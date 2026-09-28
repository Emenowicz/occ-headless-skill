'use client';
import { useState } from 'react';
import { addToCart } from '@/app/actions/cart';

export function AddToCart({ code }: { code: string }) {
  const [message, setMessage] = useState('');
  return (
    <>
      <button
        onClick={async () => {
          const result = await addToCart(code, 1);
          setMessage(result.ok ? 'Added to cart' : 'Something went wrong');
        }}
      >
        Add to cart
      </button>
      <p>{message}</p>
    </>
  );
}
