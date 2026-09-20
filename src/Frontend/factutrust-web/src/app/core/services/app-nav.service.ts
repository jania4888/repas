import { Injectable, computed, inject, signal, untracked } from '@angular/core';
import { AuthService } from '@core/services/auth.service';
import {
  ALL_NAV_ITEMS,
  filterNavItems,
  NavItem,
  NavSubItem
} from '@core/config/app-navigation.registry';
import {
  DELEGATED_SECTION_LABELS,
  FIRM_DELEGATED_FOOTER_NAV,
  FIRM_MANAGED_HIDDEN_SECTION_LABELS,
  FIRM_NATIVE_NAV,
  filterFirmGovernanceNav,
  filterFirmRevisionNav,
  filterDelegatedFirmSectionChildren
} from '@core/config/firm-navigation.registry';
import { filterFirmManagerNav } from '@core/config/firm-manager-access.config';
import {
  buildAccountingModuleNavItems,
  buildFirmDelegatedAccountingModuleNavItems
} from '@core/config/accounting-modules.config';
import {
  applyCompanyAccountingSidebar,
  COMPANY_ACCOUNTING_FIXED_ASSETS_ROUTE
} from '@core/config/company-accounting-nav.config';
import { FirmContextService } from '@core/services/firm-context.service';
import { FirmAssignmentService, FirmClientDossier } from '@core/services/firm-assignment.service';
import { FirmBadgeService } from '@core/services/firm-badge.service';
import { ExchangeBadgeService } from '@core/services/exchange-badge.service';
import { FirmFeatureFlagsService } from '@core/services/firm-feature-flags.service';
import { environment } from '@environments/environment';
import { AccountingFeatureFlagsService } from '@features/accounting/shared/accounting-feature-flags.service';
import { AppModule } from '@core/models/app-module';
import { PERMISSIONS } from '@core/config/permission-keys';
import { StudioNavService } from '@features/studio/studio-nav.service';
import { StudioAiCapabilitiesService } from '@features/studio/ai/studio-ai-capabilities.service';
import { StudioApprovalsBadgeService } from '@features/studio/approvals/studio-approvals-badge.service';
import { StockFeaturesStore } from '@core/services/stock-features-store.service';
import { VARIANT_AXES_PATH } from '@features/settings/variant-axes/variant-axes.paths';
import {
  ACCOUNTING_FIRM_SECONDARY_EXCLUDED_LABELS,
  SECONDARY_NAV_SECTION_ORDER
} from '@core/config/secondary-nav.config';

/**
 * Source unique du graphe de navigation filtré (sidebar + 2e barre).
 * Toute évolution des règles de visibilité doit passer par ce service.
 */
@Injectable({ providedIn: 'root' })
export class AppNavService {
  private readonly auth = inject(AuthService);
  private readonly firmContext = inject(FirmContextService);
  private readonly firmAssignments = inject(FirmAssignmentService);
  private readonly firmBadge = inject(FirmBadgeService);
  private readonly exchangeBadge = inject(ExchangeBadgeService);
  private readonly firmFeatureFlags = inject(FirmFeatureFlagsService);
  private readonly accountingFlags = inject(AccountingFeatureFlagsService);
  private readonly studioNav = inject(StudioNavService);
  private readonly studioCapabilities = inject(StudioAiCapabilitiesService);
  private readonly approvalsBadge = inject(StudioApprovalsBadgeService);
  private readonly stockFeaturesStore = inject(StockFeaturesStore);

  private readonly activeClients = signal<FirmClientDossier[]>([]);

  /** Concepteur : la capacité `workflowsEnabled` fait foi. Lecteur : la sonde du badge (seul endpoint accessible), 4.5d1. */
  private readonly approvalsVisible = computed(() =>
    this.auth.hasPermission(PERMISSIONS.studio.designEntities)
      ? this.studioCapabilities.workflowsEnabled()
      : this.approvalsBadge.available()
  );

  readonly dashboardHomeLink = computed(() =>
    this.auth.isAccountingFirm() ? '/firm/dashboard' : '/dashboard'
  );

