/// <reference types="@angular/localize" />
/**
 * Logique pure extraite de `BankStatementReviewComponent`, partagée avec la nouvelle page
 * `features/accounting/bank-statement-entries/`. Aucune de ces fonctions n'a d'effet de bord ni
 * de dépendance d'injection : elles ne lisent que leurs paramètres.
 *
 * `BankStatementReviewComponent` continue d'exposer les mêmes méthodes publiques (même nom, même
 * signature) et se contente d'appeler ces fonctions : comportement identique, spec existante verte.
 */
import {
  BankLineProposal,
  BankStatementImportSession,
  GenerateItem,
  IssueSeverity,
  SETTLED_STATUSES,
  ThirdPartyKindName,
  expectedThirdPartyKind,
  requiresThirdParty,
  thirdPartyKindCode,
  thirdPartyKindName
} from './bank-statement-import.models';

export type PageState = 'done' | 'fallback' | 'failed' | 'current' | 'todo';

/** Forme minimale d'une ligne de revue éditable (compatible `ReviewRow` et le futur store). */
export interface ReviewRowLike {
  proposal: BankLineProposal;
  selected: boolean;
  account: string;
  thirdPartyId: string | null;
  thirdPartyKind: number;
  thirdPartyName: string;
  splitVat: boolean;
  remember: boolean;
}

// ── Lignes de proposition ────────────────────────────────────────────────────────────────────

export function toReviewRow(proposal: BankLineProposal): ReviewRowLike {
  return {
    proposal,
    selected: proposal.selectedByDefault,
    account: proposal.accountNumber ?? '',
    thirdPartyId: proposal.thirdPartyId,
    thirdPartyKind: thirdPartyKindCode(proposal.thirdPartyKind),
    thirdPartyName: proposal.thirdPartyName ?? '',
    splitVat: !!proposal.vatSplit && !proposal.vatSplit.implied,
    remember: false
  };
}

export function isSettledRow(row: ReviewRowLike): boolean {
  return SETTLED_STATUSES.includes(row.proposal.status);
}

export function needsThirdPartyRow(row: ReviewRowLike): boolean {
  return requiresThirdParty(row.account);
}

/**
 * Ligne prête à générer : compte connu et actif, et tiers du bon type si le compte l'exige.
 * `isAccountActive` reste du ressort de l'appelant (dépend du plan comptable chargé).
 */
export function isRowReady(row: ReviewRowLike, isAccountActive: (account: string) => boolean): boolean {
  const account = row.account?.trim();
  if (!account || !isAccountActive(account)) return false;
  if (!requiresThirdParty(account)) return true;
  return !!row.thirdPartyId && row.thirdPartyKind === expectedThirdPartyKind(account);
}

/** Transforme une ligne de revue en item de génération ; `label` reste `null` sauf saisie explicite. */
export function rowToGenerateItem(row: ReviewRowLike, label: string | null = null): GenerateItem {
  const requires = requiresThirdParty(row.account);
  return {
    lineId: row.proposal.lineId,
    accountNumber: row.account.trim(),
    thirdPartyId: requires ? row.thirdPartyId : null,
    thirdPartyKind: thirdPartyKindName(requires ? row.thirdPartyKind : 0) as ThirdPartyKindName,
    vatAmount: row.splitVat && row.proposal.vatSplit && row.proposal.isDebit ? row.proposal.vatSplit.vatAmount : null,
    vatAccountNumber: row.splitVat && row.proposal.vatSplit ? row.proposal.vatSplit.vatAccountNumber : null,
    label,
    rememberRule: row.remember
  };
}

// ── Session : solde, pages, méthode de lecture ──────────────────────────────────────────────

/**
 * Mode du contrôle de solde : `ok` (prouvé), `warning` (écart lu par l'IA, enregistrable avec
 * accusé — décidé par le serveur seul via `requiresBalanceAcknowledgement`), `blocking` sinon ;
 * `null` sans contrôle.
 */
export function computeBalanceMode(s: BankStatementImportSession | null): 'ok' | 'warning' | 'blocking' | null {
  const b = s?.balanceCheck;
  if (!s || !b) return null;
  if (b.isBalanced) return 'ok';
  return s.requiresBalanceAcknowledgement === true ? 'warning' : 'blocking';
}

export function hasIssue(s: BankStatementImportSession, code: string, severity?: IssueSeverity): boolean {
  return (s.extraction?.issues ?? []).some(i => i.code === code && (!severity || i.severity === severity));
}

