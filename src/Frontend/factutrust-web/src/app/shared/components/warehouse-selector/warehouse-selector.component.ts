import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnChanges,
  SimpleChanges,
  inject,
  signal,
  DestroyRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SelectModule } from 'primeng/select';
import { StockService, Warehouse } from '@core/services/stock.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-warehouse-selector',
  standalone: true,
  imports: [CommonModule, FormsModule, SelectModule],
  template: `
    <div class="warehouse-selector">
      <label *ngIf="showLabel" class="field-label" [id]="labelId" [attr.for]="inputId">{{ label }}</label>
      <p-select
        [inputId]="inputId"
        [attr.aria-labelledby]="showLabel ? labelId : null"
        [options]="warehouses()"
        [(ngModel)]="selectedWarehouseId"
        (ngModelChange)="onSelectionChange($event)"
        optionLabel="displayLabel"
        optionValue="id"
        [placeholder]="placeholder"
        [showClear]="!required"
        [filter]="false"
        optionDisabled="disabled"
        [loading]="loading()"
        [disabled]="loading() && warehouses().length === 0"
        [style]="{ width: '100%' }"
        appendTo="body">
      </p-select>
      <p *ngIf="loadError()" class="error-text" role="alert">{{ loadError() }}</p>
    </div>
  `,
  styles: [`
    .warehouse-selector { width: 100%; }
    .field-label {
      display: block;
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--text-secondary, #64748b);
      margin-bottom: 0.375rem;
    }
    .error-text { color: #b91c1c; font-size: 0.8125rem; margin-top: 0.375rem; }
  `]
})
export class WarehouseSelectorComponent implements OnInit, OnChanges {
  @Input() label = 'Entrepôt';
  @Input() placeholder = 'Entrepôt par défaut';
  @Input() required = false;
  @Input() showLabel = true;
  @Input() value: string | null = null;
  /** When false, loads all warehouses; inactive ones are shown but disabled in the dropdown. */
  @Input() activeOnly = true;
  /** Unique id for label/dropdown association (accessibility). */
  @Input() inputId = 'warehouse-select';
  @Output() valueChange = new EventEmitter<string | null>();

  private stockService = inject(StockService);
  private destroyRef = inject(DestroyRef);
  private allWarehouses: Warehouse[] | null = null;

  get labelId(): string {
    return `${this.inputId}-label`;
  }

  warehouses = signal<{ id: string; displayLabel: string; disabled: boolean }[]>([]);
  loading = signal(true);
  loadError = signal<string | null>(null);
  selectedWarehouseId: string | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['value']) {
      this.selectedWarehouseId = this.value;
    }
    if (this.allWarehouses) {
      this.refreshOptionsAndSelection();
    }
  }

  ngOnInit(): void {
    this.stockService.getWarehouses(this.activeOnly).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        this.loading.set(false);
        if (res.data?.length) {
          this.allWarehouses = res.data as Warehouse[];
          this.loadError.set(null);
        } else {
          this.allWarehouses = [];
        }
        this.refreshOptionsAndSelection();
      },
      error: () => {
        this.loading.set(false);
        this.loadError.set('Impossible de charger les entrepôts.');
      }
    });
  }

  private refreshOptionsAndSelection(): void {
    if (!this.allWarehouses) {
      return;
    }

    const list = this.allWarehouses;

    this.warehouses.set(
      list.map((w) => {
        let displayLabel = `${w.name}${w.isDefault ? $localize`:@@ui.tern.par.defaut.27c480: (par défaut)` : ''}`;
        if (!w.isActive) {
          displayLabel += ' — Inactif';
        }
        return {
          id: w.id,
          displayLabel,
          disabled: !w.isActive,
        };
      })
    );

    const optionIds = new Set(list.map((w) => w.id));
    let nextId = this.selectedWarehouseId;

    if (nextId && !optionIds.has(nextId)) {
      nextId = null;
    }

    const selectedWh = nextId ? list.find((w) => w.id === nextId) : undefined;
    if (selectedWh && !selectedWh.isActive) {
      nextId = null;
    }

    if (this.required && list.length > 0 && !nextId) {
      const pick =
        list.find((w) => w.isDefault && w.isActive) ?? list.find((w) => w.isActive) ?? null;
      nextId = pick?.id ?? null;
    }

    const prevId = this.selectedWarehouseId;
    this.selectedWarehouseId = nextId;
    if (prevId !== nextId) {
      this.valueChange.emit(nextId);
    }
  }

  onSelectionChange(warehouseId: string | null): void {
    this.valueChange.emit(warehouseId);
  }
}
