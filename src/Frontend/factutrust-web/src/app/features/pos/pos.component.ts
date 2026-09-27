/// <reference types="@angular/localize" />
import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';
import { Component, inject, OnDestroy, OnInit, HostListener, ViewChild, effect, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { switchMap, catchError, tap } from 'rxjs/operators';
import { throwError } from 'rxjs';
import { PosStateService } from './services/pos-state.service';
import { PosOrderLine, PaymentSplit } from './services/pos-state.service';
import { PosBarcodeService } from './services/pos-barcode.service';
import { PosHeldOrdersService } from './services/pos-held-orders.service';
import { PosDualScreenService } from './services/pos-dual-screen.service';
import { PosStockService } from './services/pos-stock.service';
import { buildInsufficientStockMessage } from './services/pos-stock-guard';
import { PosUpsellService } from './services/pos-upsell.service';
import { PosAudioService } from './services/pos-audio.service';
import { PosVoiceCommandService } from './services/pos-voice-command.service';
import { PosTtsService } from './services/pos-tts.service';
import { PosClientFavoritesService } from './services/pos-client-favorites.service';
import { PosThemeService } from './services/pos-theme.service';
import { PosIdleService } from './services/pos-idle.service';
import { PosDraftAutosaveService } from './services/pos-draft-autosave.service';
import { PosSessionSyncService } from './services/pos-session-sync.service';
import { PosHeaderComponent } from './components/pos-header/pos-header.component';
import { HeldOrdersPanelComponent } from './components/held-orders-panel/held-orders-panel.component';
import { ChangeCalculatorComponent } from './components/change-calculator/change-calculator.component';
import { PosHistoryPanelComponent } from './components/pos-history-panel/pos-history-panel.component';
import { formatLocalDate } from '@core/utils/date.util';
import { createClientUuid } from '@core/utils/safe-random-uuid.util';
import { PosReceiptComponent, PosReceiptModel } from './components/pos-receipt/pos-receipt.component';
import { CompanyService } from '@core/services/company.service';
import { ProductCatalogComponent } from './components/product-catalog/product-catalog.component';
import { OrderPanelComponent } from './components/order-panel/order-panel.component';
import { ProductListItem } from '@core/services/product.service';
import { InvoiceService } from '@core/services/invoice.service';
import { PrintPreviewService } from '@core/services/print-preview.service';
import { AuthService } from '@core/services/auth.service';
import { InvoiceWizardService } from '../invoices/invoice-wizard/services/invoice-wizard.service';
import {
  PaymentMethod,
  PAYMENT_METHOD_OPTIONS,
  AddressInfo,
  InvoiceLine as WizardInvoiceLine
} from '../invoices/invoice-wizard/models/invoice-wizard.models';
import { LinkedInvoiceRef } from '@core/services/invoice-reference-resolver.service';
import { environment } from '@environments/environment';
import { ConfirmationService } from '@core/services/confirmation.service';
import { WarehouseContextService } from '@core/services/warehouse-context.service';
import { PricingService } from '@core/services/pricing.service';
import { PosRegisterSessionService, CashRegisterDto, PosSessionReportDto } from './services/pos-register-session.service';
import { PosCheckoutService } from './services/pos-checkout.service';
import { toApiPaymentMethod } from './services/pos-payment.mapper';

@Component({
  selector: 'app-pos',
  standalone: true,
  imports: [BackendLabelPipe, CommonModule, FormsModule, PosHeaderComponent, ProductCatalogComponent, OrderPanelComponent, HeldOrdersPanelComponent, ChangeCalculatorComponent, PosHistoryPanelComponent, PosReceiptComponent],
  template: `
    <div class="pos-layout">
      <app-pos-header
        [heldCount]="heldService.heldOrderCount()"
        [isDualScreenOpen]="dualScreenService.isOpen()"
        [isQuickMode]="posState.isQuickMode()"
        (onNewOrder)="newOrder()"
        (onOpenHeld)="showHeldPanel = true"
        (onOpenHistory)="showHistoryPanel = true"
        (onDualScreenToggle)="toggleDualScreen()"
        (onQuickModeToggle)="posState.toggleQuickMode()"
        (onOpenRegister)="openRegisterModal()"
        (onXReport)="openXReport()"
        (onCloseZ)="openCloseZModal()" />

      <div class="pos-content pos-content--animated">
        <div class="pos-content__catalog">
          <app-product-catalog
            #catalog
            (onProductAdd)="addProductToOrder($event)"
            (onProductAddWithQuantity)="addProductWithQuantity($event)" />
        </div>

        <div class="pos-content__order">
          <app-order-panel
            [frequentProducts]="getFrequentProducts()"
            (onValidate)="validateAndPrint()"
            (onSaveDraft)="saveDraft()"
            (onSendEmail)="sendEmailAfterSale()"
            (onHold)="holdOrder()"
            (onCancel)="newOrder()"
            (creditNoteInvoiceSelected)="onCreditNoteInvoiceSelected($event)"
            (onSuggestionAdd)="addProductToOrder($event)"
            (onFrequentProductAdd)="addProductToOrder($event)" />
        </div>
      </div>

      @if (registerSession.requireOpenSession() && !registerSession.currentSession() && !registerSession.isLoading()) {
        <div class="pos-session-gate">
          <div class="pos-session-gate__box">
            <i class="pi pi-lock"></i>
            <h2 i18n="@@pos.pos.ouvrir.la.caisse.7e98a335">Ouvrir la caisse</h2>
            <p i18n="@@pos.pos.une.session.de.caisse.doit.etre.ouverte.pour.ven.c03daecb">Une session de caisse doit être ouverte pour vendre.</p>
            <button type="button" class="pos-idle-btn" (click)="openRegisterModal()" i18n="@@pos.pos.ouvrir.la.caisse.7e98a335">Ouvrir la caisse</button>
          </div>
        </div>
      }

      @if (showHeldPanel) {
        <app-held-orders-panel
          (onClose)="showHeldPanel = false"
          (onRecall)="showHeldPanel = false" />
      }

      @if (showHistoryPanel) {
        <app-pos-history-panel (onClose)="showHistoryPanel = false" />
      }

      @if (showChangeCalculator) {
        <app-change-calculator
          [totalToPay]="changeCalculatorTotal"
          [disableFinish]="isRecordingPayment"
          (onClose)="closeChangeCalculator()" />
      }

      @if (showBarcodeToast) {
        <div class="pos-toast" [class.pos-toast--success]="barcodeToastType === 'added'" [class.pos-toast--warning]="barcodeToastType === 'not_found' || barcodeToastType === 'out_of_stock'">
          <div class="pos-toast__content">
            <div class="pos-toast__icon">
              @if (barcodeToastType === 'added') {
                <i class="pi pi-check-circle"></i>
              } @else {
                <i class="pi pi-exclamation-triangle"></i>
              }
            </div>
            <div class="pos-toast__text">
              <span class="pos-toast__title">{{ barcodeToastMessage }}</span>
            </div>
          </div>
          <div class="pos-toast__progress"></div>
        </div>
      }

      <app-pos-receipt #receiptRef [receipt]="receiptModel" />

      @if (showSuccessToast) {
        <div class="pos-toast pos-toast--success">
          <div class="pos-toast__content">
            <div class="pos-toast__icon">
              <i class="pi pi-check-circle"></i>
            </div>
            <div class="pos-toast__text">
              <span class="pos-toast__title" i18n="@@pos.pos.facture.creee.avec.succes.af22457e">Facture creee avec succes</span>
              <span class="pos-toast__subtitle">{{ successMessage }}</span>
            </div>
          </div>
          <div class="pos-toast__progress"></div>
        </div>
      }

      @if (idleService.locked()) {
        <div class="pos-idle-overlay">
          <div class="pos-idle-box">
            <i class="pi pi-lock"></i>
            <h2 i18n="@@pos.pos.session.verrouillee.f1549c06">Session verrouillee</h2>
            <p i18n="@@pos.pos.inactivite.de.min.saisissez.votre.mot.de.939f220f">Inactivite de {{ idleService.idleMinutes() }} min. Saisissez votre mot de passe pour reprendre.</p>
            <input
              type="password"
              [(ngModel)]="idleUnlockPassword"
              (keydown.enter)="unlockIdle()"
              placeholder="Mot de passe" i18n-placeholder="@@pos.pos.mot.de.passe.94e2f3ee"
              class="pos-idle-input"
              aria-label="Mot de passe" i18n-aria-label="@@pos.pos.mot.de.passe.94e2f3ee" />
            @if (idleUnlockError) {
              <p class="pos-idle-error">{{ idleUnlockError }}</p>
            }
            <button type="button" class="pos-idle-btn" (click)="unlockIdle()" i18n="@@pos.pos.reprendre.1c56710b">Reprendre</button>
          </div>
        </div>
      }

      @if (showRestoreDraftModal) {
        <div class="pos-modal-overlay" (click)="showRestoreDraftModal = false">
          <div class="pos-modal pos-modal--draft" (click)="$event.stopPropagation()">
            <h3 i18n="@@pos.pos.reprendre.la.commande.7c6faab9">Reprendre la commande ?</h3>
            <p i18n="@@pos.pos.une.commande.enregistree.localement.a.ete.trouve.4cad41c4">Une commande enregistree localement a ete trouvee. Voulez-vous la reprendre ?</p>
            <div class="pos-modal-actions">
              <button type="button" class="pos-modal-btn pos-modal-btn--primary" (click)="restoreDraft()" i18n="@@pos.pos.reprendre.1c56710b">Reprendre</button>
              <button type="button" class="pos-modal-btn" (click)="dismissDraft(); showRestoreDraftModal = false" i18n="@@pos.pos.nouvelle.commande.061f365b">Nouvelle commande</button>
            </div>
          </div>
        </div>
      }

      @if (showRestoreCloudModal) {
        <div class="pos-modal-overlay" (click)="showRestoreCloudModal = false">
          <div class="pos-modal pos-modal--cloud" (click)="$event.stopPropagation()">
            <h3 i18n="@@pos.pos.reprendre.sur.cet.appareil.dfabe137">Reprendre sur cet appareil ?</h3>
            <p i18n="@@pos.pos.une.commande.enregistree.sur.un.autre.poste.est..72a3665a">Une commande enregistree sur un autre poste est disponible.</p>
            <div class="pos-modal-actions">
              <button type="button" class="pos-modal-btn pos-modal-btn--primary" (click)="restoreCloudSession()" i18n="@@pos.pos.reprendre.1c56710b">Reprendre</button>
              <button type="button" class="pos-modal-btn" (click)="dismissCloudSession(); showRestoreCloudModal = false" i18n="@@pos.pos.ignorer.b0d64e49">Ignorer</button>
            </div>
          </div>
        </div>
      }

      @if (showOpenSessionModal) {
        <div class="pos-modal-overlay" (click)="showOpenSessionModal = false">
          <div class="pos-modal" (click)="$event.stopPropagation()">
            <h3 i18n="@@pos.pos.ouvrir.la.caisse.7e98a335">Ouvrir la caisse</h3>
            <p i18n="@@pos.pos.saisissez.le.fond.de.caisse.declare.especes.ce.m.c250b8be">Saisissez le fond de caisse déclaré (espèces). Ce montant n'écrit pas d'opération de trésorerie.</p>
            @if (availableRegisters.length > 1) {
              <label class="pos-modal-label" for="pos-register-select" i18n="@@pos.pos.caisse.ce5a5c98">Caisse</label>
              <select id="pos-register-select" class="pos-idle-input" [(ngModel)]="selectedRegisterIdForOpen">
                @for (reg of availableRegisters; track reg.id) {
                  <option [value]="reg.id">{{ reg.code }} — {{ reg.name }}{{ reg.isDefault ? loc_ui_tern_defaut_f21337 : '' }}</option>
                }
              </select>
            }
            <label class="pos-modal-label" for="pos-opening-float" i18n="@@pos.pos.fond.de.caisse.tnd.987425b1">Fond de caisse (TND)</label>
            <input id="pos-opening-float" type="number" min="0" step="0.001" class="pos-idle-input" [(ngModel)]="openingFloatInput" />
            <div class="pos-modal-actions">
              <button type="button" class="pos-modal-btn pos-modal-btn--primary" (click)="confirmOpenSession()" i18n="@@pos.pos.ouvrir.42c07747">Ouvrir</button>
              <button type="button" class="pos-modal-btn" (click)="showOpenSessionModal = false" i18n="@@pos.pos.annuler.49ba3292">Annuler</button>
            </div>
          </div>
        </div>
      }

      @if (showCloseZModal) {
        <div class="pos-modal-overlay" (click)="showCloseZModal = false">
          <div class="pos-modal pos-modal--wide" (click)="$event.stopPropagation()">
            <h3 i18n="@@pos.pos.cloture.z.e93fcfd6">Clôture Z</h3>
            @if (closePreview) {
              <p><ng-container i18n="@@pos.pos.theorique.especes.4b60f776">Théorique espèces : </ng-container> <strong>{{ formatSessionAmount(closePreview.expectedCash) }} TND</strong></p>
              @if (closePreview.heldTicketCount > 0) {
                <p i18n="@@pos.pos.attention.ticket.s.encore.en.attente.ils.68530859">Attention : {{ closePreview.heldTicketCount }} ticket(s) encore en attente. Ils ne bloquent pas la clôture.</p>
              }
            }
            <label class="pos-modal-label" for="pos-counted-cash" i18n="@@pos.pos.comptage.especes.tnd.9cc856ec">Comptage espèces (TND)</label>
            <input id="pos-counted-cash" type="number" min="0" step="0.001" class="pos-idle-input" [(ngModel)]="countedCashInput" />
            @if (closePreview) {
              <p [class.pos-variance-zero]="closeVariance() === 0" [class.pos-variance-nonzero]="closeVariance() !== 0" i18n="@@pos.pos.ecart.tnd.c1be9fa3">
                Écart : {{ formatSessionAmount(closeVariance()) }} TND
              </p>
            }
            <div class="pos-modal-actions">
              <button type="button" class="pos-modal-btn pos-modal-btn--primary" (click)="confirmCloseZ()" i18n="@@pos.pos.cloturer.e9f075c1">Clôturer</button>
              <button type="button" class="pos-modal-btn" (click)="showCloseZModal = false" i18n="@@pos.pos.annuler.49ba3292">Annuler</button>
            </div>
          </div>
        </div>
      }

      @if (sessionReport) {
        <div class="pos-modal-overlay" (click)="sessionReport = null">
          <div class="pos-modal pos-modal--wide pos-z-print" (click)="$event.stopPropagation()">
            <h3>{{ sessionReport.zReportNumber ? (loc_ui_tern_cloture_248bfe + sessionReport.zReportNumber) : loc_ui_tern_rapport_x_5a5924 }}</h3>
            <p i18n="@@pos.pos.fond.tnd.bd9049a4">{{ sessionReport.cashRegisterName }} — fond {{ formatSessionAmount(sessionReport.openingFloat) }} TND</p>
            <p i18n="@@pos.pos.tickets.avoirs.5780f599">Tickets : {{ sessionReport.invoiceCount }} — Avoirs : {{ sessionReport.creditNoteCount }}</p>
            <p i18n="@@pos.pos.theorique.tnd.ce72c0f1">Théorique : {{ formatSessionAmount(sessionReport.expectedCash) }} TND</p>
            @if (sessionReport.countedCash != null) {
              <p i18n="@@pos.pos.compte.tnd.ecart.tnd.5ad109bb">Compté : {{ formatSessionAmount(sessionReport.countedCash) }} TND — écart {{ formatSessionAmount(sessionReport.cashVariance ?? 0) }} TND</p>
            }
            <ul>
              @for (row of sessionReport.totalsByMethod; track row.method) {
                <li>{{ row.methodDisplay | backendLabel }} : {{ formatSessionAmount(row.amount) }} TND</li>
              }
            </ul>
            <div class="pos-modal-actions">
              <button type="button" class="pos-modal-btn pos-modal-btn--primary" (click)="printSessionReport()" i18n="@@pos.pos.imprimer.5382c09d">Imprimer</button>
              <button type="button" class="pos-modal-btn" (click)="sessionReport = null" i18n="@@pos.pos.fermer.5ab4ec64">Fermer</button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .pos-layout {
      --pos-header-height: 64px;
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
      background: var(--color-neutral-50);
    }

    .pos-content {
      display: flex;
      flex: 1;
      min-height: 0;
    }

    .pos-content--animated {
      animation: fadeInUp 400ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
    }

    .pos-content__catalog {
      flex: 6;
      display: flex;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
      background: var(--color-neutral-50);
      background-image: radial-gradient(circle at 1px 1px, rgba(148, 163, 184, 0.12) 1px, transparent 0);
      background-size: 24px 24px;
      background-position: 0 0;
    }

    .pos-content__order {
      flex: 4;
      display: flex;
      flex-direction: column;
      min-width: 340px;
      max-width: 480px;
      min-height: 0;
      background: var(--color-white);
      box-shadow: -8px 0 24px -4px rgba(0, 0, 0, 0.08), -2px 0 6px -2px rgba(0, 0, 0, 0.04);
    }

    .pos-toast {
      position: fixed;
      top: calc(var(--pos-header-height, 64px) + 16px);
      right: 24px;
      z-index: 600;
      min-width: 360px;
      border-radius: var(--radius-xl);
      overflow: hidden;
      box-shadow: var(--shadow-2xl);
      border-left: 3px solid var(--color-success-500);
      animation: slideInToastRight 350ms cubic-bezier(0.34, 1.2, 0.64, 1) forwards,
                 slideOutToastRight 250ms ease-in 2700ms forwards;
    }

    .pos-toast__content {
      display: flex;
      align-items: center;
      gap: var(--spacing-4);
      padding: var(--spacing-5) var(--spacing-6);
      background: rgba(255, 255, 255, 0.98);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid var(--color-success-200);
      border-left: none;
    }

    .pos-toast__icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      border-radius: var(--radius-full);
      background: var(--color-success-50);
      color: var(--color-success-600);
      font-size: 1.35rem;
      flex-shrink: 0;
    }

    .pos-toast__text {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .pos-toast__title {
      font-size: var(--font-size-base);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
    }

    .pos-toast__subtitle {
      font-size: var(--font-size-sm);
      color: var(--color-text-tertiary);
    }

    .pos-toast__progress {
      height: 3px;
      background: var(--color-success-200);
      position: relative;
      overflow: hidden;
    }

    .pos-toast__progress::after {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      bottom: 0;
      width: 100%;
      background: var(--color-success-400);
      animation: posToastProgress 3s linear forwards;
    }

    .pos-toast--warning .pos-toast__content {
      border-color: var(--color-error-200, #fecaca);
    }

    .pos-toast--warning .pos-toast__icon {
      background: var(--color-error-50, #fef2f2);
      color: var(--color-error-600, #dc2626);
    }

    .pos-toast--warning .pos-toast__progress {
      background: var(--color-error-200, #fecaca);
    }

    @keyframes posToastProgress {
      from { transform: scaleX(1); transform-origin: left; }
      to { transform: scaleX(0); transform-origin: left; }
    }

    @keyframes slideInToastRight {
      from {
        opacity: 0;
        transform: translateX(32px);
      }
      to {
        opacity: 1;
        transform: translateX(0);
      }
    }

    @keyframes slideOutToastRight {
      from {
        opacity: 1;
        transform: translateX(0);
      }
      to {
        opacity: 0;
        transform: translateX(32px);
      }
    }

    @media (min-width: 1440px) {
      .pos-content__order {
        max-width: 520px;
      }
    }

    @media (max-width: 1280px) {
      .pos-content__order {
        max-width: 420px;
      }
    }

    @media (max-width: 1024px) {
      .pos-layout {
        --pos-header-height: 56px;
      }

      .pos-content {
        flex-direction: column;
      }

      .pos-content__catalog {
        flex: 1;
        background-image: none;
        border-bottom: 1px solid var(--color-border-subtle);
      }

      .pos-content__order {
        max-width: none;
        min-width: auto;
        max-height: 45vh;
        box-shadow: 0 -4px 24px -4px rgba(0, 0, 0, 0.08), 0 -2px 6px -2px rgba(0, 0, 0, 0.04);
        border-top: 4px solid var(--color-primary-500);
      }
    }

    @media (max-width: 768px) {
      .pos-content__order {
        max-height: 50vh;
        min-width: auto;
      }

      .pos-toast {
        right: 16px;
        left: 16px;
      }

      .pos-toast__content {
        width: 100%;
      }
    }

    .pos-idle-overlay {
      position: fixed;
      inset: 0;
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(15, 23, 42, 0.85);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
    }

    .pos-idle-box {
      background: var(--color-white);
      border-radius: var(--radius-2xl);
      padding: var(--spacing-8);
      text-align: center;
      max-width: 360px;
      box-shadow: var(--shadow-2xl);
    }

    .pos-idle-box i {
      font-size: 3rem;
      color: var(--color-primary-500);
      margin-bottom: var(--spacing-4);
    }

    .pos-idle-box h2 {
      margin: 0 0 var(--spacing-2);
      font-size: var(--font-size-xl);
      color: var(--color-text-primary);
    }

    .pos-idle-box p {
      margin: 0 0 var(--spacing-5);
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
    }

    .pos-idle-input {
      width: 100%;
      max-width: 280px;
      padding: var(--spacing-3) var(--spacing-4);
      font-size: 1rem;
      text-align: left;
      letter-spacing: normal;
      border: 1px solid var(--color-border-default);
      border-radius: var(--radius-lg);
      margin-bottom: var(--spacing-4);
    }

    .pos-idle-error {
      color: var(--color-danger, #b91c1c);
      font-size: var(--font-size-sm);
      margin: 0 0 var(--spacing-3);
    }

    .pos-idle-btn {
      padding: var(--spacing-3) var(--spacing-6);
      background: var(--color-primary-500);
      color: var(--color-white);
      border: none;
      border-radius: var(--radius-lg);
      font-weight: var(--font-weight-semibold);
      cursor: pointer;
    }

    .pos-modal-overlay {
      position: fixed;
      inset: 0;
      z-index: 900;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(15, 23, 42, 0.4);
      backdrop-filter: blur(4px);
    }

    .pos-modal {
      background: var(--color-white);
      border-radius: var(--radius-2xl);
      padding: var(--spacing-6);
      max-width: 400px;
      box-shadow: var(--shadow-2xl);
    }

    .pos-modal h3 {
      margin: 0 0 var(--spacing-2);
      font-size: var(--font-size-lg);
      color: var(--color-text-primary);
    }

    .pos-modal p {
      margin: 0 0 var(--spacing-5);
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
    }

    .pos-modal-actions {
      display: flex;
      gap: var(--spacing-3);
      justify-content: flex-end;
    }

    .pos-modal-btn {
      padding: var(--spacing-2) var(--spacing-5);
      border-radius: var(--radius-lg);
      font-weight: var(--font-weight-medium);
      cursor: pointer;
      border: 1px solid var(--color-border-default);
      background: var(--color-white);
      color: var(--color-text-secondary);
    }

    .pos-modal-btn--primary {
      background: var(--color-primary-500);
      color: var(--color-white);
      border-color: var(--color-primary-500);
    }

    .pos-session-gate {
      position: fixed;
      inset: var(--pos-header-height, 64px) 0 0 0;
      z-index: 500;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(15, 23, 42, 0.45);
      backdrop-filter: blur(3px);
    }

    .pos-session-gate__box {
      background: var(--color-white);
      border-radius: var(--radius-2xl);
      padding: var(--spacing-8);
      text-align: center;
      max-width: 420px;
    }

    .pos-session-gate__box i {
      font-size: 2rem;
      color: var(--color-primary-500);
    }

    .pos-modal--wide {
      max-width: 520px;
    }

    .pos-modal-label {
      display: block;
      font-size: var(--font-size-sm);
      margin-bottom: var(--spacing-2);
    }

    .pos-variance-zero { color: #15803d; font-weight: 600; }
    .pos-variance-nonzero { color: #b45309; font-weight: 600; }

    @media print {
      .pos-layout > *:not(.pos-z-print) { display: none !important; }
      .pos-z-print { box-shadow: none; max-width: none; }
    }
  `]
})
export class PosComponent implements OnInit, OnDestroy {
  readonly loc_ui_tern_defaut_f21337 = $localize`:@@ui.tern.defaut.f21337: (défaut)`;
  readonly loc_ui_tern_cloture_248bfe = $localize`:@@ui.tern.cloture.248bfe:Clôture `;
  readonly loc_ui_tern_rapport_x_5a5924 = $localize`:@@ui.tern.rapport.x.5a5924:Rapport X`;
  @ViewChild('catalog') catalogComponent!: ProductCatalogComponent;
  @ViewChild('receiptRef') receiptRef!: PosReceiptComponent;

