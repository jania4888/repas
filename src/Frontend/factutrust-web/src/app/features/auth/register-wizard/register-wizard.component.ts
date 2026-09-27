import { Component, ElementRef, OnDestroy, OnInit, inject, signal, computed, effect, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { trigger, transition, style, animate } from '@angular/animations';
import { HttpErrorResponse } from '@angular/common/http';
import { timeout, TimeoutError, catchError, throwError, debounceTime, Subscription } from 'rxjs';
import {
  AuthService,
  RegisterRequest,
  RegistrationWarningDetail,
  toRegistrationWarningList,
  toRegistrationWarnings
} from '@core/services/auth.service';
import { WarehouseContextService } from '@core/services/warehouse-context.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { AppModule } from '@core/models/app-module';
import { environment } from '@environments/environment';
import { LogoComponent } from '@shared/components/logo/logo.component';
import { GOVERNORATE_OPTIONS } from '../shared/auth-governorate.options';
import {
  AUTH_PASSWORD_VALIDATORS_PATTERN,
  passwordMismatch as checkPasswordMismatch
} from '../shared/auth-password.helpers';
import {
  applyNifBlurCleanup,
  buildCompanyRegisterRequest,
  cleanNifValue,
  markAllFormControlsTouched,
  nifFormatValidator,
  scrollAuthWizardStepIntoView,
  scrollToFirstInvalidField,
  validateCompanyRegisterFormData
} from '../shared/auth-registration.helpers';
import {
  RegistrationCatalogService,
  applyProfileOverlay,
  EMPTY_PROFILE_ANSWERS,
  HeadcountBand,
  RegistrationProfileAnswers
} from './registration-catalog';
import { RegistrationDraftService } from './registration-draft.service';
import { TaxRegime } from './tax-regime.types';
import { StepCompanyTypeComponent } from './steps/step-company-type/step-company-type.component';
import { StepInformationsComponent } from './steps/step-informations/step-informations.component';
import { StepConfigurationComponent } from './steps/step-configuration/step-configuration.component';
import { StepFinalisationComponent } from './steps/step-finalisation/step-finalisation.component';
import {
  REGISTRATION_WIZARD_MODE,
  type CompanyRegistrationSubmitRequest,
} from '@core/registration/registration-wizard-mode';

interface WizardStepMeta {
  name: string;
  desc: string;
  icon: string;
  why: string[];
}

@Component({
  selector: 'app-register-wizard',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterModule,
    LogoComponent,
    StepCompanyTypeComponent,
    StepInformationsComponent,
    StepConfigurationComponent,
    StepFinalisationComponent
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
  templateUrl: './register-wizard.component.html',
  styleUrl: './register-wizard.component.scss'
})
export class RegisterWizardComponent implements OnInit, OnDestroy {
  readonly environment = environment;
  readonly catalog = inject(RegistrationCatalogService);

  private static readonly REGISTRATION_TIMEOUT_MS = 120_000;

  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private warehouseContext = inject(WarehouseContextService);
  private errorHandler = inject(ErrorHandlerService);
  private draftService = inject(RegistrationDraftService);
  readonly wizardMode = inject(REGISTRATION_WIZARD_MODE);

  readonly isPlatformMode = computed(() => this.wizardMode.mode === 'platform');
  readonly hidePublicCrossLinks = computed(
    () => this.isPlatformMode() || !!this.wizardMode.hidePublicCrossLinks
  );

  loading = signal(false);
  loadingMessage = signal($localize`:@@auth.register-wizard.ts.creation.de.votre.espace.07866544:Création de votre espace...`);
  error = signal<string | null>(null);
  /**
   * Avertissements non bloquants renvoyés par le backend après une inscription
   * réussie (ex. module demandé refusé par le plan — tâche 1.2 du plan). Tant
   * qu'ils sont présents, la redirection automatique vers le tableau de bord est
   * suspendue afin que l'utilisateur les voie avant de continuer.
   *
   * Source de vérité TYPÉE : `code` permet un libellé et une action justes par
   * avertissement (un avis NIF n'est pas un échec d'activation de module).
   */
  registrationWarningDetails = signal<RegistrationWarningDetail[]>([]);
  private pendingPlatformTenantId = signal<string | null>(null);
  /** Vue « messages seuls » — contrat historique conservé pour les appelants existants. */
  readonly registrationWarnings = computed(() => this.registrationWarningDetails().map(w => w.message));
  /**
   * Vrai dès que l'espace est créé côté serveur. État TERMINAL : le formulaire n'est plus
   * rendu ni modifiable, la navigation entre étapes est fermée et une nouvelle soumission
   * est refusée. Sans cela, l'écran d'avertissement laissait le bouton « Créer mon espace »
   * réactivé (form valide + loading=false), donc un second POST /auth/register possible.
   */
  accountCreated = signal(false);
  currentStep = signal(0);
  /** Once the user manually toggles a module, recommendation auto-recompute stops overwriting their choices. */
  modulesTouched = signal(false);
  /** True once the user manually picks a `taxRegime` — the auto-suggestion (plan §3.1) then stops overwriting it. */
  taxRegimeTouched = signal(false);
  /** Guards the `taxRegime` valueChanges subscription while `applySuggestedTaxRegime()` itself sets the value. */
  private applyingSuggestedTaxRegime = false;
  /** True right after a segment change auto-cleared an invalid `businessDomain` (plan WP-F2). */
  /** Brouillon détecté au chargement (lot 4) — la reprise est PROPOSÉE, jamais imposée. */
  pendingDraftStep = signal<number | null>(null);
  domainClearedNotice = signal(false);
  /** Module ids auto-enabled as hard dependencies by the last toggle (plan WP-F3). Cleared on the next toggle/reset. */
  lastAutoEnabled = signal<AppModule[]>([]);
  private autoEnabledHintTimer: ReturnType<typeof setTimeout> | null = null;

  private loadingMessageTimer: ReturnType<typeof setInterval> | null = null;
  private loadingStartedAt = 0;
  /** Sauvegarde automatique du brouillon — arrêtée dès que l'espace est créé (données personnelles). */
  private draftAutosave: Subscription | null = null;

  /**
   * Carte du wizard : cible de défilement au changement d'étape. Les anciens sélecteurs
   * (`.form-header-text` / `.auth-form-card`) n'existent que dans le formulaire legacy,
   * donc le défilement était un no-op ici — l'utilisateur restait au milieu de la page.
   */
  private readonly panelCard = viewChild<ElementRef<HTMLElement>>('panelCard');

  /**
   * Late-arriving remote catalog (plan WP-F1): if the fetch resolves to `'remote'`
   * after the user already picked a segment/domain but hasn't manually touched a
   * module toggle, recompute the recommendation once so Step 3 reflects real rules.
   * Fires at most once (loadState only transitions idle → loading → remote|fallback).
   * Note: `registrationWizardV2: false` serves the legacy 3-step form
   * (`features/auth/register/`), which never injects `RegistrationCatalogService` —
   * zero catalog HTTP traffic on that path.
   */
  private readonly reactToRemoteCatalog = effect(() => {
    if (this.catalog.loadState() === 'remote' && !this.modulesTouched()) {
      this.onProfileChanged();
    }
  });

  readonly stepsMeta: WizardStepMeta[] = [
    {
      name: 'Type de société',
      desc: $localize`:@@auth.register-wizard.ts.segment.et.domaine.236abb94:Segment et domaine`,
      icon: 'pi-sitemap',
      why: [
        $localize`:@@auth.register-wizard.ts.configuration.adaptee.a.votre.activite.c6aac6bd:Configuration adaptée à votre activité`,
        $localize`:@@auth.register-wizard.ts.plan.comptable.tunisien.personnalise.431a8ec2:Plan comptable tunisien personnalisé`,
        $localize`:@@auth.register-wizard.ts.modules.et.workflows.sur.mesure.bae0ed18:Modules et workflows sur mesure`,
        $localize`:@@auth.register-wizard.ts.gain.de.temps.des.le.demarrage.885c8c2f:Gain de temps dès le démarrage`
      ]
    },
    {
      name: 'Informations générales',
      desc: $localize`:@@auth.register-wizard.ts.compte.et.societe.700362e3:Compte et société`,
      icon: 'pi-id-card',
      why: [
        $localize`:@@auth.register-wizard.ts.vos.informations.restent.confidentielles.322c07ae:Vos informations restent confidentielles`,
        $localize`:@@auth.register-wizard.ts.un.seul.compte.administrateur.cree.af097d59:Un seul compte administrateur créé`,
        $localize`:@@auth.register-wizard.ts.coordonnees.utilisees.pour.les.factures.bc36f615:Coordonnées utilisées pour les factures`,
        $localize`:@@auth.register-wizard.ts.modifiable.a.tout.moment.plus.tard.5589ed4a:Modifiable à tout moment plus tard`
      ]
    },
    {
      name: 'Configuration',
      desc: $localize`:@@auth.register-wizard.ts.modules.recommandes.53b9fc7a:Modules recommandés`,
      icon: 'pi-cog',
      why: [
        $localize`:@@auth.register-wizard.ts.modules.deja.preselectionnes.pour.vous.b3dcbda6:Modules déjà présélectionnés pour vous`,
        $localize`:@@auth.register-wizard.ts.rien.n.est.fige.tout.reste.modifiable.627a2f23:Rien n’est figé : tout reste modifiable`,
        $localize`:@@auth.register-wizard.ts.activez.uniquement.ce.qui.vous.sert.73bd9600:Activez uniquement ce qui vous sert`,
        $localize`:@@auth.register-wizard.ts.parametres.tunisiens.preconfigures.cb647e73:Paramètres tunisiens préconfigurés`
      ]
    },
    {
      name: 'Finalisation',
      desc: $localize`:@@auth.register-wizard.ts.adresse.et.recapitulatif.d4bb7b00:Adresse et récapitulatif`,
      icon: 'pi-check-circle',
      why: [
        $localize`:@@auth.register-wizard.ts.verifiez.votre.espace.avant.de.le.creer.4fe0f690:Vérifiez votre espace avant de le créer`,
        $localize`:@@auth.register-wizard.ts.modifiez.toute.etape.en.un.clic.cc6bee3b:Modifiez toute étape en un clic`,
        $localize`:@@auth.register-wizard.ts.adresse.utilisee.pour.vos.documents.0214b555:Adresse utilisée pour vos documents`,
        $localize`:@@auth.register-wizard.ts.votre.espace.est.pret.en.quelques.second.5a314732:Votre espace est prêt en quelques secondes`
      ]
    }
  ];

  registrationFormAriaLabel = computed(() => {
    const cur = this.currentStep();
    const prev = cur > 0 ? $localize`:@@ui.tern.etapes.precedentes.completees.b92c63:Étapes précédentes complétées. ` : '';
    return $localize`:@@auth.register-wizard.ts.prev.etape.p.sur.length.name.07f58086:${prev}:prev:Étape ${cur + 1}:p: sur ${this.stepsMeta.length}:length: : ${this.stepsMeta[cur].name}:name:.`;
  });

  taxRegimes: TaxRegime[] = [
    { label: $localize`:@@auth.register-wizard.ts.regime.reel.ef6ee424:Régime réel`, value: 0 },
    { label: $localize`:@@auth.register-wizard.ts.regime.forfaitaire.a1dc2f7b:Régime forfaitaire`, value: 1 },
    { label: $localize`:@@auth.register-wizard.ts.exonere.5d577ae9:Exonéré`, value: 2 }
  ];

  readonly governorates = GOVERNORATE_OPTIONS;

  form: FormGroup = this.fb.group({
    // Step 1: Type de société
    companySegment: ['', Validators.required],
    businessDomain: ['', Validators.required],
    // Step 2 §Votre compte
    firstName: ['', [Validators.required, Validators.minLength(2)]],
    lastName: ['', [Validators.required, Validators.minLength(2)]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [
      Validators.required,
      Validators.minLength(12),
      Validators.pattern(AUTH_PASSWORD_VALIDATORS_PATTERN)
    ]],
    confirmPassword: ['', Validators.required],
    // Step 2 §Votre société
    companyName: ['', [Validators.required, Validators.minLength(2)]],
    // `nifFormatValidator` valide la valeur canonisée (forme carte `1234567A/B/C/000`
    // ou écriture historique encore présente avant le blur).
    // Effet : le format est signalé à l'étape 2, sous le champ, au lieu de l'être en
    // bandeau à l'étape 4 (validateCompanyRegisterFormData reste le filet de sécurité).
    nif: ['', [Validators.required, nifFormatValidator]],
    taxRegime: [null, Validators.required],
    companyEmail: ['', [Validators.required, Validators.email]],
    phone: ['', Validators.required],
    website: [''],
    warehouseName: [''],
    // Step 3: Configuration
    enabledModules: [this.recommendedSelection(null, null)],
    // Étape 3 §Profilage (lot 3) — toutes facultatives, `null` = sans réponse.
    hasPhysicalStock: [null as boolean | null],
    sellsToConsumers: [null as boolean | null],
    headcountBand: [null as HeadcountBand | null],
    accountingDelegatedToFirm: [null as boolean | null],
    // Step 4: Finalisation
    street: ['', Validators.required],
    streetLine2: [''],
    city: ['', Validators.required],
    postalCode: [''],
    governorate: ['', Validators.required],
    acceptTerms: [false, Validators.requiredTrue]
  });

  passwordMismatch(): boolean {
    return checkPasswordMismatch(this.form.get('password')?.value, this.form.get('confirmPassword')?.value);
  }

  stepHumanIndex(): number {
    return this.currentStep() + 1;
  }

  stepCount(): number {
    return this.stepsMeta.length;
  }

  selectedSegment(): string {
    return this.form.get('companySegment')?.value ?? '';
  }

  selectedDomain(): string {
    return this.form.get('businessDomain')?.value ?? '';
  }

  /** Suggested tax regime for the currently selected segment (plan §3.1). `null` when absent. */
  suggestedTaxRegime = computed(() => this.catalog.suggestedTaxRegimeFor(this.selectedSegment()) ?? null);

  ngOnInit(): void {
    this.form.get('password')?.valueChanges.subscribe(() => {
      this.form.get('confirmPassword')?.updateValueAndValidity();
    });

    this.form.get('companySegment')?.valueChanges.subscribe((newSegment: string) => {
      const domainControl = this.form.get('businessDomain');
      const currentDomain = domainControl?.value;
      const allowedDomains = this.catalog.domainsForSegment(newSegment);
      const stillAllowed = !currentDomain || allowedDomains.some(d => d.code === currentDomain);

      if (!stillAllowed) {
        // { emitEvent: false } avoids a second businessDomain valueChanges → onProfileChanged()
        // round-trip; onProfileChanged() is called once explicitly below.
        domainControl?.setValue('', { emitEvent: false });
        domainControl?.markAsUntouched();
        domainControl?.updateValueAndValidity({ emitEvent: false });
        this.domainClearedNotice.set(true);
      } else {
        this.domainClearedNotice.set(false);
      }

      this.onProfileChanged();
    });
    this.form.get('businessDomain')?.valueChanges.subscribe(() => {
      this.domainClearedNotice.set(false);
      this.onProfileChanged();
    });

    // Plan §3.1: once the user manually picks a taxRegime, stop overwriting it with
    // the sector suggestion. Ignored while `applySuggestedTaxRegime()` itself is
    // setting the value (see the guard flag).
    this.form.get('taxRegime')?.valueChanges.subscribe(() => {
      if (!this.applyingSuggestedTaxRegime) {
        this.taxRegimeTouched.set(true);
      }
    });

    // Brouillon (lot 4) : on se contente de SIGNALER sa présence. Rien n'est réinjecté tant que
    // l'utilisateur n'a pas cliqué « Reprendre » — un formulaire qui se remplit tout seul au
    // chargement est déroutant, et les CGU ne sont de toute façon jamais restaurées.
    const draft = this.draftService.load();
    if (draft) {
      this.pendingDraftStep.set(draft.step);
    }

    // Désabonné dès la création de l'espace : sans cela, la moindre interaction sur l'écran
    // final réécrivait le brouillon (nom, e-mail, NIF, téléphone, adresse) dans sessionStorage
    // APRÈS le `draftService.clear()` de succès.
    this.draftAutosave = this.form.valueChanges.pipe(debounceTime(600)).subscribe(() => {
      if (this.loading() || this.accountCreated()) {
        return;
      }
      this.draftService.save(this.form.getRawValue(), this.currentStep());
    });

    // Fetch the live sector catalog once; no-op if the frontend kill-switch is off or
    // a fetch already ran this session (see RegistrationCatalogService.load()).
    this.catalog.load();
  }

  ngOnDestroy(): void {
    this.stopDraftAutosave();
    this.clearLoadingMessageTimer();
    if (this.autoEnabledHintTimer) {
      clearTimeout(this.autoEnabledHintTimer);
      this.autoEnabledHintTimer = null;
    }
  }

  /**
   * Sélection soumise au backend : modules cœur + recommandations du profil.
   *
   * `catalog.recommendedModules()` exclut délibérément les modules cœur en mode distant (c'est le
   * contrat d'AFFICHAGE : ils sont rendus à part, en cartes « Inclus », non basculables) alors que
   * le repli statique `recommendedModulesFor()` les inclut. Composer explicitement le cœur ici rend
   * `enabledModules` identique dans les deux modes, de sorte que basculer le drapeau
   * `sectorCatalogHttp` ne change plus la charge envoyée — un kill-switch doit être neutre.
   */
  private recommendedSelection(segment: string | null, domain: string | null): AppModule[] {
    const selection = new Set<AppModule>(this.catalog.coreModuleIds);
    for (const id of this.catalog.recommendedModules(segment, domain)) {
      selection.add(id);
    }

    // Surcouche de profilage (lot 3). Sans aucune réponse elle est l'identité, donc la sélection
    // reste exactement celle du catalogue sectoriel.
    return applyProfileOverlay(Array.from(selection), this.profileAnswers(), {
      coreModuleIds: this.catalog.coreModuleIds,
      isLocked: id => this.catalog.isLockedOnFreePlan(id)
    });
  }

  /** Réponses de profilage courantes, lues depuis le formulaire (jamais undefined). */
  profileAnswers(): RegistrationProfileAnswers {
    if (!this.form) {
      return EMPTY_PROFILE_ANSWERS;
    }
    return {
      hasPhysicalStock: this.form.get('hasPhysicalStock')?.value ?? null,
      sellsToConsumers: this.form.get('sellsToConsumers')?.value ?? null,
      headcountBand: this.form.get('headcountBand')?.value ?? null,
      accountingDelegatedToFirm: this.form.get('accountingDelegatedToFirm')?.value ?? null
    };
  }

  /**
   * Une réponse de profilage a changé : on recalcule la pré-sélection, sauf si l'utilisateur a
   * déjà pris la main sur les bascules (même règle que pour un changement de segment/domaine).
   */
  onProfileAnswerChanged(): void {
    this.onProfileChanged();
  }

  /** Recomputes recommended modules on segment/domain change, unless the user already customized their selection. */
  private onProfileChanged(): void {
    if (!this.modulesTouched()) {
      const recommended = this.recommendedSelection(this.selectedSegment(), this.selectedDomain());
      this.form.get('enabledModules')?.setValue(recommended);
    }
    this.applySuggestedTaxRegime();
  }

  /** Pre-selects the sector-suggested tax regime (plan §3.1), unless the user already picked one manually. */
  private applySuggestedTaxRegime(): void {
    if (this.taxRegimeTouched()) return;
    const suggestion = this.catalog.suggestedTaxRegimeFor(this.selectedSegment());
    if (!suggestion) return;
    this.applyingSuggestedTaxRegime = true;
    try {
      this.form.get('taxRegime')?.setValue(suggestion.regime);
    } finally {
      this.applyingSuggestedTaxRegime = false;
    }
  }

  onModuleToggled(moduleId: AppModule): void {
    this.modulesTouched.set(true);
    const control = this.form.get('enabledModules');
    const current: AppModule[] = control?.value ?? [];
    const isEnabling = !current.includes(moduleId);

    if (!isEnabling) {
      // Turning a module off is a no-op while another enabled module still requires it (plan WP-F3).
      if (this.catalog.dependentsOf(moduleId, current).length > 0) {
        return;
      }
      control?.setValue(current.filter(m => m !== moduleId));
      this.setAutoEnabledHint([]);
      return;
    }

    const required = this.catalog.requiredBy(moduleId).filter(id => !current.includes(id));
    const next = [...current, moduleId, ...required];
    control?.setValue(next);
    this.setAutoEnabledHint(required);
  }

  /** Shows the "activé automatiquement" hint on newly-auto-enabled dependencies for a few seconds. */
  private setAutoEnabledHint(ids: AppModule[]): void {
    if (this.autoEnabledHintTimer) {
      clearTimeout(this.autoEnabledHintTimer);
      this.autoEnabledHintTimer = null;
    }
    this.lastAutoEnabled.set(ids);
    if (ids.length > 0) {
      this.autoEnabledHintTimer = setTimeout(() => this.lastAutoEnabled.set([]), 6000);
    }
  }

  resetModulesToRecommendations(): void {
    this.modulesTouched.set(false);
    this.setAutoEnabledHint([]);
    const recommended = this.recommendedSelection(this.selectedSegment(), this.selectedDomain());
    this.form.get('enabledModules')?.setValue(recommended);
  }

  isCurrentStepValid(): boolean {
    const step = this.currentStep();

    if (step === 0) {
      return !!this.form.get('companySegment')?.value && !!this.form.get('businessDomain')?.value;
    }

    if (step === 1) {
      const fields = [
        'firstName', 'lastName', 'email', 'password', 'confirmPassword',
        'companyName', 'nif', 'taxRegime', 'companyEmail', 'phone'
      ];
      return fields.every(f => this.form.get(f)?.valid) && !this.passwordMismatch();
    }

    if (step === 2) {
      return true;
    }

    if (step === 3) {
      const fields = ['street', 'city', 'governorate', 'acceptTerms'];
      return fields.every(f => this.form.get(f)?.valid);
    }

    return false;
  }

  goToStep(index: number): void {
    // L'espace existe : le formulaire n'est plus rendu, la navigation entre étapes n'a plus de sens.
    if (this.accountCreated()) return;
    if (index < 0 || index >= this.stepsMeta.length || index === this.currentStep()) return;
    // Allow jumping back freely (recap "Modifier" links); only gate forward navigation.
    if (index > this.currentStep() && !this.isCurrentStepValid()) return;
    this.currentStep.set(index);
    this.scrollWizardIntoView();
  }

  nextStep(): void {
    if (this.accountCreated()) return;
    if (this.isCurrentStepValid() && this.currentStep() < this.stepsMeta.length - 1) {
      this.currentStep.update(s => s + 1);
      this.scrollWizardIntoView();
    }
  }

  previousStep(): void {
    if (this.accountCreated()) return;
    if (this.currentStep() > 0) {
      this.currentStep.update(s => s - 1);
      this.scrollWizardIntoView();
    }
  }

  /** Ramène la carte du wizard en haut de l'écran après un changement d'étape. */
  private scrollWizardIntoView(): void {
    scrollAuthWizardStepIntoView(this.panelCard()?.nativeElement);
  }

  /** Réinjecte le brouillon dans le formulaire et reprend à l'étape enregistrée. */
  restoreDraft(): void {
    const draft = this.draftService.load();
    this.pendingDraftStep.set(null);
    if (!draft) {
      return;
    }

    this.form.patchValue(draft.values);
    // Les modules restaurés sont un choix de l'utilisateur : on ne les réécrase plus.
    if (draft.values['enabledModules']) {
      this.modulesTouched.set(true);
    }
    if (draft.values['taxRegime'] !== undefined) {
      this.taxRegimeTouched.set(true);
    }
    this.currentStep.set(draft.step);
    this.scrollWizardIntoView();
  }

  /** Refuse la reprise et supprime le brouillon. */
  discardDraft(): void {
    this.pendingDraftStep.set(null);
    this.draftService.clear();
  }

  onNifBlur(): void {
    applyNifBlurCleanup(this.form);
  }

  onSubmit(): void {
    // Ré-entrance : le `[disabled]` du bouton ne suffit pas (double-clic, soumission clavier,
    // et surtout écran d'avertissement où le formulaire redevenait valide et actif).
    if (this.loading() || this.accountCreated()) {
      return;
    }

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
      this.error.set($localize`:@@auth.register-wizard.ts.les.mots.de.passe.ne.correspondent.pas.c1a3d196:Les mots de passe ne correspondent pas`);
      this.form.get('confirmPassword')?.markAsTouched();
      return;
    }

    this.loading.set(true);
    this.error.set(null);
    // Sans cela, une nouvelle tentative affichait encore le bandeau « espace créé » de la précédente.
    this.registrationWarningDetails.set([]);
    this.loadingMessage.set($localize`:@@auth.register-wizard.ts.creation.de.votre.espace.07866544:Création de votre espace...`);
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

    const request: RegisterRequest = {
      ...buildCompanyRegisterRequest(formValue, cleanedNif),
      companySegment: formValue.companySegment || undefined,
      businessDomain: formValue.businessDomain || undefined,
      enabledModules: Array.isArray(formValue.enabledModules) ? formValue.enabledModules : undefined,
      profileAnswers: {
        hasPhysicalStock: formValue.hasPhysicalStock ?? null,
        sellsToConsumers: formValue.sellsToConsumers ?? null,
        headcountBand: formValue.headcountBand ?? null,
        accountingDelegatedToFirm: formValue.accountingDelegatedToFirm ?? null
      }
    };

    if (this.isPlatformMode()) {
      this.submitPlatformCompany(request);
      return;
    }

    this.authService.register(request).pipe(
      timeout(RegisterWizardComponent.REGISTRATION_TIMEOUT_MS),
      catchError(err => {
        if (err instanceof TimeoutError) {
          return throwError(() => ({
            status: 0,
            message: $localize`:@@auth.register-wizard.ts.la.creation.du.compte.prend.plus.de.temp.b880214b:La création du compte prend plus de temps que prévu. Veuillez patienter ou réessayer dans quelques instants.`
          }));
        }
        return throwError(() => err);
      })
    ).subscribe({
      next: (response) => {
        if (response.success) {
          console.log('[RegisterWizardComponent] Registration successful');
          this.finalizeAccountCreation();
          const warnings = toRegistrationWarnings(response.data);
          if (warnings.length > 0) {
            this.registrationWarningDetails.set(warnings);
            this.stopLoading();
            return;
          }
          this.warehouseContext.navigateAfterSuccessfulAuth('/dashboard');
        } else {
          const errorMessage = response.errors?.length > 0
            ? response.errors.join(', ')
            : response.message || $localize`:@@auth.register-wizard.ts.une.erreur.est.survenue.lors.de.l.inscri.c27c4975:Une erreur est survenue lors de l'inscription`;
          this.error.set(errorMessage);
          this.errorHandler.logError('Registration failed (success: false)', { response });
        }
        this.stopLoading();
      },
      error: (err: HttpErrorResponse | { status?: number; message?: string }) => {
        this.error.set(this.resolveSubmitErrorMessage(err));
        this.errorHandler.logError('Registration HTTP error', err);
        this.stopLoading();
      }
    });
  }

  private submitPlatformCompany(request: RegisterRequest): void {
    const handler = this.wizardMode.submitCompany;
    if (!handler) {
      this.error.set($localize`:@@auth.register-wizard.ts.configuration.plateforme.manquante.pour.f373acda:Configuration plateforme manquante pour la création d'entreprise.`);
      this.stopLoading();
      return;
    }

    const payload: CompanyRegistrationSubmitRequest = { ...request };
    handler(payload)
      .pipe(
        timeout(RegisterWizardComponent.REGISTRATION_TIMEOUT_MS),
        catchError(err => {
          if (err instanceof TimeoutError) {
            return throwError(() => ({
              status: 0,
              message: $localize`:@@auth.register-wizard.ts.la.creation.prend.plus.de.temps.que.prev.f9d6475f:La création prend plus de temps que prévu. Veuillez patienter ou réessayer.`
            }));
          }
          return throwError(() => err);
        })
      )
      .subscribe({
        next: result => {
          if (result.success) {
            this.finalizeAccountCreation();
            // Le serveur peut renvoyer un code hors union (p. ex. un ajout postérieur à ce build) :
            // le narrowing vit dans `auth.service`, jamais dans un `as` ici.
            const warnings = toRegistrationWarningList(result.registrationWarnings);
            this.pendingPlatformTenantId.set(result.tenantId ?? null);
            if (warnings.length > 0) {
              this.registrationWarningDetails.set(warnings);
              this.stopLoading();
              return;
            }
            this.navigateAfterCompanySuccess(result.tenantId);
          } else {
            this.error.set(
              result.errors?.length ? result.errors.join(', ') : result.message ?? $localize`:@@ui.tern.creation.impossible.5661a5:Création impossible.`
            );
          }
          this.stopLoading();
        },
        error: (err: HttpErrorResponse | { status?: number; message?: string }) => {
          this.error.set(this.resolveSubmitErrorMessage(err, true));
          this.stopLoading();
        }
      });
  }

  private resolveSubmitErrorMessage(
    err: HttpErrorResponse | { status?: number; message?: string },
    platform = false
  ): string {
    let errorMessage =
      err instanceof HttpErrorResponse
        ? this.errorHandler.extractErrorMessage(err)
        : 'message' in err && err.message
          ? err.message
          : this.errorHandler.extractErrorMessage(err as HttpErrorResponse);

    if (!errorMessage || errorMessage === 'undefined' || errorMessage.trim() === '' || errorMessage.includes('undefined')) {
      const status = 'status' in err ? err.status : (err as HttpErrorResponse)?.status;
      if (!status) {
        errorMessage = platform
          ? $localize`:@@ui.tern.impossible.de.joindre.l.api.plateforme.c1ad8f:Impossible de joindre l'API plateforme.`
          : $localize`:@@ui.tern.impossible.de.se.connecter.au.serveur.veri.81a4b1:Impossible de se connecter au serveur. Vérifiez que le backend est démarré sur https://localhost:7001.`;
      } else {
        errorMessage = platform
          ? $localize`:@@ui.tern.erreur.lors.de.la.creation.ph.ea3e06:Erreur lors de la création (${status}:p0:).`
          : $localize`:@@ui.tern.une.erreur.est.survenue.lors.de.l.inscript.32f480:Une erreur est survenue lors de l'inscription (${status || 'erreur inconnue'}:p0:). Veuillez réessayer.`;
      }
    }

    if (!errorMessage || errorMessage === 'undefined') {
      errorMessage = platform
        ? $localize`:@@ui.tern.la.creation.n.a.pas.pu.etre.finalisee.d36b40:La création n'a pas pu être finalisée.`
        : $localize`:@@ui.tern.une.erreur.est.survenue.lors.de.l.inscript.587687:Une erreur est survenue lors de l'inscription. Veuillez réessayer.`;
    }
    return errorMessage;
  }

  private navigateAfterCompanySuccess(tenantId?: string): void {
    if (tenantId && this.wizardMode.onCompanySuccess) {
      this.wizardMode.onCompanySuccess(tenantId);
      return;
    }
    this.warehouseContext.navigateAfterSuccessfulAuth('/dashboard');
  }

  private startLoadingMessageTimer(): void {
    this.clearLoadingMessageTimer();
    this.loadingMessageTimer = setInterval(() => {
      const elapsed = Date.now() - this.loadingStartedAt;
      if (elapsed < 5_000) {
        this.loadingMessage.set($localize`:@@auth.register-wizard.ts.creation.de.votre.espace.07866544:Création de votre espace...`);
      } else if (elapsed < 30_000) {
        this.loadingMessage.set($localize`:@@auth.register-wizard.ts.configuration.de.la.base.de.donnees.cela.6fb93f3b:Configuration de la base de données, cela peut prendre une minute...`);
      } else {
        this.loadingMessage.set($localize`:@@auth.register-wizard.ts.finalisation.en.cours.merci.de.patienter.d4489dba:Finalisation en cours, merci de patienter...`);
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

  /** L'utilisateur a pris connaissance des avertissements : on continue vers le tableau de bord. */
  continueAfterWarnings(): void {
    this.registrationWarningDetails.set([]);
    const tenantId = this.pendingPlatformTenantId();
    this.pendingPlatformTenantId.set(null);
    if (this.isPlatformMode()) {
      this.navigateAfterCompanySuccess(tenantId ?? undefined);
      return;
    }
    this.warehouseContext.navigateAfterSuccessfulAuth('/dashboard');
  }

  /**
   * Bascule irréversible vers l'état « espace créé » : plus de brouillon, plus d'autosave,
   * formulaire figé. Idempotent.
   */
  private finalizeAccountCreation(): void {
    this.accountCreated.set(true);
    this.stopDraftAutosave();
    this.draftService.clear();
    this.pendingDraftStep.set(null);
    // `emitEvent: false` : aucune valeur ne change, inutile de réveiller les abonnés.
    this.form.disable({ emitEvent: false });
  }

  private stopDraftAutosave(): void {
    this.draftAutosave?.unsubscribe();
    this.draftAutosave = null;
  }

  /** Avertissement de cohérence NIF/segment, s'il y en a un : il appelle une action dédiée. */
  readonly nifWarning = computed(
    () => this.registrationWarningDetails().find(w => w.code === 'NIF_SEGMENT_MISMATCH') ?? null
  );
}
