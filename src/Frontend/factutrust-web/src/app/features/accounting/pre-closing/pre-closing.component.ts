import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { TableModule } from 'primeng/table';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { AccountingService, PreClosingChecklistDto, PreClosingCheckDto } from '../services/accounting.service';
import { AccountingStatusBannerComponent } from '../shared/accounting-status-banner.component';
import { AccountingFilterBarComponent } from '../shared/accounting-filter-bar.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { ErrorHandlerService } from '@core/services/error-handler.service';

/**
 * Contrôles de pré-clôture : diagnostic de révision d'un exercice avant clôture annuelle
 * et verrouillage définitif. Chaque contrôle porte une sévérité (bloquant / avertissement /
 * info) et un lien direct de résolution.
 */
@Component({
  selector: 'app-pre-closing',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    TableModule,
    PageHeaderComponent,
    AccountingStatusBannerComponent,
    AccountingFilterBarComponent,
    ButtonComponent
  ],
  template: `
    <app-page-header title="Contrôles de pré-clôture" i18n-title="@@accounting.pre-closing.controles.de.pre.cloture.e6b9bc87" subtitle="Diagnostic de révision avant clôture de l'exercice" />
    <div class="card accounting-filters-card">
      <app-accounting-filter-bar ariaLabel="Exercice à contrôler">
        <div accountingFilterFields class="pc-toolbar-fields">
          <div class="accounting-filter-field">
            <label class="accounting-filter-label" for="pc-year" i18n="@@accounting.pre-closing.exercice.e171e2b0">Exercice</label>
            <input id="pc-year" type="number" min="2000" max="2100" [(ngModel)]="fiscalYear" class="accounting-filter-input" />
          </div>
        </div>
        <div accountingFilterActions>
          <app-button
            variant="secondary"
            icon="pi pi-refresh"
            iconPos="left"
            type="button"
            (click)="run()"
            [disabled]="loading()"
            ariaLabel="Lancer les contrôles de pré-clôture" i18n="@@accounting.pre-closing.lancer.les.controles.521d27dd"> Lancer les contrôles </app-button>
        </div>
      </app-accounting-filter-bar>
    </div>

    <app-accounting-status-banner variant="error" [message]="error() ?? ''" [showRetry]="!!error()" retryLabel="Réessayer" (retry)="run()" />

    @if (checklist(); as cl) {
      <div class="pc-summary" [class.pc-summary--blocking]="cl.hasBlocking" [class.pc-summary--ok]="!cl.hasBlocking" role="status">
        <i class="pi" [class.pi-times-circle]="cl.hasBlocking" [class.pi-check-circle]="!cl.hasBlocking" aria-hidden="true"></i>
        <span>
          @if (cl.hasBlocking) {
            Des contrôles <strong i18n="@@accounting.pre-closing.bloquants.3b3fd092">bloquants</strong> subsistent : la clôture annuelle et le verrouillage définitif sont refusés tant qu'ils ne sont pas résolus.
          } @else {
            Aucun contrôle bloquant. La clôture de l'exercice {{ cl.fiscalYear }} est autorisée
            @if (warningCount() > 0) { (mais {{ warningCount() }} avertissement(s) à examiner). }
          }
        </span>
      </div>

      <p-table [value]="cl.checks" styleClass="p-datatable-sm accounting-datatable" [rowHover]="true">
        <ng-template pTemplate="header">
          <tr>
            <th style="width:9rem" i18n="@@accounting.pre-closing.severite.62fd4ae5">Sévérité</th>
            <th i18n="@@accounting.pre-closing.controle.e988877e">Contrôle</th>
            <th style="width:6rem" class="text-right" i18n="@@accounting.pre-closing.nombre.e68491e9">Nombre</th>
            <th i18n="@@accounting.pre-closing.detail.7ce06afc">Détail</th>
            <th style="width:7rem" i18n="@@accounting.pre-closing.action.97c89a4d">Action</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-c>
          <tr [class.pc-row-blocking]="c.severity === 2 && c.count > 0">
            <td>
              <span class="pc-badge" [ngClass]="severityClass(c)">{{ severityLabel(c) }}</span>
            </td>
            <td>{{ c.title }}</td>
            <td class="text-right pc-num" [class.pc-count-nonzero]="c.count > 0">{{ c.count }}</td>
            <td class="pc-message">{{ c.message }}</td>
            <td>
              @if (c.deepLinkRoute && c.count > 0) {
                <a class="pc-link" [routerLink]="c.deepLinkRoute"><ng-container i18n="@@accounting.pre-closing.voir.8a754f1f">Voir </ng-container> <i class="pi pi-angle-right" aria-hidden="true"></i></a>
              }
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr><td colspan="5" style="text-align:center;padding:2rem" i18n="@@accounting.pre-closing.lancez.les.controles.pour.un.exercice.4e60b416">Lancez les contrôles pour un exercice.</td></tr>
        </ng-template>
      </p-table>
    }
  `,
  styles: `
    @use '../shared/accounting-layout';
    .pc-toolbar-fields { display:flex; flex-wrap:wrap; align-items:flex-end; gap:var(--spacing-4); }
    .text-right { text-align:right; }
    .pc-num { font-variant-numeric:tabular-nums; }
    .pc-count-nonzero { font-weight:var(--font-weight-bold); }
    .pc-message { color:var(--color-text-secondary); font-size:var(--font-size-sm); }
    .pc-summary {
      display:flex; align-items:center; gap:var(--spacing-2);
      padding:var(--spacing-3) var(--spacing-4); border-radius:var(--radius-md);
      margin-bottom:var(--spacing-4); font-size:var(--font-size-sm);
    }
    .pc-summary i { font-size:1.2rem; }
    .pc-summary--blocking { background:var(--color-danger-50,#fef2f2); color:var(--color-danger-700,#b91c1c); border:1px solid var(--color-danger-200,#fecaca); }
    .pc-summary--ok { background:var(--color-success-50,#f0fdf4); color:var(--color-success-700,#15803d); border:1px solid var(--color-success-200,#bbf7d0); }
    .pc-row-blocking { background:var(--color-danger-50,#fef2f2); }
    .pc-badge { display:inline-block; padding:0.15rem 0.5rem; border-radius:var(--radius-pill,999px); font-size:var(--font-size-xs); font-weight:var(--font-weight-semibold); white-space:nowrap; }
    .pc-badge--blocking { background:var(--color-danger-100,#fee2e2); color:var(--color-danger-700,#b91c1c); }
    .pc-badge--warning { background:var(--color-warning-100,#fef3c7); color:var(--color-warning-700,#a16207); }
    .pc-badge--info { background:var(--color-background-subtle); color:var(--color-text-tertiary); }
    .pc-badge--ok { background:var(--color-success-100,#dcfce7); color:var(--color-success-700,#15803d); }
    .pc-link { color:var(--color-primary-500); text-decoration:none; font-weight:500; white-space:nowrap; }
    .pc-link:hover { text-decoration:underline; }
  `
})
export class PreClosingComponent implements OnInit {
  private readonly errors = inject(ErrorHandlerService);
  private readonly api = inject(AccountingService);

