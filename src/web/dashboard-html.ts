// Single-file dashboard: compact, dark, Linear-inspired, Chart.js from CDN. Fetches
// /dash/data with the same token and renders balance history per meter. Shares the
// visual language (tokens, Inter, hairline borders, amber accent) with the admin panel.
export function dashboardHtml(token: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<link rel="stylesheet" href="https://rsms.me/inter/inter.css">
<title>Power Roast - Dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
<style>
  :root {
    color-scheme: dark;
    --bg: #08090a;
    --surface: #161618;
    --border-soft: rgba(255,255,255,.06);
    --text: #f7f8f8;
    --text-2: #d3d4d8;
    --muted: #8a8f98;
    --faint: #5c606a;
    --accent: #f59e0b;
    --ok: #5bc983;
    --low: #f5c451;
    --crit: #f87171;
    --r-lg: 10px;
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

  header { padding: 32px 20px 4px; text-align: center; }
  h1 {
    margin: 0; font-size: 20px; font-weight: 600; color: var(--text);
    display: inline-flex; align-items: center; gap: 8px; letter-spacing: -.01em;
  }
  h1 .mark { color: var(--accent); }
  .tagline { color: var(--muted); font-size: 13px; margin-top: 6px; }

  main { max-width: 760px; margin: 0 auto; padding: 12px 16px 48px; }
  .card {
    background: var(--surface);
    border: 1px solid var(--border-soft);
    border-radius: var(--r-lg);
    padding: 16px;
    margin-top: 14px;
  }

  .meter-head { display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 6px; }
  .meter-name { font-size: 15px; font-weight: 600; color: var(--text); }
  .balance { font-size: 24px; font-weight: 600; letter-spacing: -.02em; font-feature-settings: 'tnum' 1; }
  .ok { color: var(--ok); } .low { color: var(--low); } .critical { color: var(--crit); }
  .prediction { color: var(--muted); font-size: 13px; margin-top: 4px; }
  canvas { margin-top: 10px; }

  .table-wrap { overflow-x: auto; margin-top: 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  td { padding: 8px 4px; border-top: 1px solid var(--border-soft); color: var(--text-2); white-space: nowrap; }
  tr:first-child td { border-top: 0; }
  .empty { color: var(--muted); text-align: center; padding: 32px 0; }
  footer { text-align: center; color: var(--faint); font-size: 12px; padding-bottom: 28px; }

  @media (max-width: 640px) {
    header { padding: 24px 16px 4px; }
    main { padding: 10px 14px 40px; }
  }
</style>
</head>
<body>
<header>
  <h1><span class="mark">⚡</span> Power Roast</h1>
  <div class="tagline">your balance, judged in real time</div>
</header>
<main id="app"><div class="card empty">Loading…</div></main>
<footer>not affiliated with DESCO · alerts keep running even if you never open this page</footer>
<script>
const token = ${JSON.stringify(token)};
const fmt = n => '\\u09F3' + n.toFixed(2);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
async function load() {
  const res = await fetch('/dash/data?t=' + encodeURIComponent(token));
  const app = document.getElementById('app');
  if (!res.ok) {
    app.innerHTML = '<div class="card empty">This link expired. Ask the bot for a fresh one with /dashboard.</div>';
    return;
  }
  const data = await res.json();
  if (!data.meters.length) {
    app.innerHTML = '<div class="card empty">No active meters. Message the bot: /register</div>';
    return;
  }
  app.innerHTML = '';
  for (const meter of data.meters) {
    const cls = meter.balance === null ? 'ok' : meter.balance < meter.criticalThreshold ? 'critical' : meter.balance < meter.lowThreshold ? 'low' : 'ok';
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML =
      '<div class="meter-head"><span class="meter-name">' + esc(meter.label) + '</span>' +
      '<span class="balance ' + cls + '">' + (meter.balance === null ? '—' : fmt(meter.balance)) + '</span></div>' +
      (meter.prediction ? '<div class="prediction">~' + meter.prediction.daysLeft.toFixed(1) + ' days left · ' + fmt(meter.prediction.burnPerDay) + '/day</div>' : '') +
      '<canvas height="100"></canvas>';
    app.appendChild(card);
    new Chart(card.querySelector('canvas'), {
      type: 'line',
      data: {
        labels: meter.readings.map(r => new Date(r.t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })),
        datasets: [{
          data: meter.readings.map(r => r.balance),
          borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,.1)',
          fill: true, pointRadius: 0, tension: .35, borderWidth: 1.5,
        }],
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
  if (data.alerts.length) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = '<div class="meter-name">Recent roasts</div><div class="table-wrap"><table>' +
      data.alerts.map(a =>
        '<tr><td>' + new Date(a.sentAt).toLocaleString() + '</td><td>' + a.action + '</td><td class="' + a.level + '">' + a.level + '</td></tr>'
      ).join('') + '</table></div>';
    app.appendChild(card);
  }
}
load();
</script>
</body>
</html>`;
}
