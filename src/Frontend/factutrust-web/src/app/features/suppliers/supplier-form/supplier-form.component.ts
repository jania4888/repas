/// <reference types="@angular/localize" />
import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute, RouterModule } from '@angular/router';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { InputTextModule } from 'primeng/inputtext';
import { InputMaskModule } from 'primeng/inputmask';
import { Textarea } from 'primeng/textarea';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { MessageModule } from 'primeng/message';
import { ButtonModule } from 'primeng/button';
import { ToastModule } from 'primeng/toast';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { ErrorMessageService } from '@core/services/error-message.service';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { FormSectionComponent } from '@shared/components/form-section/form-section.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import {
  SupplierService,
  CreateSupplierRequest,
  UpdateSupplierRequest,
  SupplierType,
  SupplierRs7IsBracket,
  parseSupplierCreateConflict,
  SupplierConflictField
} from '@core/services/supplier.service';
import {
  normalizeSupplierRs7IsBracket,
  rs7BracketFromTypeCode,
  serializeSupplierRs7IsBracket
} from '@core/services/supplier-rs7-enums';
import { WithholdingTaxService, WithholdingTaxTypeDto, IdentificationType } from '@core/services/withholding-tax.service';
import { canonicalizeNif, NIF_PATTERN } from '@shared/validation';
import { nifAcceptsEitherSpelling } from '@shared/validation/tunisian-validators';
import { NifMaskPasteDirective } from '@shared/validation/nif-mask-paste.directive';

interface GovernorateOption {
  label: string;
  value: string;
}

