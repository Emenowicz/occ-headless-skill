import Image from 'next/image';
import { getProduct } from '@/lib/occ';
import { mediaUrl } from '@/lib/media';
import { formatPrice } from '@/lib/price';
import { AddToCart } from './AddToCart';

export default async function ProductPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const product = await getProduct(code);
  const image = product.images?.find((i) => i.imageType === 'PRIMARY' && i.format === 'product');

  return (
    <article>
      <h1>{product.name}</h1>
      {image && <Image src={mediaUrl(image.url)} alt={product.name} width={300} height={300} />}
      <p>{formatPrice(product.price)}</p>
      <AddToCart code={product.code} />
    </article>
  );
}
