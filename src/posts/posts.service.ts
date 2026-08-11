import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DomainException, PostNotFoundException } from '../common/errors/domain.exception';
import { PlatformContext } from '../platforms/platform-client.interface';
import { Post } from './entities/post.entity';
import { SocialAccount } from './entities/social-account.entity';

export interface PublishedPostContext {
  post: Post & { platformPostId: string };
  account: SocialAccount;
  platformContext: PlatformContext;
}

@Injectable()
export class PostsService {
  constructor(
    @InjectRepository(Post) private readonly posts: Repository<Post>,
    @InjectRepository(SocialAccount) private readonly accounts: Repository<SocialAccount>,
  ) {}

  async getPublishedPost(workspaceId: string, postId: string): Promise<PublishedPostContext> {
    const post = await this.posts.findOne({ where: { id: postId, workspaceId } });
    // Another workspace's post reads as missing; 403 would confirm the id exists.
    if (!post) throw new PostNotFoundException(postId);

    if (!post.isPublished()) {
      throw new DomainException(
        'post_not_published',
        `Post ${postId} has not been published, so it has no comments.`,
        HttpStatus.CONFLICT,
      );
    }

    const account = await this.accounts.findOne({ where: { id: post.socialAccountId } });
    if (!account) {
      throw new DomainException(
        'social_account_disconnected',
        'The social account that published this post is no longer connected.',
        HttpStatus.CONFLICT,
      );
    }

    return {
      post,
      account,
      platformContext: {
        socialAccountId: account.id,
        platformAccountId: account.platformAccountId,
        credentialRef: account.credentialRef,
      },
    };
  }
}
