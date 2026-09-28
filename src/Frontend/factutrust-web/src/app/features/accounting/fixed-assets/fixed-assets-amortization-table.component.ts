import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { AuthService } from '@core/services/auth.service';
import {
  AmortizationReportGroupingMode,
  AmortizationReportResponse,
  AmortizationReportAssetRowDto,
  AmortizationReportGroupDto,
  CURRENT_YEAR_POSTING_STATUS_LABELS,
  DEPRECIATION_METHOD_LABELS,
  DepreciationRateCategoryDto,
  FixedAssetStatus,
  FixedAssetsService
} from '../services/fixed-assets.service';
import {
  FixedAssetSettingsForm,
  defaultFiscalYearSettings,
  normalizeFiscalYearSettings
} from '../services/fixed-asset-settings-defaults';
import { fiscalYearLabel } from '../services/fiscal-year.util';
import { AccountingStatusBannerComponent } from '../shared/accounting-status-banner.component';
import { ErrorHandlerService } from '@core/services/error-handler.service';

@Component({
  selector: 'app-fixed-assets-amortization-table',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    PageHeaderComponent,
    ButtonComponent,
    EmptyStateComponent,
    AccountingStatusBannerComponent
  ],
  template: `
    <app-page-header
      title="Tableau des amortissements" i18n-title="@@accounting.fixed-assets.tableau.des.amortissements.c23d3f29"
      subtitle="État comptable complet de l'exercice (format Sage)" i18n-subtitle="@@accounting.fixed-assets.etat.comptable.complet.de.l.exercice.for.727bbf56" />

    <div class="card accounting-filters-card no-print">
      <div class="accounting-filter-row">
        <input
          type="search"
          class="accounting-filter-input"
          placeholder="Rechercher (désignation, n° inventaire)" i18n-placeholder="@@accounting.fixed-assets.rechercher.designation.n.inventaire.cc557d2d"
          [(ngModel)]="search"
          (keyup.enter)="reload()" />
        <select class="accounting-filter-input" [(ngModel)]="statusFilter" (ngModelChange)="reload()">
          <option [ngValue]="null" i18n="@@accounting.fixed-assets.tous.les.statuts.2d5088af">Tous les statuts</option>
          <option [ngValue]="FixedAssetStatus.Draft" i18n="@@accounting.fixed-assets.brouillon.57d2d7a7">Brouillon</option>
          <option [ngValue]="FixedAssetStatus.InService" i18n="@@accounting.fixed-assets.en.service.0b067773">En service</option>
          <option [ngValue]="FixedAssetStatus.FullyDepreciated" i18n="@@accounting.fixed-assets.totalement.amorti.ede655ed">Totalement amorti</option>
          <option [ngValue]="FixedAssetStatus.Disposed" i18n="@@accounting.fixed-assets.cede.51eca68c">Cédé</option>
        </select>
        <select class="accounting-filter-input" [(ngModel)]="categoryFilter" (ngModelChange)="reload()">
          <option [ngValue]="null" i18n="@@accounting.fixed-assets.toutes.les.categories.ac8ab261">Toutes les catégories</option>
          <option *ngFor="let c of categories()" [ngValue]="c.id">{{ c.label }}</option>
        </select>
        <input
          type="number"
          class="accounting-filter-input year-input"
          placeholder="Exercice" i18n-placeholder="@@accounting.fixed-assets.exercice.e171e2b0"
          min="2000"
          max="2100"
          [(ngModel)]="fiscalYearFilter"
          (keyup.enter)="reload()" />
        <select class="accounting-filter-input" [(ngModel)]="groupingMode" (ngModelChange)="reload()">
          <option value="AssetAccount" i18n="@@accounting.fixed-assets.compte.immobilisation.c2d44c21">Compte immobilisation</option>
          <option value="FiscalCategory" i18n="@@accounting.fixed-assets.categorie.fiscale.a9a54a0a">Catégorie fiscale</option>
        </select>
        <app-button variant="secondary" icon="pi pi-refresh" type="button" (click)="reload()" [disabled]="loading()" i18n="@@accounting.fixed-assets.actualiser.9d3b2a7d"> Actualiser </app-button>
        <app-button variant="secondary" icon="pi pi-print" type="button" (click)="printReport()" [disabled]="loading() || !report()" i18n="@@accounting.fixed-assets.imprimer.5382c09d"> Imprimer </app-button>
        <app-button variant="secondary" icon="pi pi-file-excel" type="button" (click)="exportXlsx()" [disabled]="loading()" i18n="@@accounting.fixed-assets.export.xlsx.93f3f8f5"> Export XLSX </app-button>
        <app-button variant="secondary" icon="pi pi-download" type="button" (click)="exportCsv()" [disabled]="loading() || !report()" i18n="@@accounting.fixed-assets.export.csv.5755f9ac"> Export CSV </app-button>
      </div>
    </div>

    <app-accounting-status-banner [message]="error() ?? ''" variant="error" *ngIf="error()" />
    <app-accounting-status-banner
      class="no-print"
      [message]="loc_ui_tern_exercice_affiche_6dd078 + fiscalYearDisplay(fiscalYearFilter)"
      variant="info"
      *ngIf="!error()" />

    <div class="card" *ngIf="!loading() && !report()?.groups?.length">
      <app-empty-state
        icon="pi pi-table"
        title="Aucune immobilisation" i18n-title="@@accounting.fixed-assets.aucune.immobilisation.f9c26485"
        message="Aucune immobilisation ne correspond aux filtres pour cet exercice." i18n-message="@@accounting.fixed-assets.aucune.immobilisation.ne.correspond.aux.bb33e4fa" />
    </div>

    <div class="card report-container" *ngIf="report() as r">
      <div class="print-only print-report">
        <header class="sage-report-header">
          <div class="sage-company">{{ displayCompanyName(r) }}</div>
          <h2 class="sage-title" i18n="@@accounting.fixed-assets.tableau.des.amortissements.44e28861">TABLEAU DES AMORTISSEMENTS</h2>
          <div class="sage-period" i18n="@@accounting.fixed-assets.exercice.du.au.c4eb641a">
            Exercice du {{ r.header.periodStart | date: 'dd/MM/yyyy' }} au {{ r.header.periodEnd | date: 'dd/MM/yyyy' }}
          </div>
          <div class="sage-meta" i18n="@@accounting.fixed-assets.le.a.exercice.8e2c09d4">
            <span>Le {{ r.header.generatedAtUtc | date: 'dd/MM/yyyy' }} à {{ r.header.generatedAtUtc | date: 'HH:mm' }}</span>
            <span>Exercice : {{ fiscalYearDisplay(r.header.fiscalYear) }}</span>
          </div>
        </header>

        <div class="sage-table-scroll">
          <table class="sage-main-table">
            <thead>
              <tr>
                <th i18n="@@accounting.fixed-assets.code.immobilisation.4463772b">Code immobilisation</th>
                <th i18n="@@accounting.fixed-assets.designation.immobilisation.8f97d390">Désignation immobilisation</th>
                <th i18n="@@accounting.fixed-assets.date.acquisition.455ed480">Date acquisition</th>
                <th class="text-right" i18n="@@accounting.fixed-assets.valeur.d.origine.b74f9474">Valeur d'origine</th>
                <th class="text-right" i18n="@@accounting.fixed-assets.duree.ans.21e6f820">Durée (ans)</th>
                <th i18n="@@accounting.fixed-assets.mode.a7b93d21">Mode</th>
                <th class="text-right" i18n="@@accounting.fixed-assets.amort.ant.31.12.0533f910">Amort. ant. 31/12/{{ priorYear() }}</th>
                <th class="text-right" i18n="@@accounting.fixed-assets.dotation.calculee.3c1b6780">Dotation calculée</th>
                <th class="text-right" i18n="@@accounting.fixed-assets.dotation.comptabilisee.03b8d6ab">Dotation comptabilisée</th>
                <th class="text-right" i18n="@@accounting.fixed-assets.ecart.6ae8dce8">Écart</th>
                <th class="text-right" i18n="@@accounting.fixed-assets.fin.exercice.31.12.881ce8e9">Fin exercice 31/12/{{ r.header.fiscalYear }}</th>
                <th class="text-right">VNC 31/12/{{ r.header.fiscalYear }}</th>
                <th i18n="@@accounting.fixed-assets.statut.compta.949575d9">Statut compta</th>
              </tr>
            </thead>
            <tbody>
              <ng-container *ngFor="let group of r.groups">
                <tr class="group-row">
                  <td colspan="13"><strong>{{ groupHeaderLabel(group) }}</strong></td>
                </tr>
                <tr *ngFor="let row of group.rows" class="asset-row">
                  <td><code>{{ row.assetAccountNumber }}</code></td>
                  <td>
                    <a [routerLink]="['/accounting/fixed-assets', row.assetId]" class="asset-link">{{ row.label }}</a>
                    <div class="inventory-sub">{{ row.inventoryNumber }}</div>
                  </td>
                  <td>{{ row.acquisitionDate | date: 'dd/MM/yyyy' }}</td>
                  <td class="text-right">{{ row.originValue | number: '1.3-3' }}</td>
                  <td class="text-right">{{ row.usefulLifeYears | number: '1.2-2' }}</td>
                  <td>{{ methodLabel(row) }}</td>
                  <td class="text-right">{{ row.priorAccumulatedDepreciation | number: '1.3-3' }}</td>
                  <td class="text-right">{{ row.dotationCalculeeExercice | number: '1.3-3' }}</td>
                  <td class="text-right">{{ row.dotationComptabiliseeExercice | number: '1.3-3' }}</td>
                  <td class="text-right">{{ gap(row) | number: '1.3-3' }}</td>
                  <td class="text-right">{{ row.endOfYearAccumulatedDepreciation | number: '1.3-3' }}</td>
                  <td class="text-right">{{ row.endOfYearNetBookValue | number: '1.3-3' }}</td>
                  <td><span class="status-pill">{{ postingStatusLabel(row.postingStatus) }}</span></td>
                </tr>
                <tr class="subtotal-row">
                  <td colspan="3" i18n="@@accounting.fixed-assets.total.0c8136b7"><strong>Total {{ group.groupLabel }}</strong></td>
                  <td class="text-right"><strong>{{ group.subtotal.originValue | number: '1.3-3' }}</strong></td>
                  <td colspan="2"></td>
                  <td class="text-right"><strong>{{ group.subtotal.priorAccumulatedDepreciation | number: '1.3-3' }}</strong></td>
                  <td class="text-right"><strong>{{ group.subtotal.dotationCalculeeExercice | number: '1.3-3' }}</strong></td>
                  <td class="text-right"><strong>{{ group.subtotal.dotationComptabiliseeExercice | number: '1.3-3' }}</strong></td>
                  <td class="text-right"><strong>{{ group.subtotal.dotationCalculeeExercice - group.subtotal.dotationComptabiliseeExercice | number: '1.3-3' }}</strong></td>
                  <td class="text-right"><strong>{{ group.subtotal.endOfYearAccumulatedDepreciation | number: '1.3-3' }}</strong></td>
                  <td class="text-right"><strong>{{ group.subtotal.endOfYearNetBookValue | number: '1.3-3' }}</strong></td>
                  <td></td>
                </tr>
              </ng-container>
              <tr class="grand-total-row">
                <td colspan="3"><strong i18n="@@accounting.fixed-assets.total.general.f6821c15">TOTAL GÉNÉRAL</strong></td>
                <td class="text-right"><strong>{{ r.grandTotal.originValue | number: '1.3-3' }}</strong></td>
                <td colspan="2"></td>
                <td class="text-right"><strong>{{ r.grandTotal.priorAccumulatedDepreciation | number: '1.3-3' }}</strong></td>
                <td class="text-right"><strong>{{ r.grandTotal.dotationCalculeeExercice | number: '1.3-3' }}</strong></td>
                <td class="text-right"><strong>{{ r.grandTotal.dotationComptabiliseeExercice | number: '1.3-3' }}</strong></td>
                <td class="text-right"><strong>{{ r.grandTotal.dotationCalculeeExercice - r.grandTotal.dotationComptabiliseeExercice | number: '1.3-3' }}</strong></td>
                <td class="text-right"><strong>{{ r.grandTotal.endOfYearAccumulatedDepreciation | number: '1.3-3' }}</strong></td>
                <td class="text-right"><strong>{{ r.grandTotal.endOfYearNetBookValue | number: '1.3-3' }}</strong></td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="sage-bottom-panels">
          <div class="sage-summary-panel">
            <h3 i18n="@@accounting.fixed-assets.recapitulatif.par.nature.d.immobilisations.37a44209">RÉCAPITULATIF PAR NATURE D'IMMOBILISATIONS</h3>
            <table class="sage-summary-table">
              <thead>
                <tr>
                  <th i18n="@@accounting.fixed-assets.nature.bddc7adb">Nature</th>
                  <th class="text-right" i18n="@@accounting.fixed-assets.valeur.d.origine.b74f9474">Valeur d'origine</th>
                  <th class="text-right" i18n="@@accounting.fixed-assets.amort.cumules.31.12.1f75aaeb">Amort. cumulés 31/12/{{ priorYear() }}</th>
                  <th class="text-right" i18n="@@accounting.fixed-assets.dotation.7590e696">Dotation {{ fiscalYearDisplay(r.header.fiscalYear) }}</th>
                  <th class="text-right">VNC 31/12/{{ r.header.fiscalYear }}</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let s of r.summaryByNature">
                  <td>{{ s.natureLabel }}</td>
                  <td class="text-right">{{ s.originValue | number: '1.3-3' }}</td>
                  <td class="text-right">{{ s.priorAccumulatedDepreciation | number: '1.3-3' }}</td>
                  <td class="text-right">{{ s.dotationCalculeeExercice | number: '1.3-3' }}</td>
                  <td class="text-right">{{ s.endOfYearNetBookValue | number: '1.3-3' }}</td>
                </tr>
                <tr class="summary-total-row">
                  <td><strong i18n="@@accounting.fixed-assets.total.general.f6821c15">TOTAL GÉNÉRAL</strong></td>
                  <td class="text-right"><strong>{{ r.grandTotal.originValue | number: '1.3-3' }}</strong></td>
                  <td class="text-right"><strong>{{ r.grandTotal.priorAccumulatedDepreciation | number: '1.3-3' }}</strong></td>
                  <td class="text-right"><strong>{{ r.grandTotal.dotationCalculeeExercice | number: '1.3-3' }}</strong></td>
                  <td class="text-right"><strong>{{ r.grandTotal.endOfYearNetBookValue | number: '1.3-3' }}</strong></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="sage-info-panel">
            <h3 i18n="@@accounting.fixed-assets.informations.08c80be1">INFORMATIONS</h3>
            <p i18n="@@accounting.fixed-assets.lineaire.dotation.constante.sur.la.duree.c82164a5"><strong>Linéaire</strong> : dotation constante sur la durée d'amortissement.</p>
            <p i18n="@@accounting.fixed-assets.accelere.application.du.taux.majore.fisc.8ef1d44b"><strong>Accéléré</strong> : application du taux majoré fiscal.</p>
            <p i18n="@@accounting.fixed-assets.integral.dotation.unique.l.annee.de.mise.ba977829"><strong>Intégral</strong> : dotation unique l'année de mise en service.</p>
            <p i18n="@@accounting.fixed-assets.devise.09c46e8b">Devise : {{ r.infoBox.currencyCode }}</p>
            <p i18n="@@accounting.fixed-assets.edite.le.date.heure">Édité le {{ r.infoBox.generatedAtUtc | date: 'dd/MM/yyyy' }} à {{ r.infoBox.generatedAtUtc | date: 'HH:mm' }}</p>
            <p>{{ r.infoBox.productName }}</p>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .accounting-filter-row {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        align-items: center;
      }
      .year-input {
        max-width: 110px;
      }
      .text-right {
        text-align: end;
      }
      .report-container {
        overflow: hidden;
      }
      .sage-report-header {
        text-align: center;
        margin-bottom: 1.25rem;
      }
      .sage-company {
        font-size: 1.1rem;
        font-weight: 600;
      }
      .sage-title {
        margin: 0.35rem 0;
        color: #1e3a8a;
        letter-spacing: 0.04em;
      }
      .sage-period,
      .sage-meta {
        color: #475569;
        font-size: 0.9rem;
      }
      .sage-meta {
        display: flex;
        justify-content: center;
        gap: 1.5rem;
        margin-top: 0.25rem;
      }
      .sage-table-scroll {
        max-height: 60vh;
        overflow: auto;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
      }
      .sage-main-table,
      .sage-summary-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.82rem;
      }
      .sage-main-table th,
      .sage-main-table td,
      .sage-summary-table th,
      .sage-summary-table td {
        border: 1px solid #e2e8f0;
        padding: 0.45rem 0.5rem;
        vertical-align: top;
      }
      .sage-main-table thead th {
        background: #e0f2fe;
        position: sticky;
        top: 0;
        z-index: 1;
      }
      .group-row td {
        background: #f8fafc;
        color: #1e3a8a;
      }
      .subtotal-row td {
        background: #f1f5f9;
        font-weight: 600;
      }
      .grand-total-row td {
        background: #1e3a8a;
        color: #fff;
      }
      .inventory-sub {
        font-size: 0.75rem;
        color: #64748b;
      }
      .asset-link {
        color: var(--primary-color, #2563eb);
        text-decoration: none;
        font-weight: 500;
      }
      .status-pill {
        display: inline-block;
        padding: 0.15rem 0.5rem;
        border-radius: 999px;
        background: #e0f2fe;
        color: #0369a1;
        font-size: 0.75rem;
        white-space: nowrap;
      }
      .sage-bottom-panels {
        display: grid;
        grid-template-columns: 2fr 1fr;
        gap: 1rem;
        margin-top: 1rem;
      }
      .sage-summary-panel,
      .sage-info-panel {
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 0.75rem;
      }
      .sage-summary-panel h3,
      .sage-info-panel h3 {
        margin: 0 0 0.5rem;
        font-size: 0.9rem;
        color: #1e3a8a;
      }
      .sage-info-panel p {
        margin: 0.35rem 0;
        font-size: 0.82rem;
        color: #334155;
      }
      .summary-total-row td {
        background: #f1f5f9;
        font-weight: 700;
      }
      .print-only {
        display: block;
      }
      @media print {
        @page {
          size: landscape;
          margin: 10mm;
        }
        .no-print {
          display: none !important;
        }
        .sage-table-scroll {
          max-height: none;
          overflow: visible;
        }
        .grand-total-row td {
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
      }
      @media (max-width: 1100px) {
        .sage-bottom-panels {
          grid-template-columns: 1fr;
        }
      }
    `
  ]
})
export class FixedAssetsAmortizationTableComponent implements OnInit {
  readonly loc_ui_tern_exercice_affiche_6dd078 = $localize`:@@ui.tern.exercice.affiche.6dd078:Exercice affiché : `;
  private readonly errors = inject(ErrorHandlerService);
  private readonly api = inject(FixedAssetsService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);

