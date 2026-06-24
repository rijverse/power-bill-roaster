// Operator admin panel: the password login screen and the signed-in console.
// Both share the Power·Roast design system (theme.ts). The console is one
// document with three client-routed screens (Revenue & health, Users & meters,
// Delivery logs) that talk to /admin/api/*. Real aggregates, the searchable user
// table and the per-user detail drawer (grant / pause / erase, balance charts,
// alerts, payments) are fully wired; metrics the backend doesn't compute yet
// (MRR / ARPU / churn, per-send delivery logs) are reproduced from the design
// but clearly marked as samples. Mutations echo the CSRF token from the page.

import { pageDoc, logo, CHART_SCRIPT, CLIENT_HELPERS } from './theme';

const ADMIN_BADGE = `<span class="pr-pill low" style="font-size:10px;padding:3px 9px">admin</span>`;

export function adminLoginHtml(hasError: boolean, message = 'Wrong password.'): string {
  const err = hasError ? message : '';
  const body = `<div style="position:relative; z-index:1; min-height:100vh; display:grid; place-items:center; padding:32px 20px;">
  <div class="pr-authpanel" style="width:100%">
    <div style="display:flex; justify-content:center; gap:10px; align-items:center; margin-bottom:22px;">${logo(true)} ${ADMIN_BADGE}</div>
    <form class="pr-formcard" method="POST" action="/admin/login" style="max-width:380px">
      <div style="font-size:20px; font-weight:800; color:var(--text); letter-spacing:-0.02em; margin-bottom:4px;">Operator sign-in</div>
      <p class="muted" style="font-size:13px; margin-bottom:18px;">This console holds customer PII. Sign in to continue.</p>
      <label class="pr-label" for="pw">Admin password</label>
      <input class="pr-input" id="pw" type="password" name="password" aria-label="Admin password" placeholder="••••••••" autofocus required style="margin-bottom:16px">
      <button class="pr-btn gold block" type="submit">Sign in</button>
      <p class="pr-err" style="margin-top:12px">${err}</p>
    </form>
  </div>
</div>`;
  return pageDoc('Power Roast — Admin', body);
}

const AIC = {
  revenue:
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"></path><path d="m19 9-5 5-4-4-3 3"></path></svg>',
  users:
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.9"></path></svg>',
  logs: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v16H4z"></path><path d="M8 8h8M8 12h8M8 16h5"></path></svg>',
};

