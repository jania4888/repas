import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { SkeletonTableComponent } from '@shared/components/skeleton/skeleton-table.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { StockService, StockMovementDto } from '@core/services/stock.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';

@Component({
  selector: 'app-stock-history',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    TableModule,
    TagModule,
    ToastModule,
    PageHeaderComponent,
    BreadcrumbComponent,
    ButtonComponent,
    SkeletonTableComponent,
    EmptyStateComponent
  ],
  template: `
    <p-toast position="bottom-right"></p-toast>
    
    <app-breadcrumb [items]="breadcrumbItems"></app-breadcrumb>
    
    <app-page-header 
      title="Historique des Mouvements" i18n-title="@@stock.stock-history.historique.des.mouvements.37a95095"
      [subtitle]="productName() ? loc_ui_tern_produit_fe4d4d + productName() : loc_ui_tern_chargement_a209b6">
      <app-button 
        variant="outline"
        icon="pi-arrow-left"
        iconPos="left"
        routerLink="/stock" i18n="@@stock.stock-history.retour.au.stock.5b0f5b07"> Retour au Stock </app-button>
    </app-page-header>

    <div class="history-card">
      @if (initialLoad()) {
      <app-skeleton-table [rows]="5" [columns]="skeletonColumns"></app-skeleton-table>
      } @else if (movements().length === 0) {
        <app-empty-state
          illustration="empty-box.svg"
          title="Aucun mouvement" i18n-title="@@stock.stock-history.aucun.mouvement.e4e42303"
          description="Aucun mouvement de stock n'a été enregistré pour ce produit." i18n-description="@@stock.stock-history.aucun.mouvement.de.stock.n.a.ete.enregis.f39f4f75"
          actionLabel="Retour au stock" i18n-actionLabel="@@stock.stock-history.retour.au.stock.298e4e65"
          actionRoute="/stock">
        </app-empty-state>
      } @else {
        <p-table 
          [loading]="loading()" 
          [value]="movements()" 
          [paginator]="true" 
          [rows]="20"
          [showCurrentPageReport]="true"
          currentPageReportTemplate="Affichage {first} à {last} sur {totalRecords} mouvements" i18n-currentPageReportTemplate="@@stock.stock-history.affichage.first.a.last.sur.totalrecords.mouvemen.2251bca4"
          [rowHover]="true"
          styleClass="p-datatable-striped">
          
          <ng-template pTemplate="header">
            <tr>
              <th scope="col" i18n="@@stock.stock-history.date.eb9a4bc1">Date</th>
              <th scope="col" i18n="@@stock.stock-history.type.3deb7456">Type</th>
              <th scope="col" i18n="@@stock.stock-history.motif.2a198f47">Motif</th>
              <th scope="col" class="text-right" i18n="@@stock.stock-history.quantite.09a38fda">Quantité</th>
              <th scope="col" class="text-right" i18n="@@stock.stock-history.cout.unit.aa73bc92">Coût Unit.</th>
              <th scope="col" class="text-right" i18n="@@stock.stock-history.total.b25928c6">Total</th>
              <th scope="col" class="text-right" i18n="@@stock.stock-history.solde.e5977cf9">Solde</th>
              <th scope="col" i18n="@@stock.stock-history.reference.f8130bb0">Référence</th>
            </tr>
          </ng-template>
          
          <ng-template pTemplate="body" let-movement>
            <tr>
              <td>{{ movement.occurredAt | date:'dd/MM/yyyy HH:mm' }}</td>
              <td>
                <p-tag 
                  [value]="movement.type === 'Entry' ? loc_ui_tern_entree_0ab59c : loc_ui_tern_sortie_fbd00e" 
                  [severity]="movement.type === 'Entry' ? 'success' : 'danger'">
                </p-tag>
              </td>
              <td>{{ movement.reason }}</td>
              <td class="text-right font-mono">
                <span [class.text-green-600]="movement.type === 'Entry'" 
                      [class.text-red-600]="movement.type !== 'Entry'">
                  {{ movement.type === 'Entry' ? '+' : '-' }}{{ movement.quantity | number:'1.2-2' }}
                </span>
              </td>
              <td class="text-right font-mono">
                {{ movement.unitCost | currency:'TND':'symbol':'1.3-3' }}
              </td>
              <td class="text-right font-mono">
                {{ movement.totalCost | currency:'TND':'symbol':'1.3-3' }}
              </td>
              <td class="text-right font-mono font-semibold">{{ movement.balanceAfter | number:'1.2-2' }}</td>
              <td class="text-gray-600">{{ movement.reference || movement.notes || '-' }}</td>
            </tr>
          </ng-template>
        </p-table>
      }
    </div>
  `,
  styles: [`
    .history-card {
      background: white;
      border-radius: var(--radius-xl, 1rem);
      overflow: hidden;
      box-shadow: var(--shadow-md, 0 4px 6px rgba(0,0,0,0.1));
      border: 1px solid var(--color-border-subtle, #e5e7eb);
    }

    .text-right { text-align: right; }
    .font-mono { font-family: 'JetBrains Mono', monospace; }
    .font-semibold { font-weight: 600; }
    .text-green-600 { color: #16a34a; }
    .text-red-600 { color: #dc2626; }
    .text-gray-500 { color: #6b7280; }
    .text-gray-600 { color: #4b5563; }

    :host ::ng-deep {
      .p-datatable .p-datatable-tbody > tr > td {
        padding: var(--spacing-3, 0.75rem) var(--spacing-4, 1rem);
        vertical-align: middle;
      }

      .p-datatable .p-datatable-thead > tr > th {
        padding: var(--spacing-3, 0.75rem) var(--spacing-4, 1rem);
        background: var(--color-background-subtle, #f9fafb);
        font-weight: 600;
        color: var(--color-text-secondary, #6b7280);
        text-transform: uppercase;
        font-size: 0.75rem;
        letter-spacing: 0.05em;
      }
    }
  `]
})
export class StockHistoryComponent implements OnInit {
  readonly loc_ui_tern_produit_fe4d4d = $localize`:@@ui.tern.produit.fe4d4d:Produit: `;
  readonly loc_ui_tern_chargement_a209b6 = $localize`:@@ui.tern.chargement.a209b6:Chargement...`;
  readonly loc_ui_tern_entree_0ab59c = $localize`:@@ui.tern.entree.0ab59c:Entrée`;
  readonly loc_ui_tern_sortie_fbd00e = $localize`:@@ui.tern.sortie.fbd00e:Sortie`;
  private route = inject(ActivatedRoute);
  private stockService = inject(StockService);
  private errorHandler = inject(ErrorHandlerService);

