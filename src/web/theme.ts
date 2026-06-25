// Shared "Power·Roast" design system — one source of truth for every
// server-rendered surface (customer app, read-only dashboard, operator admin,
// payment + email pages). shadcn-inspired neutral dark theme: zinc surfaces,
// hairline borders, a single amber accent (--gold) for primary/active, flat
// surfaces, muted-foreground secondary text, and a focus ring. Tokens, base
// elements, and the component classes below are composed by the pages, so the
// look stays consistent without duplicating CSS — restyle here, every surface
// updates.

/** Google Fonts (Inter + JetBrains Mono). The CSP in server.ts whitelists these origins. */
export const FONT_LINKS = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap">`;

const TOKENS = `:root {
  color-scheme: dark;
  --bg: #09090B;          /* zinc-950 canvas */
  --surface: #18181B;     /* zinc-900 card */
  --surface-2: #27272A;   /* zinc-800 raised / secondary */
  --hover: #3F3F46;       /* zinc-700 hover */
  --plan-grad: #18181B;   /* flat card surface */
  --border: #27272A;      /* zinc-800 hairline */
  --border-soft: #1F1F23; /* subtle divider */
  --text: #FAFAFA;        /* zinc-50 foreground */
  --text-2: #E4E4E7;      /* zinc-200 */
  --text-3: #D4D4D8;      /* zinc-300 body */
  --muted: #A1A1AA;       /* zinc-400 muted-foreground */
  --faint: #71717A;       /* zinc-500 */
  --faint-2: #52525B;     /* zinc-600 */
  --gold: #FBB024;        /* amber - the one primary accent */
  --red: #FF5247;
  --red-soft: #FF8077;
  --green: #34D399;
  --blue: #5E83FF;
  --ink: #09090B;         /* near-black: text on amber, canvas */
  --ring: rgba(251,176,36,0.55);
  --sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  --mono: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace;
  --r-lg: 14px;
  --r: 10px;
  --r-sm: 8px;
}`;

const BASE = `*, *::before, *::after { box-sizing: border-box; }
* { margin: 0; padding: 0; }
html { scrollbar-color: #3F3F46 transparent; }
body {
  background: var(--bg);
  color: var(--text-3);
  font-family: var(--sans);
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  min-height: 100vh;
  position: relative;
  overflow-x: hidden;
}
a { color: var(--gold); text-decoration: none; }
a:hover { text-decoration: underline; }
::selection { background: var(--gold); color: var(--ink); }
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-thumb { background: #3F3F46; border-radius: 8px; border: 2px solid var(--bg); }
.mono { font-family: var(--mono); }
.muted { color: var(--muted); }
.faint { color: var(--faint); }
.spacer { flex: 1; }
.ok { color: var(--green); }
.low { color: var(--gold); }
.critical { color: var(--red-soft); }
.row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }`;

const ANIM = `@keyframes prSiren { 0%,100% { opacity: 1; } 50% { opacity: 0.32; } }
@keyframes prFloat { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-7px); } }
@keyframes prSpin { to { transform: rotate(360deg); } }
@keyframes prPulse { 0%,100% { transform: scale(1); opacity: 0.55; } 50% { transform: scale(1.35); opacity: 0; } }
.pr-spin { animation: prSpin 0.8s linear infinite; }`;

// flat canvas (shadcn dark is uncluttered): no colored glow, just the element
// so pages that drop it in keep working.
const AMBIENT_CSS = `.pr-ambient { position: fixed; inset: 0; pointer-events: none; z-index: 0; }`;

const BRAND = `.pr-logo { display: inline-flex; align-items: center; gap: 11px; }
.pr-logo .mark {
  display: grid; place-items: center; width: 34px; height: 34px; border-radius: 8px;
  background: var(--gold); flex: none;
}
.pr-logo .mark svg { fill: var(--ink); }
.pr-logo .name { font-weight: 800; font-size: 17px; letter-spacing: -0.02em; color: var(--text); }
.pr-logo .name b { color: var(--gold); font-weight: 800; }
.pr-logo--lg .mark { width: 40px; height: 40px; border-radius: 10px; }
.pr-logo--lg .name { font-size: 21px; }`;

