/// <reference types="@angular/localize" />
import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';

// PrimeNG
import { SelectModule } from 'primeng/select';
import { InputTextModule } from 'primeng/inputtext';
import { AutoCompleteModule } from 'primeng/autocomplete';
import { RadioButtonModule } from 'primeng/radiobutton';
import { TooltipModule } from 'primeng/tooltip';
import { CardModule } from 'primeng/card';
import { DividerModule } from 'primeng/divider';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputMaskModule } from 'primeng/inputmask';
// Services & Models
import { InvoiceWizardService } from '../../services/invoice-wizard.service';
import { resolveClientRecordId } from '../../services/invoice-wizard-client.utils';
import { ToastService } from '@core/services/toast.service';
import { 
  ClientInfo,
  AddressInfo,
  ClientTaxType, 
  CLIENT_TAX_TYPE_OPTIONS,
  TUNISIAN_GOVERNORATES 
} from '../../models/invoice-wizard.models';
import { canonicalizeNif, isValidNif, NIF_PATTERN } from '@shared/validation';
import { nifAcceptsEitherSpelling } from '@shared/validation/tunisian-validators';
import { NifMaskPasteDirective } from '@shared/validation/nif-mask-paste.directive';

/**
 * Étape 3 - Informations du client
 * 
 * Permet de:
 * - Sélectionner un client existant
 * - Créer un nouveau client "à la volée"
 * 
 * Conformité tunisienne:
 * - Matricule fiscal obligatoire pour clients assujettis
 * - Adresse complète obligatoire
 * - Mention automatique d'exonération si applicable
 */
