import {

  Component,

  EventEmitter,

  Input,

  OnChanges,

  OnInit,

  Output,

  SimpleChanges,

  inject,

  signal

} from '@angular/core';

import { CommonModule } from '@angular/common';

import { FormsModule } from '@angular/forms';

import { DialogModule } from 'primeng/dialog';

import { InputTextModule } from 'primeng/inputtext';

import { InputNumberModule } from 'primeng/inputnumber';

import { InputSwitchModule } from 'primeng/inputswitch';

import { SelectModule } from 'primeng/select';

import { AutoCompleteModule } from 'primeng/autocomplete';

import { FormSectionComponent } from '@shared/components/form-section/form-section.component';

import { ButtonComponent } from '@shared/components/button/button.component';

import {

  Promotion,

  PromotionDiscountType,

  CreatePromotionRequest,

  UpdatePromotionRequest

} from '@core/services/pricing.service';

import { ProductService } from '@core/services/product.service';

import { ClientService } from '@core/services/client.service';

import { ProductCategoryService } from '@core/services/product-category.service';

import { buildScopePreview } from './promotions.utils';



interface DiscountTypeOption {

  label: string;

  value: PromotionDiscountType;

}



interface ProductOption {

  id: string;

  label: string;

}



interface ClientOption {

  id: string;

  label: string;

}



export interface PromotionFormValue {

  name: string;

  startsOn: string;

  endsOn: string;

  discountType: PromotionDiscountType;

  discountPercent: number | null;

  discountAmount: number | null;

  minQuantity: number;

  priority: number;

  isActive: boolean;

  productId: string | null;

  productCategoryId: string | null;

  clientId: string | null;

}