@Component({
  selector: 'app-supplier-form',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    ReactiveFormsModule,
    InputTextModule,
    InputMaskModule,
    NifMaskPasteDirective,
    Textarea,
    InputNumberModule,
    SelectModule,
    MessageModule,
    ButtonModule,
    ToastModule,
    PageHeaderComponent,
    BreadcrumbComponent,
    FormSectionComponent,
    ButtonComponent
  ],
  template: `
    <app-breadcrumb [items]="breadcrumbItems"></app-breadcrumb>

    <app-page-header
      [title]="isEditMode ? loc_ui_tern_modifier_le_fournisseur_2436d5 : loc_ui_tern_nouveau_fournisseur_7e0ee2"
      [subtitle]="isEditMode ? loc_ui_tern_mettre_a_jour_les_informations_du_fourniss_e2ba76 : loc_ui_tern_renseignez_les_informations_essentielles_d_2da734">
      <app-button
        variant="outline"
        icon="pi-times"
        iconPos="left"
        routerLink="/suppliers" i18n="@@suppliers.supplier-form.annuler.49ba3292"> Annuler </app-button>
    </app-page-header>

    @if (loading()) {
      <div class="loading-container">
        <i class="pi pi-spin pi-spinner" style="font-size: 2rem;"></i>
        <p i18n="@@suppliers.supplier-form.chargement.a209b664">Chargement...</p>
      </div>
    } @else {
      <form [formGroup]="form" (ngSubmit)="onSubmit()">
        <div class="form-grid">
          <app-form-section title="Informations générales" i18n-title="@@suppliers.supplier-form.informations.generales.be6ba6e5" icon="pi-user" [number]="1">
            <div class="form-group">
              <label for="name"><ng-container i18n="@@suppliers.supplier-form.nom.ou.raison.sociale.2983b5c6">Nom ou raison sociale </ng-container> <span class="required" i18n="@@suppliers.supplier-form.text.df58248c">*</span></label>
              <input
                pInputText
                id="name"
                formControlName="name"
                placeholder="Ex. Jean Dupont ou ABC SARL" i18n-placeholder="@@suppliers.supplier-form.ex.jean.dupont.ou.abc.sarl.92bd3a72"
                class="w-full"
                [class.ng-invalid]="isInvalid('name')">
              @if (isInvalid('name')) {
                <div class="form-error">
                  <i class="pi pi-exclamation-circle"></i>
                  <span>{{ errorMessageService.getErrorMessage(form.get('name')) }}</span>
                </div>
              }
            </div>

            <div class="form-row">
              <div class="form-group">
                <label for="type"><ng-container i18n="@@suppliers.supplier-form.type.3deb7456">Type </ng-container> <span class="required" i18n="@@suppliers.supplier-form.text.df58248c">*</span></label>
                <p-select
                  id="type"
                  [options]="typeOptions"
                  formControlName="type"
                  optionLabel="label"
                  optionValue="value"
                  placeholder="Sélectionner" i18n-placeholder="@@suppliers.supplier-form.selectionner.ab31a36f"
                  styleClass="w-full">
                </p-select>
                @if (isInvalid('type')) {
                  <div class="form-error">
                    <i class="pi pi-exclamation-circle"></i>
                    <span>{{ errorMessageService.getErrorMessage(form.get('type')) }}</span>
                  </div>
                }
              </div>

              <div class="form-group">
                <label for="nif"><ng-container i18n="@@suppliers.supplier-form.nif.matricule.fiscal.a5458ed7">NIF / Matricule fiscal </ng-container>@if (form.get('type')?.value === SupplierType.Business) {<span class="required" i18n="@@suppliers.supplier-form.text.df58248c">*</span>}</label>
                <p-inputMask
                  id="nif"
                  formControlName="nif"
                  appNifMaskPaste
                  mask="9999999a/a/a/999"
                  placeholder="Ex. 1772793W/A/M/000" i18n-placeholder="@@suppliers.supplier-form.ex.1772793w.a.m.000.f3190bfc"
                  styleClass="w-full"
                  [style]="{'text-transform': 'uppercase'}"
                  [class.ng-invalid]="isInvalid('nif')"
                  (onBlur)="normalizeNif()">
                </p-inputMask>
                @if (form.get('type')?.value === SupplierType.Business) {
                  <small class="form-hint" i18n="@@suppliers.supplier-form.format.1772793w.a.m.000.953218ad">Format : 1772793W/A/M/000</small>
                }
                @if (isInvalid('nif')) {
                  <div class="form-error">
                    <i class="pi pi-exclamation-circle"></i>
                    <span>{{ getNifErrorMessage() }}</span>
                  </div>
                }
                @if (conflictSupplierId() && conflictField() === 'nif') {
                  <a class="form-conflict-link" [routerLink]="['/suppliers', conflictSupplierId()]" i18n="@@suppliers.supplier-form.ouvrir.le.fournisseur.existant.8b13c3cd"> Ouvrir le fournisseur existant </a>
                }
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label for="paymentTermDays" i18n="@@suppliers.supplier-form.delai.de.paiement.jours.586df9e3">Délai de paiement (jours)</label>
                <p-inputNumber
                  id="paymentTermDays"
                  formControlName="paymentTermDays"
                  [min]="0"
                  [max]="365"
                  styleClass="w-full">
                </p-inputNumber>
                @if (isInvalid('paymentTermDays')) {
                  <div class="form-error">
                    <i class="pi pi-exclamation-circle"></i>
                    <span>{{ errorMessageService.getErrorMessage(form.get('paymentTermDays')) }}</span>
                  </div>
                }
              </div>
            </div>
          </app-form-section>

          <app-form-section title="Coordonnées" i18n-title="@@suppliers.supplier-form.coordonnees.7c309d77" icon="pi-envelope" [number]="2">
            <div class="form-group">
              <label for="email" i18n="@@suppliers.supplier-form.adresse.email.bdf1cc95">Adresse email</label>
              <input
                pInputText
                id="email"
                type="email"
                formControlName="email"
                placeholder="contact@exemple.tn" i18n-placeholder="@@suppliers.supplier-form.contact.exemple.tn.c035c2ff"
                class="w-full"
                [class.ng-invalid]="isInvalid('email')">
              @if (isInvalid('email')) {
                <div class="form-error">
                  <i class="pi pi-exclamation-circle"></i>
                  <span>{{ errorMessageService.getErrorMessage(form.get('email')) }}</span>
                </div>
              }
              @if (conflictSupplierId() && conflictField() === 'email') {
                <a class="form-conflict-link" [routerLink]="['/suppliers', conflictSupplierId()]" i18n="@@suppliers.supplier-form.ouvrir.le.fournisseur.existant.8b13c3cd"> Ouvrir le fournisseur existant </a>
              }
            </div>

            <div class="form-group">
              <label for="phone" i18n="@@suppliers.supplier-form.telephone.d3b023ea">Téléphone</label>
              <p-inputMask
                id="phone"
                formControlName="phone"
                mask="99 999 999"
                placeholder="+216 XX XXX XXX" i18n-placeholder="@@suppliers.supplier-form.216.xx.xxx.xxx.e336394e"
                styleClass="w-full">
              </p-inputMask>
            </div>

            <div class="form-group">
              <label for="contactPerson" i18n="@@suppliers.supplier-form.personne.de.contact.148fdd96">Personne de contact</label>
              <input
                pInputText
                id="contactPerson"
                formControlName="contactPerson"
                placeholder="Nom du responsable" i18n-placeholder="@@suppliers.supplier-form.nom.du.responsable.45818ee5"
                class="w-full">
            </div>
          </app-form-section>

          <app-form-section title="Adresse" i18n-title="@@suppliers.supplier-form.adresse.522e1466" icon="pi-map-marker" [number]="3" class="address-card">
            <div class="form-group">
              <label for="street"><ng-container i18n="@@suppliers.supplier-form.adresse.522e1466">Adresse </ng-container> <span class="required" i18n="@@suppliers.supplier-form.text.df58248c">*</span></label>
              <input
                pInputText
                id="street"
                formControlName="street"
                placeholder="Numéro et nom de rue" i18n-placeholder="@@suppliers.supplier-form.numero.et.nom.de.rue.a6fd8173"
                maxlength="200"
                class="w-full"
                [class.ng-invalid]="isInvalid('street')">
              @if (isInvalid('street')) {
                <div class="form-error">
                  <i class="pi pi-exclamation-circle"></i>
                  <span>{{ errorMessageService.getErrorMessage(form.get('street')) }}</span>
                </div>
              }
            </div>

            <div class="form-group">
              <label for="streetLine2" i18n="@@suppliers.supplier-form.complement.d.adresse.fba484a7">Complément d'adresse</label>
              <input
                pInputText
                id="streetLine2"
                formControlName="streetLine2"
                placeholder="Bâtiment, étage…" i18n-placeholder="@@suppliers.supplier-form.batiment.etage.73c5abc1"
                class="w-full">
            </div>

            <div class="form-row">
              <div class="form-group">
                <label for="city"><ng-container i18n="@@suppliers.supplier-form.ville.97217611">Ville </ng-container> <span class="required" i18n="@@suppliers.supplier-form.text.df58248c">*</span></label>
                <input
                  pInputText
                  id="city"
                  formControlName="city"
                  placeholder="Tunis" i18n-placeholder="@@suppliers.supplier-form.tunis.e58b2d54"
                  class="w-full"
                  [class.ng-invalid]="isInvalid('city')">
                @if (isInvalid('city')) {
                  <div class="form-error">
                    <i class="pi pi-exclamation-circle"></i>
                    <span>{{ errorMessageService.getErrorMessage(form.get('city')) }}</span>
                  </div>
                }
              </div>

              <div class="form-group">
                <label for="postalCode" i18n="@@suppliers.supplier-form.code.postal.74779109">Code postal</label>
                <input
                  pInputText
                  id="postalCode"
                  formControlName="postalCode"
                  placeholder="1000" i18n-placeholder="@@suppliers.supplier-form.1000.e3cbba88"
                  class="w-full">
              </div>
            </div>

            <div class="form-group">
              <label for="governorate"><ng-container i18n="@@suppliers.supplier-form.gouvernorat.b9cd1d99">Gouvernorat </ng-container> <span class="required" i18n="@@suppliers.supplier-form.text.df58248c">*</span></label>
              <p-select
                id="governorate"
                [options]="governorates"
                formControlName="governorate"
                placeholder="Sélectionner" i18n-placeholder="@@suppliers.supplier-form.selectionner.ab31a36f"
                [filter]="true"
                filterBy="label"
                styleClass="w-full">
              </p-select>
              @if (isInvalid('governorate')) {
                <div class="form-error">
                  <i class="pi pi-exclamation-circle"></i>
                  <span>{{ errorMessageService.getErrorMessage(form.get('governorate')) }}</span>
                </div>
              }
            </div>
          </app-form-section>

          <app-form-section title="Retenue à la source (TEJ)" i18n-title="@@suppliers.supplier-form.retenue.a.la.source.tej.da317399" icon="pi-percentage" [number]="4" class="tej-card">
            <div class="form-group checkbox-row">
              <label class="checkbox-label">
                <input type="checkbox" formControlName="isSubjectToWithholding" /><ng-container i18n="@@suppliers.supplier-form.fournisseur.concerne.par.la.retenue.a.la.21915fda">
                Fournisseur concerné par la retenue à la source sur les achats
              </ng-container></label>
            </div>
            @if (form.get('isSubjectToWithholding')?.value) {
              <p-message
                severity="info"
                styleClass="tej-info-msg"
                text="Choisissez soit la Tranche IS (RS7 achats), soit un Type RS explicite du catalogue — pas les deux." i18n-text="@@suppliers.supplier-form.choisissez.soit.la.tranche.is.rs7.achats.2487d980">
              </p-message>
            }
            <div class="form-row">
              <div class="form-group">
                <label for="rs7" i18n="@@suppliers.supplier-form.tranche.is.achats.rs7.27bab91e">Tranche IS (achats RS7)</label>
                <p-select
                  id="rs7"
                  formControlName="rs7IsBracket"
                  [options]="rs7BracketOptions"
                  optionLabel="label"
                  optionValue="value"
                  placeholder="Sélectionner" i18n-placeholder="@@suppliers.supplier-form.selectionner.ab31a36f"
                  [disabled]="isExplicitRsTypeSelected()"
                  styleClass="w-full">
                </p-select>
                <small class="form-hint" i18n="@@suppliers.supplier-form.renseigne.le.code.tej.rs7.1.5.1.0.5.selon.le.tau.234bfd51">Renseigne le code TEJ RS7 (1,5 % / 1 % / 0,5 %) selon le taux d’IS du fournisseur. Laisser « non défini » si vous choisissez un type RS précis ci-contre.</small>
              </div>
              <div class="form-group">
                <label for="whType" i18n="@@suppliers.supplier-form.type.rs.explicite.optionnel.734c9fb6">Type RS explicite (optionnel)</label>
                <p-select
                  id="whType"
                  formControlName="defaultWithholdingTaxTypeId"
                  [options]="withholdingTypes"
                  optionLabel="label"
                  optionValue="id"
                  [showClear]="true"
                  placeholder="Automatique (tranche ou défaut)" i18n-placeholder="@@suppliers.supplier-form.automatique.tranche.ou.defaut.e27a9036"
                  [filter]="true"
                  filterBy="label,code"
                  [disabled]="isRs7BracketSelected()"
                  styleClass="w-full">
                </p-select>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label for="whRate" i18n="@@suppliers.supplier-form.taux.rs.par.defaut.optionnel.d248ba25">Taux RS par défaut (optionnel, %)</label>
                <p-inputNumber
                  id="whRate"
                  formControlName="defaultWithholdingRate"
                  [min]="0"
                  [max]="100"
                  [maxFractionDigits]="2"
                  styleClass="w-full">
                </p-inputNumber>
              </div>
              <div class="form-group checkbox-row align-end">
                <label class="checkbox-label">
                  <input type="checkbox" formControlName="isResident" /><ng-container i18n="@@suppliers.supplier-form.resident.fiscal.tunisien.6e1aa37c">
                  Résident fiscal tunisien
                </ng-container></label>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label for="cc" i18n="@@suppliers.supplier-form.code.pays.iso.ex.tn.06ce3193">Code pays (ISO, ex. TN)</label>
                <input pInputText id="cc" formControlName="countryCode" maxlength="3" class="w-full" style="text-transform: uppercase" />
                @if (isInvalid('countryCode')) {
                  <div class="form-error">
                    <i class="pi pi-exclamation-circle"></i>
                    <span i18n="@@suppliers.supplier-form.obligatoire.pour.un.non.resident.f99463c2">Obligatoire pour un non-résident</span>
                  </div>
                }
              </div>
              <div class="form-group">
                <label for="tejId" i18n="@@suppliers.supplier-form.identifiant.tej.type.dcad6745">Identifiant TEJ (type)</label>
                <p-select
                  id="tejId"
                  formControlName="tejIdentificationType"
                  [options]="tejIdTypeOptions"
                  optionLabel="label"
                  optionValue="value"
                  placeholder="—" i18n-placeholder="@@suppliers.supplier-form.text.1b93795b"
                  styleClass="w-full">
                </p-select>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label for="dob" i18n="@@suppliers.supplier-form.date.de.naissance.cin.passeport.d6f08634">Date de naissance (CIN / passeport)</label>
                <input pInputText id="dob" type="date" formControlName="dateOfBirth" class="w-full" />
              </div>
              <div class="form-group">
                <label for="act" i18n="@@suppliers.supplier-form.activite.tej.70893f95">Activité (TEJ)</label>
                <input pInputText id="act" formControlName="activity" maxlength="200" class="w-full" placeholder="Secteur / libellé court" i18n-placeholder="@@suppliers.supplier-form.secteur.libelle.court.8655f248" />
              </div>
            </div>
          </app-form-section>

          <app-form-section title="Notes" i18n-title="@@suppliers.supplier-form.notes.70440046" icon="pi-file-edit" [number]="5" class="notes-card">
            <div class="form-group">
              <label for="notes" i18n="@@suppliers.supplier-form.notes.internes.1a81fb4e">Notes internes</label>
              <textarea
                pTextarea
                id="notes"
                formControlName="notes"
                placeholder="Préférences, instructions particulières…" i18n-placeholder="@@suppliers.supplier-form.preferences.instructions.particulieres.7f4b138b"
                [rows]="4"
                class="w-full">
              </textarea>
              <small class="form-hint" i18n="@@suppliers.supplier-form.non.visibles.par.le.fournisseur.03ee7227">Non visibles par le fournisseur.</small>
            </div>
          </app-form-section>
        </div>

        <div class="form-actions">
          <app-button
            variant="outline"
            icon="pi-times"
            iconPos="left"
            routerLink="/suppliers" i18n="@@suppliers.supplier-form.annuler.49ba3292"> Annuler </app-button>
          <app-button
            variant="primary"
            type="submit"
            [icon]="saving() ? 'pi-spin pi-spinner' : 'pi-check'"
            iconPos="left"
            [disabled]="form.invalid || saving()">
            {{ isEditMode ? loc_ui_tern_enregistrer_f7c8bc : loc_ui_tern_creer_le_fournisseur_13e0a7 }}
          </app-button>
        </div>
      </form>
    }
  `,
  styles: [`
    .loading-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: var(--spacing-12);
      gap: var(--spacing-4);
      color: var(--color-neutral-600);
    }

    .form-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: var(--spacing-4);

      @media (max-width: 1024px) {
        grid-template-columns: 1fr;
      }
    }

    .address-card {
      grid-column: 1;
    }

    .tej-card {
      grid-column: 2;

      @media (max-width: 1024px) {
        grid-column: 1;
      }
    }

    .notes-card {
      grid-column: 1 / -1;
    }

    .checkbox-row {
      margin-bottom: var(--spacing-4);
    }

    .checkbox-label {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-2);
      font-size: var(--font-size-sm);
      cursor: pointer;
    }

    .align-end {
      display: flex;
      align-items: flex-end;
      padding-bottom: var(--spacing-1);
    }

    .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--spacing-4);

      @media (max-width: 640px) {
        grid-template-columns: 1fr;
      }
    }

    .form-group {
      margin-bottom: var(--spacing-5);

      &:last-child {
        margin-bottom: 0;
      }

      label {
        display: block;
        margin-bottom: var(--spacing-2);
        font-weight: var(--font-weight-semibold);
        font-size: var(--font-size-sm);
        color: var(--color-text-primary);
      }

      .required {
        color: var(--color-error-600);
        margin-left: var(--spacing-1);
      }
    }

    .form-error {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      margin-top: var(--spacing-1);
      font-size: var(--font-size-sm);
      color: var(--color-error-600);

      i {
        font-size: var(--font-size-base);
      }
    }

    .form-conflict-link {
      display: inline-block;
      margin-top: var(--spacing-1);
      font-size: var(--font-size-sm);
      color: var(--color-primary-600);
      text-decoration: underline;
    }

    .form-hint {
      color: var(--color-neutral-500);
      font-size: var(--font-size-sm);
      margin-top: var(--spacing-1);
      display: block;
    }

    .tej-info-msg {
      margin-bottom: var(--spacing-4);
      width: 100%;
    }

    .form-actions {
      display: flex;
      justify-content: flex-end;
      gap: var(--spacing-4);
      margin-top: var(--spacing-8);
      padding-top: var(--spacing-6);
      border-top: 1px solid var(--color-border-subtle);
    }

    :host ::ng-deep {
      .p-inputmask,
      .p-select,
      .p-inputnumber {
        width: 100%;
      }
    }

    // Les champs natifs ne sont PAS couverts par le bloc ::ng-deep ci-dessus : ils
    // vivent dans ce template, pas dans un composant enfant. Sans cette règle ils
    // restent à leur largeur intrinsèque (~185 px) pendant que les p-select et
    // p-inputMask voisins occupent toute la colonne — les « class="w-full" » posées
    // sur eux ne portent rien (Tailwind est préfixé « tw- », cf. tailwind.config.js).
    .form-group > input[pInputText],
    .form-group > textarea[pTextarea] {
      width: 100%;
    }
  `]
})
export class SupplierFormComponent implements OnInit {
  readonly loc_ui_tern_modifier_le_fournisseur_2436d5 = $localize`:@@ui.tern.modifier.le.fournisseur.2436d5:Modifier le fournisseur`;
  readonly loc_ui_tern_nouveau_fournisseur_7e0ee2 = $localize`:@@ui.tern.nouveau.fournisseur.7e0ee2:Nouveau fournisseur`;
  readonly loc_ui_tern_mettre_a_jour_les_informations_du_fourniss_e2ba76 = $localize`:@@ui.tern.mettre.a.jour.les.informations.du.fourniss.e2ba76:Mettre à jour les informations du fournisseur.`;
  readonly loc_ui_tern_renseignez_les_informations_essentielles_d_2da734 = $localize`:@@ui.tern.renseignez.les.informations.essentielles.d.2da734:Renseignez les informations essentielles de ce fournisseur.`;
  readonly loc_ui_tern_enregistrer_f7c8bc = $localize`:@@ui.tern.enregistrer.f7c8bc:Enregistrer`;
  readonly loc_ui_tern_creer_le_fournisseur_13e0a7 = $localize`:@@ui.tern.creer.le.fournisseur.13e0a7:Créer le fournisseur`;
  private fb = inject(FormBuilder);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private supplierService = inject(SupplierService);
  private withholdingTaxService = inject(WithholdingTaxService);
  private toastService = inject(ToastService);
  private errorHandler = inject(ErrorHandlerService);
  private destroyRef = inject(DestroyRef);

