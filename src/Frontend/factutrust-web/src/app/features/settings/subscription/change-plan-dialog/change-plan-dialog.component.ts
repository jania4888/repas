/// <reference types="@angular/localize" />
import { Component, Input, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { RadioButtonModule } from 'primeng/radiobutton';
import { FormsModule } from '@angular/forms';
import { SubscriptionService, PlanOption, SubscriptionInfo } from '@core/services/subscription.service';
import { ToastService } from '@core/services/toast.service';

const TVA_RATE = 0.19;

@Component({
  selector: 'app-change-plan-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    TagModule,
    RadioButtonModule
  ],
  template: `
    <div class="change-plan-dialog">
      <!-- Header -->
      <div class="dialog-header">
        <h2 class="dialog-title" i18n="@@settings.subscription.changer.de.forfait.9d073980">Changer de forfait</h2>
        <div class="dialog-header-actions">
          @if (currentStep() > 1) {
            <button
              type="button"
              class="btn-back"
              (click)="goBack()"
              [disabled]="submitting()">
              <i class="pi pi-arrow-left"></i>
              Retour
            </button>
          }
          <button
            type="button"
            class="btn-close-dialog"
            (click)="modal.dismiss()"
            aria-label="Fermer" i18n-aria-label="@@settings.subscription.fermer.5ab4ec64"
            [disabled]="submitting()">
            <i class="pi pi-times"></i>
          </button>
        </div>
      </div>

      <!-- Stepper -->
      <div class="stepper">
        <div class="stepper-step" [class.active]="currentStep() >= 1" [class.completed]="currentStep() > 1">
          <div class="step-circle">
            @if (currentStep() > 1) {
              <i class="pi pi-check"></i>
            } @else {
              1
            }
          </div>
          <span class="step-label" i18n="@@settings.subscription.choisissez.votre.forfait.1a03784f">Choisissez votre forfait</span>
        </div>
        <div class="stepper-line" [class.active]="currentStep() > 1"></div>
        <div class="stepper-step" [class.active]="currentStep() >= 2">
          <div class="step-circle">2</div>
          <span class="step-label" i18n="@@settings.subscription.recapitulatif.paiement.af076074">Récapitulatif & paiement</span>
        </div>
      </div>

      <!-- Step 1: Plan Selection -->
      @if (currentStep() === 1) {
        <div class="step-content">
          <div class="plans-grid">
            @for (plan of plans; track plan.id) {
              <div
                class="plan-card"
                [class.selected]="selectedPlanId() === plan.id"
                [class.current]="plan.isCurrent"
                [class.popular]="plan.isPopular"
                [class.disabled]="plan.isCurrent"
                (click)="!plan.isCurrent && selectPlan(plan.id)"
                [attr.tabindex]="plan.isCurrent ? -1 : 0"
                [attr.role]="'radio'"
                [attr.aria-checked]="selectedPlanId() === plan.id"
                (keydown.enter)="!plan.isCurrent && selectPlan(plan.id)"
                (keydown.space)="!plan.isCurrent && selectPlan(plan.id); $event.preventDefault()">

                @if (plan.isPopular && !plan.isCurrent) {
                  <div class="badge-popular" i18n="@@settings.subscription.recommande.e1a57119">Recommandé</div>
                }
                @if (plan.isCurrent) {
                  <div class="badge-current" i18n="@@settings.subscription.forfait.actuel.ad20553e">Forfait actuel</div>
                }

                <div class="plan-card-header">
                  <h3 class="plan-name">{{ plan.name }}</h3>
                  <div class="plan-pricing">
                    <span class="plan-price">{{ plan.priceMonthly | number:'1.0-0' }}</span>
                    <span class="plan-currency" i18n="@@settings.subscription.tnd.51da21a7">TND</span>
                    <span class="plan-period">/ {{ plan.period }}</span>
                  </div>
                  @if (plan.priceAnnual) {
                    <div class="plan-annual-info">
                      Facturé {{ plan.priceAnnual | number:'1.0-0' }} TND par an
                    </div>
                  }
                  @if (plan.savePercentage) {
                    <div class="plan-save-badge">
                      <i class="pi pi-bolt"></i>
                      Économisez {{ plan.savePercentage }}%
                    </div>
                  }
                </div>

                <ul class="plan-features">
                  @for (feature of plan.features; track feature) {
                    <li class="feature-enabled">
                      <i class="pi pi-check-circle"></i>
                      <span>{{ feature }}</span>
                    </li>
                  }
                  @for (feature of plan.disabledFeatures; track feature) {
                    <li class="feature-disabled">
                      <i class="pi pi-minus-circle"></i>
                      <span>{{ feature }}</span>
                    </li>
                  }
                </ul>

                @if (!plan.isCurrent) {
                  <div class="plan-select-indicator">
                    <div class="radio-dot" [class.checked]="selectedPlanId() === plan.id">
                      @if (selectedPlanId() === plan.id) {
                        <div class="radio-dot-inner"></div>
                      }
                    </div>
                    <span>{{ getSelectionLabel(plan) }}</span>
                  </div>
                }
              </div>
            }
          </div>

          <div class="step-actions">
            <button
              type="button"
              class="btn-secondary"
              (click)="modal.dismiss()" i18n="@@settings.subscription.annuler.49ba3292"> Annuler </button>
            <button
              type="button"
              class="btn-primary"
              [disabled]="!canProceed()"
              (click)="goToStep2()">
              <ng-container i18n="@@settings.subscription.continuer.129ffff9"> Continuer </ng-container>
              <i class="pi pi-arrow-right"></i>
            </button>
          </div>
        </div>
      }

      <!-- Step 2: Summary & Payment -->
      @if (currentStep() === 2) {
        <div class="step-content">
          <!-- Change Summary -->
          <div class="summary-section">
            <div class="change-direction">
              <div class="change-from">
                <span class="change-label" i18n="@@settings.subscription.de.6b98c9b5">De</span>
                <span class="change-plan-name">{{ currentPlanDisplay() }}</span>
              </div>
              <div class="change-arrow">
                <i class="pi pi-arrow-right"></i>
              </div>
              <div class="change-to">
                <span class="change-label" i18n="@@settings.subscription.vers.abd795b0">Vers</span>
                <span class="change-plan-name highlight">{{ selectedPlanDisplay() }}</span>
              </div>
            </div>
          </div>

          @if (isDowngradeToFree()) {
            <!-- Downgrade to Free - no payment info needed -->
            <div class="downgrade-notice">
              <div class="notice-icon">
                <i class="pi pi-info-circle"></i>
              </div>
              <div class="notice-content">
                <h4 i18n="@@settings.subscription.passage.au.forfait.gratuit.8892606d">Passage au forfait Gratuit</h4>
                <p i18n="@@settings.subscription.votre.changement.prendra.effet.immediatement.vos.ec1b5302">Votre changement prendra effet immédiatement. Vos données restent accessibles, mais certaines fonctionnalités seront limitées.</p>
                <ul class="notice-limits">
                  <li i18n="@@settings.subscription.10.factures.mois.maximum.79a637a6">10 factures / mois maximum</li>
                  <li i18n="@@settings.subscription.20.clients.maximum.fd987800">20 clients maximum</li>
                  <li i18n="@@settings.subscription.pas.de.signature.electronique.adae2f11">Pas de signature électronique</li>
                  <li i18n="@@settings.subscription.pas.de.suivi.des.paiements.160d9c7b">Pas de suivi des paiements</li>
                </ul>
              </div>
            </div>
          } @else {
            <!-- Pricing breakdown -->
            <div class="pricing-table">
              <div class="pricing-row">
                <span class="pricing-label" i18n="@@settings.subscription.designation.63a9062c">Désignation</span>
                <span class="pricing-value">
                  Abonnement {{ selectedPlanDisplay() }}
                  @if (selectedPlan()?.priceAnnual) {
                    (12 mois)
                  }
                </span>
              </div>
              <div class="pricing-row">
                <span class="pricing-label" i18n="@@settings.subscription.prix.unitaire.3e848c96">Prix unitaire</span>
                <span class="pricing-value">{{ selectedPlan()?.priceMonthly | number:'1.3-3' }} TND / mois</span>
              </div>
              @if (selectedPlan()?.priceAnnual) {
                <div class="pricing-row">
                  <span class="pricing-label" i18n="@@settings.subscription.sous.total.annuel.189dc68e">Sous-total annuel</span>
                  <span class="pricing-value">{{ selectedPlan()?.priceAnnual | number:'1.3-3' }} TND</span>
                </div>
              }
              <div class="pricing-divider"></div>
              <div class="pricing-row">
                <span class="pricing-label" i18n="@@settings.subscription.prix.ht.362207ca">Prix HT</span>
                <span class="pricing-value bold">{{ priceHT() | number:'1.3-3' }} TND</span>
              </div>
              <div class="pricing-row">
                <span class="pricing-label" i18n="@@settings.subscription.tva.19.07090d79">TVA (19%)</span>
                <span class="pricing-value">{{ tvaAmount() | number:'1.3-3' }} TND</span>
              </div>
              <div class="pricing-divider"></div>
              <div class="pricing-row total">
                <span class="pricing-label" i18n="@@settings.subscription.total.ttc.9e80ff7c">Total TTC</span>
                <span class="pricing-value">{{ priceTTC() | number:'1.3-3' }} TND</span>
              </div>
            </div>

            <!-- Payment Method -->
            <div class="payment-section">
              <h4 class="payment-title" i18n="@@settings.subscription.methode.de.paiement.b111f83e">Méthode de paiement</h4>
              <div class="payment-methods">
                <div
                  class="payment-method"
                  [class.selected]="paymentMethod() === 'card'"
                  (click)="setPaymentMethod('card')"
                  tabindex="0"
                  role="radio"
                  [attr.aria-checked]="paymentMethod() === 'card'"
                  (keydown.enter)="setPaymentMethod('card')"
                  (keydown.space)="setPaymentMethod('card'); $event.preventDefault()">
                  <div class="payment-radio" [class.checked]="paymentMethod() === 'card'">
                    @if (paymentMethod() === 'card') {
                      <div class="radio-dot-inner"></div>
                    }
                  </div>
                  <div class="payment-info">
                    <span class="payment-name"><ng-container i18n="@@settings.subscription.carte.bancaire.9e3d9bfa">Carte bancaire </ng-container> <strong i18n="@@settings.subscription.clictopay.47cd6669">ClicToPay</strong></span>
                    <span class="payment-desc" i18n="@@settings.subscription.activation.immediate.fb8aaf1f">Activation immédiate</span>
                  </div>
                </div>

                <div
                  class="payment-method"
                  [class.selected]="paymentMethod() === 'bank'"
                  (click)="setPaymentMethod('bank')"
                  tabindex="0"
                  role="radio"
                  [attr.aria-checked]="paymentMethod() === 'bank'"
                  (keydown.enter)="setPaymentMethod('bank')"
                  (keydown.space)="setPaymentMethod('bank'); $event.preventDefault()">
                  <div class="payment-radio" [class.checked]="paymentMethod() === 'bank'">
                    @if (paymentMethod() === 'bank') {
                      <div class="radio-dot-inner"></div>
                    }
                  </div>
                  <div class="payment-info">
                    <span class="payment-name" i18n="@@settings.subscription.virement.bancaire.8306f08e">Virement bancaire</span>
                    <span class="payment-desc" i18n="@@settings.subscription.activation.apres.validation.du.paiement.adc9da35">Activation après validation du paiement</span>
                  </div>
                </div>
              </div>

              @if (paymentMethod() === 'bank') {
                <div class="bank-details">
                  <div class="bank-row">
                    <span class="bank-label" i18n="@@settings.subscription.banque.2a7302cd">Banque</span>
                    <span class="bank-value" i18n="@@settings.subscription.banque.attijari.61461dd8">Banque Attijari</span>
                  </div>
                  <div class="bank-row">
                    <span class="bank-label" i18n="@@settings.subscription.rib.61f3ea57">RIB</span>
                    <span class="bank-value">04 057 142 0053258414 24</span>
                  </div>
                  <div class="bank-row">
                    <span class="bank-label" i18n="@@settings.subscription.iban.e81566a5">IBAN</span>
                    <span class="bank-value" i18n="@@settings.subscription.tn59.04.057.142.0053258414.24.8f84e9d8">TN59 04 057 142 0053258414 24</span>
                  </div>
                  <div class="bank-row">
                    <span class="bank-label" i18n="@@settings.subscription.swift.112ab020">Swift</span>
                    <span class="bank-value" i18n="@@settings.subscription.bstutntint.78e09300">BSTUTNTINT</span>
                  </div>
                  <div class="bank-row">
                    <span class="bank-label" i18n="@@settings.subscription.titulaire.9cdd337a">Titulaire</span>
                    <span class="bank-value" i18n="@@settings.subscription.instafact.sas.da9f8c46">InstaFact SAS</span>
                  </div>
                </div>
              }
            </div>
          }

          <!-- Security note -->
          <div class="security-note">
            <i class="pi pi-lock"></i>
            <span i18n="@@settings.subscription.paiement.securise.vos.donnees.sont.protegees.44eb23e2">Paiement sécurisé — Vos données sont protégées</span>
          </div>

          <!-- Actions -->
          <div class="step-actions">
            <button
              type="button"
              class="btn-secondary"
              (click)="goBack()"
              [disabled]="submitting()" i18n="@@settings.subscription.retour.e5befb1f"> Retour </button>
            <button
              type="button"
              class="btn-primary confirm-btn"
              [disabled]="submitting()"
              (click)="confirmChange()">
              @if (submitting()) {
                <i class="pi pi-spin pi-spinner"></i>
                Traitement en cours...
              } @else if (isDowngradeToFree()) {
                Confirmer le changement
              } @else {
                <i class="pi pi-check"></i>
                Confirmer — {{ priceTTC() | number:'1.3-3' }} TND
              }
            </button>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .change-plan-dialog {
      max-height: 85vh;
      overflow-y: auto;
    }

    /* Header */
    .dialog-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: var(--spacing-4, 1rem) var(--spacing-5, 1.25rem);
      border-bottom: 1px solid var(--color-border-subtle, #e2e8f0);
    }

    .dialog-title {
      margin: 0;
      font-size: var(--font-size-xl, 1.25rem);
      font-weight: var(--font-weight-semibold, 600);
      color: var(--color-text-primary, #0f172a);
    }

    .dialog-header-actions {
      display: flex;
      align-items: center;
      gap: var(--spacing-2, 0.5rem);
    }

    .btn-back {
      display: flex;
      align-items: center;
      gap: var(--spacing-1, 0.25rem);
      padding: var(--spacing-2, 0.5rem) var(--spacing-3, 0.75rem);
      background: transparent;
      border: 1px solid var(--color-border-default, #cbd5e1);
      border-radius: var(--radius-md, 0.375rem);
      font-size: var(--font-size-sm, 0.875rem);
      color: var(--color-text-secondary, #475569);
      cursor: pointer;
      transition: all 150ms;
    }

    .btn-back:hover:not(:disabled) {
      background: var(--color-neutral-50, #f8fafc);
      border-color: var(--color-primary-400, #60a5fa);
    }

    .btn-close-dialog {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      background: transparent;
      border: none;
      border-radius: var(--radius-md, 0.375rem);
      color: var(--color-text-secondary, #475569);
      cursor: pointer;
      transition: all 150ms;
    }

    .btn-close-dialog:hover:not(:disabled) {
      background: var(--color-neutral-100, #f1f5f9);
    }

    /* Stepper */
    .stepper {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: var(--spacing-5, 1.25rem) var(--spacing-6, 1.5rem);
      gap: 0;
    }

    .stepper-step {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--spacing-2, 0.5rem);
    }

    .step-circle {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: var(--font-size-sm, 0.875rem);
      font-weight: var(--font-weight-semibold, 600);
      background: var(--color-neutral-200, #e2e8f0);
      color: var(--color-text-secondary, #475569);
      transition: all 300ms;
    }

    .stepper-step.active .step-circle {
      background: var(--color-primary-600, #2563eb);
      color: white;
    }

    .stepper-step.completed .step-circle {
      background: var(--color-success-500, #22c55e);
      color: white;
    }

    .step-label {
      font-size: var(--font-size-xs, 0.75rem);
      color: var(--color-text-tertiary, #94a3b8);
      white-space: nowrap;
    }

    .stepper-step.active .step-label {
      color: var(--color-primary-600, #2563eb);
      font-weight: var(--font-weight-medium, 500);
    }

    .stepper-line {
      width: 120px;
      height: 2px;
      background: var(--color-neutral-200, #e2e8f0);
      margin: 0 var(--spacing-3, 0.75rem);
      margin-bottom: var(--spacing-5, 1.25rem);
      transition: background 300ms;
    }

    .stepper-line.active {
      background: var(--color-primary-600, #2563eb);
    }

    /* Step Content */
    .step-content {
      padding: 0 var(--spacing-5, 1.25rem) var(--spacing-5, 1.25rem);
    }

    /* Plans Grid */
    .plans-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: var(--spacing-3, 0.75rem);
      margin-bottom: var(--spacing-5, 1.25rem);
    }

    .plan-card {
      position: relative;
      padding: var(--spacing-4, 1rem);
      border: 2px solid var(--color-neutral-200, #e2e8f0);
      border-radius: var(--radius-xl, 0.75rem);
      cursor: pointer;
      transition: all 200ms;
      background: white;
    }

    .plan-card:hover:not(.disabled):not(.current) {
      border-color: var(--color-primary-400, #60a5fa);
      box-shadow: 0 4px 12px rgba(37, 99, 235, 0.1);
    }

    .plan-card.selected:not(.current) {
      border-color: var(--color-primary-600, #2563eb);
      background: var(--color-primary-50, #eff6ff);
      box-shadow: 0 0 0 1px var(--color-primary-600, #2563eb);
    }

    .plan-card.current {
      border-color: var(--color-neutral-300, #cbd5e1);
      background: var(--color-neutral-50, #f8fafc);
      cursor: default;
      opacity: 0.7;
    }

    .plan-card.popular:not(.current) {
      border-color: var(--color-primary-400, #60a5fa);
    }

    .plan-card.disabled {
      pointer-events: none;
    }

    /* Badges */
    .badge-popular,
    .badge-current {
      position: absolute;
      top: -10px;
      left: 50%;
      transform: translateX(-50%);
      padding: 2px 12px;
      border-radius: var(--radius-full, 9999px);
      font-size: 11px;
      font-weight: var(--font-weight-semibold, 600);
      white-space: nowrap;
    }

    .badge-popular {
      background: var(--color-primary-600, #2563eb);
      color: white;
    }

    .badge-current {
      background: var(--color-neutral-400, #94a3b8);
      color: white;
    }

    /* Plan Card Content */
    .plan-card-header {
      text-align: center;
      margin-bottom: var(--spacing-3, 0.75rem);
      padding-bottom: var(--spacing-3, 0.75rem);
      border-bottom: 1px solid var(--color-neutral-200, #e2e8f0);
    }

    .plan-name {
      font-size: var(--font-size-lg, 1.125rem);
      font-weight: var(--font-weight-semibold, 600);
      color: var(--color-text-primary, #0f172a);
      margin: var(--spacing-2, 0.5rem) 0 var(--spacing-2, 0.5rem);
    }

    .plan-pricing {
      display: flex;
      align-items: baseline;
      justify-content: center;
      gap: 2px;
    }

    .plan-price {
      font-size: 2rem;
      font-weight: var(--font-weight-bold, 700);
      color: var(--color-text-primary, #0f172a);
      line-height: 1;
    }

    .plan-currency {
      font-size: var(--font-size-base, 1rem);
      font-weight: var(--font-weight-semibold, 600);
      color: var(--color-text-secondary, #475569);
    }

    .plan-period {
      font-size: var(--font-size-sm, 0.875rem);
      color: var(--color-text-tertiary, #94a3b8);
    }

    .plan-annual-info {
      font-size: var(--font-size-xs, 0.75rem);
      color: var(--color-text-tertiary, #94a3b8);
      margin-top: var(--spacing-1, 0.25rem);
    }

    .plan-save-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-top: var(--spacing-2, 0.5rem);
      padding: 2px 10px;
      background: var(--color-success-50, #f0fdf4);
      color: var(--color-success-700, #15803d);
      border-radius: var(--radius-full, 9999px);
      font-size: 11px;
      font-weight: var(--font-weight-semibold, 600);

      i {
        font-size: 10px;
      }
    }

    /* Features List */
    .plan-features {
      list-style: none;
      padding: 0;
      margin: 0 0 var(--spacing-3, 0.75rem);
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .plan-features li {
      display: flex;
      align-items: flex-start;
      gap: var(--spacing-2, 0.5rem);
      font-size: var(--font-size-xs, 0.75rem);
      line-height: 1.4;
    }

    .feature-enabled {
      color: var(--color-text-secondary, #475569);

      i {
        color: var(--color-success-500, #22c55e);
        font-size: 12px;
        margin-top: 1px;
        flex-shrink: 0;
      }
    }

    .feature-disabled {
      color: var(--color-text-tertiary, #94a3b8);

      i {
        color: var(--color-neutral-400, #94a3b8);
        font-size: 12px;
        margin-top: 1px;
        flex-shrink: 0;
      }
    }

    /* Plan select indicator */
    .plan-select-indicator {
      display: flex;
      align-items: center;
      gap: var(--spacing-2, 0.5rem);
      padding-top: var(--spacing-2, 0.5rem);
      border-top: 1px solid var(--color-neutral-100, #f1f5f9);
      font-size: var(--font-size-xs, 0.75rem);
      color: var(--color-text-secondary, #475569);
    }

    .radio-dot,
    .payment-radio {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      border: 2px solid var(--color-neutral-300, #cbd5e1);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 150ms;
      flex-shrink: 0;
    }

    .radio-dot.checked,
    .payment-radio.checked {
      border-color: var(--color-primary-600, #2563eb);
    }

    .radio-dot-inner {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--color-primary-600, #2563eb);
    }

    /* Step 2 Styles */
    .summary-section {
      margin-bottom: var(--spacing-4, 1rem);
    }

    .change-direction {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: var(--spacing-4, 1rem);
      padding: var(--spacing-4, 1rem);
      background: var(--color-neutral-50, #f8fafc);
      border-radius: var(--radius-lg, 0.5rem);
      border: 1px solid var(--color-neutral-200, #e2e8f0);
    }

    .change-from,
    .change-to {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
    }

    .change-label {
      font-size: var(--font-size-xs, 0.75rem);
      color: var(--color-text-tertiary, #94a3b8);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .change-plan-name {
      font-size: var(--font-size-lg, 1.125rem);
      font-weight: var(--font-weight-semibold, 600);
      color: var(--color-text-primary, #0f172a);
    }

    .change-plan-name.highlight {
      color: var(--color-primary-600, #2563eb);
    }

    .change-arrow {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: var(--color-primary-100, #dbeafe);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--color-primary-600, #2563eb);
    }

    /* Downgrade Notice */
    .downgrade-notice {
      display: flex;
      gap: var(--spacing-3, 0.75rem);
      padding: var(--spacing-4, 1rem);
      background: var(--color-warning-50, #fffbeb);
      border: 1px solid var(--color-warning-200, #fde68a);
      border-radius: var(--radius-lg, 0.5rem);
      margin-bottom: var(--spacing-4, 1rem);
    }

    .notice-icon {
      flex-shrink: 0;
      color: var(--color-warning-600, #d97706);
      font-size: 1.25rem;
    }

    .notice-content {
      h4 {
        margin: 0 0 var(--spacing-2, 0.5rem);
        font-size: var(--font-size-base, 1rem);
        font-weight: var(--font-weight-semibold, 600);
        color: var(--color-warning-800, #92400e);
      }

      p {
        margin: 0 0 var(--spacing-3, 0.75rem);
        font-size: var(--font-size-sm, 0.875rem);
        color: var(--color-warning-700, #b45309);
        line-height: var(--line-height-relaxed, 1.625);
      }
    }

    .notice-limits {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 4px;

      li {
        font-size: var(--font-size-sm, 0.875rem);
        color: var(--color-warning-700, #b45309);
        display: flex;
        align-items: center;
        gap: 6px;

        &::before {
          content: '•';
          color: var(--color-warning-500, #f59e0b);
        }
      }
    }

    /* Pricing Table */
    .pricing-table {
      background: white;
      border: 1px solid var(--color-neutral-200, #e2e8f0);
      border-radius: var(--radius-lg, 0.5rem);
      padding: var(--spacing-4, 1rem);
      margin-bottom: var(--spacing-4, 1rem);
    }

    .pricing-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: var(--spacing-2, 0.5rem) 0;
    }

    .pricing-label {
      font-size: var(--font-size-sm, 0.875rem);
      color: var(--color-text-secondary, #475569);
    }

    .pricing-value {
      font-size: var(--font-size-sm, 0.875rem);
      color: var(--color-text-primary, #0f172a);
      font-family: 'JetBrains Mono', monospace;
    }

    .pricing-value.bold {
      font-weight: var(--font-weight-semibold, 600);
    }

    .pricing-divider {
      height: 1px;
      background: var(--color-neutral-200, #e2e8f0);
      margin: var(--spacing-2, 0.5rem) 0;
    }

    .pricing-row.total {
      .pricing-label {
        font-size: var(--font-size-base, 1rem);
        font-weight: var(--font-weight-bold, 700);
        color: var(--color-text-primary, #0f172a);
      }

      .pricing-value {
        font-size: var(--font-size-lg, 1.125rem);
        font-weight: var(--font-weight-bold, 700);
        color: var(--color-primary-600, #2563eb);
      }
    }

    /* Payment Section */
    .payment-section {
      margin-bottom: var(--spacing-4, 1rem);
    }

    .payment-title {
      font-size: var(--font-size-base, 1rem);
      font-weight: var(--font-weight-semibold, 600);
      color: var(--color-text-primary, #0f172a);
      margin: 0 0 var(--spacing-3, 0.75rem);
    }

    .payment-methods {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--spacing-3, 0.75rem);
      margin-bottom: var(--spacing-3, 0.75rem);
    }

    .payment-method {
      display: flex;
      align-items: flex-start;
      gap: var(--spacing-3, 0.75rem);
      padding: var(--spacing-3, 0.75rem);
      border: 2px solid var(--color-neutral-200, #e2e8f0);
      border-radius: var(--radius-lg, 0.5rem);
      cursor: pointer;
      transition: all 150ms;
    }

    .payment-method:hover {
      border-color: var(--color-primary-300, #93c5fd);
    }

    .payment-method.selected {
      border-color: var(--color-primary-600, #2563eb);
      background: var(--color-primary-50, #eff6ff);
    }

    .payment-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .payment-name {
      font-size: var(--font-size-sm, 0.875rem);
      color: var(--color-text-primary, #0f172a);
    }

    .payment-desc {
      font-size: var(--font-size-xs, 0.75rem);
      color: var(--color-text-tertiary, #94a3b8);
    }

    /* Bank Details */
    .bank-details {
      background: var(--color-neutral-50, #f8fafc);
      border: 1px solid var(--color-neutral-200, #e2e8f0);
      border-radius: var(--radius-lg, 0.5rem);
      padding: var(--spacing-3, 0.75rem);
    }

    .bank-row {
      display: flex;
      justify-content: space-between;
      padding: var(--spacing-2, 0.5rem) 0;
      border-bottom: 1px solid var(--color-neutral-100, #f1f5f9);

      &:last-child {
        border-bottom: none;
      }
    }

    .bank-label {
      font-size: var(--font-size-sm, 0.875rem);
      color: var(--color-text-secondary, #475569);
    }

    .bank-value {
      font-size: var(--font-size-sm, 0.875rem);
      font-weight: var(--font-weight-medium, 500);
      color: var(--color-text-primary, #0f172a);
      font-family: 'JetBrains Mono', monospace;
    }

    /* Security Note */
    .security-note {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: var(--spacing-2, 0.5rem);
      padding: var(--spacing-3, 0.75rem);
      font-size: var(--font-size-xs, 0.75rem);
      color: var(--color-text-tertiary, #94a3b8);

      i {
        color: var(--color-success-500, #22c55e);
      }
    }

    /* Action Buttons */
    .step-actions {
      display: flex;
      justify-content: flex-end;
      gap: var(--spacing-3, 0.75rem);
      padding-top: var(--spacing-4, 1rem);
      border-top: 1px solid var(--color-neutral-200, #e2e8f0);
    }

    .btn-secondary {
      padding: var(--spacing-3, 0.75rem) var(--spacing-5, 1.25rem);
      background: white;
      border: 1px solid var(--color-border-default, #cbd5e1);
      border-radius: var(--radius-lg, 0.5rem);
      font-size: var(--font-size-sm, 0.875rem);
      font-weight: var(--font-weight-medium, 500);
      color: var(--color-text-primary, #0f172a);
      cursor: pointer;
      transition: all 150ms;
    }

    .btn-secondary:hover:not(:disabled) {
      background: var(--color-neutral-50, #f8fafc);
      border-color: var(--color-neutral-400, #94a3b8);
    }

    .btn-primary {
      display: flex;
      align-items: center;
      gap: var(--spacing-2, 0.5rem);
      padding: var(--spacing-3, 0.75rem) var(--spacing-5, 1.25rem);
      background: var(--color-primary-600, #2563eb);
      border: none;
      border-radius: var(--radius-lg, 0.5rem);
      font-size: var(--font-size-sm, 0.875rem);
      font-weight: var(--font-weight-semibold, 600);
      color: white;
      cursor: pointer;
      transition: all 150ms;
    }

    .btn-primary:hover:not(:disabled) {
      background: var(--color-primary-700, #1d4ed8);
    }

    .btn-primary:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .confirm-btn {
      min-width: 200px;
      justify-content: center;
    }

    /* Responsive */
    @media (max-width: 768px) {
      .plans-grid {
        grid-template-columns: 1fr;
      }

      .payment-methods {
        grid-template-columns: 1fr;
      }

      .stepper-line {
        width: 60px;
      }

      .step-label {
        font-size: 10px;
      }
    }
  `]
})
export class ChangePlanDialogComponent {
  @Input() currentSubscription!: SubscriptionInfo;
  @Input() plans: PlanOption[] = [];

