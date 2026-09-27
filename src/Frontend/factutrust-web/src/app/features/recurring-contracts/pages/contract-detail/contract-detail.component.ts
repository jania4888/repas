/// <reference types="@angular/localize" />
import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { TabsModule } from 'primeng/tabs';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { StatusBadgeComponent } from '@shared/components/status-badge/status-badge.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { SkeletonComponent } from '@shared/components/skeleton/skeleton.component';
import { DocumentActionsMenuComponent } from '@shared/components/document-actions-menu/document-actions-menu.component';
import { MenuItem } from '@shared/models/menu-item.model';
import {
  ContractEvolutionPoint,
  ContractFinancialSummary,
  ContractScheduleEntry,
  RecurringContractDetail,
  RecurringContractService
} from '@core/services/recurring-contract.service';
import { AuthService } from '@core/services/auth.service';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { buildKpiVm } from '../../contract-detail.vm';
import { contractBadgeStatus, contractStatusLabel } from '../../recurring-contracts.ui-utils';
import { ContractKpiStripComponent } from '../../components/contract-kpi-strip.component';
import { ContractSidePanelComponent, ContractSideAction } from '../../components/contract-side-panel.component';
import { ContractAmendDialogComponent } from '../../components/contract-amend-dialog.component';
import { ContractOverviewTabComponent } from '../../tabs/contract-overview.tab';
import { ContractScheduleTabComponent } from '../../tabs/contract-schedule.tab';
import { ContractInvoicesTabComponent } from '../../tabs/contract-invoices.tab';
import { ContractServicesTabComponent } from '../../tabs/contract-services.tab';
import { ContractDocumentsTabComponent } from '../../tabs/contract-documents.tab';
import { ContractHistoryTabComponent } from '../../tabs/contract-history.tab';
import { ContractNotesTabComponent } from '../../tabs/contract-notes.tab';

type ContractAction = 'activate' | 'suspend' | 'resume' | 'cancel' | 'renew' | 'trigger' | 'clone';

/**
 * Fiche contrat (maquette détail) : fil d'Ariane, en-tête avec badge et actions,
 * 5 cartes KPI, 7 onglets paresseux, colonne droite persistante.
 * Charge GET /{id}/detail en priorité (repli GET /{id} si 404) et le résumé
 * financier en parallèle (tolérant 404).
 */
