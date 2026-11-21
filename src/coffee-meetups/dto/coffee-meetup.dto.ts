import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsHexColor,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class MeetupPlaceDto {
  @ApiProperty({ enum: ['cafe', 'external'] })
  @IsIn(['cafe', 'external'])
  kind: 'cafe' | 'external';

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  cafeId?: string;

  @ApiPropertyOptional()
  @Transform(trim)
  @IsOptional()
  @IsString()
  @Length(2, 160)
  name?: string;

  @ApiPropertyOptional()
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  googleMapsUrl?: string;
}

export class CoffeeMeetupListDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  cafeId?: string;

  @ApiPropertyOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsOptional()
  @IsBoolean()
  nearMe?: boolean;

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsOptional()
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(-90)
  @Max(90)
  lat?: number;

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsOptional()
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(-180)
  @Max(180)
  lng?: number;

  @ApiPropertyOptional({ default: 2, enum: [2, 5, 10] })
  @Type(() => Number)
  @IsOptional()
  @IsIn([2, 5, 10])
  radiusKm?: number = 2;

  @ApiPropertyOptional()
  @Transform(trim)
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @Transform(trim)
  @IsOptional()
  @IsString()
  purpose?: string;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD' })
  @Transform(trim)
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional()
  @Transform(trim)
  @IsOptional()
  @IsString()
  area?: string;

  @ApiPropertyOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsOptional()
  @IsBoolean()
  available?: boolean;

  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 12 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 12;
}

const invitationTemplates = ['envelope', 'postcard', 'ticket', 'notebook', 'menu', 'picnic', 'film', 'ribbon', 'stars', 'latte', 'matchbox', 'pressed-flower', 'receipt', 'window', 'checkers'];
const invitationColors = ['caramel', 'rose', 'matcha', 'blue', 'cocoa'];

export class CreateCoffeeMeetupDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  cafeId?: string;

  @ApiPropertyOptional({ type: MeetupPlaceDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => MeetupPlaceDto)
  place?: MeetupPlaceDto;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  purpose: string;

  @ApiPropertyOptional({ enum: ['book', 'work', 'language', 'friends', 'chat', 'coffee', 'games', 'music', 'camera', 'art', 'sparkles'] })
  @IsOptional()
  @IsString()
  @IsIn(['book', 'work', 'language', 'friends', 'chat', 'coffee', 'games', 'music', 'camera', 'art', 'sparkles'])
  purposeIcon?: string;

  @ApiPropertyOptional({ example: '#875200' })
  @IsOptional()
  @IsHexColor()
  purposeColor?: string;

  @ApiPropertyOptional({ enum: invitationTemplates })
  @IsOptional()
  @IsIn(invitationTemplates)
  invitationTemplate?: string;

  @ApiPropertyOptional({ enum: invitationColors })
  @IsOptional()
  @IsIn(invitationColors)
  invitationColor?: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(3, 120)
  title: string;

  @ApiPropertyOptional()
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ maxLength: 200, description: 'Public contact details for this meetup' })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  contactInfo?: string;

  @ApiProperty()
  @IsDateString()
  startsAt: string;

  @ApiProperty()
  @IsDateString()
  endsAt: string;

  @ApiProperty({ minimum: 2, maximum: 10 })
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(10)
  maxParticipants: number;
}

export class UpdateCoffeeMeetupDto extends PartialType(CreateCoffeeMeetupDto) {}

export class CoffeeMeetupRequestDto {
  @ApiPropertyOptional()
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;
}

export class ReportCoffeeMeetupDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  reason: string;

  @ApiPropertyOptional()
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class AdminCoffeeMeetupListDto extends CoffeeMeetupListDto {
  @ApiPropertyOptional({ enum: ['open', 'full', 'cancelled', 'completed'] })
  @IsOptional()
  @IsIn(['open', 'full', 'cancelled', 'completed'])
  status?: string;

  @ApiPropertyOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsOptional()
  @IsBoolean()
  hidden?: boolean;

  @ApiPropertyOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsOptional()
  @IsBoolean()
  reported?: boolean;
}
