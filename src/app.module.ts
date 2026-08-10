import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommentsModule } from './comments/comments.module';
import configuration from './common/config/configuration';
import { entities } from './database/data-source';
import { PlatformsModule } from './platforms/platforms.module';
import { PostsModule } from './posts/posts.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration], cache: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        url: config.getOrThrow<string>('databaseUrl'),
        entities,
        // Schema is owned by migrations, never inferred. See data-source.ts.
        synchronize: false,
        migrationsRun: false,
      }),
    }),
    ScheduleModule.forRoot(),
    PlatformsModule,
    PostsModule,
    CommentsModule,
  ],
})
export class AppModule {}
