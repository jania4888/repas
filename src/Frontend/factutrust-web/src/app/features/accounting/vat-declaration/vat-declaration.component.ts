/// <reference types="@angular/localize" />
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { AccountingService, VatDeclarationDto } from '../services/accounting.service';
import { AuthService } from '@core/services/auth.service';
import {
  canManageVatDeclaration,
  canShowVatDeclarationDocLinks,
  isCompanyVatDeclarationReadOnly
} from '@core/config/company-accounting-nav.config';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { wrapLegacyAnalyzePayload } from '@features/ai-assistant/utils/ai-screen-payload.factory';
import { AccountingStatusBannerComponent } from '../shared/accounting-status-banner.component';
import { AccountingCorrectionBannerComponent } from '../shared/accounting-correction-banner.component';
import { downloadBlob } from '../shared/accounting-download.util';
import { VatDeclarationToolbarComponent } from './vat-declaration-toolbar.component';
import { VatDeclarationGeneralInfoComponent } from './vat-declaration-general-info.component';
import { VatDeclarationStatusPanelComponent } from './vat-declaration-status-panel.component';
import { VatDeclarationTaxesTableComponent } from './vat-declaration-taxes-table.component';
import { VatDeclarationVatDetailTableComponent } from './vat-declaration-vat-detail-table.component';
import { VatDeclarationDocLinksComponent } from './vat-declaration-doc-links.component';
import { VatDeclarationSummaryPanelComponent } from './vat-declaration-summary-panel.component';
import { VatDeclarationDivergenceBannerComponent } from './vat-declaration-divergence-banner.component';
import {
  VatDeclarationExtras,
  VatExtrasKey,
  buildChartSegments,
  buildDivergenceRows,
  buildDocLinks,
  buildTaxRows,
  clampExtrasValue,
  computeTotalCollected,
  computeTotalDeductible,
  computeTotalToPay,
  payrollHint,
  shiftPeriod
} from './vat-declaration.view-model';

/** Message aligné sur VatDeclarationAccess.NotSubmittedMessage (backend). */
const COMPANY_NOT_SUBMITTED_MARKER = 'Aucune déclaration soumise';

const COMPANY_EMPTY_STATE_MESSAGE =
  'Aucune déclaration mensuelle soumise par le cabinet pour cette période. Vous pourrez consulter et exporter le PDF dès qu’elle aura été soumise.';

