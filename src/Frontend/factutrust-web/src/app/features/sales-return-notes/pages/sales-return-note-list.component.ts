import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { StatusBadgeComponent } from '@shared/components/status-badge/status-badge.component';
import { TableTotalsBarComponent, TotalMetric } from '@shared/components/table-totals-bar/table-totals-bar.component';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { formatLocalDate } from '@core/utils/date.util';
import { SalesReturnNoteService } from '../services/sales-return-note.service';
import {
  SalesReturnNoteListDto,
  SalesReturnNoteListSummary,
  SalesReturnNoteStatus,
  isSalesReturnNoteDraft
} from '../models/sales-return-note.model';

@Component({
  selector: 'app-sales-return-note-list',
  standalone: true,
  imports: [
    BackendLabelPipe,
    CommonModule,
    RouterModule,
    FormsModule,
    PageHeaderComponent,
    BreadcrumbComponent,
    EmptyStateComponent,
    ButtonComponent,
    StatusBadgeComponent,
    TableTotalsBarComponent
  ],
  template: `
    <app-breadcrumb [items]="breadcrumbItems"></app-breadcrumb>
    <app-page-header
      title="Bons de retour" i18n-title="@@sales-return-notes.pages.bons.de.retour.d9f7ad6c"
      subtitle="Retournez des articles déjà livrés et non encore facturés — distinct d'un avoir fiscal" i18n-subtitle="@@sales-return-notes.pages.retournez.des.articles.deja.livres.et.no.d6ada805">
      @if (canCreate()) {
        <app-button variant="primary" icon="pi-plus" iconPos="left" routerLink="new" i18n="@@sales-return-notes.pages.nouveau.bon.de.retour.362bee47"> Nouveau bon de retour </app-button>
      }
    </app-page-header>

    <div class="filters">
      <input class="form-control" type="search" placeholder="Rechercher (BRT, client, BL, motif)" i18n-placeholder="@@sales-return-notes.pages.rechercher.brt.client.bl.motif.e72bab04"
             [ngModel]="search()" (ngModelChange)="search.set($event); reload()" />
      <select class="form-control" [ngModel]="status()" (ngModelChange)="status.set($event); reload()">
        <option [ngValue]="null" i18n="@@sales-return-notes.pages.tous.les.statuts.2d5088af">Tous les statuts</option>
        <option [ngValue]="Status.Draft" i18n="@@sales-return-notes.pages.brouillon.57d2d7a7">Brouillon</option>
        <option [ngValue]="Status.Confirmed" i18n="@@sales-return-notes.pages.confirme.5b629ae7">Confirmé</option>
      </select>
    </div>

    @if (summary(); as totals) {
      <app-table-totals-bar [metrics]="totalMetrics()"></app-table-totals-bar>
    }

    @if (loading()) {
      <p class="muted" i18n="@@sales-return-notes.pages.chargement.01cba1df">Chargement…</p>
    } @else if (items().length === 0) {
      <app-empty-state
        title="Aucun bon de retour" i18n-title="@@sales-return-notes.pages.aucun.bon.de.retour.c3f6f252"
        description="Créez un bon de retour depuis un bon de livraison livré et non facturé." i18n-description="@@sales-return-notes.pages.creez.un.bon.de.retour.depuis.un.bon.de.505e3f54">
        @if (canCreate()) {
          <app-button variant="primary" routerLink="new" i18n="@@sales-return-notes.pages.nouveau.bon.de.retour.362bee47">Nouveau bon de retour</app-button>
        }
      </app-empty-state>
    } @else {
      <table class="data-table">
        <thead>
          <tr>
            <th i18n="@@sales-return-notes.pages.numero.15e73db0">Numéro</th>
            <th i18n="@@sales-return-notes.pages.date.eb9a4bc1">Date</th>
            <th i18n="@@sales-return-notes.pages.client.1bdd79b1">Client</th>
            <th i18n="@@sales-return-notes.pages.bl.cde782be">BL</th>
            <th i18n="@@sales-return-notes.pages.statut.659499f3">Statut</th>
            <th class="text-right" i18n="@@sales-return-notes.pages.qte.a4772129">Qté</th>
            <th class="text-right" i18n="@@sales-return-notes.pages.total.ttc.9e80ff7c">Total TTC</th>
          </tr>
        </thead>
        <tbody>
          @for (row of items(); track row.id) {
            <tr [routerLink]="['/return-notes', row.id]" class="clickable">
              <td class="mono">{{ row.number }}</td>
              <td>{{ formatDate(row.returnDate) }}</td>
              <td>{{ row.clientName }}</td>
              <td class="mono">{{ row.deliveryNoteNumber }}</td>
              <td><app-status-badge [status]="isDraft(row.status) ? 'draft' : 'validated'" [label]="row.statusDisplay | backendLabel" /></td>
              <td class="text-right mono">{{ row.totalReturnedQuantity | number:'1.0-3' }}</td>
              <td class="text-right mono">{{ row.totalTTC | number:'1.3-3' }}</td>
            </tr>
          }
        </tbody>
      </table>
    }
  `,
  styles: [`
    .filters { display: flex; gap: 0.75rem; margin: 1rem 0; flex-wrap: wrap; }
    .filters .form-control { min-width: 220px; }
    .data-table { width: 100%; border-collapse: collapse; }
    .data-table th, .data-table td { padding: 0.6rem 0.75rem; border-bottom: 1px solid var(--surface-border, #e5e7eb); }
    .clickable { cursor: pointer; }
    .clickable:hover { background: var(--surface-hover, #f8fafc); }
    .text-right { text-align: end; }
    .mono { font-variant-numeric: tabular-nums; }
    .muted { color: var(--text-muted, #64748b); }
  `]
})
export class SalesReturnNoteListComponent implements OnInit {
  private readonly service = inject(SalesReturnNoteService);
  private readonly auth = inject(AuthService);

