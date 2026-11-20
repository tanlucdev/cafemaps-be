import { SubmissionMediaService } from './submission-media.service';
import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { SubmissionsController } from './submissions.controller';
import { SubmissionAssetsController } from './submission-assets.controller';
import { SubmissionAssetsService } from './submission-assets.service';
import { SubmissionsService } from './submissions.service';

@Module({
  imports: [StorageModule],
  controllers: [SubmissionsController, SubmissionAssetsController],
  providers: [SubmissionMediaService, SubmissionsService, SubmissionAssetsService],
})
export class SubmissionsModule {}
