import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { CafeDetailAccessService } from '../cafe-detail-access/cafe-detail-access.service';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { OAuthStartDto } from './dto/oauth-start.dto';
import { AuthCookieService } from './services/auth-cookie.service';
import { GoogleOAuthService } from './services/google-oauth.service';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly authCookieService: AuthCookieService,
    private readonly detailAccess: CafeDetailAccessService,
    private readonly googleOAuthService: GoogleOAuthService,
  ) {}

  @Post('register')
  @ApiOperation({ summary: 'Register a new account' })
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.register(dto);
    await this.detailAccess.mergeOnLogin(this.detailAccess.readBrowser(req.headers.cookie), result.user.id);
    this.authCookieService.setJwtCookie(res, result.token);
    return result;
  }

  @Post('login')
  @ApiOperation({ summary: 'Login and receive a JWT token' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(dto);
    await this.detailAccess.mergeOnLogin(this.detailAccess.readBrowser(req.headers.cookie), result.user.id);
    this.authCookieService.setJwtCookie(res, result.token);
    return result;
  }

  @Get('oauth/google/start')
  @ApiOperation({ summary: 'Start Google OAuth login' })
  startGoogleOAuth(@Query() dto: OAuthStartDto, @Res({ passthrough: true }) res: Response) {
    const returnUrl = normalizeReturnUrl(dto.returnUrl);
    const result = this.googleOAuthService.getAuthorizationUrl(returnUrl);
    this.authCookieService.setOAuthStateCookie(res, {
      state: result.state,
      returnUrl: result.returnUrl,
    });
    return { authorizationUrl: result.authorizationUrl };
  }

  @Get('oauth/google/callback')
  @ApiOperation({ summary: 'Handle Google OAuth callback' })
  async finishGoogleOAuth(
    @Query('code') code: string,
    @Query('state') state: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const saved = this.authCookieService.getOAuthStateCookie(req.headers.cookie);
    this.authCookieService.clearOAuthStateCookie(res);
    if (!code || !state || !saved || saved.state !== state) {
      throw new BadRequestException('Invalid OAuth state');
    }

    const result = await this.googleOAuthService.finish(code);
    await this.detailAccess.mergeOnLogin(this.detailAccess.readBrowser(req.headers.cookie), result.user.id);
    this.authCookieService.setJwtCookie(res, result.token);
    return res.redirect(normalizeReturnUrl(saved.returnUrl));
  }

  @Post('logout')
  @ApiOperation({ summary: 'Clear auth cookie' })
  logout(@Res({ passthrough: true }) res: Response) {
    this.authCookieService.clearJwtCookie(res);
    return { ok: true };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user info' })
  getMe(@CurrentUser() user: any) {
    return this.authService.getMe(user.id);
  }

  @Patch('profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update profile information' })
  updateProfile(@CurrentUser() user: any, @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(user.id, dto);
  }

  @Patch('password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change password' })
  changePassword(@CurrentUser() user: any, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(user.id, dto);
  }

  @Post('forgot-password')
  @ApiOperation({ summary: 'Request password reset — sends a link via email' })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email, dto.locale ?? 'vi');
  }

  @Post('reset-password')
  @ApiOperation({ summary: 'Reset password using token from email' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.newPassword);
  }
}

function normalizeReturnUrl(returnUrl?: string) {
  if (!returnUrl) return '/';
  try {
    const url = new URL(returnUrl, 'http://local');
    if (url.origin !== 'http://local') return '/';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/';
  }
}
