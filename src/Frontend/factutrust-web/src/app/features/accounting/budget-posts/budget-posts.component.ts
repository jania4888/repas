import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { AccountingStatusBannerComponent } from '../shared/accounting-status-banner.component';
import { AccountingTableActionsComponent } from '../shared/accounting-table-actions.component';
import { ToastService } from '@core/services/toast.service';
import { AccountingService, BudgetPostDto, BudgetPostKind } from '../services/accounting.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';

interface BudgetPostForm {
  id: string | null;
  code: string;
  label: string;
  kind: BudgetPostKind;
  accountPrefixes: string;
  displayOrder: number;
}

@Component({
  selector: 'app-budget-posts',
  standalone: true,
  imports: [CommonModule, FormsModule, TableModule, PageHeaderComponent, ButtonComponent, AccountingStatusBannerComponent, AccountingTableActionsComponent],
  template: `
    <app-page-header title="Postes budgétaires" i18n-title="Postes budgétaires" subtitle="Regroupements de comptes (par préfixes) servant à la saisie des budgets et au suivi réalisé/budget" />

    <app-accounting-status-banner variant="error" [message]="error() ?? ''" />

    <div class="card bp-toolbar">
      <app-button variant="primary" icon="pi pi-plus" type="button" (click)="startCreate()" [disabled]="loading()" i18n="@@accounting.budget-posts.nouveau.poste.03005c4d">Nouveau poste</app-button>
    </div>

    @if (form(); as f) {
      <div class="card bp-form">
        <h3 class="bp-form-title">{{ f.id ? 'Modifier le poste' : 'Nouveau poste budgétaire' }}</h3>
        <div class="bp-fields">
          <div class="bp-field"><label class="bp-lbl" i18n="@@accounting.budget-posts.code.adac6937">Code</label><input class="bp-inp" [(ngModel)]="f.code" [disabled]="!!f.id" placeholder="Ex. 613" i18n-placeholder="Ex. 613" /></div>
          <div class="bp-field bp-grow"><label class="bp-lbl" i18n="@@accounting.budget-posts.libelle.f5485bba">Libellé</label><input class="bp-inp" [(ngModel)]="f.label" placeholder="Ex. Locations et charges locatives" i18n-placeholder="Ex. Locations et charges locatives" /></div>
          <div class="bp-field"><label class="bp-lbl" i18n="@@accounting.budget-posts.sens.55928a79">Sens</label>
            <select class="bp-inp" [(ngModel)]="f.kind">
              <option [ngValue]="0" i18n="@@accounting.budget-posts.charges.cfc370a2">Charges</option>
              <option [ngValue]="1" i18n="@@accounting.budget-posts.produits.48000473">Produits</option>
            </select>
          </div>
          <div class="bp-field"><label class="bp-lbl" i18n="@@accounting.budget-posts.prefixes.de.comptes.255c5fc5">Préfixes de comptes</label>
            <input class="bp-inp" [(ngModel)]="f.accountPrefixes" placeholder="Ex. 61;62" i18n-placeholder="Ex. 61;62" />
          </div>
          <div class="bp-field"><label class="bp-lbl" i18n="@@accounting.budget-posts.ordre.5c32e631">Ordre</label><input type="number" class="bp-inp bp-narrow" [(ngModel)]="f.displayOrder" min="0" /></div>
          <div class="bp-form-actions">
            <app-button variant="secondary" size="sm" type="button" (click)="form.set(null)" [disabled]="saving()" i18n="@@accounting.budget-posts.annuler.49ba3292">Annuler</app-button>
            <app-button variant="primary" size="sm" type="button" (click)="save()" [disabled]="saving() || !f.code.trim() || !f.label.trim() || !f.accountPrefixes.trim()">
              {{ saving() ? 'Enregistrement…' : 'Enregistrer' }}
            </app-button>
          </div>
        </div>
        <p class="bp-help" i18n="@@accounting.budget-posts.prefixes.separes.par.1.a.8.chiffres.chacun.le.re.2912a10c">Préfixes séparés par « ; » (1 à 8 chiffres chacun). Le réalisé agrège les comptes commençant par ces préfixes ; en cas de chevauchement entre postes, le préfixe le plus long gagne.</p>
      </div>
    }

    <div class="card bp-list">
      <p-table [value]="posts()" [loading]="loading()" styleClass="p-datatable-sm accounting-datatable" [rowHover]="true">
        <ng-template pTemplate="header">
          <tr><th scope="col" i18n="@@accounting.budget-posts.code.adac6937">Code</th><th scope="col" i18n="@@accounting.budget-posts.libelle.f5485bba">Libellé</th><th scope="col" i18n="@@accounting.budget-posts.sens.55928a79">Sens</th><th scope="col" i18n="@@accounting.budget-posts.prefixes.f6779ef9">Préfixes</th><th scope="col" i18n="@@accounting.budget-posts.ordre.5c32e631">Ordre</th><th scope="col" i18n="@@accounting.budget-posts.actif.2eb75f84">Actif</th><th scope="col" i18n="@@accounting.budget-posts.actions.c3cd636a">Actions</th></tr>
        </ng-template>
        <ng-template pTemplate="body" let-p>
          <tr [class.bp-inactive]="!p.isActive">
            <td class="bp-mono">{{ p.code }}</td>
            <td>{{ p.label }}</td>
            <td>
              <span class="bp-badge" [class.bp-badge-expense]="p.kind === 0" [class.bp-badge-revenue]="p.kind === 1">
                {{ p.kind === 0 ? 'Charges' : 'Produits' }}
              </span>
            </td>
            <td class="bp-mono">{{ p.accountPrefixes }}</td>
            <td>{{ p.displayOrder }}</td>
            <td>{{ p.isActive ? 'Oui' : 'Non' }}</td>
            <td>
              <app-accounting-table-actions>
                <app-button variant="ghost" size="sm" icon="pi-pencil" [iconOnly]="true" [iconAlwaysVisible]="true"
                  type="button" (click)="startEdit(p)" ariaLabel="Modifier" />
                <app-button variant="ghost" size="sm"
                  [icon]="p.isActive ? 'pi-eye-slash' : 'pi-eye'"
                  [iconOnly]="true" [iconAlwaysVisible]="true"
                  type="button" (click)="toggle(p)"
                  [attr.aria-label]="p.isActive ? 'Désactiver' : 'Activer'" />
              </app-accounting-table-actions>
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage"><tr><td colspan="7" class="bp-empty" i18n="@@accounting.budget-posts.aucun.poste.budgetaire.1498bea7">Aucun poste budgétaire.</td></tr></ng-template>
      </p-table>
    </div>
  `,
  styles: `
    .bp-toolbar, .bp-form, .bp-list { padding: var(--spacing-4); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); margin-bottom: var(--spacing-4); }
    .bp-toolbar { display: flex; gap: var(--spacing-3); }
    .bp-form-title { margin: 0 0 var(--spacing-3); font-size: var(--font-size-md); font-weight: var(--font-weight-semibold); }
    .bp-fields { display: flex; flex-wrap: wrap; gap: var(--spacing-3); align-items: flex-end; }
    .bp-field { display: flex; flex-direction: column; gap: var(--spacing-1); min-width: 8rem; }
    .bp-grow { flex: 1 1 14rem; }
    .bp-narrow { max-width: 6rem; }
    .bp-lbl { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--color-text-primary); }
    .bp-inp { padding: var(--spacing-2) var(--spacing-3); border: 1px solid var(--color-border-default); border-radius: var(--radius-md); background: var(--color-background-elevated); color: var(--color-text-primary); font-size: var(--font-size-sm); width: 100%; }
    .bp-form-actions { display: flex; gap: var(--spacing-2); margin-left: auto; align-items: center; }
    .bp-help { margin: var(--spacing-3) 0 0; font-size: var(--font-size-sm); color: var(--color-text-secondary); }
    .bp-mono { font-family: ui-monospace, monospace; }
    .bp-inactive { opacity: 0.6; }
    .bp-badge { display: inline-block; padding: 0.15rem 0.55rem; border-radius: var(--radius-pill, 999px); font-size: var(--font-size-xs); font-weight: var(--font-weight-semibold); }
    .bp-badge-expense { background: var(--color-warning-50, #fffbeb); color: var(--color-warning-700, #a16207); border: 1px solid var(--color-warning-200, #fde68a); }
    .bp-badge-revenue { background: var(--color-success-100, #dcfce7); color: var(--color-success-700, #15803d); }
    .bp-empty { text-align: center; padding: var(--spacing-6); color: var(--color-text-tertiary); }
  `
})
export class BudgetPostsComponent implements OnInit {
  private readonly errors = inject(ErrorHandlerService);
  private readonly api = inject(AccountingService);
  private readonly toast = inject(ToastService);

