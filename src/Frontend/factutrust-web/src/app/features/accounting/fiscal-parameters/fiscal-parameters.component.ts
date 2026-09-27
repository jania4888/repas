import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, of } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { AccountingFilterBarComponent } from '../shared/accounting-filter-bar.component';
import { AccountingStatusBannerComponent } from '../shared/accounting-status-banner.component';
import { AccountingService, IncomeTaxYearParameterDto } from '../services/accounting.service';

/** Réponse d'API générique (miroir non exporté de `ApiResponse<T>` du service). */
interface FiscalParametersApiResponse {
  success: boolean;
  data?: IncomeTaxYearParameterDto;
  error?: string;
}

const MIN_FISCAL_YEAR = 2000;
const MAX_FISCAL_YEAR = 2100;
const UNSAVED_CHANGES_MESSAGE =
  $localize`:@@accounting.fiscal-parameters.ts.des.modifications.non.enregistrees.seron.a18f027c:Des modifications non enregistrées seront perdues. Continuer ?`;

/**
 * Paramétrage fiscal par exercice : taux IS, minimum d'impôt, CSS, acomptes, report des déficits et
 * barème IRPP. Indispensable car le droit fiscal tunisien évolue à chaque loi de finances — les
 * valeurs livrées ne sont que des références à valider par l'expert-comptable.
 */
