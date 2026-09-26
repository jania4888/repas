import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { TableModule } from 'primeng/table';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { AccountingStatusBannerComponent } from '../shared/accounting-status-banner.component';
import { AccountingFilterBarComponent } from '../shared/accounting-filter-bar.component';
import { AccountingService, CreateLoanRequest, LoanDto } from '../services/accounting.service';
import { todayLocalYmd } from '../shared/accounting-date-utils';
import { ErrorHandlerService } from '@core/services/error-handler.service';

/**
 * Registre des emprunts : liste + création (l'échéancier est généré côté serveur à la création).
 * Portée ÉDITION — aucune échéance n'est comptabilisée automatiquement.
 */
@Component({
  selector: 'app-loans-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    TableModule,
    PageHeaderComponent,
    ButtonComponent,
    AccountingStatusBannerComponent,
    AccountingFilterBarComponent
  ],
  template: `
    <app-page-header
      title="Emprunts" i18n-title="Emprunts"
      subtitle="Registre des emprunts et tableaux d'amortissement" />

    <div class="ln-notice" role="note">
      <i class="pi pi-info-circle" aria-hidden="true"></i>
      <span>Échéanciers <strong i18n="@@accounting.loans.indicatifs.5a70502c">indicatifs</strong> : les échéances ne sont pas comptabilisées automatiquement.</span>
    </div>

    <div class="card accounting-filters-card">
      <app-accounting-filter-bar ariaLabel="Recherche d'emprunt">
        <div accountingFilterFields class="ln-fields">
          <div class="accounting-filter-field">
            <label class="accounting-filter-label" for="ln-search" i18n="@@accounting.loans.recherche.787b5492">Recherche</label>
            <input id="ln-search" type="text" [(ngModel)]="search" class="accounting-filter-input"
              placeholder="Numéro, libellé, prêteur" i18n-placeholder="Numéro, libellé, prêteur" />
          </div>
        </div>
        <div accountingFilterActions>
          <app-button variant="secondary" icon="pi pi-refresh" type="button"
            (click)="load()" [disabled]="busy()" ariaLabel="Actualiser le registre des emprunts" i18n="@@accounting.loans.actualiser.9d3b2a7d">Actualiser</app-button>
          <app-button variant="primary" icon="pi pi-plus" type="button"
            (click)="showForm.set(!showForm())" [disabled]="busy()" ariaLabel="Créer un emprunt" i18n="@@accounting.loans.nouvel.emprunt.9ef02dcf">Nouvel emprunt</app-button>
        </div>
      </app-accounting-filter-bar>
    </div>

    <app-accounting-status-banner variant="error" [message]="error() ?? ''" [showRetry]="!!error()" retryLabel="Réessayer" (retry)="load()" />

    @if (successMessage(); as msg) {
      <div class="ln-success" role="status"><i class="pi pi-check-circle" aria-hidden="true"></i><span>{{ msg }}</span></div>
    }

    @if (showForm()) {
      <div class="card ln-form-card">
        <h2 class="ln-form-title" i18n="@@accounting.loans.nouvel.emprunt.9ef02dcf">Nouvel emprunt</h2>
        <div class="ln-form-grid">
          <div class="ln-field">
            <label class="accounting-filter-label" for="ln-label" i18n="@@accounting.loans.libelle.f5485bba">Libellé</label>
            <input id="ln-label" type="text" class="accounting-filter-input" [(ngModel)]="form.label" [disabled]="busy()" />
          </div>
          <div class="ln-field">
            <label class="accounting-filter-label" for="ln-lender" i18n="@@accounting.loans.preteur.3b469653">Prêteur</label>
            <input id="ln-lender" type="text" class="accounting-filter-input" [(ngModel)]="form.lenderName" [disabled]="busy()" />
          </div>
          <div class="ln-field">
            <label class="accounting-filter-label" for="ln-principal" i18n="@@accounting.loans.capital.emprunte.a40c562c">Capital emprunté</label>
            <input id="ln-principal" type="number" min="0" step="0.001" class="accounting-filter-input" [(ngModel)]="form.principal" [disabled]="busy()" />
          </div>
          <div class="ln-field">
            <label class="accounting-filter-label" for="ln-rate" i18n="@@accounting.loans.taux.annuel.9de94a3b">Taux annuel (%)</label>
            <input id="ln-rate" type="number" min="0" max="100" step="0.01" class="accounting-filter-input" [(ngModel)]="form.annualRatePercent" [disabled]="busy()" />
          </div>
          <div class="ln-field">
            <label class="accounting-filter-label" for="ln-start" i18n="@@accounting.loans.date.de.depart.27579c25">Date de départ</label>
            <input id="ln-start" type="date" class="accounting-filter-input" [(ngModel)]="form.startDate" [disabled]="busy()" />
          </div>
          <div class="ln-field">
            <label class="accounting-filter-label" for="ln-count" i18n="@@accounting.loans.nombre.d.echeances.a343d39c">Nombre d'échéances</label>
            <input id="ln-count" type="number" min="1" max="600" class="accounting-filter-input" [(ngModel)]="form.installmentCount" [disabled]="busy()" />
          </div>
          <div class="ln-field">
            <label class="accounting-filter-label" for="ln-periodicity" i18n="@@accounting.loans.periodicite.0eb1b4d4">Périodicité</label>
            <select id="ln-periodicity" class="accounting-filter-input" [(ngModel)]="form.periodicity" [disabled]="busy()">
              <option [ngValue]="0" i18n="@@accounting.loans.mensuelle.15af1be3">Mensuelle</option>
              <option [ngValue]="1" i18n="@@accounting.loans.trimestrielle.9379d384">Trimestrielle</option>
              <option [ngValue]="2" i18n="@@accounting.loans.semestrielle.367a7ab5">Semestrielle</option>
              <option [ngValue]="3" i18n="@@accounting.loans.annuelle.0e25612c">Annuelle</option>
            </select>
          </div>
          <div class="ln-field">
            <label class="accounting-filter-label" for="ln-method" i18n="@@accounting.loans.amortissement.403d7802">Amortissement</label>
            <select id="ln-method" class="accounting-filter-input" [(ngModel)]="form.method" [disabled]="busy()">
              <option [ngValue]="0" i18n="@@accounting.loans.annuite.constante.c6559110">Annuité constante</option>
              <option [ngValue]="1" i18n="@@accounting.loans.amortissement.constant.ccbefc00">Amortissement constant</option>
            </select>
          </div>
          <div class="ln-field">
            <label class="accounting-filter-label" for="ln-acc-loan" i18n="@@accounting.loans.compte.emprunt.8feb2c85">Compte emprunt</label>
            <input id="ln-acc-loan" type="text" class="accounting-filter-input" [(ngModel)]="form.loanAccountNumber" [disabled]="busy()" />
          </div>
          <div class="ln-field">
            <label class="accounting-filter-label" for="ln-acc-int" i18n="@@accounting.loans.compte.interets.21d9f624">Compte intérêts</label>
            <input id="ln-acc-int" type="text" class="accounting-filter-input" [(ngModel)]="form.interestAccountNumber" [disabled]="busy()" />
          </div>
          <div class="ln-field">
            <label class="accounting-filter-label" for="ln-acc-bank" i18n="@@accounting.loans.compte.tresorerie.2cc84a82">Compte trésorerie</label>
            <input id="ln-acc-bank" type="text" class="accounting-filter-input" [(ngModel)]="form.bankAccountNumber" [disabled]="busy()" />
          </div>
        </div>
        <div class="ln-form-actions">
          <app-button variant="secondary" type="button" (click)="showForm.set(false)" [disabled]="busy()" ariaLabel="Annuler" i18n="@@accounting.loans.annuler.49ba3292">Annuler</app-button>
          <app-button variant="primary" icon="pi pi-check" type="button"
            (click)="create()" [disabled]="busy() || !canSubmit()" ariaLabel="Créer l'emprunt et générer l'échéancier">
            {{ creating() ? 'Création…' : "Créer et générer l'échéancier" }}
          </app-button>
        </div>
      </div>
    }

    <div class="card ln-table-card">
      <p-table [value]="loans()" [loading]="loading()" [rowHover]="true"
        styleClass="p-datatable-sm accounting-datatable">
        <ng-template pTemplate="header">
          <tr>
            <th scope="col" i18n="@@accounting.loans.n.754e6095">N°</th>
            <th scope="col" i18n="@@accounting.loans.libelle.f5485bba">Libellé</th>
            <th scope="col" i18n="@@accounting.loans.preteur.3b469653">Prêteur</th>
            <th scope="col" class="ln-num" i18n="@@accounting.loans.capital.2bd8d265">Capital</th>
            <th scope="col" class="ln-num" i18n="@@accounting.loans.taux.18bc95b8">Taux</th>
            <th scope="col" class="ln-num" i18n="@@accounting.loans.echeances.c2079408">Échéances</th>
            <th scope="col" class="ln-num" i18n="@@accounting.loans.cout.du.credit.2f8c4b43">Coût du crédit</th>
            <th scope="col" i18n="@@accounting.loans.statut.659499f3">Statut</th>
            <th scope="col"></th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-l>
          <tr>
            <td data-label="N°"><span class="ln-code">{{ l.loanNumber }}</span></td>
            <td data-label="Libellé">{{ l.label }}</td>
            <td data-label="Prêteur">{{ l.lenderName }}</td>
            <td data-label="Capital" class="ln-num">{{ l.principal | number : '1.3-3' }}</td>
            <td data-label="Taux" class="ln-num">{{ l.annualRatePercent | number : '1.2-4' }} %</td>
            <td data-label="Échéances" class="ln-num">{{ l.installmentCount }}</td>
            <td data-label="Coût du crédit" class="ln-num">{{ l.totalInterest | number : '1.3-3' }}</td>
            <td data-label="Statut">{{ statusLabel(l) }}</td>
            <td>
              <a class="ln-link" [routerLink]="['/accounting/loans', l.id]">Échéancier <i class="pi pi-angle-right" aria-hidden="true"></i></a>
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr><td colspan="9" style="text-align:center;padding:2rem" i18n="@@accounting.loans.aucun.emprunt.enregistre.59e3f20f">Aucun emprunt enregistré.</td></tr>
        </ng-template>
      </p-table>
    </div>
  `,
  styles: `
    @use '../shared/accounting-layout';
    .ln-fields { display:flex; flex-wrap:wrap; align-items:flex-end; gap:var(--spacing-4); }
    .ln-num { text-align:right; font-variant-numeric:tabular-nums; }
    .ln-code { font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-weight:500; }
    .ln-table-card, .ln-form-card { padding:var(--spacing-5); }
    .ln-form-title { margin:0 0 var(--spacing-4); font-size:var(--font-size-md); font-weight:var(--font-weight-semibold); }
    .ln-form-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:var(--spacing-4); }
    .ln-field { display:flex; flex-direction:column; gap:var(--spacing-2); min-width:0; }
    .ln-form-actions { display:flex; justify-content:flex-end; gap:var(--spacing-2); margin-top:var(--spacing-4); padding-top:var(--spacing-4); border-top:1px solid var(--color-border-subtle); }
    .ln-link { color:var(--color-primary-500); text-decoration:none; font-weight:500; white-space:nowrap; }
    .ln-link:hover { text-decoration:underline; }
    .ln-notice {
      display:flex; align-items:center; gap:var(--spacing-2); margin-bottom:var(--spacing-4);
      padding:var(--spacing-3) var(--spacing-4); border-radius:var(--radius-md);
      background:var(--color-background-subtle); border:1px solid var(--color-border-subtle);
      font-size:var(--font-size-sm); color:var(--color-text-secondary);
    }
    .ln-success {
      display:flex; align-items:center; gap:var(--spacing-2); margin-bottom:var(--spacing-4);
      padding:var(--spacing-3) var(--spacing-4); border-radius:var(--radius-md);
      background:var(--color-success-50,#f0fdf4); border:1px solid var(--color-success-200,#bbf7d0);
      color:var(--color-success-700,#15803d); font-weight:var(--font-weight-medium);
    }
  `
})
export class LoansListComponent implements OnInit {
  private readonly errors = inject(ErrorHandlerService);
  private readonly api = inject(AccountingService);
  private readonly router = inject(Router);

