export interface PlatformUserDto {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  // Lot B1 — multi-rôles + permissions effectives
  roles?: string[];
  permissions?: string[];
}

export interface PlatformAuthResponseDto {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  user: PlatformUserDto;
}

/** Lot B1 — Renvoyé par GET /api/platform/auth/me/permissions */
export interface PlatformMePermissionsDto {
  userId: string;
  email: string;
  roles: string[];
  permissions: string[];
  /**
   * Drapeaux de fonctionnalité de l'instance (booléens uniquement, ex. `accountingFirms`).
   * Optionnel : absent des réponses d'une API antérieure à son exposition.
   */
  features?: Record<string, boolean> | null;
}

/** Profil détaillé GET /api/platform/auth/me */
export interface PlatformMeProfileDto {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
  lastLoginAt: string | null;
  isMfaEnabled: boolean;
}

export interface UpdatePlatformMeProfileRequest {
  firstName: string;
  lastName: string;
  currentPassword?: string | null;
  newPassword?: string | null;
  confirmNewPassword?: string | null;
}

/** Lot B1 — Liste des admins plateforme */
export interface PlatformAdminListItemDto {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  isActive: boolean;
  lastLoginAt: string | null;
  roles: string[];
  isLockedOut: boolean;
  createdAt: string;
}

export interface PlatformAdminListPageDto {
  items: PlatformAdminListItemDto[];
  totalCount: number;
  activeCount: number;
  lockedCount: number;
  superAdminCount: number;
}

export interface CreatePlatformAdminRequest {
  email: string;
  firstName: string;
  lastName: string;
  initialPassword: string;
  role: string;
}

export interface ChangePlatformAdminRoleRequest {
  role: string;
}

export interface ResetPlatformAdminPasswordRequest {
  newPassword: string;
}

/**
 * Lot B1 — Catalogue des permissions plateforme côté frontend.
 * Doit rester en phase avec `PlatformPermissions.cs`.
 */
export const PlatformPermission = {
  TenantsRead: 'platform.tenants:read',
  TenantsWrite: 'platform.tenants:write',
  TenantsSuspend: 'platform.tenants:suspend',
  TenantsDelete: 'platform.tenants:delete',
  SubscriptionChangePlan: 'platform.subscription:change-plan',
  SubscriptionCancel: 'platform.subscription:cancel',
  PlansManage: 'platform.plans:manage',
  CouponsManage: 'platform.coupons:manage',
  CreditsManage: 'platform.credits:manage',
  InvoiceRead: 'platform.invoice:read',
  InvoiceIssue: 'platform.invoice:issue',
  InvoiceCancel: 'platform.invoice:cancel',
  MigrationRead: 'platform.migration:read',
  MigrationRun: 'platform.migration:run',
  StorefrontRead: 'platform.storefront:read',
  StorefrontApprove: 'platform.storefront:approve',
  StorefrontReject: 'platform.storefront:reject',
  StorefrontSuspend: 'platform.storefront:suspend',
  AuditRead: 'platform.audit:read',
  SecurityRead: 'platform.security:read',
  AdminsRead: 'platform.admins:read',
  AdminsManage: 'platform.admins:manage',
  ProvidersConfigure: 'platform.providers:configure',
  NotificationsRead: 'platform.notifications:read',
  AiManage: 'platform.ai:manage',
  // ----- Phase 2 (WP-F6) — Règles sectorielles -----------------------------
  // Doit rester en phase avec PlatformPermissions.cs
  SectorRulesRead: 'platform.sector-rules:read',
  SectorRulesManage: 'platform.sector-rules:manage',
  SectorRulesApply: 'platform.sector-rules:apply',
  CompanySupportRead: 'platform.company-support:read',
  CompanySupportWrite: 'platform.company-support:write'
} as const;

export type PlatformPermissionKey = (typeof PlatformPermission)[keyof typeof PlatformPermission];

/** Lot B1 — Rôles plateforme reconnus */
export const PlatformRole = {
  PlatformAdmin: 'PlatformAdmin',
  BillingAdmin: 'BillingAdmin',
  SupportAgent: 'SupportAgent',
  MigrationOperator: 'MigrationOperator',
  ReadOnlyAuditor: 'ReadOnlyAuditor'
} as const;

export type PlatformRoleName = (typeof PlatformRole)[keyof typeof PlatformRole];

// ============================================================================
// Lot B2 — 2FA TOTP
// ============================================================================

/** État 2FA d'un admin (consultation page /me/2fa). */
export interface MfaStatusDto {
  isEnabled: boolean;
  hasPendingSetup: boolean;
  enabledAt: string | null;
  isLocked: boolean;
  lockoutUntil: string | null;
  remainingRecoveryCodes: number;
}

/** Réponse au démarrage du setup. */
export interface MfaSetupDto {
  secretBase32: string;
  qrCodeDataUri: string;
  otpAuthUri: string;
}

