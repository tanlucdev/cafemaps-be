import { Module } from '@nestjs/common';
import { CoffeeMeetupsController } from './coffee-meetups.controller';
import { CoffeeMeetupsService } from './coffee-meetups.service';

@Module({
  controllers: [CoffeeMeetupsController],
  providers: [CoffeeMeetupsService],
  exports: [CoffeeMeetupsService],
})
export class CoffeeMeetupsModule {}
