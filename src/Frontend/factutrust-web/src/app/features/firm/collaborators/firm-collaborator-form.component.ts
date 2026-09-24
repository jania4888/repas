import { Component, OnInit, ViewChild, inject, signal } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { CheckboxModule } from 'primeng/checkbox';
import { SelectButtonModule } from 'primeng/selectbutton';
import { MultiSelectModule } from 'primeng/multiselect';
import { TabsModule } from 'primeng/tabs';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import {
  CollaboratorCivility,
  CreateFirmUserPayload,
  FirmCollaboratorsService,
  FirmUser,
  FirmUserRole,
  UpdateFirmUserPayload
} from '@core/services/firm-collaborators.service';
import { downloadBlob } from '@features/accounting/shared/accounting-download.util';
import { FirmGovernanceService } from '@core/services/firm-governance.service';
import {
  FirmCollaboratorPayrollOnboardingComponent
} from './firm-collaborator-payroll-onboarding.component';
import {
  AUTH_PASSWORD_MIN_LENGTH,
  AUTH_PASSWORD_MIN_UNIQUE_CHARS,
  optionalAuthPasswordValidator
} from '@features/auth/shared/auth-password.helpers';

type FormMode = 'create' | 'edit' | 'view';

/**
 * Characters Identity accepts in a login name — the email doubles as one. `Validators.email` alone
 * lets `'`, `!` or `#` through, which the server then refuses.
 */
const IDENTITY_USERNAME_CHARSET = /^[A-Za-z0-9._@+-]*$/;

/** "Informations générales" tab, which holds the email and password fields. */
const GENERAL_TAB = 0;

