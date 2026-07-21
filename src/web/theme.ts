// Shared "Power·Roast" design system — one source of truth for every
// server-rendered surface (customer app, read-only dashboard, operator admin,
// payment + email pages). Dark brutalist theme: warm near-black paper, hard
// rules (no soft shadows), one amber accent, an industrial Archivo display face
// over an Inter body, and JetBrains Mono for meter numbers and labels. Tokens,
// base elements, and the component classes below are composed by the pages, so
// the look stays consistent without duplicating CSS. Restyle here, every
// surface updates.

/** Google Fonts (Archivo display + Inter body + JetBrains Mono). The CSP in server.ts whitelists these origins. */
export const FONT_LINKS = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800;900&family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap">`;

const TOKENS = `/* "Roast Brutal" theme tokens: warm near-black paper, amber accent, hard rules. */
:root {
  color-scheme: dark;
  --bg: oklch(15.5% 0.008 65);        /* warm near-black canvas */
  --surface: oklch(20% 0.008 65);     /* card */
  --surface-2: oklch(26% 0.009 65);   /* raised / secondary */
  --hover: oklch(33% 0.011 65);       /* hover */
  --plan-grad: oklch(20% 0.008 65);   /* flat card surface */
  --border: oklch(35% 0.012 65);      /* hard rule */
  --border-soft: oklch(27% 0.01 65);  /* subtle divider */
  --text: oklch(96% 0.006 80);        /* warm near-white foreground */
  --text-2: oklch(88% 0.007 80);
  --text-3: oklch(81% 0.008 80);      /* body */
  --muted: oklch(70% 0.009 75);       /* muted-foreground */
  --faint: oklch(58% 0.01 72);
  --faint-2: oklch(46% 0.011 70);
  --gold: oklch(80% 0.163 78);        /* amber - the one primary accent */
  --gold-hi: oklch(85% 0.16 82);      /* amber hover */
  --red: oklch(64% 0.213 24);
  --red-soft: oklch(72% 0.16 26);
  --green: oklch(77% 0.15 165);
  --blue: oklch(64% 0.19 268);
  --ink: oklch(16% 0.02 70);          /* warm near-black: text on amber */
  --ring: oklch(80% 0.163 78 / 0.6);
  --display: 'Archivo', 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  --sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  --mono: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace;
  --r-lg: 4px;
  --r: 3px;
  --r-sm: 2px;
}`;

const BASE = `*, *::before, *::after { box-sizing: border-box; }
* { margin: 0; padding: 0; }
html { scrollbar-color: oklch(33% 0.011 65) transparent; }
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
h1, h2, h3, h4 { font-family: var(--display); font-style: normal; }
a { color: var(--gold); text-decoration: none; }
a:hover { text-decoration: underline; }
::selection { background: var(--gold); color: var(--ink); }
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-thumb { background: oklch(33% 0.011 65); border: 2px solid var(--bg); }
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
.pr-spin { animation: prSpin 0.8s linear infinite; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; transition-duration: 0.001ms !important; }
}`;

// flat canvas (brutalist is uncluttered): no colored glow, just the element so
// pages that drop it in keep working.
const AMBIENT_CSS = `.pr-ambient { position: fixed; inset: 0; pointer-events: none; z-index: 0; }`;

const BRAND = `.pr-logo { display: inline-flex; align-items: center; gap: 11px; }
.pr-logo .mark {
  display: grid; place-items: center; width: 34px; height: 34px; border-radius: var(--r-sm);
  background: var(--gold); flex: none;
}
.pr-logo .mark svg { fill: var(--ink); }
.pr-logo .name { font-family: var(--display); font-weight: 800; font-size: 18px; letter-spacing: -0.02em; color: var(--text); }
.pr-logo .name b { color: var(--gold); font-weight: 800; }
.pr-logo--lg .mark { width: 40px; height: 40px; }
.pr-logo--lg .name { font-size: 22px; }`;

