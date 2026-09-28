/// <reference types="@angular/localize" />
import { Injectable, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, firstValueFrom, tap, catchError, of, finalize, shareReplay } from 'rxjs';
import { environment } from '@environments/environment';
import { AppModule } from '@core/models/app-module';
import { createHttpContextSkipGlobalErrorUi } from '@core/http-context';
import { clearWarehouseStorage } from './warehouse-storage';
import { ToastService } from './toast.service';
import {
  ProductOnboardingChecklist,
  ProductOnboardingStatus,
  normalizeOnboardingStatus
} from '@core/onboarding/product-onboarding.models';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  role: string;
  roleDisplay: string;
  tenantId: string;
  companyName: string;
  tenantKind?: number | string;
  accessMode?: 'native' | 'delegated';
  contextTenantId?: string;
  contextCompanyName?: string;
  /** True when the active delegated dossier is firm-managed (no platform commercial account). */
  isFirmManaged?: boolean;
  /** True when payroll execution is delegated to an assigned accounting firm (company native mode). */
  isPayrollFirmManaged?: boolean;
  twoFactorEnabled: boolean;
  /** AppModule enum values enabled for this user */
  enabledModuleIds?: number[];
  effectivePermissions?: string[];
  /**
   * Sector-aware registration profile (Phase 2 sector rules). Absent on sessions
   * created before this field existed or on legacy/non-sector-wizard signups —
   * consumers must treat it as optional and fail closed (hide, don't show).
   * Intentionally NOT added to the `getStoredUser()` session-purge guard below:
   * these two fields are onboarding-gating hints only, never a security control,
   * so an absent/stale value must not force a re-login like a missing
   * `enabledModuleIds`/`effectivePermissions` does.
   */
  companySegment?: string | null;
  businessDomain?: string | null;
  productOnboardingStatus?: ProductOnboardingStatus;
  productOnboardingVersion?: number;
  productOnboardingChecklist?: ProductOnboardingChecklist;
  /**
   * Phase 3 (plan §3.5) — UTC creation date of the home tenant, used to gate
   * "progressive profiling" onboarding nudges (e.g. show a profile-completion
   * reminder only after `minAgeDays`). Absent on sessions created before this
   * field existed — consumers must treat it as optional and fail open (show, don't hide).
   */
  tenantCreatedAtUtc?: string | null;
  /** UI locale preference (`fr` | `ar`). Absent ⇒ French. */
  preferredLanguage?: string | null;
}

/** Codes stables d'avertissement d'inscription (miroir de `RegistrationWarningCodes` côté API). */
export type RegistrationWarningCode =
  | 'SECTOR_SELECTION_IGNORED'
  | 'NIF_SEGMENT_MISMATCH'
  | 'MODULES_SELECTION_IGNORED'
  | 'MODULES_DENIED_BY_PLAN'
  | 'MODULES_ACTIVATION_FAILED'
  | 'MODULES_IGNORED_AT_REGISTRATION'
  | 'SUBSCRIPTION_PLAN_NOT_APPLIED'
  | 'UNKNOWN';

/** Sévérités stables (miroir de `RegistrationWarningSeverities` côté API). */
export type RegistrationWarningSeverity = 'info' | 'warning';

/**
 * Avertissement non bloquant typé (miroir de `RegistrationWarningDto` côté API).
 * `code` permet à l'UI de proposer une action ciblée au lieu de deviner le sujet du message
 * (une remarque sur le NIF n'est pas un échec d'activation de module).
 */
export interface RegistrationWarningDetail {
  code: RegistrationWarningCode;
  message: string;
  severity: RegistrationWarningSeverity;
}

/**
 * Table d'appartenance dérivée de l'union. `Record<RegistrationWarningCode, true>` force le
 * compilateur à exiger une entrée par membre : ajouter un code à `RegistrationWarningCode`
 * sans l'inscrire ici ne compile pas, ce qui empêche l'union de redériver du backend en silence.
 */
