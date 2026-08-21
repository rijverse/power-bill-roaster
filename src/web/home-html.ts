// Public marketing landing page served at GET /. Built on the shared theme.ts
// design system (warm near-black paper, amber accent, Archivo display) so it
// matches the app, and kept CSP-safe: inline styles only, an SVG chart instead
// of Chart.js, no new CDNs. Brutalist Feature-Stack: full-bleed bands split by
// hard rules, an oversized uppercase hero, a ruled capability matrix.
import { pageDoc, logo } from './theme';
import { maxMetersFor, priceBdtFor, smsPerMonthFor } from '../core/plans';

const GITHUB = 'https://github.com/rijverse/power-bill-roaster';

// landing-only layout, scoped under .lp- so it can't collide with the app's .pr-
// classes. colours/radii/fonts all come from the theme tokens.
const STYLE = `
.lp-nav { position: sticky; top: 0; z-index: 50; background: var(--bg); border-bottom: 1.5px solid var(--border); }
.lp-nav-inner { display: flex; align-items: center; gap: 22px; padding: 16px 28px; max-width: 1500px; margin: 0 auto; width: 100%; }
.lp-nav .links { display: flex; gap: 24px; margin-left: 18px; }
.lp-nav .links a { color: var(--muted); font-family: var(--mono); font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; }
.lp-nav .links a:hover { color: var(--gold); text-decoration: none; }
.lp-nav .right { margin-left: auto; display: flex; align-items: center; gap: 10px; }

.lp-wrap { max-width: 1500px; margin: 0 auto; padding: 0 28px; position: relative; z-index: 1; }
.lp-section { padding: 88px 0; border-top: 1.5px solid var(--border); }
.lp-eyebrow { display: inline-flex; align-items: center; gap: 8px; font-family: var(--mono); font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--gold); border: 1.5px solid color-mix(in oklch, var(--gold) 40%, transparent); padding: 6px 12px; }
.lp-h1 { font-family: var(--display); font-size: clamp(2.6rem, 6.4vw, 5.4rem); line-height: 0.95; letter-spacing: -0.03em; font-weight: 900; text-transform: uppercase; color: var(--text); margin: 24px 0 22px; overflow-wrap: anywhere; }
.lp-h1 .hl { color: var(--gold); }
.lp-h2 { font-family: var(--display); font-size: clamp(1.9rem, 4vw, 2.9rem); line-height: 1.0; letter-spacing: -0.02em; font-weight: 800; text-transform: uppercase; color: var(--text); overflow-wrap: anywhere; }
.lp-lead { font-size: 18px; line-height: 1.6; color: var(--text-3); max-width: 540px; }
.lp-sub { font-size: 16px; line-height: 1.6; color: var(--muted); max-width: 620px; margin-top: 12px; }
.lp-head { margin-bottom: 46px; max-width: 720px; }

.lp-hero { display: grid; grid-template-columns: 1.05fr 0.95fr; gap: 56px; align-items: center; padding: 76px 0 68px; }
.lp-hero > div { min-width: 0; }
.lp-ctarow { display: flex; gap: 12px; flex-wrap: wrap; margin: 30px 0 26px; }
.lp-checks { display: flex; gap: 22px; flex-wrap: wrap; }
.lp-check { display: inline-flex; align-items: center; gap: 7px; font-family: var(--mono); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-3); }
.lp-check svg { color: var(--gold); flex: none; }

/* hero power-grid canvas: sits behind the entire page */
.lp-herobox { position: relative; }
.lp-herobox .lp-hero { position: relative; z-index: 1; }
#pr-grid { position: fixed; inset: 0; width: 100%; height: 100%; z-index: 0; pointer-events: none; }

/* alert preview card in the hero */
.lp-preview { background: var(--surface); border: 1.5px solid var(--border); border-radius: var(--r-lg); padding: 18px; box-shadow: 9px 9px 0 var(--gold); }
.lp-pvhead { display: flex; align-items: center; gap: 10px; padding-bottom: 14px; border-bottom: 1.5px solid var(--border-soft); }
.lp-pvmeter { display: flex; align-items: center; gap: 12px; padding: 16px 0 14px; }
.lp-pvbal { font-family: var(--display); font-size: 32px; font-weight: 800; letter-spacing: -0.03em; color: var(--text); font-feature-settings: 'tnum' 1; }
.lp-pvmsg { font-size: 13.5px; line-height: 1.55; color: var(--text-2); background: var(--bg); border: 1.5px solid var(--border-soft); border-radius: var(--r); padding: 13px 14px; }

/* marquee strip */
.lp-strip { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; border-top: 1.5px solid var(--border); border-bottom: 1.5px solid var(--border); }
.lp-strip span { font-family: var(--mono); font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--faint); padding: 16px 22px; }
.lp-strip span + span { border-left: 1.5px solid var(--border); }

.lp-2col { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.lp-split { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; align-items: center; }
.lp-split > div { min-width: 0; }

/* roast threshold cards */
.lp-roast { background: var(--surface); border: 1.5px solid var(--border); border-radius: var(--r-lg); padding: 26px; }
.lp-roast.warn { border-color: color-mix(in oklch, var(--gold) 42%, transparent); }
.lp-roast.crit { border-color: color-mix(in oklch, var(--red) 42%, transparent); }
.lp-roast .tag { display: inline-flex; align-items: center; gap: 6px; font-family: var(--mono); font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
.lp-roast.warn .tag { color: var(--gold); }
.lp-roast.crit .tag { color: var(--red-soft); }
.lp-roast .q { font-family: var(--display); font-size: 22px; font-weight: 800; letter-spacing: -0.01em; text-transform: uppercase; line-height: 1.05; color: var(--text); margin: 16px 0 10px; }
.lp-roast .a { font-size: 14px; line-height: 1.6; color: var(--muted); }
.lp-roast .thr { font-family: var(--mono); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--faint); margin-top: 16px; }

.lp-bullets { display: flex; flex-direction: column; gap: 14px; margin-top: 24px; }
.lp-bullet { display: flex; gap: 12px; align-items: flex-start; font-size: 14.5px; line-height: 1.5; color: var(--text-2); }
.lp-bullet svg { color: var(--gold); flex: none; margin-top: 2px; }
.lp-bullet code { font-family: var(--mono); font-size: 12.5px; background: var(--surface-2); padding: 1px 6px; border-radius: var(--r-sm); color: var(--text); }

/* email preview */
.lp-mail { background: var(--surface); border: 1.5px solid var(--border); border-radius: var(--r-lg); overflow: hidden; box-shadow: 9px 9px 0 var(--surface-2); }
.lp-mailbar { display: flex; align-items: center; justify-content: space-between; padding: 12px 18px; background: var(--surface-2); border-bottom: 1.5px solid var(--border); font-family: var(--mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--faint); }
.lp-mailbody { padding: 20px; }
.lp-mailsub { font-family: var(--display); font-size: 17px; font-weight: 800; color: var(--text); }
.lp-mailmeta { font-family: var(--mono); font-size: 12px; color: var(--faint); margin: 4px 0 14px; }
.lp-mailfig { display: flex; gap: 26px; margin-top: 16px; padding-top: 14px; border-top: 1.5px solid var(--border-soft); }
.lp-mailfig .k { font-family: var(--mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--faint); }
.lp-mailfig .v { font-family: var(--display); font-size: 22px; font-weight: 800; color: var(--text); }
.lp-mailfig .v.crit { color: var(--red-soft); }

/* chart */
.lp-chartcard { background: var(--surface); border: 1.5px solid var(--border); border-radius: var(--r-lg); padding: 24px; }
.lp-chartcard svg { width: 100%; height: auto; display: block; }
.lp-chrow { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.lp-axis { display: flex; justify-content: space-between; font-family: var(--mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--faint); margin-top: 10px; }

/* capability matrix (ruled, not floating icon-tiles) */
.lp-matrix { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1.5px; background: var(--border); border: 1.5px solid var(--border); border-radius: var(--r-lg); overflow: hidden; }
.lp-cell { background: var(--surface); padding: 28px 24px; }
.lp-cellic { color: var(--gold); margin-bottom: 14px; line-height: 0; }
.lp-cell h3 { font-family: var(--display); font-size: 16px; font-weight: 800; text-transform: uppercase; letter-spacing: -0.01em; color: var(--text); margin-bottom: 8px; }
.lp-cell p { font-size: 14px; line-height: 1.55; color: var(--muted); }

/* two-path cards */
.lp-path { background: var(--surface); border: 1.5px solid var(--border); border-radius: var(--r-lg); padding: 30px; }
.lp-path.bot { border-color: color-mix(in oklch, var(--gold) 42%, transparent); }
.lp-path h3 { font-family: var(--display); font-size: 22px; font-weight: 800; text-transform: uppercase; letter-spacing: -0.01em; color: var(--text); margin-bottom: 10px; }
.lp-path p { font-size: 14.5px; line-height: 1.6; color: var(--muted); margin-bottom: 20px; }

/* pricing */
.lp-prices { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; align-items: start; }
.lp-price { background: var(--surface); border: 1.5px solid var(--border); border-radius: var(--r-lg); padding: 28px; }
.lp-price.pop { border: 1.5px solid var(--gold); box-shadow: 8px 8px 0 color-mix(in oklch, var(--gold) 22%, transparent); }
.lp-price .pname { font-family: var(--mono); font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-2); }
.lp-price .pop-badge { float: right; font-family: var(--mono); font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink); background: var(--gold); padding: 3px 9px; border-radius: var(--r-sm); }
.lp-price .amt { font-family: var(--display); font-size: 42px; font-weight: 900; letter-spacing: -0.03em; color: var(--text); margin: 16px 0 2px; }
.lp-price .amt span { font-family: var(--sans); font-size: 14px; font-weight: 500; color: var(--faint); letter-spacing: 0; }
.lp-price .blurb { font-size: 13.5px; color: var(--muted); min-height: 38px; margin-bottom: 20px; }
.lp-price .pfeat { display: flex; flex-direction: column; gap: 11px; margin-bottom: 24px; }
.lp-pricenote { text-align: center; font-family: var(--mono); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--faint); margin-top: 24px; }

/* setup / .env */
.lp-code { background: oklch(11% 0.006 65); border: 1.5px solid var(--border); border-radius: var(--r-lg); padding: 20px 22px; font-family: var(--mono); font-size: 13px; line-height: 1.85; overflow-x: auto; white-space: pre; }
.lp-code .c { color: var(--faint); }
.lp-code .k { color: var(--gold); }
.lp-code .v { color: var(--text-2); }
.lp-stack-chips { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 22px; }
.lp-chiptag { font-family: var(--mono); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-2); background: var(--surface-2); border: 1.5px solid var(--border); border-radius: var(--r-sm); padding: 5px 12px; }

/* final cta */
.lp-final { text-align: center; background: var(--surface); border: 1.5px solid var(--gold); border-radius: var(--r-lg); padding: 60px 28px; }
.lp-final .lp-h2, .lp-final .lp-sub { margin-left: auto; margin-right: auto; }
.lp-final .lp-ctarow { justify-content: center; }

.lp-footer { border-top: 1.5px solid var(--border); padding: 32px 28px; display: flex; align-items: center; gap: 20px; flex-wrap: wrap; }
.lp-footer .links { display: flex; gap: 20px; margin-left: auto; flex-wrap: wrap; }
.lp-footer .links a { color: var(--muted); font-family: var(--mono); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
.lp-footer .links a:hover { color: var(--gold); }
.lp-disclaimer { color: var(--faint); font-family: var(--mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }

@media (max-width: 880px) {
  .lp-nav .links { display: none; }
  .lp-nav-inner { padding: 16px 18px; gap: 12px; }
}
/* the two nav buttons plus the wordmark stop fitting around here, and the
   overflow pushed the whole page sideways */
@media (max-width: 460px) {
  .lp-nav .right .ghost { display: none; }
}
@media (max-width: 880px) {
  .lp-hero, .lp-split, .lp-2col, .lp-matrix, .lp-prices { grid-template-columns: minmax(0, 1fr); }
  .lp-hero { padding: 44px 0; gap: 40px; }
  .lp-section { padding: 60px 0; }
  .lp-preview { box-shadow: 6px 6px 0 var(--gold); }
  .lp-price.pop { order: -1; }
}`;

