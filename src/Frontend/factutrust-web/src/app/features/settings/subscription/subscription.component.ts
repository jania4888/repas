import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';
import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';
import { DividerModule } from 'primeng/divider';
import { ProgressBarModule } from 'primeng/progressbar';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import {
  SubscriptionService,
  SubscriptionInfo,
  PlanOption,
  BillingHistoryItem
} from '@core/services/subscription.service';
import { ToastService } from '@core/services/toast.service';
import { ChangePlanDialogComponent } from './change-plan-dialog/change-plan-dialog.component';

@Component({
  selector: 'app-subscription',
  standalone: true,
  imports: [BackendLabelPipe, 
    CommonModule,
    RouterModule,
    ButtonModule,
    CardModule,
    TagModule,
    DividerModule,
    ProgressBarModule,
    PageHeaderComponent,
    BreadcrumbComponent
  ],
  template: `
    <app-breadcrumb [items]="breadcrumbItems"></app-breadcrumb>

    <app-page-header
      title="Mon abonnement" i18n-title="@@settings.subscription.mon.abonnement.d248414d"
      subtitle="Gérez votre forfait et suivez votre consommation" i18n-subtitle="@@settings.subscription.gerez.votre.forfait.et.suivez.votre.cons.86ff45d8">
      <p-button
        label="Retour" i18n-label="@@settings.subscription.retour.e5befb1f"
        icon="pi pi-arrow-left"
        [outlined]="true"
        routerLink="/settings">
      </p-button>
    </app-page-header>

    <!-- Loading State -->
    @if (loading()) {
      <div class="current-plan-card skeleton-card">
        <div class="skeleton-block" style="width: 200px; height: 24px"></div>
        <div class="skeleton-block" style="width: 140px; height: 40px; margin-top: 8px"></div>
        <div class="skeleton-block" style="width: 260px; height: 16px; margin-top: 8px"></div>
      </div>
      <div class="skeleton-usage">
        @for (i of [1, 2, 3, 4]; track i) {
          <div class="skeleton-usage-item"></div>
        }
      </div>
    }

    <!-- Current Plan Banner -->
    @if (!loading() && subscription()) {
      <div class="current-plan-card">
        <div class="plan-info">
          <div class="plan-badge">
            <p-tag value="Forfait actuel" severity="info"></p-tag>
            <p-tag
              [value]="subscription()!.statusDisplay | backendLabel"
              [severity]="getStatusSeverity(subscription()!.status)">
            </p-tag>
          </div>
          <h2>{{ subscription()!.planDisplay | backendLabel }}</h2>
          <p class="plan-price">
            @if (subscription()!.plan === 'Free') {
              <span class="amount" i18n="@@settings.subscription.gratuit.705667ee">Gratuit</span>
            } @else {
              <span class="amount">{{ getPlanPrice() | number:'1.0-0' }}</span>
              <span class="currency" i18n="@@settings.subscription.tnd.51da21a7">TND</span>
              <span class="period" i18n="@@settings.subscription.mois.95e9be7f">/ mois</span>
            }
          </p>
          <p class="renewal-info">
            <i class="pi pi-calendar"></i>
            @if (subscription()!.endDate) {<ng-container i18n="@@settings.subscription.prochain.renouvellement.b6e9e41c">
              Prochain renouvellement : {{ subscription()!.endDate | date:'dd/MM/yyyy' }}
            </ng-container>} @else if (subscription()!.plan === 'Free') {<ng-container i18n="@@settings.subscription.forfait.gratuit.aucune.date.d.expiration.f0060395">
              Forfait gratuit — aucune date d'expiration
            </ng-container>} @else {<ng-container i18n="@@settings.subscription.actif.depuis.le.18a7117f">
              Actif depuis le {{ subscription()!.startDate | date:'dd/MM/yyyy' }}
            </ng-container>}
          </p>
        </div>
        <div class="plan-actions">
          <p-button
            label="Changer de forfait" i18n-label="@@settings.subscription.changer.de.forfait.9d073980"
            icon="pi pi-arrow-up"
            (onClick)="openChangePlanDialog()">
          </p-button>
          <p-button
            label="Gérer le paiement" i18n-label="@@settings.subscription.gerer.le.paiement.4ce031b8"
            icon="pi pi-credit-card"
            [outlined]="true">
          </p-button>
        </div>
      </div>

      @if (showInvoiceBlockWarning()) {
        <div class="subscription-alert-banner">
          <i class="pi pi-exclamation-triangle"></i>
          <div class="alert-content">
            <strong i18n="@@settings.subscription.emission.de.factures.indisponible.19185e3b">Émission de factures indisponible</strong>
            <p>{{ getInvoiceBlockMessage() }}</p>
          </div>
          @if (canRegularizeSubscription()) {
            <p-button
              label="Régulariser l'abonnement" i18n-label="@@settings.subscription.regulariser.l.abonnement.a58e2ad0"
              icon="pi pi-refresh"
              severity="warn"
              [outlined]="true"
              (onClick)="openChangePlanDialog()">
            </p-button>
          }
        </div>
      }

      <!-- Usage -->
      <p-card header="Utilisation ce mois" i18n-header="@@settings.subscription.utilisation.ce.mois.b8c6c579" styleClass="usage-card">
        <div class="usage-grid">
          @for (item of usageItems(); track item.label) {
            <div class="usage-item">
              <div class="usage-header">
                <span class="usage-label">{{ item.label }}</span>
                <span class="usage-value">
                  @if (item.isUnlimited) {<ng-container i18n="@@settings.subscription.illimite.6b1c8359">
                    {{ item.used }} / Illimité
                  </ng-container>} @else {
                    {{ item.used }} / {{ item.limit }}
                  }
                </span>
              </div>
              @if (!item.isUnlimited) {
                <p-progressBar
                  [value]="getUsagePercent(item)"
                  [showValue]="false"
                  [style]="{ height: '8px' }">
                </p-progressBar>
              } @else {
                <div class="unlimited-bar">
                  <div class="bar"></div>
                </div>
              }
            </div>
          }
        </div>
      </p-card>

      <!-- Plans Comparison (always visible) -->
      <div class="plans-section" id="plans">
        <h3 i18n="@@settings.subscription.changer.de.forfait.9d073980">Changer de forfait</h3>
        <div class="plans-grid">
          @for (plan of plans(); track plan.id) {
            <div
              class="plan-card"
              [class.popular]="plan.isPopular"
              [class.current]="plan.isCurrent">
              @if (plan.isPopular && !plan.isCurrent) {
                <div class="popular-badge" i18n="@@settings.subscription.recommande.e1a57119">Recommandé</div>
              }
              @if (plan.isCurrent) {
                <div class="current-badge" i18n="@@settings.subscription.votre.forfait.6d06f631">Votre forfait</div>
              }
              <h4>{{ plan.name }}</h4>
              <p class="plan-price-display">
                <span class="amount">{{ plan.priceMonthly | number:'1.0-0' }}</span>
                <span class="currency" i18n="@@settings.subscription.tnd.51da21a7">TND</span>
                <span class="period">/ {{ plan.period }}</span>
              </p>
              @if (plan.priceAnnual) {
                <p class="plan-annual-note" i18n="@@settings.subscription.facture.tnd.an.92930197">
                  Facturé {{ plan.priceAnnual | number:'1.0-0' }} TND/an
                </p>
              }
              @if (plan.savePercentage) {
                <div class="save-badge" i18n="@@settings.subscription.economisez.bb74433e">
                  <i class="pi pi-bolt"></i>
                  Économisez {{ plan.savePercentage }}%
                </div>
              }
              <ul class="plan-features">
                @for (feature of plan.features; track feature) {
                  <li>
                    <i class="pi pi-check"></i>
                    {{ feature }}
                  </li>
                }
                @for (feature of plan.disabledFeatures; track feature) {
                  <li class="disabled">
                    <i class="pi pi-minus"></i>
                    {{ feature }}
                  </li>
                }
              </ul>
              @if (plan.isCurrent) {
                @if (canRegularizeSubscription()) {
                  <p-button
                    label="Régulariser l'abonnement" i18n-label="@@settings.subscription.regulariser.l.abonnement.a58e2ad0"
                    styleClass="w-full"
                    severity="warn"
                    (onClick)="openChangePlanDialog()">
                  </p-button>
                } @else {
                  <p-button
                    label="Forfait actuel" i18n-label="@@settings.subscription.forfait.actuel.ad20553e"
                    [disabled]="true"
                    styleClass="w-full"
                    severity="secondary">
                  </p-button>
                }
              } @else {
                <p-button
                  [label]="getUpgradeLabel(plan)"
                  styleClass="w-full"
                  (onClick)="openChangePlanDialog(plan.id)">
                </p-button>
              }
            </div>
          }
        </div>
      </div>

      <!-- Billing History -->
      <p-card header="Historique de facturation" i18n-header="@@settings.subscription.historique.de.facturation.5cdc4eff" styleClass="billing-card">
        @if (billingHistory.length === 0) {
          <div class="empty-billing">
            <i class="pi pi-inbox"></i>
            <p i18n="@@settings.subscription.aucun.historique.de.facturation.pour.le.moment.348b48c6">Aucun historique de facturation pour le moment.</p>
          </div>
        } @else {
          <div class="billing-list">
            @for (invoice of billingHistory; track invoice.id) {
              <div class="billing-item">
                <div class="billing-info">
                  <span class="billing-date">{{ invoice.date | date:'dd/MM/yyyy' }}</span>
                  <span class="billing-desc">{{ invoice.description }}</span>
                </div>
                <div class="billing-amount">
                  <span>{{ invoice.amount | number:'1.3-3' }} {{ invoice.currency }}</span>
                  <p-tag
                    [value]="invoice.status"
                    [severity]="invoice.status === 'Payée' ? 'success' : 'warn'">
                  </p-tag>
                </div>
                <p-button
                  icon="pi pi-download"
                  [text]="true"
                  [rounded]="true"
                  pTooltip="Télécharger" i18n-pTooltip="@@settings.subscription.telecharger.b332d06d">
                </p-button>
              </div>
            }
          </div>
        }
      </p-card>
    }

    <!-- Error State -->
    @if (error()) {
      <div class="error-state">
        <i class="pi pi-exclamation-triangle"></i>
        <h3 i18n="@@settings.subscription.impossible.de.charger.votre.abonnement.890af3dd">Impossible de charger votre abonnement</h3>
        <p>{{ error() }}</p>
        <p-button
          label="Réessayer" i18n-label="@@settings.subscription.reessayer.895d416b"
          icon="pi pi-refresh"
          (onClick)="loadData()">
        </p-button>
      </div>
    }
  `,
  styles: [`
    .current-plan-card {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: var(--spacing-6);
      background: linear-gradient(135deg, var(--color-primary-600) 0%, var(--color-primary-700) 100%);
      border-radius: var(--radius-xl);
      margin-bottom: var(--spacing-6);
      color: white;

      @media (max-width: 768px) {
        flex-direction: column;
        text-align: center;
        gap: var(--spacing-4);
      }
    }

    .plan-info {
      .plan-badge {
        display: flex;
        flex-wrap: wrap;
        gap: var(--spacing-2);
        margin-bottom: var(--spacing-2);
      }

      h2 {
        margin: 0 0 var(--spacing-2);
        font-size: var(--font-size-2xl);
        font-weight: var(--font-weight-bold);
      }

      .plan-price {
        margin: 0 0 var(--spacing-3);

        .amount {
          font-size: var(--font-size-3xl);
          font-weight: var(--font-weight-bold);
        }

        .currency {
          font-size: var(--font-size-lg);
          opacity: 0.9;
        }

        .period {
          opacity: 0.8;
        }
      }

      .renewal-info {
        margin: 0;
        display: flex;
        align-items: center;
        gap: var(--spacing-2);
        opacity: 0.9;
        font-size: var(--font-size-sm);
      }
    }

    .plan-actions {
      display: flex;
      gap: var(--spacing-3);

      @media (max-width: 768px) {
        flex-direction: column;
      }
    }

    .subscription-alert-banner {
      display: flex;
      align-items: flex-start;
      gap: var(--spacing-4);
      padding: var(--spacing-4) var(--spacing-5);
      margin-bottom: var(--spacing-6);
      background: var(--color-warning-50, #fffbeb);
      border: 1px solid var(--color-warning-200, #fde68a);
      border-radius: var(--radius-lg);
      color: var(--color-warning-900, #78350f);

      > i {
        font-size: var(--font-size-xl);
        margin-top: 2px;
        color: var(--color-warning-600, #d97706);
      }

      .alert-content {
        flex: 1;

        strong {
          display: block;
          margin-bottom: var(--spacing-1);
        }

        p {
          margin: 0;
        }
      }
    }

    /* Loading Skeletons */
    .skeleton-card {
      justify-content: flex-start;
      flex-direction: column;
      align-items: flex-start;
      opacity: 0.8;
    }

    .skeleton-block {
      background: rgba(255, 255, 255, 0.2);
      border-radius: var(--radius-md);
      animation: pulse 1.5s ease-in-out infinite;
    }

    .skeleton-usage {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: var(--spacing-4);
      margin-bottom: var(--spacing-6);
    }

    .skeleton-usage-item {
      height: 80px;
      background: var(--color-neutral-100);
      border-radius: var(--radius-lg);
      animation: pulse 1.5s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    /* Usage */
    .usage-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: var(--spacing-6);
    }

    .usage-item {
      .usage-header {
        display: flex;
        justify-content: space-between;
        margin-bottom: var(--spacing-2);

        .usage-label {
          font-weight: var(--font-weight-medium);
          color: var(--color-neutral-700);
        }

        .usage-value {
          font-family: 'JetBrains Mono', monospace;
          font-size: var(--font-size-sm);
          color: var(--color-neutral-600);
        }
      }
    }

    .unlimited-bar {
      height: 8px;
      background: var(--color-neutral-100);
      border-radius: var(--radius-full);
      overflow: hidden;

      .bar {
        width: 100%;
        height: 100%;
        background: linear-gradient(90deg, var(--color-success-400), var(--color-success-500));
      }
    }

    /* Plans Section (always visible) */
    .plans-section {
      margin: var(--spacing-6) 0;

      h3 {
        margin: 0 0 var(--spacing-4);
        font-size: var(--font-size-xl);
        font-weight: var(--font-weight-semibold);
        color: var(--color-neutral-800);
      }
    }

    .plans-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: var(--spacing-4);
    }

    .plan-card {
      position: relative;
      padding: var(--spacing-6);
      background: white;
      border: 2px solid var(--color-neutral-200);
      border-radius: var(--radius-xl);
      transition: all var(--transition-fast);

      &:hover {
        border-color: var(--color-primary-300);
        transform: translateY(-2px);
      }

      &.popular {
        border-color: var(--color-primary-500);
      }

      &.current {
        border-color: var(--color-success-500);
        background: var(--color-success-50);
      }

      h4 {
        margin: 0 0 var(--spacing-3);
        font-size: var(--font-size-xl);
        font-weight: var(--font-weight-semibold);
        color: var(--color-neutral-900);
      }
    }

    .popular-badge,
    .current-badge {
      position: absolute;
      top: -12px;
      left: 50%;
      transform: translateX(-50%);
      padding: var(--spacing-1) var(--spacing-3);
      border-radius: var(--radius-full);
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-semibold);
      white-space: nowrap;
    }

    .popular-badge {
      background: var(--color-primary-500);
      color: white;
    }

    .current-badge {
      background: var(--color-success-500);
      color: white;
    }

    .plan-price-display {
      margin: 0 0 var(--spacing-2);

      .amount {
        font-size: var(--font-size-3xl);
        font-weight: var(--font-weight-bold);
        color: var(--color-neutral-900);
      }

      .currency {
        font-size: var(--font-size-lg);
        color: var(--color-neutral-600);
      }

      .period {
        font-size: var(--font-size-sm);
        color: var(--color-neutral-500);
      }
    }

    .plan-annual-note {
      font-size: var(--font-size-xs);
      color: var(--color-neutral-500);
      margin: 0 0 var(--spacing-2);
    }

    .save-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: var(--spacing-1) var(--spacing-3);
      background: var(--color-success-50);
      color: var(--color-success-700);
      border-radius: var(--radius-full);
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-semibold);
      margin-bottom: var(--spacing-3);

      i {
        font-size: 11px;
      }
    }

    .plan-features {
      list-style: none;
      padding: 0;
      margin: 0 0 var(--spacing-4);

      li {
        display: flex;
        align-items: center;
        gap: var(--spacing-2);
        padding: var(--spacing-2) 0;
        font-size: var(--font-size-sm);
        color: var(--color-neutral-700);

        i {
          color: var(--color-success-500);
          font-size: 13px;
          flex-shrink: 0;
        }

        &.disabled {
          color: var(--color-neutral-400);

          i {
            color: var(--color-neutral-400);
          }
        }
      }
    }

    /* Billing History */
    .billing-list {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-3);
    }

    .billing-item {
      display: flex;
      align-items: center;
      gap: var(--spacing-4);
      padding: var(--spacing-3);
      background: var(--color-neutral-50);
      border-radius: var(--radius-lg);
    }

    .billing-info {
      flex: 1;

      .billing-date {
        display: block;
        font-weight: var(--font-weight-medium);
        color: var(--color-neutral-800);
      }

      .billing-desc {
        font-size: var(--font-size-sm);
        color: var(--color-neutral-500);
      }
    }

    .billing-amount {
      display: flex;
      align-items: center;
      gap: var(--spacing-3);

      span:first-child {
        font-family: 'JetBrains Mono', monospace;
        font-weight: var(--font-weight-semibold);
      }
    }

    .empty-billing {
      text-align: center;
      padding: var(--spacing-8) var(--spacing-4);
      color: var(--color-neutral-400);

      i {
        font-size: 2.5rem;
        margin-bottom: var(--spacing-3);
      }

      p {
        margin: 0;
        font-size: var(--font-size-sm);
      }
    }

    /* Error State */
    .error-state {
      text-align: center;
      padding: var(--spacing-12);
      color: var(--color-neutral-500);

      i {
        font-size: 3rem;
        color: var(--color-error-400);
        margin-bottom: var(--spacing-4);
      }

      h3 {
        margin: 0 0 var(--spacing-2);
        color: var(--color-neutral-700);
      }

      p {
        margin: 0 0 var(--spacing-4);
        font-size: var(--font-size-sm);
      }
    }

    :host ::ng-deep {
      .usage-card,
      .billing-card {
        margin-bottom: var(--spacing-6);

        .p-card-header {
          padding: var(--spacing-4) var(--spacing-5);
          border-bottom: 1px solid var(--color-neutral-200);
          font-weight: var(--font-weight-semibold);
        }

        .p-card-body {
          padding: var(--spacing-5);
        }
      }
    }
  `]
})
export class SubscriptionComponent implements OnInit {
  private subscriptionService = inject(SubscriptionService);
  private toastService = inject(ToastService);
  private modalService = inject(NgbModal);

