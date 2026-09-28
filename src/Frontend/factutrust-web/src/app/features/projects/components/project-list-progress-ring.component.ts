import { CommonModule } from '@angular/common';
import { Component, input } from '@angular/core';

@Component({
  selector: 'app-project-list-progress-ring',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="proj-list-ring" role="img" [attr.aria-label]="loc_ui_tern_avancement_5143c0 + value() + loc_ui_tern_pour_cent_8f8638">
      <svg viewBox="0 0 36 36" class="proj-list-ring__svg" aria-hidden="true">
        <circle class="proj-list-ring__track" cx="18" cy="18" r="15.5" />
        <circle
          class="proj-list-ring__fill"
          cx="18"
          cy="18"
          r="15.5"
          [attr.stroke-dasharray]="circumference"
          [attr.stroke-dashoffset]="dashOffset()" />
      </svg>
      <span class="proj-list-ring__label">{{ value() }}%</span>
    </div>
  `,
  styles: [`
    .proj-list-ring {
      position: relative;
      width: 3.25rem;
      height: 3.25rem;
      margin-top: var(--spacing-2, 0.5rem);
    }
    .proj-list-ring__svg {
      width: 100%;
      height: 100%;
      transform: rotate(-90deg);
    }
    .proj-list-ring__track {
      fill: none;
      stroke: var(--color-neutral-200, #e2e8f0);
      stroke-width: 3;
    }
    .proj-list-ring__fill {
      fill: none;
      stroke: var(--color-primary-500, #3b82f6);
      stroke-width: 3;
      stroke-linecap: round;
      transition: stroke-dashoffset 0.4s ease;
    }
    .proj-list-ring__label {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.65rem;
      font-weight: 700;
      color: var(--color-text-primary, #0f172a);
    }
  `]
})
export class ProjectListProgressRingComponent {
  readonly loc_ui_tern_avancement_5143c0 = $localize`:@@ui.tern.avancement.5143c0:Avancement `;
  readonly loc_ui_tern_pour_cent_8f8638 = $localize`:@@ui.tern.pour.cent.8f8638: pour cent`;
  readonly value = input(0);
  readonly circumference = 2 * Math.PI * 15.5;

  dashOffset(): number {
    const pct = Math.min(100, Math.max(0, this.value()));
    return this.circumference * (1 - pct / 100);
  }
}
