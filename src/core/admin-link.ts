/**
 * Build a deep link into the admin panel for an operator alarm, or '' when there
 * is no useful public URL (the localhost default would just send the operator to
 * their own machine). `hash` is the client route, e.g. 'logs/failed' or 'user/12'.
 */
export function adminDeepLink(publicBaseUrl: string | undefined | null, hash: string): string {
  if (
    !publicBaseUrl ||
    publicBaseUrl.includes('localhost') ||
    publicBaseUrl.includes('127.0.0.1')
  ) {
    return '';
  }
  return `${publicBaseUrl.replace(/\/+$/, '')}/admin#${hash}`;
}