const REGISTRATION_WARNING_CODES: Readonly<Record<RegistrationWarningCode, true>> = {
  SECTOR_SELECTION_IGNORED: true,
  NIF_SEGMENT_MISMATCH: true,
  MODULES_SELECTION_IGNORED: true,
  MODULES_DENIED_BY_PLAN: true,
  MODULES_ACTIVATION_FAILED: true,
  MODULES_IGNORED_AT_REGISTRATION: true,
  SUBSCRIPTION_PLAN_NOT_APPLIED: true,
  UNKNOWN: true
};

function normalizeRegistrationWarningCode(raw: unknown): RegistrationWarningCode {
  if (typeof raw !== 'string') {
    return 'UNKNOWN';
  }
  const s = raw.trim();
  if (!s) {
    return 'UNKNOWN';
  }
  // `hasOwnProperty` et non `in` : `'constructor'` ne doit pas passer pour un code connu.
  if (Object.prototype.hasOwnProperty.call(REGISTRATION_WARNING_CODES, s)) {
    return s as RegistrationWarningCode;
  }
  console.warn('[AuthService] Unknown registration warning code; degrading to UNKNOWN:', s);
  return 'UNKNOWN';
}

/** Forme brute d'un avertissement tel qu'il arrive du réseau (ensemble OUVERT, non narrowé). */
export interface RawRegistrationWarning {
  code?: unknown;
  message?: unknown;
  severity?: unknown;
}

/**
 * Narrowing UNIQUE des avertissements d'inscription. Le contrat réseau est un ensemble OUVERT
 * (`{ code: string; severity: string; message: string }` : le serveur peut ajouter un code sans
 * casser le client) alors que l'UI branche sur une union fermée — tout ce qui entre passe donc
 * par ici, y compris `warningDetails`, qui n'est typé qu'à l'interface mais reste du JSON.
 *
 * Replis : message vide/absent ⇒ `null` (rien à afficher) ; code inconnu ⇒ `UNKNOWN` (le message
 * reste affiché, seule l'action ciblée est perdue) ; sévérité inconnue ⇒ `warning`, le repli le
 * plus visible — on ne dégrade jamais un avis en `info` par accident.
 */
export function normalizeRegistrationWarning(
  raw: RawRegistrationWarning | null | undefined
): RegistrationWarningDetail | null {
  const message = typeof raw?.message === 'string' ? raw.message : '';
  if (!message.trim()) {
    return null;
  }

  return {
    code: normalizeRegistrationWarningCode(raw?.code),
    message,
    severity: raw?.severity === 'info' ? 'info' : 'warning'
  };
}

/** Narrowing d'une liste brute : mêmes replis, entrées sans message écartées. */
export function toRegistrationWarningList(
  raw: readonly (RawRegistrationWarning | null | undefined)[] | null | undefined
): RegistrationWarningDetail[] {
  return (raw ?? [])
    .map(normalizeRegistrationWarning)
    .filter((w): w is RegistrationWarningDetail => w !== null);
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  user: User;
  requires2Fa: boolean;
  /**
   * Non-blocking warnings surfaced by the backend (e.g. a module requested by
   * the wizard could not be enabled). Absent/empty ⇒ nothing to show. Never
   * used as a security signal — purely informational for the UI banner.
   *
   * Contrat historique conservé : `warningDetails` porte la même liste, typée.
   */
  warnings?: string[];
  /**
   * Même liste que `warnings`, avec code + sévérité. Absente si l'API est antérieure à ce
   * champ : les appelants doivent alors retomber sur `warnings` (cf. `toRegistrationWarnings`).
   */
  warningDetails?: RegistrationWarningDetail[];
}

/**
 * Normalise les avertissements d'une réponse d'inscription : `warningDetails` s'il est présent,
 * sinon repli sur `warnings` (API plus ancienne) en code `UNKNOWN`. Les messages vides sont
 * écartés dans les deux cas.
 */
export function toRegistrationWarnings(response: AuthResponse | null | undefined): RegistrationWarningDetail[] {
  if (!response) {
    return [];
  }

  // Les deux contrats convergent : une entrée héritée est un avertissement sans code ni sévérité,
  // que `normalizeRegistrationWarning` ramène à `UNKNOWN` / `warning`.
  return toRegistrationWarningList(
    response.warningDetails?.length
      ? response.warningDetails
      : (response.warnings ?? []).map(message => ({ message }))
  );
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message: string | null;
  errors: string[];
}

