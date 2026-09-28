import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

const BASE = '/api/occ';

@Injectable({ providedIn: 'root' })
export class B2bCartService {
  private http = inject(HttpClient);

  addToCart(cartCode: string, productCode: string, quantity: number) {
    return this.http.post(`${BASE}/users/current/carts/${cartCode}/entries`, { product: { code: productCode }, quantity });
  }

  payOnAccount(cartCode: string, costCenter: string, poNumber: string) {
    return this.http.put(`${BASE}/users/current/carts/${cartCode}/paymenttype`, null, {
      params: { paymentType: 'ACCOUNT', purchaseOrderNumber: poNumber },
    });
  }

  setCostCenter(cartCode: string, costCenter: string) {
    return this.http.put(`${BASE}/users/current/carts/${cartCode}/costcenter`, null, { params: { costCenterId: costCenter } });
  }

  // The buyer types the delivery address into the checkout form.
  setDeliveryAddress(cartCode: string, address: Record<string, unknown>) {
    return this.http.post(`${BASE}/users/current/carts/${cartCode}/addresses/delivery`, address);
  }

  placeOrder(cartCode: string) {
    return this.http.post(`${BASE}/orgUsers/current/orders`, null, { params: { cartId: cartCode } });
  }
}
