import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';
import { Component, OnInit, Output, EventEmitter, inject, signal } from '@angular/core';
import { CommonModule, DecimalPipe, DatePipe } from '@angular/common';
import { RouterModule } from '@angular/router';

// PrimeNG
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import { DividerModule } from 'primeng/divider';
import { CardModule } from 'primeng/card';
import { TabsModule } from 'primeng/tabs';
import { AccordionModule } from 'primeng/accordion';
import { TagModule } from 'primeng/tag';
import { ProgressSpinnerModule } from 'primeng/progressspinner';

// Services & Models
import { InvoiceWizardService } from '../../services/invoice-wizard.service';
import { FeatureFlagsService } from '@core/services/feature-flags.service';
import {
  ValidationResult,
  ComplianceCheck,
  InvoiceType,
  PaymentMethod,
  InvoiceLine,
} from '../../models/invoice-wizard.models';

/**
 * Étape 6 - Aperçu, validation & émission
 * 
 * Fonctionnalités:
 * - Aperçu de la facture au format PDF
 * - Vérification automatique de conformité
 * - Validation finale avant émission
 * - Actions: émission, téléchargement PDF (si activé)
 * 
 * Conformité tunisienne:
 * - Vérification des mentions légales
 * - Validation du matricule fiscal
 * - Contrôle de la numérotation
 * - Vérification des calculs TVA
 */
