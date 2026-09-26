import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { DragDropModule, CdkDragDrop } from '@angular/cdk/drag-drop';
import { RouterModule, Router } from '@angular/router';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { ChartModule } from 'primeng/chart';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { SkeletonTableComponent, SkeletonColumn } from '@shared/components/skeleton/skeleton-table.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { StatusBadgeComponent, StatusBadgeStatus } from '@shared/components/status-badge/status-badge.component';
import { StatCardComponent } from '@shared/components/stat-card/stat-card.component';
import { ChartCardComponent } from '@shared/components/dashboard/chart-card.component';
import { DashboardPanelComponent } from '@shared/components/dashboard/dashboard-panel.component';
import { InvoiceService, InvoiceListItem } from '@core/services/invoice.service';
import { isUnpaidInvoice, sumRealizedRevenue } from '@core/utils/invoice-metrics.util';
import { AuthService } from '@core/services/auth.service';
import { WarehouseContextService } from '@core/services/warehouse-context.service';
import { StockService, StockAlertsResult } from '@core/services/stock.service';
import { DeliveryNoteService } from '../../features/delivery-notes/services/delivery-note.service';
import { DeliveryNoteListDto, DeliveryNoteStatus } from '../../features/delivery-notes/models/delivery-note.model';
import { DecimalPipe, DatePipe, CurrencyPipe } from '@angular/common';
import { QuoteListItem } from '@core/services/quote.service';
import { DashboardService, MonthlyRevenueData, TopClientData, ActivityItem, KpiTrends, KpiSparklines } from './services/dashboard.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { AppModule } from '@core/models/app-module';
import { AccountingService, AccountingDashboardDto } from '../accounting/services/accounting.service';
import { CrmService } from '../crm/services/crm.service';
import { PurchaseOrderService } from '@core/services/purchase-order.service';
import { ProjectApiService } from '../projects/project-api.service';
import { RecurringContractService } from '@core/services/recurring-contract.service';
import { APP_MODULE_OPTIONS } from '@core/models/app-module';
import {
  SectorKpiWidgetDef,
  isQuickActionWidgetVisible,
  QUICK_ACTION_WIDGETS,
  visibleSectorKpiWidgets
} from './dashboard-widgets.registry';
import { createHttpContextSkipGlobalErrorUi } from '@core/http-context';
import { TenantSystemStatusService } from '@core/services/tenant-system-status.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { AnalyzeWithAiButtonComponent } from '@features/ai-assistant/components/analyze-with-ai-button/analyze-with-ai-button.component';
import { wrapLegacyAnalyzePayload } from '@features/ai-assistant/utils/ai-screen-payload.factory';
import {
  canNavigateToTarget,
  DashboardDrillDownId,
  DashboardDrillDownTarget,
  getDrillDownTarget
} from './dashboard-drill-down.config';
import {
  DashboardBlockId,
  DEFAULT_DASHBOARD_BLOCK_ORDER,
  blockLabel,
  reorderFullOrder
} from './dashboard-layout.config';
import { DashboardLayoutService } from './services/dashboard-layout.service';
import { OnboardingChecklistComponent } from '@shared/onboarding/onboarding-checklist.component';
import { CompanyModulesService } from '@core/services/company-modules.service';
import { ModuleRecommendationsService, ModuleRecommendationDto } from '@core/services/module-recommendations.service';
import { ToastService } from '@core/services/toast.service';
import { MODULE_ICON_BY_ID } from '@core/utils/module-icon.util';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  providers: [DecimalPipe, DatePipe, CurrencyPipe],
  imports: [
    CommonModule,
    DragDropModule,
    RouterModule,
    TableModule,
    ButtonModule,
    CardModule,
    ChartModule,
    PageHeaderComponent,
    SkeletonTableComponent,
    EmptyStateComponent,
    ButtonComponent,
    StatusBadgeComponent,
    StatCardComponent,
    ChartCardComponent,
    DashboardPanelComponent,
    AnalyzeWithAiButtonComponent,
    OnboardingChecklistComponent
  ],
  template: `
    <app-page-header 
      title="Tableau de bord" i18n-title="Tableau de bord" 
      [subtitle]="greeting">
      <app-analyze-with-ai-button
        screenId="dashboard"
        [payloadBuilder]="buildDashboardAnalyzePayload"
        [disabled]="loading()" />
      @if (canCreateInvoice()) {
        <app-button 
          variant="primary"
          icon="pi-plus"
          iconPos="left"
          routerLink="/invoices/new" i18n="@@dashboard.dashboard.nouvelle.facture.cdf7e09c">Nouvelle facture</app-button>
      }
      @if (!editMode()) {
        <app-button variant="ghost" icon="pi-th-large" iconPos="left" (click)="enterEdit()" i18n="@@dashboard.dashboard.personnaliser.b9d70818">Personnaliser</app-button>
      }
    </app-page-header>

    <app-onboarding-checklist />

    @if (tenantMigrationFailed()) {
      <div class="dashboard-migration-banner" role="alert">
        <i class="pi pi-database" aria-hidden="true"></i>
        <span>{{ tenantMigrationMessage }}</span>
        <button type="button" class="dashboard-migration-banner__retry" (click)="reloadAfterMigrationIssue()" i18n="@@dashboard.dashboard.reessayer.895d416b">Réessayer</button>
      </div>
    }

    <!-- Barre de personnalisation (mode édition) -->
    @if (editMode()) {
      <div class="dash-edit-toolbar" role="region" aria-label="Personnalisation du tableau de bord" i18n-aria-label="Personnalisation du tableau de bord">
        <span class="dash-edit-toolbar__hint">
          <i class="pi pi-arrows-alt" aria-hidden="true"></i>
          Glissez les sections (ou utilisez les flèches) pour réorganiser votre tableau de bord.
        </span>
        <span class="dash-edit-toolbar__actions">
          <app-button variant="ghost" icon="pi-undo" iconPos="left" (click)="resetLayout()" i18n="@@dashboard.dashboard.reinitialiser.e0e2ad54">Réinitialiser</app-button>
          <app-button variant="ghost" (click)="cancelEdit()" i18n="@@dashboard.dashboard.annuler.49ba3292">Annuler</app-button>
          <app-button variant="primary" icon="pi-check" iconPos="left" [disabled]="savingLayout()" (click)="saveEdit()" i18n="@@dashboard.dashboard.enregistrer.f7c8bcd8">Enregistrer</app-button>
        </span>
      </div>
    }

    <!-- Conteneur réorganisable des blocs du tableau de bord -->
    <div
      class="dash-blocks"
      [class.dash-blocks--edit]="editMode()"
      cdkDropList
      [cdkDropListDisabled]="!editMode()"
      (cdkDropListDropped)="onBlockDrop($event)">
      @for (block of renderedBlocks(); track block.id) {
        <div class="dash-block" [class.dash-block--edit]="editMode()" cdkDrag [cdkDragDisabled]="!editMode()">
          @if (editMode()) {
            <div class="dash-block__handle" cdkDragHandle>
              <span class="dash-block__handle-label"><i class="pi pi-bars" aria-hidden="true"></i> {{ block.label }}</span>
              <span class="dash-block__handle-controls">
                <button type="button" class="dash-block__move" (click)="moveBlock(block.id, -1)" aria-label="Monter la section" i18n-aria-label="Monter la section">
                  <i class="pi pi-chevron-up" aria-hidden="true"></i>
                </button>
                <button type="button" class="dash-block__move" (click)="moveBlock(block.id, 1)" aria-label="Descendre la section" i18n-aria-label="Descendre la section">
                  <i class="pi pi-chevron-down" aria-hidden="true"></i>
                </button>
              </span>
            </div>
          }
          <div class="dash-block__body">
            @switch (block.id) {
              @case ('kpi') { <ng-container [ngTemplateOutlet]="kpiTpl"></ng-container> }
              @case ('sector') { <ng-container [ngTemplateOutlet]="sectorTpl"></ng-container> }
              @case ('recommendations') { <ng-container [ngTemplateOutlet]="recommendationsTpl"></ng-container> }
              @case ('urgent') { <ng-container [ngTemplateOutlet]="urgentTpl"></ng-container> }
              @case ('quick-actions') { <ng-container [ngTemplateOutlet]="quickActionsTpl"></ng-container> }
              @case ('accounting') { <ng-container [ngTemplateOutlet]="accountingTpl"></ng-container> }
              @case ('crm') { <ng-container [ngTemplateOutlet]="crmTpl"></ng-container> }
              @case ('chart') { <ng-container [ngTemplateOutlet]="chartTpl"></ng-container> }
              @case ('bottom-grid') { <ng-container [ngTemplateOutlet]="bottomGridTpl"></ng-container> }
            }
          </div>
        </div>
      }
    </div>

    <!-- ===== Définitions des blocs (rendus via ngTemplateOutlet ci-dessus) ===== -->
    <ng-template #kpiTpl>
    <!-- Statistics Cards -->
    @if (loading()) {
      <div class="kpi-row">
        <div class="stat-skeleton"></div>
        <div class="stat-skeleton"></div>
        <div class="stat-skeleton"></div>
        <div class="stat-skeleton"></div>
        <div class="stat-skeleton"></div>
      </div>
    } @else {
      <div class="kpi-row" data-tour="dash-kpi">
        @if (canReadInvoices()) {
        <app-stat-card
          label="Chiffre d'affaires"
          [value]="totalRevenue()"
          icon="fa-solid fa-sack-dollar"
          variant="primary"
          tone="primary"
          appearance="solid"
          [sparkline]="kpiSparklines()?.revenue ?? null"
          [change]="kpiTrends()?.revenueChange"
          [routerLink]="drillDown('totalRevenue')?.route"
          [queryParams]="drillDown('totalRevenue')?.queryParams"
          [navigationAriaLabel]="drillDown('totalRevenue')?.ariaLabel">
        </app-stat-card>
        <app-stat-card
          label="Ventes aujourd'hui"
          [value]="salesToday()"
          icon="fa-solid fa-cart-shopping"
          variant="primary"
          tone="cyan"
          appearance="solid"
          [sparkline]="kpiSparklines()?.salesToday ?? null"
          [routerLink]="drillDown('salesToday')?.route"
          [queryParams]="drillDown('salesToday')?.queryParams"
          [navigationAriaLabel]="drillDown('salesToday')?.ariaLabel">
        </app-stat-card>
        <app-stat-card
          label="CA du mois en cours"
          [value]="currentMonthRevenue()"
          icon="fa-solid fa-calendar-check"
          variant="success"
          tone="emerald"
          appearance="solid"
          [sparkline]="kpiSparklines()?.currentMonth ?? null"
          [change]="kpiTrends()?.revenueChange"
          [routerLink]="drillDown('currentMonthRevenue')?.route"
          [queryParams]="drillDown('currentMonthRevenue')?.queryParams"
          [navigationAriaLabel]="drillDown('currentMonthRevenue')?.ariaLabel">
        </app-stat-card>
        <app-stat-card
          label="Factures impayées"
          [value]="pendingInvoicesCount()"
          icon="fa-solid fa-clock"
          variant="warning"
          tone="amber"
          appearance="solid"
          [sparkline]="kpiSparklines()?.pending ?? null"
          [change]="kpiTrends()?.pendingChange"
          [routerLink]="drillDown('pendingInvoices')?.route"
          [queryParams]="drillDown('pendingInvoices')?.queryParams"
          [navigationAriaLabel]="drillDown('pendingInvoices')?.ariaLabel">
        </app-stat-card>
        }
        @if (showStockUrgent()) {
        <app-stat-card
          label="Produits en alerte"
          [value]="stockAlertsCount()"
          icon="fa-solid fa-triangle-exclamation"
          [variant]="stockAlertsCount() > 0 ? 'error' : 'success'"
          [tone]="stockAlertsCount() > 0 ? 'rose' : 'emerald'"
          appearance="solid"
          [sparkline]="null"
          [routerLink]="drillDown('stockAlerts')?.route"
          [queryParams]="drillDown('stockAlerts')?.queryParams"
          [navigationAriaLabel]="drillDown('stockAlerts')?.ariaLabel">
        </app-stat-card>
        }
      </div>
    }

    </ng-template>

    <ng-template #sectorTpl>
    <!-- Aperçu sectoriel & modules actifs (plan v1 §2.5 — dashboard adaptatif) -->
    <div class="sector-block">
      @if (sectorKpiWidgets().length > 0) {
        <div class="sector-kpi-row">
          @for (widget of sectorKpiWidgets(); track widget.widgetId) {
            <a [routerLink]="widget.route" class="sector-kpi-card" [ngClass]="widget.tone">
              <span class="sector-kpi-icon"><i [class]="widget.icon" aria-hidden="true"></i></span>
              <div class="sector-kpi-text">
                <span class="sector-kpi-label">{{ widget.labelFr }}</span>
                <span class="sector-kpi-value">{{ sectorKpiValue(widget) ?? '—' }}</span>
              </div>
            </a>
          }
        </div>
      }
      <div class="modules-block">
        <div class="modules-block__header">
          <span class="modules-block__title"><i class="fa-solid fa-puzzle-piece" aria-hidden="true"></i> Modules actifs</span>
          <a routerLink="/settings/modules" class="modules-block__link">
            Gérer mes modules <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>
          </a>
        </div>
        <div class="modules-block__pills">
          @for (mod of activeModuleOptions(); track mod.value) {
            <span class="mod-pill">{{ mod.label }}</span>
          }
        </div>
      </div>
    </div>
    </ng-template>

    <ng-template #recommendationsTpl>
    <!-- Recommandé pour vous (plan §3.3) — cartes d'activation en un clic -->
    @if (moduleRecommendations().length > 0) {
      <div class="recommendations-block">
        <div class="recommendations-block__header">
          <span class="recommendations-block__title"><i class="pi pi-sparkles" aria-hidden="true"></i> Recommandé pour vous</span>
        </div>
        <div class="recommendations-block__cards">
          @for (rec of moduleRecommendations(); track rec.moduleId) {
            <div class="recommendation-card">
              <div class="recommendation-card__head">
                <span class="recommendation-card__icon"><i [class]="recommendationModuleIcon(rec.moduleId)" aria-hidden="true"></i></span>
                <span class="recommendation-card__label">{{ recommendationModuleLabel(rec.moduleId) }}</span>
              </div>
              <p class="recommendation-card__reason">{{ rec.reasonFr }}</p>
              <div class="recommendation-card__actions">
                <button type="button" class="btn-activate"
                        (click)="activateRecommendation(rec.moduleId)"
                        [disabled]="activatingModuleId() !== null">
                  @if (activatingModuleId() === rec.moduleId) {
                    <i class="pi pi-spin pi-spinner" aria-hidden="true"></i> Activation…
                  } @else {
                    <i class="pi pi-check" aria-hidden="true"></i> Activer
                  }
                </button>
                <button type="button" class="btn-dismiss" (click)="dismissRecommendation(rec.moduleId)" i18n="@@dashboard.dashboard.masquer.adb05f2b">Masquer</button>
              </div>
            </div>
          }
        </div>
      </div>
    }
    </ng-template>

    <ng-template #urgentTpl>
    <!-- Urgent Actions Banner -->
    @if (!loading() && hasUrgentActions()) {
      <div class="urgent-actions-banner">
        <div class="urgent-header">
          <i class="pi pi-bell"></i>
          <span i18n="@@dashboard.dashboard.actions.requises.3ec278be">Actions requises</span>
        </div>
        <div class="urgent-items">
          @if (showStockUrgent() && stockAlertsCount() > 0) {
            @if (drillDown('urgentStock'); as stockTarget) {
              <a [routerLink]="stockTarget.route" [queryParams]="stockTarget.queryParams" class="urgent-item urgent-danger" [attr.aria-label]="stockTarget.ariaLabel">
                <i class="pi pi-exclamation-triangle"></i>
                <span>{{ stockAlertsCount() }} produit(s) en rupture ou stock faible</span>
                <i class="pi pi-arrow-right urgent-arrow"></i>
              </a>
            }
          }
          @if (showDeliveryUrgent() && pendingDeliveriesCount() > 0) {
            @if (drillDown('urgentDeliveries'); as deliveryTarget) {
              <a [routerLink]="deliveryTarget.route" [queryParams]="deliveryTarget.queryParams" class="urgent-item urgent-warning" [attr.aria-label]="deliveryTarget.ariaLabel">
                <i class="pi pi-truck"></i>
                <span>{{ pendingDeliveriesCount() }} livraison(s) en attente</span>
                <i class="pi pi-arrow-right urgent-arrow"></i>
              </a>
            }
          }
          @if (showInvoiceUrgent() && overdueInvoicesCount() > 0) {
            @if (drillDown('urgentOverdueInvoices'); as invoiceTarget) {
              <a [routerLink]="invoiceTarget.route" [queryParams]="invoiceTarget.queryParams" class="urgent-item urgent-danger" [attr.aria-label]="invoiceTarget.ariaLabel">
                <i class="pi pi-exclamation-circle"></i>
                <span>{{ overdueInvoicesCount() }} facture(s) en retard</span>
                <i class="pi pi-arrow-right urgent-arrow"></i>
              </a>
            }
          }
        </div>
      </div>
    }

    </ng-template>

    <ng-template #quickActionsTpl>
    <!-- Actions rapides + cartes latérales (style maquette) -->
    <div class="dash-actions-row">
      <div class="section quick-actions-card" data-tour="dash-quick-actions">
        <h3 class="qa-title"><i class="fa-solid fa-bolt"></i> Actions rapides</h3>
        @if (hasAnyQuickAction()) {
        <div class="quick-actions">
          @if (canCreateInvoice()) {
            <a routerLink="/invoices/new" class="quick-action-card">
              <div class="quick-action-icon qa-invoice"><i class="fa-solid fa-file-invoice"></i></div>
              <span class="quick-action-label" i18n="@@dashboard.dashboard.creer.une.facture.13a9becd">Créer une facture</span>
            </a>
          }
          @if (canReadQuotes()) {
            <a routerLink="/quotes" class="quick-action-card">
              <div class="quick-action-icon qa-quote"><i class="fa-solid fa-file-lines"></i></div>
              <span class="quick-action-label" i18n="@@dashboard.dashboard.nouveau.devis.4c3f0159">Nouveau devis</span>
            </a>
          }
          @if (canCreateDeliveryNote()) {
            <a routerLink="/delivery-notes/new" class="quick-action-card">
              <div class="quick-action-icon qa-delivery"><i class="fa-solid fa-truck"></i></div>
              <span class="quick-action-label" i18n="@@dashboard.dashboard.bon.de.livraison.1a60dc44">Bon de livraison</span>
            </a>
          }
          @if (canCreateReturnNote()) {
            <a routerLink="/return-notes/new" class="quick-action-card">
              <div class="quick-action-icon qa-return"><i class="fa-solid fa-rotate-left"></i></div>
              <span class="quick-action-label" i18n="@@dashboard.dashboard.bon.de.retour.58d2db35">Bon de retour</span>
            </a>
          }
          @if (canReadClients()) {
            <a routerLink="/clients" class="quick-action-card">
              <div class="quick-action-icon qa-client"><i class="fa-solid fa-users"></i></div>
              <span class="quick-action-label" i18n="@@dashboard.dashboard.mes.clients.5d1deb5c">Mes clients</span>
            </a>
          }
          @if (canReadPayments()) {
            <a routerLink="/payments" class="quick-action-card">
              <div class="quick-action-icon qa-payment"><i class="fa-solid fa-credit-card"></i></div>
              <span class="quick-action-label" i18n="@@dashboard.dashboard.paiements.97ecc646">Paiements</span>
            </a>
          }
          @if (canReadReports()) {
            <a routerLink="/reports" class="quick-action-card">
              <div class="quick-action-icon qa-report"><i class="fa-solid fa-chart-column"></i></div>
              <span class="quick-action-label" i18n="@@dashboard.dashboard.rapports.db7d9fbb">Rapports</span>
            </a>
          }
          @if (canUseStockEntryQuickAction()) {
            <a routerLink="/stock/entries/new" class="quick-action-card">
              <div class="quick-action-icon qa-stock"><i class="fa-solid fa-box"></i></div>
              <span class="quick-action-label" i18n="@@dashboard.dashboard.entree.de.stock.8c8e1df1">Entrée de stock</span>
            </a>
          }
          @if (canUseNewOpportunityQuickAction()) {
            <a routerLink="/crm/opportunities" class="quick-action-card">
              <div class="quick-action-icon qa-crm"><i class="fa-solid fa-heart"></i></div>
              <span class="quick-action-label" i18n="@@dashboard.dashboard.nouvelle.opportunite.ffadea57">Nouvelle opportunité</span>
            </a>
          }
        </div>
        } @else {
        <div class="quick-actions-empty">
          <i class="fa-solid fa-puzzle-piece quick-actions-empty-icon" aria-hidden="true"></i>
          <p i18n="@@dashboard.dashboard.activez.des.modules.pour.voir.vos.actions.rapide.a0632dc0">Activez des modules pour voir vos actions rapides.</p>
          <a routerLink="/settings/company" class="quick-actions-empty-link">
            Gérer mon entreprise <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>
          </a>
        </div>
        }
      </div>

      <div class="dash-side-cards">
        @if (showPendingDeliveriesSideCard()) {
          @if (drillDown('pendingDeliveriesSide'); as deliveriesTarget) {
            <a class="dash-side-card dash-side-card--clickable" [routerLink]="deliveriesTarget.route" [queryParams]="deliveriesTarget.queryParams" [attr.aria-label]="deliveriesTarget.ariaLabel">
              <span class="ft-icon-badge ft-icon-badge--lg ft-icon-badge--teal"><i class="fa-solid fa-truck-fast"></i></span>
              <div class="dash-side-text">
                <span class="dash-side-label" i18n="@@dashboard.dashboard.livraisons.en.attente.8a489de6">Livraisons en attente</span>
                <span class="dash-side-value">{{ pendingDeliveriesCount() }}</span>
              </div>
            </a>
          } @else {
            <div class="dash-side-card">
              <span class="ft-icon-badge ft-icon-badge--lg ft-icon-badge--teal"><i class="fa-solid fa-truck-fast"></i></span>
              <div class="dash-side-text">
                <span class="dash-side-label" i18n="@@dashboard.dashboard.livraisons.en.attente.8a489de6">Livraisons en attente</span>
                <span class="dash-side-value">{{ pendingDeliveriesCount() }}</span>
              </div>
            </div>
          }
        }
        @if (showActiveQuotesSideCard()) {
          @if (drillDown('activeQuotesSide'); as quotesTarget) {
            <a class="dash-side-card dash-side-card--clickable" [routerLink]="quotesTarget.route" [queryParams]="quotesTarget.queryParams" [attr.aria-label]="quotesTarget.ariaLabel">
              <span class="ft-icon-badge ft-icon-badge--lg ft-icon-badge--indigo"><i class="fa-solid fa-file-contract"></i></span>
              <div class="dash-side-text">
                <span class="dash-side-label" i18n="@@dashboard.dashboard.devis.en.cours.ec2118b7">Devis en cours</span>
                <span class="dash-side-value">{{ activeQuotesCount() }}</span>
              </div>
            </a>
          } @else {
            <div class="dash-side-card">
              <span class="ft-icon-badge ft-icon-badge--lg ft-icon-badge--indigo"><i class="fa-solid fa-file-contract"></i></span>
              <div class="dash-side-text">
                <span class="dash-side-label" i18n="@@dashboard.dashboard.devis.en.cours.ec2118b7">Devis en cours</span>
                <span class="dash-side-value">{{ activeQuotesCount() }}</span>
              </div>
            </div>
          }
        }
      </div>
    </div>

    </ng-template>


    <ng-template #accountingTpl>
    @if (hasAccountingModule() && accountingKpis()) {
      <div class="section accounting-kpis-section" aria-label="Indicateurs comptables" i18n-aria-label="Indicateurs comptables">
        <div class="section-header">
          <h2 class="section-title" i18n="@@dashboard.dashboard.comptabilite.20af7266">Comptabilité</h2>
          <a routerLink="/accounting/journal" class="section-link" i18n="@@dashboard.dashboard.voir.le.journal.2d6bf019">Voir le journal</a>
        </div>
        <div class="stats-grid">
          <app-stat-card
            label="TVA due (estim.)"
            [value]="formatAccountingAmount(accountingKpis()!.vatDueEstimate)"
            icon="pi-percentage"
            variant="primary"
            appearance="solid"
            [sparkline]="null"
            [routerLink]="drillDown('accountingVat')?.route"
            [queryParams]="drillDown('accountingVat')?.queryParams"
            [navigationAriaLabel]="drillDown('accountingVat')?.ariaLabel">
          </app-stat-card>
          <app-stat-card
            label="Créances +90 j."
            [value]="formatAccountingAmount(accountingKpis()!.overdueReceivablesOver90)"
            icon="pi-clock"
            variant="warning"
            appearance="solid"
            [sparkline]="null"
            [routerLink]="drillDown('accountingReceivables90')?.route"
            [queryParams]="drillDown('accountingReceivables90')?.queryParams"
            [navigationAriaLabel]="drillDown('accountingReceivables90')?.ariaLabel">
          </app-stat-card>
          <app-stat-card
            label="Factures non comptabilisées"
            [value]="accountingKpis()!.unpostedInvoiceCount"
            icon="pi-file-excel"
            variant="primary"
            appearance="solid"
            [sparkline]="null"
            [routerLink]="drillDown('accountingUnposted')?.route"
            [queryParams]="drillDown('accountingUnposted')?.queryParams"
            [navigationAriaLabel]="drillDown('accountingUnposted')?.ariaLabel">
          </app-stat-card>
          <app-stat-card
            label="Prochaine échéance TVA"
            [value]="formatVatDeadline(accountingKpis()!.nextVatDeadline)"
            icon="pi-calendar"
            variant="primary"
            appearance="solid"
            [sparkline]="null"
            [routerLink]="drillDown('accountingVatDeadline')?.route"
            [queryParams]="drillDown('accountingVatDeadline')?.queryParams"
            [navigationAriaLabel]="drillDown('accountingVatDeadline')?.ariaLabel">
          </app-stat-card>
        </div>
      </div>
    }

    </ng-template>

    <ng-template #crmTpl>
    @if (hasCrmModule()) {
      <div class="section crm-kpis-section" aria-label="CRM" i18n-aria-label="CRM">
        <div class="section-header">
          <h2 class="section-title" i18n="@@dashboard.dashboard.crm.commercial.96a9fcf3">CRM Commercial</h2>
          <a routerLink="/crm/dashboard" class="section-link" i18n="@@dashboard.dashboard.voir.le.crm.cef605de">Voir le CRM</a>
        </div>
        <div class="stats-grid">
          <app-stat-card
            label="Mes relances"
            [value]="crmRemindersCount()"
            icon="pi-bell"
            [variant]="crmRemindersCount() > 0 ? 'warning' : 'success'"
            appearance="solid"
            [sparkline]="null"
            [routerLink]="drillDown('crmReminders')?.route"
            [queryParams]="drillDown('crmReminders')?.queryParams"
            [navigationAriaLabel]="drillDown('crmReminders')?.ariaLabel">
          </app-stat-card>
          <app-stat-card
            label="Opportunités ouvertes"
            [value]="crmOpenOppsCount()"
            icon="pi-bullseye"
            variant="primary"
            appearance="solid"
            [sparkline]="null"
            [routerLink]="drillDown('crmOpenOpportunities')?.route"
            [queryParams]="drillDown('crmOpenOpportunities')?.queryParams"
            [navigationAriaLabel]="drillDown('crmOpenOpportunities')?.ariaLabel">
          </app-stat-card>
        </div>
      </div>
    }

    </ng-template>

    <ng-template #chartTpl>
    <!-- Revenue Chart Section (Superieur chart-card + p-chart area) -->
    @if (!loading() && monthlyRevenue().length > 0) {
      <app-chart-card
        title="Évolution du CA" i18n-title="Évolution du CA"
        subtitle="6 derniers mois"
        aria-label="Évolution du chiffre d'affaires sur 6 mois" i18n-aria-label="Évolution du chiffre d'affaires sur 6 mois">
        <div chart-actions>
          @if (drillDown('totalRevenue'); as revenueTarget) {
            <a [routerLink]="revenueTarget.route" [queryParams]="revenueTarget.queryParams" class="section-link" [attr.aria-label]="revenueTarget.ariaLabel" i18n="@@dashboard.dashboard.details.aaa029e6">Détails</a>
          }
        </div>
        <p-chart
          type="line"
          [data]="revenueChartData()"
          [options]="revenueChartOptions"
          [style]="{ height: '280px' }" />
        <!-- Fallback CSS bars kept for accessibility drill-down months -->
        <div class="chart-month-links" role="navigation" aria-label="Mois du graphique" i18n-aria-label="Mois du graphique">
          @for (month of monthlyRevenue(); track month.monthShort) {
            @if (drillDown('chartMonth', month); as monthTarget) {
              <button
                type="button"
                class="chart-month-link"
                (click)="onChartMonthClick(month)"
                [attr.aria-label]="monthTarget.ariaLabel">
                {{ month.monthShort }}
              </button>
            }
          }
        </div>
      </app-chart-card>
    }

    </ng-template>

    <ng-template #bottomGridTpl>
    <!-- Two-column grid for lower sections -->
    <div class="dashboard-grid">
      <!-- Left Column -->
      <div class="dashboard-col-left">
        <!-- Recent Invoices -->
        @if (canReadInvoices()) {
        <app-dashboard-panel title="Factures récentes" i18n-title="Factures récentes" [hasActions]="true">
          <a panel-actions routerLink="/invoices" class="section-link" i18n="@@dashboard.dashboard.voir.tout.7b7d86e8">Voir tout</a>

          @if (initialLoad()) {
      <app-skeleton-table 
              [rows]="5" 
              [columns]="skeletonColumns">
            </app-skeleton-table>
          } @else {
            <p-table 
          [loading]="loading()" 
              [value]="recentInvoices()" 
              styleClass="p-datatable-sm dashboard-table"
              [rows]="5">
            <ng-template pTemplate="header">
              <tr>
                <th style="width: 180px" i18n="@@dashboard.dashboard.numero.15e73db0">Numéro</th>
                <th i18n="@@dashboard.dashboard.client.1bdd79b1">Client</th>
                <th style="width: 120px" i18n="@@dashboard.dashboard.date.eb9a4bc1">Date</th>
                <th style="width: 140px" class="text-right" i18n="@@dashboard.dashboard.montant.4adcd9fc">Montant</th>
                <th style="width: 130px" i18n="@@dashboard.dashboard.statut.659499f3">Statut</th>
                <th style="width: 60px"></th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-invoice>
              <tr [routerLink]="['/invoices', invoice.id]" class="table-row">
                <td>
                  <a [routerLink]="['/invoices', invoice.id]" class="invoice-link" (click)="$event.stopPropagation()">
                    {{ invoice.number }}
                  </a>
                </td>
                <td>
                  <span class="client-name">{{ invoice.clientName }}</span>
                </td>
                <td>
                  <span class="invoice-date">{{ invoice.issueDate | date:'dd/MM/yyyy' }}</span>
                </td>
                <td class="amount text-right">{{ invoice.totalAmount | number:'1.3-3' }} {{ invoice.currency }}</td>
                <td>
                  <app-status-badge 
                    [status]="getStatusBadgeStatus(invoice.status)"
                    [label]="invoice.status">
                  </app-status-badge>
                </td>
                <td>
                  <app-button 
                    variant="ghost"
                    size="sm"
                    icon="pi-eye"
                    [iconOnly]="true"
                    [routerLink]="['/invoices', invoice.id]"
                    ariaLabel="Voir la facture"
                    (click)="$event.stopPropagation()">
                  </app-button>
                </td>
              </tr>
            </ng-template>
            <ng-template pTemplate="emptymessage">
              <tr>
                <td colspan="6" class="text-center p-4" data-tour="dash-empty-invoice">
                  <app-empty-state
                    illustration="empty-invoices.svg"
                    title="Aucune facture" i18n-title="Aucune facture"
                    description="Créez votre première facture pour commencer à facturer vos clients."
                    [showAction]="canCreateInvoice()"
                    actionLabel="Créer votre première facture"
                    actionRoute="/invoices/new">
                  </app-empty-state>
                </td>
              </tr>
            </ng-template>
            </p-table>
          }
        </app-dashboard-panel>
        }
      </div>

      <!-- Right Column -->
      <div class="dashboard-col-right">
        <!-- Top Clients -->
        @if (!loading() && topClients().length > 0 && canReadClients()) {
          <div class="section" aria-label="Top 5 clients par chiffre d'affaires" i18n-aria-label="Top 5 clients par chiffre d'affaires">
            <div class="section-header">
              <h2 class="section-title" i18n="@@dashboard.dashboard.top.clients.dd696714">Top clients</h2>
              <a routerLink="/clients" class="section-link" i18n="@@dashboard.dashboard.voir.tout.7b7d86e8">Voir tout</a>
            </div>
            <div class="top-clients-list">
              @for (client of topClients(); track client.id; let i = $index) {
                <a [routerLink]="['/clients', client.id]" class="top-client-item">
                  <div class="top-client-rank">{{ i + 1 }}</div>
                  <div class="top-client-info">
                    <span class="top-client-name">{{ client.name }}</span>
                    <span class="top-client-meta">{{ client.invoiceCount }} facture{{ client.invoiceCount > 1 ? 's' : '' }}</span>
                  </div>
                  <div class="top-client-revenue">
                    <span class="top-client-amount">{{ client.totalRevenue | number:'1.3-3' }} {{ client.currency }}</span>
                    <div class="top-client-bar">
                      <div class="top-client-bar-fill" [style.width.%]="client.percentage"></div>
                    </div>
                  </div>
                </a>
              }
            </div>
          </div>
        }

        <!-- Recent Quotes -->
        @if (!loading() && canReadQuotes()) {
          <div class="section" aria-label="Devis récents" i18n-aria-label="Devis récents">
            <div class="section-header">
              <h2 class="section-title" i18n="@@dashboard.dashboard.devis.recents.4379bba9">Devis récents</h2>
              <a routerLink="/quotes" class="section-link" i18n="@@dashboard.dashboard.voir.tout.7b7d86e8">Voir tout</a>
            </div>

            @if (recentQuotes().length === 0) {
              <div class="empty-section-message">
                <i class="pi pi-file"></i>
                <p i18n="@@dashboard.dashboard.aucun.devis.pour.le.moment.d644469b">Aucun devis pour le moment</p>
              </div>
            } @else {
              <div class="quotes-list">
                @for (quote of recentQuotes(); track quote.id) {
                  <a [routerLink]="['/quotes', quote.id]" class="quote-item">
                    <div class="quote-item-left">
                      <span class="quote-number">{{ quote.number }}</span>
                      <span class="quote-client">{{ quote.clientName }}</span>
                    </div>
                    <div class="quote-item-right">
                      <span class="quote-amount">{{ quote.totalAmount | number:'1.3-3' }} {{ quote.currency }}</span>
                      <app-status-badge
                        [status]="getStatusBadgeStatus(quote.status)"
                        [label]="quote.status">
                      </app-status-badge>
                    </div>
                  </a>
                }
              </div>
            }
          </div>
        }

        <!-- Activity Timeline -->
        @if (!loading() && recentActivity().length > 0) {
          <div class="section" aria-label="Activité récente" i18n-aria-label="Activité récente">
            <div class="section-header">
              <h2 class="section-title" i18n="@@dashboard.dashboard.activite.recente.524eaf8e">Activité récente</h2>
            </div>
            <div class="timeline">
              @for (activity of recentActivity(); track activity.id + activity.type) {
                <a [routerLink]="activity.link" class="timeline-item">
                  <div class="timeline-icon" [class]="activity.iconClass">
                    <i [class]="'pi ' + activity.icon"></i>
                  </div>
                  <div class="timeline-content">
                    <span class="timeline-description">{{ activity.description }}</span>
                    <span class="timeline-date">{{ activity.relativeDate }}</span>
                  </div>
                </a>
              }
            </div>
          </div>
        }
      </div>
    </div>
    </ng-template>
  `,
  styles: [`
    .dashboard-migration-banner {
      display: flex;
      align-items: center;
      gap: var(--spacing-3);
      margin-bottom: var(--spacing-4);
      padding: var(--spacing-3) var(--spacing-4);
      border-radius: var(--radius-lg);
      border: 1px solid var(--color-warning-border, #f59e0b);
      background: var(--color-warning-subtle, #fffbeb);
      color: var(--color-text-primary);
    }

    .dashboard-migration-banner__retry {
      margin-left: auto;
      border: none;
      border-radius: var(--radius-md);
      background: var(--color-primary);
      color: #fff;
      padding: 0.35rem 0.85rem;
      cursor: pointer;
    }

    /* Rangée de 5 cartes KPI — style maquette (s'adapte/replie en grille). */
    .kpi-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      gap: var(--spacing-4);
      margin-bottom: var(--spacing-6);
      animation: fadeInUp 0.4s ease-out;
    }

    /* Styles du contenu projeté des cartes KPI (.kpi-progress/.kpi-spark/.kpi-sub) :
       déplacés dans styles/_design-layer.scss (global) — s'appliquent au contenu projeté
       et n'entrent pas dans le budget de styles par-composant. */

    /* Grille KPI réutilisée par les sections Comptabilité et CRM (conservée). */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: var(--spacing-4);
      min-width: 0;
      animation: fadeInUp 0.4s ease-out;
    }

    .stat-skeleton {
      background: var(--color-background-elevated);
      border-radius: var(--radius-xl);
      padding: var(--spacing-5);
      height: 120px;
      border: 1px solid var(--color-border-subtle);
      animation: pulse 1.5s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    /* ===== Urgent Actions Banner ===== */
    .urgent-actions-banner {
      background: var(--gradient-banner-warning, var(--color-warning-50));
      border-radius: var(--radius-xl);
      padding: var(--spacing-4) var(--spacing-5);
      margin-bottom: var(--spacing-6);
      border: 1px solid var(--color-warning-200);
      border-left: 4px solid var(--color-warning-600, #d97706);
      box-shadow: var(--shadow-soft-md, var(--shadow-sm));
      animation: fadeInUp 0.5s ease-out 0.1s both;
    }

    .urgent-header {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      font-weight: var(--font-weight-bold);
      color: var(--color-warning-800);
      margin-bottom: var(--spacing-3);
      font-size: var(--font-size-xs);
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .urgent-header i {
      animation: pulseSubtle 2.5s ease-in-out infinite;
    }

    .urgent-items {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);
    }

    .urgent-item {
      display: flex;
      align-items: center;
      gap: var(--spacing-3);
      padding: var(--spacing-3) var(--spacing-4);
      border-radius: var(--radius-lg);
      text-decoration: none;
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      transition: all var(--transition-fast);
      cursor: pointer;
    }

    .urgent-item:hover {
      transform: translateX(4px);
    }

    .urgent-item .urgent-arrow {
      margin-left: auto;
      opacity: 0;
      transition: opacity var(--transition-fast);
    }

    .urgent-item:hover .urgent-arrow {
      opacity: 1;
    }

    .urgent-danger {
      background: var(--gradient-banner-danger, var(--color-error-50));
      color: var(--color-error-700);
      border: 1px solid var(--color-error-100);
      border-left: 3px solid var(--color-error-600);
    }

    .urgent-danger:hover {
      background: var(--color-error-100);
      box-shadow: 0 4px 12px rgba(239, 68, 68, 0.12);
    }

    .urgent-warning {
      background: var(--gradient-banner-warning, var(--color-warning-50));
      color: var(--color-warning-700);
      border: 1px solid var(--color-warning-100);
      border-left: 3px solid var(--color-warning-600);
    }

    .urgent-warning:hover {
      background: var(--color-warning-100);
      box-shadow: 0 4px 12px rgba(245, 158, 11, 0.12);
    }

    /* ===== Quick Actions ===== */
    /* Ligne « Actions rapides » (carte) + cartes latérales (Livraisons/Devis) — maquette. */
    .dash-actions-row {
      display: grid;
      grid-template-columns: 2fr 1fr;
      gap: var(--spacing-6);
      margin-bottom: var(--spacing-6);
      animation: fadeInUp 0.5s ease-out 0.2s both;
    }

    .qa-title {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      font-size: var(--font-size-lg);
      font-weight: var(--font-weight-bold);
      color: var(--color-text-primary);
      margin: 0 0 var(--spacing-4);
    }
    .qa-title i { color: var(--color-warning-500, #f59e0b); }

    .quick-actions {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: var(--spacing-3);
    }

    .quick-actions-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: var(--spacing-2);
      padding: var(--spacing-6) var(--spacing-4);
      border: 1px dashed var(--color-neutral-300);
      border-radius: var(--radius-lg, 0.75rem);
      color: var(--color-text-secondary);
    }
    .quick-actions-empty-icon {
      font-size: var(--font-size-xl, 1.5rem);
      color: var(--color-neutral-400);
    }
    .quick-actions-empty p {
      margin: 0;
      font-size: var(--font-size-sm);
    }
    .quick-actions-empty-link {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-1);
      font-weight: var(--font-weight-semibold);
      color: var(--color-primary-600, #2563eb);
      text-decoration: none;
    }
    .quick-actions-empty-link:hover { text-decoration: underline; }

    .dash-side-cards {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-4);
    }

    a.dash-side-card--clickable {
      text-decoration: none;
      color: inherit;
      cursor: pointer;
      transition: transform var(--duration-moderate, 260ms) var(--ease-out-soft, cubic-bezier(0.16, 1, 0.3, 1)),
                  box-shadow var(--duration-moderate, 260ms) var(--ease-out-soft, cubic-bezier(0.16, 1, 0.3, 1)),
                  border-color var(--duration-moderate, 260ms) var(--ease-out-soft, cubic-bezier(0.16, 1, 0.3, 1));
    }

    a.dash-side-card--clickable:hover {
      transform: translateY(-3px);
      box-shadow: var(--shadow-soft-lg, var(--shadow-lg));
      border-color: var(--color-accent-300, #a5b4fc);
    }

    a.dash-side-card--clickable:focus-visible {
      outline: 2px solid var(--color-primary-500);
      outline-offset: 2px;
    }

    /* .dash-side-card / -text / -label / -value : déplacés dans _design-layer.scss (global). */

    @media (max-width: 1024px) {
      .dash-actions-row { grid-template-columns: 1fr; }
    }

    .quick-action-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--spacing-3);
      padding: var(--spacing-5) var(--spacing-4);
      background: var(--color-background-elevated);
      border-radius: var(--radius-xl);
      border: 1px solid var(--color-border-subtle);
      text-decoration: none;
      transition: transform var(--duration-moderate, 260ms) var(--ease-out-soft, cubic-bezier(0.16, 1, 0.3, 1)),
                  box-shadow var(--duration-moderate, 260ms) var(--ease-out-soft, cubic-bezier(0.16, 1, 0.3, 1)),
                  border-color var(--duration-moderate, 260ms) var(--ease-out-soft);
      cursor: pointer;
      box-shadow: var(--shadow-soft-sm, var(--shadow-sm));
      position: relative;
      overflow: hidden;
    }

    /* Effet d'accent en hover : ligne de gradient en bas du card */
    .quick-action-card::after {
      content: '';
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: var(--gradient-primary, linear-gradient(90deg, #3b82f6, #6366f1));
      transform: scaleX(0);
      transform-origin: left;
      transition: transform var(--duration-moderate, 260ms) var(--ease-out-soft);
    }

    .quick-action-card:hover {
      transform: translateY(-3px);
      box-shadow: var(--shadow-soft-lg, var(--shadow-lg));
      border-color: var(--color-accent-300, #a5b4fc);
    }

    .quick-action-card:hover::after {
      transform: scaleX(1);
    }

    .quick-action-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 48px;
      height: 48px;
      border-radius: var(--radius-lg);
      font-size: var(--font-size-xl);
    }

    .qa-invoice {
      background: var(--color-primary-100);
      color: var(--color-primary-600);
    }

    .qa-quote {
      background: var(--color-success-100);
      color: var(--color-success-600);
    }

    .qa-delivery {
      background: var(--color-warning-100);
      color: var(--color-warning-600);
    }

    .qa-return {
      background: var(--color-info-100, #e0f2fe);
      color: var(--color-info-600, #0284c7);
    }

    .qa-client {
      background: var(--color-neutral-100);
      color: var(--color-neutral-600);
    }

    .qa-payment {
      background: #ecfdf5;
      color: #059669;
    }

    .qa-report {
      background: #eff6ff;
      color: #2563eb;
    }

    .qa-stock {
      background: #ecfeff;
      color: #0e7490;
    }

    .qa-crm {
      background: #fdf2f8;
      color: #db2777;
    }

    /* ===== Aperçu sectoriel & modules (plan v1 §2.5) ===== */
    .sector-block {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-4);
    }

    .sector-kpi-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: var(--spacing-3);
    }

    .sector-kpi-card {
      display: flex;
      align-items: center;
      gap: var(--spacing-3);
      padding: var(--spacing-3) var(--spacing-4);
      border-radius: var(--radius-lg);
      border: 1px solid var(--color-border-subtle, var(--color-neutral-200));
      background: var(--color-surface-card, #fff);
      text-decoration: none;
      transition: transform var(--duration-moderate, 260ms) var(--ease-out-soft), box-shadow var(--duration-moderate, 260ms) var(--ease-out-soft);
    }

    .sector-kpi-card:hover {
      transform: translateY(-2px);
      box-shadow: var(--shadow-soft-lg, var(--shadow-lg));
    }

    .sector-kpi-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      border-radius: var(--radius-lg);
      font-size: var(--font-size-lg);
      flex-shrink: 0;
    }

    .sector-kpi-card.sector-kpi--amber .sector-kpi-icon { background: var(--color-warning-100); color: var(--color-warning-600); }
    .sector-kpi-card.sector-kpi--purple .sector-kpi-icon { background: #f3e8ff; color: #9333ea; }
    .sector-kpi-card.sector-kpi--indigo .sector-kpi-icon { background: #e0e7ff; color: #4f46e5; }
    .sector-kpi-card.sector-kpi--teal .sector-kpi-icon { background: #ccfbf1; color: #0d9488; }

    .sector-kpi-text {
      display: flex;
      flex-direction: column;
    }

    .sector-kpi-label {
      font-size: var(--font-size-xs);
      color: var(--color-text-secondary);
    }

    .sector-kpi-value {
      font-size: var(--font-size-lg);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
    }

    .modules-block {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);
      padding: var(--spacing-3) var(--spacing-4);
      border-radius: var(--radius-lg);
      border: 1px solid var(--color-border-subtle, var(--color-neutral-200));
      background: var(--color-surface-subtle, var(--color-neutral-50));
    }

    .modules-block__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: var(--spacing-2);
    }

    .modules-block__title {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
    }

    .modules-block__link {
      font-size: var(--font-size-sm);
      color: var(--color-primary-600);
      text-decoration: none;
      font-weight: var(--font-weight-medium);
    }

    .modules-block__link:hover {
      text-decoration: underline;
    }

    .modules-block__pills {
      display: flex;
      flex-wrap: wrap;
      gap: var(--spacing-2);
    }

    .mod-pill {
      display: inline-flex;
      align-items: center;
      padding: var(--spacing-1) var(--spacing-3);
      border-radius: var(--radius-full, 999px);
      background: var(--color-surface-card, #fff);
      border: 1px solid var(--color-border-subtle, var(--color-neutral-200));
      font-size: var(--font-size-xs);
      color: var(--color-text-secondary);
    }

    /* Plan §3.3 — « Recommandé pour vous » */
    .recommendations-block {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-3);
    }

    .recommendations-block__header {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
    }

    .recommendations-block__title {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;

      i { color: var(--color-primary-600); }
    }

    .recommendations-block__cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: var(--spacing-3);
    }

    .recommendation-card {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      padding: var(--spacing-3) var(--spacing-4);
      border-radius: var(--radius-lg);
      border: 1px solid var(--color-border-subtle, var(--color-neutral-200));
      background: var(--color-surface-card, #fff);
    }

    .recommendation-card__head {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .recommendation-card__icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border-radius: var(--radius-md, 8px);
      background: var(--color-primary-50);
      color: var(--color-primary-600);
      flex-shrink: 0;
    }

    .recommendation-card__label {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
    }

    .recommendation-card__reason {
      margin: 0;
      font-size: var(--font-size-xs);
      color: var(--color-text-secondary);
      line-height: 1.45;
      flex: 1;
    }

    .recommendation-card__actions {
      display: flex;
      align-items: center;
      gap: 0.6rem;
    }

    .btn-activate {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      padding: 0.35rem 0.8rem;
      border-radius: var(--radius-md, 8px);
      border: none;
      background: var(--color-primary-600);
      color: #fff;
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-medium);
      cursor: pointer;
      transition: background var(--duration-fast, 150ms);

      &:hover:not(:disabled) { background: var(--color-primary-700); }
      &:disabled { opacity: 0.6; cursor: not-allowed; }
    }

    .btn-dismiss {
      background: transparent;
      border: none;
      cursor: pointer;
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-medium);
      color: var(--color-text-secondary);
      padding: 0.35rem 0.4rem;

      &:hover { text-decoration: underline; color: var(--color-text-primary); }
    }

    .quick-action-label {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      color: var(--color-text-primary);
      text-align: center;
    }

    /* ===== Revenue Chart ===== */
    .chart-section {
      margin-bottom: var(--spacing-6);
    }

    .section-subtitle {
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
      font-weight: var(--font-weight-normal);
    }

    .chart-container {
      padding: var(--spacing-4) 0;
    }

    .chart-bars {
      display: flex;
      align-items: flex-end;
      justify-content: space-around;
      height: 220px;
      gap: var(--spacing-3);
      padding: 0 var(--spacing-2);
    }

    .chart-bar-group {
      display: flex;
      flex-direction: column;
      align-items: center;
      flex: 1;
      max-width: 80px;
      position: relative;
      height: 100%;
      justify-content: flex-end;
    }

    .chart-bar-group--clickable {
      cursor: pointer;
      border-radius: var(--radius-md);
    }

    .chart-bar-group--clickable:focus-visible {
      outline: 2px solid var(--color-primary-500);
      outline-offset: 2px;
    }

    .section-title--link {
      text-decoration: none;
      color: inherit;
    }

    .section-title--link:hover {
      color: var(--color-primary-600);
    }

    .chart-bar-wrapper {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: flex-end;
      justify-content: center;
      position: relative;
    }

    .chart-bar {
      width: 70%;
      min-height: 4px;
      background: linear-gradient(180deg, var(--color-primary-400), var(--color-primary-600));
      border-radius: var(--radius-md) var(--radius-md) 0 0;
      transition: height 0.8s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease;
      cursor: pointer;
      position: relative;
    }

    .chart-bar:hover {
      background: linear-gradient(180deg, var(--color-primary-300), var(--color-primary-500));
      opacity: 0.9;
    }

    /* ===== Étiquette permanente au-dessus de chaque barre ===== */
    .chart-bar-value {
      position: absolute;
      top: -22px;
      left: 50%;
      transform: translateX(-50%);
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
      white-space: nowrap;
      pointer-events: none;
      font-family: 'JetBrains Mono', 'SF Mono', monospace;
      letter-spacing: -0.2px;
      opacity: 0;
      animation: chartValueFadeIn 0.6s ease-out 0.4s forwards;
    }

    @keyframes chartValueFadeIn {
      from { opacity: 0; transform: translateX(-50%) translateY(4px); }
      to   { opacity: 1; transform: translateX(-50%) translateY(0); }
    }

    /* Affichage par défaut : full format (desktop) */
    .chart-bar-value--compact { display: none; }
    .chart-bar-value--full    { display: block; }

    .chart-tooltip {
      position: absolute;
      top: -32px;
      left: 50%;
      transform: translateX(-50%) translateY(-100%);
      background: var(--color-text-primary);
      color: var(--color-background);
      padding: var(--spacing-2) var(--spacing-3);
      border-radius: var(--radius-md);
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-semibold);
      white-space: nowrap;
      opacity: 0;
      pointer-events: none;
      transition: opacity var(--transition-fast);
      z-index: 10;
      text-align: center;
      font-family: 'JetBrains Mono', 'SF Mono', monospace;
      line-height: 1.4;
    }

    .chart-tooltip small {
      font-weight: var(--font-weight-normal);
      opacity: 0.8;
    }

    .chart-tooltip::after {
      content: '';
      position: absolute;
      bottom: -4px;
      left: 50%;
      transform: translateX(-50%);
      width: 8px;
      height: 8px;
      background: var(--color-text-primary);
      border-radius: 1px;
      transform: translateX(-50%) rotate(45deg);
    }

    .chart-bar-group:hover .chart-tooltip {
      opacity: 1;
    }

    .chart-label {
      margin-top: var(--spacing-2);
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-medium);
      color: var(--color-text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    /* ===== Dashboard Grid (two columns) ===== */
    .dashboard-grid {
      display: grid;
      grid-template-columns: 3fr 2fr;
      gap: var(--spacing-6);
      animation: fadeInUp 0.5s ease-out 0.3s both;
    }

    .dashboard-col-left,
    .dashboard-col-right {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-6);
    }

    /* ===== Sections ===== */
    .section {
      background: var(--color-background-elevated);
      border-radius: var(--radius-xl);
      padding: var(--spacing-6);
      box-shadow: var(--shadow-sm);
      border: 1px solid var(--color-border-subtle);
      transition: all var(--transition-normal);
    }

    .section:hover {
      box-shadow: var(--shadow-md);
      border-color: var(--color-border-default);
    }

    @keyframes fadeInUp {
      from {
        opacity: 0;
        transform: translateY(20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: var(--spacing-6);
      padding-bottom: var(--spacing-4);
      border-bottom: 2px solid var(--color-border-subtle);
    }

    .section-title {
      font-size: var(--font-size-2xl);
      font-weight: var(--font-weight-bold);
      color: var(--color-text-primary);
      margin: 0;
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
    }

    .section-title::before {
      content: '';
      width: 4px;
      height: 24px;
      background: linear-gradient(180deg, var(--color-primary-500), var(--color-primary-600));
      border-radius: var(--radius-full);
    }

    .section-link {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      color: var(--color-primary-600);
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-1);
      transition: all var(--transition-fast);
      padding: var(--spacing-1) var(--spacing-2);
      border-radius: var(--radius-md);
    }

    .section-link:hover {
      color: var(--color-primary-700);
      background: var(--color-primary-50);
    }

    .section-link::after {
      content: '→';
      transition: transform var(--transition-fast);
    }

    .section-link:hover::after {
      transform: translateX(4px);
    }

    /* Table improvements */
    :host ::ng-deep .dashboard-table {
      .p-datatable-thead > tr > th {
        background: var(--color-neutral-50);
        color: var(--color-text-secondary);
        font-weight: var(--font-weight-semibold);
        font-size: var(--font-size-xs);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        padding: var(--spacing-4) var(--spacing-3);
        border-bottom: 2px solid var(--color-border-default);
        position: sticky;
        top: 0;
        z-index: 1;
      }

      .p-datatable-tbody > tr.table-row {
        transition: all var(--transition-fast);
        cursor: pointer;
        border-left: 3px solid transparent;
      }

      .p-datatable-tbody > tr.table-row:hover {
        background: linear-gradient(90deg, var(--color-primary-50) 0%, transparent 100%);
        border-left-color: var(--color-primary-500);
        transform: translateX(4px);
        box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
      }

      .p-datatable-tbody > tr.table-row > td {
        padding: var(--spacing-4) var(--spacing-3);
        border-bottom: 1px solid var(--color-border-subtle);
        vertical-align: middle;
      }

      .p-datatable-tbody > tr.table-row:last-child > td {
        border-bottom: none;
      }
    }

    .client-name {
      font-weight: var(--font-weight-medium);
      color: var(--color-text-primary);
    }

    .invoice-date {
      color: var(--color-text-secondary);
      font-size: var(--font-size-sm);
    }

    .text-right {
      text-align: right;
    }

    .invoice-link {
      font-weight: var(--font-weight-semibold);
      color: var(--color-primary-600);
      text-decoration: none;
      transition: all var(--transition-fast);
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-1);
    }

    .invoice-link:hover {
      color: var(--color-primary-700);
      text-decoration: underline;
    }

    .invoice-link::before {
      content: '#';
      opacity: 0.5;
      font-weight: var(--font-weight-normal);
    }

    .amount {
      font-family: 'JetBrains Mono', 'SF Mono', 'Monaco', 'Consolas', monospace;
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
      font-size: var(--font-size-base);
    }

    /* ===== Top Clients ===== */
    .top-clients-list {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);
    }

    .top-client-item {
      display: flex;
      align-items: center;
      gap: var(--spacing-3);
      padding: var(--spacing-3) var(--spacing-4);
      border-radius: var(--radius-lg);
      text-decoration: none;
      transition: all var(--transition-fast);
      cursor: pointer;
      border: 1px solid transparent;
    }

    .top-client-item:hover {
      background: var(--color-primary-50);
      border-color: var(--color-primary-100);
      transform: translateX(4px);
    }

    .top-client-rank {
      width: 28px;
      height: 28px;
      border-radius: var(--radius-full);
      background: var(--color-neutral-100);
      color: var(--color-text-secondary);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-bold);
      flex-shrink: 0;
    }

    .top-client-item:first-child .top-client-rank {
      background: var(--color-primary-100);
      color: var(--color-primary-700);
    }

    .top-client-info {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .top-client-name {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .top-client-meta {
      font-size: var(--font-size-xs);
      color: var(--color-text-secondary);
    }

    .top-client-revenue {
      text-align: right;
      min-width: 120px;
      display: flex;
      flex-direction: column;
      gap: var(--spacing-1);
    }

    .top-client-amount {
      font-family: 'JetBrains Mono', 'SF Mono', monospace;
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
    }

    .top-client-bar {
      height: 4px;
      background: var(--color-neutral-100);
      border-radius: var(--radius-full);
      overflow: hidden;
    }

    .top-client-bar-fill {
      height: 100%;
      background: linear-gradient(90deg, var(--color-primary-400), var(--color-primary-600));
      border-radius: var(--radius-full);
      transition: width 0.6s ease-out;
    }

    /* ===== Recent Quotes ===== */
    .quotes-list {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);
    }

    .quote-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--spacing-3) var(--spacing-4);
      border-radius: var(--radius-lg);
      text-decoration: none;
      transition: all var(--transition-fast);
      cursor: pointer;
      border: 1px solid transparent;
      gap: var(--spacing-3);
    }

    .quote-item:hover {
      background: var(--color-primary-50);
      border-color: var(--color-primary-100);
      transform: translateX(4px);
    }

    .quote-item-left {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
      flex: 1;
    }

    .quote-number {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--color-primary-600);
    }

    .quote-client {
      font-size: var(--font-size-xs);
      color: var(--color-text-secondary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .quote-item-right {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: var(--spacing-1);
      flex-shrink: 0;
    }

    .quote-amount {
      font-family: 'JetBrains Mono', 'SF Mono', monospace;
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
    }

    .empty-section-message {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--spacing-2);
      padding: var(--spacing-6);
      color: var(--color-text-secondary);
      text-align: center;
    }

    .empty-section-message i {
      font-size: 2rem;
      opacity: 0.4;
    }

    .empty-section-message p {
      margin: 0;
      font-size: var(--font-size-sm);
    }

    /* ===== Activity Timeline ===== */
    .timeline {
      display: flex;
      flex-direction: column;
      gap: 0;
      position: relative;
    }

    .timeline::before {
      content: '';
      position: absolute;
      left: 15px;
      top: 8px;
      bottom: 8px;
      width: 2px;
      background: var(--color-border-subtle);
      border-radius: var(--radius-full);
    }

    .timeline-item {
      display: flex;
      align-items: flex-start;
      gap: var(--spacing-3);
      padding: var(--spacing-3) var(--spacing-3);
      text-decoration: none;
      transition: all var(--transition-fast);
      border-radius: var(--radius-lg);
      cursor: pointer;
      position: relative;
    }

    .timeline-item:hover {
      background: var(--color-neutral-50);
    }

    .timeline-icon {
      width: 32px;
      height: 32px;
      border-radius: var(--radius-full);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: var(--font-size-sm);
      flex-shrink: 0;
      position: relative;
      z-index: 1;
    }

    .activity-success {
      background: var(--color-success-100);
      color: var(--color-success-700);
    }

    .activity-primary {
      background: var(--color-primary-100);
      color: var(--color-primary-700);
    }

    .activity-info {
      background: #dbeafe;
      color: #1d4ed8;
    }

    .activity-neutral {
      background: var(--color-neutral-100);
      color: var(--color-neutral-600);
    }

    .timeline-content {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
      flex: 1;
      padding-top: var(--spacing-1);
    }

    .timeline-description {
      font-size: var(--font-size-sm);
      color: var(--color-text-primary);
      font-weight: var(--font-weight-medium);
      line-height: 1.4;
    }

    .timeline-date {
      font-size: var(--font-size-xs);
      color: var(--color-text-secondary);
    }

    /* ===== Responsive ===== */
    @media (max-width: 1024px) {
      .dashboard-grid {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 768px) {
      .stats-grid {
        grid-template-columns: repeat(2, 1fr);
        gap: var(--spacing-3);
      }

      .quick-actions {
        grid-template-columns: repeat(2, 1fr);
      }

      .section {
        padding: var(--spacing-4);
      }

      .section-header {
        flex-direction: column;
        align-items: flex-start;
        gap: var(--spacing-2);
      }

      .section-title {
        font-size: var(--font-size-xl);
      }

      .chart-bars {
        height: 160px;
      }

      .chart-bar {
        width: 85%;
      }

      .chart-bar-value--full    { display: none; }
      .chart-bar-value--compact { display: block; }

      .chart-bar-value {
        top: -18px;
        font-size: 0.625rem;
      }

      .chart-tooltip {
        top: -28px;
      }

      .top-client-revenue {
        min-width: 90px;
      }
    }

    /* ===== Personnalisation du tableau de bord (drag & drop) ===== */
    .dash-edit-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: var(--spacing-3);
      margin-bottom: var(--spacing-4);
      padding: var(--spacing-3) var(--spacing-4);
      border: 1px solid var(--color-primary-200, #bfdbfe);
      background: var(--color-primary-50, #eff6ff);
      border-radius: var(--radius-lg);
    }
    .dash-edit-toolbar__hint {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-2);
      color: var(--color-text-secondary);
      font-size: var(--font-size-sm);
    }
    .dash-edit-toolbar__actions {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-2);
    }

    /* Hors mode édition : conteneur totalement transparent (aucun changement visuel). */
    .dash-block { position: relative; }
    .dash-block__body { display: block; }

    /* Mode édition : affordances visuelles. */
    .dash-block--edit {
      border: 1px dashed var(--color-border-strong, #cbd5e1);
      border-radius: var(--radius-xl);
      padding: var(--spacing-3);
      margin-bottom: var(--spacing-4);
      background: var(--color-background-subtle);
      transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
    }
    .dash-block--edit:hover { border-color: var(--color-primary-400, #60a5fa); }
    /* Empêche tout clic accidentel sur le contenu pendant la réorganisation. */
    .dash-block--edit .dash-block__body {
      pointer-events: none;
      user-select: none;
    }

    .dash-block__handle {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--spacing-2);
      margin-bottom: var(--spacing-3);
      padding: var(--spacing-2) var(--spacing-3);
      border-radius: var(--radius-lg);
      background: var(--color-background-elevated);
      border: 1px solid var(--color-border-subtle);
      cursor: grab;
    }
    .dash-block__handle:active { cursor: grabbing; }
    .dash-block__handle-label {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-2);
      font-weight: var(--font-weight-semibold, 600);
      color: var(--color-text-primary);
      font-size: var(--font-size-sm);
    }
    .dash-block__handle-controls { display: inline-flex; gap: var(--spacing-1); }
    .dash-block__move {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border: 1px solid var(--color-border-default);
      border-radius: var(--radius-md);
      background: var(--color-background-subtle);
      color: var(--color-text-secondary);
      cursor: pointer;
      transition: all var(--transition-fast);
    }
    .dash-block__move:hover {
      background: var(--color-primary-50, #eff6ff);
      color: var(--color-primary-600);
      border-color: var(--color-primary-300, #93c5fd);
    }

    /* Prévisualisation / placeholder du CDK pendant le glissement. */
    .cdk-drag-preview {
      box-shadow: var(--shadow-lg);
      border-radius: var(--radius-xl);
      opacity: 0.95;
    }
    .cdk-drag-placeholder { opacity: 0.4; }
    .cdk-drag-animating { transition: transform 200ms cubic-bezier(0, 0, 0.2, 1); }
    .dash-blocks.cdk-drop-list-dragging .dash-block:not(.cdk-drag-placeholder) {
      transition: transform 200ms cubic-bezier(0, 0, 0.2, 1);
    }

    .chart-month-links {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
      margin-top: 0.75rem;
    }
    .chart-month-link {
      border: 1px solid var(--color-border-subtle, #e2e8f0);
      background: var(--color-background-subtle, #f1f5f9);
      border-radius: 4px;
      padding: 0.25rem 0.55rem;
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--color-text-secondary);
      cursor: pointer;
    }
    .chart-month-link:hover {
      background: rgba(56, 98, 245, 0.1);
      color: var(--superieur-primary, #3862f5);
      border-color: var(--superieur-primary, #3862f5);
    }
  `]
})
export class DashboardComponent implements OnInit {
  private decimalPipe = inject(DecimalPipe);
  private router = inject(Router);
  private authService = inject(AuthService);
  private warehouseContext = inject(WarehouseContextService);
  private invoiceService = inject(InvoiceService);
  private stockService = inject(StockService);
  private deliveryNoteService = inject(DeliveryNoteService);
  private dashboardService = inject(DashboardService);
  private accountingService = inject(AccountingService);
  private crmService = inject(CrmService);
  private tenantSystemStatus = inject(TenantSystemStatusService);
  private errorHandler = inject(ErrorHandlerService);
  private layoutService = inject(DashboardLayoutService);
  private modulesService = inject(CompanyModulesService);
  private recommendationsService = inject(ModuleRecommendationsService);
  private toastService = inject(ToastService);