const SHELL = `.pr-shell { position: relative; z-index: 1; display: flex; min-height: 100vh; }
.pr-sidebar {
  width: 248px; flex: none; display: flex; flex-direction: column; padding: 20px 16px;
  background: var(--bg); border-right: 1px solid var(--border);
}
.pr-sidebar > .pr-logo { padding: 6px 8px 22px; }
.pr-nav { display: flex; flex-direction: column; gap: 4px; }
.pr-nav-label {
  font-family: var(--mono); font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase;
  color: var(--faint-2); padding: 8px 12px 6px;
}
.pr-navbtn {
  display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: var(--r-sm);
  border: none; cursor: pointer; font: 600 14px var(--sans); width: 100%; text-align: left;
  background: transparent; color: var(--muted); transition: background .15s, color .15s;
}
.pr-navbtn:hover { background: var(--surface-2); color: var(--text-2); }
.pr-navbtn.active { background: rgba(251,176,36,0.12); color: var(--text); }
.pr-navbtn svg { flex: none; }
.pr-side-foot { margin-top: auto; display: flex; flex-direction: column; gap: 4px; }
.pr-user { display: flex; align-items: center; gap: 11px; padding: 10px 12px; margin-top: 4px; border-radius: 10px; }
.pr-avatar {
  display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%;
  background: var(--gold); color: var(--ink); font-weight: 800; font-size: 13px; flex: none;
}
.pr-user .who { min-width: 0; flex: 1; }
.pr-user .who .n { font-size: 13px; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pr-user .who .m { font-family: var(--mono); font-size: 11px; color: var(--faint); }
.pr-iconbtn { border: none; background: transparent; color: var(--faint); cursor: pointer; padding: 4px; flex: none; }
.pr-iconbtn:hover { color: var(--text-2); }

.pr-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.pr-topbar {
  position: sticky; top: 0; z-index: 40; display: flex; align-items: center; gap: 16px;
  padding: 14px 28px; background: rgba(9,9,11,0.85); backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--border);
}
.pr-topbar .titles { flex: 1; min-width: 0; }
.pr-topbar .t { font-size: 18px; font-weight: 800; color: var(--text); letter-spacing: -0.02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pr-topbar .s { font-family: var(--mono); font-size: 11.5px; color: var(--faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pr-content { flex: 1; padding: 28px 28px 96px; max-width: 1240px; width: 100%; margin: 0 auto; }
#pr-hamburger { display: none; align-items: center; justify-content: center; width: 38px; height: 38px; border-radius: var(--r-sm); border: 1px solid var(--border); background: var(--surface-2); color: var(--text); cursor: pointer; flex: none; }
#pr-scrim { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 70; }`;

const CARD = `.pr-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-lg); padding: 22px; box-shadow: 0 1px 2px rgba(0,0,0,0.32); }
.pr-card + .pr-card { margin-top: 18px; }
.pr-card-title { font-size: 16px; font-weight: 800; color: var(--text); letter-spacing: -0.01em; }
.pr-card-sub { font-size: 13.5px; color: var(--muted); margin-top: 3px; }
.pr-section-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }

.pr-statrow { display: grid; grid-template-columns: repeat(var(--cols, 3), 1fr); gap: 16px; }
.pr-stat { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-lg); padding: 20px; box-shadow: 0 1px 2px rgba(0,0,0,0.32); }
.pr-stat .k { font-family: var(--mono); font-size: 11px; color: var(--faint); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 10px; }
.pr-stat .n { font-size: 28px; font-weight: 800; color: var(--text); letter-spacing: -0.03em; font-feature-settings: 'tnum' 1; }
.pr-stat .n.gold { color: var(--gold); } .pr-stat .n.red { color: var(--red-soft); } .pr-stat .n.green { color: var(--green); }
.pr-stat .d { font-family: var(--mono); font-size: 12px; color: var(--faint); margin-top: 6px; }
.pr-stat .d.up { color: var(--green); } .pr-stat .d.down { color: var(--red-soft); } .pr-stat .d.warn { color: var(--gold); }

.pr-banner {
  display: flex; align-items: center; gap: 16px; border-radius: var(--r-lg); padding: 18px 22px;
  background: rgba(255,82,71,0.1); border: 1px solid rgba(255,82,71,0.28);
}
.pr-banner .ic { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 12px; background: rgba(255,82,71,0.16); flex: none; }
.pr-banner .bd { flex: 1; min-width: 0; }
.pr-banner .bd .h { font-size: 16px; font-weight: 800; color: var(--text); margin-bottom: 2px; }
.pr-banner .bd .p { font-size: 14px; color: var(--text-2); }
.pr-banner.warn { background: rgba(251,176,36,0.1); border-color: rgba(251,176,36,0.28); }
.pr-banner.warn .ic { background: rgba(251,176,36,0.16); }

.pr-chart { position: relative; height: 150px; margin-top: 14px; }
.pr-chart.sm { height: 92px; }`;