@Component({
  selector: 'app-step-client',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    SelectModule,
    InputTextModule,
    AutoCompleteModule,
    RadioButtonModule,
    TooltipModule,
    CardModule,
    DividerModule,
    ButtonModule,
    DialogModule,
    InputMaskModule,
    NifMaskPasteDirective
  ],
  template: `
    <div class="step-client">
      <!-- Mode Selection -->
      <section class="section">
        <h2 class="section-title" i18n="@@invoices.invoice-wizard.client.destinataire.4bd7d212">
          <i class="pi pi-user"></i>
          Client destinataire
        </h2>
        <p class="section-description" i18n="@@invoices.invoice-wizard.selectionnez.un.client.existant.ou.creez.en.un.n.ef74ccaf"> Sélectionnez un client existant ou créez-en un nouveau </p>

        <div class="mode-selector">
          <button
            type="button"
            class="mode-btn"
            [class.active]="mode === 'existing'"
            (click)="setMode('existing')">
            <i class="pi pi-search"></i>
            <span i18n="@@invoices.invoice-wizard.client.existant.842ea3f8">Client existant</span>
          </button>
          <button
            type="button"
            class="mode-btn"
            [class.active]="mode === 'new'"
            (click)="setMode('new')">
            <i class="pi pi-plus"></i>
            <span i18n="@@invoices.invoice-wizard.nouveau.client.9e7edfed">Nouveau client</span>
          </button>
        </div>
      </section>

      <p-divider></p-divider>

      <!-- Existing Client Search -->
      @if (mode === 'existing') {
        <section class="section">
          <div class="form-group">
            <label for="clientSearch" class="required" i18n="@@invoices.invoice-wizard.rechercher.un.client.723cebe6"> Rechercher un client </label>
            <p-autoComplete
              inputId="clientSearch"
              [(ngModel)]="selectedClient"
              [suggestions]="clientSuggestions()"
              (completeMethod)="searchClients($event)"
              (onSelect)="onClientSelect($event)"
              [dropdown]="true"
              [forceSelection]="true"
              field="name"
              placeholder="Nom, matricule fiscal ou email..." i18n-placeholder="@@invoices.invoice-wizard.nom.matricule.fiscal.ou.email.270e5b5e"
              [minLength]="2"
              emptyMessage="Aucun client trouvé" i18n-emptyMessage="@@invoices.invoice-wizard.aucun.client.trouve.ef55e6be"
              appendTo="body"
              [style]="{ width: '100%' }"
              [showEmptyMessage]="true">
              <ng-template let-client pTemplate="item">
                <div class="client-suggestion">
                  <div class="client-suggestion-main">
                    <span class="client-name">{{ client?.name || '' }}</span>
                    <span class="client-type" [class]="getTaxTypeBadgeClass(client?.taxType)">
                      {{ getTaxTypeLabel(client?.taxType) }}
                    </span>
                  </div>
                  @if (client?.nif) {
                    <span class="client-nif">{{ client.nif }}</span>
                  }
                  <span class="client-email">{{ client?.email || '' }}</span>
                </div>
              </ng-template>
            </p-autoComplete>
            <small class="form-hint" i18n="@@invoices.invoice-wizard.recherchez.par.nom.matricule.fiscal.ou.adresse.e.7ee4dece"> Recherchez par nom, matricule fiscal ou adresse email </small>
          </div>

          @if (selectedClient && selectedClient.id) {
            <div class="selected-client-card">
              <div class="selected-client-header">
                <div class="client-avatar">
                  {{ getInitials(selectedClient.name) }}
                </div>
                <div class="selected-client-info">
                  <h4>{{ selectedClient.name }}</h4>
                  <span class="tax-type-badge" [class]="getTaxTypeBadgeClass(selectedClient.taxType)">
                    {{ getTaxTypeLabel(selectedClient.taxType) }}
                  </span>
                </div>
                <button 
                  type="button" 
                  class="clear-btn"
                  pTooltip="Changer de client" i18n-pTooltip="@@invoices.invoice-wizard.changer.de.client.b170ee3b"
                  (click)="clearSelection()">
                  <i class="pi pi-times"></i>
                </button>
              </div>

              <p-divider></p-divider>

              <div class="selected-client-details">
                <div class="detail-row">
                  <i class="pi pi-map-marker"></i>
                  <span>
                    @if (selectedClient.address.street) {
                      {{ selectedClient.address.street }}, 
                    }
                    {{ selectedClient.address.city }} - 
                    {{ selectedClient.address.governorate }}
                  </span>
                </div>
                @if (selectedClient.nif) {
                  <div class="detail-row">
                    <i class="pi pi-id-card"></i>
                    <code>{{ selectedClient.nif }}</code>
                  </div>
                }
                <div class="detail-row">
                  <i class="pi pi-envelope"></i>
                  <span>{{ selectedClient.email }}</span>
                </div>
                @if (selectedClient.phone) {
                  <div class="detail-row">
                    <i class="pi pi-phone"></i>
                    <span>{{ selectedClient.phone }}</span>
                  </div>
                }
              </div>
            </div>
          }
        </section>
      }

      <!-- New Client Form -->
      @if (mode === 'new') {
        <section class="section">
          <form [formGroup]="clientForm" class="new-client-form">
            <!-- Tax Type Selection -->
            <div class="form-group">
              <label class="required" i18n="@@invoices.invoice-wizard.type.de.client.b2406987">Type de client</label>
              <div class="tax-type-cards">
                @for (option of taxTypeOptions; track option.value) {
                  <div 
                    class="tax-type-card"
                    [class.selected]="clientForm.get('taxType')?.value === option.value"
                    (click)="setTaxType(option.value)"
                    tabindex="0"
                    (keydown.enter)="setTaxType(option.value)">
                    <div class="tax-type-label">{{ option.label }}</div>
                    <div class="tax-type-desc">{{ option.description }}</div>
                  </div>
                }
              </div>
            </div>

            <p-divider></p-divider>

            <!-- Identity -->
            <h3 class="form-section-title" i18n="@@invoices.invoice-wizard.identite.3138be1c">Identité</h3>
            
            <div class="form-grid">
              <div class="form-group full-width">
                <label for="name" class="required" i18n="@@invoices.invoice-wizard.raison.sociale.nom.0cbfb1bd">Raison sociale / Nom</label>
                <input 
                  pInputText 
                  id="name" 
                  formControlName="name"
                  placeholder="Ex: ABC Industries SARL" i18n-placeholder="@@invoices.invoice-wizard.ex.abc.industries.sarl.8d1bc722"
                  [class.ng-invalid]="isFieldInvalid('name')">
                @if (isFieldInvalid('name')) {
                  <small class="form-error" i18n="@@invoices.invoice-wizard.la.raison.sociale.est.obligatoire.59e5aeb0">La raison sociale est obligatoire</small>
                }
              </div>

              @if (isTaxSubject()) {
                <div class="form-group">
                  <label for="nif" class="required" i18n="@@invoices.invoice-wizard.matricule.fiscal.304096c4">Matricule fiscal</label>
                  <p-inputMask
                    id="nif"
                    formControlName="nif"
                    appNifMaskPaste
                    mask="9999999a/a/a/999"
                    placeholder="Ex. 1772793W/A/M/000" i18n-placeholder="@@invoices.invoice-wizard.ex.1772793w.a.m.000.f3190bfc"
                    styleClass="w-full"
                    [style]="{'text-transform': 'uppercase'}"
                    [class.ng-invalid]="isFieldInvalid('nif')"
                    (onBlur)="normalizeNif()">
                  </p-inputMask>
                  <small class="form-hint" i18n="@@invoices.invoice-wizard.format.1772793w.a.m.000.953218ad">Format : 1772793W/A/M/000</small>
                  @if (isFieldInvalid('nif')) {
                    <small class="form-error">{{ getNifErrorMessage() }}</small>
                  }
                </div>
              }
            </div>

            <p-divider></p-divider>

            <!-- Address -->
            <h3 class="form-section-title" i18n="@@invoices.invoice-wizard.adresse.522e1466">Adresse</h3>
            
            <div class="form-grid">
              <div class="form-group full-width">
                <label for="street" class="required" i18n="@@invoices.invoice-wizard.adresse.522e1466">Adresse</label>
                <input 
                  pInputText 
                  id="street" 
                  formControlName="street"
                  placeholder="Numéro et nom de rue" i18n-placeholder="@@invoices.invoice-wizard.numero.et.nom.de.rue.a6fd8173"
                  [class.ng-invalid]="isFieldInvalid('street')">
              </div>

              <div class="form-group full-width">
                <label for="streetLine2" i18n="@@invoices.invoice-wizard.complement.d.adresse.fba484a7">Complément d'adresse</label>
                <input 
                  pInputText 
                  id="streetLine2" 
                  formControlName="streetLine2"
                  placeholder="Appartement, étage, bâtiment..." i18n-placeholder="@@invoices.invoice-wizard.appartement.etage.batiment.15503019">
              </div>

              <div class="form-group">
                <label for="postalCode" i18n="@@invoices.invoice-wizard.code.postal.74779109">Code postal</label>
                <input 
                  pInputText 
                  id="postalCode" 
                  formControlName="postalCode"
                  placeholder="1000" i18n-placeholder="@@invoices.invoice-wizard.1000.e3cbba88"
                  maxlength="5">
              </div>

              <div class="form-group">
                <label for="city" class="required" i18n="@@invoices.invoice-wizard.ville.97217611">Ville</label>
                <input 
                  pInputText 
                  id="city" 
                  formControlName="city"
                  placeholder="Tunis" i18n-placeholder="@@invoices.invoice-wizard.tunis.e58b2d54"
                  [class.ng-invalid]="isFieldInvalid('city')">
              </div>

              <div class="form-group">
                <label for="governorate" class="required" i18n="@@invoices.invoice-wizard.gouvernorat.b9cd1d99">Gouvernorat</label>
                <p-select
                  inputId="governorate"
                  formControlName="governorate"
                  [options]="governorateOptions"
                  optionLabel="label"
                  optionValue="value"
                  placeholder="Sélectionner..." i18n-placeholder="@@invoices.invoice-wizard.selectionner.01ea04b3"
                  [filter]="true"
                  filterPlaceholder="Rechercher..." i18n-filterPlaceholder="@@invoices.invoice-wizard.rechercher.a3c28969"
                  appendTo="body"
                  [class.ng-invalid]="isFieldInvalid('governorate')">
                </p-select>
              </div>
            </div>

            <p-divider></p-divider>

            <!-- Contact -->
            <h3 class="form-section-title" i18n="@@invoices.invoice-wizard.contact.b37456c4">Contact</h3>
            
            <div class="form-grid">
              <div class="form-group">
                <label for="email" i18n="@@invoices.invoice-wizard.email.84add5b2">Email</label>
                <input 
                  pInputText 
                  type="email"
                  id="email" 
                  formControlName="email"
                  placeholder="contact@exemple.tn" i18n-placeholder="@@invoices.invoice-wizard.contact.exemple.tn.c035c2ff"
                  [class.ng-invalid]="isFieldInvalid('email')">
                @if (isFieldInvalid('email')) {
                  <small class="form-error" i18n="@@invoices.invoice-wizard.email.invalide.e09b961a">Email invalide</small>
                }
              </div>

              <div class="form-group">
                <label for="phone" i18n="@@invoices.invoice-wizard.telephone.d3b023ea">Téléphone</label>
                <p-inputMask
                  id="phone"
                  formControlName="phone"
                  mask="+216 99 999 999"
                  placeholder="+216 XX XXX XXX" i18n-placeholder="@@invoices.invoice-wizard.216.xx.xxx.xxx.e336394e">
                </p-inputMask>
              </div>

              <div class="form-group">
                <label for="contactPerson" i18n="@@invoices.invoice-wizard.personne.de.contact.148fdd96">Personne de contact</label>
                <input 
                  pInputText 
                  id="contactPerson" 
                  formControlName="contactPerson"
                  placeholder="Nom du responsable" i18n-placeholder="@@invoices.invoice-wizard.nom.du.responsable.45818ee5">
              </div>
            </div>
          </form>
        </section>
      }

      <!-- Tax Type Warning -->
      @if (showExemptionWarning()) {
        <div class="warning-box">
          <div class="warning-icon">
            <i class="pi pi-exclamation-triangle"></i>
          </div>
          <div class="warning-content">
            <strong i18n="@@invoices.invoice-wizard.client.exonere.de.tva.ce8a68fa">Client exonéré de TVA</strong>
            <p i18n="@@invoices.invoice-wizard.une.mention.legale.d.exoneration.sera.automatiqu.903e9d06"> Une mention légale d'exonération sera automatiquement ajoutée à la facture 
              conformément à la réglementation tunisienne. </p>
          </div>
        </div>
      }

      <!-- Compliance Check -->
      @if (hasClientSelected()) {
        <div class="compliance-box" [class.success]="isClientValid()" [class.warning]="!isClientValid()">
          <div class="compliance-header">
            @if (isClientValid()) {
              <i class="pi pi-check-circle"></i>
              <span i18n="@@invoices.invoice-wizard.informations.conformes.7517e50f">Informations conformes</span>
            } @else {
              <i class="pi pi-exclamation-circle"></i>
              <span i18n="@@invoices.invoice-wizard.informations.incompletes.593a626c">Informations incomplètes</span>
            }
          </div>
          <ul class="compliance-list">
            <li [class.valid]="hasClientName()" [class.invalid]="!hasClientName()" i18n="@@invoices.invoice-wizard.raison.sociale.presente.c56c3a50">
              <i [class]="hasClientName() ? 'pi pi-check' : 'pi pi-times'"></i>
              Raison sociale présente
            </li>
            <li [class.valid]="hasClientAddress()" [class.invalid]="!hasClientAddress()" i18n="@@invoices.invoice-wizard.adresse.complete.f8e9dd2a">
              <i [class]="hasClientAddress() ? 'pi pi-check' : 'pi pi-times'"></i>
              Adresse complète
            </li>
            @if (isTaxSubjectSelected()) {
              <li [class.valid]="hasValidNif()" [class.invalid]="!hasValidNif()" i18n="@@invoices.invoice-wizard.matricule.fiscal.valide.obligatoire.pour.3497d6d2">
                <i [class]="hasValidNif() ? 'pi pi-check' : 'pi pi-times'"></i>
                Matricule fiscal valide (obligatoire pour assujetti)
              </li>
            } @else {
              <li class="valid" i18n="@@invoices.invoice-wizard.matricule.fiscal.non.requis.e3ad5393">
                <i class="pi pi-check"></i>
                Matricule fiscal non requis
              </li>
            }
          </ul>
        </div>
      }
    </div>
  `,
  styles: [`
    .step-client {
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

    // Mode Selector
    .mode-selector {
      display: flex;
      gap: var(--spacing-3);
    }

    .mode-btn {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      padding: var(--spacing-3) var(--spacing-5);
      border: 2px solid var(--color-neutral-200);
      background: white;
      border-radius: var(--radius-lg);
      cursor: pointer;
      transition: all var(--transition-fast);
      font-weight: var(--font-weight-medium);
      color: var(--color-neutral-600);

      &:hover {
        border-color: var(--color-primary-300);
        color: var(--color-primary-600);
      }

      &.active {
        border-color: var(--color-primary-500);
        background: var(--color-primary-50);
        color: var(--color-primary-700);
      }

      i { font-size: var(--font-size-lg); }
    }

    // Form styles
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

        &.required::after {
          content: ' *';
          color: var(--color-error-500);
        }
      }

      .form-hint {
        margin-top: var(--spacing-1);
        font-size: var(--font-size-xs);
        color: var(--color-neutral-500);
      }

      .form-error {
        margin-top: var(--spacing-1);
        font-size: var(--font-size-xs);
        color: var(--color-error-600);
      }

      ::ng-deep {
        .p-inputtext,
        .p-select,
        .p-autocomplete {
          width: 100%;
        }

        .p-inputtext.ng-invalid.ng-touched,
        .p-select.ng-invalid.ng-touched {
          border-color: var(--color-error-500);
        }
      }
    }

    .form-section-title {
      margin: 0 0 var(--spacing-4);
      font-size: var(--font-size-base);
      font-weight: var(--font-weight-semibold);
      color: var(--color-neutral-700);
    }

    // Tax Type Cards
    .tax-type-cards {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: var(--spacing-3);

      @media (max-width: 768px) {
        grid-template-columns: 1fr;
      }
    }

    .tax-type-card {
      padding: var(--spacing-4);
      border: 2px solid var(--color-neutral-200);
      border-radius: var(--radius-lg);
      cursor: pointer;
      transition: all var(--transition-fast);
      text-align: center;

      &:hover {
        border-color: var(--color-primary-300);
      }

      &.selected {
        border-color: var(--color-primary-500);
        background: var(--color-primary-50);
      }

      &:focus-visible {
        outline: 2px solid var(--color-primary-500);
        outline-offset: 2px;
      }
    }

    .tax-type-label {
      font-weight: var(--font-weight-semibold);
      color: var(--color-neutral-800);
      margin-bottom: var(--spacing-1);
    }

    .tax-type-desc {
      font-size: var(--font-size-xs);
      color: var(--color-neutral-500);
    }

    // Client Suggestion
    .client-suggestion {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-1);
      padding: var(--spacing-2);
    }

    .client-suggestion-main {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
    }

    .client-name {
      font-weight: var(--font-weight-semibold);
      color: var(--color-neutral-800);
    }

    .client-type,
    .tax-type-badge {
      font-size: var(--font-size-xs);
      padding: var(--spacing-1) var(--spacing-2);
      border-radius: var(--radius-full);
      font-weight: var(--font-weight-medium);

      &.tax-subject {
        background: var(--color-primary-100);
        color: var(--color-primary-700);
      }

      &.non-tax-subject {
        background: var(--color-neutral-100);
        color: var(--color-neutral-600);
      }

      &.tax-exempt {
        background: var(--color-warning-100);
        color: var(--color-warning-700);
      }
    }

    .client-nif {
      font-family: 'JetBrains Mono', monospace;
      font-size: var(--font-size-xs);
      color: var(--color-neutral-600);
    }

    .client-email {
      font-size: var(--font-size-xs);
      color: var(--color-neutral-500);
    }

    // Selected Client Card
    .selected-client-card {
      width: 100%;
      margin-top: var(--spacing-4);
      padding: var(--spacing-4);
      background: white;
      border: 1px solid var(--color-neutral-200);
      border-radius: var(--radius-xl);
    }

    .selected-client-header {
      display: flex;
      align-items: center;
      gap: var(--spacing-3);
    }

    .client-avatar {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 48px;
      height: 48px;
      border-radius: var(--radius-lg);
      background: var(--color-primary-500);
      color: white;
      font-weight: var(--font-weight-bold);
      font-size: var(--font-size-lg);
    }

    .selected-client-info {
      flex: 1;

      h4 {
        margin: 0 0 var(--spacing-1);
        font-size: var(--font-size-lg);
        font-weight: var(--font-weight-semibold);
        color: var(--color-neutral-800);
      }
    }

    .clear-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border: none;
      background: var(--color-neutral-100);
      border-radius: var(--radius-full);
      cursor: pointer;
      color: var(--color-neutral-500);
      transition: all var(--transition-fast);

      &:hover {
        background: var(--color-error-100);
        color: var(--color-error-600);
      }
    }

    .selected-client-details {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);
    }

    .detail-row {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      font-size: var(--font-size-sm);
      color: var(--color-neutral-600);

      i {
        width: 20px;
        color: var(--color-neutral-400);
      }

      code {
        font-family: 'JetBrains Mono', monospace;
        background: var(--color-neutral-100);
        padding: var(--spacing-1) var(--spacing-2);
        border-radius: var(--radius-sm);
      }
    }

    // Warning Box
    .warning-box {
      display: flex;
      gap: var(--spacing-4);
      padding: var(--spacing-4);
      background: var(--color-warning-50);
      border: 1px solid var(--color-warning-200);
      border-radius: var(--radius-lg);
      margin-top: var(--spacing-4);
    }

    .warning-icon {
      flex-shrink: 0;
      
      i {
        font-size: var(--font-size-2xl);
        color: var(--color-warning-500);
      }
    }

    .warning-content {
      strong {
        color: var(--color-warning-800);
      }

      p {
        margin: var(--spacing-2) 0 0;
        font-size: var(--font-size-sm);
        color: var(--color-warning-700);
      }
    }

    // Compliance Box
    .compliance-box {
      margin-top: var(--spacing-6);
      padding: var(--spacing-4);
      border-radius: var(--radius-lg);

      &.success {
        background: var(--color-success-50);
        border: 1px solid var(--color-success-200);

        .compliance-header {
          color: var(--color-success-700);
          i { color: var(--color-success-500); }
        }
      }

      &.warning {
        background: var(--color-error-50);
        border: 1px solid var(--color-error-200);

        .compliance-header {
          color: var(--color-error-700);
          i { color: var(--color-error-500); }
        }
      }
    }

    .compliance-header {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      font-weight: var(--font-weight-semibold);
      margin-bottom: var(--spacing-3);

      i { font-size: var(--font-size-lg); }
    }

    .compliance-list {
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

        &.invalid {
          color: var(--color-error-700);
          i { color: var(--color-error-500); }
        }
      }
    }
  `]
})
export class StepClientComponent implements OnInit {
  readonly wizardService = inject(InvoiceWizardService);
  private fb = inject(FormBuilder);
  private readonly toastService = inject(ToastService);

