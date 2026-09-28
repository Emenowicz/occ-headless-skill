import { Component, computed, inject, input } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';

@Component({
  selector: 'cms-paragraph',
  template: `<div [innerHTML]="html()"></div>`,
})
export class ParagraphComponent {
  data = input.required<{ content: string }>();
  private sanitizer = inject(DomSanitizer);
  html = computed(() => this.sanitizer.bypassSecurityTrustHtml(this.data().content));
}
