/// <reference types="@angular/localize" />
import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
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
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { PricingService, PriceListDetail, PriceListItem, PriceListTier } from '@core/services/pricing.service';
import { ProductService } from '@core/services/product.service';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { AuthService } from '@core/services/auth.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { PERMISSIONS } from '@core/config/permission-keys';

interface ProductOption {
  id: string;
  label: string;
  unitPrice: number;
}

@Component({
  selector: 'app-price-list-detail',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
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
    PageHeaderComponent,
    BreadcrumbComponent,
    EmptyStateComponent,
    ButtonComponent
  ],
  template: `
    <app-breadcrumb [items]="breadcrumbItems()"></app-breadcrumb>

    @if (priceList(); as pl) {
      <app-page-header [title]="pl.name" [subtitle]="headerSubtitle()">
        @if (canUpdate()) {
          <app-button variant="secondary" icon="pi-cog" iconPos="left" (clicked)="openSettings()" i18n="@@pricing.price-list-detail.parametres.ef8f0121"> Paramètres </app-button>
          <app-button variant="primary" icon="pi-plus" iconPos="left" (clicked)="openAddItem()" i18n="@@pricing.price-list-detail.ajouter.un.produit.0f13c039"> Ajouter un produit </app-button>
        }
      </app-page-header>

      <!-- Bandeau d'état : une grille inapplicable ne sert aucun prix, il faut le dire fort. -->
      @if (!pl.isActive) {
        <div class="ft-alert ft-alert--muted" i18n="@@pricing.price-list-detail.cette.grille.est.desactivee.aucun.prix.n.7c86f095">
          <i class="pi pi-info-circle"></i>
          Cette grille est <strong>désactivée</strong> : aucun prix n'en est tiré. Les documents
          déjà émis conservent leur prix, qui a été figé à leur création.
        </div>
      } @else if (!pl.isApplicableToday) {
        <div class="ft-alert ft-alert--warning" i18n="@@pricing.price-list-detail.grille.active.mais.hors.de.sa.periode.de.04d8d6a2">
          <i class="pi pi-exclamation-triangle"></i>
          Grille active mais <strong>hors de sa période de validité</strong> : elle n'applique
          aucun prix aujourd'hui.
        </div>
      }

      @if (pl.assignedClientCount > 0) {
        <div class="ft-alert ft-alert--info" i18n="@@pricing.price-list-detail.affectee.a.client.s.0fec0274">
          <i class="pi pi-users"></i>
          Affectée à <strong>{{ pl.assignedClientCount }}</strong> client(s).
        </div>
      }

      @if (pl.items.length === 0) {
        <app-empty-state
          icon="pi-tags"
          title="Aucun prix dans cette grille" i18n-title="@@pricing.price-list-detail.aucun.prix.dans.cette.grille.fa1b4a0a"
          message="Ajoutez des produits : ceux qui n'y figurent pas restent au prix catalogue." i18n-message="@@pricing.price-list-detail.ajoutez.des.produits.ceux.qui.n.y.figure.446be17b">
        </app-empty-state>
      } @else {
        <div class="ft-table-card">
          <p-table [value]="pl.items" [rowHover]="true" styleClass="ft-table">
            <ng-template pTemplate="header">
              <tr>
                <th i18n="@@pricing.price-list-detail.code.adac6937">Code</th>
                <th i18n="@@pricing.price-list-detail.produit.ff673dc2">Produit</th>
                <th class="ft-num" i18n="@@pricing.price-list-detail.prix.catalogue.ht.045abe33">Prix catalogue HT</th>
                <th class="ft-num" i18n="@@pricing.price-list-detail.prix.de.la.grille.ht.d24eff06">Prix de la grille HT</th>
                <th class="ft-num" i18n="@@pricing.price-list-detail.ecart.6ae8dce8">Écart</th>
                <th i18n="@@pricing.price-list-detail.paliers.d48097c3">Paliers</th>
                <th class="ft-actions-col" i18n="@@pricing.price-list-detail.actions.c3cd636a">Actions</th>
              </tr>
            </ng-template>

            <ng-template pTemplate="body" let-item>
              <tr>
                <td>{{ item.productCode }}</td>
                <td>{{ item.productName }}</td>
                <td class="ft-num">{{ item.catalogUnitPriceHT | number: '1.3-3' }}</td>
                <td class="ft-num">
                  <strong>{{ item.unitPriceHT | number: '1.3-3' }}</strong>
                </td>
                <td class="ft-num">
                  <span [class]="deltaClass(item)">{{ deltaLabel(item) }}</span>
                </td>
                <td>
                  @if (item.tiers.length === 0) {
                    <span class="ft-muted" i18n="@@pricing.price-list-detail.prix.unique.9fec32e6">Prix unique</span>
                  } @else {
                    @for (tier of item.tiers; track tier.minQuantity) {
                      <p-tag
                        severity="info"
                        [value]="tierLabel(tier)"
                        [pTooltip]="canUpdate() ? loc_ui_tern_cliquer_pour_retirer_ce_palier_a449fe : ''"
                        [style.cursor]="canUpdate() ? 'pointer' : 'default'"
                        (click)="onTierClick(item, tier)"></p-tag>
                    }
                  }
                  @if (canUpdate()) {
                    <button
                      pButton
                      type="button"
                      icon="pi pi-plus"
                      class="p-button-text p-button-sm"
                      pTooltip="Ajouter un palier" i18n-pTooltip="@@pricing.price-list-detail.ajouter.un.palier.716c9dc0"
                      (click)="openAddTier(item)"></button>
                  }
                </td>
                <td class="ft-actions-col">
                  @if (canUpdate()) {
                    <button
                      pButton
                      type="button"
                      icon="pi pi-pencil"
                      class="p-button-text p-button-sm"
                      pTooltip="Modifier le prix" i18n-pTooltip="@@pricing.price-list-detail.modifier.le.prix.20fbf571"
                      (click)="openEditItem(item)"></button>
                    <button
                      pButton
                      type="button"
                      icon="pi pi-trash"
                      class="p-button-text p-button-sm p-button-danger"
                      pTooltip="Retirer de la grille" i18n-pTooltip="@@pricing.price-list-detail.retirer.de.la.grille.92c887ff"
                      (click)="confirmRemove(item)"></button>
                  }
                </td>
              </tr>
            </ng-template>
          </p-table>
        </div>
      }
    } @else if (!loading()) {
      <app-empty-state
        icon="pi-exclamation-circle"
        title="Grille introuvable" i18n-title="@@pricing.price-list-detail.grille.introuvable.56e220cc"
        message="Cette grille tarifaire n'existe pas ou a été supprimée." i18n-message="@@pricing.price-list-detail.cette.grille.tarifaire.n.existe.pas.ou.a.fc7d8a6b">
      </app-empty-state>
    }

    <!-- Paramètres de la grille -->
    <p-dialog
      header="Paramètres de la grille" i18n-header="@@pricing.price-list-detail.parametres.de.la.grille.e0229226"
      [(visible)]="settingsVisible"
      [modal]="true"
      [style]="{ width: '32rem' }"
      [draggable]="false">
      <div class="ft-form-grid">
        <div class="ft-field">
          <label for="pl-name"><ng-container i18n="@@pricing.price-list-detail.nom.7ff20370">Nom </ng-container> <span class="ft-required" i18n="@@pricing.price-list-detail.text.df58248c">*</span></label>
          <input id="pl-name" pInputText [(ngModel)]="settingsForm.name" maxlength="100" />
        </div>

        <div class="ft-field">
          <label for="pl-from" i18n="@@pricing.price-list-detail.debut.de.validite.10f1f74c">Début de validité</label>
          <input id="pl-from" type="date" pInputText [(ngModel)]="settingsForm.validFrom" />
        </div>

        <div class="ft-field">
          <label for="pl-until" i18n="@@pricing.price-list-detail.fin.de.validite.3cfa7402">Fin de validité</label>
          <input id="pl-until" type="date" pInputText [(ngModel)]="settingsForm.validUntil" />
        </div>

        <div class="ft-field ft-field--inline">
          <p-inputSwitch [(ngModel)]="settingsForm.isActive" inputId="pl-active"></p-inputSwitch>
          <label for="pl-active" i18n="@@pricing.price-list-detail.grille.active.5fe0537d">Grille active</label>
          <small class="ft-hint" i18n="@@pricing.price-list-detail.desactiver.est.reversible.et.n.affecte.aucun.doc.f76ea8fd"> Désactiver est réversible et n'affecte aucun document déjà émis. </small>
        </div>
      </div>

      <ng-template pTemplate="footer">
        <app-button variant="secondary" (clicked)="settingsVisible = false" i18n="@@pricing.price-list-detail.annuler.49ba3292">Annuler</app-button>
        <app-button
          variant="primary"
          [disabled]="!settingsForm.name.trim() || saving()"
          (clicked)="saveSettings()" i18n="@@pricing.price-list-detail.enregistrer.f7c8bcd8"> Enregistrer </app-button>
      </ng-template>
    </p-dialog>

    <!-- Ajout / modification d'un prix -->
    <p-dialog
      [header]="editingItem ? loc_ui_tern_modifier_le_prix_20fbf5 : loc_ui_tern_ajouter_un_produit_0f13c0"
      [(visible)]="itemVisible"
      [modal]="true"
      [style]="{ width: '32rem' }"
      [draggable]="false">
      <div class="ft-form-grid">
        @if (editingItem) {
          <div class="ft-field">
            <label i18n="@@pricing.price-list-detail.produit.ff673dc2">Produit</label>
            <div class="ft-readonly">{{ editingItem.productCode }} — {{ editingItem.productName }}</div>
          </div>
        } @else {
          <div class="ft-field">
            <label for="pl-product"><ng-container i18n="@@pricing.price-list-detail.produit.ff673dc2">Produit </ng-container> <span class="ft-required" i18n="@@pricing.price-list-detail.text.df58248c">*</span></label>
            <p-autoComplete
              inputId="pl-product"
              [(ngModel)]="selectedProduct"
              [suggestions]="productSuggestions()"
              (completeMethod)="searchProducts($event)"
              field="label"
              [forceSelection]="true"
              [dropdown]="true"
              placeholder="Rechercher par code ou nom" i18n-placeholder="@@pricing.price-list-detail.rechercher.par.code.ou.nom.46838c72"
              appendTo="body"></p-autoComplete>
          </div>
        }

        <div class="ft-field">
          <label for="pl-price" i18n="@@pricing.price-list-detail.prix.ht.08db238f">Prix HT ({{ priceList()?.currency }}) <span class="ft-required">*</span></label>
          <p-inputNumber
            inputId="pl-price"
            [(ngModel)]="itemPrice"
            mode="decimal"
            [minFractionDigits]="3"
            [maxFractionDigits]="3"
            [min]="0"></p-inputNumber>
          @if (catalogReference() !== null) {
            <small class="ft-hint" i18n="@@pricing.price-list-detail.prix.catalogue.bba7af9e">Prix catalogue : {{ catalogReference() | number: '1.3-3' }}</small>
          }
        </div>
      </div>

      <ng-template pTemplate="footer">
        <app-button variant="secondary" (clicked)="itemVisible = false" i18n="@@pricing.price-list-detail.annuler.49ba3292">Annuler</app-button>
        <app-button variant="primary" [disabled]="!canSaveItem() || saving()" (clicked)="saveItem()" i18n="@@pricing.price-list-detail.enregistrer.f7c8bcd8"> Enregistrer </app-button>
      </ng-template>
    </p-dialog>

    <!-- Palier quantitatif -->
    <p-dialog
      header="Ajouter un palier" i18n-header="@@pricing.price-list-detail.ajouter.un.palier.716c9dc0"
      [(visible)]="tierVisible"
      [modal]="true"
      [style]="{ width: '32rem' }"
      [draggable]="false">
      @if (tierTarget) {
        <p class="ft-dialog-intro" i18n="@@pricing.price-list-detail.prix.de.base.le.palier.remplace.ce.prix.d35e3b1e">
          <strong>{{ tierTarget.productCode }}</strong> — prix de base
          {{ tierTarget.unitPriceHT | number: '1.3-3' }}. Le palier remplace ce prix à partir
          de la quantité indiquée.
        </p>
      }

      <div class="ft-form-grid">
        <div class="ft-field">
          <label for="pl-tier-qty"><ng-container i18n="@@pricing.price-list-detail.a.partir.de.la.quantite.80cb1477">À partir de la quantité </ng-container> <span class="ft-required" i18n="@@pricing.price-list-detail.text.df58248c">*</span></label>
          <p-inputNumber
            inputId="pl-tier-qty"
            [(ngModel)]="tierMinQuantity"
            mode="decimal"
            [minFractionDigits]="0"
            [maxFractionDigits]="4"
            [min]="2"></p-inputNumber>
          <small class="ft-hint" i18n="@@pricing.price-list-detail.au.moins.2.en.deca.c.est.le.prix.de.base.qui.s.a.2d90a8c9">Au moins 2 : en deçà, c'est le prix de base qui s'applique.</small>
        </div>

        <div class="ft-field">
          <label for="pl-tier-price"><ng-container i18n="@@pricing.price-list-detail.prix.ht.du.palier.740a3726">Prix HT du palier </ng-container> <span class="ft-required" i18n="@@pricing.price-list-detail.text.df58248c">*</span></label>
          <p-inputNumber
            inputId="pl-tier-price"
            [(ngModel)]="tierPrice"
            mode="decimal"
            [minFractionDigits]="3"
            [maxFractionDigits]="3"
            [min]="0"></p-inputNumber>
        </div>
      </div>

      <ng-template pTemplate="footer">
        <app-button variant="secondary" (clicked)="tierVisible = false" i18n="@@pricing.price-list-detail.annuler.49ba3292">Annuler</app-button>
        <app-button variant="primary" [disabled]="!canSaveTier() || saving()" (clicked)="saveTier()" i18n="@@pricing.price-list-detail.enregistrer.f7c8bcd8"> Enregistrer </app-button>
      </ng-template>
    </p-dialog>
  `
})
export class PriceListDetailComponent implements OnInit {
  readonly loc_ui_tern_cliquer_pour_retirer_ce_palier_a449fe = $localize`:@@ui.tern.cliquer.pour.retirer.ce.palier.a449fe:Cliquer pour retirer ce palier`;
  readonly loc_ui_tern_modifier_le_prix_20fbf5 = $localize`:@@ui.tern.modifier.le.prix.20fbf5:Modifier le prix`;
  readonly loc_ui_tern_ajouter_un_produit_0f13c0 = $localize`:@@ui.tern.ajouter.un.produit.0f13c0:Ajouter un produit`;
  private readonly route = inject(ActivatedRoute);
  private readonly pricingService = inject(PricingService);
  private readonly productService = inject(ProductService);
  private readonly toastService = inject(ToastService);
  private readonly errorHandler = inject(ErrorHandlerService);
  private readonly auth = inject(AuthService);
  private readonly confirmationService = inject(ConfirmationService);