@Component({

  selector: 'app-promotion-form-dialog',

  standalone: true,

  imports: [

    CommonModule,

    FormsModule,

    DialogModule,

    InputTextModule,

    InputNumberModule,

    InputSwitchModule,

    SelectModule,

    AutoCompleteModule,

    FormSectionComponent,

    ButtonComponent

  ],

  template: `

    <p-dialog

      [header]="editing ? loc_ui_tern_modifier_la_promotion_b296fc : loc_ui_tern_nouvelle_promotion_32d111"

      [(visible)]="visible"

      (visibleChange)="visibleChange.emit($event)"

      [modal]="true"

      styleClass="promotion-form-dialog"

      [style]="{ width: '48rem', maxWidth: '95vw' }"

      [contentStyle]="{ 'max-height': '70vh', 'overflow-y': 'auto' }"

      [breakpoints]="{ '960px': '95vw' }"

      [draggable]="false">

      <p class="ft-dialog-intro" i18n="@@settings.promotions.remise.temporaire.appliquee.apres.le.prix.catalo.9c11f762"> Remise temporaire appliquée après le prix catalogue ou la grille. Les documents déjà émis

        conservent leur remise. </p>



      <app-form-section title="Général" i18n-title="Général" icon="pi-file-edit" variant="compact">

        <div class="ft-field ft-field--full">

          <label for="pr-name"><ng-container i18n="@@settings.promotions.nom.7ff20370">Nom </ng-container> <span class="ft-required" i18n="@@settings.promotions.text.df58248c">*</span></label>

          <input id="pr-name" pInputText [(ngModel)]="form.name" maxlength="100" [disabled]="saving" />

        </div>

        <div class="ft-form-grid">

          <div class="ft-field">

            <label for="pr-start"><ng-container i18n="@@settings.promotions.debut.f0955314">Début </ng-container> <span class="ft-required" i18n="@@settings.promotions.text.df58248c">*</span></label>

            <input id="pr-start" type="date" pInputText [(ngModel)]="form.startsOn" [disabled]="saving" />

          </div>

          <div class="ft-field">

            <label for="pr-end"><ng-container i18n="@@settings.promotions.fin.4251065f">Fin </ng-container> <span class="ft-required" i18n="@@settings.promotions.text.df58248c">*</span></label>

            <input id="pr-end" type="date" pInputText [(ngModel)]="form.endsOn" [disabled]="saving" />

          </div>

        </div>

        @if (dateRangeInvalid()) {

          <p class="ft-field-error" i18n="@@settings.promotions.la.fin.ne.peut.pas.preceder.le.debut.48ee99fb">La fin ne peut pas précéder le début.</p>

        }

      </app-form-section>



      <app-form-section title="Portée" i18n-title="Portée" icon="pi-filter" variant="compact">

        <div class="ft-form-grid">

          <div class="ft-field">

            <label for="pr-product" i18n="@@settings.promotions.produit.optionnel.149c218f">Produit (optionnel)</label>

            <p-autoComplete

              inputId="pr-product"

              [(ngModel)]="selectedProduct"

              [suggestions]="productSuggestions()"

              (completeMethod)="searchProducts($event)"

              (ngModelChange)="onProductChange($event)"

              field="label"

              [forceSelection]="true"

              [dropdown]="true"

              [placeholder]="loadingProductLabel() ? loc_ui_tern_chargement_01cba1 : loc_ui_tern_tous_les_produits_si_vide_846983"

              appendTo="body"

              [disabled]="saving || !!selectedCategoryId || loadingProductLabel()"></p-autoComplete>

            <small class="ft-hint" i18n="@@settings.promotions.laisser.vide.pour.tous.les.produits.4d7d99ee">Laisser vide pour tous les produits</small>

            @if (selectedCategoryId) {

              <small class="ft-hint" i18n="@@settings.promotions.desactive.une.categorie.est.selectionnee.8767abd1">Désactivé : une catégorie est sélectionnée</small>

            }

          </div>

          <div class="ft-field">

            <label for="pr-category" i18n="@@settings.promotions.categorie.optionnel.61e8316d">Catégorie (optionnel)</label>

            <p-select

              inputId="pr-category"

              [options]="categoryOptions()"

              [(ngModel)]="selectedCategoryId"

              (ngModelChange)="onCategoryChange($event)"

              optionLabel="label"

              optionValue="value"

              [showClear]="true"

              placeholder="Toutes les catégories si vide" i18n-placeholder="Toutes les catégories si vide"

              appendTo="body"

              [disabled]="saving || !!selectedProduct"></p-select>

            <small class="ft-hint" i18n="@@settings.promotions.laisser.vide.pour.toutes.les.categories.4768ea01">Laisser vide pour toutes les catégories</small>

            @if (selectedProduct) {

              <small class="ft-hint" i18n="@@settings.promotions.desactive.un.produit.est.selectionne.6ad5b763">Désactivé : un produit est sélectionné</small>

            }

          </div>

          <div class="ft-field ft-field--full">

            <label for="pr-client" i18n="@@settings.promotions.client.optionnel.14c8cf94">Client (optionnel)</label>

            <p-autoComplete

              inputId="pr-client"

              [(ngModel)]="selectedClient"

              [suggestions]="clientSuggestions()"

              (completeMethod)="searchClients($event)"

              (ngModelChange)="onClientChange($event)"

              field="label"

              [forceSelection]="true"

              [dropdown]="true"

              [placeholder]="loadingClientLabel() ? loc_ui_tern_chargement_01cba1 : loc_ui_tern_tous_les_clients_si_vide_b6fc94"

              appendTo="body"

              [disabled]="saving || loadingClientLabel()"></p-autoComplete>

            <small class="ft-hint" i18n="@@settings.promotions.laisser.vide.pour.tous.les.clients.3c108910">Laisser vide pour tous les clients</small>

          </div>

        </div>

        <div class="scope-preview" role="status" aria-live="polite">

          <i class="pi pi-info-circle scope-preview__icon" aria-hidden="true"></i>

          <span>{{ scopePreview() }}</span>

        </div>

      </app-form-section>



      <app-form-section title="Remise" i18n-title="Remise" icon="pi-percentage" variant="compact">

        <div class="ft-form-grid">

          <div class="ft-field">

            <label for="pr-type" i18n="@@settings.promotions.forme.de.la.remise.f75501ac">Forme de la remise</label>

            <p-select

              inputId="pr-type"

              [options]="discountTypes"

              [(ngModel)]="form.discountType"

              optionLabel="label"

              optionValue="value"

              appendTo="body"

              [disabled]="saving"></p-select>

          </div>

          <div class="ft-field">

            @if (form.discountType === 'Percentage') {

              <label for="pr-pct"><ng-container i18n="@@settings.promotions.taux.bb9a8c5a">Taux (%) </ng-container> <span class="ft-required" i18n="@@settings.promotions.text.df58248c">*</span></label>

              <p-inputNumber

                inputId="pr-pct"

                [(ngModel)]="form.discountPercent"

                mode="decimal"

                [minFractionDigits]="0"

                [maxFractionDigits]="2"

                [min]="0"

                [max]="100"

                [disabled]="saving"></p-inputNumber>

            } @else {

              <label for="pr-amt"><ng-container i18n="@@settings.promotions.montant.par.unite.800d8a4e">Montant par unité </ng-container> <span class="ft-required" i18n="@@settings.promotions.text.df58248c">*</span></label>

              <p-inputNumber

                inputId="pr-amt"

                [(ngModel)]="form.discountAmount"

                mode="decimal"

                [minFractionDigits]="3"

                [maxFractionDigits]="3"

                [min]="0"

                [disabled]="saving"></p-inputNumber>

            }

          </div>

          <div class="ft-field">

            <label for="pr-minqty" i18n="@@settings.promotions.quantite.minimale.e3df8291">Quantité minimale</label>

            <p-inputNumber

              inputId="pr-minqty"

              [(ngModel)]="form.minQuantity"

              mode="decimal"

              [minFractionDigits]="0"

              [maxFractionDigits]="4"

              [min]="1"

              [disabled]="saving"></p-inputNumber>

          </div>

          <div class="ft-field">

            <label for="pr-priority" i18n="@@settings.promotions.priorite.eede91d2">Priorité</label>

            <p-inputNumber

              inputId="pr-priority"

              [(ngModel)]="form.priority"

              [min]="0"

              [disabled]="saving"></p-inputNumber>

          </div>

        </div>

        <div class="ft-field ft-field--full promotion-form-dialog__priority-hint">

          <small class="ft-hint" i18n="@@settings.promotions.la.plus.elevee.gagne.a.egalite.c.est.la.plus.cib.d47795fd"> La plus élevée gagne ; à égalité, c'est la plus ciblée qui s'applique. </small>

        </div>

      </app-form-section>



      @if (editing) {

        <div class="promotion-form-dialog__status ft-field ft-field--inline">

          <p-inputSwitch [(ngModel)]="form.isActive" inputId="pr-active" [disabled]="saving"></p-inputSwitch>

          <label for="pr-active" i18n="@@settings.promotions.promotion.active.9ee0381f">Promotion active</label>

        </div>

        <small class="ft-hint promotion-form-dialog__status-hint" i18n="@@settings.promotions.desactiver.n.affecte.aucun.document.deja.emis.50f0b090"> Désactiver n'affecte aucun document déjà émis. </small>

      }



      <ng-template pTemplate="footer">

        <app-button variant="secondary" (clicked)="close()" i18n="@@settings.promotions.annuler.49ba3292">Annuler</app-button>

        <app-button variant="primary" [disabled]="!canSave() || saving" (clicked)="submit()" i18n="@@settings.promotions.enregistrer.f7c8bcd8"> Enregistrer </app-button>

      </ng-template>

    </p-dialog>

  `,

  styles: [

    `

      .scope-preview {

        display: flex;

        align-items: flex-start;

        gap: var(--spacing-2);

        margin-top: var(--spacing-4);

        padding: var(--spacing-3);

        border-radius: var(--radius-md);

        border: 1px solid var(--color-primary-200);

        background: var(--color-primary-50);

        color: var(--color-primary-800);

        font-size: var(--font-size-sm);

        font-weight: var(--font-weight-medium);

        line-height: 1.5;

      }



      .scope-preview__icon {

        flex-shrink: 0;

        margin-top: 0.125rem;

        color: var(--color-primary-600);

      }



      .ft-field-error {

        margin: var(--spacing-2) 0 0;

        color: var(--color-danger-600);

        font-size: var(--font-size-sm);

      }



      .promotion-form-dialog__priority-hint {

        margin-top: var(--spacing-2);

      }



      .promotion-form-dialog__status {

        margin-top: var(--spacing-2);

      }



      .promotion-form-dialog__status-hint {

        display: block;

        margin-top: var(--spacing-1);

        margin-bottom: var(--spacing-2);

      }



      :host ::ng-deep .promotion-form-dialog {

        .ft-field .p-inputnumber,

        .ft-field .p-select,

        .ft-field .p-autocomplete {

          width: 100%;

        }



        .p-inputnumber-input {

          width: 100%;

        }

      }

    `

  ]

})

