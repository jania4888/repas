import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { FixedAssetsService } from '../services/fixed-assets.service';
import { AccountingStatusBannerComponent } from '../shared/accounting-status-banner.component';
import {
  MONTH_LABELS_FR,
  defaultFiscalYearSettings
} from '../services/fixed-asset-settings-defaults';
import {
  fiscalYearEndDateTime,
  fiscalYearKey,
  fiscalYearLabel,
  fiscalYearStartDateTime
} from '../services/fiscal-year.util';
import { ErrorHandlerService } from '@core/services/error-handler.service';

/** Aperçu d'un libellé d'exercice pour un format donné et le mois de début courant. */
function sampleLabel(startMonth: number, format: string): string {
  const key = fiscalYearKey(new Date(), startMonth);
  return fiscalYearLabel(key, startMonth, format);
}

/** Date FR lisible « jj/mm/aaaa ». */
function toFrDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

/**
 * Paramétrage de l'exercice comptable du dossier (tenant) — support des exercices décalés
 * (plan « Exercices décalés », P4 frontend, décision D1=Variante B / D2 / D3).
 *
 * Règle `FixedAssetSettings { fiscalYearStartMonth, fiscalYearLabelFormat }` via l'endpoint
 * `GET/PUT /api/accounting/fixed-assets/settings` (permission Accounting). Quand l'exercice est
 * décalé (mois de début ≠ janvier), un bandeau signale la limitation transitoire : le Grand-Livre
 * reste en année civile (Variante B, phase 1).
 */
@Component({
  selector: 'app-fixed-asset-settings',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    PageHeaderComponent,
    ButtonComponent,
    AccountingStatusBannerComponent
  ],
  template: `
    <app-page-header
      title="Exercice comptable — Immobilisations" i18n-title="Exercice comptable — Immobilisations"
      subtitle="Définir la frontière d'exercice du dossier pour les dotations et le tableau d'amortissement" />

    <app-accounting-status-banner [message]="error() ?? ''" variant="error" *ngIf="error()" />
    <app-accounting-status-banner [message]="success() ?? ''" variant="success" *ngIf="success()" />

    <div class="card" *ngIf="loading()">
      <p class="hint" i18n="@@accounting.fixed-assets.chargement.des.parametres.28d37cc5">Chargement des paramètres…</p>
    </div>

    <div class="card" *ngIf="!loading()">
      <p class="hint" i18n="@@accounting.fixed-assets.l.exercice.comptable.determine.la.repartition.de.3debb716">L'exercice comptable détermine la répartition des dotations et le libellé des exercices
        dans le tableau CP17 et les exports Immobilisations. Par défaut, l'exercice coïncide avec
        l'année civile (janvier).</p>

      <app-accounting-status-banner
        *ngIf="isOffset()"
        title="Limitation transitoire" i18n-title="Limitation transitoire"
        [message]="offsetLimitationMessage"
        variant="warning" />

      <div class="form-grid">
        <label>
          Mois de début d'exercice *
          <select class="accounting-filter-input" [(ngModel)]="form.fiscalYearStartMonth" (ngModelChange)="onFormChange()">
            <option *ngFor="let m of monthOptions" [value]="m.value">{{ m.label }}</option>
          </select>
          <span class="hint" i18n="@@accounting.fixed-assets.1.janvier.exercice.civil.comportement.par.defaut.2bc6d026">1 = janvier (exercice civil, comportement par défaut).</span>
        </label>

        <fieldset class="form-section">
          <legend i18n="@@accounting.fixed-assets.format.du.libelle.d.exercice.9b92223f">Format du libellé d'exercice *</legend>
          <label class="radio-option">
            <input
              type="radio"
              name="labelFormat"
              value="N/N+1"
              [ngModel]="form.fiscalYearLabelFormat"
              (ngModelChange)="onLabelFormatChange($event)" />
            N/N+1 — ex. « {{ sampleFor('N/N+1') }} »
          </label>
          <label class="radio-option">
            <input
              type="radio"
              name="labelFormat"
              value="N"
              [ngModel]="form.fiscalYearLabelFormat"
              (ngModelChange)="onLabelFormatChange($event)" />
            N — ex. « {{ sampleFor('N') }} »
          </label>
        </fieldset>
      </div>

      <div class="preview">
        <p>
          <strong i18n="@@accounting.fixed-assets.apercu.33c24358">Aperçu :</strong> exercice courant affiché « {{ currentSample() }} »<ng-container *ngIf="isOffset()"> (frontière {{ offsetBoundary() }})</ng-container>.
        </p>
      </div>

      <div class="actions">
        <app-button variant="primary" type="button" (click)="save()" [disabled]="saving()" i18n="@@accounting.fixed-assets.enregistrer.les.parametres.f1ccef8d">Enregistrer les paramètres</app-button>
        <app-button variant="secondary" type="button" routerLink="/accounting/fixed-assets/depreciation-run" i18n="@@accounting.fixed-assets.aller.aux.dotations.1269addd">Aller aux dotations</app-button>
        <app-button variant="secondary" type="button" routerLink="/accounting/fixed-assets" i18n="@@accounting.fixed-assets.retour.au.registre.aa646cbf">Retour au registre</app-button>
      </div>
    </div>
  `,
  styles: [
    `
      .hint {
        font-size: 0.8rem;
        color: #64748b;
        margin: 0.25rem 0 0.75rem;
      }
      .form-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 1rem;
        margin-bottom: 1rem;
      }
      label {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
        font-size: 0.85rem;
        font-weight: 500;
      }
      .form-section {
        border: 1px solid #dbeafe;
        border-radius: 8px;
        padding: 0.75rem 1rem 1rem;
        margin: 0;
      }
      .form-section legend {
        font-size: 0.85rem;
        font-weight: 600;
        color: #1d4ed8;
        padding: 0 0.4rem;
      }
      .radio-option {
        flex-direction: row;
        align-items: center;
        gap: 0.5rem;
        font-weight: 400;
        margin: 0.35rem 0;
      }
      .preview {
        background: #f8fafc;
        border-radius: 8px;
        padding: 0.65rem 0.85rem;
        margin: 0.5rem 0 1rem;
        font-size: 0.85rem;
      }
      .preview p {
        margin: 0;
      }
      .actions {
        display: flex;
        gap: 0.75rem;
        flex-wrap: wrap;
        margin-top: 0.5rem;
      }
    `
  ]
})
export class FixedAssetSettingsComponent implements OnInit {
  private readonly errors = inject(ErrorHandlerService);
  private readonly api = inject(FixedAssetsService);

