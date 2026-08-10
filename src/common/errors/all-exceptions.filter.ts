import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { PlatformError } from '../../platforms/platform.errors';
import { DomainException } from './domain.exception';

interface Problem {
  title: string;
  status: number;
  code: string;
  detail: string;
  instance: string;
  [key: string]: unknown;
}

/** Single exit point for every error shape, emitting RFC 9457 problem+json. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const problem = this.toProblem(exception, request.url);

    if (problem.status >= 500) {
      this.logger.error(`${request.method} ${request.url} -> ${problem.status}`, exception as Error);
    }

    ctx.getResponse<Response>().status(problem.status).type('application/problem+json').json(problem);
  }

  private toProblem(exception: unknown, instance: string): Problem {
    if (exception instanceof DomainException) {
      return {
        title: exception.name,
        status: exception.status,
        code: exception.code,
        detail: exception.message,
        instance,
        ...(exception.details ?? {}),
      };
    }

    if (exception instanceof PlatformError) {
      // The caller's request was fine, the upstream was not — 502/504, not 500,
      // so alerting on our own 5xx stays meaningful.
      return {
        title: 'PlatformError',
        status: exception.code === 'TIMEOUT' ? HttpStatus.GATEWAY_TIMEOUT : HttpStatus.BAD_GATEWAY,
        code: `platform_${exception.code.toLowerCase()}`,
        detail: exception.message,
        instance,
        platform: exception.platform,
        retryable: exception.retryable,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const errors =
        typeof body === 'object' && body !== null && 'message' in body
          ? (body as { message: unknown }).message
          : undefined;
      return {
        title: exception.name,
        status,
        code: status === HttpStatus.BAD_REQUEST ? 'request_invalid' : 'http_error',
        detail: exception.message,
        instance,
        ...(Array.isArray(errors) ? { errors } : {}),
      };
    }

    return {
      title: 'InternalServerError',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'internal_error',
      detail: 'An unexpected error occurred.',
      instance,
    };
  }
}