@Component({
  selector: 'app-step-preview',
  standalone: true,
  imports: [BackendLabelPipe, 
    CommonModule,
    RouterModule,
    ButtonModule,
    TooltipModule,
    DividerModule,
    CardModule,
    TabsModule,
    AccordionModule,
    TagModule,
    ProgressSpinnerModule,
    DecimalPipe,
    DatePipe
  ],
  template: `
    <div class="step-preview">
      <!-- Header -->
      <section class="preview-header">
        <div class="header-content">
          <h2 class="section-title">
            <i class="pi pi-eye"></i>
            Aperçu et validation
          </h2>
          <p class="section-description" i18n="@@invoices.invoice-wizard.verifiez.les.informations.puis.emettez.la.factur.515bc47d"> Vérifiez les informations puis émettez la facture lorsque tout est conforme. </p>
        </div>
      </section>

      <p-tabs [lazy]="true">
        <p-tablist>
          <p-tab [value]="0"><i class="pi pi-file"></i><span i18n="@@invoices.invoice-wizard.apercu.facture.c43032fb">Aperçu facture</span></p-tab>
          <p-tab [value]="1"><i class="pi pi-check-circle"></i><span i18n="@@invoices.invoice-wizard.validation.conformite.59efbc17">Validation conformité</span></p-tab>
        </p-tablist>
        <p-tabpanels>
        <!-- Tab 1: Preview -->
        <p-tabpanel [value]="0">
          <div class="invoice-preview">
            <!-- Invoice Header -->
            <div class="invoice-header">
              <div class="invoice-header-left">
                @if (seller?.logo) {
                  <img [src]="seller!.logo" alt="Logo" i18n-alt="@@invoices.invoice-wizard.logo.83fce832" class="company-logo">
                }
                <div class="company-info">
                  <h3>{{ seller?.companyName }}</h3>
                  @if (seller?.tradeName) {
                    <span class="trade-name">{{ seller!.tradeName }}</span>
                  }
                </div>
              </div>
              <div class="invoice-header-right">
                <div class="facture-doc-title">{{ metadata.type === InvoiceType.CreditNote ? loc_ui_tern_facture_d_avoir_4c6fe8 : loc_ui_tern_facture_61fd01 }}</div>
                <div class="invoice-type-badge" [class]="invoiceTypeBadgeClass">
                  {{ invoiceTypeLabel }}
                </div>
                <div class="invoice-number">
                  {{ metadata.invoiceNumber || 'En attente...' }}
                </div>
              </div>
            </div>

            <p-divider></p-divider>

            <div class="client-and-meta-row">
              <div class="party-card client facture-client-block">
                <h4 i18n="@@invoices.invoice-wizard.facture.a.0fcf1964">Facturé à :</h4>
                <div class="party-name">{{ client?.name }}</div>
                <div class="party-address">
                  {{ client?.address?.street }}<br>
                  @if (client?.address?.postalCode) {
                    {{ client!.address!.postalCode }}
                  }
                  {{ client?.address?.city }}<br>
                  {{ client?.address?.governorate }}
                </div>
                @if (client?.nif) {
                  <div class="party-nif">
                    <strong i18n="@@invoices.invoice-wizard.n.fisc.8d1eec44">N° Fisc. :</strong> {{ client!.nif }}
                  </div>
                }
              </div>
              <div class="invoice-dates-block">
                <div class="dates-block-line"><strong>{{ metadata.type === InvoiceType.CreditNote ? loc_ui_tern_avoir_n_4d40ec : loc_ui_tern_facture_n_9d03d0 }}</strong> {{ metadata.invoiceNumber || '—' }}</div>
                <div class="dates-block-line"><strong i18n="@@invoices.invoice-wizard.date.facture.6bf98d96">Date facture :</strong> {{ metadata.issueDate | date:'dd/MM/yyyy' }}</div>
                @if (metadata.dueDate) {
                  <div class="dates-block-line"><strong i18n="@@invoices.invoice-wizard.echeance.0d63aefb">Échéance :</strong> {{ metadata.dueDate | date:'dd/MM/yyyy' }}</div>
                }
                @if (metadata.internalReference) {
                  <div class="dates-block-line"><strong i18n="@@invoices.invoice-wizard.ref.2bbf9d70">Réf. :</strong> {{ metadata.internalReference }}</div>
                }
                <div class="dates-block-line text-muted"><strong i18n="@@invoices.invoice-wizard.devise.7f17f4ea">Devise :</strong> {{ metadata.currency }}</div>
              </div>
            </div>

            <p-divider></p-divider>

            <!-- Lines Table -->
            <table class="lines-preview-table lines-preview-table--styled">
              <thead>
                <tr>
                  <th i18n="@@invoices.invoice-wizard.n.754e6095">N°</th>
                  <th i18n="@@invoices.invoice-wizard.ref.6f04e404">RÉF.</th>
                  <th i18n="@@invoices.invoice-wizard.description.0ceecbea">DESCRIPTION</th>
                  <th class="text-right" i18n="@@invoices.invoice-wizard.qte.fcf8d1f1">QTÉ</th>
                  <th i18n="@@invoices.invoice-wizard.unite.f40fb07b">UNITÉ</th>
                  <th class="text-right" i18n="@@invoices.invoice-wizard.prix.u.d251c16f">PRIX U.</th>
                  <th class="text-center" i18n="@@invoices.invoice-wizard.taxes.3101ff40">TAXES</th>
                  <th class="text-right" i18n="@@invoices.invoice-wizard.remise.c3be01d2">REMISE</th>
                  <th class="text-right" i18n="@@invoices.invoice-wizard.total.5c6505ae">TOTAL</th>
                </tr>
              </thead>
              <tbody>
                @for (line of lines; track line.id) {
                  <tr>
                    <td>{{ line.lineNumber }}</td>
                    <td>{{ lineRefLabel(line) }}</td>
                    <td>
                      <span class="designation-main">{{ line.designation }}</span>
                      @if (line.description) {
                        <br><small class="line-desc">{{ line.description }}</small>
                      }
                    </td>
                    <td class="text-right">{{ line.quantity | number:'1.0-3' }}</td>
                    <td>{{ line.unit || '—' }}</td>
                    <td class="text-right amount">{{ line.unitPriceHT | number:'1.3-3' }}</td>
                    <td class="text-center">
                      <span class="tax-cell">
                        <span>TVA {{ line.vatRate }}%</span>
                        @if (line.isFodecApplicable) {
                          <span class="fodec-badge" i18n="@@invoices.invoice-wizard.fodec.9a029080">FODEC</span>
                        }
                      </span>
                    </td>
                    <td class="text-right">
                      @if (line.discountAmount > 0) {
                        {{ line.discountValue }}{{ line.discountType === 'PERCENT' ? '%' : '' }}
                      } @else {
                        —
                      }
                    </td>
                    <td class="text-right amount">{{ line.totalTTC | number:'1.3-3' }}</td>
                  </tr>
                }
              </tbody>
            </table>

            <!-- Totals -->
            <div class="totals-preview">
              <div class="totals-left">
                <!-- VAT Breakdown -->
                <div class="vat-summary">
                  <h5 i18n="@@invoices.invoice-wizard.taxes.7e36e319">Taxes</h5>
                  <table class="vat-summary-table vat-summary-table--styled">
                    <thead>
                      <tr>
                        <th i18n="@@invoices.invoice-wizard.taxe.7acfb8ad">Taxe</th>
                        <th class="text-right" i18n="@@invoices.invoice-wizard.base.imposable.e1baa7e1">Base imposable</th>
                        <th class="text-right" i18n="@@invoices.invoice-wizard.montant.4adcd9fc">Montant</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (item of totals.vatBreakdown; track item.rate) {
                        <tr>
                          <td>{{ item.rateDisplay | backendLabel }}</td>
                          <td class="text-right">{{ item.baseAmount | number:'1.3-3' }}</td>
                          <td class="text-right">{{ item.vatAmount | number:'1.3-3' }}</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              </div>

              <div class="totals-right">
                <div class="total-line">
                  <span i18n="@@invoices.invoice-wizard.total.ht.2ca17ae6">Total HT</span>
                  <span class="amount">{{ totals.totalHT | number:'1.3-3' }} {{ metadata.currency }}</span>
                </div>
                @for (item of totals.vatBreakdown; track item.rate) {
                  @if (item.vatAmount > 0) {
                    <div class="total-line">
                      <span>{{ item.rateDisplay | backendLabel }}</span>
                      <span class="amount">{{ item.vatAmount | number:'1.3-3' }} {{ metadata.currency }}</span>
                    </div>
                  }
                }
                @if (totals.totalFodec > 0.0005 || totals.totalFodec < -0.0005) {
                  <div class="total-line">
                    <span>FODEC ({{ totals.fodecRatePercent }}%)</span>
                    <span class="amount">{{ totals.totalFodec | number:'1.3-3' }} {{ metadata.currency }}</span>
                  </div>
                }
                @if (totals.totalDiscount && totals.totalDiscount > 0) {
                  <div class="total-line discount">
                    <span i18n="@@invoices.invoice-wizard.remises.e0700e8c">Remises</span>
                    <span class="amount">-{{ totals.totalDiscount | number:'1.3-3' }} {{ metadata.currency }}</span>
                  </div>
                }
                @if (totals.fiscalStampAmount > 0.0005 || totals.fiscalStampAmount < -0.0005) {
                  <div class="total-line">
                    <span i18n="@@invoices.invoice-wizard.timbre.fiscal.1f8f7dd1">Timbre fiscal</span>
                    <span class="amount">{{ totals.fiscalStampAmount | number:'1.3-3' }} {{ metadata.currency }}</span>
                  </div>
                }
              </div>
            </div>

            <div class="total-ttc-banner">
              <span i18n="@@invoices.invoice-wizard.total.ttc.b4fb9955">TOTAL TTC</span>
              <span class="amount">{{ totals.totalTTC | number:'1.3-3' }} {{ metadata.currency }}</span>
            </div>

            <p class="thanks-line" i18n="@@invoices.invoice-wizard.merci.de.votre.confiance.e4293139">Merci de votre confiance.</p>

            <p-divider></p-divider>

            <!-- Legal Mentions -->
            <div class="legal-mentions-preview">
              <p class="vat-mention">{{ legalMentions.vatMention }}</p>
              @if (legalMentions.exemptionMention) {
                <p class="exemption-mention">{{ legalMentions.exemptionMention }}</p>
              }
              @if (legalMentions.customMention) {
                <p class="custom-mention">{{ legalMentions.customMention }}</p>
              }
            </div>

            <!-- Payment Info -->
            <div class="payment-info-preview">
              <h5 i18n="@@invoices.invoice-wizard.conditions.de.paiement.a9b1c917">Conditions de paiement</h5>
              <p><strong i18n="@@invoices.invoice-wizard.mode.fbb6d6fc">Mode:</strong> {{ paymentMethodLabel }}</p>
              @if (payment.terms) {
                <p>{{ payment.terms }}</p>
              }
              @if (payment.bankName || payment.rib) {
                <div class="bank-details">
                  @if (payment.bankName) {
                    <p><strong i18n="@@invoices.invoice-wizard.banque.877baf9a">Banque:</strong> {{ payment.bankName }}</p>
                  }
                  @if (payment.rib) {
                    <p><strong i18n="@@invoices.invoice-wizard.rib.e38e5dba">RIB:</strong> {{ payment.rib }}</p>
                  }
                  @if (payment.iban) {
                    <p><strong i18n="@@invoices.invoice-wizard.iban.71c8c232">IBAN:</strong> {{ payment.iban }}</p>
                  }
                </div>
              }
            </div>
          </div>
        </p-tabpanel>

        <!-- Tab 2: Validation -->
        <p-tabpanel [value]="1">
          <div class="validation-panel">
            <!-- Submission Error in Validation Tab -->
            @if (submissionError) {
              <div class="submission-error-banner">
                <div class="error-content">
                  <i class="pi pi-times-circle"></i>
                  <div class="error-text">
                    <strong i18n="@@invoices.invoice-wizard.erreur.d.emission.e55580f9">Erreur d'émission</strong>
                    <span>{{ submissionError }}</span>
                    @if (showSubscriptionCta) {
                      <a routerLink="/settings/subscription" class="quota-cta-link" i18n="@@invoices.invoice-wizard.gerer.mon.abonnement.8ba8c9cd">Gérer mon abonnement</a>
                    }
                  </div>
                </div>
                <button 
                  type="button"
                  class="error-dismiss"
                  (click)="dismissError()"
                  aria-label="Fermer" i18n-aria-label="@@invoices.invoice-wizard.fermer.5ab4ec64">
                  <i class="pi pi-times"></i>
                </button>
              </div>
            }

            @if (validating()) {
              <div class="validating-loader">
                <p-progressSpinner 
                  [style]="{ width: '50px', height: '50px' }"
                  strokeWidth="4">
                </p-progressSpinner>
                <p i18n="@@invoices.invoice-wizard.verification.de.conformite.en.cours.f8f6617d">Vérification de conformité en cours...</p>
              </div>
            } @else if (validation) {
              <!-- Validation Summary -->
              <div class="validation-summary" [class]="validationSummaryClass">
                <div class="summary-icon">
                  @if (validation.isValid) {
                    <i class="pi pi-check-circle"></i>
                  } @else if (validation.canProceed) {
                    <i class="pi pi-exclamation-circle"></i>
                  } @else {
                    <i class="pi pi-times-circle"></i>
                  }
                </div>
                <div class="summary-content">
                  <h3>{{ validationSummaryTitle }}</h3>
                  <p>{{ validationSummaryMessage }}</p>
                </div>
                <div class="summary-stats">
                  @if (validation.errorCount > 0) {
                    <span class="stat error">
                      <i class="pi pi-times"></i>
                      {{ validation.errorCount }} erreur(s)
                    </span>
                  }
                  @if (validation.warningCount > 0) {
                    <span class="stat warning">
                      <i class="pi pi-exclamation-triangle"></i>
                      {{ validation.warningCount }} avertissement(s)
                    </span>
                  }
                  @if (validation.isValid) {
                    <span class="stat success">
                      <i class="pi pi-check"></i>
                      Tout est conforme
                    </span>
                  }
                </div>
              </div>

              <!-- Validation Details -->
              <div class="validation-details">
                <p-accordion [multiple]="true">
                  <!-- Legal Checks -->
                  <p-accordionTab header="Mentions légales" i18n-header="@@invoices.invoice-wizard.mentions.legales.414291e0" [selected]="hasErrorsInCategory('LEGAL')">
                    <ng-template pTemplate="header">
                      <div class="accordion-header">
                        <span i18n="@@invoices.invoice-wizard.mentions.legales.414291e0">Mentions légales</span>
                        {{ getCategoryStatus('LEGAL') }}
                      </div>
                    </ng-template>
                    @for (check of getChecksByCategory('LEGAL'); track check.id) {
                      <div class="check-item" [class]="check.status.toLowerCase()">
                        <i [class]="getCheckIcon(check)"></i>
                        <div class="check-content">
                          <span class="check-label">{{ check.label }}</span>
                          <span class="check-desc">{{ check.description }}</span>
                        </div>
                      </div>
                    }
                  </p-accordionTab>

                  <!-- Fiscal Checks -->
                  <p-accordionTab header="Conformité fiscale" i18n-header="@@invoices.invoice-wizard.conformite.fiscale.f4dc5b52" [selected]="hasErrorsInCategory('FISCAL')">
                    <ng-template pTemplate="header">
                      <div class="accordion-header">
                        <span i18n="@@invoices.invoice-wizard.conformite.fiscale.f4dc5b52">Conformité fiscale</span>
                        {{ getCategoryStatus('FISCAL') }}
                      </div>
                    </ng-template>
                    @for (check of getChecksByCategory('FISCAL'); track check.id) {
                      <div class="check-item" [class]="check.status.toLowerCase()">
                        <i [class]="getCheckIcon(check)"></i>
                        <div class="check-content">
                          <span class="check-label">{{ check.label }}</span>
                          <span class="check-desc">{{ check.description }}</span>
                        </div>
                      </div>
                    }
                  </p-accordionTab>

                  <!-- Calculation Checks -->
                  <p-accordionTab header="Calculs" i18n-header="@@invoices.invoice-wizard.calculs.009b0e4f" [selected]="hasErrorsInCategory('CALCULATION')">
                    <ng-template pTemplate="header">
                      <div class="accordion-header">
                        <span i18n="@@invoices.invoice-wizard.calculs.009b0e4f">Calculs</span>
                        {{ getCategoryStatus('CALCULATION') }}
                      </div>
                    </ng-template>
                    @for (check of getChecksByCategory('CALCULATION'); track check.id) {
                      <div class="check-item" [class]="check.status.toLowerCase()">
                        <i [class]="getCheckIcon(check)"></i>
                        <div class="check-content">
                          <span class="check-label">{{ check.label }}</span>
                          <span class="check-desc">{{ check.description }}</span>
                        </div>
                      </div>
                    }
                  </p-accordionTab>

                  <!-- Format Checks -->
                  <p-accordionTab header="Format" i18n-header="@@invoices.invoice-wizard.format.041a5dec">
                    @for (check of getChecksByCategory('FORMAT'); track check.id) {
                      <div class="check-item" [class]="check.status.toLowerCase()">
                        <i [class]="getCheckIcon(check)"></i>
                        <div class="check-content">
                          <span class="check-label">{{ check.label }}</span>
                          <span class="check-desc">{{ check.description }}</span>
                        </div>
                      </div>
                    }
                  </p-accordionTab>
                </p-accordion>
              </div>
            }
          </div>
        </p-tabpanel>
        </p-tabpanels>
      </p-tabs>

      <!-- Submission Error Banner -->
      @if (submissionError) {
        <div class="submission-error-banner">
          <div class="error-content">
            <i class="pi pi-times-circle"></i>
            <div class="error-text">
              <strong i18n="@@invoices.invoice-wizard.erreur.ab546c23">Erreur</strong>
              <span>{{ submissionError }}</span>
              @if (showSubscriptionCta) {
                <a routerLink="/settings/subscription" class="quota-cta-link" i18n="@@invoices.invoice-wizard.gerer.mon.abonnement.8ba8c9cd">Gérer mon abonnement</a>
              }
            </div>
          </div>
          <button 
            type="button"
            class="error-dismiss"
            (click)="dismissError()"
            aria-label="Fermer" i18n-aria-label="@@invoices.invoice-wizard.fermer.5ab4ec64">
            <i class="pi pi-times"></i>
          </button>
        </div>
      }

      @if (invoiceQuotaBlocked && !submissionError) {
        <div class="quota-warning-banner">
          <div class="error-content">
            <i class="pi pi-exclamation-triangle"></i>
            <div class="error-text">
              <strong i18n="@@invoices.invoice-wizard.quota.factures.dfc0fe56">Quota factures</strong>
              <span>{{ invoiceQuotaMessage }}</span>
              <a routerLink="/settings/subscription" class="quota-cta-link" i18n="@@invoices.invoice-wizard.gerer.mon.abonnement.8ba8c9cd">Gérer mon abonnement</a>
            </div>
          </div>
        </div>
      } @else if (invoiceQuotaUsageLabel) {
        <p class="quota-usage-hint">
          <i class="pi pi-info-circle"></i>
          {{ invoiceQuotaUsageLabel }}
        </p>
      }

      <!-- Final Actions : émission unique -->
      <div class="final-actions">
        <div class="actions-warning">
          <i class="pi pi-exclamation-triangle"></i>
          <span>
            <strong i18n="@@invoices.invoice-wizard.attention.4d951ea1">Attention :</strong> Une fois émise, cette facture ne pourra plus être modifiée.
            Seule une facture d'avoir permettra d'effectuer des corrections.
          </span>
        </div>

        <div class="actions-single">
          <div class="action-card action-card--submit" [class.disabled]="!canSubmit">
            <div class="action-card-body">
              <h4 class="action-card-title">
                <i class="pi pi-send"></i>
                {{ emitActionTitle }}
              </h4>
              <p class="action-card-hint">{{ emitActionHint }}</p>
            </div>
            <p-button
              [label]="emitButtonLabel"
              icon="pi pi-send"
              severity="success"
              styleClass="action-card-btn"
              [disabled]="!canSubmit"
              (click)="onSubmit()">
            </p-button>
          </div>
        </div>

        @if (featureFlags.pdfPreview()) {
          <div class="actions-pdf">
            <p-button
              label="Télécharger aperçu PDF" i18n-label="@@invoices.invoice-wizard.telecharger.apercu.pdf.346b69f1"
              icon="pi pi-download"
              [text]="true"
              (click)="downloadPreview()">
            </p-button>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .step-preview {
      animation: fadeIn 0.3s ease-out;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .preview-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: var(--spacing-4);
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
      margin: 0;
      font-size: var(--font-size-sm);
      color: var(--color-neutral-500);
    }

    // Invoice Preview
    .invoice-preview {
      background: white;
      border: 1px solid var(--color-neutral-200);
      border-radius: var(--radius-xl);
      padding: var(--spacing-6);
      box-shadow: var(--shadow-md);
    }

    .invoice-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }

    .invoice-header-left {
      display: flex;
      align-items: center;
      gap: var(--spacing-4);

      .company-logo {
        width: 64px;
        height: 64px;
        object-fit: contain;
        border-radius: var(--radius-lg);
      }

      h3 {
        margin: 0;
        font-size: var(--font-size-xl);
        font-weight: var(--font-weight-bold);
        color: var(--color-neutral-900);
      }

      .trade-name {
        font-size: var(--font-size-sm);
        color: var(--color-neutral-500);
      }
    }

    .invoice-header-right {
      text-align: right;
    }

    .facture-doc-title {
      font-size: 1.5rem;
      font-weight: 800;
      color: #1a3d82;
      letter-spacing: 0.04em;
      margin-bottom: var(--spacing-2);
    }

    .client-and-meta-row {
      display: flex;
      flex-wrap: wrap;
      gap: var(--spacing-6);
      justify-content: space-between;
      align-items: flex-start;
      margin: var(--spacing-4) 0;
    }

    .facture-client-block {
      flex: 1 1 280px;
    }

    .invoice-dates-block {
      flex: 0 1 260px;
      text-align: right;
      font-size: var(--font-size-sm);
    }

    .dates-block-line {
      margin-bottom: var(--spacing-2);
    }

    .text-muted {
      color: var(--color-neutral-500);
      font-size: var(--font-size-xs);
    }

    .lines-preview-table--styled thead th {
      background: #1a3d82;
      color: #fff;
      border-bottom: none;
      font-weight: 600;
    }

    .lines-preview-table--styled tbody tr:nth-child(even) {
      background: var(--color-neutral-50);
    }

    .designation-main {
      font-weight: var(--font-weight-semibold);
    }

    .vat-summary-table--styled thead th {
      background: #1a3d82;
      color: #fff;
      padding: var(--spacing-2);
      font-size: var(--font-size-xs);
      text-transform: none;
    }

    .vat-summary-table--styled td {
      padding: var(--spacing-2);
    }

    .total-ttc-banner {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: var(--spacing-4);
      padding: var(--spacing-4);
      background: #1a3d82;
      color: #fff;
      border-radius: var(--radius-md);
      font-weight: var(--font-weight-bold);
    }

    .total-ttc-banner .amount {
      font-family: 'JetBrains Mono', monospace;
      font-size: var(--font-size-lg);
      color: inherit;
    }

    .thanks-line {
      margin: var(--spacing-4) 0 0;
      font-size: var(--font-size-sm);
      color: var(--color-neutral-600);
    }

    .invoice-type-badge {
      display: inline-block;
      padding: var(--spacing-2) var(--spacing-3);
      border-radius: var(--radius-md);
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      margin-bottom: var(--spacing-2);

      &.invoice {
        background: var(--color-primary-100);
        color: var(--color-primary-700);
      }

      &.credit-note {
        background: var(--color-warning-100);
        color: var(--color-warning-700);
      }
    }

    .invoice-number {
      font-family: 'JetBrains Mono', monospace;
      font-size: var(--font-size-xl);
      font-weight: var(--font-weight-bold);
      color: var(--color-neutral-900);
    }

    .parties-section {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: var(--spacing-6);
      margin: var(--spacing-4) 0;

      @media (max-width: 768px) {
        grid-template-columns: 1fr;
      }
    }

    .party-card {
      padding: var(--spacing-4);
      background: var(--color-neutral-50);
      border-radius: var(--radius-lg);

      h4 {
        margin: 0 0 var(--spacing-2);
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-semibold);
        text-transform: uppercase;
        color: var(--color-neutral-500);
      }

      .party-name {
        font-size: var(--font-size-lg);
        font-weight: var(--font-weight-semibold);
        color: var(--color-neutral-900);
        margin-bottom: var(--spacing-2);
      }

      .party-address {
        font-size: var(--font-size-sm);
        color: var(--color-neutral-600);
        margin-bottom: var(--spacing-2);
        line-height: var(--line-height-relaxed);
      }

      .party-nif,
      .party-rc {
        font-size: var(--font-size-sm);
        color: var(--color-neutral-700);
        font-family: 'JetBrains Mono', monospace;
      }
    }

    .invoice-meta {
      display: flex;
      gap: var(--spacing-6);
      margin: var(--spacing-4) 0;
      flex-wrap: wrap;
    }

    .meta-item {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-1);

      .meta-label {
        font-size: var(--font-size-xs);
        color: var(--color-neutral-500);
        text-transform: uppercase;
      }

      .meta-value {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-semibold);
        color: var(--color-neutral-800);
      }
    }

    .lines-preview-table {
      width: 100%;
      border-collapse: collapse;
      margin: var(--spacing-4) 0;

      th {
        padding: var(--spacing-3) var(--spacing-2);
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-semibold);
        text-transform: uppercase;
        color: var(--color-neutral-500);
        text-align: left;
        border-bottom: 2px solid var(--color-neutral-200);
      }

      td {
        padding: var(--spacing-3) var(--spacing-2);
        font-size: var(--font-size-sm);
        color: var(--color-neutral-700);
        border-bottom: 1px solid var(--color-neutral-100);
        vertical-align: top;
      }

      .line-desc {
        color: var(--color-neutral-500);
        font-size: var(--font-size-xs);
      }

      .amount {
        font-family: 'JetBrains Mono', monospace;
        font-weight: var(--font-weight-medium);
      }
    }

    .totals-preview {
      display: flex;
      justify-content: space-between;
      gap: var(--spacing-6);
      margin: var(--spacing-4) 0;

      @media (max-width: 768px) {
        flex-direction: column;
      }
    }

    .vat-summary {
      h5 {
        margin: 0 0 var(--spacing-2);
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-semibold);
        color: var(--color-neutral-700);
      }

      .vat-summary-table {
        font-size: var(--font-size-sm);

        td {
          padding: var(--spacing-1) var(--spacing-2);
        }
      }
    }

    .totals-right {
      min-width: 280px;
      padding: var(--spacing-4);
      background: var(--color-primary-50);
      border-radius: var(--radius-lg);
    }

    .tax-cell {
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      gap: var(--spacing-1);
    }

    .fodec-badge {
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-semibold);
      color: var(--color-warning-800);
      background: var(--color-warning-100);
      padding: 0 var(--spacing-1);
      border-radius: var(--radius-sm);
    }

    .total-line {
      display: flex;
      justify-content: space-between;
      padding: var(--spacing-2) 0;
      font-size: var(--font-size-sm);

      &.discount {
        color: var(--color-error-600);
      }

      &.grand {
        padding-top: var(--spacing-3);
        border-top: 2px solid var(--color-primary-200);
        margin-top: var(--spacing-2);

        span:first-child {
          font-size: var(--font-size-lg);
          font-weight: var(--font-weight-bold);
        }

        .amount {
          font-size: var(--font-size-xl);
          font-weight: var(--font-weight-bold);
          color: var(--color-primary-700);
        }
      }

      .amount {
        font-family: 'JetBrains Mono', monospace;
        font-weight: var(--font-weight-semibold);
      }
    }

    .legal-mentions-preview {
      margin: var(--spacing-4) 0;
      padding: var(--spacing-4);
      background: var(--color-neutral-50);
      border-radius: var(--radius-lg);
      font-size: var(--font-size-sm);

      p {
        margin: 0 0 var(--spacing-2);
        &:last-child { margin-bottom: 0; }
      }

      .vat-mention {
        font-weight: var(--font-weight-semibold);
        color: var(--color-neutral-700);
      }

      .exemption-mention {
        color: var(--color-warning-700);
      }
    }

    .payment-info-preview {
      margin: var(--spacing-4) 0;

      h5 {
        margin: 0 0 var(--spacing-2);
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-semibold);
        color: var(--color-neutral-700);
      }

      p {
        margin: 0 0 var(--spacing-1);
        font-size: var(--font-size-sm);
        color: var(--color-neutral-600);
      }

      .bank-details {
        margin-top: var(--spacing-2);
        padding: var(--spacing-3);
        background: var(--color-neutral-50);
        border-radius: var(--radius-md);
        font-family: 'JetBrains Mono', monospace;
      }
    }

    // Validation Panel
    .validation-panel {
      min-height: 400px;
    }

    .validating-loader {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: var(--spacing-10);
      gap: var(--spacing-4);

      p {
        color: var(--color-neutral-600);
      }
    }

    .validation-summary {
      display: flex;
      align-items: center;
      gap: var(--spacing-4);
      padding: var(--spacing-4);
      border-radius: var(--radius-lg);
      margin-bottom: var(--spacing-4);

      &.success {
        background: var(--color-success-50);
        border: 1px solid var(--color-success-200);

        .summary-icon i {
          color: var(--color-success-500);
        }
      }

      &.warning {
        background: var(--color-warning-50);
        border: 1px solid var(--color-warning-200);

        .summary-icon i {
          color: var(--color-warning-500);
        }
      }

      &.error {
        background: var(--color-error-50);
        border: 1px solid var(--color-error-200);

        .summary-icon i {
          color: var(--color-error-500);
        }
      }
    }

    .summary-icon i {
      font-size: 2.5rem;
    }

    .summary-content {
      flex: 1;

      h3 {
        margin: 0 0 var(--spacing-1);
        font-size: var(--font-size-lg);
        font-weight: var(--font-weight-semibold);
      }

      p {
        margin: 0;
        font-size: var(--font-size-sm);
        color: var(--color-neutral-600);
      }
    }

    .summary-stats {
      display: flex;
      gap: var(--spacing-3);

      .stat {
        display: flex;
        align-items: center;
        gap: var(--spacing-1);
        padding: var(--spacing-2) var(--spacing-3);
        border-radius: var(--radius-full);
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);

        &.error {
          background: var(--color-error-100);
          color: var(--color-error-700);
        }

        &.warning {
          background: var(--color-warning-100);
          color: var(--color-warning-700);
        }

        &.success {
          background: var(--color-success-100);
          color: var(--color-success-700);
        }
      }
    }

    .accordion-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      width: 100%;
    }

    .check-item {
      display: flex;
      align-items: flex-start;
      gap: var(--spacing-3);
      padding: var(--spacing-3);
      border-radius: var(--radius-md);
      margin-bottom: var(--spacing-2);

      &.valid {
        background: var(--color-success-50);
        i { color: var(--color-success-500); }
      }

      &.warning {
        background: var(--color-warning-50);
        i { color: var(--color-warning-500); }
      }

      &.error {
        background: var(--color-error-50);
        i { color: var(--color-error-500); }
      }

      i {
        margin-top: 2px;
        font-size: var(--font-size-lg);
      }
    }

    .check-content {
      flex: 1;
    }

    .check-label {
      display: block;
      font-weight: var(--font-weight-medium);
      color: var(--color-neutral-800);
    }

    .check-desc {
      display: block;
      font-size: var(--font-size-sm);
      color: var(--color-neutral-600);
      margin-top: var(--spacing-1);
    }

    // Final Actions
    .final-actions {
      margin-top: var(--spacing-6);
      padding-top: var(--spacing-4);
      border-top: 1px solid var(--color-neutral-200);
    }

    .actions-warning {
      display: flex;
      align-items: flex-start;
      gap: var(--spacing-3);
      padding: var(--spacing-4);
      background: var(--color-warning-50);
      border: 1px solid var(--color-warning-200);
      border-radius: var(--radius-lg);
      margin-bottom: var(--spacing-4);

      i {
        color: var(--color-warning-500);
        font-size: var(--font-size-xl);
        flex-shrink: 0;
      }

      span {
        font-size: var(--font-size-sm);
        color: var(--color-warning-800);
      }
    }

    .actions-buttons {
      display: flex;
      justify-content: flex-end;
      gap: var(--spacing-3);
    }

    .actions-single {
      display: flex;
      justify-content: center;
      margin-top: var(--spacing-2);
    }

    .actions-single .action-card {
      width: 100%;
      max-width: 640px;
    }

    .action-card {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-3);
      padding: var(--spacing-4);
      border: 1px solid var(--color-neutral-200);
      border-radius: var(--radius-lg);
      background: white;
      transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
    }

    .action-card:hover {
      border-color: var(--color-primary-300);
      box-shadow: var(--shadow-sm);
    }

    .action-card--submit:not(.disabled) {
      border-color: var(--color-success-200);
      background: linear-gradient(180deg, var(--color-success-50) 0%, white 100%);
    }

    .action-card.disabled {
      opacity: 0.7;
    }

    .action-card-title {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      margin: 0 0 var(--spacing-1);
      font-size: var(--font-size-base);
      font-weight: var(--font-weight-semibold);
      color: var(--color-neutral-900);
    }

    .action-card-title i {
      color: var(--color-primary-500);
    }

    .action-card--submit .action-card-title i {
      color: var(--color-success-600);
    }

    .action-card-hint {
      margin: 0;
      font-size: var(--font-size-sm);
      color: var(--color-neutral-600);
      line-height: var(--line-height-relaxed);
    }

    .actions-pdf {
      display: flex;
      justify-content: flex-end;
      margin-top: var(--spacing-3);
    }

    .text-right {
      text-align: right;
    }

    .text-center {
      text-align: center;
    }

    // Submission Error Banner
    .submission-error-banner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--spacing-4);
      padding: var(--spacing-4);
      margin-bottom: var(--spacing-4);
      background: var(--color-error-50);
      border: 1px solid var(--color-error-200);
      border-radius: var(--radius-lg);
      animation: slideDown 0.3s ease-out;

      .error-content {
        display: flex;
        align-items: flex-start;
        gap: var(--spacing-3);
        flex: 1;

        i {
          color: var(--color-error-500);
          font-size: var(--font-size-xl);
          flex-shrink: 0;
          margin-top: 2px;
        }

        .error-text {
          display: flex;
          flex-direction: column;
          gap: var(--spacing-1);

          strong {
            font-size: var(--font-size-sm);
            font-weight: var(--font-weight-semibold);
            color: var(--color-error-700);
            text-transform: uppercase;
          }

          span {
            font-size: var(--font-size-sm);
            color: var(--color-error-800);
            line-height: var(--line-height-relaxed);
          }
        }
      }

      .error-dismiss {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        border: none;
        background: transparent;
        border-radius: var(--radius-full);
        cursor: pointer;
        color: var(--color-error-600);
        transition: all var(--transition-fast);
        flex-shrink: 0;

        &:hover {
          background: var(--color-error-100);
          color: var(--color-error-700);
        }

        &:focus-visible {
          outline: 2px solid var(--color-error-500);
          outline-offset: 2px;
        }

        i {
          font-size: var(--font-size-sm);
        }
      }
    }

    .quota-warning-banner {
      display: flex;
      align-items: flex-start;
      gap: var(--spacing-3);
      padding: var(--spacing-4);
      margin-bottom: var(--spacing-4);
      background: var(--color-warning-50, #fffbeb);
      border: 1px solid var(--color-warning-200, #fde68a);
      border-radius: var(--radius-lg);

      .error-content i {
        color: var(--color-warning-600, #d97706);
        font-size: var(--font-size-xl);
        margin-top: 2px;
      }

      .error-text strong {
        color: var(--color-warning-800, #92400e);
      }

      .error-text span {
        color: var(--color-warning-900, #78350f);
      }
    }

    .quota-usage-hint {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      margin: 0 0 var(--spacing-4);
      font-size: var(--font-size-sm);
      color: var(--color-neutral-600);
    }

    .quota-cta-link {
      display: inline-block;
      margin-top: var(--spacing-2);
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--color-primary-600);
      text-decoration: none;

      &:hover {
        text-decoration: underline;
      }
    }

    @keyframes slideDown {
      from {
        opacity: 0;
        transform: translateY(-10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
  `]
})
export class StepPreviewComponent implements OnInit {
  readonly loc_ui_tern_facture_d_avoir_4c6fe8 = $localize`:@@ui.tern.facture.d.avoir.4c6fe8:FACTURE D'AVOIR`;
  readonly loc_ui_tern_facture_61fd01 = $localize`:@@ui.tern.facture.61fd01:FACTURE`;
  readonly loc_ui_tern_avoir_n_4d40ec = $localize`:@@ui.tern.avoir.n.4d40ec:AVOIR n° :`;
  readonly loc_ui_tern_facture_n_9d03d0 = $localize`:@@ui.tern.facture.n.9d03d0:FACTURE n° :`;
  @Output() validateAndSubmit = new EventEmitter<void>();

