import { CafeFilterDto } from './dto/cafe-filter.dto';

export type DistanceMode = 'straight' | 'route';

export interface NearbyCafeRow {
  id: string;
  name: string;
  nameEn: string | null;
  slug: string;
  address: string | null;
  addressEn: string | null;
  district: string | null;
  districtEn: string | null;
  openingTime: Date | string | null;
  closingTime: Date | string | null;
  priceMin: number | null;
  priceMax: number | null;
  oneLiner: string | null;
  oneLinerEn: string | null;
  parkingLocation: string | null;
  parkingLocationEn: string | null;
  vibes: string[];
  vibesEn: string[];
  purposes: string[];
  purposesEn: string[];
  amenities: string[];
  amenitiesEn: string[];
  tags: string[];
  tagsEn: string[];
  coverImage: string | null;
  coverImageCrop?: unknown;
  menuImage?: string | null;
  menuImages?: string[];
  lat: number;
  lng: number;
  distance_km: number | string;
  distanceMode?: DistanceMode;
  distance_mode?: DistanceMode;
  straight_distance_km?: number | string;
  duration_min?: number;
}

export const cafeListSelect = {
  id: true,
  name: true,
  nameEn: true,
  slug: true,
  address: true,
  addressEn: true,
  district: true,
  districtEn: true,
  openingTime: true,
  closingTime: true,
  priceMin: true,
  priceMax: true,
  oneLiner: true,
  oneLinerEn: true,
  parkingLocation: true,
  parkingLocationEn: true,
  vibes: true,
  vibesEn: true,
  purposes: true,
  purposesEn: true,
  amenities: true,
  amenitiesEn: true,
  tags: true,
  tagsEn: true,
  rating: true,
  isFeatured: true,
  featuredOrder: true,
  viewCount: true,
  coverImage: true,
  coverImageCrop: true,
  menuImage: true,
  menuImages: true,
  chain: { select: { id: true, name: true, slug: true } },
  createdAt: true,
  updatedAt: true,
  _count: { select: { savedCafes: true } },
};

export function priceRangeToFilter(priceRange: string): object {
  switch (priceRange) {
    case 'under_50k':
      return { priceMax: { lte: 50000 } };
    case 'price_50k_100k':
      return { priceMin: { gte: 50000 }, priceMax: { lte: 100000 } };
    case 'price_100k_150k':
      return { priceMin: { gte: 100000 }, priceMax: { lte: 150000 } };
    case 'above_150k':
      return { priceMin: { gte: 150000 } };
    default:
      return {};
  }
}

export function cafeOrderBy(sort: CafeFilterDto['sort']): any[] {
  if (sort === 'rating') {
    return [
      { rating: { sort: 'desc', nulls: 'last' } },
      { isFeatured: 'desc' },
      { featuredOrder: { sort: 'asc', nulls: 'last' } },
      { createdAt: 'desc' },
      { id: 'asc' },
    ];
  }

  if (sort === 'newest') {
    return [{ createdAt: 'desc' }, { id: 'asc' }];
  }

  return [
    { viewCount: 'desc' },
    { cafeVotes: { _count: 'desc' } },
    { isFeatured: 'desc' },
    { featuredOrder: { sort: 'asc', nulls: 'last' } },
    { savedCafes: { _count: 'desc' } },
    { createdAt: 'desc' },
  ];
}

export function getVietnamTimeAsDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
  const date = new Date(0);
  date.setUTCHours(hour, minute, 0, 0);
  return date;
}

export function openNowWhere(openingTimeField: any, now = getVietnamTimeAsDate()) {
  return {
    openingTime: { not: null },
    closingTime: { not: null },
    OR: [
      { closingTime: { equals: openingTimeField } },
      { AND: [{ openingTime: { lte: now } }, { closingTime: { gt: now } }] },
      {
        AND: [
          { closingTime: { lte: openingTimeField } },
          { OR: [{ openingTime: { lte: now } }, { closingTime: { gt: now } }] },
        ],
      },
    ],
  };
}

export function hoursWhere(hours: CafeFilterDto['hours'], closingTimeField: any) {
  if (hours === 'open_24h') return { openingTime: { equals: closingTimeField } };
  return { openingTime: { equals: new Date('1970-01-01T07:00:00.000Z') } };
}
