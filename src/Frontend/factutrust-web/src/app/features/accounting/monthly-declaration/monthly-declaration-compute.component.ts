/// <reference types="@angular/localize" />
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { AuthService } from '@core/services/auth.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { ToastService } from '@core/services/toast.service';
import { AccountingStatusBannerComponent } from '../shared/accounting-status-banner.component';
import {
  AccountingService,
  MonthlyDeclarationDiagnosticDto,
  MonthlyDeclarationMode,
  MonthlyDeclarationSettingsDto,
  VatDeclarationDto
} from '../services/accounting.service';
import { DmComputeLinesComponent } from './dm-compute-lines.component';
import { DmModePanelComponent } from './dm-mode-panel.component';
import { isConfigurableLinesActive, modeLabel } from './monthly-declaration-config.view-model';
import { formatPeriodLabel } from '../vat-declaration/vat-declaration.view-model';
import {
  DmModeForm,
  buildFamilyViews,
  countBySeverity,
  defaultComputePeriod,
  describeComputeOutcome,
  describeDiagnostic,
  diagnosticSeverity,
  distinctDiagnostics,
  isCleanParityRun,
  isComputablePeriod,
  newModeForm,
  toModeRequest,
  validateModeForm
} from './monthly-declaration-compute.view-model';

/**
 * Calcul DM — évalue la configuration du dossier sur une période et rend le détail obtenu, sans
 * rien déposer. C'est l'écran de recette de la déclaration paramétrable : on y compare, on y lit
 * les signalements, et c'est de là qu'on fait avancer la rampe de bascule.
 *
 * Le calcul **écrit** quand même quelque chose : en contrôle de parité, il consigne le résultat de
 * la comparaison sur les réglages du dossier. C'est cette série, et elle seule, qui autorise
 * ensuite le passage en calcul paramétré — d'où le rechargement des réglages après chaque calcul.
 */