  errorMessageService = inject(ErrorMessageService);
  readonly SupplierType = SupplierType;
  readonly SupplierRs7IsBracket = SupplierRs7IsBracket;
  readonly IdentificationType = IdentificationType;

  withholdingTypes: WithholdingTaxTypeDto[] = [];

  rs7BracketOptions = [
    { label: $localize`:@@suppliers.supplier-form.ts.non.defini.autre.code.rs.ou.catalogue.cf203fd0:Non défini (autre code RS ou catalogue)`, value: SupplierRs7IsBracket.Unspecified },
    { label: $localize`:@@suppliers.supplier-form.ts.rs7.is.25.retenue.1.5.fd7fd1c4:RS7 — IS 25 % (retenue 1,5 %)`, value: SupplierRs7IsBracket.Normal25 },
    { label: $localize`:@@suppliers.supplier-form.ts.rs7.is.15.retenue.1.94efe5d9:RS7 — IS 15 % (retenue 1 %)`, value: SupplierRs7IsBracket.Reduced15 },
    { label: $localize`:@@suppliers.supplier-form.ts.rs7.is.10.retenue.0.5.5a70b267:RS7 — IS 10 % (retenue 0,5 %)`, value: SupplierRs7IsBracket.Reduced10 }
  ];

  tejIdTypeOptions = [
    { label: '—', value: null },
    { label: $localize`:@@suppliers.supplier-form.ts.matricule.fiscal.304096c4:Matricule fiscal`, value: IdentificationType.MatriculeFiscal },
    { label: 'CIN', value: IdentificationType.CIN },
    { label: $localize`:@@suppliers.supplier-form.ts.passeport.0d7912ad:Passeport`, value: IdentificationType.Passport },
    { label: $localize`:@@suppliers.supplier-form.ts.carte.de.sejour.21cd02f7:Carte de séjour`, value: IdentificationType.CarteSejour },
    { label: $localize`:@@suppliers.supplier-form.ts.autre.identifiant.f4b025c7:Autre identifiant`, value: IdentificationType.Autre }
  ];