  search = '';
  readonly loans = signal<LoanDto[]>([]);
  readonly error = signal<string | null>(null);
  readonly loading = signal(false);
  readonly creating = signal(false);
  readonly showForm = signal(false);
  readonly successMessage = signal<string | null>(null);

  form: CreateLoanRequest = this.emptyForm();

  busy(): boolean {
    return this.loading() || this.creating();
  }

  canSubmit(): boolean {
    return !!this.form.label.trim()
      && !!this.form.lenderName.trim()
      && this.form.principal > 0
      && this.form.installmentCount >= 1;
  }

  statusLabel(loan: LoanDto): string {
    switch (loan.status) {
      case 1: return 'Remboursé';
      case 2: return 'Annulé';
      default: return 'Actif';
    }
  }

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.error.set(null);
    this.loading.set(true);
    this.api.getLoans(1, 100, this.search.trim() || undefined).subscribe({
      next: res => {
        this.loading.set(false);
        if (res.success && res.data) this.loans.set(res.data.items);
        else this.error.set(res.error ?? 'Erreur');
      },
      error: err => {
        this.loading.set(false);
        this.error.set(this.errors.extractErrorMessage(err, 'Erreur réseau'));
      }
    });
  }

  create(): void {
    if (!this.canSubmit() || this.busy()) return;
    this.error.set(null);
    this.successMessage.set(null);
    this.creating.set(true);
    this.api.createLoan(this.form).subscribe({
      next: res => {
        this.creating.set(false);
        if (res.success && res.data) {
          this.successMessage.set('Emprunt créé et échéancier généré.');
          this.showForm.set(false);
          this.form = this.emptyForm();
          this.router.navigate(['/accounting/loans', res.data]);
        } else {
          this.error.set(res.error ?? 'La création a échoué.');
        }
      },
      error: err => {
        this.creating.set(false);
        this.error.set(this.errors.extractErrorMessage(err, 'Erreur réseau lors de la création.'));
      }
    });
  }

  private emptyForm(): CreateLoanRequest {
    return {
      label: '',
      lenderName: '',
      principal: 0,
      annualRatePercent: 0,
      startDate: todayLocalYmd(),
      installmentCount: 12,
      periodicity: 0,
      method: 0,
      loanAccountNumber: '164',
      interestAccountNumber: '651',
      bankAccountNumber: '532'
    };
  }
}
