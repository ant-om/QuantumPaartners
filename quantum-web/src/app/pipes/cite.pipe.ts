import { Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { CitationIndex, renderCitedText } from '../services/citations';

/** Citation markers for model prose rendered WITHOUT markdown — headlines,
 *  takeaways, horizon rationales, certainty explanations.
 *
 *  Usage: [innerHTML]="text | cite : citations"
 *
 *  bypassSecurityTrustHtml is safe for the same reason as the `md` pipe:
 *  renderCitedText HTML-escapes the whole source first, so the only live HTML
 *  is the superscript markers this app emits. */
@Pipe({ name: 'cite', standalone: false, pure: true })
export class CitePipe implements PipeTransform {
  constructor(private sanitizer: DomSanitizer) {}

  transform(value: string | null | undefined, citations?: CitationIndex | null): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(renderCitedText(value, citations));
  }
}