  readonly FixedAssetStatus = FixedAssetStatus;
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly report = signal<AmortizationReportResponse | null>(null);
  readonly categories = signal<DepreciationRateCategoryDto[]>([]);

  /** Paramètres d'exercice du dossier (repli civil tant que non chargés) — plan « Exercices décalés ». */
  readonly settings = signal<FixedAssetSettingsForm>(defaultFiscalYearSettings());

  readonly priorYear = computed(() => this.fiscalYearFilter - 1);

  search = '';
  statusFilter: FixedAssetStatus | null = null;
  categoryFilter: string | null = null;
  fiscalYearFilter = new Date().getFullYear();
  groupingMode: AmortizationReportGroupingMode = 'AssetAccount';

  ngOnInit(): void {
    this.api.getRateCategories().subscribe({
      next: res => this.categories.set(res.data ?? []),
      error: () => this.categories.set([])
    });
    this.loadFiscalYearSettings();

    if (this.route.snapshot.queryParamMap.get('refresh') === '1') {
      this.load();
    } else {
      this.load();
    }
  }

  /** Libellé d'exercice (« N/N+1 » si décalé, sinon « N ») pour l'affichage du tableau Sage. */
  fiscalYearDisplay(fiscalYear: number): string {
    const { fiscalYearStartMonth, fiscalYearLabelFormat } = this.settings();
    return fiscalYearLabel(fiscalYear, fiscalYearStartMonth, fiscalYearLabelFormat);
  }

