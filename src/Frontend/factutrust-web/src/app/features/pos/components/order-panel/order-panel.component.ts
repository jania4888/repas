import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';
import { Component, inject, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PosStateService } from '../../services/pos-state.service';
import { PosUpsellService } from '../../services/pos-upsell.service';
import { PosClientPreferencesService } from '../../services/pos-client-preferences.service';
import { ProductListItem, ProductService } from '@core/services/product.service';
import { ClientSelectorComponent } from '../client-selector/client-selector.component';
import { OrderLineComponent } from '../order-line/order-line.component';
import { PaymentActionsComponent } from '../payment-actions/payment-actions.component';
import { LinkedInvoiceRef } from '@core/services/invoice-reference-resolver.service';

@Component({
  selector: 'app-order-panel',
  standalone: true,
  imports: [BackendLabelPipe, CommonModule, FormsModule, ClientSelectorComponent, OrderLineComponent, PaymentActionsComponent],
  template: `
    <div class="order-panel">
      <div class="order-panel__scroll">
      @if (posState.isCreditNote()) {
          <div class="order-panel__credit-bandeau" i18n="@@pos.components.mode.avoir.facture.33ecc3d7">
            <i class="pi pi-file-edit"></i>
            <span>Mode Avoir — Facture : {{ posState.linkedInvoiceNumber() || posState.linkedInvoiceId() }}</span>
          </div>
          }
      <!-- Header -->
      <div class="order-panel__header">
        <h2 class="order-panel__title" i18n="@@pos.components.commande.47844341">Commande</h2>
        @if (posState.lineCount() > 0) {
          <span class="order-panel__badge order-panel__badge--animated" i18n="@@pos.components.article.7ad8e07d">
            <i class="pi pi-shopping-cart order-panel__badge-icon"></i>
            {{ posState.totalItemsQuantity() }} article{{ posState.totalItemsQuantity() > 1 ? 's' : '' }}
          </span>
        }
      </div>

      @if (!posState.isQuickMode()) {
      <!-- Client Selector -->
      <div class="order-panel__client">
        <app-client-selector />
      </div>

      @if (posState.client(); as client) {
      <!-- Preference reçu par e-mail (42) -->
      <div class="order-panel__pref-email">
        <label class="order-panel__pref-email-label">
          <input
            type="checkbox"
            [checked]="clientPrefService.getPreferReceiptByEmail(client.id)"
            (change)="clientPrefService.setPreferReceiptByEmail(client.id, $any($event.target).checked)"
            aria-label="Toujours envoyer le recu par e-mail" i18n-aria-label="@@pos.components.toujours.envoyer.le.recu.par.e.mail.98f490b9" />
          <span i18n="@@pos.components.recu.par.e.mail.pour.ce.client.5c5d4ea6">Reçu par e-mail pour ce client</span>
        </label>
      </div>
      }

      @if (frequentProducts.length > 0) {
      <!-- Historique client - produits frequents (40) -->
      <div class="order-panel__frequent">
        <span class="order-panel__frequent-title" i18n="@@pos.components.ce.client.prend.souvent.de74a569">Ce client prend souvent :</span>
        <div class="order-panel__frequent-btns">
          @for (p of frequentProducts; track p.id) {
            <button type="button" class="order-panel__frequent-btn" (click)="onFrequentProductAdd.emit(p)" [attr.aria-label]="loc_ui_tern_ajouter_778d9b + p.name">
              {{ p.name }}
            </button>
          }
        </div>
      </div>
      }

      <!-- Order Notes -->
      <div class="order-panel__notes">
        <button
          type="button"
          class="order-panel__notes-toggle"
          (click)="showOrderNotes = !showOrderNotes"
          [attr.aria-expanded]="showOrderNotes">
          <i class="pi pi-pencil"></i>
          <span i18n="@@pos.components.notes.de.commande.6d66940b">Notes de commande</span>
          @if (posState.orderNotes()) {
            <span class="order-panel__notes-badge">1</span>
          }
        </button>
        @if (showOrderNotes) {
          <textarea
            class="order-panel__notes-input"
            [ngModel]="posState.orderNotes()"
            (ngModelChange)="posState.setOrderNotes($event)"
            placeholder="Ex: A emporter, livraison 14h..." i18n-placeholder="@@pos.components.ex.a.emporter.livraison.14h.1eb4a9e6"
            rows="2"
            aria-label="Notes de commande" i18n-aria-label="@@pos.components.notes.de.commande.6d66940b"></textarea>
        }
      </div>
      }

      @if (posState.isFirstPurchaseDiscount()) {
      <div class="order-panel__first-purchase" i18n="@@pos.components.premier.achat.applique.b66f3b88">
        <i class="pi pi-gift"></i>
        <span>Premier achat : -{{ posState.firstPurchaseDiscountPercent() }}% applique</span>
      </div>
      }

      <!-- Divider -->
      <div class="order-panel__divider"></div>

      @if (posState.lines().length > 0 && showVisualCart) {
      <!-- Apercu visuel du panier (54) -->
      <div class="order-panel__visual-cart">
        <button type="button" class="order-panel__visual-cart-toggle" (click)="showVisualCart = false" aria-label="Fermer apercu" i18n-aria-label="@@pos.components.fermer.apercu.32412ecd" i18n="@@pos.components.9660.cb2e2b05">&#9660;</button>
        <div class="order-panel__visual-cart-scroll">
          @for (line of posState.lines(); track line.id) {
            <div class="order-panel__visual-cart-item" [title]="line.designation + ' x' + line.quantity">
              @if (resolveCartLineImageUrl(line.imageUrl)) {
                <img [src]="resolveCartLineImageUrl(line.imageUrl)!" [alt]="line.designation" />
              } @else {
                <span class="order-panel__visual-cart-placeholder"><i class="pi pi-box"></i></span>
              }
              <span class="order-panel__visual-cart-qty">x{{ line.quantity }}</span>
            </div>
          }
        </div>
      </div>
      } @else if (posState.lines().length > 0) {
      <button type="button" class="order-panel__visual-cart-open" (click)="showVisualCart = true" i18n="@@pos.components.apercu.visuel.du.panier.9ca6544c">
        <i class="pi pi-images"></i> Apercu visuel du panier
      </button>
      }

      <!-- Upsell band -->
      @if (upsellService.hasSuggestions()) {
        <div class="order-panel__upsell">
          <div class="order-panel__upsell-header">
            <span class="order-panel__upsell-title" i18n="@@pos.components.suggestions.861edba0">Suggestions</span>
            <button type="button" class="order-panel__upsell-close" (click)="upsellService.clearSuggestions()" aria-label="Fermer" i18n-aria-label="@@pos.components.fermer.5ab4ec64">
              <i class="pi pi-times"></i>
            </button>
          </div>
          <div class="order-panel__upsell-scroll">
            @for (product of upsellService.suggestions(); track product.id) {
              <div class="order-panel__upsell-card">
                <span class="order-panel__upsell-name">{{ product.name }}</span>
                <span class="order-panel__upsell-price">{{ posState.formatAmountWithCurrency(product.unitPrice) }}</span>
                <button type="button" class="order-panel__upsell-add" (click)="onSuggestionAdd.emit(product)" [attr.aria-label]="loc_ui_tern_ajouter_778d9b + product.name">
                  <i class="pi pi-plus"></i>
                </button>
              </div>
            }
          </div>
        </div>
      }

      <!-- Lines -->
      <div class="order-panel__lines">
        @if (posState.lines().length === 0) {
          <div class="order-panel__empty order-panel__empty--animated">
            <div class="order-panel__empty-icon">
              <i class="pi pi-shopping-cart"></i>
            </div>
            <p class="order-panel__empty-title" i18n="@@pos.components.panier.vide.669bb72c">Panier vide</p>
            <p class="order-panel__empty-text" i18n="@@pos.components.selectionnez.un.produit.dans.le.catalogu.a2cb34e4"><ng-container>Selectionnez un produit dans le catalogue ou appuyez sur </ng-container> <kbd class="order-panel__empty-kbd">F2</kbd> pour rechercher</p>
          </div>
        } @else {
          @for (line of posState.lines(); track line.id) {
            <app-order-line
              [line]="line"
              [quickMode]="posState.isQuickMode()"
              (onIncrement)="posState.incrementQuantity(line.id)"
              (onDecrement)="posState.decrementQuantity(line.id)"
              (onQuantitySet)="posState.updateQuantity(line.id, $event)"
              (onRemove)="posState.removeLine(line.id)"
              (onDiscountSet)="posState.setLineDiscount(line.id, $event.type, $event.value)"
              (onDiscountRemove)="posState.removeLineDiscount(line.id)" />
          }
        }
      </div>

      @if (posState.lines().length > 0) {
        <div class="order-panel__footer">
        <div class="order-panel__totals-section">
          <div class="order-panel__divider"></div>

          <div class="order-panel__totals" [class.order-panel__totals--quick]="posState.isQuickMode()">
            @if (!posState.isQuickMode()) {
            <div class="order-panel__total-row">
              <span class="order-panel__total-label" i18n="@@pos.components.total.ht.2ca17ae6">Total HT</span>
              <span class="order-panel__total-value">{{ posState.formatAmountWithCurrency(posState.totals().subTotalHT) }}</span>
            </div>

            @if (posState.hasGlobalDiscount()) {
              <div class="order-panel__total-row order-panel__total-row--discount">
                <span class="order-panel__total-label" i18n="@@pos.components.remise.globale.a87e11a6">Remise globale</span>
                <span class="order-panel__total-value order-panel__total-value--discount">-{{ posState.formatAmountWithCurrency(posState.totals().totalDiscount) }}</span>
              </div>
            }

            @if (showGlobalDiscountForm) {
              <div class="order-panel__discount-form">
                <select [(ngModel)]="globalDiscountType">
                  <option value="PERCENT" i18n="@@pos.components.pourcentage.e34218e3">Pourcentage</option>
                  <option value="AMOUNT" i18n="@@pos.components.montant.fixe.b4a2ce45">Montant fixe</option>
                </select>
                <input
                  type="number"
                  [(ngModel)]="globalDiscountValue"
                  [min]="0"
                  [attr.max]="globalDiscountType === 'PERCENT' ? 100 : null"
                  step="0.001"
                  placeholder="0" i18n-placeholder="@@pos.components.0.b6589fc6" />
                <button type="button" class="order-panel__discount-apply" (click)="applyGlobalDiscount()" i18n="@@pos.components.appliquer.a4d66139">Appliquer</button>
                <button type="button" class="order-panel__discount-cancel" (click)="cancelGlobalDiscountForm()" i18n="@@pos.components.annuler.49ba3292">Annuler</button>
              </div>
            }

            @if (posState.totals().totalFodec !== 0) {
              <div class="order-panel__total-row">
                <span class="order-panel__total-label">FODEC ({{ posState.totals().fodecRatePercent }}%)</span>
                <span class="order-panel__total-value">{{ posState.formatAmountWithCurrency(posState.totals().totalFodec) }}</span>
              </div>
            }
            @for (vat of posState.totals().vatBreakdown; track vat.rate) {
              <div class="order-panel__total-row order-panel__total-row--vat">
                <span class="order-panel__total-label">TVA {{ vat.rateDisplay | backendLabel }}</span>
                <span class="order-panel__total-value">{{ posState.formatAmountWithCurrency(vat.vatAmount) }}</span>
              </div>
            }
            }

            <div class="order-panel__total-row order-panel__total-row--ttc" [class.order-panel__total-row--ttc-quick]="posState.isQuickMode()">
              <span class="order-panel__total-label" i18n="@@pos.components.total.ttc.9e80ff7c">Total TTC</span>
              <span class="order-panel__total-value">{{ posState.formatAmountWithCurrency(posState.totals().totalTTC) }}</span>
            </div>

            @if (!posState.isQuickMode()) {
            @if (!posState.hasGlobalDiscount() && !showGlobalDiscountForm) {
              <button type="button" class="order-panel__add-discount" (click)="openGlobalDiscountForm()" i18n="@@pos.components.ajouter.remise.92fdf439">
                <i class="pi pi-percentage"></i> Ajouter remise
              </button>
            }

            @if (posState.hasGlobalDiscount() && !showGlobalDiscountForm) {
              <button type="button" class="order-panel__remove-discount" (click)="posState.removeGlobalDiscount()" i18n="@@pos.components.supprimer.remise.cabc76a7"> Supprimer remise </button>
            }
            }

            @if (posState.totals().firstPurchaseDiscount > 0) {
              <div class="order-panel__total-row order-panel__total-row--first-purchase" i18n="@@pos.components.premier.achat.89a0b4f0">
                <span class="order-panel__total-label">Premier achat -{{ posState.firstPurchaseDiscountPercent() }}%</span>
                <span class="order-panel__total-value order-panel__total-value--discount">-{{ posState.formatAmountWithCurrency(posState.totals().firstPurchaseDiscount) }}</span>
              </div>
            }

            @if (posState.paymentSchedule() === 'onAccount') {
              <div class="order-panel__schedule" i18n="@@pos.components.paiement.a.terme.echeance.j.0cb37e43">
                <span class="order-panel__schedule-label">Paiement a terme</span>
                <span class="order-panel__schedule-value">
                  Echeance {{ posState.client()?.defaultPaymentTermDays || 30 }} j
                </span>
              </div>
            }

            <div class="order-panel__total-row order-panel__total-row--net" i18n="@@pos.components.net.a.payer.64737429">
              <span class="order-panel__total-label">
                <i class="pi pi-receipt order-panel__total-net-icon"></i>
                Net a payer
              </span>
              <span class="order-panel__total-value order-panel__total-value--net">{{ posState.formatAmountWithCurrency(posState.totals().totalTTC) }}</span>
            </div>

            @if (!posState.isQuickMode()) {
            <div class="order-panel__schedule-btns">
              <span class="order-panel__schedule-btns-label" i18n="@@pos.components.paiement.7154f3bf">Paiement :</span>
              <button type="button" class="order-panel__schedule-btn" [class.order-panel__schedule-btn--active]="posState.paymentSchedule() === 'immediate'" (click)="posState.setPaymentSchedule('immediate')" i18n="@@pos.components.comptant.ee47253b">
                <i class="pi pi-wallet order-panel__schedule-btn-icon"></i> Comptant
              </button>
              <button
                type="button"
                class="order-panel__schedule-btn"
                [class.order-panel__schedule-btn--active]="posState.paymentSchedule() === 'onAccount'"
                [disabled]="!posState.client()"
                (click)="posState.client() && posState.setPaymentSchedule('onAccount')"
                title="Facture a terme — client identifie obligatoire" i18n-title="@@pos.components.facture.a.terme.client.identifie.obligatoire.32f40c31" i18n="@@pos.components.a.terme.9cc3650a">
                <i class="pi pi-calendar order-panel__schedule-btn-icon"></i> A terme
              </button>
            </div>
            }
          </div>
        </div>

      <div class="order-panel__actions">
        <app-payment-actions
          (onValidate)="onValidate.emit()"
          (onSaveDraft)="onSaveDraft.emit()"
          (onSendEmail)="onSendEmail.emit()"
          (onHold)="onHold.emit()"
          (onCancel)="onCancel.emit()"
          (creditNoteInvoiceSelected)="creditNoteInvoiceSelected.emit($event)" />
      </div>
        </div>
      }
      </div>
    </div>
  `,
  styles: [`
    :host {
      flex: 1;
      min-height: 0;
      display: block;
    }

    .order-panel {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      background: #faf8f5;
      overflow: hidden;
    }

    .order-panel__scroll {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
      scrollbar-gutter: stable;
      scrollbar-width: thin;
      scrollbar-color: var(--color-neutral-300) transparent;
    }

    .order-panel__scroll::-webkit-scrollbar {
      width: 6px;
    }

    .order-panel__scroll::-webkit-scrollbar-thumb {
      background: var(--color-neutral-300);
      border-radius: var(--radius-full);
    }

    .order-panel__scroll::-webkit-scrollbar-thumb:hover {
      background: var(--color-neutral-400);
    }

    .order-panel__footer {
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      background: #faf8f5;
      border-top: 1px solid var(--color-border-subtle);
      box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.04);
      padding-bottom: var(--spacing-4);
    }

    .order-panel__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--spacing-5) var(--spacing-5);
      flex-shrink: 0;
    }

    .order-panel__title {
      font-size: var(--font-size-xl);
      font-weight: var(--font-weight-bold);
      letter-spacing: -0.02em;
      color: var(--color-text-primary);
      margin: 0;
    }

    .order-panel__badge {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-2);
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-secondary);
      background: var(--color-white);
      padding: 6px 14px;
      border-radius: var(--radius-full);
      border: 1px solid var(--color-border-default);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
    }

    .order-panel__badge-icon {
      font-size: 0.85rem;
      color: inherit;
    }

    .order-panel__badge--animated {
      animation: scaleInBounce 300ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
    }

    .order-panel__credit-bandeau {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      padding: var(--spacing-3) var(--spacing-5);
      background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
      color: #b45309;
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
    }

    .order-panel__notes {
      padding: 0 var(--spacing-5);
      margin-bottom: var(--spacing-2);
    }

    .order-panel__notes-toggle {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      width: 100%;
      padding: var(--spacing-2) var(--spacing-3);
      border: 1px solid var(--color-border-default);
      border-radius: var(--radius-lg);
      background: var(--color-white);
      color: var(--color-text-secondary);
      font-size: var(--font-size-sm);
      cursor: pointer;
      transition: all 200ms ease;
    }

    .order-panel__notes-toggle i {
      color: inherit;
      flex-shrink: 0;
    }

    .order-panel__notes-toggle:hover {
      background: var(--color-neutral-50);
      color: var(--color-text-primary);
    }

    .order-panel__notes-badge {
      margin-left: auto;
      min-width: 18px;
      height: 18px;
      padding: 0 6px;
      border-radius: var(--radius-full);
      background: var(--color-primary-500);
      color: var(--color-white);
      font-size: 0.7rem;
      font-weight: var(--font-weight-semibold);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .order-panel__notes-input {
      width: 100%;
      margin-top: var(--spacing-2);
      padding: var(--spacing-3);
      font-size: var(--font-size-sm);
      border: 1px solid var(--color-border-default);
      border-radius: var(--radius-lg);
      resize: vertical;
      min-height: 56px;
    }

    .order-panel__notes-input:focus {
      outline: none;
      border-color: var(--color-primary-500);
    }

    .order-panel__client {
      padding: 0 var(--spacing-5);
      flex-shrink: 0;
    }

    .order-panel__pref-email {
      padding: 0 var(--spacing-5) var(--spacing-2);
    }

    .order-panel__pref-email-label {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      font-size: var(--font-size-xs);
      color: var(--color-text-secondary);
      cursor: pointer;
    }

    .order-panel__pref-email-label input {
      accent-color: var(--color-primary-500);
    }

    .order-panel__frequent {
      padding: 0 var(--spacing-5) var(--spacing-3);
    }

    .order-panel__frequent-title {
      display: block;
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-tertiary);
      margin-bottom: var(--spacing-2);
    }

    .order-panel__frequent-btns {
      display: flex;
      flex-wrap: wrap;
      gap: var(--spacing-2);
    }

    .order-panel__frequent-btn {
      padding: 6px 12px;
      font-size: var(--font-size-xs);
      border: 1px solid var(--color-border-default);
      border-radius: var(--radius-lg);
      background: var(--color-white);
      color: var(--color-text-secondary);
      cursor: pointer;
      transition: all 200ms;
    }

    .order-panel__frequent-btn:hover {
      border-color: var(--color-primary-300);
      background: var(--color-primary-50);
      color: var(--color-primary-700);
    }

    .order-panel__first-purchase {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      padding: var(--spacing-2) var(--spacing-5);
      margin: 0 var(--spacing-5) var(--spacing-2);
      background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
      border-radius: var(--radius-lg);
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: #b45309;
    }

    .order-panel__credit-bandeau i,
    .order-panel__first-purchase i {
      color: inherit;
    }

    .order-panel__first-purchase i {
      font-size: 1rem;
    }

    .order-panel__visual-cart-open {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      margin: 0 var(--spacing-5) var(--spacing-2);
      padding: var(--spacing-2) var(--spacing-3);
      font-size: var(--font-size-xs);
      border: 1px dashed var(--color-border-default);
      border-radius: var(--radius-lg);
      background: var(--color-neutral-50);
      color: var(--color-text-secondary);
      cursor: pointer;
    }

    .order-panel__visual-cart-open i {
      color: inherit;
      flex-shrink: 0;
    }

    .order-panel__visual-cart-open:hover {
      background: var(--color-neutral-100);
      color: var(--color-text-primary);
    }

    .order-panel__visual-cart {
      margin: 0 var(--spacing-3) var(--spacing-2);
      padding: var(--spacing-2);
      background: var(--color-neutral-50);
      border-radius: var(--radius-lg);
      border: 1px solid var(--color-border-subtle);
    }

    .order-panel__visual-cart-toggle {
      display: block;
      width: 100%;
      padding: 4px;
      border: none;
      background: transparent;
      color: var(--color-text-tertiary);
      cursor: pointer;
      font-size: 0.7rem;
    }

    .order-panel__visual-cart-scroll {
      display: flex;
      gap: var(--spacing-2);
      overflow-x: auto;
      padding: var(--spacing-2) 0;
    }

    .order-panel__visual-cart-item {
      flex-shrink: 0;
      position: relative;
      width: 48px;
      height: 48px;
      border-radius: var(--radius-md);
      overflow: hidden;
      background: var(--color-neutral-100);
    }

    .order-panel__visual-cart-item img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .order-panel__visual-cart-placeholder {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
      color: var(--color-neutral-400);
      font-size: 1.2rem;
    }

    .order-panel__visual-cart-placeholder i {
      color: inherit;
    }

    .order-panel__visual-cart-qty {
      position: absolute;
      bottom: 0;
      right: 0;
      font-size: 0.65rem;
      font-weight: var(--font-weight-semibold);
      background: rgba(0,0,0,0.6);
      color: var(--color-white);
      padding: 1px 4px;
      border-radius: var(--radius-sm);
    }

    .order-panel__schedule {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: var(--spacing-2) 0;
      font-size: var(--font-size-sm);
    }

    .order-panel__schedule-label {
      color: var(--color-text-secondary);
    }

    .order-panel__schedule-value {
      font-weight: var(--font-weight-semibold);
      color: var(--color-primary-600);
    }

    .order-panel__total-row--first-purchase .order-panel__total-value {
      color: var(--color-success-600);
    }

    .order-panel__schedule-btns {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--spacing-2);
      padding: var(--spacing-3) 0;
      border-top: 1px solid var(--color-border-subtle);
      margin-top: var(--spacing-2);
    }

    .order-panel__schedule-btns-label {
      font-size: var(--font-size-xs);
      color: var(--color-text-tertiary);
      margin-right: var(--spacing-2);
    }

    .order-panel__schedule-btn {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-2);
      padding: 6px 12px;
      font-size: var(--font-size-xs);
      border: 1px solid var(--color-border-default);
      border-radius: var(--radius-lg);
      background: var(--color-white);
      color: var(--color-text-secondary);
      cursor: pointer;
    }

    .order-panel__schedule-btn-icon {
      font-size: 0.9rem;
      color: inherit;
      flex-shrink: 0;
    }

    .order-panel__schedule-btn--active .order-panel__schedule-btn-icon {
      color: inherit;
    }

    .order-panel__schedule-btn--active {
      background: var(--color-primary-500);
      color: var(--color-white);
      border-color: var(--color-primary-500);
    }

    .order-panel__divider {
      height: 0.5px;
      background: var(--color-border-subtle);
      margin: var(--spacing-4) var(--spacing-5);
      flex-shrink: 0;
    }

    .order-panel__upsell {
      flex-shrink: 0;
      margin: 0 var(--spacing-3) var(--spacing-2);
      padding: var(--spacing-3);
      background: linear-gradient(135deg, var(--color-primary-50) 0%, var(--color-primary-100) 100%);
      border: 1px solid var(--color-primary-200);
      border-radius: var(--radius-lg);
      animation: fadeInUp 300ms ease-out;
    }

    .order-panel__upsell-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: var(--spacing-2);
    }

    .order-panel__upsell-title {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--color-primary-800);
    }

    .order-panel__upsell-close {
      padding: 4px;
      border: none;
      background: transparent;
      color: var(--color-primary-600);
      cursor: pointer;
      border-radius: var(--radius-md);
      transition: background 150ms;
    }

    .order-panel__upsell-close i {
      color: inherit;
      flex-shrink: 0;
    }

    .order-panel__upsell-close:hover {
      background: var(--color-primary-200);
    }

    .order-panel__upsell-scroll {
      display: flex;
      gap: var(--spacing-2);
      overflow-x: auto;
      scrollbar-width: thin;
      padding-bottom: 2px;
    }

    .order-panel__upsell-scroll::-webkit-scrollbar {
      height: 4px;
    }

    .order-panel__upsell-scroll::-webkit-scrollbar-thumb {
      background: var(--color-primary-300);
      border-radius: var(--radius-full);
    }

    .order-panel__upsell-card {
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: var(--spacing-1);
      min-width: 120px;
      padding: var(--spacing-2) var(--spacing-3);
      background: var(--color-white);
      border: 1px solid var(--color-primary-200);
      border-radius: var(--radius-md);
      transition: box-shadow 150ms;
    }

    .order-panel__upsell-card:hover {
      box-shadow: 0 2px 8px rgba(26, 92, 76, 0.12);
    }

    .order-panel__upsell-name {
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-medium);
      color: var(--color-text-primary);
      line-height: 1.3;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .order-panel__upsell-price {
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-semibold);
      color: var(--color-primary-600);
      font-variant-numeric: tabular-nums;
    }

    .order-panel__upsell-add {
      align-self: stretch;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 6px;
      border: none;
      background: var(--color-primary-500);
      color: var(--color-white);
      border-radius: var(--radius-md);
      cursor: pointer;
      transition: background 150ms;
    }

    .order-panel__upsell-add:hover {
      background: var(--color-primary-600);
    }

    .order-panel__lines {
      padding: 0 var(--spacing-2);
    }

    .order-panel__totals-section {
      flex-shrink: 0;
      background: #faf8f5;
      border-radius: var(--radius-xl);
      margin: 0 var(--spacing-3);
      padding: var(--spacing-3) var(--spacing-2);
    }

    .order-panel__empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: var(--spacing-10) var(--spacing-4);
      text-align: center;
    }

    .order-panel__empty--animated {
      animation: fadeInUp 400ms ease-out forwards;
    }

    .order-panel__empty-icon {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 88px;
      height: 88px;
      border-radius: var(--radius-2xl);
      background: linear-gradient(135deg, var(--color-neutral-100) 0%, var(--color-neutral-50) 100%);
      color: var(--color-neutral-400);
      font-size: 2.5rem;
      margin-bottom: var(--spacing-5);
      animation: orderPanelEmptyBreathe 3s ease-in-out infinite;
    }

    .order-panel__empty-icon i {
      color: inherit;
    }

    .order-panel__empty-icon::before {
      content: '';
      position: absolute;
      inset: -8px;
      border-radius: var(--radius-2xl);
      background: var(--color-neutral-100);
      opacity: 0.4;
      z-index: -1;
    }

    @keyframes orderPanelEmptyBreathe {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.04); }
    }

    .order-panel__empty-title {
      font-size: var(--font-size-lg);
      font-weight: var(--font-weight-bold);
      color: var(--color-text-primary);
      margin-bottom: var(--spacing-2);
    }

    .order-panel__empty-text {
      font-size: var(--font-size-sm);
      color: var(--color-text-tertiary);
      max-width: 260px;
      line-height: 1.5;
    }

    .order-panel__empty-kbd {
      display: inline-flex;
      align-items: center;
      padding: 2px 6px;
      background: var(--color-neutral-200);
      border: 1px solid var(--color-border-default);
      border-radius: var(--radius-md);
      font-size: 0.7rem;
      font-weight: var(--font-weight-semibold);
      font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
      color: var(--color-text-primary);
      box-shadow: 0 1px 0 var(--color-border-subtle);
    }

    .order-panel__totals {
      padding: 0 var(--spacing-5);
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);
    }

    .order-panel__total-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .order-panel__total-label {
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
    }

    .order-panel__total-value {
      font-family: 'JetBrains Mono', 'SF Mono', 'Consolas', monospace;
      font-variant-numeric: tabular-nums;
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      color: var(--color-text-primary);
    }

    .order-panel__total-row:not(.order-panel__total-row--ttc):not(.order-panel__total-row--net) .order-panel__total-label {
      font-size: var(--font-size-xs);
      color: var(--color-text-tertiary);
    }

    .order-panel__total-row:not(.order-panel__total-row--ttc):not(.order-panel__total-row--net) .order-panel__total-value {
      font-size: var(--font-size-xs);
      color: var(--color-text-tertiary);
    }

    .order-panel__total-row--ttc {
      padding-top: var(--spacing-4);
      margin-top: var(--spacing-2);
      border-top: 3px solid var(--color-border-default);
    }

    .order-panel__total-row--ttc .order-panel__total-label {
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
    }

    .order-panel__total-row--ttc .order-panel__total-value {
      font-weight: var(--font-weight-bold);
    }

    .order-panel__total-row--discount .order-panel__total-value--discount {
      color: var(--color-success-600);
    }

    .order-panel__discount-form {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--spacing-3);
      padding: var(--spacing-3) 0;
    }

    .order-panel__discount-form select,
    .order-panel__discount-form input {
      padding: 6px 10px;
      border: 1px solid var(--color-border-default);
      border-radius: var(--radius-md);
      font-size: var(--font-size-sm);
      max-width: 100px;
    }

    .order-panel__discount-apply,
    .order-panel__discount-cancel {
      padding: 6px 12px;
      border: none;
      border-radius: var(--radius-md);
      font-size: var(--font-size-sm);
      cursor: pointer;
      font-weight: var(--font-weight-medium);
    }

    .order-panel__discount-apply {
      background: var(--color-primary-500);
      color: var(--color-white);
    }

    .order-panel__discount-cancel {
      background: var(--color-neutral-100);
      color: var(--color-text-secondary);
    }

    .order-panel__add-discount,
    .order-panel__remove-discount {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      padding: var(--spacing-2) var(--spacing-3);
      margin-top: var(--spacing-2);
      border: 1px dashed var(--color-border-default);
      border-radius: var(--radius-lg);
      background: transparent;
      color: var(--color-text-secondary);
      font-size: var(--font-size-sm);
      cursor: pointer;
      transition: all 200ms ease;
    }

    .order-panel__add-discount i {
      color: inherit;
      flex-shrink: 0;
    }

    .order-panel__add-discount:hover,
    .order-panel__remove-discount:hover {
      border-color: var(--color-primary-300);
      color: var(--color-primary-600);
      background: var(--color-primary-50);
    }

    .order-panel__remove-discount {
      border-style: solid;
      color: var(--color-error-600);
      border-color: var(--color-error-200);
    }

    .order-panel__remove-discount:hover {
      background: var(--color-error-50);
      border-color: var(--color-error-300);
    }

    .order-panel__total-row--net {
      padding: var(--spacing-4);
      margin: var(--spacing-3) 0 0;
      background: var(--color-primary-50);
      border-radius: var(--radius-lg);
      border: 1px solid var(--color-primary-200);
      box-shadow: none;
    }

    .order-panel__total-row--net .order-panel__total-label {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--color-primary-800);
    }

    .order-panel__total-net-icon {
      font-size: 1rem;
      color: var(--color-primary-600);
    }

    .order-panel__total-value--net {
      font-size: 1.35rem !important;
      font-weight: var(--font-weight-bold) !important;
      color: var(--color-primary-900) !important;
    }

    .order-panel__actions {
      padding: var(--spacing-3) var(--spacing-5);
      border-top: 1px solid var(--color-border-subtle);
      flex-shrink: 0;
    }

    @media (max-width: 768px) {
      .order-panel__header,
      .order-panel__client {
        padding-left: var(--spacing-4);
        padding-right: var(--spacing-4);
      }

      .order-panel__divider {
        margin-left: var(--spacing-4);
        margin-right: var(--spacing-4);
      }

      .order-panel__totals {
        padding: 0 var(--spacing-4);
      }

      .order-panel__actions {
        padding: var(--spacing-3) var(--spacing-4);
      }
    }
  `]
})
export class OrderPanelComponent {
  readonly loc_ui_tern_ajouter_778d9b = $localize`:@@ui.tern.ajouter.778d9b:Ajouter `;
  @Input() frequentProducts: ProductListItem[] = [];
  @Output() onValidate = new EventEmitter<void>();
  @Output() onSaveDraft = new EventEmitter<void>();
  @Output() onSendEmail = new EventEmitter<void>();
  @Output() onHold = new EventEmitter<void>();
  @Output() onCancel = new EventEmitter<void>();
  @Output() creditNoteInvoiceSelected = new EventEmitter<LinkedInvoiceRef>();
  @Output() onSuggestionAdd = new EventEmitter<ProductListItem>();
  @Output() onFrequentProductAdd = new EventEmitter<ProductListItem>();

  readonly posState = inject(PosStateService);
  readonly upsellService = inject(PosUpsellService);
  readonly clientPrefService = inject(PosClientPreferencesService);
  private readonly productService = inject(ProductService);
  showGlobalDiscountForm = false;
  showOrderNotes = false;
  showVisualCart = false;
  globalDiscountType: 'PERCENT' | 'AMOUNT' = 'PERCENT';
  globalDiscountValue = 0;

  openGlobalDiscountForm(): void {
    this.showGlobalDiscountForm = true;
    this.globalDiscountType = this.posState.globalDiscountType() ?? 'PERCENT';
    this.globalDiscountValue = this.posState.globalDiscountValue() ?? 0;
  }

  applyGlobalDiscount(): void {
    if (this.globalDiscountValue > 0) {
      this.posState.setGlobalDiscount(this.globalDiscountType, this.globalDiscountValue);
    }
    this.showGlobalDiscountForm = false;
  }

  cancelGlobalDiscountForm(): void {
    this.showGlobalDiscountForm = false;
  }

  resolveCartLineImageUrl(url: string | null | undefined): string | null {
    return this.productService.resolveProductImageUrl(url ?? null);
  }
}
