import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { AccountingService, InventoryBookDto } from '../services/accounting.service';
import { AccountingStatusBannerComponent } from '../shared/accounting-status-banner.component';
import { AccountingFilterBarComponent } from '../shared/accounting-filter-bar.component';
import { AccountingExportMenuComponent } from '../shared/accounting-export-menu.component';
import { AccountingExportFormat, downloadBlob, exportExtension } from '../shared/accounting-download.util';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';

/**
 * Livre d'inventaire d'un exercice : édition légale figée (états financiers NCT + provisions
 * détaillées + balance de clôture), produite en PDF. L'écran affiche un résumé (statut de
 * verrouillage, provisions) et déclenche l'export ; le document complet est le PDF.
 */
@Component({
  selector: 'app-inventory-book',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    PageHeaderComponent,
    ButtonComponent,
    AccountingStatusBannerComponent,
    AccountingFilterBarComponent,
    AccountingExportMenuComponent
  ],
  template: `
    <app-page-header
      title="Livre d'inventaire" i18n-title="Livre d'inventaire"
      subtitle="Édition légale figée de l'exercice — états financiers, provisions et balance de clôture" />

    <div class="card accounting-filters-card">
      <app-accounting-filter-bar ariaLabel="Exercice du livre d'inventaire">
        <div accountingFilterFields class="ib-fields">
          <div class="accounting-filter-field">
            <label class="accounting-filter-label" for="ib-year" i18n="@@accounting.inventory-book.exercice.e171e2b0">Exercice</label>
            <input id="ib-year" type="number" min="2000" max="2100" [(ngModel)]="fiscalYear" class="accounting-filter-input" />
          </div>
        </div>
        <div accountingFilterActions>
          <app-button
            variant="secondary"
            icon="pi pi-refresh"
            iconPos="left"
            type="button"
            (click)="load()"
            [disabled]="loading()"
            ariaLabel="Charger le livre d'inventaire" i18n="@@accounting.inventory-book.charger.8f860300">Charger</app-button>
          <app-accounting-export-menu
            [disabled]="loading() || exporting() || !book()"
            (exportFormat)="onExport($event)" />
        </div>
      </app-accounting-filter-bar>
    </div>

    <app-accounting-status-banner variant="error" [message]="error() ?? ''" [showRetry]="!!error()" retryLabel="Réessayer" (retry)="load()" />

    @if (book(); as b) {
      <div class="ib-lock" [class.ib-lock--locked]="b.isYearLocked" [class.ib-lock--provisional]="!b.isYearLocked" role="status">
        <i class="pi" [class.pi-lock]="b.isYearLocked" [class.pi-lock-open]="!b.isYearLocked" aria-hidden="true"></i>
        <span>
          @if (b.isYearLocked) {
            Exercice verrouillé définitivement@if (b.lockedAt) { le {{ b.lockedAt | date : 'shortDate' }} } — le livre d'inventaire est figé.
          } @else {
            Exercice non verrouillé — édition <strong i18n="@@accounting.inventory-book.provisoire.107ae9dc">provisoire</strong> (les données peuvent encore évoluer). Verrouillez l'exercice pour figer le livre.
          }
        </span>
      </div>

      <div class="card ib-card">
        <h2 class="ib-section-title" i18n="@@accounting.inventory-book.provisions.et.depreciations.detail.par.compte.68bb815f">Provisions et dépréciations (détail par compte)</h2>
        <p-table [value]="b.detailedProvisions" styleClass="p-datatable-sm accounting-datatable" [rowHover]="true">
          <ng-template pTemplate="header">
            <tr>
              <th scope="col" i18n="@@accounting.inventory-book.compte.c45740bb">Compte</th>
              <th scope="col" i18n="@@accounting.inventory-book.libelle.f5485bba">Libellé</th>
              <th scope="col" class="text-right" i18n="@@accounting.inventory-book.montant.4adcd9fc">Montant</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-r>
            <tr>
              <td data-label="Compte"><span class="ib-code">{{ r.code }}</span></td>
              <td data-label="Libellé">{{ r.label }}</td>
              <td data-label="Montant" class="text-right" [class.ib-neg]="r.amount < 0">{{ r.amount | number : '1.3-3' }}</td>
            </tr>
          </ng-template>
          <ng-template pTemplate="footer">
            <tr class="acc-totals-row">
              <td colspan="2" i18n="@@accounting.inventory-book.total.des.provisions.2647629b">Total des provisions</td>
              <td class="text-right">{{ provisionsTotal() | number : '1.3-3' }}</td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr><td colspan="3" class="ib-empty" i18n="@@accounting.inventory-book.aucune.provision.ni.depreciation.a.la.cloture.43a83a56">Aucune provision ni dépréciation à la clôture.</td></tr>
          </ng-template>
        </p-table>
        <p class="ib-hint" i18n="@@accounting.inventory-book.le.document.complet.etats.nct.balance.de.cloture.03bf0860">Le document complet (états NCT + balance de clôture) est disponible en export PDF.</p>
      </div>
    }
  `,
  styles: `
    @use '../shared/accounting-layout';
    .ib-fields { display:flex; flex-wrap:wrap; align-items:flex-end; gap:var(--spacing-4); }
    .text-right { text-align:right; font-variant-numeric:tabular-nums; }
    .ib-code { font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-weight:500; }
    .ib-section-title { margin:0 0 var(--spacing-3); font-size:var(--font-size-md); font-weight:var(--font-weight-semibold); }
    .ib-card { padding:var(--spacing-5); }
    .ib-empty { text-align:center; padding:var(--spacing-6); color:var(--color-text-secondary); }
    .ib-hint { margin:var(--spacing-3) 0 0; font-size:var(--font-size-sm); color:var(--color-text-secondary); }
    .acc-totals-row td { font-weight:var(--font-weight-bold); background:var(--color-background-subtle); border-top:2px solid var(--color-border-default); }
    .ib-lock {
      display:flex; align-items:center; gap:var(--spacing-2);
      padding:var(--spacing-3) var(--spacing-4); border-radius:var(--radius-md);
      margin-bottom:var(--spacing-4); font-size:var(--font-size-sm);
    }
    .ib-lock i { font-size:1.2rem; }
    .ib-lock--locked { background:var(--color-success-50,#f0fdf4); color:var(--color-success-700,#15803d); border:1px solid var(--color-success-200,#bbf7d0); }
    .ib-lock--provisional { background:var(--color-warning-50,#fffbeb); color:var(--color-warning-700,#a16207); border:1px solid var(--color-warning-200,#fde68a); }
    .ib-neg { color:var(--color-danger-700,#b91c1c); font-weight:var(--font-weight-semibold); }
  `
})
export class InventoryBookComponent implements OnInit {
  private readonly errors = inject(ErrorHandlerService);
  private readonly api = inject(AccountingService);
  private readonly toast = inject(ToastService);

