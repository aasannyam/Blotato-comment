import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Post } from './entities/post.entity';
import { SocialAccount } from './entities/social-account.entity';
import { PostsService } from './posts.service';

/**
 * Only the slice of posts the comment system needs. In the real product this
 * module already exists; the comment system depends on `PostsService` and
 * nothing deeper.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Post, SocialAccount])],
  providers: [PostsService],
  exports: [PostsService, TypeOrmModule],
})
export class PostsModule {}