  private subscriptionService = inject(SubscriptionService);
  private toastService = inject(ToastService);

  currentStep = signal(1);
  selectedPlanId = signal<string | null>(null);
  paymentMethod = signal<'card' | 'bank'>('card');
  submitting = signal(false);

  selectedPlan = computed(() =>
    this.plans.find(p => p.id === this.selectedPlanId())
  );

  currentPlanDisplay = computed(() => {
    const current = this.plans.find(p => p.isCurrent);
    return current?.name ?? this.currentSubscription.planDisplay;
  });

  selectedPlanDisplay = computed(() =>
    this.selectedPlan()?.name ?? ''
  );

  isDowngradeToFree = computed(() =>
    this.selectedPlanId() === 'Free'
  );

  priceHT = computed(() => {
    const plan = this.selectedPlan();
    if (!plan) return 0;
    return plan.priceAnnual ?? plan.priceMonthly;
  });

  tvaAmount = computed(() =>
    this.priceHT() * TVA_RATE
  );

  priceTTC = computed(() =>
    this.priceHT() + this.tvaAmount()
  );

  constructor(public modal: NgbActiveModal) {}

  canProceed = computed(() =>
    this.selectedPlanId() !== null
  );

  selectPlan(planId: string): void {
    this.selectedPlanId.set(planId);
  }