  mode: 'existing' | 'new' = 'existing';
  selectedClient: any = null;
  clientSuggestions = signal<any[]>([]);

  // Options
  taxTypeOptions = CLIENT_TAX_TYPE_OPTIONS;
  governorateOptions = TUNISIAN_GOVERNORATES;

  // New Client Form
  clientForm!: FormGroup;

  ngOnInit(): void {
    // S'assurer que clientSuggestions est toujours un tableau vide au démarrage
    this.clientSuggestions.set([]);
    
    this.initForm();

    // Restore from service state
    const currentClient = this.wizardService.client();
    if (currentClient) {
      if (currentClient.isNewClient) {
        this.mode = 'new';
        this.patchFormFromClient(currentClient);
        this.updateNifValidators();
      } else {
        this.selectedClient = currentClient;
      }
    }
  }

  private initForm(): void {
    this.clientForm = this.fb.group({
      taxType: [ClientTaxType.TaxSubject, Validators.required],
      name: ['', [Validators.required, Validators.minLength(2)]],
      nif: [''],
      street: ['', Validators.required],
      streetLine2: [''],
      postalCode: [''],
      city: ['', Validators.required],
      governorate: ['', Validators.required],
      email: ['', [Validators.email]],
      phone: [''],
      contactPerson: ['']
    });

    // Watch for changes to update service
    this.clientForm.valueChanges.subscribe(value => {
      if (this.mode === 'new') {
        this.updateServiceFromForm(value);
      }
    });

    // Appliquer les validateurs NIF selon le type initial (Assujetti par défaut)
    this.updateNifValidators();
  }