const CONTROLS = `.pr-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 9px;
  padding: 11px 16px; border-radius: var(--r); border: 1px solid var(--border); cursor: pointer;
  font: 700 14px var(--sans); background: var(--surface-2); color: var(--text);
  transition: background .15s, border-color .15s, color .15s;
}
.pr-btn:hover { background: var(--hover); }
.pr-btn:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
.pr-btn:disabled { opacity: 0.45; cursor: default; }
.pr-btn.sm { padding: 7px 12px; font-size: 13px; }
.pr-btn.block { width: 100%; }
.pr-btn.gold { background: var(--gold); color: var(--ink); border-color: var(--gold); }
.pr-btn.gold:hover { background: #ffbf3d; }
.pr-btn.red { background: var(--red); color: #fff; border-color: var(--red); }
.pr-btn.red:hover { background: #ff6359; }
.pr-btn.blue { background: var(--blue); color: #fff; border-color: var(--blue); }
.pr-btn.blue:hover { background: #7593ff; }
.pr-btn.ghost { background: transparent; border-color: var(--border); color: var(--text-2); }
.pr-btn.ghost:hover { background: var(--surface-2); color: var(--text); }
.pr-btn.danger { background: rgba(255,82,71,0.1); border-color: rgba(255,82,71,0.3); color: var(--red-soft); }
.pr-btn.danger:hover { background: rgba(255,82,71,0.18); }

.pr-label { display: block; font-size: 13px; font-weight: 600; color: var(--text-2); margin-bottom: 7px; }
.pr-input {
  width: 100%; padding: 12px 14px; background: var(--bg);
  border: 1px solid var(--border); border-radius: var(--r-sm); color: var(--text);
  font: 15px var(--sans); outline: none; transition: border-color .15s, box-shadow .15s;
}
.pr-input::placeholder { color: var(--faint); }
.pr-input:focus { border-color: rgba(251,176,36,0.55); box-shadow: 0 0 0 3px rgba(251,176,36,0.16); }
.pr-input.mono { font-family: var(--mono); }

.pr-pill {
  display: inline-flex; align-items: center; gap: 6px; font-family: var(--mono); font-size: 11px; font-weight: 700;
  padding: 4px 10px; border-radius: 999px; color: var(--text-2); background: var(--surface-2); width: fit-content;
}
.pr-pill.ok { color: var(--green); background: rgba(52,211,153,0.12); }
.pr-pill.low { color: var(--gold); background: rgba(251,176,36,0.12); }
.pr-pill.crit { color: var(--red-soft); background: rgba(255,82,71,0.12); }
.pr-pill.info { color: #8FA8FF; background: rgba(94,131,255,0.12); }
.pr-pill .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex: none; }
.pr-pill.siren .dot { animation: prSiren 1.1s infinite; }

/* switch (checkbox styled as a track + knob) */
.pr-switch { position: relative; width: 44px; height: 24px; flex: none; cursor: pointer; }
.pr-switch input { position: absolute; opacity: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; }
.pr-switch .track { position: absolute; inset: 0; border-radius: 999px; background: var(--hover); transition: background .15s; }
.pr-switch .knob { position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: var(--muted); transition: left .15s, background .15s; }
.pr-switch input:checked ~ .track { background: var(--gold); }
.pr-switch input:checked ~ .knob { left: 23px; background: var(--ink); }
.pr-switch input:focus-visible ~ .track { outline: 2px solid var(--ring); outline-offset: 2px; }

input[type=range].pr-range { -webkit-appearance: none; appearance: none; width: 100%; height: 6px; border-radius: 999px; background: var(--surface-2); outline: none; }
input[type=range].pr-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 18px; height: 18px; border-radius: 50%; background: var(--gold); cursor: pointer; }
input[type=range].pr-range::-moz-range-thumb { width: 18px; height: 18px; border: none; border-radius: 50%; background: var(--gold); cursor: pointer; }

/* segmented control */
.pr-seg { display: flex; gap: 8px; }
.pr-seg button { flex: 1; padding: 11px; border-radius: var(--r-sm); border: 1px solid var(--border); cursor: pointer; font: 700 13px var(--sans); background: var(--surface-2); color: var(--muted); transition: all .15s; }
.pr-seg button.on { border-color: var(--gold); background: rgba(251,176,36,0.1); color: var(--gold); }

/* list rows (meters, alerts, channels) */
.pr-list > * { border-top: 1px solid var(--border-soft); }
.pr-list > *:first-child { border-top: 0; }
.pr-rowitem { display: flex; align-items: center; gap: 12px; padding: 13px 0; }
.pr-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.pr-chan-ic { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 10px; flex: none; }

/* tables */
.pr-tableshell { overflow: hidden; }
.pr-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.pr-table thead th {
  text-align: left; padding: 11px 14px; white-space: nowrap;
  font-family: var(--mono); font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--faint); font-weight: 700; border-bottom: 1px solid var(--border-soft);
}
.pr-table tbody td { padding: 12px 14px; white-space: nowrap; color: var(--text-2); border-top: 1px solid var(--border-soft); }
.pr-table tbody tr:first-child td { border-top: 0; }
.pr-table tbody tr.click { cursor: pointer; }
.pr-table tbody tr.click:hover { background: var(--surface-2); }

.pr-empty { color: var(--muted); text-align: center; padding: 30px 0; font-size: 13.5px; }
.pr-err { color: var(--red-soft); min-height: 18px; font-size: 13px; }
.pr-good { color: var(--green); min-height: 18px; font-size: 13px; }

.pr-grid { display: grid; gap: 18px; }
.pr-2col { grid-template-columns: 1.55fr 1fr; }
.pr-2col-even { grid-template-columns: 1fr 0.9fr; align-items: start; }
.pr-stack { display: flex; flex-direction: column; gap: 18px; }`;

