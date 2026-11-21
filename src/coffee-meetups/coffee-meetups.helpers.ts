export const PURPOSE_ALIASES: Record<string, string> = {
  study: 'study', 'học tập': 'study', work: 'work', 'làm việc': 'work',
  language: 'language', 'language practice': 'language', 'luyện ngoại ngữ': 'language',
  reading: 'reading', 'đọc sách': 'reading', friends: 'friends',
  'meet new friends': 'friends', 'gặp bạn mới': 'friends', chat: 'chat', 'trò chuyện': 'chat',
};

export const normalizePurpose = (value?: string) => {
  const raw = value?.trim() ?? '';
  return PURPOSE_ALIASES[raw.toLowerCase()] ?? raw;
};
export const purposeValues = (value?: string) => {
  if (!value) return [];
  const normalized = normalizePurpose(value);
  return Object.entries(PURPOSE_ALIASES).filter(([, code]) => code === normalized).map(([alias]) => alias).concat(normalized);
};

export const normalizeGoogleMapsUrl = (value: string) => {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.port || /\s/.test(value.trim())) return null;
    const host = url.hostname;
    const path = url.pathname;
    if (host === 'maps.google.com' && path === '/' && url.searchParams.get('cid')?.trim()) {
      return 'https://www.google.com/maps' + url.search + url.hash;
    }
    if ((host === 'maps.app.goo.gl' && path.length > 1) ||
        (host === 'goo.gl' && path.startsWith('/maps/') && path.length > 6) ||
        ((host === 'google.com' || host === 'www.google.com') && path.startsWith('/maps'))) {
      return url.href;
    }
  } catch {
    return null;
  }
  return null;
};

export const pageValue = (value: number | undefined, fallback: number, max?: number) => {
  const next = Number(value);
  if (!Number.isInteger(next) || next <= 0) return fallback;
  return max ? Math.min(next, max) : next;
};
export const statusData = (status: string, now: Date) => ({ status, cancelledAt: status === 'cancelled' ? now : null, completedAt: status === 'completed' ? now : null });
export const dateWhere = (date?: string) => {
  if (!date) return {};
  const start = new Date(`${date}T00:00:00.000+07:00`);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  return { startsAt: { gte: start, lt: end } };
};
export const searchWhere = (search?: string, admin = false) => {
  const q = search?.trim();
  return q ? { OR: [
    { title: { contains: q, mode: 'insensitive' as const } },
    { externalPlaceName: { contains: q, mode: 'insensitive' as const } },
    { cafe: { name: { contains: q, mode: 'insensitive' as const } } },
    ...(admin ? [{ organizer: { email: { contains: q, mode: 'insensitive' as const } } }] : []),
  ] } : {};
};

export const userSelect = { id: true, displayName: true } as const;
export const adminUserSelect = { ...userSelect, email: true } as const;
export const cafeSelect = { id: true, name: true, slug: true, address: true, district: true, coverImage: true, images: true } as const;
export const counts = { requests: { where: { status: 'accepted' }  } } as const;
export const adminCounts = { ...counts, reports: true } as const;
export const displayName = (user: any) => user?.displayName?.trim() || 'Cafe Maps user';
export const acceptedRequestCount = (meetup: any) => meetup._count?.requests ?? (Array.isArray(meetup.requests) ? meetup.requests.filter((request: any) => request.status === 'accepted').length : 0);
export const pendingRequestCount = (meetup: any) => Array.isArray(meetup.requests) ? meetup.requests.filter((request: any) => request.status === 'pending').length : 0;
export const seats = (meetup: any) => 1 + acceptedRequestCount(meetup);

export const serializeMeetup = (meetup: any, detail = false, viewerId?: string | null, admin = false, includeParticipants = detail) => {
  const organizerName = displayName(meetup.organizer);
  const isOwner = Boolean(viewerId && viewerId === meetup.organizerId);
  const requests = Array.isArray(meetup.requests) ? meetup.requests : [];
  const myRequest = viewerId ? requests.find((request: any) => request.requesterId === viewerId) : null;
  const visibleRequests = detail ? (admin || isOwner ? requests : myRequest ? [myRequest] : []) : [];
  const cafe = meetup.cafe ?? null;
  const place = cafe ? { kind: 'cafe' as const, cafeId: meetup.cafeId } : { kind: 'external' as const, name: meetup.externalPlaceName, googleMapsUrl: meetup.externalGoogleMapsUrl };
  return {
    id: meetup.id, cafeId: meetup.cafeId ?? null, place, organizerId: meetup.organizerId, organizerName,
    purpose: normalizePurpose(meetup.purpose), purposeIcon: meetup.purposeIcon ?? null, purposeColor: meetup.purposeColor ?? null,
    invitationTemplate: meetup.invitationTemplate ?? null, invitationColor: meetup.invitationColor ?? null,
    title: meetup.title, description: meetup.description, contactInfo: meetup.contactInfo ?? null,
    startsAt: meetup.startsAt, endsAt: meetup.endsAt, maxParticipants: meetup.maxParticipants,
    acceptedCount: seats(meetup), pendingCount: pendingRequestCount(meetup), myRequestStatus: myRequest?.status ?? null,
    status: meetup.status, isHidden: meetup.isHidden, cancelledAt: meetup.cancelledAt,
    completedAt: meetup.completedAt, createdAt: meetup.createdAt, updatedAt: meetup.updatedAt, cafe,
    organizer: serializeUser(meetup.organizer, admin),
    requests: visibleRequests.map(({ requester, message, ...request }: any) => ({
      ...request,
      requesterName: displayName(requester),
      requester: serializeUser(requester, admin),
      message: isOwner || request.requesterId === viewerId ? message : null,
    })),
    ...(includeParticipants ? {
      acceptedParticipants: requests
        .filter((request: any) => request.status === 'accepted' && request.requesterId !== meetup.organizerId)
        .map((request: any) => ({ displayName: displayName(request.requester) })),
    } : {}),
  };
};

const serializeUser = (user: any, admin: boolean) => user ? {
  id: user.id,
  displayName: displayName(user),
  ...(admin ? { email: user.email } : {}),
} : null;

export const serializeAdminMeetup = (meetup: any, detail = false) => ({
  ...serializeMeetup(meetup, detail, null, true),
  adminNote: meetup.adminNote,
  reportCount: meetup._count?.reports ?? meetup.reports?.length ?? 0,
  ...(detail ? {
    reports: (meetup.reports ?? []).map(({ reporter, ...report }: any) => ({
      ...report,
      reporter: serializeUser(reporter, true),
    })),
  } : {}),
});