  private loadFiscalYearSettings(): void {
    this.api.getSettings().subscribe({
      next: res => this.settings.set(normalizeFiscalYearSettings(res.data)),
      error: () => this.settings.set(defaultFiscalYearSettings())
    });
  }

  reload(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    const companyName = this.auth.user()?.companyName ?? '';

    this.api
      .getAmortizationReport({
        fiscalYear: this.fiscalYearFilter,
        groupingMode: this.groupingMode,
        status: this.statusFilter === null ? undefined : this.statusFilter,
        categoryId: this.categoryFilter ?? undefined,
        search: this.search.trim() || undefined,
        companyName
      })
      .subscribe({
        next: res => {
          this.report.set(res.data ?? null);
          this.loading.set(false);
        },
        error: err => {
          this.error.set(this.errors.extractErrorMessage(err, $localize`:@@accounting.fixed-assets-amortization-table.ts.impossible.de.charger.le.tableau.des.amo.1292a2dd:Impossible de charger le tableau des amortissements de l'exercice.`));
          this.loading.set(false);
        }
      });
  }

  displayCompanyName(report: AmortizationReportResponse): string {
    return report.header.companyName || this.auth.user()?.companyName || $localize`:@@accounting.fixed-assets-amortization-table.ts.societe.2c3fdad8:Société`;
  }