@Component({
  selector: 'app-contract-detail',
  standalone: true,
  imports: [
    BackendLabelPipe,
    CommonModule, RouterModule, TabsModule,
    PageHeaderComponent, BreadcrumbComponent, ButtonComponent, StatusBadgeComponent,
    EmptyStateComponent, SkeletonComponent, DocumentActionsMenuComponent,
    ContractKpiStripComponent, ContractSidePanelComponent, ContractAmendDialogComponent,
    ContractOverviewTabComponent, ContractScheduleTabComponent, ContractInvoicesTabComponent,
    ContractServicesTabComponent, ContractDocumentsTabComponent, ContractHistoryTabComponent,
    ContractNotesTabComponent
  ],
  template: `
    <app-breadcrumb [items]="breadcrumbItems()"></app-breadcrumb>

    @if (loading()) {
      <app-skeleton height="2.5rem" width="40%"></app-skeleton>
      <div class="kpi-skeleton-grid">
        @for (i of [1, 2, 3, 4, 5]; track i) {
          <app-skeleton height="6rem" shape="rounded"></app-skeleton>
        }
      </div>
      <app-skeleton height="24rem" shape="rounded"></app-skeleton>
    } @else if (loadError()) {
      <app-empty-state
        icon="pi-exclamation-triangle"
        title="Impossible de charger le contrat" i18n-title="@@recurring-contracts.pages.impossible.de.charger.le.contrat.d4646382"
        description="Le contrat est introuvable ou une erreur est survenue." i18n-description="@@recurring-contracts.pages.le.contrat.est.introuvable.ou.une.erreur.7fdf9198"
        actionLabel="Réessayer" i18n-actionLabel="@@recurring-contracts.pages.reessayer.b885e20c"
        (actionClick)="reload()">
      </app-empty-state>
    } @else {
      @if (contract(); as c) {
      <app-page-header
        [title]="c.number ? loc_ui_tern_contrat_f06722 + c.number : 'Contrat récurrent'"
        [subtitle]="c.clientName">
        <app-status-badge
          title-addon
          [status]="contractBadgeStatus(c.status)"
          [label]="contractStatusLabel(c.status, c.statusDisplay) | backendLabel">
        </app-status-badge>
        <div class="actions">
          @if (c.status === 'Draft' && canManage()) {
            <app-button
              variant="primary" icon="pi-play"
              [disabled]="!!actionInProgress()"
              (clicked)="confirmActivate()" i18n="@@recurring-contracts.pages.activer.b96fa78d"> Activer </app-button>
          }
          @if (c.status === 'Active' && canManage()) {
            <app-button
              variant="outline" icon="pi-pause"
              [disabled]="!!actionInProgress()"
              (clicked)="confirmSuspend()" i18n="@@recurring-contracts.pages.suspendre.1e34ab4e"> Suspendre </app-button>
          }
          @if (c.status === 'Suspended' && canManage()) {
            <app-button
              variant="primary" icon="pi-play"
              [disabled]="!!actionInProgress()"
              (clicked)="confirmResume()" i18n="@@recurring-contracts.pages.reprendre.1c56710b"> Reprendre </app-button>
          }
          @if (canRenew(c) && canManage()) {
            <app-button
              variant="secondary" icon="pi-refresh"
              [disabled]="!!actionInProgress()"
              (clicked)="confirmRenew()" i18n="@@recurring-contracts.pages.renouveler.maintenant.698440b4"> Renouveler maintenant </app-button>
          }
          @if (c.status === 'Active' && canTriggerBilling()) {
            <app-button
              variant="outline" icon="pi-file-edit"
              [disabled]="!!actionInProgress()"
              (clicked)="generateDraft()" i18n="@@recurring-contracts.pages.generer.brouillon.e5010c97"> Générer brouillon </app-button>
          }
          @if ((c.status === 'Active' || c.status === 'Suspended') && canManage()) {
            <app-button
              variant="danger" icon="pi-times"
              [disabled]="!!actionInProgress()"
              (clicked)="confirmCancel()" i18n="@@recurring-contracts.pages.resilier.1b922dae"> Résilier </app-button>
          }
          @if (c.status === 'Draft' && canUpdate()) {
            <app-button variant="outline" icon="pi-pencil" [routerLink]="['edit']" i18n="@@recurring-contracts.pages.modifier.f260e757"> Modifier </app-button>
          }
          <app-document-actions-menu [items]="actionsMenuItems()"></app-document-actions-menu>
        </div>
      </app-page-header>

      @if (kpi(); as k) {
        <app-contract-kpi-strip [kpi]="k" [currency]="c.currency"></app-contract-kpi-strip>
      }

      <div class="detail-grid">
        <div class="main-content">
          <p-tabs class="ft-tabs" [lazy]="true" [(value)]="activeTab">
            <p-tablist>
              <p-tab [value]="0"><i class="pi pi-eye"></i><span i18n="@@recurring-contracts.pages.apercu.f0f53004">Aperçu</span></p-tab>
              <p-tab [value]="1"><i class="pi pi-calendar"></i><span i18n="@@recurring-contracts.pages.echeances.c2079408">Échéances</span></p-tab>
              <p-tab [value]="2"><i class="pi pi-receipt"></i><span i18n="@@recurring-contracts.pages.factures.da35e4f2">Factures</span></p-tab>
              <p-tab [value]="3"><i class="pi pi-list"></i><span i18n="@@recurring-contracts.pages.services.5cbd5840">Services</span></p-tab>
              <p-tab [value]="4"><i class="pi pi-folder"></i><span i18n="@@recurring-contracts.pages.documents.687c8286">Documents</span></p-tab>
              <p-tab [value]="5"><i class="pi pi-history"></i><span i18n="@@recurring-contracts.pages.historique.34f3a06a">Historique</span></p-tab>
              <p-tab [value]="6"><i class="pi pi-comment"></i><span i18n="@@recurring-contracts.pages.notes.70440046">Notes</span></p-tab>
            </p-tablist>
            <p-tabpanels>
              <p-tabpanel [value]="0">
                <app-contract-overview-tab
                  [contract]="c"
                  [schedule]="schedule()"
                  [evolution]="evolution()"
                  [scheduleLoading]="scheduleLoading()"
                  [evolutionLoading]="evolutionLoading()"
                  (viewSchedule)="activeTab = 1"
                  (viewServices)="activeTab = 3">
                </app-contract-overview-tab>
              </p-tabpanel>
              <p-tabpanel [value]="1">
                <app-contract-schedule-tab
                  [contract]="c"
                  [refreshToken]="refreshToken()"
                  (draftChanged)="onDraftAdjusted()">
                </app-contract-schedule-tab>
              </p-tabpanel>
              <p-tabpanel [value]="2">
                <app-contract-invoices-tab [contract]="c" [refreshToken]="refreshToken()">
                </app-contract-invoices-tab>
              </p-tabpanel>
              <p-tabpanel [value]="3">
                <app-contract-services-tab [contract]="c" [refreshToken]="refreshToken()">
                </app-contract-services-tab>
              </p-tabpanel>
              <p-tabpanel [value]="4">
                <app-contract-documents-tab></app-contract-documents-tab>
              </p-tabpanel>
              <p-tabpanel [value]="5">
                <app-contract-history-tab
                  [contract]="c"
                  [refreshToken]="refreshToken()"
                  (createAmend)="amendDialogVisible = true"
                  (draftChanged)="onDraftAdjusted()">
                </app-contract-history-tab>
              </p-tabpanel>
              <p-tabpanel [value]="6">
                <app-contract-notes-tab [contract]="c" (notesSaved)="onNotesSaved($event)">
                </app-contract-notes-tab>
              </p-tabpanel>
            </p-tabpanels>
          </p-tabs>
        </div>
        <div class="sidebar">
          <app-contract-side-panel
            [contract]="c"
            [summary]="summary()"
            [canManage]="canManage()"
            [canTriggerBilling]="canTriggerBilling()"
            [canCreate]="canCreate()"
            [actionInProgress]="!!actionInProgress()"
            (actionTriggered)="onSideAction($event)">
          </app-contract-side-panel>
        </div>
      </div>

      <app-contract-amend-dialog
        [(visible)]="amendDialogVisible"
        [contract]="c"
        (amended)="onAmended()">
      </app-contract-amend-dialog>
      }
    }
  `,
  styles: [`
    .actions {
      display: flex;
      gap: var(--spacing-2);
      flex-wrap: wrap;
      align-items: center;
    }

    .kpi-skeleton-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: var(--spacing-4);
      margin: var(--spacing-4) 0;
    }

    .detail-grid {
      display: grid;
      grid-template-columns: 1fr 320px;
      gap: var(--spacing-6);

      // Sous 1400px la colonne principale (~700px à 1280px viewport avec le shell) est trop
      // étroite : la barre d'onglets déborde et chevauche le panneau latéral, et les cartes
      // KPI tronquent leurs valeurs. Le panneau passe alors sous le contenu, pleine largeur.
      @media (max-width: 1400px) {
        grid-template-columns: 1fr;
      }
    }

    .main-content { min-width: 0; }

    // L'en-tête partagé laisse la zone titre se comprimer (flex-basis 0% + min-width: 0) :
    // avec 4+ boutons d'action (~930 px) le titre passait à ~40 px de large et se coupait
    // sur 4 lignes au lieu de laisser les actions passer à la ligne. On impose une largeur
    // minimale lisible à la zone titre pour cette page uniquement (override scopé).
    :host ::ng-deep app-page-header .page-header-content {
      min-width: 280px;
    }
  `]
})
export class ContractDetailComponent implements OnInit {
  readonly loc_ui_tern_contrat_f06722 = $localize`:@@ui.tern.contrat.f06722:Contrat `;
  private readonly service = inject(RecurringContractService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);
  private readonly errorHandler = inject(ErrorHandlerService);
  private readonly confirmationService = inject(ConfirmationService);

