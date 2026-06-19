// Customer web app: login screen + the signed-in app shell. Same dark,
// roast-branded look as dashboard-html.ts / admin-html.ts, Chart.js from the
// same CDN, vanilla JS against /app/api/*.

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
  main { max-width: 760px; margin: 0 auto; padding: 16px; }
  .card { background: #161616; border: 1px solid #2a2a2a; border-radius: 14px; padding: 18px; margin-top: 16px; }
  .tagline { color: #888; font-size: 13px; }
  input, button, label { font: inherit; }
  input[type=text], input[type=email], input[type=number] { background: #0d0d0d; color: #eee; border: 1px solid #333; border-radius: 8px; padding: 9px 11px; }
  button { background: #f59e0b; color: #111; border: 0; border-radius: 8px; padding: 9px 14px; font-weight: 600; cursor: pointer; }
  button.ghost { background: transparent; color: #ccc; border: 1px solid #333; }
  button.danger { background: #b91c1c; color: #fff; }
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .spacer { flex: 1; }
  .muted { color: #888; } .pill { font-size: 12px; padding: 2px 8px; border-radius: 999px; border: 1px solid #333; }
  .ok { color: #4ade80; } .low { color: #facc15; } .critical { color: #f87171; }
  .balance { font-size: 26px; font-weight: 800; }
  .meter-name { font-size: 17px; font-weight: 600; }
  .empty { color: #888; text-align: center; padding: 28px 0; }
  .err { color: #f87171; font-size: 13px; min-height: 16px; }
  .good { color: #4ade80; font-size: 13px; min-height: 16px; }
  canvas { margin-top: 12px; }
  .controls { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; align-items: center; }
  .controls input { width: 90px; }
  footer { text-align: center; color: #555; font-size: 12px; padding: 24px; }
</style>`;

function page(title: string, body: string): string {
  return `<!DOCTYPE html><html lang="en"><head>${HEAD}<title>${title}</title></head><body>${body}</body></html>`;
}

const LOGIN_STATUS: Record<string, { cls: string; msg: string }> = {
  sent: {
    cls: 'good',
    msg: '✅ Check your inbox - we emailed you a sign-in link (good for 20 minutes).',
  },
  bademail: { cls: 'err', msg: "That doesn't look like an email address." },
  ratelimited: { cls: 'err', msg: 'Too many requests. Wait a few minutes and try again.' },
  sendfailed: { cls: 'err', msg: "Couldn't send the email just now. Try again in a bit." },
  badlink: { cls: 'err', msg: 'That sign-in link is invalid or expired. Request a new one.' },
  disabled: { cls: 'err', msg: 'Email sign-in is not configured on this server yet.' },
};

export function loginHtml(mailEnabled: boolean, status: string | null): string {
  const s = status ? LOGIN_STATUS[status] : undefined;
  const notice = s ? `<p class="${s.cls}" style="margin:0 0 12px">${s.msg}</p>` : '';
  const form = mailEnabled
    ? `<form class="card" method="POST" action="/app/login">
    <p class="muted" style="margin:0 0 12px">Enter your email and we'll send you a one-tap sign-in link. No password needed.</p>
    ${notice}
    <div class="row">
      <input type="email" name="email" placeholder="you@example.com" autofocus required style="flex:1;min-width:200px">
      <button type="submit">Send link</button>
    </div>
  </form>`
    : `<div class="card"><p class="err" style="margin:0">Email sign-in is not configured on this server yet.</p></div>`;
  return page(
    'Power Roast',
    `<main style="max-width:440px;margin-top:10vh">
  <h1>⚡ Power <span>Roast</span></h1>
  <p class="tagline">Watch your prepaid balance. Get roasted before the lights go out.</p>
  ${form}
</main>`
  );
}

export function appShellHtml(csrf: string): string {
  return page(
    'Power Roast',
    `<header>
  <h1>⚡ Power <span>Roast</span></h1>
  <form method="POST" action="/app/logout" style="margin:0"><button class="ghost" type="submit">Sign out</button></form>
</header>
<main id="app"><div class="card empty">Loading…</div></main>
<footer>not affiliated with DESCO · alerts keep running even when this page is closed</footer>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
<script>
const CSRF = ${JSON.stringify(csrf)};
const fmt = n => n === null ? '—' : '\\u09F3' + Number(n).toFixed(2);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);

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

function cls(m) {
  if (m.balance === null) return 'ok';
  return m.balance < m.criticalThreshold ? 'critical' : m.balance < m.lowThreshold ? 'low' : 'ok';
}

function meterCard(m) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML =
    '<div class="row"><span class="meter-name">📟 ' + esc(m.label) + '</span><div class="spacer"></div>' +
    '<span class="balance ' + cls(m) + '">' + fmt(m.balance) + '</span></div>' +
    '<div class="muted" style="font-size:13px">acct ' + esc(m.accountNo) + ' · meter ' + esc(m.meterNo) + '</div>' +
    (m.prediction ? '<div style="color:#c4b5fd;font-size:13px;margin-top:4px">🔮 ~' + m.prediction.daysLeft.toFixed(1) + ' days left at ' + fmt(m.prediction.burnPerDay) + '/day</div>' : '') +
    '<canvas height="100"></canvas>' +
    '<div class="controls">' +
      '<label class="muted">Warn under</label><input type="number" class="low" value="' + m.lowThreshold + '">' +
      '<label class="muted">Panic under</label><input type="number" class="crit" value="' + m.criticalThreshold + '">' +
      '<button class="setThresh">Save</button>' +
    '</div>' +
    '<div class="controls">' +
      '<input type="text" class="nick" placeholder="Nickname (e.g. Flat 3B)" style="width:auto;flex:1">' +
      '<button class="setNick ghost">Rename</button>' +
      '<button class="pause ghost">Pause</button>' +
    '</div>' +
    '<p class="err meterErr"></p>';
  const err = card.querySelector('.meterErr');
  const guard = fn => async () => { err.textContent = ''; try { await fn(); await render(); } catch (e) { err.textContent = e.message; } };
  card.querySelector('.setThresh').onclick = guard(() =>
    post('/meters/' + m.id + '/threshold', { low: Number(card.querySelector('.low').value), critical: Number(card.querySelector('.crit').value) }));
  card.querySelector('.setNick').onclick = guard(() =>
    post('/meters/' + m.id + '/nickname', { name: card.querySelector('.nick').value }));
  card.querySelector('.pause').onclick = guard(async () => {
    if (!confirm('Pause monitoring for this meter?')) throw new Error('');
    await post('/meters/' + m.id + '/pause');
  });
  setTimeout(() => new Chart(card.querySelector('canvas'), {
    type: 'line',
    data: {
      labels: m.readings.map(r => new Date(r.t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })),
      datasets: [{ data: m.readings.map(r => r.balance), borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,.12)', fill: true, pointRadius: 0, tension: .3, borderWidth: 2 }],
    },
    options: { plugins: { legend: { display: false } }, scales: { x: { ticks: { maxTicksLimit: 7, color: '#777' }, grid: { display: false } }, y: { ticks: { color: '#777' }, grid: { color: '#222' } } } },
  }), 0);
  return card;
}

async function render() {
  const d = await getMe();
  const app = document.getElementById('app');
  app.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'card';
  head.innerHTML =
    '<div class="row"><span class="pill">' + esc(d.plan) + '</span>' +
    '<span class="muted">' + esc(d.email) + ' · up to ' + esc(d.limits.maxMeters) + ' meter(s)</span></div>' +
    '<label class="row" style="margin-top:10px;cursor:pointer"><input type="checkbox" id="emailToggle"' + (d.emailAlerts ? ' checked' : '') + '> Email me low/critical alerts</label>' +
    '<p class="err" id="headErr"></p>';
  app.appendChild(head);
  head.querySelector('#emailToggle').onchange = async (e) => {
    document.getElementById('headErr').textContent = '';
    try { await post('/alerts/email', { enabled: e.target.checked }); } catch (err) { document.getElementById('headErr').textContent = err.message; }
  };

  if (!d.meters.length) {
    const empty = document.createElement('div');
    empty.className = 'card empty';
    empty.textContent = 'No meters yet. Add one below to start watching it.';
    app.appendChild(empty);
  } else {
    for (const m of d.meters) app.appendChild(meterCard(m));
  }

  const add = document.createElement('div');
  add.className = 'card';
  add.innerHTML =
    '<div class="meter-name">Add a meter</div>' +
    '<p class="muted" style="font-size:13px;margin:4px 0 10px">Find these on your DESCO bill or the DESCO prepaid portal.</p>' +
    '<div class="controls">' +
      '<input type="text" id="acct" placeholder="Account number" style="width:auto;flex:1">' +
      '<input type="text" id="meter" placeholder="Meter number" style="width:auto;flex:1">' +
      '<button id="addBtn">Add</button>' +
    '</div><p class="err" id="addErr"></p>';
  app.appendChild(add);
  add.querySelector('#addBtn').onclick = async () => {
    const errEl = document.getElementById('addErr');
    errEl.textContent = '';
    try {
      await post('/meters', { accountNo: document.getElementById('acct').value.trim(), meterNo: document.getElementById('meter').value.trim() });
      await render();
    } catch (e) { errEl.textContent = e.message; }
  };

  const danger = document.createElement('div');
  danger.className = 'card';
  danger.innerHTML = '<div class="row"><span class="muted">Delete your account and all data, permanently.</span><div class="spacer"></div><button class="danger" id="del">Delete account</button></div>';
  app.appendChild(danger);
  danger.querySelector('#del').onclick = async () => {
    if (prompt('This erases your account and ALL data. Type DELETE to confirm.') !== 'DELETE') return;
    try { await post('/account/delete'); location.href = '/app'; } catch (e) { alert(e.message); }
  };
}

render().catch(() => {
  document.getElementById('app').innerHTML = '<div class="card empty">Something broke. Reload the page.</div>';
});
</script>`
  );
}