@Component({
  selector: 'app-monthly-declaration-compute',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    PageHeaderComponent,
    ButtonComponent,
    AccountingStatusBannerComponent,
    DmComputeLinesComponent,
    DmModePanelComponent
  ],
  template: `
    <app-page-header
      title="Calcul DM" i18n-title="@@accounting.monthly-declaration.calcul.dm.7af61bf4"
      subtitle="Évalue la configuration du dossier sur une période et rend le détail obtenu. Rien n’est déposé." i18n-subtitle="@@accounting.monthly-declaration.evalue.la.configuration.du.dossier.sur.u.9ae8e552" />

    <app-accounting-status-banner variant="error" [message]="error() ?? ''" />

    @if (settings(); as s) {
      @if (!s.configurableLinesEnabled) {
        <app-accounting-status-banner
          variant="info"
          title="Calcul paramétré non activé" i18n-title="@@accounting.monthly-declaration.calcul.parametre.non.active.504c61d8"
          message="Le calcul et le changement de régime sont indisponibles pour tous les dossiers tant que l’administrateur de la plateforme n’a pas activé cette fonctionnalité." i18n-message="@@accounting.monthly-declaration.le.calcul.et.le.changement.de.regime.son.04a1c379" />
      }
    }

    @if (!canWrite()) {
      <app-accounting-status-banner
        variant="info"
        message="Calcul réservé au cabinet comptable ouvrant le dossier : une société ne recalcule pas sa propre déclaration." i18n-message="@@accounting.monthly-declaration.calcul.reserve.au.cabinet.comptable.ouvr.febfac41" />
    }

    <div class="card dm-period">
      <div class="dm-field">
        <label class="dm-lbl" for="dm-year" i18n="@@accounting.monthly-declaration.exercice.e171e2b0">Exercice</label>
        <input
          id="dm-year"
          type="number"
          class="dm-inp dm-narrow"
          min="2000"
          max="2100"
          [(ngModel)]="year"
          [disabled]="!canCompute()" />
      </div>
      <div class="dm-field">
        <label class="dm-lbl" for="dm-month" i18n="@@accounting.monthly-declaration.mois.0d304bea">Mois</label>
        <input
          id="dm-month"
          type="number"
          class="dm-inp dm-narrow"
          min="1"
          max="12"
          [(ngModel)]="month"
          [disabled]="!canCompute()" />
      </div>
      <app-button
        variant="primary"
        icon="pi-calculator"
        type="button"
        [disabled]="!canCompute() || !periodValid() || computing()"
        (click)="compute()">
        {{ computing() ? loc_ui_tern_calcul_c289e9 : loc_ui_tern_calculer_297058 }}
      </app-button>
    </div>

    @if (result(); as r) {
      <div class="card dm-outcome" [class.dm-outcome--clean]="cleanRun()">
        <div class="dm-outcome__head">
          <h2 class="dm-outcome__title">{{ periodLabel() }}</h2>
          <span class="dm-badge">{{ resultModeLabel(r) }}</span>
        </div>
        <p class="dm-outcome__text">{{ outcome(r) }}</p>
        @if (cleanRun()) {
          <p class="dm-outcome__text" i18n="@@accounting.monthly-declaration.ce.controle.allonge.la.serie.qui.ouvre.la.bascul.b289ec8b"> Ce contrôle allonge la série qui ouvre la bascule vers le calcul paramétré. </p>
        }
      </div>

      @if (diagnostics(r); as list) {
        @if (list.length) {
          <section class="card dm-diags">
            <h3 class="dm-diags__title" i18n="@@accounting.monthly-declaration.signalements.du.calcul.erreur.s.avertiss.dacdbbf8">
              <ng-container> Signalements du calcul </ng-container>
              <span class="dm-diags__counts">
                {{ errorCount(r) }} erreur(s), {{ warningCount(r) }} avertissement(s)
              </span>
            </h3>
            <ul class="dm-diags__list">
              @for (d of list; track $index) {
                <li [class.dm-diags__item--error]="severity(d) === 'error'">{{ describe(d) }}</li>
              }
            </ul>
          </section>
        }
      }

      <app-dm-compute-lines [views]="familyViews()" />
    }

    <app-dm-mode-panel
      [settings]="settings()"
      [form]="modeForm()"
      [disabled]="!canCompute()"
      [saving]="savingMode()"
      (apply)="applyMode()" />
  `,
  styles: `
    .dm-period { display: flex; flex-wrap: wrap; gap: var(--spacing-3); align-items: flex-end; }
    .dm-field { display: flex; flex-direction: column; gap: var(--spacing-1); }
    .dm-lbl { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--color-text-primary); }
    .dm-inp { padding: var(--spacing-2) var(--spacing-3); border: 1px solid var(--color-border-default); border-radius: var(--radius-md); background: var(--color-background-elevated); color: var(--color-text-primary); font-size: var(--font-size-sm); }
    .dm-narrow { width: 7rem; }
    .dm-outcome { display: flex; flex-direction: column; gap: var(--spacing-2); border-inline-start: 3px solid var(--color-border-default); }
    .dm-outcome--clean { border-inline-start-color: var(--color-success-500, #22c55e); }
    .dm-outcome__head { display: flex; flex-wrap: wrap; gap: var(--spacing-3); align-items: center; justify-content: space-between; }
    .dm-outcome__title { margin: 0; font-size: var(--font-size-md); font-weight: var(--font-weight-semibold); }
    .dm-outcome__text { margin: 0; font-size: var(--font-size-sm); color: var(--color-text-secondary); }
    .dm-badge { padding: 0.15rem 0.6rem; border-radius: var(--radius-pill, 999px); background: var(--color-background-subtle, #f1f5f9); font-size: var(--font-size-xs); font-weight: var(--font-weight-semibold); }
    .dm-diags { margin-bottom: var(--spacing-4); }
    .dm-diags__title { margin: 0 0 var(--spacing-2); font-size: var(--font-size-md); font-weight: var(--font-weight-semibold); display: flex; flex-wrap: wrap; gap: var(--spacing-2); align-items: baseline; }
    .dm-diags__counts { font-size: var(--font-size-xs); font-weight: var(--font-weight-normal); color: var(--color-text-tertiary); }
    .dm-diags__list { margin: 0; padding-inline-start: var(--spacing-5); font-size: var(--font-size-sm); color: var(--color-warning-700, #a16207); }
    .dm-diags__item--error { color: var(--color-error-700, #b91c1c); }
  `
})
export class MonthlyDeclarationComputeComponent implements OnInit {
  readonly loc_ui_tern_calcul_c289e9 = $localize`:@@ui.tern.calcul.c289e9:Calcul…`;
  readonly loc_ui_tern_calculer_297058 = $localize`:@@ui.tern.calculer.297058:Calculer`;
  private readonly api = inject(AccountingService);
  private readonly auth = inject(AuthService);
  private readonly errors = inject(ErrorHandlerService);
  private readonly toast = inject(ToastService);

  readonly settings = signal<MonthlyDeclarationSettingsDto | null>(null);
  readonly result = signal<VatDeclarationDto | null>(null);
  readonly modeForm = signal<DmModeForm | null>(null);

  readonly computing = signal(false);
  readonly savingMode = signal(false);
  readonly error = signal<string | null>(null);

  year = 0;
  month = 0;

  /**
   * Miroir du verrou serveur `IsAccountingFirmDelegatedContext`. Le calcul est une écriture : il
   * consigne le contrôle de parité sur les réglages du dossier.
   */
  readonly canWrite = computed(() => this.auth.isAccountingFirm() && this.auth.isDelegatedMode());

  /** Reflet de l'interrupteur serveur, global à la plateforme — `false` tant que non chargé. */
  readonly linesEnabled = computed(() => isConfigurableLinesActive(this.settings()));

  /**
   * Calcul et changement de régime : cabinet délégué ET interrupteur allumé. Sans le second, le
   * serveur refuserait à coup sûr ; mieux vaut ne pas proposer l'action que d'afficher son échec.
   */
  readonly canCompute = computed(() => this.canWrite() && this.linesEnabled());

