import { Component, OnInit, OnDestroy, inject, signal, computed, ViewChildren, ElementRef, QueryList, effect } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { Router, RouterModule, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil, debounceTime, filter, switchMap, EMPTY, catchError } from 'rxjs';

// PrimeNG
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import { ProgressBarModule } from 'primeng/progressbar';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ToastModule } from 'primeng/toast';
import { ConfirmationService } from '@core/services/confirmation.service';
import { ToastService } from '@core/services/toast.service';

// Step Components
import { StepMetadataComponent } from './steps/step-metadata/step-metadata.component';
import { StepSellerComponent } from './steps/step-seller/step-seller.component';
import { StepClientComponent } from './steps/step-client/step-client.component';
import { StepLinesComponent } from './steps/step-lines/step-lines.component';
import { StepLegalComponent } from './steps/step-legal/step-legal.component';
import { StepPreviewComponent } from './steps/step-preview/step-preview.component';
import { StepDocumentComponent } from './steps/step-document/step-document.component';
import { StepBillingComponent } from './steps/step-billing/step-billing.component';

// Services & Models
import { InvoiceWizardService } from './services/invoice-wizard.service';
import { InvoiceImportPrefillStore } from './services/invoice-import-prefill.store';
import { WizardStep, WizardStepKey } from './models/invoice-wizard.models';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { LayoutRouteService } from '@core/layout/layout-route.service';

/**
 * Invoice Wizard - Composant principal
 * 
 * Wizard multi-étapes pour la création de factures électroniques
 * conformes à la réglementation tunisienne.
 * 
 * Architecture:
 * - State management centralisé via InvoiceWizardService
 * - Validation en temps réel à chaque étape
 * - Sauvegarde automatique des brouillons
 * - Conformité fiscale tunisienne
 */