  loading = signal(false);
  saving = signal(false);
  supplierId: string | null = null;
  isEditMode = false;
  readonly conflictSupplierId = signal<string | null>(null);
  readonly conflictField = signal<SupplierConflictField | null>(null);

  breadcrumbItems: BreadcrumbItem[] = [];

  typeOptions = [
    { label: $localize`:@@suppliers.supplier-form.ts.particulier.281680dd:Particulier`, value: SupplierType.Individual },
    { label: $localize`:@@suppliers.supplier-form.ts.entreprise.d03e74b6:Entreprise`, value: SupplierType.Business }
  ];

  governorates: GovernorateOption[] = [
    { label: $localize`:@@suppliers.supplier-form.ts.ariana.4787a016:Ariana`, value: 'Ariana' },
    { label: $localize`:@@suppliers.supplier-form.ts.beja.603d1fac:Béja`, value: 'Béja' },
    { label: $localize`:@@suppliers.supplier-form.ts.ben.arous.3fab69ae:Ben Arous`, value: 'Ben Arous' },
    { label: $localize`:@@suppliers.supplier-form.ts.bizerte.2e83a969:Bizerte`, value: 'Bizerte' },
    { label: $localize`:@@suppliers.supplier-form.ts.gabes.e4b74f5d:Gabès`, value: 'Gabès' },
    { label: $localize`:@@suppliers.supplier-form.ts.gafsa.eae1e5d1:Gafsa`, value: 'Gafsa' },
    { label: $localize`:@@suppliers.supplier-form.ts.jendouba.c6f39067:Jendouba`, value: 'Jendouba' },
    { label: $localize`:@@suppliers.supplier-form.ts.kairouan.62201cff:Kairouan`, value: 'Kairouan' },
    { label: $localize`:@@suppliers.supplier-form.ts.kasserine.2ac4b4c3:Kasserine`, value: 'Kasserine' },
    { label: $localize`:@@suppliers.supplier-form.ts.kebili.5c50d601:Kébili`, value: 'Kébili' },
    { label: $localize`:@@suppliers.supplier-form.ts.le.kef.6dfe486f:Le Kef`, value: 'Le Kef' },
    { label: $localize`:@@suppliers.supplier-form.ts.mahdia.00f1b39b:Mahdia`, value: 'Mahdia' },
    { label: $localize`:@@suppliers.supplier-form.ts.la.manouba.25ff50d2:La Manouba`, value: 'La Manouba' },
    { label: $localize`:@@suppliers.supplier-form.ts.medenine.0e0d3c6a:Médenine`, value: 'Médenine' },
    { label: $localize`:@@suppliers.supplier-form.ts.monastir.aef3b69f:Monastir`, value: 'Monastir' },
    { label: $localize`:@@suppliers.supplier-form.ts.nabeul.43036f00:Nabeul`, value: 'Nabeul' },
    { label: $localize`:@@suppliers.supplier-form.ts.sfax.7f5b35de:Sfax`, value: 'Sfax' },
    { label: $localize`:@@suppliers.supplier-form.ts.sidi.bouzid.923cd336:Sidi Bouzid`, value: 'Sidi Bouzid' },
    { label: $localize`:@@suppliers.supplier-form.ts.siliana.279c3c64:Siliana`, value: 'Siliana' },
    { label: $localize`:@@suppliers.supplier-form.ts.sousse.e45910eb:Sousse`, value: 'Sousse' },
    { label: $localize`:@@suppliers.supplier-form.ts.tataouine.d3f11bd9:Tataouine`, value: 'Tataouine' },
    { label: $localize`:@@suppliers.supplier-form.ts.tozeur.0c755425:Tozeur`, value: 'Tozeur' },
    { label: $localize`:@@suppliers.supplier-form.ts.tunis.e58b2d54:Tunis`, value: 'Tunis' },
    { label: $localize`:@@suppliers.supplier-form.ts.zaghouan.65a3dc81:Zaghouan`, value: 'Zaghouan' }
  ];