  readonly priceList = signal<PriceListDetail | null>(null);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly productSuggestions = signal<ProductOption[]>([]);

  settingsVisible = false;
  settingsForm = { name: '', validFrom: '', validUntil: '', isActive: true };

  itemVisible = false;
  editingItem: PriceListItem | null = null;

  tierVisible = false;
  tierTarget: PriceListItem | null = null;
  tierMinQuantity: number | null = 10;
  tierPrice: number | null = null;
  selectedProduct: ProductOption | null = null;
  itemPrice: number | null = null;

  private priceListId = '';

  readonly canUpdate = computed(() => this.auth.hasPermission(PERMISSIONS.pricing.update));

  readonly breadcrumbItems = computed<BreadcrumbItem[]>(() => [
    { label: 'Ventes' },
    { label: 'Grilles tarifaires', route: '/pricing' },
    { label: this.priceList()?.name ?? $localize`:@@ui.tern.detail.7ce06a:Détail` }
  ]);

  readonly headerSubtitle = computed(() => {
    const pl = this.priceList();
    if (!pl) return '';
    const count = pl.items.length;
    return `${count} produit(s) tarifé(s) · devise ${pl.currency}. Les produits absents restent au prix catalogue.`;
  });

  /** Prix catalogue de référence dans la boîte de dialogue, pour situer la saisie. */
  readonly catalogReference = computed<number | null>(() => {
    if (this.editingItem) return this.editingItem.catalogUnitPriceHT;
    return this.selectedProduct?.unitPrice ?? null;
  });

