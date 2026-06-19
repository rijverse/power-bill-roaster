// Operator admin panel: one dark, roast-branded page. Same look as the customer
// dashboard (dashboard-html.ts) + Chart.js from the same CDN. The login screen
// and the app shell are separate documents; the app shell talks to /admin/api/*.

const HEAD = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #0d0d0d; color: #eee; font-family: 'Segoe UI', system-ui, sans-serif; }
  a { color: #f59e0b; }
  header { display: flex; justify-content: space-between; align-items: center; padding: 18px 20px; border-bottom: 1px solid #2a2a2a; }
  h1 { margin: 0; font-size: 20px; } h1 span { color: #f59e0b; }
  main { max-width: 960px; margin: 0 auto; padding: 16px; }
  .card { background: #161616; border: 1px solid #2a2a2a; border-radius: 14px; padding: 16px; margin-top: 14px; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px; }
  .stat { background: #161616; border: 1px solid #2a2a2a; border-radius: 12px; padding: 12px 14px; }
  .stat .n { font-size: 22px; font-weight: 800; } .stat .k { color: #888; font-size: 12px; margin-top: 2px; }
  input, select, button { font: inherit; }
  input[type=text], input[type=password], select { background: #0d0d0d; color: #eee; border: 1px solid #333; border-radius: 8px; padding: 8px 10px; }
  button { background: #f59e0b; color: #111; border: 0; border-radius: 8px; padding: 8px 12px; font-weight: 600; cursor: pointer; }
  button.ghost { background: transparent; color: #ccc; border: 1px solid #333; }
  button.danger { background: #b91c1c; color: #fff; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 9px 6px; border-top: 1px solid #2a2a2a; }
  th { color: #888; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
  tbody tr { cursor: pointer; } tbody tr:hover { background: #1c1c1c; }
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .spacer { flex: 1; }
  .muted { color: #888; } .pill { font-size: 12px; padding: 2px 8px; border-radius: 999px; border: 1px solid #333; }
  .ok { color: #4ade80; } .low { color: #facc15; } .critical { color: #f87171; }
  .balance { font-weight: 800; }
  .empty { color: #888; text-align: center; padding: 28px 0; }
  .err { color: #f87171; min-height: 18px; font-size: 13px; }
  canvas { margin-top: 10px; }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px; }
  label { font-size: 13px; color: #bbb; }
</style>`;

function page(title: string, body: string): string {
  return `<!DOCTYPE html><html lang="en"><head>${HEAD}<title>${title}</title></head><body>${body}</body></html>`;
}

export function adminLoginHtml(hasError: boolean, message = 'Wrong password.'): string {
  const err = hasError ? message : '';
  return page(
    'Power Roast - Admin',
    `<main style="max-width:360px;margin-top:12vh">
  <h1>⚡ Power <span>Roast</span> admin</h1>
  <form class="card" method="POST" action="/admin/login">
    <p class="muted" style="margin-top:0">Operator sign-in.</p>
    <input type="password" name="password" placeholder="Admin password" autofocus required
           style="width:100%;margin-bottom:10px">
    <button type="submit" style="width:100%">Sign in</button>
    <p class="err" style="margin-bottom:0">${err}</p>
  </form>
</main>`
  );
}

export function adminAppHtml(csrf: string): string {
  return page(
    'Power Roast - Admin',
    `<header>
  <h1>⚡ Power <span>Roast</span> admin</h1>
  <form method="POST" action="/admin/logout" style="margin:0"><button class="ghost" type="submit">Sign out</button></form>
</header>
<main>
  <div id="stats" class="stats"></div>

  <div class="card">
    <div class="row">
      <input id="q" type="text" placeholder="Search by email or Telegram chat id" style="flex:1;min-width:200px">
      <button id="searchBtn" type="button">Search</button>
    </div>
    <div id="list"><div class="empty">Loading…</div></div>
    <div class="row" style="margin-top:10px">
      <button id="prev" class="ghost" type="button">‹ Prev</button>
      <span id="pageLabel" class="muted"></span>
      <button id="next" class="ghost" type="button">Next ›</button>
    </div>
  </div>

  <div id="detail"></div>
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

function balanceClass(m) {
  if (m.balance === null) return 'muted';
  return m.balance < m.criticalThreshold ? 'critical' : m.balance < m.lowThreshold ? 'low' : 'ok';
}

async function loadList() {
  const data = await getJSON('/users?page=' + page + '&q=' + encodeURIComponent(query));
  const box = document.getElementById('list');
  if (!data.users.length) { box.innerHTML = '<div class="empty">No customers found.</div>'; }
  else {
    box.innerHTML = '<table><thead><tr><th>ID</th><th>Chat id</th><th>Email</th><th>Plan</th><th>Meters</th><th>Last reading</th></tr></thead><tbody>' +
      data.users.map(u =>
        '<tr data-id="' + u.id + '"><td>' + u.id + '</td><td>' + esc(u.telegramChatId ?? '—') + '</td><td>' + esc(u.email ?? '—') +
        '</td><td><span class="pill">' + esc(u.plan) + '</span></td><td>' + u.activeMeters + '</td><td class="muted">' + when(u.lastReadingAt) + '</td></tr>'
      ).join('') + '</tbody></table>';
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
    '<div class="card"><div class="row"><h2 style="margin:0;font-size:18px">Customer #' + u.id + '</h2>' +
      '<span class="pill">' + esc(u.plan) + '</span><div class="spacer"></div>' +
      '<button class="ghost" type="button" id="closeDetail">Close</button></div>' +
      '<p class="muted" style="margin:8px 0 0">Chat id ' + esc(u.telegramChatId ?? '—') + ' · ' + esc(u.email ?? 'no email') +
      ' · joined ' + when(u.createdAt) + ' · tone ' + esc(u.tonePref) + '</p>' +
      '<p class="muted" style="margin:4px 0 0">Subscription: ' + sub + ' · meter cap ' + esc(d.limits.maxMeters) + ' · SMS ' + esc(d.limits.smsPerMonth) + '/mo</p>' +
      '<div class="actions">' +
        '<select id="grantPlan"><option value="plus">plus</option><option value="business">business</option></select>' +
        '<input id="grantDays" type="text" value="30" style="width:64px" title="days">' +
        '<button type="button" id="grantBtn">Grant plan</button>' +
        '<button class="ghost" type="button" id="pauseBtn">Pause monitoring</button>' +
        '<button class="danger" type="button" id="eraseBtn">Erase customer</button>' +
      '</div><p class="err" id="detailErr"></p></div>';

  // active meters with charts
  for (const m of d.active.meters) {
    const cls = balanceClass(m);
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML =
      '<div class="row"><span style="font-weight:600">📟 ' + esc(m.label) + '</span>' +
      '<span class="muted">acct ' + esc(m.accountNo) + ' · meter ' + esc(m.meterNo) + '</span><div class="spacer"></div>' +
      '<span class="balance ' + cls + '">' + (m.balance === null ? '—' : fmt(m.balance)) + '</span></div>' +
      (m.prediction ? '<div class="muted" style="font-size:13px">🔮 ~' + m.prediction.daysLeft.toFixed(1) + ' days left at ' + fmt(m.prediction.burnPerDay) + '/day</div>' : '') +
      '<canvas height="90"></canvas>';
    det.appendChild(card);
    new Chart(card.querySelector('canvas'), {
      type: 'line',
      data: {
        labels: m.readings.map(r => new Date(r.t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })),
        datasets: [{ data: m.readings.map(r => r.balance), borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,.12)', fill: true, pointRadius: 0, tension: .3, borderWidth: 2 }],
      },
      options: { plugins: { legend: { display: false } }, scales: { x: { ticks: { maxTicksLimit: 7, color: '#777' }, grid: { display: false } }, y: { ticks: { color: '#777' }, grid: { color: '#222' } } } },
    });
  }
  if (d.pausedMeters.length) {
    const c = document.createElement('div'); c.className = 'card';
    c.innerHTML = '<div class="muted" style="font-weight:600">Paused meters</div>' +
      d.pausedMeters.map(m => '<div class="muted" style="font-size:13px">📴 ' + esc(m.nickname ?? m.meterNo) + ' · acct ' + esc(m.accountNo) + '</div>').join('');
    det.appendChild(c);
  }
  if (d.active.alerts.length) {
    const c = document.createElement('div'); c.className = 'card';
    c.innerHTML = '<div style="font-weight:600;margin-bottom:6px">Recent alerts</div><table><tbody>' +
      d.active.alerts.map(a => '<tr><td class="muted">' + when(a.sentAt) + '</td><td>' + esc(a.action) + '</td><td class="' + esc(a.level) + '">' + esc(a.level) + '</td></tr>').join('') +
      '</tbody></table>';
    det.appendChild(c);
  }
  if (d.payments.length) {
    const c = document.createElement('div'); c.className = 'card';
    c.innerHTML = '<div style="font-weight:600;margin-bottom:6px">Payments</div><table><tbody>' +
      d.payments.map(p => '<tr><td class="muted">' + when(p.createdAt) + '</td><td>' + fmt(p.amountBdt) + '</td><td>' + esc(p.provider) + '</td><td>' + esc(p.status) + '</td></tr>').join('') +
      '</tbody></table>';
    det.appendChild(c);
  }

  const err = document.getElementById('detailErr');
  const fail = e => { err.textContent = e.message; };
  document.getElementById('closeDetail').onclick = () => { det.innerHTML = ''; };
  document.getElementById('grantBtn').onclick = async () => {
    err.textContent = '';
    try {
      await action(u.id, 'grant', { plan: document.getElementById('grantPlan').value, days: Number(document.getElementById('grantDays').value) });
      await loadStats(); await openDetail(u.id);
    } catch (e) { fail(e); }
  };
  document.getElementById('pauseBtn').onclick = async () => {
    if (!confirm('Pause monitoring for every meter this customer has?')) return;
    err.textContent = '';
    try { await action(u.id, 'pause'); await openDetail(u.id); await loadList(); } catch (e) { fail(e); }
  };
  document.getElementById('eraseBtn').onclick = async () => {
    if (prompt('This permanently erases customer #' + u.id + ' and ALL their data. Type ERASE to confirm.') !== 'ERASE') return;
    err.textContent = '';
    try { await action(u.id, 'erase'); det.innerHTML = ''; await loadStats(); await loadList(); } catch (e) { fail(e); }
  };
  det.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

document.getElementById('searchBtn').onclick = () => { query = document.getElementById('q').value.trim(); page = 0; loadList(); };
document.getElementById('q').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('searchBtn').click(); });
document.getElementById('prev').onclick = () => { if (page > 0) { page--; loadList(); } };
document.getElementById('next').onclick = () => { page++; loadList(); };

loadStats().catch(() => {});
loadList().catch(() => {});
</script>`
  );
}
