// nicknames are interpolated into Telegram messages sent with
// parse_mode: Markdown and into dashboard HTML. An unmatched * or _ makes
// Telegram reject the whole message (the user silently stops getting
// alerts), so strip everything markup-significant at the input boundary.
const UNSAFE_CHARS = /[*_`~|\\[\]<>]/g;

export function sanitizeNickname(input: string): string {
  return input.replace(UNSAFE_CHARS, '').replace(/\s+/g, ' ').trim();
}
