/// <reference types="@angular/localize" />
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  computed,
  inject,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { InputNumberModule } from 'primeng/inputnumber';
import { CheckboxModule } from 'primeng/checkbox';

import { ProductService, LabelLayout } from '@core/services/product.service';
import { ToastService } from '@core/services/toast.service';
import { ButtonComponent } from '@shared/components/button/button.component';

/** Article dont on veut imprimer des étiquettes. */
export interface LabelPrintTarget {
  id: string;
  name: string;
  hasBarcode: boolean;
}

/**
 * Choix du gabarit et de la quantité, puis téléchargement du PDF.
 *
 * <p>
 * Le nombre de planches est affiché avant l'impression : c'est le seul moment où l'utilisateur
 * peut encore éviter de lancer huit feuilles pour trois étiquettes.
 * </p>
 */
@Component({
  selector: 'ft-print-labels-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DialogModule,
    SelectModule,
    InputNumberModule,
    CheckboxModule,
    ButtonComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p-dialog
      header="Imprimer les étiquettes" i18n-header="@@products.components.imprimer.les.etiquettes.ff40cf1e"
      [visible]="visible"
      (visibleChange)="onVisibleChange($event)"
      [modal]="true"
      [draggable]="false"
      [style]="{ width: '460px' }">

      @if (target) {
        <p class="target-name">{{ target.name }}</p>

        @if (!target.hasBarcode) {
          <p class="hint hint--warn" i18n="@@products.components.cet.article.n.a.pas.de.code.barres.l.eti.86e730f4">
            <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
            Cet article n'a pas de code-barres : l'étiquette portera son code interne en clair.
          </p>
        }

        <div class="field">
          <label for="label-layout" i18n="@@products.components.gabarit.abd6ed45">Gabarit</label>
          <p-select
            inputId="label-layout"
            [options]="layouts()"
            [(ngModel)]="selectedLayout"
            optionLabel="label"
            optionValue="key"
            placeholder="Choisir un gabarit" i18n-placeholder="@@products.components.choisir.un.gabarit.8b120da1"
            styleClass="w-full">
          </p-select>
        </div>

        <div class="field">
          <label for="label-qty" i18n="@@products.components.nombre.d.etiquettes.cc444f8e">Nombre d'étiquettes</label>
          <p-inputNumber
            inputId="label-qty"
            [(ngModel)]="quantity"
            [min]="1"
            [max]="500"
            [showButtons]="true"
            styleClass="w-full">
          </p-inputNumber>
        </div>

        <div class="field field--check">
          <p-checkbox inputId="label-price" [(ngModel)]="includePrice" [binary]="true"></p-checkbox>
          <label for="label-price" i18n="@@products.components.imprimer.le.prix.ttc.360b03e0">Imprimer le prix TTC</label>
        </div>

        @if (sheetsLabel()) {
          <p class="hint">
            <i class="pi pi-print" aria-hidden="true"></i>
            {{ sheetsLabel() }}
          </p>
        }
      }

      <ng-template pTemplate="footer">
        <app-button variant="outline" (clicked)="close()" i18n="@@products.components.annuler.49ba3292">Annuler</app-button>
        <app-button
          variant="primary"
          icon="pi-download"
          iconPos="left"
          [disabled]="!selectedLayout || quantity < 1 || generating()"
          (clicked)="generate()" i18n="@@products.components.generer.le.pdf.09958b8a"> Générer le PDF </app-button>
      </ng-template>
    </p-dialog>
  `,
  styles: [
    `
      .target-name {
        font-weight: 600;
        margin: 0 0 0.75rem;
      }
      .field {
        margin-bottom: 0.9rem;
      }
      .field label {
        display: block;
        margin-bottom: 0.3rem;
        font-size: 0.85rem;
      }
      .field--check {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .field--check label {
        margin: 0;
      }
      .hint {
        font-size: 0.8rem;
        color: var(--text-color-secondary, #6b7280);
        display: flex;
        align-items: center;
        gap: 0.4rem;
        margin: 0;
      }
      .hint--warn {
        color: var(--orange-600, #c2410c);
        margin-bottom: 0.9rem;
      }
      .w-full {
        width: 100%;
      }
    `
  ]
})
export class PrintLabelsDialogComponent {
  private readonly productService = inject(ProductService);
  private readonly toastService = inject(ToastService);

  /**
   * Les gabarits ne sont chargés qu'à la PREMIÈRE ouverture.
   *
   * Les charger à l'initialisation déclencherait une requête sur chaque affichage de la fiche
   * article et de la liste, alors que la plupart des visites n'imprimeront jamais d'étiquette.
   */
  @Input()
  set visible(value: boolean) {
    this.visibleState = value;
    if (value) this.ensureLayoutsLoaded();
  }
  get visible(): boolean {
    return this.visibleState;
  }

  @Input() target: LabelPrintTarget | null = null;

  @Output() visibleChange = new EventEmitter<boolean>();

  readonly layouts = signal<LabelLayout[]>([]);
  readonly generating = signal(false);

  selectedLayout: string | null = null;
  quantity = 1;
  includePrice = false;

  private visibleState = false;
  private layoutsRequested = false;

  private readonly quantitySignal = signal(1);
  private readonly layoutSignal = signal<string | null>(null);

  readonly sheetsLabel = computed(() => {
    const key = this.layoutSignal();
    const layout = this.layouts().find(l => l.key === key);
    if (!layout) return null;

    const qty = this.quantitySignal();
    const sheets = Math.ceil(qty / Math.max(1, layout.labelsPerPage));

    return layout.isRoll
      ? $localize`:@@ui.tern.ph.etiquette.s.en.continu.f42d7c:${qty}:p0: étiquette(s) en continu.`
      : $localize`:@@ui.tern.ph.etiquette.s.sur.ph.planche.s.de.ph.761668:${qty}:p0: étiquette(s) sur ${sheets}:p1: planche(s) de ${layout.labelsPerPage}:p2:.`;
  });

  private ensureLayoutsLoaded(): void {
    if (this.layoutsRequested) return;
    this.layoutsRequested = true;

    this.productService.getLabelLayouts().subscribe({
      next: response => {
        if (!response.success || !response.data) return;
        this.layouts.set(response.data);
        if (!this.selectedLayout && response.data.length > 0) {
          this.selectedLayout = response.data[0].key;
          this.layoutSignal.set(this.selectedLayout);
        }
      },
      // Une nouvelle tentative reste possible à la prochaine ouverture.
      error: () => (this.layoutsRequested = false)
    });
  }

  onVisibleChange(value: boolean): void {
    this.visibleState = value;
    this.visibleChange.emit(value);
  }

  close(): void {
    this.onVisibleChange(false);
  }

  generate(): void {
    if (!this.target || !this.selectedLayout) return;

    // Les signaux miroirs alimentent l'aperçu du nombre de planches ; ngModel seul ne
    // déclencherait pas le calcul avec une détection OnPush.
    this.quantitySignal.set(this.quantity);
    this.layoutSignal.set(this.selectedLayout);

    this.generating.set(true);
    this.productService
      .exportProductLabels({
        layout: this.selectedLayout,
        includePrice: this.includePrice,
        includeCode: true,
        items: [{ productId: this.target.id, quantity: this.quantity }]
      })
      .subscribe({
        next: blob => {
          this.generating.set(false);
          this.download(blob);
          this.close();
        },
        error: () => this.generating.set(false)
      });
  }

  private download(blob: Blob): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `etiquettes_${this.selectedLayout}.pdf`;
    link.click();
    // Révocation différée : sans cela, Firefox annule le téléchargement en cours.
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    this.toastService.add({
      severity: 'success',
      summary: $localize`:@@print-labels-dialog.component.summary.Étiquettes:Étiquettes`,
      detail: $localize`:@@print-labels-dialog.component.detail.Le PDF a été:Le PDF a été téléchargé.`
    });
  }
}
