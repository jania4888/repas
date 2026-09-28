import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, RouterModule } from '@angular/router';
import { AuthService } from '@core/services/auth.service';

/**
 * POS runs outside MainLayout (no FAB). Link to the full-screen assistant with return navigation.
 */
@Component({
  selector: 'app-pos-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterModule],
  template: `
    <router-outlet></router-outlet>
  `,
  styles: [`
    :host { display: block; position: relative; }
    .pos-ai-link {
      position: fixed;
      top: 12px;
      inset-inline-end: 12px;
      z-index: 1000;
      padding: 0.5rem 0.75rem;
      font-size: var(--font-size-sm, 0.875rem);
      font-weight: var(--font-weight-medium, 500);
      color: var(--color-primary-700, #1d4ed8);
      background: #fff;
      border: 2px solid var(--color-primary-600, #2563eb);
      border-radius: var(--radius-lg, 10px);
      text-decoration: none;
      box-shadow: 0 2px 8px rgba(37, 99, 235, 0.15);
    }
    .pos-ai-link:focus-visible {
      outline: 3px solid var(--color-primary-500);
      outline-offset: 2px;
    }
  `]
})
export class PosShellComponent {
  private readonly auth = inject(AuthService);

  readonly canAi = computed(() => this.auth.hasAllPermissions(['ai:chat']));
}
