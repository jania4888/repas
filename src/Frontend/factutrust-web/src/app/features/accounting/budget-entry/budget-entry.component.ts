/// <reference types="@angular/localize" />
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { AccountingStatusBannerComponent } from '../shared/accounting-status-banner.component';
import { ToastService } from '@core/services/toast.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { AuthService } from '@core/services/auth.service';
import { canValidateAccountingEntries } from '@core/utils/accounting-access';
import {
  AccountingService,
  BudgetPostKind,
  BudgetYearGridDto,
  BudgetYearStatus,
  SaveBudgetLineRequest
} from '../services/accounting.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';

interface EditableBudgetRow {
  budgetPostId: string;
  code: string;
  label: string;
  kind: BudgetPostKind;
  /** Valeurs de la version modifiable (index 0 = janvier). */
  months: number[];
  /** Référence figée : budget initial (affichée après validation). */
  initialMonths: number[];
}

const MONTH_LABELS = [$localize`:@@accounting.budget-entry.ts.jan.efed3690:Jan`, $localize`:@@accounting.budget-entry.ts.fev.7b8852ec:Fév`, $localize`:@@accounting.budget-entry.ts.mar.c4ba0822:Mar`, $localize`:@@accounting.budget-entry.ts.avr.d648a3b7:Avr`, $localize`:@@accounting.budget-entry.ts.mai.afe526a6:Mai`, $localize`:@@accounting.budget-entry.ts.juin.8b1e84b6:Juin`, $localize`:@@accounting.budget-entry.ts.juil.190b5d60:Juil`, $localize`:@@accounting.budget-entry.ts.aout.460b6696:Août`, $localize`:@@accounting.budget-entry.ts.sep.fdd289e3:Sep`, $localize`:@@accounting.budget-entry.ts.oct.51327aef:Oct`, $localize`:@@accounting.budget-entry.ts.nov.bb9bfefd:Nov`, $localize`:@@accounting.budget-entry.ts.dec.2bc2249a:Déc`];