  readonly wizardService = inject(InvoiceWizardService);
  readonly featureFlags = inject(FeatureFlagsService);

  /** Exposed for template comparisons (Angular templates can only access class members). */
  readonly InvoiceType = InvoiceType;

  validating = signal(false);
  validation: ValidationResult | null = null;

  // Computed from service
  get metadata() { return this.wizardService.metadata(); }
  get seller() { return this.wizardService.seller(); }
  get client() { return this.wizardService.client(); }
  get lines() { return this.wizardService.lines(); }
  get totals() { return this.wizardService.totals(); }
  get legalMentions() { return this.wizardService.legalMentions(); }
  get payment() { return this.wizardService.payment(); }
  get submissionError() { return this.wizardService.submissionError(); }

  get showSubscriptionCta(): boolean {
    return this.wizardService.isPlanQuotaErrorCode(this.wizardService.submissionErrorCode())
      || this.invoiceQuotaBlocked;
  }

  get invoiceQuotaCheck(): ComplianceCheck | undefined {
    return this.validation?.checks.find(c => c.id === 'invoice-quota');
  }

  get invoiceQuotaBlocked(): boolean {
    const check = this.invoiceQuotaCheck;
    return !!check && check.status === 'ERROR' && check.isBlocking;
  }

  get invoiceQuotaMessage(): string {
    return this.invoiceQuotaCheck?.description ?? '';
  }

