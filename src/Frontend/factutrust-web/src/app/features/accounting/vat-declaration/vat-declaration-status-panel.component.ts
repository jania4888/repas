import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { VatDeclarationDto } from '../services/accounting.service';
import { formatDateTimeFr, statusClass, statusLabel } from './vat-declaration.view-model';

@Component({
  selector: 'app-vat-declaration-status-panel',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (declaration; as d) {
      <div class="card vat-zone-card">
        <h3 class="vat-zone-title" i18n="@@accounting.vat-declaration.2.statut.de.la.declaration.8455bb1d">2. Statut de la déclaration</h3>
        <div class="vat-status-header"><ng-container i18n="@@accounting.vat-declaration.version.77603db3">
          <span class="vat-status-badge" [class]="badgeClass">{{ badgeLabel }}</span>
          <span class="vat-version">Version {{ d.version }}</span>
          </ng-container>@if (d.isRectificative) {
            <span class="vat-rectificative" i18n="@@accounting.vat-declaration.rectificative.886aa2ba">RECTIFICATIVE</span>
          }
        </div>
        <div class="vat-status-grid">
          <div class="vat-status-item">
            <span class="vat-status-label" i18n="@@accounting.vat-declaration.cree.le.046c02a0">Créé le</span>
            <span>{{ formatDateTime(d.createdAt) }}</span>
          </div>
          <div class="vat-status-item">
            <span class="vat-status-label" i18n="@@accounting.vat-declaration.derniere.modification.76b7837a">Dernière modification</span>
            <span>{{ formatDateTime(d.updatedAt) }}</span>
          </div>
          <div class="vat-status-item">
            <span class="vat-status-label" i18n="@@accounting.vat-declaration.soumis.le.7bcd611f">Soumis le</span>
            <span>{{ formatDateTime(d.submittedAt) }}</span>
          </div>
          <div class="vat-status-item">
            <span class="vat-status-label" i18n="@@accounting.vat-declaration.cree.par.cebcfaba">Créé par</span>
            <span>{{ d.createdBy ?? '—' }}</span>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    .vat-zone-card { padding: var(--spacing-5); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); margin-bottom: var(--spacing-4); }
    .vat-zone-title { font-size: var(--font-size-md); font-weight: var(--font-weight-semibold); margin: 0 0 var(--spacing-4); color: var(--color-text-primary); }
    .vat-status-header { display: flex; flex-wrap: wrap; align-items: center; gap: var(--spacing-2); margin-bottom: var(--spacing-4); }
    .vat-status-badge { padding: 0.25rem 0.75rem; border-radius: var(--radius-md); font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); }
    .vat-status--draft { background: var(--color-warning-50,#fffbeb); color: var(--color-warning-700,#a16207); border: 1px solid var(--color-warning-200,#fde68a); }
    .vat-status--submitted { background: var(--color-primary-50,#eff6ff); color: var(--color-primary-700,#1d4ed8); border: 1px solid var(--color-primary-200,#bfdbfe); }
    .vat-status--locked { background: var(--color-success-50,#f0fdf4); color: var(--color-success-700,#15803d); border: 1px solid var(--color-success-200,#bbf7d0); }
    .vat-version { font-size: var(--font-size-sm); color: var(--color-text-tertiary); }
    .vat-rectificative { font-size: var(--font-size-xs); font-weight: var(--font-weight-bold); color: var(--color-danger-700,#b91c1c); background: var(--color-danger-50,#fef2f2); padding: 0.15rem 0.5rem; border-radius: var(--radius-sm); }
    .vat-status-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr)); gap: var(--spacing-3); }
    .vat-status-item { display: flex; flex-direction: column; gap: 0.15rem; font-size: var(--font-size-sm); }
    .vat-status-label { color: var(--color-text-tertiary); font-size: var(--font-size-xs); }
  `
})
export class VatDeclarationStatusPanelComponent {
  @Input() declaration: VatDeclarationDto | null = null;

  readonly formatDateTime = formatDateTimeFr;

  get badgeLabel(): string {
    return this.declaration ? statusLabel(this.declaration.status) : '';
  }

  get badgeClass(): string {
    return this.declaration ? `vat-status-badge ${statusClass(this.declaration.status)}` : 'vat-status-badge';
  }
}