  loading = signal(true);
  initialLoad = signal(true);
  movements = signal<StockMovementDto[]>([]);
  productName = signal<string>('');
  stockItemId: string | null = null;

  breadcrumbItems: BreadcrumbItem[] = [
    { label: $localize`:@@stock.stock-history.ts.tableau.de.bord.a524057f:Tableau de bord`, route: '/dashboard', icon: 'pi-home' },
    { label: $localize`:@@stock.stock-history.ts.gestion.du.stock.72df5586:Gestion du Stock`, route: '/stock' },
    { label: $localize`:@@stock.stock-history.ts.historique.34f3a06a:Historique` }
  ];

  skeletonColumns = [
    { header: $localize`:@@stock.stock-history.ts.date.eb9a4bc1:Date`, width: '15%' },
    { header: $localize`:@@stock.stock-history.ts.type.3deb7456:Type`, width: '10%' },
    { header: $localize`:@@stock.stock-history.ts.motif.2a198f47:Motif`, width: '15%' },
    { header: $localize`:@@stock.stock-history.ts.quantite.09a38fda:Quantité`, width: '12%' },
    { header: $localize`:@@stock.stock-history.ts.cout.4a4aa395:Coût`, width: '12%' },
    { header: $localize`:@@stock.stock-history.ts.avant.5315d949:Avant`, width: '10%' },
    { header: $localize`:@@stock.stock-history.ts.apres.546e1c41:Après`, width: '10%' },
    { header: $localize`:@@stock.stock-history.ts.reference.f8130bb0:Référence`, width: '16%' }
  ];

  ngOnInit() {
    this.stockItemId = this.route.snapshot.paramMap.get('id');
    if (this.stockItemId) {
      this.loadMovements();
      this.loadStockItemInfo();
    }
  }

  loadMovements() {
    if (!this.stockItemId) return;

    this.stockService.getStockMovements(this.stockItemId).subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.movements.set(response.data.items);
        }
        this.loading.set(false);
        this.initialLoad.set(false);
      },
      error: (err) => {
        this.errorHandler.logError('Failed to load movements', err);
        this.loading.set(false);
        this.initialLoad.set(false);
      }
    });
  }

  loadStockItemInfo() {
    // Get product name from stock items
    this.stockService.getStockItems().subscribe({
      next: (response) => {
        if (response.success && response.data) {
          const item = response.data.items.find(i => i.id === this.stockItemId);
          if (item) {
            this.productName.set(item.productName);
          }
        }
      }
    });
  }
}