@Component({
  selector: 'app-budget-entry',
  standalone: true,
  imports: [CommonModule, FormsModule, TableModule, PageHeaderComponent, ButtonComponent, AccountingStatusBannerComponent],
  template: `
    <app-page-header title="Saisie des budgets" i18n-title="@@accounting.budget-entry.saisie.des.budgets.0b3e253e" subtitle="Budgets annuels mensualisés par poste — versions Initial puis Révisé après validation" i18n-subtitle="@@accounting.budget-entry.budgets.annuels.mensualises.par.poste.ve.c818a7b7" />

    <app-accounting-status-banner variant="error" [message]="error() ?? ''" />

    <div class="card be-toolbar">
      <div class="be-year">
        <button type="button" class="be-year-btn" (click)="changeYear(-1)" [disabled]="busy()" aria-label="Exercice précédent" i18n-aria-label="@@accounting.budget-entry.exercice.precedent.b34f8172"><i class="pi pi-chevron-left"></i></button>
        <span class="be-year-value" i18n="@@accounting.budget-entry.exercice.019abec6">Exercice {{ fiscalYear() }}</span>
        <button type="button" class="be-year-btn" (click)="changeYear(1)" [disabled]="busy()" aria-label="Exercice suivant" i18n-aria-label="@@accounting.budget-entry.exercice.suivant.b90eb269"><i class="pi pi-chevron-right"></i></button>
      </div>

      @if (grid(); as g) {
        <span class="be-badge" [class.be-badge-draft]="g.status === 0" [class.be-badge-validated]="g.status === 1">
          {{ g.status === 1 ? loc_ui_tern_initial_valide_39455a : loc_ui_tern_brouillon_budgetaire_3977e5 }}
        </span>
        @if (g.status === 1) {
          <span class="be-validated-info" i18n="@@accounting.budget-entry.valide.le.par.vous.modifiez.le.budget.re.1dd95663">
            validé le {{ g.validatedAt | date : 'shortDate' }} par {{ g.validatedBy }} — vous modifiez le <strong>budget révisé</strong>
          </span>
        }
      }

      <div class="be-actions">
        @if (grid()?.status === 0 && canValidate()) {
          <app-button variant="secondary" icon="pi pi-lock" type="button" (click)="validateInitial()" [disabled]="busy()" i18n="@@accounting.budget-entry.valider.le.budget.initial.ec885ae3"> Valider le budget initial </app-button>
        }
        <app-button variant="primary" icon="pi pi-save" type="button" (click)="save()" [disabled]="busy() || rows().length === 0">
          {{ saving() ? loc_ui_tern_enregistrement_e7d5f2 : loc_ui_tern_enregistrer_f7c8bc }}
        </app-button>
      </div>
    </div>

    @if (distributeFor(); as row) {
      <div class="card be-distribute">
        <span i18n="@@accounting.budget-entry.repartir.un.montant.annuel.sur.lineaire.f141d51e"><ng-container>Répartir un montant annuel sur </ng-container> <strong>{{ row.code }} — {{ row.label }}</strong> (linéaire, reliquat sur décembre) :</span>
        <input type="number" class="be-inp be-dist-inp" [(ngModel)]="distributeAmount" min="0" step="0.001" placeholder="Montant annuel" i18n-placeholder="@@accounting.budget-entry.montant.annuel.7f48f8e0" />
        <button type="button" class="btn btn-primary" (click)="applyDistribution()" i18n="@@accounting.budget-entry.repartir.d7593598">Répartir</button>
        <button type="button" class="btn btn-secondary" (click)="distributeFor.set(null)" i18n="@@accounting.budget-entry.annuler.49ba3292">Annuler</button>
      </div>
    }

    <div class="card be-grid">
      <p-table [value]="rows()" [loading]="loading()" [scrollable]="true" styleClass="p-datatable-sm accounting-datatable be-table" [rowHover]="true">
        <ng-template pTemplate="header">
          <tr>
            <th scope="col" class="be-post-col" i18n="@@accounting.budget-entry.poste.86abf0cd">Poste</th>
            @for (m of monthLabels; track $index) { <th scope="col" class="be-amt">{{ m }}</th> }
            <th scope="col" class="be-amt" i18n="@@accounting.budget-entry.total.b25928c6">Total</th>
            @if (grid()?.status === 1) { <th scope="col" class="be-amt" i18n="@@accounting.budget-entry.total.initial.37fc5d14">Total initial</th> }
            <th scope="col"></th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-row>
          <tr>
            <td class="be-post-col">
              <span class="be-code">{{ row.code }}</span> {{ row.label }}
              <span class="be-kind" [class.be-kind-rev]="row.kind === 1">{{ row.kind === 0 ? 'C' : 'P' }}</span>
            </td>
            @for (m of monthLabels; track m; let i = $index) {
              <td class="be-amt">
                <input type="number" class="be-inp be-cell" [(ngModel)]="row.months[i]" min="0" step="0.001"
                  (ngModelChange)="bumpTotals()" [disabled]="busy()" />
              </td>
            }
            <td class="be-amt be-row-total">{{ rowTotal(row) | number : '1.3-3' }}</td>
            @if (grid()?.status === 1) { <td class="be-amt be-muted">{{ sum(row.initialMonths) | number : '1.3-3' }}</td> }
            <td>
              <button type="button" class="be-icon" (click)="startDistribution(row)" [disabled]="busy()" title="Répartir un montant annuel" i18n-title="@@accounting.budget-entry.repartir.un.montant.annuel.d176a745">
                <i class="pi pi-calculator"></i>
              </button>
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="footer">
          @if (rows().length > 0) {
            <tr class="be-totals-row">
              <td class="be-post-col" i18n="@@accounting.budget-entry.totaux.a1ca02f8">Totaux</td>
              @for (m of monthLabels; track m; let i = $index) {
                <td class="be-amt">{{ monthTotals()[i] | number : '1.3-3' }}</td>
              }
              <td class="be-amt">{{ grandTotal() | number : '1.3-3' }}</td>
              @if (grid()?.status === 1) { <td></td> }
              <td></td>
            </tr>
          }
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr><td [attr.colspan]="16" class="be-empty" i18n="@@accounting.budget-entry.aucun.poste.budgetaire.actif.creez.d.abord.des.p.c9d46f49">Aucun poste budgétaire actif. Créez d'abord des postes dans « Postes budgétaires ».</td></tr>
        </ng-template>
      </p-table>
    </div>
  `,
  styles: `
    .be-toolbar, .be-grid, .be-distribute { padding: var(--spacing-4); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); margin-bottom: var(--spacing-4); }
    .be-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--spacing-3); }
    .be-year { display: inline-flex; align-items: center; gap: var(--spacing-2); }
    .be-year-value { font-size: var(--font-size-md); font-weight: var(--font-weight-semibold); min-width: 9rem; text-align: center; }
    .be-year-btn { background: var(--color-background-subtle); border: 1px solid var(--color-border-default); border-radius: var(--radius-md); padding: var(--spacing-1) var(--spacing-2); cursor: pointer; color: var(--color-text-primary); }
    .be-year-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .be-badge { display: inline-block; padding: 0.15rem 0.6rem; border-radius: var(--radius-pill, 999px); font-size: var(--font-size-xs); font-weight: var(--font-weight-semibold); }
    .be-badge-draft { background: var(--color-warning-50, #fffbeb); color: var(--color-warning-700, #a16207); border: 1px solid var(--color-warning-200, #fde68a); }
    .be-badge-validated { background: var(--color-success-100, #dcfce7); color: var(--color-success-700, #15803d); }
    .be-validated-info { font-size: var(--font-size-sm); color: var(--color-text-secondary); }
    .be-actions { display: flex; gap: var(--spacing-2); margin-left: auto; }
    .be-distribute { display: flex; flex-wrap: wrap; align-items: center; gap: var(--spacing-3); border: 1px solid var(--color-primary-200, #bfdbfe); }
    .be-inp { padding: var(--spacing-1) var(--spacing-2); border: 1px solid var(--color-border-default); border-radius: var(--radius-md); background: var(--color-background-elevated); color: var(--color-text-primary); font-size: var(--font-size-sm); }
    .be-dist-inp { width: 10rem; }
    .be-cell { width: 6.2rem; text-align: right; font-variant-numeric: tabular-nums; }
    .be-post-col { min-width: 16rem; }
    .be-code { font-family: ui-monospace, monospace; font-weight: var(--font-weight-semibold); margin-right: var(--spacing-1); }
    .be-kind { display: inline-block; margin-left: var(--spacing-2); padding: 0 0.4rem; border-radius: var(--radius-sm, 4px); font-size: var(--font-size-xs); font-weight: var(--font-weight-semibold); background: var(--color-warning-50, #fffbeb); color: var(--color-warning-700, #a16207); }
    .be-kind-rev { background: var(--color-success-100, #dcfce7); color: var(--color-success-700, #15803d); }
    .be-amt { text-align: right; font-variant-numeric: tabular-nums; }
    .be-row-total { font-weight: var(--font-weight-semibold); }
    .be-muted { color: var(--color-text-tertiary); }
    .be-totals-row td { font-weight: var(--font-weight-semibold); border-top: 2px solid var(--color-border-default); }
    .be-icon { background: none; border: none; cursor: pointer; color: var(--color-text-secondary); padding: var(--spacing-1); }
    .be-icon:hover { color: var(--color-text-primary); }
    .be-icon:disabled { opacity: 0.5; cursor: not-allowed; }
    .be-empty { text-align: center; padding: var(--spacing-6); color: var(--color-text-tertiary); }
    .btn { padding: var(--spacing-2) var(--spacing-4); border-radius: var(--radius-md); font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); cursor: pointer; border: 1px solid transparent; }
    .btn-secondary { background: var(--color-background-subtle); color: var(--color-text-primary); border-color: var(--color-border-default); }
    .btn-primary { background: var(--color-primary-500, #2563eb); color: #fff; }
  `
})
export class BudgetEntryComponent implements OnInit {
  readonly loc_ui_tern_initial_valide_39455a = $localize`:@@ui.tern.initial.valide.39455a:Initial validé`;
  readonly loc_ui_tern_brouillon_budgetaire_3977e5 = $localize`:@@ui.tern.brouillon.budgetaire.3977e5:Brouillon budgétaire`;
  readonly loc_ui_tern_enregistrement_e7d5f2 = $localize`:@@ui.tern.enregistrement.e7d5f2:Enregistrement…`;
  readonly loc_ui_tern_enregistrer_f7c8bc = $localize`:@@ui.tern.enregistrer.f7c8bc:Enregistrer`;
  private readonly errors = inject(ErrorHandlerService);
  private readonly api = inject(AccountingService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly confirmationService = inject(ConfirmationService);

  readonly canValidate = computed(() => canValidateAccountingEntries(this.auth));

  readonly monthLabels = MONTH_LABELS;

  readonly fiscalYear = signal(new Date().getFullYear());
  readonly grid = signal<BudgetYearGridDto | null>(null);
  readonly rows = signal<EditableBudgetRow[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly validating = signal(false);
  readonly error = signal<string | null>(null);

  readonly distributeFor = signal<EditableBudgetRow | null>(null);
  distributeAmount: number | null = null;

  /** Les inputs mutent les lignes en place : ce tick force le recalcul des totaux. */
  private readonly totalsTick = signal(0);

  readonly monthTotals = computed<number[]>(() => {
    this.totalsTick();
    const totals = new Array<number>(12).fill(0);
    for (const row of this.rows())
      for (let i = 0; i < 12; i++) totals[i] += Number(row.months[i]) || 0;
    return totals;
  });

  readonly grandTotal = computed(() => this.monthTotals().reduce((a, b) => a + b, 0));

  ngOnInit(): void {
    this.load();
  }

  busy(): boolean {
    return this.loading() || this.saving() || this.validating();
  }

  bumpTotals(): void {
    this.totalsTick.update(t => t + 1);
  }

  sum(values: number[]): number {
    return values.reduce((a, b) => a + (Number(b) || 0), 0);
  }

  rowTotal(row: EditableBudgetRow): number {
    this.totalsTick();
    return this.sum(row.months);
  }

  changeYear(delta: number): void {
    this.fiscalYear.update(y => y + delta);
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.distributeFor.set(null);
    this.api.getBudgetYear(this.fiscalYear()).subscribe({
      next: res => {
        this.loading.set(false);
        if (!res.success || !res.data) {
          this.grid.set(null);
          this.rows.set([]);
          this.error.set(res.error ?? $localize`:@@ui.tern.erreur.de.chargement.de.la.grille.budgetai.b383de:Erreur de chargement de la grille budgétaire.`);
          return;
        }
        const g = res.data;
        this.grid.set(g);
        const editRevised = g.status === BudgetYearStatus.Validated;
        this.rows.set(g.rows.map(r => ({
          budgetPostId: r.budgetPostId,
          code: r.code,
          label: r.label,
          kind: r.kind,
          months: [...(editRevised ? r.revisedMonths : r.initialMonths)],
          initialMonths: [...r.initialMonths]
        })));
        this.bumpTotals();
      },
      error: err => {
        this.loading.set(false);
        this.error.set(this.errors.extractErrorMessage(err, $localize`:@@accounting.budget-entry.ts.erreur.reseau.lors.du.chargement.de.la.g.d3ea77ca:Erreur réseau lors du chargement de la grille budgétaire.`));
      }
    });
  }

  startDistribution(row: EditableBudgetRow): void {
    this.distributeAmount = this.sum(row.months) || null;
    this.distributeFor.set(row);
  }

  /** Répartition linéaire : montant/12 arrondi à 3 décimales, reliquat sur décembre. */
  applyDistribution(): void {
    const row = this.distributeFor();
    const amount = Number(this.distributeAmount);
    if (!row || !isFinite(amount) || amount < 0) return;
    const monthly = Math.round((amount / 12) * 1000) / 1000;
    for (let i = 0; i < 11; i++) row.months[i] = monthly;
    row.months[11] = Math.round((amount - monthly * 11) * 1000) / 1000;
    this.distributeFor.set(null);
    this.bumpTotals();
  }

  save(): void {
    if (this.busy()) return;
    const lines: SaveBudgetLineRequest[] = [];
    for (const row of this.rows())
      for (let i = 0; i < 12; i++)
        lines.push({ budgetPostId: row.budgetPostId, month: i + 1, amount: Number(row.months[i]) || 0 });
    if (lines.length === 0) return;

    this.saving.set(true);
    this.error.set(null);
    this.api.saveBudgetYear(this.fiscalYear(), lines).subscribe({
      next: res => {
        this.saving.set(false);
        if (!res.success) {
          this.error.set(res.error ?? $localize`:@@ui.tern.l.enregistrement.du.budget.a.echoue.7cabe0:L'enregistrement du budget a échoué.`);
          return;
        }
        this.toast.add({ severity: 'success', summary: $localize`:@@budget-entry.component.summary.Budget_enregistr:Budget enregistré`, detail: $localize`:@@accounting.budget-entry.ts.exercice.fiscalyear.ed73b957:Exercice ${this.fiscalYear()}:fiscalYear:`, life: 4000 });
        this.load();
      },
      error: err => {
        this.saving.set(false);
        this.error.set(this.errors.extractErrorMessage(err, $localize`:@@accounting.budget-entry.ts.erreur.reseau.lors.de.l.enregistrement.d.b976f45a:Erreur réseau lors de l'enregistrement du budget.`));
      }
    });
  }

  validateInitial(): void {
    if (!this.canValidate()) return;
    if (this.busy()) return;
    this.confirmationService.confirm({
      message:
        $localize`:@@accounting.budget-entry.ts.valider.le.budget.initial.fiscalyear.le.0ce3d2a0:Valider le budget initial ${this.fiscalYear()}:fiscalYear: ?\n\nLe budget initial sera figé (copié vers le budget révisé, seule version modifiable ensuite). Cette action est irréversible.`,
      header: $localize`:@@accounting.budget-entry.ts.confirmation.3424edc2:Confirmation`,
      acceptLabel: $localize`:@@budget-entry.component.acceptLabel.Valider:Valider`,
      rejectLabel: $localize`:@@budget-entry.component.rejectLabel.Annuler:Annuler`,
      accept: () => {
        this.validating.set(true);
        this.error.set(null);
        this.api.validateInitialBudget(this.fiscalYear()).subscribe({
          next: res => {
            this.validating.set(false);
            if (!res.success) {
              this.error.set(res.error ?? $localize`:@@ui.tern.la.validation.du.budget.initial.a.echoue.d3cadb:La validation du budget initial a échoué.`);
              return;
            }
            this.toast.add({ severity: 'success', summary: $localize`:@@budget-entry.component.summary.Budget_initial_v:Budget initial validé`, detail: $localize`:@@accounting.budget-entry.ts.exercice.fiscalyear.ed73b957:Exercice ${this.fiscalYear()}:fiscalYear:`, life: 4000 });
            this.load();
          },
          error: err => {
            this.validating.set(false);
            this.error.set(this.errors.extractErrorMessage(err, $localize`:@@accounting.budget-entry.ts.erreur.reseau.lors.de.la.validation.du.b.d1b484aa:Erreur réseau lors de la validation du budget initial.`));
          }
        });
      }
    });
  }
}
