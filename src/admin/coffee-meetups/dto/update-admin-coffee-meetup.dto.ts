import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class UpdateAdminCoffeeMeetupDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isHidden?: boolean;

  @ApiPropertyOptional({ enum: ['open', 'full', 'cancelled', 'completed'] })
  @IsOptional()
  @IsIn(['open', 'full', 'cancelled', 'completed'])
  status?: string;

  @ApiPropertyOptional()
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  adminNote?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  resolveReports?: boolean;
}
