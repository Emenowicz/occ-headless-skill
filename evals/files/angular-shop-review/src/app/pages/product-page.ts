import { Component, inject, input, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';

@Component({
  selector: 'app-product-page',
  template: `
    @if (notFound()) { <h1>Sorry, this product does not exist.</h1> }
    @else if (product(); as p) { <h1>{{ p.name }}</h1><p>{{ p.price?.formattedValue }}</p> }
  `,
})
export class ProductPage {
  code = input.required<string>();
  private http = inject(HttpClient);
  product = signal<any>(null);
  notFound = signal(false);

  ngOnInit() {
    this.http.get<any>(`/api/occ/products/${this.code()}`, { params: { fields: 'code,name,price(formattedValue)' } }).subscribe({
      next: (p) => this.product.set(p),
      error: (e) => { if (e.status === 404) this.notFound.set(true); },
    });
  }
}