  ngOnInit(): void {
    this.priceListId = this.route.snapshot.paramMap.get('id') ?? '';
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.pricingService.getPriceList(this.priceListId).subscribe({
      next: res => {
        this.priceList.set(res.data ?? null);
        this.loading.set(false);
      },
      error: err => {
        this.showError(err, 'Impossible de charger la grille');
        this.errorHandler.logError('Failed to load price list', err);
        this.priceList.set(null);
        this.loading.set(false);
      }
    });
  }

  deltaLabel(item: PriceListItem): string {
    if (item.catalogUnitPriceHT === 0) return '—';
    const delta = ((item.unitPriceHT - item.catalogUnitPriceHT) / item.catalogUnitPriceHT) * 100;
    const sign = delta > 0 ? '+' : '';
    return `${sign}${delta.toFixed(1)} %`;
  }

  deltaClass(item: PriceListItem): string {
    if (item.catalogUnitPriceHT === 0) return '';
    return item.unitPriceHT < item.catalogUnitPriceHT ? 'ft-delta--down' : 'ft-delta--up';
  }

  // ─────────────────────────── Paramètres ───────────────────────────

  openSettings(): void {
    const pl = this.priceList();
    if (!pl) return;

    this.settingsForm = {
      name: pl.name,
      validFrom: pl.validFrom ? pl.validFrom.substring(0, 10) : '',
      validUntil: pl.validUntil ? pl.validUntil.substring(0, 10) : '',
      isActive: pl.isActive
    };
    this.settingsVisible = true;
  }

