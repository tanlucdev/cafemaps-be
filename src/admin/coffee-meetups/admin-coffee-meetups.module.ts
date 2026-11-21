import { Module } from '@nestjs/common';
import { CoffeeMeetupsModule } from '../../coffee-meetups/coffee-meetups.module';
import { AdminCoffeeMeetupsController } from './admin-coffee-meetups.controller';

@Module({
  imports: [CoffeeMeetupsModule],
  controllers: [AdminCoffeeMeetupsController],
})
export class AdminCoffeeMeetupsModule {}
