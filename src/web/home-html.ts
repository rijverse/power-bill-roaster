// Public marketing landing page served at GET /. Rebuilt on the shared theme.ts
// design system (zinc surfaces, amber accent) so it matches the app, and kept
// CSP-safe: inline styles only, an SVG chart instead of Chart.js, no new CDNs.
import { pageDoc, logo } from './theme';

const GITHUB = 'https://github.com/rijverse/power-bill-roaster';

// landing-only layout, scoped under .lp- so it can't collide with the app's .pr-
// classes. colours/radii/fonts all come from the theme tokens.
const STYLE = `
.lp-nav { position: sticky; top: 0; z-index: 50; display: flex; align-items: center; gap: 22px; padding: 14px 28px; background: rgba(9,9,11,0.82); backdrop-filter: blur(10px); border-bottom: 1px solid var(--border); }
.lp-nav .links { display: flex; gap: 22px; margin-left: 14px; }
.lp-nav .links a { color: var(--muted); font-size: 14px; font-weight: 500; }
.lp-nav .links a:hover { color: var(--text); text-decoration: none; }
.lp-nav .right { margin-left: auto; display: flex; align-items: center; gap: 10px; }

.lp-wrap { max-width: 1120px; margin: 0 auto; padding: 0 28px; position: relative; z-index: 1; }
.lp-section { padding: 84px 0; border-top: 1px solid var(--border-soft); }
.lp-eyebrow { display: inline-flex; align-items: center; gap: 7px; font-family: var(--mono); font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--gold); background: rgba(251,176,36,0.1); border: 1px solid rgba(251,176,36,0.22); padding: 5px 11px; border-radius: 999px; }
.lp-h1 { font-size: 56px; line-height: 1.03; letter-spacing: -0.035em; font-weight: 800; color: var(--text); margin: 20px 0 18px; }
.lp-h1 .hl { color: var(--gold); }
.lp-h2 { font-size: 34px; line-height: 1.1; letter-spacing: -0.03em; font-weight: 800; color: var(--text); }
.lp-lead { font-size: 18px; line-height: 1.6; color: var(--text-3); max-width: 540px; }
.lp-sub { font-size: 16px; line-height: 1.6; color: var(--muted); max-width: 620px; margin: 12px auto 0; }
.lp-center { text-align: center; }
.lp-center .lp-sub, .lp-center .lp-h2 { margin-left: auto; margin-right: auto; }
.lp-head { margin-bottom: 44px; }

.lp-hero { display: grid; grid-template-columns: 1.05fr 0.95fr; gap: 56px; align-items: center; padding: 72px 0 64px; }
.lp-ctarow { display: flex; gap: 12px; flex-wrap: wrap; margin: 28px 0 22px; }
.lp-checks { display: flex; gap: 20px; flex-wrap: wrap; }
.lp-check { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; color: var(--text-3); }
.lp-check svg { color: var(--gold); flex: none; }

/* alert preview card in the hero */
.lp-preview { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-lg); padding: 18px; box-shadow: 0 24px 60px rgba(0,0,0,0.5); }
.lp-pvhead { display: flex; align-items: center; gap: 10px; padding-bottom: 14px; border-bottom: 1px solid var(--border-soft); }
.lp-pvmeter { display: flex; align-items: center; gap: 12px; padding: 16px 0 14px; }
.lp-pvbal { font-size: 30px; font-weight: 800; letter-spacing: -0.03em; color: var(--text); font-feature-settings: 'tnum' 1; }
.lp-pvmsg { font-size: 13.5px; line-height: 1.55; color: var(--text-2); background: var(--bg); border: 1px solid var(--border-soft); border-radius: var(--r); padding: 13px 14px; }

/* marquee strip */
.lp-strip { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px 0; align-items: center; padding: 20px 0; border-top: 1px solid var(--border-soft); border-bottom: 1px solid var(--border-soft); }
.lp-strip span { font-family: var(--mono); font-size: 12px; color: var(--faint); padding: 0 22px; }
.lp-strip span + span { border-left: 1px solid var(--border); }

.lp-2col { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.lp-split { display: grid; grid-template-columns: 1fr 1fr; gap: 44px; align-items: center; }

/* roast threshold cards */
.lp-roast { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-lg); padding: 24px; }
.lp-roast.crit { border-color: rgba(255,82,71,0.3); }
.lp-roast .tag { display: inline-flex; align-items: center; gap: 6px; font-family: var(--mono); font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
.lp-roast.warn .tag { color: var(--gold); }
.lp-roast.crit .tag { color: var(--red-soft); }
.lp-roast .q { font-size: 21px; font-weight: 800; letter-spacing: -0.02em; color: var(--text); margin: 14px 0 8px; }
.lp-roast .a { font-size: 14px; line-height: 1.6; color: var(--muted); }
.lp-roast .thr { font-family: var(--mono); font-size: 12px; color: var(--faint); margin-top: 14px; }

.lp-bullets { display: flex; flex-direction: column; gap: 14px; margin-top: 22px; }
.lp-bullet { display: flex; gap: 11px; align-items: flex-start; font-size: 14.5px; line-height: 1.5; color: var(--text-2); }
.lp-bullet svg { color: var(--gold); flex: none; margin-top: 2px; }
.lp-bullet code { font-family: var(--mono); font-size: 12.5px; background: var(--surface-2); padding: 1px 6px; border-radius: 5px; color: var(--text); }

/* email preview */
.lp-mail { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-lg); overflow: hidden; box-shadow: 0 24px 60px rgba(0,0,0,0.5); }
.lp-mailbar { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: var(--surface-2); border-bottom: 1px solid var(--border); font-family: var(--mono); font-size: 11px; color: var(--faint); }
.lp-mailbody { padding: 18px; }
.lp-mailsub { font-size: 16px; font-weight: 800; color: var(--text); }
.lp-mailmeta { font-size: 12px; color: var(--faint); margin: 3px 0 14px; }
.lp-mailfig { display: flex; gap: 26px; margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--border-soft); }
.lp-mailfig .k { font-family: var(--mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--faint); }
.lp-mailfig .v { font-size: 22px; font-weight: 800; color: var(--text); }
.lp-mailfig .v.crit { color: var(--red-soft); }

/* chart */
.lp-chartcard { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-lg); padding: 22px; }
.lp-chartcard svg { width: 100%; height: auto; display: block; }
.lp-chrow { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.lp-axis { display: flex; justify-content: space-between; font-family: var(--mono); font-size: 11px; color: var(--faint); margin-top: 8px; }

/* feature grid */
.lp-grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
.lp-feature { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-lg); padding: 22px; }
.lp-feicon { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 10px; background: rgba(251,176,36,0.1); color: var(--gold); margin-bottom: 14px; }
.lp-feature h3 { font-size: 16px; font-weight: 700; color: var(--text); margin-bottom: 7px; }
.lp-feature p { font-size: 14px; line-height: 1.55; color: var(--muted); }

/* two-path cards */
.lp-path { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-lg); padding: 28px; }
.lp-path.bot { border-color: rgba(251,176,36,0.3); }
.lp-path h3 { font-size: 20px; font-weight: 800; color: var(--text); margin-bottom: 8px; }
.lp-path p { font-size: 14.5px; line-height: 1.6; color: var(--muted); margin-bottom: 18px; }

/* pricing */
.lp-prices { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; align-items: start; }
.lp-price { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-lg); padding: 26px; }
.lp-price.pop { border: 1.5px solid var(--gold); box-shadow: 0 20px 50px rgba(251,176,36,0.1); }
.lp-price .pname { font-size: 14px; font-weight: 700; color: var(--text-2); }
.lp-price .pop-badge { float: right; font-family: var(--mono); font-size: 10px; font-weight: 700; letter-spacing: 0.06em; color: var(--ink); background: var(--gold); padding: 3px 9px; border-radius: 999px; }
.lp-price .amt { font-size: 40px; font-weight: 800; letter-spacing: -0.03em; color: var(--text); margin: 14px 0 2px; }
.lp-price .amt span { font-size: 14px; font-weight: 500; color: var(--faint); letter-spacing: 0; }
.lp-price .blurb { font-size: 13.5px; color: var(--muted); min-height: 38px; margin-bottom: 18px; }
.lp-price .pfeat { display: flex; flex-direction: column; gap: 11px; margin-bottom: 22px; }
.lp-pricenote { text-align: center; font-size: 13px; color: var(--faint); margin-top: 22px; }

/* setup / .env */
.lp-code { background: #060608; border: 1px solid var(--border); border-radius: var(--r-lg); padding: 18px 20px; font-family: var(--mono); font-size: 13px; line-height: 1.85; overflow-x: auto; white-space: pre; }
.lp-code .c { color: var(--faint); }
.lp-code .k { color: var(--gold); }
.lp-code .v { color: var(--text-2); }
.lp-stack-chips { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 20px; }
.lp-chiptag { font-family: var(--mono); font-size: 12px; color: var(--text-2); background: var(--surface-2); border: 1px solid var(--border); border-radius: 999px; padding: 5px 12px; }

/* final cta */
.lp-final { text-align: center; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-lg); padding: 56px 28px; }
.lp-final .lp-ctarow { justify-content: center; }

.lp-footer { border-top: 1px solid var(--border-soft); padding: 26px 28px; display: flex; align-items: center; gap: 20px; flex-wrap: wrap; }
.lp-footer .links { display: flex; gap: 20px; margin-left: auto; flex-wrap: wrap; }
.lp-footer .links a { color: var(--muted); font-size: 13px; }
.lp-disclaimer { color: var(--faint); font-size: 12px; }

@media (max-width: 880px) {
  .lp-nav .links { display: none; }
  .lp-hero, .lp-split, .lp-2col, .lp-grid3, .lp-prices { grid-template-columns: 1fr; }
  .lp-hero { padding: 40px 0; gap: 36px; }
  .lp-h1 { font-size: 40px; }
  .lp-h2 { font-size: 27px; }
  .lp-section { padding: 56px 0; }
  .lp-price.pop { order: -1; }
}`;