  private patchFormFromClient(client: ClientInfo): void {
    this.clientForm.patchValue({
      taxType: client.taxType,
      name: client.name,
      nif: client.nif || '',
      street: client.address.street,
      streetLine2: client.address.streetLine2 || '',
      postalCode: client.address.postalCode || '',
      city: client.address.city,
      governorate: client.address.governorate,
      email: client.email,
      phone: client.phone || '',
      contactPerson: client.contactPerson || ''
    });
  }

  private updateServiceFromForm(value: any): void {
    const client: ClientInfo = {
      id: null,
      isNewClient: true,
      name: value.name,
      taxType: value.taxType,
      address: {
        street: value.street,
        streetLine2: value.streetLine2 || null,
        postalCode: value.postalCode || null,
        city: value.city,
        governorate: value.governorate,
        country: 'Tunisie'
      },
      nif: value.nif || null,
      email: value.email,
      phone: value.phone || null,
      contactPerson: value.contactPerson || null
    };

    this.wizardService.selectClient(client);
  }

  setMode(mode: 'existing' | 'new'): void {
    this.mode = mode;
    if (mode === 'new') {
      this.selectedClient = null;
      this.updateServiceFromForm(this.clientForm.value);
    } else {
      // Nettoyer l'état service quand on passe en mode "existant"
      // Le client sera re-défini dès qu'une sélection est faite dans l'autocomplete
      this.wizardService.selectClient(null);
    }
  }

