import { Routes } from '@angular/router';
import { ProductPage } from './pages/product-page';

export const routes: Routes = [
  { path: 'p/:code', component: ProductPage },
];
