import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import {
  AdminDonationSettingsController,
  DonationSettingsController,
} from './donation-settings.controller';
import { DonationSettingsService } from './donation-settings.service';

@Module({
  imports: [StorageModule],
  controllers: [DonationSettingsController, AdminDonationSettingsController],
  providers: [DonationSettingsService],
})
export class DonationSettingsModule {}