  getSelectionLabel(plan: PlanOption): string {
    const currentPlan = this.currentSubscription.plan;
    if (plan.id === 'Free') return 'Passer au Gratuit';

    const planOrder: Record<string, number> = { 'Free': 0, 'Monthly': 1, 'Annual': 2 };
    const currentOrder = planOrder[currentPlan] ?? 0;
    const targetOrder = planOrder[plan.id] ?? 0;

    if (targetOrder > currentOrder) return 'Passer au supérieur';
    if (targetOrder < currentOrder) return 'Rétrograder';
    return 'Sélectionner';
  }

  goToStep2(): void {
    if (this.canProceed()) {
      this.currentStep.set(2);
    }
  }

  goBack(): void {
    if (this.currentStep() > 1) {
      this.currentStep.set(this.currentStep() - 1);
    }
  }

  setPaymentMethod(method: 'card' | 'bank'): void {
    this.paymentMethod.set(method);
  }

  confirmChange(): void {
    const planId = this.selectedPlanId();
    if (!planId) return;

    this.submitting.set(true);

    this.subscriptionService.changePlan(planId).subscribe({
      next: (response) => {
        this.submitting.set(false);
        if (response.success) {
          this.toastService.add({
            severity: 'success',
            summary: $localize`:@@change-plan-dialog.component.summary.Forfait mis :Forfait mis à jour`,
            detail: response.message ?? $localize`:@@ui.tern.votre.forfait.a.ete.mis.a.jour.avec.succes.2c5c57:Votre forfait a été mis à jour avec succès.`,
            life: 5000
          });
          this.modal.close(response.data);
        } else {
          this.toastService.add({
            severity: 'error',
            summary: $localize`:@@change-plan-dialog.component.summary.Erreur:Erreur`,
            detail: response.errors?.[0] ?? $localize`:@@ui.tern.une.erreur.est.survenue.9a1331:Une erreur est survenue.`,
            life: 5000
          });
        }
      },
      error: (err) => {
        this.submitting.set(false);
        const message = err?.error?.errors?.[0]
          ?? err?.error?.message
          ?? $localize`:@@ui.tern.une.erreur.est.survenue.veuillez.reessayer.51f64e:Une erreur est survenue. Veuillez réessayer.`;
        this.toastService.add({
          severity: 'error',
          summary: $localize`:@@change-plan-dialog.component.summary.Erreur:Erreur`,
          detail: message,
          life: 5000
        });
      }
    });
  }
}