  fiscalYear = new Date().getFullYear();
  readonly checklist = signal<PreClosingChecklistDto | null>(null);
  readonly error = signal<string | null>(null);
  readonly loading = signal(false);

  readonly warningCount = computed(() =>
    (this.checklist()?.checks ?? []).filter(c => c.severity === 1 && c.count > 0).length
  );

  ngOnInit(): void {
    this.run();
  }

  run(): void {
    this.error.set(null);
    this.loading.set(true);
    this.api.getPreClosingChecklist(this.fiscalYear).subscribe({
      next: res => {
        this.loading.set(false);
        if (res.success && res.data) this.checklist.set(res.data);
        else this.error.set(res.error ?? $localize`:@@ui.tern.erreur.ab546c:Erreur`);
      },
      error: err => {
        this.loading.set(false);
        this.error.set(this.errors.extractErrorMessage(err, 'Erreur réseau'));
      }
    });
  }

  severityLabel(c: PreClosingCheckDto): string {
    if (c.count === 0) return 'OK';
    if (c.severity === 2) return 'Bloquant';
    if (c.severity === 1) return 'Avertissement';
    return 'Info';
  }

  severityClass(c: PreClosingCheckDto): string {
    if (c.count === 0) return 'pc-badge--ok';
    if (c.severity === 2) return 'pc-badge--blocking';
    if (c.severity === 1) return 'pc-badge--warning';
    return 'pc-badge--info';
  }
}