  methodLabel(row: AmortizationReportAssetRowDto): string {
    return DEPRECIATION_METHOD_LABELS[row.depreciationMethod] ?? $localize`:@@ui.tern.lineaire.a5db4c:Linéaire`;
  }

  // C4 : n'affiche le code de groupe qu'une seule fois — certaines réponses API renvoient déjà le
  // code dans le libellé (ex. groupCode="224", groupLabel="224 Véhicules"), ce qui produisait
  // « 224 224 Véhicules… » en concaténant systématiquement code + libellé.
  groupHeaderLabel(group: AmortizationReportGroupDto): string {
    const code = (group.groupCode ?? '').trim();
    const label = (group.groupLabel ?? '').trim();
    if (!code) return label;
    if (!label) return code;
    return label.startsWith(code) ? label : `${code} ${label}`;
  }

  postingStatusLabel(status: keyof typeof CURRENT_YEAR_POSTING_STATUS_LABELS): string {
    return CURRENT_YEAR_POSTING_STATUS_LABELS[status] ?? $localize`:@@ui.tern.non.comptabilisee.5e1470:Non comptabilisée`;
  }

  gap(row: { dotationCalculeeExercice: number; dotationComptabiliseeExercice: number }): number {
    return row.dotationCalculeeExercice - row.dotationComptabiliseeExercice;
  }

