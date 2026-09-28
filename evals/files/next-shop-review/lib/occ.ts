const HOST = process.env.OCC_HOST!;
const SITE = process.env.OCC_SITE!;

export async function occFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${HOST}/occ/v2/${SITE}/${path}`, init);
  if (!res.ok) throw new Error(`OCC request failed: ${res.status}`);
  return res.json();
}

export type Price = { value: number; formattedValue: string };
export type Image = { url: string; format: string; imageType: string; galleryIndex?: number };
export type Product = { code: string; name: string; price?: Price; images?: Image[] };

export function getProduct(code: string) {
  return occFetch<Product>(`products/${encodeURIComponent(code)}?fields=code,name,price(FULL),images(DEFAULT)`);
}

export function getCart(userId: string, cartId: string, token?: string) {
  return occFetch<any>(`users/${userId}/carts/${cartId}?fields=DEFAULT`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    next: { revalidate: 60 },
  });
}

export function searchProducts(query: string, currentPage: number) {
  return occFetch<any>(
    `products/search?query=${encodeURIComponent(query)}&currentPage=${currentPage}&pageSize=24&fields=products(code,name,price(FULL),images(DEFAULT)),facets,breadcrumbs,pagination(DEFAULT),sorts(DEFAULT)`,
  );
}