const SHELL = `.pr-shell { position: relative; z-index: 1; display: flex; min-height: 100vh; }
.pr-sidebar {
  width: 232px; flex: none; display: flex; flex-direction: column; padding: 16px 12px;
  background: var(--bg); border-right: 1.5px solid var(--border);
}
.pr-sidebar > .pr-logo { padding: 6px 8px 20px; }
.pr-nav { display: flex; flex-direction: column; gap: 4px; }
.pr-nav-label {
  font-family: var(--mono); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase;
  color: var(--faint-2); padding: 8px 12px 6px;
}
.pr-navbtn {
  display: flex; align-items: center; gap: 11px; padding: 9px 11px; border-radius: var(--r-sm);
  border: none; cursor: pointer; font: 600 13.5px var(--sans); width: 100%; text-align: left;
  background: transparent; color: var(--muted); transition: background .12s, color .12s, box-shadow .12s;
}
.pr-navbtn:hover { background: var(--surface-2); color: var(--text-2); }
.pr-navbtn.active { background: color-mix(in oklch, var(--gold) 12%, transparent); color: var(--text); box-shadow: inset 3px 0 0 var(--gold); }
.pr-navbtn svg { flex: none; }
.pr-side-foot { margin-top: auto; display: flex; flex-direction: column; gap: 4px; }
.pr-user { display: flex; align-items: center; gap: 11px; padding: 10px 12px; margin-top: 4px; border-radius: var(--r); }
.pr-avatar {
  display: grid; place-items: center; width: 32px; height: 32px; border-radius: var(--r-sm);
  background: var(--gold); color: var(--ink); font-family: var(--display); font-weight: 800; font-size: 14px; flex: none;
}
.pr-user .who { min-width: 0; flex: 1; }
.pr-user .who .n { font-size: 13px; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pr-user .who .m { font-family: var(--mono); font-size: 11px; color: var(--faint); }
.pr-iconbtn { border: none; background: transparent; color: var(--faint); cursor: pointer; padding: 4px; flex: none; }
.pr-iconbtn:hover { color: var(--text-2); }
.pr-iconbtn:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }

.pr-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.pr-topbar {
  position: sticky; top: 0; z-index: 40; display: flex; align-items: center; gap: 14px;
  padding: 12px 22px; background: var(--bg); border-bottom: 1.5px solid var(--border);
}
.pr-topbar .titles { flex: 1; min-width: 0; }
.pr-topbar .t { font-family: var(--display); font-size: 17px; font-weight: 800; color: var(--text); letter-spacing: -0.02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pr-topbar .s { font-family: var(--mono); font-size: 11.5px; color: var(--faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pr-content { flex: 1; padding: 22px 24px 80px; max-width: 1240px; width: 100%; margin: 0 auto; }
#pr-hamburger { display: none; align-items: center; justify-content: center; width: 38px; height: 38px; border-radius: var(--r-sm); border: 1.5px solid var(--border); background: var(--surface-2); color: var(--text); cursor: pointer; flex: none; }
#pr-scrim { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 70; }`;

const CARD = `.pr-card { background: var(--surface); border: 1.5px solid var(--border); border-radius: var(--r-lg); padding: 18px; }
.pr-card + .pr-card { margin-top: 16px; }
.pr-card-title { font-family: var(--display); font-size: 16px; font-weight: 800; color: var(--text); letter-spacing: -0.01em; }
.pr-card-sub { font-size: 13px; color: var(--muted); margin-top: 3px; }
.pr-section-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }

.pr-statrow { display: grid; grid-template-columns: repeat(var(--cols, 3), minmax(0, 1fr)); gap: 14px; }
.pr-stat { background: var(--surface); border: 1.5px solid var(--border); border-radius: var(--r-lg); padding: 16px; }
.pr-stat .k { font-family: var(--mono); font-size: 11px; color: var(--faint); text-transform: uppercase; letter-spacing: 0.07em; margin-bottom: 8px; }
.pr-stat .n { font-family: var(--display); font-size: 27px; font-weight: 800; color: var(--text); letter-spacing: -0.03em; font-feature-settings: 'tnum' 1; }
.pr-stat .n.gold { color: var(--gold); } .pr-stat .n.red { color: var(--red-soft); } .pr-stat .n.green { color: var(--green); }
.pr-stat .d { font-family: var(--mono); font-size: 12px; color: var(--faint); margin-top: 6px; }
.pr-stat .d.up { color: var(--green); } .pr-stat .d.down { color: var(--red-soft); } .pr-stat .d.warn { color: var(--gold); }

.pr-banner {
  display: flex; align-items: center; gap: 16px; border-radius: var(--r-lg); padding: 18px 22px;
  background: color-mix(in oklch, var(--red) 12%, transparent); border: 1.5px solid color-mix(in oklch, var(--red) 42%, transparent);
}
.pr-banner .ic { display: grid; place-items: center; width: 44px; height: 44px; border-radius: var(--r); background: color-mix(in oklch, var(--red) 20%, transparent); flex: none; }
.pr-banner .bd { flex: 1; min-width: 0; }
.pr-banner .bd .h { font-family: var(--display); font-size: 16px; font-weight: 800; color: var(--text); margin-bottom: 2px; }
.pr-banner .bd .p { font-size: 14px; color: var(--text-2); }
.pr-banner.warn { background: color-mix(in oklch, var(--gold) 12%, transparent); border-color: color-mix(in oklch, var(--gold) 42%, transparent); }
.pr-banner.warn .ic { background: color-mix(in oklch, var(--gold) 20%, transparent); }

.pr-chart { position: relative; height: 150px; margin-top: 14px; }
.pr-chart.sm { height: 92px; }`;

