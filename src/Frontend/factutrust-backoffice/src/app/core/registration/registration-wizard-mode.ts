import { InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';

/**
 * Copie backoffice des contrats d'inscription. Le jumeau
 * `factutrust-web/src/app/core/registration/registration-wizard-mode.ts` porte les mêmes
 * types pour l'application publique : les deux applications sont des workspaces npm
 * distincts, la duplication est assumée. Ne jamais modifier la copie web depuis ici.
 */

/**
 * Statut de provisionnement de la base d'un tenant, tel que l'API le sérialise.
 * `Pending` et `Failed` signifient que le dossier existe mais n'est pas utilisable.
 */
export type TenantProvisioningStatusValue = 'Ready' | 'Pending' | 'Failed';

/** Avertissement non bloquant renvoyé par le serveur après une inscription. */
export interface RegistrationWarning {
  code: string;
  severity: string;
  message: string;
}

export interface CompanyRegistrationSubmitRequest {
  email: string;
  password: string;
  confirmPassword: string;
  firstName: string;
  lastName: string;
  companyName: string;
  nif: string;
  taxRegime: number;
  street: string;
  city: string;
  postalCode?: string;
  governorate: string;
  streetLine2?: string;
  companyEmail: string;
  phone: string;
  website?: string;
  warehouseName?: string;
  companySegment?: string;
  businessDomain?: string;
  enabledModules?: number[];
  profileAnswers?: {
    hasPhysicalStock?: boolean | null;
    sellsToConsumers?: boolean | null;
    headcountBand?: string | null;
    accountingDelegatedToFirm?: boolean | null;
  };
}

export interface CompanyRegistrationSubmitResult {
  success: boolean;
  message?: string;
  errors?: string[];
  tenantId?: string;
  registrationWarnings?: RegistrationWarning[];
  /**
   * Statut de provisionnement renvoyé par la plateforme. L'API sérialise les énumérations en
   * chaînes (`JsonStringEnumConverter`) : `Ready` | `Pending` | `Failed`.
   */
  provisioningStatus?: TenantProvisioningStatusValue;
  /** Email du gérant créé, à communiquer à l'opérateur. */
  managerEmail?: string;
  /** Référence à transmettre au support (corrélation serveur). */
  reference?: string;
  /** Statut HTTP d'origine, pour distinguer un conflit (409) d'une validation (400). */
  httpStatus?: number;
}

export interface RegistrationWizardModeConfig {
  mode: 'public' | 'platform';
  submitCompany?: (request: CompanyRegistrationSubmitRequest) => Observable<CompanyRegistrationSubmitResult>;
  onCompanySuccess?: (tenantId: string) => void;
  hidePublicCrossLinks?: boolean;
  successTitle?: string;
}

export const REGISTRATION_WIZARD_MODE = new InjectionToken<RegistrationWizardModeConfig>(
  'REGISTRATION_WIZARD_MODE',
  { factory: () => ({ mode: 'public' }) }
);

export interface FirmRegistrationSubmitRequest {
  email: string;
  password: string;
  confirmPassword: string;
  firstName: string;
  lastName: string;
  firmName: string;
  nif: string;
  street: string;
  city: string;
  postalCode?: string;
  governorate: string;
  streetLine2?: string;
  firmEmail: string;
  phone: string;
  website?: string;
  description?: string;
  professionalRegistrationNumber?: string;
  isPublicInDirectory: boolean;
}

export interface FirmRegistrationSubmitResult {
  success: boolean;
  message?: string;
  errors?: string[];
  tenantId?: string;
  provisioningStatus?: TenantProvisioningStatusValue;
  managerEmail?: string;
  reference?: string;
  httpStatus?: number;
}

export interface RegistrationFirmModeConfig {
  mode: 'public' | 'platform';
  submitFirm?: (request: FirmRegistrationSubmitRequest) => Observable<FirmRegistrationSubmitResult>;
  onFirmSuccess?: (tenantId: string) => void;
  hidePublicCrossLinks?: boolean;
}

export const REGISTRATION_FIRM_MODE = new InjectionToken<RegistrationFirmModeConfig>(
  'REGISTRATION_FIRM_MODE',
  { factory: () => ({ mode: 'public' }) }
);