export function adminAppHtml(csrf: string): string {
  const body = `<div class="pr-shell">
  <div id="pr-scrim"></div>
  <aside class="pr-sidebar" id="pr-sidebar">
    <div style="display:flex;align-items:center;gap:9px;padding:6px 8px 22px">${logo()} ${ADMIN_BADGE}</div>
    <nav class="pr-nav">
      <div class="pr-nav-label">Operator</div>
      <button class="pr-navbtn active" type="button" data-screen="revenue">${AIC.revenue}Revenue &amp; health</button>
      <button class="pr-navbtn" type="button" data-screen="users">${AIC.users}Users &amp; meters</button>
      <button class="pr-navbtn" type="button" data-screen="logs">${AIC.logs}Delivery logs</button>
    </nav>
    <div class="pr-side-foot">
      <a class="pr-navbtn" href="/app" style="border:1px solid var(--border);background:rgba(255,255,255,0.03);font-size:13px;gap:11px"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#34D399" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"></path></svg>Back to my dashboard</a>
      <div class="pr-user">
        <span class="pr-avatar">⚡</span>
        <div class="who"><div class="n">Operator</div><div class="m">admin console</div></div>
        <form method="POST" action="/admin/logout" style="margin:0"><button class="pr-iconbtn" type="submit" title="Sign out"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><path d="m16 17 5-5-5-5M21 12H9"></path></svg></button></form>
      </div>
    </div>
  </aside>

  <div class="pr-main">
    <header class="pr-topbar">
      <button id="pr-hamburger" type="button"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M3 12h18M3 18h18"></path></svg></button>
      <div class="titles"><div class="t" id="topTitle">Revenue &amp; health</div><div class="s" id="topSub">operator console · everything is fine, mostly</div></div>
      <button class="pr-btn gold" id="refreshBtn" type="button"><svg id="refreshIcon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0B1020" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"></path></svg><span>Refresh</span></button>
    </header>
    <main class="pr-content"><div id="host"><div class="pr-card pr-empty">Loading…</div></div></main>
  </div>
</div>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
<script>
const CSRF = ${JSON.stringify(csrf)};
${CLIENT_HELPERS}
${CHART_SCRIPT}

let SCREEN = 'revenue', page = 0, query = '', OVERVIEW = null, HEALTH = null, DETAIL = null;
let CHARTS = [];
const host = document.getElementById('host');

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
function clearCharts() { CHARTS.forEach(c => { try { c.destroy(); } catch (e) {} }); CHARTS = []; }
function planPill(plan) { return '<span class="pr-pill ' + (plan === 'free' ? '' : 'low') + '">' + esc(plan) + '</span>'; }
function balanceClass(m) { return m.balance === null ? 'muted' : m.balance < m.criticalThreshold ? 'critical' : m.balance < m.lowThreshold ? 'low' : 'ok'; }

// ---- chrome --------------------------------------------------------------
const TITLES = {
  revenue: ['Revenue & health', 'operator console · everything is fine, mostly'],
  users: ['Users & meters', null],
  logs: ['Delivery logs', 'alert delivery · last 24 hours'],
};
function renderChrome() {
  document.querySelectorAll('.pr-navbtn[data-screen]').forEach(b => b.classList.toggle('active', b.getAttribute('data-screen') === SCREEN));
  let title = TITLES[SCREEN][0], sub = TITLES[SCREEN][1];
  if (SCREEN === 'users' && OVERVIEW) sub = OVERVIEW.users.toLocaleString() + ' users · ' + OVERVIEW.activeMeters.toLocaleString() + ' meters tracked';
  document.getElementById('topTitle').textContent = title;
  document.getElementById('topSub').textContent = sub || '';
}

// ---- screen: revenue & health -------------------------------------------
function statCard(k, n, sub, cls, sample) {
  return '<div class="pr-stat" style="padding:20px"><div class="k" style="display:flex;align-items:center;justify-content:space-between;gap:6px">' + k + (sample ? '<span class="pr-sample">sample</span>' : '') + '</div>' +
    '<div class="n ' + (cls || '') + '" style="font-size:26px">' + esc(n) + '</div>' + (sub ? '<div class="d ' + (cls === 'green' ? 'up' : '') + '">' + esc(sub) + '</div>' : '') + '</div>';
}
function healthRow(label, meta, val, color) {
  return '<div class="pr-rowitem"><span class="pr-dot" style="background:' + color + '"></span>' +
    '<div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:600;color:var(--text)">' + esc(label) + '</div><div class="mono" style="font-size:11px;color:var(--faint)">' + esc(meta) + '</div></div>' +
    '<span class="mono" style="font-size:12.5px;font-weight:700;color:' + color + '">' + esc(val) + '</span></div>';
}
function mrrSvg(series) {
  if (!series.length) return '<div class="pr-empty" style="padding:48px 0">No payments recorded yet.</div>';
  const W = 600, H = 200, n = series.length;
  const max = Math.max.apply(null, series.map(s => s.total).concat([1]));
  const x = i => (n === 1 ? W / 2 : (i / (n - 1)) * W);
  const y = v => H - 10 - (v / max) * (H - 24);
  const pts = series.map((s, i) => x(i).toFixed(0) + ',' + y(s.total).toFixed(0));
  const line = 'M' + pts.join(' L');
  const last = series[n - 1];
  return '<svg width="100%" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" style="display:block"><defs><linearGradient id="prRev" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#34D399" stop-opacity="0.3"></stop><stop offset="100%" stop-color="#34D399" stop-opacity="0"></stop></linearGradient></defs>' +
    '<path d="' + line + ' L' + W + ',' + H + ' L0,' + H + ' Z" fill="url(#prRev)"></path>' +
    '<path d="' + line + '" fill="none" stroke="#34D399" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path>' +
    '<circle cx="' + x(n - 1).toFixed(0) + '" cy="' + y(last.total).toFixed(0) + '" r="5" fill="#34D399" stroke="#11162A" stroke-width="2"></circle></svg>' +
    '<div style="display:flex;justify-content:space-between;margin-top:8px" class="mono"><span style="font-size:11px;color:var(--faint)">' + esc(series[0].month) + '</span><span style="font-size:11px;color:var(--green)">' + esc(last.month) + '</span></div>';
}
function revPayments(payments) {
  if (!payments.length) return '<div class="pr-empty" style="padding:18px 0">No payments yet.</div>';
  return '<div class="pr-list">' + payments.map(p =>
    '<div class="pr-rowitem"><span class="pr-chan-ic" style="background:rgba(255,255,255,0.05);font-family:var(--mono);font-size:10px;font-weight:700;color:var(--muted)">' + esc(String(p.provider).slice(0, 4)) + '</span>' +
    '<div style="flex:1;min-width:0"><div style="font-size:13.5px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(p.user) + '</div><div class="mono" style="font-size:11px;color:var(--faint)">' + esc(p.plan) + ' · ' + when(p.createdAt) + '</div></div>' +
    '<div style="font-size:14px;font-weight:800;color:var(--green)">' + fmt(p.amountBdt) + '</div></div>'
  ).join('') + '</div>';
}
function renderRevenue() {
  const o = OVERVIEW || {};
  const free = Math.max(0, (o.users || 0) - (o.activeSubscriptions || 0));
  let h = '<div class="pr-statrow" style="--cols:4;margin-bottom:18px">' +
    statCard('MRR', fmt(o.mrr ?? 0), 'monthly recurring', '') +
    statCard('Paid subscribers', String(o.activeSubscriptions ?? 0), free.toLocaleString() + ' on free / self-host', '') +
    statCard('ARPU', fmt(o.arpu ?? 0), 'per paid / month', '') +
    statCard('Churn', (o.churnPct ?? 0) + '%', 'last 30 days', (o.churnPct ?? 0) > 5 ? 'red' : 'gold') +
  '</div>';

  h += '<div class="pr-grid pr-2col">' +
    '<div class="pr-card"><div class="pr-section-head" style="margin-bottom:14px"><div><div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:3px">Monthly recurring revenue</div><div class="mono" style="font-size:12px;color:var(--faint)">last 12 months · collected, BDT</div></div><span class="mono" style="font-size:12px;font-weight:700;color:var(--green)">' + fmt(o.totalPaidBdt ?? 0) + ' all-time</span></div>' +
      '<div id="mrrChart"><div class="pr-empty" style="padding:48px 0">Loading…</div></div></div>' +
    '<div class="pr-card" style="padding:20px"><div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:12px">System health</div><div class="pr-list">' +
      healthRow('DESCO prepaid API', HEALTH ? ('last poll ' + relWhen(HEALTH.lastPollCycleAt)) : 'status unknown', HEALTH ? (HEALTH.status === 'ok' ? 'Operational' : 'Stale') : '—', HEALTH ? (HEALTH.status === 'ok' ? '#34D399' : '#FBB024') : '#6E7790') +
      healthRow('Alerts sent', 'rolling 24 hours', (o.alerts24h ?? 0) + ' / 24h', '#34D399') +
      healthRow('Readings stored', 'all-time data points', (o.readings ?? 0).toLocaleString(), '#8FA8FF') +
      healthRow('Past-due subscriptions', 'active but period ended', String(o.pastDue ?? 0), (o.pastDue ?? 0) > 0 ? '#FF8077' : '#34D399') +
    '</div></div></div>';

  h += '<div class="pr-card" style="margin-top:18px"><div class="pr-section-head" style="margin-bottom:8px"><span class="pr-card-title">Recent payments</span><span class="mono muted" style="font-size:12px">latest first</span></div>' +
    '<div id="payFeed"><div class="pr-empty" style="padding:18px 0">Loading…</div></div></div>';

  host.innerHTML = h;
  getJSON('/revenue').then(rev => {
    const c = host.querySelector('#mrrChart'); if (c) c.innerHTML = mrrSvg(rev.mrrSeries);
    const f = host.querySelector('#payFeed'); if (f) f.innerHTML = revPayments(rev.payments);
  }).catch(() => {});
}
function relWhen(t) {
  if (!t) return 'never';
  const d = Date.now() - new Date(t).getTime();
  if (d < 60000) return 'just now';
  if (d < 3600000) return Math.floor(d / 60000) + 'm ago';
  if (d < 86400000) return Math.floor(d / 3600000) + 'h ago';
  return Math.floor(d / 86400000) + 'd ago';
}

// ---- screen: users & meters ---------------------------------------------
function renderUsers() {
  const o = OVERVIEW || {};
  let h = '<div class="pr-statrow" style="--cols:4;margin-bottom:18px">' +
    statCard('Total users', (o.users ?? 0).toLocaleString(), '', '') +
    statCard('Paid', String(o.activeSubscriptions ?? 0), '', 'gold') +
    statCard('Meters tracked', (o.activeMeters ?? 0).toLocaleString(), '', '') +
    statCard('Past due', '—', 'not tracked yet', 'red', true) +
  '</div>';
  h += '<div class="pr-card" style="padding:8px 0">' +
    '<div class="row" style="padding:14px 22px;gap:12px"><input id="q" class="pr-input" type="text" placeholder="Search by email or Telegram chat id…" value="' + esc(query) + '" style="flex:1;min-width:200px"><button id="searchBtn" class="pr-btn" type="button">Search</button></div>' +
    '<div id="list" style="padding:0 8px"><div class="pr-empty">Loading…</div></div>' +
    '<div class="row" style="padding:12px 22px"><button id="prev" class="pr-btn ghost sm" type="button">‹ Prev</button><span id="pageLabel" class="mono muted" style="font-size:12px"></span><button id="next" class="pr-btn ghost sm" type="button">Next ›</button></div>' +
  '</div><div id="detailHost"></div>';
  host.innerHTML = h;
  host.querySelector('#searchBtn').onclick = () => { query = host.querySelector('#q').value.trim(); page = 0; loadList(); };
  host.querySelector('#q').addEventListener('keydown', e => { if (e.key === 'Enter') host.querySelector('#searchBtn').click(); });
  host.querySelector('#prev').onclick = () => { if (page > 0) { page--; loadList(); } };
  host.querySelector('#next').onclick = () => { page++; loadList(); };
  loadList();
  if (DETAIL) openDetail(DETAIL);
}
async function loadList() {
  const box = host.querySelector('#list'); if (!box) return;
  let data;
  try { data = await getJSON('/users?page=' + page + '&q=' + encodeURIComponent(query)); }
  catch (e) { box.innerHTML = '<div class="pr-empty">Could not load users.</div>'; return; }
  if (!data.users.length) { box.innerHTML = '<div class="pr-empty">No users found.</div>'; }
  else {
    box.innerHTML = '<div class="pr-tableshell" style="overflow-x:auto"><div style="min-width:680px">' +
      '<div style="display:grid;grid-template-columns:2fr 0.8fr 1.1fr 1fr 1fr;gap:12px;padding:11px 14px;border-bottom:1px solid var(--border-soft)" class="mono"><span style="font-size:10.5px;text-transform:uppercase;letter-spacing:0.06em;color:var(--faint)">User</span><span style="font-size:10.5px;text-transform:uppercase;letter-spacing:0.06em;color:var(--faint)">Meters</span><span style="font-size:10.5px;text-transform:uppercase;letter-spacing:0.06em;color:var(--faint)">Plan</span><span style="font-size:10.5px;text-transform:uppercase;letter-spacing:0.06em;color:var(--faint)">Last reading</span><span style="font-size:10.5px;text-transform:uppercase;letter-spacing:0.06em;color:var(--faint)">Status</span></div>' +
      data.users.map(u => {
        const initial = (u.email || '?').charAt(0).toUpperCase();
        const handle = u.telegramChatId ? ('chat ' + u.telegramChatId) : 'no telegram';
        const status = u.plan === 'free' ? '<span class="pr-pill">Free</span>' : '<span class="pr-pill ok">Active</span>';
        return '<div class="pr-rowitem userRow" data-id="' + u.id + '" style="display:grid;grid-template-columns:2fr 0.8fr 1.1fr 1fr 1fr;gap:12px;align-items:center;padding:13px 14px;cursor:pointer">' +
          '<div style="display:flex;align-items:center;gap:11px;min-width:0"><span class="pr-avatar" style="width:30px;height:30px;font-size:12px">' + initial + '</span><div style="min-width:0"><div style="font-size:13.5px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(u.email || 'no email') + '</div><div class="mono" style="font-size:11px;color:var(--faint)">' + esc(handle) + '</div></div></div>' +
          '<span class="mono" style="font-size:13px;color:var(--text-2)">' + u.activeMeters + '</span>' +
          '<span style="font-size:13px">' + planPill(u.plan) + '</span>' +
          '<span class="mono muted" style="font-size:12px">' + when(u.lastReadingAt) + '</span>' +
          '<span>' + status + '</span></div>';
      }).join('') + '</div></div>';
    box.querySelectorAll('.userRow').forEach(tr => tr.onclick = () => openDetail(tr.dataset.id));
  }
  host.querySelector('#pageLabel').textContent = 'page ' + (page + 1);
  host.querySelector('#prev').disabled = page === 0;
  host.querySelector('#next').disabled = !data.hasMore;
}

async function openDetail(id) {
  DETAIL = id;
  clearCharts();
  const d = await getJSON('/users/' + id);
  const det = host.querySelector('#detailHost'); if (!det) return;
  const u = d.user;
  const sub = d.subscription
    ? esc(d.subscription.plan) + ' · ' + esc(d.subscription.status) + ' · via ' + esc(d.subscription.provider) + (d.subscription.currentPeriodEnd ? ' · until ' + when(d.subscription.currentPeriodEnd) : '')
    : 'none (free)';

  det.innerHTML =
    '<div class="pr-card" style="margin-top:18px"><div class="pr-section-head" style="margin-bottom:10px">' +
      '<div style="display:flex;align-items:center;gap:10px"><span class="pr-card-title">' + esc(u.email || ('Customer #' + u.id)) + '</span>' + planPill(u.plan) + '</div>' +
      '<button class="pr-btn ghost sm" type="button" id="closeDetail">Close</button></div>' +
      '<p class="muted" style="font-size:13px">#' + u.id + ' · chat ' + esc(u.telegramChatId ?? '—') + ' · joined ' + when(u.createdAt) + ' · tone ' + esc(u.tonePref) + '</p>' +
      '<p class="muted" style="font-size:13px;margin-top:4px">Subscription: ' + sub + ' · meter cap ' + esc(d.limits.maxMeters) + ' · SMS ' + esc(d.limits.smsPerMonth) + '/mo</p>' +
      '<div class="row" style="margin-top:14px;gap:10px">' +
        '<select id="grantPlan" class="pr-input" aria-label="Plan to grant" style="width:auto;min-width:120px"><option value="plus">plus</option><option value="business">business</option></select>' +
        '<input id="grantDays" class="pr-input mono" type="text" value="30" style="width:70px" aria-label="Days" title="days">' +
        '<button class="pr-btn gold" type="button" id="grantBtn">Grant plan</button>' +
        '<button class="pr-btn ghost" type="button" id="pauseBtn">Pause monitoring</button>' +
        '<button class="pr-btn danger" type="button" id="eraseBtn">Erase customer</button>' +
      '</div><p class="pr-err" id="detailErr" style="margin-top:8px"></p></div>';

  for (let i = 0; i < d.active.meters.length; i++) {
    const m = d.active.meters[i];
    const card = document.createElement('div');
    card.className = 'pr-card';
    card.style.marginTop = '18px';
    card.innerHTML =
      '<div class="pr-section-head" style="margin-bottom:4px"><div style="min-width:0"><span style="font-weight:700;color:var(--text)">' + esc(m.label) + '</span>' +
        '<div class="mono" style="font-size:11.5px;color:var(--faint);margin-top:2px">acct ' + esc(m.accountNo) + ' · meter ' + esc(m.meterNo) + '</div></div>' +
        '<div class="balance ' + balanceClass(m) + '" style="font-size:20px;font-weight:800">' + fmt(m.balance) + '</div></div>' +
      (m.prediction ? '<div class="mono" style="font-size:11.5px;color:var(--faint)">~' + m.prediction.daysLeft.toFixed(1) + ' days left · ' + fmt(m.prediction.burnPerDay) + '/day</div>' : '') +
      '<div class="pr-chart sm"><canvas></canvas></div>';
    det.appendChild(card);
    CHARTS.push(window.prChart(card.querySelector('canvas'), m.readings, { low: m.lowThreshold, critical: m.criticalThreshold }));
  }
  if (d.pausedMeters.length) {
    const c = document.createElement('div'); c.className = 'pr-card'; c.style.marginTop = '18px';
    c.innerHTML = '<div class="mono" style="font-weight:700;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px">Paused meters</div>' +
      d.pausedMeters.map(m => '<div class="muted" style="font-size:13px">' + esc(m.nickname ?? m.meterNo) + ' · acct ' + esc(m.accountNo) + '</div>').join('');
    det.appendChild(c);
  }
  if (d.active.alerts.length) {
    const c = document.createElement('div'); c.className = 'pr-card'; c.style.marginTop = '18px';
    c.innerHTML = '<div class="pr-card-title" style="margin-bottom:8px">Recent alerts</div><div class="pr-tableshell" style="overflow-x:auto"><table class="pr-table"><tbody>' +
      d.active.alerts.map(a => '<tr><td class="mono muted">' + when(a.sentAt) + '</td><td>' + esc(a.action) + '</td><td><span class="pr-pill ' + (a.level === 'critical' ? 'crit' : a.level === 'low' ? 'low' : 'ok') + '">' + esc(a.level) + '</span></td></tr>').join('') +
      '</tbody></table></div>';
    det.appendChild(c);
  }
  if (d.payments.length) {
    const c = document.createElement('div'); c.className = 'pr-card'; c.style.marginTop = '18px';
    c.innerHTML = '<div class="pr-card-title" style="margin-bottom:8px">Payments</div><div class="pr-tableshell" style="overflow-x:auto"><table class="pr-table"><tbody>' +
      d.payments.map(p => '<tr><td class="mono muted">' + when(p.createdAt) + '</td><td class="mono" style="color:var(--green);font-weight:700">' + fmt(p.amountBdt) + '</td><td>' + esc(p.provider) + '</td><td>' + esc(p.status) + '</td></tr>').join('') +
      '</tbody></table></div>';
    det.appendChild(c);
  }

  const err = host.querySelector('#detailErr');
  host.querySelector('#closeDetail').onclick = () => { DETAIL = null; det.innerHTML = ''; };
  host.querySelector('#grantBtn').onclick = async () => {
    err.textContent = '';
    try { await action(u.id, 'grant', { plan: host.querySelector('#grantPlan').value, days: Number(host.querySelector('#grantDays').value) }); await loadOverview(); await openDetail(u.id); } catch (e) { err.textContent = e.message; }
  };
  host.querySelector('#pauseBtn').onclick = async () => {
    if (!confirm('Pause monitoring for every meter this customer has?')) return;
    err.textContent = '';
    try { await action(u.id, 'pause'); await openDetail(u.id); await loadList(); } catch (e) { err.textContent = e.message; }
  };
  host.querySelector('#eraseBtn').onclick = async () => {
    if (prompt('This permanently erases customer #' + u.id + ' and ALL their data. Type ERASE to confirm.') !== 'ERASE') return;
    err.textContent = '';
    try { await action(u.id, 'erase'); DETAIL = null; det.innerHTML = ''; await loadOverview(); await loadList(); renderChrome(); } catch (e) { err.textContent = e.message; }
  };
  det.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---- screen: delivery logs ----------------------------------------------
const LEVEL_LABEL = { critical: 'CRITICAL', low: 'WARNING', ok: 'OK' };
function deliveryRow(l) {
  const t = new Date(l.sentAt);
  const time = t.toLocaleTimeString('en-GB');
  const date = t.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  const typePill = '<span class="pr-pill ' + (l.level === 'critical' ? 'crit' : l.level === 'low' ? 'low' : 'ok') + '">' + (LEVEL_LABEL[l.level] || esc(l.level)) + '</span>';
  const statusPill = l.status === 'sent'
    ? '<span class="pr-pill ok">Delivered</span>'
    : '<span class="pr-pill crit">Failed</span>';
  const chan = l.channel.charAt(0).toUpperCase() + l.channel.slice(1);
  return '<div style="display:grid;grid-template-columns:1.1fr 1fr 1.3fr 0.9fr 0.9fr 1.1fr;gap:12px;align-items:center;padding:13px 22px;border-bottom:1px solid var(--border-soft)">' +
    '<span class="mono" style="font-size:12px;color:var(--muted)">' + date + ' ' + time + '</span>' +
    '<span class="mono" style="font-size:12px;color:var(--text-2)">' + esc(l.meterNo) + '</span>' +
    '<span style="font-size:13px;color:var(--text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(l.recipient) + '</span>' +
    '<span style="font-size:12.5px;color:var(--muted)">' + esc(chan) + '</span>' + typePill + statusPill + '</div>';
}
function renderLogs() {
  let h = '<div class="pr-statrow" style="--cols:4;margin-bottom:18px" id="logStats">' +
    statCard('Delivered · 24h', '…', 'across all channels', 'green') +
    statCard('Failed · 24h', '…', 'send errors', 'red') +
    statCard('Attempts · 24h', '…', 'total sends', '') +
    statCard('Success rate', '…', 'last 24 hours', 'gold') +
  '</div>';

  h += '<div class="pr-card" style="padding:8px 0"><div class="pr-section-head" style="padding:14px 22px;margin:0"><div style="font-size:14px;font-weight:700;color:var(--text)">Delivery attempts</div><span class="mono muted" style="font-size:12px">latest 40 · real</span></div>' +
    '<div class="pr-tableshell" style="overflow-x:auto"><div style="min-width:760px">' +
    '<div style="display:grid;grid-template-columns:1.1fr 1fr 1.3fr 0.9fr 0.9fr 1.1fr;gap:12px;padding:11px 22px;border-top:1px solid var(--border-soft);border-bottom:1px solid var(--border-soft)" class="mono">' +
    ['Time', 'Meter', 'Recipient', 'Channel', 'Type', 'Status'].map(c => '<span style="font-size:10.5px;text-transform:uppercase;letter-spacing:0.06em;color:var(--faint)">' + c + '</span>').join('') + '</div>' +
    '<div id="logRows"><div class="pr-empty" style="padding:24px 0">Loading…</div></div></div></div></div>';

  // real admin audit log
  h += '<div class="pr-card" style="margin-top:18px"><div class="pr-section-head"><span class="pr-card-title">Admin audit log</span><span class="mono muted" style="font-size:12px">operator actions</span></div><div id="auditBody"><div class="pr-empty">Loading…</div></div></div>';

  host.innerHTML = h;
  getJSON('/deliveries').then(d => {
    const total = d.delivered24h + d.failed24h;
    const rate = total > 0 ? Math.round((d.delivered24h / total) * 1000) / 10 + '%' : '—';
    const stats = host.querySelector('#logStats');
    if (stats) stats.innerHTML =
      statCard('Delivered · 24h', d.delivered24h.toLocaleString(), 'across all channels', 'green') +
      statCard('Failed · 24h', d.failed24h.toLocaleString(), 'send errors', d.failed24h > 0 ? 'red' : '') +
      statCard('Attempts · 24h', total.toLocaleString(), 'total sends', '') +
      statCard('Success rate', rate, 'last 24 hours', 'gold');
    const rows = host.querySelector('#logRows');
    if (rows) rows.innerHTML = d.rows.length ? d.rows.map(deliveryRow).join('') : '<div class="pr-empty" style="padding:24px 0">No alert deliveries yet.</div>';
  }).catch(() => {
    const rows = host.querySelector('#logRows'); if (rows) rows.innerHTML = '<div class="pr-empty" style="padding:24px 0">Could not load deliveries.</div>';
  });
  loadAudit();
}
async function loadAudit() {
  const box = host.querySelector('#auditBody'); if (!box) return;
  let data;
  try { data = await getJSON('/audit'); } catch (e) { box.innerHTML = '<div class="pr-empty">Could not load audit log.</div>'; return; }
  if (!data.entries.length) { box.innerHTML = '<div class="pr-empty">No operator actions logged yet.</div>'; return; }
  box.innerHTML = '<div class="pr-tableshell" style="overflow-x:auto"><table class="pr-table"><thead><tr><th>When</th><th>Action</th><th>Customer</th><th>Detail</th><th>IP</th></tr></thead><tbody>' +
    data.entries.map(e => '<tr><td class="mono muted">' + when(e.createdAt) + '</td><td>' + esc(e.action) + '</td><td>' + (e.targetUserId == null ? '—' : '#' + esc(e.targetUserId)) + '</td><td class="muted">' + esc(e.detail ?? '—') + '</td><td class="mono muted">' + esc(e.ip ?? '—') + '</td></tr>').join('') +
    '</tbody></table></div>';
}

// ---- router --------------------------------------------------------------
function renderScreen() {
  clearCharts();
  if (SCREEN === 'users') renderUsers();
  else if (SCREEN === 'logs') renderLogs();
  else renderRevenue();
}
function go(screen) {
  SCREEN = screen;
  if (location.hash !== '#' + screen) location.hash = screen;
  if (screen !== 'users') DETAIL = null;
  renderChrome();
  renderScreen();
  window.scrollTo(0, 0);
  setSidebar(false);
}
async function loadOverview() {
  OVERVIEW = await getJSON('/overview').catch(() => OVERVIEW);
  HEALTH = await fetch('/health').then(r => r.json()).catch(() => null);
  renderChrome();
}

// ---- chrome wiring -------------------------------------------------------
const sidebar = document.getElementById('pr-sidebar');
const scrim = document.getElementById('pr-scrim');
function setSidebar(open) { sidebar.dataset.open = open ? 'true' : 'false'; scrim.dataset.open = open ? 'true' : 'false'; }
document.getElementById('pr-hamburger').onclick = () => setSidebar(sidebar.dataset.open !== 'true');
scrim.onclick = () => setSidebar(false);
document.querySelectorAll('.pr-navbtn[data-screen]').forEach(btn => btn.onclick = () => go(btn.getAttribute('data-screen')));
window.addEventListener('hashchange', () => {
  const s = location.hash.slice(1);
  if (['revenue', 'users', 'logs'].includes(s) && s !== SCREEN) { SCREEN = s; if (s !== 'users') DETAIL = null; renderChrome(); renderScreen(); }
});
document.getElementById('refreshBtn').onclick = async () => {
  const icon = document.getElementById('refreshIcon');
  icon.classList.add('pr-spin');
  try { await loadOverview(); renderScreen(); } finally { icon.classList.remove('pr-spin'); }
};

const initial = location.hash.slice(1);
if (['users', 'logs'].includes(initial)) SCREEN = initial;
(async () => { await loadOverview(); renderScreen(); })().catch(() => { host.innerHTML = '<div class="pr-card pr-empty">Something broke. Reload the page.</div>'; });
</script>`;

  return pageDoc('Power Roast — Admin', body);
}