export function viaDocStrange(s: BankStatementImportSession): boolean {
  return s.aiProviderKind === 'docstrange';
}

/** Nombre de pages à lire : celles du plan IA, sinon le nombre de pages du fichier. */
export function totalPages(s: BankStatementImportSession): number {
  const plan = s.extraction?.aiPlan;
  const planned = plan ? (plan.scannedPages?.length ?? 0) + (plan.textPages?.length ?? 0) : 0;
  return planned > 0 ? planned : Math.max(0, s.pageCount ?? 0);
}

/** Page en cours : la suivante des pages déjà lues, sinon déduite de l'avancement ; bornée au total. */
export function currentPage(s: BankStatementImportSession): number {
  const total = totalPages(s);
  if (total === 0) return 0;
  const readings = s.extraction?.aiPlan?.pageReadings;
  if (readings && readings.length > 0) return Math.min(total, readings.length + 1);
  const percent = Math.min(100, Math.max(0, s.progressPercent ?? 0));
  return Math.min(total, Math.floor((percent * total) / 100) + 1);
}

/** État de chaque page du plan, pour les pastilles de progression. */
export function pageStates(s: BankStatementImportSession): { page: number; state: PageState }[] {
  const total = totalPages(s);
  if (total === 0) return [];
  const plan = s.extraction?.aiPlan;
  const planned = [...(plan?.scannedPages ?? []), ...(plan?.textPages ?? [])].sort((a, b) => a - b);
  const pages = planned.length === total ? planned : Array.from({ length: total }, (_, i) => i + 1);
  const readings = new Map((plan?.pageReadings ?? []).map(r => [r.page, r]));
  const current = currentPage(s);
  let currentAssigned = false;
  return pages.map((page, position) => {
    const reading = readings.get(page);
    if (reading) {
      const state: PageState = reading.engine === 'text-model' ? 'fallback' : reading.engine === 'failed' ? 'failed' : 'done';
      return { page, state };
    }
    if (readings.size === 0) {
      if (position + 1 < current) return { page, state: 'done' as const };
      if (position + 1 === current) return { page, state: 'current' as const };
      return { page, state: 'todo' as const };
    }
    if (!currentAssigned) {
      currentAssigned = true;
      return { page, state: 'current' as const };
    }
    return { page, state: 'todo' as const };
  });
}

/** Pages relues par le modèle texte : lectures page par page si présentes, sinon `fallbackPages` du plan. */
export function fallbackPagesOf(s: BankStatementImportSession): number[] {
  const plan = s.extraction?.aiPlan;
  if (!plan) return [];
  const readings = plan.pageReadings ?? [];
  const pages = readings.length > 0 ? readings.filter(r => r.engine === 'text-model').map(r => r.page) : (plan.fallbackPages ?? []);
  return [...new Set(pages)].sort((a, b) => a - b);
}

/** Liste de numéros de pages triée, séparée par « , » (un seul placeholder dans le message traduit). */
export function pageList(pages: number[]): string {
  return [...pages].sort((a, b) => a - b).join(', ');
}

/** RIB masqué : « AA … ZZZZ » ; « — » sans RIB. */
export function maskRib(rib: string | null): string {
  return rib ? `${rib.slice(0, 2)} … ${rib.slice(-4)}` : '—';
}

/** Chiffres d'un RIB, en ignorant tout séparateur ; réutilisable pour comparer deux RIB (relance ciblée). */
export function normalizeRibDigits(rib: string | null | undefined): string {
  return (rib ?? '').replace(/\D/g, '');
}

export function ribTail(rib: string): string {
  const digits = normalizeRibDigits(rib);
  return digits.length >= 4 ? digits.slice(-4) : '????';
}

