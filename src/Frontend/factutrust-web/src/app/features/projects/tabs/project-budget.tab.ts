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
          <dt i18n="@@projects.tabs.budget.ht.0374a3ad">Budget HT</dt><dd>{{ budget.budgetHt | number:'1.3-3' }}</dd>
          <dt i18n="@@projects.tabs.realise.eed7fe3a">Réalisé</dt><dd>{{ budget.actualCostHt | number:'1.3-3' }}</dd>
          <dt i18n="@@projects.tabs.cout.temps.91eada0d">Coût temps</dt><dd>{{ budget.timeCostHt | number:'1.3-3' }}</dd>
          <dt i18n="@@projects.tabs.reste.68135bb8">Reste</dt><dd>{{ budget.remainingHt | number:'1.3-3' }}</dd>
        </dl>
        <p-progressBar [value]="usedPercent" [showValue]="true" />
        <p class="mt-2 mb-0" i18n="@@projects.tabs.heures.a.facturer.b248279e">Heures : {{ budget.loggedHours }} · à facturer {{ budget.billableUninvoicedHours }}</p>
      </div>
    }

    @if (canUpdate) {
      <div class="proj-field-row mb-3">
        <label>
          <span i18n="@@projects.tabs.description.90dfe3b8">Description <span class="ft-required">*</span></span>
          <input pInputText [(ngModel)]="costDesc" placeholder="Libellé coût" i18n-placeholder="@@projects.tabs.libelle.cout.5e1fc3e6" />
        </label>
        <label>
          <span i18n="@@projects.tabs.montant.ht.8292ce36">Montant HT <span class="ft-required">*</span></span>
          <p-inputNumber [(ngModel)]="costAmount" mode="decimal" />
        </label>
        <app-button (click)="addCost()" i18n="@@projects.tabs.ajouter.un.cout.16b135c5">Ajouter un coût</app-button>
      </div>
    }

    <p-table [value]="costs" styleClass="p-datatable-sm">
      <ng-template pTemplate="header"><tr><th i18n="@@projects.tabs.date.eb9a4bc1">Date</th><th i18n="@@projects.tabs.source.6da13add">Source</th><th i18n="@@projects.tabs.libelle.f5485bba">Libellé</th><th>HT</th></tr></ng-template>
      <ng-template pTemplate="body" let-c>
        <tr><td>{{ c.occurredOn | date:'shortDate' }}</td><td>{{ c.sourceDisplay | backendLabel }}</td><td>{{ c.description }}</td><td>{{ c.amountHt | number:'1.3-3' }}</td></tr>
      </ng-template>
    </p-table>

    @if (project && isBtp(project.kind) && canUpdate) {
      <h3 i18n="@@projects.tabs.sortie.stock.chantier.37070f5e">Sortie stock chantier</h3>
      <div class="proj-field-row">
        <label><ng-container i18n="@@projects.tabs.produit.ff673dc2">Produit
          </ng-container><p-select [options]="products" [(ngModel)]="productId" optionLabel="name" optionValue="id" placeholder="Produit" i18n-placeholder="@@projects.tabs.produit.fd4a4517" [filter]="true" />
        </label>
        <label><ng-container i18n="@@projects.tabs.quantite.09a38fda">Quantité
          </ng-container><p-inputNumber [(ngModel)]="qty" [min]="0.001" />
        </label>
        <label><ng-container i18n="@@projects.tabs.entrepot.c349c0bc">Entrepôt
          </ng-container><input pInputText [(ngModel)]="warehouseId" placeholder="Optionnel" i18n-placeholder="@@projects.tabs.optionnel.fcdd2927" />
        </label>
        <label><ng-container i18n="@@projects.tabs.notes.70440046">Notes
          </ng-container><input pInputText [(ngModel)]="stockNotes" />
        </label>
        <app-button (click)="stock()" i18n="@@projects.tabs.sortir.a1ae4b77">Sortir</app-button>
      </div>
    }

    <h3 i18n="@@projects.tabs.bons.de.commande.aae719f0">Bons de commande</h3>
    @if (canUpdate) {
      <div class="proj-field-row mb-2">
        <label><ng-container i18n="@@projects.tabs.bon.de.commande.4b9aea29">Bon de commande
          </ng-container><p-select
            [options]="purchaseOrders"
            [(ngModel)]="purchaseOrderId"
            optionLabel="name"
            optionValue="id"
            placeholder="Sélectionner un bon de commande" i18n-placeholder="@@projects.tabs.selectionner.un.bon.de.commande.39e1aa56"
            [filter]="true"
            [showClear]="true" />
        </label>
        <app-button (click)="assignPo()" i18n="@@projects.tabs.associer.e9f6a162">Associer</app-button>
      </div>
    }

    <p-table [value]="linkedPurchaseOrders" styleClass="p-datatable-sm">
      <ng-template pTemplate="header">
        <tr>
          <th>N°</th>
          <th i18n="@@projects.tabs.fournisseur.97d91d89">Fournisseur</th>
          <th i18n="@@projects.tabs.statut.659499f3">Statut</th>
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
        <tr><td colspan="4" i18n="@@projects.tabs.aucun.bon.de.commande.associe.c3b18d74">Aucun bon de commande associé</td></tr>
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