  loading = signal(true);
  error = signal<string | null>(null);
  subscription = signal<SubscriptionInfo | null>(null);
  plans = signal<PlanOption[]>([]);

  breadcrumbItems: BreadcrumbItem[] = [
    { label: $localize`:@@settings.subscription.ts.accueil.a8ff8fd2:Accueil`, route: '/dashboard', icon: 'pi-home' },
    { label: $localize`:@@settings.subscription.ts.parametres.ef8f0121:Paramètres`, route: '/settings' },
    { label: $localize`:@@settings.subscription.ts.subscription.8fde48f3:Subscription` }
  ];

  billingHistory: BillingHistoryItem[] = [];

  usageItems = computed(() => {
    const sub = this.subscription();
    if (!sub?.usage) return [];
    const u = sub.usage;
    return [u.invoices, u.quotes, u.clients, u.products, u.storage];
  });

  ngOnInit(): void {
    this.loadData();
  }

  loadData(): void {
    this.loading.set(true);
    this.error.set(null);

    this.subscriptionService.getCurrentSubscription(true).subscribe({
      next: (response) => {
        if (response.success) {
          this.subscription.set(response.data);
        } else {
          this.error.set(response.errors?.[0] ?? $localize`:@@ui.tern.erreur.inconnue.c3ec73:Erreur inconnue`);
        }
      },
      error: (err) => {
        this.error.set($localize`:@@settings.subscription.ts.impossible.de.contacter.le.serveur.verif.56ab13d5:Impossible de contacter le serveur. Vérifiez votre connexion.`);
        this.loading.set(false);
      }
    });

    this.subscriptionService.getAvailablePlans(true).subscribe({
      next: (response) => {
        if (response.success) {
          this.plans.set(response.data);
        }
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      }
    });
  }

