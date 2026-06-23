// Read-only, shareable dashboard reached via a signed /dash?t=token link (the
// bot's /dashboard command). No sidebar or mutations — just the brand, a quick
// summary, per-meter balance charts, and recent roasts. Shares the Power·Roast
// design system (theme.ts) with the customer app and admin panel.

import { pageDoc, logo, CHART_SCRIPT, CLIENT_HELPERS } from './theme';

export function dashboardHtml(token: string): string {
  const body = `<div style="position:relative; z-index:1; max-width:880px; margin:0 auto; padding:36px 20px 64px;">
  <header style="text-align:center; margin-bottom:18px;">
    <div style="display:flex; justify-content:center;">${logo(true)}</div>
    <div class="mono" style="color:var(--faint); font-size:12px; margin-top:12px; letter-spacing:0.04em;">your balance, judged in real time</div>
  </header>
  <div id="app"><div class="pr-card pr-empty">Loading…</div></div>
  <footer style="text-align:center; color:var(--faint-2); font-size:12px; padding-top:28px;">not affiliated with DESCO · alerts keep running even if you never open this page</footer>
</div>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
<script>
const token = ${JSON.stringify(token)};
${CLIENT_HELPERS}
${CHART_SCRIPT}

function statusOf(m) {
  if (m.balance === null) return { label: 'NO DATA', pill: 'pr-pill', cls: 'muted' };
  if (m.balance < m.criticalThreshold) return { label: 'CRITICAL', pill: 'pr-pill crit siren', cls: 'critical' };
  if (m.balance < m.lowThreshold) return { label: 'LOW', pill: 'pr-pill low', cls: 'low' };
  return { label: 'HEALTHY', pill: 'pr-pill ok', cls: 'ok' };
}

function statRow(meters) {
  const total = meters.reduce((a, m) => a + (m.balance ?? 0), 0);
  const atRisk = meters.filter(m => m.balance !== null && m.balance < m.lowThreshold).length;
  const crit = meters.filter(m => m.balance !== null && m.balance < m.criticalThreshold).length;
  const preds = meters.map(m => m.prediction && m.prediction.daysLeft).filter(d => typeof d === 'number');
  const soon = preds.length ? Math.min.apply(null, preds) : null;
  return '<div class="pr-statrow" style="margin-bottom:18px">' +
    '<div class="pr-stat"><div class="k">Total balance</div><div class="n">' + fmt(total) + '</div></div>' +
    '<div class="pr-stat"><div class="k">Meters at risk</div><div class="n ' + (atRisk ? 'red' : 'green') + '">' + atRisk + ' <span class="muted" style="font-size:14px;font-weight:600">of ' + meters.length + '</span></div><div class="d ' + (crit ? 'down' : '') + '">' + crit + ' critical</div></div>' +
    '<div class="pr-stat"><div class="k">Soonest run-out</div><div class="n ' + (soon !== null && soon < 4 ? 'red' : 'gold') + '">' + (soon === null ? '—' : '~' + soon.toFixed(soon < 10 ? 1 : 0) + ' days') + '</div></div>' +
  '</div>';
}

function meterCard(m) {
  const st = statusOf(m);
  const card = document.createElement('div');
  card.className = 'pr-card';
  card.style.marginBottom = '18px';
  card.innerHTML =
    '<div class="pr-section-head" style="align-items:flex-start;margin-bottom:4px">' +
      '<div style="min-width:0">' +
        '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:4px">' +
          '<span style="font-size:17px;font-weight:800;color:var(--text);letter-spacing:-0.01em">' + esc(m.label) + '</span>' +
          '<span class="' + st.pill + '"><span class="dot"></span>' + st.label + '</span>' +
        '</div>' +
        (m.prediction ? '<div class="mono" style="font-size:11.5px;color:var(--faint)">~' + m.prediction.daysLeft.toFixed(1) + ' days left · ' + fmt(m.prediction.burnPerDay) + '/day</div>' : '') +
      '</div>' +
      '<div class="balance ' + st.cls + '" style="font-size:26px;font-weight:800;letter-spacing:-0.02em">' + fmt(m.balance) + '</div>' +
    '</div>' +
    '<div class="pr-chart"><canvas></canvas></div>';
  setTimeout(() => window.prChart(card.querySelector('canvas'), m.readings, { low: m.lowThreshold, critical: m.criticalThreshold }), 0);
  return card;
}

function levelPill(level) {
  const cls = level === 'critical' ? 'crit' : level === 'low' ? 'low' : 'ok';
  return '<span class="pr-pill ' + cls + '">' + esc(level) + '</span>';
}

async function load() {
  const res = await fetch('/dash/data?t=' + encodeURIComponent(token));
  const app = document.getElementById('app');
  if (!res.ok) {
    app.innerHTML = '<div class="pr-card pr-empty">This link expired. Ask the bot for a fresh one with /dashboard.</div>';
    return;
  }
  const data = await res.json();
  if (!data.meters.length) {
    app.innerHTML = '<div class="pr-card pr-empty">No active meters. Message the bot: /register</div>';
    return;
  }
  app.innerHTML = statRow(data.meters);
  for (const m of data.meters) app.appendChild(meterCard(m));
  if (data.alerts.length) {
    const card = document.createElement('div');
    card.className = 'pr-card';
    card.innerHTML = '<div class="pr-card-title" style="margin-bottom:8px">Recent roasts</div>' +
      '<div class="pr-tableshell" style="overflow-x:auto"><table class="pr-table"><tbody>' +
      data.alerts.map(a => '<tr><td class="mono muted">' + when(a.sentAt) + '</td><td>' + esc(a.action) + '</td><td>' + levelPill(a.level) + '</td></tr>').join('') +
      '</tbody></table></div>';
    app.appendChild(card);
  }
}
load();
</script>`;

  return pageDoc('Power Roast — Dashboard', body);
}
