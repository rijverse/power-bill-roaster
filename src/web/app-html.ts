// Customer web app: the passwordless login screen and the signed-in shell.
// Both share the Power·Roast design system (see theme.ts). The shell is a single
// document that fetches /app/api/me once, then renders four client-routed screens
// (Dashboard, Meter, Alerts & thresholds, Billing) with vanilla JS. Real data
// drives everything that the backend supports; surfaces the API can't back yet
// (in-app recharge, paid plans, roast intensity, quiet hours) are reproduced
// faithfully but clearly marked as previews. Mutations echo the CSRF token.

import { DEFAULT_RECHARGE_URL } from '../core/recharge';
import { pageDoc, logo, CHART_SCRIPT, CLIENT_HELPERS } from './theme';

const LOGIN_STATUS: Record<string, { cls: string; msg: string }> = {
  sent: {
    cls: 'pr-good',
    msg: '✅ Check your inbox, we emailed you a sign-in link (good for 20 minutes). Check your spam folder too.',
  },
  bademail: { cls: 'pr-err', msg: "That doesn't look like an email address." },
  ratelimited: { cls: 'pr-err', msg: 'Too many requests. Wait a few minutes and try again.' },
  sendfailed: { cls: 'pr-err', msg: "Couldn't send the email just now. Try again in a bit." },
  badlink: { cls: 'pr-err', msg: 'That sign-in link is invalid or expired. Request a new one.' },
  badcode: {
    cls: 'pr-err',
    msg: 'That code is wrong or expired. Request a new link and try again.',
  },
  emailtaken: {
    cls: 'pr-err',
    msg: 'That email already has an account. Sign in with it, then use Connect Telegram to link them.',
  },
  disabled: { cls: 'pr-err', msg: 'Email sign-in is not configured on this server yet.' },
};

export function loginHtml(nonce: string, mailEnabled: boolean, status: string | null): string {
  const s = status ? LOGIN_STATUS[status] : undefined;
  const notice = s ? `<p class="${s.cls}" style="margin:0 0 14px">${s.msg}</p>` : '';

  // After a link is sent, offer the emailed code as a fallback for people whose
  // mail app opened the link in a different browser than the one they started in.
  const codeForm =
    mailEnabled && status === 'sent'
      ? `<div style="margin-top:18px; padding-top:18px; border-top:1px solid var(--border-soft)">
          <label class="pr-label" for="lcemail">Or enter the 6-digit code from the email</label>
          <form method="POST" action="/app/login/code" style="margin-top:8px">
            <input class="pr-input" id="lcemail" type="email" name="email" placeholder="you@example.com" required style="margin-bottom:10px">
            <input class="pr-input mono" id="code" name="code" inputmode="numeric" pattern="[0-9 ]{6,7}" maxlength="7" placeholder="123 456" required style="margin-bottom:12px; letter-spacing:0.15em">
            <button class="pr-btn ghost block" type="submit">Sign in with code</button>
          </form>
        </div>`
      : '';

  const emailPane = mailEnabled
    ? `<form method="POST" action="/app/login">
        ${notice}
        <label class="pr-label" for="email">Email</label>
        <input class="pr-input" id="email" type="email" name="email" placeholder="you@example.com" required style="margin-bottom:18px">
        <p class="muted" style="font-size:13px; margin:-8px 0 18px">No password to remember, we email you a one-tap link.</p>
        <button class="pr-btn gold block" type="submit">Send sign-in link &amp; brace yourself</button>
      </form>${codeForm}`
    : `<div class="pr-err" style="background:rgba(255,82,71,0.08); border:1px solid rgba(255,82,71,0.28); border-radius:11px; padding:14px 16px; min-height:0">Email sign-in is not configured on this server yet. Use the Telegram bot instead.</div>`;

  // Default to the Telegram tab (matches the design); if there's an email status
  // message to show, open the Email tab so the user sees it.
  const initialTab = status ? 'email' : 'telegram';

  const body = `<div class="pr-loginwrap">
  <div class="pr-loginbrand">
    ${logo(true)}
    <h1>Welcome back.<br>Your meter <span>missed you.</span></h1>
    <p>It's been quietly judging your recharge habits while you were gone. Sign in and face the numbers.</p>
    <div class="pr-peek">
      <span style="display:grid; place-items:center; width:42px; height:42px; border-radius:10px; background:rgba(255,82,71,0.14); flex:none;">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FF5247" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h6l-1 8 9-12h-6z"></path></svg>
      </span>
      <div>
        <div class="mono" style="font-size:11px; color:var(--faint); text-transform:uppercase; letter-spacing:0.08em; margin-bottom:3px;">A low balance, somewhere</div>
        <div style="display:flex; align-items:baseline; gap:9px;"><span style="font-size:24px; font-weight:800; color:var(--red-soft); letter-spacing:-0.02em;">৳42.50</span><span class="mono" style="font-size:12px; color:var(--faint);">~3 days left</span></div>
      </div>
    </div>
  </div>

  <div class="pr-formcard">
    <div style="margin-bottom:24px">
      <div style="font-size:22px; font-weight:800; color:var(--text); letter-spacing:-0.02em; margin-bottom:5px;">Sign in to Power·Roast</div>
      <div style="font-size:14px; color:var(--muted);">Pick your poison. Both lead to the same uncomfortable truth.</div>
    </div>

    <div class="pr-tabs" style="margin-bottom:24px">
      <button class="pr-tab" type="button" data-tab="telegram">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M21.9 4.3 2.9 11.6c-1 .4-1 1.4-.2 1.7l4.9 1.5 1.9 5.8c.2.5.4.7.8.7.4 0 .6-.2.9-.5l2.4-2.4 4.9 3.6c.9.5 1.5.2 1.7-.8l3.2-15c.3-1.2-.5-1.8-1.3-1.4z"></path></svg>
        Telegram
      </button>
      <button class="pr-tab" type="button" data-tab="email">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"></rect><path d="m2 7 10 6 10-6"></path></svg>
        Email
      </button>
    </div>

    <div data-pane="telegram">
      <div style="text-align:center; padding:8px 0 18px;">
        <div style="position:relative; display:inline-grid; place-items:center; width:84px; height:84px; margin-bottom:18px;">
          <span style="position:absolute; inset:0; border-radius:24px; background:rgba(94,131,255,0.18); animation:prPulse 2.4s ease-out infinite;"></span>
          <span style="position:relative; display:grid; place-items:center; width:64px; height:64px; border-radius:18px; background:linear-gradient(135deg,#5E83FF,#2A6FDB);">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="#fff"><path d="M21.9 4.3 2.9 11.6c-1 .4-1 1.4-.2 1.7l4.9 1.5 1.9 5.8c.2.5.4.7.8.7.4 0 .6-.2.9-.5l2.4-2.4 4.9 3.6c.9.5 1.5.2 1.7-.8l3.2-15c.3-1.2-.5-1.8-1.3-1.4z"></path></svg>
          </span>
        </div>
        <div style="font-size:16px; font-weight:700; color:var(--text); margin-bottom:6px;">Open the bot to sign in</div>
        <p class="muted" style="margin:0 auto; max-width:300px; font-size:14px; line-height:1.55;">No password to forget. Open the bot, send <b style="color:var(--text-2)">/start</b>, and it'll watch your meters and roast you right there.</p>
      </div>
      <a href="https://t.me/" target="_blank" rel="noopener" class="pr-btn blue block" style="text-decoration:none">Open Telegram
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"></path></svg>
      </a>
    </div>

    <div data-pane="email" style="display:none">${emailPane}</div>

    <div style="margin-top:22px; padding-top:18px; border-top:1px solid var(--border-soft); text-align:center; font-size:13px; color:var(--faint);">Not affiliated with DESCO, alerts keep running even when this page is closed.</div>
  </div>
</div>
<script nonce="${nonce}">
(function () {
  var tabs = document.querySelectorAll('[data-tab]');
  var panes = document.querySelectorAll('[data-pane]');
  function show(name) {
    tabs.forEach(function (t) { t.classList.toggle('on', t.getAttribute('data-tab') === name); });
    panes.forEach(function (p) { p.style.display = p.getAttribute('data-pane') === name ? '' : 'none'; });
  }
  tabs.forEach(function (t) { t.onclick = function () { show(t.getAttribute('data-tab')); }; });
  show('${mailEnabled ? initialTab : 'telegram'}');
})();
</script>`;

  return pageDoc('Power Roast', body);
}