  getPlanPrice(): number {
    const sub = this.subscription();
    if (!sub) return 0;
    if (sub.plan === 'Monthly') return sub.monthlyPrice ?? 49;
    if (sub.plan === 'Annual') return 39;
    return 0;
  }

  getStatusSeverity(status: string): 'success' | 'info' | 'warn' | 'danger' | 'secondary' {
    switch (status) {
      case 'Active': return 'success';
      case 'Trial': return 'info';
      case 'PastDue': return 'warn';
      case 'Suspended':
      case 'Expired':
      case 'Cancelled':
        return 'danger';
      default:
        return 'secondary';
    }
  }

  showInvoiceBlockWarning(): boolean {
    const sub = this.subscription();
    if (!sub) return false;
    if (typeof sub.canCreateInvoice === 'boolean') {
      return !sub.canCreateInvoice;
    }
    return !['Active', 'Trial'].includes(sub.status);
  }

  getInvoiceBlockMessage(): string {
    const sub = this.subscription();
    if (!sub) return '';
    if (sub.invoiceBlockMessage) {
      return sub.invoiceBlockMessage;
    }
    if (sub.plan !== 'Free' && ['Suspended', 'PastDue'].includes(sub.status)) {
      return $localize`:@@settings.subscription.ts.votre.forfait.plandisplay.est.actif.mais.3a655d24:Votre forfait ${sub.planDisplay}:planDisplay: est actif mais votre compte est ${sub.statusDisplay.toLowerCase()}:toLowerCase:. Régularisez votre paiement pour émettre des factures.`;
    }
    return $localize`:@@settings.subscription.ts.statut.d.abonnement.statusdisplay.emissi.8ad79e20:Statut d'abonnement « ${sub.statusDisplay}:statusDisplay: » : émission de factures indisponible.`;
  }

