import { Routes } from '@angular/router';
import { ProductPage } from './pages/product-page';
import { ContentPage } from './pages/content-page';

export const routes: Routes = [
  { path: 'p/:code', component: ProductPage },
  { path: '**', component: ContentPage },
];