  saveSettings(): void {
    this.saving.set(true);
    this.pricingService
      .updatePriceList(this.priceListId, {
        name: this.settingsForm.name.trim(),
        validFrom: this.settingsForm.validFrom || null,
        validUntil: this.settingsForm.validUntil || null,
        isActive: this.settingsForm.isActive
      })
      .subscribe({
        next: () => {
          this.toastService.add({
            severity: 'success',
            summary: $localize`:@@price-list-detail.component.summary.Succ_s:Succès`,
            detail: $localize`:@@price-list-detail.component.detail.Grille_mise_jo:Grille mise à jour.`
          });
          this.settingsVisible = false;
          this.saving.set(false);
          this.load();
        },
        error: err => {
          this.showError(err, 'Mise à jour impossible');
          this.errorHandler.logError('Update price list failed', err);
          this.saving.set(false);
        }
      });
  }

  // ─────────────────────────── Prix produit ───────────────────────────

  openAddItem(): void {
    this.editingItem = null;
    this.selectedProduct = null;
    this.itemPrice = null;
    this.itemVisible = true;
  }

  openEditItem(item: PriceListItem): void {
    this.editingItem = item;
    this.selectedProduct = null;
    this.itemPrice = item.unitPriceHT;
    this.itemVisible = true;
  }

