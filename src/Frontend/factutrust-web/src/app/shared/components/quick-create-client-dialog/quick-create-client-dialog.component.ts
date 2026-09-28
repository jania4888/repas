import {
  Component,
  EventEmitter,
  Input,
  Output,
  inject,
  signal,
  computed,
  HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { InputMaskModule } from 'primeng/inputmask';
import { SelectModule } from 'primeng/select';
import { OverlayOptions } from 'primeng/api';
import { ButtonComponent } from '@shared/components/button/button.component';
import {
  ClientService,
  Client,
  ClientListItem,
  ClientType,
  CreateClientRequest,
} from '@core/services/client.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { DrawerOverlayService } from '@core/services/drawer-overlay.service';
import { HttpErrorResponse } from '@angular/common/http';
import { switchMap } from 'rxjs/operators';
import { of } from 'rxjs';
import { EMAIL_PATTERN, NIF_PATTERN, TUNISIAN_GOVERNORATES } from '@shared/validation';
import { cleanNif } from './quick-create-client.utils';
import { NifMaskPasteDirective } from '@shared/validation/nif-mask-paste.directive';

export interface QuickCreatedClient {
  listItem: ClientListItem;
  street: string;
  postalCode: string | null;
}

interface TypeOption {
  label: string;
  value: ClientType;
}

interface GovernorateOption {
  label: string;
  value: string;
}

const TYPE_OPTIONS: TypeOption[] = [
  { label: $localize`:@@shared.quick-create-client-dialog.ts.particulier.281680dd:Particulier`, value: ClientType.Individual },
  { label: $localize`:@@shared.quick-create-client-dialog.ts.entreprise.d03e74b6:Entreprise`, value: ClientType.Business },
];

const GOVERNORATE_OPTIONS: GovernorateOption[] = TUNISIAN_GOVERNORATES.map((g) => ({
  label: g,
  value: g,
}));

const FIELD_IDS = {
  name: 'quick-client-name',
  email: 'quick-client-email',
  street: 'quick-client-street',
  city: 'quick-client-city',
  governorate: 'quick-client-governorate',
  nif: 'quick-client-nif',
} as const;

@Component({
  selector: 'app-quick-create-client-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DialogModule,
    InputTextModule,
    InputMaskModule,
    NifMaskPasteDirective,
    SelectModule,
    ButtonComponent,
  ],
  template: `
    <ng-template #formContent>
      <div class="quick-create-client-content">
        <div class="form-fields">
          <div class="form-block">
            <h4 class="form-block-title" i18n="@@shared.components.quick-create-client-dialog.quick-create-client-dialog.identite.3138be1c">Identité</h4>
            <div class="form-group">
              <label for="quick-client-name"><ng-container i18n="@@shared.components.quick-create-client-dialog.quick-create-client-dialog.nom.ou.raison.sociale.2983b5c6">Nom ou raison sociale </ng-container> <span class="required" i18n="@@shared.components.quick-create-client-dialog.quick-create-client-dialog.text.df58248c">*</span></label>
              <input
                pInputText
                id="quick-client-name"
                [ngModel]="name()"
                (ngModelChange)="name.set($event)"
                (blur)="nameTouched.set(true)"
                placeholder="Ex. Jean Dupont ou ABC SARL" i18n-placeholder="@@shared.components.quick-create-client-dialog.quick-create-client-dialog.ex.jean.dupont.ou.abc.sarl.92bd3a72"
                class="w-full"
                [class.ng-invalid]="showNameError()" />
              @if (showNameError()) {
                <div class="field-error" role="alert">
                  <i class="pi pi-exclamation-circle"></i>
                  <span>{{ nameErrorMessage() }}</span>
                </div>
              }
            </div>
            <div class="form-row">
              <div class="form-group">
                <label for="quick-client-type"><ng-container i18n="@@shared.components.quick-create-client-dialog.quick-create-client-dialog.type.3deb7456">Type </ng-container> <span class="required" i18n="@@shared.components.quick-create-client-dialog.quick-create-client-dialog.text.df58248c">*</span></label>
                <p-select
                  id="quick-client-type"
                  [options]="typeOptions"
                  [ngModel]="type()"
                  (ngModelChange)="type.set($event)"
                  optionLabel="label"
                  optionValue="value"
                  placeholder="Type" i18n-placeholder="@@shared.components.quick-create-client-dialog.quick-create-client-dialog.type.3deb7456"
                  appendTo="body"
                  [overlayOptions]="drawerOverlayOptions"
                  styleClass="w-full" />
              </div>
              <div class="form-group">
                <label for="quick-client-nif"><ng-container i18n="@@shared.components.quick-create-client-dialog.quick-create-client-dialog.nif.matricule.fiscal.a5458ed7">
                  NIF / Matricule fiscal
                  </ng-container>@if (type() === ClientType.Business) {
                    <span class="required" i18n="@@shared.components.quick-create-client-dialog.quick-create-client-dialog.text.df58248c">*</span>
                  }
                </label>
                <p-inputMask
                  id="quick-client-nif"
                  [ngModel]="nif()"
                  (ngModelChange)="nif.set($event)"
                  (onBlur)="onNifBlur()"
                  appNifMaskPaste
                  mask="9999999a/a/a/999"
                  placeholder="Ex. 1772793W/A/M/000" i18n-placeholder="@@shared.components.quick-create-client-dialog.quick-create-client-dialog.ex.1772793w.a.m.000.f3190bfc"
                  styleClass="w-full"
                  [class.ng-invalid]="showNifError()" />
                @if (showNifError()) {
                  <div class="field-error" role="alert">
                    <i class="pi pi-exclamation-circle"></i>
                    <span>{{ nifErrorMessage() }}</span>
                  </div>
                }
              </div>
            </div>
          </div>
          <div class="form-block">
            <h4 class="form-block-title" i18n="@@shared.components.quick-create-client-dialog.quick-create-client-dialog.contact.b37456c4">Contact</h4>
            <div class="form-group">
              <label for="quick-client-email" i18n="@@shared.components.quick-create-client-dialog.quick-create-client-dialog.email.84add5b2">Email</label>
              <input
                pInputText
                id="quick-client-email"
                type="email"
                [ngModel]="email()"
                (ngModelChange)="email.set($event)"
                (blur)="emailTouched.set(true)"
                placeholder="client@exemple.tn" i18n-placeholder="@@shared.components.quick-create-client-dialog.quick-create-client-dialog.client.exemple.tn.336b0635"
                class="w-full"
                [class.ng-invalid]="showEmailError()" />
              @if (showEmailError()) {
                <div class="field-error" role="alert">
                  <i class="pi pi-exclamation-circle"></i>
                  <span>{{ emailErrorMessage() }}</span>
                </div>
              }
            </div>
            <div class="form-group">
              <label for="quick-client-phone" i18n="@@shared.components.quick-create-client-dialog.quick-create-client-dialog.telephone.d3b023ea">Téléphone</label>
              <input
                pInputText
                id="quick-client-phone"
                [ngModel]="phone()"
                (ngModelChange)="phone.set($event)"
                class="w-full" />
            </div>
          </div>
          <div class="form-block">
            <h4 class="form-block-title" i18n="@@shared.components.quick-create-client-dialog.quick-create-client-dialog.adresse.522e1466">Adresse</h4>
            <div class="form-group">
              <label for="quick-client-street"><ng-container i18n="@@shared.components.quick-create-client-dialog.quick-create-client-dialog.rue.53f787b0">Rue </ng-container> <span class="required" i18n="@@shared.components.quick-create-client-dialog.quick-create-client-dialog.text.df58248c">*</span></label>
              <input
                pInputText
                id="quick-client-street"
                [ngModel]="street()"
                (ngModelChange)="street.set($event)"
                (blur)="streetTouched.set(true)"
                placeholder="Adresse complète" i18n-placeholder="@@shared.components.quick-create-client-dialog.quick-create-client-dialog.adresse.complete.ac51a43d"
                class="w-full"
                [class.ng-invalid]="showStreetError()" />
              @if (showStreetError()) {
                <div class="field-error" role="alert">
                  <i class="pi pi-exclamation-circle"></i>
                  <span i18n="@@shared.components.quick-create-client-dialog.quick-create-client-dialog.ce.champ.est.obligatoire.17061b6a">Ce champ est obligatoire</span>
                </div>
              }
            </div>
            <div class="form-row">
              <div class="form-group">
                <label for="quick-client-city"><ng-container i18n="@@shared.components.quick-create-client-dialog.quick-create-client-dialog.ville.97217611">Ville </ng-container> <span class="required" i18n="@@shared.components.quick-create-client-dialog.quick-create-client-dialog.text.df58248c">*</span></label>
                <input
                  pInputText
                  id="quick-client-city"
                  [ngModel]="city()"
                  (ngModelChange)="city.set($event)"
                  (blur)="cityTouched.set(true)"
                  class="w-full"
                  [class.ng-invalid]="showCityError()" />
                @if (showCityError()) {
                  <div class="field-error" role="alert">
                    <i class="pi pi-exclamation-circle"></i>
                    <span i18n="@@shared.components.quick-create-client-dialog.quick-create-client-dialog.ce.champ.est.obligatoire.17061b6a">Ce champ est obligatoire</span>
                  </div>
                }
              </div>
              <div class="form-group">
                <label for="quick-client-governorate"><ng-container i18n="@@shared.components.quick-create-client-dialog.quick-create-client-dialog.gouvernorat.b9cd1d99">Gouvernorat </ng-container> <span class="required" i18n="@@shared.components.quick-create-client-dialog.quick-create-client-dialog.text.df58248c">*</span></label>
                <p-select
                  id="quick-client-governorate"
                  [options]="governorateOptions"
                  [ngModel]="governorate()"
                  (ngModelChange)="governorate.set($event)"
                  (onChange)="governorateTouched.set(true)"
                  (onBlur)="governorateTouched.set(true)"
                  optionLabel="label"
                  optionValue="value"
                  placeholder="Sélectionner" i18n-placeholder="@@shared.components.quick-create-client-dialog.quick-create-client-dialog.selectionner.ab31a36f"
                  appendTo="body"
                  [overlayOptions]="drawerOverlayOptions"
                  styleClass="w-full"
                  [class.ng-invalid]="showGovernorateError()" />
                @if (showGovernorateError()) {
                  <div class="field-error" role="alert">
                    <i class="pi pi-exclamation-circle"></i>
                    <span i18n="@@shared.components.quick-create-client-dialog.quick-create-client-dialog.ce.champ.est.obligatoire.17061b6a">Ce champ est obligatoire</span>
                  </div>
                }
              </div>
            </div>
            <div class="form-group">
              <label for="quick-client-postal" i18n="@@shared.components.quick-create-client-dialog.quick-create-client-dialog.code.postal.74779109">Code postal</label>
              <input
                pInputText
                id="quick-client-postal"
                [ngModel]="postalCode()"
                (ngModelChange)="postalCode.set($event)"
                class="w-full" />
            </div>
          </div>
        </div>
        @if (showValidationSummary()) {
          <div class="validation-summary" role="alert" id="quick-client-validation-summary">
            <i class="pi pi-info-circle"></i>
            <div>
              <strong i18n="@@shared.components.quick-create-client-dialog.quick-create-client-dialog.completez.les.champs.obligatoires.pour.continuer.2719fef2">Complétez les champs obligatoires pour continuer</strong>
              <span>{{ missingFieldsMessage() }}</span>
            </div>
          </div>
        }
        @if (errorMessage()) {
          <div class="error-message" role="alert">
            <i class="pi pi-exclamation-triangle"></i>
            {{ errorMessage() }}
          </div>
        }
      </div>
    </ng-template>

    @if (panelMode && visible) {
      <div class="panel-overlay" (click)="close()" role="presentation">
        <div class="panel-content" (click)="$event.stopPropagation()" role="dialog" aria-modal="true">
          <div class="panel-header">
            <h2 class="panel-title" i18n="@@shared.components.quick-create-client-dialog.quick-create-client-dialog.creer.un.client.db580ea8">Créer un client</h2>
            <button type="button" class="panel-close" (click)="close()" aria-label="Fermer" i18n-aria-label="@@shared.components.quick-create-client-dialog.quick-create-client-dialog.fermer.5ab4ec64">
              <i class="pi pi-times"></i>
            </button>
          </div>
          <div class="panel-body">
            <ng-container *ngTemplateOutlet="formContent"></ng-container>
          </div>
          <div class="panel-footer">
            <app-button variant="outline" icon="pi-times" iconPos="left" (click)="close()" i18n="@@shared.components.quick-create-client-dialog.quick-create-client-dialog.annuler.49ba3292">Annuler</app-button>
            <app-button
              variant="primary"
              icon="pi-plus"
              iconPos="left"
              [disabled]="submitting() || !canSubmit()"
              [attr.title]="submitDisabledReason()"
              [attr.aria-describedby]="!canSubmit() ? 'quick-client-validation-summary' : null"
              (click)="submit()">
              {{ submitting() ? loc_ui_tern_creation_dca950 : loc_ui_tern_creer_et_selectionner_41dd64 }}
            </app-button>
          </div>
        </div>
      </div>
    }

    @if (!panelMode) {
      <p-dialog
        header="Créer un client" i18n-header="@@shared.components.quick-create-client-dialog.quick-create-client-dialog.creer.un.client.db580ea8"
        [(visible)]="visible"
        [modal]="true"
        [style]="{ width: '640px', maxWidth: '95vw' }"
        [draggable]="false"
        [closable]="true"
        (onHide)="onHide()">
        <ng-container *ngTemplateOutlet="formContent"></ng-container>
        <ng-template pTemplate="footer">
          <div class="dialog-footer">
            <app-button variant="outline" icon="pi-times" iconPos="left" (click)="close()" i18n="@@shared.components.quick-create-client-dialog.quick-create-client-dialog.annuler.49ba3292">Annuler</app-button>
            <app-button
              variant="primary"
              icon="pi-plus"
              iconPos="left"
              [disabled]="submitting() || !canSubmit()"
              [attr.title]="submitDisabledReason()"
              [attr.aria-describedby]="!canSubmit() ? 'quick-client-validation-summary' : null"
              (click)="submit()">
              {{ submitting() ? loc_ui_tern_creation_dca950 : loc_ui_tern_creer_et_selectionner_41dd64 }}
            </app-button>
          </div>
        </ng-template>
      </p-dialog>
    }
  `,
  styles: [`
    .quick-create-client-content { padding: 0; }
    .form-fields { display: flex; flex-direction: column; gap: var(--spacing-3); }
    .form-block { display: flex; flex-direction: column; gap: var(--spacing-3); }
    .form-block-title {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-tertiary);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin: 0;
      padding-top: var(--spacing-2);
      border-top: 1px solid var(--color-border-subtle);
    }
    .form-block:first-child .form-block-title { padding-top: 0; border-top: none; }
    .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: var(--spacing-4); }
    .form-group { display: flex; flex-direction: column; gap: var(--spacing-1); }
    .form-group label {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
      margin-bottom: var(--spacing-2);
    }
    .required { color: var(--color-error-600); margin-inline-start: var(--spacing-1); }
    .field-error {
      display: flex; align-items: center; gap: var(--spacing-2);
      margin-top: var(--spacing-1); font-size: var(--font-size-sm); color: var(--color-error-600);
    }
    .validation-summary {
      display: flex; align-items: flex-start; gap: var(--spacing-2);
      padding: var(--spacing-3) var(--spacing-4); margin-top: var(--spacing-4);
      background: var(--color-warning-50, #fffbeb); color: var(--color-warning-800, #92400e);
      border-radius: var(--radius-md); font-size: var(--font-size-sm);
    }
    .validation-summary strong { display: block; margin-bottom: var(--spacing-1); }
    .error-message {
      display: flex; align-items: center; gap: var(--spacing-2);
      padding: var(--spacing-3) var(--spacing-4); margin-top: var(--spacing-4);
      background: var(--color-error-50); color: var(--color-error-700);
      border-radius: var(--radius-md); font-size: var(--font-size-sm);
    }
    .dialog-footer { display: flex; justify-content: flex-end; gap: var(--spacing-4); }
    @media (max-width: 520px) { .form-row { grid-template-columns: 1fr; } }
    :host ::ng-deep .p-select { width: 100%; }
    .panel-overlay {
      position: fixed; inset: 0; z-index: var(--z-drawer-overlay);
      display: flex; justify-content: flex-end; align-items: stretch;
      background: rgba(15, 23, 42, 0.25); backdrop-filter: blur(4px);
    }
    .panel-content {
      position: relative; z-index: var(--z-drawer-panel);
      width: min(520px, 100vw); max-height: 100dvh; height: 100%;
      background: var(--color-white);
      box-shadow: -8px 0 24px rgba(0, 0, 0, 0.12);
      display: flex; flex-direction: column; overflow: hidden;
    }
    .panel-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: var(--spacing-5); border-bottom: 1px solid var(--color-border-subtle);
      flex-shrink: 0;
    }
    .panel-title {
      font-size: var(--font-size-lg); font-weight: var(--font-weight-bold);
      margin: 0; color: var(--color-text-primary);
    }
    .panel-close {
      display: flex; align-items: center; justify-content: center;
      width: 36px; height: 36px; border: none; border-radius: var(--radius-lg);
      background: var(--color-neutral-100); color: var(--color-text-tertiary); cursor: pointer;
    }
    .panel-body { flex: 1; overflow-y: auto; padding: var(--spacing-5); min-height: 0; }
    .panel-footer {
      display: flex; justify-content: flex-end; gap: var(--spacing-4);
      padding: var(--spacing-4) var(--spacing-5);
      padding-bottom: calc(var(--spacing-4) + env(safe-area-inset-bottom, 0px));
      border-top: 1px solid var(--color-border-subtle); background: var(--color-background-subtle);
      flex-shrink: 0;
    }
  `],
})
export class QuickCreateClientDialogComponent {
  readonly loc_ui_tern_creation_dca950 = $localize`:@@ui.tern.creation.dca950:Création...`;
  readonly loc_ui_tern_creer_et_selectionner_41dd64 = $localize`:@@ui.tern.creer.et.selectionner.41dd64:Créer et sélectionner`;
  readonly ClientType = ClientType;

