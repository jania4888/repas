import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { AuthService } from '@core/services/auth.service';

@Component({
  selector: 'app-firm-settings',
  standalone: true,
  imports: [CommonModule, RouterModule, PageHeaderComponent],
  template: `
    <app-page-header
      title="Paramètres cabinet"
      subtitle="Gérez la configuration de votre cabinet comptable">
    </app-page-header>

    <div class="fs-cards">
      @if (isFirmManager()) {
        <a routerLink="/firm/settings/profile" class="fs-card-link">
          <div class="fs-card">
            <div class="fs-card__icon"><i class="pi pi-id-card"></i></div>
            <div class="fs-card__body">
              <h2 class="fs-card__title">Fiche annuaire</h2>
              <p class="fs-card__desc">Présentez votre cabinet pour être choisi par les sociétés.</p>
            </div>
            <i class="pi pi-chevron-right fs-card__chevron"></i>
          </div>
        </a>

        <a routerLink="/firm/collaborateurs" class="fs-card-link">
          <div class="fs-card">
            <div class="fs-card__icon"><i class="pi pi-users"></i></div>
            <div class="fs-card__body">
              <h2 class="fs-card__title">Collaborateurs</h2>
              <p class="fs-card__desc">Gérer les comptables et responsables du cabinet.</p>
            </div>
            <i class="pi pi-chevron-right fs-card__chevron"></i>
          </div>
        </a>

        <a routerLink="/firm/settings/activity-codes" class="fs-card-link">
          <div class="fs-card">
            <div class="fs-card__icon"><i class="pi pi-tags"></i></div>
            <div class="fs-card__body">
              <h2 class="fs-card__title">Types d’activité</h2>
              <p class="fs-card__desc">Définir les codes de diligence utilisés dans les feuilles de temps.</p>
            </div>
            <i class="pi pi-chevron-right fs-card__chevron"></i>
          </div>
        </a>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .fs-cards { display: grid; gap: 12px; max-width: 560px; }
    .fs-card-link { text-decoration: none; color: inherit; display: block; max-width: 480px; }
    .fs-card {
      display: flex;
      align-items: center;
      gap: var(--spacing-4, 16px);
      padding: var(--spacing-4, 16px) var(--spacing-5, 20px);
      background: var(--color-surface, #fff);
      border: 1px solid var(--color-border-subtle, #e2e8f0);
      border-radius: var(--radius-xl, 16px);
      box-shadow: var(--shadow-soft-sm, 0 1px 2px rgba(15, 23, 42, 0.05));
      transition: all 0.15s ease;
    }
    .fs-card:hover { border-color: var(--color-primary-300, #93c5fd); box-shadow: var(--shadow-soft-md, 0 4px 12px rgba(15, 23, 42, 0.08)); }
    .fs-card__icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      border-radius: var(--radius-lg, 12px);
      background: var(--color-primary-50, #eff6ff);
      color: var(--color-primary-600, #2563eb);
      font-size: 1.2rem;
      flex-shrink: 0;
    }
    .fs-card__body { flex: 1; }
    .fs-card__title { margin: 0; font-size: 1rem; font-weight: 600; color: var(--color-text-primary, #0f172a); }
    .fs-card__desc { margin: 2px 0 0; font-size: 0.875rem; color: var(--color-text-secondary, #64748b); }
    .fs-card__chevron { color: var(--color-text-tertiary, #94a3b8); }
  `]
})
export class FirmSettingsComponent {
  private readonly auth = inject(AuthService);
  readonly isFirmManager = computed(() => this.auth.isFirmManager());
}