  readonly tenantMigrationFailed = this.tenantSystemStatus.tenantMigrationFailed;
  readonly tenantMigrationMessage = this.errorHandler.getTenantMigrationFailureMessage();
  private readonly skipGlobalErrorContext = createHttpContextSkipGlobalErrorUi();

  loading = signal(true);
  initialLoad = signal(true);
  recentInvoices = signal<InvoiceListItem[]>([]);
  allInvoices = signal<InvoiceListItem[]>([]);
  stockAlerts = signal<StockAlertsResult | null>(null);
  pendingDeliveries = signal<DeliveryNoteListDto[]>([]);

  recentQuotes = signal<QuoteListItem[]>([]);
  topClients = signal<TopClientData[]>([]);
  monthlyRevenue = signal<MonthlyRevenueData[]>([]);
  recentActivity = signal<ActivityItem[]>([]);
  kpiTrends = signal<KpiTrends | null>(null);
  kpiSparklines = signal<KpiSparklines | null>(null);
  activeQuotesCount = signal<number>(0);
  accountingKpis = signal<AccountingDashboardDto | null>(null);
  crmRemindersCount = signal(0);
  crmOpenOppsCount = signal(0);

  // ===== Recommandations de modules basées sur l'usage (plan §3.3) =====
  moduleRecommendations = signal<ModuleRecommendationDto[]>([]);
  recommendationsLoading = signal(false);
  activatingModuleId = signal<AppModule | null>(null);