  readonly contract = signal<RecurringContractDetail | null>(null);
  readonly loading = signal(true);
  readonly loadError = signal(false);
  /** null = endpoint phase 2 absent (404) → placeholder discret, jamais de toast. */
  readonly summary = signal<ContractFinancialSummary | null>(null);
  readonly schedule = signal<ContractScheduleEntry[] | null>(null);
  readonly evolution = signal<ContractEvolutionPoint[] | null>(null);
  readonly scheduleLoading = signal(true);
  readonly evolutionLoading = signal(true);
  readonly actionInProgress = signal<ContractAction | null>(null);
  /** Incrémenté après chaque mutation pour recharger les onglets déjà initialisés. */
  readonly refreshToken = signal(0);

  activeTab = 0;
  amendDialogVisible = false;
  private contractId = '';

  readonly kpi = computed(() => {
    const c = this.contract();
    return c ? buildKpiVm(c, this.summary()) : null;
  });

  readonly breadcrumbItems = computed<BreadcrumbItem[]>(() => {
    const c = this.contract();
    return [
      { label: $localize`:@@recurring-contracts.contract-detail.ts.accueil.a8ff8fd2:Accueil`, route: '/', icon: 'pi-home' },
      { label: $localize`:@@recurring-contracts.contract-detail.ts.contrats.recurrents.e773e54a:Contrats récurrents`, route: '/recurring-contracts' },
      { label: c?.number ? $localize`:@@ui.tern.contrat.ph.396b9e:Contrat ${c.number}:p0:` : $localize`:@@ui.tern.contrat.d008bd:Contrat` }
    ];
  });

