import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlatformsModule } from '../platforms/platforms.module';
import { PostsModule } from '../posts/posts.module';
import { CommentAuthorsRepository } from './repositories/comment-authors.repository';
import { CommentSyncService } from './services/comment-sync.service';
import { CommentsController } from './controllers/comments.controller';
import { CommentsRepository } from './repositories/comments.repository';
import { SyncStateRepository } from './repositories/sync-state.repository';
import { CommentsService } from './services/comments.service';
import { CommentAuthor } from './entities/comment-author.entity';
import { CommentSyncState } from './entities/comment-sync-state.entity';
import { Comment } from './entities/comment.entity';
import { PostCommentsController } from './controllers/post-comments.controller';
import { RepliesService } from './services/replies.service';
import { CommentPollerService } from './workers/comment-poller.service';
import { ReplyDispatcherService } from './workers/reply-dispatcher.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Comment, CommentAuthor, CommentSyncState]),
    PostsModule,
    PlatformsModule,
  ],
  controllers: [PostCommentsController, CommentsController],
  providers: [
    CommentsRepository,
    CommentAuthorsRepository,
    SyncStateRepository,
    CommentsService,
    RepliesService,
    CommentSyncService,
    ReplyDispatcherService,
    CommentPollerService,
  ],
  exports: [CommentsService, RepliesService, CommentSyncService],
})
export class CommentsModule {}