  // --- Personnalisation du tableau de bord (drag & drop) ---
  editMode = signal(false);
  savingLayout = signal(false);
  private editSnapshot: DashboardBlockId[] = [];

  /** Blocs effectivement rendus : ordre courant filtré par visibilité. */
  readonly renderedBlocks = computed(() =>
    this.layoutService
      .order()
      .filter((id) => this.isBlockVisible(id))
      .map((id) => ({ id, label: blockLabel(id) }))
  );

  canCreateInvoice = computed(() => this.authService.hasPermission(PERMISSIONS.invoices.create));
  canReadInvoices = computed(() => this.authService.hasPermission(PERMISSIONS.invoices.read));
  canReadQuotes = computed(() => this.authService.hasPermission(PERMISSIONS.quotes.read));
  canCreateDeliveryNote = computed(() => this.authService.hasPermission(PERMISSIONS.deliveryNotes.create));
  canCreateReturnNote = computed(() => this.authService.hasPermission(PERMISSIONS.returnNotes.create));
  canReadClients = computed(() => this.authService.hasPermission(PERMISSIONS.clients.read));
  canReadPayments = computed(() => this.authService.hasPermission(PERMISSIONS.payments.read));
  canReadReports = computed(() => this.authService.hasPermission(PERMISSIONS.reports.view));
  /**
   * Tâche 1.7 du plan : le bloc « Actions rapides » n'a de sens que si au moins une
   * action y est visible. Un nouveau tenant avec peu de modules/permissions actifs
   * ne doit pas voir un bloc vide — voir `hasAnyQuickAction` ci-dessous.
   */
  hasAnyQuickAction = computed(
    () =>
      this.canCreateInvoice() ||
      this.canReadQuotes() ||
      this.canCreateDeliveryNote() ||
      this.canCreateReturnNote() ||
      this.canReadClients() ||
      this.canReadPayments() ||
      this.canReadReports() ||
      this.canUseStockEntryQuickAction() ||
      this.canUseNewOpportunityQuickAction()
  );
  /** Carte latérale « Livraisons en attente » : les bons de livraison sont rattachés au module Ventes. */
  showPendingDeliveriesSideCard = computed(() => this.authService.hasModule(AppModule.Sales));
  /** Carte latérale « Devis en cours » : n'a de sens que si le module Ventes est actif. */
  showActiveQuotesSideCard = computed(() => this.authService.hasModule(AppModule.Sales));
  showStockUrgent = computed(
    () => this.authService.hasModule(AppModule.Stock) && this.authService.hasPermission(PERMISSIONS.stock.read)
  );
  // Alignées sur showStockUrgent : ces deux widgets sont rattachés au module Sales
  // (factures/BL de vente). La permission seule suffit déjà en pratique (le calcul des
  // permissions effectives intersecte déjà les modules activés côté backend), mais on
  // ajoute le hasModule() explicite en défense en profondeur, par cohérence avec
  // showStockUrgent/hasAccountingModule/hasCrmModule (Phase 2 — audit gating dashboard).
  showDeliveryUrgent = computed(
    () => this.authService.hasModule(AppModule.Sales) && this.authService.hasPermission(PERMISSIONS.deliveryNotes.read)
  );
  showInvoiceUrgent = computed(
    () => this.authService.hasModule(AppModule.Sales) && this.authService.hasPermission(PERMISSIONS.invoices.read)
  );