  searchClients(event: any): void {
    const query = event.query?.toLowerCase() || '';
    
    // Réinitialiser les suggestions avant la recherche
    this.clientSuggestions.set([]);
    
    this.wizardService.loadClients(query).subscribe({
      next: (clients) => {
        // Vérification stricte : s'assurer que clients est toujours un tableau
        let clientsArray: any[] = [];
        
        if (Array.isArray(clients)) {
          clientsArray = clients;
        } else if (clients && typeof clients === 'object') {
          // Si c'est un objet, ne pas le convertir en tableau (causerait l'erreur NG02200)
          console.error('[searchClients] Received object instead of array:', clients);
          clientsArray = [];
        } else {
          console.warn('[searchClients] Unexpected clients type:', typeof clients, clients);
          clientsArray = [];
        }

        // Mapper les clients pour s'assurer qu'ils ont la structure attendue
        // Le backend renvoie maintenant Street, StreetLine2, PostalCode, City, Governorate, Country directement sur le DTO
        const mappedClients = clientsArray.map(client => {
          const address = client.address || {};
          const nif = client.nif || client.Nif || null;
          const clientType = client.type || client.Type;
          return {
            id: client.id || client.Id,
            name: client.name || client.Name,
            taxType: this.resolveSearchClientTaxType(clientType, nif),
            nif,
            email: client.email || client.Email || '',
            phone: client.phone || client.Phone || null,
            contactPerson: client.contactPerson || client.ContactPerson || null,
            address: {
              street: address.street || address.Street || client.street || client.Street || '',
              streetLine2: address.streetLine2 || address.StreetLine2 || client.streetLine2 || client.StreetLine2 || null,
              postalCode: address.postalCode || address.PostalCode || client.postalCode || client.PostalCode || null,
              city: address.city || address.City || client.city || client.City || '',
              governorate: address.governorate || address.Governorate || client.governorate || client.Governorate || '',
              country: address.country || address.Country || client.country || client.Country || 'Tunisie'
            }
          };
        });

        console.log('[searchClients] Setting suggestions, count:', mappedClients.length);
        this.clientSuggestions.set(mappedClients);
      },
      error: (error) => {
        console.error('[searchClients] Error loading clients:', error);
        // En cas d'erreur, utiliser un tableau vide plutôt que des données de démonstration
        // pour éviter de masquer le problème
        this.clientSuggestions.set([]);
      }
    });
  }

