// api/reply-context.js — resolve who a Triage item is from and pull the
// recent thread with them, so a reply can be drafted with real context.
//
// This route is a thin authenticated proxy. It does NOT read any
// STWRD+LIFE table directly: it calls the STWRD+LIFE `reply-context` edge
// function using the same PERSONAL_BRIEFING_URL / PERSONAL_BRIEFING_KEY
// pair that api/digest.js uses for `morning-briefing` (see fetchPersonalBriefing
// there). No new env vars, no cross-project table read.
//
// Auth model (mirrors api/brief.js):
//   1. Caller sends Supabase JWT in Authorization: Bearer header
//   2. Verify JWT via /auth/v1/user -> requesterId
//   3. requesterId must be in REPLY_CONTEXT_USER_IDS, else 403
//
// Request body: { query: "Mia" } — a name, handle, or address.
//
// `query` is this route's public name for the field; the edge function's own
// parameter is `name`, and the mapping happens at the fetch boundary below.
// There is no candidate id path: disambiguation is just a second call with a
// more specific name, since the resolver's candidates are display-name
// strings.
//
// The edge function answers in exactly three shapes. This route normalizes
// each into a tagged `status` so the client never has to shape-sniff:
//   hit        { contact, matched_count, newest_msg_ts, thread }
//                -> 200 { status:'hit', contact, matched_count, newest_msg_ts, thread }
//   ambiguous  { candidates: ["Mia Ramdon", "Mia Q (work)"] }
//                -> 200 { status:'ambiguous', candidates }
//   miss       { matched_count: 0 }
//                -> 200 { status:'miss', matched_count: 0 }
//
// Anything else coming back is treated as contract drift and surfaced as a
// 502, not silently flattened into a miss. A miss and a broken resolver look
// identical to the user otherwise, and that is exactly the silent failure
// mode we keep paying for elsewhere.
//
// Nothing here sends a message. Resolution only.

const SUPABASE_URL = 'https://fnnegalrrdzcgoelljmi.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZubmVnYWxycmR6Y2dvZWxsam1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5NDMwNjksImV4cCI6MjA5MTUxOTA2OX0.bhgk6czCQYTuUGnu5Zv7pml9uMuPrp4I1VBSzVIHwqw';

// Vijay only for now. Same gate shape as PERSONAL_BRIEFING_USER_IDS in
// api/digest.js — convert both to a profiles flag together when this opens
// up to Mia or other beta users.
const REPLY_CONTEXT_USER_IDS = new Set([
  '2e5683e0-c6ad-483f-b31d-c93f097c0aeb',
]);

const RESOLVER_TIMEOUT_MS = 8000;
const MAX_QUERY_LEN = 200;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const authHeader = req.headers.authorization || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '');
  if (!jwt) return res.status(401).json({ error: 'missing_auth' });

  let userId;
  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${jwt}` },
    });
    if (!userRes.ok) return res.status(401).json({ error: 'invalid_jwt' });
    const userData = await userRes.json();
    userId = userData?.id;
    if (!userId) return res.status(401).json({ error: 'invalid_jwt' });
  } catch (err) {
    console.error('[api/reply-context] auth verify failed', err);
    return res.status(401).json({ error: 'auth_failed' });
  }

  if (!REPLY_CONTEXT_USER_IDS.has(userId)) {
    return res.status(403).json({ error: 'not_enabled' });
  }

  const body = req.body || {};
  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (!query) return res.status(400).json({ error: 'missing_query' });
  if (query.length > MAX_QUERY_LEN) return res.status(400).json({ error: 'query_too_long' });

  const url = process.env.PERSONAL_BRIEFING_URL;
  const key = process.env.PERSONAL_BRIEFING_KEY;
  if (!url || !key) {
    console.error('[api/reply-context] PERSONAL_BRIEFING_URL/KEY not configured');
    return res.status(503).json({ error: 'not_configured' });
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), RESOLVER_TIMEOUT_MS);
  let data;
  try {
    const resolverRes = await fetch(`${url}/functions/v1/reply-context`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      // The edge function's parameter is `name`. Map at the boundary so the
      // client keeps talking in `query`.
      body: JSON.stringify({ name: query }),
      signal: ctrl.signal,
    });

    // Read the body even on 2xx. An edge function that catches per-request
    // errors into a 200 body is the failure mode that hid the Gmail
    // invalid_grant breakage for weeks.
    const text = await resolverRes.text();
    if (!resolverRes.ok) {
      console.error('[api/reply-context] resolver non-2xx', resolverRes.status, text.slice(0, 300));
      return res.status(502).json({ error: 'resolver_unavailable' });
    }
    try {
      data = text ? JSON.parse(text) : null;
    } catch (parseErr) {
      console.error('[api/reply-context] resolver returned non-JSON', text.slice(0, 300));
      return res.status(502).json({ error: 'resolver_bad_json' });
    }
  } catch (err) {
    const aborted = err?.name === 'AbortError';
    console.error('[api/reply-context] resolver fetch failed', aborted ? 'timeout' : (err?.message || err));
    return res.status(502).json({ error: aborted ? 'resolver_timeout' : 'resolver_unavailable' });
  } finally {
    clearTimeout(timer);
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    console.error('[api/reply-context] resolver returned unexpected top-level shape');
    return res.status(502).json({ error: 'resolver_bad_shape' });
  }

  if (data.error) {
    console.error('[api/reply-context] resolver reported error in body:', String(data.error).slice(0, 300));
    return res.status(502).json({ error: 'resolver_error' });
  }

  // Ambiguous first: a candidates list is the resolver saying "pick one",
  // and it can legitimately arrive alongside a zero matched_count. Candidates
  // are display-name strings that get sent straight back as the next `name`.
  if (Array.isArray(data.candidates) && data.candidates.length > 0) {
    return res.status(200).json({
      status: 'ambiguous',
      candidates: data.candidates.map(c => String(c)),
    });
  }

  const matchedCount = Number(data.matched_count);

  // Hit: a resolved contact with at least one matched message.
  if (data.contact && Number.isFinite(matchedCount) && matchedCount > 0) {
    return res.status(200).json({
      status: 'hit',
      contact: data.contact,
      matched_count: matchedCount,
      newest_msg_ts: data.newest_msg_ts ?? null,
      thread: data.thread ?? null,
    });
  }

  // Miss: explicitly zero matches. An empty candidates array lands here too.
  if (matchedCount === 0) {
    return res.status(200).json({ status: 'miss', matched_count: 0 });
  }

  // Neither of the three documented shapes. Surface it rather than pretending
  // it was a miss.
  console.error(
    '[api/reply-context] resolver shape did not match hit/ambiguous/miss; keys:',
    Object.keys(data).join(',')
  );
  return res.status(502).json({ error: 'resolver_bad_shape' });
}