const LOGIN = `.pr-loginwrap {
  position: relative; z-index: 1; min-height: 100vh; display: grid;
  grid-template-columns: 1.05fr 0.95fr; align-items: center; gap: 56px;
  max-width: 1180px; margin: 0 auto; padding: 48px 32px;
}
.pr-loginbrand h1 { margin: 28px 0 18px; font-size: 46px; line-height: 1.04; letter-spacing: -0.03em; font-weight: 800; color: var(--text); }
.pr-loginbrand h1 span { color: var(--gold); }
.pr-loginbrand p { font-size: 17px; line-height: 1.6; color: var(--text-3); max-width: 440px; }
.pr-peek {
  display: inline-flex; align-items: center; gap: 16px; margin-top: 32px;
  background: var(--surface); border: 1px solid rgba(255,82,71,0.28); border-radius: var(--r-lg);
  padding: 16px 20px; box-shadow: 0 1px 2px rgba(0,0,0,0.4); animation: prFloat 6s ease-in-out infinite;
}
.pr-formcard {
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-lg); padding: 34px;
  box-shadow: 0 8px 30px rgba(0,0,0,0.4); max-width: 440px; width: 100%; justify-self: center;
}
.pr-tabs { display: flex; gap: 6px; padding: 5px; background: var(--surface-2); border: 1px solid var(--border-soft); border-radius: var(--r); }
.pr-tab { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 11px; border-radius: var(--r-sm); border: none; cursor: pointer; font: 600 14px var(--sans); background: transparent; color: var(--muted); transition: all .15s; }
.pr-tab.on { background: var(--gold); color: var(--ink); font-weight: 700; }
.pr-authpanel { max-width: 380px; margin: 0 auto; }`;