  private resolveSearchClientTaxType(clientType: string | undefined, nif: string | null): ClientTaxType {
    if (nif && isValidNif(nif)) {
      return ClientTaxType.TaxSubject;
    }

    if (typeof clientType === 'string') {
      if (clientType === ClientTaxType.TaxSubject || clientType === ClientTaxType.NonTaxSubject || clientType === ClientTaxType.TaxExempt) {
        return clientType as ClientTaxType;
      }

      const normalized = clientType.toLowerCase();
      if (normalized === 'individual' || normalized === 'association') {
        return ClientTaxType.NonTaxSubject;
      }
    }

    return ClientTaxType.TaxSubject;
  }

  onClientSelect(event: { originalEvent?: Event; value: any }): void {
    // PrimeNG AutoComplete onSelect émet { originalEvent, value }; le client est dans value
    const client = event?.value;
    if (!client) return;

    const resolvedId = resolveClientRecordId(client as Record<string, unknown>);
    if (!resolvedId) {
      this.toastService.add({
        severity: 'error',
        summary: $localize`:@@step-client.component.summary.Client_invalide:Client invalide`,
        detail:
          $localize`:@@step-client.component.detail.Ce_client_n_a_pa:Ce client n'a pas d'identifiant serveur. Veuillez le resélectionner dans la liste ou utiliser l'onglet « Nouveau client ».`,
        life: 6000
      });
      return;
    }

    const address = client.address || {};
    const normalizedAddress: AddressInfo = {
      street: address.street || address.Street || '',
      streetLine2: address.streetLine2 || address.StreetLine2 || null,
      postalCode: address.postalCode || address.PostalCode || null,
      city: address.city || address.City || '',
      governorate: address.governorate || address.Governorate || '',
      country: address.country || address.Country || 'Tunisie'
    };

    const clientInfo: ClientInfo = {
      id: resolvedId,
      isNewClient: false,
      name: client.name,
      taxType: client.taxType,
      address: normalizedAddress,
      nif: client.nif ?? null,
      email: client.email,
      phone: client.phone ?? null,
      contactPerson: client.contactPerson ?? null
    };

    this.selectedClient = clientInfo;
    this.wizardService.selectClient(clientInfo);
  }