  @Input() panelMode = false;

  @Input() set visible(value: boolean) {
    const wasVisible = this._dialogVisible;
    this._dialogVisible = value;
    if (value && !wasVisible) {
      if (this.panelMode) {
        this.drawerOverlay.registerOpen();
      }
      this.resetForm();
      setTimeout(() => this.focusFirstField(), 200);
    } else if (!value && wasVisible && this.panelMode) {
      this.drawerOverlay.registerClose();
    }
  }
  get visible(): boolean {
    return this._dialogVisible;
  }
  _dialogVisible = false;

  @Output() visibleChange = new EventEmitter<boolean>();
  @Output() clientCreated = new EventEmitter<QuickCreatedClient>();

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.panelMode && this.visible) {
      this.close();
    }
  }

  readonly clientService = inject(ClientService);
  readonly errorHandler = inject(ErrorHandlerService);
  readonly drawerOverlay = inject(DrawerOverlayService);

  readonly drawerOverlayOptions: OverlayOptions = { baseZIndex: 1200 };

  readonly typeOptions = TYPE_OPTIONS;
  readonly governorateOptions = GOVERNORATE_OPTIONS;

  readonly name = signal('');
  readonly type = signal<ClientType>(ClientType.Individual);
  readonly nif = signal('');
  readonly email = signal('');
  readonly phone = signal('');
  readonly street = signal('');
  readonly city = signal('');
  readonly governorate = signal('');
  readonly postalCode = signal('');

  readonly submitting = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly submitAttempted = signal(false);

  readonly nameTouched = signal(false);
  readonly emailTouched = signal(false);
  readonly streetTouched = signal(false);
  readonly cityTouched = signal(false);
  readonly governorateTouched = signal(false);
  readonly nifTouched = signal(false);

  readonly nameValid = computed(() => this.name().trim().length >= 2);
  readonly emailValid = computed(() => {
    const v = this.email().trim();
    return v.length === 0 || EMAIL_PATTERN.test(v);
  });
  readonly streetValid = computed(() => this.street().trim().length > 0);
  readonly cityValid = computed(() => this.city().trim().length > 0);
  readonly governorateValid = computed(() => this.governorate().trim().length > 0);
  readonly nifValid = computed(() => {
    if (this.type() !== ClientType.Business) return true;
    const normalized = cleanNif(this.nif());
    return normalized.length > 0 && NIF_PATTERN.test(normalized);
  });

  readonly canSubmit = computed(() =>
    this.nameValid() &&
    this.emailValid() &&
    this.streetValid() &&
    this.cityValid() &&
    this.governorateValid() &&
    this.nifValid()
  );

  readonly showNameError = computed(() => (this.submitAttempted() || this.nameTouched()) && !this.nameValid());
  readonly showEmailError = computed(() => (this.submitAttempted() || this.emailTouched()) && !this.emailValid());
  readonly showStreetError = computed(() => (this.submitAttempted() || this.streetTouched()) && !this.streetValid());
  readonly showCityError = computed(() => (this.submitAttempted() || this.cityTouched()) && !this.cityValid());
  readonly showGovernorateError = computed(() => (this.submitAttempted() || this.governorateTouched()) && !this.governorateValid());
  readonly showNifError = computed(() => {
    if (this.type() !== ClientType.Business) return false;
    return (this.submitAttempted() || this.nifTouched()) && !this.nifValid();
  });
  readonly showValidationSummary = computed(() => this.submitAttempted() && !this.canSubmit());

  readonly nameErrorMessage = computed(() => {
    const v = this.name().trim();
    return v.length === 0 ? $localize`:@@ui.tern.ce.champ.est.obligatoire.17061b:Ce champ est obligatoire` : $localize`:@@ui.tern.min.2.caracteres.af9507:Min. 2 caractères`;
  });

  readonly emailErrorMessage = computed(() => $localize`:@@shared.quick-create-client-dialog.ts.adresse.email.invalide.393d7440:Adresse email invalide`);

  readonly nifErrorMessage = computed(() => {
    const normalized = cleanNif(this.nif());
    if (normalized.length === 0) return $localize`:@@shared.quick-create-client-dialog.ts.le.matricule.fiscal.est.obligatoire.pour.cc46d410:Le matricule fiscal est obligatoire pour une entreprise`;
    return $localize`:@@shared.quick-create-client-dialog.ts.matricule.fiscal.invalide.format.attendu.7da88009:Matricule fiscal invalide. Format attendu: 1772793W/A/M/000`;
  });

  readonly missingFieldsMessage = computed(() => {
    const missing: string[] = [];
    if (!this.nameValid()) missing.push($localize`:@@shared.quick-create-client-dialog.ts.nom.ou.raison.sociale.7341f504:nom ou raison sociale`);
    if (!this.emailValid()) missing.push('email');
    if (!this.streetValid()) missing.push('rue');
    if (!this.cityValid()) missing.push('ville');
    if (!this.governorateValid()) missing.push('gouvernorat');
    if (!this.nifValid()) missing.push('matricule fiscal');
    return missing.length > 0 ? ` : ${missing.join(', ')}` : '';
  });

  submitDisabledReason(): string {
    if (this.submitting()) return $localize`:@@shared.quick-create-client-dialog.ts.creation.en.cours.cccfc6a4:Création en cours...`;
    if (!this.canSubmit()) {
      const fields = this.missingFieldsMessage().replace(/^ : /, '');
      return fields ? $localize`:@@ui.tern.champs.manquants.ou.invalides.ph.744911:Champs manquants ou invalides : ${fields}:p0:` : $localize`:@@ui.tern.completez.les.champs.obligatoires.703cef:Complétez les champs obligatoires`;
    }
    return '';
  }

  onNifBlur(): void {
    this.nifTouched.set(true);
    const normalized = cleanNif(this.nif());
    if (normalized !== this.nif()) {
      this.nif.set(normalized);
    }
  }

  onHide(): void {
    this.visibleChange.emit(false);
  }

  close(): void {
    this._dialogVisible = false;
    this.visibleChange.emit(false);
  }

  focusFirstField(): void {
    document.getElementById('quick-client-name')?.focus();
  }

  resetForm(): void {
    this.name.set('');
    this.type.set(ClientType.Individual);
    this.nif.set('');
    this.email.set('');
    this.phone.set('');
    this.street.set('');
    this.city.set('');
    this.governorate.set('');
    this.postalCode.set('');
    this.errorMessage.set(null);
    this.submitAttempted.set(false);
    this.nameTouched.set(false);
    this.emailTouched.set(false);
    this.streetTouched.set(false);
    this.cityTouched.set(false);
    this.governorateTouched.set(false);
    this.nifTouched.set(false);
  }

  private scrollToFirstInvalidField(): void {
    const checks: Array<{ valid: boolean; id: string }> = [
      { valid: this.nameValid(), id: FIELD_IDS.name },
      { valid: this.emailValid(), id: FIELD_IDS.email },
      { valid: this.streetValid(), id: FIELD_IDS.street },
      { valid: this.cityValid(), id: FIELD_IDS.city },
      { valid: this.governorateValid(), id: FIELD_IDS.governorate },
      { valid: this.nifValid(), id: FIELD_IDS.nif },
    ];
    const firstInvalid = checks.find((check) => !check.valid);
    if (!firstInvalid) return;
    document.getElementById(firstInvalid.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  private mapClientToListItem(client: Client): ClientListItem {
    return {
      id: client.id,
      code: client.code,
      name: client.name,
      email: client.email,
      phone: client.phone,
      nif: client.nif,
      type: client.type,
      typeDisplay: client.typeDisplay,
      city: client.address.city,
      governorate: client.address.governorate,
      isActive: client.isActive,
      totalInvoices: client.totalInvoices ?? 0,
      totalRevenue: client.totalRevenue ?? 0,
    };
  }

  submit(): void {
    this.submitAttempted.set(true);
    if (!this.canSubmit() || this.submitting()) {
      this.scrollToFirstInvalidField();
      return;
    }

    this.errorMessage.set(null);
    this.submitting.set(true);

    const normalizedNif = cleanNif(this.nif());
    const request: CreateClientRequest = {
      name: this.name().trim(),
      email: this.email().trim() || null,
      phone: this.phone().trim() || undefined,
      nif: normalizedNif || undefined,
      type: this.type(),
      street: this.street().trim(),
      city: this.city().trim(),
      postalCode: this.postalCode().trim() || undefined,
      governorate: this.governorate(),
    };

    this.clientService.createClient(request).pipe(
      switchMap((response) => {
        if (!response.success || !response.data) {
          this.submitting.set(false);
          this.errorMessage.set(response.message || $localize`:@@shared.quick-create-client-dialog.ts.impossible.de.creer.le.client.8c980488:Impossible de créer le client.`);
          return of(null);
        }
        return this.clientService.getClient(response.data);
      })
    ).subscribe({
      next: (getResponse) => {
        this.submitting.set(false);
        if (!getResponse) return;
        if (getResponse.success && getResponse.data) {
          const client = getResponse.data;
          this.clientCreated.emit({
            listItem: this.mapClientToListItem(client),
            street: client.address.street,
            postalCode: client.address.postalCode ?? null,
          });
          this.close();
          return;
        }
        this.errorMessage.set(
          getResponse.message || $localize`:@@shared.quick-create-client-dialog.ts.le.client.a.ete.cree.mais.n.a.pas.pu.etr.64e36dbf:Le client a été créé mais n'a pas pu être chargé. Réessayez la sélection.`
        );
      },
      error: (err: HttpErrorResponse) => {
        this.submitting.set(false);
        if (err.status === 409) {
          this.errorMessage.set($localize`:@@shared.quick-create-client-dialog.ts.un.client.existe.deja.avec.cet.email.ou.6506038c:Un client existe déjà avec cet email ou ce matricule fiscal.`);
        } else if (err.status === 403) {
          this.errorMessage.set($localize`:@@shared.quick-create-client-dialog.ts.vous.n.avez.pas.la.permission.de.creer.u.98c5dfe5:Vous n'avez pas la permission de créer un client.`);
        } else {
          const message = this.errorHandler.extractErrorMessage(err);
          this.errorMessage.set(message || $localize`:@@shared.quick-create-client-dialog.ts.impossible.de.creer.le.client.8c980488:Impossible de créer le client.`);
        }
      },
    });
  }
}
