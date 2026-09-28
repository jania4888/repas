/// <reference types="@angular/localize" />
import { Component, Input, OnChanges, SimpleChanges, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ButtonComponent } from '@shared/components/button/button.component';
import {
  BulkUpdateVariantPricesRequest,
  ProductService,
  ProductVariantChildDto
} from '@core/services/product.service';
import { ToastService } from '@core/services/toast.service';

@Component({
  selector: 'app-product-variant-matrix',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    TableModule,
    InputNumberModule,
    InputTextModule,
    TagModule,
    ButtonComponent
  ],
  template: `
    @if (loading()) {
      <p class="form-hint" i18n="@@shared.components.product-variant-matrix.product-variant-matrix.chargement.des.sku.4f181a40"><i class="pi pi-spin pi-spinner"></i> Chargement des SKU…</p>
    } @else if (variants().length === 0) {
      <p class="form-hint" i18n="@@shared.components.product-variant-matrix.product-variant-matrix.aucun.sku.enfant.genere.pour.ce.modele.b60126e5">Aucun SKU enfant généré pour ce modèle.</p>
    } @else {
      <div class="matrix-toolbar">
        <app-button type="button" variant="outline" size="sm" icon="pi-copy"
                    (clicked)="copyPricesFromParent()" [disabled]="saving()" i18n="@@shared.components.product-variant-matrix.product-variant-matrix.appliquer.les.prix.du.modele.b6e3445d"> Appliquer les prix du modèle </app-button>
        <app-button type="button" variant="secondary" size="sm" icon="pi-save"
                    (clicked)="saveAllPrices()" [disabled]="saving()" i18n="@@shared.components.product-variant-matrix.product-variant-matrix.enregistrer.les.prix.e06faf29"> Enregistrer les prix </app-button>
      </div>
      <p-table [value]="variants()" styleClass="variant-matrix-table" [scrollable]="true" scrollHeight="320px">
        <ng-template pTemplate="header">
          <tr>
            <th i18n="@@shared.components.product-variant-matrix.product-variant-matrix.code.adac6937">Code</th>
            <th i18n="@@shared.components.product-variant-matrix.product-variant-matrix.axes.d75f36f8">Axes</th>
            <th i18n="@@shared.components.product-variant-matrix.product-variant-matrix.prix.ht.362207ca">Prix HT</th>
            <th i18n="@@shared.components.product-variant-matrix.product-variant-matrix.prix.ttc.c48d80e8">Prix TTC</th>
            <th i18n="@@shared.components.product-variant-matrix.product-variant-matrix.stock.bcecf456">Stock</th>
            <th i18n="@@shared.components.product-variant-matrix.product-variant-matrix.code.barres.a5ce859a">Code-barres</th>
            <th></th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-row>
          <tr>
            <td><code>{{ row.code }}</code></td>
            <td>{{ formatAttributes(row) }}</td>
            <td>
              <p-inputNumber [(ngModel)]="row.unitPrice" [min]="0" mode="decimal" [minFractionDigits]="3"
                             [maxFractionDigits]="3" styleClass="w-full" />
            </td>
            <td>{{ row.salePriceTtc | number:'1.3-3' }}</td>
            <td>{{ row.quantityAvailable ?? '—' }}</td>
            <td>
              <input pInputText [(ngModel)]="row.barcode" class="w-full" placeholder="EAN" i18n-placeholder="@@shared.components.product-variant-matrix.product-variant-matrix.ean.057d1674" />
            </td>
            <td>
              <app-button type="button" variant="ghost" size="sm" icon="pi-external-link"
                          [routerLink]="['/products', row.id, 'edit']" i18n="@@shared.components.product-variant-matrix.product-variant-matrix.fiche.6ad30343"> Fiche </app-button>
            </td>
          </tr>
        </ng-template>
      </p-table>
    }
  `,
  styles: [`
    .matrix-toolbar {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 0.75rem;
      flex-wrap: wrap;
    }
    :host ::ng-deep .variant-matrix-table .p-inputnumber,
    :host ::ng-deep .variant-matrix-table input {
      max-width: 8rem;
    }
  `]
})
export class ProductVariantMatrixComponent implements OnChanges {
  @Input({ required: true }) parentProductId!: string;

