const HOST = process.env.OCC_HOST!;
const SITE = process.env.OCC_SITE!;

export type Product = {
  code: string;
  name: string;
  price?: { formattedValue: string };
  images?: { url: string; format: string; imageType: string }[];
};

export async function getProduct(code: string): Promise<Product> {
  const res = await fetch(
    `${HOST}/occ/v2/${SITE}/products/${encodeURIComponent(code)}?fields=code,name,price(formattedValue),images(DEFAULT)&lang=en&curr=USD`,
  );
  if (!res.ok) throw new Error(`OCC ${res.status}`);
  return res.json();
}