  readonly canManage = computed(() => this.auth.hasPermission(PERMISSIONS.recurringContracts.manage));
  readonly canUpdate = computed(() => this.auth.hasPermission(PERMISSIONS.recurringContracts.update));
  readonly canTriggerBilling = computed(() => this.auth.hasPermission(PERMISSIONS.recurringContracts.triggerBilling));
  readonly canCreate = computed(() => this.auth.hasPermission(PERMISSIONS.recurringContracts.create));

  protected readonly contractBadgeStatus = contractBadgeStatus;
  protected readonly contractStatusLabel = contractStatusLabel;

  ngOnInit(): void {
    // Souscription (et non snapshot) : cloner un contrat navigue vers /recurring-contracts/<newId>
    // — même route, même composant réutilisé, ngOnInit non rappelé. Sans cela, la fiche
    // continue d'afficher l'ancien contrat sous la nouvelle URL.
    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(params => {
        const id = params.get('id');
        if (!id || id === this.contractId) return;
        this.contractId = id;
        this.reload();
      });
    this.contractId = this.route.snapshot.paramMap.get('id')!;
    this.reload();
  }

  reload(): void {
    this.loading.set(true);
    this.loadError.set(false);

    // Vue enrichie en priorité ; repli sur le GET simple quand l'endpoint phase 2 est absent.
    this.service.getDetail(this.contractId).subscribe({
      next: detail => {
        if (detail) {
          this.onContractLoaded(detail);
        } else {
          this.service.get(this.contractId).subscribe({
            next: c => this.onContractLoaded(c),
            error: err => this.onLoadFailure(err)
          });
        }
      },
      error: err => this.onLoadFailure(err)
    });

    this.loadPhase2Data();
  }

  /** Renouvellement : uniquement Active avec date de fin, ou Expired (arbitrage A1). */
  canRenew(c: RecurringContractDetail): boolean {
    return (c.status === 'Active' && !!c.endDate) || c.status === 'Expired';
  }