const CONTROLS = `.pr-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 9px;
  padding: 9px 15px; border-radius: var(--r-sm); border: 1.5px solid var(--border); cursor: pointer;
  font: 700 13px var(--sans); text-transform: uppercase; letter-spacing: 0.04em;
  background: var(--surface-2); color: var(--text);
  transition: background .12s, border-color .12s, color .12s, transform .05s;
}
.pr-btn:hover { background: var(--hover); }
.pr-btn:active { transform: translateY(1px); }
.pr-btn:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
.pr-btn:disabled { opacity: 0.45; cursor: default; }
.pr-btn:disabled:active { transform: none; }
.pr-btn.sm { padding: 6px 11px; font-size: 11.5px; }
.pr-btn.block { width: 100%; }
.pr-btn.gold { background: var(--gold); color: var(--ink); border-color: var(--gold); }
.pr-btn.gold:hover { background: var(--gold-hi); }
.pr-btn.red { background: var(--red); color: #fff; border-color: var(--red); }
.pr-btn.red:hover { background: color-mix(in oklch, var(--red) 88%, white); }
.pr-btn.blue { background: var(--blue); color: #fff; border-color: var(--blue); }
.pr-btn.blue:hover { background: color-mix(in oklch, var(--blue) 88%, white); }
.pr-btn.ghost { background: transparent; border-color: var(--border); color: var(--text-2); }
.pr-btn.ghost:hover { background: var(--surface-2); color: var(--text); }
.pr-btn.danger { background: color-mix(in oklch, var(--red) 12%, transparent); border-color: color-mix(in oklch, var(--red) 42%, transparent); color: var(--red-soft); }
.pr-btn.danger:hover { background: color-mix(in oklch, var(--red) 20%, transparent); }

.pr-label { display: block; font-size: 13px; font-weight: 600; color: var(--text-2); margin-bottom: 7px; }
.pr-input {
  width: 100%; padding: 10px 12px; background: var(--bg);
  border: 1.5px solid var(--border); border-radius: var(--r-sm); color: var(--text);
  font: 14px var(--sans); outline: none; transition: border-color .12s, box-shadow .12s;
}
.pr-input::placeholder { color: var(--faint); }
.pr-input:focus { border-color: var(--gold); box-shadow: 0 0 0 2px var(--ring); }
.pr-input.mono { font-family: var(--mono); }

.pr-pill {
  display: inline-flex; align-items: center; gap: 6px; font-family: var(--mono); font-size: 11px; font-weight: 700;
  padding: 4px 10px; border-radius: var(--r-sm); color: var(--text-2); background: var(--surface-2); width: fit-content;
  text-transform: uppercase; letter-spacing: 0.04em;
}
.pr-pill.ok { color: var(--green); background: color-mix(in oklch, var(--green) 14%, transparent); }
.pr-pill.low { color: var(--gold); background: color-mix(in oklch, var(--gold) 14%, transparent); }
.pr-pill.crit { color: var(--red-soft); background: color-mix(in oklch, var(--red) 14%, transparent); }
.pr-pill.info { color: var(--blue); background: color-mix(in oklch, var(--blue) 14%, transparent); }
.pr-pill .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex: none; }
.pr-pill.siren .dot { animation: prSiren 1.1s infinite; }

/* switch (checkbox styled as a track + knob) */
.pr-switch { position: relative; width: 44px; height: 24px; flex: none; cursor: pointer; }
.pr-switch input { position: absolute; opacity: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; }
.pr-switch .track { position: absolute; inset: 0; border-radius: var(--r-sm); background: var(--hover); transition: background .12s; }
.pr-switch .knob { position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 1px; background: var(--muted); transition: left .12s, background .12s; }
.pr-switch input:checked ~ .track { background: var(--gold); }
.pr-switch input:checked ~ .knob { left: 23px; background: var(--ink); }
.pr-switch input:focus-visible ~ .track { outline: 2px solid var(--ring); outline-offset: 2px; }

input[type=range].pr-range { -webkit-appearance: none; appearance: none; width: 100%; height: 6px; border-radius: var(--r-sm); background: var(--surface-2); outline: none; }
input[type=range].pr-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 18px; height: 18px; border-radius: var(--r-sm); background: var(--gold); cursor: pointer; }
input[type=range].pr-range::-moz-range-thumb { width: 18px; height: 18px; border: none; border-radius: var(--r-sm); background: var(--gold); cursor: pointer; }
input[type=range].pr-range:focus-visible { outline: 2px solid var(--ring); outline-offset: 3px; }

/* segmented control */
.pr-seg { display: flex; gap: 8px; }
.pr-seg button { flex: 1; padding: 11px; border-radius: var(--r-sm); border: 1.5px solid var(--border); cursor: pointer; font: 700 12.5px var(--sans); text-transform: uppercase; letter-spacing: 0.04em; background: var(--surface-2); color: var(--muted); transition: all .12s; }
.pr-seg button.on { border-color: var(--gold); background: color-mix(in oklch, var(--gold) 12%, transparent); color: var(--gold); }
.pr-seg button:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }

/* list rows (meters, alerts, channels) */
.pr-list > * { border-top: 1px solid var(--border-soft); }
.pr-list > *:first-child { border-top: 0; }
.pr-rowitem { display: flex; align-items: center; gap: 12px; padding: 13px 0; }
.pr-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.pr-chan-ic { display: grid; place-items: center; width: 38px; height: 38px; border-radius: var(--r); flex: none; }

/* tables */
.pr-tableshell { overflow: hidden; }
.pr-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.pr-table thead th {
  text-align: left; padding: 11px 14px; white-space: nowrap;
  font-family: var(--mono); font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.07em;
  color: var(--faint); font-weight: 700; border-bottom: 1px solid var(--border-soft);
}
.pr-table tbody td { padding: 12px 14px; white-space: nowrap; color: var(--text-2); border-top: 1px solid var(--border-soft); }
.pr-table tbody tr:first-child td { border-top: 0; }
.pr-table tbody tr.click { cursor: pointer; }
.pr-table tbody tr.click:hover { background: var(--surface-2); }

.pr-empty { color: var(--muted); text-align: center; padding: 30px 0; font-size: 13.5px; }
.pr-err { color: var(--red-soft); min-height: 18px; font-size: 13px; }
.pr-good { color: var(--green); min-height: 18px; font-size: 13px; }

.pr-grid { display: grid; gap: 16px; }
.pr-2col { grid-template-columns: 1.55fr minmax(0, 1fr); }
.pr-2col-even { grid-template-columns: minmax(0, 1fr) minmax(0, 0.9fr); align-items: start; }
.pr-stack { display: flex; flex-direction: column; gap: 16px; }`;

