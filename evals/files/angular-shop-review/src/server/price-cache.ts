// Product prices are expensive to fetch, so the SSR server keeps them for 10 minutes.
const cache = new Map<string, { value: unknown; until: number }>();

export async function cachedPrice(productCode: string, load: () => Promise<unknown>) {
  const hit = cache.get(productCode);
  if (hit && hit.until > Date.now()) return hit.value;
  const value = await load();
  cache.set(productCode, { value, until: Date.now() + 10 * 60_000 });
  return value;
}