  // computed (et non méthode de template) : une méthode renverrait un NOUVEAU tableau à
  // chaque cycle de détection, ce qui réinitialise le p-menu en boucle et fige l'onglet
  // dès l'ouverture du menu « Actions ».
  readonly actionsMenuItems = computed<MenuItem[]>(() => {
    const c = this.contract();
    if (!c) return [];
    return [
      {
        label: $localize`:@@recurring-contracts.contract-detail.ts.creer.un.avenant.676020ba:Créer un avenant`,
        icon: 'pi pi-file-plus',
        visible: c.status === 'Active' && this.canManage(),
        command: () => { this.amendDialogVisible = true; }
      },
      {
        label: $localize`:@@recurring-contracts.contract-detail.ts.cloner.1a9fa729:Cloner`,
        icon: 'pi pi-copy',
        visible: this.canCreate(),
        command: () => this.cloneContract()
      },
      { separator: true },
      {
        label: $localize`:@@recurring-contracts.contract-detail.ts.voir.les.brouillons.c69e12e7:Voir les brouillons`,
        icon: 'pi pi-file-edit',
        routerLink: '/recurring-contracts/pending-drafts'
      }
    ];
  });

  onSideAction(action: ContractSideAction): void {
    switch (action) {
      case 'invoice':
        this.generateDraft();
        break;
      case 'clone':
        this.cloneContract();
        break;
      case 'cancel':
        this.confirmCancel();
        break;
      // 'reminder' et 'download' sont des boutons désactivés (phase 2) : jamais émis.
    }
  }

  onAmended(): void {
    this.reloadContractOnly();
    this.refreshToken.update(t => t + 1);
  }

  /** Après ajustement / émission d'un brouillon d'échéance : sync Historique, Échéances et KPI. */
  onDraftAdjusted(): void {
    this.reloadContractOnly();
    this.refreshToken.update(t => t + 1);
  }

  onNotesSaved(notes: string | null): void {
    const c = this.contract();
    if (c) this.contract.set({ ...c, notes });
  }

  confirmActivate(): void {
    this.confirmationService.confirm({
      header: $localize`:@@recurring-contracts.contract-detail.ts.activer.le.contrat.9474c318:Activer le contrat`,
      message: $localize`:@@recurring-contracts.contract-detail.ts.le.contrat.sera.active.et.la.facturation.2bb33b68:Le contrat sera activé et la facturation démarrera à la prochaine échéance.`,
      icon: 'pi pi-play',
      acceptLabel: $localize`:@@contract-detail.component.acceptLabel.Activer:Activer`,
      rejectLabel: $localize`:@@contract-detail.component.rejectLabel.Annuler:Annuler`,
      accept: () => this.runAction('activate', 'Contrat activé', 'La facturation reprendra à la prochaine échéance.')
    });
  }

  confirmSuspend(): void {
    this.confirmationService.confirm({
      header: $localize`:@@recurring-contracts.contract-detail.ts.suspendre.le.contrat.d43dfca2:Suspendre le contrat`,
      message: $localize`:@@recurring-contracts.contract-detail.ts.les.prochaines.factures.ne.seront.plus.g.cfe433df:Les prochaines factures ne seront plus générées tant que le contrat est suspendu.`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: $localize`:@@contract-detail.component.acceptLabel.Suspendre:Suspendre`,
      rejectLabel: $localize`:@@contract-detail.component.rejectLabel.Annuler:Annuler`,
      accept: () => this.runAction('suspend', 'Contrat suspendu', 'La génération de factures est interrompue.')
    });
  }

  confirmResume(): void {
    this.confirmationService.confirm({
      header: $localize`:@@recurring-contracts.contract-detail.ts.reprendre.le.contrat.edff7e03:Reprendre le contrat`,
      message: $localize`:@@recurring-contracts.contract-detail.ts.le.contrat.redeviendra.actif.et.la.factu.aef399a7:Le contrat redeviendra actif et la facturation reprendra.`,
      icon: 'pi pi-play',
      acceptLabel: $localize`:@@contract-detail.component.acceptLabel.Reprendre:Reprendre`,
      rejectLabel: $localize`:@@contract-detail.component.rejectLabel.Annuler:Annuler`,
      accept: () => this.runAction('resume', 'Contrat repris', 'La facturation reprendra à la prochaine échéance.')
    });
  }