  hasAccountingModule = computed(
    () =>
      this.authService.hasModule(AppModule.Accounting) &&
      this.authService.hasPermission(PERMISSIONS.accounting.read)
  );

  hasCrmModule = computed(
    () =>
      this.authService.hasModule(AppModule.CRM) && this.authService.hasPermission(PERMISSIONS.crm.read)
  );

  // ===== Aperçu sectoriel & modules (plan v1 §2.5 — dashboard adaptatif) =====
  private purchaseOrderService = inject(PurchaseOrderService);
  private projectApiService = inject(ProjectApiService);
  private recurringContractService = inject(RecurringContractService);

  companySegment = computed(() => this.authService.user()?.companySegment ?? null);

  /** Modules actifs de l'utilisateur, pour le bloc « Modules actifs » (plan §2.5 point 3). */
  activeModuleOptions = computed(() => {
    const enabledIds = new Set(this.authService.user()?.enabledModuleIds ?? []);
    return APP_MODULE_OPTIONS.filter((o) => enabledIds.has(o.value));
  });

  /** Widgets KPI sectoriels visibles pour le segment courant (modules + permission). */
  sectorKpiWidgets = computed(() =>
    visibleSectorKpiWidgets(
      this.companySegment(),
      (mods) => this.authService.hasAllModules(mods),
      (perm) => this.authService.hasPermission(perm)
    )
  );

