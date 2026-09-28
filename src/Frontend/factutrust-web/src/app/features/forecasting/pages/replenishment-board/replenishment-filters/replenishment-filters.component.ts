import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnInit,
  Output,
  inject,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { StockService, Warehouse } from '@core/services/stock.service';
import { SupplierService, SupplierListItem } from '@core/services/supplier.service';
import {
  ReplenishmentStatus,
  ReplenishmentUrgency,
  ReplenishmentFilters
} from '../../../models/forecasting.models';

/**
 * Filter strip for the V2 replenishment board: status, warehouse, supplier, urgency, free-text search,
 * generated-at date range. Emits {@link change} with the consolidated filters whenever a control changes
 * (parent re-fetches with these filters). Search is debounced inline by 300ms.
 *
 * Selection is persisted to <c>localStorage</c> (key <c>forecasting-repl-v2-filters</c>) so users keep
 * their context across sessions.
 */
@Component({
  selector: 'app-replenishment-filters',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="filters" role="search" aria-label="Filtres des recommandations de réapprovisionnement" i18n-aria-label="@@forecasting.pages.filtres.des.recommandations.de.reapprovisionneme.96f5b7e1">
      <label class="field">
        <span class="field-label" i18n="@@forecasting.pages.statut.659499f3">Statut</span>
        <select [ngModel]="filters().status ?? ''" (ngModelChange)="onStatusChange($event)">
          <option value="" i18n="@@forecasting.pages.tous.b97ae3b4">Tous</option>
          <option value="pending" i18n="@@forecasting.pages.en.attente.5231158f">En attente</option>
          <option value="approved" i18n="@@forecasting.pages.approuvees.b5329d45">Approuvées</option>
          <option value="dismissed" i18n="@@forecasting.pages.ecartees.c08d1c36">Écartées</option>
          <option value="ordered" i18n="@@forecasting.pages.commandees.480b28d2">Commandées</option>
          <option value="superseded" i18n="@@forecasting.pages.remplacees.cc46072e">Remplacées</option>
        </select>
      </label>

      <label class="field">
        <span class="field-label" i18n="@@forecasting.pages.entrepot.c349c0bc">Entrepôt</span>
        <select [ngModel]="filters().warehouseId ?? ''" (ngModelChange)="patch({ warehouseId: $event || null })">
          <option value="" i18n="@@forecasting.pages.tous.b97ae3b4">Tous</option>
          @for (w of warehouses(); track w.id) {
            <option [value]="w.id">{{ w.name }}</option>
          }
        </select>
      </label>

      <label class="field">
        <span class="field-label" i18n="@@forecasting.pages.fournisseur.97d91d89">Fournisseur</span>
        <select [ngModel]="filters().supplierId ?? ''" (ngModelChange)="patch({ supplierId: $event || null })">
          <option value="" i18n="@@forecasting.pages.tous.b97ae3b4">Tous</option>
          @for (s of suppliers(); track s.id) {
            <option [value]="s.id">{{ s.name }}</option>
          }
        </select>
      </label>

      <label class="field">
        <span class="field-label" i18n="@@forecasting.pages.urgence.9dc19606">Urgence</span>
        <select [ngModel]="filters().urgencyLevel ?? ''" (ngModelChange)="onUrgencyChange($event)">
          <option value="" i18n="@@forecasting.pages.toutes.c5f641e4">Toutes</option>
          <option value="OutOfStock" i18n="@@forecasting.pages.rupture.fda77001">Rupture</option>
          <option value="Urgent" i18n="@@forecasting.pages.urgent.ecb26f46">Urgent</option>
          <option value="Warning" i18n="@@forecasting.pages.attention.74e0b9c8">Attention</option>
          <option value="Normal" i18n="@@forecasting.pages.normal.45e118d0">Normal</option>
        </select>
      </label>

      <label class="field">
        <span class="field-label" i18n="@@forecasting.pages.recherche.787b5492">Recherche</span>
        <input
          type="search"
          [ngModel]="filters().search ?? ''"
          (ngModelChange)="onSearchInput($event)"
          placeholder="Code, produit, fournisseur…" i18n-placeholder="@@forecasting.pages.code.produit.fournisseur.75d442d7"
          autocomplete="off"
          aria-label="Rechercher par code, nom de produit ou fournisseur" i18n-aria-label="@@forecasting.pages.rechercher.par.code.nom.de.produit.ou.fournisseu.be72cc18" />
      </label>

      <button
        type="button"
        class="btn-reset"
        (click)="onReset()"
        title="Réinitialiser les filtres" i18n-title="@@forecasting.pages.reinitialiser.les.filtres.d8915f02"
        aria-label="Réinitialiser tous les filtres" i18n-aria-label="@@forecasting.pages.reinitialiser.tous.les.filtres.9ec4827b">
        <i class="pi pi-filter-slash" aria-hidden="true"></i>
      </button>
    </section>
  `,
  styles: [`
    .filters { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)) auto; gap: .75rem; align-items: end; padding: .75rem; background: var(--color-neutral-50, #f9fafb); border: 1px solid var(--color-neutral-200, #e5e7eb); border-radius: 8px; margin-bottom: 1rem; }
    .field { display: flex; flex-direction: column; gap: .2rem; font-size: .85rem; }
    .field-label { color: var(--color-neutral-600, #6b7280); font-size: .75rem; font-weight: 500; }
    .field select, .field input { padding: .4rem .6rem; border: 1px solid var(--color-neutral-300, #d1d5db); border-radius: 6px; font: inherit; background: white; }
    .field select:focus, .field input:focus { outline: 2px solid var(--color-primary-400, #60a5fa); outline-offset: 1px; }
    .btn-reset { padding: .5rem .75rem; border: 1px solid var(--color-neutral-300, #d1d5db); border-radius: 6px; background: white; cursor: pointer; color: var(--color-neutral-700, #374151); display: inline-flex; align-items: center; gap: .25rem; height: fit-content; }
    .btn-reset:hover { background: var(--color-neutral-100, #f3f4f6); }
  `]
})
export class ReplenishmentFiltersComponent implements OnInit {
  /** Initial filters (e.g. loaded from URL/route or app state). */
  @Input() set initial(value: ReplenishmentFilters | undefined) {
    if (value) this.filters.set({ ...this.filters(), ...value });
  }

  @Output() change = new EventEmitter<ReplenishmentFilters>();

  private readonly stockService = inject(StockService);
  private readonly supplierService = inject(SupplierService);

  private static readonly STORAGE_KEY = 'forecasting-repl-v2-filters';

  readonly filters = signal<ReplenishmentFilters>(this.readFromStorage() ?? {});
  readonly warehouses = signal<Warehouse[]>([]);
  readonly suppliers = signal<SupplierListItem[]>([]);

  private searchDebounce: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    void this.loadWarehouses();
    void this.loadSuppliers();
    // Emit initial state so the parent fetches immediately.
    this.change.emit(this.filters());
  }

  /** Status select uses a string union — cast safely from the bound value. */
  onStatusChange(value: string): void {
    this.patch({ status: (value || null) as ReplenishmentStatus | null });
  }

  /** Urgency select uses a string union — cast safely from the bound value. */
  onUrgencyChange(value: string): void {
    this.patch({ urgencyLevel: (value || null) as ReplenishmentUrgency | null });
  }

  patch(diff: Partial<ReplenishmentFilters>): void {
    const merged: ReplenishmentFilters = { ...this.filters(), ...diff };
    this.filters.set(merged);
    this.persist(merged);
    this.change.emit(merged);
  }

  onSearchInput(value: string): void {
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => this.patch({ search: value || null }), 300);
  }

  onReset(): void {
    this.filters.set({});
    this.persist(this.filters());
    this.change.emit(this.filters());
  }

  private async loadWarehouses(): Promise<void> {
    try {
      const res = await firstValueFrom(this.stockService.getWarehouses(true));
      this.warehouses.set(res.success && res.data ? res.data : []);
    } catch {
      this.warehouses.set([]);
    }
  }

  private async loadSuppliers(): Promise<void> {
    try {
      const res = await firstValueFrom(this.supplierService.getSuppliers({ pageSize: 200, isActive: true }));
      this.suppliers.set(res.success && res.data ? (res.data.items ?? []) : []);
    } catch {
      this.suppliers.set([]);
    }
  }

  private readFromStorage(): ReplenishmentFilters | null {
    try {
      const raw = localStorage.getItem(ReplenishmentFiltersComponent.STORAGE_KEY);
      return raw ? JSON.parse(raw) as ReplenishmentFilters : null;
    } catch {
      return null;
    }
  }

  private persist(filters: ReplenishmentFilters): void {
    try {
      localStorage.setItem(ReplenishmentFiltersComponent.STORAGE_KEY, JSON.stringify(filters));
    } catch {
      // localStorage may be unavailable (Safari private mode) — ignore.
    }
  }
}