// a few inline lucide-style glyphs (stroke = currentColor) so the page needs no
// icon font or CDN.
const I = {
  check:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  star: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/></svg>',
  clock:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  msg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  trend:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 17 13.5 8.5l-5 5L2 7"/><path d="M16 17h6v-6"/></svg>',
  layers:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/></svg>',
  git: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.9a3.4 3.4 0 0 0-1-2.6c3-.3 6-1.5 6-6.6a5.1 5.1 0 0 0-1.4-3.5 4.8 4.8 0 0 0-.1-3.5s-1.1-.3-3.5 1.3a12 12 0 0 0-6.4 0C6.3 1.6 5.2 1.9 5.2 1.9a4.8 4.8 0 0 0-.1 3.5A5.1 5.1 0 0 0 3.7 9c0 5 3 6.3 6 6.6a3.4 3.4 0 0 0-1 2.6V22"/></svg>',
  sliders:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></svg>',
};

function check(text: string): string {
  return `<div class="lp-check">${I.check}<span>${text}</span></div>`;
}

function bullet(html: string): string {
  return `<div class="lp-bullet">${I.check}<div>${html}</div></div>`;
}

function feature(icon: string, title: string, body: string): string {
  return `<div class="lp-feature"><div class="lp-feicon">${icon}</div><h3>${title}</h3><p>${body}</p></div>`;
}

