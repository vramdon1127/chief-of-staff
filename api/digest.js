// STWRD Daily Digest — runs every morning at 6am CT via cron-job.org
// Pulls tasks from Supabase, generates AI summary, sends via Resend

const SUPABASE_URL = 'https://fnnegalrrdzcgoelljmi.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZubmVnYWxycmR6Y2dvZWxsam1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5NDMwNjksImV4cCI6MjA5MTUxOTA2OX0.bhgk6czCQYTuUGnu5Zv7pml9uMuPrp4I1VBSzVIHwqw';

// Use service role key to bypass RLS for server-side digest
function getServiceKey() {
  return process.env.SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY;
}

async function sbFetch(path, useServiceRole = false) {
  const key = useServiceRole ? getServiceKey() : SUPABASE_ANON_KEY;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    }
  });
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Friendly first-name salutation from a profile row.
// Falls back to email local-part, then "friend", so the digest never crashes
// on a partial profile.
function firstNameFrom(profile) {
  const raw = profile?.full_name || profile?.digest_email || '';
  const first = String(raw).trim().split(/\s+/)[0] || '';
  // Strip the @domain tail if we fell back to the email.
  return first.split('@')[0] || 'friend';
}

// Resolve a project name → hex color for the email template.
// CSS variables don't render in email clients, so we force hex: prefer the
// user's stored per-project color (written during onboarding), fall back to
// the built-in defaults for legacy project names, then to accent-purple.
const LEGACY_PROJECT_HEX = {
  GNE: '#f472b6',
  Caliber: '#60a5fa',
  Personal: '#34d399',
  ServeAnts: '#fb923c',
  Family: '#22d3ee',
};
function projectHexFor(name, colorByName) {
  if (!name) return '#7c6fef';
  const stored = colorByName ? colorByName[name] : null;
  if (stored && stored.startsWith('#')) return stored;
  return LEGACY_PROJECT_HEX[name] || '#7c6fef';
}

export default async function handler(req, res) {
  // Allow manual trigger via POST (for testing), cron hits GET
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify cron secret to prevent unauthorized triggers
  const authHeader = req.headers['authorization'];
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // ── Pull all user profiles for digest sending ──────────────
    // For now send to all users who have digest_email set
    const profiles = await sbFetch('profiles?digest_email=not.is.null&select=id,full_name,digest_email,anthropic_key', true);
    
    if (!profiles || profiles.length === 0) {
      return res.status(200).json({ message: 'No users with digest email configured' });
    }

    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) {
      return res.status(500).json({ error: 'RESEND_API_KEY not configured in environment' });
    }

    let sent = 0;
    let errors = [];

    // Send digest to each user
    for (const profile of profiles) {
      try {
        await sendDigestToUser(profile, resendKey);
        sent++;
      } catch(e) {
        errors.push({ user: profile.id, error: e.message });
      }
    }

    return res.status(200).json({ success: true, sent, errors });

  } catch (e) {
    console.error('Digest error:', e);
    return res.status(500).json({ error: e.message });
  }
}

