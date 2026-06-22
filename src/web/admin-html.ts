// Operator admin panel: one compact, dark, Linear-inspired page. The login screen
// and the app shell are separate documents; the app shell talks to /admin/api/* and
// renders per-meter balance charts with Chart.js from a CDN. Styling is self-contained.

const HEAD = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<link rel="stylesheet" href="https://rsms.me/inter/inter.css">
<style>
  :root {
    color-scheme: dark;
    --bg: #08090a;
    --surface: #161618;
    --surface-2: #1d1d20;
    --border: rgba(255,255,255,.09);
    --border-soft: rgba(255,255,255,.06);
    --text: #f7f8f8;
    --text-2: #d3d4d8;
    --muted: #8a8f98;
    --faint: #5c606a;
    --accent: #f59e0b;
    --accent-hi: #fbbf24;
    --accent-ink: #1a1205;
    --ok: #5bc983;
    --low: #f5c451;
    --crit: #f87171;
    --danger: #f06a6a;
    --r-lg: 10px;
    --r: 7px;
    --r-sm: 5px;
  }
  * { box-sizing: border-box; }
  html { scrollbar-color: rgba(255,255,255,.16) transparent; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text-2);
    font-family: 'InterVariable', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    letter-spacing: -.006em;
    font-feature-settings: 'cv01','cv03','cv04','cv09','ss03','calt','liga';
    -webkit-font-smoothing: antialiased;
  }
  ::selection { background: rgba(245,158,11,.26); }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }

  header {
    position: sticky; top: 0; z-index: 10;
    display: flex; justify-content: space-between; align-items: center;
    height: 52px; padding: 0 16px;
    border-bottom: 1px solid var(--border-soft);
    background: rgba(8,9,10,.72);
    backdrop-filter: saturate(140%) blur(10px);
  }
  h1 {
    margin: 0; font-size: 14px; font-weight: 600; color: var(--text);
    display: flex; align-items: center; gap: 7px; letter-spacing: -.01em;
  }
  h1 .mark { color: var(--accent); }
  h1 .sub {
    color: var(--muted); font-weight: 500; font-size: 11px;
    border: 1px solid var(--border); border-radius: var(--r-sm); padding: 1px 6px;
  }

  main { max-width: 1080px; margin: 0 auto; padding: 20px 16px 64px; }
  .auth { max-width: 320px; margin: 14vh auto 0; }
  .authglow {
    position: fixed; inset: 0; pointer-events: none;
    background: radial-gradient(60% 42% at 50% 0%, rgba(245,158,11,.10), transparent 72%);
  }

  .card {
    background: var(--surface);
    border: 1px solid var(--border-soft);
    border-radius: var(--r-lg);
    padding: 14px;
    margin-top: 14px;
  }

  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 1px;
    background: var(--border-soft);
    border: 1px solid var(--border-soft);
    border-radius: var(--r-lg);
    overflow: hidden;
  }
  .stat { background: var(--surface); padding: 13px 16px; }
  .stat .n {
    font-size: 22px; font-weight: 600; color: var(--text);
    letter-spacing: -.02em; font-feature-settings: 'tnum' 1;
  }
  .stat .k {
    color: var(--muted); font-size: 12px; margin-top: 3px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }

  input, select, button { font: inherit; }
  input[type=text], input[type=password], select {
    background: rgba(255,255,255,.03);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--r);
    padding: 7px 10px;
    font-size: 14px;
    line-height: 1.25;
    outline: none;
  }
  input::placeholder { color: var(--faint); }
  input[type=text]:focus, input[type=password]:focus, select:focus {
    border-color: rgba(245,158,11,.55);
    box-shadow: 0 0 0 3px rgba(245,158,11,.14);
  }
  select {
    appearance: none; -webkit-appearance: none; padding-right: 30px;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='9' height='6' viewBox='0 0 9 6' fill='none'%3E%3Cpath d='M1 1l3.5 3.5L8 1' stroke='%238a8f98' stroke-width='1.3' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat; background-position: right 10px center; background-size: 9px;
  }
  #q {
    padding-left: 32px;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 14 14' fill='none'%3E%3Ccircle cx='6' cy='6' r='4.5' stroke='%238a8f98' stroke-width='1.3'/%3E%3Cpath d='M10 10l3 3' stroke='%238a8f98' stroke-width='1.3' stroke-linecap='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat; background-position: left 10px center; background-size: 14px;
  }

  button {
    font-size: 13px; font-weight: 500;
    background: rgba(255,255,255,.05);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--r);
    padding: 7px 11px; line-height: 1.2; cursor: pointer;
  }
  button:hover { background: rgba(255,255,255,.08); }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  button:disabled { opacity: .4; cursor: default; }
  button.sm { padding: 5px 9px; font-size: 12px; }
  button.primary {
    background: var(--accent); color: var(--accent-ink);
    border-color: var(--accent); font-weight: 600;
  }
  button.primary:hover { background: var(--accent-hi); }
  button.ghost { background: transparent; border-color: transparent; color: var(--muted); }
  button.ghost:hover { background: rgba(255,255,255,.05); color: var(--text); }
  button.danger {
    background: rgba(240,106,106,.08); border-color: rgba(240,106,106,.28); color: #f98c8c;
  }
  button.danger:hover { background: rgba(240,106,106,.14); }

  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  thead th {
    text-align: left; padding: 8px 10px; white-space: nowrap;
    color: var(--muted); font-weight: 500; font-size: 12px;
    border-bottom: 1px solid var(--border-soft);
  }
  tbody td {
    padding: 9px 10px; white-space: nowrap;
    color: var(--text-2); border-top: 1px solid var(--border-soft);
  }
  tbody tr:first-child td { border-top: 0; }
  tbody tr { cursor: pointer; }
  tbody tr:hover { background: rgba(255,255,255,.025); }

  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .spacer { flex: 1; }
  .muted { color: var(--muted); }
  .pill {
    font-size: 11px; font-weight: 500; padding: 2px 7px; line-height: 1.45;
    border-radius: var(--r-sm); border: 1px solid var(--border);
    background: rgba(255,255,255,.04); color: var(--text-2);
  }
  .pill.accent {
    color: var(--accent-hi); border-color: rgba(245,158,11,.3); background: rgba(245,158,11,.1);
  }
  .ok { color: var(--ok); } .low { color: var(--low); } .critical { color: var(--crit); }
  .balance { font-weight: 600; font-feature-settings: 'tnum' 1; }
  .empty { color: var(--muted); text-align: center; padding: 28px 0; font-size: 13px; }
  .err { color: #f98c8c; min-height: 18px; font-size: 13px; }
  canvas { margin-top: 8px; }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 10px; }
  label { font-size: 13px; color: var(--muted); }

  @media (max-width: 640px) {
    header { padding: 0 14px; }
    main { padding: 16px 14px 56px; }
    .stat .n { font-size: 20px; }
    input[type=text], input[type=password], select { font-size: 16px; }
  }
