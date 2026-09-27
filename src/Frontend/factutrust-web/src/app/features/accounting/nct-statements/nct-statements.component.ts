import { Component, LOCALE_ID, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, of } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { AccountingFilterBarComponent } from '../shared/accounting-filter-bar.component';
import { AccountingStatusBannerComponent } from '../shared/accounting-status-banner.component';
import { AccountingService, NctFinancialStatementsDto, NctLineDto } from '../services/accounting.service';
import { FinancialStatementsExportDialogComponent } from './financial-statements-export-dialog.component';
import { NctNoteOverridesDialogComponent } from './nct-note-overrides-dialog.component';

type NctTab = 'bilan' | 'resultat' | 'flux' | 'capitaux' | 'notes';

/** Réponse d'API générique (miroir non exporté de `ApiResponse<T>` du service). */
interface NctStatementsApiResponse {
  success: boolean;
  data?: NctFinancialStatementsDto;
  error?: string;
}

const MIN_FISCAL_YEAR = 2000;
const MAX_FISCAL_YEAR = 2100;

/** Code de la ligne de réconciliation dans le tableau des flux de trésorerie (méthode indirecte). */
const CASH_FLOW_RECONCILIATION_CODE = 'CFECART';

@Component({
  selector: 'app-nct-statements',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    PageHeaderComponent,
    ButtonComponent,
    AccountingFilterBarComponent,
    AccountingStatusBannerComponent,
    FinancialStatementsExportDialogComponent,
    NctNoteOverridesDialogComponent
  ],
  template: `
    <app-page-header title="États financiers NCT" i18n-title="@@accounting.nct-statements.etats.financiers.nct.a11800a0" subtitle="Liasse : bilan, résultat, flux de trésorerie, capitaux propres et notes" i18n-subtitle="@@accounting.nct-statements.liasse.bilan.resultat.flux.de.tresorerie.5fbd0222" />

    <div class="card accounting-filters-card">
      <app-accounting-filter-bar ariaLabel="Exercice de la liasse NCT" i18n-ariaLabel="@@accounting.nct-statements.exercice.de.la.liasse.nct.d3042351">
        <div accountingFilterFields>
          <div class="accounting-filter-field">
            <label class="accounting-filter-label" for="nct-year" i18n="@@accounting.nct-statements.exercice.e171e2b0">Exercice</label>
            <input id="nct-year" type="number" [ngModel]="fiscalYear" (ngModelChange)="onYearInputChange($event)"
              class="accounting-filter-input nct-year-input" min="2000" max="2100"
              [attr.aria-invalid]="!isYearValid()" />
            @if (!isYearValid()) {
              <span class="nct-year-error" role="alert" i18n="@@accounting.nct-statements.exercice.invalide.doit.etre.compris.entre.2000.e.db4c8a16">Exercice invalide : doit être compris entre 2000 et 2100.</span>
            }
          </div>
        </div>
        <div accountingFilterActions>
          <app-button variant="secondary" icon="pi pi-refresh" type="button" (click)="load()" [disabled]="loading() || !isYearValid()"
            ariaLabel="Charger la liasse NCT" i18n-ariaLabel="@@accounting.nct-statements.charger.la.liasse.nct.f6fc09c9" i18n="@@accounting.nct-statements.charger.8f860300">Charger</app-button>
          <app-button variant="secondary" icon="pi pi-eye" type="button" (click)="openExportDialog()" [disabled]="loading() || !data()"
            ariaLabel="Aperçu et impression des états financiers" i18n-ariaLabel="@@accounting.nct-statements.apercu.et.impression.des.etats.financier.c7ea131c" i18n="@@accounting.nct-statements.apercu.impression.b2018ec0">Aperçu / Impression</app-button>
          <app-button variant="secondary" icon="pi pi-file-pdf" type="button" (click)="exportPdf()" [disabled]="loading() || !data()"
            ariaLabel="Exporter la liasse NCT en PDF" i18n-ariaLabel="@@accounting.nct-statements.exporter.la.liasse.nct.en.pdf.0b15784e" i18n="@@accounting.nct-statements.exporter.pdf.9a2c3956">Exporter PDF</app-button>
          <app-button variant="secondary" icon="pi pi-pencil" type="button" (click)="overridesDialogVisible = true" [disabled]="loading()"
            ariaLabel="Personnaliser les notes annexes" i18n-ariaLabel="@@accounting.nct-statements.personnaliser.les.notes.annexes.4acec9c1" i18n="@@accounting.nct-statements.personnaliser.les.annexes.05ae837d">Personnaliser les annexes</app-button>
        </div>
      </app-accounting-filter-bar>
    </div>

    <app-financial-statements-export-dialog
      [(visible)]="exportDialogVisible"
      [fiscalYear]="fiscalYear"
      [statements]="data()" />

    <app-nct-note-overrides-dialog
      [(visible)]="overridesDialogVisible"
      [fiscalYear]="fiscalYear"
      (changed)="load()" />

    <app-accounting-status-banner variant="error" [message]="error() ?? ''" [showRetry]="!!error()" retryLabel="Réessayer" i18n-retryLabel="@@accounting.nct-statements.reessayer.c4f78b12" (retry)="load()" />

    @if (data(); as d) {
      @if (!d.nctStatementsEnabled) {
        <div class="nct-info-banner" role="status">
          <i class="pi pi-info-circle" aria-hidden="true"></i>
          <span i18n="@@accounting.nct-statements.la.liasse.nct.n.est.pas.activee.pour.ce.dossier..bc970082">La liasse NCT n'est pas activée pour ce dossier. L'aperçu ci-dessous est indicatif.</span>
        </div>
      }

      @if (d.balanceSheet.warnings.length) {
        <div class="nct-alert-banner" role="alert">
          <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
          <div>
            <strong i18n="@@accounting.nct-statements.controles.qualite.de.la.liasse.602d2a38">Contrôles qualité de la liasse</strong>
            <ul class="nct-warn-list">
              @for (w of d.balanceSheet.warnings; track w) { <li>{{ w }}</li> }
            </ul>
          </div>
        </div>
      }

      <div class="nct-tabs" role="tablist">
        <button type="button" role="tab" class="nct-tab" [class.nct-tab--active]="tab() === 'bilan'" (click)="tab.set('bilan')" i18n="@@accounting.nct-statements.bilan.a80c4623">Bilan</button>
        <button type="button" role="tab" class="nct-tab" [class.nct-tab--active]="tab() === 'resultat'" (click)="tab.set('resultat')" i18n="@@accounting.nct-statements.compte.de.resultat.a292527b">Compte de résultat</button>
        <button type="button" role="tab" class="nct-tab" [class.nct-tab--active]="tab() === 'flux'" (click)="tab.set('flux')" i18n="@@accounting.nct-statements.flux.de.tresorerie.b60dc8b6">Flux de trésorerie</button>
        <button type="button" role="tab" class="nct-tab" [class.nct-tab--active]="tab() === 'capitaux'" (click)="tab.set('capitaux')" i18n="@@accounting.nct-statements.capitaux.propres.4245faa7">Capitaux propres</button>
        <button type="button" role="tab" class="nct-tab" [class.nct-tab--active]="tab() === 'notes'" (click)="tab.set('notes')" i18n="@@accounting.nct-statements.notes.70440046">Notes</button>
      </div>

      <div class="card nct-card">
        @switch (tab()) {
          @case ('bilan') {
            <div class="nct-balance-status">
              <span class="nct-badge" [class.nct-badge--ok]="d.balanceSheet.isBalanced" [class.nct-badge--ko]="!d.balanceSheet.isBalanced">
                {{ d.balanceSheet.isBalanced ? loc_ui_tern_bilan_equilibre_8e3fbf : unbalancedLabel(d.balanceSheet.difference) }}
              </span>
            </div>
            <h3 class="nct-section" i18n="@@accounting.nct-statements.actif.0fc6c6b8">ACTIF</h3>
            <ng-container [ngTemplateOutlet]="tableTpl" [ngTemplateOutletContext]="{ lines: d.balanceSheet.assets }"></ng-container>
            <h3 class="nct-section" i18n="@@accounting.nct-statements.capitaux.propres.et.passifs.4a6fc6d6">CAPITAUX PROPRES ET PASSIFS</h3>
            <ng-container [ngTemplateOutlet]="tableTpl" [ngTemplateOutletContext]="{ lines: d.balanceSheet.equityAndLiabilities }"></ng-container>
          }
          @case ('resultat') {
            <ng-container [ngTemplateOutlet]="tableTpl" [ngTemplateOutletContext]="{ lines: d.incomeStatement.lines }"></ng-container>
          }
          @case ('flux') {
            <div class="nct-balance-status">
              <span class="nct-badge" [class.nct-badge--ok]="d.cashFlow.isReconciled" [class.nct-badge--ko]="!d.cashFlow.isReconciled">
                {{ d.cashFlow.isReconciled ? loc_ui_tern_flux_de_tresorerie_rapproche_e8cb8d : unreconciledLabel(cashFlowGap()) }}
              </span>
            </div>
            <p class="nct-hint" i18n="@@accounting.nct-statements.methode.indirecte.la.ligne.ecart.de.rapprochemen.ff0b4d3e">Méthode indirecte. La ligne « Écart de rapprochement » explicite tout résidu par rapport à la variation réelle de trésorerie.</p>
            <ng-container [ngTemplateOutlet]="tableTpl" [ngTemplateOutletContext]="{ lines: d.cashFlow.lines }"></ng-container>
          }
          @case ('capitaux') {
            <ng-container [ngTemplateOutlet]="tableTpl" [ngTemplateOutletContext]="{ lines: d.equityChanges.lines }"></ng-container>
          }
          @case ('notes') {
            @for (note of d.notes; track note.title) {
              <h3 class="nct-section">{{ note.title }}</h3>
              <ng-container [ngTemplateOutlet]="tableTpl" [ngTemplateOutletContext]="{ lines: note.lines }"></ng-container>
            }
          }
        }
      </div>
    }

    <ng-template #tableTpl let-lines="lines">
      <table class="nct-table">
        <thead>
          <tr>
            <th scope="col" class="nct-th-label" i18n="@@accounting.nct-statements.rubrique.ef1b579b">Rubrique</th>
            <th scope="col" class="nct-th-amount" i18n="@@accounting.nct-statements.exercice.n.6fef5d8f">Exercice N</th>
            <th scope="col" class="nct-th-amount" i18n="@@accounting.nct-statements.exercice.n.1.2568d50f">Exercice N-1</th>
          </tr>
        </thead>
        <tbody>
          @for (line of lines; track line.code) {
            <tr [class.nct-row--subtotal]="line.isSubtotal" [class.nct-row--reconciliation]="line.code === reconciliationCode">
              <td class="nct-td-label" [style.paddingLeft.rem]="0.75 + line.level * 1.25">{{ line.label }}</td>
              <td class="nct-td-amount">{{ line.amount | number : '1.3-3' }}</td>
              <td class="nct-td-amount nct-td-prev">{{ line.previousAmount | number : '1.3-3' }}</td>
            </tr>
          }
        </tbody>
      </table>
    </ng-template>
  `,
  styles: `
    @use '../shared/accounting-layout';
    .nct-year-input { max-width: 7rem; }
    .nct-info-banner { display:flex; align-items:center; gap:var(--spacing-2); margin-bottom:var(--spacing-4); padding:var(--spacing-3) var(--spacing-4); border-radius:var(--radius-md); background:var(--color-primary-50,#eff6ff); border:1px solid var(--color-primary-200,#bfdbfe); color:var(--color-primary-700,#1d4ed8); font-size:var(--font-size-sm); }
    .nct-tabs { display:flex; flex-wrap:wrap; gap:var(--spacing-2); margin-bottom:var(--spacing-4); }
    .nct-tab { padding:var(--spacing-2) var(--spacing-4); border:1px solid var(--color-border-default); border-radius:var(--radius-pill,999px); background:var(--color-background-elevated); color:var(--color-text-secondary); font-size:var(--font-size-sm); font-weight:var(--font-weight-medium); cursor:pointer; }
    .nct-tab--active { background:var(--color-primary-500,#2563eb); color:#fff; border-color:var(--color-primary-500,#2563eb); }
    .nct-card { padding:var(--spacing-5); border-radius:var(--radius-lg); box-shadow:var(--shadow-sm); max-width:56rem; }
    .nct-balance-status { margin-bottom:var(--spacing-3); }
    .nct-badge { display:inline-block; padding:0.15rem 0.6rem; border-radius:var(--radius-pill,999px); font-size:var(--font-size-xs); font-weight:var(--font-weight-semibold); }
    .nct-badge--ok { background:var(--color-success-100,#dcfce7); color:var(--color-success-700,#15803d); }
    .nct-badge--ko { background:var(--color-danger-100,#fee2e2); color:var(--color-danger-700,#b91c1c); }
    .nct-alert-banner { display:flex; align-items:flex-start; gap:var(--spacing-2); margin-bottom:var(--spacing-4); padding:var(--spacing-3) var(--spacing-4); border-radius:var(--radius-md); font-size:var(--font-size-sm); background:var(--color-warning-50,#fffbeb); border:1px solid var(--color-warning-200,#fde68a); color:var(--color-warning-800,#92400e); }
    .nct-warn-list { margin:0.25rem 0 0; padding-left:1.1rem; }
    .nct-warn-list li { margin:0.15rem 0; }
    .nct-section { font-size:var(--font-size-sm); font-weight:var(--font-weight-bold); text-transform:uppercase; letter-spacing:0.04em; color:var(--color-text-tertiary); margin:var(--spacing-4) 0 var(--spacing-2); }
    .nct-hint { font-size:var(--font-size-sm); color:var(--color-text-secondary); margin:0 0 var(--spacing-3); }
    .nct-table { width:100%; border-collapse:collapse; margin-bottom:var(--spacing-2); }
    .nct-th-label, .nct-th-amount { font-size:var(--font-size-xs); text-transform:uppercase; letter-spacing:0.04em; color:var(--color-text-tertiary); padding:var(--spacing-2) var(--spacing-3); border-bottom:1px solid var(--color-border-subtle); }
    .nct-th-amount { text-align:right; }
    .nct-td-label { padding:var(--spacing-2) var(--spacing-3); color:var(--color-text-secondary); }
    .nct-td-amount { padding:var(--spacing-2) var(--spacing-3); text-align:right; font-variant-numeric:tabular-nums; font-weight:var(--font-weight-medium); }
    .nct-td-prev { color:var(--color-text-tertiary); }
    .nct-row--subtotal > td { font-weight:var(--font-weight-bold); color:var(--color-text-primary); border-top:1px solid var(--color-border-subtle); background:var(--color-background-subtle); }
    .nct-row--reconciliation > td { font-style:italic; color:var(--color-warning-700,#b45309); background:var(--color-warning-50,#fffbeb); }
    .nct-year-error { display:block; font-size:var(--font-size-xs); color:var(--color-danger-600,#dc2626); margin-top:0.2rem; }
  `
})
export class NctStatementsComponent implements OnInit {
  readonly loc_ui_tern_bilan_equilibre_8e3fbf = $localize`:@@ui.tern.bilan.equilibre.8e3fbf:Bilan équilibré`;
  readonly loc_ui_tern_flux_de_tresorerie_rapproche_e8cb8d = $localize`:@@ui.tern.flux.de.tresorerie.rapproche.e8cb8d:Flux de trésorerie rapproché`;
  private readonly api = inject(AccountingService);
  private readonly decimal = new DecimalPipe(inject(LOCALE_ID));