  readonly monthOptions = MONTH_LABELS_FR.map((label, idx) => ({ value: idx + 1, label }));

  readonly offsetLimitationMessage =
    "L'exercice est décalé : le Grand-Livre, les périodes et les verrous comptables restent en année civile. " +
    "Seul le module Immobilisations (dotations, tableau CP17, exports) applique la frontière d'exercice. " +
    "Le bascule complète du socle est planifiée séparément.";

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly success = signal<string | null>(null);

  form = { ...defaultFiscalYearSettings() };

  /** Vrai si l'exercice est décalé (mois de début ≠ janvier). Méthode (et non computed) car le
   *  formulaire est un objet simple muté par ngModel : un computed ne trackerait pas ces mutations
   *  et cacherait une valeur stale. */
  isOffset(): boolean {
    return this.form.fiscalYearStartMonth !== 1;
  }

  /** Libellé d'exercice courant selon les paramètres du formulaire (aperçu live). */
  currentSample(): string {
    return sampleLabel(this.form.fiscalYearStartMonth, this.form.fiscalYearLabelFormat);
  }

  /** Bornes de l'exercice courant affichées sous forme lisible (ex. « 01/07/2026 → 30/06/2027 »). */
  offsetBoundary(): string {
    const startMonth = this.form.fiscalYearStartMonth;
    const key = fiscalYearKey(new Date(), startMonth);
    const start = toFrDate(fiscalYearStartDateTime(key, startMonth));
    const end = toFrDate(fiscalYearEndDateTime(key, startMonth));
    return `${start} → ${end}`;
  }

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.getSettings().subscribe({
      next: res => {
        this.loading.set(false);
        if (res.data) {
          this.form = {
            fiscalYearStartMonth: res.data.fiscalYearStartMonth,
            fiscalYearLabelFormat: res.data.fiscalYearLabelFormat
          };
        }
      },
      error: err => {
        this.loading.set(false);
        this.error.set(this.errors.extractErrorMessage(err, 'Impossible de charger les paramètres d\'exercice.'));
      }
    });
  }

  onFormChange(): void {
    this.success.set(null);
  }

  onLabelFormatChange(value: string): void {
    this.form.fiscalYearLabelFormat = value;
    this.success.set(null);
  }

  /** Aperçu du libellé pour un format donné, avec le mois de début courant. */
  sampleFor(format: string): string {
    return sampleLabel(this.form.fiscalYearStartMonth, format);
  }

  save(): void {
    if (this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    this.success.set(null);
    this.api.updateSettings(this.form).subscribe({
      next: res => {
        this.saving.set(false);
        if (res.success && res.data) {
          this.form = {
            fiscalYearStartMonth: res.data.fiscalYearStartMonth,
            fiscalYearLabelFormat: res.data.fiscalYearLabelFormat
          };
          this.success.set('Paramètres d\'exercice enregistrés.');
        } else {
          this.error.set(res.message ?? 'Enregistrement impossible.');
        }
      },
      error: err => {
        this.saving.set(false);
        this.error.set(err?.error?.message ?? 'Enregistrement impossible.');
      }
    });
  }
}
