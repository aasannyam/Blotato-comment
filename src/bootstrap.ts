import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';

/**
 * Shared app setup. Kept out of `main.ts` so importing it does not also start a
 * server — `main.ts` calls `bootstrap()` at module load.
 */
export function configureApp(app: INestApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      // Unknown fields are rejected, not ignored: `?refresh=treu` silently doing
      // nothing is a support ticket; a 400 is not.
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  SwaggerModule.setup(
    'docs',
    app,
    SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Blotato Comments API')
        .setDescription('Retrieve and reply to comments on published posts across social platforms.')
        .setVersion('1.0')
        .build(),
    ),
  );
}
