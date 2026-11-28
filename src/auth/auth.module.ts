import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { CafeDetailAccessModule } from '../cafe-detail-access/cafe-detail-access.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { EmailModule } from '../email/email.module';
import { AuthCookieService } from './services/auth-cookie.service';
import { GoogleOAuthService } from './services/google-oauth.service';

@Module({
  imports: [
    PassportModule,
    CafeDetailAccessModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_SECRET'),
        signOptions: { expiresIn: config.get('JWT_EXPIRES_IN', '7d') },
      }),
    }),
    EmailModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, AuthCookieService, GoogleOAuthService],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
