import { randomUUID } from 'crypto';
import {
  Controller,
  ForbiddenException,
  UnauthorizedException,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtService } from '@nestjs/jwt';
import { Request, Response } from 'express';
import { CafeDetailAccessService } from '../cafe-detail-access/cafe-detail-access.service';
import { parseCookies } from '../auth/services/auth-cookie.service';
import { CafesService } from './cafes.service';
import { CafeFilterDto } from './dto/cafe-filter.dto';
import { CafeVotesService } from './cafe-votes.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RecentlyViewedService } from '../recently-viewed/recently-viewed.service';

@ApiTags('Cafes')
@Controller('cafes')
export class CafesController {
  constructor(
    private readonly detailAccess: CafeDetailAccessService,
    private readonly cafesService: CafesService,
    private readonly cafeVotesService: CafeVotesService,
    private readonly jwtService: JwtService,
    private readonly recentlyViewedService: RecentlyViewedService,
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'List cafes with filters and pagination' })
  findAll(@Query() filter: CafeFilterDto) {
    return this.cafesService.findAll(filter);
  }

  @Get('detail-quota')
  @UseGuards(OptionalJwtAuthGuard)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Read the current monthly cafe detail quota without consuming an open' })
  detailQuota(@Req() req: Request, @CurrentUser() user?: { id: string }) {
    return this.detailAccess.quota(this.detailAccess.readBrowser(req.headers.cookie), user?.id);
  }

  @Get('sitemap/entries')
  @Header('Cache-Control', 'public, max-age=300')
  @ApiOperation({ summary: 'List slugs and districts of public cafes for the sitemap' })
  @ApiOkResponse({
    schema: {
      type: 'array',
      items: {
        type: 'object',
        required: ['slug', 'district'],
        properties: {
          slug: { type: 'string' },
          district: { type: 'string', nullable: true },
        },
      },
    },
  })
  getSitemapEntries() {
    return this.cafesService.getSitemapEntries();
  }

  @Get('nearby/discovery')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Find nearby cafe previews' })
  findNearbyDiscovery(@Query() filter: CafeFilterDto) {
    return this.cafesService.findNearbyDiscovery(filter);
  }

  // Specific routes must be placed BEFORE /:slug
  @Get('nearby')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Find cafes near a location (PostGIS, optional OSRM route distance)' })
  @ApiQuery({ name: 'lat', required: true, type: Number })
  @ApiQuery({ name: 'lng', required: true, type: Number })
  @ApiQuery({
    name: 'radius',
    required: false,
    type: Number,
    description: 'Radius in km, default 2',
  })
  @ApiQuery({
    name: 'distanceMode',
    required: false,
    enum: ['straight', 'route'],
    description: 'straight = PostGIS direct distance, route = OSRM driving distance with fallback',
  })
  findNearby(
    @Query('lat') lat: number,
    @Query('lng') lng: number,
    @Query('radius') radius: number = 2,
    @Query('distanceMode') distanceMode: 'straight' | 'route' = 'straight',
    @Query('locale') locale?: string,
    @Query('search') search?: string,
    @Query('vibes') vibes?: string,
    @Query('purposes') purposes?: string,
  ) {
    return this.cafesService.findNearby(
      +lat,
      +lng,
      +radius,
      distanceMode === 'route' ? 'route' : 'straight',
      locale,
      { search, vibes: vibes?.split(',').filter(Boolean), purposes: purposes?.split(',').filter(Boolean) },
    );
  }

  @Get('districts')
  @Header('Cache-Control', 'public, max-age=3600, stale-while-revalidate=7200')
  @ApiOperation({ summary: 'List districts that have cafes' })
  getDistricts(@Query('locale') locale?: string) {
    return this.cafesService.getDistricts(locale);
  }

  @Get('votes/me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'List cafes voted by current user' })
  getMyVotes(@CurrentUser() user: { id: string }) {
    return this.cafeVotesService.getMyVotes(user.id);
  }

  @Get('quiz-match')
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  @ApiOperation({ summary: 'Recommend cafes by vibe and purpose' })
  @ApiQuery({ name: 'vibes', required: false, example: 'Cozy,Artistic' })
  @ApiQuery({ name: 'purposes', required: false, example: 'Work,Study' })
  @ApiQuery({ name: 'tags', required: false, example: 'outdoor,smoking' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 36 })
  quizMatch(
    @Query('vibes') vibes: string,
    @Query('purposes') purposes: string,
    @Query('tags') tags: string,
    @Query('limit') limit?: string,
    @Query('locale') locale?: string,
  ) {
    const vibeArr = vibes ? vibes.split(',').filter(Boolean) : [];
    const purposeArr = purposes ? purposes.split(',').filter(Boolean) : [];
    const tagArr = tags ? tags.split(',').filter(Boolean) : [];
    return this.cafesService.quizMatch(vibeArr, purposeArr, locale, tagArr, limit);
  }

  @Get(':slug/similar')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Find public cafes with a similar vibe' })
  findSimilar(@Param('slug') slug: string, @Query('locale') locale?: string) {
    return this.cafesService.findSimilar(slug, locale);
  }

  @Post(':id/vote')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Vote for a cafe' })
  vote(@Param('id') cafeId: string, @CurrentUser() user: { id: string }) {
    return this.cafeVotesService.vote(user.id, cafeId);
  }

  @Delete(':id/vote')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Remove current user vote for a cafe' })
  unvote(@Param('id') cafeId: string, @CurrentUser() user: { id: string }) {
    return this.cafeVotesService.unvote(user.id, cafeId);
  }

  @Post(':id/view')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Track a public cafe detail view' })
  async trackView(
    @Param('id') cafeId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() user?: { id: string },
  ) {
    const cookies = parseCookies(req.headers.cookie);
    const userVisitorKey = await this.getUserVisitorKey(req, cookies);
    const cookieName = 'cafe-anon-id';
    const anonId = cookies[cookieName] || randomUUID();

    if (!userVisitorKey && !cookies[cookieName]) {
      res.cookie(cookieName, anonId, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 365 * 24 * 60 * 60 * 1000,
        path: '/',
      });
    }

    const result = await this.cafesService.trackView(cafeId, userVisitorKey ?? `anon:${anonId}`);
    if (user) await this.recentlyViewedService.recordView(user.id, cafeId);
    return result;
  }

  private async getUserVisitorKey(req: Request, cookies: Record<string, string>) {
    const bearer = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    const cookieToken = cookies[process.env.JWT_COOKIE_NAME || 'cafe-auth-token'];
    const token = bearer || cookieToken;
    if (!token) return null;

    try {
      const payload = await this.jwtService.verifyAsync<{ sub?: string }>(token);
      return payload.sub ? `user:${payload.sub}` : null;
    } catch {
      return null;
    }
  }

  @Post(':slug/detail-access')
  @UseGuards(OptionalJwtAuthGuard)
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Open cafe detail and record one distinct monthly access',
    description: 'Includes imageSourceUsernames for gallery credits and experienceUrls for original posts.',
  })
  @ApiResponse({ status: 428, description: 'Retry with the guest cookie sent in Set-Cookie' })
  @ApiResponse({ status: 401, description: 'Sign in to open cafe details' })
  @ApiResponse({ status: 403, description: 'Account monthly limit reached' })
  async openDetail(
    @Param('slug') slug: string,
    @Query('locale') locale: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() user?: { id: string },
  ) {
    const cafeId = await this.cafesService.findPublicCafeId(slug);
    const browser = this.detailAccess.requireBrowser(req.headers.cookie, res);
    const result = await this.detailAccess.open(browser, user?.id, cafeId, (tx) =>
      this.cafesService.findBySlug(cafeId, locale, tx),
    );

    if (result.status === 'login-required') throw new UnauthorizedException('DETAIL_LOGIN_REQUIRED');
    if (result.status === 'guest-quota-exhausted') throw new UnauthorizedException('DETAIL_GUEST_QUOTA_EXHAUSTED');
    if (result.status === 'quota-exhausted') throw new ForbiddenException('DETAIL_QUOTA_EXHAUSTED');
    return result.cafe;
  }

  @Get(':slug')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Get public cafe preview by slug' })
  findOne(@Param('slug') slug: string, @Query('locale') locale?: string) {
    return this.cafesService.findPreview(slug, locale);
  }
}