export class PromotionFormDialogComponent implements OnInit, OnChanges {
  readonly loc_ui_tern_modifier_la_promotion_b296fc = $localize`:@@ui.tern.modifier.la.promotion.b296fc:Modifier la promotion`;
  readonly loc_ui_tern_nouvelle_promotion_32d111 = $localize`:@@ui.tern.nouvelle.promotion.32d111:Nouvelle promotion`;
  readonly loc_ui_tern_chargement_01cba1 = $localize`:@@ui.tern.chargement.01cba1:Chargement…`;
  readonly loc_ui_tern_tous_les_produits_si_vide_846983 = $localize`:@@ui.tern.tous.les.produits.si.vide.846983:Tous les produits si vide`;
  readonly loc_ui_tern_tous_les_clients_si_vide_b6fc94 = $localize`:@@ui.tern.tous.les.clients.si.vide.b6fc94:Tous les clients si vide`;

  private readonly productService = inject(ProductService);

  private readonly clientService = inject(ClientService);

  private readonly categoryService = inject(ProductCategoryService);



  @Input() visible = false;

  @Input() editing: Promotion | null = null;

  @Input() saving = false;



  @Output() visibleChange = new EventEmitter<boolean>();

  @Output() save = new EventEmitter<PromotionFormValue>();



