import { Component, computed, DestroyRef, effect, inject, OnInit, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { EMPTY, distinctUntilChanged, finalize, map, switchMap } from 'rxjs';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { Textarea } from 'primeng/textarea';
import { TabsModule } from 'primeng/tabs';
import { MessageService } from 'primeng/api';
import { PlatformTenantService } from '@core/services/platform-tenant.service';
import { PlatformPermissionsService } from '@core/services/platform-permissions.service';
import { PlatformTenantProvisioningService } from '@core/services/platform-tenant-provisioning.service';
import { FtConfirmActionComponent } from '@core/ui/confirm-action/ft-confirm-action.component';
import { TENANTS_FR } from './tenants.i18n.fr';
import { PlatformDunningService } from '@core/services/platform-dunning.service';
import {
  DunningOutcomeValue,
  PlatformPermission,
  type DunningStateDto,
  type PlatformTenantDetailDto
} from '@core/models/platform.models';
import { TenantInvoicesTabComponent } from './tenant-invoices-tab.component';
import { TenantModulesTabComponent } from './tenant-modules-tab.component';
import { TenantModalSettingsTabComponent } from './tenant-modal-settings-tab.component';
import { TenantSectorTabComponent } from './tenant-sector-tab.component';
import { FtSkeletonComponent } from '@core/ui/skeleton/ft-skeleton.component';

@Component({
  selector: 'app-platform-tenant-detail-page',
  standalone: true,
  imports: [
    DatePipe,
    RouterLink,
    FormsModule,
    CardModule,
    TagModule,
    ButtonModule,
    DialogModule,
    SelectModule,
    Textarea,
    TabsModule,
    TenantInvoicesTabComponent,
    TenantModulesTabComponent,
    TenantModalSettingsTabComponent,
    TenantSectorTabComponent,
    FtSkeletonComponent,
    FtConfirmActionComponent
  ],
  template: `
    <p-button
      label="Retour à la liste"
      icon="pi pi-arrow-left"
      [outlined]="true"
      severity="secondary"
      routerLink="/tenants"
      styleClass="back-btn" />

    @if (loading()) {
      <div class="detail-loading" aria-busy="true" aria-label="Chargement de l'entreprise">
        <ft-skeleton shape="line" width="min(18rem, 70%)" />
        <ft-skeleton shape="rect" width="100%" height="2.25rem" />
        <ft-skeleton shape="line" />
        <ft-skeleton shape="line" width="85%" />
        <ft-skeleton shape="line" width="60%" />
      </div>
    } @else {
      @if (detail(); as d) {
      <div class="detail-header">
        <h1 class="page-title">{{ d.companyName }}</h1>
        <p-tag
          [severity]="d.isPayingSubscriber ? 'success' : 'secondary'"
          [value]="d.isPayingSubscriber ? 'Abonné payant' : 'Non abonné'" />
      </div>

      <!-- Le saga de provisionnement se termine APRES le commit des lignes maîtres : un dossier
           peut donc exister sans base exploitable. Sans ce bandeau, l'anomalie reste invisible et
           l'utilisateur ne comprend pas pourquoi il ne peut pas se connecter. -->
      @if (d.provisioningStatus === 'Pending' || d.provisioningStatus === 'Failed') {
        <div class="provisioning-banner" [class.provisioning-banner--failed]="d.provisioningStatus === 'Failed'">
          <i class="pi pi-database" aria-hidden="true"></i>
          <div class="provisioning-text">
            <strong>
              {{ d.provisioningStatus === 'Failed' ? tr('provisioning.failed') : tr('provisioning.pending') }}
            </strong>
            <span>
              La base de données de cette entreprise n'est pas opérationnelle : son administrateur ne
              peut pas se connecter tant que le provisionnement n'a pas abouti.
            </span>
          </div>
          @if (canRetryProvisioning()) {
            <p-button
              label="Relancer le provisionnement"
              icon="pi pi-refresh"
              size="small"
              [loading]="retryingProvisioning()"
              (onClick)="askRetryProvisioning()" />
          }
        </div>
      }

      <ft-confirm-action
        [(visible)]="retryConfirmVisible"
        title="Relancer le provisionnement"
        [description]="'Cette opération recrée la base de données du dossier. Elle est réservée aux dossiers en attente ou en échec.'"
        variant="destructive"
        [confirmKeyword]="d.companyName"
        [busy]="retryingProvisioning()"
        (confirmed)="confirmRetryProvisioning()" />

      <!-- Lot C6 (complément) — Bandeau cycle dunning actif -->
      @if (activeDunning(); as dn) {
        <div class="dunning-banner">
          <i class="pi pi-megaphone" aria-hidden="true"></i>
          <div class="dunning-text">
            <strong>Cycle de relance impayés en cours</strong>
            <span>
              Étape #{{ dn.currentStepIndex + 1 }} · Prochaine action le {{ dn.nextActionAt | date:'dd/MM/yyyy' }} ·
              Échéance facture {{ dn.dueDate | date:'dd/MM/yyyy' }} ·
              {{ dn.attemptsCount }} tentative(s)
            </span>
          </div>
          @if (canSeeDunningLink()) {
            <a routerLink="/dunning" class="dunning-link">Voir Dunning →</a>
          }
        </div>
      }

      <p-tabs
        class="ft-tab-view"
        [lazy]="true"
        [value]="activeTab()"
        (valueChange)="onTabChange($event)">
        <p-tablist>
          <p-tab [value]="0"><i class="pi pi-info-circle"></i><span>Vue d’ensemble</span></p-tab>
          @if (canSeeInvoices()) {
            <p-tab [value]="1"><i class="pi pi-file"></i><span>Factures plateforme</span></p-tab>
          }
          @if (canSeeModules()) {
            <p-tab [value]="2"><i class="pi pi-th-large"></i><span>Modules</span></p-tab>
          }
          @if (canSeeAiConfig()) {
            <p-tab [value]="3"><i class="pi pi-microchip-ai"></i><span>Configuration IA</span></p-tab>
          }
          @if (canSeeSectorConfig()) {
            <p-tab [value]="4"><i class="pi pi-sitemap"></i><span>Configuration sectorielle</span></p-tab>
          }
        </p-tablist>
        <p-tabpanels>
        <p-tabpanel [value]="0">
          <div class="detail-grid">
            <p-card header="Identité & contact">
              <dl class="dl-grid">
                <dt>Email</dt>
                <dd [attr.title]="d.companyEmail">
                  @if (d.companyEmail) {
                    <a class="muted-link" [href]="'mailto:' + d.companyEmail">{{ d.companyEmail }}</a>
                  } @else {
                    —
                  }
                </dd>
                <dt>NIF</dt>
                <dd>{{ d.nif }}</dd>
                <dt>Téléphone</dt>
                <dd>{{ d.phone }}</dd>
                <dt>Adresse</dt>
                <dd>{{ d.city }}, {{ d.governorate }}</dd>
                <dt>Site web</dt>
                <dd [attr.title]="d.website ?? undefined">{{ d.website ?? '—' }}</dd>
                <dt>Régime fiscal</dt>
                <dd>{{ d.taxRegimeDisplay }}</dd>
                @if (d.companySegment || d.businessDomain) {
                  <dt>Secteur</dt>
                  <dd>{{ d.companySegment ?? '—' }} @if (d.businessDomain) { / {{ d.businessDomain }} }</dd>
                }
              </dl>
            </p-card>

            <p-card header="Abonnement">
              <div class="sub-block">
                <div class="sub-row">
                  <span class="sub-label">Plan</span>
                  <span>{{ d.subscriptionPlanDisplay ?? '—' }}</span>
                </div>
                <div class="sub-row">
                  <span class="sub-label">Statut</span>
                  <span>{{ d.subscriptionStatusDisplay ?? '—' }}</span>
                </div>
                <div class="sub-row">
                  <span class="sub-label">Fin de période</span>
                  <span>{{ formatDate(d.subscriptionEndDate) }}</span>
                </div>
              </div>
              <div class="sub-actions">
                <p-button label="Changer le forfait" icon="pi pi-sync" (onClick)="openChangePlan()" />
                <p-button
                  label="Annuler l’abonnement"
                  icon="pi pi-times"
                  severity="danger"
                  [outlined]="true"
                  (onClick)="openCancel()" />
              </div>
            </p-card>

            <p-card header="Technique">
              <dl class="dl-grid">
                <dt>Base de données</dt>
                <dd [attr.title]="d.databaseName"><code class="code-pill">{{ d.databaseName }}</code></dd>
                <dt>Migrations tenant</dt>
                <dd>
                  <p-tag
                    [severity]="d.hasMigrationsApplied ? 'success' : 'warning'"
                    [value]="d.hasMigrationsApplied ? 'À jour' : 'Manquantes'" />
                </dd>
                <dt></dt>
                <dd>
                  <a routerLink="/migrations" class="muted-link">Voir la page migrations</a>
                </dd>
              </dl>
            </p-card>

            <p-card header="Statut entreprise">
              <p>
                <p-tag [severity]="d.isActive ? 'success' : 'danger'" [value]="d.isActive ? 'Actif' : 'Inactif'" />
                @if (d.deactivatedAt) {
                  <span class="deact"> Désactivée le {{ formatDate(d.deactivatedAt) }}</span>
                }
              </p>
            </p-card>
          </div>
        </p-tabpanel>

        @if (canSeeInvoices()) {
          <p-tabpanel [value]="1">
            <app-tenant-invoices-tab [tenantId]="d.tenantId" />
          </p-tabpanel>
        }
        @if (canSeeModules()) {
          <p-tabpanel [value]="2">
            <app-tenant-modules-tab [tenantId]="d.tenantId" />
          </p-tabpanel>
        }
        @if (canSeeAiConfig()) {
          <p-tabpanel [value]="3">
            <app-tenant-modal-settings-tab [tenantId]="d.tenantId" />
          </p-tabpanel>
        }
        @if (canSeeSectorConfig()) {
          <p-tabpanel [value]="4">
            <app-tenant-sector-tab
              [tenantId]="d.tenantId"
              [companyName]="d.companyName"
              [companySegment]="d.companySegment ?? null"
              [businessDomain]="d.businessDomain ?? null"
              (changed)="load(d.tenantId)"
            />
          </p-tabpanel>
        }
        </p-tabpanels>
      </p-tabs>
      } @else {
        <p class="not-found">Entreprise introuvable.</p>
      }
    }

    <p-dialog
      header="Changer le forfait"
      [(visible)]="changeVisible"
      [modal]="true"
      [draggable]="false"
      [style]="{ width: 'min(420px, 94vw)' }"
      (onHide)="changePlan = 'Free'">
      <div class="dialog-field">
        <label class="field-label" for="planSelect">Nouveau plan</label>
        <p-select
          inputId="planSelect"
          [options]="planOptions"
          [(ngModel)]="changePlan"
          optionLabel="label"
          optionValue="value"
          styleClass="w-full" />
      </div>
      <ng-template pTemplate="footer">
        <p-button label="Annuler" [outlined]="true" (onClick)="changeVisible = false" />
        <p-button label="Enregistrer" icon="pi pi-check" [loading]="changeSaving" (onClick)="saveChangePlan()" />
      </ng-template>
    </p-dialog>

    <p-dialog
      header="Annuler l’abonnement"
      [(visible)]="cancelVisible"
      [modal]="true"
      [draggable]="false"
      [style]="{ width: 'min(440px, 94vw)' }"
      (onHide)="cancelReason = ''">
      <div class="dialog-field">
        <label class="field-label" for="cancelReason">Raison (min. 10 caractères)</label>
        <textarea
          id="cancelReason"
          pTextarea
          [(ngModel)]="cancelReason"
          rows="4"
          class="w-full"
          autocomplete="off"></textarea>
      </div>
      <ng-template pTemplate="footer">
        <p-button label="Fermer" [outlined]="true" (onClick)="cancelVisible = false" />
        <p-button label="Annuler l’abonnement" severity="danger" [loading]="cancelSaving" (onClick)="saveCancel()" />
      </ng-template>
    </p-dialog>
  `,
  styles: [
    `
      .back-btn {
        margin-bottom: var(--ft-space-4, 1rem);
      }

      .detail-loading {
        display: flex;
        flex-direction: column;
        gap: var(--ft-space-4, 1rem);
        margin-top: var(--ft-space-2, 0.5rem);
      }
      .detail-header {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.75rem;
        margin-bottom: var(--ft-space-5, 1.25rem);
      }

      /* Lot C6 (complément) — Bandeau d'alerte cycle dunning actif */
      .provisioning-banner {
        display: flex;
        align-items: center;
        gap: 0.85rem;
        padding: 0.75rem 1rem;
        border: 1px solid var(--ft-warning-border, rgba(187, 128, 9, 0.4));
        background: var(--ft-warning-surface, rgba(187, 128, 9, 0.16));
        border-radius: var(--ft-radius, 8px);
        margin-bottom: var(--ft-space-4, 1rem);
        color: var(--ft-warning-text, #d29922);
      }
      .provisioning-banner--failed {
        border-color: var(--ft-danger-border, rgba(248, 81, 73, 0.4));
        background: var(--ft-danger-surface, rgba(248, 81, 73, 0.16));
        color: var(--ft-danger-text, #f85149);
      }
      .provisioning-banner i {
        font-size: 1.2rem;
      }
      .provisioning-text {
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
        flex: 1;
        font-size: 0.875rem;
      }
      .dunning-banner {
        display: flex;
        align-items: center;
        gap: 0.85rem;
        padding: 0.75rem 1rem;
        border: 1px solid var(--ft-warning-border, rgba(187, 128, 9, 0.4));
        background: var(--ft-warning-surface, rgba(187, 128, 9, 0.16));
        border-radius: var(--ft-radius, 8px);
        margin-bottom: var(--ft-space-4, 1rem);
        color: var(--ft-warning-text, #d29922);
      }
      .dunning-banner i {
        font-size: 1.2rem;
        flex-shrink: 0;
      }
      .dunning-text { display: flex; flex-direction: column; gap: 0.15rem; flex: 1; }
      .dunning-text strong { color: var(--ft-text); font-weight: 600; }
      .dunning-text span { color: var(--ft-text-muted); font-size: 0.85rem; }
      .dunning-link {
        color: var(--ft-warning-text, #d29922);
        text-decoration: none;
        font-weight: 600;
        font-size: 0.88rem;
        white-space: nowrap;
      }
      .dunning-link:hover { text-decoration: underline; }
      .page-title {
        margin: 0;
        font-size: 1.5rem;
        font-weight: 650;
        color: var(--ft-text, #e6edf3);
      }
      .detail-grid {
        display: grid;
        gap: var(--ft-space-4, 1rem);
        grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
        align-items: stretch;
      }
      :host ::ng-deep .detail-grid .p-card {
        height: 100%;
      }
      :host ::ng-deep .detail-grid .p-card .p-card-title {
        font-size: 0.8rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--ft-text-muted, #8b949e);
      }
      :host ::ng-deep .detail-grid .p-card .p-card-body {
        padding-top: 0.5rem;
      }
      .dl-grid {
        display: grid;
        grid-template-columns: 8rem 1fr;
        gap: 0.45rem 1rem;
        margin: 0;
      }
      dt {
        margin: 0;
        font-size: 0.8rem;
        color: var(--ft-text-muted, #8b949e);
      }
      dd {
        margin: 0;
        color: var(--ft-text, #e6edf3);
        word-break: break-word;
        overflow-wrap: anywhere;
      }
      .code-pill {
        font-size: 0.8rem;
        padding: 0.15rem 0.45rem;
        border-radius: 6px;
        background: var(--ft-surface-2, #0d1117);
        border: 1px solid var(--ft-border, #30363d);
        word-break: break-all;
        display: inline-block;
        max-width: 100%;
      }
      .sub-block {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        margin-bottom: 1rem;
      }
      .sub-row {
        display: flex;
        justify-content: space-between;
        gap: 1rem;
        font-size: 0.95rem;
      }
      .sub-label {
        color: var(--ft-text-muted, #8b949e);
      }
      .sub-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
      }
      .muted-link {
        color: var(--ft-accent, #58a6ff);
        text-decoration: none;
      }
      .muted-link:hover {
        text-decoration: underline;
      }
      .deact {
        color: var(--ft-text-muted, #8b949e);
        font-size: 0.9rem;
      }
      .not-found {
        color: var(--ft-text-muted, #8b949e);
      }
      .dialog-field {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        padding: 0.5rem 0 0;
      }
      .field-label {
        font-size: 0.85rem;
        font-weight: 600;
        color: var(--ft-text-muted, #8b949e);
      }
      .w-full {
        width: 100%;
      }
      :host ::ng-deep .p-dialog .p-select {
        width: 100%;
      }

      /* Sous-lot C4.5 — Tabs dark-friendly (héritage tokens --ft-*) */
      :host ::ng-deep .ft-tab-view .p-tablist-tab-list {
        background: transparent;
        border-bottom: 1px solid var(--ft-border, #30363d);
      }
      :host ::ng-deep .ft-tab-view .p-tab {
        background: transparent;
        color: var(--ft-text-muted, #8b949e);
        border-color: transparent;
      }
      :host ::ng-deep .ft-tab-view .p-tab.p-tab-active {
        color: var(--ft-accent, #58a6ff);
        border-color: var(--ft-accent, #58a6ff);
        background: transparent;
      }
      :host ::ng-deep .ft-tab-view .p-tabpanels {
        background: transparent;
        padding: 1.1rem 0 0;
      }
    `
  ]
})
export class PlatformTenantDetailPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(PlatformTenantService);
  private readonly dunningApi = inject(PlatformDunningService);
  private readonly messages = inject(MessageService);
  private readonly permissions = inject(PlatformPermissionsService);
  private readonly provisioning = inject(PlatformTenantProvisioningService);
  private readonly destroyRef = inject(DestroyRef);

  readonly detail = signal<PlatformTenantDetailDto | null>(null);
  readonly loading = signal(true);
  /** 0 overview · 1 invoices · 2 modules · 3 ai — ids stables, indépendants des @if. */
  readonly activeTab = signal(0);
  private loadedTenantId: string | null = null;

  constructor() {
    effect(() => {
      if (!this.permissions.isLoaded()) {
        return;
      }
      untracked(() => this.syncTabFromRoute());
    });
  }

  /** Visible si l'admin a la permission de lire les factures plateforme. */
  readonly retryConfirmVisible = signal(false);
  readonly retryingProvisioning = signal(false);

  readonly canRetryProvisioning = computed(() => this.permissions.has(PlatformPermission.TenantsWrite));

  protected tr(key: keyof typeof TENANTS_FR): string {
    return TENANTS_FR[key];
  }

  protected askRetryProvisioning(): void {
    this.retryConfirmVisible.set(true);
  }

  protected confirmRetryProvisioning(): void {
    const tenantId = this.detail()?.tenantId;
    if (!tenantId) return;

    this.retryingProvisioning.set(true);
    this.provisioning.retryProvisioning(tenantId).subscribe(result => {
      this.retryingProvisioning.set(false);
      this.retryConfirmVisible.set(false);

      if (result.success) {
        this.messages.add({ severity: 'success', summary: 'Provisionnement relancé' });
        this.load(tenantId);
        return;
      }

      this.messages.add({
        severity: 'error',
        summary: 'Erreur',
        detail: result.message ?? 'La reprise du provisionnement a échoué.'
      });
    });
  }

  readonly canSeeInvoices = computed(() => this.permissions.has(PlatformPermission.InvoiceRead));
  /** Visible si l'admin a la permission de gérer les plans (donc les overrides modules). */
  readonly canSeeModules = computed(() => this.permissions.has(PlatformPermission.PlansManage));
  readonly canSeeAiConfig = computed(() => this.permissions.has(PlatformPermission.AiManage));
  /** WP-F8 — visible si l'admin peut au moins consulter les règles sectorielles. */
  readonly canSeeSectorConfig = computed(() => this.permissions.has(PlatformPermission.SectorRulesRead));
  /** Lien direct vers la page Dunning si l'utilisateur a la permission `invoice:issue`. */
  readonly canSeeDunningLink = computed(() => this.permissions.has(PlatformPermission.InvoiceIssue));

  /** Lot C6 (complément) — Cycle dunning actif éventuel pour ce tenant. */
  readonly activeDunning = signal<DunningStateDto | null>(null);

  changeVisible = false;
  changePlan = 'Free';
  changeSaving = false;
  readonly planOptions = [
    { label: 'Gratuit', value: 'Free' },
    { label: 'Mensuel', value: 'Monthly' },
    { label: 'Annuel', value: 'Annual' }
  ];

  cancelVisible = false;
  cancelReason = '';
  cancelSaving = false;

  ngOnInit(): void {
    this.route.queryParamMap
      .pipe(
        map((p) => p.get('tab') ?? 'overview'),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => this.syncTabFromRoute());

    this.route.paramMap
      .pipe(
        map((p) => p.get('tenantId')),
        distinctUntilChanged(),
        switchMap((id) => {
          if (!id) {
            this.loadedTenantId = null;
            this.detail.set(null);
            this.loading.set(false);
            return EMPTY;
          }
          this.loadedTenantId = id;
          this.detail.set(null);
          this.loading.set(true);
          return this.api.get(id).pipe(finalize(() => this.loading.set(false)));
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (res) => this.handleTenantResponse(res),
        error: () => {
          this.detail.set(null);
          this.messages.add({
            severity: 'error',
            summary: 'Erreur',
            detail: 'Impossible de charger le détail'
          });
        }
      });
  }

  onTabChange(index: string | number): void {
    const tabIndex = typeof index === 'number' ? index : Number(index);
    if (Number.isNaN(tabIndex)) {
      return;
    }

    const key = this.tabKeyFromIndex(tabIndex);
    const current = this.route.snapshot.queryParamMap.get('tab') ?? 'overview';
    this.activeTab.set(tabIndex);

    if (key === current) {
      return;
    }

    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: key },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  private syncTabFromRoute(): void {
    const next = this.clampTabIndex(this.tabIndexFromQuery(this.route.snapshot.queryParamMap.get('tab')));
    if (this.activeTab() !== next) {
      this.activeTab.set(next);
    }
  }

  private clampTabIndex(index: number): number {
    if (index === 4 && !this.canSeeSectorConfig()) {
      return 0;
    }
    if (index === 3 && !this.canSeeAiConfig()) {
      return 0;
    }
    if (index === 2 && !this.canSeeModules()) {
      return 0;
    }
    if (index === 1 && !this.canSeeInvoices()) {
      return 0;
    }
    return index;
  }

  private tabIndexFromQuery(raw: string | null): number {
    if (raw === 'sector' && this.canSeeSectorConfig()) {
      return 4;
    }
    if (raw === 'ai' && this.canSeeAiConfig()) {
      return 3;
    }
    if (raw === 'invoices' && this.canSeeInvoices()) {
      return 1;
    }
    if (raw === 'modules' && this.canSeeModules()) {
      return 2;
    }
    return 0;
  }

  private tabKeyFromIndex(index: number): string {
    switch (index) {
      case 1:
        return 'invoices';
      case 2:
        return 'modules';
      case 3:
        return 'ai';
      case 4:
        return 'sector';
      default:
        return 'overview';
    }
  }

  private handleTenantResponse(res: { success: boolean; data?: PlatformTenantDetailDto | null; message?: string | null }): void {
    if (res.success && res.data) {
      this.detail.set(res.data);
      const d = res.data;
      if (d.subscriptionPlan != null) {
        const p = d.subscriptionPlan;
        if (typeof p === 'string') {
          this.changePlan = p;
        } else {
          const map = ['Free', 'Monthly', 'Annual'] as const;
          this.changePlan = map[p as number] ?? 'Free';
        }
      }
      const id = this.loadedTenantId;
      if (id) {
        this.loadActiveDunning(id);
      }
      this.syncTabFromRoute();
    } else {
      this.detail.set(null);
      this.messages.add({ severity: 'error', summary: 'Erreur', detail: res.message ?? 'Introuvable' });
    }
  }

  formatDate(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR');
  }

  /** Recharge le tenant courant (après changement d’abonnement). */
  load(id: string): void {
    this.loading.set(true);
    this.api
      .get(id)
      .pipe(
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (res) => this.handleTenantResponse(res),
        error: () => {
          this.detail.set(null);
          this.messages.add({
            severity: 'error',
            summary: 'Erreur',
            detail: 'Impossible de charger le détail'
          });
        }
      });
  }

  /** Lot C6 (complément) — Cherche s'il y a un cycle dunning Active pour ce tenant. */
  private loadActiveDunning(tenantId: string): void {
    this.activeDunning.set(null);
    // Seul l'admin avec permission invoice:read peut consulter — la route renvoie 403 sinon.
    if (!this.canSeeInvoices()) return;
    this.dunningApi.listStates('Active', tenantId, 1, 1).subscribe({
      next: res => {
        if (res.success && res.data && res.data.items.length > 0) {
          this.activeDunning.set(res.data.items[0]);
        }
      },
      error: () => {
        // silencieux — l'absence d'indicateur n'est pas critique
      }
    });
  }

  openChangePlan(): void {
    this.changeVisible = true;
  }

  openCancel(): void {
    this.cancelVisible = true;
  }

  saveChangePlan(): void {
    const id = this.detail()?.tenantId;
    if (!id) return;
    this.changeSaving = true;
    this.api.changeSubscription(id, this.changePlan).subscribe({
      next: res => {
        this.changeSaving = false;
        if (res.success) {
          this.changeVisible = false;
          this.messages.add({ severity: 'success', summary: 'Mis à jour', detail: res.message ?? 'Forfait enregistré' });
          this.load(id);
        } else {
          this.messages.add({ severity: 'error', summary: 'Erreur', detail: res.message ?? 'Échec' });
        }
      },
      error: () => {
        this.changeSaving = false;
        this.messages.add({ severity: 'error', summary: 'Erreur', detail: 'Requête échouée' });
      }
    });
  }

  saveCancel(): void {
    const id = this.detail()?.tenantId;
    if (!id) return;
    const reason = this.cancelReason.trim();
    if (reason.length < 10) {
      this.messages.add({
        severity: 'warn',
        summary: 'Validation',
        detail: 'La raison doit contenir au moins 10 caractères.'
      });
      return;
    }
    this.cancelSaving = true;
    this.api.cancelSubscription(id, reason).subscribe({
      next: res => {
        this.cancelSaving = false;
        if (res.success) {
          this.cancelVisible = false;
          this.cancelReason = '';
          this.messages.add({ severity: 'success', summary: 'Annulé', detail: res.message ?? 'Abonnement annulé' });
          this.load(id);
        } else {
          this.messages.add({ severity: 'error', summary: 'Erreur', detail: res.message ?? 'Échec' });
        }
      },
      error: () => {
        this.cancelSaving = false;
        this.messages.add({ severity: 'error', summary: 'Erreur', detail: 'Requête échouée' });
      }
    });
  }
}
