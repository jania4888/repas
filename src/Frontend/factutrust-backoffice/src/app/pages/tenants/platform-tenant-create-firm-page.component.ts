import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';
import { CheckboxModule } from 'primeng/checkbox';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { MessageModule } from 'primeng/message';
import { SelectModule } from 'primeng/select';
import { TextareaModule } from 'primeng/textarea';
import { FtFieldErrorComponent, FtPageHeaderComponent } from '@core/ui';
import { PlatformTenantProvisioningService } from '@core/services/platform-tenant-provisioning.service';
import {
  evaluatePasswordRules,
  governorateValidator,
  identityPasswordValidator,
  nifValidator,
  passwordsMatchValidator,
  postalCodeValidator,
  tunisianPhoneValidator
} from '@core/registration/registration-validators';
import { TUNISIAN_GOVERNORATE_OPTIONS, normalizeNif, normalizePhone } from '@core/registration/tunisian-validation';
import type { FirmRegistrationSubmitRequest } from '@core/registration/registration-wizard-mode';
import { TENANTS_FR } from './tenants.i18n.fr';

/**
 * Création d'un cabinet comptable par un opérateur plateforme.
 *
 * Volontairement un formulaire simple et non un assistant : `RegisterAccountingFirmDto` n'a ni
 * secteur, ni domaine, ni modules — un découpage en étapes n'apporterait rien. En revanche il
 * partage exactement les mêmes briques de validation et de remontée d'erreur que l'assistant
 * entreprise.
 */
