// Operator admin panel: the password login screen and the signed-in console.
// Both share the Power·Roast design system (theme.ts). The console is one
// document with four client-routed screens (Revenue & health, Users & meters,
// Delivery logs, Audit trail) that talk to /admin/api/*. The statCard helper
// still takes a `sample` flag for cases we haven't wired to the backend yet,
// but every screen here currently renders live data: aggregates (MRR / ARPU /
// churn), the searchable user table, the per-user detail drawer (grant /
// pause / erase, balance charts, alerts, payments), per-send delivery logs,
// and ops controls (poll now, dead-letter requeue). Mutations echo the CSRF
// token from the page.

import { pageDoc, logo, CHART_SCRIPT, CLIENT_HELPERS } from './theme';
import { CLIENT_PARSE_HASH } from './admin-hash';

const ADMIN_BADGE = `<span class="pr-pill low" style="font-size:10px;padding:3px 9px">admin</span>`;

export function adminLoginHtml(
  nonce: string,
  hasError: boolean,
  message = 'Wrong password.'
): string {
  const err = hasError ? message : '';
  const body = `<div style="position:relative; z-index:1; min-height:100vh; display:grid; place-items:center; padding:32px 20px;">
  <div class="pr-authpanel" style="width:100%">
    <div style="display:flex; justify-content:center; gap:10px; align-items:center; margin-bottom:22px;">${logo(true)} ${ADMIN_BADGE}</div>
    <form class="pr-formcard" method="POST" action="/admin/login" style="max-width:380px">
      <div style="font-size:20px; font-weight:800; color:var(--text); letter-spacing:-0.02em; margin-bottom:4px;">Operator sign-in</div>
      <p class="muted" style="font-size:13px; margin-bottom:18px;">This console holds customer PII. Sign in to continue.</p>
      <label class="pr-label" for="pw">Admin password</label>
      <div style="position:relative;margin-bottom:16px">
        <input class="pr-input" id="pw" type="password" name="password" aria-label="Admin password" placeholder="••••••••" autofocus required style="margin:0;padding-right:56px">
        <button type="button" id="pwToggle" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:0;color:var(--muted);font-size:12px;cursor:pointer;padding:4px 8px">Show</button>
      </div>
      <button class="pr-btn gold block" type="submit">Sign in</button>
      <p class="pr-err" style="margin-top:12px">${err}</p>
    </form>
  </div>
</div>
<script nonce="${nonce}">
document.getElementById('pwToggle').addEventListener('click', function () {
  var p = document.getElementById('pw');
  var show = p.type === 'password';
  p.type = show ? 'text' : 'password';
  this.textContent = show ? 'Hide' : 'Show';
});
</script>`;
  return pageDoc('Power Roast Admin', body);
}

const AIC = {
  revenue:
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"></path><path d="m19 9-5 5-4-4-3 3"></path></svg>',
  users:
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.9"></path></svg>',
  logs: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v16H4z"></path><path d="M8 8h8M8 12h8M8 16h5"></path></svg>',
};

