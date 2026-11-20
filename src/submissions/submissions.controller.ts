import {
  Body,
  Controller,
  Delete,
  ParseUUIDPipe,
  Get,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  Patch,
  Post,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiResponse,
} from '@nestjs/swagger';
import type {} from 'multer';
import { SubmissionsService } from './submissions.service';
import { CreateSubmissionDto } from './dto/create-submission.dto';
import { CreateCommunitySubmissionDto } from './dto/create-community-submission.dto';
import { JwtAuthGuard, OptionalJwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  ImageUploadFileValidator,
  validateBatchFiles,
  validateCommunityFiles,
  MAX_IMAGE_BYTES,
  MAX_BATCH_IMAGES,
  MAX_COMMUNITY_IMAGES,
  UploadResponse,
} from './submission-upload.validation';
export {
  ImageUploadFileValidator,
  validateBatchFiles,
  validateCommunityFiles,
} from './submission-upload.validation';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

type UploadedFile = Express.Multer.File;

@ApiTags('Submissions')
@Controller('submissions')
@ApiBearerAuth()
export class SubmissionsController {
  constructor(private readonly submissionsService: SubmissionsService) {}

  @Post('community')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Submit a community cafe with optional images' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['name', 'googleMapsUrl'],
      properties: {
        name: { type: 'string' },
        googleMapsUrl: { type: 'string' },
        note: { type: 'string' },
        photos: { type: 'array', items: { type: 'string', format: 'binary' } },
      },
    },
  })
  @UseInterceptors(
    FilesInterceptor('photos', MAX_COMMUNITY_IMAGES, {
      limits: { files: MAX_COMMUNITY_IMAGES, fileSize: MAX_IMAGE_BYTES },
    }),
  )
  createCommunity(
    @CurrentUser() user: { id: string } | null,
    @Body() dto: CreateCommunitySubmissionDto,
    @UploadedFiles() files: UploadedFile[] = [],
  ) {
    validateCommunityFiles(files);
    return this.submissionsService.createCommunity(user?.id, dto, files);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Submit a new cafe for admin review' })
  create(@CurrentUser() user: any, @Body() dto: CreateSubmissionDto) {
    return this.submissionsService.create(user.id, dto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Update current user cafe submission draft' })
  update(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateSubmissionDto,
  ) {
    return this.submissionsService.update(user.id, id, dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'List current user cafe submissions' })
  getMe(@CurrentUser() user: any) {
    return this.submissionsService.getMe(user.id);
  }

  @Post(':id/submit')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Submit current user draft for admin review' })
  submit(@CurrentUser() user: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.submissionsService.submit(user.id, id);
  }

  @Delete(':id/images')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Delete a recorded draft asset; retry on storage failure' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['url'],
      properties: { url: { type: 'string', format: 'uri' } },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Current submission after deletion; repeat DELETE retries pending storage cleanup',
  })
  @ApiResponse({ status: 404, description: 'Draft or recorded asset not owned by user' })
  @ApiResponse({
    status: 502,
    description: 'Storage deletion failed; retry same URL; submit blocked',
  })
  @ApiResponse({
    status: 504,
    description: 'Legacy image storage deletion timed out; pending asset retained for retry',
  })
  deleteImage(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('url') url: string,
  ) {
    return this.submissionsService.deleteImage(user.id, id, url);
  }

  @Post(':id/images')
  @UploadResponse()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Upload gallery image for current user submission' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES } }))
  uploadImage(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: MAX_IMAGE_BYTES }),
          new ImageUploadFileValidator({}),
        ],
      }),
    )
    file: UploadedFile,
  ) {
    return this.submissionsService.uploadImage(user.id, id, file, 'images');
  }

  @Post(':id/images/batch')
  @UploadResponse()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Upload gallery images for current user submission' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['files'],
      properties: { files: { type: 'array', items: { type: 'string', format: 'binary' } } },
    },
  })
  @UseInterceptors(
    FilesInterceptor('files', MAX_BATCH_IMAGES, { limits: { fileSize: MAX_IMAGE_BYTES } }),
  )
  uploadImages(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFiles() files: UploadedFile[],
  ) {
    validateBatchFiles(files);
    return this.submissionsService.uploadImages(user.id, id, files, 'images');
  }

  @Post(':id/menu')
  @UploadResponse()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Upload menu image for current user submission' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES } }))
  uploadMenuImage(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: MAX_IMAGE_BYTES }),
          new ImageUploadFileValidator({}),
        ],
      }),
    )
    file: UploadedFile,
  ) {
    return this.submissionsService.uploadImage(user.id, id, file, 'menuImages');
  }

  @Post(':id/menu/batch')
  @UploadResponse()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Upload menu images for current user submission' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['files'],
      properties: { files: { type: 'array', items: { type: 'string', format: 'binary' } } },
    },
  })
  @UseInterceptors(
    FilesInterceptor('files', MAX_BATCH_IMAGES, { limits: { fileSize: MAX_IMAGE_BYTES } }),
  )
  uploadMenuImages(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFiles() files: UploadedFile[],
  ) {
    validateBatchFiles(files);
    return this.submissionsService.uploadImages(user.id, id, files, 'menuImages');
  }
}
