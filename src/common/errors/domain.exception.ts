import { HttpStatus } from '@nestjs/common';

export class DomainException extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: HttpStatus,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class PostNotFoundException extends DomainException {
  constructor(postId: string) {
    super('post_not_found', `Post ${postId} was not found.`, HttpStatus.NOT_FOUND);
  }
}

export class CommentNotFoundException extends DomainException {
  constructor(commentId: string) {
    super('comment_not_found', `Comment ${commentId} was not found.`, HttpStatus.NOT_FOUND);
  }
}

export class UnsupportedPlatformException extends DomainException {
  constructor(platform: string) {
    super(
      'unsupported_platform',
      `No comment adapter registered for "${platform}".`,
      HttpStatus.NOT_IMPLEMENTED,
      { platform },
    );
  }
}

export class ReplyTooLongException extends DomainException {
  constructor(platform: string, length: number, maxLength: number) {
    super(
      'reply_too_long',
      `Reply is ${length} characters; ${platform} allows ${maxLength}.`,
      HttpStatus.UNPROCESSABLE_ENTITY,
      { platform, length, maxLength },
    );
  }
}

export class IdempotencyConflictException extends DomainException {
  constructor(key: string) {
    super(
      'idempotency_conflict',
      `Idempotency key "${key}" was already used with a different body.`,
      HttpStatus.CONFLICT,
      { idempotencyKey: key },
    );
  }
}

export class InvalidCursorException extends DomainException {
  constructor() {
    super('invalid_cursor', 'The pagination cursor is not valid.', HttpStatus.BAD_REQUEST);
  }
}
