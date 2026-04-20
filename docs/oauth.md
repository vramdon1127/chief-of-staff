# OAuth Troubleshooting

STWRD uses Google OAuth via Supabase for sign-in. This runbook covers recovery from the most common failure modes.

## Symptom: `Error 403: access_denied` on Google sign-in

Users see Google's "Access blocked" screen after choosing their account. The app never receives a session.

Work through these checks **in order** — stop at the first one that resolves it.

### 1. Is the user on the Test users list?

While the OAuth consent screen is in Testing mode, Google rejects any account that is not explicitly allowlisted.

- Google Cloud Console → **My First Project** → APIs & Services → OAuth consent screen → **Test users**
- Confirm the signing-in email is listed. If not, **Add users** → enter the email → **Save**.
- No redeploy needed. User can retry immediately.

This was the cause of the multi-week sign-in outage resolved on 2026-04-20. Previous diagnosis had assumed a project-level verification block; the real fix was a 60-second allowlist edit.

### 2. Is the consent screen configured correctly?

- Publishing status should be **Testing** (until beta outgrows the 100-user cap — see below).
- Scope list should include **only** `openid`, `email`, `profile`. Any "sensitive" or "restricted" scope (e.g. Calendar, Gmail) triggers Google's verification requirements and can surface as an access-denied error even for allowlisted testers.

### 3. Does the Supabase Google provider match?

Only check this if steps 1 and 2 pass.

- Supabase → Authentication → Providers → Google
- Confirm the **Client ID** matches the one in Google Cloud Console → Credentials → OAuth 2.0 Client IDs.
- Confirm the authorized redirect URI in Google Cloud includes the Supabase callback: `https://fnnegalrrdzcgoelljmi.supabase.co/auth/v1/callback`.

## Testing mode and the 100-user cap

STWRD's OAuth consent screen is currently in **Testing** mode. This caps sign-ins at 100 allowlisted test users and requires each user's email to be added manually.

This is fine for friends-and-family beta (~5–10 couples). When the beta scales beyond that, submit the app for Google verification so arbitrary users can sign in without being allowlisted.

- Verification docs: https://support.google.com/cloud/answer/13463073

## Stale Calendar scope

The OAuth consent screen still lists a Calendar scope left over from a Season 2 planning effort. It is not used by any current code path.

Sensitive scope presence adds consent friction — users see a broader permissions prompt than STWRD actually needs, and it pushes the app closer to Google's verification thresholds even when unused.

**Action:** remove the Calendar scope from the consent screen at the next convenient opportunity.

When Calendar is actually built for Season 2, re-add the scope **and** submit the app for Google verification at that point (Calendar is a sensitive scope and verification will be required once beyond Testing mode anyway).