  purchaseOrdersPendingCount = signal<number | null>(null);
  activeProjectsCount = signal<number | null>(null);
  activeRecurringContractsCount = signal<number | null>(null);

  /** Résout la valeur numérique affichée pour un widget KPI sectoriel donné. */
  sectorKpiValue(widget: SectorKpiWidgetDef): number | null {
    switch (widget.widgetId) {
      case 'commerce-stock-ruptures':
        return this.stockAlertsCount();
      case 'commerce-purchases-pending':
        return this.purchaseOrdersPendingCount();
      case 'services-btp-active-projects':
        return this.activeProjectsCount();
      case 'services-btp-recurring-contracts':
      case 'assoc-edu-membership-fees':
        return this.activeRecurringContractsCount();
      default:
        return null;
    }
  }

  /** Action rapide dérivée des modules actifs : entrée de stock (plan §2.5 point 3). */
  canUseStockEntryQuickAction = computed(() =>
    isQuickActionWidgetVisible(
      QUICK_ACTION_WIDGETS.find((w) => w.widgetId === 'qa-stock-entry')!,
      (mods) => this.authService.hasAllModules(mods),
      (perm) => this.authService.hasPermission(perm)
    )
  );

  /** Action rapide dérivée des modules actifs : nouvelle opportunité CRM. */
  canUseNewOpportunityQuickAction = computed(() =>
    isQuickActionWidgetVisible(
      QUICK_ACTION_WIDGETS.find((w) => w.widgetId === 'qa-new-opportunity')!,
      (mods) => this.authService.hasAllModules(mods),
      (perm) => this.authService.hasPermission(perm)
    )
  );