@Component({
  selector: 'app-invoice-wizard',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    ButtonModule,
    TooltipModule,
    ProgressBarModule,
    ConfirmDialogModule,
    ToastModule,
    StepMetadataComponent,
    StepSellerComponent,
    StepClientComponent,
    StepLinesComponent,
    StepLegalComponent,
    StepPreviewComponent,
    StepDocumentComponent,
    StepBillingComponent,
    BreadcrumbComponent
  ],
  template: `
    @if (!layoutFlags().hideLayout) {
      <app-breadcrumb [items]="breadcrumbItems()"></app-breadcrumb>
    }
    
    <div class="wizard-container">
      <!-- Header -->
      <header class="wizard-header">
        <div class="wizard-header-content">
          <div class="wizard-title-section">
            <button 
              type="button" 
              class="back-button"
              pTooltip="Retour aux factures"
              tooltipPosition="right"
              (click)="onCancel()">
              <i class="pi pi-arrow-left"></i>
            </button>
            <div>
              <h1 class="wizard-title">
                {{ wizardService.metadata().type === 'CREDIT_NOTE' ? "Nouvelle facture d'avoir" : 'Nouvelle facture' }}
              </h1>
              <p class="wizard-subtitle">
                {{ getCurrentStepDescription() }}
              </p>
            </div>
          </div>

          <div class="wizard-actions-header">
            @if (wizardService.isDirty() && !wizardService.isSaving()) {
              <span class="unsaved-indicator">
                <i class="pi pi-circle-fill"></i>
                Non enregistré
              </span>
            }
            @if (wizardService.isSaving()) {
              <span class="saving-indicator">
                <i class="pi pi-spin pi-spinner"></i>
                Enregistrement...
              </span>
            }
            @if (wizardService.wizardState().lastSaved) {
              <span class="saved-indicator">
                <i class="pi pi-check"></i>
                Progression sauvegardée à {{ wizardService.wizardState().lastSaved | date:'HH:mm' }}
              </span>
            }
          </div>
        </div>

        <!-- Progress -->
        <div class="wizard-progress">
          <p-progressBar 
            [value]="wizardService.progressPercent()" 
            [showValue]="false"
            [style]="{ height: '4px' }">
          </p-progressBar>
        </div>
      </header>

      <!-- Stepper -->
      <nav class="wizard-stepper" role="tablist" aria-label="Étapes de création de facture">
        @for (step of wizardService.steps(); track step.key) {
          <button
            #stepItem
            type="button"
            class="step-item"
            [class.active]="step.isActive"
            [class.complete]="step.isComplete && !step.isActive"
            [class.disabled]="step.isDisabled"
            [attr.aria-selected]="step.isActive"
            [attr.aria-disabled]="step.isDisabled"
            [attr.data-step-key]="step.key"
            [attr.data-step-index]="step.index"
            role="tab"
            (click)="onStepClick(step)">
            <div class="step-indicator">
              @if (step.isComplete && !step.isActive) {
                <i class="pi pi-check"></i>
              } @else {
                <span>{{ step.index + 1 }}</span>
              }
            </div>
            <div class="step-content">
              <span class="step-label">{{ step.label }}</span>
              <span class="step-description hide-mobile">{{ step.description }}</span>
            </div>
          </button>
        }
      </nav>

      <!-- Main Content -->
      <main class="wizard-content" role="tabpanel">
        <div class="wizard-content-inner" [class.step-wide]="isWideStep()">
          @switch (currentStepKey()) {
            @case ('metadata') {
              <app-step-metadata></app-step-metadata>
            }
            @case ('seller') {
              <app-step-seller></app-step-seller>
            }
            @case ('client') {
              <app-step-client></app-step-client>
            }
            @case ('lines') {
              <app-step-lines></app-step-lines>
            }
            @case ('legal') {
              <app-step-legal></app-step-legal>
            }
            @case ('document') {
              <app-step-document></app-step-document>
            }
            @case ('billing') {
              <app-step-billing></app-step-billing>
            }
            @case ('preview') {
              <app-step-preview (validateAndSubmit)="onSubmit()">
              </app-step-preview>
            }
            @case ('review') {
              <app-step-preview (validateAndSubmit)="onSubmit()">
              </app-step-preview>
            }
          }
        </div>
      </main>

      <!-- Footer Navigation -->
      <footer class="wizard-footer">
        <div class="wizard-footer-content">
          <div class="footer-left">
            <p-button
              label="Annuler"
              [text]="true"
              severity="secondary"
              icon="pi pi-times"
              (click)="onCancel()">
            </p-button>
          </div>

          <div class="footer-right">
            @if (wizardService.canGoPrev()) {
              <p-button
                label="Précédent"
                [outlined]="true"
                icon="pi pi-arrow-left"
                (click)="onPrevious()">
              </p-button>
            }

            @if (!wizardService.isLastStep()) {
              <p-button
                label="Suivant"
                icon="pi pi-arrow-right"
                iconPos="right"
                [disabled]="!wizardService.canGoNext()"
                (click)="onNext()">
              </p-button>
            }
            <!-- Sur la dernière étape, l'émission est gérée par step-preview uniquement. -->
          </div>
        </div>
      </footer>
    </div>

    <!-- Dialogs -->
  `,
  styles: [`
    .wizard-container {
      display: flex;
      flex-direction: column;
      height: 100vh;
      min-height: 0;
      background: var(--color-neutral-50);
    }

    // ===== HEADER =====
    .wizard-header {
      background: white;
      border-bottom: 1px solid var(--color-neutral-200);
      position: sticky;
      top: 0;
      z-index: var(--z-sticky);
    }

    .wizard-header-content {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: var(--spacing-4) var(--spacing-6);
      max-width: none;
      margin: 0 auto;
      width: 100%;
    }

    .wizard-title-section {
      display: flex;
      align-items: center;
      gap: var(--spacing-4);
    }

    .back-button {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      border: none;
      background: var(--color-neutral-100);
      border-radius: var(--radius-lg);
      cursor: pointer;
      transition: all var(--transition-fast);
      color: var(--color-neutral-600);

      &:hover {
        background: var(--color-neutral-200);
        color: var(--color-neutral-800);
      }

      &:focus-visible {
        outline: 2px solid var(--color-primary-500);
        outline-offset: 2px;
      }
    }

    .wizard-title {
      margin: 0;
      font-size: var(--font-size-xl);
      font-weight: var(--font-weight-semibold);
      color: var(--color-neutral-900);
    }

    .wizard-subtitle {
      margin: var(--spacing-1) 0 0;
      font-size: var(--font-size-sm);
      color: var(--color-neutral-500);
    }

    .wizard-actions-header {
      display: flex;
      align-items: center;
      gap: var(--spacing-4);
    }

    .unsaved-indicator,
    .saving-indicator,
    .saved-indicator {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      font-size: var(--font-size-sm);
      padding: var(--spacing-2) var(--spacing-3);
      border-radius: var(--radius-full);
    }

    .unsaved-indicator {
      background: var(--color-warning-50);
      color: var(--color-warning-600);

      i { font-size: 8px; }
    }

    .saving-indicator {
      background: var(--color-primary-50);
      color: var(--color-primary-600);
    }

    .saved-indicator {
      background: var(--color-success-50);
      color: var(--color-success-600);
    }

    .wizard-progress {
      padding: 0 var(--spacing-6);

      ::ng-deep .p-progressbar {
        background: var(--color-neutral-100);
        border-radius: 0;

        .p-progressbar-value {
          background: var(--gradient-primary, linear-gradient(90deg, #3b82f6, #6366f1));
          transition: width var(--duration-moderate, 260ms) var(--ease-out-soft, cubic-bezier(0.16, 1, 0.3, 1));
        }
      }
    }

    // ===== STEPPER =====
    .wizard-stepper {
      position: sticky;
      top: 64px; // Hauteur du header
      z-index: var(--z-sticky);
      background: white;
      border-bottom: 1px solid var(--color-neutral-200);
      box-shadow: var(--shadow-sm);
      display: flex;
      justify-content: flex-start;
      gap: var(--spacing-2);
      padding: var(--spacing-4) var(--spacing-6);
      background: white;
      border-bottom: 1px solid var(--color-neutral-200);
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      scroll-padding-inline: var(--spacing-6);

      &::-webkit-scrollbar {
        display: none;
      }
    }

    .step-item {
      display: flex;
      align-items: center;
      gap: var(--spacing-3);
      padding: var(--spacing-3) var(--spacing-4);
      border: none;
      background: transparent;
      border-radius: var(--radius-lg);
      cursor: pointer;
      transition: all var(--transition-fast);
      min-width: fit-content;
      flex-shrink: 0;

      &:hover:not(.disabled) {
        background: var(--color-neutral-100);
      }

      &:focus-visible {
        outline: 2px solid var(--color-primary-500);
        outline-offset: 2px;
      }

      &.disabled {
        cursor: not-allowed;
        opacity: 0.5;
      }

      &.active {
        background: var(--color-accent-50, var(--color-primary-50));

        .step-indicator {
          background: var(--gradient-primary, linear-gradient(135deg, #3b82f6 0%, #6366f1 100%));
          color: white;
          box-shadow: var(--shadow-glow-primary, 0 0 0 4px rgba(59, 130, 246, 0.25));
          transform: scale(1.05);
        }

        .step-label {
          color: var(--color-primary-700);
          font-weight: var(--font-weight-semibold);
        }
      }

      &.complete:not(.active) {
        .step-indicator {
          background: var(--gradient-success, linear-gradient(135deg, #10b981 0%, #059669 100%));
          color: white;
          box-shadow: 0 4px 10px rgba(16, 185, 129, 0.25);
        }
      }
    }

    .step-indicator {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border-radius: var(--radius-full);
      background: var(--color-neutral-200);
      color: var(--color-neutral-600);
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      flex-shrink: 0;
      transition: background var(--duration-moderate, 260ms) var(--ease-out-soft),
                  box-shadow var(--duration-moderate, 260ms) var(--ease-out-soft),
                  transform var(--duration-moderate, 260ms) var(--ease-out-back, cubic-bezier(0.34, 1.56, 0.64, 1)),
                  color var(--duration-moderate, 260ms) var(--ease-out-soft);
    }

    .step-content {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      text-align: left;
    }

    .step-label {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      color: var(--color-neutral-700);
      white-space: nowrap;
    }

    .step-description {
      font-size: var(--font-size-xs);
      color: var(--color-neutral-500);
      white-space: nowrap;
    }

    // ===== MAIN CONTENT =====
    .wizard-content {
      flex: 1;
      min-height: 0;
      padding: var(--spacing-6);
      overflow-y: auto;
    }

    .wizard-content-inner {
      max-width: 100%;
      margin: 0 auto;
      padding-inline: var(--spacing-2);

      &.step-wide {
        max-width: 100%;
      }
    }

    // ===== FOOTER =====
    .wizard-footer {
      position: sticky;
      bottom: 0;
      z-index: var(--z-sticky);
      background: white;
      border-top: 1px solid var(--color-neutral-200);
      box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.05);
      padding: var(--spacing-4) var(--spacing-6);
    }

    .wizard-footer-content {
      display: flex;
      justify-content: space-between;
      align-items: center;
      max-width: none;
      margin: 0 auto;
    }

    .footer-left,
    .footer-right {
      display: flex;
      align-items: center;
      gap: var(--spacing-3);
    }

    // ===== RESPONSIVE =====
    @media (max-width: 768px) {
      .wizard-header-content {
        flex-direction: column;
        align-items: flex-start;
        gap: var(--spacing-3);
      }

      .wizard-actions-header {
        width: 100%;
        justify-content: flex-end;
      }

      .wizard-stepper {
        justify-content: flex-start;
        padding: var(--spacing-3) var(--spacing-4);
      }

      .step-item {
        padding: var(--spacing-2) var(--spacing-3);

        .step-content {
          display: none;
        }

        &.active .step-content {
          display: flex;
        }
      }

      .wizard-content {
        padding: var(--spacing-4);
      }

      .wizard-footer-content {
        flex-direction: column;
        gap: var(--spacing-3);
      }

      .footer-left,
      .footer-right {
        width: 100%;
        justify-content: center;
      }

      .footer-right {
        flex-direction: row-reverse;
      }

      .hide-mobile {
        display: none !important;
      }
    }
  `]
})
export class InvoiceWizardComponent implements OnInit, OnDestroy {
  @ViewChildren('stepItem', { read: ElementRef }) stepButtons!: QueryList<ElementRef>;

