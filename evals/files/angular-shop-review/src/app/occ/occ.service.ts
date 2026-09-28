import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class OccService {
  private http = inject(HttpClient);
  private base = `${environment.occBaseUrl}/occ/v2/${environment.occSite}`;

  getProduct(code: string) {
    return this.http.get<any>(`${this.base}/products/${code}`, {
      params: { fields: 'code,name,price(formattedValue),images(DEFAULT)', lang: 'en', curr: 'USD' },
    });
  }
}
