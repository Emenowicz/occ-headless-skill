import type { Price } from './occ';

export function formatPrice(price?: Price) {
  return price ? `$${price.value.toFixed(2)}` : '';
}