  readonly breadcrumbItems: BreadcrumbItem[] = [
    { label: $localize`:@@sales-return-notes.sales-return-note-list.ts.tableau.de.bord.a524057f:Tableau de bord`, route: '/dashboard', icon: 'pi-home' },
    { label: $localize`:@@sales-return-notes.sales-return-note-list.ts.bons.de.retour.d9f7ad6c:Bons de retour` }
  ];

  readonly Status = SalesReturnNoteStatus;
  readonly isDraft = isSalesReturnNoteDraft;

  search = signal('');
  status = signal<SalesReturnNoteStatus | null>(null);
  items = signal<SalesReturnNoteListDto[]>([]);
  summary = signal<SalesReturnNoteListSummary | null>(null);
  loading = signal(true);
  canCreate = computed(() => this.auth.hasPermission(PERMISSIONS.returnNotes.create));

  totalMetrics = computed<TotalMetric[]>(() => {
    const s = this.summary();
    if (!s) return [];
    return [
      { label: $localize`:@@sales-return-notes.sales-return-note-list.ts.documents.687c8286:Documents`, value: s.count, format: 'number' },
      { label: $localize`:@@sales-return-notes.sales-return-note-list.ts.brouillons.a55f3cd9:Brouillons`, value: s.draftCount, format: 'number' },
      { label: $localize`:@@sales-return-notes.sales-return-note-list.ts.confirmes.8a484038:Confirmés`, value: s.confirmedCount, format: 'number' },
      { label: $localize`:@@sales-return-notes.sales-return-note-list.ts.total.ttc.9e80ff7c:Total TTC`, value: s.totalTtc, format: 'currency', currency: s.currency }
    ];
  });

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.loading.set(true);
    const params = { search: this.search() || undefined, status: this.status(), page: 1, pageSize: 50 };
    this.service.getList(params).subscribe({
      next: res => {
        this.items.set(res.data?.items ?? []);
        this.loading.set(false);
      },
      error: () => this.loading.set(false)
    });
    this.service.getSummary(params).subscribe({
      next: res => this.summary.set(res.data ?? null)
    });
  }

  formatDate(value: string): string {
    return formatLocalDate(new Date(value));
  }
}
