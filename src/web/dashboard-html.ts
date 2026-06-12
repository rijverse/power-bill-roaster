// Single-file dashboard: dark, roast-branded, Chart.js from CDN. Fetches
// /dash/data with the same token and renders balance history per meter.
export function dashboardHtml(token: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Power Roast - Dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #0d0d0d; color: #eee; font-family: 'Segoe UI', system-ui, sans-serif; }
  header { padding: 24px 20px 8px; text-align: center; }
  h1 { margin: 0; font-size: 26px; }
  h1 span { color: #f59e0b; }
  .tagline { color: #888; font-size: 13px; margin-top: 4px; }
  main { max-width: 760px; margin: 0 auto; padding: 12px 16px 48px; }
  .card { background: #161616; border: 1px solid #2a2a2a; border-radius: 14px; padding: 18px; margin-top: 16px; }
  .meter-head { display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 6px; }
  .meter-name { font-size: 17px; font-weight: 600; }
  .balance { font-size: 28px; font-weight: 800; }
  .ok { color: #4ade80; } .low { color: #facc15; } .critical { color: #f87171; }
  .prediction { color: #c4b5fd; font-size: 13px; margin-top: 4px; }
  canvas { margin-top: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }
  td { padding: 6px 4px; border-top: 1px solid #2a2a2a; color: #bbb; }
  .empty { color: #888; text-align: center; padding: 32px 0; }
  footer { text-align: center; color: #555; font-size: 12px; padding-bottom: 24px; }
</style>
</head>
<body>
<header>
  <h1>⚡ Power <span>Roast</span></h1>
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
      '<div class="meter-head"><span class="meter-name">📟 ' + esc(meter.label) + '</span>' +
      '<span class="balance ' + cls + '">' + (meter.balance === null ? '—' : fmt(meter.balance)) + '</span></div>' +
      (meter.prediction ? '<div class="prediction">🔮 ~' + meter.prediction.daysLeft.toFixed(1) + ' days left at ' + fmt(meter.prediction.burnPerDay) + '/day</div>' : '') +
      '<canvas height="110"></canvas>';
    app.appendChild(card);
    new Chart(card.querySelector('canvas'), {
      type: 'line',
      data: {
        labels: meter.readings.map(r => new Date(r.t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })),
        datasets: [{
          data: meter.readings.map(r => r.balance),
          borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,.12)',
          fill: true, pointRadius: 0, tension: .3, borderWidth: 2,
        }],
      },
      options: {
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { maxTicksLimit: 7, color: '#777' }, grid: { display: false } },
          y: { ticks: { color: '#777' }, grid: { color: '#222' } },
        },
      },
    });
  }
  if (data.alerts.length) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = '<div class="meter-name">Recent roasts</div><table>' +
      data.alerts.map(a =>
        '<tr><td>' + new Date(a.sentAt).toLocaleString() + '</td><td>' + a.action + '</td><td class="' + a.level + '">' + a.level + '</td></tr>'
      ).join('') + '</table>';
    app.appendChild(card);
  }
}
load();
</script>
</body>
</html>`;
}