  fiscalYear = new Date().getFullYear() - 1;
  readonly book = signal<InventoryBookDto | null>(null);
  readonly error = signal<string | null>(null);
  readonly loading = signal(false);
  readonly exporting = signal(false);

  provisionsTotal(): number {
    return (this.book()?.detailedProvisions ?? []).reduce((s, r) => s + r.amount, 0);
  }

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    const wasLocked = this.book()?.isYearLocked ?? false;
    this.error.set(null);
    this.loading.set(true);
    this.api.getInventoryBook(this.fiscalYear).subscribe({
      next: res => {
        this.loading.set(false);
        if (res.success && res.data) {
          this.book.set(res.data);
          // BUG #014 : notifie si l'état de verrouillage a changé depuis le dernier chargement.
          if (!wasLocked && res.data.isYearLocked) {
            this.toast.add({
              severity: 'warn',
              summary: "Livre d'inventaire",
              detail: "L'exercice a été verrouillé depuis le dernier chargement.",
              life: 6000
            });
          }
        } else {
          this.error.set(res.error ?? 'Erreur');
        }
      },
      error: err => {
        this.loading.set(false);
        this.error.set(this.errors.extractErrorMessage(err, 'Erreur réseau'));
      }
    });
  }

  onExport(format: AccountingExportFormat): void {
    this.exporting.set(true);
    this.api.exportInventoryBook(this.fiscalYear, format).subscribe({
      next: blob => {
        this.exporting.set(false);
        downloadBlob(blob, `livre_inventaire_${this.fiscalYear}.${exportExtension(format)}`);
      },
      error: err => {
        this.exporting.set(false);
        this.error.set(this.errors.extractErrorMessage(err, "Erreur lors de l'export."));
      }
    });
  }
}
