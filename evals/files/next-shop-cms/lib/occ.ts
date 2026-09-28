import 'server-only';

export class OccError extends Error {
  constructor(readonly status: number, readonly type?: string, readonly reason?: string) {
    super(`OCC ${status} ${type ?? ''} ${reason ?? ''}`.trim());
  }
}

const HOST = process.env.OCC_HOST!;
const SITE = process.env.OCC_SITE ?? 'electronics';

export async function occ<T>(path: string, params: Record<string, string> = {}, init: RequestInit = {}): Promise<T> {
  const url = new URL(`${HOST}/occ/v2/${SITE}/${path}`);
  url.searchParams.set('lang', process.env.OCC_LANG ?? 'en');
  url.searchParams.set('curr', process.env.OCC_CURR ?? 'USD');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { ...init, headers: { Accept: 'application/json', ...init.headers } });
  const text = await res.text();
  const body = text ? JSON.parse(text) : undefined;
  if (res.ok) return body as T;
  const e = body?.errors?.[0];
  throw new OccError(res.status, e?.type, e?.reason);
}

export const mediaUrl = (url?: string) => (url ? `${HOST}${url}` : undefined);
