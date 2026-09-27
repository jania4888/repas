import { Component, OnInit, OnDestroy, computed, inject, signal, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { trigger, transition, style, animate } from '@angular/animations';
import { HttpErrorResponse } from '@angular/common/http';
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
import { Textarea } from 'primeng/textarea';
import { MenuItem } from '@shared/models/menu-item.model';
import { AuthService, RegisterAccountingFirmRequest } from '@core/services/auth.service';
import { WarehouseContextService } from '@core/services/warehouse-context.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { ErrorMessageService } from '@core/services/error-message.service';
import { timeout, TimeoutError, catchError, throwError } from 'rxjs';
import { AuthShellComponent } from '../auth-shell/auth-shell.component';
import { REGISTER_FIRM_AUTH_SHELL_CONFIG } from '../auth-shell/auth-shell.config';
import { TunisianValidators } from '@shared/validation/tunisian-validators';
import { NifMaskPasteDirective } from '@shared/validation/nif-mask-paste.directive';
import { MAX_LENGTHS } from '@shared/validation/validation-rules';
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
  validateFirmRegisterFormData
} from '../shared/auth-registration.helpers';
import {
  REGISTRATION_FIRM_MODE,
  type FirmRegistrationSubmitRequest
} from '@core/registration/registration-wizard-mode';

@Component({
  selector: 'app-register-firm',
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
    Textarea,
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
  templateUrl: './register-firm.component.html',
  styleUrl: './register-firm.component.scss'
})
export class RegisterFirmComponent implements OnInit, OnDestroy {
  readonly shellConfig = REGISTER_FIRM_AUTH_SHELL_CONFIG;
  readonly environment = environment;

  private static readonly REGISTRATION_TIMEOUT_MS = 120_000;

  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly warehouseContext = inject(WarehouseContextService);
  private readonly errorHandler = inject(ErrorHandlerService);
  readonly errorMessageService = inject(ErrorMessageService);
  readonly firmMode = inject(REGISTRATION_FIRM_MODE);
  readonly hidePublicCrossLinks = computed(
    () => this.firmMode.mode === 'platform' || !!this.firmMode.hidePublicCrossLinks
  );

  readonly loading = signal(false);
  readonly loadingMessage = signal('Création de votre espace cabinet...');
  readonly error = signal<string | null>(null);
  readonly currentStep = signal(0);
  readonly showOptionalProfile = signal(false);

  private loadingMessageTimer: ReturnType<typeof setInterval> | null = null;
  private loadingStartedAt = 0;

  readonly registrationFormAriaLabel = computed(() => {
    const stepNames = ['Compte', 'Cabinet', 'Adresse & visibilité'];
    const cur = this.currentStep();
    const prev = cur > 0 ? $localize`:@@ui.tern.etapes.precedentes.completees.b92c63:Étapes précédentes complétées. ` : '';
    return `${prev}Étape ${cur + 1} sur 3 : ${stepNames[cur]}.`;
  });

  readonly steps: MenuItem[] = [
    { label: 'Compte' },
    { label: 'Cabinet' },
    { label: 'Adresse & visibilité' }
  ];

  readonly strengthSegments: readonly number[] = [1, 2, 3, 4, 5];
  readonly governorates = GOVERNORATE_OPTIONS;

