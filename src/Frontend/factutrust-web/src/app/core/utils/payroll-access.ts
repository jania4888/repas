import { PERMISSIONS } from '@core/config/permission-keys';
import type { AuthService } from '@core/services/auth.service';

/** True when payroll execution is delegated to an assigned accounting firm. */
export function isPayrollFirmManaged(auth: AuthService): boolean {
  return auth.isPayrollFirmManaged();
}

/** Company user with an active cabinet assignment (payroll cycles managed by the firm). */
export function isCompanyPayrollReadOnly(auth: AuthService): boolean {
  return !auth.isAccountingFirm() && auth.isPayrollFirmManaged();
}

/** True when the user may create/edit employees, contracts, leaves and advances. */
export function canManagePayrollEmployees(auth: AuthService): boolean {
  return auth.hasPermission(PERMISSIONS.payroll.manageEmployees);
}

export function canRunPayroll(auth: AuthService): boolean {
  return auth.hasPermission(PERMISSIONS.payroll.run);
}

export function canValidatePayroll(auth: AuthService): boolean {
  return auth.hasPermission(PERMISSIONS.payroll.validate);
}

export function canConfigurePayroll(auth: AuthService): boolean {
  return auth.hasPermission(PERMISSIONS.payroll.settings);
}

export function canDeclarePayroll(auth: AuthService): boolean {
  return auth.hasPermission(PERMISSIONS.payroll.declare);
}

export function canExportPayroll(auth: AuthService): boolean {
  return auth.hasPermission(PERMISSIONS.payroll.export);
}

export function canPayPayroll(auth: AuthService): boolean {
  return auth.hasPermission(PERMISSIONS.payroll.pay);
}

/** True when the user may create/edit salary garnishments and alimony orders. */
export function canManageGarnishments(auth: AuthService): boolean {
  return auth.hasPermission(PERMISSIONS.payroll.manageGarnishments);
}

export function canGenerateHrDocuments(auth: AuthService): boolean {
  return auth.hasPermission(PERMISSIONS.payroll.hrDocuments);
}

export function canManageTermination(auth: AuthService): boolean {
  return auth.hasPermission(PERMISSIONS.payroll.manageTermination);
}

/** Accounting firm in delegated mode without employee management rights. */
export function isPayrollConsultMode(auth: AuthService): boolean {
  return auth.isAccountingFirm() && auth.isDelegatedMode() && !canManagePayrollEmployees(auth);
}

export const PAYROLL_FIRM_MANAGED_COMPANY_BANNER =
  $localize`:@@core.payroll-access.ts.la.gestion.des.cycles.de.paie.du.calcul.6cf43fb7:La gestion des cycles de paie, du calcul, de la régularisation IRPP et des paramètres est assurée par votre cabinet comptable. Vous pouvez consulter les résultats et saisir les éléments variables.`;

export const PAYROLL_FIRM_CONSULT_BANNER =
  $localize`:@@core.payroll-access.ts.mode.consultation.la.gestion.des.dossier.370ed62d:Mode consultation — la gestion des dossiers salariés est réservée à la société cliente.`;