  skeletonColumns: SkeletonColumn[] = [
    { width: '120px' },
    { width: '200px' },
    { width: '100px' },
    { width: '120px' },
    { width: '100px' },
    { width: '80px' }
  ];

  private maxRevenue = 0;

  get greeting(): string {
    const user = this.authService.user();
    const hour = new Date().getHours();
    let greeting = 'Bonjour';

    if (hour < 12) greeting = 'Bonjour';
    else if (hour < 18) greeting = 'Bon après-midi';
    else greeting = 'Bonsoir';

    return user ? `${greeting}, ${user.firstName}` : greeting;
  }

  ngOnInit(): void {
    this.loadDashboardData();
    this.loadStockAlerts();
    this.loadPendingDeliveries();
    this.loadAccountingKpis();
    this.loadCrmKpis();
    this.loadSectorKpis();
    this.loadModuleRecommendations();
    this.layoutService.loadLayout();
  }

  /** Détermine si un bloc a du contenu à afficher dans l'état courant. */
  isBlockVisible(id: DashboardBlockId): boolean {
    switch (id) {
      case 'urgent':
        return !this.loading() && this.hasUrgentActions();
      case 'accounting':
        return this.hasAccountingModule() && !!this.accountingKpis();
      case 'crm':
        return this.hasCrmModule();
      case 'chart':
        return !this.loading() && this.canReadInvoices() && this.monthlyRevenue().length > 0;
      case 'recommendations':
        return !this.loading() && this.moduleRecommendations().length > 0;
      case 'kpi':
      case 'sector':
      case 'quick-actions':
      case 'bottom-grid':
      default:
        return true;
    }
  }

