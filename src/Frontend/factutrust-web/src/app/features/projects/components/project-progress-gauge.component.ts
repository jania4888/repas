import { CommonModule } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-project-progress-gauge',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="proj-dash-gauge" role="img" [attr.aria-label]="ariaLabel()">
      <h3 class="proj-dash-gauge__title" i18n="@@projects.components.avancement.global.5f0ee62d">Avancement global</h3>
      <svg viewBox="0 0 200 118" class="proj-dash-gauge__svg" aria-hidden="true">
        <path [attr.d]="trackPath()" class="proj-dash-gauge__track" />
        <path [attr.d]="valuePath()" class="proj-dash-gauge__fill" />
        <circle [attr.cx]="targetDot().x" [attr.cy]="targetDot().y" r="4" class="proj-dash-gauge__target-dot" />
      </svg>
      <div class="proj-dash-gauge__readout" i18n="@@projects.components.objectif.d07f894b">
        <strong class="proj-dash-gauge__value">{{ value() }} %</strong>
        <span class="proj-dash-gauge__target">Objectif : {{ target() }} %</span>
      </div>
      <a routerLink="/projects" class="proj-dash-gauge__link" i18n="@@projects.components.voir.le.rapport.complet.9f039147">Voir le rapport complet →</a>
    </div>
  `,
  styles: [`
    .proj-dash-gauge {
      background: var(--color-background-elevated, #fff);
      border: 1px solid var(--color-border-subtle, #e2e8f0);
      border-radius: var(--radius-2xl, 1rem);
      padding: 1.15rem 1.25rem 1.25rem;
      box-shadow: var(--shadow-soft-sm, 0 1px 2px rgb(0 0 0 / 6%));
      display: flex;
      flex-direction: column;
      align-items: center;
      height: 100%;
    }
    .proj-dash-gauge__title {
      margin: 0 0 0.5rem;
      align-self: flex-start;
      font-size: 1.05rem;
      font-weight: 600;
    }
    .proj-dash-gauge__svg { width: 100%; max-width: 220px; height: auto; }
    .proj-dash-gauge__track { fill: none; stroke: #e2e8f0; stroke-width: 14; stroke-linecap: round; }
    .proj-dash-gauge__fill { fill: none; stroke: #2563eb; stroke-width: 14; stroke-linecap: round; }
    .proj-dash-gauge__target-dot { fill: #10b981; }
    .proj-dash-gauge__readout {
      display: flex;
      flex-direction: column;
      align-items: center;
      margin-top: -1.5rem;
      gap: 0.15rem;
    }
    .proj-dash-gauge__value { font-size: 1.75rem; font-weight: 700; color: var(--color-text-primary, #0f172a); }
    .proj-dash-gauge__target { font-size: 0.8rem; color: var(--color-text-secondary, #64748b); }
    .proj-dash-gauge__link {
      margin-top: 0.75rem;
      font-size: 0.85rem;
      color: var(--color-primary-600, #2563eb);
      text-decoration: none;
    }
    .proj-dash-gauge__link:hover { text-decoration: underline; }
  `]
})
export class ProjectProgressGaugeComponent {
  readonly value = input(0);
  readonly target = input(90);

  readonly ariaLabel = computed(
    () => $localize`:@@projects.project-progress-gauge.ts.avancement.global.value.pour.cent.object.82b5f2a4:Avancement global ${this.value()}:value: pour cent, objectif ${this.target()}:target: pour cent`
  );

  private readonly cx = 100;
  private readonly cy = 100;
  private readonly r = 72;

  readonly trackPath = computed(() => this.arcPath(0, 1));
  readonly valuePath = computed(() => {
    const pct = Math.min(100, Math.max(0, this.value())) / 100;
    return pct <= 0 ? '' : this.arcPath(0, pct);
  });

  readonly targetDot = computed(() => {
    const t = Math.min(100, Math.max(0, this.target())) / 100;
    const angle = Math.PI * (1 - t);
    return {
      x: this.cx + this.r * Math.cos(angle),
      y: this.cy - this.r * Math.sin(angle)
    };
  });

  private arcPath(startRatio: number, endRatio: number): string {
    const startAngle = Math.PI * (1 - startRatio);
    const endAngle = Math.PI * (1 - endRatio);
    const x1 = this.cx + this.r * Math.cos(startAngle);
    const y1 = this.cy - this.r * Math.sin(startAngle);
    const x2 = this.cx + this.r * Math.cos(endAngle);
    const y2 = this.cy - this.r * Math.sin(endAngle);
    const large = endRatio - startRatio > 0.5 ? 1 : 0;
    return `M ${x1} ${y1} A ${this.r} ${this.r} 0 ${large} 1 ${x2} ${y2}`;
  }
}