  form: FormGroup = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(200)]],
    type: [SupplierType.Business, Validators.required],
    nif: [''],
    email: ['', [Validators.email]],
    phone: [''],
    contactPerson: [''],
    paymentTermDays: [30, [Validators.min(0), Validators.max(365)]],
    street: ['', Validators.required],
    streetLine2: [''],
    city: ['', Validators.required],
    postalCode: [''],
    governorate: ['', Validators.required],
    notes: [''],
    isSubjectToWithholding: [false],
    rs7IsBracket: [SupplierRs7IsBracket.Unspecified],
    defaultWithholdingTaxTypeId: [null as string | null],
    defaultWithholdingRate: [null as number | null],
    isResident: [true],
    countryCode: ['TN'],
    tejIdentificationType: [null as number | null],
    dateOfBirth: [''],
    activity: ['']
  });

  ngOnInit(): void {
    this.supplierId = this.route.snapshot.paramMap.get('id');
    this.isEditMode = !!this.supplierId;

    this.breadcrumbItems = [
      { label: $localize`:@@suppliers.supplier-form.ts.tableau.de.bord.a524057f:Tableau de bord`, route: '/dashboard', icon: 'pi-home' },
      { label: $localize`:@@suppliers.supplier-form.ts.fournisseurs.06b6d88c:Fournisseurs`, route: '/suppliers' },
      this.isEditMode ? { label: $localize`:@@suppliers.supplier-form.ts.modifier.f260e757:Modifier` } : { label: $localize`:@@suppliers.supplier-form.ts.nouveau.b9676c8f:Nouveau` }
    ];

    this.form.get('type')?.valueChanges.subscribe(() => this.updateNifValidators());
    this.updateNifValidators();

    this.form.get('isResident')?.valueChanges.subscribe(() => this.updateResidenceValidators());
    this.updateResidenceValidators();

    this.form.get('email')?.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.clearServerConflict('email'));
    this.form.get('nif')?.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.clearServerConflict('nif'));

    this.withholdingTaxService.getTypes(true).subscribe({
      next: (types) => {
        this.withholdingTypes = types ?? [];
      },
      error: () => {
        this.withholdingTypes = [];
      }
    });

    if (this.isEditMode && this.supplierId) {
      this.loadSupplier();
    }

    this.setupWithholdingMutualExclusion();
  }

  isRs7BracketSelected(): boolean {
    const bracket = normalizeSupplierRs7IsBracket(this.form.get('rs7IsBracket')?.value);
    return bracket !== SupplierRs7IsBracket.Unspecified;
  }

  isExplicitRsTypeSelected(): boolean {
    const typeId = this.form.get('defaultWithholdingTaxTypeId')?.value as string | null;
    if (!typeId) {
      return false;
    }

    const selected = this.withholdingTypes.find((t) => t.id === typeId);
    return !!selected && !selected.code?.toUpperCase().startsWith('RS7_');
  }

  private setupWithholdingMutualExclusion(): void {
    const rs7Control = this.form.get('rs7IsBracket');
    const whTypeControl = this.form.get('defaultWithholdingTaxTypeId');
    if (!rs7Control || !whTypeControl) {
      return;
    }

    rs7Control.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((value) => {
      const bracket = normalizeSupplierRs7IsBracket(value);
      if (bracket !== SupplierRs7IsBracket.Unspecified && whTypeControl.value) {
        whTypeControl.setValue(null, { emitEvent: false });
      }
    });

    whTypeControl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((typeId) => {
      if (!typeId) {
        return;
      }

      const selected = this.withholdingTypes.find((t) => t.id === typeId);
      const code = selected?.code ?? '';
      const syncedBracket = rs7BracketFromTypeCode(code);
      if (syncedBracket !== null) {
        rs7Control.setValue(syncedBracket, { emitEvent: false });
        return;
      }

      rs7Control.setValue(SupplierRs7IsBracket.Unspecified, { emitEvent: false });
    });
  }

  private updateNifValidators(): void {
    const nif = this.form.get('nif');
    const isBusiness = this.form.get('type')?.value === SupplierType.Business;
    if (isBusiness) {
      nif?.setValidators([Validators.required, nifAcceptsEitherSpelling]);
    } else {
      nif?.setValidators([]);
    }
    nif?.updateValueAndValidity({ emitEvent: false });
  }

  private updateResidenceValidators(): void {
    const cc = this.form.get('countryCode');
    const resident = this.form.get('isResident')?.value === true;
    if (!resident) {
      cc?.setValidators([Validators.required, Validators.maxLength(3), Validators.minLength(2)]);
    } else {
      cc?.setValidators([Validators.maxLength(3)]);
    }
    cc?.updateValueAndValidity({ emitEvent: false });
  }

  private tejPayload(val: Record<string, unknown>) {
    const bracket = normalizeSupplierRs7IsBracket(val['rs7IsBracket']);
    const explicitTypeId = (val['defaultWithholdingTaxTypeId'] as string) || undefined;
    const dob = (val['dateOfBirth'] as string)?.toString().trim();
    const rate = val['defaultWithholdingRate'] as number | null;

    const base = {
      tejIdentificationType: (val['tejIdentificationType'] as number | null) ?? null,
      dateOfBirth: dob ? new Date(dob).toISOString() : null,
      countryCode: ((val['countryCode'] as string) || 'TN').trim().toUpperCase() || 'TN',
      isResident: val['isResident'] === true,
      activity: ((val['activity'] as string) || '').trim() || undefined,
      isSubjectToWithholding: val['isSubjectToWithholding'] === true,
      defaultWithholdingRate: rate != null && !Number.isNaN(Number(rate)) ? Number(rate) : undefined
    };

    if (bracket !== SupplierRs7IsBracket.Unspecified) {
      return {
        ...base,
        defaultWithholdingTaxTypeId: undefined,
        rs7IsBracket: serializeSupplierRs7IsBracket(bracket)
      };
    }

    if (explicitTypeId) {
      return {
        ...base,
        defaultWithholdingTaxTypeId: explicitTypeId,
        rs7IsBracket: null
      };
    }

    return {
      ...base,
      defaultWithholdingTaxTypeId: undefined,
      rs7IsBracket: null
    };
  }

  normalizeNif(): void {
    const nifControl = this.form.get('nif');
    if (!nifControl) return;

    const value = nifControl.value as string;
    if (!value || typeof value !== 'string') return;

    const normalized = canonicalizeNif(value);

    // Ne mettre à jour le contrôle que si vide ou NIF complet valide (évite conflit avec p-inputMask)
    const isEmpty = normalized === '';
    const isValidComplete = normalized.length > 0 && NIF_PATTERN.test(normalized);
    if ((isEmpty || isValidComplete) && normalized !== value) {
      nifControl.setValue(normalized, { emitEvent: false });
      nifControl.updateValueAndValidity({ emitEvent: false });
    }
  }

  getNifErrorMessage(): string {
    const control = this.form.get('nif');
    if (!control?.errors) return '';
    if (control.errors['required']) {
      return $localize`:@@suppliers.supplier-form.ts.le.matricule.fiscal.est.obligatoire.pour.461e8771:Le matricule fiscal est obligatoire pour un fournisseur entreprise`;
    }
    if (control.errors['pattern']) {
      return 'Matricule fiscal invalide. Format attendu: 1772793W/A/M/000';
    }
    if (control.errors['server']) {
      const server = control.errors['server'];
      if (typeof server === 'string') {
        return server;
      }
      if (server && typeof server === 'object' && typeof server.message === 'string') {
        return server.message;
      }
    }
    return '';
  }

  isInvalid(field: string): boolean {
    const control = this.form.get(field);
    return !!(control?.invalid && control?.touched);
  }

  private loadSupplier(): void {
    if (!this.supplierId) return;

    this.loading.set(true);
    this.supplierService.getSupplier(this.supplierId).subscribe({
      next: (response) => {
        this.loading.set(false);
        if (response.success && response.data) {
          const s = response.data;
          this.form.patchValue({
            name: s.name,
            type: s.type,
            nif: s.nif || '',
            email: s.email ?? '',
            phone: s.phone || '',
            contactPerson: s.contactPerson || '',
            paymentTermDays: s.paymentTermDays,
            street: s.address.street,
            streetLine2: s.address.streetLine2 || '',
            city: s.address.city,
            postalCode: s.address.postalCode || '',
            governorate: s.address.governorate,
            notes: s.notes || '',
            isSubjectToWithholding: s.isSubjectToWithholding ?? false,
            rs7IsBracket: normalizeSupplierRs7IsBracket(s.rs7IsBracket),
            defaultWithholdingTaxTypeId: s.defaultWithholdingTaxTypeId ?? null,
            defaultWithholdingRate: s.defaultWithholdingRate ?? null,
            isResident: s.isResident !== false,
            countryCode: (s.countryCode || 'TN').toUpperCase(),
            tejIdentificationType: s.tejIdentificationType ?? null,
            dateOfBirth: s.dateOfBirth ? s.dateOfBirth.slice(0, 10) : '',
            activity: s.activity || ''
          });
          this.updateNifValidators();
          this.updateResidenceValidators();
        }
      },
      error: () => {
        this.loading.set(false);
        this.toastService.add({
          severity: 'error',
          summary: $localize`:@@supplier-form.component.summary.Erreur:Erreur`,
          detail: $localize`:@@supplier-form.component.detail.Impossible_de_ch:Impossible de charger le fournisseur`
        });
        this.router.navigate(['/suppliers']);
      }
    });
  }

  onSubmit(): void {
    if (this.form.invalid || this.saving()) return;

    this.form.markAllAsTouched();
    if (this.form.invalid) return;

    this.saving.set(true);
    const val = this.form.value;

    if (this.isEditMode && this.supplierId) {
      const request: UpdateSupplierRequest = {
        name: val.name,
        street: val.street,
        streetLine2: val.streetLine2 || undefined,
        city: val.city,
        postalCode: val.postalCode || undefined,
        governorate: val.governorate,
        email: val.email?.trim() || null,
        phone: val.phone || undefined,
        contactPerson: val.contactPerson || undefined,
        paymentTermDays: val.paymentTermDays,
        notes: val.notes || undefined,
        ...this.tejPayload(val as Record<string, unknown>)
      };

      this.supplierService.updateSupplier(this.supplierId, request).subscribe({
        next: (response) => {
          this.saving.set(false);
          if (response.success) {
            this.toastService.add({ severity: 'success', summary: $localize`:@@supplier-form.component.summary.Succès:Succès`, detail: $localize`:@@supplier-form.component.detail.Fournisseur_mis_:Fournisseur mis à jour` });
            this.router.navigate(['/suppliers', this.supplierId]);
          } else {
            this.toastService.add({ severity: 'error', summary: $localize`:@@supplier-form.component.summary.Erreur:Erreur`, detail: response.errors?.[0] || $localize`:@@suppliers.supplier-form.ts.erreur.ab546c23:Erreur` });
          }
        },
        error: (err) => {
          this.saving.set(false);
          this.applySaveError(err);
        }
      });
    } else {
      const cleanNif = val.nif ? canonicalizeNif(val.nif as string) : '';
      const request: CreateSupplierRequest = {
        name: val.name,
        type: val.type,
        nif: cleanNif || undefined,
        street: val.street,
        streetLine2: val.streetLine2 || undefined,
        city: val.city,
        postalCode: val.postalCode || undefined,
        governorate: val.governorate,
        email: val.email?.trim() || null,
        phone: val.phone || undefined,
        contactPerson: val.contactPerson || undefined,
        paymentTermDays: val.paymentTermDays ?? 30,
        notes: val.notes || undefined,
        ...this.tejPayload(val as Record<string, unknown>)
      };

      this.supplierService.createSupplier(request).subscribe({
        next: (response) => {
          this.saving.set(false);
          if (response.success) {
            this.toastService.add({ severity: 'success', summary: $localize`:@@supplier-form.component.summary.Succès:Succès`, detail: $localize`:@@supplier-form.component.detail.Fournisseur_cr_:Fournisseur créé avec succès` });
            this.router.navigate(['/suppliers']);
          } else {
            this.toastService.add({ severity: 'error', summary: $localize`:@@supplier-form.component.summary.Erreur:Erreur`, detail: response.errors?.[0] || $localize`:@@suppliers.supplier-form.ts.erreur.ab546c23:Erreur` });
          }
        },
        error: (err) => {
          this.saving.set(false);
          this.applySaveError(err);
        }
      });
    }
  }

  private applySaveError(err: { status?: number; error?: { data?: unknown } }): void {
    if (err?.status === 409) {
      this.applyDuplicateConflict(err);
      return;
    }
    const msg = this.errorHandler.extractErrorMessage(err);
    this.toastService.add({ severity: 'error', summary: $localize`:@@supplier-form.component.summary.Erreur:Erreur`, detail: msg });
  }

  private applyDuplicateConflict(err: { error?: { data?: unknown } }): void {
    const msg = this.errorHandler.extractErrorMessage(err);
    const conflict = parseSupplierCreateConflict(err, msg);
    const control = this.form.get(conflict.field);
    if (control) {
      control.setErrors({ ...(control.errors ?? {}), server: msg });
      control.markAsTouched();
    }
    this.conflictField.set(conflict.field);
    this.conflictSupplierId.set(conflict.existingSupplierId);
    this.toastService.add({
      severity: 'warn',
      summary: $localize`:@@supplier-form.component.summary.Fournisseur_exis:Fournisseur existant`,
      detail: msg,
      life: 6000
    });
    this.focusField(conflict.field);
  }

  private clearServerConflict(field: SupplierConflictField): void {
    const control = this.form.get(field);
    if (control?.errors?.['server']) {
      const rest = { ...control.errors };
      delete rest['server'];
      control.setErrors(Object.keys(rest).length ? rest : null);
    }
    if (this.conflictField() === field) {
      this.conflictField.set(null);
      this.conflictSupplierId.set(null);
    }
  }

  private focusField(field: string): void {
    queueMicrotask(() => {
      const el = document.getElementById(field);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.focus();
    });
  }
}
