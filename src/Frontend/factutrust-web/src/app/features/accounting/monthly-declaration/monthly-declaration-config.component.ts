/// <reference types="@angular/localize" />
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TabsModule } from 'primeng/tabs';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { AuthService } from '@core/services/auth.service';
import { FirmAssignmentService } from '@core/services/firm-assignment.service';
import { FirmContextService } from '@core/services/firm-context.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { ToastService } from '@core/services/toast.service';
import { AccountingStatusBannerComponent } from '../shared/accounting-status-banner.component';
import { AccountingTableShellComponent } from '../shared/accounting-table-shell.component';
import {
  AccountingService,
  ChartOfAccountDto,
  DuplicateMonthlyDeclarationConfigRequest,
  MonthlyDeclarationConfigurationDto,
  MonthlyDeclarationDuplicationResultDto,
  MonthlyDeclarationFamily,
  MonthlyDeclarationRubricDto
} from '../services/accounting.service';
import { DmDuplicatePanelComponent, DmDuplicateSource } from './dm-duplicate-panel.component';
import { DmRubricFormComponent } from './dm-rubric-form.component';
import { DmRubricTableComponent } from './dm-rubric-table.component';
import {
  DM_FAMILY_TABS,
  DmRubricForm,
  accountPickerOptions,
  countActiveRubrics,
  describeMode,
  familyNeedsAttention,
  familyTab,
  isConfigurableLinesActive,
  isFamilyIncluded,
  isFamilyOutOfEngineScope,
  modeLabel,
  newRubricForm,
  nextDisplayOrder,
  rubricsOfFamily,
  toCreateRequest,
  toRubricForm,
  toUpdateRequest,
  validateRubricForm
} from './monthly-declaration-config.view-model';

/**
 * Configuration DM — paramétrage, par dossier, du calcul de chaque rubrique de la déclaration
 * mensuelle : onze familles, origine du montant brut et de la retenue, comptes et sens par
 * colonne, taux et période d'application.
 *
 * Deux verrous, tous deux tenus par le serveur à chaque écriture : l'interrupteur de la plateforme
 * et le contexte cabinet délégué. L'écran les reflète dans `editable` pour ne pas proposer une
 * écriture vouée au refus ; il n'accorde rien.
 */