  readonly familyViews = computed(() => {
    const r = this.result();
    return r ? buildFamilyViews(r) : [];
  });

  readonly cleanRun = computed(() => {
    const r = this.result();
    return !!r && isCleanParityRun(r);
  });

  ngOnInit(): void {
    const period = defaultComputePeriod(new Date());
    this.year = period.year;
    this.month = period.month;
    this.loadSettings();
  }

  periodValid(): boolean {
    return isComputablePeriod({ year: Number(this.year), month: Number(this.month) });
  }

  periodLabel(): string {
    return formatPeriodLabel(Number(this.year), Number(this.month));
  }

  outcome(d: VatDeclarationDto): string {
    return describeComputeOutcome(d);
  }

  resultModeLabel(d: VatDeclarationDto): string {
    return modeLabel(d.monthlyDeclarationMode ?? MonthlyDeclarationMode.Legacy);
  }

  diagnostics(d: VatDeclarationDto): MonthlyDeclarationDiagnosticDto[] {
    return distinctDiagnostics(d.monthlyDeclarationDiagnostics);
  }

  errorCount(d: VatDeclarationDto): number {
    return countBySeverity(d.monthlyDeclarationDiagnostics, 'error');
  }

  warningCount(d: VatDeclarationDto): number {
    return countBySeverity(d.monthlyDeclarationDiagnostics, 'warning');
  }

  describe(d: MonthlyDeclarationDiagnosticDto): string {
    return describeDiagnostic(d);
  }

  severity(d: MonthlyDeclarationDiagnosticDto): string {
    return diagnosticSeverity(d.kind);
  }

  /**
   * @param clearError `false` lorsqu'un appel vient de poser un message : une relecture destinée à
   * réaligner l'écran sur le serveur ne doit pas effacer le refus qui l'a motivée.
   */
  loadSettings(clearError = true): void {
    if (clearError) {
      this.error.set(null);
    }
    // `includeInactive: false` — cet écran n'affiche pas les rubriques, seulement les réglages.
    this.api.getMonthlyDeclarationConfiguration(false).subscribe({
      next: res => {
        if (res.success && res.data) {
          this.settings.set(res.data.settings);
          this.modeForm.set(newModeForm(res.data.settings, new Date()));
        } else if (clearError) {
          this.error.set(res.error ?? $localize`:@@ui.tern.erreur.de.chargement.des.reglages.de.la.de.3d201b:Erreur de chargement des réglages de la déclaration.`);
        }
      },
      error: err => {
        if (clearError) {
          this.error.set(this.errors.extractErrorMessage(err, $localize`:@@accounting.monthly-declaration-compute.ts.erreur.reseau.0683007f:Erreur réseau`));
        }
      }
    });
  }

  compute(): void {
    if (!this.canCompute() || this.computing() || !this.periodValid()) {
      return;
    }
    this.computing.set(true);
    this.error.set(null);
    this.api.computeMonthlyDeclaration(Number(this.year), Number(this.month)).subscribe({
      next: res => {
        this.computing.set(false);
        if (res.success && res.data) {
          this.result.set(res.data);
          // Le contrôle de parité vient peut-être d'allonger la série : relire les réglages plutôt
          // que d'afficher une rampe périmée à côté de son propre résultat.
          this.loadSettings(false);
        } else {
          this.result.set(null);
          this.error.set(res.error ?? $localize`:@@ui.tern.le.calcul.a.echoue.353312:Le calcul a échoué.`);
        }
      },
      error: err => {
        this.computing.set(false);
        this.result.set(null);
        this.error.set(this.errors.extractErrorMessage(err, $localize`:@@accounting.monthly-declaration-compute.ts.erreur.reseau.0683007f:Erreur réseau`));
      }
    });
  }

  applyMode(): void {
    const form = this.modeForm();
    const settings = this.settings();
    if (!this.canCompute() || !form || !settings || this.savingMode()) {
      return;
    }
    const invalid = validateModeForm(form, settings);
    if (invalid) {
      this.error.set(invalid);
      return;
    }

    this.savingMode.set(true);
    this.error.set(null);
    this.api.setMonthlyDeclarationMode(toModeRequest(form)).subscribe({
      next: res => {
        this.savingMode.set(false);
        if (res.success) {
          this.toast.add({
            severity: 'success',
            summary: $localize`:@@monthly-declaration-compute.component.summary.Régime de ca:Régime de calcul modifié`,
            detail: modeLabel(form.mode),
            life: 4000
          });
          this.loadSettings();
        } else {
          this.error.set(res.error ?? $localize`:@@ui.tern.le.changement.de.regime.a.ete.refuse.e7a8db:Le changement de régime a été refusé.`);
          this.loadSettings(false);
        }
      },
      error: err => {
        this.savingMode.set(false);
        this.error.set(this.errors.extractErrorMessage(err, $localize`:@@accounting.monthly-declaration-compute.ts.erreur.reseau.0683007f:Erreur réseau`));
        this.loadSettings(false);
      }
    });
  }
}