  /** Badge d'écart du bilan : une seule phrase traduisible, montant au format du pipe number. */
  unbalancedLabel(difference: number | null | undefined): string {
    const amount = this.decimal.transform(difference, '1.3-3');
    return $localize`:@@accounting.nct-statements.non.equilibre.ecart:Non équilibré (écart : ${amount}:amount: TND)`;
  }

  /** Badge d'écart du tableau de flux. */
  unreconciledLabel(gap: number | null | undefined): string {
    const amount = this.decimal.transform(gap, '1.3-3');
    return $localize`:@@accounting.nct-statements.flux.non.rapproche.ecart:Flux non rapproché (écart : ${amount}:amount: TND)`;
  }

  fiscalYear = new Date().getFullYear();
  exportDialogVisible = false;
  overridesDialogVisible = false;
  readonly data = signal<NctFinancialStatementsDto | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly tab = signal<NctTab>('bilan');
  /** Exposé au template pour la mise en évidence de la ligne de réconciliation des flux (BUG #004). */
  readonly reconciliationCode = CASH_FLOW_RECONCILIATION_CODE;
  /** Montant de la ligne de réconciliation CFECART (écart flux) — alimente le badge de l'onglet Flux (T21). */
  readonly cashFlowGap = computed(() => {
    const lines = this.data()?.cashFlow.lines ?? [];
    const gap = lines.find(l => l.code === CASH_FLOW_RECONCILIATION_CODE);
    return gap ? gap.amount : 0;
  });