  readonly productSuggestions = signal<ProductOption[]>([]);

  readonly clientSuggestions = signal<ClientOption[]>([]);

  readonly categoryOptions = signal<{ label: string; value: string }[]>([]);

  readonly loadingProductLabel = signal(false);

  readonly loadingClientLabel = signal(false);



  selectedProduct: ProductOption | null = null;

  selectedClient: ClientOption | null = null;

  selectedCategoryId: string | null = null;



  form: PromotionFormValue = this.emptyForm();



  readonly discountTypes: DiscountTypeOption[] = [

    { label: 'Pourcentage', value: 'Percentage' },

    { label: 'Montant par unité', value: 'Amount' }

  ];



  ngOnInit(): void {

    this.categoryService.getCategoryOptionsForDropdown().subscribe({

      next: options => this.categoryOptions.set(options),

      error: () => this.categoryOptions.set([])

    });

  }



  ngOnChanges(changes: SimpleChanges): void {

    if (changes['visible']?.currentValue === true || changes['editing']) {

      this.resetForm();

    }

  }



  scopePreview(): string {

    const categoryLabel =

      this.selectedCategoryId != null

        ? (this.categoryOptions().find(o => o.value === this.selectedCategoryId)?.label ?? null)

        : null;



    return buildScopePreview(

      this.selectedProduct?.label ?? null,

      categoryLabel,

      this.selectedClient?.label ?? null

    );

  }



  dateRangeInvalid(): boolean {

    return !!this.form.startsOn && !!this.form.endsOn && this.form.endsOn < this.form.startsOn;

  }



  canSave(): boolean {

    if (!this.form.name.trim() || !this.form.startsOn || !this.form.endsOn) return false;

    if (this.dateRangeInvalid()) return false;

    if (this.selectedProduct && this.selectedCategoryId) return false;



    return this.form.discountType === 'Percentage'

      ? (this.form.discountPercent ?? 0) > 0

      : (this.form.discountAmount ?? 0) > 0;

  }



  searchProducts(event: { query: string }): void {

    this.productService.getProducts({ search: event.query, pageSize: 20 }).subscribe({

      next: res => {

        const items = res.data?.items ?? [];

        this.productSuggestions.set(

          items.map(p => ({ id: p.id, label: `${p.code} — ${p.name}` }))

        );

      },

      error: () => this.productSuggestions.set([])

    });

  }



  searchClients(event: { query: string }): void {

    this.clientService.getClients({ search: event.query, pageSize: 20, isActive: true }).subscribe({

      next: res => {

        const items = (res.data?.items ?? []).map(c => ({ id: c.id, label: c.name }));

        this.clientSuggestions.set(items);

      },

      error: () => this.clientSuggestions.set([])

    });

  }