@Component({
  selector: 'app-fiscal-parameters',
  standalone: true,
  imports: [CommonModule, FormsModule, PageHeaderComponent, ButtonComponent, AccountingFilterBarComponent, AccountingStatusBannerComponent],
  template: `
    <app-page-header title="Paramètres fiscaux" i18n-title="@@accounting.fiscal-parameters.parametres.fiscaux.ec3397a0"
      subtitle="Taux IS, minimum d'impôt, CSS, acomptes et barème IRPP — par exercice" i18n-subtitle="@@accounting.fiscal-parameters.taux.is.minimum.d.impot.css.acomptes.et.420bfe73" />

    @if (isDirty()) {
      <p class="fp-dirty-indicator" role="status" i18n="@@accounting.fiscal-parameters.modifications.non.enregistrees.af44fff0"><i class="pi pi-circle-fill" aria-hidden="true"></i> Modifications non enregistrées</p>
    }

    <div class="card accounting-filters-card">
      <app-accounting-filter-bar ariaLabel="Exercice des paramètres fiscaux" i18n-ariaLabel="@@accounting.fiscal-parameters.exercice.des.parametres.fiscaux.6b8e7d5a">
        <div accountingFilterFields>
          <div class="accounting-filter-field">
            <label class="accounting-filter-label" for="fp-year" i18n="@@accounting.fiscal-parameters.exercice.e171e2b0">Exercice</label>
            <input id="fp-year" type="number" [ngModel]="fiscalYear" (ngModelChange)="onYearInputChange($event)"
              class="accounting-filter-input fp-year-input" min="2000" max="2100"
              [attr.aria-invalid]="!isYearValid()" />
            @if (!isYearValid()) {
              <span class="fp-year-error" role="alert" i18n="@@accounting.fiscal-parameters.exercice.invalide.doit.etre.compris.entre.2000.e.db4c8a16">Exercice invalide : doit être compris entre 2000 et 2100.</span>
            }
          </div>
        </div>
        <div accountingFilterActions>
          <app-button variant="secondary" icon="pi pi-refresh" type="button" (click)="load()" [disabled]="loading() || !isYearValid()"
            ariaLabel="Charger les paramètres de l'exercice" i18n-ariaLabel="@@accounting.fiscal-parameters.charger.les.parametres.de.l.exercice.c853e85c" i18n="@@accounting.fiscal-parameters.charger.8f860300">Charger</app-button>
          <app-button variant="primary" icon="pi pi-save" type="button" (click)="save()" [disabled]="loading() || saving() || !model"
            ariaLabel="Enregistrer les paramètres fiscaux" i18n-ariaLabel="@@accounting.fiscal-parameters.enregistrer.les.parametres.fiscaux.cc33ee82" i18n="@@accounting.fiscal-parameters.enregistrer.f7c8bcd8">Enregistrer</app-button>
        </div>
      </app-accounting-filter-bar>
    </div>

    <div class="fp-validate-banner" role="status" i18n="@@accounting.fiscal-parameters.valeurs.indicatives.a.valider.selon.la.l.bb0471cd">
      <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
      <span>
        <strong>Valeurs indicatives</strong> — à valider selon la loi de finances de l'exercice.
        Le droit fiscal tunisien évolue chaque année : contrôlez les taux avant d'établir la liasse.
      </span>
    </div>

    <app-accounting-status-banner variant="error" [message]="error() ?? ''" [showRetry]="!!error()" retryLabel="Réessayer" i18n-retryLabel="@@accounting.fiscal-parameters.reessayer.c4f78b12" (retry)="load()" />

    @if (jsonError(); as jerr) {
      <div class="fp-json-error-banner" role="alert">
        <i class="pi pi-times-circle" aria-hidden="true"></i>
        <span>{{ jerr }}</span>
      </div>
    }

    @if (info(); as msg) {
      <div class="fp-info-banner" role="status"><i class="pi pi-check-circle" aria-hidden="true"></i><span>{{ msg }}</span></div>
    }

    @if (model; as m) {
      @if (!m.isUserModified) {
        <div class="fp-default-banner" role="status">
          <i class="pi pi-info-circle" aria-hidden="true"></i>
          <span i18n="@@accounting.fiscal-parameters.parametres.standards.en.vigueur.apres.enregistre.e086c573">Paramètres standards en vigueur. Après enregistrement, vos valeurs personnalisées seront conservées et ne seront plus mises à jour automatiquement.</span>
        </div>
      }

      <div class="fp-grid">
        <div class="card fp-card">
          <h3 class="fp-title" i18n="@@accounting.fiscal-parameters.impot.sur.les.societes.33c535a2">Impôt sur les sociétés</h3>
          <div class="fp-row"><label i18n="@@accounting.fiscal-parameters.taux.de.droit.commun.f3555cac">Taux de droit commun</label><input type="number" step="0.01" min="0" max="1" [(ngModel)]="m.isStandardRate" /><span class="fp-hint" i18n="@@accounting.fiscal-parameters.0.15.15.584ea9ee">0.15 = 15 %</span></div>
          <div class="fp-row"><label i18n="@@accounting.fiscal-parameters.taux.reduit.48dc3022">Taux réduit</label><input type="number" step="0.01" min="0" max="1" [(ngModel)]="m.isReducedRate" /></div>
          <div class="fp-row"><label i18n="@@accounting.fiscal-parameters.taux.sectoriel.majore.16c309a7">Taux sectoriel majoré</label><input type="number" step="0.01" min="0" max="1" [(ngModel)]="m.isSectorRate" /><span class="fp-hint" i18n="@@accounting.fiscal-parameters.banques.assurances.telecoms.a926498e">banques, assurances, télécoms…</span></div>
        </div>

        <div class="card fp-card">
          <h3 class="fp-title" i18n="@@accounting.fiscal-parameters.minimum.d.impot.8689385e">Minimum d'impôt</h3>
          <div class="fp-row"><label i18n="@@accounting.fiscal-parameters.taux.droit.commun.1738478e">Taux (droit commun)</label><input type="number" step="0.001" min="0" max="1" [(ngModel)]="m.minTaxRate" /><span class="fp-hint" i18n="@@accounting.fiscal-parameters.0.002.0.2.du.ca.local.ttc.26904314">0.002 = 0,2 % du CA local TTC</span></div>
          <div class="fp-row"><label i18n="@@accounting.fiscal-parameters.plancher.droit.commun.11d78598">Plancher (droit commun)</label><input type="number" step="0.001" min="0" [(ngModel)]="m.minTaxFloorTnd" /><span class="fp-hint" i18n="@@accounting.fiscal-parameters.tnd.51da21a7">TND</span></div>
          <div class="fp-row"><label i18n="@@accounting.fiscal-parameters.taux.reduit.48dc3022">Taux réduit</label><input type="number" step="0.001" min="0" max="1" [(ngModel)]="m.minTaxReducedRate" /><span class="fp-hint" i18n="@@accounting.fiscal-parameters.0.001.0.1.d4b62d5a">0.001 = 0,1 %</span></div>
          <div class="fp-row"><label i18n="@@accounting.fiscal-parameters.plancher.reduit.36c97c30">Plancher réduit</label><input type="number" step="0.001" min="0" [(ngModel)]="m.minTaxFloorReducedTnd" /><span class="fp-hint" i18n="@@accounting.fiscal-parameters.tnd.51da21a7">TND</span></div>
        </div>

        <div class="card fp-card">
          <h3 class="fp-title" i18n="@@accounting.fiscal-parameters.contribution.sociale.de.solidarite.49cf2910">Contribution sociale de solidarité</h3>
          <div class="fp-row fp-row--check">
            <label for="fp-css" i18n="@@accounting.fiscal-parameters.la.css.s.applique.e06158a8">La CSS s'applique</label>
            <input id="fp-css" type="checkbox" [(ngModel)]="m.cssApplies" />
          </div>
          <div class="fp-row"><label i18n="@@accounting.fiscal-parameters.taux.css.0070206d">Taux CSS</label><input type="number" step="0.001" min="0" max="1" [(ngModel)]="m.cssRate" /><span class="fp-hint" i18n="@@accounting.fiscal-parameters.0.01.1.de.l.assiette.imposable.0c6a4e47">0.01 = 1 % de l'assiette imposable</span></div>
          <div class="fp-row"><label i18n="@@accounting.fiscal-parameters.plancher.css.3c30a8cb">Plancher CSS</label><input type="number" step="0.001" min="0" [(ngModel)]="m.cssFloorTnd" /><span class="fp-hint" i18n="@@accounting.fiscal-parameters.tnd.51da21a7">TND</span></div>
        </div>

        <div class="card fp-card">
          <h3 class="fp-title" i18n="@@accounting.fiscal-parameters.acomptes.reports.et.arrondi.f15dd43a">Acomptes, reports et arrondi</h3>
          <div class="fp-row"><label i18n="@@accounting.fiscal-parameters.taux.d.un.acompte.17038508">Taux d'un acompte</label><input type="number" step="0.01" min="0" max="1" [(ngModel)]="m.acompteRate" /><span class="fp-hint" i18n="@@accounting.fiscal-parameters.0.30.30.de.l.is.n.1.c440fa3d">0.30 = 30 % de l'IS N-1</span></div>
          <div class="fp-row"><label i18n="@@accounting.fiscal-parameters.nombre.d.acomptes.1eaa3604">Nombre d'acomptes</label><input type="number" step="1" min="0" max="12" [(ngModel)]="m.acompteCount" /></div>
          <div class="fp-row"><label i18n="@@accounting.fiscal-parameters.report.des.deficits.annees.23f152ab">Report des déficits (années)</label><input type="number" step="1" min="1" max="20" [(ngModel)]="m.deficitCarryForwardYears" /><span class="fp-hint" i18n="@@accounting.fiscal-parameters.amortissements.differes.illimite.a4e6a31a">amortissements différés : illimité</span></div>
          <div class="fp-row fp-row--check">
            <label for="fp-round" i18n="@@accounting.fiscal-parameters.arrondir.l.assiette.au.dinar.08d31433">Arrondir l'assiette au dinar</label>
            <input id="fp-round" type="checkbox" [(ngModel)]="m.roundTaxableToDinar" />
          </div>
        </div>

        <div class="card fp-card fp-card--wide">
          <h3 class="fp-title" i18n="@@accounting.fiscal-parameters.bareme.irpp.bic.regime.reel.0fc0c501">Barème IRPP (BIC — régime réel)</h3>
          <p class="fp-hint" i18n="@@accounting.fiscal-parameters.tableau.json.lower.0.rate.0.lower.borne.f242ddb0"><ng-container>Tableau JSON : </ng-container> <code>[{{ '{' }}"lower":0,"rate":0{{ '}' }}, …]</code> — <em>lower</em> = borne inférieure annuelle (TND), <em>rate</em> = taux en %.</p>
          <textarea rows="4" class="fp-json" [class.fp-json--invalid]="!!irppValidationError()" [(ngModel)]="m.irppBracketsJson" aria-label="Barème IRPP en JSON" i18n-aria-label="@@accounting.fiscal-parameters.bareme.irpp.en.json.bef0cbaa"></textarea>
          @if (irppValidationError(); as verr) {
            <span class="fp-json-inline-error" role="alert">{{ verr }}</span>
          }
        </div>
      </div>
    }
  `,
  styles: `
    @use '../shared/accounting-layout';
    .fp-year-input { max-width:7rem; }
    .fp-validate-banner, .fp-info-banner, .fp-default-banner, .fp-json-error-banner { display:flex; align-items:flex-start; gap:var(--spacing-2); margin-bottom:var(--spacing-4); padding:var(--spacing-3) var(--spacing-4); border-radius:var(--radius-md); font-size:var(--font-size-sm); }
    .fp-validate-banner { background:var(--color-warning-50,#fffbeb); border:1px solid var(--color-warning-200,#fde68a); color:var(--color-warning-800,#92400e); }
    .fp-info-banner { background:var(--color-success-50,#f0fdf4); border:1px solid var(--color-success-200,#bbf7d0); color:var(--color-success-700,#15803d); }
    .fp-default-banner { background:var(--color-primary-50,#eff6ff); border:1px solid var(--color-primary-200,#bfdbfe); color:var(--color-primary-700,#1d4ed8); }
    .fp-json-error-banner { background:var(--color-danger-50,#fef2f2); border:1px solid var(--color-danger-200,#fecaca); color:var(--color-danger-700,#b91c1c); }
    .fp-grid { display:grid; grid-template-columns:1fr; gap:var(--spacing-4); }
    @media (min-width:900px){ .fp-grid { grid-template-columns:1fr 1fr; align-items:start; } }
    .fp-card { padding:var(--spacing-4) var(--spacing-5); border-radius:var(--radius-lg); box-shadow:var(--shadow-sm); }
    .fp-card--wide { grid-column:1/-1; }
    .fp-title { font-size:var(--font-size-base); font-weight:var(--font-weight-bold); margin:0 0 var(--spacing-3); }
    .fp-row { display:grid; grid-template-columns:1fr 9rem auto; align-items:center; gap:var(--spacing-2); margin-bottom:var(--spacing-2); }
    .fp-row--check { grid-template-columns:1fr auto; }
    .fp-row label { font-size:var(--font-size-sm); color:var(--color-text-secondary); }
    .fp-row input[type=number] { padding:0.4rem 0.55rem; border:1px solid var(--color-border-default,#cbd5e1); border-radius:var(--radius-md); text-align:right; font-variant-numeric:tabular-nums; }
    .fp-hint { font-size:var(--font-size-xs); color:var(--color-text-tertiary); }
    .fp-json { width:100%; font-family:monospace; font-size:var(--font-size-sm); padding:var(--spacing-2); border:1px solid var(--color-border-default,#cbd5e1); border-radius:var(--radius-md); }
    .fp-json--invalid { border-color:var(--color-danger-600,#dc2626); }
    .fp-year-error, .fp-json-inline-error { display:block; font-size:var(--font-size-xs); color:var(--color-danger-600,#dc2626); margin-top:0.2rem; }
    .fp-dirty-indicator { display:flex; align-items:center; gap:var(--spacing-2); margin:0 0 var(--spacing-2); font-size:var(--font-size-xs); color:var(--color-warning-700,#b45309); }
    .fp-dirty-indicator i { font-size:0.5rem; }
  `
})
export class FiscalParametersComponent implements OnInit {
  private readonly api = inject(AccountingService);

