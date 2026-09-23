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
      [title]="isEditMode ? 'Modifier le fournisseur' : 'Nouveau fournisseur'"
      [subtitle]="isEditMode ? 'Mettre à jour les informations du fournisseur.' : 'Renseignez les informations essentielles de ce fournisseur.'">
      <app-button
        variant="outline"
        icon="pi-times"
        iconPos="left"
        routerLink="/suppliers">
        Annuler
      </app-button>
    </app-page-header>

    @if (loading()) {
      <div class="loading-container">
        <i class="pi pi-spin pi-spinner" style="font-size: 2rem;"></i>
        <p>Chargement...</p>
      </div>
    } @else {
      <form [formGroup]="form" (ngSubmit)="onSubmit()">
        <div class="form-grid">
          <app-form-section title="Informations générales" icon="pi-user" [number]="1">
            <div class="form-group">
              <label for="name">Nom ou raison sociale <span class="required">*</span></label>
              <input
                pInputText
                id="name"
                formControlName="name"
                placeholder="Ex. Jean Dupont ou ABC SARL"
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
                <label for="type">Type <span class="required">*</span></label>
                <p-select
                  id="type"
                  [options]="typeOptions"
                  formControlName="type"
                  optionLabel="label"
                  optionValue="value"
                  placeholder="Sélectionner"
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
                <label for="nif">NIF / Matricule fiscal @if (form.get('type')?.value === SupplierType.Business) {<span class="required">*</span>}</label>
                <p-inputMask
                  id="nif"
                  formControlName="nif"
                  appNifMaskPaste
                  mask="9999999a/a/a/999"
                  placeholder="Ex. 1772793W/A/M/000"
                  styleClass="w-full"
                  [style]="{'text-transform': 'uppercase'}"
                  [class.ng-invalid]="isInvalid('nif')"
                  (onBlur)="normalizeNif()">
                </p-inputMask>
                @if (form.get('type')?.value === SupplierType.Business) {
                  <small class="form-hint">Format : 1772793W/A/M/000</small>
                }
                @if (isInvalid('nif')) {
                  <div class="form-error">
                    <i class="pi pi-exclamation-circle"></i>
                    <span>{{ getNifErrorMessage() }}</span>
                  </div>
                }
                @if (conflictSupplierId() && conflictField() === 'nif') {
                  <a class="form-conflict-link" [routerLink]="['/suppliers', conflictSupplierId()]">
                    Ouvrir le fournisseur existant
                  </a>
                }
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label for="paymentTermDays">Délai de paiement (jours)</label>
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

          <app-form-section title="Coordonnées" icon="pi-envelope" [number]="2">
            <div class="form-group">
              <label for="email">Adresse email</label>
              <input
                pInputText
                id="email"
                type="email"
                formControlName="email"
                placeholder="contact@exemple.tn"
                class="w-full"
                [class.ng-invalid]="isInvalid('email')">
              @if (isInvalid('email')) {
                <div class="form-error">
                  <i class="pi pi-exclamation-circle"></i>
                  <span>{{ errorMessageService.getErrorMessage(form.get('email')) }}</span>
                </div>
              }
              @if (conflictSupplierId() && conflictField() === 'email') {
                <a class="form-conflict-link" [routerLink]="['/suppliers', conflictSupplierId()]">
                  Ouvrir le fournisseur existant
                </a>
              }
            </div>

            <div class="form-group">
              <label for="phone">Téléphone</label>
              <p-inputMask
                id="phone"
                formControlName="phone"
                mask="99 999 999"
                placeholder="+216 XX XXX XXX"
                styleClass="w-full">
              </p-inputMask>
            </div>

            <div class="form-group">
              <label for="contactPerson">Personne de contact</label>
              <input
                pInputText
                id="contactPerson"
                formControlName="contactPerson"
                placeholder="Nom du responsable"
                class="w-full">
            </div>
          </app-form-section>

          <app-form-section title="Adresse" icon="pi-map-marker" [number]="3" class="address-card">
            <div class="form-group">
              <label for="street">Adresse <span class="required">*</span></label>
              <input
                pInputText
                id="street"
                formControlName="street"
                placeholder="Numéro et nom de rue"
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
              <label for="streetLine2">Complément d'adresse</label>
              <input
                pInputText
                id="streetLine2"
                formControlName="streetLine2"
                placeholder="Bâtiment, étage…"
                class="w-full">
            </div>

            <div class="form-row">
              <div class="form-group">
                <label for="city">Ville <span class="required">*</span></label>
                <input
                  pInputText
                  id="city"
                  formControlName="city"
                  placeholder="Tunis"
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
                <label for="postalCode">Code postal</label>
                <input
                  pInputText
                  id="postalCode"
                  formControlName="postalCode"
                  placeholder="1000"
                  class="w-full">
              </div>
            </div>

            <div class="form-group">
              <label for="governorate">Gouvernorat <span class="required">*</span></label>
              <p-select
                id="governorate"
                [options]="governorates"
                formControlName="governorate"
                placeholder="Sélectionner"
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

          <app-form-section title="Retenue à la source (TEJ)" icon="pi-percentage" [number]="4" class="tej-card">
            <div class="form-group checkbox-row">
              <label class="checkbox-label">
                <input type="checkbox" formControlName="isSubjectToWithholding" />
                Fournisseur concerné par la retenue à la source sur les achats
              </label>
            </div>
            @if (form.get('isSubjectToWithholding')?.value) {
              <p-message
                severity="info"
                styleClass="tej-info-msg"
                text="Choisissez soit la Tranche IS (RS7 achats), soit un Type RS explicite du catalogue — pas les deux.">
              </p-message>
            }
            <div class="form-row">
              <div class="form-group">
                <label for="rs7">Tranche IS (achats RS7)</label>
                <p-select
                  id="rs7"
                  formControlName="rs7IsBracket"
                  [options]="rs7BracketOptions"
                  optionLabel="label"
                  optionValue="value"
                  placeholder="Sélectionner"
                  [disabled]="isExplicitRsTypeSelected()"
                  styleClass="w-full">
                </p-select>
                <small class="form-hint">Renseigne le code TEJ RS7 (1,5 % / 1 % / 0,5 %) selon le taux d’IS du fournisseur. Laisser « non défini » si vous choisissez un type RS précis ci-contre.</small>
              </div>
              <div class="form-group">
                <label for="whType">Type RS explicite (optionnel)</label>
                <p-select
                  id="whType"
                  formControlName="defaultWithholdingTaxTypeId"
                  [options]="withholdingTypes"
                  optionLabel="label"
                  optionValue="id"
                  [showClear]="true"
                  placeholder="Automatique (tranche ou défaut)"
                  [filter]="true"
                  filterBy="label,code"
                  [disabled]="isRs7BracketSelected()"
                  styleClass="w-full">
                </p-select>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label for="whRate">Taux RS par défaut (optionnel, %)</label>
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
                  <input type="checkbox" formControlName="isResident" />
                  Résident fiscal tunisien
                </label>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label for="cc">Code pays (ISO, ex. TN)</label>
                <input pInputText id="cc" formControlName="countryCode" maxlength="3" class="w-full" style="text-transform: uppercase" />
                @if (isInvalid('countryCode')) {
                  <div class="form-error">
                    <i class="pi pi-exclamation-circle"></i>
                    <span>Obligatoire pour un non-résident</span>
                  </div>
                }
              </div>
              <div class="form-group">
                <label for="tejId">Identifiant TEJ (type)</label>
                <p-select
                  id="tejId"
                  formControlName="tejIdentificationType"
                  [options]="tejIdTypeOptions"
                  optionLabel="label"
                  optionValue="value"
                  placeholder="—"
                  styleClass="w-full">
                </p-select>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label for="dob">Date de naissance (CIN / passeport)</label>
                <input pInputText id="dob" type="date" formControlName="dateOfBirth" class="w-full" />
              </div>
              <div class="form-group">
                <label for="act">Activité (TEJ)</label>
                <input pInputText id="act" formControlName="activity" maxlength="200" class="w-full" placeholder="Secteur / libellé court" />
              </div>
            </div>
          </app-form-section>

          <app-form-section title="Notes" icon="pi-file-edit" [number]="5" class="notes-card">
            <div class="form-group">
              <label for="notes">Notes internes</label>
              <textarea
                pTextarea
                id="notes"
                formControlName="notes"
                placeholder="Préférences, instructions particulières…"
                [rows]="4"
                class="w-full">
              </textarea>
              <small class="form-hint">Non visibles par le fournisseur.</small>
            </div>
          </app-form-section>
        </div>

        <div class="form-actions">
          <app-button
            variant="outline"
            icon="pi-times"
            iconPos="left"
            routerLink="/suppliers">
            Annuler
          </app-button>
          <app-button
            variant="primary"
            type="submit"
            [icon]="saving() ? 'pi-spin pi-spinner' : 'pi-check'"
            iconPos="left"
            [disabled]="form.invalid || saving()">
            {{ isEditMode ? 'Enregistrer' : 'Créer le fournisseur' }}
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
    { label: 'Non défini (autre code RS ou catalogue)', value: SupplierRs7IsBracket.Unspecified },
    { label: 'RS7 — IS 25 % (retenue 1,5 %)', value: SupplierRs7IsBracket.Normal25 },
    { label: 'RS7 — IS 15 % (retenue 1 %)', value: SupplierRs7IsBracket.Reduced15 },
    { label: 'RS7 — IS 10 % (retenue 0,5 %)', value: SupplierRs7IsBracket.Reduced10 }
  ];

  tejIdTypeOptions = [
    { label: '—', value: null },
    { label: 'Matricule fiscal', value: IdentificationType.MatriculeFiscal },
    { label: 'CIN', value: IdentificationType.CIN },
    { label: 'Passeport', value: IdentificationType.Passport },
    { label: 'Carte de séjour', value: IdentificationType.CarteSejour },
    { label: 'Autre identifiant', value: IdentificationType.Autre }
  ];

  loading = signal(false);
  saving = signal(false);
  supplierId: string | null = null;
  isEditMode = false;
  readonly conflictSupplierId = signal<string | null>(null);
  readonly conflictField = signal<SupplierConflictField | null>(null);

  breadcrumbItems: BreadcrumbItem[] = [];

  typeOptions = [
    { label: 'Particulier', value: SupplierType.Individual },
    { label: 'Entreprise', value: SupplierType.Business }
  ];

  governorates: GovernorateOption[] = [
    { label: 'Ariana', value: 'Ariana' },
    { label: 'Béja', value: 'Béja' },
    { label: 'Ben Arous', value: 'Ben Arous' },
    { label: 'Bizerte', value: 'Bizerte' },
    { label: 'Gabès', value: 'Gabès' },
    { label: 'Gafsa', value: 'Gafsa' },
    { label: 'Jendouba', value: 'Jendouba' },
    { label: 'Kairouan', value: 'Kairouan' },
    { label: 'Kasserine', value: 'Kasserine' },
    { label: 'Kébili', value: 'Kébili' },
    { label: 'Le Kef', value: 'Le Kef' },
    { label: 'Mahdia', value: 'Mahdia' },
    { label: 'La Manouba', value: 'La Manouba' },
    { label: 'Médenine', value: 'Médenine' },
    { label: 'Monastir', value: 'Monastir' },
    { label: 'Nabeul', value: 'Nabeul' },
    { label: 'Sfax', value: 'Sfax' },
    { label: 'Sidi Bouzid', value: 'Sidi Bouzid' },
    { label: 'Siliana', value: 'Siliana' },
    { label: 'Sousse', value: 'Sousse' },
    { label: 'Tataouine', value: 'Tataouine' },
    { label: 'Tozeur', value: 'Tozeur' },
    { label: 'Tunis', value: 'Tunis' },
    { label: 'Zaghouan', value: 'Zaghouan' }
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
      { label: 'Tableau de bord', route: '/dashboard', icon: 'pi-home' },
      { label: 'Fournisseurs', route: '/suppliers' },
      this.isEditMode ? { label: 'Modifier' } : { label: 'Nouveau' }
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
      return 'Le matricule fiscal est obligatoire pour un fournisseur entreprise';
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
          summary: 'Erreur',
          detail: 'Impossible de charger le fournisseur'
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
            this.toastService.add({ severity: 'success', summary: 'Succès', detail: 'Fournisseur mis à jour' });
            this.router.navigate(['/suppliers', this.supplierId]);
          } else {
            this.toastService.add({ severity: 'error', summary: 'Erreur', detail: response.errors?.[0] || 'Erreur' });
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
            this.toastService.add({ severity: 'success', summary: 'Succès', detail: 'Fournisseur créé avec succès' });
            this.router.navigate(['/suppliers']);
          } else {
            this.toastService.add({ severity: 'error', summary: 'Erreur', detail: response.errors?.[0] || 'Erreur' });
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
    this.toastService.add({ severity: 'error', summary: 'Erreur', detail: msg });
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
      summary: 'Fournisseur existant',
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