/** Réponse à la confirmation : 10 recovery codes en clair (one-shot). */
export interface MfaConfirmDto {
  recoveryCodes: string[];
  enabledAt: string;
}

/** Réponse 1re étape du login quand 2FA actif. */
export interface TwoFactorChallengeDto {
  requiresTwoFactor: true;
  ticket: string;
  ticketExpiresAt: string;
}

/** Type union renvoyé par /api/platform/auth/login. */
export type LoginResultDto = PlatformAuthResponseDto | TwoFactorChallengeDto;

/** Discriminator helper. */
export function isTwoFactorChallenge(dto: LoginResultDto): dto is TwoFactorChallengeDto {
  return (dto as TwoFactorChallengeDto).requiresTwoFactor === true;
}

// ============================================================================
// Lot B3 — Audit Log Viewer
// ============================================================================

/** Entrée résumée d'audit log (liste paginée). */
export interface AuditLogEntryDto {
  id: string;
  createdAt: string;
  userId: string | null;
  userEmail: string;
  action: string;
  entityType: string;
  entityId: string | null;
  entityLabel: string | null;
}

/** Page paginée de logs. */
export interface AuditLogPageDto {
  items: AuditLogEntryDto[];
  totalCount: number;
  page: number;
  pageSize: number;
}

/** Détail complet (avec OldValues / NewValues + chaîne hashes). */
export interface AuditLogDetailDto {
  id: string;
  createdAt: string;
  userId: string | null;
  userEmail: string;
  action: string;
  entityType: string;
  entityId: string | null;
  entityLabel: string | null;
  oldValues: string | null;
  newValues: string | null;
  ipAddress: string;
  userAgent: string | null;
  previousHash: string;
  hash: string;
}

/** Rapport d'intégrité de la chaîne SHA-256. */
export interface AuditChainVerificationDto {
  isValid: boolean;
  entryCount: number;
  firstBrokenEntryId: string | null;
  /** "IntegrityMismatch" | "ChainMismatch" | null */
  firstFailureReason: string | null;
  duplicatePreviousHashGroupCount: number;
}

/** Filtres reçus en query params. */
export interface AuditLogListParams {
  from?: string;
  to?: string;
  action?: string;
  userId?: string;
  entityType?: string;
  page?: number;
  pageSize?: number;
}

// ============================================================================
// Lot B4 — Sessions actives + tentatives login
// ============================================================================

export interface UserSessionDto {
  id: string;
  userId: string;
  userEmail: string;
  tenantId: string | null;
  tenantName: string | null;
  ipAddress: string;
  userAgent: string | null;
  issuedAt: string;
  lastUsedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  revocationReason: string | null;
  isActive: boolean;
}

export interface UserSessionsPageDto {
  items: UserSessionDto[];
  totalCount: number;
  activeCount: number;
  revokedCount: number;
}

export interface FailedLoginAttemptDto {
  id: string;
  email: string;
  userId: string | null;
  ipAddress: string;
  userAgent: string | null;
  attemptAt: string;
  /** Numeric enum value (0..6) */
  reason: number;
  reasonDisplay: string;
  tenantId: string | null;
}

export interface TopIpDto {
  ipAddress: string;
  count: number;
  lastSeen: string;
}

export interface FailedLoginAttemptsPageDto {
  items: FailedLoginAttemptDto[];
  totalCount: number;
  last24h: number;
  lastHour: number;
  topSuspiciousIps: TopIpDto[];
}

export interface SessionListParams {
  activeOnly?: boolean;
  page?: number;
  pageSize?: number;
}

