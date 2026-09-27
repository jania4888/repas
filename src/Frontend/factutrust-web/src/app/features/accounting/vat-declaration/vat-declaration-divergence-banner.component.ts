import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { VatDivergenceRow } from './vat-declaration.view-model';

/**
 * Signale que les montants déposés ne correspondent plus à ce que les modules produisent.
 *
 * La déclaration enregistrée fait foi et n'est jamais réalignée toute seule : ce bandeau rend
 * l'écart visible et propose de le corriger, mais l'utilisateur reste seul à décider. Sur une
 * déclaration déjà soumise, la correction passe par une rectificative.
 */
@Component({
  selector: 'app-vat-declaration-divergence-banner',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (rows.length > 0 || payrollHint) {
      <div class="vat-divergence" [class.vat-divergence--info]="rows.length === 0">
        <div class="vat-divergence-head">
          <span class="vat-divergence-icon">{{ rows.length > 0 ? '⚠' : 'ⓘ' }}</span>
          <div>
            <strong>{{ headline }}</strong>
            @if (rows.length > 0) {
              <p class="vat-divergence-lead">{{ actionHint }}</p>
            }
            @if (payrollHint) {
              <p class="vat-divergence-lead">{{ payrollHint }}</p>
            }
          </div>
        </div>

        @if (rows.length > 0) {
          <ul class="vat-divergence-list">
            @for (row of rows; track row.label) {
              <li>
                <span class="vat-divergence-label">{{ row.label }}</span>
                <span class="vat-divergence-values">
                  <span class="vat-divergence-declared">{{ format(row.declared) }}</span>
                  <span class="vat-divergence-arrow" i18n="@@accounting.vat-declaration.text.213edd25">→</span>
                  <span class="vat-divergence-computed">{{ format(row.computed) }}</span>
                </span>
              </li>
            }
          </ul>

          @if (canResync) {
            <button type="button" class="vat-divergence-action" (click)="resync.emit()" i18n="@@accounting.vat-declaration.resynchroniser.depuis.les.modules.85cff7e2"> Resynchroniser depuis les modules </button>
          }
        }
      </div>
    }
  `,
  styles: `
    .vat-divergence { border: 1px solid var(--color-warning-300,#fcd34d); background: var(--color-warning-50,#fffbeb); border-radius: var(--radius-lg); padding: var(--spacing-4); margin-bottom: var(--spacing-4); }
    .vat-divergence--info { border-color: var(--color-border-default); background: var(--color-surface-subtle,#f8fafc); }
    .vat-divergence-head { display: flex; gap: var(--spacing-3); align-items: flex-start; }
    .vat-divergence-icon { font-size: var(--font-size-lg); line-height: 1.2; }
    .vat-divergence-lead { margin: var(--spacing-1) 0 0; font-size: var(--font-size-sm); color: var(--color-text-secondary); }
    .vat-divergence-list { list-style: none; margin: var(--spacing-3) 0 0; padding: 0; display: grid; gap: var(--spacing-1); }
    .vat-divergence-list li { display: flex; justify-content: space-between; gap: var(--spacing-4); font-size: var(--font-size-sm); padding: var(--spacing-1) 0; border-bottom: 1px dashed var(--color-border-subtle,#e5e7eb); }
    .vat-divergence-label { color: var(--color-text-primary); }
    .vat-divergence-values { display: flex; gap: var(--spacing-2); align-items: baseline; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .vat-divergence-declared { color: var(--color-text-tertiary); text-decoration: line-through; }
    .vat-divergence-arrow { color: var(--color-text-tertiary); }
    .vat-divergence-computed { color: var(--color-warning-700,#b45309); font-weight: var(--font-weight-semibold); }
    .vat-divergence-action { margin-top: var(--spacing-3); border: 1px solid var(--color-warning-600,#d97706); background: transparent; color: var(--color-warning-700,#b45309); border-radius: var(--radius-md); padding: var(--spacing-2) var(--spacing-3); font-size: var(--font-size-sm); font-weight: var(--font-weight-medium); cursor: pointer; }
    .vat-divergence-action:hover { background: var(--color-warning-100,#fef3c7); }
  `
})
export class VatDeclarationDivergenceBannerComponent {
  @Input() rows: VatDivergenceRow[] = [];

  /** Message sur l'état du cycle de paie, ou null s'il n'y a rien à signaler. */
  @Input() payrollHint: string | null = null;

  /** Marche à suivre, fonction du statut de la déclaration. */
  @Input() actionHint = '';

  /** L'utilisateur peut-il modifier les montants ? Masque l'action en lecture seule. */
  @Input() canResync = false;

  @Output() resync = new EventEmitter<void>();

  get headline(): string {
    const n = this.rows.length;
    if (n === 0) return 'Cycle de paie';
    return n === 1
      ? $localize`:@@ui.tern.1.ligne.s.ecarte.des.montants.calcules.par.9dca12:1 ligne s'écarte des montants calculés par les modules`
      : $localize`:@@ui.tern.ph.lignes.s.ecartent.des.montants.calcules.ee76fb:${n}:p0: lignes s'écartent des montants calculés par les modules`;
  }

  format(value: number): string {
    return value.toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  }
}
