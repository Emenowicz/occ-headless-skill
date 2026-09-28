import { getProduct } from '@/lib/occ';

export default async function ProductPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const product = await getProduct(code);
  const image = product.images?.find((i) => i.imageType === 'PRIMARY' && i.format === 'product');

  return (
    <article>
      <h1>{product.name}</h1>
      {image && <img src={`${process.env.OCC_HOST}${image.url}`} alt={product.name} />}
      <p>{product.price?.formattedValue}</p>
    </article>
  );
}