function priceFeat(text: string): string {
  return `<div class="lp-bullet" style="font-size:13.5px">${I.check}<div>${text}</div></div>`;
}

// hand-drawn 14-day decline: amber line + fill, dashed low/critical lines, ending
// well below both (a meter on its way to zero).
function declineChart(): string {
  const pts =
    '8,30 60,44 116,38 172,70 228,64 284,96 340,104 396,128 452,150 508,160 564,180 624,196';
  const fill = `8,30 ${pts.split(' ').slice(1).join(' ')} 624,230 8,230`;
  return `<svg viewBox="0 0 640 230" preserveAspectRatio="none" role="img" aria-label="Balance declining over 14 days">
    <defs><linearGradient id="lpfill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="rgba(251,176,36,0.28)"/><stop offset="1" stop-color="rgba(251,176,36,0)"/>
    </linearGradient></defs>
    <line x1="0" y1="150" x2="640" y2="150" stroke="rgba(251,176,36,0.45)" stroke-width="1" stroke-dasharray="5 5"/>
    <line x1="0" y1="178" x2="640" y2="178" stroke="rgba(255,82,71,0.5)" stroke-width="1" stroke-dasharray="5 5"/>
    <polygon points="${fill}" fill="url(#lpfill)"/>
    <polyline points="${pts}" fill="none" stroke="#FBB024" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="624" cy="196" r="4" fill="#FF5247"/>
    <text x="636" y="146" text-anchor="end" font-family="monospace" font-size="11" fill="#71717A">৳150</text>
    <text x="636" y="174" text-anchor="end" font-family="monospace" font-size="11" fill="#71717A">৳100</text>
  </svg>`;
}

