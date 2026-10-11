/**
 * Mirror of backend `InstaFact.Domain.Enums.Permissions` (UserRole.cs).
 * Do not change strings without updating the domain.
 */
export const PERMISSIONS = {
  invoices: {
    create: 'invoices:create',
    read: 'invoices:read',
    update: 'invoices:update',
    delete: 'invoices:delete',
    sign: 'invoices:sign',
    send: 'invoices:send'
  },
  clients: {
    create: 'clients:create',
    read: 'clients:read',
    update: 'clients:update',
    delete: 'clients:delete'
  },
  products: {
    create: 'products:create',
    read: 'products:read',
    update: 'products:update',
    delete: 'products:delete'
  },
  payments: {
    create: 'payments:create',
    read: 'payments:read',
    update: 'payments:update'
  },
  /**
   * Trésorerie prévisionnelle par IA. Volontairement distinct de `forecasting:*` (Prévisions IA
   * ventes/stock) : le rôle Comptable possède celles-ci et pas celles-là.
   */
  treasuryForecast: {
    view: 'treasury_forecast:view',
    manage: 'treasury_forecast:manage'
  },
  users: {
    create: 'users:create',
    read: 'users:read',
    update: 'users:update',
    delete: 'users:delete'
  },
  settings: {
    read: 'settings:read',
    update: 'settings:update'
  },
  reports: {
    view: 'reports:view',
    export: 'reports:export',
    salesOwn: 'reports:sales_own'
  },
  quotes: {
    create: 'quotes:create',
    read: 'quotes:read',
    update: 'quotes:update',
    delete: 'quotes:delete'
  },
  deliveryNotes: {
    create: 'delivery_notes:create',
    read: 'delivery_notes:read',
    update: 'delivery_notes:update',
    delete: 'delivery_notes:delete'
  },
  returnNotes: {
    create: 'return_notes:create',
    read: 'return_notes:read',
    update: 'return_notes:update',
    delete: 'return_notes:delete'
  },
  pricing: {
    create: 'pricing:create',
    read: 'pricing:read',
    update: 'pricing:update',
    delete: 'pricing:delete'
  },
  salesOrders: {
    create: 'sales_orders:create',
    read: 'sales_orders:read',
    update: 'sales_orders:update',
    delete: 'sales_orders:delete'
  },
  suppliers: {
    create: 'suppliers:create',
    read: 'suppliers:read',
    update: 'suppliers:update',
    delete: 'suppliers:delete'
  },
  purchaseOrders: {
    create: 'purchase_orders:create',
    read: 'purchase_orders:read',
    update: 'purchase_orders:update',
    delete: 'purchase_orders:delete'
  },
  purchaseReceipts: {
    create: 'purchase_receipts:create',
    read: 'purchase_receipts:read',
    update: 'purchase_receipts:update',
    delete: 'purchase_receipts:delete'
  },
  supplierInvoices: {
    create: 'supplier_invoices:create',
    read: 'supplier_invoices:read',
    update: 'supplier_invoices:update',
    delete: 'supplier_invoices:delete'
  },
  stock: {
    create: 'stock:create',
    read: 'stock:read',
    update: 'stock:update',
    delete: 'stock:delete'
  },
  stockVouchers: {
    create: 'stock_vouchers:create',
    read: 'stock_vouchers:read',
    update: 'stock_vouchers:update',
    delete: 'stock_vouchers:delete'
  },
  stockTransfers: {
    create: 'stock_transfers:create',
    read: 'stock_transfers:read',
    update: 'stock_transfers:update',
    delete: 'stock_transfers:delete'
  },
  inventory: {
    create: 'inventory:create',
    read: 'inventory:read',
    update: 'inventory:update',
    delete: 'inventory:delete'
  },
  accounting: {
    read: 'accounting:read',
    create: 'accounting:create',
    delete: 'accounting:delete',
    close: 'accounting:close',
    validate: 'accounting:validate',
    reverse: 'accounting:reverse',
    import: 'accounting:import',
    declare: 'accounting:declare',
    /** Délettrer un groupe de lettrage (refonte lettrage, D6) — distincte de `delete`. */
    unletter: 'accounting:unletter',
    /** Configurer le catalogue des devises et leurs taux de change. */
    currenciesManage: 'accounting:currencies_manage',
    /**
     * Saisir un taux de change different de celui de la table. Le taux determine le montant en
     * dinar porte en comptabilite : sans cette permission le champ est en lecture seule.
     */
    exchangeRateOverride: 'accounting:exchange_rate_override',
    /**
     * Délettrer un groupe de lettrage existant (écran de lettrage, Phase 2). Clé définie par le
     * contrat §4/D6 du plan de refonte du lettrage ; ajoutée de façon provisoire ici en Phase 2
     * pour permettre la compilation/les tests de ce dépôt avant le rebase sur la Phase 1 (backend,
     * branche `vorflux/lettering-p1-backend-security`), qui ajoute la même clé indépendamment.
     * Conflit de rebase attendu et trivial à résoudre (les deux valeurs sont identiques).
     */
    unletter: 'accounting:unletter'
  },
  audit: {
    read: 'audit:read'
  },
  crm: {
    read: 'crm:read',
    create: 'crm:create',
    update: 'crm:update',
    delete: 'crm:delete'
  },
  salesTargets: {
    read: 'sales_targets:read',
    manage: 'sales_targets:manage'
  },
  withholdingTax: {
    read: 'withholding_tax:read',
    create: 'withholding_tax:create',
    edit: 'withholding_tax:edit',
    validate: 'withholding_tax:validate',
    delete: 'withholding_tax:delete',
    export: 'withholding_tax:export'
  },
  storefront: {
    manage: 'storefront:manage'
  },
  studio: {
    designEntities: 'studio:design_entities',
    designForms: 'studio:design_forms',
    designReports: 'studio:design_reports'
  },
  customData: {
    recordsRead: 'custom_records:read',
    recordsWrite: 'custom_records:write',
    reportsView: 'custom_reports:view'
  },
  payroll: {
    read: 'payroll:read',
    manageEmployees: 'payroll:manage_employees',
    manageGarnishments: 'payroll:manage_garnishments',
    run: 'payroll:run',
    validate: 'payroll:validate',
    declare: 'payroll:declare',
    export: 'payroll:export',
    pay: 'payroll:pay',
    settings: 'payroll:settings',
    hrDocuments: 'payroll:hr_documents',
    manageTermination: 'payroll:manage_termination'
  },
  firm: {
    manage: 'firm:manage',
    usersManage: 'firm:users:manage',
    assignmentsManage: 'firm:assignments:manage'
  },
  /** Agent « Chef de mission » — distinct de `ai:chat`, qui reste réservé à l'assistant société. */
  firmAi: {
    chat: 'firm:ai:chat',
    remind: 'firm:ai:remind'
  },
  /**
   * Réviseur de portefeuille. `view` est accordée au responsable ET au collaborateur (l'ACL
   * dossier restreint ensuite chacun) ; `manage` au seul responsable. Le back ne les délivre que
   * si `Features:AccountingFirms:FirmRevisionEnabled` est vrai : la permission porte donc à la
   * fois le droit et l'état du module côté serveur.
   */
  firmRevision: {
    view: 'firm:revision:view',
    manage: 'firm:revision:manage'
  },
  honorairesInvoices: {
    create: 'honoraires.invoices:create',
    read: 'honoraires.invoices:read',
    update: 'honoraires.invoices:update',
    delete: 'honoraires.invoices:delete',
    validate: 'honoraires.invoices:validate',
    send: 'honoraires.invoices:send'
  },
  honorairesQuotes: {
    create: 'honoraires.quotes:create',
    read: 'honoraires.quotes:read',
    update: 'honoraires.quotes:update',
    delete: 'honoraires.quotes:delete',
    convert: 'honoraires.quotes:convert'
  },
  honorairesPayments: {
    create: 'honoraires.payments:create',
    read: 'honoraires.payments:read'
  },
  projects: {
    read: 'projects:read',
    create: 'projects:create',
    update: 'projects:update',
    delete: 'projects:delete',
    manageTeam: 'projects:manage_team'
  },
  projectTasks: {
    create: 'project_tasks:create',
    read: 'project_tasks:read',
    update: 'project_tasks:update',
    delete: 'project_tasks:delete'
  },
  projectTime: {
    create: 'project_time:create',
    read: 'project_time:read',
    submit: 'project_time:submit',
    validate: 'project_time:validate'
  },
  projectBilling: {
    read: 'project_billing:read',
    create: 'project_billing:create'
  },
  recurringContracts: {
    read: 'recurring_contracts:read',
    create: 'recurring_contracts:create',
    update: 'recurring_contracts:update',
    delete: 'recurring_contracts:delete',
    manage: 'recurring_contracts:manage',
    recordUsage: 'recurring_contracts:usage',
    triggerBilling: 'recurring_contracts:billing'
  },
  portal: {
    access: 'portal:access',
    invoicesRead: 'portal:invoices:read',
    paymentsRead: 'portal:payments:read',
    profileRead: 'portal:profile:read'
  }
} as const;
