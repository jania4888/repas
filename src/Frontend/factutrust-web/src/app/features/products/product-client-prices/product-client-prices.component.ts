/// <reference types="@angular/localize" />
import { Component, OnInit, OnChanges, SimpleChanges, inject, input, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputSwitchModule } from 'primeng/inputswitch';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { DialogModule } from 'primeng/dialog';
import { AutoCompleteModule } from 'primeng/autocomplete';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import {
  PricingService,
  ProductClientPrice,
  ProductPricing
} from '@core/services/pricing.service';
import { ClientService } from '@core/services/client.service';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { AuthService } from '@core/services/auth.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { PERMISSIONS } from '@core/config/permission-keys';

interface ClientOption {
  id: string;
  label: string;
}

@Component({
  selector: 'app-product-client-prices',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    ButtonModule,
    InputTextModule,
    InputNumberModule,
    InputSwitchModule,
    TagModule,
    TooltipModule,
    DialogModule,
    AutoCompleteModule,
    EmptyStateComponent,
    ButtonComponent
  ],
  template: `
    <div class="client-prices-section">
      <div class="client-prices-header">
        <div>
          <h4 class="pricing-block-title" i18n="@@products.product-client-prices.tarifs.par.client.e47e033b">Tarifs par client</h4>
          <p class="client-prices-subtitle" i18n="@@products.product-client-prices.prix.catalogue.les.clients.absents.conse.bdc76c4e">
            <ng-container> Prix catalogue : </ng-container> <strong>{{ catalogUnitPriceHT() | number: '1.3-3' }} {{ currency() }}</strong>
            — les clients absents conservent ce tarif.
          </p>
        </div>
        @if (!readOnly() && canUpdate()) {
          <app-button variant="primary" icon="pi-plus" iconPos="left" (clicked)="openAdd()" i18n="@@products.product-client-prices.ajouter.un.tarif.client.db59e2ab"> Ajouter un tarif client </app-button>
        }
      </div>

      @if (loading()) {
        <p class="ft-muted" i18n="@@products.product-client-prices.chargement.des.tarifs.client.820f8874">Chargement des tarifs client…</p>
      } @else if (clientPrices().length === 0) {
        <app-empty-state
          icon="pi-users"
          title="Aucun tarif client" i18n-title="@@products.product-client-prices.aucun.tarif.client.ffe1127d"
          message="Définissez des prix spécifiques pour certains clients. Les autres restent au prix catalogue." i18n-message="@@products.product-client-prices.definissez.des.prix.specifiques.pour.cer.02b8e16f">
        </app-empty-state>
      } @else {
        <div class="ft-table-card">
          <p-table [value]="clientPrices()" [rowHover]="true" styleClass="ft-table">
            <ng-template pTemplate="header">
              <tr>
                <th i18n="@@products.product-client-prices.client.1bdd79b1">Client</th>
                <th class="ft-num" i18n="@@products.product-client-prices.prix.ht.362207ca">Prix HT</th>
                <th i18n="@@products.product-client-prices.validite.8be7d506">Validité</th>
                <th class="ft-num" i18n="@@products.product-client-prices.ecart.6ae8dce8">Écart</th>
                <th i18n="@@products.product-client-prices.etat.d3b28a2a">État</th>
                @if (!readOnly() && (canUpdate() || canDelete())) {
                  <th class="ft-actions-col" i18n="@@products.product-client-prices.actions.c3cd636a">Actions</th>
                }
              </tr>
            </ng-template>

            <ng-template pTemplate="body" let-item>
              <tr>
                <td>{{ item.clientName }}</td>
                <td class="ft-num">
                  <strong>{{ item.unitPriceHT | number: '1.3-3' }}</strong>
                  {{ item.currency }}
                </td>
                <td>{{ validityLabel(item) }}</td>
                <td class="ft-num">
                  <span [class]="deltaClass(item)">{{ deltaLabel(item) }}</span>
                </td>
                <td>
                  <p-tag [severity]="statusSeverity(item)" [value]="statusLabel(item)"></p-tag>
                </td>
                @if (!readOnly() && (canUpdate() || canDelete())) {
                  <td class="ft-actions-col">
                    @if (canUpdate()) {
                      <button
                        pButton
                        type="button"
                        icon="pi pi-pencil"
                        class="p-button-text p-button-sm"
                        pTooltip="Modifier" i18n-pTooltip="@@products.product-client-prices.modifier.f260e757"
                        (click)="openEdit(item)"></button>
                    }
                    @if (canDelete()) {
                      <button
                        pButton
                        type="button"
                        icon="pi pi-trash"
                        class="p-button-text p-button-sm p-button-danger"
                        pTooltip="Supprimer" i18n-pTooltip="@@products.product-client-prices.supprimer.1acfc1c7"
                        (click)="confirmDelete(item)"></button>
                    }
                  </td>
                }
              </tr>
            </ng-template>
          </p-table>
        </div>
      }
    </div>

    <p-dialog
      [header]="editingItem ? loc_ui_tern_modifier_le_tarif_client_45204a : loc_ui_tern_ajouter_un_tarif_client_db59e2"
      [(visible)]="dialogVisible"
      [modal]="true"
      styleClass="client-price-dialog"
      [style]="{ width: '32rem', maxWidth: '95vw' }"
      [breakpoints]="{ '640px': '95vw' }"
      [draggable]="false">
      <p class="ft-dialog-intro" i18n="@@products.product-client-prices.prix.catalogue.ce.tarif.s.applique.uniqu.d9ed9b12">
        <ng-container> Prix catalogue : </ng-container>
        <strong>{{ catalogUnitPriceHT() | number: '1.3-3' }} {{ currency() }}</strong>.
        Ce tarif s'applique uniquement à ce client ; les autres conservent le catalogue.
      </p>

      <div class="ft-field ft-field--full client-price-dialog__client">
        <label for="cp-client"><ng-container i18n="@@products.product-client-prices.client.1bdd79b1">Client </ng-container> <span class="ft-required" i18n="@@products.product-client-prices.text.df58248c">*</span></label>
        @if (editingItem) {
          <div class="ft-readonly">{{ editingItem.clientName }}</div>
        } @else {
          <p-autoComplete
            inputId="cp-client"
            [(ngModel)]="selectedClient"
            [suggestions]="clientSuggestions()"
            (completeMethod)="searchClients($event)"
            field="label"
            [forceSelection]="true"
            [dropdown]="true"
            placeholder="Rechercher par nom" i18n-placeholder="@@products.product-client-prices.rechercher.par.nom.88b5f2ab"
            appendTo="body"
            [disabled]="saving()">
          </p-autoComplete>
        }
      </div>

      <div class="ft-field ft-field--full client-price-dialog__price">
        <label for="cp-price" i18n="@@products.product-client-prices.prix.ht.8d5f1e98">Prix HT ({{ currency() }}) <span class="ft-required">*</span></label>
        <p-inputNumber
          inputId="cp-price"
          [(ngModel)]="formPrice"
          [minFractionDigits]="3"
          [maxFractionDigits]="3"
          [min]="0"
          mode="decimal"
          [disabled]="saving()">
        </p-inputNumber>
        @if (catalogUnitPriceHT() > 0) {
          <small class="ft-hint"><ng-container i18n="@@products.product-client-prices.prix.catalogue.da7a8470">
            Prix catalogue : {{ catalogUnitPriceHT() | number: '1.3-3' }} {{ currency() }}
            </ng-container>@if (formPriceDeltaLabel()) {<ng-container i18n="@@products.product-client-prices.ecart.94b88477">
              — Écart :
              <span [class]="formPriceDeltaClass()">{{ formPriceDeltaLabel() }}</span>
            </ng-container>}
          </small>
        }
      </div>

      <div class="ft-form-grid client-price-dialog__dates">
        <div class="ft-field">
          <label for="cp-valid-from" i18n="@@products.product-client-prices.debut.de.validite.10f1f74c">Début de validité</label>
          <input
            id="cp-valid-from"
            type="date"
            pInputText
            [(ngModel)]="formValidFrom"
            [disabled]="saving()" />
          <small class="ft-hint" i18n="@@products.product-client-prices.optionnel.879d6b16">Optionnel</small>
        </div>

        <div class="ft-field">
          <label for="cp-valid-until" i18n="@@products.product-client-prices.fin.de.validite.3cfa7402">Fin de validité</label>
          <input
            id="cp-valid-until"
            type="date"
            pInputText
            [(ngModel)]="formValidUntil"
            [disabled]="saving()" />
          <small class="ft-hint" i18n="@@products.product-client-prices.optionnel.879d6b16">Optionnel</small>
        </div>
      </div>

      @if (dateRangeInvalid()) {
        <p class="ft-field-error" i18n="@@products.product-client-prices.la.fin.de.validite.ne.peut.pas.preceder.le.debut.4833acba">La fin de validité ne peut pas précéder le début.</p>
      }
      <small class="ft-hint client-price-dialog__dates-hint" i18n="@@products.product-client-prices.format.affiche.selon.votre.systeme.laissez.vide..d0c19b95"> Format affiché selon votre système. Laissez vide pour une validité sans limite. </small>

      <div class="ft-field ft-field--inline client-price-dialog__active">
        <p-inputSwitch [(ngModel)]="formIsActive" inputId="cp-active" [disabled]="saving()"></p-inputSwitch>
        <label for="cp-active" i18n="@@products.product-client-prices.tarif.actif.989d1fb6">Tarif actif</label>
      </div>
      <small class="ft-hint client-price-dialog__active-hint" i18n="@@products.product-client-prices.desactiver.est.reversible.n.affecte.pas.les.docu.f09cf48c"> Désactiver est réversible ; n'affecte pas les documents déjà émis. </small>

      <ng-template pTemplate="footer">
        <app-button variant="secondary" (clicked)="dialogVisible = false" i18n="@@products.product-client-prices.annuler.49ba3292">Annuler</app-button>
        <app-button variant="primary" [disabled]="!canSave() || saving()" (clicked)="save()" i18n="@@products.product-client-prices.enregistrer.f7c8bcd8"> Enregistrer </app-button>
      </ng-template>
    </p-dialog>
  `,
  styles: [
    `
      .client-prices-section {
        margin-top: var(--spacing-4);
      }

      .client-prices-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--spacing-4);
        margin-bottom: var(--spacing-4);
      }

      .client-prices-subtitle {
        margin: var(--spacing-1) 0 0;
        color: var(--color-text-muted);
        font-size: var(--font-size-sm);
      }

      .client-price-dialog__dates {
        margin-top: var(--spacing-2);
      }

      .client-price-dialog__dates-hint {
        display: block;
        margin-top: var(--spacing-1);
      }

      .client-price-dialog__active {
        margin-top: var(--spacing-4);
      }

      .client-price-dialog__active-hint {
        display: block;
        margin-top: var(--spacing-1);
      }

      :host ::ng-deep .client-price-dialog .p-dialog-footer {
        display: flex;
        justify-content: flex-end;
        gap: var(--spacing-3);
      }

      :host ::ng-deep .ft-field .p-inputnumber,
      :host ::ng-deep .ft-field .p-autocomplete {
        width: 100%;
      }
    `
  ]
})
export class ProductClientPricesComponent implements OnInit, OnChanges {
  readonly loc_ui_tern_modifier_le_tarif_client_45204a = $localize`:@@ui.tern.modifier.le.tarif.client.45204a:Modifier le tarif client`;
  readonly loc_ui_tern_ajouter_un_tarif_client_db59e2 = $localize`:@@ui.tern.ajouter.un.tarif.client.db59e2:Ajouter un tarif client`;
  readonly productId = input.required<string>();
  readonly catalogUnitPriceHT = input(0);
  readonly currency = input('TND');
  readonly readOnly = input(false);

