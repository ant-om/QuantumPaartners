import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { FormsModule } from '@angular/forms';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { HomeComponent } from './pages/home/home.component';
import { StockDetailComponent } from './pages/stock-detail/stock-detail.component';
import { DynamicIslandTocComponent } from './components/dynamic-island-toc/dynamic-island-toc.component';
import { SentimentChipComponent } from './components/sentiment-chip/sentiment-chip.component';
import { ScoreGaugeComponent } from './components/score-gauge/score-gauge.component';
import { AnalysisSectionComponent } from './components/analysis-section/analysis-section.component';
import { MetricChartsComponent } from './components/metric-charts/metric-charts.component';
import { NavComponent } from './components/nav/nav.component';
import { StockCardComponent } from './components/stock-card/stock-card.component';
import { TickerTapeComponent } from './components/ticker-tape/ticker-tape.component';
import { RevealDirective } from './directives/reveal.directive';

@NgModule({
  declarations: [
    AppComponent,
    HomeComponent,
    StockDetailComponent,
    DynamicIslandTocComponent,
    SentimentChipComponent,
    ScoreGaugeComponent,
    AnalysisSectionComponent,
    MetricChartsComponent,
    NavComponent,
    StockCardComponent,
    TickerTapeComponent,
    RevealDirective,
  ],
  imports: [
    BrowserModule,
    BrowserAnimationsModule,
    AppRoutingModule,
    FormsModule,
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule { }
