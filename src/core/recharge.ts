// The DESCO recharge URL, in one place. Deliberately a zero-import leaf: config.ts
// resolves RECHARGE_URL against this default, and config.ts must not reach into
// the notifications layer, so the constant can't live next to the templates that
// use it most.

export const DEFAULT_RECHARGE_URL = 'https://prepaid.desco.org.bd/';