</style>`;

function page(title: string, body: string): string {
  return `<!DOCTYPE html><html lang="en"><head>${HEAD}<title>${title}</title></head><body>${body}</body></html>`;
}

export function adminLoginHtml(hasError: boolean, message = 'Wrong password.'): string {
  const err = hasError ? message : '';
  return page(
    'Power Roast - Admin',
    `<div class="authglow"></div>
<main class="auth">
  <h1 style="justify-content:center;margin-bottom:16px"><span class="mark">⚡</span> Power Roast <span class="sub">admin</span></h1>
  <form class="card" method="POST" action="/admin/login">
    <p class="muted" style="margin:0 0 12px;font-size:13px">Operator sign-in.</p>
    <input type="password" name="password" aria-label="Admin password" placeholder="Admin password" autofocus required
           style="width:100%;margin-bottom:10px">
    <button class="primary" type="submit" style="width:100%">Sign in</button>
    <p class="err" style="margin:10px 0 0">${err}</p>
  </form>
</main>`
  );
}

export function adminAppHtml(csrf: string): string {
  return page(
    'Power Roast - Admin',
    `<header>
  <h1><span class="mark">⚡</span> Power Roast <span class="sub">admin</span></h1>
  <form method="POST" action="/admin/logout" style="margin:0"><button class="ghost" type="submit">Sign out</button></form>
