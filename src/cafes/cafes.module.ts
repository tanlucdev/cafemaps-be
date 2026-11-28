import { Module } from '@nestjs/common';
import { CafeDetailAccessModule } from '../cafe-detail-access/cafe-detail-access.module';
import { CafesController } from './cafes.controller';
import { CafesService } from './cafes.service';
import { RouteDistanceService } from './route-distance.service';
import { CafeVotesService } from './cafe-votes.service';
import { AuthModule } from '../auth/auth.module';
import { RecentlyViewedModule } from '../recently-viewed/recently-viewed.module';

@Module({
  imports: [AuthModule, RecentlyViewedModule, CafeDetailAccessModule],
  controllers: [CafesController],
  providers: [CafesService, RouteDistanceService, CafeVotesService],
  exports: [CafesService],
})
export class CafesModule {}
