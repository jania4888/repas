import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LandingCopyService } from '../content/landing-copy.service';

/**
 * Page « Cabinets comptables » — SQUELETTE provisoire (TB1) remplacé intégralement par TB3.
 * Sert uniquement à faire exister la route `cabinets-comptables` sous le shell.
 */
@Component({
  selector: 'app-cabinets-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="chain-theme-root">
      <main id="top" class="container py-5">
        <p class="text-uppercase">{{ t().cabinets.hero.kicker }}</p>
        <h1>{{ t().cabinets.hero.title }}</h1>
        <p>{{ t().cabinets.hero.subtitle }}</p>
      </main>
    </div>
  `
})
export class CabinetsPageComponent {
  protected readonly t = inject(LandingCopyService).t;
}