// Extras for the multi-screen app/admin: a client-side screen router, the topbar
// meter selector, a "sample data" marker for placeholdered surfaces, recharge
// chips, the highlighted plan card, the circular balance gauge and a notice strip.
const EXTRAS = `.pr-screen { display: none; }
.pr-screen.on { display: block; }
.pr-chart.lg { height: 220px; }

.pr-mselwrap { display: flex; align-items: center; gap: 6px; padding: 5px; background: var(--surface-2); border: 1px solid var(--border-soft); border-radius: 10px; flex: none; }
.pr-mselbtn { display: inline-flex; align-items: center; gap: 7px; padding: 7px 12px; border-radius: 7px; border: none; cursor: pointer; font: 600 13px var(--sans); background: transparent; color: var(--muted); white-space: nowrap; transition: background .15s, color .15s; }
.pr-mselbtn .dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.pr-mselbtn:hover { color: var(--text-2); }
.pr-mselbtn.on { background: var(--surface); color: var(--text); }

.pr-sample { display: inline-flex; align-items: center; gap: 5px; font-family: var(--mono); font-size: 9.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--faint); background: var(--surface-2); border: 1px solid var(--border-soft); padding: 2px 7px; border-radius: 999px; }

.pr-chip { flex: 1; min-width: 80px; padding: 16px 10px; border-radius: var(--r); border: 1px solid var(--border); background: var(--bg); color: var(--text-2); font: 700 15px var(--mono); cursor: pointer; transition: all .15s; }
.pr-chip.on { border: 1.5px solid var(--gold); background: rgba(251,176,36,0.1); color: var(--gold); }
.pr-paybtn { flex: 1; padding: 12px; border-radius: var(--r-sm); border: 1px solid var(--border); background: var(--bg); color: var(--text-2); font: 600 13px var(--sans); cursor: pointer; transition: all .15s; }
.pr-paybtn.on { border-color: var(--gold); background: rgba(251,176,36,0.1); color: var(--gold); }

.pr-plan { background: var(--surface); border: 1.5px solid var(--gold); border-radius: var(--r-lg); padding: 24px; }
.pr-feat { display: flex; gap: 9px; align-items: center; font-size: 13px; color: var(--text-2); }

.pr-notice { display: flex; gap: 12px; align-items: flex-start; background: rgba(94,131,255,0.08); border: 1px solid rgba(94,131,255,0.22); border-radius: var(--r); padding: 13px 16px; font-size: 13px; line-height: 1.5; color: var(--text-2); }
.pr-notice svg { flex: none; margin-top: 1px; }
.pr-faux { opacity: 0.5; pointer-events: none; }

.pr-gauge { position: relative; flex: none; }
.pr-gauge .v { position: absolute; inset: 0; display: grid; place-items: center; text-align: center; }`;

const RESPONSIVE = `@media (max-width: 920px) {
  .pr-sidebar { position: fixed; left: 0; top: 0; bottom: 0; transform: translateX(-100%); transition: transform .22s cubic-bezier(0.2,0,0,1); z-index: 80; }
  .pr-sidebar[data-open="true"] { transform: translateX(0); }
  #pr-scrim[data-open="true"] { display: block; }
  #pr-hamburger { display: inline-flex; }
  .pr-content { padding: 20px 16px 80px; }
  .pr-topbar { padding: 12px 16px; }
  .pr-2col, .pr-2col-even { grid-template-columns: 1fr; }
  .pr-statrow { grid-template-columns: 1fr 1fr; }
  .pr-loginwrap { grid-template-columns: 1fr; }
  .pr-loginbrand { display: none; }
  .pr-mselwrap { display: none; }
}
@media (max-width: 520px) {
  .pr-statrow { grid-template-columns: 1fr; }
  .pr-loginbrand h1 { font-size: 34px; }
}`;