  /** Arbre complet visible (identique à l’ancien `SidebarComponent.navItems`). */
  readonly navItems = computed(() => {
    this.auth.user();
    this.firmContext.context();
    this.activeClients();
    this.firmBadge.pendingInvitationsCount();
    this.exchangeBadge.unreadCount();

    this.stockFeaturesStore.ensureLoaded();
    this.stockFeaturesStore.features();

    const isDesigner = this.auth.hasPermission(PERMISSIONS.studio.designEntities);
    const isReader = this.auth.hasPermission(PERMISSIONS.customData.recordsRead);
    if (isDesigner || isReader) {
      // NG0600 : écritures de signaux interdites dans un computed — différées hors tracking.
      untracked(() => {
        if (isDesigner) this.studioCapabilities.ensureLoaded(); // 403 pour les autres profils : on ne l'appelle pas
        this.approvalsBadge.start(); // D23 : idempotent ; 403/404 ⇒ arrêt définitif jusqu'à reset() (4.5d1 : lecteurs aussi)
      });
    }

    if (this.auth.isAccountingFirm()) {
      if (this.auth.isDelegatedMode()) {
        return this.buildDelegatedNav();
      }
      return this.buildFirmNativeNav();
    }

    const fixedAssetsEnabled = this.accountingFlags.flags().fixedAssetsEnabled;
    let items = filterNavItems(this.auth, ALL_NAV_ITEMS);
    items = this.filterProductAttributesNav(items);
    items = this.filterCompanyExchangesNav(items);
    items = applyCompanyAccountingSidebar(items);
    items = filterNavItems(this.auth, items);
    if (!fixedAssetsEnabled) {
      items = items.map(item =>
        item.children?.length && item.label === 'Comptabilité'
          ? {
              ...item,
              children: item.children.filter(
                c => c.route !== COMPANY_ACCOUNTING_FIXED_ASSETS_ROUTE
              )
            }
          : item
      );
    }
    const studioParent = this.buildStudioNavSection();
    const studioFiltered = filterNavItems(this.auth, [studioParent]);
    return [...items, ...studioFiltered];
  });

  /**
   * Sections de la 2e barre desktop.
   * - Entreprise : ordre `SECONDARY_NAV_SECTION_ORDER` dérivé de `navItems`.
   * - Cabinet délégué : modules comptables (`ACCOUNTING_MODULES`) uniquement ;
   *   Ventes/Achats/Trésorerie/RH&Paie restent dans le sidebar via `navItems`.
   * - Cabinet natif : vide (pas de sections métier company).
   */
  readonly secondaryNavSections = computed((): NavItem[] => {
    if (this.auth.isAccountingFirm() && this.auth.isDelegatedMode()) {
      const moduleSections = filterNavItems(this.auth, buildAccountingModuleNavItems());
      return moduleSections
        .filter(item => !ACCOUNTING_FIRM_SECONDARY_EXCLUDED_LABELS.has(item.label))
        .filter(item => !!item.route || !!item.children?.length);
    }

    const byLabel = new Map(this.navItems().map(item => [item.label, item]));
    const sections: NavItem[] = [];
    for (const label of SECONDARY_NAV_SECTION_ORDER) {
      const item = byLabel.get(label);
      if (!item) {
        continue;
      }
      if (item.children?.length || item.route) {
        sections.push(item);
      }
    }
    return sections;
  });

  readonly hasSecondaryNav = computed(() => this.secondaryNavSections().length > 0);

  /** Footer utilitaire du sidemenu en mode cabinet délégué (Contrôle & Audit, etc.). */
  readonly delegatedFooterNav = computed((): NavItem[] => {
    if (!this.auth.isAccountingFirm() || !this.auth.isDelegatedMode()) {
      return [];
    }
    const helpUrl = environment.firmHelpUrl?.trim();
    const items = FIRM_DELEGATED_FOOTER_NAV.map(item => {
      if (item.externalUrl === '__FIRM_HELP_URL__') {
        if (!helpUrl) {
          return null;
        }
        return { ...item, externalUrl: helpUrl };
      }
      return item;
    }).filter((item): item is NavItem => item !== null);
    return filterNavItems(this.auth, items);
  });

