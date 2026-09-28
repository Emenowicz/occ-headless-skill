import { Component, computed, input } from '@angular/core';

@Component({
  selector: 'cms-product-carousel',
  template: `@for (code of codes(); track code) { <app-product-tile [code]="code" /> }`,
})
export class ProductCarouselComponent {
  data = input.required<{ productCodes: string[] }>();
  codes = computed(() => this.data().productCodes.slice(0, 12));
}