const LOGIN = `.pr-loginwrap {
  position: relative; z-index: 1; min-height: 100vh; display: grid;
  grid-template-columns: 1.05fr 0.95fr; align-items: center; gap: 56px;
  max-width: 1180px; margin: 0 auto; padding: 48px 32px;
}
.pr-loginbrand h1 { font-family: var(--display); margin: 28px 0 18px; font-size: 52px; line-height: 0.98; letter-spacing: -0.03em; font-weight: 900; text-transform: uppercase; color: var(--text); }
.pr-loginbrand h1 span { color: var(--gold); }
.pr-loginbrand p { font-size: 17px; line-height: 1.6; color: var(--text-3); max-width: 440px; }
.pr-peek {
  display: inline-flex; align-items: center; gap: 16px; margin-top: 32px;
  background: var(--surface); border: 1.5px solid color-mix(in oklch, var(--red) 42%, transparent); border-radius: var(--r-lg);
  padding: 16px 20px; box-shadow: 6px 6px 0 var(--bg), 6px 6px 0 1.5px var(--border); animation: prFloat 6s ease-in-out infinite;
}
.pr-formcard {
  background: var(--surface); border: 1.5px solid var(--border); border-radius: var(--r-lg); padding: 34px;
  box-shadow: 8px 8px 0 var(--bg), 8px 8px 0 1.5px var(--border); max-width: 440px; width: 100%; justify-self: center;
}
.pr-tabs { display: flex; gap: 6px; padding: 5px; background: var(--surface-2); border: 1.5px solid var(--border-soft); border-radius: var(--r); }
.pr-tab { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 11px; border-radius: var(--r-sm); border: none; cursor: pointer; font: 700 13px var(--sans); text-transform: uppercase; letter-spacing: 0.04em; background: transparent; color: var(--muted); transition: all .12s; }
.pr-tab.on { background: var(--gold); color: var(--ink); }
.pr-tab:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
.pr-authpanel { max-width: 380px; margin: 0 auto; }`;

