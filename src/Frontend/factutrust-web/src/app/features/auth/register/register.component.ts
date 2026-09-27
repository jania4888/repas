import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators, FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { trigger, transition, style, animate } from '@angular/animations';
import { HttpErrorResponse } from '@angular/common/http';
import { timeout, TimeoutError, catchError, throwError } from 'rxjs';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { InputMaskModule } from 'primeng/inputmask';
import { StepsModule } from 'primeng/steps';
import { MessageModule } from 'primeng/message';
import { DividerModule } from 'primeng/divider';
import { CheckboxModule } from 'primeng/checkbox';
import { InputSwitchModule } from 'primeng/inputswitch';
import { MenuItem } from '@shared/models/menu-item.model';
import { AuthService, RegisterRequest } from '@core/services/auth.service';
import { WarehouseContextService } from '@core/services/warehouse-context.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { ErrorMessageService } from '@core/services/error-message.service';
import { AuthShellComponent } from '../auth-shell/auth-shell.component';
import { NifMaskPasteDirective } from '@shared/validation/nif-mask-paste.directive';
import { REGISTER_AUTH_SHELL_CONFIG } from '../auth-shell/auth-shell.config';
import { environment } from '@environments/environment';
import { GOVERNORATE_OPTIONS } from '../shared/auth-governorate.options';
import {
  AUTH_PASSWORD_VALIDATORS_PATTERN,
  passwordCriteria as computePasswordCriteria,
  passwordMatches as checkPasswordMatches,
  passwordMismatch as checkPasswordMismatch,
  passwordStrengthLabel as getPasswordStrengthLabel,
  passwordStrengthLevel as computePasswordStrengthLevel,
  passwordStrengthMetCount
} from '../shared/auth-password.helpers';
import {
  applyNifBlurCleanup,
  cleanNifValue,
  cleanPhoneValue,
  dropdownStringValue,
  markAllFormControlsTouched,
  scrollAuthWizardStepIntoView,
  scrollToFirstInvalidField,
  trimOptional,
  trimRequired,
  validateCompanyRegisterFormData
} from '../shared/auth-registration.helpers';

interface TaxRegime {
  label: string;
  value: number;
}

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    RouterModule,
    InputTextModule,
    PasswordModule,
    ButtonModule,
    SelectModule,
    InputMaskModule,
    NifMaskPasteDirective,
    StepsModule,
    MessageModule,
    DividerModule,
    CheckboxModule,
    InputSwitchModule,
    AuthShellComponent
  ],
  animations: [
    trigger('fadeInOut', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(10px)' }),
        animate('300ms ease-out', style({ opacity: 1, transform: 'translateY(0)' }))
      ]),
      transition(':leave', [
        animate('200ms ease-in', style({ opacity: 0, transform: 'translateY(-10px)' }))
      ])
    ]),
    trigger('stepSlide', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateX(16px)' }),
        animate('320ms cubic-bezier(0.16, 1, 0.3, 1)', style({ opacity: 1, transform: 'translateX(0)' }))
      ]),
      transition(':leave', [
        animate('220ms ease-in', style({ opacity: 0, transform: 'translateX(-12px)' }))
      ])
    ])
  ],
  templateUrl: './register.component.html',
  styleUrl: './register.component.scss'
})
export class RegisterComponent implements OnInit, OnDestroy {
  readonly environment = environment;
  readonly shellConfig = REGISTER_AUTH_SHELL_CONFIG;

  private static readonly REGISTRATION_TIMEOUT_MS = 120_000;

  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private warehouseContext = inject(WarehouseContextService);
  private router = inject(Router);
  private errorHandler = inject(ErrorHandlerService);
  errorMessageService = inject(ErrorMessageService);

  loading = signal(false);
  loadingMessage = signal('Création de votre espace...');
  error = signal<string | null>(null);
  currentStep = signal(0);

  private loadingMessageTimer: ReturnType<typeof setInterval> | null = null;
  private loadingStartedAt = 0;

