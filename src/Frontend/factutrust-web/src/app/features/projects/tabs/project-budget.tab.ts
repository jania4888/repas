import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TableModule } from 'primeng/table';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { ProgressBarModule } from 'primeng/progressbar';
import { TagModule } from 'primeng/tag';
import { ButtonComponent } from '@shared/components/button/button.component';
import { ProjectBudget, ProjectCostLine, ProjectDetail, ProjectPurchaseOrder } from '../project-api.service';
import { isBtp } from '../project-enums';
import { PurchaseOrderStatus } from '@core/services/purchase-order.service';

export interface ProductOption {
  id: string;
  name: string;
}

@Component({
  selector: 'app-project-budget-tab',
  standalone: true,
  imports: [
    BackendLabelPipe,
    CommonModule,
    FormsModule,
    RouterLink,
    TableModule,
    InputTextModule,
    InputNumberModule,
    SelectModule,
    ProgressBarModule,
    TagModule,
    ButtonComponent
  ],
  template: `
    @if (budget) {
      <div class="card p-3 mb-3">
        <dl class="budget-summary m-0 mb-2">
          <dt>Budget HT</dt><dd>{{ budget.budgetHt | number:'1.3-3' }}</dd>
          <dt>Réalisé</dt><dd>{{ budget.actualCostHt | number:'1.3-3' }}</dd>
          <dt>Coût temps</dt><dd>{{ budget.timeCostHt | number:'1.3-3' }}</dd>
          <dt>Reste</dt><dd>{{ budget.remainingHt | number:'1.3-3' }}</dd>
        </dl>
        <p-progressBar [value]="usedPercent" [showValue]="true" />
        <p class="mt-2 mb-0">Heures : {{ budget.loggedHours }} · à facturer {{ budget.billableUninvoicedHours }}</p>
      </div>
    }

    @if (canUpdate) {
      <div class="proj-field-row mb-3">
        <label>
          <span>Description <span class="ft-required">*</span></span>
          <input pInputText [(ngModel)]="costDesc" placeholder="Libellé coût" />
        </label>
        <label>
          <span>Montant HT <span class="ft-required">*</span></span>
          <p-inputNumber [(ngModel)]="costAmount" mode="decimal" />
        </label>
        <app-button (click)="addCost()">Ajouter un coût</app-button>
      </div>
    }

    <p-table [value]="costs" styleClass="p-datatable-sm">
      <ng-template pTemplate="header"><tr><th>Date</th><th>Source</th><th>Libellé</th><th>HT</th></tr></ng-template>
      <ng-template pTemplate="body" let-c>
        <tr><td>{{ c.occurredOn | date:'shortDate' }}</td><td>{{ c.sourceDisplay }}</td><td>{{ c.description }}</td><td>{{ c.amountHt | number:'1.3-3' }}</td></tr>
      </ng-template>
    </p-table>

    @if (project && isBtp(project.kind) && canUpdate) {
      <h3>Sortie stock chantier</h3>
      <div class="proj-field-row">
        <label>Produit
          <p-select [options]="products" [(ngModel)]="productId" optionLabel="name" optionValue="id" placeholder="Produit" [filter]="true" />
        </label>
        <label>Quantité
          <p-inputNumber [(ngModel)]="qty" [min]="0.001" />
        </label>
        <label>Entrepôt
          <input pInputText [(ngModel)]="warehouseId" placeholder="Optionnel" />
        </label>
        <label>Notes
          <input pInputText [(ngModel)]="stockNotes" />
        </label>
        <app-button (click)="stock()">Sortir</app-button>
      </div>
    }

    <h3>Bons de commande</h3>
    @if (canUpdate) {
      <div class="proj-field-row mb-2">
        <label>Bon de commande
          <p-select
            [options]="purchaseOrders"
            [(ngModel)]="purchaseOrderId"
            optionLabel="name"
            optionValue="id"
            placeholder="Sélectionner un bon de commande"
            [filter]="true"
            [showClear]="true" />
        </label>
        <app-button (click)="assignPo()">Associer</app-button>
      </div>
    }

    <p-table [value]="linkedPurchaseOrders" styleClass="p-datatable-sm">
      <ng-template pTemplate="header">
        <tr>
          <th>N°</th>
          <th>Fournisseur</th>
          <th>Statut</th>
          <th>HT</th>
        </tr>
      </ng-template>
      <ng-template pTemplate="body" let-po>
        <tr>
          <td><a [routerLink]="['/purchase-orders', po.id]">{{ po.number }}</a></td>
          <td>{{ po.supplierName }}</td>
          <td><p-tag [value]="po.statusDisplay | backendLabel" [severity]="poStatusSeverity(po.status)" /></td>
          <td>{{ po.totalHt | number:'1.3-3' }}</td>
        </tr>
      </ng-template>
      <ng-template pTemplate="emptymessage">
        <tr><td colspan="4">Aucun bon de commande associé</td></tr>
      </ng-template>
    </p-table>
  `,
  styles: [`
    .budget-summary { display: grid; grid-template-columns: auto 1fr auto 1fr; gap: 0.25rem 1rem; font-size: 0.9rem; }
    dt { color: var(--text-color-secondary); font-weight: 500; }
    dd { margin: 0; }
  `],
})
export class ProjectBudgetTabComponent {
  @Input() project: ProjectDetail | null = null;
  @Input() budget: ProjectBudget | null = null;
  @Input() costs: ProjectCostLine[] = [];
  @Input() products: ProductOption[] = [];
  @Input() purchaseOrders: ProductOption[] = [];
  @Input() linkedPurchaseOrders: ProjectPurchaseOrder[] = [];
  @Input() canUpdate = false;

  @Output() cost = new EventEmitter<{ description: string; amountHt: number; occurredOn: string }>();
  @Output() stockExit = new EventEmitter<{ productId: string; quantity: number; warehouseId?: string; notes?: string }>();
  @Output() assignPurchaseOrder = new EventEmitter<string>();

  costDesc = '';
  costAmount = 0;
  productId = '';
  qty = 1;
  warehouseId = '';
  stockNotes = '';
  purchaseOrderId = '';
  readonly isBtp = isBtp;

  get usedPercent(): number {
    if (!this.budget || this.budget.budgetHt <= 0) return 0;
    return Math.min(100, Math.round((this.budget.actualCostHt / this.budget.budgetHt) * 100));
  }

  poStatusSeverity(status: number | string): 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast' | undefined {
    const value = typeof status === 'string' ? PurchaseOrderStatus[status as keyof typeof PurchaseOrderStatus] : status;
    switch (value) {
      case PurchaseOrderStatus.Draft:
        return 'secondary';
      case PurchaseOrderStatus.Confirmed:
        return 'info';
      case PurchaseOrderStatus.PartiallyReceived:
        return 'warn';
      case PurchaseOrderStatus.Received:
        return 'success';
      case PurchaseOrderStatus.Cancelled:
        return 'danger';
      default:
        return 'secondary';
    }
  }

  addCost(): void {
    if (!this.costDesc.trim()) return;
    this.cost.emit({ description: this.costDesc, amountHt: this.costAmount, occurredOn: new Date().toISOString() });
    this.costDesc = '';
  }

  stock(): void {
    if (!this.productId) return;
    this.stockExit.emit({
      productId: this.productId,
      quantity: this.qty,
      warehouseId: this.warehouseId.trim() || undefined,
      notes: this.stockNotes.trim() || undefined
    });
  }

  assignPo(): void {
    if (!this.purchaseOrderId) return;
    this.assignPurchaseOrder.emit(this.purchaseOrderId);
    this.purchaseOrderId = '';
  }
}