// SVG icons used in the sidebar / topbar, kept as named constants for clarity.
const IC = {
  dashboard:
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1"></rect><rect x="14" y="3" width="7" height="5" rx="1"></rect><rect x="14" y="12" width="7" height="9" rx="1"></rect><rect x="3" y="16" width="7" height="5" rx="1"></rect></svg>',
  meter:
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 12 8.5 8.5"></path><path d="M12 3v2M21 12h-2M12 21v-2M3 12h2"></path></svg>',
  alerts:
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"></path><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"></path></svg>',
  billing:
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"></rect><path d="M2 10h20"></path></svg>',
};

export function appShellHtml(
  nonce: string,
  csrf: string,
  rechargeUrl: string = DEFAULT_RECHARGE_URL
): string {
  const body = `<div class="pr-shell">
  <div id="pr-scrim"></div>
  <aside class="pr-sidebar" id="pr-sidebar">
    ${logo()}
    <nav class="pr-nav">
      <div class="pr-nav-label">Workspace</div>
      <button class="pr-navbtn active" type="button" data-screen="dashboard">${IC.dashboard}Dashboard</button>
      <button class="pr-navbtn" type="button" data-screen="meter">${IC.meter}Meters</button>
      <button class="pr-navbtn" type="button" data-screen="alerts">${IC.alerts}Alerts &amp; thresholds</button>
      <button class="pr-navbtn" type="button" data-screen="billing">${IC.billing}Billing &amp; recharge</button>
    </nav>
    <div class="pr-side-foot">
      <a class="pr-navbtn" href="/admin" style="border:1px solid var(--border);background:rgba(255,255,255,0.03);font-size:13px;gap:11px"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FBB024" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 4 6v6c0 5 3.4 8.5 8 10 4.6-1.5 8-5 8-10V6z"></path></svg>Switch to admin</a>
      <div class="pr-user">
        <span class="pr-avatar" id="navAvatar"></span>
        <div class="who"><div class="n" id="navName">...</div><div class="m" id="navPlan"></div></div>
        <form method="POST" action="/app/logout" style="margin:0"><input type="hidden" name="csrf" value="${csrf}"><button class="pr-iconbtn" type="submit" title="Sign out"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><path d="m16 17 5-5-5-5M21 12H9"></path></svg></button></form>
      </div>
    </div>
  </aside>

  <div class="pr-main">
    <header class="pr-topbar">
      <button id="pr-hamburger" type="button"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M3 12h18M3 18h18"></path></svg></button>
      <div class="titles"><div class="t" id="topTitle">Dashboard</div><div class="s" id="topSub">loading...</div></div>
      <div class="pr-mselwrap" id="mselWrap" style="display:none"></div>
      <button class="pr-btn gold" id="refreshBtn" type="button" title="Re-fetch the latest balances"><svg id="refreshIcon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0B1020" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"></path></svg><span id="refreshLabel">Force check</span></button>
    </header>
    <main class="pr-content"><div id="host"><div class="pr-card pr-empty">Loading...</div></div></main>
  </div>
</div>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
<script nonce="${nonce}">
const CSRF = ${JSON.stringify(csrf)};
${CLIENT_HELPERS}
${CHART_SCRIPT}

// ---- state ---------------------------------------------------------------
const RECHARGE_URL = ${JSON.stringify(rechargeUrl)};
let DATA = null, SEL = 0, SCREEN = 'dashboard', ROAST = 'savage';
let CHARTS = [];
const host = document.getElementById('host');

// ---- api -----------------------------------------------------------------
async function api(path, opts) {
  const res = await fetch('/app/api' + path, opts);
  if (res.status === 401) { location.href = '/app'; throw new Error('signed out'); }
  return res;
}
async function getMe() { const r = await api('/me'); if (!r.ok) throw new Error('load failed'); return r.json(); }
async function post(path, body) {
  const r = await api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
  return data;
}

// ---- helpers -------------------------------------------------------------
function statusOf(m) {
  if (!m || m.balance === null) return { label: 'NO DATA', key: 'nodata', pill: 'pr-pill', color: '#6E7790' };
  if (m.balance < m.criticalThreshold) return { label: 'CRITICAL', key: 'crit', pill: 'pr-pill crit siren', color: '#FF5247' };
  if (m.balance < m.lowThreshold) return { label: 'LOW', key: 'low', pill: 'pr-pill low', color: '#FBB024' };
  return { label: 'HEALTHY', key: 'ok', pill: 'pr-pill ok', color: '#34D399' };
}
function days(m) { return m && m.prediction ? m.prediction.daysLeft : null; }
function clip(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '...' : s; }
function rel(t) {
  if (!t) return 'n/a';
  const d = Date.now() - new Date(t).getTime();
  if (d < 60000) return 'just now';
  if (d < 3600000) return Math.floor(d / 60000) + 'm ago';
  if (d < 86400000) return Math.floor(d / 3600000) + 'h ago';
  return Math.floor(d / 86400000) + 'd ago';
}
function shortDate(ms) { return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
function lastCheck() {
  let t = 0;
  for (const m of DATA.meters) for (const r of m.readings) { const v = new Date(r.t).getTime(); if (v > t) t = v; }
  return t || null;
}
function pctChange(readings) {
  if (!readings || readings.length < 2) return null;
  const a = readings[0].balance, b = readings[readings.length - 1].balance;
  if (!a) return null;
  return Math.round(((b - a) / a) * 100);
}
function lastRecharge(m) {
  let best = null;
  for (let i = 1; i < m.readings.length; i++) {
    const d = m.readings[i].balance - m.readings[i - 1].balance;
    if (d > 1 && (!best || d > best.amount)) best = { amount: d, t: m.readings[i].t };
  }
  return best;
}
function meterAlerts(m) { return DATA.alerts.filter(a => a.meterId === m.id); }
function levelColor(l) { return l === 'critical' ? '#FF5247' : l === 'low' ? '#FBB024' : '#34D399'; }
function clearCharts() { CHARTS.forEach(c => { try { c.destroy(); } catch (e) {} }); CHARTS = []; }
function drawCharts() {
  host.querySelectorAll('canvas[data-mi]').forEach(cv => {
    const m = DATA.meters[+cv.getAttribute('data-mi')];
    if (m) CHARTS.push(window.prChart(cv, m.readings, { low: m.lowThreshold, critical: m.criticalThreshold }));
  });
}
function gauge(m, size) {
  size = size || 96;
  const C = 314, st = statusOf(m);
  let frac = 0;
  if (m && m.balance !== null) {
    let max = m.balance;
    for (const r of m.readings) if (r.balance > max) max = r.balance;
    frac = max > 0 ? Math.max(0, Math.min(1, m.balance / max)) : 0;
  }
  const off = Math.round(C * (1 - frac));
  return '<div class="pr-gauge" style="width:' + size + 'px;height:' + size + 'px">' +
    '<svg width="' + size + '" height="' + size + '" viewBox="0 0 120 120"><circle cx="60" cy="60" r="50" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="11"></circle>' +
    '<circle cx="60" cy="60" r="50" fill="none" stroke="' + st.color + '" stroke-width="11" stroke-linecap="round" stroke-dasharray="' + C + '" stroke-dashoffset="' + off + '" transform="rotate(-90 60 60)"></circle></svg>' +
    '<div class="v"><div><div style="font-size:' + (size > 80 ? 19 : 15) + 'px;font-weight:800;color:var(--text);letter-spacing:-0.02em">' + fmt(m ? m.balance : null) + '</div><div class="mono" style="font-size:9px;color:var(--faint);text-transform:uppercase">balance</div></div></div></div>';
}

// reusable add-meter card (markup + wiring)
function addMeterCard() {
  return '<div class="pr-card" style="margin-top:18px"><div class="pr-card-title">Add a meter</div>' +
    '<div class="pr-card-sub" style="margin-bottom:16px">Find these on your DESCO bill or the DESCO prepaid portal.</div>' +
    '<div class="row" style="gap:10px">' +
      '<input type="text" id="acct" class="pr-input mono" placeholder="Account number" style="flex:1;min-width:160px">' +
      '<input type="text" id="meter" class="pr-input mono" placeholder="Meter number" style="flex:1;min-width:160px">' +
      '<button class="pr-btn gold" id="addBtn" type="button">Add</button>' +
    '</div><p class="pr-err" id="addErr" style="margin-top:8px"></p></div>';
}
function wireAddMeter() {
  const btn = host.querySelector('#addBtn'); if (!btn) return;
  btn.onclick = async () => {
    const err = host.querySelector('#addErr'); err.textContent = ''; err.className = 'pr-err';
    try {
      const r = await post('/meters', { accountNo: host.querySelector('#acct').value.trim(), meterNo: host.querySelector('#meter').value.trim() });
      // echo the balance we just read so the add feels confirmed, then refresh
      err.className = 'pr-good';
      err.textContent = 'Added ✓ Current balance: ' + fmt(r.balance) + '. Watching it now.';
      setTimeout(load, 1200);
    } catch (e) { err.className = 'pr-err'; err.textContent = e.message; }
  };
}

// ---- chrome (topbar + sidebar) ------------------------------------------
const TITLES = {
  dashboard: ['Dashboard', null],
  meter: [null, null],
  alerts: ['Alerts & thresholds', 'decide how loudly the bot judges you'],
  billing: ['Billing & recharge', 'plans, history, and the recharge you keep forgetting'],
};
function renderChrome() {
  const name = DATA.email || 'You';
  document.getElementById('navName').textContent = name;
  document.getElementById('navAvatar').textContent = name.charAt(0).toUpperCase();
  document.getElementById('navPlan').textContent = DATA.plan + ', ' + DATA.meters.length + ' meter' + (DATA.meters.length === 1 ? '' : 's');

  document.querySelectorAll('.pr-navbtn[data-screen]').forEach(b => b.classList.toggle('active', b.getAttribute('data-screen') === SCREEN));

  // meter selector
  const wrap = document.getElementById('mselWrap');
  if (DATA.meters.length) {
    wrap.style.display = '';
    wrap.innerHTML = DATA.meters.map((m, i) =>
      '<button class="pr-mselbtn' + (i === SEL ? ' on' : '') + '" type="button" data-sel="' + i + '"><span class="dot" style="background:' + statusOf(m).color + '"></span>' + esc(clip(m.label, 14)) + '</button>'
    ).join('');
    wrap.querySelectorAll('[data-sel]').forEach(b => b.onclick = () => { SEL = +b.dataset.sel; renderChrome(); renderScreen(); });
  } else { wrap.style.display = 'none'; }

  // topbar title/sub
  let title = TITLES[SCREEN][0], sub = TITLES[SCREEN][1];
  if (SCREEN === 'dashboard') {
    sub = DATA.meters.length ? (DATA.meters.length + ' meter' + (DATA.meters.length === 1 ? '' : 's') + ' watched, checked ' + rel(lastCheck())) : 'no meters yet, add one to begin';
  } else if (SCREEN === 'meter') {
    const m = DATA.meters[SEL];
    title = m ? m.label : 'Meters';
    sub = m ? ('meter ' + m.meterNo + ', checked ' + rel(m.readings.length ? m.readings[m.readings.length - 1].t : null)) : 'no meters yet';
  } else if (SCREEN === 'billing') {
    sub = DATA.plan + ' plan' + (DATA.billingLive ? '' : ', free-only launch');
  }
  document.getElementById('topTitle').textContent = title;
  document.getElementById('topSub').textContent = sub;
}

// ---- screen: dashboard ---------------------------------------------------
function dashBanner() {
  const ms = DATA.meters;
  const crit = ms.filter(m => m.balance !== null && m.balance < m.criticalThreshold);
  const low = ms.filter(m => m.balance !== null && m.balance < m.lowThreshold && m.balance >= m.criticalThreshold);
  if (crit.length) {
    const m = crit[0];
    return '<div class="pr-banner" style="margin-bottom:22px"><span class="ic"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FF5247" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h6l-1 8 9-12h-6z"></path></svg></span>' +
      '<div class="bd"><div class="h">' + esc(m.label) + ' is one warm fridge from darkness</div><div class="p">' + fmt(m.balance) + ' left' + (crit.length + low.length > 1 ? ', ' + (crit.length + low.length) + ' meters need attention' : '') + '. Recharge before the lights file a complaint.</div></div>' +
      '<button class="pr-btn red" type="button" data-go="billing" style="flex:none">Recharge now →</button></div>';
  }
  if (low.length) {
    const m = low[0];
    return '<div class="pr-banner warn" style="margin-bottom:22px"><span class="ic"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FBB024" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h6l-1 8 9-12h-6z"></path></svg></span>' +
      '<div class="bd"><div class="h">' + esc(m.label) + ' is getting low</div><div class="p">' + fmt(m.balance) + ' left. A top-up now saves you a panicked midnight recharge later.</div></div>' +
      '<button class="pr-btn gold" type="button" data-go="billing" style="flex:none">Recharge →</button></div>';
  }
  if (!ms.length) return '';
  return '<div class="pr-banner" style="margin-bottom:22px;background:linear-gradient(135deg,rgba(52,211,153,0.12),rgba(52,211,153,0.04));border-color:rgba(52,211,153,0.3)"><span class="ic" style="background:rgba(52,211,153,0.16)"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#34D399" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg></span>' +
    '<div class="bd"><div class="h">Every meter is healthy</div><div class="p">Nothing to roast you about right now. Enjoy it while it lasts.</div></div></div>';
}
function renderDashboard() {
  if (!DATA.meters.length) {
    host.innerHTML = '<div class="pr-card pr-empty" style="margin-bottom:18px">No meters yet. Add one below to start watching it.</div>' + addMeterCard();
    wireAddMeter();
    return;
  }
  const ms = DATA.meters;
  const total = ms.reduce((a, m) => a + (m.balance ?? 0), 0);
  const atRisk = ms.filter(m => m.balance !== null && m.balance < m.lowThreshold);
  const crit = ms.filter(m => m.balance !== null && m.balance < m.criticalThreshold);
  const preds = ms.map(m => days(m)).filter(d => typeof d === 'number');
  const soon = preds.length ? Math.min.apply(null, preds) : null;
  const soonM = soon === null ? null : ms.find(m => days(m) === soon);
  const sel = ms[SEL], st = statusOf(sel), pc = pctChange(sel.readings);

  let h = dashBanner();
  h += '<div class="pr-statrow" style="margin-bottom:18px">' +
    '<div class="pr-stat"><div class="k">Total balance, ' + ms.length + ' meter' + (ms.length === 1 ? '' : 's') + '</div><div class="n">' + fmt(total) + '</div></div>' +
    '<div class="pr-stat"><div class="k">Meters at risk</div><div style="display:flex;align-items:baseline;gap:8px"><span class="n ' + (atRisk.length ? 'red' : 'green') + '">' + atRisk.length + '</span><span class="muted" style="font-size:14px">of ' + ms.length + '</span></div><div class="d ' + (crit.length ? 'down' : 'warn') + '">' + crit.length + ' critical, ' + (atRisk.length - crit.length) + ' low</div></div>' +
    '<div class="pr-stat"><div class="k">Next blackout</div><div class="n ' + (soon !== null && soon < 4 ? 'red' : 'gold') + '">' + (soon === null ? 'n/a' : '~' + soon.toFixed(soon < 10 ? 1 : 0) + ' days') + '</div><div class="d">' + (soonM ? esc(clip(soonM.label, 22)) + ' leads the race' : 'all steady') + '</div></div>' +
  '</div>';

  // chart + meters/prediction
  h += '<div class="pr-grid pr-2col">' +
    '<div class="pr-card">' +
      '<div class="pr-section-head" style="align-items:flex-start;margin-bottom:0"><div>' +
        '<div class="mono" style="font-size:13px;color:var(--faint);margin-bottom:5px">' + esc(sel.label) + ', last 30 days</div>' +
        '<div style="display:flex;align-items:baseline;gap:10px"><span style="font-size:30px;font-weight:800;color:var(--text);letter-spacing:-0.03em">' + fmt(sel.balance) + '</span>' + (pc !== null ? '<span class="mono" style="font-size:12px;font-weight:700;color:' + (pc < 0 ? '#FF8077' : '#34D399') + '">' + (pc < 0 ? '▼ ' : '▲ ') + Math.abs(pc) + '%</span>' : '') + '</div>' +
      '</div><span class="' + st.pill + '"><span class="dot"></span>' + st.label + '</span></div>' +
      '<div class="pr-chart lg"><canvas data-mi="' + SEL + '"></canvas></div>' +
    '</div>' +
    '<div class="pr-stack">' +
      '<div class="pr-card" style="padding:20px"><div class="pr-section-head" style="margin-bottom:12px"><span style="font-size:14px;font-weight:700;color:var(--text)">Your meters</span><span class="mono muted" style="font-size:12px">' + ms.length + ' active</span></div><div class="pr-list">' +
        ms.map((m, i) => {
          const s = statusOf(m), d = days(m);
          return '<div class="pr-rowitem" style="cursor:pointer" data-i="' + i + '"><span class="pr-dot" style="background:' + s.color + '"></span>' +
            '<div style="flex:1;min-width:0"><div style="font-size:13.5px;font-weight:600;color:var(--text)">' + esc(m.label) + '</div><div class="mono" style="font-size:11px;color:var(--faint)">' + esc(m.meterNo) + '</div></div>' +
            '<div style="text-align:right"><div style="font-size:14px;font-weight:800;color:' + s.color + '">' + fmt(m.balance) + '</div><div class="mono" style="font-size:10px;color:var(--faint)">' + (d === null ? 'n/a' : '~' + d.toFixed(d < 10 ? 1 : 0) + 'd') + '</div></div></div>';
        }).join('') +
      '</div></div>';
  if (soonM && soon !== null) {
    h += '<div style="background:linear-gradient(135deg,rgba(251,176,36,0.12),rgba(255,82,71,0.1));border:1px solid rgba(251,176,36,0.25);border-radius:16px;padding:20px">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FBB024" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"></path><path d="m19 9-5 5-4-4-3 3"></path></svg><span style="font-size:13px;font-weight:700;color:var(--text)">Run-out prediction</span></div>' +
      '<p style="margin:0;font-size:14px;line-height:1.55;color:var(--text-2)">At the current burn rate, <b style="color:var(--gold)">' + esc(soonM.label) + '</b> goes dark in <b style="color:var(--red-soft)">~' + soon.toFixed(soon < 10 ? 1 : 0) + ' days</b>. Maybe set a reminder, since the alerts clearly aren\\'t landing.</p></div>';
  }
  h += '</div></div>';

  host.innerHTML = h;
  host.querySelectorAll('[data-i]').forEach(el => el.onclick = () => { SEL = +el.dataset.i; go('meter'); });
  host.querySelectorAll('[data-go]').forEach(el => el.onclick = () => go(el.dataset.go));
  drawCharts();
}

// ---- screen: meter detail ------------------------------------------------
function renderMeter() {
  if (!DATA.meters.length) {
    host.innerHTML = '<div class="pr-card pr-empty" style="margin-bottom:18px">No meters yet. Add one below.</div>' + addMeterCard();
    wireAddMeter();
    return;
  }
  const m = DATA.meters[SEL], st = statusOf(m), d = days(m), lr = lastRecharge(m), als = meterAlerts(m);
  const proj = (m.prediction && m.balance !== null) ? shortDate(Date.now() + m.prediction.daysLeft * 86400000) : 'n/a';

  let h = '<div style="display:flex;align-items:center;gap:16px;background:var(--surface);border:1px solid ' + (st.key === 'crit' ? 'rgba(255,82,71,0.28)' : 'var(--border)') + ';border-radius:16px;padding:22px;margin-bottom:18px">' +
    gauge(m, 96) +
    '<div style="flex:1;min-width:0"><div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;flex-wrap:wrap"><span style="font-size:20px;font-weight:800;color:var(--text);letter-spacing:-0.02em">' + esc(m.label) + '</span><span class="' + st.pill + '"><span class="dot"></span>' + st.label + '</span></div>' +
      '<div class="mono" style="font-size:12.5px;color:var(--faint)">Account ' + esc(m.accountNo) + ', Meter ' + esc(m.meterNo) + ', DESCO prepaid</div>' +
      '<div style="font-size:14px;color:var(--text-2);margin-top:8px">' + (d === null ? 'Not enough history to predict a run-out yet.' : 'Goes dark in <b style="color:' + st.color + '">~' + d.toFixed(d < 10 ? 1 : 0) + ' days</b>. It deserves better and so do you.') + '</div></div>' +
    '<button class="pr-btn gold" type="button" data-go="billing" style="flex:none">Recharge →</button></div>';

  h += '<div class="pr-statrow" style="--cols:4;margin-bottom:18px">' +
    statCard('Daily burn', m.prediction ? fmt(m.prediction.burnPerDay) : 'n/a', m.prediction ? 'per day' : 'need more data', '') +
    statCard('Projected zero', proj, d === null ? 'n/a' : '~' + d.toFixed(d < 10 ? 1 : 0) + ' days from now', 'gold') +
    statCard('Last recharge', lr ? fmt(lr.amount) : 'n/a', lr ? rel(lr.t) : 'none detected', '') +
    statCard('Alerts sent', String(als.length), als.length ? 'in the last 30 days' : 'all quiet', als.length ? 'red' : '') +
  '</div>';

  h += '<div class="pr-grid pr-2col">' +
    '<div class="pr-card"><div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:4px">Balance history</div><div class="mono" style="font-size:12px;color:var(--faint);margin-bottom:6px">Last 30 days, ৳ remaining</div><div class="pr-chart lg"><canvas data-mi="' + SEL + '"></canvas></div></div>' +
    '<div class="pr-card" style="padding:20px"><div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:6px">Recent alerts</div>' +
      (als.length ? '<div class="pr-list">' + als.slice(0, 6).map(a =>
        '<div class="pr-rowitem" style="align-items:flex-start"><span class="pr-dot" style="margin-top:5px;background:' + levelColor(a.level) + '"></span><div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:600;color:var(--text)">' + esc(a.action) + '</div><div class="mono" style="font-size:11px;color:var(--faint);margin-top:2px">' + esc(a.level) + ', ' + rel(a.sentAt) + '</div></div></div>'
      ).join('') + '</div>' : '<div class="pr-empty" style="padding:20px 0">No alerts for this meter yet.</div>') +
    '</div></div>';

  // meter settings (rename / pause) — real mutations
  h += '<div class="pr-card" style="margin-top:18px"><div class="pr-card-title">Meter settings</div><div class="pr-card-sub" style="margin-bottom:14px">Rename it something you\\'ll recognise, or pause monitoring if you\\'ve moved out.</div>' +
    '<div class="row" style="gap:10px"><input type="text" id="nick" class="pr-input" placeholder="Nickname (e.g. Flat 3B)" value="' + esc(m.nickname || '') + '" style="flex:1;min-width:160px"><button class="pr-btn ghost" id="nickBtn" type="button">Rename</button><button class="pr-btn ghost" id="pauseBtn" type="button">Pause monitoring</button></div>' +
    '<p class="pr-err" id="mErr" style="margin-top:8px"></p></div>';

  h += addMeterCard();

  host.innerHTML = h;
  host.querySelectorAll('[data-go]').forEach(el => el.onclick = () => go(el.dataset.go));
  const err = host.querySelector('#mErr');
  host.querySelector('#nickBtn').onclick = async () => {
    err.textContent = '';
    try { await post('/meters/' + m.id + '/nickname', { name: host.querySelector('#nick').value }); await load(); } catch (e) { err.textContent = e.message; }
  };
  host.querySelector('#pauseBtn').onclick = async () => {
    if (!confirm('Pause monitoring for this meter?')) return;
    err.textContent = '';
    try { await post('/meters/' + m.id + '/pause'); SEL = 0; await load(); } catch (e) { err.textContent = e.message; }
  };
  wireAddMeter();
  drawCharts();
}
function statCard(k, n, d, cls) {
  return '<div class="pr-stat" style="padding:18px"><div class="k">' + k + '</div><div class="n ' + cls + '" style="font-size:22px">' + esc(n) + '</div><div class="d">' + esc(d) + '</div></div>';
}

// ---- screen: alerts & thresholds ----------------------------------------
const ROASTS = {
  savage: { accent: '#FF5247', subject: '⚡ Your electricity is about to ghost you', body: 'Bro. {bal} is your line in the sand and you sprinted past it. Recharge now, or start rationing fridge openings like it\\'s a survival show.' },
  mild: { accent: '#34D399', subject: 'Heads-up: your balance is getting low', body: 'Friendly nudge, your meter is at {bal}. Might be a good time to top up before it runs out.' },
};
function hourLabel(h) { const ap = h < 12 ? 'am' : 'pm'; const hr = h % 12 === 0 ? 12 : h % 12; return hr + ap; }
function hourOpts(sel) { let o = ''; for (let h = 0; h < 24; h++) o += '<option value="' + h + '"' + (h === sel ? ' selected' : '') + '>' + hourLabel(h) + '</option>'; return o; }

function renderAlerts() {
  if (!DATA.meters.length) {
    host.innerHTML = '<div class="pr-card pr-empty">Add a meter first, thresholds are set per meter.</div>';
    return;
  }
  const m = DATA.meters[SEL];
  ROAST = DATA.tone || 'savage';
  const ch = DATA.channels;
  const qhOn = DATA.quietStart !== null && DATA.quietStart !== undefined;
  const qhStart = qhOn ? DATA.quietStart : 23;
  const qhEnd = qhOn ? DATA.quietEnd : 7;

  // channel rows reflect real state; disabled when the channel can't be toggled here
  const emailRow = channelRow('rgba(251,176,36,0.13)', emailIcon(), 'Email', esc(ch.email.address || 'no email on file'), 'email', ch.email.enabled, !ch.email.verified, '', 'No verified email');
  const tgRow = channelRow('rgba(94,131,255,0.13)', tgIcon(), 'Telegram', ch.telegram.available ? 'instant' : 'link via the bot', 'telegram', ch.telegram.enabled, !ch.telegram.available, '', 'Open the bot and /start');
  // SMS is a paid channel, so hide it entirely on a free-only launch unless this
  // account already has a number on file (e.g. from a comped plan).
  const showSms = DATA.billingLive || ch.sms.hasPhone;
  const smsBadge = ch.sms.available ? '' : 'PAID';
  const smsMeta = ch.sms.hasPhone ? esc(ch.sms.address) : ch.sms.available ? 'add a number via the bot' : 'on paid plans';
  const smsRow = showSms
    ? channelRow('rgba(52,211,153,0.13)', smsIcon(), 'SMS', smsMeta, 'sms', ch.sms.enabled, !ch.sms.available || !ch.sms.hasPhone, smsBadge, ch.sms.available ? 'Add a phone with /sms in the bot' : 'Upgrade for SMS alerts')
    : '';
  const dc = ch.discord || { connected: false, enabled: false, address: null };
  const dcMeta = dc.connected ? esc(dc.address) : 'free - paste a webhook below';
  const discordRow = channelRow('rgba(88,101,242,0.15)', discordIcon(), 'Discord', dcMeta, 'discord', dc.enabled, !dc.connected, '', 'Connect a webhook below first');
  // when this account has no Telegram yet, offer the deep link to connect one
  const tgConnect = ch.telegram.connectUrl
    ? '<div style="margin-top:12px"><a href="' + ch.telegram.connectUrl + '" target="_blank" rel="noopener" class="pr-btn blue block" style="text-decoration:none">Connect Telegram</a><p class="mono" style="font-size:11px;color:var(--faint);margin:6px 0 0">Get instant alerts and manage meters from the bot too.</p></div>'
    : '';

  let h = '<div class="pr-grid pr-2col-even">';
  h += '<div class="pr-stack">';
  h += '<div class="pr-card"><div class="pr-card-title">Where it roasts you</div><div class="pr-card-sub" style="margin-bottom:14px">Turn off a channel and you\\'re just choosing which way to be surprised by darkness.</div><div class="pr-list">' +
    emailRow + tgRow + smsRow + discordRow +
  '</div>' +
  '<div style="margin-top:12px"><div class="mono" style="font-size:10px;color:var(--faint);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px">Discord webhook</div>' +
    '<div class="row" style="gap:8px"><input type="text" id="dcUrl" class="pr-input" placeholder="https://discord.com/api/webhooks/..." style="flex:1;min-width:160px"><button class="pr-btn ghost" id="dcBtn" type="button">' + (dc.connected ? 'Update' : 'Connect') + '</button></div>' +
    '<p class="mono" id="dcMsg" style="font-size:11.5px;margin-top:6px;color:var(--faint)">We send a test message to confirm it works.</p></div>' +
  tgConnect +
  '<p class="pr-err" id="chErr" style="margin-top:8px"></p></div>';

  h += '<div class="pr-card"><div class="pr-section-head" style="margin-bottom:4px"><span class="pr-card-title">Thresholds</span><span class="mono muted" style="font-size:12px">' + esc(clip(m.label, 18)) + '</span></div><div class="pr-card-sub" style="margin-bottom:22px">Defaults are ৳150 / ৳100. Higher if you like a buffer, lower if you like danger.</div>' +
    '<div style="margin-bottom:24px"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px"><span style="display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--gold)"><span style="width:9px;height:9px;border-radius:50%;background:var(--gold)"></span>Warning shot</span><span class="mono" id="loVal" style="font-size:18px;font-weight:700;color:var(--text)">৳' + m.lowThreshold + '</span></div><input type="range" class="pr-range" id="loRange" min="50" max="400" step="10" value="' + m.lowThreshold + '"></div>' +
    '<div><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px"><span style="display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--red-soft)"><span style="width:9px;height:9px;border-radius:50%;background:var(--red)"></span>DEFCON 1</span><span class="mono" id="crVal" style="font-size:18px;font-weight:700;color:var(--text)">৳' + m.criticalThreshold + '</span></div><input type="range" class="pr-range" id="crRange" min="30" max="300" step="10" value="' + m.criticalThreshold + '"></div>' +
  '</div>';
  h += '</div>';

  // right: roast intensity (real) + schedule (real quiet hours) + save
  h += '<div class="pr-stack">';
  h += '<div class="pr-card"><div class="pr-card-title" style="margin-bottom:14px">Roast intensity</div>' +
    '<div class="pr-seg" style="margin-bottom:18px"><button type="button" class="' + (ROAST === 'savage' ? 'on' : '') + '" data-roast="savage">🔥 Savage</button><button type="button" class="' + (ROAST === 'mild' ? 'on' : '') + '" data-roast="mild">😌 Mild</button></div>' +
    '<div class="mono" style="font-size:10px;color:var(--faint);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:10px">Preview, critical email</div>' +
    '<div id="roastPrev" style="border-left:3px solid ' + ROASTS[ROAST].accent + ';padding:14px 16px;background:rgba(255,255,255,0.03);border-radius:0 10px 10px 0"></div></div>';
  h += '<div class="pr-card"><div class="pr-card-title" style="margin-bottom:16px">Schedule</div>' +
    '<div style="display:flex;align-items:center;justify-content:space-between;padding-bottom:14px;border-bottom:1px solid var(--border-soft)"><div><div style="font-size:13.5px;font-weight:600;color:var(--text)">Check frequency</div><div class="mono" style="font-size:11.5px;color:var(--faint)">balance polled automatically</div></div><span class="mono" style="font-size:13px;font-weight:700;color:var(--gold)">automatic</span></div>' +
    '<div style="display:flex;align-items:center;justify-content:space-between;padding-top:14px"><div><div style="font-size:13.5px;font-weight:600;color:var(--text)">Quiet hours</div><div class="mono" style="font-size:11.5px;color:var(--faint)">pause nudges overnight</div></div>' +
      '<label class="pr-switch"><input type="checkbox" id="qhToggle"' + (qhOn ? ' checked' : '') + '><span class="track"></span><span class="knob"></span></label></div>' +
    '<div id="qhRow" style="display:' + (qhOn ? 'flex' : 'none') + ';align-items:center;gap:10px;margin-top:12px"><span class="mono muted" style="font-size:12px">from</span><select id="qhStart" class="pr-input" style="width:auto;padding:8px 10px">' + hourOpts(qhStart) + '</select><span class="mono muted" style="font-size:12px">to</span><select id="qhEnd" class="pr-input" style="width:auto;padding:8px 10px">' + hourOpts(qhEnd) + '</select></div>' +
    '<div class="mono" style="font-size:11px;color:var(--faint);margin-top:10px">Critical alerts always come through.</div></div>';
  h += '<button class="pr-btn gold block" id="saveBtn" type="button" style="padding:14px">Save settings</button><p class="pr-good" id="saveMsg" style="text-align:center"></p>';
  h += '</div>';
  h += '</div>';

  host.innerHTML = h;
  // channel toggles (real) — email/telegram/sms
  const chErr = host.querySelector('#chErr');
  ['email', 'telegram', 'sms', 'discord'].forEach(key => {
    const el = host.querySelector('#tg-' + key);
    if (el && !el.disabled) el.onchange = async e => {
      chErr.textContent = '';
      try { await post('/alerts/' + key, { enabled: e.target.checked }); } catch (err) { chErr.textContent = err.message; e.target.checked = !e.target.checked; }
    };
  });
  // Discord: validate + test-send + save the webhook, then reload to reflect state
  const dcBtn = host.querySelector('#dcBtn');
  if (dcBtn) dcBtn.onclick = async () => {
    const url = host.querySelector('#dcUrl').value.trim();
    const dcMsg = host.querySelector('#dcMsg');
    dcMsg.style.color = 'var(--faint)';
    if (!url) { dcMsg.style.color = 'var(--red-soft)'; dcMsg.textContent = 'Paste your webhook URL first.'; return; }
    dcMsg.textContent = 'Sending a test message...';
    try { await post('/discord', { url }); dcMsg.textContent = 'Connected - check Discord for the test message.'; await load(); }
    catch (e) { dcMsg.style.color = 'var(--red-soft)'; dcMsg.textContent = e.message; }
  };
  // roast preview reflects the selected (savable) tone
  function paintRoast() {
    const r = ROASTS[ROAST];
    host.querySelector('#roastPrev').innerHTML = '<div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:6px">' + esc(r.subject) + '</div><div style="font-size:13px;line-height:1.6;color:var(--text-2)">' + esc(r.body.replace('{bal}', fmt(m.balance))) + '</div>';
    host.querySelector('#roastPrev').style.borderLeftColor = r.accent;
    host.querySelectorAll('[data-roast]').forEach(b => b.classList.toggle('on', b.dataset.roast === ROAST));
  }
  host.querySelectorAll('[data-roast]').forEach(b => b.onclick = () => { ROAST = b.dataset.roast; paintRoast(); });
  paintRoast();
  // quiet-hours toggle reveals the range
  const qhToggle = host.querySelector('#qhToggle');
  qhToggle.onchange = () => host.querySelector('#qhRow').style.display = qhToggle.checked ? 'flex' : 'none';
  // threshold sliders
  const lo = host.querySelector('#loRange'), cr = host.querySelector('#crRange');
  lo.oninput = () => host.querySelector('#loVal').textContent = '৳' + lo.value;
  cr.oninput = () => host.querySelector('#crVal').textContent = '৳' + cr.value;
  // Save settings: tone + quiet hours + thresholds in one go (channels save instantly)
  host.querySelector('#saveBtn').onclick = async () => {
    const msg = host.querySelector('#saveMsg'); msg.textContent = ''; msg.className = 'pr-good'; msg.style.textAlign = 'center';
    const on = qhToggle.checked;
    try {
      await post('/settings', { tone: ROAST, quietStart: on ? Number(host.querySelector('#qhStart').value) : null, quietEnd: on ? Number(host.querySelector('#qhEnd').value) : null });
      await post('/meters/' + m.id + '/threshold', { low: Number(lo.value), critical: Number(cr.value) });
      msg.textContent = 'Saved ✓';
      await load();
    } catch (e) { msg.className = 'pr-err'; msg.textContent = e.message; }
  };
}
function channelRow(bg, icon, name, meta, key, on, disabled, badge, lockTitle) {
  const badgeHtml = badge ? '<span class="mono" style="font-size:10px;font-weight:700;color:var(--gold);background:rgba(251,176,36,0.13);padding:2px 7px;border-radius:999px">' + badge + '</span>' : '';
  return '<div class="pr-rowitem"><span class="pr-chan-ic" style="background:' + bg + '">' + icon + '</span>' +
    '<div style="flex:1;min-width:0"><div style="display:flex;align-items:center;gap:8px"><span style="font-size:14px;font-weight:600;color:var(--text)">' + name + '</span>' + badgeHtml + '</div><div class="mono" style="font-size:11.5px;color:var(--faint)">' + meta + '</div></div>' +
    '<label class="pr-switch"' + (disabled ? ' title="' + (lockTitle || '') + '" style="opacity:0.5;pointer-events:none"' : '') + '><input type="checkbox" id="tg-' + key + '"' + (on ? ' checked' : '') + (disabled ? ' disabled' : '') + '><span class="track"></span><span class="knob"></span></label></div>';
}
function emailIcon() { return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FBB024" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"></rect><path d="m2 7 10 6 10-6"></path></svg>'; }
function tgIcon() { return '<svg width="18" height="18" viewBox="0 0 24 24" fill="#5E83FF"><path d="M21.9 4.3 2.9 11.6c-1 .4-1 1.4-.2 1.7l4.9 1.5 1.9 5.8c.2.5.4.7.8.7.4 0 .6-.2.9-.5l2.4-2.4 4.9 3.6c.9.5 1.5.2 1.7-.8l3.2-15c.3-1.2-.5-1.8-1.3-1.4z"></path></svg>'; }
function smsIcon() { return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#34D399" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="3"></rect><path d="M11 18h2"></path></svg>'; }
function discordIcon() { return '<svg width="18" height="18" viewBox="0 0 24 24" fill="#5865F2"><path d="M20.3 4.9A19.8 19.8 0 0 0 15.4 3.4l-.2.5c1.6.5 2.4 1 3.3 1.6a13.4 13.4 0 0 0-11 0c.9-.6 1.8-1.1 3.3-1.6l-.2-.5A19.8 19.8 0 0 0 3.7 4.9C1 8.9.2 12.9.6 16.8a19.9 19.9 0 0 0 6 3l.4-.6c-.9-.3-1.6-.7-2.3-1.2l.6-.4a14 14 0 0 0 11.9 0l.6.4c-.7.5-1.5.9-2.3 1.2l.4.6a19.9 19.9 0 0 0 6-3c.5-4.5-.8-8.5-3.6-11.9zM9 14.3c-.9 0-1.7-.9-1.7-2s.8-2 1.7-2 1.7.9 1.7 2-.8 2-1.7 2zm6 0c-.9 0-1.7-.9-1.7-2s.8-2 1.7-2 1.7.9 1.7 2-.8 2-1.7 2z"></path></svg>'; }

// ---- screen: billing & recharge -----------------------------------------
const PROVIDER_LABEL = { bkash: 'bKash', sslcommerz: 'SSLCommerz', sandbox: 'Sandbox', manual: 'Manual', card: 'Card' };

function renderBilling() {
  host.innerHTML = '<div class="pr-card pr-empty">Loading...</div>';
  api('/billing').then(r => r.ok ? r.json() : Promise.reject()).then(paintBilling)
    .catch(() => { host.innerHTML = '<div class="pr-card pr-empty">Could not load billing.</div>'; });
}
function planFeatures(p) {
  const meters = p.maxMeters >= 99 ? 'Unlimited meters' : p.maxMeters + ' meter' + (p.maxMeters === 1 ? '' : 's');
  const sms = p.smsPerMonth > 0 ? p.smsPerMonth + ' SMS alerts / month' : 'Email + Telegram alerts';
  return featRow(meters) + featRow(sms) + featRow('Run-out predictions + history');
}
function paintBilling(b) {
  const cur = b.catalog.find(p => p.id === b.plan) || { name: b.plan, priceBdt: b.priceBdt, maxMeters: b.limits.maxMeters, smsPerMonth: b.limits.smsPerMonth };
  // Only offer upgrades when a billing gateway is live; the free-only launch has none.
  const upgrades = b.live ? b.catalog.filter(p => p.id !== 'free' && p.priceBdt > (cur.priceBdt || 0)) : [];
  const m = DATA.meters[SEL];

  let h = '<div class="pr-notice" style="margin-bottom:18px"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#8FA8FF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4M12 8h.01"></path></svg><div>Topping up a meter happens on DESCO\\'s prepaid portal, Power·Roast links you straight there. ' + (b.live ? 'Plan upgrades are handled here.' : 'Every feature is free while we\\'re in launch.') + '</div></div>';

  h += '<div class="pr-grid pr-2col-even">';
  // left: recharge deep-link + history
  h += '<div class="pr-stack">';
  h += '<div class="pr-card"><div class="pr-card-title">Recharge a meter</div><div class="pr-card-sub" style="margin-bottom:16px">' +
    (m ? esc(m.label) + ' is at ' + fmt(m.balance) + '. ' : '') + 'Recharge runs on the official DESCO portal, your meter and account are below.</div>' +
    (m ? '<div class="pr-list" style="margin-bottom:16px"><div class="pr-rowitem"><div style="flex:1"><div class="mono" style="font-size:11px;color:var(--faint);text-transform:uppercase">Account</div><div style="font-weight:600;color:var(--text)">' + esc(m.accountNo) + '</div></div><div style="flex:1"><div class="mono" style="font-size:11px;color:var(--faint);text-transform:uppercase">Meter</div><div style="font-weight:600;color:var(--text)">' + esc(m.meterNo) + '</div></div></div></div>' : '') +
    '<a class="pr-btn gold block" href="' + RECHARGE_URL + '" target="_blank" rel="noopener" style="padding:15px;text-decoration:none">Open DESCO recharge →</a></div>';
  // Payment history is meaningless on a free-only launch; only show it once billing is live.
  if (b.live)
    h += '<div class="pr-card"><div class="pr-card-title" style="margin-bottom:8px">Billing history</div>' +
    (b.payments.length
      ? '<div class="pr-list">' + b.payments.map(p =>
          '<div class="pr-rowitem"><span class="pr-chan-ic" style="background:rgba(255,255,255,0.05);font-family:var(--mono);font-size:10px;font-weight:700;color:var(--muted)">' + esc((PROVIDER_LABEL[p.provider] || p.provider).slice(0, 4)) + '</span>' +
          '<div style="flex:1;min-width:0"><div style="font-size:13.5px;font-weight:600;color:var(--text)">' + esc(PROVIDER_LABEL[p.provider] || p.provider) + ' payment</div><div class="mono" style="font-size:11px;color:var(--faint)">' + when(p.createdAt) + '</div></div>' +
          '<div style="text-align:right"><div style="font-size:14px;font-weight:800;color:var(--text)">' + fmt(p.amountBdt) + '</div><div class="mono ' + (p.status === 'completed' ? 'ok' : 'low') + '" style="font-size:11px">' + esc(p.status) + '</div></div></div>'
        ).join('') + '</div>'
      : '<div class="pr-empty" style="padding:24px 0">No payments yet.</div>') + '</div>';
  h += '</div>';

  // right: current plan + manage/upgrade
  h += '<div class="pr-stack">';
  h += '<div class="pr-plan"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px"><span class="mono" style="font-size:11px;font-weight:700;color:var(--gold);letter-spacing:0.04em">CURRENT PLAN</span>' +
    (b.subscription ? '<span class="mono" style="display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:700;color:var(--green)"><span style="width:6px;height:6px;border-radius:50%;background:var(--green)"></span>' + esc(b.subscription.status) + (b.subscription.currentPeriodEnd ? ', renews ' + when(b.subscription.currentPeriodEnd).split(',')[0] : '') + '</span>' : '<span class="mono muted" style="font-size:11px">free plan</span>') + '</div>' +
    '<div style="font-size:26px;font-weight:800;color:var(--text);letter-spacing:-0.02em;margin-bottom:4px">' + esc(cur.name) + '</div>' +
    '<div style="display:flex;align-items:baseline;gap:6px;margin-bottom:18px"><span style="font-size:30px;font-weight:800;color:var(--gold);letter-spacing:-0.03em">৳' + cur.priceBdt + '</span><span style="font-size:13px;color:var(--faint)">/ month' + (cur.priceBdt === 0 ? ', free forever' : '') + '</span></div>' +
    '<div style="display:flex;flex-direction:column;gap:9px">' + planFeatures(cur) + '</div></div>';

  h += '<div class="pr-card" style="padding:20px"><div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:6px">' + (upgrades.length ? 'Upgrade' : b.live ? 'Manage plan' : 'Your plan') + '</div>';
  if (upgrades.length) {
    h += '<p class="muted" style="font-size:13px;line-height:1.5;margin-bottom:14px">More meters and SMS alerts when you need them.</p><div style="display:flex;flex-direction:column;gap:9px">' +
      upgrades.map(p => '<button class="pr-btn gold" type="button" data-plan="' + p.id + '">Upgrade to ' + esc(p.name) + ', ৳' + p.priceBdt + '/mo</button>').join('') + '</div>';
  } else {
    h += '<p class="muted" style="font-size:13px;line-height:1.5">' + (b.live ? "You\\'re on the top plan. Nothing left to sell you." : "Every feature is free right now. Nothing to buy, nothing to manage.") + '</p>';
  }
  h += '<div style="border-top:1px solid var(--border-soft);margin-top:16px;padding-top:14px"><button class="pr-btn danger block" id="delBtn" type="button">Delete account</button></div>' +
    '<p class="pr-err" id="billErr" style="margin-top:8px"></p></div>';
  h += '</div>';
  h += '</div>';

  host.innerHTML = h;
  host.querySelectorAll('[data-plan]').forEach(btn => btn.onclick = async () => {
    const err = host.querySelector('#billErr'); err.textContent = '';
    btn.disabled = true;
    try {
      const res = await post('/checkout', { plan: btn.dataset.plan });
      if (res.paymentUrl) { location.href = res.paymentUrl; return; }
      await load(); go('billing'); // sandbox / manual: activated immediately
    } catch (e) { err.textContent = e.message; btn.disabled = false; }
  });
  host.querySelector('#delBtn').onclick = async () => {
    if (prompt('This erases your account and ALL data. Type DELETE to confirm.') !== 'DELETE') return;
    try { await post('/account/delete'); location.href = '/app'; } catch (e) { host.querySelector('#billErr').textContent = e.message; }
  };
}
function featRow(t) { return '<div class="pr-feat"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#FBB024" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>' + esc(t) + '</div>'; }

// ---- router --------------------------------------------------------------
function renderScreen() {
  clearCharts();
  if (SCREEN === 'meter') renderMeter();
  else if (SCREEN === 'alerts') renderAlerts();
  else if (SCREEN === 'billing') renderBilling();
  else renderDashboard();
}
function go(screen) {
  SCREEN = screen;
  if (location.hash !== '#' + screen) location.hash = screen;
  renderChrome();
  renderScreen();
  window.scrollTo(0, 0);
  setSidebar(false);
}
async function load() {
  DATA = await getMe();
  if (SEL >= DATA.meters.length) SEL = 0;
  renderChrome();
  renderScreen();
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
  if (['dashboard', 'meter', 'alerts', 'billing'].includes(s) && s !== SCREEN) { SCREEN = s; renderChrome(); renderScreen(); }
});
const refreshBtn = document.getElementById('refreshBtn');
refreshBtn.onclick = async () => {
  const icon = document.getElementById('refreshIcon');
  icon.classList.add('pr-spin');
  document.getElementById('refreshLabel').textContent = 'Checking...';
  try { await load(); } finally { icon.classList.remove('pr-spin'); document.getElementById('refreshLabel').textContent = 'Force check'; }
};

// initial screen from hash
const initial = location.hash.slice(1);
if (['meter', 'alerts', 'billing'].includes(initial)) SCREEN = initial;
load().catch(() => { host.innerHTML = '<div class="pr-card pr-empty">Something broke. Reload the page.</div>'; });
</script>`;

  return pageDoc('Power Roast', body);
}