  fiscalYear = new Date().getFullYear() - 1;
  model: IncomeTaxYearParameterDto | null = null;
  private snapshot: IncomeTaxYearParameterDto | null = null;
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly info = signal<string | null>(null);
  /** Erreur de parsing JSON constatée sur la valeur reçue du serveur (BUG #015). */
  readonly jsonError = signal<string | null>(null);

  private readonly loadRequests$ = new Subject<number>();

  constructor() {
    this.loadRequests$
      .pipe(
        switchMap(year =>
          this.api.getIncomeTaxParameters(year).pipe(
            catchError(() => of<FiscalParametersApiResponse>({ success: false, error: $localize`:@@accounting.fiscal-parameters.ts.erreur.reseau.0683007f:Erreur réseau` }))
          )
        ),
        takeUntilDestroyed()
      )
      .subscribe(res => {
        this.loading.set(false);
        if (res.success && res.data) {
          this.model = { ...res.data };
          this.snapshot = { ...res.data };
          this.jsonError.set(this.validateIrppJsonSyntax(res.data.irppBracketsJson));
        } else {
          this.error.set(res.error ?? $localize`:@@ui.tern.erreur.ab546c:Erreur`);
        }
      });
  }

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    if (!this.confirmDiscardIfDirty()) return;
    const y = this.clampYear(this.fiscalYear);
    this.fiscalYear = y;
    this.loading.set(true);
    this.error.set(null);
    this.info.set(null);
    this.jsonError.set(null);
    this.loadRequests$.next(y);
  }

  /** Année saisie via l'input « Exercice » : demande confirmation si des modifications sont en cours. */
  onYearInputChange(value: number): void {
    if (this.isDirty() && !confirm(UNSAVED_CHANGES_MESSAGE)) {
      return;
    }
    this.fiscalYear = value;
  }

  isYearValid(): boolean {
    const y = Number(this.fiscalYear);
    return Number.isInteger(y) && y >= MIN_FISCAL_YEAR && y <= MAX_FISCAL_YEAR;
  }

  private clampYear(y: number): number {
    return Math.min(MAX_FISCAL_YEAR, Math.max(MIN_FISCAL_YEAR, Math.floor(Number(y)) || new Date().getFullYear()));
  }

  /** État « modifications non enregistrées » : compare le modèle courant au dernier instantané chargé/sauvegardé. */
  isDirty(): boolean {
    if (!this.snapshot || !this.model) return false;
    return JSON.stringify(this.model) !== JSON.stringify(this.snapshot);
  }

  private confirmDiscardIfDirty(): boolean {
    if (!this.isDirty()) return true;
    return confirm(UNSAVED_CHANGES_MESSAGE);
  }

  /** Garde fonctionnelle de désactivation de route (T23) : confirmation si des modifications sont en cours. */
  canDeactivate(): boolean {
    return this.confirmDiscardIfDirty();
  }

  /** Erreur de syntaxe JSON simple (BUG #015) — utilisée à l'affichage du bandeau après chargement. */
  private validateIrppJsonSyntax(raw: string): string | null {
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return $localize`:@@accounting.fiscal-parameters.ts.le.bareme.irpp.recu.du.serveur.est.inval.7ef58a26:Le barème IRPP reçu du serveur est invalide (tableau attendu).`;
      return null;
    } catch {
      return $localize`:@@accounting.fiscal-parameters.ts.le.bareme.irpp.recu.du.serveur.est.illis.141f9d42:Le barème IRPP reçu du serveur est illisible (JSON invalide) — vérifiez avant de sauvegarder.`;
    }
  }

  /**
   * Valide le barème IRPP saisi (T22, réplique côté client des règles serveur T13) : JSON valide,
   * tableau, `lower ≥ 0` strictement croissants et uniques, `rate ∈ [0;100]`.
   * Retourne `null` si valide, sinon un message d'erreur en français.
   */
  irppValidationError(): string | null {
    if (!this.model) return null;
    const raw = this.model.irppBracketsJson;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return $localize`:@@accounting.fiscal-parameters.ts.bareme.irpp.json.invalide.e3da66c9:Barème IRPP : JSON invalide.`;
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return $localize`:@@accounting.fiscal-parameters.ts.bareme.irpp.un.tableau.non.vide.de.tranc.178edcd9:Barème IRPP : un tableau non vide de tranches est requis.`;
    }
    let previousLower = -1;
    for (const entry of parsed) {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        return $localize`:@@accounting.fiscal-parameters.ts.bareme.irpp.chaque.tranche.doit.etre.un.38076dfc:Barème IRPP : chaque tranche doit être un objet { lower, rate }.`;
      }
      const lower = (entry as Record<string, unknown>)['lower'];
      const rate = (entry as Record<string, unknown>)['rate'];
      if (typeof lower !== 'number' || !Number.isFinite(lower) || lower < 0) {
        return $localize`:@@accounting.fiscal-parameters.ts.bareme.irpp.chaque.lower.doit.etre.un.no.fe088626:Barème IRPP : chaque « lower » doit être un nombre ≥ 0.`;
      }
      if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > 100) {
        return $localize`:@@accounting.fiscal-parameters.ts.bareme.irpp.chaque.rate.doit.etre.compri.2ed6568c:Barème IRPP : chaque « rate » doit être compris entre 0 et 100.`;
      }
      if (lower <= previousLower) {
        return $localize`:@@accounting.fiscal-parameters.ts.bareme.irpp.les.bornes.lower.doivent.etr.deae9533:Barème IRPP : les bornes « lower » doivent être strictement croissantes et uniques.`;
      }
      previousLower = lower;
    }
    return null;
  }

  /** Re-validation des bornes numériques en TypeScript (BUG #017) — les attributs HTML min/max n'empêchent pas le collage. */
  private numericBoundsError(): string | null {
    if (!this.model) return null;
    const m = this.model;
    const rateFields: Array<[number, string]> = [
      [m.isStandardRate, $localize`:@@accounting.fiscal-parameters.ts.taux.is.de.droit.commun.d37f185c:Taux IS de droit commun`],
      [m.isReducedRate, $localize`:@@accounting.fiscal-parameters.ts.taux.is.reduit.0bc7cf2d:Taux IS réduit`],
      [m.isSectorRate, $localize`:@@accounting.fiscal-parameters.ts.taux.is.sectoriel.majore.4ec8a76f:Taux IS sectoriel majoré`],
      [m.minTaxRate, $localize`:@@accounting.fiscal-parameters.ts.taux.du.minimum.d.impot.70af8e48:Taux du minimum d'impôt`],
      [m.minTaxReducedRate, $localize`:@@accounting.fiscal-parameters.ts.taux.reduit.du.minimum.d.impot.80afdd6f:Taux réduit du minimum d'impôt`],
      [m.cssRate, $localize`:@@accounting.fiscal-parameters.ts.taux.css.0070206d:Taux CSS`],
      [m.acompteRate, $localize`:@@accounting.fiscal-parameters.ts.taux.d.un.acompte.17038508:Taux d'un acompte`]
    ];
    for (const [value, label] of rateFields) {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0 || n > 1) {
        return $localize`:@@accounting.fiscal-parameters.ts.label.doit.etre.compris.entre.0.et.1.8ee660ad:${label}:label: : doit être compris entre 0 et 1.`;
      }
    }
    const floorFields: Array<[number, string]> = [
      [m.minTaxFloorTnd, $localize`:@@accounting.fiscal-parameters.ts.plancher.du.minimum.d.impot.b293528b:Plancher du minimum d'impôt`],
      [m.minTaxFloorReducedTnd, $localize`:@@accounting.fiscal-parameters.ts.plancher.reduit.du.minimum.d.impot.5bd56c4d:Plancher réduit du minimum d'impôt`],
      [m.cssFloorTnd, $localize`:@@accounting.fiscal-parameters.ts.plancher.css.3c30a8cb:Plancher CSS`]
    ];
    for (const [value, label] of floorFields) {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) {
        return $localize`:@@accounting.fiscal-parameters.ts.label.doit.etre.positif.ou.nul.e11ca7fe:${label}:label: : doit être positif ou nul.`;
      }
    }
    const acompteCount = Number(m.acompteCount);
    if (!Number.isInteger(acompteCount) || acompteCount < 0 || acompteCount > 12) {
      return $localize`:@@accounting.fiscal-parameters.ts.nombre.d.acomptes.doit.etre.compris.entr.3dde7df8:Nombre d'acomptes : doit être compris entre 0 et 12.`;
    }
    const deficitYears = Number(m.deficitCarryForwardYears);
    if (!Number.isInteger(deficitYears) || deficitYears < 1 || deficitYears > 20) {
      return $localize`:@@accounting.fiscal-parameters.ts.report.des.deficits.annees.doit.etre.com.2a7522b5:Report des déficits (années) : doit être compris entre 1 et 20.`;
    }
    return null;
  }

  save(): void {
    if (!this.model) return;
    if (!this.isYearValid()) {
      this.error.set($localize`:@@accounting.fiscal-parameters.ts.exercice.invalide.doit.etre.compris.entr.db4c8a16:Exercice invalide : doit être compris entre 2000 et 2100.`);
      return;
    }
    const irppError = this.irppValidationError();
    if (irppError) {
      this.error.set(irppError);
      return;
    }
    const boundsError = this.numericBoundsError();
    if (boundsError) {
      this.error.set(boundsError);
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    this.info.set(null);
    this.api.updateIncomeTaxParameters(this.fiscalYear, this.model).subscribe({
      next: res => {
        this.saving.set(false);
        if (res.success && res.data) {
          this.model = { ...res.data };
          this.snapshot = { ...res.data };
          this.jsonError.set(this.validateIrppJsonSyntax(res.data.irppBracketsJson));
          this.info.set($localize`:@@accounting.fiscal-parameters.ts.parametres.enregistres.ils.ne.seront.plu.a92b4346:Paramètres enregistrés — ils ne seront plus réinitialisés automatiquement.`);
        } else {
          this.error.set(res.error ?? $localize`:@@ui.tern.l.enregistrement.a.echoue.3f69ec:L'enregistrement a échoué.`);
        }
      },
      error: () => {
        this.saving.set(false);
        this.error.set($localize`:@@accounting.fiscal-parameters.ts.l.enregistrement.a.echoue.3f69ec30:L'enregistrement a échoué.`);
      }
    });
  }
}
