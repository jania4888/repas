import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterModule, ActivatedRoute } from '@angular/router';
import { InputTextModule } from 'primeng/inputtext';
import { InputMaskModule } from 'primeng/inputmask';
import { InputNumberModule } from 'primeng/inputnumber';
import { Textarea } from 'primeng/textarea';
import { SelectModule } from 'primeng/select';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { DividerModule } from 'primeng/divider';
import { InputSwitchModule } from 'primeng/inputswitch';
import { ToastModule } from 'primeng/toast';
import { ToastService } from '@core/services/toast.service';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { FormSectionComponent } from '@shared/components/form-section/form-section.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { ErrorMessageService } from '@core/services/error-message.service';
import { canonicalizeNif, NIF_PATTERN } from '@shared/validation';
import { nifAcceptsEitherSpelling } from '@shared/validation/tunisian-validators';
import { NifMaskPasteDirective } from '@shared/validation/nif-mask-paste.directive';
import { ClientService, Client, ClientType, CreateClientRequest, UpdateClientRequest } from '@core/services/client.service';

interface TypeOption {
  label: string;
  value: ClientType;
}

interface GovernorateOption {
  label: string;
  value: string;
}

@Component({
  selector: 'app-client-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterModule,
    InputTextModule,
    InputMaskModule,
    NifMaskPasteDirective,
    InputNumberModule,
    Textarea,
    SelectModule,
    ButtonModule,
    CardModule,
    DividerModule,
    InputSwitchModule,
    ToastModule,
    PageHeaderComponent,
    BreadcrumbComponent,
    FormSectionComponent,
    ButtonComponent
  ],
  template: `
    <app-breadcrumb [items]="breadcrumbItems()"></app-breadcrumb>
    
    <app-page-header 
      [title]="isEditMode() ? 'Modifier le client' : 'Nouveau client'" 
      [subtitle]="isEditMode() ? 'Mettez à jour les informations du client.' : 'Renseignez les informations essentielles pour facturer ce client.'">
      <app-button 
        variant="outline"
        icon="pi-times"
        iconPos="left"
        routerLink="/clients" i18n="@@clients.client-form.annuler.49ba3292">Annuler</app-button>
    </app-page-header>

    @if (loading()) {
      <div class="loading-container">
        <i class="pi pi-spin pi-spinner" style="font-size: 2rem;"></i>
        <p i18n="@@clients.client-form.chargement.a209b664">Chargement...</p>
      </div>
    } @else {
      <form [formGroup]="form" (ngSubmit)="onSubmit()">
        <div class="form-grid">
          <!-- General Information -->
          <app-form-section title="Informations générales" i18n-title="Informations générales" icon="pi-user" [number]="1">
            <div class="form-group">
              <label for="name">Nom ou raison sociale <span class="required" i18n="@@clients.client-form.text.df58248c">*</span></label>
              <input 
                pInputText 
                id="name" 
                formControlName="name"
                placeholder="Ex. Jean Dupont ou ABC SARL" i18n-placeholder="Ex. Jean Dupont ou ABC SARL"
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
                <label for="type">Type de client <span class="required" i18n="@@clients.client-form.text.df58248c">*</span></label>
                <p-select 
                  id="type"
                  [options]="typeOptions" 
                  formControlName="type"
                  optionLabel="label"
                  optionValue="value"
                  placeholder="Sélectionner" i18n-placeholder="Sélectionner"
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
                <label for="nif">NIF / Matricule fiscal @if (form.get('type')?.value === ClientType.Business) {<span class="required" i18n="@@clients.client-form.text.df58248c">*</span>}</label>
                <p-inputMask
                  id="nif"
                  formControlName="nif"
                  appNifMaskPaste
                  mask="9999999a/a/a/999"
                  placeholder="Ex. 1772793W/A/M/000" i18n-placeholder="Ex. 1772793W/A/M/000"
                  styleClass="w-full"
                  [style]="{'text-transform': 'uppercase'}"
                  [class.ng-invalid]="isInvalid('nif')"
                  (onBlur)="normalizeNif()">
                </p-inputMask>
                @if (form.get('type')?.value === ClientType.Business) {
                  <small class="form-hint" i18n="@@clients.client-form.format.1772793w.a.m.000.953218ad">Format : 1772793W/A/M/000</small>
                }
                @if (isInvalid('nif')) {
                  <div class="form-error">
                    <i class="pi pi-exclamation-circle"></i>
                    <span>{{ getNifErrorMessage() }}</span>
                  </div>
                }
              </div>
            </div>

            @if (isEditMode()) {
              <div class="form-group">
                <label for="isActive" i18n="@@clients.client-form.statut.659499f3">Statut</label>
                <div class="status-switch">
                  <p-inputSwitch 
                    id="isActive"
                    formControlName="isActive">
                  </p-inputSwitch>
                  <span [class.active]="form.get('isActive')?.value">
                    {{ form.get('isActive')?.value ? 'Actif' : 'Inactif' }}
                  </span>
                </div>
              </div>
            }
          </app-form-section>

          <!-- Contact Information -->
          <app-form-section title="Coordonnées" i18n-title="Coordonnées" icon="pi-envelope" [number]="2">
            <div class="form-group">
              <label for="email" i18n="@@clients.client-form.adresse.email.bdf1cc95">Adresse email</label>
              <input 
                pInputText 
                id="email" 
                type="email"
                formControlName="email"
                placeholder="contact@exemple.tn" i18n-placeholder="contact@exemple.tn"
                class="w-full"
                [class.ng-invalid]="isInvalid('email')">
              @if (isInvalid('email')) {
                <div class="form-error">
                  <i class="pi pi-exclamation-circle"></i>
                  <span>{{ errorMessageService.getErrorMessage(form.get('email')) }}</span>
                </div>
              }
            </div>

            <div class="form-group">
              <label for="phone" i18n="@@clients.client-form.telephone.d3b023ea">Téléphone</label>
              <p-inputMask 
                id="phone" 
                formControlName="phone"
                mask="99 999 999"
                placeholder="+216 XX XXX XXX" i18n-placeholder="+216 XX XXX XXX"
                styleClass="w-full">
              </p-inputMask>
            </div>

            <div class="form-group">
              <label for="contactPerson" i18n="@@clients.client-form.personne.de.contact.148fdd96">Personne de contact</label>
              <input 
                pInputText 
                id="contactPerson" 
                formControlName="contactPerson"
                placeholder="Nom du responsable" i18n-placeholder="Nom du responsable"
                class="w-full">
            </div>
          </app-form-section>

          <!-- Address -->
          <app-form-section title="Adresse" i18n-title="Adresse" icon="pi-map-marker" [number]="3" class="address-card">
            <div class="form-group">
              <label for="street">Adresse <span class="required" i18n="@@clients.client-form.text.df58248c">*</span></label>
              <input 
                pInputText 
                id="street" 
                formControlName="street"
                placeholder="Numéro et nom de rue" i18n-placeholder="Numéro et nom de rue"
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
              <label for="streetLine2" i18n="@@clients.client-form.complement.d.adresse.fba484a7">Complément d'adresse</label>
              <input 
                pInputText 
                id="streetLine2" 
                formControlName="streetLine2"
                placeholder="Bâtiment, étage…" i18n-placeholder="Bâtiment, étage…"
                class="w-full">
            </div>

            <div class="form-row">
              <div class="form-group">
                <label for="city">Ville <span class="required" i18n="@@clients.client-form.text.df58248c">*</span></label>
                <input 
                  pInputText 
                  id="city" 
                  formControlName="city"
                  placeholder="Tunis" i18n-placeholder="Tunis"
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
                <label for="postalCode" i18n="@@clients.client-form.code.postal.74779109">Code postal</label>
                <p-inputMask 
                  id="postalCode" 
                  formControlName="postalCode"
                  mask="9999"
                  placeholder="1000" i18n-placeholder="1000"
                  styleClass="w-full">
                </p-inputMask>
              </div>
            </div>

            <div class="form-group">
              <label for="governorate">Gouvernorat <span class="required" i18n="@@clients.client-form.text.df58248c">*</span></label>
              <p-select 
                id="governorate"
                [options]="governorates" 
                formControlName="governorate"
                placeholder="Sélectionner" i18n-placeholder="Sélectionner"
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

          <!-- Notes -->
          <app-form-section title="Notes" i18n-title="Notes" icon="pi-file-edit" [number]="4" class="notes-card">
            <div class="form-group">
              <label for="notes" i18n="@@clients.client-form.notes.internes.1a81fb4e">Notes internes</label>
              <textarea 
                pTextarea 
                id="notes" 
                formControlName="notes"
                placeholder="Préférences, instructions particulières…" i18n-placeholder="Préférences, instructions particulières…"
                [rows]="4"
                class="w-full">
              </textarea>
              <small class="form-hint" i18n="@@clients.client-form.non.visibles.par.le.client.f5513dc9">Non visibles par le client.</small>
            </div>
          </app-form-section>

          <!-- Conditions financières -->
          <app-form-section title="Conditions financières" i18n-title="Conditions financières" icon="pi-wallet" [number]="5" class="finance-card">
            <div class="form-row">
              <div class="form-group">
                <label for="creditLimit" i18n="@@clients.client-form.plafond.d.encours.tnd.9a9150cb">Plafond d'encours (TND)</label>
                <p-inputNumber
                  inputId="creditLimit"
                  formControlName="creditLimit"
                  mode="decimal"
                  [min]="0"
                  [minFractionDigits]="3"
                  [maxFractionDigits]="3"
                  [useGrouping]="true"
                  locale="fr-TN"
                  placeholder="Aucun plafond" i18n-placeholder="Aucun plafond"
                  styleClass="w-full">
                </p-inputNumber>
                <small class="form-hint" i18n="@@clients.client-form.laisser.vide.pour.aucun.plafond.le.depassement.a.3de2a34c">Laisser vide pour aucun plafond. Le dépassement avertit sans bloquer les ventes.</small>
                @if (isInvalid('creditLimit')) {
                  <div class="form-error">
                    <i class="pi pi-exclamation-circle"></i>
                    <span>{{ errorMessageService.getErrorMessage(form.get('creditLimit')) }}</span>
                  </div>
                }
              </div>

              <div class="form-group">
                <label for="defaultPaymentTermDays" i18n="@@clients.client-form.delai.de.reglement.jours.a445720b">Délai de règlement (jours)</label>
                <p-inputNumber
                  inputId="defaultPaymentTermDays"
                  formControlName="defaultPaymentTermDays"
                  [min]="0"
                  [max]="365"
                  [useGrouping]="false"
                  placeholder="Ex. 30" i18n-placeholder="Ex. 30"
                  styleClass="w-full">
                </p-inputNumber>
                <small class="form-hint" i18n="@@clients.client-form.propose.a.la.saisie.des.factures.et.commandes.3b2e61c6">Proposé à la saisie des factures et commandes.</small>
                @if (isInvalid('defaultPaymentTermDays')) {
                  <div class="form-error">
                    <i class="pi pi-exclamation-circle"></i>
                    <span>{{ errorMessageService.getErrorMessage(form.get('defaultPaymentTermDays')) }}</span>
                  </div>
                }
              </div>
            </div>
          </app-form-section>
        </div>

        <!-- Actions -->
        <div class="form-actions">
          <app-button 
            variant="outline"
            icon="pi-times"
            iconPos="left"
            routerLink="/clients" i18n="@@clients.client-form.annuler.49ba3292">Annuler</app-button>
          <app-button 
            variant="primary"
            type="submit"
            [icon]="saving() ? 'pi-spin pi-spinner' : 'pi-check'"
            iconPos="left"
            [disabled]="form.invalid || saving()">
            {{ isEditMode() ? 'Enregistrer' : 'Créer le client' }}
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

    .notes-card {
      grid-column: 2;

      @media (max-width: 1024px) {
        grid-column: 1;
      }
    }

    .finance-card {
      grid-column: 1 / -1;
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

      .form-hint {
        display: block;
        margin-top: var(--spacing-1);
        color: var(--color-neutral-600);
        font-size: var(--font-size-xs);
      }
    }

    .form-hint {
      color: var(--color-neutral-500);
      font-size: var(--font-size-sm);
      margin-top: var(--spacing-1);
      display: block;
    }

    .status-switch {
      display: flex;
      align-items: center;
      gap: var(--spacing-3);

      span {
        color: var(--color-neutral-600);

        &.active {
          color: var(--color-success-600);
          font-weight: var(--font-weight-medium);
        }
      }
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
      .p-inputnumber,
      .p-inputnumber-input {
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
export class ClientFormComponent implements OnInit {
  private fb = inject(FormBuilder);
  private clientService = inject(ClientService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private toastService = inject(ToastService);
  errorMessageService = inject(ErrorMessageService);

  loading = signal(false);
  saving = signal(false);
  clientId = signal<string | null>(null);
  
  isEditMode = computed(() => !!this.clientId());

  readonly ClientType = ClientType;

  breadcrumbItems = computed<BreadcrumbItem[]>(() => {
    const base: BreadcrumbItem[] = [
      { label: 'Tableau de bord', route: '/dashboard', icon: 'pi-home' },
      { label: 'Clients', route: '/clients' }
    ];
    if (this.isEditMode()) {
      base.push({ label: 'Modifier' });
    } else {
      base.push({ label: 'Nouveau client' });
    }
    return base;
  });

  typeOptions: TypeOption[] = [
    { label: 'Particulier', value: ClientType.Individual },
    { label: 'Entreprise', value: ClientType.Business }
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
    name: ['', [Validators.required, Validators.minLength(2)]],
    type: [ClientType.Business, Validators.required],
    nif: [''],
    email: ['', [Validators.email]],
    phone: [''],
    contactPerson: [''],
    street: ['', Validators.required],
    streetLine2: [''],
    city: ['', Validators.required],
    postalCode: [''],
    governorate: ['', Validators.required],
    notes: [''],
    isActive: [true],
    creditLimit: [null as number | null, [Validators.min(0)]],
    defaultPaymentTermDays: [null as number | null, [Validators.min(0), Validators.max(365)]]
  });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.clientId.set(id);
      this.loadClient(id);
    }
    this.form.get('type')?.valueChanges.subscribe(() => this.updateNifValidators());
    this.updateNifValidators();
  }

  private updateNifValidators(): void {
    const nif = this.form.get('nif');
    const isCompany = this.form.get('type')?.value === ClientType.Business;
    if (isCompany) {
      nif?.setValidators([Validators.required, nifAcceptsEitherSpelling]);
    } else {
      nif?.setValidators([]);
    }
    nif?.updateValueAndValidity({ emitEvent: false });
  }

  /**
   * Normalise le NIF au blur (aligné sur formulaire fournisseur).
   * Nettoye les placeholders du masque (_), espaces, et force le format avec slashes.
   */
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

  isInvalid(field: string): boolean {
    const control = this.form.get(field);
    return !!(control?.invalid && control?.touched);
  }

  /**
   * Message d'erreur NIF aligné sur step-client (wizard facture).
   */
  getNifErrorMessage(): string {
    const control = this.form.get('nif');
    if (!control?.errors) return '';
    if (control.errors['required']) {
      return 'Le matricule fiscal est obligatoire pour un client assujetti';
    }
    if (control.errors['pattern']) {
      return 'Matricule fiscal invalide. Format attendu: 1772793W/A/M/000';
    }
    return '';
  }

  private loadClient(id: string): void {
    this.loading.set(true);
    
    this.clientService.getClient(id).subscribe({
      next: (response) => {
        if (response.success) {
          this.populateForm(response.data);
        } else {
          this.toastService.add({
            severity: 'error',
            summary: 'Erreur',
            detail: 'Client non trouvé'
          });
          this.router.navigate(['/clients']);
        }
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.toastService.add({
          severity: 'error',
          summary: 'Erreur',
          detail: 'Impossible de charger le client'
        });
        this.router.navigate(['/clients']);
      }
    });
  }

  private populateForm(client: Client): void {
    this.form.patchValue({
      name: client.name,
      type: client.type,
      nif: client.nif ?? '',
      email: client.email ?? '',
      phone: client.phone ?? '',
      contactPerson: client.contactPerson ?? '',
      street: client.address.street,
      streetLine2: client.address.streetLine2 ?? '',
      city: client.address.city,
      postalCode: client.address.postalCode ?? '',
      governorate: client.address.governorate,
      notes: client.notes ?? '',
      isActive: client.isActive,
      creditLimit: client.creditLimit ?? null,
      defaultPaymentTermDays: client.defaultPaymentTermDays ?? null
    });
    this.updateNifValidators();
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.saving.set(true);

    const formValue = this.form.value;

    if (this.isEditMode()) {
      const cleanNif = formValue.nif ? canonicalizeNif(formValue.nif as string) : '';

      const request: UpdateClientRequest = {
        name: formValue.name.trim(),
        email: formValue.email?.trim() || null,
        phone: (formValue.phone as string)?.trim() || undefined,
        nif: cleanNif || undefined,
        type: formValue.type,
        street: formValue.street.trim(),
        streetLine2: (formValue.streetLine2 as string)?.trim() || undefined,
        city: formValue.city.trim(),
        postalCode: (formValue.postalCode as string)?.trim() || undefined,
        governorate: formValue.governorate,
        contactPerson: (formValue.contactPerson as string)?.trim() || undefined,
        notes: (formValue.notes as string)?.trim() || undefined,
        isActive: formValue.isActive,
        creditLimit: formValue.creditLimit ?? null,
        defaultPaymentTermDays: formValue.defaultPaymentTermDays ?? null
      };

      this.clientService.updateClient(this.clientId()!, request).subscribe({
        next: (response) => {
          if (response.success) {
            this.toastService.add({
              severity: 'success',
              summary: 'Succès',
              detail: 'Client mis à jour avec succès'
            });
            this.router.navigate(['/clients', this.clientId()]);
          } else {
            this.toastService.add({
              severity: 'error',
              summary: 'Erreur',
              detail: response.errors[0] || 'Impossible de mettre à jour le client'
            });
          }
          this.saving.set(false);
        },
        error: (err) => {
          this.saving.set(false);
          this.toastService.add({
            severity: 'error',
            summary: 'Erreur',
            detail: err.error?.errors?.[0] || 'Impossible de mettre à jour le client'
          });
        }
      });
    } else {
      const cleanNif = formValue.nif ? canonicalizeNif(formValue.nif as string) : '';

      const request: CreateClientRequest = {
        name: formValue.name.trim(),
        email: formValue.email?.trim() || null,
        phone: (formValue.phone as string)?.trim() || undefined,
        nif: cleanNif || undefined,
        type: formValue.type,
        street: formValue.street.trim(),
        streetLine2: (formValue.streetLine2 as string)?.trim() || undefined,
        city: formValue.city.trim(),
        postalCode: (formValue.postalCode as string)?.trim() || undefined,
        governorate: formValue.governorate,
        contactPerson: (formValue.contactPerson as string)?.trim() || undefined,
        notes: (formValue.notes as string)?.trim() || undefined,
        creditLimit: formValue.creditLimit ?? null,
        defaultPaymentTermDays: formValue.defaultPaymentTermDays ?? null
      };

      this.clientService.createClient(request).subscribe({
        next: (response) => {
          if (response.success && response.data) {
            this.toastService.add({
              severity: 'success',
              summary: 'Succès',
              detail: 'Client créé. Vous pouvez maintenant créer un devis ou une facture.'
            });
            // response.data est un Guid (string), pas un objet Client
            this.router.navigate(['/clients', response.data]);
          } else {
            this.toastService.add({
              severity: 'error',
              summary: 'Erreur',
              detail: response.errors[0] || 'Impossible de créer le client'
            });
          }
          this.saving.set(false);
        },
        error: (err) => {
          this.saving.set(false);
          
          // Extraire les erreurs de validation détaillées
          let errorMessage = 'Impossible de créer le client';
          
          if (err.error?.errors && Array.isArray(err.error.errors) && err.error.errors.length > 0) {
            errorMessage = err.error.errors[0];
          } else if (err.error?.message) {
            errorMessage = err.error.message;
          } else if (err.status === 400) {
            errorMessage = 'Les données fournies sont invalides. Veuillez vérifier les champs obligatoires et le format du matricule fiscal (NIF).';
          } else if (err.status === 409) {
            errorMessage = 'Un client existe déjà avec cet email ou ce matricule fiscal.';
          } else if (err.status === 0) {
            errorMessage = 'Impossible de contacter le serveur. Vérifiez votre connexion.';
          }
          
          this.toastService.add({
            severity: 'error',
            summary: 'Erreur',
            detail: errorMessage
          });
        }
      });
    }
  }
}
