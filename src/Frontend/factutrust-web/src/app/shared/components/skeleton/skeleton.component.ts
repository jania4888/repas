import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-skeleton',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div 
      class="skeleton" 
      [class.skeleton--circle]="shape === 'circle'"
      [class.skeleton--rounded]="shape === 'rounded'"
      [style.width]="width"
      [style.height]="height"
      [style.border-radius]="shape === 'circle' ? '50%' : shape === 'rounded' ? loc_ui_tern_var_radius_md_d50c22 : loc_ui_tern_var_radius_sm_1113ae"
      aria-hidden="true">
    </div>
  `,
  styles: [`
    .skeleton {
      background: linear-gradient(
        90deg,
        var(--color-neutral-200) 0%,
        var(--color-neutral-100) 50%,
        var(--color-neutral-200) 100%
      );
      background-size: 200% 100%;
      animation: shimmer 1.5s ease-in-out infinite;
      display: inline-block;
    }

    @keyframes shimmer {
      0% {
        background-position: -200% 0;
      }
      100% {
        background-position: 200% 0;
      }
    }

    .skeleton--circle {
      border-radius: 50%;
    }

    .skeleton--rounded {
      border-radius: var(--radius-md);
    }
  `]
})
export class SkeletonComponent {
  readonly loc_ui_tern_var_radius_md_d50c22 = "var(--radius-md)";
  readonly loc_ui_tern_var_radius_sm_1113ae = "var(--radius-sm)";
  @Input() width: string = '100%';
  @Input() height: string = '1rem';
  @Input() shape: 'default' | 'circle' | 'rounded' = 'default';
}
