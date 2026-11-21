import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AdminCoffeeMeetupListDto } from '../../coffee-meetups/dto/coffee-meetup.dto';
import { CoffeeMeetupsService } from '../../coffee-meetups/coffee-meetups.service';
import { UpdateAdminCoffeeMeetupDto } from './dto/update-admin-coffee-meetup.dto';

@ApiTags('Admin Coffee Meetups')
@Controller('admin/coffee-meetups')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@ApiBearerAuth()
export class AdminCoffeeMeetupsController {
  constructor(private readonly meetups: CoffeeMeetupsService) {}

  @Get()
  @ApiOperation({ summary: 'List coffee meetups for moderation' })
  list(@Query() query: AdminCoffeeMeetupListDto) {
    return this.meetups.adminList(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get coffee meetup moderation detail' })
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.meetups.adminDetail(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Moderate coffee meetup' })
  patch(
    @CurrentUser() user: { id: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdminCoffeeMeetupDto,
  ) {
    return this.meetups.adminPatch(user.id, id, dto);
  }
}