  ensureFirmNavDataLoaded(): void {
    if (this.auth.isAccountingFirm() && !this.auth.isDelegatedMode()) {
      this.refreshFirmNavData();
    }
  }

  private refreshFirmNavData(): void {
    this.firmAssignments.getActiveClients().subscribe(r => {
      if (r.success) this.activeClients.set(r.data);
    });
    this.firmBadge.refresh();
  }

  private buildFirmNativeNav(): NavItem[] {
    const clients = this.activeClients();
    const dossierChildren: NavSubItem[] = clients.slice(0, 8).map(c => ({
      label: c.companyName,
      route: `/firm/open/${c.companyTenantId}`,
      icon: 'fa-solid fa-building'
    }));
    if (clients.length > 0) {
      dossierChildren.push({
        label: 'Voir tous les dossiers',
        route: '/firm/clients',
        icon: 'fa-solid fa-list'
      });
    }

    const pending = this.firmBadge.pendingInvitationsCount();
    const exchangeUnread = this.exchangeBadge.unreadCount();
    const dashboard = FIRM_NATIVE_NAV.find(i => i.route === '/firm/dashboard')!;
    const invitations = FIRM_NATIVE_NAV.find(i => i.route === '/firm/invitations')!;
    const exchanges = FIRM_NATIVE_NAV.find(i => i.route === '/firm/exchanges');
    const tail = FIRM_NATIVE_NAV.filter(
      i =>
        i.route !== '/firm/dashboard' &&
        i.route !== '/firm/clients' &&
        i.route !== '/firm/invitations' &&
        i.route !== '/firm/exchanges'
    );

    const tailFiltered = filterFirmManagerNav(
      filterFirmRevisionNav(
        filterFirmGovernanceNav(tail, this.firmFeatureFlags.isEnabled('firmGovernance')),
        this.firmFeatureFlags.isEnabled('firmRevision')
      ),
      this.auth.isFirmManager()
    );

    const items: NavItem[] = [
      dashboard,
      {
        label: 'Mes dossiers clients',
        icon: 'fa-solid fa-briefcase',
        children: dossierChildren.length
          ? dossierChildren
          : [{
              label: this.auth.isFirmAccountant()
                ? 'Aucun dossier affecté'
                : 'Aucun dossier actif',
              route: '/firm/clients',
              icon: 'fa-solid fa-inbox'
            }]
      },
      {
        ...invitations,
        badge: pending > 0 ? pending : undefined
      },
      ...(exchanges
        ? [{ ...exchanges, badge: exchangeUnread > 0 ? exchangeUnread : undefined }]
        : []),
      ...tailFiltered
    ];

    return filterNavItems(this.auth, items);
  }

  private filterProductAttributesNav(items: NavItem[]): NavItem[] {
    if (this.stockFeaturesStore.productVariantsEnabled()) {
      return items;
    }
    return items.map(item =>
      item.children?.length
        ? {
            ...item,
            children: item.children.filter(c => c.route !== VARIANT_AXES_PATH)
          }
        : item
    );
  }

  private filterCompanyExchangesNav(items: NavItem[]): NavItem[] {
    const show =
      environment.accountingFirmsEnabled &&
      this.auth.isAdmin() &&
      !this.auth.isAccountingFirm();
    if (show) return items;
    return items.filter(i => i.label !== 'Échanges');
  }

