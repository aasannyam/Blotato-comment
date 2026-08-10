import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlatformsModule } from '../platforms/platforms.module';
import { PostsModule } from '../posts/posts.module';
import { CommentAuthorsRepository } from './comment-authors.repository';
import { CommentSyncService } from './comment-sync.service';
import { CommentsController } from './comments.controller';
import { CommentsRepository } from './comments.repository';
import { CommentsService } from './comments.service';
import { CommentAuthor } from './entities/comment-author.entity';
import { CommentSyncState } from './entities/comment-sync-state.entity';
import { Comment } from './entities/comment.entity';
import { PostCommentsController } from './post-comments.controller';
import { RepliesService } from './replies.service';
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
    CommentsService,
    RepliesService,
    CommentSyncService,
    ReplyDispatcherService,
    CommentPollerService,
  ],
  exports: [CommentsService, RepliesService, CommentSyncService],
})
export class CommentsModule {}