@Component({
  selector: 'app-platform-tenant-create-firm-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    ButtonModule,
    InputTextModule,
    PasswordModule,
    CheckboxModule,
    ToggleSwitchModule,
    MessageModule,
    SelectModule,
    TextareaModule,
    FtPageHeaderComponent,
    FtFieldErrorComponent
  ],
  template: `
    <ft-page-header [title]="t('createFirm.title')" [subtitle]="t('createFirm.subtitle')" />

    @if (success(); as done) {
      <section class="firm-success">
        <h2>{{ t('createFirm.success.title') }}</h2>
        <p class="ft-wizard__hint">{{ t('create.success.credentials') }}</p>
        <p><strong>{{ t('create.success.managerEmail') }} :</strong> {{ done.managerEmail }}</p>
        <p class="ft-wizard__hint">{{ t('create.success.password') }}</p>
        <div class="ft-wizard__actions">
          <p-button [label]="t('create.success.openTenant')" (onClick)="openTenant()" />
          <p-button [label]="t('create.action.cancel')" [text]="true" (onClick)="cancel()" />
        </div>
      </section>
    } @else {
      @if (submitError(); as err) {
        <p-message severity="error" styleClass="firm-banner">
          <span>{{ err.message }}</span>
          @if (err.reference) {
            <span> — {{ t('create.success.reference') }} : <code>{{ err.reference }}</code></span>
          }
        </p-message>
      }

      <form [formGroup]="form" (ngSubmit)="onSubmit()" novalidate>
        <h3 class="firm-section">{{ t('createFirm.section.manager') }}</h3>
        <fieldset class="ft-wizard__grid">
          <div class="ft-wizard__field">
            <label for="firmAdminEmail">{{ t('create.field.email') }}</label>
            <input id="firmAdminEmail" pInputText type="email" formControlName="email" autocomplete="off" />
            <ft-field-error [control]="form.get('email')" />
          </div>
          <div class="ft-wizard__field">
            <label for="firmFirstName">{{ t('create.field.firstName') }}</label>
            <input id="firmFirstName" pInputText formControlName="firstName" autocomplete="off" />
            <ft-field-error [control]="form.get('firstName')" />
          </div>
          <div class="ft-wizard__field">
            <label for="firmLastName">{{ t('create.field.lastName') }}</label>
            <input id="firmLastName" pInputText formControlName="lastName" autocomplete="off" />
            <ft-field-error [control]="form.get('lastName')" />
          </div>
          <div class="ft-wizard__field">
            <label for="firmPassword">{{ t('create.field.password') }}</label>
            <p-password inputId="firmPassword" formControlName="password" [feedback]="false" [toggleMask]="true" autocomplete="new-password" />
            <ul class="password-rules">
              @for (rule of passwordRules(); track rule.key) {
                <li [class.password-rules__item--ok]="rule.satisfied">
                  <i [class]="rule.satisfied ? 'pi pi-check' : 'pi pi-circle'"></i>
                  <span>{{ rule.label }}</span>
                </li>
              }
            </ul>
          </div>
          <div class="ft-wizard__field">
            <label for="firmConfirmPassword">{{ t('create.field.confirmPassword') }}</label>
            <p-password inputId="firmConfirmPassword" formControlName="confirmPassword" [feedback]="false" [toggleMask]="true" autocomplete="new-password" />
            <ft-field-error [control]="form.get('confirmPassword')" />
          </div>
          <p class="ft-wizard__hint ft-wizard__grid--full">{{ t('create.hint.password') }}</p>
        </fieldset>

        <h3 class="firm-section">{{ t('createFirm.section.firm') }}</h3>
        <fieldset class="ft-wizard__grid">
          <div class="ft-wizard__field">
            <label for="firmName">{{ t('createFirm.field.firmName') }}</label>
            <input id="firmName" pInputText formControlName="firmName" autocomplete="off" />
            <ft-field-error [control]="form.get('firmName')" />
          </div>
          <div class="ft-wizard__field">
            <label for="firmNif">{{ t('create.field.nif') }}</label>
            <input id="firmNif" pInputText formControlName="nif" [placeholder]="t('create.placeholder.nif')" autocomplete="off" />
            <ft-field-error [control]="form.get('nif')" />
          </div>
          <div class="ft-wizard__field">
            <label for="firmEmail">{{ t('createFirm.field.firmEmail') }}</label>
            <input id="firmEmail" pInputText type="email" formControlName="firmEmail" autocomplete="off" />
            <ft-field-error [control]="form.get('firmEmail')" />
          </div>
          <div class="ft-wizard__field">
            <label for="firmPhone">{{ t('create.field.phone') }}</label>
            <input id="firmPhone" pInputText formControlName="phone" autocomplete="off" />
            <ft-field-error [control]="form.get('phone')" />
          </div>
          <div class="ft-wizard__field">
            <label for="firmRegistrationNumber">{{ t('createFirm.field.registrationNumber') }}</label>
            <input id="firmRegistrationNumber" pInputText formControlName="professionalRegistrationNumber" autocomplete="off" />
          </div>
          <div class="ft-wizard__field ft-wizard__grid--full">
            <label for="firmDescription">{{ t('createFirm.field.description') }}</label>
            <textarea id="firmDescription" pTextarea formControlName="description" rows="3"></textarea>
          </div>
        </fieldset>

        <h3 class="firm-section">{{ t('createFirm.section.address') }}</h3>
        <fieldset class="ft-wizard__grid">
          <div class="ft-wizard__field">
            <label for="firmStreet">{{ t('create.field.street') }}</label>
            <input id="firmStreet" pInputText formControlName="street" autocomplete="off" />
            <ft-field-error [control]="form.get('street')" />
          </div>
          <div class="ft-wizard__field">
            <label for="firmCity">{{ t('create.field.city') }}</label>
            <input id="firmCity" pInputText formControlName="city" autocomplete="off" />
            <ft-field-error [control]="form.get('city')" />
          </div>
          <div class="ft-wizard__field">
            <label for="firmGovernorate">{{ t('create.field.governorate') }}</label>
            <p-select
              inputId="firmGovernorate"
              formControlName="governorate"
              [options]="governorateOptions"
              optionLabel="label"
              optionValue="value"
              [filter]="true"
              [placeholder]="t('create.placeholder.governorate')"
            />
            <ft-field-error [control]="form.get('governorate')" />
          </div>
          <div class="ft-wizard__field">
            <label for="firmPostalCode">{{ t('create.field.postalCode') }}</label>
            <input id="firmPostalCode" pInputText formControlName="postalCode" inputmode="numeric" maxlength="4" />
            <ft-field-error [control]="form.get('postalCode')" />
          </div>
        </fieldset>

        <div class="firm-switch">
          <p-toggleswitch inputId="firmDirectory" formControlName="isPublicInDirectory" />
          <label for="firmDirectory">{{ t('createFirm.field.directory') }}</label>
        </div>

        <div class="firm-switch">
          <p-checkbox formControlName="acceptResponsibility" [binary]="true" inputId="firmAccept" />
          <label for="firmAccept">{{ t('create.confirm.checkbox') }}</label>
        </div>
        <ft-field-error [control]="form.get('acceptResponsibility')" />

        <div class="ft-wizard__actions">
          <p-button [label]="t('createFirm.action.submit')" type="submit" [loading]="submitting()" />
          <p-button [label]="t('create.action.cancel')" [text]="true" type="button" (onClick)="cancel()" />
        </div>
      </form>
    }
  `,
  styles: [
    `
      :host {
        display: block;
        max-width: 60rem;
      }
      fieldset {
        border: 0;
        margin: 0;
        padding: 0;
      }
      .firm-section {
        margin: 1.5rem 0 0.5rem;
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--ft-text);
      }
      .firm-banner {
        display: block;
        margin-bottom: 1rem;
      }
      .firm-switch {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-top: 1rem;
        font-size: 0.875rem;
      }
      .firm-success {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        max-width: 44rem;
      }
      .firm-success h2 {
        margin: 0;
        font-size: 1.125rem;
      }
      .password-rules {
        list-style: none;
        margin: 0.4rem 0 0;
        padding: 0;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
        gap: 0.2rem 0.75rem;
        font-size: 0.8125rem;
        color: var(--ft-text-muted);
      }
      .password-rules li {
        display: flex;
        align-items: center;
        gap: 0.35rem;
      }
      .password-rules li i {
        font-size: 0.7rem;
      }
      .password-rules__item--ok {
        color: var(--ft-success-text, #3fb950);
      }
    `
  ]
})
export class PlatformTenantCreateFirmPageComponent {
  private readonly fb = inject(FormBuilder);
  private readonly provisioning = inject(PlatformTenantProvisioningService);
  private readonly router = inject(Router);
  private readonly toast = inject(MessageService);
  private readonly host = inject(ElementRef<HTMLElement>);