export interface FailedLoginListParams {
  email?: string;
  ipAddress?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

// ============================================================================
// Lot B5 — Ops health & Hangfire stats
// ============================================================================

export interface OpsHealthCheckDto {
  name: string;
  /** "Healthy" | "Degraded" | "Unhealthy" */
  status: string;
  durationMs: number;
  description: string | null;
  tags: string[];
}

export interface OpsHangfireDto {
  serversOnline: number;
  enqueued: number;
  scheduled: number;
  processing: number;
  succeeded: number;
  failed: number;
  recurring: number;
}

export interface OpsHealthDto {
  /** "Healthy" | "Degraded" | "Unhealthy" */
  status: string;
  totalDurationMs: number;
  checks: OpsHealthCheckDto[];
  hangfire: OpsHangfireDto | null;
}

// ============================================================================
// Lot C1 — Plans configurables + module overrides
// ============================================================================

/** Période de facturation. Doit rester aligné avec InstaFact.Domain.Billing.BillingPeriod. */
export type BillingPeriodValue = 0 | 1 | 2 | 3;
export const BillingPeriod = {
  Free: 0 as BillingPeriodValue,
  Monthly: 1 as BillingPeriodValue,
  Annual: 2 as BillingPeriodValue,
  OneShot: 3 as BillingPeriodValue
} as const;

export interface PlanLimitDto {
  key: string;
  value: string;
}

export interface PlanFeatureDto {
  featureKey: string;
  enabled: boolean;
}

export interface PlanModuleDto {
  module: number;
  moduleDisplay: string;
  isIncluded: boolean;
}

export interface PlanDto {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isPublic: boolean;
  isActive: boolean;
  billingPeriod: BillingPeriodValue;
  billingPeriodDisplay: string;
  basePriceTND: number;
  currency: string;
  trialDays: number;
  sortOrder: number;
  archivedAt: string | null;
  limits: PlanLimitDto[];
  features: PlanFeatureDto[];
  modules: PlanModuleDto[];
  subscriptionsCount: number;
}

export interface ClonePlanRequest {
  newCode: string;
  newName: string;
}

export interface TenantModuleOverrideDto {
  id: string;
  tenantId: string;
  module: number;
  moduleDisplay: string;
  isEnabled: boolean;
  expiresAt: string | null;
  grantedByUserId: string;
  reason: string | null;
  isCurrentlyActive: boolean;
}

/** Query param values for GET /platform/tenants filters (numeric enums). */
export type TaxRegimeValue = 0 | 1 | 2;
/** `TenantKind` côté serveur : Company = 0, AccountingFirm = 1 (valeur de filtre). */
export type TenantKindFilterValue = 0 | 1;
export type SubscriptionPlanValue = 0 | 1 | 2;
export type SubscriptionStatusValue = 0 | 1 | 2 | 3 | 4 | 5;

/**
 * Statut de provisionnement de la base d'un tenant, serialise en chaine par l'API.
 * `Pending` / `Failed` : le dossier existe en base maitre mais sa base n'est pas exploitable,
 * l'utilisateur ne peut pas se connecter.
 */
export type TenantProvisioningStatusValue = 'Ready' | 'Pending' | 'Failed';

/** Nature d'un dossier plateforme, telle que sérialisée par l'API. */
export type TenantKindValue = 'Company' | 'AccountingFirm';

export interface PlatformTenantListItemDto {
  tenantId: string;
  companyName: string;
  companyEmail: string;
  taxRegimeDisplay: string;
  isActive: boolean;
  databaseName: string;
  /** API returns enum as string (e.g. Free, Monthly). */
  subscriptionPlan: string | null;
  subscriptionPlanDisplay: string | null;
  subscriptionStatus: string | null;
  subscriptionStatusDisplay: string | null;
  subscriptionEndDate: string | null;
  isPayingSubscriber: boolean;
  // ----- Lot A2 additions (optionnels) ------------------------------------
  /** NIF / matricule fiscal */
  nif?: string | null;
  /** Date de création du tenant (ISO string) */
  createdAt?: string | null;
  /** Dernière activité (UpdatedAt ?? CreatedAt côté tenant) */
  lastActivityAt?: string | null;
  /** MRR estimé en TND pour cette ligne */
  mrrTnd?: number | null;
  // ----- Phase 2 (WP-F6 / D8) additions (optionnels, nullable) ------------
  /** Segment sectoriel déclaré à l'onboarding (kebab-case, ex: "commerce"). */
  companySegment?: string | null;
  /** Domaine d'activité déclaré à l'onboarding (kebab-case, ex: "alimentation-agroalimentaire"). */
  businessDomain?: string | null;
  /** Statut de provisionnement ; absent des réponses antérieures à son exposition. */
  provisioningStatus?: TenantProvisioningStatusValue | null;
  /**
   * Nature du dossier, enum sérialisée en chaîne par l'API : `Company` | `AccountingFirm`.
   * Optionnel : absent des réponses antérieures à son exposition — traiter l'absence comme
   * `Company`, ce qu'étaient tous les tenants avant que les cabinets existent.
   */
  kind?: TenantKindValue | null;
}

export interface PlatformTenantListPageDto {
  items: PlatformTenantListItemDto[];
  totalCount: number;
}

export interface PlatformTenantStatsDto {
  totalTenants: number;
  payingSubscribers: number;
  nonPayingSubscribers: number;
  // ----- Lot A2 additions (optionnels) ------------------------------------
  /** Variation absolue du nombre total d'entreprises sur les 30 derniers jours */
  totalDelta30d?: number | null;
  /** MRR estimé du parc en TND */
  mrrEstimateTnd?: number | null;
  /** Taux de conversion essai → payant 30j (fraction 0..1) */
  trialConversionRate30d?: number | null;
  /** Variation du taux de conversion vs période précédente (différence absolue) */
  trialConversionDelta30d?: number | null;
  /** Nombre d'entreprises en risque (PastDue + Suspended) */
  riskCount?: number | null;
  /** Série temporelle des nouveaux signups (J-29 → J-0) */
  newSignupsTimeseries30d?: number[] | null;
}

export interface PlatformTenantListParams {
  search?: string;
  /** paying | non_paying | all */
  segment?: string;
  plan?: SubscriptionPlanValue;
  subscriptionStatus?: SubscriptionStatusValue;
  isActive?: boolean;
  taxRegime?: TaxRegimeValue;
  /** Nature du dossier : 0 = entreprise, 1 = cabinet comptable. */
  kind?: TenantKindFilterValue;
  page?: number;
  pageSize?: number;
  // ----- Lot A2 additions (optionnels) ------------------------------------
  /** Champ de tri serveur : name | createdAt | lastActivity | plan | status | endDate | mrr */
  sortBy?: TenantSortKey;
  /** Direction du tri : asc | desc */
  sortDir?: 'asc' | 'desc';
}

export type TenantSortKey =
  | 'name'
  | 'createdAt'
  | 'lastActivity'
  | 'plan'
  | 'status'
  | 'endDate'
  | 'mrr';

/** Vue sauvegardée pour la page Entreprises (stockage localStorage). */
export interface SavedTenantView {
  id: string;
  name: string;
  filters: Omit<PlatformTenantListParams, 'page' | 'pageSize'>;
  isDefault?: boolean;
  createdAt: string;
}

export interface PlatformTenantDetailDto {
  tenantId: string;
  companyName: string;
  companyEmail: string;
  taxRegimeDisplay: string;
  isActive: boolean;
  databaseName: string;
  subscriptionPlanDisplay: string | null;
  subscriptionStatusDisplay: string | null;
  nif: string;
  phone: string;
  city: string;
  governorate: string;
  website: string | null;
  deactivatedAt: string | null;
  subscriptionPlan: string | null;
  subscriptionStatus: string | null;
  subscriptionEndDate: string | null;
  isPayingSubscriber: boolean;
  hasMigrationsApplied: boolean;
  // ----- Phase 2 (WP-F6 / D8) additions (optionnels, nullable) ------------
  /** Segment sectoriel déclaré à l'onboarding (kebab-case, ex: "commerce"). */
  companySegment?: string | null;
  /** Domaine d'activité déclaré à l'onboarding (kebab-case, ex: "alimentation-agroalimentaire"). */
  businessDomain?: string | null;
  /** Statut de provisionnement ; absent des réponses antérieures à son exposition. */
  provisioningStatus?: TenantProvisioningStatusValue | null;
}

export interface SubscriptionDto {
  id: string;
  plan: string;
  planDisplay: string;
  status: string;
  statusDisplay: string;
  startDate: string;
  endDate: string | null;
  trialEndDate: string | null;
  monthlyPrice: number | null;
  annualPrice: number | null;
  currency: string;
  invoicesThisMonth: number;
  currentPeriodStart: string;
}

export interface MigrationResultDto {
  totalTenants: number;
  successCount: number;
  failureCount: number;
}

export interface MigrationStatusResultDto {
  tenantId: string;
  tenantName: string;
  hasMigrationsApplied: boolean;
  subscriptionPlan: string | null;
  subscriptionPlanDisplay: string | null;
  subscriptionStatus: string | null;
  subscriptionStatusDisplay: string | null;
  isPayingSubscriber: boolean;
}

/** Statistiques agrégées pour la page Migrations (Lot A3). */
export interface MigrationStatsDto {
  /** Total des tenants actifs */
  totalTenants: number;
  /** Tenants à jour (toutes les migrations EF appliquées) */
  upToDate: number;
  /** Tenants en retard (au moins une migration manquante) */
  pending: number;
  /** Échecs sur 24h — toujours 0 tant que le tracking persistant n'est pas en place (Lot D4) */
  failures24h: number;
}

// ============================================================================
// Lot C2 — Email message log
// ============================================================================

/** Statut d'un email — aligné avec EmailMessageStatus côté backend (0..6). */
export type EmailMessageStatusValue = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface EmailMessageListItemDto {
  id: string;
  createdAt: string;
  toEmail: string;
  toName: string | null;
  templateCode: string;
  subject: string;
  status: EmailMessageStatusValue;
  statusDisplay: string;
  sentAt: string | null;
  errorMessage: string | null;
  attemptsCount: number;
  relatedTenantId: string | null;
}

export interface EmailMessageDetailDto extends EmailMessageListItemDto {
  renderedHtml: string | null;
  renderedText: string | null;
  providerMessageId: string | null;
  openedAt: string | null;
  bouncedAt: string | null;
}

export interface EmailMessagesPageDto {
  items: EmailMessageListItemDto[];
  totalCount: number;
  queuedCount: number;
  sentCount: number;
  failedCount: number;
  last24h: number;
}

export interface EmailMessageListParams {
  tenantId?: string;
  status?: EmailMessageStatusValue;
  search?: string;
  page?: number;
  pageSize?: number;
}

// ============================================================================
// Lot C3 — Coupons + crédits tenant
// ============================================================================

export type CouponTypeValue = 0 | 1; // 0 = Percent, 1 = FixedAmount
export const CouponType = {
  Percent: 0 as CouponTypeValue,
  FixedAmount: 1 as CouponTypeValue
} as const;

export interface CouponDto {
  id: string;
  code: string;
  type: CouponTypeValue;
  typeDisplay: string;
  value: number;
  durationMonths: number | null;
  maxRedemptions: number | null;
  redeemedCount: number;
  validFrom: string;
  validTo: string;
  appliesToPlanId: string | null;
  appliesToPlanCode: string | null;
  isActive: boolean;
  isRedeemable: boolean;
  notes: string | null;
  createdAt: string;
}

export interface CouponRedemptionDto {
  id: string;
  couponId: string;
  tenantId: string;
  tenantName: string;
  redeemedAt: string;
  amountSavedTND: number;
  appliedToInvoiceId: string | null;
}

export interface CouponsPageDto {
  items: CouponDto[];
  totalCount: number;
  activeCount: number;
  redeemableCount: number;
  totalRedemptions: number;
}

export interface CreateCouponRequest {
  code: string;
  type: CouponTypeValue;
  value: number;
  durationMonths?: number;
  maxRedemptions?: number;
  validFrom: string;
  validTo: string;
  appliesToPlanId?: string;
  notes?: string;
}

export interface UpdateCouponRequest {
  type: CouponTypeValue;
  value: number;
  durationMonths?: number;
  maxRedemptions?: number;
  validFrom: string;
  validTo: string;
  appliesToPlanId?: string;
  notes?: string;
}

export interface TenantCreditDto {
  id: string;
  tenantId: string;
  tenantName: string;
  amountTND: number;
  consumedAmountTND: number;
  remainingTND: number;
  reason: string;
  grantedByUserId: string;
  grantedAt: string;
  expiresAt: string | null;
  relatedInvoiceId: string | null;
  revokedAt: string | null;
  revocationReason: string | null;
  isActive: boolean;
}

export interface TenantCreditsPageDto {
  items: TenantCreditDto[];
  totalCount: number;
  activeCount: number;
  totalGrantedTND: number;
  totalRemainingTND: number;
}

export interface GrantTenantCreditRequest {
  amountTND: number;
  reason: string;
  expiresAt?: string;
}

export interface RevokeTenantCreditRequest {
  reason: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Lot C4 — Facturation plateforme (PlatformInvoices, Receipts, FiscalSettings)
// ─────────────────────────────────────────────────────────────────────────────

/** Statut courant d'une facture plateforme (mapping enum côté API). */
export const PlatformInvoiceStatusValue = {
  Draft: 0,
  Issued: 1,
  Paid: 2,
  PartiallyPaid: 3,
  Overdue: 4,
  Cancelled: 5,
  Refunded: 6
} as const;
export type PlatformInvoiceStatusValueType =
  (typeof PlatformInvoiceStatusValue)[keyof typeof PlatformInvoiceStatusValue];

/** Type de facturation (mapping enum côté API). */
export const PlatformInvoiceBillingTypeValue = {
  Subscription: 0,
  SetupFee: 1,
  Manual: 2,
  Refund: 3
} as const;
export type PlatformInvoiceBillingTypeValueType =
  (typeof PlatformInvoiceBillingTypeValue)[keyof typeof PlatformInvoiceBillingTypeValue];

/** Mode de paiement d'un reçu. */
export const PlatformPaymentMethodValue = {
  BankTransfer: 0,
  CardKonnect: 1,
  CardPaymee: 2,
  Cash: 3,
  Manual: 4
} as const;
export type PlatformPaymentMethodValueType =
  (typeof PlatformPaymentMethodValue)[keyof typeof PlatformPaymentMethodValue];

/** Statut d'un reçu. */
export const PlatformReceiptStatusValue = {
  Pending: 0,
  Confirmed: 1,
  Cancelled: 2
} as const;
export type PlatformReceiptStatusValueType =
  (typeof PlatformReceiptStatusValue)[keyof typeof PlatformReceiptStatusValue];

export interface PlatformInvoiceLineDto {
  id: string;
  description: string;
  quantity: number;
  unitPriceHT: number;
  vatRate: number;
  lineTotalHT: number;
  lineTotalTTC: number;
  relatedPeriodFrom: string | null;
  relatedPeriodTo: string | null;
}

export interface PlatformReceiptDto {
  id: string;
  invoiceId: string;
  receiptNumber: string;
  paymentDate: string;
  method: PlatformPaymentMethodValueType;
  methodDisplay: string;
  status: PlatformReceiptStatusValueType;
  statusDisplay: string;
  reference: string | null;
  amountTND: number;
  providerTxId: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  cancelledReason: string | null;
  createdAt: string;
}

export interface PlatformInvoiceSummaryDto {
  id: string;
  tenantId: string;
  tenantName: string;
  number: string | null;
  invoiceDate: string;
  dueDate: string | null;
  billingType: PlatformInvoiceBillingTypeValueType;
  billingTypeDisplay: string;
  status: PlatformInvoiceStatusValueType;
  statusDisplay: string;
  subtotalHT: number;
  vatAmount: number;
  stampDuty: number;
  totalTTC: number;
  totalReceived: number;
  remainingAmount: number;
  issuedAt: string | null;
  paidAt: string | null;
  isOverdue: boolean;
}

export interface PlatformInvoiceDetailDto {
  id: string;
  tenantId: string;
  tenantName: string;
  tenantNif: string | null;
  number: string | null;
  sequenceYear: number | null;
  invoiceDate: string;
  dueDate: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  billingType: PlatformInvoiceBillingTypeValueType;
  billingTypeDisplay: string;
  status: PlatformInvoiceStatusValueType;
  statusDisplay: string;
  subtotalHT: number;
  vatAmount: number;
  discountAmount: number;
  creditsApplied: number;
  stampDuty: number;
  totalTTC: number;
  totalReceived: number;
  remainingAmount: number;
  couponRedemptionId: string | null;
  pdfStorageKey: string | null;
  legalMentions: string | null;
  issuedAt: string | null;
  paidAt: string | null;
  cancelledAt: string | null;
  cancelledReason: string | null;
  relatedInvoiceId: string | null;
  relatedInvoiceNumber: string | null;
  createdAt: string;
  lines: PlatformInvoiceLineDto[];
  receipts: PlatformReceiptDto[];
}

export interface PlatformInvoicesPageDto {
  items: PlatformInvoiceSummaryDto[];
  totalCount: number;
  draftCount: number;
  issuedCount: number;
  paidCount: number;
  overdueCount: number;
  totalIssuedTtc: number;
  totalPaidTtc: number;
  totalOutstandingTtc: number;
}

export interface CreatePlatformInvoiceLineRequest {
  description: string;
  quantity: number;
  unitPriceHT: number;
  vatRate: number;
  relatedPeriodFrom?: string;
  relatedPeriodTo?: string;
}

export interface CreatePlatformInvoiceRequest {
  tenantId: string;
  billingType: PlatformInvoiceBillingTypeValueType;
  invoiceDate?: string;
  dueDate?: string;
  periodFrom?: string;
  periodTo?: string;
  discountAmount: number;
  creditsApplied: number;
  couponRedemptionId?: string;
  lines: CreatePlatformInvoiceLineRequest[];
}

export interface CancelPlatformInvoiceRequest {
  reason: string;
}

export interface CreatePlatformReceiptRequest {
  amountTND: number;
  paymentDate?: string;
  method: PlatformPaymentMethodValueType;
  reference?: string;
  providerTxId?: string;
  autoConfirm: boolean;
}

export interface CancelPlatformReceiptRequest {
  reason: string;
}

export interface PlatformFiscalSettingsDto {
  id: string;
  nif: string;
  codeTva: string | null;
  companyName: string;
  address: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  iban: string | null;
  bankName: string | null;
  applyVat: boolean;
  defaultVatRate: number;
  timbreFiscalAmount: number;
  applyClientWithholding: boolean;
  clientWithholdingRate: number;
  invoiceNumberPrefix: string;
  receiptNumberPrefix: string;
  legalMentions: string | null;
  updatedAt: string | null;
}

export interface UpdatePlatformFiscalSettingsRequest {
  nif: string;
  codeTva?: string | null;
  companyName: string;
  address: string;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  iban?: string | null;
  bankName?: string | null;
  applyVat: boolean;
  defaultVatRate: number;
  timbreFiscalAmount: number;
  applyClientWithholding: boolean;
  clientWithholdingRate: number;
  invoiceNumberPrefix: string;
  receiptNumberPrefix: string;
  legalMentions?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration IA plateforme (modèle LLM global, partagé par toutes les entreprises)
// ─────────────────────────────────────────────────────────────────────────────

/** Modèle IA disponible (issu du moteur IA InstaFact installé sur le serveur plateforme). */
export interface AiModelInfoDto {
  modelRef: string;
  providerKey: string;
  displayLabel: string;
  sizeBytes: number | null;
  modifiedAtUtc: string | null;
  supportsVision: boolean;
  supportsChat?: boolean;
}

export interface AiGpuInfoDto {
  name: string | null;
  vramBytes: number | null;
  isAccelerated: boolean;
}

export interface AiHardwareProfileDto {
  totalRamBytes: number;
  availableRamBytes: number;
  cpuCores: number;
  gpu: AiGpuInfoDto | null;
}

/** Recommandation matérielle du meilleur modèle local. */
export interface AiModelRecommendationDto {
  recommendedModelRef: string;
  displayLabel: string;
  reason: string;
  hardwareProfile: AiHardwareProfileDto;
}

/** Moteur d'inférence InstaFact IA (GPU auto ou CPU uniquement). */
export type OllamaInferenceDevice = 'Gpu' | 'CpuOnly';

/** Credentials OpenRouter partagés (masqués — jamais de clé en clair). */
export interface PlatformOpenRouterSettingsDto {
  isEnabled: boolean;
  displayName: string | null;
  baseUrl: string | null;
  defaultBaseUrl: string;
  isApiKeyConfigured: boolean;
  apiKeyLast4: string | null;
}

export interface UpdatePlatformOpenRouterRequest {
  isEnabled: boolean;
  displayName?: string | null;
  baseUrl?: string | null;
  /** Null/vide = conserver la clé existante. */
  apiKey?: string | null;
}

/** Credentials Cursor SDK partagés (masqués — jamais de clé en clair). */
export interface PlatformCursorSettingsDto {
  isEnabled: boolean;
  displayName: string | null;
  isApiKeyConfigured: boolean;
  apiKeyLast4: string | null;
}

export interface UpdatePlatformCursorRequest {
  isEnabled: boolean;
  displayName?: string | null;
  /** Null/vide = conserver la clé existante. */
  apiKey?: string | null;
}

/** Credentials Modal (Kimi) partagés (masqués — jamais de token en clair). */
export interface PlatformModalSettingsDto {
  isEnabled: boolean;
  displayName: string | null;
  baseUrl: string | null;
  defaultBaseUrl: string;
  defaultModelId: string;
  isApiKeyConfigured: boolean;
  apiKeyLast4: string | null;
}

export interface UpdatePlatformModalRequest {
  isEnabled: boolean;
  displayName?: string | null;
  baseUrl?: string | null;
  /** Bearer concaténé TOKEN_ID.TOKEN_SECRET. Null/vide = conserver la clé existante. */
  apiKey?: string | null;
}

/** Snapshot masqué de l'endpoint Modal plateforme (jamais de secret). */
export interface TenantModalPlatformSnapshotDto {
  isEnabled: boolean;
  displayName: string | null;
  baseUrl: string | null;
  isApiKeyConfigured: boolean;
  apiKeyLast4: string | null;
}

/** Configuration Modal d'une entreprise (override optionnel). */
export interface TenantModalSettingsDto {
  hasOverride: boolean;
  isEnabled: boolean;
  displayName: string | null;
  baseUrl: string | null;
  defaultBaseUrl: string;
  defaultModelId: string;
  isApiKeyConfigured: boolean;
  apiKeyLast4: string | null;
  platformConfiguredModelRef: string | null;
  platform: TenantModalPlatformSnapshotDto;
}

export interface UpdateTenantModalSettingsRequest {
  isEnabled: boolean;
  displayName?: string | null;
  baseUrl?: string | null;
  /** Bearer concaténé TOKEN_ID.TOKEN_SECRET. Null/vide = conserver la clé existante. */
  apiKey?: string | null;
}

/** Configuration IA plateforme : modèle configuré + données pour en choisir un. */
export interface PlatformAiSettingsDto {
  configuredModelRef: string | null;
  invoiceImportModelRef: string | null;
  studioAiModelRef: string | null;
  /** Modèle Studio avancé (GPU / cloud) proposé derrière la bascule « Modèle avancé » du Studio. */
  studioAiAdvancedModelRef: string | null;
  serverInvoiceImportVisionModel: string | null;
  inferenceDevice: OllamaInferenceDevice;
  isOllamaAssistantConfigured: boolean;
  availableModels: AiModelInfoDto[];
  recommendation: AiModelRecommendationDto | null;
  openRouter: PlatformOpenRouterSettingsDto;
  cursor: PlatformCursorSettingsDto;
  modal: PlatformModalSettingsDto;
}

export interface UpdatePlatformAiSettingsRequest {
  modelRef?: string | null;
  invoiceImportModelRef?: string | null;
  studioAiModelRef?: string | null;
  /** Doit différer de studioAiModelRef ; null/'' = désactiver la bascule « Modèle avancé ». */
  studioAiAdvancedModelRef?: string | null;
  inferenceDevice?: OllamaInferenceDevice | null;
  openRouter?: UpdatePlatformOpenRouterRequest | null;
  cursor?: UpdatePlatformCursorRequest | null;
  modal?: UpdatePlatformModalRequest | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Lot C5 — Providers paiement (Konnect / Paymee / Wire)
// ─────────────────────────────────────────────────────────────────────────────

export const PaymentProviderCode = {
  Konnect: 'konnect',
  Paymee: 'paymee',
  Wire: 'wire'
} as const;
export type PaymentProviderCodeType = (typeof PaymentProviderCode)[keyof typeof PaymentProviderCode];

export const PaymentIntentStatusValue = {
  Created: 0,
  RedirectIssued: 1,
  Pending: 2,
  Succeeded: 3,
  Failed: 4,
  Cancelled: 5,
  Refunded: 6
} as const;
export type PaymentIntentStatusValueType =
  (typeof PaymentIntentStatusValue)[keyof typeof PaymentIntentStatusValue];

export interface PaymentProviderConfigDto {
  id: string;
  providerCode: string;
  displayName: string;
  isEnabled: boolean;
  isTestMode: boolean;
  allowedReturnDomain: string | null;
  hasSecrets: boolean;
  hasWebhookSecret: boolean;
  updatedAt: string | null;
}

export interface PaymentProviderConfigsListDto {
  items: PaymentProviderConfigDto[];
  enabledCount: number;
}

export interface UpdatePaymentProviderConfigRequest {
  displayName: string;
  isEnabled: boolean;
  isTestMode: boolean;
  /** JSON brut chiffré côté serveur — laisser vide pour conserver l'existant. */
  secretsJson?: string | null;
  /** Webhook secret — laisser vide pour conserver l'existant. */
  webhookSecret?: string | null;
  allowedReturnDomain?: string | null;
}

export interface PaymentIntentDto {
  id: string;
  tenantId: string;
  tenantName: string;
  invoiceId: string;
  invoiceNumber: string | null;
  providerCode: string;
  providerRef: string | null;
  amountTND: number;
  status: PaymentIntentStatusValueType;
  statusDisplay: string;
  returnUrl: string | null;
  redirectUrl: string | null;
  failureReason: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface PaymentIntentsPageDto {
  items: PaymentIntentDto[];
  totalCount: number;
  succeededCount: number;
  pendingCount: number;
  failedCount: number;
  totalAmountSucceededTnd: number;
}

export interface InitiateCheckoutRequest {
  invoiceId: string;
  providerCode: string;
  returnUrl?: string;
}

export interface WireTransferInstructionsDto {
  companyName: string;
  iban: string;
  bankName: string | null;
  reference: string;
  amountTND: number;
}

export interface InitiateCheckoutResponse {
  intentId: string;
  providerCode: string;
  status: string;
  redirectUrl: string | null;
  wireInstructions: WireTransferInstructionsDto | null;
}

export interface RegisterWireReceiptRequest {
  reference: string;
  paymentDate?: string;
  amountTND: number;
  proofFileBase64?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Lot C6 — Renouvellement automatique + Dunning
// ─────────────────────────────────────────────────────────────────────────────

export const DunningStepActionValue = {
  SendEmail: 0,
  SuspendSubscription: 1,
  MarkPastDue: 2
} as const;
export type DunningStepActionValueType =
  (typeof DunningStepActionValue)[keyof typeof DunningStepActionValue];

export const DunningOutcomeValue = {
  Active: 0,
  Paid: 1,
  Suspended: 2,
  GiveUp: 3
} as const;
export type DunningOutcomeValueType =
  (typeof DunningOutcomeValue)[keyof typeof DunningOutcomeValue];

export interface DunningStepDto {
  daysAfterDueDate: number;
  action: DunningStepActionValueType;
  actionDisplay: string;
  emailTemplateCode: string | null;
  label: string;
}

export interface DunningCampaignDto {
  id: string;
  name: string;
  description: string | null;
  steps: DunningStepDto[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string | null;
}

export interface DunningCampaignsListDto {
  items: DunningCampaignDto[];
  activeCount: number;
}

export interface DunningStepInput {
  daysAfterDueDate: number;
  action: DunningStepActionValueType;
  emailTemplateCode?: string | null;
  label: string;
}

export interface CreateDunningCampaignRequest {
  name: string;
  description?: string | null;
  steps: DunningStepInput[];
  activateImmediately: boolean;
}

export interface UpdateDunningCampaignRequest {
  name: string;
  description?: string | null;
  steps: DunningStepInput[];
}

export interface DunningStateDto {
  id: string;
  subscriptionId: string;
  tenantId: string;
  tenantName: string;
  campaignId: string;
  campaignName: string;
  dueDate: string;
  currentStepIndex: number;
  nextActionAt: string;
  lastEmailSentAt: string | null;
  attemptsCount: number;
  outcome: DunningOutcomeValueType;
  outcomeDisplay: string;
  completedAt: string | null;
  lastError: string | null;
  relatedInvoiceId: string | null;
  relatedInvoiceNumber: string | null;
  createdAt: string;
}

export interface DunningStatesPageDto {
  items: DunningStateDto[];
  totalCount: number;
  activeCount: number;
  paidCount: number;
  suspendedCount: number;
  giveUpCount: number;
}

export interface ExtendGracePeriodRequest {
  days: number;
}