export interface LoginRequest {
  email: string;
  password: string;
  rememberMe: boolean;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  email: string;
  token: string;
  newPassword: string;
  confirmNewPassword: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  confirmPassword: string;
  firstName: string;
  lastName: string;
  companyName: string;
  nif: string;
  taxRegime: number;
  street: string;
  streetLine2?: string;
  city: string;
  postalCode?: string;
  governorate: string;
  companyEmail: string;
  phone: string;
  website?: string;
  warehouseName?: string;
  /** Sector-aware registration wizard (Phase 1). Absent/undefined ⇒ exact legacy behavior. */
  companySegment?: string;
  businessDomain?: string;
  enabledModules?: number[];
  /**
   * Réponses de profilage de l'étape Configuration (lot 3). Facultatif : absent ⇒ comportement
   * d'inscription identique à avant ce lot. Le serveur ne s'en sert jamais pour dériver des
   * modules — `enabledModules` reste la seule sélection soumise à validation — il les normalise
   * et les enregistre sur le tenant.
   */
  profileAnswers?: {
    hasPhysicalStock?: boolean | null;
    sellsToConsumers?: boolean | null;
    headcountBand?: string | null;
    accountingDelegatedToFirm?: boolean | null;
  };
}

export interface RegisterAccountingFirmRequest {
  email: string;
  password: string;
  confirmPassword: string;
  firstName: string;
  lastName: string;
  firmName: string;
  nif: string;
  street: string;
  streetLine2?: string;
  city: string;
  postalCode?: string;
  governorate: string;
  firmEmail: string;
  phone: string;
  website?: string;
  description?: string;
  professionalRegistrationNumber?: string;
  isPublicInDirectory?: boolean;
}

/** Canonical role names (PascalCase), aligned with backend <c>InstaFact.Domain.Enums.UserRole</c>. */
const CANONICAL_TENANT_ROLES = [
  'Administrator',
  'Accountant',
  'Client',
  'SalesRep',
  'SalesManager',
  'Warehouse',
  'Purchaser',
  'Cashier',
  'Auditor',
  'Supervisor',
  'Developer',
  'FirmManager',
  'FirmAccountant'
] as const;

/**
 * API JSON uses <c>JsonStringEnumConverter(JsonNamingPolicy.CamelCase)</c> → e.g. <c>administrator</c>.
 * The SPA compares roles to PascalCase strings; normalize at the boundary.
 */
const API_ROLE_STRING_TO_CANONICAL: Record<string, string> = {
  administrator: 'Administrator',
  accountant: 'Accountant',
  client: 'Client',
  salesRep: 'SalesRep',
  salesManager: 'SalesManager',
  warehouse: 'Warehouse',
  purchaser: 'Purchaser',
  cashier: 'Cashier',
  auditor: 'Auditor',
  supervisor: 'Supervisor',
  developer: 'Developer',
  firmManager: 'FirmManager',
  firmAccountant: 'FirmAccountant'
};

const ROLE_ENUM_INDEX_TO_CANONICAL: Record<number, string> = {
  0: 'Administrator',
  1: 'Accountant',
  2: 'Client',
  3: 'SalesRep',
  4: 'SalesManager',
  5: 'Warehouse',
  6: 'Purchaser',
  7: 'Cashier',
  8: 'Auditor',
  9: 'Supervisor',
  10: 'Developer',
  11: 'FirmManager',
  12: 'FirmAccountant'
};

/**
 * Maps API / stored <c>role</c> to canonical PascalCase. Unknown values fall back to <c>Accountant</c>
 * (same default as backend when no tenant role claim is present).
 */
export function normalizeTenantRole(raw: unknown): string {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw in ROLE_ENUM_INDEX_TO_CANONICAL) {
    return ROLE_ENUM_INDEX_TO_CANONICAL[raw];
  }
  if (typeof raw !== 'string') {
    if (raw !== null && raw !== undefined) {
      console.warn('[AuthService] Unexpected role type; defaulting to Accountant:', raw);
    }
    return 'Accountant';
  }
  const s = raw.trim();
  if (!s) {
    return 'Accountant';
  }
  if ((CANONICAL_TENANT_ROLES as readonly string[]).includes(s)) {
    return s;
  }
  const fromCamel = API_ROLE_STRING_TO_CANONICAL[s];
  if (fromCamel) {
    return fromCamel;
  }
  const lowerFirst = s.charAt(0).toLowerCase() + s.slice(1);
  const fromLowerFirst = API_ROLE_STRING_TO_CANONICAL[lowerFirst];
  if (fromLowerFirst) {
    return fromLowerFirst;
  }
  console.warn('[AuthService] Unknown role value; defaulting to Accountant:', s);
  return 'Accountant';
}