  get invoiceQuotaUsageLabel(): string | null {
    const check = this.invoiceQuotaCheck;
    if (!check || check.status !== 'VALID') {
      return null;
    }
    return check.description;
  }

  get invoiceTypeLabel(): string {
    return this.metadata.type === InvoiceType.CreditNote ? $localize`:@@ui.tern.facture.d.avoir.541e44:Facture d'avoir` : $localize`:@@ui.tern.facture.3953b9:Facture`;
  }

  get invoiceTypeBadgeClass(): string {
    return this.metadata.type === InvoiceType.CreditNote ? 'credit-note' : 'invoice';
  }

  get isCreditNote(): boolean {
    return this.metadata.type === InvoiceType.CreditNote;
  }

  get emitActionTitle(): string {
    return this.isCreditNote ? $localize`:@@ui.tern.emettre.l.avoir.4155eb:Émettre l'avoir` : $localize`:@@ui.tern.emettre.la.facture.9ba0dd:Émettre la facture`;
  }

  get emitButtonLabel(): string {
    return this.isCreditNote ? $localize`:@@ui.tern.emettre.l.avoir.4155eb:Émettre l'avoir` : $localize`:@@ui.tern.emettre.la.facture.9ba0dd:Émettre la facture`;
  }

  get emitActionHint(): string {
    return this.isCreditNote
      ? $localize`:@@ui.tern.l.avoir.est.valide.immediatement.avec.un.n.0d7593:L'avoir est validé immédiatement avec un numéro attribué.`
      : $localize`:@@ui.tern.la.facture.est.creee.vous.pourrez.la.valid.ef8ee6:La facture est créée ; vous pourrez la valider et la signer depuis sa fiche.`;
  }

