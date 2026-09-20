import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MenuItem, MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { PasswordModule } from 'primeng/password';
import { SelectModule } from 'primeng/select';
import { StepsModule } from 'primeng/steps';
import { FtBadgeComponent, FtFieldErrorComponent, FtPageHeaderComponent } from '@core/ui';
import { PlatformTenantProvisioningService } from '@core/services/platform-tenant-provisioning.service';
import { PlatformPermissionsService } from '@core/services/platform-permissions.service';
import { PlatformPermission } from '@core/models/platform.models';
import { RegistrationCatalogService } from '@core/registration/registration-catalog.service';
import { evaluatePasswordRules } from '@core/registration/registration-validators';
import { TUNISIAN_GOVERNORATE_OPTIONS } from '@core/registration/tunisian-validation';
import type {
  RegistrationWarning,
  TenantProvisioningStatusValue
} from '@core/registration/registration-wizard-mode';
import { TENANTS_FR } from '../tenants.i18n.fr';
import {
  buildCreateCompanyForm,
  buildSubmitRequest,
  type CreateCompanyRawValue
} from './create-company-form.model';

type StepKey = 'sector' | 'identity' | 'modules' | 'address' | 'recap';

interface SuccessState {
  tenantId: string;
  managerEmail?: string;
  provisioningStatus: TenantProvisioningStatusValue;
  warnings: RegistrationWarning[];
  reference?: string;
}

/**
 * Assistant de création d'entreprise (backoffice plateforme).
 *
 * Choix de structure : un seul composant intelligent avec un gabarit externe, plutôt qu'un
 * composant par étape. La logique réellement testable (résolution du catalogue, construction de
 * la charge utile, validateurs) vit dans des modules purs — `registration-catalog.service.ts`,
 * `create-company-form.model.ts`, `registration-validators.ts` — testables sans TestBed, ce qui
 * rend le découpage en composants d'étape peu rentable ici et suit la convention du backoffice
 * (cf. `tenant-sector-tab.component.ts`).
 */
@Component({
  selector: 'app-platform-tenant-create-company-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    ButtonModule,
    CheckboxModule,
    InputTextModule,
    MessageModule,
    PasswordModule,
    SelectModule,
    StepsModule,
    FtPageHeaderComponent,
    FtBadgeComponent,
    FtFieldErrorComponent
  ],
  templateUrl: './platform-tenant-create-company-page.component.html',
  styleUrl: './platform-tenant-create-company-page.component.scss'
})
export class PlatformTenantCreateCompanyPageComponent {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly toast = inject(MessageService);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly provisioning = inject(PlatformTenantProvisioningService);
  private readonly permissions = inject(PlatformPermissionsService);
  protected readonly catalog = inject(RegistrationCatalogService);

  protected readonly form = buildCreateCompanyForm(this.fb);

  protected readonly stepIndex = signal(0);
  protected readonly submitting = signal(false);
  protected readonly submitError = signal<{ message: string; reference?: string } | null>(null);
  protected readonly success = signal<SuccessState | null>(null);
  protected readonly selectedModules = signal<ReadonlySet<number>>(new Set<number>());
  protected readonly moduleNotice = signal<string | null>(null);

  /** Vue triee des modules selectionnes, pour le gabarit (`@for` n'itere pas un Set). */
  protected readonly selectedModuleIds = computed(() =>
    [...this.selectedModules()].sort((a, b) => a - b)
  );

  /** Recalculé à chaque changement de segment/domaine, pour piloter l'étape « Modules ». */
  private readonly sectorSelection = signal<{ segment: string | null; domain: string | null }>({
    segment: null,
    domain: null
  });

  // Copie mutable : `p-select` type ses `options` en `any[]`, un `readonly` y est refuse.
  protected readonly governorateOptions = [...TUNISIAN_GOVERNORATE_OPTIONS];

  /** Les trois valeurs de `TaxRegime` côté serveur — `Exempt` manquait dans l'écran d'origine. */
  protected readonly taxRegimeOptions = [
    { label: 'Régime réel', value: 0 },
    { label: 'Forfaitaire', value: 1 },
    { label: 'Exonéré', value: 2 }
  ];

  protected readonly planOptions = [
    { label: 'Gratuit', value: 0 },
    { label: 'Mensuel', value: 1 },
    { label: 'Annuel', value: 2 }
  ];

  protected readonly canChoosePlan = computed(
    () => this.permissions.isLoaded() && this.permissions.has(PlatformPermission.SubscriptionChangePlan)
  );

  /** Catalogue désactivé sur l'instance : secteur et modules n'auraient aucun effet. */
  protected readonly sectorEnabled = computed(() => !this.catalog.isDisabled());

