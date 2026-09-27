/// <reference types="@angular/localize" />
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { InputSwitchModule } from 'primeng/inputswitch';
import { TagModule } from 'primeng/tag';
import { ToastService } from '@core/services/toast.service';
import { ErrorMessageService } from '@core/services/error-message.service';
import {
  EmployeeService,
  CreateEmployeeRequest,
  DependentParentClaim,
  EmployeeDetail,
  UpdateEmployeeRequest
} from '@core/services/employee.service';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { FormSectionComponent } from '@shared/components/form-section/form-section.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { tunisianPayrollValidators, formatValidationError } from '@core/validators/tunisian-payroll.validators';
import { MARITAL_STATUS_OPTIONS, TUNISIAN_GOVERNORATE_OPTIONS } from '../payroll-options';

function toIsoDate(value: Date | null | undefined): string | undefined {
  if (!value) return undefined;
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseIsoDate(value?: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

@Component({
  selector: 'app-employee-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterModule,
    InputTextModule,
    InputNumberModule,
    SelectModule,
    DatePickerModule,
    InputSwitchModule,
    TagModule,
    PageHeaderComponent,
    BreadcrumbComponent,
    FormSectionComponent,
    ButtonComponent
  ],
  template: `
    <app-breadcrumb [items]="breadcrumbItems()" />

    <app-page-header
      [title]="isEditMode() ? loc_ui_tern_modifier_le_salarie_ae2e4e : loc_ui_tern_nouveau_salarie_c5cbf8"
      [subtitle]="isEditMode() ? loc_ui_tern_mettez_a_jour_le_dossier_salarie_37a607 : loc_ui_tern_creez_un_dossier_salarie_et_ses_informatio_2bab8b">
      <app-button variant="outline" icon="pi-times" iconPos="left" [routerLink]="routeBase() + '/employees'" i18n="@@payroll.employees.annuler.49ba3292">Annuler</app-button>
    </app-page-header>

    @if (loading()) {
      <p i18n="@@payroll.employees.chargement.01cba1df">Chargement…</p>
    } @else {
      <form [formGroup]="form" (ngSubmit)="onSubmit()">
        <app-form-section title="Identité" i18n-title="@@payroll.employees.identite.3138be1c" icon="pi-id-card" [number]="1">
          <div class="payroll-form-row">
            <div class="payroll-form-group">
              <label for="employeeNumber"><ng-container i18n="@@payroll.employees.matricule.8f74c132">Matricule </ng-container> <span class="required" i18n="@@payroll.employees.text.df58248c">*</span></label>
              <input pInputText id="employeeNumber" formControlName="employeeNumber" class="w-full" [class.ng-invalid]="isInvalid('employeeNumber')" />
              @if (isInvalid('employeeNumber')) {
                <div class="field-error">{{ fieldError('employeeNumber') }}</div>
              }
            </div>
            <div class="payroll-form-group">
              <label for="cin" i18n="@@payroll.employees.cin.748d5d16">CIN</label>
              <input pInputText id="cin" formControlName="cin" class="w-full" [class.ng-invalid]="isInvalid('cin')" />
              <span class="field-hint" i18n="@@payroll.employees.8.chiffres.ex.12345678.527de8d0">8 chiffres (ex. 12345678)</span>
              @if (isInvalid('cin')) {
                <div class="field-error">{{ fieldError('cin') }}</div>
              }
            </div>
            <div class="payroll-form-group">
              <label for="cnssNumber" i18n="@@payroll.employees.n.cnss.7f5891f3">N° CNSS</label>
              <input pInputText id="cnssNumber" formControlName="cnssNumber" class="w-full" [class.ng-invalid]="isInvalid('cnssNumber')" />
              <span class="field-hint" i18n="@@payroll.employees.10.chiffres.sans.espaces.112df24e">10 chiffres sans espaces</span>
              @if (isInvalid('cnssNumber')) {
                <div class="field-error">{{ fieldError('cnssNumber') }}</div>
              }
            </div>
          </div>
          <div class="payroll-form-row">
            <div class="payroll-form-group">
              <label for="category" i18n="@@payroll.employees.categorie.6b38300a">Catégorie</label>
              <input pInputText id="category" formControlName="category" class="w-full" />
            </div>
            <div class="payroll-form-group">
              <label for="echelon" i18n="@@payroll.employees.echelon.8d0277a5">Échelon</label>
              <input pInputText id="echelon" formControlName="echelon" class="w-full" />
            </div>
          </div>
          <div class="payroll-form-row">
            <div class="payroll-form-group">
              <label for="firstName"><ng-container i18n="@@payroll.employees.prenom.e4387ade">Prénom </ng-container> <span class="required" i18n="@@payroll.employees.text.df58248c">*</span></label>
              <input pInputText id="firstName" formControlName="firstName" class="w-full" [class.ng-invalid]="isInvalid('firstName')" />
              @if (isInvalid('firstName')) {
                <div class="field-error">{{ fieldError('firstName') }}</div>
              }
            </div>
            <div class="payroll-form-group">
              <label for="lastName"><ng-container i18n="@@payroll.employees.nom.7ff20370">Nom </ng-container> <span class="required" i18n="@@payroll.employees.text.df58248c">*</span></label>
              <input pInputText id="lastName" formControlName="lastName" class="w-full" [class.ng-invalid]="isInvalid('lastName')" />
              @if (isInvalid('lastName')) {
                <div class="field-error">{{ fieldError('lastName') }}</div>
              }
            </div>
          </div>
          <div class="payroll-form-row">
            <div class="payroll-form-group">
              <label for="dateOfBirth" i18n="@@payroll.employees.date.de.naissance.8851f385">Date de naissance</label>
              <p-datepicker id="dateOfBirth" formControlName="dateOfBirth" dateFormat="dd/mm/yy" [showIcon]="true" styleClass="w-full" />
            </div>
            <div class="payroll-form-group">
              <label for="hireDate"><ng-container i18n="@@payroll.employees.date.d.embauche.a42fd436">Date d'embauche </ng-container> <span class="required" i18n="@@payroll.employees.text.df58248c">*</span></label>
              <p-datepicker id="hireDate" formControlName="hireDate" dateFormat="dd/mm/yy" [showIcon]="true" styleClass="w-full" />
              @if (isInvalid('hireDate')) {
                <div class="field-error">{{ fieldError('hireDate') }}</div>
              }
            </div>
          </div>
        </app-form-section>

        <app-form-section title="Situation familiale & contact" i18n-title="@@payroll.employees.situation.familiale.contact.c9751437" icon="pi-users" [number]="2">
          <div class="payroll-form-row">
            <div class="payroll-form-group">
              <label for="maritalStatus" i18n="@@payroll.employees.situation.familiale.3b708781">Situation familiale</label>
              <p-select id="maritalStatus" [options]="maritalStatusOptions" formControlName="maritalStatus" optionLabel="label" optionValue="value" styleClass="w-full" />
            </div>
            <div class="payroll-form-group">
              <label for="dependentChildren" i18n="@@payroll.employees.enfants.a.charge.d024299f">Enfants à charge</label>
              <p-inputNumber id="dependentChildren" formControlName="dependentChildren" [min]="0" styleClass="w-full" />
            </div>
            <div class="payroll-form-group switch-group">
              <label for="isHeadOfFamily" i18n="@@payroll.employees.chef.de.famille.0ba5a38a">Chef de famille</label>
              <p-inputSwitch id="isHeadOfFamily" formControlName="isHeadOfFamily" />
            </div>
          </div>
          <div class="payroll-form-row">
            <div class="payroll-form-group">
              <label for="studentChildren" i18n="@@payroll.employees.dont.etudiants.non.boursiers.lt.25.ans.ac38c774">Dont étudiants (non boursiers, &lt; 25 ans)</label>
              <p-inputNumber id="studentChildren" formControlName="studentChildren" [min]="0" styleClass="w-full" />
              <span class="field-hint" i18n="@@payroll.employees.deduction.irpp.majoree.315b142c">Déduction IRPP majorée</span>
            </div>
            <div class="payroll-form-group">
              <label for="disabledChildren" i18n="@@payroll.employees.dont.infirmes.486cedf0">Dont infirmes</label>
              <p-inputNumber id="disabledChildren" formControlName="disabledChildren" [min]="0" styleClass="w-full" />
              <span class="field-hint" i18n="@@payroll.employees.deduction.majoree.sans.limite.de.rang.f11ea99e">Déduction majorée, sans limite de rang</span>
            </div>
          </div>
          @if (form.errors?.['familyCounts'] && form.touched) {
            <div class="field-error">{{ form.errors?.['familyCounts'] }}</div>
          }

          <div class="parent-claims" formArrayName="dependentParentClaims">
            <div class="parent-claims-header">
              <div>
                <strong i18n="@@payroll.employees.parents.a.charge.ce5fcb65">Parents à charge</strong>
                <span class="field-hint" i18n="@@payroll.employees.un.parent.cin.ne.peut.etre.declare.que.par.un.se.d34a224b">Un parent (CIN) ne peut être déclaré que par un seul salarié de l'entreprise.</span>
              </div>
              <app-button
                type="button"
                variant="outline"
                icon="pi-plus"
                iconPos="left"
                [disabled]="dependentParentClaims.length >= 2"
                (click)="addParentClaim()" i18n="@@payroll.employees.ajouter.un.parent.a870b210"> Ajouter un parent </app-button>
            </div>
            @if (legacyIncomplete()) {
              <p-tag value="Parents à compléter — saisissez les CIN pour activer la déduction" severity="warn" />
            }
            @for (ctrl of dependentParentClaims.controls; track $index; let i = $index) {
              <div class="parent-claim-row" [formGroupName]="i">
                <div class="payroll-form-group">
                  <label [for]="'kinship' + i" i18n="@@payroll.employees.lien.e2639e1d">Lien</label>
                  <p-select
                    [inputId]="'kinship' + i"
                    [options]="kinshipOptions"
                    formControlName="kinship"
                    optionLabel="label"
                    optionValue="value"
                    styleClass="w-full" />
                </div>
                <div class="payroll-form-group">
                  <label [for]="'parentCin' + i"><ng-container i18n="@@payroll.employees.cin.parent.cb5cda16">CIN parent </ng-container> <span class="required" i18n="@@payroll.employees.text.df58248c">*</span></label>
                  <input
                    pInputText
                    [id]="'parentCin' + i"
                    formControlName="parentCin"
                    class="w-full"
                    [class.ng-invalid]="isClaimInvalid(i, 'parentCin')" />
                  @if (isClaimInvalid(i, 'parentCin')) {
                    <div class="field-error">{{ claimFieldError(i, 'parentCin') }}</div>
                  }
                </div>
                <div class="payroll-form-group">
                  <label [for]="'parentFirstName' + i" i18n="@@payroll.employees.prenom.e4387ade">Prénom</label>
                  <input pInputText [id]="'parentFirstName' + i" formControlName="firstName" class="w-full" />
                </div>
                <div class="payroll-form-group">
                  <label [for]="'parentLastName' + i" i18n="@@payroll.employees.nom.7ff20370">Nom</label>
                  <input pInputText [id]="'parentLastName' + i" formControlName="lastName" class="w-full" />
                </div>
                <div class="parent-claim-actions">
                  <app-button type="button" variant="danger" icon="pi-trash" iconPos="left" (click)="removeParentClaim(i)" i18n="@@payroll.employees.retirer.54ec24a1"> Retirer </app-button>
                </div>
              </div>
            }
            @if (dependentParentClaims.length === 0) {
              <p class="field-hint" i18n="@@payroll.employees.aucun.parent.declare.la.deduction.parents.a.char.1151a5a9">Aucun parent déclaré — la déduction parents à charge ne sera pas appliquée.</p>
            }
          </div>

          <div class="payroll-form-row">
            <div class="payroll-form-group">
              <label for="email" i18n="@@payroll.employees.email.84add5b2">Email</label>
              <input pInputText id="email" formControlName="email" class="w-full" [class.ng-invalid]="isInvalid('email')" />
              @if (isInvalid('email')) {
                <div class="field-error">{{ fieldError('email') }}</div>
              }
            </div>
            <div class="payroll-form-group">
              <label for="phone" i18n="@@payroll.employees.telephone.d3b023ea">Téléphone</label>
              <input pInputText id="phone" formControlName="phone" class="w-full" [class.ng-invalid]="isInvalid('phone')" />
              @if (isInvalid('phone')) {
                <div class="field-error">{{ fieldError('phone') }}</div>
              }
            </div>
            <div class="payroll-form-group">
              <label for="rib" i18n="@@payroll.employees.rib.61f3ea57">RIB</label>
              <input pInputText id="rib" formControlName="rib" class="w-full" [class.ng-invalid]="isInvalid('rib')" />
              <span class="field-hint" i18n="@@payroll.employees.20.chiffres.compte.bancaire.tunisien.e8ab5a63">20 chiffres (compte bancaire tunisien)</span>
              @if (isInvalid('rib')) {
                <div class="field-error">{{ fieldError('rib') }}</div>
              }
            </div>
          </div>
        </app-form-section>

        <app-form-section title="Adresse" i18n-title="@@payroll.employees.adresse.522e1466" icon="pi-map-marker" [number]="3">
          <div class="payroll-form-group">
            <label for="street" i18n="@@payroll.employees.rue.53f787b0">Rue</label>
            <input pInputText id="street" formControlName="street" class="w-full" />
          </div>
          <div class="payroll-form-group">
            <label for="streetLine2" i18n="@@payroll.employees.complement.d.adresse.fba484a7">Complément d'adresse</label>
            <input pInputText id="streetLine2" formControlName="streetLine2" class="w-full" />
          </div>
          <div class="payroll-form-row">
            <div class="payroll-form-group">
              <label for="city" i18n="@@payroll.employees.ville.97217611">Ville</label>
              <input pInputText id="city" formControlName="city" class="w-full" />
            </div>
            <div class="payroll-form-group">
              <label for="postalCode" i18n="@@payroll.employees.code.postal.74779109">Code postal</label>
              <input pInputText id="postalCode" formControlName="postalCode" class="w-full" />
            </div>
            <div class="payroll-form-group">
              <label for="governorate" i18n="@@payroll.employees.gouvernorat.b9cd1d99">Gouvernorat</label>
              <p-select id="governorate" [options]="governorateOptions" formControlName="governorate" optionLabel="label" optionValue="value" [showClear]="true" styleClass="w-full" />
              @if (isInvalid('governorate')) {
                <div class="field-error">{{ fieldError('governorate') }}</div>
              }
            </div>
          </div>
        </app-form-section>

        <div class="form-actions">
          <app-button type="submit" variant="primary" icon="pi-check" iconPos="left" [disabled]="form.invalid || saving()">
            {{ isEditMode() ? loc_ui_tern_enregistrer_f7c8bc : loc_ui_tern_creer_le_salarie_20b7cb }}
          </app-button>
        </div>
      </form>
    }
  `,
  styles: [`
    .required { color: var(--color-error-600); }
    .form-actions { margin-top: var(--spacing-6); display: flex; gap: var(--spacing-3); }
    .switch-group { justify-content: flex-end; }
    .w-full { width: 100%; }
    .parent-claims { margin: var(--spacing-4) 0; display: flex; flex-direction: column; gap: var(--spacing-3); }
    .parent-claims-header { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--spacing-3); flex-wrap: wrap; }
    .parent-claim-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: var(--spacing-3); padding: var(--spacing-3); border: 1px solid var(--surface-border, #e5e7eb); border-radius: 8px; }
    .parent-claim-actions { display: flex; align-items: flex-end; }
  `]
})
export class EmployeeFormComponent implements OnInit {
  readonly loc_ui_tern_modifier_le_salarie_ae2e4e = $localize`:@@ui.tern.modifier.le.salarie.ae2e4e:Modifier le salarié`;
  readonly loc_ui_tern_nouveau_salarie_c5cbf8 = $localize`:@@ui.tern.nouveau.salarie.c5cbf8:Nouveau salarié`;
  readonly loc_ui_tern_mettez_a_jour_le_dossier_salarie_37a607 = $localize`:@@ui.tern.mettez.a.jour.le.dossier.salarie.37a607:Mettez à jour le dossier salarié.`;
  readonly loc_ui_tern_creez_un_dossier_salarie_et_ses_informatio_2bab8b = $localize`:@@ui.tern.creez.un.dossier.salarie.et.ses.informatio.2bab8b:Créez un dossier salarié et ses informations de base.`;
  readonly loc_ui_tern_enregistrer_f7c8bc = $localize`:@@ui.tern.enregistrer.f7c8bc:Enregistrer`;
  readonly loc_ui_tern_creer_le_salarie_20b7cb = $localize`:@@ui.tern.creer.le.salarie.20b7cb:Créer le salarié`;
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly employees = inject(EmployeeService);
  private readonly toast = inject(ToastService);
  readonly errorMessageService = inject(ErrorMessageService);

  readonly maritalStatusOptions = MARITAL_STATUS_OPTIONS;
  readonly governorateOptions = TUNISIAN_GOVERNORATE_OPTIONS;
  readonly kinshipOptions = [
    { label: $localize`:@@payroll.employee-form.ts.pere.3b0ae0ae:Père`, value: 'Father' },
    { label: $localize`:@@payroll.employee-form.ts.mere.0c653389:Mère`, value: 'Mother' }
  ];
  loading = signal(false);
  saving = signal(false);
  employeeId = signal<string | null>(null);
  routeBase = signal('/payroll');
  parentClaimsStatus = signal<string>('None');
  legacyDependentParents = signal(0);
  isEditMode = computed(() => !!this.employeeId());
  legacyIncomplete = computed(() =>
    this.parentClaimsStatus() === 'Incomplete'
    || (this.legacyDependentParents() > 0 && this.dependentParentClaims.length === 0));

  form: FormGroup = this.fb.group({
    employeeNumber: ['', Validators.required],
    firstName: ['', Validators.required],
    lastName: ['', Validators.required],
    cin: ['', tunisianPayrollValidators.cin],
    cnssNumber: ['', tunisianPayrollValidators.cnss],
    category: [''],
    echelon: [''],
    dateOfBirth: [null as Date | null],
    hireDate: [null as Date | null, Validators.required],
    maritalStatus: ['Single'],
    isHeadOfFamily: [false],
    dependentChildren: [0, Validators.min(0)],
    studentChildren: [0, Validators.min(0)],
    disabledChildren: [0, Validators.min(0)],
    dependentParentClaims: this.fb.array([]),
    email: ['', Validators.email],
    phone: ['', tunisianPayrollValidators.phone],
    rib: ['', tunisianPayrollValidators.rib],
    street: [''],
    streetLine2: [''],
    city: [''],
    postalCode: [''],
    governorate: ['', tunisianPayrollValidators.governorate]
  }, { validators: tunisianPayrollValidators.familyCounts });

  get dependentParentClaims(): FormArray {
    return this.form.get('dependentParentClaims') as FormArray;
  }

  breadcrumbItems = computed((): BreadcrumbItem[] => [
    { label: $localize`:@@payroll.employee-form.ts.salaries.ce68387d:Salariés`, route: `${this.routeBase()}/employees` },
    { label: this.isEditMode() ? $localize`:@@ui.tern.modifier.f260e7:Modifier` : $localize`:@@ui.tern.nouveau.b9676c:Nouveau` }
  ]);

  ngOnInit(): void {
    const data = this.route.snapshot.data;
    this.routeBase.set(data['payrollRouteBase'] ?? '/payroll');
    const id = this.route.snapshot.paramMap.get('id');
    if (id && id !== 'new') {
      this.employeeId.set(id);
      this.form.get('employeeNumber')?.disable();
      this.form.get('hireDate')?.disable();
      this.loadEmployee(id);
    } else {
      this.form.patchValue({ hireDate: new Date() });
    }
  }

  addParentClaim(claim?: DependentParentClaim): void {
    if (this.dependentParentClaims.length >= 2) return;
    this.dependentParentClaims.push(this.createParentClaimGroup(claim));
  }

  removeParentClaim(index: number): void {
    this.dependentParentClaims.removeAt(index);
  }

  isInvalid(field: string): boolean {
    const c = this.form.get(field);
    return !!(c?.invalid && c?.touched);
  }

  fieldError(field: string): string {
    const c = this.form.get(field);
    return formatValidationError(c?.errors ?? null)
      ?? this.errorMessageService.getErrorMessage(c);
  }

  isClaimInvalid(index: number, field: string): boolean {
    const c = this.dependentParentClaims.at(index)?.get(field);
    return !!(c?.invalid && c?.touched);
  }

  claimFieldError(index: number, field: string): string {
    const c = this.dependentParentClaims.at(index)?.get(field);
    return formatValidationError(c?.errors ?? null)
      ?? this.errorMessageService.getErrorMessage(c);
  }

  private createParentClaimGroup(claim?: DependentParentClaim): FormGroup {
    return this.fb.group({
      parentCin: [claim?.parentCin ?? '', [Validators.required, tunisianPayrollValidators.cin]],
      kinship: [claim?.kinship ?? 'Father', Validators.required],
      firstName: [claim?.firstName ?? ''],
      lastName: [claim?.lastName ?? '']
    });
  }

  private loadEmployee(id: string): void {
    this.loading.set(true);
    this.employees.getById(id).subscribe({
      next: res => {
        if (res.data) this.populateForm(res.data);
        this.loading.set(false);
      },
      error: () => {
        this.toast.add({ severity: 'error', summary: $localize`:@@employee-form.component.summary.Salarié:Salarié`, detail: $localize`:@@employee-form.component.detail.Salari_introuva:Salarié introuvable.` });
        this.router.navigate([this.routeBase() + '/employees']);
        this.loading.set(false);
      }
    });
  }

  private populateForm(e: EmployeeDetail): void {
    this.parentClaimsStatus.set(e.parentClaimsStatus ?? 'None');
    this.legacyDependentParents.set(e.dependentParents ?? 0);
    this.dependentParentClaims.clear();
    for (const claim of e.dependentParentClaims ?? []) {
      this.addParentClaim(claim);
    }

    this.form.patchValue({
      employeeNumber: e.employeeNumber,
      firstName: e.firstName,
      lastName: e.lastName,
      cin: e.cin ?? '',
      cnssNumber: e.cnssNumber ?? '',
      category: e.category ?? '',
      echelon: e.echelon ?? '',
      dateOfBirth: parseIsoDate(e.dateOfBirth),
      hireDate: parseIsoDate(e.hireDate),
      maritalStatus: e.maritalStatus,
      isHeadOfFamily: e.isHeadOfFamily,
      dependentChildren: e.dependentChildren,
      studentChildren: e.studentChildren ?? 0,
      disabledChildren: e.disabledChildren ?? 0,
      email: e.email ?? '',
      phone: e.phone ?? '',
      rib: e.rib ?? '',
      street: e.address?.street ?? '',
      streetLine2: e.address?.streetLine2 ?? '',
      city: e.address?.city ?? '',
      postalCode: e.address?.postalCode ?? '',
      governorate: e.address?.governorate ?? ''
    });
  }

  private buildClaimsPayload(): DependentParentClaim[] {
    return this.dependentParentClaims.controls.map(ctrl => {
      const v = ctrl.getRawValue();
      return {
        parentCin: (v.parentCin as string).trim(),
        kinship: v.kinship as string,
        firstName: (v.firstName as string)?.trim() || undefined,
        lastName: (v.lastName as string)?.trim() || undefined
      };
    });
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    const raw = this.form.getRawValue();
    const claims = this.buildClaimsPayload();

    if (this.isEditMode()) {
      const body: UpdateEmployeeRequest = {
        firstName: raw.firstName,
        lastName: raw.lastName,
        cin: raw.cin || undefined,
        cnssNumber: raw.cnssNumber || undefined,
        category: raw.category || undefined,
        echelon: raw.echelon || undefined,
        dateOfBirth: toIsoDate(raw.dateOfBirth),
        maritalStatus: raw.maritalStatus,
        isHeadOfFamily: raw.isHeadOfFamily,
        dependentChildren: raw.dependentChildren ?? 0,
        studentChildren: raw.studentChildren ?? 0,
        disabledChildren: raw.disabledChildren ?? 0,
        dependentParents: claims.length,
        dependentParentClaims: claims,
        street: raw.street || undefined,
        streetLine2: raw.streetLine2 || undefined,
        city: raw.city || undefined,
        postalCode: raw.postalCode || undefined,
        governorate: raw.governorate || undefined,
        email: raw.email || undefined,
        phone: raw.phone || undefined,
        rib: raw.rib || undefined
      };
      this.employees.update(this.employeeId()!, body).subscribe({
        next: () => {
          this.toast.add({ severity: 'success', summary: $localize`:@@employee-form.component.summary.Salarié:Salarié`, detail: $localize`:@@employee-form.component.detail.Dossier mis :Dossier mis à jour.` });
          this.router.navigate([this.routeBase() + '/employees', this.employeeId()]);
          this.saving.set(false);
        },
        error: err => {
          this.toast.add({
            severity: 'error',
            summary: $localize`:@@employee-form.component.summary.Salarié:Salarié`,
            detail: err.error?.message ?? err.error?.errors?.[0] ?? $localize`:@@ui.tern.enregistrement.impossible.206044:Enregistrement impossible.`
          });
          this.saving.set(false);
        }
      });
    } else {
      const body: CreateEmployeeRequest = {
        employeeNumber: raw.employeeNumber,
        firstName: raw.firstName,
        lastName: raw.lastName,
        cin: raw.cin || undefined,
        cnssNumber: raw.cnssNumber || undefined,
        category: raw.category || undefined,
        echelon: raw.echelon || undefined,
        dateOfBirth: toIsoDate(raw.dateOfBirth),
        hireDate: toIsoDate(raw.hireDate)!,
        maritalStatus: raw.maritalStatus,
        isHeadOfFamily: raw.isHeadOfFamily,
        dependentChildren: raw.dependentChildren ?? 0,
        studentChildren: raw.studentChildren ?? 0,
        disabledChildren: raw.disabledChildren ?? 0,
        dependentParents: claims.length,
        dependentParentClaims: claims,
        street: raw.street || undefined,
        streetLine2: raw.streetLine2 || undefined,
        city: raw.city || undefined,
        postalCode: raw.postalCode || undefined,
        governorate: raw.governorate || undefined,
        email: raw.email || undefined,
        phone: raw.phone || undefined,
        rib: raw.rib || undefined
      };
      this.employees.create(body).subscribe({
        next: res => {
          if (res.success && res.data) {
            this.toast.add({ severity: 'success', summary: $localize`:@@employee-form.component.summary.Salarié:Salarié`, detail: $localize`:@@employee-form.component.detail.Salarié créé:Salarié créé.` });
            this.router.navigate([this.routeBase() + '/employees', res.data]);
          }
          this.saving.set(false);
        },
        error: err => {
          this.toast.add({
            severity: 'error',
            summary: $localize`:@@employee-form.component.summary.Salarié:Salarié`,
            detail: err.error?.message ?? err.error?.errors?.[0] ?? $localize`:@@ui.tern.creation.impossible.5661a5:Création impossible.`
          });
          this.saving.set(false);
        }
      });
    }
  }
}
