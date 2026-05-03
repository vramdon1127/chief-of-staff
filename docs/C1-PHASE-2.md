# C1 Phase 2 — Server-side gcal token refresh

**Status:** Design — not yet implemented
**Depends on:** C1 Phase 1 (commit `5a52dd1`, shipped 5/2/26)
**Blocks:** Partner-view calendar reads (B-series briefing items)

---

## Goal

Enable any authenticated STWRD user to obtain a fresh Google Calendar access token for themselves OR for a confirmed partner, using the refresh tokens persisted in `profiles.gcal_refresh_token` during Phase 1.

## Why a serverless function is mandatory

Three console experiments on 5/2/26 ruled out every pure-client path:

1. **Direct browser refresh:** `POST oauth2.googleapis.com/token` with `refresh_token` + `client_id` returns HTTP 400 `client_secret is missing`. The Supabase-managed OAuth client is configured as a *confidential* client.
2. **Supabase proxy:** `sbClient.auth.refreshSession()` returns a session with `provider_token: null` and 6 keys instead of 8. Supabase does not refresh provider tokens on our behalf.
3. **Conclusion:** The `client_secret` cannot live in the browser. We need a backend that holds it.

## Endpoint contract

### `POST /api/refresh-gcal-token`

**Headers:**
- `Authorization: Bearer <supabase_jwt>` (required)
- `Content-Type: application/json`

**Body:**

    { "userId": "<uuid>" }

**Response 200:**

    { "access_token": "ya29...", "expires_in": 3599 }

**Response 401:**
- Missing/invalid JWT
- `userId` is not self and `is_partner_or_self()` returns false
- Google returned `invalid_grant` (refresh token revoked) — client should clear local state and prompt re-auth

**Response 404:**
- No `gcal_refresh_token` row for `userId`

**Response 500:**
- Google token endpoint unreachable, env var missing, etc. Generic error; do not leak details to client.

## Server logic outline

1. Verify JWT via `supabaseAuth.auth.getUser()`, extract requesterId
2. Read `userId` from body
3. If `userId !== requesterId`, call `is_partner_or_self(userId)` RPC; reject if false
4. Use service role client to read `profiles.gcal_refresh_token` for userId
5. POST to `oauth2.googleapis.com/token` with `client_id` + `client_secret` (env var) + `refresh_token` + `grant_type=refresh_token`
6. On `invalid_grant`, NULL out the stored refresh token and return 401
7. On success, return `{access_token, expires_in}`

## Client wrapper outline

`getCalendarTokenForUser(userId)`:
- If self → existing localStorage path via `ensureCalendarToken()`
- Else → check in-memory cache, else POST to `/api/refresh-gcal-token`
- Cache by userId, expires at `(expires_in - 120) * 1000` ms from now

Update `fetchCalendarEvents()` to take `userId` param. Briefing render path passes `viewingPartner ? partnerId : currentUser.id`.

## Environment variables (Vercel, all Production scope)

| Name | Source |
|------|--------|
| `GOOGLE_OAUTH_CLIENT_SECRET` | Google Cloud project 933764042380, STWRD v2 OAuth client |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard → Settings → API |
| `GOOGLE_OAUTH_CLIENT_ID` | `933764042380-43o4bosc2unqd6dstrvgulcuqsc6mhc3.apps.googleusercontent.com` |
| `SUPABASE_URL` | `https://fnnegalrrdzcgoelljmi.supabase.co` |
| `SUPABASE_ANON_KEY` | Supabase Dashboard |

## Pre-flight gates for tomorrow's implementation

1. `/api/refresh-gcal-token.js` exists, exports default function, handles only POST
2. Returns 401 without JWT
3. Returns 401 with valid JWT but stranger userId
4. Returns 200 with valid JWT for self
5. Returns 200 with Vijay's JWT for Mia's userId (after Mia signs in fresh)
6. `git log origin/main..HEAD` is empty after push

## Test plan

1. **Self-refresh smoke:** Vijay signs in, calls endpoint with own userId. Expect 200, valid `ya29.` token. Use against `googleapis.com/calendar/v3/users/me/calendarList` — expect 200.
2. **Partner refresh:** Mia signs in fresh. Vijay calls endpoint with Mia's userId. Expect 200. Use token to read Mia's calendar — expect 200.
3. **Unauthorized partner:** Third test account, no partnership. Vijay calls with their userId. Expect 401 `not_partner`.
4. **Revoked token:** Mia revokes STWRD access in Google. Vijay calls with Mia's userId. Expect 401 `invalid_grant`. Verify `gcal_refresh_token` is NULL.
5. **Cache:** Two consecutive partner calls within 50 min — only first hits network.

## Out of scope for Phase 2

- Encrypting refresh tokens at rest (KMS / pgsodium) — Phase 3
- Rate limiting `/api/refresh-gcal-token` — Phase 3
- Audit logging of partner-on-partner calendar reads — Phase 3
- Migrating self-path to also use serverless function — Phase 3

## Risk register

| Risk | Mitigation |
|------|------------|
| Service role key leaks via deploy logs | Vercel encrypts env vars; never log it; never commit `.env` |
| Partner revokes Google access mid-session | `invalid_grant` handler clears DB row; client treats 401 as "partner not connected" |
| Cache serves stale token across logout | Cache is in-memory per page load; logout reloads page |
| `is_partner_or_self` returns true for inactive partnership | Helper already filters `status='active'`; verify before relying |

## Reference constants

- Vijay UUID: `2e5683e0-c6ad-483f-b31d-c93f097c0aeb`
- Mia UUID: `b2a5f996-2c13-4430-85e1-26fad69dea31`
- Google OAuth client_id: `933764042380-43o4bosc2unqd6dstrvgulcuqsc6mhc3.apps.googleusercontent.com`
- Supabase project ref: `fnnegalrrdzcgoelljmi`
- Repo: `/Users/vijayramdon/Documents/GitHub/STWRD`