export function adminAppHtml(nonce: string, csrf: string, billingLive = true): string {
  // During a free-only launch there's no money to report, so the landing
  // screen leads with usage + ops instead of an all-zero revenue board.
  const homeLabel = billingLive ? 'Revenue &amp; health' : 'Ops &amp; health';
  const body = `<div class="pr-shell">
  <div id="pr-scrim"></div>
  <aside class="pr-sidebar" id="pr-sidebar">
    <div style="display:flex;align-items:center;gap:9px;padding:6px 8px 22px">${logo()} ${ADMIN_BADGE}</div>
    <nav class="pr-nav">
      <div class="pr-nav-label">Operator</div>
      <button class="pr-navbtn active" type="button" data-screen="revenue">${AIC.revenue}${homeLabel}</button>
      <button class="pr-navbtn" type="button" data-screen="users">${AIC.users}Users &amp; meters</button>
      <button class="pr-navbtn" type="button" data-screen="logs">${AIC.logs}Delivery logs</button>
      <button class="pr-navbtn" type="button" data-screen="audit">${AIC.logs}Audit trail</button>
    </nav>
    <div class="pr-side-foot">
      <a class="pr-navbtn" href="/app" style="border:1px solid var(--border);background:rgba(255,255,255,0.03);font-size:13px;gap:11px"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#34D399" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"></path></svg>Back to my dashboard</a>
      <div class="pr-user">
        <span class="pr-avatar">⚡</span>
        <div class="who"><div class="n">Operator</div><div class="m">admin console</div></div>
        <form method="POST" action="/admin/logout" style="margin:0"><input type="hidden" name="csrf" value="${csrf}"><button class="pr-iconbtn" type="submit" title="Sign out"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><path d="m16 17 5-5-5-5M21 12H9"></path></svg></button></form>
      </div>
    </div>
  </aside>

  <div class="pr-main">
    <header class="pr-topbar">
      <button id="pr-hamburger" type="button"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M3 12h18M3 18h18"></path></svg></button>
      <div class="titles"><div class="t" id="topTitle">${homeLabel}</div><div class="s" id="topSub">operator console, everything is fine, mostly</div></div>
      <button class="pr-btn gold" id="refreshBtn" type="button"><svg id="refreshIcon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1a1408" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"></path></svg><span>Refresh</span></button>
    </header>
    <main class="pr-content"><div id="host"><div class="pr-card pr-empty">Loading...</div></div></main>
  </div>
</div>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
<script nonce="${nonce}">
const CSRF = ${JSON.stringify(csrf)};
const BILLING_LIVE = ${JSON.stringify(billingLive)};
${CLIENT_HELPERS}
${CHART_SCRIPT}

let SCREEN = 'revenue', page = 0, query = '', OVERVIEW = null, HEALTH = null, DETAIL = null, auditPage = 0, filter = 'all', logStatus = 'all', logChannel = 'all', logPage = 0;
let CHARTS = [];
const host = document.getElementById('host');

async function api(path, opts) {
  const res = await fetch('/admin/api' + path, opts);
  if (res.status === 401) { location.href = '/admin'; throw new Error('signed out'); }
  return res;
}
async function getJSON(path) { const r = await api(path); if (!r.ok) throw new Error(await r.text()); return r.json(); }
async function postAdmin(path, body) {
  const r = await api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
  return data;
}
async function action(id, verb, body) {
  return postAdmin('/users/' + id + '/' + verb, body);
}
async function meterAction(id, meterId, verb) {
  return postAdmin('/users/' + id + '/meters/' + meterId + '/' + verb);
}
function clearCharts() { CHARTS.forEach(c => { try { c.destroy(); } catch (e) {} }); CHARTS = []; }
// Styled stand-in for confirm()/prompt(): resolves true on confirm. With
// requireText set, the confirm button stays disabled until it's typed exactly.
function prModal(opts) {
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:80;background:rgba(10,8,4,0.72);display:grid;place-items:center;padding:20px';
    ov.innerHTML = '<div class="pr-card" style="max-width:430px;width:100%" role="dialog" aria-modal="true">' +
      '<div style="font-size:15px;font-weight:800;color:var(--text);margin-bottom:8px">' + esc(opts.title) + '</div>' +
      '<p class="muted" style="font-size:13px;line-height:1.55;margin:0 0 14px">' + esc(opts.body) + '</p>' +
      (opts.requireText ? '<input class="pr-input mono" id="prModalInput" placeholder="Type ' + esc(opts.requireText) + ' to confirm" autocomplete="off" style="margin-bottom:12px">' : '') +
      '<div class="row" style="justify-content:flex-end;gap:8px">' +
        '<button class="pr-btn ghost" type="button" id="prModalCancel">Cancel</button>' +
        '<button class="pr-btn ' + (opts.danger ? 'danger' : 'gold') + '" type="button" id="prModalOk"' + (opts.requireText ? ' disabled' : '') + '>' + esc(opts.confirmLabel || 'Confirm') + '</button>' +
      '</div></div>';
    document.body.appendChild(ov);
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
    function done(v) { document.removeEventListener('keydown', onKey, true); ov.remove(); resolve(v); }
    document.addEventListener('keydown', onKey, true);
    const ok = ov.querySelector('#prModalOk');
    const input = ov.querySelector('#prModalInput');
    ov.querySelector('#prModalCancel').onclick = () => done(false);
    ov.onclick = e => { if (e.target === ov) done(false); };
    ok.onclick = () => done(true);
    if (input) {
      input.focus();
      input.oninput = () => { ok.disabled = input.value.trim() !== opts.requireText; };
      input.onkeydown = e => { if (e.key === 'Enter' && !ok.disabled) done(true); };
    } else { ok.focus(); }
  });
}
function planPill(plan) { return '<span class="pr-pill ' + (plan === 'free' ? '' : 'low') + '">' + esc(plan) + '</span>'; }
function copyChip(label, value) { return '<button class="pr-btn ghost sm copyBtn" type="button" data-copy="' + esc(value) + '">' + label + '</button>'; }
function balanceClass(m) { return m.balance === null ? 'muted' : m.balance < m.criticalThreshold ? 'critical' : m.balance < m.lowThreshold ? 'low' : 'ok'; }

// ---- chrome --------------------------------------------------------------
const TITLES = {
  revenue: [BILLING_LIVE ? 'Revenue & health' : 'Ops & health', 'operator console, everything is fine, mostly'],
  users: ['Users & meters', null],
  logs: ['Delivery logs', 'alert delivery, last 24 hours'],
  audit: ['Audit trail', 'every operator action, newest first'],
};
function renderChrome() {
  document.querySelectorAll('.pr-navbtn[data-screen]').forEach(b => b.classList.toggle('active', b.getAttribute('data-screen') === SCREEN));
  let title = TITLES[SCREEN][0], sub = TITLES[SCREEN][1];
  if (SCREEN === 'users' && OVERVIEW) sub = OVERVIEW.users.toLocaleString() + ' users, ' + OVERVIEW.activeMeters.toLocaleString() + ' meters tracked';
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
    '<circle cx="' + x(n - 1).toFixed(0) + '" cy="' + y(last.total).toFixed(0) + '" r="5" fill="#34D399" stroke="#171410" stroke-width="2"></circle></svg>' +
    '<div style="display:flex;justify-content:space-between;margin-top:8px" class="mono"><span style="font-size:11px;color:var(--faint)">' + esc(series[0].month) + '</span><span style="font-size:11px;color:var(--green)">' + esc(last.month) + '</span></div>';
}
function revPayments(payments) {
  if (!payments.length) return '<div class="pr-empty" style="padding:18px 0">No payments yet.</div>';
  return '<div class="pr-list">' + payments.map(p =>
    '<div class="pr-rowitem"><span class="pr-chan-ic" style="background:rgba(255,255,255,0.05);font-family:var(--mono);font-size:10px;font-weight:700;color:var(--muted)">' + esc(String(p.provider).slice(0, 4)) + '</span>' +
    '<div style="flex:1;min-width:0"><div style="font-size:13.5px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(p.user) + '</div><div class="mono" style="font-size:11px;color:var(--faint)">' + esc(p.plan) + ', ' + when(p.createdAt) + '</div></div>' +
    '<div style="font-size:14px;font-weight:800;color:var(--green)">' + fmt(p.amountBdt) + '</div></div>'
  ).join('') + '</div>';
}
function renderRevenue() {
  const o = OVERVIEW || {};
  const poll = o.poll || {};

  const descoRow = healthRow('DESCO prepaid API', HEALTH ? ('last poll ' + relWhen(HEALTH.lastPollCycleAt)) : 'status unknown', HEALTH ? (HEALTH.status === 'ok' ? 'Operational' : 'Stale') : 'n/a', HEALTH ? (HEALTH.status === 'ok' ? '#34D399' : '#FBB024') : '#837a68');
  const pollRows =
    healthRow('Last completed', poll.lastCycleAt ? relWhen(poll.lastCycleAt) : 'never', poll.overdue ? 'Overdue' : (poll.running ? 'Running' : 'OK'), poll.overdue ? '#FF5247' : (poll.running ? '#FBB024' : '#34D399')) +
    healthRow('Interval', 'configured', (poll.intervalHours ?? '?') + 'h', '#8FA8FF');
  const deadCard = '<div class="pr-card" style="padding:20px"><div class="pr-section-head" style="margin-bottom:12px"><span class="pr-card-title">Dead letters</span><button class="pr-btn ghost sm" id="requeueAll" type="button">Requeue all</button></div><div id="deadBody"><div class="pr-empty" style="padding:12px 0">Loading...</div></div></div>';

  let h;
  if (BILLING_LIVE) {
    const free = Math.max(0, (o.users || 0) - (o.activeSubscriptions || 0));
    h = '<div class="pr-statrow" style="--cols:4;margin-bottom:18px">' +
      statCard('MRR', fmt(o.mrr ?? 0), 'monthly recurring', '') +
      statCard('Paid subscribers', String(o.activeSubscriptions ?? 0), free.toLocaleString() + ' on free / self-host', '') +
      statCard('ARPU', fmt(o.arpu ?? 0), 'per paid / month', '') +
      statCard('Churn', (o.churnPct ?? 0) + '%', 'last 30 days', (o.churnPct ?? 0) > 5 ? 'red' : 'gold') +
    '</div>';

    h += '<div class="pr-grid pr-2col">' +
      '<div class="pr-card"><div class="pr-section-head" style="margin-bottom:14px"><div><div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:3px">Monthly recurring revenue</div><div class="mono" style="font-size:12px;color:var(--faint)">last 12 months, collected, BDT</div></div><span class="mono" style="font-size:12px;font-weight:700;color:var(--green)">' + fmt(o.totalPaidBdt ?? 0) + ' all-time</span></div>' +
        '<div id="mrrChart"><div class="pr-empty" style="padding:48px 0">Loading...</div></div></div>' +
      '<div class="pr-card" style="padding:20px"><div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:12px">System health</div><div class="pr-list">' +
        descoRow +
        healthRow('Alerts sent', 'rolling 24 hours', (o.alerts24h ?? 0) + ' / 24h', '#34D399') +
        healthRow('Readings stored', 'all-time data points', (o.readings ?? 0).toLocaleString(), '#8FA8FF') +
        healthRow('Past-due subscriptions', 'active but period ended', String(o.pastDue ?? 0), (o.pastDue ?? 0) > 0 ? '#FF8077' : '#34D399') +
      '</div></div></div>';

    h += '<div class="pr-grid pr-2col" style="margin-top:18px">' +
      '<div class="pr-card" style="padding:20px"><div class="pr-section-head" style="margin-bottom:12px"><span class="pr-card-title">Poll cycle</span><button class="pr-btn ghost sm" id="pollBtn" type="button">Run now</button></div><div class="pr-list">' + pollRows +
      '</div><p class="mono muted" id="pollMsg" style="font-size:12px;margin-top:8px"></p></div>' +
      deadCard +
    '</div>';

    h += '<div class="pr-card" style="margin-top:18px"><div class="pr-section-head" style="margin-bottom:8px"><span class="pr-card-title">Recent payments</span><span class="mono muted" style="font-size:12px">latest first</span></div>' +
      '<div id="payFeed"><div class="pr-empty" style="padding:18px 0">Loading...</div></div></div>';
  } else {
    // free-only launch: no revenue to stare at - usage stats up top, then one
    // ops card (health + poll) beside the dead-letter queue.
    h = '<div class="pr-statrow" style="--cols:4;margin-bottom:18px">' +
      statCard('Users', (o.users ?? 0).toLocaleString(), '', '') +
      statCard('Meters tracked', (o.activeMeters ?? 0).toLocaleString(), '', '') +
      statCard('Alerts sent', String(o.alerts24h ?? 0), 'last 24 hours', 'gold') +
      statCard('Readings stored', (o.readings ?? 0).toLocaleString(), 'all-time data points', '') +
    '</div>';

    h += '<div class="pr-grid pr-2col">' +
      '<div class="pr-card" style="padding:20px"><div class="pr-section-head" style="margin-bottom:12px"><span class="pr-card-title">System health</span><button class="pr-btn ghost sm" id="pollBtn" type="button">Run poll now</button></div><div class="pr-list">' +
        descoRow + pollRows +
      '</div><p class="mono muted" id="pollMsg" style="font-size:12px;margin-top:8px"></p></div>' +
      deadCard +
    '</div>';
  }

  host.innerHTML = h;
  if (BILLING_LIVE) getJSON('/revenue').then(rev => {
    const c = host.querySelector('#mrrChart'); if (c) c.innerHTML = mrrSvg(rev.mrrSeries);
    const f = host.querySelector('#payFeed'); if (f) f.innerHTML = revPayments(rev.payments);
  }).catch(() => {});
  const pollMsg = host.querySelector('#pollMsg');
  host.querySelector('#pollBtn').onclick = async () => {
    pollMsg.textContent = 'starting...';
    try { const r = await postAdmin('/poll'); pollMsg.textContent = r.alreadyRunning ? 'A cycle is already running.' : 'Poll cycle started.'; } catch (e) { pollMsg.textContent = e.message; }
  };
  host.querySelector('#requeueAll').onclick = async () => {
    try { await postAdmin('/alerts/requeue-all'); loadDeadLetters(); } catch (e) { const b = host.querySelector('#deadBody'); if (b) b.innerHTML = '<div class="pr-empty" style="padding:12px 0">' + esc(e.message) + '</div>'; }
  };
  loadDeadLetters();
}
async function loadDeadLetters() {
  const box = host.querySelector('#deadBody'); if (!box) return;
  let d;
  try { d = await getJSON('/deadletters'); } catch (e) { box.innerHTML = '<div class="pr-empty" style="padding:12px 0">Could not load.</div>'; return; }
  if (!d.rows.length) { box.innerHTML = '<div class="pr-empty" style="padding:12px 0">No dead letters in the last 24h ✓</div>'; return; }
  box.innerHTML = '<div class="pr-list">' + d.rows.map(r =>
    '<div class="pr-rowitem"><div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:600;color:var(--text)">' + esc(r.action) + ', ' + esc(r.level) + '</div><div class="mono" style="font-size:11px;color:var(--faint)">' + relWhen(r.createdAt) + ', ' + r.attempts + ' tries, ' + esc(r.lastError ?? 'no error') + '</div></div>' +
    '<button class="pr-btn ghost sm dlq" type="button" data-id="' + r.id + '">Requeue</button></div>'
  ).join('') + '</div>';
  box.querySelectorAll('.dlq').forEach(b => b.onclick = async () => {
    try { await postAdmin('/alerts/' + b.dataset.id + '/requeue'); loadDeadLetters(); } catch (e) { box.innerHTML = '<div class="pr-empty" style="padding:12px 0">' + esc(e.message) + '</div>'; }
  });
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
    statCard('Past due', String(o.pastDue ?? 0), 'active plans lapsed', o.pastDue ? 'red' : '') +
  '</div>';
  const chip = (key, label) => '<button class="pr-btn ' + (filter === key ? '' : 'ghost') + ' sm chip" type="button" data-filter="' + key + '">' + label + '</button>';
  h += '<div class="pr-card" style="padding:8px 0">' +
    '<div class="row" style="padding:14px 22px 6px;gap:12px"><input id="q" class="pr-input" type="text" placeholder="Search email, chat id, meter/account no, or nickname..." value="' + esc(query) + '" style="flex:1;min-width:200px"><button id="searchBtn" class="pr-btn" type="button">Search</button></div>' +
    '<div class="row" style="padding:0 22px 12px;gap:8px">' + chip('all', 'All') + chip('paid', 'Paid') + chip('pastdue', 'Past due') + chip('stale', 'Stale') + '</div>' +
    '<div id="list" style="padding:0 8px"><div class="pr-empty">Loading...</div></div>' +
    '<div class="row" style="padding:12px 22px"><button id="prev" class="pr-btn ghost sm" type="button">‹ Prev</button><span id="pageLabel" class="mono muted" style="font-size:12px"></span><button id="next" class="pr-btn ghost sm" type="button">Next ›</button></div>' +
  '</div><div id="detailHost"></div>';
  host.innerHTML = h;
  host.querySelector('#searchBtn').onclick = () => { query = host.querySelector('#q').value.trim(); page = 0; loadList(); };
  host.querySelector('#q').addEventListener('keydown', e => { if (e.key === 'Enter') host.querySelector('#searchBtn').click(); });
  host.querySelectorAll('.chip').forEach(c => c.onclick = () => { filter = c.dataset.filter; page = 0; renderUsers(); });
  host.querySelector('#prev').onclick = () => { if (page > 0) { page--; loadList(); } };
  host.querySelector('#next').onclick = () => { page++; loadList(); };
  loadList();
  if (DETAIL) openDetail(DETAIL);
}
// green fresh / amber late / red stale-or-never, from the last reading time
function dotFor(lastReadingAt) {
  if (!lastReadingAt) return '#FF5247';
  const hrs = (Date.now() - new Date(lastReadingAt).getTime()) / 3600000;
  return hrs < 12 ? '#34D399' : hrs < 36 ? '#FBB024' : '#FF5247';
}
async function loadList() {
  const box = host.querySelector('#list'); if (!box) return;
  let data;
  try { data = await getJSON('/users?page=' + page + '&filter=' + filter + '&q=' + encodeURIComponent(query)); }
  catch (e) { box.innerHTML = '<div class="pr-empty">Could not load users.</div>'; return; }
  if (!data.users.length) { box.innerHTML = '<div class="pr-empty">No users found.</div>'; }
  else {
    box.innerHTML = '<div class="pr-tableshell" style="overflow-x:auto"><div style="min-width:680px">' +
      '<div style="display:grid;grid-template-columns:2fr 0.8fr 1.1fr 1fr 1fr;gap:12px;padding:11px 14px;border-bottom:1px solid var(--border-soft)" class="mono"><span style="font-size:10.5px;text-transform:uppercase;letter-spacing:0.06em;color:var(--faint)">User</span><span style="font-size:10.5px;text-transform:uppercase;letter-spacing:0.06em;color:var(--faint)">Meters</span><span style="font-size:10.5px;text-transform:uppercase;letter-spacing:0.06em;color:var(--faint)">Plan</span><span style="font-size:10.5px;text-transform:uppercase;letter-spacing:0.06em;color:var(--faint)">Last reading</span><span style="font-size:10.5px;text-transform:uppercase;letter-spacing:0.06em;color:var(--faint)">Status</span></div>' +
      data.users.map(u => {
        const initial = (u.email || '?').charAt(0).toUpperCase();
        const handle = u.telegramChatId ? ('chat ' + u.telegramChatId) : u.discordUserId ? ('discord ' + u.discordUserId) : 'no chat linked';
        const status = u.plan === 'free' ? '<span class="pr-pill">Free</span>' : '<span class="pr-pill ok">Active</span>';
        return '<div class="pr-rowitem userRow" data-id="' + u.id + '" style="display:grid;grid-template-columns:2fr 0.8fr 1.1fr 1fr 1fr;gap:12px;align-items:center;padding:13px 14px;cursor:pointer">' +
          '<div style="display:flex;align-items:center;gap:11px;min-width:0"><span class="pr-avatar" style="width:30px;height:30px;font-size:12px">' + initial + '</span><div style="min-width:0"><div style="font-size:13.5px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(u.email || 'no email') + '</div><div class="mono" style="font-size:11px;color:var(--faint)">' + esc(handle) + '</div></div></div>' +
          '<span class="mono" style="font-size:13px;color:var(--text-2)">' + u.activeMeters + '</span>' +
          '<span style="font-size:13px">' + planPill(u.plan) + '</span>' +
          '<span class="mono muted" style="font-size:12px;display:inline-flex;align-items:center;gap:7px"><span style="width:8px;height:8px;border-radius:50%;flex:none;background:' + dotFor(u.lastReadingAt) + '"></span>' + relWhen(u.lastReadingAt) + '</span>' +
          '<span>' + status + '</span></div>';
      }).join('') + '</div></div>';
    box.querySelectorAll('.userRow').forEach(tr => tr.onclick = () => openDetail(tr.dataset.id));
  }
  const totalTxt = typeof data.total === 'number' ? ' · ' + data.total.toLocaleString() + ' users' : '';
  host.querySelector('#pageLabel').textContent = 'page ' + (page + 1) + totalTxt;
  host.querySelector('#prev').disabled = page === 0;
  host.querySelector('#next').disabled = !data.hasMore;
}

async function openDetail(id) {
  DETAIL = id;
  // keep the URL shareable without re-triggering the router
  if (location.hash !== '#user/' + id) history.replaceState(null, '', '#user/' + id);
  clearCharts();
  const d = await getJSON('/users/' + id);
  const det = host.querySelector('#detailHost'); if (!det) return;
  const u = d.user;
  const sub = d.subscription
    ? esc(d.subscription.plan) + ', ' + esc(d.subscription.status) + ', via ' + esc(d.subscription.provider) + (d.subscription.currentPeriodEnd ? ', until ' + when(d.subscription.currentPeriodEnd) : '')
    : 'none (free)';

  det.innerHTML =
    '<div class="pr-card" style="margin-top:18px"><div class="pr-section-head" style="margin-bottom:10px">' +
      '<div style="display:flex;align-items:center;gap:10px"><span class="pr-card-title">' + esc(u.email || ('Customer #' + u.id)) + '</span>' + planPill(u.plan) + '</div>' +
      '<button class="pr-btn ghost sm" type="button" id="closeDetail">Close</button></div>' +
      '<p class="muted" style="font-size:13px" title="' + esc(when(u.createdAt)) + '">#' + u.id + ', ' + esc([u.telegramChatId != null ? 'chat ' + u.telegramChatId : null, u.discordUserId ? 'discord ' + u.discordUserId : null].filter(Boolean).join(', ') || 'no chat linked') + ', joined ' + relWhen(u.createdAt) + ', tone ' + esc(u.tonePref) + '</p>' +
      // t.me can't deep-link a bot *to* a user, so we offer copy buttons, not links
      '<div class="row" style="gap:6px;margin-top:6px;flex-wrap:wrap">' +
        (u.email ? copyChip('Copy email', u.email) : '') +
        (u.telegramChatId != null ? copyChip('Copy chat id', String(u.telegramChatId)) : '') +
        (u.discordUserId ? copyChip('Copy discord id', u.discordUserId) : '') +
      '</div>' +
      '<p class="muted" style="font-size:13px;margin-top:8px">Subscription: ' + sub + ', meter cap ' + esc(d.limits.maxMeters) + ', SMS ' + esc(d.limits.smsPerMonth) + '/mo</p>' +
      '<div class="row" style="margin-top:14px;gap:10px;flex-wrap:wrap">' +
        '<select id="grantPlan" class="pr-input" aria-label="Plan to grant" style="width:auto;min-width:120px"><option value="plus">plus</option><option value="business">business</option></select>' +
        '<input id="grantDays" class="pr-input mono" type="text" value="30" style="width:70px" aria-label="Days" title="days">' +
        '<button class="pr-btn ghost sm" type="button" data-days="30">30</button>' +
        '<button class="pr-btn ghost sm" type="button" data-days="90">90</button>' +
        '<button class="pr-btn ghost sm" type="button" data-days="365">365</button>' +
        '<button class="pr-btn gold" type="button" id="grantBtn">Grant plan</button>' +
        (d.subscription ? '<button class="pr-btn ghost" type="button" id="revokeBtn">Revoke plan</button>' : '') +
        '<button class="pr-btn ghost" type="button" id="pauseBtn">Pause monitoring</button>' +
        '<button class="pr-btn danger" type="button" id="eraseBtn">Erase customer</button>' +
      '</div>' +
      '<input id="grantReason" class="pr-input" type="text" placeholder="Reason for grant (optional, saved to the audit log)" style="margin-top:8px">' +
      '<p class="pr-err" id="detailErr" style="margin-top:8px"></p></div>';

  for (let i = 0; i < d.active.meters.length; i++) {
    const m = d.active.meters[i];
    const card = document.createElement('div');
    card.className = 'pr-card';
    card.style.marginTop = '18px';
    card.innerHTML =
      '<div class="pr-section-head" style="margin-bottom:4px"><div style="min-width:0"><span style="font-weight:700;color:var(--text)">' + esc(m.label) + '</span>' +
        '<div class="mono" style="font-size:11.5px;color:var(--faint);margin-top:2px">acct ' + esc(m.accountNo) + ', meter ' + esc(m.meterNo) + '</div></div>' +
        '<div class="balance ' + balanceClass(m) + '" style="font-size:20px;font-weight:800">' + fmt(m.balance) + '</div></div>' +
      (m.prediction ? '<div class="mono" style="font-size:11.5px;color:var(--faint)">~' + m.prediction.daysLeft.toFixed(1) + ' days left, ' + fmt(m.prediction.burnPerDay) + '/day</div>' : '') +
      '<div class="row" style="gap:8px;margin:10px 0;flex-wrap:wrap"><button class="pr-btn ghost sm mRecheck" type="button" data-mid="' + m.id + '">🔄 Re-check</button><button class="pr-btn ghost sm mPause" type="button" data-mid="' + m.id + '">Pause</button>' + copyChip('Copy acct', m.accountNo) + copyChip('Copy meter', m.meterNo) + '<span class="mono muted mMsg" style="font-size:11.5px"></span></div>' +
      '<div class="pr-chart sm"><canvas></canvas></div>';
    det.appendChild(card);
    CHARTS.push(window.prChart(card.querySelector('canvas'), m.readings, { low: m.lowThreshold, critical: m.criticalThreshold }));
    const mid = m.id, msg = card.querySelector('.mMsg');
    card.querySelector('.mRecheck').onclick = async () => {
      msg.textContent = 'checking...';
      try { const r = await meterAction(u.id, mid, 'recheck'); msg.textContent = 'now ' + fmt(r.balance); } catch (e) { msg.textContent = e.message; }
    };
    card.querySelector('.mPause').onclick = async () => {
      try { await meterAction(u.id, mid, 'pause'); await openDetail(u.id); await loadList(); } catch (e) { msg.textContent = e.message; }
    };
  }
  if (d.pausedMeters.length) {
    const c = document.createElement('div'); c.className = 'pr-card'; c.style.marginTop = '18px';
    c.innerHTML = '<div class="pr-section-head" style="margin-bottom:6px"><span class="mono" style="font-weight:700;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:0.06em">Paused meters</span><button class="pr-btn ghost sm" type="button" id="resumeAll">Resume all</button></div>' +
      d.pausedMeters.map(m => '<div class="row" style="justify-content:space-between;gap:10px;padding:4px 0"><span class="muted" style="font-size:13px">' + esc(m.nickname ?? m.meterNo) + ', acct ' + esc(m.accountNo) + '</span><button class="pr-btn ghost sm pResume" type="button" data-mid="' + m.id + '">Resume</button></div>').join('') +
      '<p class="pr-err pMsg" style="margin-top:6px"></p>';
    det.appendChild(c);
    const pMsg = c.querySelector('.pMsg');
    c.querySelector('#resumeAll').onclick = async () => {
      try { const r = await action(u.id, 'resume'); if (r.stillPaused) pMsg.textContent = r.stillPaused + ' meter(s) stayed paused (plan cap full).'; await openDetail(u.id); await loadList(); } catch (e) { pMsg.textContent = e.message; }
    };
    c.querySelectorAll('.pResume').forEach(b => b.onclick = async () => {
      try { await meterAction(u.id, b.dataset.mid, 'resume'); await openDetail(u.id); await loadList(); } catch (e) { pMsg.textContent = e.message; }
    });
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
  host.querySelector('#closeDetail').onclick = () => { DETAIL = null; det.innerHTML = ''; history.replaceState(null, '', '#users'); };
  det.querySelectorAll('[data-days]').forEach(b => b.onclick = () => { host.querySelector('#grantDays').value = b.dataset.days; });
  host.querySelector('#grantBtn').onclick = async () => {
    err.textContent = '';
    try { await action(u.id, 'grant', { plan: host.querySelector('#grantPlan').value, days: Number(host.querySelector('#grantDays').value), reason: host.querySelector('#grantReason').value }); await loadOverview(); await openDetail(u.id); } catch (e) { err.textContent = e.message; }
  };
  const revokeBtn = host.querySelector('#revokeBtn');
  if (revokeBtn) revokeBtn.onclick = async () => {
    if (!(await prModal({ title: 'Revoke plan', body: 'Cancel this customer\\'s plan and drop them to free? Meters beyond the free cap will be paused.', confirmLabel: 'Revoke plan', danger: true }))) return;
    err.textContent = '';
    try { await action(u.id, 'revoke'); await loadOverview(); await openDetail(u.id); await loadList(); } catch (e) { err.textContent = e.message; }
  };
  host.querySelector('#pauseBtn').onclick = async () => {
    if (!(await prModal({ title: 'Pause monitoring', body: 'Pause monitoring for every meter this customer has?', confirmLabel: 'Pause all meters' }))) return;
    err.textContent = '';
    try { await action(u.id, 'pause'); await openDetail(u.id); await loadList(); } catch (e) { err.textContent = e.message; }
  };
  host.querySelector('#eraseBtn').onclick = async () => {
    const im = d.impact || { meters: 0, readings: 0, payments: 0 };
    if (!(await prModal({ title: 'Erase customer #' + u.id, body: 'This permanently erases ' + im.meters + ' meter(s), ' + im.readings + ' reading(s), and ' + im.payments + ' payment record(s). No undo.', confirmLabel: 'Erase forever', danger: true, requireText: 'ERASE' }))) return;
    err.textContent = '';
    try { await action(u.id, 'erase'); DETAIL = null; det.innerHTML = ''; history.replaceState(null, '', '#users'); await loadOverview(); await loadList(); renderChrome(); } catch (e) { err.textContent = e.message; }
  };
  // copy buttons (header + meter cards), wired after everything is in the DOM
  det.querySelectorAll('.copyBtn').forEach(b => b.onclick = () => {
    if (navigator.clipboard) navigator.clipboard.writeText(b.dataset.copy);
    const orig = b.textContent; b.textContent = 'Copied ✓'; setTimeout(() => { b.textContent = orig; }, 1200);
  });
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
  const chan = l.channel === 'discord-dm' ? 'Discord DM' : l.channel.charAt(0).toUpperCase() + l.channel.slice(1);
  return '<div style="display:grid;grid-template-columns:1.1fr 1fr 1.3fr 0.9fr 0.9fr 1.1fr;gap:12px;align-items:center;padding:13px 22px;border-bottom:1px solid var(--border-soft)">' +
    '<span class="mono" style="font-size:12px;color:var(--muted)">' + date + ' ' + time + '</span>' +
    '<span class="mono" style="font-size:12px;color:var(--text-2)">' + esc(l.meterNo) + '</span>' +
    '<span style="font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + (l.userId != null ? '<a href="#users" class="logUser" data-uid="' + l.userId + '" style="color:var(--gold)">' + esc(l.recipient) + '</a>' : esc(l.recipient)) + '</span>' +
    '<span style="font-size:12.5px;color:var(--muted)">' + esc(chan) + '</span>' + typePill + statusPill + '</div>';
}
function renderLogs() {
  let h = '<div class="pr-statrow" style="--cols:4;margin-bottom:18px" id="logStats">' +
    statCard('Delivered, 24h', '...', 'across all channels', 'green') +
    statCard('Failed, 24h', '...', 'send errors', 'red') +
    statCard('Attempts, 24h', '...', 'total sends', '') +
    statCard('Success rate', '...', 'last 24 hours', 'gold') +
  '</div>';

  const sChip = (key, label) => '<button class="pr-btn ' + (logStatus === key ? '' : 'ghost') + ' sm lchip" type="button" data-status="' + key + '">' + label + '</button>';
  const chOpt = (key, label) => '<option value="' + key + '"' + (logChannel === key ? ' selected' : '') + '>' + label + '</option>';
  h += '<div class="pr-card" style="padding:8px 0"><div class="pr-section-head" style="padding:14px 22px;margin:0"><div style="font-size:14px;font-weight:700;color:var(--text)">Delivery attempts</div><span class="mono muted" style="font-size:12px">newest first</span></div>' +
    '<div class="row" style="padding:0 22px 12px;gap:8px;flex-wrap:wrap">' + sChip('all', 'All') + sChip('sent', 'Sent') + sChip('failed', 'Failed') +
      '<select id="chanSel" class="pr-input sm" style="width:auto;min-width:130px">' + chOpt('all', 'All channels') + chOpt('telegram', 'Telegram') + chOpt('email', 'Email') + chOpt('sms', 'SMS') + chOpt('discord', 'Discord webhook') + chOpt('discord-dm', 'Discord DM') + '</select></div>' +
    '<div class="pr-tableshell" style="overflow-x:auto"><div style="min-width:760px">' +
    '<div style="display:grid;grid-template-columns:1.1fr 1fr 1.3fr 0.9fr 0.9fr 1.1fr;gap:12px;padding:11px 22px;border-top:1px solid var(--border-soft);border-bottom:1px solid var(--border-soft)" class="mono">' +
    ['Time', 'Meter', 'Recipient', 'Channel', 'Type', 'Status'].map(c => '<span style="font-size:10.5px;text-transform:uppercase;letter-spacing:0.06em;color:var(--faint)">' + c + '</span>').join('') + '</div>' +
    '<div id="logRows"><div class="pr-empty" style="padding:24px 0">Loading...</div></div></div></div>' +
    '<div class="row" style="padding:12px 22px"><button id="lPrev" class="pr-btn ghost sm" type="button">‹ Prev</button><span id="lPageLabel" class="mono muted" style="font-size:12px"></span><button id="lNext" class="pr-btn ghost sm" type="button">Next ›</button></div></div>';

  host.innerHTML = h;
  host.querySelectorAll('.lchip').forEach(c => c.onclick = () => { logStatus = c.dataset.status; logPage = 0; renderLogs(); });
  host.querySelector('#chanSel').onchange = e => { logChannel = e.target.value; logPage = 0; renderLogs(); };
  host.querySelector('#lPrev').onclick = () => { if (logPage > 0) { logPage--; loadDeliveries(); } };
  host.querySelector('#lNext').onclick = () => { logPage++; loadDeliveries(); };
  loadDeliveries();
}
async function loadDeliveries() {
  let d;
  try { d = await getJSON('/deliveries?status=' + logStatus + '&channel=' + logChannel + '&page=' + logPage); }
  catch (e) { const rows = host.querySelector('#logRows'); if (rows) rows.innerHTML = '<div class="pr-empty" style="padding:24px 0">Could not load deliveries.</div>'; return; }
  const total = d.delivered24h + d.failed24h;
  const rate = total > 0 ? Math.round((d.delivered24h / total) * 1000) / 10 + '%' : 'n/a';
  const stats = host.querySelector('#logStats');
  if (stats) stats.innerHTML =
    statCard('Delivered, 24h', d.delivered24h.toLocaleString(), 'across all channels', 'green') +
    statCard('Failed, 24h', d.failed24h.toLocaleString(), 'send errors', d.failed24h > 0 ? 'red' : '') +
    statCard('Attempts, 24h', total.toLocaleString(), 'total sends', '') +
    statCard('Success rate', rate, 'last 24 hours', 'gold');
  const rows = host.querySelector('#logRows');
  if (rows) {
    rows.innerHTML = d.rows.length ? d.rows.map(deliveryRow).join('') : '<div class="pr-empty" style="padding:24px 0">' + (logPage > 0 ? 'No more deliveries.' : 'No matching deliveries.') + '</div>';
    rows.querySelectorAll('.logUser').forEach(a => a.onclick = ev => { ev.preventDefault(); go('user/' + a.dataset.uid); });
  }
  const lPrev = host.querySelector('#lPrev'), lNext = host.querySelector('#lNext'), lLabel = host.querySelector('#lPageLabel');
  if (lPrev) lPrev.disabled = logPage === 0;
  if (lNext) lNext.disabled = !d.hasMore;
  if (lLabel) lLabel.textContent = 'page ' + (logPage + 1);
}

// ---- screen: audit trail -------------------------------------------------
function renderAudit() {
  host.innerHTML = '<div class="pr-card" style="padding:8px 0">' +
    '<div class="pr-section-head" style="padding:14px 22px;margin:0"><div style="font-size:14px;font-weight:700;color:var(--text)">Operator actions</div><span class="mono muted" style="font-size:12px">newest first</span></div>' +
    '<div id="auditBody"><div class="pr-empty" style="padding:24px 0">Loading...</div></div>' +
    '<div class="row" style="justify-content:flex-end;gap:8px;padding:12px 22px"><button id="aPrev" class="pr-btn" type="button">Prev</button><button id="aNext" class="pr-btn" type="button">Next</button></div>' +
    '</div>';
  host.querySelector('#aPrev').onclick = () => { if (auditPage > 0) { auditPage--; loadAudit(); } };
  host.querySelector('#aNext').onclick = () => { auditPage++; loadAudit(); };
  loadAudit();
}
async function loadAudit() {
  const box = host.querySelector('#auditBody'); if (!box) return;
  let data;
  try { data = await getJSON('/audit?page=' + auditPage); } catch (e) { box.innerHTML = '<div class="pr-empty" style="padding:24px 0">Could not load audit log.</div>'; return; }
  if (!data.entries.length) { box.innerHTML = '<div class="pr-empty" style="padding:24px 0">' + (auditPage > 0 ? 'No more entries.' : 'No operator actions logged yet.') + '</div>'; }
  else {
    box.innerHTML = '<div class="pr-tableshell" style="overflow-x:auto"><table class="pr-table"><thead><tr><th>When</th><th>Action</th><th>Customer</th><th>Detail</th><th>IP</th></tr></thead><tbody>' +
      data.entries.map(e => '<tr><td class="mono muted" title="' + esc(when(e.createdAt)) + '">' + relWhen(e.createdAt) + '</td><td>' + esc(e.action) + '</td><td>' + (e.targetUserId == null ? 'n/a' : '<a href="#users" class="auditUser" data-uid="' + esc(e.targetUserId) + '" style="color:var(--gold)">#' + esc(e.targetUserId) + '</a>') + '</td><td class="muted">' + esc(e.detail ?? 'n/a') + '</td><td class="mono muted">' + esc(e.ip ?? 'n/a') + '</td></tr>').join('') +
      '</tbody></table></div>';
    box.querySelectorAll('.auditUser').forEach(a => a.onclick = ev => { ev.preventDefault(); go('user/' + a.dataset.uid); });
  }
  const prev = host.querySelector('#aPrev'), next = host.querySelector('#aNext');
  if (prev) prev.disabled = auditPage === 0;
  if (next) next.disabled = !data.hasMore;
}

// ---- router --------------------------------------------------------------
function renderScreen() {
  clearCharts();
  if (SCREEN === 'users') renderUsers();
  else if (SCREEN === 'logs') renderLogs();
  else if (SCREEN === 'audit') renderAudit();
  else renderRevenue();
}
${CLIENT_PARSE_HASH}
function applyRoute(r) {
  SCREEN = r.screen; DETAIL = r.detail; query = r.query; logStatus = r.logStatus;
  if (r.screen === 'audit') auditPage = 0;
  if (r.screen === 'logs') logPage = 0;
  renderChrome(); renderScreen(); // renderUsers opens DETAIL when set
  window.scrollTo(0, 0);
}
function go(route) {
  setSidebar(false);
  if (('#' + route) === location.hash) applyRoute(parseHashClient(route));
  else location.hash = route; // triggers hashchange -> applyRoute
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
document.addEventListener('keydown', e => {
  const tag = (e.target && e.target.tagName) || '';
  if (e.key === '/' && tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA') {
    if (SCREEN !== 'users') go('users');
    setTimeout(() => { const q = host.querySelector('#q'); if (q) { q.focus(); } }, 0);
    e.preventDefault();
  } else if (e.key === 'Escape' && DETAIL) {
    const c = host.querySelector('#closeDetail'); if (c) c.click();
  }
});
window.addEventListener('hashchange', () => { applyRoute(parseHashClient(location.hash)); });
document.getElementById('refreshBtn').onclick = async () => {
  const icon = document.getElementById('refreshIcon');
  icon.classList.add('pr-spin');
  try { await loadOverview(); renderScreen(); } finally { icon.classList.remove('pr-spin'); }
};

const initialRoute = parseHashClient(location.hash);
SCREEN = initialRoute.screen; DETAIL = initialRoute.detail; query = initialRoute.query; logStatus = initialRoute.logStatus;
(async () => { await loadOverview(); renderScreen(); })().catch(() => { host.innerHTML = '<div class="pr-card pr-empty">Something broke. Reload the page.</div>'; });
</script>`;

  return pageDoc('Power Roast Admin', body);
}
