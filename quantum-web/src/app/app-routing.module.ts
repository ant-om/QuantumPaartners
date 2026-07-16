import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { HomeComponent } from './pages/home/home.component';
import { StockDetailComponent } from './pages/stock-detail/stock-detail.component';
import { FactorDetailComponent } from './pages/factor-detail/factor-detail.component';
import { AboutPageComponent } from './pages/about/about.component';
import { NewsletterPageComponent } from './pages/newsletter/newsletter.component';

const routes: Routes = [
  { path: '', component: HomeComponent },
  { path: 'about', component: AboutPageComponent },
  { path: 'newsletter', component: NewsletterPageComponent },
  { path: 'stock/:ticker', component: StockDetailComponent },
  { path: 'stock/:ticker/:factor', component: FactorDetailComponent },
  { path: '**', redirectTo: '' },
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