export type NormalizedTenantKind = 'company' | 'accountingFirm';

const FIRM_ROLES = new Set(['FirmManager', 'FirmAccountant']);

/**
 * Normalizes API/stored tenantKind to a canonical discriminant.
 * Handles numeric enums, PascalCase/camelCase strings, and role fallback for legacy sessions.
 */
export function normalizeTenantKind(raw: unknown, role?: unknown): NormalizedTenantKind {
  if (typeof raw === 'number') {
    return raw === 1 ? 'accountingFirm' : 'company';
  }
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) {
      return FIRM_ROLES.has(normalizeTenantRole(role)) ? 'accountingFirm' : 'company';
    }
    const lower = s.toLowerCase();
    if (lower === 'accountingfirm' || lower === 'accounting_firm') {
      return 'accountingFirm';
    }
    if (lower === 'company') {
      return 'company';
    }
  }
  if (FIRM_ROLES.has(normalizeTenantRole(role))) {
    return 'accountingFirm';
  }
  return 'company';
}

function normalizeUserFields(user: User): User {
  const role = normalizeTenantRole(user.role);
  const tenantKind = normalizeTenantKind(user.tenantKind, role);
  return {
    ...user,
    role,
    tenantKind,
    productOnboardingStatus:
      user.productOnboardingStatus === undefined || user.productOnboardingStatus === null
        ? 'Completed'
        : normalizeOnboardingStatus(user.productOnboardingStatus)
  };
}

/**
 * When "Se souvenir de moi" is used, tokens live in localStorage (one session shared across
 * tabs/windows). Otherwise sessionStorage isolates each tab/window.
 */
