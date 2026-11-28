# Cafe Finder – Backend

NestJS REST API cho ứng dụng tìm kiếm cafe tại TP.HCM.

- **Framework**: NestJS 10 + TypeScript
- **Database**: Supabase PostgreSQL (PostGIS enabled) + Prisma ORM 5
- **Auth**: JWT (passport-jwt), bcrypt, forgot/reset password qua Resend email
- **Storage**: Supabase (ảnh)
- **Email**: Resend (`resend` package) — cấu hình qua `RESEND_API_KEY`
- **Port**: 3005 — global prefix `/api`, Swagger tại `/api/docs`
- **Deploy**: Render.com (xem Dockerfile)
- **Package manager**: Yarn (`yarn`, `yarn build`, `yarn test`)

---

## Local Development

```bash
yarn
yarn prisma:generate
yarn start:dev    # hot reload
yarn start:prod   # production
```

### Các lệnh Prisma hữu ích

```bash
yarn prisma:studio    # GUI database browser
yarn prisma:seed      # Seed data mẫu
npx prisma db push       # Sync schema → DB (không tạo migration)
```

---

## Environment Variables (`be/.env`)

| Key | Mô tả |
|-----|-------|
| `DATABASE_URL` | Supabase **Session Pooler** URL (IPv4 compatible) — lấy từ Supabase > Project Settings > Database > Connection Pooling > Session |
| `DIRECT_URL` | Supabase direct URL — dùng cho `prisma db push`/migrate. Local: cũng dùng Session Pooler; Render: dùng direct |
| `JWT_SECRET` | Secret key cho JWT |
| `JWT_EXPIRES_IN` | Thời hạn token (default `7d`) |
| `SUPABASE_URL` | Base URL Supabase, **không có** trailing path |
| `SUPABASE_SERVICE_KEY` | Service role key từ Supabase Settings → API |
| `SUPABASE_BUCKET` | Tên bucket (default `cafe-images`) |
| `IMAGE_MAX_OUTPUT_KB` | Trần dung lượng ảnh WebP sau convert (default `2048`) |
| `IMAGE_UPLOAD_MODE` | `cloudinary_original` để Cloudinary upload ảnh gốc, bỏ convert trong request |
| `IMAGE_WEBP_MAX_QUALITY` | Quality WebP bắt đầu thử (default `92`) |
| `IMAGE_WEBP_MIN_QUALITY` | Quality WebP thấp nhất được phép thử (default `84`) |
| `GOOGLE_PLACES_API_KEY` | Optional |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `GOOGLE_OAUTH_REDIRECT_URI` | Backend callback URL, ví dụ `http://localhost:3005/api/auth/oauth/google/callback` |
| `PORT` | Default `3005` |
| `FRONTEND_URL` | CORS origin (default `http://localhost:3000`) |
| `APP_URL` | Frontend URL — dùng để tạo link reset password trong email |
| `RESEND_API_KEY` | API key từ resend.com — dùng để gửi email |
| `RESEND_FROM_EMAIL` | Email gửi đi (cần verify domain trên Resend). Dev: `onboarding@resend.dev` |

### Lưu ý kết nối Supabase (IPv4)

Local development thường dùng IPv4 — **không thể** kết nối thẳng tới `db.xxx.supabase.co:5432` (IPv6 only).
Phải dùng **Session Pooler** URL: `postgresql://postgres.[ref]:[pass]@aws-0-[region].pooler.supabase.com:5432/postgres`

Trên Render.com (IPv6 native), có thể dùng direct URL cho `DIRECT_URL`.

---

## Module Architecture

```
src/
├── auth/           JWT auth, register/login, forgot/reset password, guards, strategies
├── email/          EmailService dùng Resend — gửi email reset password
├── cafes/          Browse, search, nearby (PostGIS), quiz-match
├── saved/          User saved cafes & collections
├── submissions/    User cafe submission flow
├── admin/          Dashboard APIs split by domain: cafes, submissions, users, stats
├── storage/        Supabase image upload/delete
├── prisma/         PrismaService (global module)
└── common/         Guards, decorators, filters, pipes
```

---

## API Reference

