import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { HomeComponent } from './pages/home/home.component';
import { StockDetailComponent } from './pages/stock-detail/stock-detail.component';

const routes: Routes = [
  { path: '', component: HomeComponent },
  { path: 'stock/:ticker', component: StockDetailComponent },
  { path: '**', redirectTo: '' },
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