  printReport(): void {
    globalThis.print();
  }

  exportXlsx(): void {
    const companyName = this.auth.user()?.companyName ?? '';
    this.api
      .exportAmortizationReportExcel({
        fiscalYear: this.fiscalYearFilter,
        groupingMode: this.groupingMode,
        status: this.statusFilter === null ? undefined : this.statusFilter,
        categoryId: this.categoryFilter ?? undefined,
        search: this.search.trim() || undefined,
        companyName
      })
      .subscribe({
        next: blob =>
          this.downloadBlob(blob, `tableau-amortissements-sage-${this.fiscalYearFilter}.xlsx`),
        error: () => this.error.set($localize`:@@accounting.fixed-assets-amortization-table.ts.export.xlsx.impossible.pour.le.tableau.d.3157935a:Export XLSX impossible pour le tableau des amortissements.`)
      });
  }

  exportCsv(): void {
    const r = this.report();
    if (!r) return;

    const headers = [
      'Groupe',
      'CodeImmobilisation',
      'NumeroInventaire',
      'Designation',
      'DateAcquisition',
      'ValeurOrigine',
      'DureeAns',
      'Mode',
      'AmortissementsAnterieurs',
      'DotationCalculee',
      'DotationComptabilisee',
      'Ecart',
      'FinExercice',
      'VncFinExercice',
      'StatutComptabilisation'
    ];

    const lines: string[] = [];
    for (const group of r.groups) {
      for (const row of group.rows) {
        lines.push(
          [
            group.groupLabel,
            row.assetAccountNumber,
            row.inventoryNumber,
            row.label,
            row.acquisitionDate,
            row.originValue.toFixed(3),
            row.usefulLifeYears.toFixed(2),
            this.methodLabel(row),
            row.priorAccumulatedDepreciation.toFixed(3),
            row.dotationCalculeeExercice.toFixed(3),
            row.dotationComptabiliseeExercice.toFixed(3),
            this.gap(row).toFixed(3),
            row.endOfYearAccumulatedDepreciation.toFixed(3),
            row.endOfYearNetBookValue.toFixed(3),
            this.postingStatusLabel(row.postingStatus)
          ]
            .map(v => `"${String(v).replace(/"/g, '""')}"`)
            .join(',')
        );
      }
    }

    const csv = [headers.join(','), ...lines].join('\n');
    this.downloadBlob(
      new Blob([csv], { type: 'text/csv;charset=utf-8;' }),
      `tableau-amortissements-sage-${this.fiscalYearFilter}.csv`
    );
  }

  private downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}
