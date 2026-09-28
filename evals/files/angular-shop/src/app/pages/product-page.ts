import { Component, inject, input } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs';
import { OccService } from '../occ/occ.service';

@Component({
  selector: 'app-product-page',
  template: `@if (product(); as p) { <h1>{{ p.name }}</h1><p>{{ p.price?.formattedValue }}</p> }`,
})
export class ProductPage {
  code = input.required<string>();
  private occ = inject(OccService);
  product = toSignal(toObservable(this.code).pipe(switchMap((c) => this.occ.getProduct(c))));
}