@Component({
  selector: 'app-monthly-declaration-config',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TabsModule,
    PageHeaderComponent,
    ButtonComponent,
    AccountingStatusBannerComponent,
    AccountingTableShellComponent,
    DmRubricTableComponent,
    DmRubricFormComponent,
    DmDuplicatePanelComponent
  ],
  template: `
    <app-page-header
      title="Configuration DM" i18n-title="Configuration DM"
      subtitle="Calcul de chaque rubrique de la déclaration mensuelle : comptes, valeurs de paie, taux et période d’application" />

    <app-accounting-status-banner variant="error" [message]="error() ?? ''" />

    @if (configuration(); as config) {
      @if (!config.settings.configurableLinesEnabled) {
        <app-accounting-status-banner
          variant="info"
          title="Calcul paramétré non activé" i18n-title="Calcul paramétré non activé"
          message="La configuration reste consultable. Sa modification sera possible dès l’activation par l’administrateur de la plateforme ; aucun montant n’en dépend pour l’instant." />
      }

      <div class="card dm-state">
        <div class="dm-state__mode">
          <span class="dm-badge" [class.dm-badge--live]="config.settings.mode === 2">
            {{ modeText(config) }}
          </span>
          <p class="dm-state__detail">{{ modeDetail(config) }}</p>
        </div>
        <app-button
          variant="secondary"
          size="sm"
          icon="pi-refresh"
          type="button"
          [disabled]="loading()"
          (click)="load()" i18n="@@accounting.monthly-declaration.actualiser.9d3b2a7d"> Actualiser </app-button>
      </div>

      @if (!canWrite()) {
        <app-accounting-status-banner
          variant="info"
          message="Configuration en lecture seule : sa modification est réservée au cabinet comptable ouvrant le dossier." />
      }

      <div class="card dm-panel">
        <!-- Onze onglets : la barre défile plutôt que de se replier sur deux lignes. -->
        <p-tabs [value]="activeFamily()" [scrollable]="true" (valueChange)="selectFamily($event)">
          <p-tablist>
            @for (tab of tabs; track tab.family) {
              <p-tab [value]="tab.family">
                {{ tab.label }}
                @if (needsAttention(tab.family)) {
                  <span class="dm-dot" title="Famille incluse sans rubrique active" i18n-title="Famille incluse sans rubrique active" i18n="@@accounting.monthly-declaration.text.02b4ebd4">●</span>
                }
              </p-tab>
            }
          </p-tablist>
        </p-tabs>

        @if (currentTab(); as tab) {
          <div class="dm-family">
            <div class="dm-family__head">
              <div>
                <h2 class="dm-family__title">{{ tab.title }}</h2>
                <p class="dm-family__hint">{{ tab.hint }}</p>
              </div>
              <label class="dm-family__include">
                <input
                  type="checkbox"
                  [checked]="included()"
                  [disabled]="!editable() || savingFamily()"
                  (change)="toggleFamily($event)" />
                <span i18n="@@accounting.monthly-declaration.inclure.cette.famille.dans.la.declaration.mensue.4fe1eab3">Inclure cette famille dans la déclaration mensuelle</span>
              </label>
            </div>

            @if (outOfEngineScope()) {
              <app-accounting-status-banner
                variant="info"
                message="La T.V.A reste calculée depuis les factures et le chaînage de crédit : ces rubriques s’enregistrent mais ne déplacent aucun montant." />
            }

            @if (needsAttention(tab.family)) {
              <app-accounting-status-banner
                variant="warning"
                message="Famille incluse sans rubrique active : en mode paramétré, l’enregistrement de la déclaration sera refusé plutôt que de produire un zéro silencieux." />
            }

            <div class="dm-family__toolbar">
              <app-button
                variant="primary"
                size="sm"
                icon="pi pi-plus"
                type="button"
                [disabled]="!editable() || loading()"
                (click)="startCreate()" i18n="@@accounting.monthly-declaration.nouvelle.rubrique.f16710ee"> Nouvelle rubrique </app-button>
              <span class="dm-family__count">{{ activeCount() }} rubrique(s) active(s)</span>
            </div>

            @if (form(); as draft) {
              <div class="dm-editor">
                <app-dm-rubric-form
                  [form]="draft"
                  [accountOptions]="accountOptions()"
                  [saving]="savingRubric()"
                  [disabled]="!editable()"
                  (save)="saveRubric()"
                  (cancel)="form.set(null)" />
              </div>
            }

            <app-accounting-table-shell [loadingOverlay]="loading()" loadingMessage="Chargement de la configuration…">
              <app-dm-rubric-table
                [rubrics]="visibleRubrics()"
                [loading]="loading()"
                [readOnly]="!editable()"
                [knownAccounts]="knownAccounts()"
                (edit)="startEdit($event)"
                (toggle)="toggleRubric($event)"
                (remove)="confirmRemove($event)" />
            </app-accounting-table-shell>
          </div>
        }
      </div>

      @if (editable()) {
        <div class="card dm-panel">
          <app-dm-duplicate-panel
            [sources]="duplicateSources()"
            [busy]="duplicating()"
            [result]="duplicationResult()"
            (duplicate)="duplicate($event)" />
        </div>
      }
    }
  `,
  styles: `
    .dm-state, .dm-panel { padding: var(--spacing-4); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); margin-bottom: var(--spacing-4); }
    .dm-state { display: flex; gap: var(--spacing-3); align-items: flex-start; justify-content: space-between; flex-wrap: wrap; }
    .dm-state__mode { display: flex; flex-direction: column; gap: var(--spacing-1); }
    .dm-state__detail { margin: 0; font-size: var(--font-size-sm); color: var(--color-text-secondary); max-width: 70ch; }
    .dm-badge { align-self: flex-start; padding: 0.15rem 0.6rem; border-radius: var(--radius-pill, 999px); font-size: var(--font-size-xs); font-weight: var(--font-weight-semibold); background: var(--color-neutral-100, #f3f4f6); color: var(--color-text-secondary); }
    .dm-badge--live { background: var(--color-success-100, #dcfce7); color: var(--color-success-700, #15803d); }
    .dm-family { display: flex; flex-direction: column; gap: var(--spacing-3); margin-top: var(--spacing-3); }
    .dm-family__head { display: flex; gap: var(--spacing-3); align-items: flex-start; justify-content: space-between; flex-wrap: wrap; }
    .dm-family__title { margin: 0; font-size: var(--font-size-md); font-weight: var(--font-weight-semibold); }
    .dm-family__hint { margin: var(--spacing-1) 0 0; font-size: var(--font-size-sm); color: var(--color-text-secondary); max-width: 70ch; }
    .dm-family__include { display: flex; align-items: center; gap: var(--spacing-2); font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); }
    .dm-family__toolbar { display: flex; gap: var(--spacing-3); align-items: center; }
    .dm-family__count { font-size: var(--font-size-sm); color: var(--color-text-secondary); }
    .dm-editor { border: 1px solid var(--color-border-default); border-radius: var(--radius-lg); padding: var(--spacing-4); }
    .dm-dot { margin-left: var(--spacing-1); color: var(--color-warning-600, #d97706); }
  `
})
export class MonthlyDeclarationConfigComponent implements OnInit {
  private readonly api = inject(AccountingService);
  private readonly auth = inject(AuthService);
  private readonly firmAssignments = inject(FirmAssignmentService);
  private readonly firmContext = inject(FirmContextService);
  private readonly confirmation = inject(ConfirmationService);
  private readonly errors = inject(ErrorHandlerService);
  private readonly toast = inject(ToastService);

