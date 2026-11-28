import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Webhook } from '@payos/node';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PaymentsService } from './payments.service';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('cafe-detail/pricing')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Read launch pricing and the number of offers not yet paid' })
  pricing() {
    return this.payments.pricing();
  }

  @Post('cafe-detail')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Create or resume a checkout for 30 days of cafe detail access',
    description:
      'Pending checkouts include the exact amount in VND. The first five buyers pay 10,000 VND, then the price is 19,000 VND.',
  })
  @ApiResponse({ status: 409, description: 'Remaining launch offers are temporarily reserved' })
  checkout(@CurrentUser() user: { id: string }) {
    return this.payments.checkout(user.id);
  }

  @Get('cafe-detail/:orderCode')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Read the signed-in account’s checkout status' })
  status(@CurrentUser() user: { id: string }, @Param('orderCode', ParseIntPipe) orderCode: number) {
    return this.payments.status(user.id, orderCode);
  }

  @Post('cafe-detail/:orderCode/mock-complete')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  completeMock(
    @CurrentUser() user: { id: string },
    @Param('orderCode', ParseIntPipe) orderCode: number,
  ) {
    return this.payments.completeMock(user.id, orderCode);
  }

  @Post('payos/webhook')
  @HttpCode(200)
  @ApiOperation({ summary: 'Receive verified PayOS payment events' })
  webhook(@Body() event: Webhook) {
    return this.payments.webhook(event);
  }
}
