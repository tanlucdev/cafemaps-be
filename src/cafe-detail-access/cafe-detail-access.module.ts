import { Module } from '@nestjs/common';
import { CafeDetailAccessService } from './cafe-detail-access.service';

@Module({
  providers: [CafeDetailAccessService],
  exports: [CafeDetailAccessService],
})
export class CafeDetailAccessModule {}
