import { Component, computed, input } from '@angular/core';

@Component({
  selector: 'cms-link',
  template: `<a [href]="data().url" [attr.target]="target()" [attr.rel]="target() === '_blank' ? 'noopener' : null">{{ data().linkName }}</a>`,
})
export class LinkComponent {
  data = input.required<any>();
  target = computed(() => (this.data().external ? '_blank' : '_self'));
}