@Component({
  selector: 'app-firm-collaborator-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    RouterModule,
    ButtonModule,
    InputTextModule,
    SelectModule,
    CheckboxModule,
    SelectButtonModule,
    MultiSelectModule,
    TabsModule,
    PageHeaderComponent,
    FirmCollaboratorPayrollOnboardingComponent
  ],
  template: `
    <app-page-header [title]="title" [subtitle]="subtitle">
      <p-button label="Retour" icon="pi pi-arrow-left" [outlined]="true" (onClick)="back()"></p-button>
      <p-button
        *ngIf="mode !== 'view'"
        label="Enregistrer"
        icon="pi pi-save"
        [loading]="saving()"
        [disabled]="form.invalid || saving() || payrollFormInvalid()"
        (onClick)="save()"></p-button>
      <p-button *ngIf="mode !== 'view'" label="Annuler" [outlined]="true" (onClick)="back()"></p-button>
      <p-button
        *ngIf="mode === 'view' && collaborator()"
        label="Modifier"
        icon="pi pi-pencil"
        (onClick)="goEdit()"></p-button>
      <p-button
        *ngIf="mode === 'edit' && collaborator() && !collaborator()!.emailConfirmed"
        label="Renvoyer le lien de création de compte"
        icon="pi pi-envelope"
        [outlined]="true"
        [loading]="resending()"
        (onClick)="resendInvite()"></p-button>
    </app-page-header>

    <div class="fc-card" *ngIf="!loading(); else loadingTpl">
      <p-tabs [(value)]="activeTab" [lazy]="true">
        <p-tablist>
          <p-tab [value]="0">Informations générales</p-tab>
          <p-tab [value]="1" *ngIf="autoProvisionEnabled()">Paie</p-tab>
          <p-tab [value]="autoProvisionEnabled() ? 2 : 1" [disabled]="mode === 'create' || !collaborator()">Binômes</p-tab>
        </p-tablist>
        <p-tabpanels>
        <p-tabpanel [value]="0">
          <form [formGroup]="form" class="form-grid">
            <label class="full">Civilité
              <p-selectButton
                formControlName="civility"
                [options]="civilityOptions"
                optionLabel="label"
                optionValue="value"
                [disabled]="readOnly"></p-selectButton>
            </label>
            <label>Nom
              <input pInputText formControlName="lastName" placeholder="Nom" />
            </label>
            <label>Prénom
              <input pInputText formControlName="firstName" placeholder="Prénom" />
            </label>
            <label>Qualification
              <input pInputText formControlName="qualification" placeholder="Qualification" />
            </label>
            <label>Email
              <input pInputText formControlName="email" placeholder="Email" [readonly]="mode !== 'create'" />
              <small class="field-error" *ngIf="form.controls.email.hasError('pattern')">
                Caractères autorisés : lettres sans accent, chiffres et . _ - + &#64;
              </small>
              <small class="field-error" *ngIf="form.controls.email.hasError('server')">
                {{ form.controls.email.getError('server') }}
              </small>
            </label>
            <div class="full payroll-link-row" *ngIf="mode !== 'create'">
              <strong>Salarié paie lié</strong>
              <span *ngIf="payrollLinkLabel(); else noPayrollLink">{{ payrollLinkLabel() }}</span>
              <ng-template #noPayrollLink>
                <span class="hint">Aucune liaison — la synchronisation par email ou la page Coûts collaborateurs permet de lier un salarié.</span>
              </ng-template>
              <p-button
                label="Modifier la liaison"
                icon="pi pi-link"
                [outlined]="true"
                size="small"
                (onClick)="goPayrollCosts()"></p-button>
            </div>
            <label>Téléphone mobile professionnel
              <input pInputText formControlName="phoneNumber" placeholder="+216…" />
            </label>
            <label>Téléphone fixe
              <input pInputText formControlName="phoneLandline" placeholder="+216…" />
            </label>
            <label class="full checkbox-row">
              <p-checkbox formControlName="useFirmAddress" [binary]="true" inputId="useFirmAddress" [disabled]="readOnly"></p-checkbox>
              <span>Utiliser la même adresse du cabinet</span>
            </label>
            <label class="full">Adresse
              <input pInputText formControlName="addressLine" placeholder="Adresse" />
            </label>
            <label>Code postal
              <input pInputText formControlName="postalCode" placeholder="Code postal" />
            </label>
            <label>Ville
              <input pInputText formControlName="city" placeholder="Ville" />
            </label>
            <label>Pays
              <input pInputText formControlName="country" placeholder="Pays" />
            </label>
            <label>Rôle
              <p-select
                formControlName="role"
                [options]="roleOptions"
                optionLabel="label"
                optionValue="value"
                [disabled]="readOnly"
                appendTo="body"></p-select>
            </label>
            <label *ngIf="mode === 'create'">Mot de passe (optionnel — laissez vide pour invitation)
              <input pInputText type="password" formControlName="password" placeholder="Mot de passe" autocomplete="new-password" />
              <small class="hint">{{ passwordHint }}</small>
              <small class="field-error" *ngIf="form.controls.password.hasError('passwordPolicy')">
                Il manque : {{ form.controls.password.getError('passwordPolicy').missing.join(', ') }}.
              </small>
              <small class="field-error" *ngIf="form.controls.password.hasError('server')">
                {{ form.controls.password.getError('server') }}
              </small>
            </label>
            <label *ngIf="mode === 'create'" class="full checkbox-row">
              <p-checkbox formControlName="sendInvite" [binary]="true" inputId="sendInvite"></p-checkbox>
              <span>Envoyer une invitation par email</span>
            </label>
            <div class="full cni-block">
              <div class="cni-row">
                <strong>Copie de carte d'identité (PDF)</strong>
                <span *ngIf="collaborator()?.hasCni" class="cni-ok">Fichier présent</span>
              </div>
              <input *ngIf="!readOnly" type="file" accept=".pdf,application/pdf" (change)="onCniSelected($event)" />
              <div class="cni-actions" *ngIf="collaborator()?.hasCni">
                <p-button label="Télécharger" icon="pi pi-download" [outlined]="true" size="small" (onClick)="downloadCni()"></p-button>
                <p-button *ngIf="!readOnly" label="Supprimer" icon="pi pi-trash" severity="danger" [outlined]="true" size="small" (onClick)="deleteCni()"></p-button>
              </div>
            </div>
          </form>
        </p-tabpanel>

        <p-tabpanel [value]="1" *ngIf="autoProvisionEnabled()">
          <app-firm-collaborator-payroll-onboarding
            #payrollOnboarding
            [identity]="collaboratorIdentity()" />
        </p-tabpanel>

        <p-tabpanel [value]="autoProvisionEnabled() ? 2 : 1">
          <div class="binomes" *ngIf="mode !== 'create' && collaborator(); else noBinomes">
            <p class="hint">Sélectionnez les collaborateurs binômes (second manager).</p>
            <p-multiSelect
              [options]="binomeCandidates()"
              [(ngModel)]="selectedBinomeIds"
              [ngModelOptions]="{standalone: true}"
              optionLabel="label"
              optionValue="value"
              placeholder="Binômes"
              [disabled]="readOnly"
              display="chip"
              appendTo="body"
              styleClass="full-ms"></p-multiSelect>
            <p-button
              *ngIf="!readOnly"
              class="mt"
              label="Enregistrer les binômes"
              icon="pi pi-save"
              [loading]="savingBinomes()"
              (onClick)="saveBinomes()"></p-button>
          </div>
          <ng-template #noBinomes>
            <p class="hint">Enregistrez d'abord le collaborateur pour gérer les binômes.</p>
          </ng-template>
        </p-tabpanel>
        </p-tabpanels>
      </p-tabs>
    </div>

    <ng-template #loadingTpl>
      <p class="loading">Chargement…</p>
    </ng-template>
  `,
  styles: [`
    :host { display: block; }
    .fc-card {
      background: var(--color-surface, #fff);
      border: 1px solid var(--color-border-subtle, #e2e8f0);
      border-radius: var(--radius-xl, 16px);
      padding: 1rem 1.25rem 1.5rem;
    }
    .form-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: .9rem 1rem;
      max-width: 820px;
    }
    .form-grid label { display: flex; flex-direction: column; gap: .35rem; font-size: .875rem; }
    .full { grid-column: 1 / -1; }
    .checkbox-row { flex-direction: row !important; align-items: center; gap: .6rem; }
    .cni-block { display: flex; flex-direction: column; gap: .5rem; }
    .cni-row { display: flex; gap: .75rem; align-items: center; }
    .cni-ok { color: var(--color-success-600, #16a34a); font-size: .85rem; }
    .cni-actions { display: flex; gap: .5rem; }
    .payroll-link-row {
      display: flex; flex-wrap: wrap; align-items: center; gap: .5rem .75rem;
      padding: .75rem; border-radius: 12px; background: var(--color-surface-muted, #f8fafc);
    }
    .binomes { display: flex; flex-direction: column; gap: .75rem; max-width: 640px; }
    .hint { margin: 0; color: var(--color-text-secondary, #64748b); font-size: .875rem; }
    .mt { margin-top: .5rem; align-self: flex-start; }
    .loading { padding: 2rem; color: var(--color-text-secondary, #64748b); }
    .field-error { color: var(--color-danger-600, #dc2626); font-size: .8rem; }
    :host ::ng-deep .full-ms { width: 100%; }
    @media (max-width: 700px) {
      .form-grid { grid-template-columns: 1fr; }
    }
  `]
})
export class FirmCollaboratorFormComponent implements OnInit {
  @ViewChild('payrollOnboarding') payrollOnboarding?: FirmCollaboratorPayrollOnboardingComponent;

