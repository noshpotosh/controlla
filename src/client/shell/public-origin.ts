/**
 * An origin a phone can open. A page served from localhost means nothing to a
 * phone, so the dev server offers this machine's LAN address instead.
 */
export async function publicOrigin(): Promise<string> {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(location.hostname))
    return location.origin;
  try {
    const res = await fetch('/__controlla/lan');
    const { origins } = (await res.json()) as { origins: string[] };
    if (origins[0]) return origins[0].replace(/\/$/, '');
  } catch {
    /* Deployed build: no dev endpoint. */
  }
  return location.origin;
}
