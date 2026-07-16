import { NgModule } from '@angular/core';
import { BrowserModule, provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { FormsModule } from '@angular/forms';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { HomeComponent } from './pages/home/home.component';
import { StockDetailComponent } from './pages/stock-detail/stock-detail.component';
import { FactorDetailComponent } from './pages/factor-detail/factor-detail.component';
import { AboutPageComponent } from './pages/about/about.component';
import { NewsletterPageComponent } from './pages/newsletter/newsletter.component';
import { NewsletterSignupComponent } from './components/newsletter-signup/newsletter-signup.component';
import { DynamicIslandTocComponent } from './components/dynamic-island-toc/dynamic-island-toc.component';
import { SentimentChipComponent } from './components/sentiment-chip/sentiment-chip.component';
import { ScoreGaugeComponent } from './components/score-gauge/score-gauge.component';
import { AnalysisSectionComponent } from './components/analysis-section/analysis-section.component';
import { MetricChartsComponent } from './components/metric-charts/metric-charts.component';
import { NavComponent } from './components/nav/nav.component';
import { StockCardComponent } from './components/stock-card/stock-card.component';
import { FactorCardComponent } from './components/factor-card/factor-card.component';
import { AnalysisChartsComponent } from './components/analysis-charts/analysis-charts.component';
import { BlockScoreBarsComponent } from './components/block-score-bars/block-score-bars.component';
import { TickerTapeComponent } from './components/ticker-tape/ticker-tape.component';
import { RevealDirective } from './directives/reveal.directive';

@NgModule({
  declarations: [
    AppComponent,
    HomeComponent,
    StockDetailComponent,
    FactorDetailComponent,
    AboutPageComponent,
    NewsletterPageComponent,
    NewsletterSignupComponent,
    DynamicIslandTocComponent,
    SentimentChipComponent,
    ScoreGaugeComponent,
    AnalysisSectionComponent,
    MetricChartsComponent,
    NavComponent,
    StockCardComponent,
    FactorCardComponent,
    AnalysisChartsComponent,
    BlockScoreBarsComponent,
    TickerTapeComponent,
    RevealDirective,
  ],
  imports: [
    BrowserModule,
    BrowserAnimationsModule,
    AppRoutingModule,
    FormsModule,
  ],
  providers: [
    provideClientHydration(withEventReplay())
  ],
  bootstrap: [AppComponent]
})
export class AppModule { }