@Component({
  selector: 'app-vat-declaration',
  standalone: true,
  imports: [
    CommonModule,
    PageHeaderComponent,
    AccountingStatusBannerComponent,
    AccountingCorrectionBannerComponent,
    VatDeclarationToolbarComponent,
    VatDeclarationGeneralInfoComponent,
    VatDeclarationStatusPanelComponent,
    VatDeclarationTaxesTableComponent,
    VatDeclarationVatDetailTableComponent,
    VatDeclarationDocLinksComponent,
    VatDeclarationSummaryPanelComponent,
    VatDeclarationDivergenceBannerComponent
  ],
  template: `
    <app-page-header
      title="Déclaration mensuelle des impôts et taxes" i18n-title="@@accounting.vat-declaration.declaration.mensuelle.des.impots.et.taxes.2ab684d8"
      [subtitle]="isCompanyReadOnly
        ? loc_ui_tern_consultation_des_declarations_soumises_par_879645
        : loc_ui_tern_preremplissage_a_partir_des_ventes_et_acha_bb3884" />

    <app-accounting-correction-banner />

    <app-vat-declaration-toolbar
      [year]="year"
      [month]="month"
      [loading]="loading()"
      [hasData]="!!data()"
      [showCompanySettings]="!isCompanyReadOnly && !auth.isFirmDelegatedReadonly()"
      [showAiAnalyze]="canManage"
      [showPreview]="canManage"
      [showExportPdf]="true"
      [showOfficialForm]="!!data()?.officialFormEnabled"
      [payloadBuilder]="buildVatAnalyzePayload"
      (yearChange)="onYearChange($event)"
      (monthChange)="onMonthChange($event)"
      (refresh)="load()"
      (prevPeriod)="navigatePeriod(-1)"
      (nextPeriod)="navigatePeriod(1)"
      (exportPdf)="exportPdf()"
      (exportOfficialForm)="exportOfficialForm()"
      (previewPdf)="previewPdf()" />

    <app-accounting-status-banner
      variant="error"
      [message]="error() ?? ''"
      [showRetry]="!!error()"
      retryLabel="Réessayer"
      (retry)="load()" />

    @if (unavailableReason(); as reason) {
      <div class="vat-empty-state card" role="status">
        <i class="pi pi-info-circle" aria-hidden="true"></i>
        <p>{{ reason }}</p>
      </div>
    }

    @if (data(); as d) {
      <div class="vat-page-layout">
        <div class="vat-main-column">
          <app-vat-declaration-general-info
            [declaration]="d"
            [year]="year"
            [month]="month" />

          <app-vat-declaration-status-panel [declaration]="d" />

          <app-vat-declaration-divergence-banner
            [rows]="divergenceRows()"
            [payrollHint]="payrollHint()"
            [actionHint]="divergenceActionHint()"
            [canResync]="canManage && !isCompanyReadOnly"
            (resync)="resyncFromModules()" />

          <app-vat-declaration-taxes-table
            [rows]="taxRows()"
            [extras]="extras()"
            [disabled]="loading() || isCompanyReadOnly"
            (extraChange)="onExtraChange($event.key, $event.value)" />

          <app-vat-declaration-vat-detail-table [declaration]="d" />

          @if (showDocLinks) {
            <app-vat-declaration-doc-links [links]="docLinks()" />
          }
        </div>

        <app-vat-declaration-summary-panel
          class="vat-side-column"
          [declaration]="d"
          [totalToPay]="totalToPay()"
          [currency]="d.currency"
          [loading]="loading()"
          [v2Enabled]="d.monthlyDeclarationV2Enabled"
          [chartSegments]="chartSegments()"
          [canManage]="canManage"
          (saveDraft)="save(false)"
          (submit)="save(true)"
          (rectificative)="save(true, true)"
          (exportPdf)="exportPdf()" />
      </div>
    }
  `,
  styles: `
    .vat-page-layout {
      display: grid;
      grid-template-columns: 1fr;
      gap: var(--spacing-4);
      align-items: start;
    }
    @media (min-width: 64rem) {
      .vat-page-layout {
        grid-template-columns: minmax(0, 1.65fr) minmax(18rem, 1fr);
      }
    }
    .vat-main-column { min-width: 0; }
    .vat-side-column { min-width: 0; }
    .vat-empty-state {
      display: flex;
      align-items: flex-start;
      gap: var(--spacing-3);
      padding: var(--spacing-5);
      margin-bottom: var(--spacing-4);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-sm);
      color: var(--color-text-secondary);
      font-size: var(--font-size-sm);
    }
    .vat-empty-state i {
      margin-top: 0.15rem;
      color: var(--color-primary-600, #2563eb);
      font-size: 1.25rem;
    }
    .vat-empty-state p { margin: 0; line-height: 1.5; }
  `
})
export class VatDeclarationComponent implements OnInit {
  readonly loc_ui_tern_consultation_des_declarations_soumises_par_879645 = $localize`:@@ui.tern.consultation.des.declarations.soumises.par.879645:Consultation des déclarations soumises par le cabinet`;
  readonly loc_ui_tern_preremplissage_a_partir_des_ventes_et_acha_bb3884 = $localize`:@@ui.tern.preremplissage.a.partir.des.ventes.et.acha.bb3884:Préremplissage à partir des ventes et achats du mois`;
  private readonly api = inject(AccountingService);
  readonly auth = inject(AuthService);
  readonly showDocLinks = canShowVatDeclarationDocLinks(this.auth);
  readonly isCompanyReadOnly = isCompanyVatDeclarationReadOnly(this.auth);
  readonly canManage = canManageVatDeclaration(this.auth);
  private readonly toast = inject(ToastService);
  private readonly title = inject(Title);
  private readonly route = inject(ActivatedRoute);
  private readonly errorHandler = inject(ErrorHandlerService);

  year = new Date().getFullYear();
  month = new Date().getMonth() + 1;

