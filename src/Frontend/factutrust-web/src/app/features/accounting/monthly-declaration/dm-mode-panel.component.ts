import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonComponent } from '@shared/components/button/button.component';
import {
  MonthlyDeclarationMode,
  MonthlyDeclarationSettingsDto
} from '../services/accounting.service';
import {
  DM_MAX_OVERRIDE_REASON_LENGTH,
  DM_MODE_OPTIONS,
  DmModeForm,
  describeRamp,
  formatMillimes,
  needsOverrideReason,
  validateModeForm
} from './monthly-declaration-compute.view-model';
import { formatDateTimeFr } from '../vat-declaration/vat-declaration.view-model';

/**
 * Régime de calcul du dossier et état de sa rampe de bascule. Composant muet : il modifie le
 * brouillon qu'on lui confie et signale la demande ; le serveur revalide tout et reste seul juge.
 *
 * Le motif de dérogation n'apparaît que lorsqu'il est exigé — offrir le champ en permanence
 * suggérerait qu'on peut passer outre la série de contrôles à volonté.
 */
@Component({
  selector: 'app-dm-mode-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent],
  template: `
    @if (settings; as s) {
      <section class="card dm-mode">
        <h3 class="dm-mode__title" i18n="@@accounting.monthly-declaration.regime.de.calcul.392297bd">Régime de calcul</h3>
        <p class="dm-mode__ramp">{{ ramp }}</p>

        <dl class="dm-mode__facts">
          <div>
            <dt i18n="@@accounting.monthly-declaration.dernier.controle.9f050453">Dernier contrôle</dt>
            <dd>{{ s.lastParityRunAt ? lastRun : 'aucun' }}</dd>
          </div>
          <div>
            <dt i18n="@@accounting.monthly-declaration.dernier.ecart.7947e822">Dernier écart</dt>
            <dd>{{ s.lastParityRunAt ? lastGap : '—' }}</dd>
          </div>
          <div>
            <dt i18n="@@accounting.monthly-declaration.serie.sans.ecart.f7dfdfcc">Série sans écart</dt>
            <dd>{{ s.parityCleanStreak }} / {{ s.requiredCleanParityPeriods }}</dd>
          </div>
        </dl>

        @if (s.parityOverrideReason) {
          <p class="dm-mode__override">
            Bascule par dérogation de {{ s.parityOverrideBy }} : « {{ s.parityOverrideReason }} »
          </p>
        }

        @if (form; as f) {
          <div class="dm-mode__form">
            <div class="dm-field">
              <label class="dm-lbl" for="dm-mode" i18n="@@accounting.monthly-declaration.passer.en.4dcb22a1">Passer en</label>
              <select id="dm-mode" class="dm-inp" [(ngModel)]="f.mode" [disabled]="disabled">
                @for (o of modes; track o.value) {
                  <option [ngValue]="o.value">{{ o.label }}</option>
                }
              </select>
            </div>

            @if (showConfiguredSince) {
              <div class="dm-field">
                <label class="dm-lbl" for="dm-since" i18n="@@accounting.monthly-declaration.date.d.effet.ebfb317e">Date d’effet</label>
                <input
                  id="dm-since"
                  type="date"
                  class="dm-inp"
                  [(ngModel)]="f.configuredSince"
                  [disabled]="disabled" />
                <span class="dm-hint" i18n="@@accounting.monthly-declaration.premier.jour.du.mois.a.partir.duquel.le.calcul.p.83201e1c">Premier jour du mois à partir duquel le calcul paramétré fait foi. Les périodes
                  antérieures restent calculées à l’ancienne.</span>
              </div>
            }

            @if (showOverrideReason) {
              <div class="dm-field dm-grow">
                <label class="dm-lbl" for="dm-override" i18n="@@accounting.monthly-declaration.motif.de.derogation.38926796">Motif de dérogation</label>
                <textarea
                  id="dm-override"
                  class="dm-inp"
                  rows="2"
                  [maxlength]="maxReasonLength"
                  [(ngModel)]="f.overrideReason"
                  [disabled]="disabled"></textarea>
                <span class="dm-hint" i18n="@@accounting.monthly-declaration.la.serie.de.controles.sans.ecart.n.est.pas.attei.f05c8902">La série de contrôles sans écart n’est pas atteinte. Le motif est conservé dans
                  l’audit avec le nom de son auteur.</span>
              </div>
            }

            @if (validationError; as message) {
              <p class="dm-invalid">{{ message }}</p>
            }

            <div class="dm-actions">
              <app-button
                variant="primary"
                size="sm"
                type="button"
                [disabled]="disabled || saving || !!validationError"
                (click)="apply.emit()">
                {{ saving ? 'Application…' : 'Appliquer' }}
              </app-button>
            </div>
          </div>
        }
      </section>
    }
  `,
  styles: `
    .dm-mode { display: flex; flex-direction: column; gap: var(--spacing-3); }
    .dm-mode__title { margin: 0; font-size: var(--font-size-md); font-weight: var(--font-weight-semibold); }
    .dm-mode__ramp { margin: 0; font-size: var(--font-size-sm); color: var(--color-text-secondary); }
    .dm-mode__facts { display: flex; flex-wrap: wrap; gap: var(--spacing-5); margin: 0; }
    .dm-mode__facts dt { font-size: var(--font-size-xs); color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.04em; }
    .dm-mode__facts dd { margin: 0; font-weight: var(--font-weight-semibold); }
    .dm-mode__override { margin: 0; font-size: var(--font-size-sm); color: var(--color-warning-700, #a16207); }
    .dm-mode__form { display: flex; flex-wrap: wrap; gap: var(--spacing-3); align-items: flex-start; }
    .dm-field { display: flex; flex-direction: column; gap: var(--spacing-1); min-width: 11rem; }
    .dm-grow { flex: 1 1 20rem; }
    .dm-lbl { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--color-text-primary); }
    .dm-inp { padding: var(--spacing-2) var(--spacing-3); border: 1px solid var(--color-border-default); border-radius: var(--radius-md); background: var(--color-background-elevated); color: var(--color-text-primary); font-size: var(--font-size-sm); width: 100%; }
    .dm-hint { font-size: var(--font-size-xs); color: var(--color-text-secondary); }
    .dm-invalid { flex-basis: 100%; margin: 0; font-size: var(--font-size-sm); color: var(--color-danger-700, #b91c1c); }
    .dm-actions { flex-basis: 100%; display: flex; justify-content: flex-end; }
  `
})
export class DmModePanelComponent {
  @Input({ required: true }) settings!: MonthlyDeclarationSettingsDto | null;
  @Input() form: DmModeForm | null = null;
  @Input() disabled = false;
  @Input() saving = false;

  @Output() readonly apply = new EventEmitter<void>();

  readonly modes = DM_MODE_OPTIONS;
  readonly maxReasonLength = DM_MAX_OVERRIDE_REASON_LENGTH;

  get ramp(): string {
    return this.settings ? describeRamp(this.settings) : '';
  }

  get lastRun(): string {
    return formatDateTimeFr(this.settings?.lastParityRunAt);
  }

  get lastGap(): string {
    return formatMillimes(this.settings?.lastParityMaxGapMillimes ?? 0);
  }

  get showConfiguredSince(): boolean {
    return this.form?.mode === MonthlyDeclarationMode.Configured;
  }

  get showOverrideReason(): boolean {
    return !!this.form && !!this.settings && needsOverrideReason(this.form, this.settings);
  }

  get validationError(): string | null {
    return this.form && this.settings ? validateModeForm(this.form, this.settings) : null;
  }
}
