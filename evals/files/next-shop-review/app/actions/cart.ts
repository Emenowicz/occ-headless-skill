'use server';
import { cookies } from 'next/headers';

const BASE = `${process.env.OCC_HOST}/occ/v2/${process.env.OCC_SITE}`;

export async function addToCart(code: string, quantity: number) {
  const jar = await cookies();
  let cartId = jar.get('cart')?.value;
  if (!cartId) {
    const res = await fetch(`${BASE}/users/anonymous/carts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const cart = await res.json();
    cartId = cart.code as string;
    jar.set('cart', cartId, { httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
  }
  const res = await fetch(`${BASE}/users/anonymous/carts/${cartId}/entries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ product: { code }, quantity }),
  });
  return { ok: res.ok };
}