  readonly posState = inject(PosStateService);
  private readonly barcodeService = inject(PosBarcodeService);
  readonly heldService = inject(PosHeldOrdersService);
  readonly dualScreenService = inject(PosDualScreenService);
  private readonly posStockService = inject(PosStockService);
  private readonly upsellService = inject(PosUpsellService);
  private readonly audioService = inject(PosAudioService);
  private readonly invoiceService = inject(InvoiceService);
  private readonly printPreviewService = inject(PrintPreviewService);
  private readonly wizardService = inject(InvoiceWizardService);
  private readonly voiceCommandService = inject(PosVoiceCommandService);
  readonly ttsService = inject(PosTtsService);
  private readonly clientFavoritesService = inject(PosClientFavoritesService);
  readonly themeService = inject(PosThemeService);
  readonly idleService = inject(PosIdleService);
  private readonly draftAutosaveService = inject(PosDraftAutosaveService);
  private readonly sessionSyncService = inject(PosSessionSyncService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly companyService = inject(CompanyService);
  private readonly warehouseContext = inject(WarehouseContextService);
  private readonly pricingService = inject(PricingService);
  readonly registerSession = inject(PosRegisterSessionService);
  private readonly checkoutService = inject(PosCheckoutService);
  private readonly authService = inject(AuthService);

  showSuccessToast = false;
  showRestoreDraftModal = false;
  showRestoreCloudModal = false;
  showOpenSessionModal = false;
  showCloseZModal = false;
  openingFloatInput = 0;
  countedCashInput = 0;
  closePreview: PosSessionReportDto | null = null;
  sessionReport: PosSessionReportDto | null = null;
  idleUnlockPassword = '';
  idleUnlockError = '';
  availableRegisters: CashRegisterDto[] = [];
  selectedRegisterIdForOpen = '';
  private sendEmailAfterSubmit = false;
  private lastHydratedWarehouseId: string | null = null;
  private skipFirstWarehouseEffect = true;
  successMessage = '';
  showBarcodeToast = false;
  barcodeToastMessage = '';
  barcodeToastType: 'added' | 'not_found' | 'multiple' | 'out_of_stock' = 'added';
  showHeldPanel = false;
  showHistoryPanel = false;
  showChangeCalculator = false;
  changeCalculatorTotal = 0;
  receiptModel: PosReceiptModel | null = null;
  private cachedInvoiceFooter = '';
  private cachedCompanyReceipt: {
    name: string;
    addressLine: string;
    email: string;
    logoUrl: string | null;
  } | null = null;
  private toastTimeout?: ReturnType<typeof setTimeout>;
  private barcodeToastTimeout?: ReturnType<typeof setTimeout>;
  private sellerLoaded = false;
  /** ID de la facture créée en espèces, pour enregistrer le paiement au clic Terminer. */
  lastCreatedInvoiceIdForCash: string | null = null;
  /** Empêche double envoi lors de l'enregistrement du paiement. */
  isRecordingPayment = false;

    constructor() {
    effect(() => {
      const result = this.barcodeService.lastScanResult();
      if (!result) return;
      this.barcodeToastType = result;
      if (result === 'added') {
        this.barcodeToastMessage = $localize`:@@pos.pos.ts.produit.ajoute.par.scan.ace05abe:Produit ajoute par scan`;
        this.audioService.beepScan();
      } else if (result === 'not_found') {
        this.audioService.beepError();
        this.barcodeToastMessage = $localize`:@@pos.pos.ts.produit.non.trouve.91e3db45:Produit non trouve`;
      } else if (result === 'out_of_stock') {
        this.audioService.beepError();
        this.barcodeToastMessage = $localize`:@@pos.pos.ts.produit.en.rupture.de.stock.e9dbdcda:Produit en rupture de stock`;
      } else {
        this.barcodeToastMessage = $localize`:@@pos.pos.ts.plusieurs.produits.correspondent.selecti.1667c366:Plusieurs produits correspondent - selectionnez dans le catalogue`;
        const code = this.barcodeService.lastScannedCode();
        if (code) {
          setTimeout(() => this.catalogComponent?.searchWithCode(code), 0);
        }
      }
      this.showBarcodeToast = true;
      if (this.barcodeToastTimeout) clearTimeout(this.barcodeToastTimeout);
      this.barcodeToastTimeout = setTimeout(() => {
        this.showBarcodeToast = false;
      }, 2500);
    });

    // Retarification au changement de client ou de quantite (paliers tarifaires).
    effect(() => {
      const clientId = this.posState.client()?.id ?? null;
      const qtyKey = this.posState.lines().map(l => `${l.productId}:${l.quantity}`).join('|');
      void qtyKey;
      this.repriceOrderForClient(clientId);
    });

    effect(() => {
      this.posState.lines();
      this.posState.isDirty();
      this.sessionSyncService.scheduleSave();
    });

    effect(() => {
      const warehouseId = this.warehouseContext.selectedWarehouseId();
      untracked(() => this.onWarehouseChanged(warehouseId));
    });
  }

  /**
   * Aligne les prix du ticket sur ce que le serveur appliquera pour ce client.
   *
   * Silencieux en cas d'echec : la caisse ne doit jamais se bloquer sur la tarification. Les
   * lignes gardent alors le prix catalogue deja affiche.
   */
  private repriceOrderForClient(clientId: string | null): void {
    const lines = this.posState.lines();
    if (lines.length === 0) return;

    const items = lines.map(l => ({ productId: l.productId, quantity: l.quantity }));

    this.pricingService.resolveBatch(items, clientId).subscribe({
      next: response => {
        const resolved = response?.data;
        if (resolved?.length) {
          this.posState.applyResolvedPrices(resolved);
        }
      },
      error: () => { /* prix catalogue conserve */ }
    });
  }

  /**
   * Resout le prix d'un produit qui vient d'etre ajoute, lorsqu'un vrai client est rattache.
   * Sans client identifie, le prix catalogue est deja le bon et aucun appel n'est fait.
   */
  private resolvePriceForAddedProduct(productId: string): void {
    const clientId = this.posState.client()?.id ?? null;
    if (!clientId) return;

    const line = this.posState.lines().find(l => l.productId === productId);

    this.pricingService.resolve(productId, clientId, line?.quantity ?? 1).subscribe({
      next: response => {
        const resolved = response?.data;
        if (resolved) {
          this.posState.applyResolvedPrices([{
            productId,
            unitPriceHT: resolved.unitPriceHT,
            isNegotiated: resolved.isNegotiated
          }]);
        }
      },
      error: () => { /* prix catalogue conserve */ }
    });
  }

  private voiceCommandSub = this.voiceCommandService.onCommand.subscribe(cmd => {
    if (cmd === 'undo_last_line') {
      this.posState.removeLastLine();
      this.audioService.beepSuccess();
    }
  });

  ngOnInit(): void {
    this.wizardService.ensureFiscalStampLoaded();
    this.loadSeller();
    this.companyService.getCompany().subscribe(res => {
      if (!res.success || !res.data) return;
      const c = res.data;
      const addr = c.address;
      const addressLine =
        addr.fullAddress?.trim() ||
        [addr.street, addr.streetLine2, addr.postalCode, addr.city, addr.governorate]
          .filter((x): x is string => !!x?.trim())
          .join(', ');
      this.cachedCompanyReceipt = {
        name: c.companyName,
        addressLine,
        email: c.email?.trim() ?? '',
        logoUrl: c.logoUrl?.trim() || null
      };
      const footer = c.invoiceFooter?.trim();
      if (footer) this.cachedInvoiceFooter = footer;
    });
    this.barcodeService.startListening();
    this.themeService.init();
    this.idleService.startWatching();
    this.draftAutosaveService.start();
    if (this.draftAutosaveService.hasStoredDraft()) {
      this.showRestoreDraftModal = true;
    }
    this.registerSession.hydrate(this.warehouseContext.selectedWarehouseId()).subscribe(session => {
      if (!session && this.registerSession.requireOpenSession()) {
        this.showOpenSessionModal = true;
        this.loadRegistersForOpen();
      }
    });
    void this.heldService.initialize();
    this.sessionSyncService.hasCloudSession().subscribe(has => {
      if (has) this.showRestoreCloudModal = true;
    });
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyboardShortcuts(event: KeyboardEvent): void {
    this.idleService.touch();
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
      if (event.key !== 'Escape') return;
    }

    switch (event.key) {
      case 'F2':
        event.preventDefault();
        this.catalogComponent?.focusSearch();
        break;
      case 'F5':
        event.preventDefault();
        this.validateAndPrint();
        break;
      case 'F4':
        event.preventDefault();
        this.posState.toggleQuickMode();
        break;
      case 'F6':
        event.preventDefault();
        this.ttsService.speakTotal();
        break;
      case 'F9':
        event.preventDefault();
        this.newOrder();
        break;
      case 'Escape':
        event.preventDefault();
        break;
    }
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.idleService.touch();
  }

  unlockIdle(): void {
    const email = this.authService.user()?.email?.trim();
    const password = this.idleUnlockPassword;
    if (!email || !password) {
      this.idleUnlockError = $localize`:@@pos.pos.ts.saisissez.votre.mot.de.passe.1916c0ee:Saisissez votre mot de passe.`;
      return;
    }
    this.idleUnlockError = '';
    this.authService.login({ email, password, rememberMe: true }).subscribe({
      next: res => {
        if (res.success) {
          this.idleService.unlock();
          this.idleUnlockPassword = '';
          return;
        }
        this.idleUnlockError = res.message || $localize`:@@pos.pos.ts.mot.de.passe.incorrect.c4b8638f:Mot de passe incorrect.`;
      },
      error: () => {
        this.idleUnlockError = $localize`:@@pos.pos.ts.mot.de.passe.incorrect.c4b8638f:Mot de passe incorrect.`;
      }
    });
  }

  sendEmailAfterSale(): void {
    this.sendEmailAfterSubmit = true;
    this.validateAndPrint();
  }

  openRegisterModal(): void {
    this.showOpenSessionModal = true;
    this.loadRegistersForOpen();
  }

  restoreDraft(): void {
    this.draftAutosaveService.restore();
    this.showRestoreDraftModal = false;
  }

  dismissDraft(): void {
    this.draftAutosaveService.clear();
  }

  restoreCloudSession(): void {
    this.sessionSyncService.getFromCloud().subscribe(state => {
      if (state && state.lines?.length) {
        this.posState.restoreSnapshot(state);
        this.sessionSyncService.clearCloudSession();
      }
      this.showRestoreCloudModal = false;
    });
  }

  dismissCloudSession(): void {
    this.sessionSyncService.clearCloudSession();
    this.showRestoreCloudModal = false;
  }

  getFrequentProducts(): ProductListItem[] {
    const clientId = this.posState.client()?.id ?? null;
    const cache = this.catalogComponent?.productCache() ?? new Map();
    return this.clientFavoritesService.getFrequentProducts(clientId, cache);
  }

  ngOnDestroy(): void {
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    if (this.barcodeToastTimeout) clearTimeout(this.barcodeToastTimeout);
    this.barcodeService.stopListening();
    this.voiceCommandSub?.unsubscribe();
    this.idleService.stopWatching();
    this.draftAutosaveService.stop();
  }

  addProductToOrder(product: ProductListItem): void {
    if (!this.guardCanAddProduct(product, 1)) return;
    const orderIds = this.posState.lines().map(l => l.productId);
    this.upsellService.computeSuggestions(product, orderIds, this.catalogComponent?.productCache() ?? new Map());
    this.posState.addProduct(product);
    this.resolvePriceForAddedProduct(product.id);
    this.audioService.beepSuccess();
  }

  addProductWithQuantity(event: { product: ProductListItem; quantity: number }): void {
    if (!this.guardCanAddProduct(event.product, event.quantity)) return;
    const orderIds = this.posState.lines().map(l => l.productId);
    this.upsellService.computeSuggestions(event.product, orderIds, this.catalogComponent?.productCache() ?? new Map());
    this.posState.addProductWithQuantity(event.product, event.quantity);
    this.resolvePriceForAddedProduct(event.product.id);
    this.audioService.beepSuccess();
  }

  private guardCanAddProduct(product: ProductListItem, extraQty: number): boolean {
    if (this.posState.isCreditNote()) return true;
    const currentQty = this.posState.lines().find(l => l.productId === product.id)?.quantity ?? 0;
    const check = this.posStockService.canSell(product, extraQty, currentQty);
    if (check.ok) return true;
    this.posState.setError(check.message);
    this.audioService.beepError();
    return false;
  }

  newOrder(): void {
    if (this.posState.isDirty() && this.posState.lines().length > 0) {
      this.confirmationService.confirm({
        header: $localize`:@@pos.pos.ts.abandonner.la.commande.39b13386:Abandonner la commande ?`,
        message: $localize`:@@pos.pos.ts.la.commande.en.cours.sera.perdue.voulez.ec0bd7d3:La commande en cours sera perdue. Voulez-vous continuer ?`,
        icon: 'pi pi-exclamation-triangle',
        acceptLabel: $localize`:@@pos.component.acceptLabel.Abandonner:Abandonner`,
        rejectLabel: $localize`:@@pos.component.rejectLabel.Annuler:Annuler`,
        accept: () => {
          this.upsellService.clearSuggestions();
          this.posState.resetOrder();
        }
      });
      return;
    }
    this.upsellService.clearSuggestions();
    this.posState.resetOrder();
  }

  holdOrder(): void {
    this.heldService.holdCurrentOrder().then(() => {
      this.showHeldPanel = true;
    });
  }

  toggleDualScreen(): void {
    if (this.dualScreenService.isOpen()) {
      this.dualScreenService.close();
    } else {
      this.dualScreenService.open();
      this.posState.broadcastDisplayState();
    }
  }

  /**
   * Uses the draft+submit pipeline exclusively:
   * 1. saveDraft() -> POST /api/invoices/wizard/drafts -> draftId
   * 2. POST /api/invoices/wizard/drafts/{draftId}/submit -> invoiceId
   *
   * The direct POST /api/invoices endpoint fails with an EF Core
   * InvalidOperationException (misreported as "Erreur de contexte")
   * because CreateInvoiceCommand loads entities across separate
   * TenantDbContext instances. The draft+submit pipeline uses
   * SubmitInvoiceCommand which loads everything in a single UnitOfWork.
   */
  validateAndPrint(): void {
    if (!this.posState.canValidate()) return;

    if (!this.registerSession.canSell()) {
      this.showOpenSessionModal = true;
      this.loadRegistersForOpen();
      this.posState.setError('Ouvrez la caisse avant de vendre.');
      this.audioService.beepError();
      return;
    }

    if (this.posState.paymentSchedule() === 'onAccount' && !this.posState.client()) {
      this.posState.setError('Le paiement a terme exige un client identifie.');
      this.audioService.beepError();
      return;
    }

    const outstanding = this.posState.clientOutstanding();
    if (outstanding?.isOverLimit && !this.posState.overLimitAcknowledged()) {
      this.confirmationService.confirm({
        header: $localize`:@@pos.pos.ts.plafond.d.encours.depasse.182d2a10:Plafond d'encours depasse`,
        message: $localize`:@@pos.pos.ts.le.plafond.client.est.depasse.continuer.992db4af:Le plafond client est depasse. Continuer quand meme ? (avertissement, la vente n'est pas bloquee)`,
        icon: 'pi pi-exclamation-triangle',
        acceptLabel: $localize`:@@pos.component.acceptLabel.Continuer_quand_:Continuer quand meme`,
        rejectLabel: $localize`:@@pos.component.rejectLabel.Annuler:Annuler`,
        accept: () => {
          this.posState.acknowledgeOverLimit();
          this.validateAndPrint();
        }
      });
      return;
    }

    if (this.posState.isDemoMode()) {
      this.showToast('Mode demo : facture simulee (aucune ecriture)');
      this.audioService.beepSuccess();
      return;
    }

    if (!this.sellerLoaded) {
      this.posState.setError('Chargement des informations entreprise en cours. Veuillez reessayer.');
      this.audioService.beepError();
      this.loadSeller();
      return;
    }

    this.posState.setProcessing(true);
    this.posState.setError(null);

    this.posStockService.checkOrderStock().subscribe({
      next: check => {
        if (this.posState.isCreditNote()) {
          this.runCreditNoteValidationPipeline();
          return;
        }
        if (!check) {
          this.posState.setError('Impossible de vérifier le stock. Réessayez.');
          this.audioService.beepError();
          this.posState.setProcessing(false);
          return;
        }
        if (!check.allAvailable) {
          const msg = (check.details ?? [])
            .filter(d => !d.isAvailable)
            .map(d => buildInsufficientStockMessage(d.productName, d.requestedQuantity, d.availableQuantity))
            .join('\n');
          this.posState.setError(msg || 'Stock insuffisant pour certains produits.');
          this.audioService.beepError();
          this.posState.setProcessing(false);
          return;
        }
        this.doValidateAndPrint(false);
      },
      error: () => {
        this.posState.setError('Impossible de vérifier le stock. Réessayez.');
        this.audioService.beepError();
        this.posState.setProcessing(false);
      }
    });
  }

  onCreditNoteInvoiceSelected(linkedInvoice: LinkedInvoiceRef): void {
    const activate = () => this.activateCreditNoteMode(linkedInvoice);

    if (this.posState.lines().length > 0) {
      this.confirmationService.confirm({
        header: $localize`:@@pos.pos.ts.remplacer.le.panier.4f7abe74:Remplacer le panier ?`,
        message: $localize`:@@pos.pos.ts.le.panier.actuel.sera.remplace.par.les.l.84680c56:Le panier actuel sera remplacé par les lignes de la facture sélectionnée.`,
        icon: 'pi pi-exclamation-triangle',
        acceptLabel: $localize`:@@pos.component.acceptLabel.Continuer:Continuer`,
        rejectLabel: $localize`:@@pos.component.rejectLabel.Annuler:Annuler`,
        accept: activate
      });
      return;
    }

    activate();
  }

  private activateCreditNoteMode(linkedInvoice: LinkedInvoiceRef): void {
    this.posState.enableCreditNoteMode(linkedInvoice);
    this.posState.setProcessing(true);
    this.posState.setError(null);

    this.wizardService.initForCreditNote(linkedInvoice.id).subscribe({
      next: () => {
        this.populatePosCartFromWizardLines();
        this.posState.setProcessing(false);
        this.showToast('Panier pré-rempli — modifiez les quantités pour un avoir partiel');
      },
      error: err => {
        this.posState.setProcessing(false);
        this.posState.disableCreditNoteMode();
        const message = this.extractErrorMessage(err, $localize`:@@pos.pos.ts.impossible.de.charger.la.facture.liee.53f3a0f5:Impossible de charger la facture liée.`);
        this.posState.setError(message);
        this.audioService.beepError();
      }
    });
  }

  private runCreditNoteValidationPipeline(): void {
    const linked = this.posState.linkedInvoice();
    if (!linked?.id) {
      this.posState.setProcessing(false);
      this.posState.setError('Facture liée invalide. Veuillez sélectionner une facture.');
      this.audioService.beepError();
      return;
    }

    if (this.posState.lines().length === 0) {
      this.posState.setProcessing(false);
      this.posState.setError('Ajoutez au moins une ligne à rembourser.');
      this.audioService.beepError();
      return;
    }

    this.wizardService.initForCreditNote(linked.id).pipe(
      tap(() => this.checkoutService.applyCreditNoteToWizard()),
      switchMap(() => this.checkoutService.submitCurrentDraft()),
      catchError(err => {
        this.posState.setProcessing(false);
        const message = this.extractErrorMessage(err, $localize`:@@pos.pos.ts.erreur.lors.de.la.creation.de.l.avoir.1c0f4923:Erreur lors de la création de l'avoir`);
        this.posState.setError(message);
        this.audioService.beepError();
        return throwError(() => err);
      })
    ).subscribe({
      next: payload => this.onInvoiceCreated(payload),
      error: () => {}
    });
  }

  private populatePosCartFromWizardLines(): void {
    const posLines = this.mapWizardLinesToPosLines(this.wizardService.lines());
    this.posState.setLines(posLines);
  }

  private mapWizardLinesToPosLines(lines: WizardInvoiceLine[]): PosOrderLine[] {
    return lines.map(line => ({
      id: createClientUuid(),
      productId: line.productId ?? '',
      productCode: '',
      designation: line.designation,
      description: line.description,
      quantity: line.quantity,
      unit: line.unit ?? '',
      unitPriceHT: line.unitPriceHT,
      vatRate: line.vatRate,
      isFodecApplicable: line.isFodecApplicable ?? false,
      fodecAmount: line.fodecAmount,
      totalHT: line.totalHT,
      vatAmount: line.vatAmount,
      totalTTC: line.totalTTC,
      discountType: line.discountType,
      discountValue: line.discountValue,
      discountAmount: line.discountAmount,
      notes: ''
    }));
  }

  private doValidateAndPrint(skipPrepare = false): void {
    this.repriceThen(() => {
      if (!skipPrepare) {
        this.checkoutService.applySaleToWizard();
      }

      this.checkoutService.submitCurrentDraft().pipe(
        catchError(err => {
          this.posState.setProcessing(false);
          const message = this.extractErrorMessage(err, $localize`:@@pos.pos.ts.erreur.lors.de.la.creation.de.la.facture.01f7e6d5:Erreur lors de la creation de la facture`);
          this.posState.setError(message);
          this.audioService.beepError();
          return throwError(() => err);
        })
      ).subscribe({
        next: payload => this.onInvoiceCreated(payload),
        error: () => {}
      });
    });
  }

  private prepareWizardState(): void {
    this.checkoutService.applySaleToWizard();
  }

  private onWarehouseChanged(warehouseId: string | null): void {
    if (this.skipFirstWarehouseEffect) {
      this.skipFirstWarehouseEffect = false;
      this.lastHydratedWarehouseId = warehouseId;
      return;
    }
    if (warehouseId === this.lastHydratedWarehouseId) {
      return;
    }

    const previous = this.lastHydratedWarehouseId;
    const apply = () => {
      this.lastHydratedWarehouseId = warehouseId;
      this.posStockService.invalidateOrderStockCache();
      this.posStockService.loadCatalogAlerts();
      this.registerSession.hydrate(warehouseId).subscribe(session => {
        if (!session && this.registerSession.requireOpenSession()) {
          this.showOpenSessionModal = true;
          this.loadRegistersForOpen();
        }
      });
      void this.heldService.initialize();
    };

    if (this.posState.lines().length > 0) {
      this.confirmationService.confirm({
        header: $localize`:@@pos.pos.ts.changer.de.magasin.33744235:Changer de magasin ?`,
        message: $localize`:@@pos.pos.ts.le.panier.est.lie.au.magasin.precedent.c.20de7d7f:Le panier est lie au magasin precedent. Continuer videra le panier.`,
        icon: 'pi pi-exclamation-triangle',
        acceptLabel: $localize`:@@pos.component.acceptLabel.Vider_et_continu:Vider et continuer`,
        rejectLabel: $localize`:@@pos.component.rejectLabel.Annuler:Annuler`,
        accept: () => {
          this.posState.resetOrder();
          apply();
        },
        reject: () => {
          if (previous) {
            this.warehouseContext.setSelectedWarehouse(previous);
          }
        }
      });
      return;
    }

    apply();
  }

  private repriceThen(action: () => void): void {
    const lines = this.posState.lines().filter(l => !l.priceManuallyEdited);
    if (lines.length === 0 || this.posState.isCreditNote()) {
      action();
      return;
    }
    const clientId = this.posState.client()?.id ?? null;
    const items = lines.map(l => ({ productId: l.productId, quantity: l.quantity }));
    this.pricingService.resolveBatch(items, clientId).subscribe({
      next: response => {
        const resolved = response?.data;
        if (resolved?.length) {
          this.posState.applyResolvedPrices(resolved);
        }
        action();
      },
      error: () => action()
    });
  }

  private loadRegistersForOpen(): void {
    const warehouseId = this.warehouseContext.selectedWarehouseId();
    if (!warehouseId) {
      this.availableRegisters = [];
      return;
    }

    const cached = this.registerSession.availableRegisters();
    if (cached.length > 0) {
      this.availableRegisters = cached;
      this.selectedRegisterIdForOpen =
        this.registerSession.selectedRegisterId()
        ?? cached.find(r => r.isDefault)?.id
        ?? cached[0]?.id
        ?? '';
      return;
    }

    this.registerSession.listRegisters(warehouseId).subscribe({
      next: list => {
        this.availableRegisters = list;
        this.selectedRegisterIdForOpen =
          this.registerSession.selectedRegisterId()
          ?? list.find(r => r.isDefault)?.id
          ?? list[0]?.id
          ?? '';
      },
      error: () => {
        this.availableRegisters = [];
      }
    });
  }

  saveDraft(): void {
    if (!this.posState.canSaveDraft()) return;
    this.posState.setProcessing(true);
    this.posState.setError(null);

    this.prepareWizardState();

    this.wizardService.saveDraft().subscribe({
      next: () => {
        this.posState.setProcessing(false);
        this.showToast('Brouillon sauvegarde');
      },
      error: err => {
        this.posState.setProcessing(false);
        const message = this.extractErrorMessage(err, $localize`:@@pos.pos.ts.erreur.lors.de.la.sauvegarde.4a2bbdd4:Erreur lors de la sauvegarde`);
        this.posState.setError(message);
        this.audioService.beepError();
      }
    });
  }

  private loadSeller(): void {
    this.wizardService.loadSellers().subscribe(sellers => {
      if (sellers.length > 0) {
        this.wizardService.selectSeller(sellers[0]);
        this.sellerLoaded = true;
      }
    });
  }

  private onInvoiceCreated(payload: { invoiceId: string; invoiceNumber: string }): void {
    const soldProductIds = [...new Set(this.posState.lines().map(l => l.productId))];
    const { invoiceId, invoiceNumber } = payload;
    // Capturé AVANT resetOrder(), qui vide la ventilation.
    const splits = this.posState.isSplitPayment() ? [...this.posState.paymentSplits()] : [];
    const client = this.posState.client();
    if (client && !client.isWalkIn) {
      const productIds = this.posState.lines().map(l => l.productId);
      this.clientFavoritesService.recordOrder(client.id, productIds);
    }
    this.upsellService.clearSuggestions();
    this.posState.setProcessing(false);
    const totalTTC = this.posState.totals().totalTTC;
    const paymentMethod = this.posState.paymentMethod();
    const paymentSchedule = this.posState.paymentSchedule();
    const printMode = this.posState.printMode();

    if (printMode === 'receipt' || printMode === 'both') {
      this.receiptModel = this.buildPosReceiptModel(invoiceId, invoiceNumber);
      setTimeout(() => this.receiptRef?.print(), 50);
    }

    if (printMode === 'pdf' || printMode === 'both') {
      this.downloadPdf(invoiceId);
    }

    this.posState.resetOrder();

    this.posStockService.invalidateOrderStockCache();
    this.posStockService.loadCatalogAlerts();
    this.catalogComponent?.refreshStockAfterSale(soldProductIds);

    const sendEmail = this.sendEmailAfterSubmit;
    this.sendEmailAfterSubmit = false;

    if (splits.length > 0) {
      this.recordSplitPayments(invoiceId, splits);
      this.maybeSendInvoiceEmail(sendEmail, invoiceId);
      return;
    }

    if (paymentMethod === PaymentMethod.Cash && paymentSchedule === 'immediate') {
      this.lastCreatedInvoiceIdForCash = invoiceId;
      this.invoiceService.getInvoice(invoiceId).subscribe({
        next: res => {
          const fromServer = res.success && res.data?.remainingAmount != null
            ? Number(res.data.remainingAmount)
            : null;
          this.changeCalculatorTotal =
            fromServer != null && fromServer > 0 ? fromServer : totalTTC;
          this.showChangeCalculator = true;
        },
        error: () => {
          this.changeCalculatorTotal = totalTTC;
          this.showChangeCalculator = true;
        }
      });
      this.maybeSendInvoiceEmail(sendEmail, invoiceId);
    } else if (paymentSchedule === 'immediate') {
      this.recordImmediatePayment(invoiceId, paymentMethod);
      this.maybeSendInvoiceEmail(sendEmail, invoiceId);
    } else {
      const label = invoiceNumber?.trim() || invoiceId.substring(0, 8);
      this.showToast(`Facture a terme N° ${label}`);
      this.maybeSendInvoiceEmail(sendEmail, invoiceId);
    }
  }

  private buildPosReceiptModel(invoiceId: string, invoiceNumber: string): PosReceiptModel {
    const seller = this.wizardService.seller();
    const fallback = this.cachedCompanyReceipt;
    const companyName = seller?.companyName?.trim() || fallback?.name || environment.appName;
    const companyAddressLine = seller
      ? this.formatSellerAddress(seller.address)
      : fallback?.addressLine || '';
    const companyEmail = (seller?.email?.trim() || fallback?.email?.trim() || '').trim();
    const logoUrl = seller?.logo?.trim() || fallback?.logoUrl || null;

    const posClient = this.posState.client();
    const clientName = posClient?.name?.trim() || 'Client passager';
    const clientIdDisplay = posClient?.id
      ? `#${posClient.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`
      : $localize`:@@ui.tern.passager.b5e3a4:#PASSAGER`;

    const num = invoiceNumber?.trim();
    const displayInvoiceNumber = num || invoiceId.replace(/-/g, '').slice(0, 12).toUpperCase();

    const totals = this.posState.totals();
    const lines = this.posState.lines();
    const timbreFiscal = this.wizardService.getFiscalStampSignedAmountForCreditNote(
      this.posState.isCreditNote());
    const grandTotal = totals.totalTTC + timbreFiscal;

    const isCredit = this.posState.isCreditNote();
    const documentBanner = isCredit
      ? $localize`:@@ui.tern.avoir.detail.011371:---------- AVOIR (DÉTAIL) ----------`
      : $localize`:@@ui.tern.recu.de.detail.2e79d7:---------- REÇU DE DÉTAIL ----------`;

    const remise = totals.totalDiscount + totals.firstPurchaseDiscount;
    const footerLegal =
      this.cachedInvoiceFooter.trim() || 'Merci pour votre confiance.';

    return {
      companyName,
      companyAddressLine,
      companyEmail,
      logoUrl,
      documentBanner,
      clientName,
      clientIdDisplay,
      invoiceNumber: displayInvoiceNumber,
      issuedAt: new Date(),
      lines: lines.map(l => {
        const q = l.quantity > 0 ? l.quantity : 1;
        return {
          designation: l.designation,
          quantity: l.quantity,
          unitPriceTTC: l.totalTTC / q,
          lineTotalTTC: l.totalTTC
        };
      }),
      subTotalHT: totals.subTotalHT,
      remise,
      baseTVA: totals.totalHT,
      totalTVA: totals.totalVat,
      vatDetails: totals.vatBreakdown.map(v => ({
        rateDisplay: v.rateDisplay,
        vatAmount: v.vatAmount
      })),
      timbreFiscal,
      totalTTC: totals.totalTTC,
      grandTotal,
      paymentLabel: this.getReceiptPaymentLabel(),
      footerLegal,
      poweredByLabel: `Powered by ${environment.appName}`
    };
  }

  private formatSellerAddress(addr: AddressInfo): string {
    const parts = [
      addr.street,
      addr.streetLine2,
      addr.postalCode,
      addr.city,
      addr.governorate,
      addr.country?.trim() && addr.country.trim() !== 'Tunisie' ? addr.country.trim() : null
    ].filter((p): p is string => !!p?.trim());
    return parts.join(', ');
  }

  private getReceiptPaymentLabel(): string {
    if (this.posState.isSplitPayment() && this.posState.paymentSplits().length > 0) {
      return this.posState
        .paymentSplits()
        .map(s => {
          const label =
            PAYMENT_METHOD_OPTIONS.find(o => o.value === s.method)?.label ?? String(s.method);
          return `${label}: ${this.posState.formatAmount(s.amount)} TND`;
        })
        .join(' | ');
    }
    const m = this.posState.paymentMethod();
    return PAYMENT_METHOD_OPTIONS.find(o => o.value === m)?.label ?? String(m);
  }

  closeChangeCalculator(): void {
    if (this.isRecordingPayment) return;

    if (this.lastCreatedInvoiceIdForCash) {
      this.isRecordingPayment = true;
      const invoiceId = this.lastCreatedInvoiceIdForCash;
      this.checkoutService.recordCashPayment(invoiceId).subscribe({
        next: () => {
          this.lastCreatedInvoiceIdForCash = null;
          this.showChangeCalculator = false;
          this.changeCalculatorTotal = 0;
          this.isRecordingPayment = false;
          this.showToast('Paiement enregistré');
        },
        error: err => {
          this.isRecordingPayment = false;
          const message = this.extractErrorMessage(err, $localize`:@@pos.pos.ts.erreur.lors.de.l.enregistrement.du.paiem.e23b0f61:Erreur lors de l'enregistrement du paiement`);
          this.posState.setError(message);
          this.audioService.beepError();
        }
      });
      return;
    }

    this.showChangeCalculator = false;
    this.changeCalculatorTotal = 0;
    this.showToast('Transaction terminee');
  }

  /**
   * Enregistre la ventilation d'un encaissement fractionné : un règlement par mode, dans une
   * seule transaction serveur. Auparavant seul le premier mode survivait, le reste finissant
   * concaténé dans le champ texte des conditions de règlement — ce qui rendait le
   * rapprochement bancaire et le comptage de caisse invérifiables.
   */
  private recordSplitPayments(invoiceId: string, splits: PaymentSplit[]): void {
    const paymentDate = formatLocalDate(new Date());
    const requests = splits.map(split => ({
      paymentDate,
      method: toApiPaymentMethod(split.method),
      amount: split.amount,
      cashRegisterSessionId: this.registerSession.currentSession()?.id ?? undefined
    }));

    this.isRecordingPayment = true;
    this.invoiceService.recordPayments(invoiceId, requests).subscribe({
      next: () => {
        this.isRecordingPayment = false;
        this.showToast(`Encaissement fractionné enregistré (${splits.length} règlements)`);
      },
      error: err => {
        this.isRecordingPayment = false;
        const message = this.extractErrorMessage(
          err, $localize`:@@pos.pos.ts.erreur.lors.de.l.enregistrement.de.l.enc.64664de1:Erreur lors de l'enregistrement de l'encaissement fractionné`);
        this.posState.setError(message);
        this.audioService.beepError();
      }
    });
  }

  private downloadPdf(invoiceId: string): void {
    this.invoiceService.downloadPdf(invoiceId).subscribe({
      next: blob => this.printPreviewService.openPdfForPrintPreview(blob, `facture-${invoiceId}.pdf`),
      error: err => {
        const message = this.extractErrorMessage(err, $localize`:@@pos.pos.ts.impossible.de.telecharger.le.pdf.1944a2e7:Impossible de telecharger le PDF`);
        this.posState.setError(message);
        this.audioService.beepError();
      }
    });
  }

  private maybeSendInvoiceEmail(send: boolean, invoiceId: string): void {
    if (!send || !invoiceId) {
      return;
    }
    this.checkoutService.sendInvoiceEmail(invoiceId).subscribe({
      next: () => this.showToast('Facture envoyee par e-mail'),
      error: err => {
        const message = this.extractErrorMessage(err, $localize`:@@pos.pos.ts.impossible.d.envoyer.la.facture.par.e.ma.2e9a3c5e:Impossible d'envoyer la facture par e-mail`);
        this.posState.setError(message);
        this.audioService.beepError();
      }
    });
  }

  private showToast(message: string): void {
    this.successMessage = message;
    this.showSuccessToast = true;
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      this.showSuccessToast = false;
    }, 3000);
  }

  private extractErrorMessage(err: any, fallback: string): string {
    if (err?.error?.error) return err.error.error;
    if (err?.error?.message) return err.error.message;
    if (err?.error?.errors?.length) return err.error.errors[0];
    if (err?.error?.globalErrors?.length) return err.error.globalErrors[0];
    if (err?.message) return err.message;
    return fallback;
  }

  private cashRegisterSessionId(): string | undefined {
    return this.registerSession.currentSession()?.id ?? undefined;
  }

  private recordImmediatePayment(invoiceId: string, method: PaymentMethod): void {
    this.isRecordingPayment = true;
    this.invoiceService.recordPayment(invoiceId, {
      paymentDate: formatLocalDate(new Date()),
      method: toApiPaymentMethod(method),
      cashRegisterSessionId: this.cashRegisterSessionId()
    }).subscribe({
      next: () => {
        this.isRecordingPayment = false;
        this.showToast('Paiement enregistré');
      },
      error: err => {
        this.isRecordingPayment = false;
        const message = this.extractErrorMessage(err, $localize`:@@pos.pos.ts.erreur.lors.de.l.enregistrement.du.paiem.e23b0f61:Erreur lors de l'enregistrement du paiement`);
        this.posState.setError(message);
        this.audioService.beepError();
      }
    });
  }

  confirmOpenSession(): void {
    const warehouseId = this.warehouseContext.selectedWarehouseId();
    if (!warehouseId) {
      return;
    }
    const floatValue = Number(this.openingFloatInput) || 0;
    const registerId = this.availableRegisters.length > 1 ? this.selectedRegisterIdForOpen : undefined;
    this.registerSession.open(warehouseId, floatValue, registerId).subscribe({
      next: () => {
        this.showOpenSessionModal = false;
        this.showToast('Caisse ouverte');
      },
      error: err => {
        this.posState.setError(this.extractErrorMessage(err, $localize`:@@pos.pos.ts.impossible.d.ouvrir.la.caisse.1dc009cf:Impossible d'ouvrir la caisse`));
        this.audioService.beepError();
      }
    });
  }

  openXReport(): void {
    const warehouseId = this.warehouseContext.selectedWarehouseId();
    if (!warehouseId) {
      return;
    }
    this.registerSession.getXReport(warehouseId).subscribe({
      next: report => {
        this.sessionReport = report;
      },
      error: err => {
        this.posState.setError(this.extractErrorMessage(err, $localize`:@@pos.pos.ts.rapport.x.indisponible.c1080668:Rapport X indisponible`));
      }
    });
  }

  openCloseZModal(): void {
    const warehouseId = this.warehouseContext.selectedWarehouseId();
    if (!warehouseId) {
      return;
    }
    this.registerSession.getXReport(warehouseId).subscribe({
      next: report => {
        this.closePreview = report;
        this.countedCashInput = report.expectedCash;
        this.showCloseZModal = true;
      },
      error: err => {
        this.posState.setError(this.extractErrorMessage(err, $localize`:@@pos.pos.ts.impossible.de.preparer.la.cloture.z.9eb8ddf2:Impossible de préparer la clôture Z`));
      }
    });
  }

  closeVariance(): number {
    if (!this.closePreview) {
      return 0;
    }
    return (Number(this.countedCashInput) || 0) - this.closePreview.expectedCash;
  }

  confirmCloseZ(): void {
    const warehouseId = this.warehouseContext.selectedWarehouseId();
    if (!warehouseId) {
      return;
    }
    this.registerSession.close(warehouseId, Number(this.countedCashInput) || 0).subscribe({
      next: report => {
        this.showCloseZModal = false;
        this.closePreview = null;
        this.sessionReport = report;
        this.showToast(report.zReportNumber ? $localize`:@@ui.tern.cloture.ph.fba751:Clôture ${report.zReportNumber}:p0:` : $localize`:@@ui.tern.caisse.cloturee.6b484e:Caisse clôturée`);
      },
      error: err => {
        this.posState.setError(this.extractErrorMessage(err, $localize`:@@pos.pos.ts.cloture.z.impossible.8bbab029:Clôture Z impossible`));
        this.audioService.beepError();
      }
    });
  }

  formatSessionAmount(amount: number): string {
    return amount.toLocaleString('fr-TN', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  }

  printSessionReport(): void {
    window.print();
  }
}