  canRegularizeSubscription(): boolean {
    const sub = this.subscription();
    return !!sub && ['Suspended', 'PastDue'].includes(sub.status);
  }

  getUsagePercent(item: { used: number; limit: number; isUnlimited: boolean }): number {
    if (item.isUnlimited || item.limit === 0) return 0;
    return Math.min(100, (item.used / item.limit) * 100);
  }

  getUpgradeLabel(plan: PlanOption): string {
    const current = this.subscription()?.plan;
    const order: Record<string, number> = { 'Free': 0, 'Monthly': 1, 'Annual': 2 };
    const currentOrder = order[current ?? $localize`:@@ui.tern.free.75f527:Free`] ?? 0;
    const targetOrder = order[plan.id] ?? 0;

    if (targetOrder > currentOrder) return $localize`:@@settings.subscription.ts.choisir.ce.forfait.a713a296:Choisir ce forfait`;
    if (targetOrder < currentOrder) return $localize`:@@settings.subscription.ts.retrograder.6740723a:Rétrograder`;
    return $localize`:@@settings.subscription.ts.choisir.ce.forfait.a713a296:Choisir ce forfait`;
  }

  openChangePlanDialog(preselectedPlanId?: string): void {
    const sub = this.subscription();
    const planList = this.plans();
    if (!sub || planList.length === 0) return;

    const ref = this.modalService.open(ChangePlanDialogComponent, {
      centered: true,
      size: 'lg',
      backdrop: 'static',
      keyboard: true,
      windowClass: 'change-plan-modal-window',
      scrollable: true
    });

    ref.componentInstance.currentSubscription = sub;
    ref.componentInstance.plans = planList;

    if (preselectedPlanId) {
      ref.componentInstance.selectedPlanId.set(preselectedPlanId);
    }

    ref.result.then(
      (updatedSubscription: SubscriptionInfo) => {
        this.subscription.set(updatedSubscription);
        this.subscriptionService.invalidateCache();
        this.subscriptionService.getAvailablePlans(true).subscribe({
          next: (response) => {
            if (response.success) {
              this.plans.set(response.data);
            }
          }
        });
      },
      () => {}
    );
  }
}
