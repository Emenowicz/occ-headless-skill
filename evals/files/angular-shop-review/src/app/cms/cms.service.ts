import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

export type CmsComponent = { uid: string; typeCode: string; [key: string]: any };
export type CmsPage = { uid: string; title?: string; contentSlots: { contentSlot: { position: string; components: { component: CmsComponent[] } }[] } };

@Injectable({ providedIn: 'root' })
export class CmsService {
  private http = inject(HttpClient);

  getContentPage(label: string) {
    return this.http.get<CmsPage>('/api/occ/users/anonymous/cms/pages', {
      params: { pageType: 'ContentPage', pageLabel: label, lang: 'en', curr: 'USD' },
    });
  }

  getComponents(ids: string[]) {
    return this.http.get<{ component: CmsComponent[] }>('/api/occ/users/anonymous/cms/components', {
      params: { componentIds: ids.join(','), fields: 'DEFAULT', lang: 'en', curr: 'USD' },
    });
  }
}