  confirmCancel(): void {
    this.confirmationService.confirm({
      header: $localize`:@@recurring-contracts.contract-detail.ts.resilier.le.contrat.aa98822d:Résilier le contrat`,
      message: $localize`:@@recurring-contracts.contract-detail.ts.cette.action.est.irreversible.le.contrat.ebe87177:Cette action est irréversible : le contrat sera définitivement résilié.`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: $localize`:@@contract-detail.component.acceptLabel.Résilier:Résilier`,
      rejectLabel: $localize`:@@contract-detail.component.rejectLabel.Annuler:Annuler`,
      acceptButtonStyleClass: 'btn-danger',
      size: 'md',
      accept: () => this.runAction('cancel', 'Contrat résilié', 'Le contrat a été résilié.')
    });
  }

  confirmRenew(): void {
    this.confirmationService.confirm({
      header: $localize`:@@recurring-contracts.contract-detail.ts.renouveler.le.contrat.1e20cca2:Renouveler le contrat`,
      message: $localize`:@@recurring-contracts.contract-detail.ts.le.contrat.sera.prolonge.d.une.duree.ide.57797cfd:Le contrat sera prolongé d'une durée identique à la durée initiale.`,
      icon: 'pi pi-refresh',
      acceptLabel: $localize`:@@contract-detail.component.acceptLabel.Renouveler:Renouveler`,
      rejectLabel: $localize`:@@contract-detail.component.rejectLabel.Annuler:Annuler`,
      accept: () => {
        this.actionInProgress.set('renew');
        this.service.renewNow(this.contractId, {}).subscribe({
          next: result => {
            this.actionInProgress.set(null);
            this.toast.add({
              severity: 'success',
              summary: $localize`:@@contract-detail.component.summary.Contrat_renouvel:Contrat renouvelé`,
              detail: $localize`:@@recurring-contracts.contract-detail.ts.nouvelle.date.de.fin.tolocaledatestring.61aefc26:Nouvelle date de fin : ${new Date(result.newEndDate).toLocaleDateString('fr-FR')}:toLocaleDateString:.`
            });
            this.reload();
            this.refreshToken.update(t => t + 1);
          },
          error: err => {
            this.actionInProgress.set(null);
            if (err?.status === 404) {
              this.toast.add({
                severity: 'info',
                summary: $localize`:@@contract-detail.component.summary.Fonction_indispo:Fonction indisponible`,
                detail: $localize`:@@contract-detail.component.detail.Fonction_disponi:Fonction disponible après la mise à jour du serveur.`
              });
              return;
            }
            this.errorHandler.logError('RecurringContracts: renew', err);
            this.toast.add({ severity: 'error', summary: $localize`:@@contract-detail.component.summary.Erreur:Erreur`, detail: this.errorHandler.extractErrorMessage(err) });
          }
        });
      }
    });
  }

  generateDraft(): void {
    this.actionInProgress.set('trigger');
    this.service.triggerBilling(this.contractId).subscribe({
      next: count => {
        this.actionInProgress.set(null);
        this.toast.add({
          severity: 'success',
          summary: $localize`:@@contract-detail.component.summary.G_n_ration_termi:Génération terminée`,
          detail: $localize`:@@recurring-contracts.contract-detail.ts.count.brouillon.s.genere.s.visibles.dans.0c88fdb0:${count}:count: brouillon(s) généré(s) — visibles dans « Brouillons à valider ».`
        });
        this.refreshToken.update(t => t + 1);
      },
      error: err => {
        this.actionInProgress.set(null);
        this.errorHandler.logError('RecurringContracts: trigger billing', err);
        this.toast.add({ severity: 'error', summary: $localize`:@@contract-detail.component.summary.Erreur:Erreur`, detail: this.errorHandler.extractErrorMessage(err) });
      }
    });
  }

