'use server';
import { cookies } from 'next/headers';

const BASE = `${process.env.OCC_HOST}/occ/v2/${process.env.OCC_SITE}`;

export async function placeOrder() {
  const jar = await cookies();
  const cartId = jar.get('cart')?.value;
  const token = jar.get('token')?.value;
  const res = await fetch(`${BASE}/users/current/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ cartId, termsChecked: true }),
  });
  if (!res.ok) throw new Error('Order failed');
  return res.json();
}
