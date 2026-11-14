import {
  Body,
  Controller,
  Get,
  Header,
  MaxFileSizeValidator,
  ParseFilePipe,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiExtraModels,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UpdateDonationSettingsDto } from './donation-settings.dto';
import { DonationSettingsService } from './donation-settings.service';

const MAX_QR_BYTES = 5 * 1024 * 1024;

@ApiTags('Donation Settings')
@Controller('donation-settings')
export class DonationSettingsController {
  constructor(private readonly settings: DonationSettingsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Public footer donation settings; null fields use frontend defaults' })
  get() {
    return this.settings.get();
  }
}

@ApiTags('Admin Donation Settings')
@ApiExtraModels(UpdateDonationSettingsDto)
@Controller('admin/donation-settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@ApiBearerAuth()
export class AdminDonationSettingsController {
  constructor(private readonly settings: DonationSettingsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  get() {
    return this.settings.get();
  }

  @Put()
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_QR_BYTES, files: 1, fields: 5 } }),
  )
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({
    schema: {
      allOf: [
        { $ref: '#/components/schemas/UpdateDonationSettingsDto' },
        {
          type: 'object',
          properties: { file: { type: 'string', format: 'binary' } },
        },
      ],
    },
  })
  @ApiOperation({
    summary:
      'Save settings and optional QR together; JPEG/PNG/WebP up to 5 MB. No file preserves QR.',
  })
  update(
    @Body() dto: UpdateDonationSettingsDto,
    @UploadedFile(
      new ParseFilePipe({
        fileIsRequired: false,
        validators: [new MaxFileSizeValidator({ maxSize: MAX_QR_BYTES })],
      }),
    )
    file?: Express.Multer.File,
  ) {
    return this.settings.update(dto, file);
  }
}