  protected readonly visibleSteps = computed<StepKey[]>(() =>
    this.sectorEnabled()
      ? ['sector', 'identity', 'modules', 'address', 'recap']
      : ['identity', 'address', 'recap']
  );

  protected readonly steps = computed<MenuItem[]>(() =>
    this.visibleSteps().map(key => ({ label: this.t(`create.step.${key}` as keyof typeof TENANTS_FR) }))
  );

  protected readonly currentStep = computed<StepKey>(
    () => this.visibleSteps()[this.stepIndex()] ?? 'identity'
  );

  protected readonly isLastStep = computed(() => this.stepIndex() === this.visibleSteps().length - 1);

  protected readonly passwordRules = computed(() =>
    evaluatePasswordRules(this.identityGroup.get('password')?.value as string)
  );

  protected readonly availableDomains = computed(() =>
    this.catalog.domainsForSegment(this.sectorSelection().segment)
  );

  protected readonly segmentOptions = computed(() =>
    this.catalog.segments().map(s => ({ label: s.labelFr, value: s.code, description: s.descriptionFr }))
  );

  protected readonly domainOptions = computed(() =>
    this.availableDomains().map(d => ({ label: d.labelFr, value: d.code }))
  );

  protected readonly coreModuleIds = computed(() => this.catalog.coreModuleIds());

  protected readonly recommendedModuleIds = computed(() => {
    const { segment, domain } = this.sectorSelection();
    return this.catalog
      .recommendedModuleIds(segment, domain)
      .filter(id => !this.coreModuleIds().includes(id));
  });

  protected readonly optionalModuleIds = computed(() => {
    const { segment, domain } = this.sectorSelection();
    return this.catalog
      .optionalModuleIds(segment, domain)
      .filter(id => !this.coreModuleIds().includes(id) && !this.catalog.isLockedOnFreePlan(id));
  });

  protected readonly premiumModuleIds = computed(() => {
    const { segment, domain } = this.sectorSelection();
    return [...this.recommendedModuleIds(), ...this.catalog.optionalModuleIds(segment, domain)]
      .filter(id => this.catalog.isLockedOnFreePlan(id))
      .filter((id, index, all) => all.indexOf(id) === index);
  });

  protected readonly taxRegimeSuggestion = computed(() =>
    this.catalog.suggestedTaxRegimeFor(this.sectorSelection().segment)
  );

  constructor() {
    this.catalog.load().subscribe(() => {
      // Le catalogue peut arriver après le premier rendu : réaligner l'index si le nombre
      // d'étapes a changé (mode désactivé), et pré-remplir les recommandations.
      this.stepIndex.update(i => Math.min(i, this.visibleSteps().length - 1));
      this.resetModuleSelection();
    });

    if (!this.permissions.isLoaded()) {
      this.permissions.load().subscribe();
    }
  }

  protected get sectorGroup(): FormGroup {
    return this.form.get('sector') as FormGroup;
  }

  protected get identityGroup(): FormGroup {
    return this.form.get('identity') as FormGroup;
  }

  protected get addressGroup(): FormGroup {
    return this.form.get('address') as FormGroup;
  }

  protected get recapGroup(): FormGroup {
    return this.form.get('recap') as FormGroup;
  }

  protected t(key: keyof typeof TENANTS_FR): string {
    return TENANTS_FR[key];
  }

  protected moduleLabel(moduleId: number): string {
    return this.catalog.moduleLabelFor(moduleId);
  }

  protected isModuleSelected(moduleId: number): boolean {
    return this.selectedModules().has(moduleId);
  }

  /** Changer de segment invalide le domaine : un couple incohérent est refusé par le serveur. */
  protected onSegmentChange(segmentCode: string): void {
    this.sectorGroup.patchValue({ businessDomain: '' });
    this.sectorSelection.set({ segment: segmentCode || null, domain: null });
    this.applySegmentDefaults(segmentCode);
    this.resetModuleSelection();
  }

  protected onDomainChange(domainCode: string): void {
    this.sectorSelection.update(s => ({ ...s, domain: domainCode || null }));
    this.resetModuleSelection();
  }

  /**
   * Bascule un module optionnel. Activer tire automatiquement ses prérequis ; désactiver est
   * refusé tant qu'un module sélectionné en dépend — c'est la règle que le serveur appliquerait
   * de toute façon, autant l'expliquer ici.
   */
  protected toggleModule(moduleId: number): void {
    this.moduleNotice.set(null);
    const next = new Set(this.selectedModules());

    if (next.has(moduleId)) {
      const dependents = this.catalog.dependentsOf(moduleId, next);
      if (dependents.length > 0) {
        this.moduleNotice.set(
          this.t('create.modules.blocked').replace(
            '{modules}',
            dependents.map(id => this.moduleLabel(id)).join(', ')
          )
        );
        return;
      }
      next.delete(moduleId);
    } else {
      next.add(moduleId);
      const pulled = this.catalog.requiredBy(moduleId).filter(id => !next.has(id));
      pulled.forEach(id => next.add(id));
      if (pulled.length > 0) {
        this.moduleNotice.set(
          this.t('create.modules.autoAdded').replace(
            '{modules}',
            pulled.map(id => this.moduleLabel(id)).join(', ')
          )
        );
      }
    }

    this.selectedModules.set(next);
  }

