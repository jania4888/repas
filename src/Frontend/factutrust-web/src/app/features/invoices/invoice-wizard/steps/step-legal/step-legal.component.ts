import { Component, OnInit, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

// PrimeNG
import { SelectModule } from 'primeng/select';
import { InputTextModule } from 'primeng/inputtext';
import { Textarea } from 'primeng/textarea';
import { InputNumberModule } from 'primeng/inputnumber';
import { TooltipModule } from 'primeng/tooltip';
import { DividerModule } from 'primeng/divider';
import { CardModule } from 'primeng/card';
import { InputMaskModule } from 'primeng/inputmask';
import { CheckboxModule } from 'primeng/checkbox';

// Services & Models
import { InvoiceWizardService } from '../../services/invoice-wizard.service';
import { 
  PaymentMethod, 
  ClientTaxType,
  PAYMENT_METHOD_OPTIONS 
} from '../../models/invoice-wizard.models';

/**
 * Étape 5 - Mentions légales & paiement
 *
 * @deprecated Utilisé tel quel par le parcours legacy 6 étapes
 * (`featureFlags.wizardSimplifiedFlow === false`). Le parcours simplifié 4 étapes
 * compose ce composant dans `StepBillingComponent` au sein d'un accordion replié.
 * Sera retiré ou fusionné lorsque le flag sera activé par défaut.
 *
 * Permet de configurer:
 * - Mode de paiement
 * - Conditions de paiement
 * - Coordonnées bancaires
 * - Mentions légales obligatoires
 * 
 * Conformité tunisienne:
 * - Mention "TVA due par le vendeur" obligatoire
 * - Mention d'exonération si client exonéré
 * - Conditions de paiement claires
 */
@Component({
  selector: 'app-step-legal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    SelectModule,
    InputTextModule,
    Textarea,
    InputNumberModule,
    TooltipModule,
    DividerModule,
    CardModule,
    InputMaskModule,
    CheckboxModule
  ],
  template: `
    <div class="step-legal">
      <!-- Payment Method -->
      <section class="section">
        <h2 class="section-title" i18n="@@invoices.invoice-wizard.mode.de.paiement.3559799b">
          <i class="pi pi-money-bill"></i>
          Mode de paiement
        </h2>
        <p class="section-description" i18n="@@invoices.invoice-wizard.selectionnez.le.mode.de.reglement.pour.cette.fac.b38260c5"> Sélectionnez le mode de règlement pour cette facture </p>

        <div class="payment-methods-grid">
          @for (method of paymentMethodOptions; track method.value) {
            <div 
              class="payment-method-card"
              [class.selected]="payment.method === method.value"
              (click)="selectPaymentMethod(method.value)"
              (keydown.enter)="selectPaymentMethod(method.value)"
              tabindex="0"
              role="radio"
              [attr.aria-checked]="payment.method === method.value">
              <i [class]="method.icon"></i>
              <span>{{ method.label }}</span>
            </div>
          }
        </div>
      </section>

      <p-divider></p-divider>

      <!-- Payment Terms -->
      <section class="section">
        <h2 class="section-title" i18n="@@invoices.invoice-wizard.conditions.de.paiement.55b90ddd">
          <i class="pi pi-calendar"></i>
          Conditions de paiement
        </h2>

        <div class="form-grid">
          <div class="form-group">
            <label for="paymentTerms" i18n="@@invoices.invoice-wizard.conditions.5506eb61">Conditions</label>
            <p-select
              inputId="paymentTerms"
              [options]="paymentTermsOptions"
              [(ngModel)]="selectedPaymentTerms"
              (ngModelChange)="onPaymentTermsChange($event)"
              optionLabel="label"
              optionValue="value"
              placeholder="Sélectionner..." i18n-placeholder="@@invoices.invoice-wizard.selectionner.01ea04b3"
              appendTo="body">
            </p-select>
          </div>

          <div class="form-group">
            <label for="daysUntilDue" i18n="@@invoices.invoice-wizard.delai.de.paiement.jours.586df9e3">Délai de paiement (jours)</label>
            <p-inputNumber
              inputId="daysUntilDue"
              [(ngModel)]="payment.daysUntilDue"
              (ngModelChange)="updatePayment({ daysUntilDue: $event })"
              [min]="0"
              [max]="365"
              suffix=" jours">
            </p-inputNumber>
            <small class="form-hint" i18n="@@invoices.invoice-wizard.la.date.d.echeance.sera.calculee.automatiquement.46127cd1"> La date d'échéance sera calculée automatiquement </small>
          </div>

          <div class="form-group full-width">
            <label for="customTerms" i18n="@@invoices.invoice-wizard.conditions.personnalisees.72cffa4d">Conditions personnalisées</label>
            <textarea
              pTextarea
              id="customTerms"
              [(ngModel)]="payment.terms"
              (ngModelChange)="updatePayment({ terms: $event })"
              rows="3"
              placeholder="Ex: Paiement à réception de facture, escompte de 2% pour paiement anticipé..." i18n-placeholder="@@invoices.invoice-wizard.ex.paiement.a.reception.de.facture.escompte.de.2.9537d717">
            </textarea>
          </div>
        </div>
      </section>

      <!-- Bank Details (if Bank Transfer) -->
      @if (payment.method === 'BANK_TRANSFER') {
        <p-divider></p-divider>

        <section class="section">
          <h2 class="section-title" i18n="@@invoices.invoice-wizard.coordonnees.bancaires.d28ffc8e">
            <i class="pi pi-building"></i>
            Coordonnées bancaires
          </h2>
          <p class="section-description" i18n="@@invoices.invoice-wizard.ces.informations.apparaitront.sur.la.facture.pou.7f2c6707"> Ces informations apparaîtront sur la facture pour faciliter le règlement </p>

          <div class="form-grid">
            <div class="form-group">
              <label for="bankName" i18n="@@invoices.invoice-wizard.nom.de.la.banque.9848ce74">Nom de la banque</label>
              <input
                pInputText
                id="bankName"
                [(ngModel)]="payment.bankName"
                (ngModelChange)="updatePayment({ bankName: $event })"
                placeholder="Ex: Banque de Tunisie" i18n-placeholder="@@invoices.invoice-wizard.ex.banque.de.tunisie.c3754ea9">
            </div>

            <div class="form-group">
              <label for="rib" i18n="@@invoices.invoice-wizard.rib.61f3ea57">RIB</label>
              <p-inputMask
                inputId="rib"
                [(ngModel)]="payment.rib"
                (ngModelChange)="updatePayment({ rib: $event })"
                mask="99 999 9999999999999999 99"
                placeholder="XX XXX XXXXXXXXXXX XX" i18n-placeholder="@@invoices.invoice-wizard.xx.xxx.xxxxxxxxxxx.xx.09ed7c5a">
              </p-inputMask>
              <small class="form-hint" i18n="@@invoices.invoice-wizard.releve.d.identite.bancaire.20.caracteres.0a997ef2"> Relevé d'Identité Bancaire (20 caractères) </small>
            </div>

            <div class="form-group full-width">
              <label for="iban" i18n="@@invoices.invoice-wizard.iban.optionnel.e3ca0f8d">IBAN (optionnel)</label>
              <input
                pInputText
                id="iban"
                [(ngModel)]="payment.iban"
                (ngModelChange)="updatePayment({ iban: $event })"
                placeholder="TNXX XXXX XXXX XXXX XXXX XXXX" i18n-placeholder="@@invoices.invoice-wizard.tnxx.xxxx.xxxx.xxxx.xxxx.xxxx.9f78d4ed"
                maxlength="34">
              <small class="form-hint" i18n="@@invoices.invoice-wizard.format.international.pour.les.paiements.depuis.l.fa96cb29"> Format international pour les paiements depuis l'étranger </small>
            </div>
          </div>
        </section>
      }

      <p-divider></p-divider>

      <!-- Purchase Order Reference -->
      <section class="section">
        <h2 class="section-title" i18n="@@invoices.invoice-wizard.reference.de.commande.0401dd40">
          <i class="pi pi-file"></i>
          Référence de commande
        </h2>

        <div class="form-group" style="max-width: 400px;">
          <label for="purchaseOrderRef" i18n="@@invoices.invoice-wizard.n.de.bon.de.commande.22b5d26b">N° de bon de commande</label>
          <input
            pInputText
            id="purchaseOrderRef"
            [(ngModel)]="payment.purchaseOrderRef"
            (ngModelChange)="updatePayment({ purchaseOrderRef: $event })"
            placeholder="Ex: BC-2026-0001" i18n-placeholder="@@invoices.invoice-wizard.ex.bc.2026.0001.e994e436">
          <small class="form-hint" i18n="@@invoices.invoice-wizard.reference.du.bon.de.commande.client.optionnel.e6c12910"> Référence du bon de commande client (optionnel) </small>
        </div>
      </section>

      <p-divider></p-divider>

      <!-- Legal Mentions -->
      <section class="section">
        <h2 class="section-title" i18n="@@invoices.invoice-wizard.mentions.legales.86ed0d3e">
          <i class="pi pi-shield"></i>
          Mentions légales
        </h2>
        <p class="section-description" i18n="@@invoices.invoice-wizard.mentions.obligatoires.selon.la.reglementation.tu.fa52fcf9"> Mentions obligatoires selon la réglementation tunisienne </p>

        <div class="legal-mentions-list">
          <!-- TVA Mention (Always required) -->
          <div class="legal-mention mandatory">
            <div class="mention-header">
              <i class="pi pi-check-circle"></i>
              <span class="mention-badge" i18n="@@invoices.invoice-wizard.obligatoire.389b678a">Obligatoire</span>
            </div>
            <div class="mention-content">
              <strong>{{ legalMentions.vatMention }}</strong>
              <p i18n="@@invoices.invoice-wizard.cette.mention.est.automatiquement.ajoutee.confor.7b0cd47e"> Cette mention est automatiquement ajoutée conformément à l'article 18 
                du Code de la TVA tunisien. </p>
            </div>
          </div>

          <!-- Exemption Mention (if applicable) -->
          @if (showExemptionMention()) {
            <div class="legal-mention exemption">
              <div class="mention-header">
                <i class="pi pi-exclamation-triangle"></i>
                <span class="mention-badge warning" i18n="@@invoices.invoice-wizard.client.exonere.f44392ad">Client exonéré</span>
              </div>
              <div class="mention-content">
                <strong i18n="@@invoices.invoice-wizard.mention.d.exoneration.0df903f7">Mention d'exonération</strong>
                <textarea
                  pTextarea
                  [(ngModel)]="legalMentions.exemptionMention"
                  (ngModelChange)="updateLegalMentions({ exemptionMention: $event })"
                  rows="2"
                  placeholder="Motif d'exonération de TVA..." i18n-placeholder="@@invoices.invoice-wizard.motif.d.exoneration.de.tva.3b0f8aad">
                </textarea>
                <small i18n="@@invoices.invoice-wizard.le.client.etant.exonere.de.tva.une.mention.justi.b25e8824"> Le client étant exonéré de TVA, une mention justificative est obligatoire. </small>
              </div>
            </div>
          }

          <!-- Custom Mention (Optional) -->
          <div class="legal-mention optional">
            <div class="mention-header">
              <i class="pi pi-plus-circle"></i>
              <span class="mention-badge optional-badge" i18n="@@invoices.invoice-wizard.optionnel.879d6b16">Optionnel</span>
            </div>
            <div class="mention-content">
              <strong i18n="@@invoices.invoice-wizard.mention.personnalisee.f15fe1a7">Mention personnalisée</strong>
              <textarea
                pTextarea
                [(ngModel)]="legalMentions.customMention"
                (ngModelChange)="updateLegalMentions({ customMention: $event })"
                rows="3"
                placeholder="Ajoutez une mention spécifique (garantie, conditions particulières, etc.)" i18n-placeholder="@@invoices.invoice-wizard.ajoutez.une.mention.specifique.garantie.conditio.aa9f5d90">
              </textarea>
            </div>
          </div>
        </div>
      </section>

      <!-- Compliance Summary -->
      <div class="compliance-summary">
        <div class="compliance-header">
          <i class="pi pi-shield"></i>
          <span i18n="@@invoices.invoice-wizard.conformite.reglementaire.300ae573">Conformité réglementaire</span>
        </div>
        <ul class="compliance-checklist">
          <li class="valid" i18n="@@invoices.invoice-wizard.mention.tva.presente.5d20d0ce">
            <i class="pi pi-check"></i>
            Mention TVA présente
          </li>
          <li [class.valid]="payment.method" [class.pending]="!payment.method" i18n="@@invoices.invoice-wizard.mode.de.paiement.specifie.7cb27fe5">
            <i [class]="payment.method ? 'pi pi-check' : 'pi pi-clock'"></i>
            Mode de paiement spécifié
          </li>
          @if (showExemptionMention()) {
            <li [class.valid]="legalMentions.exemptionMention" [class.invalid]="!legalMentions.exemptionMention" i18n="@@invoices.invoice-wizard.mention.d.exoneration.357a0f09">
              <i [class]="legalMentions.exemptionMention ? 'pi pi-check' : 'pi pi-times'"></i>
              Mention d'exonération {{ legalMentions.exemptionMention ? loc_ui_tern_renseignee_14ff83 : 'obligatoire' }}
            </li>
          }
          @if (payment.method === 'BANK_TRANSFER') {
            <li [class.valid]="payment.rib || payment.iban" [class.pending]="!payment.rib && !payment.iban" i18n="@@invoices.invoice-wizard.coordonnees.bancaires.59c16813">
              <i [class]="payment.rib || payment.iban ? 'pi pi-check' : 'pi pi-clock'"></i>
              Coordonnées bancaires {{ payment.rib || payment.iban ? loc_ui_tern_renseignees_a5ced9 : loc_ui_tern_recommandees_0c1370 }}
            </li>
          }
        </ul>
      </div>
    </div>
  `,
  styles: [`
    .step-legal {
      animation: fadeIn 0.3s ease-out;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .section {
      margin-bottom: var(--spacing-6);
    }

    .section-title {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      margin: 0 0 var(--spacing-2);
      font-size: var(--font-size-lg);
      font-weight: var(--font-weight-semibold);
      color: var(--color-neutral-800);

      i { color: var(--color-primary-500); }
    }

    .section-description {
      margin: 0 0 var(--spacing-4);
      font-size: var(--font-size-sm);
      color: var(--color-neutral-500);
    }

    // Payment Methods Grid
    .payment-methods-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: var(--spacing-3);
    }

    .payment-method-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--spacing-2);
      padding: var(--spacing-4);
      background: white;
      border: 2px solid var(--color-neutral-200);
      border-radius: var(--radius-lg);
      cursor: pointer;
      transition: all var(--transition-fast);
      text-align: center;

      i {
        font-size: var(--font-size-2xl);
        color: var(--color-neutral-500);
      }

      span {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        color: var(--color-neutral-700);
      }

      &:hover {
        border-color: var(--color-primary-300);
        background: var(--color-primary-50);
      }

      &.selected {
        border-color: var(--color-primary-500);
        background: var(--color-primary-50);

        i {
          color: var(--color-primary-600);
        }

        span {
          color: var(--color-primary-700);
        }
      }

      &:focus-visible {
        outline: 2px solid var(--color-primary-500);
        outline-offset: 2px;
      }
    }

    // Form Grid
    .form-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: var(--spacing-4);

      @media (max-width: 768px) {
        grid-template-columns: 1fr;
      }
    }

    .form-group {
      display: flex;
      flex-direction: column;

      &.full-width {
        grid-column: 1 / -1;
      }

      label {
        margin-bottom: var(--spacing-2);
        font-weight: var(--font-weight-medium);
        color: var(--color-neutral-700);
        font-size: var(--font-size-sm);
      }

      .form-hint {
        margin-top: var(--spacing-1);
        font-size: var(--font-size-xs);
        color: var(--color-neutral-500);
      }

      ::ng-deep {
        .p-inputtext,
        .p-select,
        .p-inputnumber,
        .p-inputmask,
        textarea {
          width: 100%;
        }
      }
    }

    // Legal Mentions
    .legal-mentions-list {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-4);
    }

    .legal-mention {
      padding: var(--spacing-4);
      border-radius: var(--radius-lg);
      border: 1px solid;

      &.mandatory {
        background: var(--color-success-50);
        border-color: var(--color-success-200);
      }

      &.exemption {
        background: var(--color-warning-50);
        border-color: var(--color-warning-200);
      }

      &.optional {
        background: var(--color-neutral-50);
        border-color: var(--color-neutral-200);
      }
    }

    .mention-header {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      margin-bottom: var(--spacing-3);

      i {
        font-size: var(--font-size-lg);
      }

      .mandatory & i { color: var(--color-success-500); }
      .exemption & i { color: var(--color-warning-500); }
      .optional & i { color: var(--color-neutral-400); }
    }

    .mention-badge {
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-semibold);
      padding: var(--spacing-1) var(--spacing-2);
      border-radius: var(--radius-full);
      background: var(--color-success-100);
      color: var(--color-success-700);

      &.warning {
        background: var(--color-warning-100);
        color: var(--color-warning-700);
      }

      &.optional-badge {
        background: var(--color-neutral-200);
        color: var(--color-neutral-600);
      }
    }

    .mention-content {
      strong {
        display: block;
        margin-bottom: var(--spacing-2);
        color: var(--color-neutral-800);
      }

      p {
        margin: 0 0 var(--spacing-2);
        font-size: var(--font-size-sm);
        color: var(--color-neutral-600);
      }

      small {
        font-size: var(--font-size-xs);
        color: var(--color-neutral-500);
      }

      textarea {
        margin-bottom: var(--spacing-2);
      }
    }

    // Compliance Summary
    .compliance-summary {
      margin-top: var(--spacing-6);
      padding: var(--spacing-4);
      background: var(--color-neutral-50);
      border: 1px solid var(--color-neutral-200);
      border-radius: var(--radius-lg);
    }

    .compliance-header {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      margin-bottom: var(--spacing-3);
      font-weight: var(--font-weight-semibold);
      color: var(--color-neutral-700);

      i {
        color: var(--color-primary-500);
      }
    }

    .compliance-checklist {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);

      li {
        display: flex;
        align-items: center;
        gap: var(--spacing-2);
        font-size: var(--font-size-sm);

        &.valid {
          color: var(--color-success-700);
          i { color: var(--color-success-500); }
        }

        &.pending {
          color: var(--color-neutral-600);
          i { color: var(--color-neutral-400); }
        }

        &.invalid {
          color: var(--color-error-700);
          i { color: var(--color-error-500); }
        }
      }
    }
  `]
})
export class StepLegalComponent implements OnInit {
  readonly loc_ui_tern_renseignee_14ff83 = $localize`:@@ui.tern.renseignee.14ff83:renseignée`;
  readonly loc_ui_tern_renseignees_a5ced9 = $localize`:@@ui.tern.renseignees.a5ced9:renseignées`;
  readonly loc_ui_tern_recommandees_0c1370 = $localize`:@@ui.tern.recommandees.0c1370:recommandées`;
  readonly wizardService = inject(InvoiceWizardService);