  readonly posts = signal<BudgetPostDto[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly form = signal<BudgetPostForm | null>(null);

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.getBudgetPosts(true).subscribe({
      next: res => {
        this.loading.set(false);
        if (res.success && res.data) this.posts.set(res.data);
        else this.error.set(res.error ?? 'Erreur de chargement des postes budgétaires.');
      },
      error: err => { this.loading.set(false); this.error.set(this.errors.extractErrorMessage(err, 'Erreur réseau')); }
    });
  }

  startCreate(): void {
    const nextOrder = Math.max(0, ...this.posts().map(p => p.displayOrder)) + 10;
    this.form.set({ id: null, code: '', label: '', kind: 0, accountPrefixes: '', displayOrder: nextOrder });
  }

  startEdit(p: BudgetPostDto): void {
    this.form.set({ id: p.id, code: p.code, label: p.label, kind: p.kind, accountPrefixes: p.accountPrefixes, displayOrder: p.displayOrder });
  }

  save(): void {
    const f = this.form();
    if (!f || this.saving()) return;
    this.saving.set(true);
    const done = (ok: boolean, err?: string) => {
      this.saving.set(false);
      if (ok) { this.toast.add({ severity: 'success', summary: 'Poste enregistré', detail: f.code, life: 4000 }); this.form.set(null); this.load(); }
      else this.error.set(err ?? 'Erreur');
    };
    const body = { label: f.label.trim(), kind: f.kind, accountPrefixes: f.accountPrefixes.trim(), displayOrder: f.displayOrder };
    if (f.id) {
      this.api.updateBudgetPost(f.id, body).subscribe({ next: r => done(r.success, r.error), error: err => done(false, this.errors.extractErrorMessage(err, 'Erreur réseau')) });
    } else {
      this.api.createBudgetPost({ code: f.code.trim().toUpperCase(), ...body }).subscribe({ next: r => done(r.success, r.error), error: err => done(false, this.errors.extractErrorMessage(err, 'Erreur réseau')) });
    }
  }

  toggle(p: BudgetPostDto): void {
    this.api.toggleBudgetPost(p.id).subscribe({
      next: r => { if (r.success) this.load(); else this.error.set(r.error ?? 'Erreur'); },
      error: err => this.error.set(this.errors.extractErrorMessage(err, 'Erreur réseau'))
    });
  }
}
