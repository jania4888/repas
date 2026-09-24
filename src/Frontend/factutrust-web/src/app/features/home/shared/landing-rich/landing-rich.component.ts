import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { RichText } from '../../content/landing-copy.types';

/**
 * Rend un `RichText` (segments `{ text, kind? }`) sans jamais utiliser `innerHTML`.
 * `kind: 'ltr'` isole un sigle / nombre en RTL (`<span dir="ltr">`).
 */
@Component({
  selector: 'app-landing-rich',
  standalone: true,
  template: `@for (s of segments(); track $index) {
    @if (s.kind === 'strong') {
      <strong>{{ s.text }}</strong>
    } @else if (s.kind === 'em') {
      <em>{{ s.text }}</em>
    } @else if (s.kind === 'ltr') {
      <span dir="ltr" class="ltr-inline">{{ s.text }}</span>
    } @else {
      {{ s.text }}
    }
  }`,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LandingRichComponent {
  readonly segments = input.required<RichText>();
}