  enterEdit(): void {
    this.editSnapshot = [...this.layoutService.order()];
    this.editMode.set(true);
  }

  cancelEdit(): void {
    this.layoutService.setOrderInMemory(this.editSnapshot);
    this.editMode.set(false);
  }

  saveEdit(): void {
    this.savingLayout.set(true);
    this.layoutService.saveLayout(this.layoutService.order()).subscribe({
      next: () => {
        this.savingLayout.set(false);
        this.editMode.set(false);
      },
      error: () => {
        this.savingLayout.set(false);
        this.editMode.set(false);
      }
    });
  }

  /** Restaure l'ordre par défaut (en mémoire — confirmé ensuite via Enregistrer). */
  resetLayout(): void {
    this.layoutService.setOrderInMemory([...DEFAULT_DASHBOARD_BLOCK_ORDER]);
  }

  onBlockDrop(event: CdkDragDrop<unknown>): void {
    const rendered = this.renderedBlocks();
    const moved = rendered[event.previousIndex];
    const target = rendered[event.currentIndex];
    if (!moved || !target || moved.id === target.id) return;
    this.layoutService.setOrderInMemory(
      reorderFullOrder(this.layoutService.order(), moved.id, target.id)
    );
  }

  moveBlock(id: DashboardBlockId, direction: -1 | 1): void {
    const rendered = this.renderedBlocks();
    const index = rendered.findIndex((b) => b.id === id);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= rendered.length) return;
    this.layoutService.setOrderInMemory(
      reorderFullOrder(this.layoutService.order(), id, rendered[targetIndex].id)
    );
  }

  formatAccountingAmount(value: number): string {
    const n = this.decimalPipe.transform(value, '1.3-3') || '0,000';
    return `${n} TND`;
  }

  // ===== Recommandations de modules (plan §3.3) =====

  /** Libellé français d'un module à partir de son id (pour l'affichage de la carte). */
  recommendationModuleLabel(moduleId: AppModule): string {
    return APP_MODULE_OPTIONS.find((o) => o.value === moduleId)?.label ?? String(moduleId);
  }

  recommendationModuleIcon(moduleId: AppModule): string {
    return MODULE_ICON_BY_ID[moduleId]?.icon ?? 'pi-puzzle';
  }

  loadModuleRecommendations(): void {
    this.recommendationsLoading.set(true);
    this.recommendationsService.getRecommendations().subscribe({
      next: (res) => {
        this.recommendationsLoading.set(false);
        if (res.success && res.data) {
          this.moduleRecommendations.set(res.data);
        }
      },
      error: () => {
        this.recommendationsLoading.set(false);
        /* dashboard reste utilisable sans recommandations */
      }
    });
  }

  /** Active un module recommandé en un clic (réutilise PUT /api/company/modules, plan §3.3). */
  activateRecommendation(moduleId: AppModule): void {
    if (this.activatingModuleId() !== null) return;
    const currentEnabled = this.authService.user()?.enabledModuleIds ?? [];
    const nextEnabled = [...new Set([...currentEnabled, moduleId])];

    this.activatingModuleId.set(moduleId);
    this.modulesService.updateModules(nextEnabled as AppModule[]).subscribe({
      next: (res) => {
        this.activatingModuleId.set(null);
        if (!res.success || !res.data) {
          this.toastService.add({
            severity: 'error',
            summary: 'Échec de l’activation',
            detail: res.message || 'Impossible d’activer ce module.'
          });
          return;
        }
        // Sidebar/nav must reflect the change immediately (plan 1.3/2.2).
        this.authService.refreshUserProfile().subscribe();
        const warnings = res.data.warnings?.filter((w) => !!w?.trim()) ?? [];
        if (warnings.length > 0) {
          this.toastService.add({
            severity: 'warn',
            summary: 'Module activé avec avertissements',
            detail: warnings.join(' '),
            life: 8000
          });
        } else {
          this.toastService.add({
            severity: 'success',
            summary: 'Module activé',
            detail: 'Votre navigation a été actualisée.'
          });
        }
        // Retire la reco localement (le backend ne la renverra plus non plus).
        this.moduleRecommendations.update((list) => list.filter((r) => r.moduleId !== moduleId));
      },
      error: (err: HttpErrorResponse) => {
        this.activatingModuleId.set(null);
        this.toastService.add({
          severity: 'error',
          summary: 'Échec de l’activation',
          detail: this.errorHandler.extractErrorMessage(err),
          life: 8000
        });
      }
    });
  }

  /** Masque une recommandation (persistant côté backend, plan §3.3). */
  dismissRecommendation(moduleId: AppModule): void {
    this.recommendationsService.dismiss(moduleId).subscribe({
      next: (res) => {
        if (res.success) {
          this.moduleRecommendations.update((list) => list.filter((r) => r.moduleId !== moduleId));
        }
      },
      error: () => {
        /* échec silencieux — la reco reste visible, l'utilisateur peut réessayer */
      }
    });
  }

  formatVatDeadline(isoDate: string): string {
    if (!isoDate) return '—';
    const d = new Date(isoDate);
    if (Number.isNaN(d.getTime())) return isoDate;
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  loadAccountingKpis(): void {
    if (!this.hasAccountingModule()) return;
    this.accountingService.getDashboard({ skipGlobalErrorUi: true }).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.accountingKpis.set(res.data);
        }
      },
      error: () => {
        /* dashboard reste utilisable sans bloc compta */
      }
    });
  }

  loadCrmKpis(): void {
    if (!this.hasCrmModule()) return;
    this.crmService.getMyReminders(this.skipGlobalErrorContext).subscribe({
      next: (r) => {
        if (r.success && r.data) this.crmRemindersCount.set(r.data.length);
      },
      error: (err) => this.handlePossibleTenantMigrationError(err)
    });
    this.crmService.getOpportunities(undefined, undefined, undefined, this.skipGlobalErrorContext).subscribe({
      next: (r) => {
        if (r.success && r.data) this.crmOpenOppsCount.set(r.data.filter((o) => o.stage < 4).length);
      },
      error: (err) => this.handlePossibleTenantMigrationError(err)
    });
  }

  /**
   * Charge les données des widgets KPI sectoriels visibles (plan v1 §2.5). Chaque
   * appel est conditionné à la visibilité effective du widget correspondant
   * (module + permission) pour éviter des requêtes inutiles/interdites.
   */
  loadSectorKpis(): void {
    const widgets = this.sectorKpiWidgets();

    if (widgets.some((w) => w.widgetId === 'commerce-purchases-pending')) {
      this.purchaseOrderService.getPurchaseOrdersSummary({}).subscribe({
        next: (res) => {
          if (res.success && res.data) this.purchaseOrdersPendingCount.set(res.data.pendingCount ?? 0);
        },
        error: () => {
          /* le tableau de bord reste utilisable sans ce widget */
        }
      });
    }

    if (widgets.some((w) => w.widgetId === 'services-btp-active-projects')) {
      this.projectApiService.dashboard().subscribe({
        next: (res) => {
          if (res.success && res.data) this.activeProjectsCount.set(res.data.activeProjects ?? 0);
        },
        error: () => {
          /* le tableau de bord reste utilisable sans ce widget */
        }
      });
    }

    if (widgets.some((w) => w.widgetId === 'services-btp-recurring-contracts' || w.widgetId === 'assoc-edu-membership-fees')) {
      this.recurringContractService.list({ status: 'Active', page: 1, pageSize: 1 }).subscribe({
        next: (paged) => this.activeRecurringContractsCount.set(paged?.totalCount ?? 0),
        error: () => {
          /* le tableau de bord reste utilisable sans ce widget */
        }
      });
    }
  }

  reloadAfterMigrationIssue(): void {
    this.tenantSystemStatus.clearTenantMigrationFailure();
    this.loading.set(true);
    this.loadDashboardData();
    this.loadCrmKpis();
  }

  private handlePossibleTenantMigrationError(err: unknown): void {
    if (this.errorHandler.isTenantMigrationFailure(err)) {
      this.tenantSystemStatus.reportTenantMigrationFailure();
    }
  }

  loadDashboardData(): void {
    this.dashboardService.loadDashboardData().subscribe({
      next: (data) => {
        this.allInvoices.set(data.allInvoices);
        this.recentInvoices.set(data.recentInvoices);
        this.recentQuotes.set(data.recentQuotes);
        this.topClients.set(data.topClients);
        this.monthlyRevenue.set(data.monthlyRevenue);
        this.recentActivity.set(data.recentActivity);
        this.kpiTrends.set(data.kpiTrends);
        this.kpiSparklines.set(data.kpiSparklines);
        this.activeQuotesCount.set(data.activeQuotesCount);

        const revenues = data.monthlyRevenue.map(m => m.revenue);
        this.maxRevenue = Math.max(...revenues, 1);

        this.loading.set(false);
        this.initialLoad.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.initialLoad.set(false);
      }
    });
  }

  loadStockAlerts(): void {
    if (!this.showStockUrgent()) return;
    const warehouseId = this.warehouseContext.selectedWarehouseId() ?? undefined;
    this.stockService.getStockAlerts(warehouseId, { skipGlobalErrorUi: true }).subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.stockAlerts.set(response.data);
        }
      },
      error: () => {
        // Silent fail – dashboard still functional without stock data
      }
    });
  }

  loadPendingDeliveries(): void {
    if (!this.showDeliveryUrgent()) return;
    this.deliveryNoteService.getDeliveryNotes({
      status: DeliveryNoteStatus.Confirmed,
      pageSize: 100,
      skipGlobalErrorUi: true
    }).subscribe({
      next: (response) => {
        if (response.success) {
          this.pendingDeliveries.set(response.data.items);
        }
      },
      error: () => {
        // Silent fail – dashboard still functional without delivery data
      }
    });
  }

  // Statistiques calculées
  totalRevenue = computed(() => {
    const invoices = this.allInvoices();
    // Chiffre d'affaires cumulé (tout l'historique) — réalisé = Payée + Validée.
    const total = sumRealizedRevenue(invoices);
    const currency = invoices.length > 0 ? invoices[0].currency : 'TND';

    const formatted = this.decimalPipe.transform(total, '1.3-3') || '0,000';
    return `${formatted} ${currency}`;
  });

  salesToday = computed(() => {
    const invoices = this.allInvoices();
    const today = new Date();
    const todayYear = today.getFullYear();
    const todayMonth = today.getMonth();
    const todayDay = today.getDate();

    const todayInvoices = invoices.filter(inv => {
      const invDate = new Date(inv.issueDate);
      return invDate.getFullYear() === todayYear &&
             invDate.getMonth() === todayMonth &&
             invDate.getDate() === todayDay;
    });

    const total = todayInvoices.reduce((sum, inv) => sum + inv.totalAmount, 0);
    const currency = invoices.length > 0 ? invoices[0].currency : 'TND';

    const formatted = this.decimalPipe.transform(total, '1.3-3') || '0,000';
    return `${formatted} ${currency}`;
  });

  currentMonthRevenue = computed(() => {
    const months = this.monthlyRevenue();
    const invoices = this.allInvoices();
    const currentMonthEntry = months.length > 0 ? months[months.length - 1] : null;
    const total = currentMonthEntry?.revenue ?? 0;
    const currency = invoices.length > 0 ? invoices[0].currency : 'TND';
    const formatted = this.decimalPipe.transform(total, '1.3-3') || '0,000';
    return `${formatted} ${currency}`;
  });

  pendingInvoicesCount = computed(() => {
    // Aligné sur /invoices/unpaid (unpaidOnly backend = Status != Paid && != Cancelled,
    // inclut « Partiellement payée ») — voir dashboard-drill-down.config.ts
    const invoices = this.allInvoices();
    return invoices.filter(inv => isUnpaidInvoice(inv.status)).length;
  });

  overdueInvoicesCount = computed(() => {
    const invoices = this.allInvoices();
    return invoices.filter(inv => {
      const s = inv.status?.toLowerCase() || '';
      return s.includes('retard') || s.includes('overdue');
    }).length;
  });

  stockAlertsCount = computed(() => {
    const alerts = this.stockAlerts();
    return alerts ? alerts.totalAlerts : 0;
  });

  pendingDeliveriesCount = computed(() => {
    return this.pendingDeliveries().length;
  });

  hasUrgentActions = computed(() => {
    return (
      (this.showStockUrgent() && this.stockAlertsCount() > 0) ||
      (this.showDeliveryUrgent() && this.pendingDeliveriesCount() > 0) ||
      (this.showInvoiceUrgent() && this.overdueInvoicesCount() > 0)
    );
  });

  readonly buildDashboardAnalyzePayload = (): unknown =>
    wrapLegacyAnalyzePayload(
      'dashboard',
      {
        screen: 'dashboard',
        loading: this.loading(),
        warehouseId: this.warehouseContext.selectedWarehouseId(),
        kpis: {
          totalRevenue: this.totalRevenue(),
          currentMonthRevenue: this.currentMonthRevenue(),
          salesToday: this.salesToday(),
          pendingInvoices: this.pendingInvoicesCount(),
          overdueInvoices: this.overdueInvoicesCount(),
          stockAlerts: this.stockAlertsCount(),
          pendingDeliveries: this.pendingDeliveriesCount(),
          activeQuotes: this.activeQuotesCount(),
          crmReminders: this.crmRemindersCount(),
          crmOpenOpportunities: this.crmOpenOppsCount()
        },
        accounting: this.accountingKpis(),
        recentInvoicesSample: this.recentInvoices().slice(0, 15).map((i) => ({
          number: i.number,
          clientName: i.clientName,
          issueDate: i.issueDate,
          status: i.status,
          totalAmount: i.totalAmount,
          currency: i.currency,
          isOverdue: i.isOverdue
        })),
        recentQuotesSample: this.recentQuotes().slice(0, 10).map((q) => ({
          number: q.number,
          clientName: q.clientName,
          status: q.status,
          totalAmount: q.totalAmount
        })),
        topClientsSample: this.topClients().slice(0, 8),
        monthlyRevenue: this.monthlyRevenue(),
        recentActivity: this.recentActivity().slice(0, 12)
      } as Record<string, unknown>,
      { rowsKey: 'recentInvoicesSample', maxRows: 200 }
    );

  drillDown(id: DashboardDrillDownId, month?: MonthlyRevenueData): DashboardDrillDownTarget | null {
    const target = getDrillDownTarget(id, { month, now: new Date() });
    return canNavigateToTarget(target, this.authService) ? target : null;
  }

  onChartMonthClick(month: MonthlyRevenueData, event?: Event): void {
    if (event instanceof KeyboardEvent) {
      event.preventDefault();
    }
    const target = this.drillDown('chartMonth', month);
    if (!target) {
      return;
    }
    this.router.navigate(
      Array.isArray(target.route) ? [...target.route] : [target.route],
      { queryParams: target.queryParams }
    );
  }

  getBarHeight(revenue: number): number {
    if (this.maxRevenue === 0) return 4;
    const percent = (revenue / this.maxRevenue) * 100;
    return Math.max(percent, 4);
  }

  readonly revenueChartData = computed(() => {
    const months = this.monthlyRevenue();
    return {
      labels: months.map(m => m.monthShort),
      datasets: [
        {
          label: 'CA (TND)',
          data: months.map(m => m.revenue),
          fill: true,
          borderColor: '#3862f5',
          backgroundColor: 'rgba(56, 98, 245, 0.18)',
          tension: 0.4,
          pointBackgroundColor: '#3862f5',
          pointBorderColor: '#fff',
          pointRadius: 4
        }
      ]
    };
  });

  readonly revenueChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx: { parsed: { y: number } }) =>
            `${this.decimalPipe.transform(ctx.parsed.y, '1.3-3') ?? '0'} TND`
        }
      }
    },
    scales: {
      x: { grid: { display: false } },
      y: {
        beginAtZero: true,
        grid: { color: 'rgba(0,0,0,0.06)' },
        ticks: {
          callback: (value: string | number) => this.formatCurrencyCompact(Number(value))
        }
      }
    }
  };

  formatCurrency(amount: number): string {
    const formatted = this.decimalPipe.transform(amount, '1.3-3') || '0,000';
    return `${formatted} TND`;
  }

  formatCurrencyCompact(amount: number): string {
    if (!amount || amount === 0) return '0';
    const abs = Math.abs(amount);

    if (abs >= 1_000_000) {
      return `${this.decimalPipe.transform(amount / 1_000_000, '1.0-1') ?? '0'}M`;
    }
    if (abs >= 1_000) {
      return `${this.decimalPipe.transform(amount / 1_000, '1.0-1') ?? '0'}K`;
    }
    return this.decimalPipe.transform(amount, '1.0-0') ?? '0';
  }

  getStatusBadgeStatus(status: string): StatusBadgeStatus {
    const s = status?.toLowerCase() || '';
    
    if (s.includes('partiellement')) return 'partial';
    if (s.includes('payé') || s.includes('paid')) return 'paid';
    if (s.includes('attente') || s.includes('pending')) return 'pending';
    if (s.includes('retard') || s.includes('overdue')) return 'overdue';
    if (s.includes('brouillon') || s.includes('draft')) return 'draft';
    if (s.includes('envoyé') || s.includes('sent')) return 'sent';
    if (s.includes('annulé') || s.includes('cancel')) return 'cancelled';
    if (s.includes('validé') || s.includes('validated')) return 'validated';
    if (s.includes('signé') || s.includes('signed')) return 'signed';
    if (s.includes('accepté') || s.includes('accept')) return 'accepted';
    if (s.includes('rejeté') || s.includes('reject')) return 'rejected';
    if (s.includes('expiré') || s.includes('expired')) return 'overdue';
    if (s.includes('converti') || s.includes('converted')) return 'paid';
    
    return 'draft';
  }
}