  lineRefLabel(_line: InvoiceLine): string {
    return '—';
  }

  get paymentMethodLabel(): string {
    const labels: Record<PaymentMethod, string> = {
      [PaymentMethod.BankTransfer]: $localize`:@@ui.tern.virement.bancaire.8306f0:Virement bancaire`,
      [PaymentMethod.Cash]: $localize`:@@ui.tern.especes.b7679d:Espèces`,
      [PaymentMethod.Check]: $localize`:@@ui.tern.cheque.8bbb89:Chèque`,
      [PaymentMethod.Card]: $localize`:@@ui.tern.carte.bancaire.9e3d9b:Carte bancaire`,
      [PaymentMethod.Effect]: $localize`:@@ui.tern.effet.de.commerce.9793a8:Effet de commerce`
    };
    return labels[this.payment.method] || '';
  }

  get canSubmit(): boolean {
    return this.validation?.canProceed ?? false;
  }

  get validationSummaryClass(): string {
    if (!this.validation) return '';
    if (this.validation.isValid) return 'success';
    if (this.validation.canProceed) return 'warn';
    return 'error';
  }

  get validationSummaryTitle(): string {
    if (!this.validation) return '';
    if (this.validation.isValid) return 'Facture conforme';
    if (this.validation.canProceed) return 'Avertissements détectés';
    return 'Erreurs bloquantes';
  }