  readonly tabs = DM_FAMILY_TABS;

  readonly configuration = signal<MonthlyDeclarationConfigurationDto | null>(null);
  readonly chart = signal<ChartOfAccountDto[]>([]);
  readonly activeFamily = signal<MonthlyDeclarationFamily>(DM_FAMILY_TABS[0].family);
  readonly form = signal<DmRubricForm | null>(null);

  readonly loading = signal(false);
  readonly savingRubric = signal(false);
  readonly savingFamily = signal(false);
  readonly duplicating = signal(false);
  readonly error = signal<string | null>(null);

  readonly duplicateSources = signal<DmDuplicateSource[]>([]);
  readonly duplicationResult = signal<MonthlyDeclarationDuplicationResultDto | null>(null);

  /**
   * Miroir du verrou serveur `IsAccountingFirmDelegatedContext` : le cabinet, dossier ouvert.
   * Une société ne modifie pas plus la configuration fiscale de son dossier qu'elle n'enregistre
   * sa propre déclaration.
   */
  readonly canWrite = computed(() => this.auth.isAccountingFirm() && this.auth.isDelegatedMode());

  /** Reflet de l'interrupteur serveur, global à la plateforme — `false` tant que non chargé. */
  readonly linesEnabled = computed(() =>
    isConfigurableLinesActive(this.configuration()?.settings)
  );

  /**
   * Écritures proposées : cabinet délégué ET interrupteur allumé. `canWrite` seul reste l'origine
   * du bandeau « lecture seule » destiné à la société, qui ne dépend pas de l'interrupteur.
   */
  readonly editable = computed(() => this.canWrite() && this.linesEnabled());

  readonly currentTab = computed(() => familyTab(this.activeFamily()));

  readonly visibleRubrics = computed(() =>
    rubricsOfFamily(this.configuration()?.rubrics ?? [], this.activeFamily())
  );

  readonly included = computed(() =>
    isFamilyIncluded(this.configuration()?.families ?? [], this.activeFamily())
  );

  readonly activeCount = computed(() =>
    countActiveRubrics(this.configuration()?.rubrics ?? [], this.activeFamily())
  );

  readonly outOfEngineScope = computed(() => isFamilyOutOfEngineScope(this.activeFamily()));

  readonly accountOptions = computed(() => accountPickerOptions(this.chart()));

  readonly knownAccounts = computed<ReadonlySet<string>>(
    () => new Set(this.chart().map(a => a.accountNumber))
  );

  ngOnInit(): void {
    this.load();
    this.loadChart();
    this.loadDuplicateSources();
  }

  modeText(config: MonthlyDeclarationConfigurationDto): string {
    return modeLabel(config.settings.mode);
  }

  modeDetail(config: MonthlyDeclarationConfigurationDto): string {
    return describeMode(config.settings);
  }

  needsAttention(family: MonthlyDeclarationFamily): boolean {
    const config = this.configuration();
    return config ? familyNeedsAttention(config.families, config.rubrics, family) : false;
  }