// Helper: send digest to a single user
async function sendDigestToUser(profile, resendKey) {
    const toEmail = profile.digest_email;
    const anthropicKey = profile.anthropic_key;
    const settingsMap = { digest_email: toEmail, anthropic_key: anthropicKey };

    if (!toEmail || !anthropicKey || !resendKey) {
      return res.status(400).json({ 
        error: 'Missing config', 
        missing: { toEmail: !toEmail, anthropicKey: !anthropicKey, resendKey: !resendKey }
      });
    }

    // ── Identity ────────────────────────────────────────────────
    const firstName = firstNameFrom(profile);

    // ── Pull active tasks ───────────────────────────────────────
    const userId = profile.id;
    const tasks = await sbFetch(`tasks?user_id=eq.${userId}&status=neq.done&order=created_at.desc&limit=100`, true) || [];

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
    const todayDisplay = new Date().toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/Chicago'
    });

    const dueTodayTasks = tasks.filter(t => t.due_date === today);
    const overdueTasks = tasks.filter(t => t.due_date && t.due_date < today);
    const p1Tasks = tasks.filter(t => t.priority === 'P1');
    const aiCompleteTasks = tasks.filter(t => t.category === 'AI Complete');

    // Per-user project color map, used for the project dots next to Due Today
    // items. Matches what the in-app drilldowns render.
    const userProjectRows = await sbFetch(
      `projects?user_id=eq.${userId}&order=sort_order.asc`,
      true
    ) || [];
    const projectColorByName = {};
    userProjectRows.forEach(p => { if (p?.name) projectColorByName[p.name] = p.color || null; });

    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekAgoStr = weekAgo.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });

    let completedThisWeek = [];
    try {
      completedThisWeek = await sbFetch(`tasks?user_id=eq.${userId}&status=eq.done&created_at=gte.${weekAgoStr}T00:00:00Z&limit=200`, true) || [];
    } catch(e) {}

    const totalThisWeek = tasks.length + completedThisWeek.length;
    const completionRate = totalThisWeek > 0
      ? Math.round((completedThisWeek.length / totalThisWeek) * 100)
      : 0;

    // ── Ask Claude for one sharp insight ───────────────────────
    const taskSummary = tasks.slice(0, 30).map(t =>
      `[${t.project}][${t.category}][${t.priority}]${t.due_date ? '[due:'+t.due_date+']' : ''} ${t.cleaned_task || t.content}`
    ).join('\n');

    const aiPrompt = `You are STWRD, ${firstName}'s personal AI life manager. Generate a sharp, specific morning briefing.

TODAY: ${todayDisplay}
COMPLETION RATE: ${completionRate}%
DUE TODAY: ${dueTodayTasks.length} tasks
OVERDUE: ${overdueTasks.length} tasks
URGENT (P1): ${p1Tasks.length} tasks
AI CAN HANDLE: ${aiCompleteTasks.length} tasks

ACTIVE TASKS:
${taskSummary || 'No active tasks'}

Give exactly ONE sharp, actionable focus recommendation for today. Be specific — name actual tasks. Be direct, warm, brief. Max 2 sentences.

FOCUS: [your recommendation here]`;

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', // fast + cheap for daily digest
        max_tokens: 150,
        messages: [{ role: 'user', content: aiPrompt }]
      })
    });

    const aiData = await aiRes.json();
    const aiText = aiData.content?.[0]?.text || '';
    const focusMatch = aiText.match(/FOCUS: (.+)/s);
    const focusRaw = focusMatch ? focusMatch[1].trim() : aiText.trim();
    const focusLine = focusRaw.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^FOCUS:\s*/i, '').trim();

    // ── Build HTML email ────────────────────────────────────────
    const dueTodayHtml = dueTodayTasks.length > 0
      ? dueTodayTasks.slice(0, 5).map(t => {
          const projColor = projectHexFor(t.project, projectColorByName);
          return `<tr>
            <td style="padding:5px 0;">
              <span style="display:inline-block;width:8px;height:8px;background:${projColor};border-radius:50%;margin-right:8px;"></span>
              <span style="font-size:13px;color:#f0f0ff;">${t.cleaned_task || t.content}</span>
              <span style="font-size:11px;color:#8888aa;margin-left:6px;">${t.project}</span>
            </td>
          </tr>`;
        }).join('') + (dueTodayTasks.length > 5 ? `<tr><td style="font-size:12px;color:#8888aa;padding:4px 0;">+${dueTodayTasks.length - 5} more</td></tr>` : '')
      : '<tr><td style="font-size:13px;color:#8888aa;padding:8px 0;">Nothing due today 🎉</td></tr>';

    const overdueHtml = overdueTasks.length > 0
      ? `<div style="background:#1a0f0f;border:1px solid #ef444440;border-radius:10px;padding:14px;margin-bottom:16px;">
          <div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#ef4444;margin-bottom:8px;">⚠️ Overdue (${overdueTasks.length})</div>
          ${overdueTasks.slice(0, 3).map(t => `<div style="font-size:13px;color:#f0f0ff;padding:3px 0;">${t.cleaned_task || t.content} <span style="color:#8888aa;">(${t.due_date})</span></div>`).join('')}
          ${overdueTasks.length > 3 ? `<div style="font-size:12px;color:#8888aa;margin-top:4px;">+${overdueTasks.length - 3} more overdue</div>` : ''}
        </div>` 
      : '';

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px;">

    <!-- HEADER -->
    <div style="margin-bottom:24px;">
      <div style="font-size:22px;font-weight:800;color:#7c6fef;letter-spacing:-0.5px;">STWRD</div>
      <div style="font-size:13px;color:#8888aa;margin-top:2px;">${todayDisplay}</div>
    </div>

    <!-- AI FOCUS -->
    <div style="background:#12121a;border:1px solid #7c6fef40;border-radius:14px;padding:18px;margin-bottom:16px;position:relative;overflow:hidden;">
      <div style="position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,#7c6fef,#f472b6,#10b981);"></div>
      <div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#7c6fef;margin-bottom:8px;">🧠 Today's Focus</div>
      <div style="font-size:14px;color:#f0f0ff;line-height:1.6;">${focusLine}</div>
    </div>

    ${overdueHtml}

    <!-- DUE TODAY -->
    <div style="background:#12121a;border:1px solid #2a2a3d;border-radius:14px;padding:18px;margin-bottom:16px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#8888aa;margin-bottom:10px;">Due Today (${dueTodayTasks.length})</div>
      <table style="width:100%;border-collapse:collapse;">${dueTodayHtml}</table>
    </div>

    <!-- QUICK STATS -->
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px;">
      <div style="background:#12121a;border:1px solid #2a2a3d;border-radius:10px;padding:12px;text-align:center;">
        <div style="font-size:22px;font-weight:800;color:#7c6fef;">${tasks.length}</div>
        <div style="font-size:10px;color:#8888aa;margin-top:2px;">Active</div>
      </div>
      <div style="background:#12121a;border:1px solid #2a2a3d;border-radius:10px;padding:12px;text-align:center;">
        <div style="font-size:22px;font-weight:800;color:#ef4444;">${p1Tasks.length}</div>
        <div style="font-size:10px;color:#8888aa;margin-top:2px;">Urgent</div>
      </div>
      <div style="background:#12121a;border:1px solid #2a2a3d;border-radius:10px;padding:12px;text-align:center;">
        <div style="font-size:22px;font-weight:800;color:#10b981;">${completionRate}%</div>
        <div style="font-size:10px;color:#8888aa;margin-top:2px;">Done Rate</div>
      </div>
    </div>

    <!-- CTA -->
    <div style="text-align:center;margin-bottom:24px;">
      <a href="https://getstwrd.com" style="display:inline-block;background:linear-gradient(135deg,#7c6fef,#8b5cf6);color:white;text-decoration:none;padding:14px 32px;border-radius:12px;font-size:14px;font-weight:700;letter-spacing:0.5px;">Open STWRD →</a>
    </div>

    <!-- FOOTER -->
    <div style="text-align:center;font-size:11px;color:#8888aa;">
      STWRD · Your Household OS · <a href="https://getstwrd.com" style="color:#7c6fef;text-decoration:none;">Open app</a>
    </div>

  </div>
</body>
</html>`;

    // ── Send via Resend ─────────────────────────────────────────
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resendKey}`
      },
      body: JSON.stringify({
        from: 'STWRD <onboarding@resend.dev>',
        to: [toEmail],
        subject: `STWRD · ${todayDisplay}`,
        html
      })
    });

    const emailData = await emailRes.json();

    if (!emailRes.ok) {
      console.error('Resend error:', emailData);
      return res.status(500).json({ error: 'Email send failed', details: emailData });
    }

    // digest sent successfully for this user
}