  get validationSummaryMessage(): string {
    if (!this.validation) return '';
    if (this.validation.isValid) {
      return 'Tous les contrôles de conformité sont passés avec succès.';
    }
    if (this.validation.canProceed) {
      return 'La facture peut être émise mais certains éléments méritent votre attention.';
    }
    return 'Des erreurs doivent être corrigées avant de pouvoir émettre cette facture.';
  }

  ngOnInit(): void {
    this.runValidation();
  }

  runValidation(): void {
    this.validating.set(true);

    this.wizardService.ensureSubscriptionLoaded({ forceRefresh: true }).subscribe({
      next: () => {
        this.validation = this.wizardService.validateInvoice();
        this.validating.set(false);
      },
      error: () => {
        this.validation = this.wizardService.validateInvoice();
        this.validating.set(false);
      }
    });
  }

  getChecksByCategory(category: string): ComplianceCheck[] {
    return this.validation?.checks.filter(c => c.category === category) || [];
  }

  hasErrorsInCategory(category: string): boolean {
    return this.getChecksByCategory(category).some(c => c.status === 'ERROR');
  }

  getCategoryStatus(category: string): string {
    const checks = this.getChecksByCategory(category);
    const errors = checks.filter(c => c.status === 'ERROR').length;
    const warnings = checks.filter(c => c.status === 'WARNING').length;
    
    if (errors > 0) return `${errors} erreur(s)`;
    if (warnings > 0) return `${warnings} avertissement(s)`;
    return 'OK';
  }

  getCheckIcon(check: ComplianceCheck): string {
    switch (check.status) {
      case 'VALID': return 'pi pi-check-circle';
      case 'WARNING': return 'pi pi-exclamation-triangle';
      case 'ERROR': return 'pi pi-times-circle';
      default: return 'pi pi-question-circle';
    }
  }

  onSubmit(): void {
    if (this.canSubmit) {
      this.validateAndSubmit.emit();
    }
  }

  downloadPreview(): void {
    // Implement PDF preview download
    console.log('Download preview PDF');
  }

  dismissError(): void {
    this.wizardService.clearSubmissionError();
  }
}