  selectFamily(value: unknown): void {
    this.form.set(null);
    this.activeFamily.set(Number(value) as MonthlyDeclarationFamily);
  }

  /**
   * @param clearError `false` lorsqu'un appel vient de poser un message : une relecture destinée à
   * réaligner l'écran sur le serveur ne doit pas effacer le refus qui l'a motivée.
   */
  load(clearError = true): void {
    this.loading.set(true);
    if (clearError) {
      this.error.set(null);
    }
    this.api.getMonthlyDeclarationConfiguration(true).subscribe({
      next: res => {
        this.loading.set(false);
        if (res.success && res.data) {
          this.configuration.set(res.data);
        } else {
          this.error.set(res.error ?? $localize`:@@ui.tern.erreur.de.chargement.de.la.configuration.d.15ff2d:Erreur de chargement de la configuration DM.`);
        }
      },
      error: err => {
        this.loading.set(false);
        this.error.set(this.errors.extractErrorMessage(err, 'Erreur réseau'));
      }
    });
  }

  /**
   * Le plan comptable alimente les sélecteurs et sert à signaler les comptes disparus. Son échec
   * n'est pas remonté en bandeau : la configuration reste lisible et modifiable sans lui.
   */
  private loadChart(): void {
    this.api.getChartOfAccounts().subscribe({
      next: res => {
        if (res.success && res.data) {
          this.chart.set(res.data);
        }
      },
      error: () => this.chart.set([])
    });
  }

  /**
   * Dossiers proposés à la duplication : le portefeuille du cabinet, moins le dossier ouvert.
   * Échec silencieux — la duplication est une commodité, pas le sujet de l'écran.
   */
  private loadDuplicateSources(): void {
    if (!this.canWrite()) {
      return;
    }
    const currentTenantId = this.firmContext.activeClient()?.tenantId ?? null;
    this.firmAssignments.getActiveClients().subscribe({
      next: res => {
        if (!res.success || !res.data) {
          return;
        }
        this.duplicateSources.set(
          res.data
            .filter(d => d.companyTenantId !== currentTenantId)
            .map(d => ({ companyTenantId: d.companyTenantId, companyName: d.companyName }))
        );
      },
      error: () => this.duplicateSources.set([])
    });
  }

  startCreate(): void {
    if (!this.editable()) {
      return;
    }
    const family = this.activeFamily();
    const order = nextDisplayOrder(this.configuration()?.rubrics ?? [], family);
    this.form.set(newRubricForm(family, order));
  }

  startEdit(rubric: MonthlyDeclarationRubricDto): void {
    if (!this.editable()) {
      return;
    }
    this.form.set(toRubricForm(rubric));
  }

  saveRubric(): void {
    const draft = this.form();
    if (!this.editable() || !draft || this.savingRubric()) {
      return;
    }
    const invalid = validateRubricForm(draft);
    if (invalid) {
      this.error.set(invalid);
      return;
    }

    this.savingRubric.set(true);
    this.error.set(null);
    const done = (ok: boolean, message?: string) => {
      this.savingRubric.set(false);
      if (!ok) {
        this.error.set(message ?? $localize`:@@ui.tern.erreur.lors.de.l.enregistrement.de.la.rubr.d150ee:Erreur lors de l’enregistrement de la rubrique.`);
        return;
      }
      this.toast.add({
        severity: 'success',
        summary: $localize`:@@monthly-declaration-config.component.summary.Rubrique_enregis:Rubrique enregistrée`,
        detail: draft.code.toUpperCase(),
        life: 4000
      });
      this.form.set(null);
      this.load();
    };

    // Les deux appels ne rendent pas le même type de charge utile (identifiant créé contre
    // booléen) : on branche l'abonnement plutôt que d'unir deux observables inconciliables.
    const handlers = {
      next: (res: { success: boolean; error?: string }) => done(res.success, res.error),
      error: (err: unknown) => done(false, this.errors.extractErrorMessage(err, 'Erreur réseau'))
    };

    if (draft.id) {
      this.api.updateMonthlyDeclarationRubric(draft.id, toUpdateRequest(draft)).subscribe(handlers);
    } else {
      this.api.createMonthlyDeclarationRubric(toCreateRequest(draft)).subscribe(handlers);
    }
  }