  private readonly productService = inject(ProductService);
  private readonly toastService = inject(ToastService);

  loading = signal(false);
  saving = signal(false);
  variants = signal<ProductVariantChildDto[]>([]);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['parentProductId'] && this.parentProductId) {
      this.load();
    }
  }

  load(): void {
    this.loading.set(true);
    this.productService.getProductVariants(this.parentProductId).subscribe({
      next: res => {
        this.loading.set(false);
        if (res.success && res.data) {
          this.variants.set(res.data.items.map(v => ({ ...v })));
        }
      },
      error: () => this.loading.set(false)
    });
  }

  formatAttributes(row: ProductVariantChildDto): string {
    return row.attributes.map(a => a.valueName).join(' / ') || '—';
  }

  copyPricesFromParent(): void {
    this.saving.set(true);
    const request: BulkUpdateVariantPricesRequest = { mode: 'copyFromParent' };
    this.productService.bulkUpdateVariantPrices(this.parentProductId, request).subscribe({
      next: res => {
        this.saving.set(false);
        if (res.success) {
          this.toastService.add({ severity: 'success', summary: $localize`:@@product-variant-matrix.component.summary.Prix:Prix`, detail: $localize`:@@product-variant-matrix.component.detail.Prix_du_mod_le_a:Prix du modèle appliqués aux variantes.` });
          this.load();
        }
      },
      error: () => this.saving.set(false)
    });
  }

  saveAllPrices(): void {
    const items = this.variants().map(v => ({
      childId: v.id,
      unitPrice: v.unitPrice,
      purchasePrice: v.purchasePrice ?? undefined,
      barcode: v.barcode ?? null
    }));
    this.saving.set(true);
    this.productService.bulkUpdateVariantPrices(this.parentProductId, { mode: 'absolute', items }).subscribe({
      next: res => {
        this.saving.set(false);
        if (res.success) {
          this.toastService.add({
            severity: 'success',
            summary: $localize`:@@product-variant-matrix.component.summary.Prix:Prix`,
            detail: $localize`:@@shared.product-variant-matrix.ts.p.variante.s.mise.s.a.jour.5947452a:${res.data ?? 0}:p: variante(s) mise(s) à jour.`
          });
          this.load();
          return;
        }

        // Un refus arrivait ici sans rien afficher : le bouton se déverrouillait et l'écran
        // restait tel quel, laissant croire à un enregistrement. C'est devenu bloquant depuis
        // que le serveur refuse un code-barres en doublon ou d'une symbologie non activée.
        this.toastService.add({
          severity: 'warn',
          summary: $localize`:@@product-variant-matrix.component.summary.Enregistrement_r:Enregistrement refusé`,
          detail: res.message || res.errors?.[0] || $localize`:@@shared.product-variant-matrix.ts.verifiez.les.prix.et.les.codes.barres.sa.e1f0fba8:Vérifiez les prix et les codes-barres saisis.`
        });
      },
      error: (err: unknown) => {
        this.saving.set(false);
        const detail =
          (err as { error?: { message?: string; error?: string } })?.error?.message ??
          (err as { error?: { message?: string; error?: string } })?.error?.error ??
          $localize`:@@ui.tern.verifiez.les.prix.et.les.codes.barres.sais.e1f0fb:Vérifiez les prix et les codes-barres saisis.`;
        this.toastService.add({
          severity: 'error',
          summary: $localize`:@@product-variant-matrix.component.summary.Enregistrement_r:Enregistrement refusé`,
          detail
        });
      }
    });
  }
}