  searchProducts(event: { query: string }): void {
    this.productService.getProducts({ search: event.query, pageSize: 20 }).subscribe({
      next: res => {
        const items = res.data?.items ?? [];
        this.productSuggestions.set(
          items.map(p => ({
            id: p.id,
            label: `${p.code} — ${p.name}`,
            unitPrice: p.unitPrice
          }))
        );
      },
      error: () => this.productSuggestions.set([])
    });
  }

  canSaveItem(): boolean {
    const hasProduct = this.editingItem !== null || this.selectedProduct !== null;
    return hasProduct && this.itemPrice !== null && this.itemPrice >= 0;
  }

  saveItem(): void {
    const productId = this.editingItem?.productId ?? this.selectedProduct?.id;
    if (!productId || this.itemPrice === null) return;

    this.saving.set(true);
    this.pricingService.setPriceListItem(this.priceListId, productId, this.itemPrice).subscribe({
      next: () => {
        this.toastService.add({
          severity: 'success',
          summary: $localize`:@@price-list-detail.component.summary.Succ_s:Succès`,
          detail: $localize`:@@price-list-detail.component.detail.Prix_enregistr_:Prix enregistré.`
        });
        this.itemVisible = false;
        this.saving.set(false);
        this.load();
      },
      error: err => {
        this.showError(err, 'Enregistrement impossible');
        this.errorHandler.logError('Set price list item failed', err);
        this.saving.set(false);
      }
    });
  }

