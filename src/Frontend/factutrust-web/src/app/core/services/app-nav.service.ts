import { Injectable, computed, inject, signal, untracked } from '@angular/core';
import { AuthService } from '@core/services/auth.service';
import {
  ALL_NAV_ITEMS,
  filterNavItems,
  NavItem,
  NavSubItem
} from '@core/config/app-navigation.registry';
import {
  DELEGATED_SECTION_IDS,
  FIRM_MANAGED_HIDDEN_SECTION_IDS,
  FIRM_DELEGATED_FOOTER_NAV,
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
import { CompanySupportBadgeService } from '@core/services/company-support-badge.service';
import { FirmFeatureFlagsService } from '@core/services/firm-feature-flags.service';
import { environment } from '@environments/environment';
import { AccountingFeatureFlagsService } from '@features/accounting/shared/accounting-feature-flags.service';
import { AppModule } from '@core/models/app-module';
import { PERMISSIONS } from '@core/config/permission-keys';
import { FIRM_DELEGATED_HOME_ROUTE } from '@core/config/firm-area-access';
import { StudioNavService } from '@features/studio/studio-nav.service';
import { StudioAiCapabilitiesService } from '@features/studio/ai/studio-ai-capabilities.service';
import { StudioApprovalsBadgeService } from '@features/studio/approvals/studio-approvals-badge.service';
import { StockFeaturesStore } from '@core/services/stock-features-store.service';
import { VARIANT_AXES_PATH } from '@features/settings/variant-axes/variant-axes.paths';
import {
  ACCOUNTING_FIRM_SECONDARY_EXCLUDED_IDS,
  SECONDARY_NAV_SECTION_ORDER
} from '@core/config/secondary-nav.config';
import { CONTEXT_NAV_ID, getNavId, NAV_ID, STUDIO_CHILD_NAV_ID, studioDynamicNavId } from '@core/config/nav-item-ids';

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
  private readonly assistanceBadge = inject(CompanySupportBadgeService);
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

  /**
   * En mode délégué le logo ramène à l'accueil du DOSSIER : une URL cabinet n'est plus une sortie
   * implicite du dossier, la sortie passe par « Retour au cabinet ».
   */
  readonly dashboardHomeLink = computed(() => {
    if (!this.auth.isAccountingFirm()) {
      return '/dashboard';
    }
    return this.auth.isDelegatedMode() ? FIRM_DELEGATED_HOME_ROUTE : '/firm/dashboard';
  });

  /** Arbre complet visible (identique à l’ancien `SidebarComponent.navItems`). */
  readonly navItems = computed(() => {
    this.auth.user();
    this.firmContext.context();
    this.activeClients();
    this.firmBadge.pendingInvitationsCount();
    this.exchangeBadge.unreadCount();
    this.assistanceBadge.unreadCount();

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
    items = this.filterCompanyAssistanceNav(items);
    items = this.applyAssistanceBadge(items);
    items = applyCompanyAccountingSidebar(items);
    items = filterNavItems(this.auth, items);
    if (!fixedAssetsEnabled) {
      items = items.map(item =>
        item.children?.length && getNavId(item) === NAV_ID.accounting
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
    if (this.auth.isAccountingFirm() && !this.auth.isDelegatedMode()) {
      return [];
    }
    if (this.auth.isAccountingFirm() && this.auth.isDelegatedMode()) {
      const moduleSections = filterNavItems(this.auth, buildAccountingModuleNavItems());
      return moduleSections
        .filter(item => !ACCOUNTING_FIRM_SECONDARY_EXCLUDED_IDS.has(getNavId(item)))
        .filter(item => !!item.route || !!item.children?.length);
    }

    const byId = new Map(this.navItems().map(item => [getNavId(item), item]));
    const sections: NavItem[] = [];
    for (const sectionId of SECONDARY_NAV_SECTION_ORDER) {
      const item = byId.get(sectionId);
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
      id: `firm-dossier--${c.companyTenantId}`,
      label: c.companyName,
      route: `/firm/open/${c.companyTenantId}`,
      icon: 'fa-solid fa-building'
    }));
    if (clients.length > 0) {
      dossierChildren.push({
        id: CONTEXT_NAV_ID.allDossiers,
        label: $localize`:@@core.app-nav.ts.voir.tous.les.dossiers.1c370e1e:Voir tous les dossiers`,
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
        id: CONTEXT_NAV_ID.myDossiers,
        label: $localize`:@@core.app-nav.ts.mes.dossiers.clients.7ad4d1c3:Mes dossiers clients`,
        icon: 'fa-solid fa-briefcase',
        children: dossierChildren.length
          ? dossierChildren
          : [{
              label: this.auth.isFirmAccountant()
                ? $localize`:@@core.app-nav.ts.aucun.dossier.affecte.48bb6111:Aucun dossier affecté`
                : $localize`:@@core.app-nav.ts.aucun.dossier.actif.4214c9a3:Aucun dossier actif`,
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
    return items.filter(i => getNavId(i) !== NAV_ID.exchanges);
  }

  private filterCompanyAssistanceNav(items: NavItem[]): NavItem[] {
    const show =
      this.auth.canAccessPlatformSettings() &&
      !this.auth.isAccountingFirm() &&
      !this.auth.isDelegatedMode() &&
      !this.auth.isClientPortal();
    if (show) return items;
    return items.filter(i => getNavId(i) !== NAV_ID.assistance);
  }

  private applyAssistanceBadge(items: NavItem[]): NavItem[] {
    const unread = this.assistanceBadge.unreadCount();
    return items.map(item =>
      item.route === '/assistance'
        ? { ...item, badge: unread > 0 ? unread : undefined }
        : item
    );
  }

  private buildDelegatedNav(): NavItem[] {
    const client = this.firmContext.activeClient();
    let items = filterNavItems(this.auth, ALL_NAV_ITEMS);
    items = items.filter(i => DELEGATED_SECTION_IDS.has(getNavId(i)));
    if (this.auth.isFirmManagedDelegated()) {
      items = items.filter(i => !FIRM_MANAGED_HIDDEN_SECTION_IDS.has(getNavId(i)));
    }
    items = items
      .map(item =>
        item.children?.length && (getNavId(item) === NAV_ID.sales || getNavId(item) === NAV_ID.purchases)
          ? { ...item, children: filterDelegatedFirmSectionChildren(getNavId(item), item.children) }
          : item
      )
      .filter(item => !item.children?.length || item.children.length > 0);

    const comptaIndex = items.findIndex(i => getNavId(i) === NAV_ID.accounting);
    if (comptaIndex >= 0) {
      // Remplace la section Comptabilité : même id, pour que les règles par section s'appliquent.
      const comptaHub: NavItem = {
        id: NAV_ID.accounting,
        label: $localize`:@@core.app-nav.ts.comptabilite.20af7266:Comptabilité`,
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
      id: CONTEXT_NAV_ID.firmDossierHeader,
      label: client ? $localize`:@@core.app-nav.ts.dossier.companyname.f0a59ef1:Dossier : ${client.companyName}:companyName:` : $localize`:@@core.app-nav.ts.dossier.client.52cd904a:Dossier client`,
      icon: 'fa-solid fa-folder-open',
      children: [
        {
          id: CONTEXT_NAV_ID.returnToFirm,
          label: $localize`:@@core.app-nav.ts.retour.au.cabinet.ea23ac22:Retour au cabinet`,
          icon: 'fa-solid fa-arrow-left',
          action: 'returnToFirm'
        },
        {
          id: CONTEXT_NAV_ID.changeDossier,
          label: $localize`:@@core.app-nav.ts.changer.de.dossier.c849871f:Changer de dossier`,
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
        id: STUDIO_CHILD_NAV_ID.tables,
        label: $localize`:@@core.app-nav.ts.concepteur.de.tables.26aa941d:Concepteur de tables`,
        route: '/studio',
        icon: 'fa-solid fa-screwdriver-wrench',
        modules: [AppModule.Studio],
        permissionsAll: [PERMISSIONS.studio.designEntities]
      },
      {
        id: STUDIO_CHILD_NAV_ID.forms,
        label: $localize`:@@core.app-nav.ts.formulaires.edb3637f:Formulaires`,
        route: '/studio/forms',
        icon: 'fa-solid fa-table-cells-large',
        modules: [AppModule.Studio],
        permissionsAll: [PERMISSIONS.studio.designForms]
      },
      {
        id: STUDIO_CHILD_NAV_ID.reports,
        label: $localize`:@@core.app-nav.ts.rapports.db7d9fbb:Rapports`,
        route: '/studio/reports',
        icon: 'fa-solid fa-chart-column',
        modules: [AppModule.Studio],
        permissionsAll: [PERMISSIONS.studio.designReports]
      },
      {
        id: STUDIO_CHILD_NAV_ID.ai,
        label: $localize`:@@core.app-nav.ts.assistant.ia.94f6f208:Assistant IA`,
        route: '/studio/ai',
        icon: 'fa-solid fa-wand-magic-sparkles',
        modules: [AppModule.Studio],
        permissionsAll: [PERMISSIONS.studio.designEntities]
      },
      ...(this.studioCapabilities.workflowsEnabled()
        ? ([
            {
              id: STUDIO_CHILD_NAV_ID.workflows,
              label: $localize`:@@core.app-nav.ts.workflows.825ce9e9:Workflows`,
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
              id: STUDIO_CHILD_NAV_ID.approvals,
              label: $localize`:@@core.app-nav.ts.mes.approbations.8f2a2f56:Mes approbations`,
              route: '/studio/approvals',
              icon: 'fa-solid fa-inbox',
              modules: [AppModule.Studio],
              permissionsAll: [PERMISSIONS.customData.recordsRead],
              badge: this.approvalsBadge.count() || null
            }
          ] satisfies NavSubItem[])
        : []),
      ...this.studioNav.items().map<NavSubItem>(e => ({
        id: studioDynamicNavId(e.key),
        label: e.label,
        route: e.route.startsWith('/') ? e.route : `/studio/d/${e.key}`,
        icon: e.icon || (e.label.trimStart() !== e.label ? 'fa-solid fa-table' : 'fa-solid fa-folder-tree'),
        modules: [AppModule.Studio],
        permissionsAll: [PERMISSIONS.customData.recordsRead]
      }))
    ];
    return { id: NAV_ID.studio, label: $localize`:@@core.app-nav.ts.studio.5b23bd71:Studio`, icon: 'fa-solid fa-shapes', children };
  }
}