  /** Libellé ARIA pour le formulaire multi-étapes (progression + contexte). */
  registrationFormAriaLabel = computed(() => {
    const stepNames = ['Compte', 'Entreprise', 'Adresse'];
    const cur = this.currentStep();
    const prev = cur > 0 ? $localize`:@@ui.tern.etapes.precedentes.completees.b92c63:Étapes précédentes complétées. ` : '';
    return `${prev}Étape ${cur + 1} sur 3 : ${stepNames[cur]}.`;
  });

  steps: MenuItem[] = [
    { label: $localize`:@@auth.register.ts.compte.c45740bb:Compte` },
    { label: $localize`:@@auth.register.ts.entreprise.d03e74b6:Entreprise` },
    { label: $localize`:@@auth.register.ts.adresse.522e1466:Adresse` }
  ];

  /** Segments de la barre de force (5 critères). */
  readonly strengthSegments: readonly number[] = [1, 2, 3, 4, 5];

  taxRegimes: TaxRegime[] = [
    { label: $localize`:@@auth.register.ts.regime.reel.ef6ee424:Régime réel`, value: 0 },
    { label: $localize`:@@auth.register.ts.regime.forfaitaire.a1dc2f7b:Régime forfaitaire`, value: 1 },
    { label: $localize`:@@auth.register.ts.exonere.5d577ae9:Exonéré`, value: 2 }
  ];

  readonly governorates = GOVERNORATE_OPTIONS;


  form: FormGroup = this.fb.group({
    // Step 1: Account
    firstName: ['', [Validators.required, Validators.minLength(2)]],
    lastName: ['', [Validators.required, Validators.minLength(2)]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [
      Validators.required,
      Validators.minLength(12),
      Validators.pattern(AUTH_PASSWORD_VALIDATORS_PATTERN)
    ]],
    confirmPassword: ['', Validators.required],
    acceptTerms: [false, Validators.requiredTrue],
    // Step 2: Company
    companyName: ['', [Validators.required, Validators.minLength(2)]],
    nif: ['', Validators.required],
    taxRegime: [null, Validators.required],
    companyEmail: ['', [Validators.required, Validators.email]],
    phone: ['', Validators.required],
    website: [''],
    warehouseName: [''],  // Default to empty, let placeholder show default
    // Step 3: Address
    street: ['', Validators.required],
    streetLine2: [''],
    city: ['', Validators.required],
    postalCode: [''],
    governorate: ['', Validators.required]
  });

  passwordMismatch(): boolean {
    return checkPasswordMismatch(this.form.get('password')?.value, this.form.get('confirmPassword')?.value);
  }

  passwordMatches(): boolean {
    return checkPasswordMatches(this.form.get('password')?.value, this.form.get('confirmPassword')?.value);
  }

  passwordCriteria() {
    return computePasswordCriteria(this.form.get('password')?.value);
  }

  passwordStrengthMetCount(): number {
    return passwordStrengthMetCount(this.passwordCriteria());
  }

  passwordStrengthLevel() {
    return computePasswordStrengthLevel(this.form.get('password')?.value, this.passwordCriteria());
  }

  passwordStrengthLabel(): string {
    return getPasswordStrengthLabel(this.passwordStrengthLevel());
  }

  /** Indice d’étape affiché (1–3) pour le libellé « Étape X sur 3 ». */
  stepHumanIndex(): number {
    return this.currentStep() + 1;
  }

  /** IDs pour aria-describedby du champ mot de passe (erreur + aide). */
  passwordFieldAriaDescribedBy(): string {
    const ids: string[] = ['password-strength-hint'];
    if (this.isInvalid('password')) {
      ids.unshift('password-error');
    }
    return ids.join(' ');
  }

  /** IDs pour aria-describedby du champ confirmation. */
  confirmPasswordAriaDescribedBy(): string | null {
    if (this.isInvalid('confirmPassword') || this.passwordMismatch()) {
      return 'confirmPassword-error';
    }
    if (this.passwordMatches() && this.form.get('confirmPassword')?.value) {
      return 'confirmPassword-success';
    }
    return null;
  }

  ngOnInit(): void {
    // Watch for password changes to update validation
    this.form.get('password')?.valueChanges.subscribe(() => {
      this.form.get('confirmPassword')?.updateValueAndValidity();
    });
  }

