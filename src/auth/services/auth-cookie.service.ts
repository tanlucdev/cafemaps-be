import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';

const DEFAULT_JWT_COOKIE = 'cafe-auth-token';
const OAUTH_STATE_COOKIE = 'cafe-google-oauth-state';

@Injectable()
export class AuthCookieService {
  constructor(private config: ConfigService) {}

  get jwtCookieName() {
    return this.config.get<string>('JWT_COOKIE_NAME') || DEFAULT_JWT_COOKIE;
  }

  setJwtCookie(res: Response, token: string) {
    res.cookie(this.jwtCookieName, token, {
      httpOnly: true,
      secure: this.config.get<string>('NODE_ENV') === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: this.jwtMaxAgeMs(),
    });
  }

  clearJwtCookie(res: Response) {
    res.clearCookie(this.jwtCookieName, { path: '/' });
  }

  setOAuthStateCookie(res: Response, value: { state: string; returnUrl: string }) {
    res.cookie(OAUTH_STATE_COOKIE, Buffer.from(JSON.stringify(value)).toString('base64url'), {
      httpOnly: true,
      secure: this.config.get<string>('NODE_ENV') === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 5 * 60 * 1000,
    });
  }

  getOAuthStateCookie(cookieHeader?: string) {
    const value = parseCookies(cookieHeader)[OAUTH_STATE_COOKIE];
    if (!value) return null;
    try {
      return JSON.parse(Buffer.from(value, 'base64url').toString()) as {
        state: string;
        returnUrl: string;
      };
    } catch {
      return null;
    }
  }

  clearOAuthStateCookie(res: Response) {
    res.clearCookie(OAUTH_STATE_COOKIE, { path: '/' });
  }

  private jwtMaxAgeMs() {
    const value = this.config.get<string>('JWT_EXPIRES_IN') || '7d';
    const match = /^(\d+)([smhd])?$/.exec(value);
    if (!match) return 7 * 24 * 60 * 60 * 1000;
    const amount = Number(match[1]);
    const unit = match[2] || 's';
    return amount * ({ s: 1000, m: 60000, h: 3600000, d: 86400000 }[unit] ?? 1000);
  }
}

export function parseCookies(cookieHeader?: string) {
  return Object.fromEntries(
    (cookieHeader || '').split(';').flatMap((part) => {
      const index = part.indexOf('=');
      if (index < 0) return [];
      try {
        return [[part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())]];
      } catch {
        return [];
      }
    }),
  );
}
