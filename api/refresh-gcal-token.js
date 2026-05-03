// Phase 2 stub — server-side gcal token refresh
// Real implementation per docs/C1-PHASE-2.md
// Status: stub only. Returns 200 on POST to prove Vercel routing.
// Do not call from client until real implementation lands.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  return res.status(200).json({
    stub: true,
    message: 'Phase 2 endpoint stub. Real implementation pending.',
    received_method: req.method
  });
}