export const BASE_STYLE = [
  TOKENS,
  BASE,
  ANIM,
  AMBIENT_CSS,
  BRAND,
  SHELL,
  CARD,
  CONTROLS,
  LOGIN,
  EXTRAS,
  RESPONSIVE,
].join('\n');

/** The lightning-bolt logo mark used in headers, sidebars and login. */
export function logo(big = false): string {
  const sz = big ? 21 : 18;
  return `<span class="pr-logo${big ? ' pr-logo--lg' : ''}"><span class="mark"><svg width="${sz}" height="${sz}" viewBox="0 0 24 24"><path d="M13 2 4 14h6l-1 8 9-12h-6z"></path></svg></span><span class="name">Power<b>·Roast</b></span></span>`;
}

/** Fixed ambient layer. Drop once near the top of <body>. */
export const AMBIENT = `<div class="pr-ambient"></div>`;

export function pageHead(title: string): string {
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
${FONT_LINKS}
<title>${title}</title>
<style>${BASE_STYLE}</style>`;
}

export function pageDoc(title: string, body: string): string {
  return `<!DOCTYPE html><html lang="en"><head>${pageHead(title)}</head><body>${AMBIENT}${body}</body></html>`;
}

/**
 * Inline JS (string) shared by every charted page: a themed Chart.js line-chart
 * factory plus a tiny plugin that draws dashed low/critical threshold lines.
 * Include once after the Chart.js <script>. Expects Chart to be global.
 */
export const CHART_SCRIPT = `
window.prThresholdPlugin = {
  id: 'prThresholds',
  afterDatasetsDraw: function (chart) {
    var o = chart.options.plugins.prThresholds; if (!o) return;
    var ctx = chart.ctx, ys = chart.scales.y, area = chart.chartArea;
    [[o.low, 'rgba(251,176,36,0.5)'], [o.critical, 'rgba(255,82,71,0.55)']].forEach(function (t) {
      if (t[0] == null || !isFinite(t[0])) return;
      var y = ys.getPixelForValue(t[0]); if (y < area.top || y > area.bottom) return;
      ctx.save(); ctx.beginPath(); ctx.setLineDash([5, 5]); ctx.lineWidth = 1; ctx.strokeStyle = t[1];
      ctx.moveTo(area.left, y); ctx.lineTo(area.right, y); ctx.stroke(); ctx.restore();
    });
  },
};
window.prChart = function (canvas, readings, opts) {
  opts = opts || {};
  var ctx = canvas.getContext('2d');
  var grad = ctx.createLinearGradient(0, 0, 0, 160);
  grad.addColorStop(0, 'rgba(251,176,36,0.30)');
  grad.addColorStop(1, 'rgba(251,176,36,0)');
  return new Chart(canvas, {
    type: 'line',
    data: {
      labels: readings.map(function (r) { return new Date(r.t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }),
      datasets: [{ data: readings.map(function (r) { return r.balance; }), borderColor: '#FBB024', backgroundColor: grad, fill: true, pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: '#FF5247', tension: 0.35, borderWidth: 2 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { display: false },
        prThresholds: { low: opts.low, critical: opts.critical },
        tooltip: { backgroundColor: '#18181B', borderColor: '#27272A', borderWidth: 1, titleColor: '#FAFAFA', bodyColor: '#D4D4D8', padding: 10, displayColors: false, callbacks: { label: function (c) { return '\\u09F3' + Number(c.parsed.y).toFixed(2); } } },
      },
      scales: {
        x: { ticks: { maxTicksLimit: 7, color: '#71717A', font: { size: 11, family: "'JetBrains Mono', monospace" } }, grid: { display: false }, border: { display: false } },
        y: { ticks: { color: '#71717A', font: { size: 11, family: "'JetBrains Mono', monospace" } }, grid: { color: 'rgba(255,255,255,0.05)' }, border: { display: false } },
      },
    },
    plugins: [window.prThresholdPlugin],
  });
};`;

/** Shared client helpers (escape + ৳ money format) as an inline JS string. */
export const CLIENT_HELPERS = `
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => n === null || n === undefined ? '—' : '\\u09F3' + Number(n).toFixed(2);
const when = s => s ? new Date(s).toLocaleString() : '—';`;