### Auth

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| POST | `/api/auth/register` | ❌ | Đăng ký (email, password, displayName) |
| POST | `/api/auth/login` | ❌ | Đăng nhập → trả JWT token |
| GET | `/api/auth/me` | JWT | Thông tin user hiện tại |
| PATCH | `/api/auth/profile` | JWT | Cập nhật displayName |
| PATCH | `/api/auth/password` | JWT | Đổi mật khẩu (cần mật khẩu cũ) |
| POST | `/api/auth/forgot-password` | ❌ | Gửi email link đặt lại mật khẩu |
| POST | `/api/auth/reset-password` | ❌ | Đặt lại mật khẩu bằng token từ email |

### Cafes (Public)

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| GET | `/api/cafes` | ❌ | Danh sách cafe (có filter + pagination) |
| GET | `/api/cafes/nearby` | ❌ | Cafe gần nhất (PostGIS) |
| GET | `/api/cafes/districts` | ❌ | Danh sách quận có cafe |
| GET | `/api/cafes/quiz-match` | ❌ | Top 10 theo vibe + purpose |
| GET | `/api/cafes/:slug` | ❌ | Bản xem trước công khai |
| POST | `/api/cafes/:slug/detail-access` | Khách hoặc JWT | Chi tiết gồm menu và album. Phản hồi `private, no-store` |

Lượt được tính theo quán duy nhất và tháng Việt Nam. Lần gọi POST đầu tiên trả
`428` kèm cookie `cafe-detail-guest`. Gửi lại cùng cookie để nhận chi tiết.
`401` yêu cầu đăng nhập. `403` báo hết hạn mức miễn phí của tài khoản.

Cấu hình backend staging với `CAFE_DETAIL_ACCESS_MODE=enforce`. Production dùng
`measure` để phục vụ toàn bộ danh sách và ghi nhận lượt, kể cả lượt vượt hạn mức.
Trước khi bật giới hạn trên production, xóa cache CDN cũ của API quán, trang chi tiết
và Markdown. Xác nhận một đơn payOS thật 10.000₫ chỉ cấp quyền 30 ngày một lần.

### Thanh toán PayOS

Backend đọc `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY` và
`PAYOS_RETURN_URL`. Đặt URL quay về là trang Cafe Maps tương ứng với môi trường.
Khai báo `https://<backend>/api/payments/payos/webhook` trong kênh thanh toán PayOS.

| Method | Path | Mô tả |
|--------|------|-------|
| POST | `/api/payments/cafe-detail` | JWT. Tạo hoặc dùng lại đơn 10.000₫ và trả QR. Mã hết hạn sau 15 phút. |
| GET | `/api/payments/cafe-detail/:orderCode` | JWT. Chủ đơn đọc trạng thái khi chờ thanh toán. |
| POST | `/api/payments/payos/webhook` | Chữ ký PayOS. Xác nhận đơn đúng số tiền và cấp quyền 30 ngày một lần. |

Webhook PayOS cập nhật trạng thái đơn. Khi popup mở và tab đang hiển thị,
trình duyệt polling khoảng 2 giây trong 30 giây đầu, 5 giây đến phút thứ hai
và 15 giây sau đó. Mỗi đơn có độ lệch tối đa 20% để tránh gọi đồng loạt.
Polling dừng khi đã thanh toán, đóng popup hoặc quá một phút sau khi QR hết hạn.
Mở lại popup hoặc quay về tab sẽ kiểm tra ngay. Chế độ local `NODE_ENV=development`, `PAYOS_MOCK_ENABLED=true` với
PostgreSQL loopback hiển thị QR mẫu và nút hoàn tất mô phỏng.

### Saved (Cần JWT)

| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/api/saved` | Danh sách cafe đã lưu |
| GET | `/api/saved/collections` | Tên các collection |
| POST | `/api/saved` | Lưu cafe (body: `{ cafeId, collectionName? }`) |
| DELETE | `/api/saved/:cafeId` | Xóa khỏi saved |

### Submissions (Cần JWT)

| Method | Path | Mô tả |
|--------|------|-------|
| POST | `/api/submissions` | Gửi đề xuất cafe mới |

### Admin (Cần JWT + role ADMIN)

| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/api/admin/cafes` | Tất cả cafe, hỗ trợ filter `district`, `is_published`, `is_featured`, `search`, `page`, `limit` |
| GET | `/api/admin/cafes/:id` | Chi tiết cafe |
| POST | `/api/admin/cafes` | Tạo cafe mới |
| PATCH | `/api/admin/cafes/:id` | Cập nhật cafe |
| PUT | `/api/admin/cafes/:id` | Cập nhật cafe (legacy alias) |
| DELETE | `/api/admin/cafes/:id` | Xóa cafe |
| PATCH | `/api/admin/cafes/:id/publish` | Toggle publish/unpublish |
| PATCH | `/api/admin/cafes/:id/feature` | Toggle featured/featuredOrder |
| POST | `/api/admin/cafes/:id/images` | Upload ảnh, tự cập nhật `images[]`/`coverImage` |
| PATCH | `/api/admin/cafes/:id/images/reorder` | Sắp xếp lại thứ tự ảnh theo `imageUrls[]` |
| DELETE | `/api/admin/cafes/:id/images` | Xóa ảnh khỏi cafe |
| GET | `/api/admin/submissions` | Danh sách submissions |
| GET | `/api/admin/submissions/:id` | Chi tiết submission |
| PATCH | `/api/admin/submissions/:id/approve` | Duyệt submission và tạo draft cafe |
| PATCH | `/api/admin/submissions/:id/reject` | Từ chối submission |
| GET | `/api/admin/users` | Danh sách user |
| GET | `/api/admin/stats` | Số liệu dashboard |

---

## Cafe Filter Params (`GET /api/cafes`)

| Param | Type | Mô tả |
|-------|------|-------|
| `district` | string | Lọc theo quận (exact match) |
| `search` | string | Tìm trong name, address, oneLiner |
| `priceRange` | enum | `under_50k` \| `price_50k_100k` \| `price_100k_150k` \| `above_150k` |
| `vibe` | string (comma-sep) | Match any (hasSome) |
| `purpose` | string (comma-sep) | Match any (hasSome) |
| `page` | number | 1-based, default 1 |
| `limit` | number | 1–50, default 12 |

---

## PostGIS Nearby Search

```
GET /api/cafes/nearby?lat=10.78&lng=106.69&radius=2&distanceMode=route
```

- `radius`: km, default 2km
- `distanceMode`: `straight` (default, PostGIS đường chim bay) hoặc `route` (OSRM driving)
- Trả về tối đa 20 cafe, sort theo `distance_km` tăng dần
- Dùng `ST_DWithin` (lọc radius) + `ST_Distance` (tính khoảng cách đường chim bay)
- Khi `distanceMode=route` và `OSRM_BASE_URL` được cấu hình, backend gọi OSRM `/table` để ghi đè `distance_km`, thêm `duration_min`, `distance_mode=route`, `straight_distance_km`
- Nếu OSRM lỗi/chưa cấu hình, fallback `distance_mode=straight`
- Kiểu dữ liệu: `geography` SRID 4326 (độ chính xác cao hơn `geometry`)
- Cột `location` được trigger tự cập nhật khi `lat`/`lng` thay đổi
- GIST spatial index trên `location`

---

## Database Schema

**Models**: `User`, `Cafe`, `SavedCafe`, `CafeSubmission`, `PasswordResetToken`

**Enums**:
- `Role`: `USER` | `ADMIN`
- `PriceRange`: `under_50k` | `price_50k_100k` | `price_100k_150k` | `above_150k`
- `SubmissionStatus`: `pending` | `approved` | `rejected`

**File**: [prisma/schema.prisma](prisma/schema.prisma)

---

## Known Issues & Gaps

| Issue | Mô tả |
|-------|-------|
| ⚠️ Full-text search | Migration đã tạo `tsvector` index nhưng service dùng Prisma `contains` (slower) thay vì raw `to_tsvector` query |
| ❌ Rate limiting | Chưa có `@nestjs/throttler` — auth endpoints có thể bị brute force |
| ❌ Caching | Không có cache layer — mỗi request đều query DB |
| ❌ User profile | Không có endpoint update `displayName`, avatar, password |
| ❌ Soft delete | Xóa cafe là hard delete, không thể khôi phục |

Xem danh sách đầy đủ: [plan.md](plan.md)

---

## Migration Notes

- Chỉ có 1 migration: `add_postgis`. Schema khởi tạo bằng `prisma db push`.
- **Không dùng** `prisma migrate dev` trên DB trống — xem hướng dẫn trong root [CLAUDE.md](../CLAUDE.md).
- PostgreSQL@17 bắt buộc (PostGIS 3.6.x không tương thích @16).
