import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { Textarea } from 'primeng/textarea';
import { InputSwitchModule } from 'primeng/inputswitch';
import { AutoCompleteModule, AutoCompleteCompleteEvent, AutoCompleteSelectEvent } from 'primeng/autocomplete';
import { MessageModule } from 'primeng/message';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { FormSectionComponent } from '@shared/components/form-section/form-section.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import {
  CrmService,
  CreateQuoteTemplatePayload,
  QuoteTemplateDto,
  UpdateQuoteTemplatePayload,
} from '../services/crm.service';
import { ProductService, ProductListItem } from '@core/services/product.service';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';

interface TemplateLineRow {
  product: ProductListItem | null;
  quantity: number;
  customUnitPrice: number | null;
  discountPercent: number | null;
}

@Component({
  selector: 'app-quote-template-form',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    ButtonModule,
    InputTextModule,
    InputNumberModule,
    Textarea,
    InputSwitchModule,
    AutoCompleteModule,
    MessageModule,
    BreadcrumbComponent,
    FormSectionComponent,
    ButtonComponent,
  ],
  template: `
    <app-breadcrumb [items]="breadcrumbItems"></app-breadcrumb>

    <div class="form-container">
      <h1 class="page-title">{{ isEdit() ? 'Modifier le modèle' : 'Nouveau modèle de devis' }}</h1>
      <p class="page-subtitle" i18n="@@crm.quote-templates.definissez.les.lignes.produits.la.validite.par.d.ebd25d30">Définissez les lignes produits, la validité par défaut et les textes réutilisés lors de la création d'un devis.</p>

      <form (ngSubmit)="onSubmit()" class="quote-template-form">
        <app-form-section title="Informations générales" i18n-title="Informations générales" icon="pi-bookmark" [number]="1">
          <div class="form-grid">
            <div class="field span-2">
              <label for="name">Nom <span class="required" i18n="@@crm.quote-templates.text.df58248c">*</span></label>
              <input pInputText id="name" [(ngModel)]="name" name="name" class="w-full" required />
            </div>
            <div class="field span-2">
              <label for="description" i18n="@@crm.quote-templates.description.55f8ebc8">Description</label>
              <input pInputText id="description" [(ngModel)]="description" name="description" class="w-full" />
            </div>
            <div class="field">
              <label for="validity">Validité par défaut (jours) <span class="required" i18n="@@crm.quote-templates.text.df58248c">*</span></label>
              <p-inputNumber
                id="validity"
                [(ngModel)]="defaultValidityDays"
                name="validity"
                [min]="1"
                [max]="3650"
                [showButtons]="true"
                styleClass="w-full">
              </p-inputNumber>
            </div>
            @if (isEdit()) {
              <div class="field switch-field">
                <label for="isActive" i18n="@@crm.quote-templates.modele.actif.61a8a78c">Modèle actif</label>
                <p-inputSwitch inputId="isActive" [(ngModel)]="isActive" name="isActive"></p-inputSwitch>
              </div>
            }
          </div>
        </app-form-section>

        <app-form-section title="Lignes du modèle" i18n-title="Lignes du modèle" icon="pi-list" [number]="2">
          <div class="lines-actions">
            <app-button variant="secondary" icon="pi-plus" iconPos="left" type="button" (click)="addLine()" i18n="@@crm.quote-templates.ajouter.une.ligne.ba241fd4">Ajouter une ligne</app-button>
          </div>
          <div class="lines-table-wrap">
            <table class="lines-table">
              <thead>
                <tr>
                  <th style="width: 36%">Produit <span class="required" i18n="@@crm.quote-templates.text.df58248c">*</span></th>
                  <th style="width: 12%">Qté <span class="required" i18n="@@crm.quote-templates.text.df58248c">*</span></th>
                  <th style="width: 16%" i18n="@@crm.quote-templates.prix.unit.ht.optionnel.ba9c62c4">Prix unit. HT (optionnel)</th>
                  <th style="width: 12%" i18n="@@crm.quote-templates.remise.a39386b5">Remise %</th>
                  <th style="width: 8%"></th>
                </tr>
              </thead>
              <tbody>
                @for (line of lines; track $index) {
                  <tr>
                    <td>
                      <p-autoComplete
                        [(ngModel)]="line.product"
                        [name]="'prod-' + $index"
                        [suggestions]="productSuggestions()"
                        (completeMethod)="searchProducts($event)"
                        (onSelect)="onProductSelect(line, $event)"
                        field="name"
                        [dropdown]="true"
                        [forceSelection]="true"
                        placeholder="Rechercher un produit..." i18n-placeholder="Rechercher un produit..."
                        styleClass="w-full"
                        inputStyleClass="w-full">
                        <ng-template let-product pTemplate="item">
                          <div class="product-item">
                            <span class="font-bold">{{ product.code }}</span> — {{ product.name }}
                          </div>
                        </ng-template>
                      </p-autoComplete>
                    </td>
                    <td>
                      <p-inputNumber
                        [(ngModel)]="line.quantity"
                        [name]="'qty-' + $index"
                        [min]="0.001"
                        [minFractionDigits]="0"
                        [maxFractionDigits]="3"
                        mode="decimal"
                        styleClass="w-full">
                      </p-inputNumber>
                    </td>
                    <td>
                      <p-inputNumber
                        [(ngModel)]="line.customUnitPrice"
                        [name]="'price-' + $index"
                        [min]="0"
                        [minFractionDigits]="2"
                        [maxFractionDigits]="3"
                        mode="decimal"
                        [allowEmpty]="true"
                        placeholder="Prix catalogue" i18n-placeholder="Prix catalogue"
                        styleClass="w-full">
                      </p-inputNumber>
                    </td>
                    <td>
                      <p-inputNumber
                        [(ngModel)]="line.discountPercent"
                        [name]="'disc-' + $index"
                        [min]="0"
                        [max]="100"
                        [minFractionDigits]="0"
                        [maxFractionDigits]="1"
                        mode="decimal"
                        suffix="%"
                        [allowEmpty]="true"
                        styleClass="w-full">
                      </p-inputNumber>
                    </td>
                    <td>
                      <app-button
                        variant="ghost"
                        size="sm"
                        icon="pi-trash"
                        [iconOnly]="true"
                        type="button"
                        (click)="removeLine($index)"
                        [disabled]="lines.length <= 1"
                        ariaLabel="Supprimer la ligne">
                      </app-button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </app-form-section>

        <app-form-section title="Notes et conditions par défaut" i18n-title="Notes et conditions par défaut" icon="pi-file-edit" [number]="3">
          <div class="field">
            <label for="notes" i18n="@@crm.quote-templates.notes.70440046">Notes</label>
            <textarea
              pTextarea
              id="notes"
              [(ngModel)]="defaultNotes"
              name="notes"
              [rows]="2"
              class="w-full">
            </textarea>
          </div>
          <div class="field mt-3">
            <label for="terms" i18n="@@crm.quote-templates.conditions.generales.0c152db4">Conditions générales</label>
            <textarea
              pTextarea
              id="terms"
              [(ngModel)]="defaultTermsAndConditions"
              name="terms"
              [rows]="2"
              class="w-full">
            </textarea>
          </div>
        </app-form-section>

        @if (submitError()) {
          <div class="submit-error-banner" role="alert" aria-live="polite">
            <p-message severity="error" [text]="submitError()!" styleClass="w-full"></p-message>
            @if (conflictReloadOffered() && isEdit()) {
              <div class="conflict-reload-actions">
                <app-button variant="secondary" type="button" (click)="reloadAfterConflict()" i18n="@@crm.quote-templates.recharger.le.modele.85129767">Recharger le modèle</app-button>
              </div>
            }
          </div>
        }

        <div class="form-actions">
          <app-button variant="outline" icon="pi-times" iconPos="left" type="button" routerLink="/crm/quote-templates" i18n="@@crm.quote-templates.annuler.49ba3292">Annuler</app-button>
          <app-button
            variant="primary"
            [icon]="submitting() ? 'pi-spin pi-spinner' : 'pi-check'"
            iconPos="left"
            type="submit"
            [disabled]="!canSubmit() || submitting()">
            {{ submitting() ? 'Enregistrement…' : isEdit() ? 'Enregistrer' : 'Créer le modèle' }}
          </app-button>
        </div>
      </form>
    </div>
  `,
  styles: [
    `
      .form-container {
        max-width: 1200px;
        margin: 0 auto;
        padding: var(--spacing-6) 0;
      }
      .page-title {
        font-size: var(--font-size-2xl);
        font-weight: var(--font-weight-bold);
        color: var(--color-text-primary);
        margin: 0 0 var(--spacing-3);
      }
      .page-subtitle {
        color: var(--color-text-secondary);
        margin: 0 0 var(--spacing-8);
        font-size: var(--font-size-base);
      }
      .quote-template-form {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-6);
      }
      .form-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--spacing-4);
      }
      .span-2 {
        grid-column: 1 / -1;
      }
      .switch-field {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-2);
        justify-content: flex-end;
      }
      @media (max-width: 768px) {
        .form-grid {
          grid-template-columns: 1fr;
        }
        .span-2 {
          grid-column: span 1;
        }
      }
      .field {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-2);
      }
      .field label {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-semibold);
        color: var(--color-text-primary);
      }
      .required {
        color: var(--color-error-600);
      }
      .mt-3 {
        margin-top: var(--spacing-3);
      }
      .w-full {
        width: 100%;
      }
      .lines-actions {
        margin-bottom: var(--spacing-4);
      }
      .lines-table-wrap {
        overflow-x: auto;
      }
      .lines-table {
        width: 100%;
        border-collapse: collapse;
      }
      .lines-table th,
      .lines-table td {
        padding: var(--spacing-3);
        text-align: left;
        vertical-align: top;
      }
      .lines-table th {
        font-size: var(--font-size-xs);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--color-text-secondary);
        background: var(--color-background-subtle);
        font-weight: var(--font-weight-semibold);
        border-bottom: 1px solid var(--color-border-subtle);
      }
      .font-bold {
        font-weight: bold;
      }
      .product-item {
        display: flex;
        flex-direction: column;
      }
      .submit-error-banner {
        margin-bottom: var(--spacing-4);
      }
      .conflict-reload-actions {
        margin-top: var(--spacing-3);
      }
      .form-actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--spacing-4);
        margin-top: var(--spacing-6);
        padding-top: var(--spacing-6);
        border-top: 1px solid var(--color-border-subtle);
      }
      :host ::ng-deep .lines-table p-autocomplete .p-autocomplete {
        width: 100%;
      }
      :host ::ng-deep .lines-table p-autocomplete .p-autocomplete-input {
        width: 100%;
      }
      :host ::ng-deep .lines-table p-inputnumber,
      :host ::ng-deep .lines-table p-inputnumber .p-inputnumber,
      :host ::ng-deep .lines-table p-inputnumber .p-inputtext {
        width: 100%;
      }
    `,
  ],
})
export class QuoteTemplateFormComponent implements OnInit {
  private readonly crm = inject(CrmService);
  private readonly productService = inject(ProductService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly errorHandler = inject(ErrorHandlerService);

  readonly isEdit = signal(false);
  readonly templateId = signal<string | null>(null);

  breadcrumbItems: BreadcrumbItem[] = [
    { label: 'Tableau de bord', route: '/dashboard', icon: 'pi-home' },
    { label: 'CRM Commercial', route: '/crm/dashboard' },
    { label: 'Modèles de devis', route: '/crm/quote-templates' },
    { label: 'Nouveau modèle' },
  ];

  name = '';
  description = '';
  defaultValidityDays = 30;
  defaultNotes = '';
  defaultTermsAndConditions = '';
  isActive = true;

  lines: TemplateLineRow[] = [this.createEmptyLine()];
  productSuggestions = signal<ProductListItem[]>([]);

  submitting = signal(false);
  submitError = signal<string | null>(null);
  /** Shown when save fails with HTTP 409 (e.g. concurrent edit); offers reload of server state. */
  conflictReloadOffered = signal(false);

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.isEdit.set(true);
      this.templateId.set(id);
      this.breadcrumbItems = [
        { label: 'Tableau de bord', route: '/dashboard', icon: 'pi-home' },
        { label: 'CRM Commercial', route: '/crm/dashboard' },
        { label: 'Modèles de devis', route: '/crm/quote-templates' },
        { label: 'Modifier le modèle' },
      ];
      this.loadTemplate(id);
    }
  }

  createEmptyLine(): TemplateLineRow {
    return {
      product: null,
      quantity: 1,
      customUnitPrice: null,
      discountPercent: null,
    };
  }

  addLine(): void {
    this.lines.push(this.createEmptyLine());
  }

  removeLine(i: number): void {
    if (this.lines.length > 1) this.lines.splice(i, 1);
  }

  loadTemplate(id: string): void {
    this.crm.getQuoteTemplate(id).subscribe({
      next: (res) => {
        if (!res.success || !res.data) {
          this.submitError.set(res.error ?? 'Modèle introuvable');
          return;
        }
        this.submitError.set(null);
        this.conflictReloadOffered.set(false);
        this.applyDto(res.data);
      },
      error: (err: HttpErrorResponse) => {
        this.submitError.set(this.errorHandler.extractErrorMessage(err));
      },
    });
  }

  reloadAfterConflict(): void {
    const id = this.templateId();
    if (!id) return;
    this.submitError.set(null);
    this.conflictReloadOffered.set(false);
    this.loadTemplate(id);
  }

  private applyDto(d: QuoteTemplateDto): void {
    this.name = d.name;
    this.description = d.description ?? '';
    this.defaultValidityDays = d.defaultValidityDays;
    this.defaultNotes = d.defaultNotes ?? '';
    this.defaultTermsAndConditions = d.defaultTermsAndConditions ?? '';
    this.isActive = d.isActive;

    if (!d.lines?.length) {
      this.lines = [this.createEmptyLine()];
      return;
    }

    this.lines = d.lines.map((l) => ({
      product: this.minimalProduct(l.productId, l.productName),
      quantity: l.quantity,
      customUnitPrice: l.customUnitPrice ?? null,
      discountPercent: l.discountPercent ?? null,
    }));
  }

  private minimalProduct(id: string, name?: string | null): ProductListItem {
    return {
      id,
      code: '',
      name: name || 'Produit',
      description: null,
      typeDisplay: '',
      categoryId: '',
      category: '',
      unitPrice: 0,
      unit: 'unité',
      vatRate: 19,
      isActive: true,
      isStockManaged: false,
    };
  }

  searchProducts(event: AutoCompleteCompleteEvent): void {
    this.productService
      .getProducts({
        search: event.query,
        isActive: true,
        pageSize: 20,
      })
      .subscribe({
        next: (res) => {
          if (res.success) this.productSuggestions.set(res.data.items);
        },
      });
  }

  onProductSelect(line: TemplateLineRow, event: AutoCompleteSelectEvent): void {
    line.product = event.value as ProductListItem;
  }

  canSubmit(): boolean {
    if (!this.name?.trim()) return false;
    if (this.defaultValidityDays < 1) return false;
    return this.lines.every(
      (l) => l.product !== null && l.quantity > 0
    );
  }

  onSubmit(): void {
    if (!this.canSubmit()) return;
    if (this.submitting()) return;
    this.submitting.set(true);
    this.submitError.set(null);
    this.conflictReloadOffered.set(false);

    const linePayload = this.lines.map((l, i) => ({
      productId: l.product!.id,
      quantity: l.quantity,
      customUnitPrice: l.customUnitPrice != null && l.customUnitPrice > 0 ? l.customUnitPrice : null,
      discountPercent: l.discountPercent != null && l.discountPercent > 0 ? l.discountPercent : null,
      sortOrder: i + 1,
    }));

    if (this.isEdit()) {
      const id = this.templateId();
      if (!id) {
        this.submitting.set(false);
        return;
      }
      const body: UpdateQuoteTemplatePayload = {
        name: this.name.trim(),
        description: this.description?.trim() || null,
        defaultNotes: this.defaultNotes?.trim() || null,
        defaultTermsAndConditions: this.defaultTermsAndConditions?.trim() || null,
        defaultValidityDays: this.defaultValidityDays,
        lines: linePayload,
        isActive: this.isActive,
      };
      this.crm.updateQuoteTemplate(id, body).subscribe({
        next: (res) => {
          this.submitting.set(false);
          if (res.success) {
            this.toast.add({ severity: 'success', summary: 'Enregistré', detail: 'Modèle mis à jour.' });
            this.router.navigate(['/crm/quote-templates']);
          } else {
            this.submitError.set(res.error ?? 'Erreur');
          }
        },
        error: (err: HttpErrorResponse) => {
          this.submitting.set(false);
          this.conflictReloadOffered.set(err.status === 409);
          this.submitError.set(this.errorHandler.extractErrorMessage(err));
        },
      });
    } else {
      const body: CreateQuoteTemplatePayload = {
        name: this.name.trim(),
        description: this.description?.trim() || null,
        defaultNotes: this.defaultNotes?.trim() || null,
        defaultTermsAndConditions: this.defaultTermsAndConditions?.trim() || null,
        defaultValidityDays: this.defaultValidityDays,
        lines: linePayload,
      };
      this.crm.createQuoteTemplate(body).subscribe({
        next: (res) => {
          this.submitting.set(false);
          if (res.success) {
            this.toast.add({ severity: 'success', summary: 'Créé', detail: 'Modèle créé.' });
            this.router.navigate(['/crm/quote-templates']);
          } else {
            this.submitError.set(res.error ?? 'Erreur');
          }
        },
        error: (err: HttpErrorResponse) => {
          this.submitting.set(false);
          this.submitError.set(this.errorHandler.extractErrorMessage(err));
        },
      });
    }
  }
}