  ngOnDestroy(): void {
    this.clearLoadingMessageTimer();
  }

  isInvalid(field: string): boolean {
    const control = this.form.get(field);
    return !!(control?.invalid && control?.touched);
  }

  isCurrentStepValid(): boolean {
    const step = this.currentStep();

    if (step === 0) {
      const fields = ['firstName', 'lastName', 'email', 'password', 'confirmPassword', 'acceptTerms'];
      return fields.every(f => this.form.get(f)?.valid) && !this.passwordMismatch();
    }

    if (step === 1) {
      const fields = ['companyName', 'nif', 'taxRegime', 'companyEmail', 'phone'];
      return fields.every(f => this.form.get(f)?.valid);
    }

    if (step === 2) {
      const fields = ['street', 'city', 'governorate'];
      return fields.every(f => this.form.get(f)?.valid);
    }

    return false;
  }

  nextStep(): void {
    if (this.isCurrentStepValid() && this.currentStep() < 2) {
      this.currentStep.update(s => s + 1);
      scrollAuthWizardStepIntoView();
    }
  }

  previousStep(): void {
    if (this.currentStep() > 0) {
      this.currentStep.update(s => s - 1);
      scrollAuthWizardStepIntoView();
    }
  }

  onSubmit(): void {
    // Prevent submission if form is invalid
    if (this.form.invalid) {
      markAllFormControlsTouched(this.form);
      scrollToFirstInvalidField();
      return;
    }

    if (!this.form.get('acceptTerms')?.value) {
      this.form.get('acceptTerms')?.markAsTouched();
      scrollToFirstInvalidField();
      return;
    }

    // Check password mismatch
    if (this.passwordMismatch()) {
      this.error.set($localize`:@@auth.register.ts.les.mots.de.passe.ne.correspondent.pas.c1a3d196:Les mots de passe ne correspondent pas`);
      this.form.get('confirmPassword')?.markAsTouched();
      return;
    }

    this.loading.set(true);
    this.error.set(null);
    this.loadingMessage.set($localize`:@@auth.register.ts.creation.de.votre.espace.07866544:Création de votre espace...`);
    this.loadingStartedAt = Date.now();
    this.startLoadingMessageTimer();

    // Nettoyer le NIF une fois et réutiliser partout (évite que l'InputMask écrase notre valeur)
    const nifControl = this.form.get('nif');
    const rawNif = nifControl?.value ?? '';
    const cleanedNif = cleanNifValue(rawNif);
    if (nifControl && cleanedNif !== rawNif) {
      nifControl.setValue(cleanedNif, { emitEvent: false });
      nifControl.updateValueAndValidity({ emitEvent: false });
    }


    // Use getRawValue() to ensure we capture all fields, even if disabled
    const formValue = this.form.getRawValue();

    const validationErrors = validateCompanyRegisterFormData(
      formValue,
      cleanedNif,
      !!this.form.get('nif')?.touched
    );
    if (validationErrors.length > 0) {
      this.error.set(validationErrors.join(', '));
      this.stopLoading();
      return;
    }

    // Transform data to match backend expectations
    const request: RegisterRequest = {
      email: trimRequired(formValue.email),
      password: formValue.password || '',
      confirmPassword: formValue.confirmPassword || '',
      firstName: trimRequired(formValue.firstName),
      lastName: trimRequired(formValue.lastName),
      companyName: trimRequired(formValue.companyName),
      phone: cleanPhoneValue(formValue.phone),
      nif: cleanedNif,
      taxRegime: typeof formValue.taxRegime === 'number'
        ? formValue.taxRegime
        : (typeof formValue.taxRegime === 'object' && formValue.taxRegime !== null && 'value' in formValue.taxRegime
          ? Number((formValue.taxRegime as { value: unknown }).value)
          : 0),
      companyEmail: trimRequired(formValue.companyEmail),
      website: trimOptional(formValue.website),
      street: trimRequired(formValue.street),
      streetLine2: trimOptional(formValue.streetLine2),
      city: trimRequired(formValue.city),
      postalCode: trimOptional(formValue.postalCode),
      governorate: dropdownStringValue(formValue.governorate),
      warehouseName: trimOptional(formValue.warehouseName)
    };

    // Aucune journalisation de la requête ici : même masquée sur les mots de passe, elle
    // contient des données personnelles (e-mail, NIF, téléphone, adresse). Voir la note
    // de sécurité sur `AuthService.register()`.
    this.authService.register(request).pipe(
      timeout(RegisterComponent.REGISTRATION_TIMEOUT_MS),
      catchError(err => {
        if (err instanceof TimeoutError) {
          return throwError(() => ({
            status: 0,
            message: $localize`:@@auth.register.ts.la.creation.du.compte.prend.plus.de.temp.b880214b:La création du compte prend plus de temps que prévu. Veuillez patienter ou réessayer dans quelques instants.`
          }));
        }
        return throwError(() => err);
      })
    ).subscribe({
      next: (response) => {
        if (response.success) {
          console.log('[RegisterComponent] Registration successful');
          this.warehouseContext.navigateAfterSuccessfulAuth('/dashboard');
        } else {
          const errorMessage = response.errors?.length > 0
            ? response.errors.join(', ')
            : response.message || $localize`:@@auth.register.ts.une.erreur.est.survenue.lors.de.l.inscri.c27c4975:Une erreur est survenue lors de l'inscription`;
          this.error.set(errorMessage);
          this.errorHandler.logError('Registration failed (success: false)', { response });
        }
        this.stopLoading();
      },
      error: (err: HttpErrorResponse | { status?: number; message?: string }) => {
        let errorMessage = err instanceof HttpErrorResponse
          ? this.errorHandler.extractErrorMessage(err)
          : ('message' in err && err.message ? err.message : this.errorHandler.extractErrorMessage(err as HttpErrorResponse));

        if (!errorMessage || errorMessage === 'undefined' || errorMessage.trim() === '' || errorMessage.includes('undefined')) {
          const status = 'status' in err ? err.status : (err as HttpErrorResponse)?.status;
          if (!status) {
            errorMessage = $localize`:@@auth.register.ts.impossible.de.se.connecter.au.serveur.ve.81a4b133:Impossible de se connecter au serveur. Vérifiez que le backend est démarré sur https://localhost:7001.`;
          } else {
            errorMessage = $localize`:@@auth.register.ts.une.erreur.est.survenue.lors.de.l.inscri.12bd2764:Une erreur est survenue lors de l'inscription (${status || 'erreur inconnue'}:p:). Veuillez réessayer.`;
          }
        }

        if (!errorMessage || errorMessage === 'undefined') {
          errorMessage = $localize`:@@auth.register.ts.une.erreur.est.survenue.lors.de.l.inscri.5876878f:Une erreur est survenue lors de l'inscription. Veuillez réessayer.`;
        }

        this.error.set(errorMessage);
        this.errorHandler.logError('Registration HTTP error', err);
        this.stopLoading();
      }
    });
  }

  private startLoadingMessageTimer(): void {
    this.clearLoadingMessageTimer();
    this.loadingMessageTimer = setInterval(() => {
      const elapsed = Date.now() - this.loadingStartedAt;
      if (elapsed < 5_000) {
        this.loadingMessage.set($localize`:@@auth.register.ts.creation.de.votre.espace.07866544:Création de votre espace...`);
      } else if (elapsed < 30_000) {
        this.loadingMessage.set($localize`:@@auth.register.ts.configuration.de.la.base.de.donnees.cela.6fb93f3b:Configuration de la base de données, cela peut prendre une minute...`);
      } else {
        this.loadingMessage.set($localize`:@@auth.register.ts.finalisation.en.cours.merci.de.patienter.d4489dba:Finalisation en cours, merci de patienter...`);
      }
    }, 1_000);
  }

  private clearLoadingMessageTimer(): void {
    if (this.loadingMessageTimer !== null) {
      clearInterval(this.loadingMessageTimer);
      this.loadingMessageTimer = null;
    }
  }

  private stopLoading(): void {
    this.clearLoadingMessageTimer();
    this.loading.set(false);
  }

  onNifBlur(): void {
    applyNifBlurCleanup(this.form);
  }
}
