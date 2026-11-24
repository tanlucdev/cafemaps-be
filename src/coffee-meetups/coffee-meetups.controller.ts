import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { CoffeeMeetupsService } from './coffee-meetups.service';
import {
  CoffeeMeetupListDto,
  CoffeeMeetupRequestDto,
  CreateCoffeeMeetupDto,
  ReportCoffeeMeetupDto,
  UpdateCoffeeMeetupDto,
} from './dto/coffee-meetup.dto';

@ApiTags('Coffee Meetups')
@Controller('coffee-meetups')
export class CoffeeMeetupsController {
  constructor(private readonly meetups: CoffeeMeetupsService) {}

  @Get()
  @ApiOperation({ summary: 'List public coffee meetups' })
  list(@Query() query: CoffeeMeetupListDto) {
    return this.meetups.list(query);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List current user coffee meetups and requests' })
  me(@CurrentUser() user: { id: string }) {
    return this.meetups.me(user.id);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create coffee meetup' })
  create(@CurrentUser() user: { id: string }, @Body() dto: CreateCoffeeMeetupDto) {
    return this.meetups.create(user.id, dto);
  }

  @Get(':id')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Get public coffee meetup detail' })
  detail(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user?: { id: string } | null) {
    return this.meetups.detail(id, user?.id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update owned coffee meetup' })
  update(
    @CurrentUser() user: { id: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCoffeeMeetupDto,
  ) {
    return this.meetups.update(user.id, id, dto);
  }

  @Post(':id/requests')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Request to join coffee meetup' })
  request(
    @CurrentUser() user: { id: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CoffeeMeetupRequestDto,
  ) {
    return this.meetups.request(user.id, id, dto);
  }

  @Post(':id/cancel')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel owned coffee meetup' })
  cancel(@CurrentUser() user: { id: string }, @Param('id', ParseUUIDPipe) id: string) {
    return this.meetups.cancel(user.id, id);
  }

  @Post(':id/complete')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Complete owned coffee meetup' })
  complete(@CurrentUser() user: { id: string }, @Param('id', ParseUUIDPipe) id: string) {
    return this.meetups.complete(user.id, id);
  }

  @Post(':id/report')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Report coffee meetup' })
  report(
    @CurrentUser() user: { id: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReportCoffeeMeetupDto,
  ) {
    return this.meetups.report(user.id, id, dto);
  }

  @Delete('requests/:requestId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Withdraw current user coffee meetup request' })
  withdraw(@CurrentUser() user: { id: string }, @Param('requestId', ParseUUIDPipe) requestId: string) {
    return this.meetups.withdraw(user.id, requestId);
  }

  @Post('requests/:requestId/accept')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Accept coffee meetup request' })
  accept(@CurrentUser() user: { id: string }, @Param('requestId', ParseUUIDPipe) requestId: string) {
    return this.meetups.accept(user.id, requestId);
  }

  @Post('requests/:requestId/reject')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reject coffee meetup request' })
  reject(@CurrentUser() user: { id: string }, @Param('requestId', ParseUUIDPipe) requestId: string) {
    return this.meetups.reject(user.id, requestId);
  }
}