</header>
<main>
  <div id="stats" class="stats"></div>

  <div class="card">
    <div class="row">
      <input id="q" type="text" name="q" aria-label="Search customers" placeholder="Search by email or Telegram chat id" style="flex:1;min-width:200px">
      <button id="searchBtn" type="button">Search</button>
    </div>
    <div id="list"><div class="empty">Loading…</div></div>
    <div class="row" style="margin-top:12px">
      <button id="prev" class="ghost sm" type="button">‹ Prev</button>
      <span id="pageLabel" class="muted" style="font-size:12px"></span>
      <button id="next" class="ghost sm" type="button">Next ›</button>
    </div>
  </div>

  <div id="detail"></div>

  <div class="card">
    <div class="row">
      <div style="font-weight:600;color:var(--text);font-size:13px">Recent admin actions</div>
      <div class="spacer"></div>
      <button id="auditRefresh" class="ghost sm" type="button">Refresh</button>
    </div>
    <div id="audit"><div class="empty">Loading…</div></div>
  </div>
</main>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
<script>
const CSRF = ${JSON.stringify(csrf)};
const fmt = n => '\\u09F3' + Number(n).toFixed(2);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const when = s => s ? new Date(s).toLocaleString() : '—';
let page = 0, query = '';

async function api(path, opts) {
  const res = await fetch('/admin/api' + path, opts);
  if (res.status === 401) { location.href = '/admin'; throw new Error('signed out'); }
  return res;
}
async function getJSON(path) { const r = await api(path); if (!r.ok) throw new Error(await r.text()); return r.json(); }
async function action(id, verb, body) {
  const r = await api('/users/' + id + '/' + verb, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
  return data;
}

async function loadStats() {
  const s = await getJSON('/overview');
  const cells = [
    [s.users, 'users'], [s.activeMeters, 'active meters'], [s.readings, 'readings'],
    [s.alerts24h, 'alerts (24h)'], [s.activeSubscriptions, 'paid subs'], [fmt(s.totalPaidBdt), 'collected'],
  ];
  document.getElementById('stats').innerHTML =
    cells.map(([n, k]) => '<div class="stat"><div class="n">' + esc(n) + '</div><div class="k">' + k + '</div></div>').join('');
}

async function loadAudit() {
  const data = await getJSON('/audit');
  const box = document.getElementById('audit');
  if (!data.entries.length) { box.innerHTML = '<div class="empty">No actions logged yet.</div>'; return; }
  box.innerHTML = '<div class="table-wrap"><table><thead><tr><th>When</th><th>Action</th><th>Customer</th><th>Detail</th><th>IP</th></tr></thead><tbody>' +
    data.entries.map(e =>
      '<tr><td class="muted">' + when(e.createdAt) + '</td><td>' + esc(e.action) + '</td><td>' +
      (e.targetUserId == null ? '—' : '#' + esc(e.targetUserId)) + '</td><td class="muted">' + esc(e.detail ?? '—') +
      '</td><td class="muted">' + esc(e.ip ?? '—') + '</td></tr>'
    ).join('') + '</tbody></table></div>';
}

function balanceClass(m) {
  if (m.balance === null) return 'muted';
  return m.balance < m.criticalThreshold ? 'critical' : m.balance < m.lowThreshold ? 'low' : 'ok';
}

async function loadList() {
  const data = await getJSON('/users?page=' + page + '&q=' + encodeURIComponent(query));
  const box = document.getElementById('list');
  if (!data.users.length) { box.innerHTML = '<div class="empty">No customers found.</div>'; }
  else {
    box.innerHTML = '<div class="table-wrap"><table><thead><tr><th>ID</th><th>Chat id</th><th>Email</th><th>Plan</th><th>Meters</th><th>Last reading</th></tr></thead><tbody>' +
      data.users.map(u =>
        '<tr data-id="' + u.id + '"><td>' + u.id + '</td><td>' + esc(u.telegramChatId ?? '—') + '</td><td>' + esc(u.email ?? '—') +
        '</td><td><span class="pill' + (u.plan === 'free' ? '' : ' accent') + '">' + esc(u.plan) + '</span></td><td>' + u.activeMeters + '</td><td class="muted">' + when(u.lastReadingAt) + '</td></tr>'
      ).join('') + '</tbody></table></div>';
    box.querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => openDetail(tr.dataset.id));
  }
  document.getElementById('pageLabel').textContent = 'page ' + (page + 1);
  document.getElementById('prev').disabled = page === 0;
  document.getElementById('next').disabled = !data.hasMore;
}

