import { StatusBadgeStatus } from '@shared/components/status-badge/status-badge.component';

/**
 * Statuts d'une liaison société ↔ cabinet (miroir de l'enum backend
 * FirmAssignmentStatus).
 *
 * Contrat JSON : `Program.cs` sérialise les enums en **PascalCase** via
 * `JsonStringEnumConverter()` (ex. `"Active"`, `"PendingFirmApproval"`).
 * Le parseur accepte aussi les entiers 0–5 (tests / compat).
 *
 * Le front n'affiche PAS le `statusDisplay` API : il mappe le code vers un
 * libellé FR + style StatusBadgeComponent.
 */
export enum FirmAssignmentStatusCode {
  PendingFirmApproval = 0,
  Active = 1,
  Rejected = 2,
  RevokedByCompany = 3,
  RevokedByFirm = 4,
  CancelledByCompany = 5
}

export interface FirmAssignmentStatusView {
  label: string;
  badge: StatusBadgeStatus;
}

const STATUS_VIEWS: Record<FirmAssignmentStatusCode, FirmAssignmentStatusView> = {
  [FirmAssignmentStatusCode.PendingFirmApproval]: { label: $localize`:@@settings.firm-assignment-status.ts.en.attente.d.acceptation.c5f916db:En attente d'acceptation`, badge: 'pending' },
  [FirmAssignmentStatusCode.Active]: { label: $localize`:@@settings.firm-assignment-status.ts.liaison.active.eaeb1b89:Liaison active`, badge: 'active' },
  [FirmAssignmentStatusCode.Rejected]: { label: $localize`:@@settings.firm-assignment-status.ts.refusee.ce45da5d:Refusée`, badge: 'rejected' },
  [FirmAssignmentStatusCode.RevokedByCompany]: { label: $localize`:@@settings.firm-assignment-status.ts.revoquee.par.la.societe.70d9fc0d:Révoquée par la société`, badge: 'inactive' },
  [FirmAssignmentStatusCode.RevokedByFirm]: { label: $localize`:@@settings.firm-assignment-status.ts.resiliee.par.le.cabinet.a454623a:Résiliée par le cabinet`, badge: 'inactive' },
  [FirmAssignmentStatusCode.CancelledByCompany]: { label: $localize`:@@settings.firm-assignment-status.ts.annulee.2776573b:Annulée`, badge: 'cancelled' }
};

const PASCAL_TO_CODE: Record<string, FirmAssignmentStatusCode> = {
  PendingFirmApproval: FirmAssignmentStatusCode.PendingFirmApproval,
  Active: FirmAssignmentStatusCode.Active,
  Rejected: FirmAssignmentStatusCode.Rejected,
  RevokedByCompany: FirmAssignmentStatusCode.RevokedByCompany,
  RevokedByFirm: FirmAssignmentStatusCode.RevokedByFirm,
  CancelledByCompany: FirmAssignmentStatusCode.CancelledByCompany
};

const FALLBACK_VIEW: FirmAssignmentStatusView = { label: $localize`:@@settings.firm-assignment-status.ts.inconnu.f3cfc645:Inconnu`, badge: 'inactive' };

/**
 * Interprète `status` renvoyé par l'API (PascalCase, entier 0–5, ou string numérique).
 */
export function parseFirmAssignmentStatus(raw: unknown): FirmAssignmentStatusCode | null {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 5) {
    return raw as FirmAssignmentStatusCode;
  }

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;

    const fromPascal = PASCAL_TO_CODE[trimmed];
    if (fromPascal !== undefined) return fromPascal;

    if (/^[0-5]$/.test(trimmed)) {
      return Number(trimmed) as FirmAssignmentStatusCode;
    }
  }

  return null;
}

export function firmAssignmentStatusView(raw: unknown): FirmAssignmentStatusView {
  const code = parseFirmAssignmentStatus(raw);
  return code === null ? FALLBACK_VIEW : STATUS_VIEWS[code];
}

/** Une liaison est « ouverte » (bloque une nouvelle demande) si elle est en attente ou active. */
export function isOpenAssignment(raw: unknown): boolean {
  const code = parseFirmAssignmentStatus(raw);
  return (
    code === FirmAssignmentStatusCode.PendingFirmApproval ||
    code === FirmAssignmentStatusCode.Active
  );
}

export function isActiveAssignment(raw: unknown): boolean {
  return parseFirmAssignmentStatus(raw) === FirmAssignmentStatusCode.Active;
}

export function isPendingAssignment(raw: unknown): boolean {
  return parseFirmAssignmentStatus(raw) === FirmAssignmentStatusCode.PendingFirmApproval;
}

export function isRejectedAssignment(raw: unknown): boolean {
  return parseFirmAssignmentStatus(raw) === FirmAssignmentStatusCode.Rejected;
}