  clearSelection(): void {
    this.selectedClient = null;
    this.wizardService.selectClient(null);
  }

  setTaxType(taxType: ClientTaxType): void {
    this.clientForm.patchValue({ taxType });
    this.updateNifValidators();
  }

  isTaxSubject(): boolean {
    return this.clientForm.get('taxType')?.value === ClientTaxType.TaxSubject;
  }

  isTaxSubjectSelected(): boolean {
    if (this.mode === 'new') {
      return this.isTaxSubject();
    }
    return this.selectedClient?.taxType === ClientTaxType.TaxSubject;
  }

  getTaxTypeLabel(taxType: ClientTaxType): string {
    const option = this.taxTypeOptions.find(o => o.value === taxType);
    return option?.label || '';
  }

  getTaxTypeBadgeClass(taxType: ClientTaxType): string {
    switch (taxType) {
      case ClientTaxType.TaxSubject: return 'tax-subject';
      case ClientTaxType.NonTaxSubject: return 'non-tax-subject';
      case ClientTaxType.TaxExempt: return 'tax-exempt';
      default: return '';
    }
  }

  getInitials(name: string): string {
    return name
      .split(' ')
      .map(w => w[0])
      .join('')
      .substring(0, 2)
      .toUpperCase();
  }

  isFieldInvalid(field: string): boolean {
    const control = this.clientForm.get(field);
    return !!(control && control.invalid && control.touched);
  }