async function openDetail(id) {
  const d = await getJSON('/users/' + id);
  const det = document.getElementById('detail');
  const u = d.user;
  const sub = d.subscription
    ? esc(d.subscription.plan) + ' · ' + esc(d.subscription.status) + ' · via ' + esc(d.subscription.provider) +
      (d.subscription.currentPeriodEnd ? ' · until ' + when(d.subscription.currentPeriodEnd) : '')
    : 'none (free)';

  det.innerHTML =
    '<div class="card"><div class="row"><h2 style="margin:0;font-size:15px;font-weight:600;color:var(--text)">Customer #' + u.id + '</h2>' +
      '<span class="pill' + (u.plan === 'free' ? '' : ' accent') + '">' + esc(u.plan) + '</span><div class="spacer"></div>' +
      '<button class="ghost" type="button" id="closeDetail">Close</button></div>' +
      '<p class="muted" style="margin:10px 0 0;font-size:13px">Chat id ' + esc(u.telegramChatId ?? '—') + ' · ' + esc(u.email ?? 'no email') +
      ' · joined ' + when(u.createdAt) + ' · tone ' + esc(u.tonePref) + '</p>' +
      '<p class="muted" style="margin:4px 0 0;font-size:13px">Subscription: ' + sub + ' · meter cap ' + esc(d.limits.maxMeters) + ' · SMS ' + esc(d.limits.smsPerMonth) + '/mo</p>' +
      '<div class="actions">' +
        '<select id="grantPlan" aria-label="Plan to grant"><option value="plus">plus</option><option value="business">business</option></select>' +
        '<input id="grantDays" type="text" value="30" style="width:56px" aria-label="Days" title="days">' +
        '<button class="primary" type="button" id="grantBtn">Grant plan</button>' +
        '<button class="ghost" type="button" id="pauseBtn">Pause monitoring</button>' +
        '<button class="danger" type="button" id="eraseBtn">Erase customer</button>' +
      '</div><p class="err" id="detailErr"></p></div>';

  // active meters with charts
  for (const m of d.active.meters) {
    const cls = balanceClass(m);
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML =
      '<div class="row"><span style="font-weight:600;color:var(--text)">' + esc(m.label) + '</span>' +
      '<span class="muted" style="font-size:12px">acct ' + esc(m.accountNo) + ' · meter ' + esc(m.meterNo) + '</span><div class="spacer"></div>' +
      '<span class="balance ' + cls + '">' + (m.balance === null ? '—' : fmt(m.balance)) + '</span></div>' +
      (m.prediction ? '<div class="muted" style="font-size:12px;margin-top:4px">~' + m.prediction.daysLeft.toFixed(1) + ' days left · ' + fmt(m.prediction.burnPerDay) + '/day</div>' : '') +
      '<canvas height="80"></canvas>';
    det.appendChild(card);
    new Chart(card.querySelector('canvas'), {
      type: 'line',
      data: {
        labels: m.readings.map(r => new Date(r.t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })),
        datasets: [{ data: m.readings.map(r => r.balance), borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,.1)', fill: true, pointRadius: 0, tension: .35, borderWidth: 1.5 }],
      },
      options: {
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { maxTicksLimit: 7, color: '#5c606a', font: { size: 11 } }, grid: { display: false }, border: { display: false } },
          y: { ticks: { color: '#5c606a', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,.05)' }, border: { display: false } },
        },
      },
    });
  }
  if (d.pausedMeters.length) {
    const c = document.createElement('div'); c.className = 'card';
    c.innerHTML = '<div style="font-weight:600;color:var(--muted);font-size:12px;margin-bottom:4px">Paused meters</div>' +
      d.pausedMeters.map(m => '<div class="muted" style="font-size:13px">' + esc(m.nickname ?? m.meterNo) + ' · acct ' + esc(m.accountNo) + '</div>').join('');
    det.appendChild(c);
  }
  if (d.active.alerts.length) {
    const c = document.createElement('div'); c.className = 'card';
    c.innerHTML = '<div style="font-weight:600;color:var(--text);font-size:13px;margin-bottom:8px">Recent alerts</div><div class="table-wrap"><table><tbody>' +
      d.active.alerts.map(a => '<tr><td class="muted">' + when(a.sentAt) + '</td><td>' + esc(a.action) + '</td><td class="' + esc(a.level) + '">' + esc(a.level) + '</td></tr>').join('') +
      '</tbody></table></div>';
    det.appendChild(c);
  }
  if (d.payments.length) {
    const c = document.createElement('div'); c.className = 'card';
    c.innerHTML = '<div style="font-weight:600;color:var(--text);font-size:13px;margin-bottom:8px">Payments</div><div class="table-wrap"><table><tbody>' +
      d.payments.map(p => '<tr><td class="muted">' + when(p.createdAt) + '</td><td>' + fmt(p.amountBdt) + '</td><td>' + esc(p.provider) + '</td><td>' + esc(p.status) + '</td></tr>').join('') +
      '</tbody></table></div>';
    det.appendChild(c);
  }

  const err = document.getElementById('detailErr');
  const fail = e => { err.textContent = e.message; };
  document.getElementById('closeDetail').onclick = () => { det.innerHTML = ''; };
  document.getElementById('grantBtn').onclick = async () => {
    err.textContent = '';
    try {
      await action(u.id, 'grant', { plan: document.getElementById('grantPlan').value, days: Number(document.getElementById('grantDays').value) });
      await loadStats(); await openDetail(u.id); loadAudit().catch(() => {});
    } catch (e) { fail(e); }
  };
  document.getElementById('pauseBtn').onclick = async () => {
    if (!confirm('Pause monitoring for every meter this customer has?')) return;
    err.textContent = '';
    try { await action(u.id, 'pause'); await openDetail(u.id); await loadList(); loadAudit().catch(() => {}); } catch (e) { fail(e); }
  };
  document.getElementById('eraseBtn').onclick = async () => {
    if (prompt('This permanently erases customer #' + u.id + ' and ALL their data. Type ERASE to confirm.') !== 'ERASE') return;
    err.textContent = '';
    try { await action(u.id, 'erase'); det.innerHTML = ''; await loadStats(); await loadList(); loadAudit().catch(() => {}); } catch (e) { fail(e); }
  };
  det.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

document.getElementById('searchBtn').onclick = () => { query = document.getElementById('q').value.trim(); page = 0; loadList(); };
document.getElementById('q').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('searchBtn').click(); });
document.getElementById('prev').onclick = () => { if (page > 0) { page--; loadList(); } };
document.getElementById('next').onclick = () => { page++; loadList(); };
document.getElementById('auditRefresh').onclick = () => loadAudit().catch(() => {});

loadStats().catch(() => {});
loadList().catch(() => {});
loadAudit().catch(() => {});
</script>`
  );
}