// a few inline lucide-style glyphs (stroke = currentColor) so the page needs no
// icon font or CDN.
const I = {
  check:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  star: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/></svg>',
  clock:
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  msg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  trend:
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 17 13.5 8.5l-5 5L2 7"/><path d="M16 17h6v-6"/></svg>',
  layers:
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/></svg>',
  git: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.9a3.4 3.4 0 0 0-1-2.6c3-.3 6-1.5 6-6.6a5.1 5.1 0 0 0-1.4-3.5 4.8 4.8 0 0 0-.1-3.5s-1.1-.3-3.5 1.3a12 12 0 0 0-6.4 0C6.3 1.6 5.2 1.9 5.2 1.9a4.8 4.8 0 0 0-.1 3.5A5.1 5.1 0 0 0 3.7 9c0 5 3 6.3 6 6.6a3.4 3.4 0 0 0-1 2.6V22"/></svg>',
  sliders:
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></svg>',
};

function check(text: string): string {
  return `<div class="lp-check">${I.check}<span>${text}</span></div>`;
}

function bullet(html: string): string {
  return `<div class="lp-bullet">${I.check}<div>${html}</div></div>`;
}

function feature(icon: string, title: string, body: string): string {
  return `<div class="lp-cell"><div class="lp-cellic">${icon}</div><h3>${title}</h3><p>${body}</p></div>`;
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
    <text x="636" y="146" text-anchor="end" font-family="monospace" font-size="11" fill="#837a68">৳150</text>
    <text x="636" y="174" text-anchor="end" font-family="monospace" font-size="11" fill="#837a68">৳100</text>
  </svg>`;
}

export function homeHtml(billingLive = false): string {
  const paid = billingLive;
  const nav = `<nav class="lp-nav">
    <div class="lp-nav-inner">
      ${logo()}
      <div class="links">
        <a href="#how">How it works</a>
        <a href="#dashboard">Dashboard</a>
        ${paid ? '<a href="#pricing">Pricing</a>' : ''}
        <a href="#selfhost">Self-host</a>
      </div>
      <div class="right">
        <a class="pr-btn ghost sm" href="${GITHUB}" target="_blank" rel="noopener">${I.star} Star on GitHub</a>
        <a class="pr-btn gold sm" href="/app">Start watching</a>
      </div>
    </div>
  </nav>`;

  const hero = `<section class="lp-wrap" id="top">
    <div class="lp-herobox">
      <div class="lp-hero">
      <div>
        <span class="lp-eyebrow">Prepaid electricity, brutally honest alerts</span>
        <h1 class="lp-h1">Recharge now, or get <span class="hl">roasted</span> in the dark.</h1>
        <p class="lp-lead">Your prepaid balance is one bad day from zero. And after how you've treated that meter, can you blame it for wanting out? Power·Roast emails you before the lights do.</p>
        <div class="lp-ctarow">
          <a class="pr-btn gold" href="/app">${I.msg} Start watching my meter</a>
          <a class="pr-btn ghost" href="${GITHUB}" target="_blank" rel="noopener">${I.git} Self-host free</a>
        </div>
        <div class="lp-checks">
          ${check('Free forever, self-hosted')}${check('Open source, MIT')}${check('No app to install')}
        </div>
      </div>
      <div class="lp-preview">
        <div class="lp-pvhead">${logo()}<span class="pr-pill crit siren" style="margin-left:auto"><span class="dot"></span>CRITICAL</span></div>
        <div class="lp-pvmeter">
          <div><div class="lp-pvbal">৳42.50</div><div class="mono" style="font-size:12px;color:var(--faint)">Meter #0227, ~3 days left</div></div>
          <a class="pr-btn gold sm" href="/app" style="margin-left:auto">Recharge →</a>
        </div>
        <div class="lp-pvmsg">Bro. ৳42.50? That's not a balance, that's a cry for help. Your meter is one warm fridge away from cutting you off mid-Netflix. Recharge now, or start practicing your shadow puppets.</div>
      </div>
    </div>
    </div>
    <div class="lp-strip">
      <span>Checks every 6 hours</span><span>${paid ? 'Email, Telegram, SMS' : 'Telegram, Discord &amp; email'}</span><span>Run-out predictions</span><span>${paid ? 'Multi-meter' : 'Free, no card'}</span><span>Zero servers to self-host</span>
    </div>
  </section>`;

  const thresholds = `<section class="lp-section" id="how"><div class="lp-wrap">
    <div class="lp-head">
      <h2 class="lp-h2">Two thresholds. One very tired meter.</h2>
      <p class="lp-sub">Both limits are configurable. Cross them and the bot gets progressively less polite about your life choices.</p>
    </div>
    <div class="lp-2col">
      <div class="lp-roast warn">
        <span class="tag">⚠ Warning shot, below ৳150</span>
        <div class="q">"Your Electricity About to Ghost You."</div>
        <div class="a">Translation: recharge before you're explaining to your family why the fridge is suddenly "a cabinet."</div>
        <div class="thr">below ৳150</div>
      </div>
      <div class="lp-roast crit">
        <span class="tag">💀 DEFCON 1, below ৳100</span>
        <!-- Marketing copy, deliberately NOT wired to alert-copy.ts: the landing
             page shouldn't silently rewrite itself when alert tone is tuned. -->
        <div class="q">"You're About to Live in the Stone Age."</div>
        <div class="a">Light a candle. Sharpen a stick. This is DEFCON 1 and your meter is not bluffing.</div>
        <div class="thr">below ৳100</div>
      </div>
    </div>
  </div></section>`;

  const inbox = `<section class="lp-section"><div class="lp-wrap"><div class="lp-split">
    <div>
      <h2 class="lp-h2">It hits your inbox like a disappointed parent.</h2>
      <p class="lp-lead" style="margin-top:16px">Every check runs the same pipeline: verify config, fetch your live meter balance, validate the response, compare against your thresholds, then if you're too low, blast an email that pulls no punches.</p>
      <div class="lp-bullets">
        ${bullet("Live balance, straight from your provider's API. Not a guess.")}
        ${bullet('Configurable thresholds. Defaults ৳150 / ৳100, tune them to taste.')}
        ${bullet('Tone it down if you must. The templates live in <code>src/templates/</code>.')}
      </div>
    </div>
    <div class="lp-mail">
      <div class="lp-mailbar"><span>Incoming · email</span><span>07:42</span></div>
      <div class="lp-mailbody">
        <div class="lp-mailsub">⚡ Your Electricity About to Ghost You</div>
        <div class="lp-mailmeta">roast@power-roast.app</div>
        <div class="lp-pvmsg">Bro. ৳42.50? That's not a balance, that's a cry for help. Your meter is one warm fridge away from cutting you off mid-Netflix. Recharge now, or start practicing your shadow puppets.</div>
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
      <p class="lp-lead" style="margin-top:16px">${
        paid
          ? 'The Telegram-hosted version adds a web dashboard: balance history, run-out predictions, and every meter you own in one place.'
          : 'The Telegram-hosted version adds a web dashboard: balance history, run-out predictions, and every reading for your meter in one place.'
      }</p>
      <div class="lp-bullets">
        ${
          paid
            ? bullet(
                '<b style="color:var(--text)">Your meters</b>: 3 active, each with its own live balance and trend.'
              )
            : bullet(
                '<b style="color:var(--text)">Your meter</b>: live balance, trend, and status at a glance.'
              )
        }
        ${bullet('<b style="color:var(--text)">Run-out prediction</b>: at your current burn rate, your Mirpur meter goes dark in ~3 days. The bot already messaged you. Twice.')}
        ${bullet('<b style="color:var(--text)">14-day history</b>: watch the slide so a flat week never surprises you.')}
      </div>
    </div>
  </div></div></section>`;

  const features = `<section class="lp-section"><div class="lp-wrap">
    <div class="lp-head"><h2 class="lp-h2">Small tool. Big mouth.</h2></div>
    <div class="lp-matrix">
      ${feature(I.clock, 'Checks every 6 hours', "An automated schedule pings your provider around the clock, or force a run any time you're feeling anxious.")}
      ${feature(
        I.msg,
        paid ? 'Email, Telegram, SMS' : 'Telegram, Discord &amp; email',
        paid
          ? 'Self-host fires emails. The hosted bot adds Telegram pings and SMS alerts on paid plans. Same roast, more channels.'
          : 'Self-host fires emails. The hosted bot adds instant Telegram and Discord alerts. Same roast, more channels.'
      )}
      ${feature(I.trend, 'Run-out predictions', '"~3 days left at this rate." It watches your burn rate and tells you when the lights actually go out.')}
      ${feature(
        I.layers,
        paid ? 'Multi-meter support' : 'Live web dashboard',
        paid
          ? "Home, office, your parents' place. Track every prepaid meter from one dashboard and one bot."
          : 'Balance history, run-out predictions, and every reading in one place. Nothing to install.'
      )}
      ${feature(I.git, 'Free forever, self-hosted', 'Fork the repo, drop secrets into GitHub Actions, done. Zero servers, zero cost, MIT-licensed.')}
      ${feature(I.sliders, 'Configurable everything', "Thresholds, SMTP provider, roast intensity, all env vars. Soften the templates if you can't take the heat.")}
    </div>
  </div></section>`;

  const paths = `<section class="lp-section" id="selfhost"><div class="lp-wrap">
    <div class="lp-head"><h2 class="lp-h2">Two ways to run it.</h2></div>
    <div class="lp-2col">
    <div class="lp-path">
      <h3>Self-hosted</h3>
      <p>Fork the repo, paste your details into GitHub Secrets, and the workflow runs on a schedule. No servers, no cost, just email roasts.</p>
      <div class="lp-bullets" style="margin-top:0">
        ${bullet('Runs on GitHub Actions every 6h')}
        ${bullet('Any SMTP provider (Gmail, Outlook, etc.)')}
        ${bullet('Your data never leaves your repo')}
      </div>
    </div>
    <div class="lp-path bot">
      <h3>Hosted, on the web</h3>
      <p>${
        paid
          ? 'No fork, no secrets. Sign in with your email, add a meter, done. Unlocks predictions, the dashboard, multi-meter, and SMS.'
          : 'No fork, no secrets. Sign in with your email and add a meter. It predicts the run-out and roasts you by email, Telegram, or Discord. Free.'
      }</p>
      <div class="lp-bullets" style="margin-top:0">
        ${bullet('Web dashboard with history charts')}
        ${paid ? bullet('SMS alerts via bKash / SSLCommerz') : bullet('Telegram &amp; Discord alerts, free')}
        ${paid ? bullet('Run-out predictions, multi-meter') : bullet('Run-out predictions built in')}
      </div>
    </div>
    </div>
  </div></section>`;

  const pricing = `<section class="lp-section" id="pricing"><div class="lp-wrap">
    <div class="lp-head">
      <h2 class="lp-h2">Cheaper than living in the dark.</h2>
      <p class="lp-sub">Self-host for free, forever. Or let us do the work and pay in BDT via bKash or SSLCommerz.</p>
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
        <div class="pname">Plus <span class="pop-badge">Most popular</span></div>
        <div class="amt">৳${priceBdtFor('plus')} <span>/ month</span></div>
        <div class="blurb">The hosted watchdog, fully loaded.</div>
        <div class="pfeat">${priceFeat('Telegram + email, zero setup')}${priceFeat('Web dashboard + history charts')}${priceFeat('Run-out predictions')}${priceFeat(`Up to ${maxMetersFor('plus')} meters`)}${priceFeat(`${smsPerMonthFor('plus')} SMS alerts / month`)}</div>
        <a class="pr-btn gold block" href="/app">Start with bKash</a>
      </div>
      <div class="lp-price">
        <div class="pname">Business</div>
        <div class="amt">৳${priceBdtFor('business')} <span>/ month</span></div>
        <div class="blurb">For landlords and big families.</div>
        <div class="pfeat">${priceFeat('Everything in Plus')}${priceFeat(`${smsPerMonthFor('business')} SMS alerts / month`)}${priceFeat('Unlimited meters')}${priceFeat('Priority recharge reminders')}</div>
        <a class="pr-btn ghost block" href="/app">Choose Business</a>
      </div>
    </div>
    <p class="lp-pricenote">60-day money-back guarantee. Cancel anytime. No per-meter gouging.</p>
  </div></section>`;

  const setup = `<section class="lp-section"><div class="lp-wrap"><div class="lp-split">
    <div>
      <h2 class="lp-h2">Three secrets and a cron. That's the whole setup.</h2>
      <p class="lp-lead" style="margin-top:16px">Built in TypeScript, run with Bun, scheduled by GitHub Actions. Drop your provider + SMTP details into repo secrets and forget it exists, until it roasts you.</p>
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

<span class="c"># optional, tune the roast</span>
<span class="k">LOW_THRESHOLD</span>=<span class="v">150</span>
<span class="k">CRITICAL_THRESHOLD</span>=<span class="v">100</span>
<span class="c"># or run every 6h via Actions</span></div>
  </div></div></section>`;

  const finalCta = `<section class="lp-section"><div class="lp-wrap"><div class="lp-final">
    <h2 class="lp-h2">Don't wait for the dark.</h2>
    <p class="lp-sub">Two numbers off your bill and you're watching. Either way, you'll never get ghosted by your own meter again.</p>
    <div class="lp-ctarow">
      <a class="pr-btn gold" href="/app">${I.msg} Start watching my meter</a>
      <a class="pr-btn ghost" href="${GITHUB}" target="_blank" rel="noopener">${I.git} Self-host free</a>
    </div>
  </div></div></section>`;

  const footer = `<footer class="lp-footer lp-wrap">
    ${logo()}
    <span class="lp-disclaimer">Independent project, not affiliated with electricity providers.</span>
    <div class="links">
      <a href="#how">How it works</a>
      ${paid ? '<a href="#pricing">Pricing</a>' : ''}
      <a href="#selfhost">Self-host</a>
      <a href="${GITHUB}" target="_blank" rel="noopener">GitHub ↗</a>
    </div>
  </footer>`;

  const body = `<style>${STYLE}</style>${nav}<canvas id="pr-grid" aria-hidden="true"></canvas><main>${hero}${thresholds}${inbox}${dashboard}${features}${paths}${paid ? pricing : ''}${setup}${finalCta}</main>${footer}<script src="/assets/hero-grid.js" defer></script>`;
  return pageDoc('Power·Roast: Prepaid balance alerts that roast you', body);
}

// Hero power-grid animation, served as a static same-origin script (see the
// /assets/hero-grid.js route in server.ts) so the / page stays memoized and the
// script loads under CSP script-src 'self' without a per-request nonce. Amber
// nodes drift and wire up to nearby nodes; every ~110 frames a node surges and
// lights its links; the grid reacts to the cursor. Honours reduced-motion.
export const HERO_GRID_JS = `(function () {
  var canvas = document.getElementById('pr-grid');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var AMBER = '251,176,36';
  var W = 0, H = 0, DPR = Math.min(window.devicePixelRatio || 1, 2);
  var nodes = [], LINK = 132, tick = 0, raf = null;
  var mouse = { x: -9999, y: -9999, on: false };

  function build() {
    var count = Math.max(14, Math.min(46, Math.round((W * H) / 15000)));
    nodes = [];
    for (var i = 0; i < count; i++) {
      nodes.push({
        x: Math.random() * W, y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.18, vy: (Math.random() - 0.5) * 0.18,
        r: 1.1 + Math.random() * 1.8, e: 0
      });
    }
  }
  function size() {
    var rect = canvas.getBoundingClientRect();
    W = rect.width; H = rect.height;
    if (W === 0 || H === 0) return;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    build();
  }
  function step() {
    tick++;
    if (tick % 110 === 0 && nodes.length) nodes[(Math.random() * nodes.length) | 0].e = 1;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      n.x += n.vx; n.y += n.vy;
      if (n.x < 0 || n.x > W) n.vx *= -1;
      if (n.y < 0 || n.y > H) n.vy *= -1;
      if (n.e > 0) n.e -= 0.012;
      if (mouse.on) {
        var dx = n.x - mouse.x, dy = n.y - mouse.y, d2 = dx * dx + dy * dy;
        if (d2 < 12000 && d2 > 0.01) {
          var d = Math.sqrt(d2), f = ((12000 - d2) / 12000) * 0.8;
          n.x += (dx / d) * f; n.y += (dy / d) * f;
        }
      }
    }
  }
  function render() {
    ctx.clearRect(0, 0, W, H);
    for (var i = 0; i < nodes.length; i++) {
      var a = nodes[i];
      for (var j = i + 1; j < nodes.length; j++) {
        var b = nodes[j], dx = a.x - b.x, dy = a.y - b.y, d = Math.sqrt(dx * dx + dy * dy);
        if (d < LINK) {
          var t = 1 - d / LINK, lit = a.e > b.e ? a.e : b.e;
          ctx.strokeStyle = 'rgba(' + AMBER + ',' + (t * 0.16 + lit * 0.4).toFixed(3) + ')';
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
    }
    for (var k = 0; k < nodes.length; k++) {
      var m = nodes[k];
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r + m.e * 1.5, 0, 6.2832);
      ctx.fillStyle = 'rgba(' + AMBER + ',' + (0.5 + m.e * 0.5).toFixed(3) + ')';
      ctx.fill();
    }
    if (mouse.on) {
      var g = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, 150);
      g.addColorStop(0, 'rgba(' + AMBER + ',0.10)');
      g.addColorStop(1, 'rgba(' + AMBER + ',0)');
      ctx.fillStyle = g;
      ctx.fillRect(mouse.x - 150, mouse.y - 150, 300, 300);
    }
  }
  function loop() { step(); render(); raf = requestAnimationFrame(loop); }
  function start() { if (!raf) loop(); }
  function stop() { if (raf) { cancelAnimationFrame(raf); raf = null; } }
  function onMove(ev) {
    var rect = canvas.getBoundingClientRect();
    mouse.x = ev.clientX - rect.left; mouse.y = ev.clientY - rect.top;
    mouse.on = mouse.x >= 0 && mouse.x <= W && mouse.y >= 0 && mouse.y <= H;
  }

  size();
  window.addEventListener('resize', size);
  if (reduce) { render(); return; }
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseout', function () { mouse.on = false; });
  document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else start(); });
  start();
})();
`;