  private cloneContract(): void {
    this.actionInProgress.set('clone');
    this.service.clone(this.contractId).subscribe({
      next: newId => {
        this.actionInProgress.set(null);
        this.toast.add({ severity: 'success', summary: $localize`:@@contract-detail.component.summary.Contrat_clon_:Contrat cloné`, detail: $localize`:@@contract-detail.component.detail.Le_nouveau_broui:Le nouveau brouillon a été créé.` });
        void this.router.navigate(['/recurring-contracts', newId]);
      },
      error: err => {
        this.actionInProgress.set(null);
        if (err?.status === 404) {
          this.toast.add({
            severity: 'info',
            summary: $localize`:@@contract-detail.component.summary.Fonction_indispo:Fonction indisponible`,
            detail: $localize`:@@contract-detail.component.detail.Fonction_disponi:Fonction disponible après la mise à jour du serveur.`
          });
          return;
        }
        this.errorHandler.logError('RecurringContracts: clone', err);
        this.toast.add({ severity: 'error', summary: $localize`:@@contract-detail.component.summary.Erreur:Erreur`, detail: this.errorHandler.extractErrorMessage(err) });
      }
    });
  }

  private runAction(action: 'activate' | 'suspend' | 'resume' | 'cancel', summary: string, detail: string): void {
    this.actionInProgress.set(action);
    this.service[action](this.contractId).subscribe({
      next: () => {
        this.actionInProgress.set(null);
        this.toast.add({ severity: 'success', summary, detail });
        this.reload();
        this.refreshToken.update(t => t + 1);
      },
      error: err => {
        this.actionInProgress.set(null);
        this.errorHandler.logError(`RecurringContracts: ${action}`, err);
        this.toast.add({ severity: 'error', summary: $localize`:@@contract-detail.component.summary.Erreur:Erreur`, detail: this.errorHandler.extractErrorMessage(err) });
      }
    });
  }

  private onContractLoaded(c: RecurringContractDetail): void {
    this.contract.set(c);
    this.loading.set(false);
  }

  private onLoadFailure(err: unknown): void {
    this.loading.set(false);
    this.loadError.set(true);
    this.errorHandler.logError('RecurringContracts: load detail', err);
    this.toast.add({ severity: 'error', summary: $localize`:@@contract-detail.component.summary.Erreur:Erreur`, detail: this.errorHandler.extractErrorMessage(err) });
  }

  /** Recharge sans skeleton pleine page (après avenant, notes, actions de cycle de vie). */
  private reloadContractOnly(): void {
    this.service.getDetail(this.contractId).subscribe({
      next: detail => {
        if (detail) {
          this.contract.set(detail);
        } else {
          this.service.get(this.contractId).subscribe({ next: c => this.contract.set(c), error: () => undefined });
        }
      },
      error: () => undefined
    });
    this.loadPhase2Data();
  }

  /** Données phase 2 : null = endpoint absent → placeholders, jamais de toast d'erreur. */
  private loadPhase2Data(): void {
    this.service.getFinancialSummary(this.contractId).subscribe({
      next: s => this.summary.set(s),
      error: err => {
        this.errorHandler.logError('RecurringContracts: financial summary', err);
        this.toast.add({ severity: 'error', summary: $localize`:@@contract-detail.component.summary.Erreur:Erreur`, detail: this.errorHandler.extractErrorMessage(err) });
      }
    });

    this.scheduleLoading.set(true);
    this.service.getSchedule(this.contractId, 12).subscribe({
      next: s => {
        this.schedule.set(s);
        this.scheduleLoading.set(false);
      },
      error: err => {
        this.scheduleLoading.set(false);
        this.errorHandler.logError('RecurringContracts: schedule (overview)', err);
        this.toast.add({ severity: 'error', summary: $localize`:@@contract-detail.component.summary.Erreur:Erreur`, detail: this.errorHandler.extractErrorMessage(err) });
      }
    });

    this.evolutionLoading.set(true);
    this.service.getEvolution(this.contractId, 6).subscribe({
      next: e => {
        this.evolution.set(e);
        this.evolutionLoading.set(false);
      },
      error: err => {
        this.evolutionLoading.set(false);
        this.errorHandler.logError('RecurringContracts: evolution', err);
        this.toast.add({ severity: 'error', summary: $localize`:@@contract-detail.component.summary.Erreur:Erreur`, detail: this.errorHandler.extractErrorMessage(err) });
      }
    });
  }
}
