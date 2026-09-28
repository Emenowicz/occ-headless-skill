'use client';
import { useRouter } from 'next/navigation';
import { placeOrder } from '@/app/actions/checkout';

export function PlaceOrderButton() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        const order = await placeOrder();
        router.push(`/order/${order.code}`);
      }}
    >
      Place order
    </button>
  );
}