const REMEMBER_ME_FLAG_KEY = 'ft_auth_remember_me';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly API_URL = `${environment.apiUrl}/auth`;
  private readonly TOKEN_KEY = 'ft_access_token';
  private readonly REFRESH_TOKEN_KEY = 'ft_refresh_token';
  private readonly USER_KEY = 'ft_user';

  private userSignal = signal<User | null>(null);

  readonly user = this.userSignal.asReadonly();
  readonly isAuthenticated = computed(() => !!this.userSignal());
  readonly isAdmin = computed(() => this.userSignal()?.role === 'Administrator');
  readonly isClientPortal = computed(() => this.userSignal()?.role === 'Client');
  /** Hub Paramètres plateforme (hors « Mon profil ») : Administrateur ou Superviseur uniquement. */
  readonly canAccessPlatformSettings = computed(() => {
    const r = this.userSignal()?.role;
    return r === 'Administrator' || r === 'Supervisor';
  });
  /** Accès au builder Studio (low-code) : permission de conception requise (Développeur, ou Admin/Superviseur). */
  readonly canAccessStudio = computed(() => this.hasPermission('studio:design_entities'));
  readonly isAccountingFirm = computed(() => {
    const user = this.userSignal();
    return normalizeTenantKind(user?.tenantKind, user?.role) === 'accountingFirm';
  });
  readonly isDelegatedMode = computed(() => this.userSignal()?.accessMode === 'delegated');
  /** Cabinet comptable consulte un dossier client : pas d'écriture trésorerie/paiements côté UI. */
  readonly isFirmDelegatedReadonly = computed(
    () => this.isAccountingFirm() && this.isDelegatedMode()
  );
  /** Dossier client créé/géré par le cabinet (sans compte plateforme) en mode délégué. */
  readonly isFirmManagedDelegated = computed(
    () => this.isAccountingFirm() && this.isDelegatedMode() && !!this.userSignal()?.isFirmManaged
  );
  /** Société cliente avec cabinet assigné : cycles de paie gérés par le cabinet. */
  readonly isPayrollFirmManaged = computed(
    () => !this.isAccountingFirm() && !!this.userSignal()?.isPayrollFirmManaged
  );
  readonly isFirmManager = computed(() => this.userSignal()?.role === 'FirmManager');
  readonly isFirmAccountant = computed(() => this.userSignal()?.role === 'FirmAccountant');

  constructor(
    private http: HttpClient,
    private router: Router,
    private toast: ToastService
  ) {
    this.migrateLegacyLocalToSessionIfNeeded();
    this.userSignal.set(this.getStoredUser());
    this.checkTokenExpiration();
  }

  login(credentials: LoginRequest): Observable<ApiResponse<AuthResponse>> {
    return this.http.post<ApiResponse<AuthResponse>>(`${this.API_URL}/login`, credentials, {
      context: createHttpContextSkipGlobalErrorUi()
    })
      .pipe(
        tap(response => {
          if (response.success && response.data && !response.data.requires2Fa) {
            this.handleAuthResponse(response.data, credentials.rememberMe);
          }
        })
      );
  }

  forgotPassword(email: string): Observable<ApiResponse<null>> {
    return this.http.post<ApiResponse<null>>(`${this.API_URL}/forgot-password`, { email });
  }

  resetPassword(dto: ResetPasswordRequest): Observable<ApiResponse<null>> {
    return this.http.post<ApiResponse<null>>(`${this.API_URL}/reset-password`, dto);
  }

  /**
   * Inscription société.
   *
   * SÉCURITÉ — la réponse transporte `accessToken` + `refreshToken` + le profil complet :
   * elle ne doit JAMAIS être journalisée (console, télémétrie, capture d'écran de support).
   * Un `console.log` de cette réponse a existé ici et exposait les jetons en clair.
   * Les erreurs ne sont pas journalisées non plus : elles remontent telles quelles aux
   * composants d'inscription, qui les affichent via `ErrorHandlerService`.
   */
  register(data: RegisterRequest): Observable<ApiResponse<AuthResponse>> {
    return this.http.post<ApiResponse<AuthResponse>>(`${this.API_URL}/register`, data)
      .pipe(
        tap(response => {
          if (response.success && response.data) {
            this.handleAuthResponse(response.data, false);
          }
        })
      );
  }

  registerFirm(data: RegisterAccountingFirmRequest): Observable<ApiResponse<AuthResponse>> {
    return this.http.post<ApiResponse<AuthResponse>>(`${this.API_URL}/register-firm`, data).pipe(
      tap(response => {
        if (response.success && response.data) {
          this.handleAuthResponse(response.data, false);
        }
      })
    );
  }

  applyAuthResponse(response: AuthResponse): void {
    this.handleAuthResponse(response, this.isRememberMeBrowserScope());
  }

  logout(): void {
    this.http.post(`${this.API_URL}/logout`, {}).pipe(
      catchError(() => of(null))
    ).subscribe(() => {
      this.clearAuth();
      this.redirectToLoginUnlessOnAuthRoute();
    });
  }

  /**
   * Clears local session without POST /logout.
   * Used by the auth interceptor when refresh fails or the JWT is already unusable.
   * Redirects to login only when not already on an /auth/* route — avoids a redundant
   * navigation that aborts View Transitions (`InvalidStateError`) on /auth/login.
   */
  invalidateSession(): void {
    this.clearAuth();
    this.redirectToLoginUnlessOnAuthRoute();
  }

  /** True when the current router URL is under `/auth` (login, register, …). */
  private isOnAuthRoute(): boolean {
    const path = this.router.url.split('?')[0];
    return /^\/auth(\/|$)/.test(path);
  }

  private redirectToLoginUnlessOnAuthRoute(): void {
    if (!this.isOnAuthRoute()) {
      void this.router.navigate(['/auth/login']);
    }
  }

  /**
   * Mutex de refresh : les 401 concurrents partagent LA même requête.
   * Sans cela, chaque 401 déclenchait son propre refresh ; avec la rotation des
   * refresh tokens côté serveur, les requêtes perdantes invalidaient la session
   * (déconnexions intempestives sous rafale de requêtes expirées).
   */
  private refreshInFlight$: Observable<ApiResponse<AuthResponse>> | null = null;

  refreshToken(): Observable<ApiResponse<AuthResponse>> {
    if (this.refreshInFlight$) {
      return this.refreshInFlight$;
    }
    const refreshToken = this.getRefreshToken();
    const previousContextTenantId =
      this.userSignal()?.accessMode === 'delegated' ? this.userSignal()?.contextTenantId : undefined;
    this.refreshInFlight$ = this.http.post<ApiResponse<AuthResponse>>(`${this.API_URL}/refresh`, { refreshToken })
      .pipe(
        tap(response => {
          if (response.success && response.data) {
            this.handleAuthResponse(response.data, this.isRememberMeBrowserScope());
            this.handleDelegatedContextLoss(previousContextTenantId);
          }
        }),
        catchError(error => {
          this.clearAuth();
          throw error;
        }),
        finalize(() => {
          this.refreshInFlight$ = null;
        }),
        shareReplay(1)
      );
    return this.refreshInFlight$;
  }

  /**
   * Un rafraichissement qui perd le contexte dossier ramene l'utilisateur au cabinet.
   *
   * Le serveur rejoue desormais `context_tenant_id` au refresh, mais il refuse de le faire quand
   * l'affectation a ete revoquee entre-temps. Dans ce cas l'ecran comptable ouvert continuerait
   * d'interroger l'API avec un jeton natif : les memes URL repondraient 200 avec les donnees DU
   * CABINET. Le garde de route ne se rejoue pas sans navigation : c'est donc ici qu'on force le
   * retour, plutot que de laisser l'utilisateur lire la mauvaise base sans le savoir.
   */
  private handleDelegatedContextLoss(previousContextTenantId: string | undefined): void {
    if (!previousContextTenantId) {
      return;
    }

    const user = this.userSignal();
    if (user?.accessMode === 'delegated' && user.contextTenantId === previousContextTenantId) {
      return;
    }

    this.toast.add({
      severity: 'warn',
      summary: $localize`:@@auth.service.summary.dossierFerme:Dossier fermé`,
      detail: $localize`:@@auth.service.detail.accesDossierInactif:Votre accès à ce dossier client n'est plus actif. Retour à l'espace cabinet.`
    });

    void this.router.navigate(['/firm/dashboard']);
  }

  /**
   * Re-fetch the current user with fresh permissions and modules from the backend
   * without rotating the JWT. Used at app boot to pick up role/grant changes that
   * occurred while the user's session was idle.
   */
  me(): Observable<ApiResponse<User>> {
    return this.http.get<ApiResponse<User>>(`${this.API_URL}/me`).pipe(
      tap(response => {
        if (response.success && response.data) {
          const user = normalizeUserFields(response.data);
          this.persistUser(user);
          this.userSignal.set(user);
        }
      })
    );
  }

  /**
   * Re-fetch the current user's profile (permissions + enabled modules) and update
   * the signal in place, without rotating the JWT. Intention-revealing alias of
   * {@link me} for callers that change the tenant's module configuration
   * (registration follow-up, Paramètres > Modules in Phase 2) and need the sidebar
   * (`AppNavService.navItems`) to recompute immediately — no logout/login required.
   */
  refreshUserProfile(): Observable<ApiResponse<User>> {
    return this.me();
  }

  /**
   * Called once during APP_INITIALIZER. If a session exists locally, fetch fresh
   * permissions/modules from the backend and update the user signal. No-ops when
   * unauthenticated. Network/server failures are swallowed to keep the app bootable
   * offline; the existing 401 → refreshToken flow handles auth issues.
   */
  async bootstrapRefresh(): Promise<void> {
    if (!this.getAccessToken() || !this.getStoredUser()) {
      return;
    }
    const timeout = new Promise<void>(resolve => setTimeout(resolve, 3000));
    try {
      await Promise.race([
        firstValueFrom(this.me()).then(() => undefined),
        timeout
      ]);
    } catch {
      // keep stored user — interceptor handles 401, transient errors are non-fatal
    }
  }

  getAccessToken(): string | null {
    if (this.isRememberMeBrowserScope()) {
      return localStorage.getItem(this.TOKEN_KEY);
    }
    return sessionStorage.getItem(this.TOKEN_KEY);
  }

  getRefreshToken(): string | null {
    if (this.isRememberMeBrowserScope()) {
      return localStorage.getItem(this.REFRESH_TOKEN_KEY);
    }
    return sessionStorage.getItem(this.REFRESH_TOKEN_KEY);
  }

  /**
   * Fail-closed : champ absent => refus. Le backend renvoie TOUJOURS
   * enabledModuleIds (login/refresh/me), et les sessions stockées antérieures
   * à ce champ sont purgées au chargement (getStoredUser) — l'absence ne peut
   * donc être qu'un état anormal (ex. storage édité à la main).
   */
  hasModule(module: AppModule): boolean {
    const ids = this.userSignal()?.enabledModuleIds;
    if (ids === undefined || ids === null) {
      return false;
    }
    return ids.includes(module);
  }

  hasAllModules(modules: readonly AppModule[]): boolean {
    return modules.every(m => this.hasModule(m));
  }

  /**
   * Fail-closed : champ absent => refus (voir hasModule). Quand il est présent
   * (y compris vide), chaque permission listée est exigée.
   */
  hasAllPermissions(permissions: readonly string[]): boolean {
    if (permissions.length === 0) {
      return true;
    }
    const raw = this.userSignal()?.effectivePermissions;
    if (raw === undefined || raw === null) {
      return false;
    }
    const set = new Set(raw);
    return permissions.every(p => set.has(p));
  }

  /** Single permission; same legacy rules as {@link hasAllPermissions}. */
  hasPermission(permission: string): boolean {
    return this.hasAllPermissions([permission]);
  }

  /**
   * True si au moins une permission est présente. Fail-closed : champ absent => refus.
   */
  hasAnyPermission(permissions: readonly string[]): boolean {
    if (permissions.length === 0) {
      return true;
    }
    const raw = this.userSignal()?.effectivePermissions;
    if (raw === undefined || raw === null) {
      return false;
    }
    const set = new Set(raw);
    return permissions.some(p => set.has(p));
  }

  private isRememberMeBrowserScope(): boolean {
    return localStorage.getItem(REMEMBER_ME_FLAG_KEY) === '1';
  }

  /**
   * Legacy: tokens were only in localStorage. Move to sessionStorage for this tab so other
   * windows/tabs no longer share the same JWT. Skip if user chose "remember me" (flag set).
   */
  private migrateLegacyLocalToSessionIfNeeded(): void {
    if (this.isRememberMeBrowserScope()) {
      return;
    }
    if (sessionStorage.getItem(this.TOKEN_KEY)) {
      return;
    }
    const access = localStorage.getItem(this.TOKEN_KEY);
    const refresh = localStorage.getItem(this.REFRESH_TOKEN_KEY);
    const user = localStorage.getItem(this.USER_KEY);
    if (!access && !refresh && !user) {
      return;
    }
    if (access) {
      sessionStorage.setItem(this.TOKEN_KEY, access);
    }
    if (refresh) {
      sessionStorage.setItem(this.REFRESH_TOKEN_KEY, refresh);
    }
    if (user) {
      sessionStorage.setItem(this.USER_KEY, user);
    }
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.REFRESH_TOKEN_KEY);
    localStorage.removeItem(this.USER_KEY);
  }

  private handleAuthResponse(response: AuthResponse, persistAcrossBrowserRestarts: boolean): void {
    const user = normalizeUserFields(response.user);
    if (persistAcrossBrowserRestarts) {
      localStorage.setItem(REMEMBER_ME_FLAG_KEY, '1');
      localStorage.setItem(this.TOKEN_KEY, response.accessToken);
      localStorage.setItem(this.REFRESH_TOKEN_KEY, response.refreshToken);
      localStorage.setItem(this.USER_KEY, JSON.stringify(user));
      this.clearSessionAuthKeys();
    } else {
      localStorage.removeItem(REMEMBER_ME_FLAG_KEY);
      sessionStorage.setItem(this.TOKEN_KEY, response.accessToken);
      sessionStorage.setItem(this.REFRESH_TOKEN_KEY, response.refreshToken);
      sessionStorage.setItem(this.USER_KEY, JSON.stringify(user));
      this.clearLocalAuthKeys();
    }
    this.userSignal.set(user);

    if (normalizeTenantKind(user.tenantKind, user.role) === 'accountingFirm') {
      clearWarehouseStorage();
    }

    // Préchauffe le modèle IA en arrière-plan dès la connexion (fire-and-forget).
    // Sur CPU, charger un modèle 7B prend 10–30 s : le faire ici évite que le 1ᵉʳ message
    // du chat paie ce coût. Si l'endpoint échoue (Ollama down, OpenRouter sans clé), on
    // ignore silencieusement — le panneau chat réessaiera à la première ouverture.
    this.warmUpAiSilently();
  }

  private warmUpAiSilently(): void {
    if (!this.hasPermission('ai:chat')) {
      return;
    }
    try {
      this.http
        .post(`${environment.apiUrl}/ai/warm-up`, {}, {
          context: createHttpContextSkipGlobalErrorUi()
        })
        .pipe(catchError(() => of(null)))
        .subscribe();
    } catch {
      // Échec très improbable (DI non prête) — non bloquant.
    }
  }

  /**
   * Persist a user object to the same storage scope (local vs session) currently
   * in use. Does not touch tokens. Used by me() to keep ft_user in sync with
   * backend permission changes while preserving remember-me semantics.
   */
  private persistUser(user: User): void {
    const json = JSON.stringify(user);
    if (this.isRememberMeBrowserScope()) {
      localStorage.setItem(this.USER_KEY, json);
    } else {
      sessionStorage.setItem(this.USER_KEY, json);
    }
  }

  /** Merge first-login tour fields into the in-memory + stored user (no token change). */
  patchLocalOnboarding(partial: {
    productOnboardingStatus?: ProductOnboardingStatus;
    productOnboardingVersion?: number;
    productOnboardingChecklist?: ProductOnboardingChecklist;
  }): void {
    const current = this.userSignal();
    if (!current) {
      return;
    }
    const next: User = {
      ...current,
      ...partial,
      productOnboardingStatus:
        partial.productOnboardingStatus === undefined || partial.productOnboardingStatus === null
          ? current.productOnboardingStatus
          : normalizeOnboardingStatus(partial.productOnboardingStatus)
    };
    this.userSignal.set(next);
    this.persistUser(next);
  }

  private clearAuth(): void {
    localStorage.removeItem(REMEMBER_ME_FLAG_KEY);
    this.clearLocalAuthKeys();
    this.clearSessionAuthKeys();
    this.userSignal.set(null);
    clearWarehouseStorage();
  }

  private clearLocalAuthKeys(): void {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.REFRESH_TOKEN_KEY);
    localStorage.removeItem(this.USER_KEY);
  }

  private clearSessionAuthKeys(): void {
    sessionStorage.removeItem(this.TOKEN_KEY);
    sessionStorage.removeItem(this.REFRESH_TOKEN_KEY);
    sessionStorage.removeItem(this.USER_KEY);
  }

  private getStoredUser(): User | null {
    const userJson = this.isRememberMeBrowserScope()
      ? localStorage.getItem(this.USER_KEY)
      : sessionStorage.getItem(this.USER_KEY);
    if (userJson) {
      try {
        const parsed = JSON.parse(userJson) as User;
        // Session obsolète (antérieure aux champs enabledModuleIds/effectivePermissions) :
        // on la purge plutôt que d'appliquer un fail-open — l'utilisateur se reconnecte
        // et reçoit un payload complet. Empêche aussi qu'une édition manuelle du storage
        // (suppression des champs) ne désactive les contrôles côté client.
        if (parsed.enabledModuleIds == null || parsed.effectivePermissions == null) {
          this.clearLocalAuthKeys();
          this.clearSessionAuthKeys();
          return null;
        }
        return normalizeUserFields(parsed);
      } catch {
        return null;
      }
    }
    return null;
  }

  private checkTokenExpiration(): void {
    const token = this.getAccessToken();
    if (!token) return;

    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const expiry = payload.exp * 1000;

      if (Date.now() >= expiry) {
        this.clearAuth();
      }
    } catch {
      this.clearAuth();
    }
  }
}
