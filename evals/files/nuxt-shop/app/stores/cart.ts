import { defineStore } from 'pinia';

export const useCartStore = defineStore('cart', {
  state: () => ({ itemCount: 0 }),
});
