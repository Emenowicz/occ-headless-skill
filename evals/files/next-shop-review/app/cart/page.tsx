import { cookies } from 'next/headers';
import { getCart } from '@/lib/occ';

export default async function CartPage() {
  const jar = await cookies();
  const token = jar.get('token')?.value;
  const cartId = jar.get('cart')?.value;
  if (!cartId) return <p>Your cart is empty.</p>;
  const cart = await getCart(token ? 'current' : 'anonymous', cartId, token);
  return (
    <section>
      <h1>Your cart</h1>
      <p>{cart.totalItems} items, {cart.totalPrice?.formattedValue}</p>
    </section>
  );
}