  toggleFamily(event: Event): void {
    if (!this.editable()) {
      return;
    }
    const isIncluded = (event.target as HTMLInputElement).checked;
    this.savingFamily.set(true);
    this.error.set(null);
    this.api
      .setMonthlyDeclarationFamily({ family: this.activeFamily(), isIncluded })
      .subscribe({
        next: res => {
          this.savingFamily.set(false);
          if (res.success) {
            this.load();
          } else {
            // La case reflète l'état du serveur : la recharger est la seule façon de ne pas
            // laisser l'écran afficher une inclusion qui n'a pas été enregistrée.
            this.error.set(res.error ?? $localize`:@@ui.tern.erreur.lors.de.la.mise.a.jour.de.la.famill.f72ba5:Erreur lors de la mise à jour de la famille.`);
            this.load(false);
          }
        },
        error: err => {
          this.savingFamily.set(false);
          this.error.set(this.errors.extractErrorMessage(err, 'Erreur réseau'));
          this.load(false);
        }
      });
  }

  toggleRubric(rubric: MonthlyDeclarationRubricDto): void {
    if (!this.editable()) {
      return;
    }
    this.api.toggleMonthlyDeclarationRubric(rubric.id).subscribe({
      next: res => {
        if (res.success) {
          this.load();
        } else {
          this.error.set(res.error ?? $localize`:@@ui.tern.erreur.lors.du.changement.d.etat.de.la.rub.3fdf4d:Erreur lors du changement d’état de la rubrique.`);
        }
      },
      error: err => this.error.set(this.errors.extractErrorMessage(err, 'Erreur réseau'))
    });
  }

  confirmRemove(rubric: MonthlyDeclarationRubricDto): void {
    if (!this.editable()) {
      return;
    }
    this.confirmation.confirm({
      header: 'Supprimer la rubrique',
      message: `Supprimer définitivement « ${rubric.code} — ${rubric.label} » ? Les déclarations déjà déposées gardent leurs lignes ; les périodes suivantes ne la calculeront plus.`,
      acceptLabel: $localize`:@@monthly-declaration-config.component.acceptLabel.Supprimer:Supprimer`,
      rejectLabel: $localize`:@@monthly-declaration-config.component.rejectLabel.Annuler:Annuler`,
      size: 'md',
      accept: () => this.remove(rubric)
    });
  }

  private remove(rubric: MonthlyDeclarationRubricDto): void {
    this.api.deleteMonthlyDeclarationRubric(rubric.id).subscribe({
      next: res => {
        if (res.success) {
          this.toast.add({
            severity: 'success',
            summary: $localize`:@@monthly-declaration-config.component.summary.Rubrique sup:Rubrique supprimée`,
            detail: rubric.code,
            life: 4000
          });
          this.form.set(null);
          this.load();
        } else {
          this.error.set(res.error ?? $localize`:@@ui.tern.erreur.lors.de.la.suppression.de.la.rubriq.389719:Erreur lors de la suppression de la rubrique.`);
        }
      },
      error: err => this.error.set(this.errors.extractErrorMessage(err, 'Erreur réseau'))
    });
  }

  duplicate(request: DuplicateMonthlyDeclarationConfigRequest): void {
    if (!this.editable() || this.duplicating()) {
      return;
    }
    this.duplicating.set(true);
    this.error.set(null);
    this.duplicationResult.set(null);
    this.api.duplicateMonthlyDeclarationConfig(request).subscribe({
      next: res => {
        this.duplicating.set(false);
        if (res.success && res.data) {
          this.duplicationResult.set(res.data);
          this.toast.add({
            severity: 'success',
            summary: $localize`:@@monthly-declaration-config.component.summary.Configuration_du:Configuration dupliquée`,
            detail: `${res.data.inserted} insérée(s), ${res.data.replaced} remplacée(s)`,
            life: 5000
          });
          this.load();
        } else {
          this.error.set(res.error ?? $localize`:@@ui.tern.erreur.lors.de.la.duplication.de.la.config.837517:Erreur lors de la duplication de la configuration.`);
        }
      },
      error: err => {
        this.duplicating.set(false);
        this.error.set(this.errors.extractErrorMessage(err, 'Erreur réseau'));
      }
    });
  }
}