  protected next(): void {
    const group = this.groupForStep(this.currentStep());
    if (group && group.invalid) {
      group.markAllAsTouched();
      this.submitError.set({ message: this.t('create.error.stepInvalid') });
      this.scrollToFirstInvalid();
      return;
    }

    this.submitError.set(null);
    this.stepIndex.update(i => Math.min(this.visibleSteps().length - 1, i + 1));
  }

  protected prev(): void {
    this.submitError.set(null);
    this.stepIndex.update(i => Math.max(0, i - 1));
  }

  protected goToStep(step: StepKey): void {
    const index = this.visibleSteps().indexOf(step);
    if (index >= 0) this.stepIndex.set(index);
  }

  protected onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.submitError.set({ message: this.t('create.error.stepInvalid') });
      this.scrollToFirstInvalid();
      return;
    }

    const raw = this.form.getRawValue() as CreateCompanyRawValue;
    const payload = buildSubmitRequest(raw, [...this.selectedModules()], {
      sectorEnabled: this.sectorEnabled()
    });

    if (!this.canChoosePlan()) {
      // Le serveur retomberait de toute façon sur le forfait gratuit ; ne pas le demander.
      delete payload.plan;
    }

    this.submitting.set(true);
    this.submitError.set(null);

    this.provisioning.createCompany(payload).subscribe(result => {
      this.submitting.set(false);

      if (result.success && result.tenantId) {
        this.success.set({
          tenantId: result.tenantId,
          managerEmail: result.managerEmail ?? raw.identity.email,
          provisioningStatus: result.provisioningStatus ?? 'Ready',
          warnings: result.registrationWarnings ?? [],
          reference: result.reference
        });
        this.toast.add({ severity: 'success', summary: this.t('create.success.title') });
        return;
      }

      this.submitError.set({
        message: result.message ?? this.t('create.error.title'),
        reference: result.reference
      });
    });
  }

  protected successTitle(): string {
    const status = this.success()?.provisioningStatus ?? 'Ready';
    if (status === 'Pending') return this.t('create.success.titlePending');
    if (status === 'Failed') return this.t('create.success.titleFailed');
    return this.t('create.success.title');
  }

  protected successHint(): string | null {
    const status = this.success()?.provisioningStatus ?? 'Ready';
    if (status === 'Pending') return this.t('create.success.pendingHint');
    if (status === 'Failed') return this.t('create.success.failedHint');
    return null;
  }

  protected warningSeverity(warning: RegistrationWarning): 'info' | 'warn' {
    return warning.severity === 'warning' ? 'warn' : 'info';
  }

  protected openTenant(): void {
    const tenantId = this.success()?.tenantId;
    if (tenantId) void this.router.navigate(['/tenants', tenantId]);
  }

  protected createAnother(): void {
    this.form.reset();
    this.selectedModules.set(new Set<number>());
    this.sectorSelection.set({ segment: null, domain: null });
    this.success.set(null);
    this.submitError.set(null);
    this.stepIndex.set(0);
  }

  protected cancel(): void {
    void this.router.navigate(['/tenants']);
  }

  private groupForStep(step: StepKey): FormGroup | null {
    switch (step) {
      case 'sector':
        return this.sectorGroup;
      case 'identity':
        return this.identityGroup;
      case 'address':
        return this.addressGroup;
      case 'recap':
        return this.recapGroup;
      case 'modules':
        // Aucune contrainte : le socle suffit à créer un dossier exploitable.
        return null;
    }
  }

  private applySegmentDefaults(segmentCode: string): void {
    const warehouse = this.catalog.defaultWarehouseName(segmentCode);
    if (warehouse) {
      this.addressGroup.patchValue({ warehouseName: warehouse });
    }

    const suggestion = this.catalog.suggestedTaxRegimeFor(segmentCode);
    if (suggestion && !this.addressGroup.get('taxRegime')?.dirty) {
      this.addressGroup.patchValue({ taxRegime: suggestion.regime });
    }
  }

  /** Les recommandations sont pré-cochées mais restent décochables. */
  private resetModuleSelection(): void {
    this.moduleNotice.set(null);
    this.selectedModules.set(new Set<number>(this.recommendedModuleIds()));
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
