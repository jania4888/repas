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
  SupplierService,
  SupplierType,
  CreateSupplierRequest,
} from '@core/services/supplier.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { HttpErrorResponse } from '@angular/common/http';
import { EMAIL_PATTERN, NIF_PATTERN, TUNISIAN_GOVERNORATES } from '@shared/validation';
import { canonicalizeNif } from '@shared/validation/validation-rules';

export interface QuickCreateSupplierPrefill {
  name?: string | null;
  type?: SupplierType;
  nif?: string | null;
  street?: string | null;
  city?: string | null;
  postalCode?: string | null;
  governorate?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface QuickCreatedSupplier {
  id: string;
  name: string;
}

interface TypeOption {
  label: string;
  value: SupplierType;
}

interface GovernorateOption {
  label: string;
  value: string;
}

const TYPE_OPTIONS: TypeOption[] = [
  { label: $localize`:@@shared.components.quick-create-supplier-dialog.ts.particulier.1a2b3c40:Particulier`, value: SupplierType.Individual },
  { label: $localize`:@@shared.components.quick-create-supplier-dialog.ts.entreprise.1a2b3c41:Entreprise`, value: SupplierType.Business },
];

const GOVERNORATE_OPTIONS: GovernorateOption[] = TUNISIAN_GOVERNORATES.map((g) => ({ label: g, value: g }));

/**
 * Modale de création rapide de fournisseur, utilisée notamment par le flux
 * d'import de bon de réception quand le fournisseur extrait du document
 * n'est pas rapproché d'un fournisseur existant. Modèle sur
 * QuickCreateClientDialogComponent, avec détection de doublon et reprise sur
 * conflit (409) sur le modèle de third-party-quick-create.component.ts.
 */
@Component({
  selector: 'app-quick-create-supplier-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, DialogModule, InputTextModule, InputMaskModule, SelectModule, ButtonComponent],
  template: `
    <p-dialog
      header="Créer un fournisseur" i18n-header="@@shared.components.quick-create-supplier-dialog.ts.creer.un.fournisseur.1a2b3c42"
      [(visible)]="visible"
      [modal]="true"
      [style]="{ width: '640px', maxWidth: '95vw' }"
      [draggable]="false"
      [closable]="true"
      (onHide)="onHide()">
      <div class="qcsd-content">
        <div class="form-fields">
          <div class="form-block">
            <div class="form-group">
              <label for="qcsd-name"><ng-container i18n="@@shared.components.quick-create-supplier-dialog.ts.nom.ou.raison.sociale.1a2b3c43">Nom ou raison sociale </ng-container> <span class="required">*</span></label>
              <input pInputText id="qcsd-name" [ngModel]="name()" (ngModelChange)="onNameChange($event)" (blur)="nameTouched.set(true)" class="w-full" [class.ng-invalid]="showNameError()" />
              @if (showNameError()) {
                <div class="field-error" role="alert"><i class="pi pi-exclamation-circle"></i><span>{{ nameErrorMessage() }}</span></div>
              }
            </div>
            <div class="form-row">
              <div class="form-group">
                <label for="qcsd-type" i18n="@@shared.components.quick-create-supplier-dialog.ts.type.1a2b3c44">Type</label>
                <p-select id="qcsd-type" [options]="typeOptions" [ngModel]="type()" (ngModelChange)="type.set($event)"
                  optionLabel="label" optionValue="value" appendTo="body" [overlayOptions]="drawerOverlayOptions" styleClass="w-full" />
              </div>
              <div class="form-group">
                <label for="qcsd-nif"><ng-container i18n="@@shared.components.quick-create-supplier-dialog.ts.nif.matricule.fiscal.1a2b3c45">NIF / Matricule fiscal </ng-container>@if (type() === SupplierType.Business) {<span class="required">*</span>}</label>
                <p-inputMask id="qcsd-nif" [ngModel]="nif()" (ngModelChange)="onNifChange($event)" (onBlur)="nifTouched.set(true)"
                  mask="9999999a/a/a/999" placeholder="Ex. 1772793W/A/M/000" i18n-placeholder="@@shared.components.quick-create-supplier-dialog.ts.ex.1772793w.a.m.000.1a2b3c46"
                  styleClass="w-full" [class.ng-invalid]="showNifError()" />
                @if (showNifError()) {
                  <div class="field-error" role="alert"><i class="pi pi-exclamation-circle"></i><span i18n="@@shared.components.quick-create-supplier-dialog.ts.matricule.fiscal.invalide.1a2b3c47">Matricule fiscal invalide</span></div>
                }
              </div>
            </div>
          </div>
          <div class="form-block">
            <div class="form-group">
              <label for="qcsd-email" i18n="@@shared.components.quick-create-supplier-dialog.ts.email.1a2b3c48">Email</label>
              <input pInputText id="qcsd-email" type="email" [ngModel]="email()" (ngModelChange)="email.set($event)" (blur)="emailTouched.set(true)" class="w-full" [class.ng-invalid]="showEmailError()" />
              @if (showEmailError()) {
                <div class="field-error" role="alert"><i class="pi pi-exclamation-circle"></i><span i18n="@@shared.components.quick-create-supplier-dialog.ts.email.invalide.1a2b3c49">Email invalide</span></div>
              }
            </div>
            <div class="form-group">
              <label for="qcsd-phone" i18n="@@shared.components.quick-create-supplier-dialog.ts.telephone.1a2b3c4a">Téléphone</label>
              <input pInputText id="qcsd-phone" [ngModel]="phone()" (ngModelChange)="phone.set($event)" class="w-full" />
            </div>
          </div>
          <div class="form-block">
            <div class="form-group">
              <label for="qcsd-street"><ng-container i18n="@@shared.components.quick-create-supplier-dialog.ts.rue.1a2b3c4b">Rue </ng-container> <span class="required">*</span></label>
              <input pInputText id="qcsd-street" [ngModel]="street()" (ngModelChange)="street.set($event)" (blur)="streetTouched.set(true)" class="w-full" [class.ng-invalid]="showStreetError()" />
              @if (showStreetError()) {
                <div class="field-error" role="alert"><i class="pi pi-exclamation-circle"></i><span i18n="@@shared.components.quick-create-supplier-dialog.ts.ce.champ.est.obligatoire.1a2b3c4c">Ce champ est obligatoire</span></div>
              }
            </div>
            <div class="form-row">
              <div class="form-group">
                <label for="qcsd-city"><ng-container i18n="@@shared.components.quick-create-supplier-dialog.ts.ville.1a2b3c4d">Ville </ng-container> <span class="required">*</span></label>
                <input pInputText id="qcsd-city" [ngModel]="city()" (ngModelChange)="city.set($event)" (blur)="cityTouched.set(true)" class="w-full" [class.ng-invalid]="showCityError()" />
                @if (showCityError()) {
                  <div class="field-error" role="alert"><i class="pi pi-exclamation-circle"></i><span i18n="@@shared.components.quick-create-supplier-dialog.ts.ce.champ.est.obligatoire.1a2b3c4c">Ce champ est obligatoire</span></div>
                }
              </div>
              <div class="form-group">
                <label for="qcsd-governorate"><ng-container i18n="@@shared.components.quick-create-supplier-dialog.ts.gouvernorat.1a2b3c4e">Gouvernorat </ng-container> <span class="required">*</span></label>
                <p-select id="qcsd-governorate" [options]="governorateOptions" [ngModel]="governorate()" (ngModelChange)="governorate.set($event)" (onChange)="governorateTouched.set(true)"
                  optionLabel="label" optionValue="value" appendTo="body" [overlayOptions]="drawerOverlayOptions" styleClass="w-full" [class.ng-invalid]="showGovernorateError()" />
                @if (showGovernorateError()) {
                  <div class="field-error" role="alert"><i class="pi pi-exclamation-circle"></i><span i18n="@@shared.components.quick-create-supplier-dialog.ts.ce.champ.est.obligatoire.1a2b3c4c">Ce champ est obligatoire</span></div>
                }
              </div>
            </div>
            <div class="form-group">
              <label for="qcsd-postal" i18n="@@shared.components.quick-create-supplier-dialog.ts.code.postal.1a2b3c4f">Code postal</label>
              <input pInputText id="qcsd-postal" [ngModel]="postalCode()" (ngModelChange)="postalCode.set($event)" class="w-full" />
            </div>
          </div>
        </div>

        @if (duplicates().length > 0) {
          <div class="duplicates" role="status">
            <i class="pi pi-info-circle"></i>
            <div>
              <strong i18n="@@shared.components.quick-create-supplier-dialog.ts.fournisseurs.similaires.1a2b3c50">Fournisseurs similaires existants</strong>
              <ul>
                @for (d of duplicates(); track d.id) {
                  <li>
                    {{ d.name }}{{ d.nif ? ' — ' + d.nif : '' }}
                    <app-button variant="outline" size="sm" (clicked)="useExisting.emit({ id: d.id, name: d.name })" i18n="@@shared.components.quick-create-supplier-dialog.ts.utiliser.1a2b3c51">Utiliser</app-button>
                  </li>
                }
              </ul>
            </div>
          </div>
        }

        @if (errorMessage()) {
          <div class="error-message" role="alert">
            <i class="pi pi-exclamation-triangle"></i>
            <span>{{ errorMessage() }}</span>
            @if (conflictSupplierId()) {
              <app-button variant="outline" size="sm" (clicked)="useConflicting()" i18n="@@shared.components.quick-create-supplier-dialog.ts.utiliser.ce.fournisseur.1a2b3c52">Utiliser ce fournisseur</app-button>
            }
          </div>
        }
      </div>
      <ng-template pTemplate="footer">
        <div class="dialog-footer">
          <app-button variant="outline" icon="pi-times" iconPos="left" (click)="close()" i18n="@@shared.components.quick-create-supplier-dialog.ts.annuler.1a2b3c53">Annuler</app-button>
          <app-button variant="primary" icon="pi-plus" iconPos="left" [disabled]="submitting() || !canSubmit()" (click)="submit()">
            {{ submitting() ? locCreation : locCreerEtSelectionner }}
          </app-button>
        </div>
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    .qcsd-content { padding: 0; }
    .form-fields { display: flex; flex-direction: column; gap: var(--spacing-3); }
    .form-block { display: flex; flex-direction: column; gap: var(--spacing-3); }
    .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: var(--spacing-4); }
    .form-group { display: flex; flex-direction: column; gap: var(--spacing-1); }
    .form-group label { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--color-text-primary); margin-bottom: var(--spacing-2); }
    .required { color: var(--color-error-600); margin-inline-start: var(--spacing-1); }
    .field-error { display: flex; align-items: center; gap: var(--spacing-2); margin-top: var(--spacing-1); font-size: var(--font-size-sm); color: var(--color-error-600); }
    .duplicates { display: flex; align-items: flex-start; gap: var(--spacing-2); padding: var(--spacing-3) var(--spacing-4); margin-top: var(--spacing-4); background: var(--color-warning-50, #fffbeb); color: var(--color-warning-800, #92400e); border-radius: var(--radius-md); font-size: var(--font-size-sm); }
    .duplicates ul { list-style: none; margin: var(--spacing-2) 0 0; padding: 0; display: flex; flex-direction: column; gap: var(--spacing-2); }
    .duplicates li { display: flex; align-items: center; justify-content: space-between; gap: var(--spacing-2); }
    .error-message { display: flex; align-items: center; gap: var(--spacing-2); padding: var(--spacing-3) var(--spacing-4); margin-top: var(--spacing-4); background: var(--color-error-50); color: var(--color-error-700); border-radius: var(--radius-md); font-size: var(--font-size-sm); flex-wrap: wrap; }
    .dialog-footer { display: flex; justify-content: flex-end; gap: var(--spacing-4); }
    @media (max-width: 520px) { .form-row { grid-template-columns: 1fr; } }
    :host ::ng-deep .p-select { width: 100%; }
  `]
})
export class QuickCreateSupplierDialogComponent {
  protected readonly locCreation = $localize`:@@shared.components.quick-create-supplier-dialog.ts.creation.1a2b3c54:Création...`;
  protected readonly locCreerEtSelectionner = $localize`:@@shared.components.quick-create-supplier-dialog.ts.creer.et.selectionner.1a2b3c55:Créer et sélectionner`;
  readonly SupplierType = SupplierType;

