import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const trim = ({ obj, key }: { obj: Record<string, unknown>; key: string }) => {
  const value = obj[key];
  return typeof value === 'string' ? value.trim() || null : value;
};

export class UpdateDonationSettingsDto {
  @ApiProperty({ description: 'Show or hide the footer donation section', type: Boolean })
  @Transform(({ obj }) =>
    obj.enabled === 'true' ? true : obj.enabled === 'false' ? false : obj.enabled,
  )
  @IsBoolean()
  enabled: boolean;

  @ApiPropertyOptional({
    maxLength: 120,
    nullable: true,
    description: 'Blank uses the frontend default',
  })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  titleVi?: string | null;

  @ApiPropertyOptional({ maxLength: 120, nullable: true })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  titleEn?: string | null;

  @ApiPropertyOptional({ maxLength: 500, nullable: true })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  descriptionVi?: string | null;

  @ApiPropertyOptional({ maxLength: 500, nullable: true })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  descriptionEn?: string | null;
}