  readonly form: FormGroup = this.fb.group({
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
    firmName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(200)]],
    nif: ['', [Validators.required, TunisianValidators.nif()]],
    firmEmail: ['', [Validators.required, Validators.email]],
    phone: ['', [Validators.required, TunisianValidators.tunisianPhone()]],
    website: [''],
    description: ['', Validators.maxLength(MAX_LENGTHS.description)],
    professionalRegistrationNumber: ['', Validators.maxLength(100)],
    street: ['', [Validators.required, Validators.maxLength(MAX_LENGTHS.street)]],
    streetLine2: ['', Validators.maxLength(MAX_LENGTHS.street)],
    city: ['', [Validators.required, Validators.maxLength(MAX_LENGTHS.city)]],
    postalCode: ['', TunisianValidators.postalCode()],
    governorate: ['', [Validators.required, TunisianValidators.governorate()]],
    isPublicInDirectory: [true]
  });

  ngOnInit(): void {
    this.form.get('password')?.valueChanges.subscribe(() => {
      this.form.get('confirmPassword')?.updateValueAndValidity();
    });
  }

  ngOnDestroy(): void {
    this.clearLoadingMessageTimer();
  }

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.loading()) {
      event.preventDefault();
      event.returnValue = '';
    }
  }

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

  stepHumanIndex(): number {
    return this.currentStep() + 1;
  }

  passwordFieldAriaDescribedBy(): string {
    const ids: string[] = ['password-strength-hint'];
    if (this.isInvalid('password')) {
      ids.unshift('password-error');
    }
    return ids.join(' ');
  }

  confirmPasswordAriaDescribedBy(): string | null {
    if (this.isInvalid('confirmPassword') || this.passwordMismatch()) {
      return 'confirmPassword-error';
    }
    if (this.passwordMatches() && this.form.get('confirmPassword')?.value) {
      return 'confirmPassword-success';
    }
    return null;
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
      const fields = ['firmName', 'nif', 'firmEmail', 'phone', 'website', 'description', 'professionalRegistrationNumber'];
      return fields.every(f => this.form.get(f)?.valid);
    }

    if (step === 2) {
      const fields = ['street', 'city', 'governorate', 'streetLine2', 'postalCode'];
      return fields.every(f => this.form.get(f)?.valid);
    }

    return false;
  }

  nextStep(): void {
    if (!this.isCurrentStepValid()) {
      this.markCurrentStepTouched();
      scrollToFirstInvalidField();
      return;
    }
    if (this.currentStep() < 2) {
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

  onNifBlur(): void {
    applyNifBlurCleanup(this.form);
  }

  submit(): void {
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

    if (this.passwordMismatch()) {
      this.error.set('Les mots de passe ne correspondent pas');
      this.form.get('confirmPassword')?.markAsTouched();
      return;
    }

    this.loading.set(true);
    this.error.set(null);
    this.loadingMessage.set('Création de votre espace cabinet...');
    this.loadingStartedAt = Date.now();
    this.startLoadingMessageTimer();

    const nifControl = this.form.get('nif');
    const rawNif = nifControl?.value ?? '';
    const cleanedNif = cleanNifValue(rawNif);
    if (nifControl && cleanedNif !== rawNif) {
      nifControl.setValue(cleanedNif, { emitEvent: false });
      nifControl.updateValueAndValidity({ emitEvent: false });
    }

    const formValue = this.form.getRawValue();
    const validationErrors = validateFirmRegisterFormData(
      formValue,
      cleanedNif,
      !!nifControl?.touched
    );
    if (validationErrors.length > 0) {
      this.error.set(validationErrors.join(', '));
      this.loading.set(false);
      return;
    }

    const payload: RegisterAccountingFirmRequest = {
      email: trimRequired(formValue.email),
      password: formValue.password || '',
      confirmPassword: formValue.confirmPassword || '',
      firstName: trimRequired(formValue.firstName),
      lastName: trimRequired(formValue.lastName),
      firmName: trimRequired(formValue.firmName),
      nif: cleanedNif,
      street: trimRequired(formValue.street),
      streetLine2: trimOptional(formValue.streetLine2),
      city: trimRequired(formValue.city),
      postalCode: trimOptional(formValue.postalCode),
      governorate: dropdownStringValue(formValue.governorate),
      firmEmail: trimRequired(formValue.firmEmail),
      phone: cleanPhoneValue(formValue.phone),
      website: trimOptional(formValue.website),
      description: trimOptional(formValue.description),
      professionalRegistrationNumber: trimOptional(formValue.professionalRegistrationNumber),
      isPublicInDirectory: formValue.isPublicInDirectory ?? true
    };

    if (this.firmMode.mode === 'platform' && this.firmMode.submitFirm) {
      this.firmMode
        .submitFirm(payload as FirmRegistrationSubmitRequest)
        .pipe(
          timeout(RegisterFirmComponent.REGISTRATION_TIMEOUT_MS),
          catchError(err => {
            if (err instanceof TimeoutError) {
              return throwError(() => ({
                status: 0,
                message: 'La création du cabinet prend plus de temps que prévu.'
              }));
            }
            return throwError(() => err);
          })
        )
        .subscribe({
          next: result => {
            this.stopLoading();
            if (result.success && result.tenantId && this.firmMode.onFirmSuccess) {
              this.firmMode.onFirmSuccess(result.tenantId);
            } else if (result.success) {
              this.error.set('Cabinet créé mais identifiant tenant manquant.');
            } else {
              this.error.set(result.errors?.join(', ') ?? result.message ?? $localize`:@@ui.tern.creation.impossible.5661a5:Création impossible.`);
            }
          },
          error: (err: HttpErrorResponse | { status?: number; message?: string }) => {
            this.stopLoading();
            this.error.set(this.extractSubmitError(err));
          }
        });
      return;
    }

    this.auth.registerFirm(payload).pipe(
      timeout(RegisterFirmComponent.REGISTRATION_TIMEOUT_MS),
      catchError(err => {
        if (err instanceof TimeoutError) {
          return throwError(() => ({
            status: 0,
            message: 'La création du cabinet prend plus de temps que prévu. Veuillez patienter ou réessayer dans quelques instants.'
          }));
        }
        return throwError(() => err);
      })
    ).subscribe({
      next: response => {
        this.stopLoading();
        if (response.success) {
          this.warehouseContext.navigateAfterSuccessfulAuth('/firm/dashboard');
        } else {
          const errorMessage = response.errors?.length
            ? response.errors.join(', ')
            : response.message ?? $localize`:@@ui.tern.une.erreur.est.survenue.lors.de.l.inscript.c27c49:Une erreur est survenue lors de l'inscription`;
          this.error.set(errorMessage);
          this.errorHandler.logError('Firm registration failed (success: false)', { response });
        }
      },
      error: (err: HttpErrorResponse | { status?: number; message?: string }) => {
        // On délègue à ErrorHandlerService : lui sait extraire un message métier des
        // enveloppes {code,message,fieldErrors} du backend. Le err.message natif d'un
        // HttpErrorResponse ("Http failure response for...") n'est jamais destiné à
        // l'utilisateur et masquerait un vrai message d'erreur applicative.
        let errorMessage = err instanceof HttpErrorResponse
          ? this.errorHandler.extractErrorMessage(err)
          : ('message' in err && err.message ? err.message : this.errorHandler.extractErrorMessage(err as HttpErrorResponse));
        if (!errorMessage || errorMessage === 'undefined' || errorMessage.trim() === '') {
          const status = 'status' in err ? err.status : (err as HttpErrorResponse)?.status;
          if (!status) {
            errorMessage = 'Impossible de se connecter au serveur. Vérifiez que le backend est démarré.';
          } else {
            errorMessage = `Une erreur est survenue lors de l'inscription (${status}). Veuillez réessayer.`;
          }
        }
        this.error.set(errorMessage);
        this.errorHandler.logError('Firm registration HTTP error', err);
        this.stopLoading();
      }
    });
  }

  private startLoadingMessageTimer(): void {
    this.clearLoadingMessageTimer();
    this.loadingMessageTimer = setInterval(() => {
      const elapsed = Date.now() - this.loadingStartedAt;
      if (elapsed < 5_000) {
        this.loadingMessage.set('Création de votre espace cabinet...');
      } else if (elapsed < 30_000) {
        this.loadingMessage.set('Configuration de la base de données, cela peut prendre une minute...');
      } else {
        this.loadingMessage.set('Finalisation en cours, merci de patienter...');
      }
    }, 1_000);
  }

  private extractSubmitError(err: HttpErrorResponse | { status?: number; message?: string }): string {
    let errorMessage =
      err instanceof HttpErrorResponse
        ? this.errorHandler.extractErrorMessage(err)
        : 'message' in err && err.message
          ? err.message
          : this.errorHandler.extractErrorMessage(err as HttpErrorResponse);
    if (!errorMessage || errorMessage === 'undefined' || errorMessage.trim() === '') {
      errorMessage = 'La création du cabinet a échoué. Veuillez réessayer.';
    }
    return errorMessage;
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

  private markCurrentStepTouched(): void {
    const stepFields: Record<number, string[]> = {
      0: ['firstName', 'lastName', 'email', 'password', 'confirmPassword', 'acceptTerms'],
      1: ['firmName', 'nif', 'firmEmail', 'phone', 'website', 'description', 'professionalRegistrationNumber'],
      2: ['street', 'streetLine2', 'city', 'postalCode', 'governorate', 'isPublicInDirectory']
    };
    stepFields[this.currentStep()]?.forEach(field => {
      this.form.get(field)?.markAsTouched();
    });
  }
}