  private readonly pricingService = inject(PricingService);
  private readonly clientService = inject(ClientService);
  private readonly toast = inject(ToastService);
  private readonly errorHandler = inject(ErrorHandlerService);
  private readonly authService = inject(AuthService);
  private readonly confirmation = inject(ConfirmationService);

  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly pricing = signal<ProductPricing | null>(null);
  readonly clientSuggestions = signal<ClientOption[]>([]);

  dialogVisible = false;
  editingItem: ProductClientPrice | null = null;
  selectedClient: ClientOption | null = null;
  formPrice: number | null = null;
  formValidFrom: string | null = null;
  formValidUntil: string | null = null;
  formIsActive = true;

  readonly clientPrices = computed(() => this.pricing()?.clientPrices ?? []);

  readonly canRead = computed(() => this.authService.hasPermission(PERMISSIONS.pricing.read));
  readonly canUpdate = computed(() => this.authService.hasPermission(PERMISSIONS.pricing.update));
  readonly canDelete = computed(() => this.authService.hasPermission(PERMISSIONS.pricing.delete));

  ngOnInit(): void {
    this.load();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['productId'] && !changes['productId'].firstChange) {
      this.load();
    }
  }

  load(): void {
    if (!this.productId() || !this.canRead()) {
      return;
    }

    this.loading.set(true);
    this.pricingService.getProductPricing(this.productId()).subscribe({
      next: res => {
        this.pricing.set(res.data ?? null);
        this.loading.set(false);
      },
      error: err => {
        this.errorHandler.logError('Failed to load product pricing', err);
        this.loading.set(false);
      }
    });
  }

  searchClients(event: { query: string }): void {
    const existingIds = new Set(this.clientPrices().map(p => p.clientId));
    this.clientService.getClients({ search: event.query, pageSize: 20, isActive: true }).subscribe({
      next: res => {
        const items = (res.data?.items ?? [])
          .filter(c => !existingIds.has(c.id))
          .map(c => ({ id: c.id, label: c.name }));
        this.clientSuggestions.set(items);
      },
      error: () => this.clientSuggestions.set([])
    });
  }

  openAdd(): void {
    this.editingItem = null;
    this.selectedClient = null;
    this.formPrice = this.catalogUnitPriceHT() > 0 ? this.catalogUnitPriceHT() : null;
    this.formValidFrom = null;
    this.formValidUntil = null;
    this.formIsActive = true;
    this.dialogVisible = true;
  }

  openEdit(item: ProductClientPrice): void {
    this.editingItem = item;
    this.selectedClient = { id: item.clientId, label: item.clientName };
    this.formPrice = item.unitPriceHT;
    this.formValidFrom = item.validFrom ? item.validFrom.substring(0, 10) : null;
    this.formValidUntil = item.validUntil ? item.validUntil.substring(0, 10) : null;
    this.formIsActive = item.isActive;
    this.dialogVisible = true;
  }

  canSave(): boolean {
    const clientId = this.editingItem?.clientId ?? this.selectedClient?.id;
    return !!clientId && this.formPrice !== null && this.formPrice >= 0 && !this.dateRangeInvalid();
  }

  dateRangeInvalid(): boolean {
    if (!this.formValidFrom || !this.formValidUntil) {
      return false;
    }
    return this.formValidUntil < this.formValidFrom;
  }

  formPriceDeltaLabel(): string | null {
    const catalog = this.catalogUnitPriceHT();
    if (!catalog || this.formPrice === null) {
      return null;
    }
    const pct = ((this.formPrice - catalog) / catalog) * 100;
    const sign = pct > 0 ? '+' : '';
    return `${sign}${pct.toFixed(1)} %`;
  }

  formPriceDeltaClass(): string {
    const catalog = this.catalogUnitPriceHT();
    if (!catalog || this.formPrice === null) {
      return 'ft-muted';
    }
    const diff = this.formPrice - catalog;
    if (diff < 0) {
      return 'ft-delta--down';
    }
    if (diff > 0) {
      return 'ft-delta--up';
    }
    return 'ft-muted';
  }

  save(): void {
    const clientId = this.editingItem?.clientId ?? this.selectedClient?.id;
    if (!clientId || this.formPrice === null) {
      return;
    }

    this.saving.set(true);
    this.pricingService
      .upsertClientProductPrice(clientId, this.productId(), {
        unitPriceHT: this.formPrice,
        validFrom: this.formValidFrom,
        validUntil: this.formValidUntil,
        isActive: this.formIsActive
      })
      .subscribe({
        next: () => {
          this.toast.add({
            severity: 'success',
            summary: $localize`:@@product-client-prices.component.summary.Succès:Succès`,
            detail: $localize`:@@product-client-prices.component.detail.Tarif_client_enr:Tarif client enregistré`
          });
          this.dialogVisible = false;
          this.saving.set(false);
          this.load();
        },
        error: err => {
          this.errorHandler.logError('Upsert client product price failed', err);
          this.toast.add({
            severity: 'error',
            summary: $localize`:@@product-client-prices.component.summary.Erreur:Erreur`,
            detail: $localize`:@@product-client-prices.component.detail.Enregistrement_d:Enregistrement du tarif client impossible.`
          });
          this.saving.set(false);
        }
      });
  }

  confirmDelete(item: ProductClientPrice): void {
    this.confirmation.confirm({
      message: $localize`:@@products.product-client-prices.ts.supprimer.le.tarif.de.clientname.le.clie.12d20884:Supprimer le tarif de « ${item.clientName}:clientName: » ? Le client repassera au prix catalogue.`,
      header: $localize`:@@products.product-client-prices.ts.confirmation.3424edc2:Confirmation`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: $localize`:@@product-client-prices.component.acceptLabel.Supprimer:Supprimer`,
      rejectLabel: $localize`:@@product-client-prices.component.rejectLabel.Annuler:Annuler`,
      acceptButtonStyleClass: 'btn-danger',
      accept: () => this.delete(item)
    });
  }

  private delete(item: ProductClientPrice): void {
    this.pricingService.deleteClientProductPrice(item.id).subscribe({
      next: () => {
        this.toast.add({
          severity: 'success',
          summary: $localize`:@@product-client-prices.component.summary.Succès:Succès`,
          detail: $localize`:@@product-client-prices.component.detail.Tarif_client_sup:Tarif client supprimé`
        });
        this.load();
      },
      error: err => {
        this.errorHandler.logError('Delete client product price failed', err);
        this.toast.add({
          severity: 'error',
          summary: $localize`:@@product-client-prices.component.summary.Erreur:Erreur`,
          detail: $localize`:@@product-client-prices.component.detail.Suppression_du_t:Suppression du tarif client impossible.`
        });
      }
    });
  }

  validityLabel(item: ProductClientPrice): string {
    if (!item.validFrom && !item.validUntil) {
      return 'Sans limite';
    }
    const from = item.validFrom ? this.formatDate(item.validFrom) : '…';
    const until = item.validUntil ? this.formatDate(item.validUntil) : '…';
    return `${from} — ${until}`;
  }

  private formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('fr-FR');
  }

  deltaLabel(item: ProductClientPrice): string {
    const catalog = item.catalogUnitPriceHT;
    if (!catalog) {
      return '—';
    }
    const pct = ((item.unitPriceHT - catalog) / catalog) * 100;
    const sign = pct > 0 ? '+' : '';
    return `${sign}${pct.toFixed(1)} %`;
  }

  deltaClass(item: ProductClientPrice): string {
    const catalog = item.catalogUnitPriceHT;
    if (!catalog) {
      return 'ft-muted';
    }
    const pct = item.unitPriceHT - catalog;
    if (pct < 0) {
      return 'ft-delta--down';
    }
    if (pct > 0) {
      return 'ft-delta--up';
    }
    return 'ft-muted';
  }

  statusLabel(item: ProductClientPrice): string {
    if (!item.isActive) {
      return 'Désactivé';
    }
    if (!item.isApplicableToday) {
      return 'Hors période';
    }
    return 'Applicable';
  }

  statusSeverity(item: ProductClientPrice): 'success' | 'warning' | 'secondary' {
    if (!item.isActive) {
      return 'secondary';
    }
    if (!item.isApplicableToday) {
      return 'warning';
    }
    return 'success';
  }
}