  private buildDelegatedNav(): NavItem[] {
    const client = this.firmContext.activeClient();
    let items = filterNavItems(this.auth, ALL_NAV_ITEMS);
    items = items.filter(i => DELEGATED_SECTION_LABELS.has(i.label));
    if (this.auth.isFirmManagedDelegated()) {
      items = items.filter(i => !FIRM_MANAGED_HIDDEN_SECTION_LABELS.has(i.label));
    }
    items = items
      .map(item =>
        item.children?.length && (item.label === 'Ventes' || item.label === 'Achats')
          ? { ...item, children: filterDelegatedFirmSectionChildren(item.label, item.children) }
          : item
      )
      .filter(item => !item.children?.length || item.children.length > 0);

    const comptaIndex = items.findIndex(i => i.label === 'Comptabilité');
    if (comptaIndex >= 0) {
      const comptaHub: NavItem = {
        label: 'Comptabilité',
        icon: 'fa-solid fa-table-cells-large',
        route: '/accounting/home',
        modules: [AppModule.Accounting],
        permissionsAll: [PERMISSIONS.accounting.read]
      };
      const moduleItems = filterNavItems(this.auth, buildFirmDelegatedAccountingModuleNavItems());
      items = [
        ...items.slice(0, comptaIndex),
        ...filterNavItems(this.auth, [comptaHub]),
        ...moduleItems,
        ...items.slice(comptaIndex + 1)
      ];
    }

    const contextHeader: NavItem = {
      label: client ? `Dossier : ${client.companyName}` : 'Dossier client',
      icon: 'fa-solid fa-folder-open',
      children: [
        {
          label: 'Retour au cabinet',
          icon: 'fa-solid fa-arrow-left',
          action: 'returnToFirm'
        },
        {
          label: 'Changer de dossier',
          icon: 'fa-solid fa-right-left',
          action: 'changeDossier'
        }
      ]
    };

    const fixedAssetsEnabled = this.accountingFlags.flags().fixedAssetsEnabled;
    if (!fixedAssetsEnabled) {
      items = items
        .map(item =>
          item.children?.length
            ? { ...item, children: item.children.filter(c => !c.route?.startsWith('/accounting/fixed-assets')) }
            : item
        )
        .filter(item => !item.children || item.children.length > 0);
    }
    return [contextHeader, ...items];
  }

  private buildStudioNavSection(): NavItem {
    const children: NavSubItem[] = [
      {
        label: 'Concepteur de tables',
        route: '/studio',
        icon: 'fa-solid fa-screwdriver-wrench',
        modules: [AppModule.Studio],
        permissionsAll: [PERMISSIONS.studio.designEntities]
      },
      {
        label: 'Formulaires',
        route: '/studio/forms',
        icon: 'fa-solid fa-table-cells-large',
        modules: [AppModule.Studio],
        permissionsAll: [PERMISSIONS.studio.designForms]
      },
      {
        label: 'Rapports',
        route: '/studio/reports',
        icon: 'fa-solid fa-chart-column',
        modules: [AppModule.Studio],
        permissionsAll: [PERMISSIONS.studio.designReports]
      },
      {
        label: 'Assistant IA',
        route: '/studio/ai',
        icon: 'fa-solid fa-wand-magic-sparkles',
        modules: [AppModule.Studio],
        permissionsAll: [PERMISSIONS.studio.designEntities]
      },
      ...(this.studioCapabilities.workflowsEnabled()
        ? ([
            {
              label: 'Workflows',
              route: '/studio/workflows',
              icon: 'fa-solid fa-route',
              modules: [AppModule.Studio],
              permissionsAll: [PERMISSIONS.studio.designEntities]
            }
          ] satisfies NavSubItem[])
        : []),
      ...(this.approvalsVisible()
        ? ([
            {
              label: 'Mes approbations',
              route: '/studio/approvals',
              icon: 'fa-solid fa-inbox',
              modules: [AppModule.Studio],
              permissionsAll: [PERMISSIONS.customData.recordsRead],
              badge: this.approvalsBadge.count() || null
            }
          ] satisfies NavSubItem[])
        : []),
      ...this.studioNav.items().map<NavSubItem>(e => ({
        label: e.label,
        route: e.route.startsWith('/') ? e.route : `/studio/d/${e.key}`,
        icon: e.icon || (e.label.trimStart() !== e.label ? 'fa-solid fa-table' : 'fa-solid fa-folder-tree'),
        modules: [AppModule.Studio],
        permissionsAll: [PERMISSIONS.customData.recordsRead]
      }))
    ];
    return { label: 'Studio', icon: 'fa-solid fa-shapes', children };
  }
}
