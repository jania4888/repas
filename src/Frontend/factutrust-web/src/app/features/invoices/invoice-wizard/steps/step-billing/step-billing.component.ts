import { Component, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';

import { StepLinesComponent } from '../step-lines/step-lines.component';
import { StepLegalComponent } from '../step-legal/step-legal.component';
import { InvoiceWizardService } from '../../services/invoice-wizard.service';
import { PaymentMethod } from '../../models/invoice-wizard.models';

/**
 * Étape 3 (parcours simplifié) - Facturation
 *
 * Conteneur fusionnant la saisie des lignes (step-lines) et du paiement / mentions légales
 * (step-legal). Le bloc paiement est replié par défaut et s'ouvre automatiquement quand un
 * champ obligatoire devient nécessaire (coordonnées bancaires en virement par exemple).
 *
 * Aucune logique métier dupliquée : compose les deux composants existants sans porter leur code.
 */
@Component({
  selector: 'app-step-billing',
  standalone: true,
  imports: [CommonModule, StepLinesComponent, StepLegalComponent],
  template: `
    <div class="step-billing">
      <section class="billing-section billing-section--lines">
        <app-step-lines></app-step-lines>
      </section>

      <section class="billing-section billing-section--payment">
        <button
          type="button"
          class="payment-toggle"
          [class.expanded]="paymentExpanded()"
          [attr.aria-expanded]="paymentExpanded()"
          aria-controls="billing-payment-panel"
          (click)="togglePayment()" i18n="@@invoices.invoice-wizard.paiement.mentions.legales.d00b53d3">
          <i class="pi" [class.pi-chevron-right]="!paymentExpanded()" [class.pi-chevron-down]="paymentExpanded()"></i>
          <span class="payment-toggle-label">
            <i class="pi pi-money-bill"></i>
            Paiement &amp; mentions légales
          </span>
          <span class="payment-summary">{{ paymentSummary() }}</span>
        </button>

        @if (paymentExpanded()) {
          <div id="billing-payment-panel" class="payment-panel">
            <app-step-legal></app-step-legal>
          </div>
        }
      </section>
    </div>
  `,
  styles: [`
    .step-billing {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-4, 16px);
    }

    .billing-section {
      display: block;
    }

    .payment-toggle {
      width: 100%;
      display: flex;
      align-items: center;
      gap: var(--spacing-3, 12px);
      padding: var(--spacing-3, 12px) var(--spacing-4, 16px);
      background: var(--color-neutral-50, #fafafa);
      border: 1px solid var(--color-neutral-200, #e5e7eb);
      border-radius: var(--radius-lg, 12px);
      cursor: pointer;
      transition: background var(--transition-fast, 150ms);
      font-size: var(--font-size-sm, 14px);
      color: var(--color-neutral-700, #374151);
    }

    .payment-toggle:hover {
      background: var(--color-neutral-100, #f3f4f6);
    }

    .payment-toggle:focus-visible {
      outline: 2px solid var(--color-primary-500, #3b82f6);
      outline-offset: 2px;
    }

    .payment-toggle.expanded {
      border-bottom-left-radius: 0;
      border-bottom-right-radius: 0;
      border-bottom-color: transparent;
    }

    .payment-toggle-label {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-2, 8px);
      font-weight: var(--font-weight-medium, 500);
      color: var(--color-neutral-900, #111827);
    }

    .payment-summary {
      margin-left: auto;
      color: var(--color-neutral-500, #6b7280);
      font-size: var(--font-size-xs, 12px);
    }

    .payment-panel {
      border: 1px solid var(--color-neutral-200, #e5e7eb);
      border-top: 0;
      border-radius: 0 0 var(--radius-lg, 12px) var(--radius-lg, 12px);
      padding: var(--spacing-4, 16px);
      background: white;
    }
  `]
})
export class StepBillingComponent {
  protected readonly wizardService = inject(InvoiceWizardService);

  /** Whether the payment/legal section is expanded. Default collapsed for cognitive simplicity. */
  protected readonly paymentExpanded = signal(false);

  protected readonly paymentSummary = computed(() => {
    const payment = this.wizardService.payment();
    const labels: Record<PaymentMethod, string> = {
      [PaymentMethod.BankTransfer]: $localize`:@@ui.tern.virement.bancaire.8306f0:Virement bancaire`,
      [PaymentMethod.Cash]: $localize`:@@ui.tern.especes.b7679d:Espèces`,
      [PaymentMethod.Check]: $localize`:@@ui.tern.cheque.8bbb89:Chèque`,
      [PaymentMethod.Card]: $localize`:@@ui.tern.carte.bancaire.9e3d9b:Carte bancaire`,
      [PaymentMethod.Effect]: $localize`:@@ui.tern.effet.de.commerce.9793a8:Effet de commerce`
    };
    const method = labels[payment.method] ?? $localize`:@@ui.tern.non.defini.4ed844:Non défini`;
    const terms = payment.daysUntilDue != null ? ` · ${payment.daysUntilDue} j` : '';
    return `${method}${terms}`;
  });

  constructor() {
    // Force-open the payment panel when bank info is required but missing (virement bancaire),
    // so the user never misses a blocking field while the section is collapsed.
    effect(() => {
      const p = this.wizardService.payment();
      const requiresBank = p.method === PaymentMethod.BankTransfer;
      const missingBank = !p.bankName || !p.rib;
      if (requiresBank && missingBank && !this.paymentExpanded()) {
        this.paymentExpanded.set(true);
      }
    });
  }

  togglePayment(): void {
    this.paymentExpanded.update(v => !v);
  }
}