export function homeHtml(): string {
  const nav = `<nav class="lp-nav">
    ${logo()}
    <div class="links">
      <a href="#how">How it works</a>
      <a href="#dashboard">Dashboard</a>
      <a href="#pricing">Pricing</a>
      <a href="#selfhost">Self-host</a>
    </div>
    <div class="right">
      <a class="pr-btn ghost sm" href="${GITHUB}" target="_blank" rel="noopener">${I.star} Star on GitHub</a>
      <a class="pr-btn gold sm" href="/app">Start the bot</a>
    </div>
  </nav>`;

  const hero = `<section class="lp-wrap" id="top">
    <div class="lp-hero">
      <div>
        <span class="lp-eyebrow">DESCO prepaid · brutally honest alerts</span>
        <h1 class="lp-h1">Recharge now, or get <span class="hl">roasted</span> in the dark.</h1>
        <p class="lp-lead">Your prepaid balance is one bad day from zero — and after how you've treated that meter, can you blame it for wanting out? Power·Roast emails you before the lights do.</p>
        <div class="lp-ctarow">
          <a class="pr-btn gold" href="/app">${I.msg} Message the bot</a>
          <a class="pr-btn ghost" href="${GITHUB}" target="_blank" rel="noopener">${I.git} Self-host free</a>
        </div>
        <div class="lp-checks">
          ${check('Free forever, self-hosted')}${check('Open source · MIT')}${check('No app to install')}
        </div>
      </div>
      <div class="lp-preview">
        <div class="lp-pvhead">${logo()}<span class="pr-pill crit siren" style="margin-left:auto"><span class="dot"></span>CRITICAL</span></div>
        <div class="lp-pvmeter">
          <div><div class="lp-pvbal">৳42.50</div><div class="mono" style="font-size:12px;color:var(--faint)">Meter #0227 · ~3 days left</div></div>
          <a class="pr-btn gold sm" href="/app" style="margin-left:auto">Recharge →</a>
        </div>
        <div class="lp-pvmsg">Bro. ৳42.50? That's not a balance, that's a cry for help. Your meter is one warm fridge away from cutting you off mid-Netflix. Recharge now — or start practicing your shadow puppets.</div>
      </div>
    </div>
    <div class="lp-strip">
      <span>Checks every 6 hours</span><span>Email · Telegram · SMS</span><span>Run-out predictions</span><span>Multi-meter</span><span>Zero servers to self-host</span>
    </div>
  </section>`;

  const thresholds = `<section class="lp-section" id="how"><div class="lp-wrap">
    <div class="lp-head lp-center">
      <h2 class="lp-h2">Two thresholds. One very tired meter.</h2>
      <p class="lp-sub">Both limits are configurable. Cross them and the bot gets progressively less polite about your life choices.</p>
    </div>
    <div class="lp-2col">
      <div class="lp-roast warn">
        <span class="tag">⚠ Warning shot · below ৳150</span>
        <div class="q">"Your Electricity About to Ghost You."</div>
        <div class="a">Translation: recharge before you're explaining to your family why the fridge is suddenly "a cabinet."</div>
        <div class="thr">below ৳150</div>
      </div>
      <div class="lp-roast crit">
        <span class="tag">💀 DEFCON 1 · below ৳100</span>
        <div class="q">"You're About to Live in the Stone Age."</div>
        <div class="a">Light a candle. Sharpen a stick. This is DEFCON 1 and your meter is not bluffing.</div>
        <div class="thr">below ৳100</div>
      </div>
    </div>
  </div></section>`;

  const inbox = `<section class="lp-section"><div class="lp-wrap"><div class="lp-split">
    <div>
      <h2 class="lp-h2">It hits your inbox like a disappointed parent.</h2>
      <p class="lp-lead" style="margin-top:14px">Every check runs the same pipeline: verify config, fetch your live DESCO balance, validate the response, compare against your thresholds — then, if you're too low, blast an email that pulls no punches.</p>
      <div class="lp-bullets">
        ${bullet("Live balance, straight from DESCO's prepaid API — not a guess.")}
        ${bullet('Configurable thresholds — defaults ৳150 / ৳100, tune them to taste.')}
        ${bullet('Tone it down if you must — the templates live in <code>src/templates/</code>.')}
      </div>
    </div>
    <div class="lp-mail">
      <div class="lp-mailbar"><span>inbox — 1 unread</span><span>07:42</span></div>
      <div class="lp-mailbody">
        <div class="lp-mailsub">⚡ Your Electricity About to Ghost You</div>
        <div class="lp-mailmeta">roast@power-roast.app</div>
        <div class="lp-pvmsg">Bro. ৳42.50? That's not a balance, that's a cry for help. Your meter is one warm fridge away from cutting you off mid-Netflix. Recharge now — or start practicing your shadow puppets.</div>
        <div class="lp-mailfig">
          <div><div class="k">balance</div><div class="v crit">৳42.50</div></div>
          <div><div class="k">threshold</div><div class="v">৳100</div></div>
          <a class="pr-btn gold sm" href="/app" style="margin-left:auto;align-self:flex-end">Recharge now</a>
        </div>
      </div>
    </div>
  </div></div></section>`;

  const dashboard = `<section class="lp-section" id="dashboard"><div class="lp-wrap"><div class="lp-split">
    <div class="lp-chartcard">
      <div class="lp-chrow">
        <div><div class="lp-pvbal" style="font-size:26px">৳42.50</div><div class="mono" style="font-size:11px;color:var(--red-soft)">▼ 91% in 14d</div></div>
        <span class="pr-pill crit"><span class="dot"></span>~3 days left</span>
      </div>
      ${declineChart()}
      <div class="lp-axis"><span>14d ago</span><span>today</span></div>
    </div>
    <div>
      <h2 class="lp-h2">See the decline before it ghosts you.</h2>
      <p class="lp-lead" style="margin-top:14px">The Telegram-hosted version adds a web dashboard: balance history, run-out predictions, and every meter you own in one place.</p>
      <div class="lp-bullets">
        ${bullet('<b style="color:var(--text)">Your meters</b> — 3 active, each with its own live balance and trend.')}
        ${bullet('<b style="color:var(--text)">Run-out prediction</b> — at your current burn rate, Home · Mirpur goes dark in ~3 days. The bot already messaged you. Twice.')}
        ${bullet('<b style="color:var(--text)">14-day history</b> — watch the slide so a flat week never surprises you.')}
      </div>
    </div>
  </div></div></section>`;

  const features = `<section class="lp-section"><div class="lp-wrap">
    <div class="lp-head lp-center"><h2 class="lp-h2">Small tool. Big mouth.</h2></div>
    <div class="lp-grid3">
      ${feature(I.clock, 'Checks every 6 hours', "An automated schedule pings DESCO around the clock — or force a run any time you're feeling anxious.")}
      ${feature(I.msg, 'Email · Telegram · SMS', 'Self-host fires emails. The hosted bot adds Telegram pings and SMS alerts on paid plans — same roast, more channels.')}
      ${feature(I.trend, 'Run-out predictions', '"~3 days left at this rate." It watches your burn rate and tells you when the lights actually go out.')}
      ${feature(I.layers, 'Multi-meter support', "Home, office, your parents' place — track every DESCO meter from one dashboard and one bot.")}
      ${feature(I.git, 'Free forever, self-hosted', 'Fork the repo, drop secrets into GitHub Actions, done. Zero servers, zero cost, MIT-licensed.')}
      ${feature(I.sliders, 'Configurable everything', "Thresholds, SMTP provider, roast intensity — all env vars. Soften the templates if you can't take the heat.")}
    </div>
  </div></section>`;

  const paths = `<section class="lp-section" id="selfhost"><div class="lp-wrap"><div class="lp-2col">
    <div class="lp-path">
      <h3>Self-hosted</h3>
      <p>Fork the repo, paste your details into GitHub Secrets, and the workflow runs on a schedule. No servers, no cost — just email roasts.</p>
      <div class="lp-bullets" style="margin-top:0">
        ${bullet('Runs on GitHub Actions every 6h')}
        ${bullet('Any SMTP provider (Gmail, Outlook…)')}
        ${bullet('Your data never leaves your repo')}
      </div>
    </div>
    <div class="lp-path bot">
      <h3>Hosted Telegram bot</h3>
      <p>No fork, no secrets. Just message the bot. It handles everything and unlocks predictions, a web dashboard, multi-meter, and SMS.</p>
      <div class="lp-bullets" style="margin-top:0">
        ${bullet('Web dashboard with history charts')}
        ${bullet('SMS alerts via bKash / SSLCommerz')}
        ${bullet('Run-out predictions, multi-meter')}
      </div>
    </div>
  </div></div></section>`;

  const pricing = `<section class="lp-section" id="pricing"><div class="lp-wrap">
    <div class="lp-head lp-center">
      <h2 class="lp-h2">Cheaper than living in the dark.</h2>
      <p class="lp-sub">Self-host for free, forever. Or let the bot do the work — pay in BDT via bKash or SSLCommerz.</p>
    </div>
    <div class="lp-prices">
      <div class="lp-price">
        <div class="pname">Self-Host</div>
        <div class="amt">৳0 <span>/ forever</span></div>
        <div class="blurb">For developers who'd rather own it all.</div>
        <div class="pfeat">${priceFeat('Email roasts, single meter')}${priceFeat('GitHub Actions schedule')}${priceFeat('Configurable thresholds')}</div>
        <a class="pr-btn ghost block" href="${GITHUB}" target="_blank" rel="noopener">Fork on GitHub</a>
      </div>
      <div class="lp-price pop">
        <div class="pname">Roast Pro <span class="pop-badge">Most popular</span></div>
        <div class="amt">৳99 <span>/ month</span></div>
        <div class="blurb">The hosted bot, fully loaded.</div>
        <div class="pfeat">${priceFeat('Telegram + email, zero setup')}${priceFeat('Web dashboard + history charts')}${priceFeat('Run-out predictions')}${priceFeat('Up to 3 meters')}</div>
        <a class="pr-btn gold block" href="/app">Start with bKash</a>
      </div>
      <div class="lp-price">
        <div class="pname">Power User</div>
        <div class="amt">৳249 <span>/ month</span></div>
        <div class="blurb">For landlords and big families.</div>
        <div class="pfeat">${priceFeat('Everything in Roast Pro')}${priceFeat('SMS alerts included')}${priceFeat('Unlimited meters')}${priceFeat('Priority recharge reminders')}</div>
        <a class="pr-btn ghost block" href="/app">Choose Power User</a>
      </div>
    </div>
    <p class="lp-pricenote">60-day money-back guarantee · cancel anytime · no per-meter gouging</p>
  </div></section>`;

  const setup = `<section class="lp-section"><div class="lp-wrap"><div class="lp-split">
    <div>
      <h2 class="lp-h2">Three secrets and a cron. That's the whole setup.</h2>
      <p class="lp-lead" style="margin-top:14px">Built in TypeScript, run with Bun, scheduled by GitHub Actions. Drop your DESCO + SMTP details into repo secrets and forget it exists — until it roasts you.</p>
      <div class="lp-stack-chips">
        <span class="lp-chiptag">TypeScript</span><span class="lp-chiptag">nodemailer</span><span class="lp-chiptag">Drizzle</span><span class="lp-chiptag">Docker</span>
      </div>
    </div>
    <div class="lp-code"><span class="c"># required</span>
<span class="k">DESCO_ACCOUNT_NO</span>=<span class="v">41021094</span>
<span class="k">DESCO_METER_NO</span>=<span class="v">37755210</span>
<span class="k">EMAIL_TO</span>=<span class="v">you@example.com</span>
<span class="k">SMTP_HOST</span>=<span class="v">smtp.gmail.com</span>
<span class="k">SMTP_USER</span>=<span class="v">you@gmail.com</span>
<span class="k">SMTP_PASS</span>=<span class="v">••••••••••••</span>

<span class="c"># optional — tune the roast</span>
<span class="k">LOW_THRESHOLD</span>=<span class="v">150</span>
<span class="k">CRITICAL_THRESHOLD</span>=<span class="v">100</span>
<span class="c"># …or run every 6h via Actions</span></div>
  </div></div></section>`;

  const finalCta = `<section class="lp-section"><div class="lp-wrap"><div class="lp-final">
    <h2 class="lp-h2">Don't wait for the dark.</h2>
    <p class="lp-sub">Set it up in under an hour, or just message the bot. Either way, you'll never get ghosted by your own meter again.</p>
    <div class="lp-ctarow">
      <a class="pr-btn gold" href="/app">${I.msg} Message the bot</a>
      <a class="pr-btn ghost" href="${GITHUB}" target="_blank" rel="noopener">${I.git} Self-host free</a>
    </div>
  </div></div></section>`;

  const footer = `<footer class="lp-footer lp-wrap">
    ${logo()}
    <span class="lp-disclaimer">Independent project · not affiliated with DESCO.</span>
    <div class="links">
      <a href="#how">How it works</a>
      <a href="#pricing">Pricing</a>
      <a href="#selfhost">Self-host</a>
      <a href="${GITHUB}" target="_blank" rel="noopener">GitHub ↗</a>
    </div>
  </footer>`;

  const body = `<style>${STYLE}</style>${nav}<main>${hero}${thresholds}${inbox}${dashboard}${features}${paths}${pricing}${setup}${finalCta}</main>${footer}`;
  return pageDoc('Power·Roast — DESCO prepaid balance alerts that roast you', body);
}
