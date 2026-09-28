import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CmsService, CmsPage } from '../cms/cms.service';

@Component({
  selector: 'app-content-page',
  template: `
    @if (failed()) { <h1>Something went wrong. Please try again later.</h1> }
    @else if (page(); as p) { <h1>{{ p.title }}</h1> <!-- slots rendered by <cms-page> --> }
  `,
})
export class ContentPage {
  private cms = inject(CmsService);
  private router = inject(Router);
  page = signal<CmsPage | null>(null);
  failed = signal(false);

  ngOnInit() {
    this.cms.getContentPage(this.router.url.split('?')[0]).subscribe({
      next: (p) => this.page.set(p),
      error: () => this.failed.set(true),
    });
  }
}