  protected readonly submitting = signal(false);
  protected readonly submitError = signal<{ message: string; reference?: string } | null>(null);
  protected readonly success = signal<{ tenantId: string; managerEmail?: string } | null>(null);

  protected readonly governorateOptions = [...TUNISIAN_GOVERNORATE_OPTIONS];

  protected readonly form = this.fb.nonNullable.group(
    {
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, identityPasswordValidator]],
      confirmPassword: ['', Validators.required],
      firstName: ['', Validators.required],
      lastName: ['', Validators.required],
      firmName: ['', Validators.required],
      nif: ['', [Validators.required, nifValidator]],
      firmEmail: ['', [Validators.required, Validators.email]],
      phone: ['', [Validators.required, tunisianPhoneValidator]],
      description: [''],
      professionalRegistrationNumber: [''],
      street: ['', Validators.required],
      city: ['', Validators.required],
      governorate: ['', [Validators.required, governorateValidator]],
      postalCode: ['', postalCodeValidator],
      isPublicInDirectory: [true],
      acceptResponsibility: [false, Validators.requiredTrue]
    },
    { validators: passwordsMatchValidator() }
  );

  protected readonly passwordRules = computed(() =>
    evaluatePasswordRules(this.form.get('password')?.value as string)
  );

  protected t(key: keyof typeof TENANTS_FR): string {
    return TENANTS_FR[key];
  }

  protected openTenant(): void {
    const tenantId = this.success()?.tenantId;
    if (tenantId) void this.router.navigate(['/tenants', tenantId]);
  }

  protected cancel(): void {
    void this.router.navigate(['/tenants']);
  }

  protected onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.submitError.set({ message: this.t('create.error.stepInvalid') });
      this.scrollToFirstInvalid();
      return;
    }

    const v = this.form.getRawValue();
    const payload: FirmRegistrationSubmitRequest = {
      email: v.email.trim(),
      password: v.password,
      confirmPassword: v.confirmPassword,
      firstName: v.firstName.trim(),
      lastName: v.lastName.trim(),
      firmName: v.firmName.trim(),
      nif: normalizeNif(v.nif),
      firmEmail: v.firmEmail.trim(),
      phone: normalizePhone(v.phone),
      street: v.street.trim(),
      city: v.city.trim(),
      governorate: v.governorate.trim(),
      isPublicInDirectory: v.isPublicInDirectory
    };

    const description = v.description.trim();
    if (description) payload.description = description;

    const registrationNumber = v.professionalRegistrationNumber.trim();
    if (registrationNumber) payload.professionalRegistrationNumber = registrationNumber;

    const postalCode = v.postalCode.trim();
    if (postalCode) payload.postalCode = postalCode;

    this.submitting.set(true);
    this.submitError.set(null);

    this.provisioning.createAccountingFirm(payload).subscribe(result => {
      this.submitting.set(false);

      if (result.success && result.tenantId) {
        this.success.set({ tenantId: result.tenantId, managerEmail: result.managerEmail ?? payload.email });
        this.toast.add({ severity: 'success', summary: this.t('createFirm.success.title') });
        return;
      }

      this.submitError.set({
        message: result.message ?? this.t('createFirm.error.title'),
        reference: result.reference
      });
    });
  }

  private scrollToFirstInvalid(): void {
    queueMicrotask(() => {
      const element = (this.host.nativeElement as HTMLElement).querySelector<HTMLElement>(
        '.ng-invalid[formControlName], .ng-invalid [formControlName], .ng-invalid input'
      );
      element?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      element?.focus?.();
    });
  }
}