  onProductChange(product: ProductOption | null): void {

    if (product) {

      this.selectedCategoryId = null;

    }

  }



  onCategoryChange(categoryId: string | null): void {

    if (categoryId) {

      this.selectedProduct = null;

    }

  }



  onClientChange(_client: ClientOption | null): void {

    // scope preview updates via template binding

  }



  close(): void {

    this.visibleChange.emit(false);

  }



  submit(): void {

    if (!this.canSave()) return;

    this.save.emit({

      ...this.form,

      name: this.form.name.trim(),

      productId: this.selectedProduct?.id ?? null,

      productCategoryId: this.selectedProduct ? null : this.selectedCategoryId,

      clientId: this.selectedClient?.id ?? null

    });

  }



  private resetForm(): void {

    const today = new Date().toISOString().substring(0, 10);

    this.loadingProductLabel.set(false);

    this.loadingClientLabel.set(false);



    if (this.editing) {

      this.form = {

        name: this.editing.name,

        startsOn: this.editing.startsOn.substring(0, 10),

        endsOn: this.editing.endsOn.substring(0, 10),

        discountType: this.editing.discountType,

        discountPercent: this.editing.discountPercent,

        discountAmount: this.editing.discountAmount,

        minQuantity: this.editing.minQuantity,

        priority: this.editing.priority,

        isActive: this.editing.isActive,

        productId: this.editing.productId,

        productCategoryId: this.editing.productCategoryId,

        clientId: this.editing.clientId

      };

      this.selectedProduct = null;

      this.selectedCategoryId = this.editing.productCategoryId;

      this.selectedClient = null;



      if (this.editing.productId) {

        this.loadingProductLabel.set(true);

        this.productService.getProduct(this.editing.productId).subscribe({

          next: res => {

            const p = res.data;

            if (p) {

              this.selectedProduct = { id: p.id, label: `${p.code} — ${p.name}` };

            }

          },

          complete: () => this.loadingProductLabel.set(false),

          error: () => this.loadingProductLabel.set(false)

        });

      }

      if (this.editing.clientId) {

        this.loadingClientLabel.set(true);

        this.clientService.getClient(this.editing.clientId).subscribe({

          next: res => {

            const c = res.data;

            if (c) {

              this.selectedClient = { id: c.id, label: c.name };

            }

          },

          complete: () => this.loadingClientLabel.set(false),

          error: () => this.loadingClientLabel.set(false)

        });

      }

    } else {

      this.form = this.emptyForm(today);

      this.selectedProduct = null;

      this.selectedCategoryId = null;

      this.selectedClient = null;

    }

  }



  private emptyForm(today = new Date().toISOString().substring(0, 10)): PromotionFormValue {

    return {

      name: '',

      startsOn: today,

      endsOn: today,

      discountType: 'Percentage',

      discountPercent: null,

      discountAmount: null,

      minQuantity: 1,

      priority: 0,

      isActive: true,

      productId: null,

      productCategoryId: null,

      clientId: null

    };

  }

}



export function toCreateRequest(value: PromotionFormValue): CreatePromotionRequest {

  return {

    name: value.name,

    startsOn: value.startsOn,

    endsOn: value.endsOn,

    discountType: value.discountType,

    discountPercent: value.discountType === 'Percentage' ? value.discountPercent : null,

    discountAmount: value.discountType === 'Amount' ? value.discountAmount : null,

    productId: value.productId,

    productCategoryId: value.productCategoryId,

    clientId: value.clientId,

    minQuantity: value.minQuantity,

    priority: value.priority

  };

}



export function toUpdateRequest(value: PromotionFormValue): UpdatePromotionRequest {

  return {

    name: value.name,

    startsOn: value.startsOn,

    endsOn: value.endsOn,

    discountType: value.discountType,

    discountPercent: value.discountType === 'Percentage' ? value.discountPercent : null,

    discountAmount: value.discountType === 'Amount' ? value.discountAmount : null,

    minQuantity: value.minQuantity,

    priority: value.priority,

    isActive: value.isActive,

    productId: value.productId,

    productCategoryId: value.productCategoryId,

    clientId: value.clientId

  };

}