// Extras for the multi-screen app/admin: a client-side screen router, the topbar
// meter selector, a "sample data" marker for placeholdered surfaces, recharge
// chips, the highlighted plan card, the circular balance gauge and a notice strip.
const EXTRAS = `.pr-screen { display: none; }
.pr-screen.on { display: block; }
.pr-chart.lg { height: 220px; }

.pr-mselwrap { display: flex; align-items: center; gap: 6px; padding: 5px; background: var(--surface-2); border: 1.5px solid var(--border-soft); border-radius: var(--r); flex: none; }
.pr-mselbtn { display: inline-flex; align-items: center; gap: 7px; padding: 7px 12px; border-radius: var(--r-sm); border: none; cursor: pointer; font: 600 13px var(--sans); background: transparent; color: var(--muted); white-space: nowrap; transition: background .12s, color .12s; }
.pr-mselbtn .dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.pr-mselbtn:hover { color: var(--text-2); }
.pr-mselbtn.on { background: var(--surface); color: var(--text); }
.pr-mselbtn:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; }

.pr-sample { display: inline-flex; align-items: center; gap: 5px; font-family: var(--mono); font-size: 9.5px; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; color: var(--faint); background: var(--surface-2); border: 1px solid var(--border-soft); padding: 2px 7px; border-radius: var(--r-sm); }

.pr-chip { flex: 1; min-width: 80px; padding: 16px 10px; border-radius: var(--r-sm); border: 1.5px solid var(--border); background: var(--bg); color: var(--text-2); font: 700 15px var(--mono); cursor: pointer; transition: all .12s; }
.pr-chip.on { border: 1.5px solid var(--gold); background: color-mix(in oklch, var(--gold) 12%, transparent); color: var(--gold); }
.pr-paybtn { flex: 1; padding: 12px; border-radius: var(--r-sm); border: 1.5px solid var(--border); background: var(--bg); color: var(--text-2); font: 600 13px var(--sans); cursor: pointer; transition: all .12s; }
.pr-paybtn.on { border-color: var(--gold); background: color-mix(in oklch, var(--gold) 12%, transparent); color: var(--gold); }

.pr-plan { background: var(--surface); border: 1.5px solid var(--gold); border-radius: var(--r-lg); padding: 24px; }
.pr-feat { display: flex; gap: 9px; align-items: center; font-size: 13px; color: var(--text-2); }

.pr-notice { display: flex; gap: 12px; align-items: flex-start; background: color-mix(in oklch, var(--blue) 10%, transparent); border: 1.5px solid color-mix(in oklch, var(--blue) 34%, transparent); border-radius: var(--r); padding: 13px 16px; font-size: 13px; line-height: 1.5; color: var(--text-2); }
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
  .pr-2col, .pr-2col-even { grid-template-columns: minmax(0, 1fr); }
  .pr-statrow { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .pr-loginwrap { grid-template-columns: 1fr; }
  .pr-loginbrand { display: none; }
  .pr-mselwrap { display: none; }
}
@media (max-width: 520px) {
  .pr-statrow { grid-template-columns: minmax(0, 1fr); }
  .pr-loginbrand h1 { font-size: 38px; }
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
 * Include once after the Chart.js <script>. Expects Chart to be global. Canvas
 * can't read CSS custom properties, so the theme colours are inlined here to
 * match the token values above.
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
        tooltip: { backgroundColor: '#171410', borderColor: '#3a3126', borderWidth: 1, titleColor: '#f5f1ea', bodyColor: '#cfc6b8', padding: 10, displayColors: false, callbacks: { label: function (c) { return '\\u09F3' + Number(c.parsed.y).toFixed(2); } } },
      },
      scales: {
        x: { ticks: { maxTicksLimit: 7, color: '#837a68', font: { size: 11, family: "'JetBrains Mono', monospace" } }, grid: { display: false }, border: { display: false } },
        y: { ticks: { color: '#837a68', font: { size: 11, family: "'JetBrains Mono', monospace" } }, grid: { color: 'rgba(255,255,255,0.05)' }, border: { display: false } },
      },
    },
    plugins: [window.prThresholdPlugin],
  });
};`;

/** Shared client helpers (escape + ৳ money format) as an inline JS string. */
export const CLIENT_HELPERS = `
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => n === null || n === undefined ? 'n/a' : '\\u09F3' + Number(n).toFixed(2);
const when = s => s ? new Date(s).toLocaleString() : 'n/a';`;