/** Date (ISO ou yyyy-MM-dd) affichée en dd/MM/yyyy pour les messages de confirmation (plan LOW). */
export function formatDateFr(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Libellé de la méthode de lecture d'une session (IA, lecture directe, service d'extraction…). */
export function methodLabel(s: BankStatementImportSession): string {
  if (hasIssue(s, 'statement.ai_unavailable', 'Blocking') || s.extractionMethod === 'none') {
    return $localize`:@@accounting.bank-statement-import.ts.lecture.ia.non.effectuee:Lecture IA non effectuée`;
  }
  // Le service d'extraction documentaire lit SEUL : aucune page n'est « lue en secours », et
  // aucune de ces lectures n'est le fait d'une IA — locale ou non. Les libellés qui suivent
  // parlent du service, sans jamais le nommer à l'utilisateur.
  if (viaDocStrange(s)) {
    switch (s.extractionMethod) {
      case 'ai-vision': {
        const count = s.pageCount ?? 0;
        if (count === 1) return $localize`:@@accounting.bank-statement-import.ts.lu.par.le.service.d.extraction.documentaire.1.pa.d281f138:Lu par le service d'extraction documentaire (1 page)`;
        if (count > 1) return $localize`:@@accounting.bank-statement-import.ts.lu.par.le.service.d.extraction.documentaire.page.d0085280:Lu par le service d'extraction documentaire (${String(count)}:count: pages)`;
        return $localize`:@@accounting.bank-statement-import.ts.lu.par.le.service.d.extraction.documentaire.27912217:Lu par le service d'extraction documentaire`;
      }
      case 'layout+ai':
        return $localize`:@@accounting.bank-statement-import.ts.lecture.directe.completee.par.le.service.d.extra.e232c028:Lecture directe complétée par le service d'extraction documentaire`;
      case 'ai':
      case 'ai-text':
        return $localize`:@@accounting.bank-statement-import.ts.lu.par.le.service.d.extraction.documentaire.27912217:Lu par le service d'extraction documentaire`;
      case 'layout':
        return $localize`:@@accounting.bank-statement-import.ts.lecture.directe.du.pdf.aucune.ia.ba300454:Lecture directe du PDF (aucune IA)`;
      default:
        return '—';
    }
  }

  switch (s.extractionMethod) {
    case 'ai-vision': {
      const fallback = fallbackPagesOf(s);
      if (fallback.length > 1) {
        const pages = pageList(fallback);
        return $localize`:@@accounting.bank-statement-import.ts.lu.par.l.ia.pages.lues.en.secours.9c5e1339:Lu par l'IA — pages ${pages}:pages: lues en secours`;
      }
      if (fallback.length === 1) {
        const page = String(fallback[0]);
        return $localize`:@@accounting.bank-statement-import.ts.lu.par.l.ia.page.lue.en.secours.6fa79a4c:Lu par l'IA — page ${page}:page: lue en secours`;
      }
      const count = s.pageCount ?? 0;
      if (count === 1) return $localize`:@@accounting.bank-statement-import.ts.lu.par.l.ia.1.page.0bb90ccc:Lu par l'IA (1 page)`;
      return $localize`:@@accounting.bank-statement-import.ts.lu.par.l.ia.pages.d44397d6:Lu par l'IA (${String(count)}:count: pages)`;
    }
    case 'ai-text':
      return $localize`:@@accounting.bank-statement-import.ts.lu.par.l.ia.sans.l.image.des.pages.21167785:Lu par l'IA, sans l'image des pages`;
    case 'layout':
      return $localize`:@@accounting.bank-statement-import.ts.lecture.directe.du.pdf.aucune.ia.ba300454:Lecture directe du PDF (aucune IA)`;
    case 'layout+ai':
      if (s.extraction?.aiPlan?.textPages?.length) {
        return s.aiProviderKind === 'external'
          ? $localize`:@@accounting.bank-statement-import.ts.lecture.directe.completee.par.une.ia.externe.b4615235:Lecture directe complétée par une IA externe`
          : $localize`:@@accounting.bank-statement-import.ts.lecture.directe.completee.par.l.ia.locale.bdf8d38c:Lecture directe complétée par l'IA locale`;
      }
      return s.aiProviderKind === 'external'
        ? $localize`:@@accounting.bank-statement-import.ts.lecture.directe.pages.scannees.lues.par.une.ia.e.1e33d5e5:Lecture directe + pages scannées lues par une IA externe`
        : $localize`:@@accounting.bank-statement-import.ts.lecture.directe.pages.scannees.lues.par.l.ia.loc.9d423ab4:Lecture directe + pages scannées lues par l'IA locale`;
    case 'ai':
      return s.aiProviderKind === 'external'
        ? $localize`:@@accounting.bank-statement-import.ts.lu.par.une.ia.externe.ba81ec2a:Lu par une IA externe`
        : $localize`:@@accounting.bank-statement-import.ts.lu.par.l.ia.locale.04535067:Lu par l'IA locale`;
    default:
      return '—';
  }
}