  readonly data = signal<VatDeclarationDto | null>(null);
  readonly error = signal<string | null>(null);
  readonly unavailableReason = signal<string | null>(null);
  readonly loading = signal(false);

  readonly extras = signal<VatDeclarationExtras>({
    fodec: 0, droitTimbre: 0, tcl: 0, tfp: 0, foprolos: 0, withholdingTax: 0, acomptes: 0
  });

  readonly totalToPay = computed(() => {
    const d = this.data();
    if (!d) return 0;
    return computeTotalToPay(d, this.extras());
  });

  readonly taxRows = computed(() => {
    const d = this.data();
    if (!d) return [];
    return buildTaxRows(d, this.extras(), this.totalToPay(), d.fodecRatePercent ?? 1, d.tclRatePercent ?? 0.2);
  });

  readonly chartSegments = computed(() => {
    const d = this.data();
    if (!d) return [];
    return buildChartSegments(d, this.extras(), this.totalToPay());
  });

  readonly docLinks = computed(() => {
    if (!this.showDocLinks) return [];
    const d = this.data();
    if (!d) return [];
    return buildDocLinks(d, this.year, this.month);
  });

  /** Lignes dont le montant déposé s'écarte du recalcul des modules. */
  readonly divergenceRows = computed(() => {
    const d = this.data();
    return d ? buildDivergenceRows(d) : [];
  });

  readonly payrollHint = computed(() => {
    const d = this.data();
    return d ? payrollHint(d) : null;
  });

  /**
   * Marche à suivre : un brouillon se corrige en place, une déclaration déposée par rectificative
   * — c'est ce que le domaine impose (UpdateDraft refuse tout statut autre que Brouillon).
   */
  readonly divergenceActionHint = computed(() => {
    const d = this.data();
    if (!d) return '';
    if (this.isCompanyReadOnly)
      return 'Les montants déposés par le cabinet font foi. Rapprochez-vous de lui pour toute correction.';
    if (d.status === 0)
      return $localize`:@@ui.tern.les.montants.enregistres.font.foi.et.ne.so.718ac5:Les montants enregistrés font foi et ne sont jamais réalignés automatiquement. `
        + $localize`:@@ui.tern.resynchronisez.puis.enregistrez.pour.les.m.dfda5a:Resynchronisez puis enregistrez pour les mettre à jour.`;
    return $localize`:@@ui.tern.cette.declaration.a.ete.deposee.ses.montan.c05947:Cette déclaration a été déposée : ses montants restent ceux du dépôt. `
      + $localize`:@@ui.tern.pour.la.corriger.resynchronisez.puis.enreg.daefa1:Pour la corriger, resynchronisez puis enregistrez une « Rectificative ».`;
  });

  /**
   * Recopie les valeurs calculées dans les champs éditables. Purement local : rien n'est persisté
   * tant que l'utilisateur n'a pas explicitement enregistré ou déposé une rectificative.
   */
  resyncFromModules(): void {
    const s = this.data()?.suggested;
    if (!s || this.isCompanyReadOnly) return;

    this.extras.update(e => ({
      ...e,
      fodec: clampExtrasValue(s.fodec),
      droitTimbre: clampExtrasValue(s.droitTimbre),
      tcl: clampExtrasValue(s.tcl),
      tfp: clampExtrasValue(s.tfp),
      foprolos: clampExtrasValue(s.foprolos),
      withholdingTax: clampExtrasValue(s.withholdingTax)
      // Les acomptes provisionnels n'ont aucune source automatique : saisie manuelle préservée.
    }));

    this.toast.add({
      severity: 'info',
      summary: $localize`:@@vat-declaration.component.summary.Montants_resynch:Montants resynchronisés`,
      detail: $localize`:@@vat-declaration.component.detail.V_rifiez_les_lig:Vérifiez les lignes, puis enregistrez pour que la déclaration les porte réellement.`,
      life: 6000
    });
  }

  ngOnInit(): void {
    this.title.setTitle('Déclaration mensuelle - InstaFact');
    // Deep-link depuis l'échéancier fiscal : ?year=2026&month=7 ouvre la bonne période.
    const params = this.route.snapshot.queryParamMap;
    const year = Number(params.get('year'));
    const month = Number(params.get('month'));
    if (Number.isInteger(year) && year >= 2000 && year <= 2100) this.year = year;
    if (Number.isInteger(month) && month >= 1 && month <= 12) this.month = month;
    this.load();
  }

  onYearChange(value: number): void {
    this.year = value;
  }

  onMonthChange(value: number): void {
    this.month = value;
  }

  navigatePeriod(delta: number): void {
    const next = shiftPeriod(this.year, this.month, delta);
    this.year = next.year;
    this.month = next.month;
    this.load();
  }

  onExtraChange(key: VatExtrasKey, value: unknown): void {
    if (this.isCompanyReadOnly) return;
    this.patchExtras(key, value);
  }

  patchExtras(key: VatExtrasKey, value: unknown): void {
    this.extras.update(e => ({ ...e, [key]: clampExtrasValue(value) }));
  }

  readonly buildVatAnalyzePayload = (): unknown => {
    const d = this.data();
    if (!d) {
      return wrapLegacyAnalyzePayload(
        'accounting-vat-declaration',
        { screen: 'accounting-vat-declaration', noData: true } as Record<string, unknown>
      );
    }
    const e = this.extras();
    return wrapLegacyAnalyzePayload(
      'accounting-vat-declaration',
      {
        screen: 'accounting-vat-declaration',
        period: { year: this.year, month: this.month },
        collectedVat: {
          rate19: d.collectedVat19,
          rate13: d.collectedVat13,
          rate7: d.collectedVat7,
          total: computeTotalCollected(d)
        },
        deductibleVat: {
          goods: d.deductibleVatGoods,
          assets: d.deductibleVatAssets,
          total: computeTotalDeductible(d)
        },
        previousCredit: d.previousCredit,
        vatDue: d.vatDue,
        creditToCarry: d.creditToCarry,
        status: d.status,
        currency: d.currency,
        otherTaxes: d.monthlyDeclarationV2Enabled ? {
          fodec: e.fodec,
          droitTimbre: e.droitTimbre,
          tcl: e.tcl,
          tfp: e.tfp,
          foprolos: e.foprolos,
          withholdingTax: e.withholdingTax,
          acomptes: e.acomptes,
          totalToPay: this.totalToPay()
        } : undefined,
        filingDeadline: d.filingDeadline,
        version: d.version,
        isRectificative: d.isRectificative
      } as Record<string, unknown>
    );
  };

  load(): void {
    this.clampPeriod();
    this.loading.set(true);
    this.error.set(null);
    this.unavailableReason.set(null);

    this.api.getVatDeclaration(this.year, this.month).subscribe({
      next: res => {
        this.loading.set(false);
        if (res.success && res.data) {
          this.data.set(res.data);
          const d = res.data;
          this.extras.set({
            fodec: d.fodec,
            droitTimbre: d.droitTimbre,
            tcl: d.tcl,
            tfp: d.tfp,
            foprolos: d.foprolos,
            withholdingTax: d.withholdingTax,
            acomptes: d.acomptes
          });
        } else {
          this.handleLoadFailure(res.error ?? $localize`:@@ui.tern.erreur.ab546c:Erreur`);
        }
      },
      error: (err) => {
        this.loading.set(false);
        this.handleLoadFailure(this.errorHandler.extractErrorMessage(err));
      }
    });
  }

  save(submit: boolean, rectificative = false): void {
    if (!this.canManage) return;
    this.clampPeriod();
    this.loading.set(true);
    this.error.set(null);
    const v2 = this.data()?.monthlyDeclarationV2Enabled ?? false;
    const extrasPayload = v2 ? { ...this.extras(), isRectificative: rectificative } : undefined;
    this.api.saveVatDeclaration(this.year, this.month, submit, extrasPayload).subscribe({
      next: res => {
        this.loading.set(false);
        if (res.success) {
          this.toast.add({
            severity: 'success',
            summary: rectificative ? $localize`:@@ui.tern.rectificative.enregistree.82a024:Rectificative enregistrée` : (submit ? $localize`:@@ui.tern.declaration.soumise.fba01b:Déclaration soumise` : $localize`:@@ui.tern.brouillon.enregistre.5b3c3a:Brouillon enregistré`),
            detail: rectificative
              ? $localize`:@@ui.tern.la.declaration.rectificative.a.ete.enregis.960df1:La déclaration rectificative a été enregistrée.`
              : (submit ? $localize`:@@ui.tern.la.declaration.a.ete.soumise.c56b8d:La déclaration a été soumise.` : $localize`:@@ui.tern.le.brouillon.de.declaration.a.ete.enregist.7c0e32:Le brouillon de déclaration a été enregistré.`),
            life: 5000
          });
          this.load();
        } else {
          this.error.set(res.error ?? $localize`:@@ui.tern.erreur.ab546c:Erreur`);
        }
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(this.errorHandler.extractErrorMessage(err));
      }
    });
  }