  @Input() set visible(value: boolean) {
    const wasVisible = this._visible;
    this._visible = value;
    if (value && !wasVisible) {
      this.resetForm();
      this.applyPrefill(this._prefill);
    }
  }
  get visible(): boolean { return this._visible; }
  private _visible = false;

  @Input() set prefill(value: QuickCreateSupplierPrefill | null) {
    this._prefill = value;
    if (this._visible) this.applyPrefill(value);
  }
  get prefill(): QuickCreateSupplierPrefill | null { return this._prefill; }
  private _prefill: QuickCreateSupplierPrefill | null = null;

  @Output() visibleChange = new EventEmitter<boolean>();
  @Output() supplierCreated = new EventEmitter<QuickCreatedSupplier>();
  /** Émis quand l'utilisateur choisit d'utiliser un doublon détecté (pré-check ou 409). */
  @Output() useExisting = new EventEmitter<QuickCreatedSupplier>();

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.visible) this.close();
  }

  private readonly supplierService = inject(SupplierService);
  private readonly errorHandler = inject(ErrorHandlerService);

  readonly drawerOverlayOptions: OverlayOptions = { baseZIndex: 1200 };
  readonly typeOptions = TYPE_OPTIONS;
  readonly governorateOptions = GOVERNORATE_OPTIONS;

  readonly name = signal('');
  readonly type = signal<SupplierType>(SupplierType.Business);
  readonly nif = signal('');
  readonly email = signal('');
  readonly phone = signal('');
  readonly street = signal('');
  readonly city = signal('');
  readonly governorate = signal('');
  readonly postalCode = signal('');

  readonly submitting = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly conflictSupplierId = signal<string | null>(null);
  readonly submitAttempted = signal(false);
  readonly duplicates = signal<{ id: string; name: string; nif: string | null }[]>([]);

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
    if (this.type() !== SupplierType.Business) return true;
    const normalized = canonicalizeNif(this.nif());
    return normalized.length > 0 && NIF_PATTERN.test(normalized);
  });

  readonly canSubmit = computed(() =>
    this.nameValid() && this.emailValid() && this.streetValid() && this.cityValid() && this.governorateValid() && this.nifValid()
  );

  readonly showNameError = computed(() => (this.submitAttempted() || this.nameTouched()) && !this.nameValid());
  readonly showEmailError = computed(() => (this.submitAttempted() || this.emailTouched()) && !this.emailValid());
  readonly showStreetError = computed(() => (this.submitAttempted() || this.streetTouched()) && !this.streetValid());
  readonly showCityError = computed(() => (this.submitAttempted() || this.cityTouched()) && !this.cityValid());
  readonly showGovernorateError = computed(() => (this.submitAttempted() || this.governorateTouched()) && !this.governorateValid());
  readonly showNifError = computed(() => (this.submitAttempted() || this.nifTouched()) && !this.nifValid());

  readonly nameErrorMessage = computed(() =>
    this.name().trim().length === 0
      ? $localize`:@@shared.components.quick-create-supplier-dialog.ts.ce.champ.est.obligatoire.1a2b3c4c:Ce champ est obligatoire`
      : $localize`:@@shared.components.quick-create-supplier-dialog.ts.min.2.caracteres.1a2b3c56:Min. 2 caractères`
  );

  private resetForm(): void {
    this.name.set('');
    this.type.set(SupplierType.Business);
    this.nif.set('');
    this.email.set('');
    this.phone.set('');
    this.street.set('');
    this.city.set('');
    this.governorate.set('');
    this.postalCode.set('');
    this.errorMessage.set(null);
    this.conflictSupplierId.set(null);
    this.submitAttempted.set(false);
    this.duplicates.set([]);
    this.nameTouched.set(false);
    this.emailTouched.set(false);
    this.streetTouched.set(false);
    this.cityTouched.set(false);
    this.governorateTouched.set(false);
    this.nifTouched.set(false);
  }

  private applyPrefill(prefill: QuickCreateSupplierPrefill | null): void {
    if (!prefill) return;
    if (prefill.name) this.name.set(prefill.name);
    if (prefill.type !== undefined) this.type.set(prefill.type);
    if (prefill.nif) this.nif.set(prefill.nif);
    if (prefill.street) this.street.set(prefill.street);
    if (prefill.city) this.city.set(prefill.city);
    if (prefill.postalCode) this.postalCode.set(prefill.postalCode);
    if (prefill.governorate) this.governorate.set(prefill.governorate);
    if (prefill.email) this.email.set(prefill.email);
    if (prefill.phone) this.phone.set(prefill.phone);
    this.searchDuplicates();
  }

  onNameChange(value: string): void {
    this.name.set(value);
    this.searchDuplicates();
  }

  onNifChange(value: string): void {
    this.nif.set(value);
    this.searchDuplicates();
  }

  /** Garde anti-doublon, avant soumission : recherche par matricule fiscal puis par nom. */
  private searchDuplicates(): void {
    const name = this.name().trim();
    const nif = canonicalizeNif(this.nif());
    const terms = [nif, name].filter((t) => t.length >= 2);
    if (terms.length === 0) {
      this.duplicates.set([]);
      return;
    }
    this.supplierService.getSuppliers({ search: terms[0], page: 1, pageSize: 5, skipGlobalErrorUi: true }).subscribe({
      next: (res) => {
        const items = res.data?.items ?? [];
        this.duplicates.set(items.slice(0, 5).map((i) => ({ id: i.id, name: i.name, nif: i.nif })));
      },
      error: () => this.duplicates.set([])
    });
  }

  onHide(): void {
    this.visibleChange.emit(false);
  }

  close(): void {
    this._visible = false;
    this.visibleChange.emit(false);
  }

  useConflicting(): void {
    const id = this.conflictSupplierId();
    if (!id) return;
    this.supplierService.getSupplier(id).subscribe((res) => {
      if (res.success && res.data) {
        this.useExisting.emit({ id: res.data.id, name: res.data.name });
        this.close();
      }
    });
  }

  submit(): void {
    this.submitAttempted.set(true);
    if (!this.canSubmit() || this.submitting()) return;

    this.errorMessage.set(null);
    this.conflictSupplierId.set(null);
    this.submitting.set(true);

    const request: CreateSupplierRequest = {
      name: this.name().trim(),
      type: this.type(),
      nif: this.type() === SupplierType.Business ? canonicalizeNif(this.nif()) : undefined,
      street: this.street().trim(),
      city: this.city().trim(),
      postalCode: this.postalCode().trim() || undefined,
      governorate: this.governorate().trim(),
      email: this.email().trim() || null,
      phone: this.phone().trim() || undefined,
      paymentTermDays: 30,
    };

    this.supplierService.createSupplier(request).subscribe({
      next: (res) => {
        this.submitting.set(false);
        if (res.success && res.data) {
          this.supplierCreated.emit({ id: res.data, name: request.name });
          this.close();
        } else {
          this.errorMessage.set(res.message || $localize`:@@shared.components.quick-create-supplier-dialog.ts.impossible.de.creer.le.fournisseur.1a2b3c57:Impossible de créer le fournisseur.`);
        }
      },
      error: (err: HttpErrorResponse) => {
        this.submitting.set(false);
        if (err.status === 409) {
          const data = err.error?.data as { existingSupplierId?: string } | undefined;
          if (data?.existingSupplierId) {
            this.conflictSupplierId.set(data.existingSupplierId);
          }
          this.errorMessage.set(err.error?.message || $localize`:@@shared.components.quick-create-supplier-dialog.ts.un.fournisseur.avec.ces.informations.existe.de.1a2b3c58:Un fournisseur avec ces informations existe déjà.`);
        } else {
          const message = this.errorHandler.extractErrorMessage(err);
          this.errorMessage.set(message || $localize`:@@shared.components.quick-create-supplier-dialog.ts.impossible.de.creer.le.fournisseur.1a2b3c57:Impossible de créer le fournisseur.`);
        }
      }
    });
  }
}