  confirmRemove(item: PriceListItem): void {
    this.confirmationService.confirm({
      header: 'Retirer de la grille',
      message: `Retirer « ${item.productName} » de cette grille ? Il repassera au prix catalogue.`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: $localize`:@@price-list-detail.component.acceptLabel.Retirer:Retirer`,
      rejectLabel: $localize`:@@price-list-detail.component.rejectLabel.Annuler:Annuler`,
      acceptButtonStyleClass: 'btn-danger',
      accept: () => this.removeItem(item)
    });
  }

  private removeItem(item: PriceListItem): void {
    this.pricingService.removePriceListItem(this.priceListId, item.productId).subscribe({
      next: () => {
        this.toastService.add({
          severity: 'success',
          summary: $localize`:@@price-list-detail.component.summary.Succ_s:Succès`,
          detail: $localize`:@@price-list-detail.component.detail.Produit_retir_d:Produit retiré de la grille.`
        });
        this.load();
      },
      error: err => {
        this.showError(err, 'Retrait impossible');
        this.errorHandler.logError('Remove price list item failed', err);
      }
    });
  }

  // ────────── Paliers quantitatifs ──────────

  tierLabel(tier: PriceListTier): string {
    return `\u2265 ${tier.minQuantity} : ${tier.unitPriceHT.toFixed(3)}`;
  }

  onTierClick(item: PriceListItem, tier: PriceListTier): void {
    if (!this.canUpdate()) return;
    this.confirmRemoveTier(item, tier);
  }

  openAddTier(item: PriceListItem): void {
    this.tierTarget = item;
    this.tierMinQuantity = 10;
    this.tierPrice = item.unitPriceHT;
    this.tierVisible = true;
  }

  canSaveTier(): boolean {
    return (
      this.tierTarget !== null &&
      this.tierMinQuantity !== null &&
      this.tierMinQuantity >= 2 &&
      this.tierPrice !== null &&
      this.tierPrice >= 0
    );
  }

  saveTier(): void {
    if (!this.canSaveTier() || !this.tierTarget) return;

    this.saving.set(true);
    this.pricingService
      .setPriceListTier(
        this.priceListId,
        this.tierTarget.productId,
        this.tierMinQuantity as number,
        this.tierPrice as number
      )
      .subscribe({
        next: () => {
          this.toastService.add({
            severity: 'success',
            summary: $localize`:@@price-list-detail.component.summary.Succ_s:Succès`,
            detail: $localize`:@@price-list-detail.component.detail.Palier_enregistr:Palier enregistré.`
          });
          this.tierVisible = false;
          this.saving.set(false);
          this.load();
        },
        error: err => {
          this.showError(err, 'Enregistrement du palier impossible');
          this.errorHandler.logError('Set price list tier failed', err);
          this.saving.set(false);
        }
      });
  }

  confirmRemoveTier(item: PriceListItem, tier: PriceListTier): void {
    this.confirmationService.confirm({
      header: 'Retirer le palier',
      message:
        `Retirer le palier « à partir de ${tier.minQuantity} » sur ${item.productCode} ? ` +
        $localize`:@@ui.tern.ces.quantites.retomberont.sur.le.palier.in.5636c0:Ces quantités retomberont sur le palier inférieur, ou sur le prix de base.`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: $localize`:@@price-list-detail.component.acceptLabel.Retirer:Retirer`,
      rejectLabel: $localize`:@@price-list-detail.component.rejectLabel.Annuler:Annuler`,
      acceptButtonStyleClass: 'btn-danger',
      accept: () => this.removeTier(item, tier)
    });
  }

  private removeTier(item: PriceListItem, tier: PriceListTier): void {
    this.pricingService
      .removePriceListTier(this.priceListId, item.productId, tier.minQuantity)
      .subscribe({
        next: () => {
          this.toastService.add({
            severity: 'success',
            summary: $localize`:@@price-list-detail.component.summary.Succ_s:Succès`,
            detail: $localize`:@@price-list-detail.component.detail.Palier_retir_:Palier retiré.`
          });
          this.load();
        },
        error: err => {
          this.showError(err, 'Retrait du palier impossible');
          this.errorHandler.logError('Remove price list tier failed', err);
        }
      });
  }

  private showError(err: unknown, fallback: string): void {
    const msg = this.errorHandler.extractErrorMessage(err);
    this.toastService.add({
      severity: 'error',
      summary: $localize`:@@price-list-detail.component.summary.Erreur:Erreur`,
      detail: msg || fallback
    });
  }
}