  exportPdf(): void {
    if (!this.data()) {
      this.toast.add({
        severity: 'warn',
        summary: $localize`:@@vat-declaration.component.summary.Export PDF:Export PDF`,
        detail: $localize`:@@vat-declaration.component.detail.Aucune_d_clarati:Aucune déclaration soumise à exporter pour cette période.`,
        life: 5000
      });
      return;
    }
    this.clampPeriod();
    this.api.exportVatDeclarationPdf(this.year, this.month).subscribe({
      next: blob => this.downloadPdf(blob),
      error: () => this.toast.add({ severity: 'error', summary: $localize`:@@vat-declaration.component.summary.Export PDF:Export PDF`, detail: $localize`:@@vat-declaration.component.detail.LexportPDFaéchoué:L'export PDF a échoué.`, life: 5000 })
    });
  }

  /** Édite la déclaration sur le gabarit officiel de la DGI (prêt à déposer). */
  exportOfficialForm(): void {
    if (!this.data()) {
      this.toast.add({
        severity: 'warn',
        summary: $localize`:@@vat-declaration.component.summary.Formulaire o:Formulaire officiel`,
        detail: $localize`:@@vat-declaration.component.detail.Aucune_d_clarati:Aucune déclaration soumise à exporter pour cette période.`,
        life: 5000
      });
      return;
    }
    this.clampPeriod();
    this.api.exportMonthlyDeclarationOfficialForm(this.year, this.month).subscribe({
      next: blob => downloadBlob(blob, `declaration_officielle_${this.year}_${String(this.month).padStart(2, '0')}.pdf`),
      error: () => this.toast.add({
        severity: 'error',
        summary: $localize`:@@vat-declaration.component.summary.Formulaire o:Formulaire officiel`,
        detail: $localize`:@@vat-declaration.component.detail.Lexportduformulaireo:L'export du formulaire officiel a échoué.`,
        life: 5000
      })
    });
  }

  previewPdf(): void {
    if (!this.canManage || !this.data()) return;
    this.clampPeriod();
    this.api.exportVatDeclarationPdf(this.year, this.month).subscribe({
      next: blob => {
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank', 'noopener,noreferrer');
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      },
      error: () => this.toast.add({ severity: 'error', summary: $localize`:@@vat-declaration.component.summary.Aperçu PDF:Aperçu PDF`, detail: $localize`:@@vat-declaration.component.detail.LaperçuPDFaéchoué:L'aperçu PDF a échoué.`, life: 5000 })
    });
  }

  private handleLoadFailure(message: string): void {
    this.data.set(null);
    if (this.isCompanyReadOnly && this.isCompanyNotSubmittedMessage(message)) {
      this.unavailableReason.set(COMPANY_EMPTY_STATE_MESSAGE);
      this.error.set(null);
      return;
    }
    this.unavailableReason.set(null);
    this.error.set(message);
  }

  private isCompanyNotSubmittedMessage(message: string): boolean {
    return message.includes(COMPANY_NOT_SUBMITTED_MARKER);
  }

  private downloadPdf(blob: Blob): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `declaration_${this.year}_${String(this.month).padStart(2, '0')}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private clampPeriod(): void {
    const y = Math.min(2100, Math.max(2000, Math.floor(Number(this.year)) || new Date().getFullYear()));
    const m = Math.min(12, Math.max(1, Math.floor(Number(this.month)) || 1));
    this.year = y;
    this.month = m;
  }
}