  private readonly fb = inject(FormBuilder);
  private readonly api = inject(FirmCollaboratorsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly toast = inject(ToastService);
  private readonly errorHandler = inject(ErrorHandlerService);
  private readonly governanceApi = inject(FirmGovernanceService);

  mode: FormMode = 'create';
  readOnly = false;
  title = 'Collaborateur';
  subtitle = '';

  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly resending = signal(false);
  readonly savingBinomes = signal(false);
  readonly collaborator = signal<FirmUser | null>(null);
  readonly allUsers = signal<FirmUser[]>([]);
  readonly binomeCandidates = signal<{ label: string; value: string }[]>([]);
  readonly payrollLinkLabel = signal<string | null>(null);
  readonly autoProvisionEnabled = signal(false);

  selectedBinomeIds: string[] = [];
  activeTab = GENERAL_TAB;
  readonly passwordHint =
    `${AUTH_PASSWORD_MIN_LENGTH} caractères minimum, dont une majuscule, une minuscule, un chiffre, `
    + `un caractère spécial et ${AUTH_PASSWORD_MIN_UNIQUE_CHARS} caractères différents.`;
  private pendingCni: File | null = null;
  private collaboratorId: string | null = null;

  readonly civilityOptions = [
    { label: 'Mme.', value: 1 as CollaboratorCivility },
    { label: 'M.', value: 2 as CollaboratorCivility }
  ];
  readonly roleOptions = [
    { label: 'Comptable cabinet', value: 12 as FirmUserRole },
    { label: 'Responsable cabinet', value: 11 as FirmUserRole }
  ];

  readonly form = this.fb.nonNullable.group({
    civility: [2 as CollaboratorCivility, Validators.required],
    lastName: ['', Validators.required],
    firstName: ['', Validators.required],
    qualification: [''],
    email: ['', [Validators.required, Validators.email]],
    phoneNumber: [''],
    phoneLandline: [''],
    useFirmAddress: [true],
    addressLine: [{ value: '', disabled: true }],
    postalCode: [{ value: '', disabled: true }],
    city: [{ value: '', disabled: true }],
    country: [{ value: 'Tunisie', disabled: true }],
    role: [12 as FirmUserRole, Validators.required],
    password: ['', optionalAuthPasswordValidator()],
    sendInvite: [true]
  });

  ngOnInit(): void {
    this.mode = this.resolveFormMode();

    if (this.mode === 'create') {
      this.title = "Création d'un nouveau collaborateur";
      this.subtitle = 'Informations générales';
      // Create mode only: an existing account's email is read-only and must never block saving an edit.
      this.form.controls.email.addValidators(Validators.pattern(IDENTITY_USERNAME_CHARSET));
      this.form.controls.email.updateValueAndValidity({ emitEvent: false });
      this.loadFirmAddress();
      this.loadProvisioningFlags();
    } else if (this.mode === 'edit') {
      this.title = 'Modification du collaborateur';
      this.collaboratorId = this.route.snapshot.paramMap.get('id');
      this.loadCollaborator();
    } else {
      this.readOnly = true;
      this.title = 'Consultation du collaborateur';
      this.collaboratorId = this.route.snapshot.paramMap.get('id');
      this.form.disable({ emitEvent: false });
      this.loadCollaborator();
    }

    this.form.controls.useFirmAddress.valueChanges.subscribe(checked => {
      this.onUseFirmAddressChanged(!!checked);
    });

    for (const control of [this.form.controls.email, this.form.controls.password]) {
      control.valueChanges.subscribe(() => {
        if (control.hasError('server')) {
          const { server: _server, ...rest } = control.errors ?? {};
          control.setErrors(Object.keys(rest).length ? rest : null);
        }
      });
    }
  }

  /** Resolve create/edit/view from route data, id param, and URL suffix. */
  private resolveFormMode(): FormMode {
    const id = this.route.snapshot.paramMap.get('id');
    const routeMode = this.route.snapshot.data['mode'];
    const url = this.router.url;

    if (routeMode === 'create' || !id) {
      return 'create';
    }
    if (url.endsWith('/edit')) {
      return 'edit';
    }
    return 'view';
  }

  private loadProvisioningFlags(): void {
    this.governanceApi.getPayrollProvisioningStatus().subscribe({
      next: res => {
        this.autoProvisionEnabled.set(!!res.data?.autoProvisionOnCollaboratorCreate);
      },
      error: () => this.autoProvisionEnabled.set(false)
    });
  }

  collaboratorIdentity(): { firstName: string; lastName: string; email: string } {
    const raw = this.form.getRawValue();
    return {
      firstName: raw.firstName?.trim() ?? '',
      lastName: raw.lastName?.trim() ?? '',
      email: raw.email?.trim() ?? ''
    };
  }

  payrollFormInvalid(): boolean {
    if (!this.autoProvisionEnabled() || this.mode !== 'create') return false;
    return this.payrollOnboarding?.form.invalid ?? true;
  }

  private loadFirmAddress(): void {
    this.api.getFirmAddress().subscribe({
      next: addr => {
        this.form.patchValue({
          addressLine: addr.addressLine,
          postalCode: addr.postalCode ?? '',
          city: addr.city,
          country: addr.country || 'Tunisie'
        }, { emitEvent: false });
      },
      error: () => { /* optional */ }
    });
  }

  private loadCollaborator(): void {
    if (!this.collaboratorId) return;
    this.loading.set(true);
    this.api.getById(this.collaboratorId).subscribe({
      next: user => {
        this.collaborator.set(user);
        this.subtitle = `${user.firstName} ${user.lastName}`;
        this.form.patchValue({
          civility: (user.civility ?? 2) as CollaboratorCivility,
          lastName: user.lastName,
          firstName: user.firstName,
          qualification: user.qualification ?? '',
          email: user.email,
          phoneNumber: user.phoneNumber ?? '',
          phoneLandline: user.phoneLandline ?? '',
          useFirmAddress: user.useFirmAddress,
          addressLine: user.addressLine ?? '',
          postalCode: user.postalCode ?? '',
          city: user.city ?? '',
          country: user.country ?? 'Tunisie',
          role: user.role
        }, { emitEvent: false });
        this.onUseFirmAddressChanged(user.useFirmAddress);
        if (this.readOnly) this.form.disable({ emitEvent: false });
        this.selectedBinomeIds = user.binomes.map(b => b.id);
        this.loading.set(false);
        this.loadBinomeCandidates(user.id);
        this.loadPayrollLink(user.id);
      },
      error: err => {
        this.loading.set(false);
        this.showError(this.errorHandler.extractErrorMessage(err) || 'Chargement impossible');
        void this.router.navigate(['/firm/collaborateurs']);
      }
    });
  }

  private loadBinomeCandidates(excludeId: string): void {
    this.api.list({ isActive: true }).subscribe({
      next: rows => {
        this.allUsers.set(rows);
        this.binomeCandidates.set(
          rows
            .filter(u => u.id !== excludeId)
            .map(u => ({ label: `${u.firstName} ${u.lastName}`, value: u.id }))
        );
      }
    });
  }

  private loadPayrollLink(userId: string): void {
    const year = new Date().getFullYear();
    this.governanceApi.listCollaboratorCosts(year).subscribe({
      next: res => {
        const row = (res.data ?? []).find(c => c.collaboratorUserId === userId);
        if (row?.payrollEmployeeName) {
          const source = row.payrollLinkSourceDisplay ? ` (${row.payrollLinkSourceDisplay})` : '';
          this.payrollLinkLabel.set(`${row.payrollEmployeeName}${source}`);
        } else {
          this.payrollLinkLabel.set(null);
        }
      },
      error: () => this.payrollLinkLabel.set(null)
    });
  }

  goPayrollCosts(): void {
    void this.router.navigate(['/firm/governance/collaborator-costs']);
  }

  private onUseFirmAddressChanged(useFirmAddress: boolean): void {
    const controls = [
      this.form.controls.addressLine,
      this.form.controls.postalCode,
      this.form.controls.city,
      this.form.controls.country
    ];
    if (this.readOnly) return;
    if (useFirmAddress) {
      controls.forEach(c => c.disable({ emitEvent: false }));
      this.loadFirmAddress();
    } else {
      controls.forEach(c => c.enable({ emitEvent: false }));
    }
  }

  onCniSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      this.toast.add({ severity: 'error', summary: 'Erreur', detail: 'Seuls les fichiers PDF sont acceptés' });
      input.value = '';
      return;
    }
    this.pendingCni = file;
    if (this.mode !== 'create' && this.collaboratorId) {
      this.api.uploadCni(this.collaboratorId, file).subscribe({
        next: () => {
          this.toast.add({ severity: 'success', summary: 'Collaborateurs', detail: 'CNI enregistrée' });
          this.pendingCni = null;
          this.loadCollaborator();
        },
        error: err => this.showError(this.errorHandler.extractErrorMessage(err) || 'Upload impossible')
      });
    }
  }

  downloadCni(): void {
    if (!this.collaboratorId) return;
    this.api.downloadCni(this.collaboratorId).subscribe({
      next: blob => downloadBlob(blob, 'cni.pdf'),
      error: () => this.showError('Téléchargement impossible')
    });
  }

  deleteCni(): void {
    if (!this.collaboratorId) return;
    this.api.deleteCni(this.collaboratorId).subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: 'Collaborateurs', detail: 'CNI supprimée' });
        this.loadCollaborator();
      },
      error: err => this.showError(this.errorHandler.extractErrorMessage(err) || 'Suppression impossible')
    });
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    if (this.autoProvisionEnabled() && this.mode === 'create') {
      this.payrollOnboarding?.markAllAsTouched();
      if (this.payrollFormInvalid()) {
        this.toast.add({
          severity: 'warn',
          summary: 'Paie',
          detail: 'Complétez le dossier paie (onglet Paie) avant d\'enregistrer.'
        });
        return;
      }
    }
    this.saving.set(true);
    const raw = this.form.getRawValue();

    if (this.mode === 'create') {
      const payload: CreateFirmUserPayload = {
        email: raw.email.trim(),
        firstName: raw.firstName.trim(),
        lastName: raw.lastName.trim(),
        password: raw.password?.trim() || null,
        role: raw.role,
        civility: raw.civility,
        qualification: raw.qualification?.trim() || null,
        phoneNumber: raw.phoneNumber?.trim() || null,
        phoneLandline: raw.phoneLandline?.trim() || null,
        useFirmAddress: raw.useFirmAddress,
        addressLine: raw.addressLine?.trim() || null,
        postalCode: raw.postalCode?.trim() || null,
        city: raw.city?.trim() || null,
        country: raw.country?.trim() || null,
        sendInvite: !raw.password?.trim() || raw.sendInvite
      };
      if (this.autoProvisionEnabled()) {
        const payroll = this.payrollOnboarding?.buildPayload();
        if (!payroll) {
          this.saving.set(false);
          this.toast.add({
            severity: 'warn',
            summary: 'Paie',
            detail: 'Le dossier paie est incomplet (vérifiez le matricule, les dates et le salaire).'
          });
          return;
        }
        payload.payroll = payroll;
      }
      this.api.create(payload, this.pendingCni).subscribe({
        next: user => {
          this.saving.set(false);
          const detail = user.payrollEmployeeId
            ? 'Collaborateur et salarié paie créés'
            : 'Collaborateur créé';
          this.toast.add({ severity: 'success', summary: 'Collaborateurs', detail });
          void this.router.navigate(['/firm/collaborateurs', user.id, 'edit']);
        },
        error: err => {
          this.saving.set(false);
          const detail = this.errorHandler.extractErrorMessage(err) || 'Création impossible';
          if (this.isPayrollProvisionError(detail)) {
            this.showError(
              detail.startsWith('Collaborateur non créé')
                ? detail
                : `Collaborateur non créé : ${detail}`);
            return;
          }
          this.showError(detail);
          this.applyServerFieldError(err?.error?.code, detail);
        }
      });
      return;
    }

    if (!this.collaboratorId) return;
    const payload: UpdateFirmUserPayload = {
      firstName: raw.firstName.trim(),
      lastName: raw.lastName.trim(),
      role: raw.role,
      civility: raw.civility,
      qualification: raw.qualification?.trim() || null,
      phoneNumber: raw.phoneNumber?.trim() || null,
      phoneLandline: raw.phoneLandline?.trim() || null,
      useFirmAddress: raw.useFirmAddress,
      addressLine: raw.addressLine?.trim() || null,
      postalCode: raw.postalCode?.trim() || null,
      city: raw.city?.trim() || null,
      country: raw.country?.trim() || null
    };
    this.api.update(this.collaboratorId, payload).subscribe({
      next: user => {
        this.saving.set(false);
        this.collaborator.set(user);
        this.toast.add({ severity: 'success', summary: 'Collaborateurs', detail: 'Collaborateur mis à jour' });
      },
      error: err => {
        this.saving.set(false);
        this.showError(this.errorHandler.extractErrorMessage(err) || 'Mise à jour impossible');
      }
    });
  }

  saveBinomes(): void {
    if (!this.collaboratorId) return;
    this.savingBinomes.set(true);
    this.api.setBinomes(this.collaboratorId, this.selectedBinomeIds).subscribe({
      next: () => {
        this.savingBinomes.set(false);
        this.toast.add({ severity: 'success', summary: 'Collaborateurs', detail: 'Binômes mis à jour' });
        this.loadCollaborator();
      },
      error: err => {
        this.savingBinomes.set(false);
        this.showError(this.errorHandler.extractErrorMessage(err) || 'Erreur binômes');
      }
    });
  }

  resendInvite(): void {
    if (!this.collaboratorId) return;
    this.resending.set(true);
    this.api.resendInvite(this.collaboratorId).subscribe({
      next: () => {
        this.resending.set(false);
        this.toast.add({ severity: 'success', summary: 'Collaborateurs', detail: 'Invitation renvoyée' });
      },
      error: err => {
        this.resending.set(false);
        this.showError(this.errorHandler.extractErrorMessage(err) || 'Renvoi impossible');
      }
    });
  }

  goEdit(): void {
    if (!this.collaboratorId) return;
    void this.router.navigate(['/firm/collaborateurs', this.collaboratorId, 'edit']);
  }

  back(): void {
    this.location.back();
  }

  private isPayrollProvisionError(detail: string): boolean {
    const normalized = detail.toLowerCase();
    return normalized.includes('impossible de créer le salarié paie')
      || normalized.includes('payrollprovision');
  }

  private showError(detail: string): void {
    this.toast.add({ severity: 'error', summary: 'Erreur', detail });
  }

  /**
   * Surfaces a server refusal on the offending control and brings the user back to its tab: the
   * Save button is also reachable from the Paie tab, where the field is out of sight.
   * The error code comes first; the duplicate-email wording remains a fallback for older responses.
   */
  private applyServerFieldError(code: string | undefined, detail: string): void {
    const control = code === 'Validation.Password'
      ? this.form.controls.password
      : code === 'Validation.Email' || detail.toLowerCase().includes('déjà utilis')
        ? this.form.controls.email
        : null;
    if (!control) {
      return;
    }
    control.setErrors({
      ...control.errors,
      server: detail
    });
    control.markAsTouched();
    this.activeTab = GENERAL_TAB;
  }
}