  readonly wizardService = inject(InvoiceWizardService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly toastService = inject(ToastService);
  private readonly importPrefillStore = inject(InvoiceImportPrefillStore);
  private readonly layoutRoute = inject(LayoutRouteService);

  readonly layoutFlags = this.layoutRoute.flags;

  private destroy$ = new Subject<void>();

  /**
   * Observable miroir du signal `wizardState`, créé en injection context (champ de classe)
   * pour que `toObservable()` ait accès à l'injector. Utilisé par l'autosave et toute
   * pipeline RxJS qui doit observer l'état global.
   */
  private readonly wizardState$ = toObservable(this.wizardService.wizardState);

  private scrollActiveStepIntoView = effect(() => {
    this.wizardService.currentStep();
    setTimeout(() => this.scrollActiveStepIntoViewIfNeeded(), 0);
  });

  // Computed
  currentStepKey = computed(() => {
    const currentIndex = this.wizardService.currentStep();
    const steps = this.wizardService.steps();
    return steps[currentIndex]?.key || 'metadata';
  });

  readonly isWideStep = computed(() => {
    const key = this.currentStepKey();
    return key === 'lines' || key === 'billing' || key === 'review' || key === 'preview';
  });

  canSubmit = computed(() => {
    const validation = this.wizardService.validationResult();
    return validation?.canProceed ?? false;
  });

  breadcrumbItems = computed<BreadcrumbItem[]>(() => {
    const isCreditNote = this.wizardService.metadata().type === 'CREDIT_NOTE';
    return [
      { label: 'Tableau de bord', route: '/dashboard', icon: 'pi-home' },
      { label: 'Factures', route: '/invoices' },
      { label: isCreditNote ? "Facture d'avoir" : 'Nouvelle facture' }
    ];
  });

  ngOnInit(): void {
    this.wizardService.ensureFiscalStampLoaded();
    const isCreditNoteRoute = this.route.snapshot.data['isCreditNote'] === true;
    const invoiceId = this.route.snapshot.paramMap.get('id');
    const draftId = this.route.snapshot.paramMap.get('draftId');

    if (isCreditNoteRoute && invoiceId) {
      this.wizardService.initForCreditNote(invoiceId)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.wizardService.fetchNextInvoiceNumber()
              .pipe(takeUntil(this.destroy$))
              .subscribe({ next: () => {}, error: () => {} });
          },
          error: (err) => {
            console.error('[InvoiceWizard] Failed to init credit note:', err);
            this.toastService.add({
              severity: 'error',
              summary: 'Erreur',
              detail: 'Impossible de charger la facture. Retour à la liste.',
              life: 5000
            });
            this.router.navigate(['/invoices']);
          }
        });
    } else if (draftId) {
      this.wizardService.loadDraft(draftId)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {},
          error: (err) => {
            console.error('[InvoiceWizard] Failed to load draft:', err);
            this.toastService.add({
              severity: 'error',
              summary: 'Erreur',
              detail: 'Impossible de charger le brouillon.',
              life: 5000
            });
            this.router.navigate(['/invoices/new']);
          }
        });
    } else {
      this.wizardService.reset();
      this.wizardService.fetchNextInvoiceNumber()
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (number) => {
            if (number && !number.toUpperCase().includes('TEMP')) {
              console.log('[InvoiceWizard] Invoice number fetched:', number);
            }
          },
          error: (error) => {
            console.warn('[InvoiceWizard] Failed to fetch invoice number, using temporary number:', error);
          }
        });

      // Pré-remplissage du client via query param (utilisé par les actions
      // de navigation proposées par l'assistant IA : /invoices/new?clientId=xxx).
      const preselectClientId = this.route.snapshot.queryParamMap.get('clientId');
      if (preselectClientId) {
        this.wizardService.loadAndPreselectClient(preselectClientId)
          .pipe(takeUntil(this.destroy$))
          .subscribe({
            next: () => {},
            error: (err) => {
              console.warn('[InvoiceWizard] Failed to preselect client:', err);
            }
          });
      }

      // Pré-remplissage depuis un import de fichier analysé par l'IA (modale d'import).
      // Additif : ne se déclenche que si la modale a déposé un résultat dans le store.
      if (this.importPrefillStore.hasPending) {
        const imported = this.importPrefillStore.consume();
        if (imported) {
          this.wizardService.applyImportedInvoice(imported);
          const isDeliveryNote = imported.documentType === 'DELIVERY_NOTE';
          if (isDeliveryNote) {
            this.toastService.add({
              severity: 'warn',
              summary: 'Import depuis un bon de livraison',
              detail: 'Vérifiez la TVA, le numéro de facture et les montants avant validation.',
              life: 9000
            });
          } else if ((imported.warnings?.length ?? 0) > 0 || imported.confidence !== 'high') {
            this.toastService.add({
              severity: 'info',
              summary: 'Facture pré-remplie par l\'IA',
              detail: 'Vérifiez attentivement les montants, le client et les lignes avant de valider.',
              life: 7000
            });
          }
        }
      }
    }

    this.setupAutosave();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Sauvegarde automatique du brouillon.
   *
   * Observe l'état dirty du wizard. Quand l'utilisateur modifie un champ, attend 2s d'inactivité
   * avant d'appeler POST /invoices/wizard/drafts. La sauvegarde est silencieuse (pas de toast)
   * pour ne pas interrompre la saisie. En cas d'erreur réseau, on log uniquement : l'utilisateur
   * La progression est conservée automatiquement ; l'émission se fait depuis l'étape Récap.
   *
   * Le verrou `isSaving` côté service empêche les soumissions concurrentes.
   */
  private setupAutosave(): void {
    this.wizardState$
      .pipe(
        debounceTime(2000),
        filter((state) => state.isDirty && !state.isSaving),
        switchMap(() =>
          this.wizardService.saveDraft().pipe(
            catchError((err) => {
              console.warn('[InvoiceWizard] Autosave failed:', err);
              return EMPTY;
            })
          )
        ),
        takeUntil(this.destroy$)
      )
      .subscribe();
  }

  getCurrentStepDescription(): string {
    const steps = this.wizardService.steps();
    const step = steps[this.wizardService.currentStep()];
    return step ? `Étape ${step.index + 1} sur ${steps.length} - ${step.description}` : '';
  }

  onStepClick(step: WizardStep): void {
    if (!step.isDisabled) {
      this.wizardService.goToStep(step.index);
    }
  }

  private scrollActiveStepIntoViewIfNeeded(): void {
    if (!this.stepButtons?.length) return;
    const idx = this.wizardService.currentStep();
    const el = this.stepButtons.get(idx)?.nativeElement as HTMLElement | undefined;
    if (el) {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
  }

  onNext(): void {
    this.wizardService.nextStep();
  }

  onPrevious(): void {
    this.wizardService.prevStep();
  }

  onSubmit(): void {
    this.wizardService.ensureSubscriptionLoaded({ forceRefresh: true })
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        const validation = this.wizardService.validateInvoice();

        if (!validation.canProceed) {
          const quotaCheck = validation.checks.find(c => c.id === 'invoice-quota' && c.status === 'ERROR');
          this.toastService.add({
            severity: 'error',
            summary: quotaCheck ? 'Quota atteint' : 'Validation échouée',
            detail: quotaCheck?.description ?? `${validation.errorCount} erreur(s) bloquante(s) détectée(s)`,
            life: 5000
          });
          return;
        }

        const isCreditNote = this.wizardService.metadata().type === 'CREDIT_NOTE';
        this.confirmationService.confirm({
          message: isCreditNote
            ? "Une fois validée, cette facture d'avoir ne pourra plus être modifiée. Confirmer l'émission ?"
            : 'Une fois validée, cette facture ne pourra plus être modifiée. Confirmer l\'émission ?',
          header: 'Confirmer l\'émission',
          icon: 'pi pi-exclamation-triangle',
          acceptLabel: isCreditNote ? "Émettre l'avoir" : 'Émettre la facture',
          rejectLabel: 'Annuler',
          acceptButtonStyleClass: 'btn-success',
          accept: () => {
            this.submitInvoice();
          }
        });
      });
  }

  private submitInvoice(): void {
    this.wizardService.submitInvoice()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (invoiceId) => {
          const isCreditNote = this.wizardService.metadata().type === 'CREDIT_NOTE';
          this.toastService.add({
            severity: 'success',
            summary: isCreditNote ? "Avoir émis" : 'Facture émise',
            detail: isCreditNote
              ? "La facture d'avoir a été créée et validée avec succès"
              : 'La facture a été créée et validée avec succès',
            life: 3000
          });
          
          // Navigate to invoice detail
          this.router.navigate(['/invoices', invoiceId]);
        },
        error: (error) => {
          // The error message is already stored in the service state and displayed in the preview component
          // We still show a toast for immediate feedback, but the detailed error is in the preview
          const errorMessage = error.message || this.wizardService.submissionError() || "Impossible d'émettre la facture";
          
          this.toastService.add({
            severity: 'error',
            summary: 'Erreur',
            detail: errorMessage,
            life: 5000
          });
        }
      });
  }

  onCancel(): void {
    if (this.wizardService.isDirty()) {
      this.confirmationService.confirm({
        message: 'Vous avez des modifications non enregistrées. Voulez-vous quitter sans sauvegarder ?',
        header: 'Quitter le wizard',
        icon: 'pi pi-exclamation-triangle',
        acceptLabel: 'Quitter',
        rejectLabel: 'Rester',
        acceptButtonStyleClass: 'btn-danger',
        accept: () => {
          this.router.navigate(['/invoices']);
        }
      });
    } else {
      this.router.navigate(['/invoices']);
    }
  }
}