  // Options
  paymentMethodOptions = PAYMENT_METHOD_OPTIONS;
  paymentTermsOptions = [
    { label: 'Paiement comptant', value: 'Paiement comptant' },
    { label: 'Paiement à 30 jours', value: 'Paiement à 30 jours' },
    { label: 'Paiement à 60 jours', value: 'Paiement à 60 jours' },
    { label: 'Paiement à 90 jours', value: 'Paiement à 90 jours' },
    { label: 'Paiement à réception', value: 'Paiement à réception de facture' },
    { label: 'Personnalisé', value: '' }
  ];

  selectedPaymentTerms: string = 'Paiement à 30 jours';

  get payment() {
    return this.wizardService.payment();
  }

  get legalMentions() {
    return this.wizardService.legalMentions();
  }

  ngOnInit(): void {
    // Initialize from service state
    this.selectedPaymentTerms = this.payment.terms || 'Paiement à 30 jours';
  }

  selectPaymentMethod(method: PaymentMethod): void {
    this.updatePayment({ method });
  }

  onPaymentTermsChange(value: string): void {
    this.updatePayment({ terms: value || this.payment.terms });
    
    // Update days based on selection
    if (value.includes('comptant') || value.includes('réception')) {
      this.updatePayment({ daysUntilDue: 0 });
    } else if (value.includes('30')) {
      this.updatePayment({ daysUntilDue: 30 });
    } else if (value.includes('60')) {
      this.updatePayment({ daysUntilDue: 60 });
    } else if (value.includes('90')) {
      this.updatePayment({ daysUntilDue: 90 });
    }
  }

  updatePayment(updates: any): void {
    this.wizardService.updatePayment(updates);
  }

  updateLegalMentions(updates: any): void {
    this.wizardService.updateLegalMentions(updates);
  }

  showExemptionMention(): boolean {
    const client = this.wizardService.client();
    return client?.taxType === ClientTaxType.TaxExempt;
  }
}