  private readonly loadRequests$ = new Subject<number>();

  constructor() {
    this.loadRequests$
      .pipe(
        switchMap(year =>
          this.api.getNctStatements(year).pipe(
            catchError(() => of<NctStatementsApiResponse>({ success: false, error: 'Erreur réseau' }))
          )
        ),
        takeUntilDestroyed()
      )
      .subscribe(res => {
        this.loading.set(false);
        if (res.success && res.data) this.data.set(res.data);
        else this.error.set(res.error ?? $localize`:@@ui.tern.erreur.ab546c:Erreur`);
      });
  }

  ngOnInit(): void {
    this.load();
  }

  openExportDialog(): void {
    if (!this.data()) return;
    this.exportDialogVisible = true;
  }

  onYearInputChange(value: number): void {
    this.fiscalYear = value;
  }

  isYearValid(): boolean {
    const y = Number(this.fiscalYear);
    return Number.isInteger(y) && y >= MIN_FISCAL_YEAR && y <= MAX_FISCAL_YEAR;
  }

  private clampYear(y: number): number {
    return Math.min(MAX_FISCAL_YEAR, Math.max(MIN_FISCAL_YEAR, Math.floor(Number(y)) || new Date().getFullYear()));
  }

  load(): void {
    const y = this.clampYear(this.fiscalYear);
    this.fiscalYear = y;
    this.loading.set(true);
    this.error.set(null);
    this.loadRequests$.next(y);
  }

  exportPdf(): void {
    if (!this.data()) return;
    this.api.exportNctStatementsPdf(this.fiscalYear).subscribe({
      next: blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `liasse_nct_${this.fiscalYear}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      },
      error: () => this.error.set("L'export PDF a échoué.")
    });
  }

  // Référence utilisée par le template (évite l'avertissement d'import non utilisé).
  protected trackLine(_: number, line: NctLineDto): string {
    return line.code;
  }
}