  showExemptionWarning(): boolean {
    if (this.mode === 'new') {
      return this.clientForm.get('taxType')?.value === ClientTaxType.TaxExempt;
    }
    return this.selectedClient?.taxType === ClientTaxType.TaxExempt;
  }

  hasClientSelected(): boolean {
    if (this.mode === 'new') {
      return this.clientForm.get('name')?.value?.length > 0;
    }
    return !!this.selectedClient?.id;
  }

  isClientValid(): boolean {
    if (this.mode === 'new') {
      return this.clientForm.valid;
    }
    if (!this.selectedClient?.id) return false;
    if (!this.hasClientName() || !this.hasClientAddress()) return false;
    if (this.isTaxSubjectSelected() && !this.hasValidNif()) return false;
    return true;
  }

  hasClientName(): boolean {
    if (this.mode === 'new') {
      return this.clientForm.get('name')?.value?.length > 0;
    }
    return !!this.selectedClient?.name;
  }

  hasClientAddress(): boolean {
    if (this.mode === 'new') {
      const form = this.clientForm;
      return !!(form.get('street')?.value && form.get('city')?.value && form.get('governorate')?.value);
    }
    // Pour les clients existants, vérifier que l'adresse contient tous les champs obligatoires
    // selon le modèle AddressInfo : street, city et governorate sont tous requis
    // Utiliser selectedClient ou le client du service comme source de vérité
    const client = this.selectedClient || this.wizardService.client();
    const address = client?.address;
    // Vérifier que tous les champs requis sont présents et non vides
    return !!(address?.street?.trim() && address?.city?.trim() && address?.governorate?.trim());
  }

  hasValidNif(): boolean {
    if (this.mode === 'new') {
      const nif = this.clientForm.get('nif')?.value;
      return isValidNif(nif);
    }
    const nif = this.selectedClient?.nif;
    return !!nif && isValidNif(nif);
  }

  /**
   * Applique les validateurs NIF selon le type de client (assujetti = obligatoire + pattern).
   */
  private updateNifValidators(): void {
    const nifControl = this.clientForm.get('nif');
    const taxType = this.clientForm.get('taxType')?.value;
    if (taxType === ClientTaxType.TaxSubject) {
      nifControl?.setValidators([Validators.required, nifAcceptsEitherSpelling]);
    } else {
      nifControl?.clearValidators();
    }
    nifControl?.updateValueAndValidity();
  }

  /**
   * Normalise le NIF au blur. Nettoie les placeholders du masque (_), espaces,
   * et force le format avec slashes. Aligné sur client-form.
   */
  normalizeNif(): void {
    const nifControl = this.clientForm.get('nif');
    if (!nifControl) return;

    const value = nifControl.value as string;
    if (!value || typeof value !== 'string') return;

    const normalized = canonicalizeNif(value);

    const isEmpty = normalized === '';
    const isValidComplete = normalized.length > 0 && NIF_PATTERN.test(normalized);
    if ((isEmpty || isValidComplete) && normalized !== value) {
      nifControl.setValue(normalized, { emitEvent: false });
      nifControl.updateValueAndValidity({ emitEvent: false });
    }
  }

  /**
   * Message d'erreur NIF cohérent avec tunisian-validators / client-form.
   */
  getNifErrorMessage(): string {
    const control = this.clientForm.get('nif');
    if (!control?.errors) return '';
    if (control.errors['required']) {
      return 'Le matricule fiscal est obligatoire pour un client assujetti';
    }
    if (control.errors['pattern']) {
      return 'Matricule fiscal invalide. Format attendu: 1772793W/A/M/000';
    }
    return '';
  }
}
