import {
  MonthlyDeclarationDiagnosticDto,
  MonthlyDeclarationFamily,
  MonthlyDeclarationLineDto,
  RubricDiagnosticKind,
  VatDeclarationDto
} from '../services/accounting.service';
import { familyLabel } from './monthly-declaration-config.view-model';
import { round3, shiftPeriod } from '../vat-declaration/vat-declaration.view-model';

/**
 * Logique d'affichage de l'écran « Calcul DM ». Fonctions pures : le conteneur ne garde que les
 * signaux et les appels réseau, et tout ce qui se raisonne se teste sans TestBed.
 */

// ── Période ──────────────────────────────────────────────────────────────────

export interface DmComputePeriod {
  year: number;
  month: number;
}

/**
 * Période proposée à l'ouverture : le mois **écoulé**. La déclaration d'un mois se dépose le mois
 * suivant ; ouvrir sur le mois courant poserait d'emblée l'écran sur une période incomplète, et le
 * premier réflexe serait de reculer d'un cran.
 */
export function defaultComputePeriod(today: Date): DmComputePeriod {
  return shiftPeriod(today.getFullYear(), today.getMonth() + 1, -1);
}

/** Bornes acceptées par le serveur, reprises ici pour refuser la saisie avant l'aller-retour. */
export function isComputablePeriod(period: DmComputePeriod): boolean {
  return (
    Number.isInteger(period.year) &&
    period.year >= 2000 &&
    period.year <= 2100 &&
    Number.isInteger(period.month) &&
    period.month >= 1 &&
    period.month <= 12
  );
}

// ── Signalements ─────────────────────────────────────────────────────────────

/**
 * Deux niveaux seulement. « Erreur » = le montant produit est faux ou manquant tant que la
 * configuration n'est pas corrigée ; « avertissement » = le montant est juste, mais son sort mérite
 * d'être dit. Un troisième niveau n'aiderait personne à décider quoi faire.
 */
export type DmDiagnosticSeverity = 'error' | 'warning';

export function diagnosticSeverity(kind: RubricDiagnosticKind): DmDiagnosticSeverity {
  switch (kind) {
    case RubricDiagnosticKind.UnknownAccount:
    case RubricDiagnosticKind.RateRequired:
    case RubricDiagnosticKind.UnsupportedCombination:
    case RubricDiagnosticKind.MissingRubricForFamily:
    case RubricDiagnosticKind.DuplicateSourceRead:
    case RubricDiagnosticKind.ConfigurationNotInitialized:
      return 'error';
    default:
      return 'warning';
  }
}

/**
 * Le serveur envoie le nom technique de la famille (« Tfp ») dans le détail d'un signalement.
 * L'écran le retraduit plutôt que de l'afficher tel quel : personne ne déclare une « Tfp ».
 */
function familyFromServerName(name: string): MonthlyDeclarationFamily | null {
  const value = (MonthlyDeclarationFamily as unknown as Record<string, unknown>)[name];
  return typeof value === 'number' ? (value as MonthlyDeclarationFamily) : null;
}

export function describeDiagnostic(d: MonthlyDeclarationDiagnosticDto): string {
  const detail = (d.detail ?? '').trim();
  switch (d.kind) {
    case RubricDiagnosticKind.UnknownAccount:
      return detail
        ? $localize`:@@accounting.monthly-declaration-compute.view-model.ts.le.compte.detail.ne.figure.pas.au.plan.c.4b17702f:Le compte ${detail}:detail: ne figure pas au plan comptable du dossier : il ne remonte aucun mouvement.`
        : $localize`:@@accounting.monthly-declaration-compute.view-model.ts.un.compte.cite.par.la.configuration.ne.f.0bc83ddf:Un compte cité par la configuration ne figure pas au plan comptable du dossier.`;
    case RubricDiagnosticKind.RateRequired:
      return detail
        ? $localize`:@@accounting.monthly-declaration-compute.view-model.ts.la.rubrique.detail.calcule.sur.un.taux.r.e3e4069c:La rubrique ${detail}:detail: calcule sur un taux resté à zéro : elle produit zéro.`
        : $localize`:@@accounting.monthly-declaration-compute.view-model.ts.une.rubrique.calcule.sur.un.taux.reste.a.baafc131:Une rubrique calcule sur un taux resté à zéro : elle produit zéro.`;
    case RubricDiagnosticKind.PayrollRunNotUsable:
      return $localize`:@@accounting.monthly-declaration-compute.view-model.ts.le.cycle.de.paie.du.mois.n.est.ni.valide.1ca57f17:Le cycle de paie du mois n'est ni validé ni clôturé : les rubriques assises sur la paie sont ignorées.`;
    case RubricDiagnosticKind.UnsupportedCombination:
      return detail
        ? $localize`:@@accounting.monthly-declaration-compute.view-model.ts.combinaison.de.calcul.non.prise.en.charg.946a4d89:Combinaison de calcul non prise en charge : ${detail}:detail:.`
        : $localize`:@@accounting.monthly-declaration-compute.view-model.ts.combinaison.de.calcul.non.prise.en.charg.1ee7f506:Combinaison de calcul non prise en charge.`;
    case RubricDiagnosticKind.UnmappedReportCode:
      return detail
        ? $localize`:@@accounting.monthly-declaration-compute.view-model.ts.le.code.rapport.detail.ne.correspond.a.a.f4e49f72:Le code rapport ${detail}:detail: ne correspond à aucune case du formulaire officiel : le montant est calculé, mais il ne sera pas imprimé.`
        : $localize`:@@accounting.monthly-declaration-compute.view-model.ts.un.code.rapport.ne.correspond.a.aucune.c.94fead74:Un code rapport ne correspond à aucune case du formulaire officiel : le montant est calculé, mais il ne sera pas imprimé.`;
    case RubricDiagnosticKind.SuppressedFromForm:
      return detail
        ? $localize`:@@accounting.monthly-declaration-compute.view-model.ts.ligne.ecartee.du.formulaire.par.le.contr.4c600990:Ligne écartée du formulaire par le contrôle de total de famille (${detail}:detail:).`
        : $localize`:@@accounting.monthly-declaration-compute.view-model.ts.une.ligne.a.ete.ecartee.du.formulaire.pa.793e3e04:Une ligne a été écartée du formulaire par le contrôle de total de famille.`;
    case RubricDiagnosticKind.DuplicateSourceRead:
      return detail || $localize`:@@accounting.monthly-declaration-compute.view-model.ts.deux.rubriques.reprennent.la.meme.source.0098936d:Deux rubriques reprennent la même source : le montant serait déclaré deux fois.`;
    case RubricDiagnosticKind.ConfigurationNotInitialized:
      return $localize`:@@accounting.monthly-declaration-compute.view-model.ts.configuration.pas.encore.initialisee.7d2e94c1:La configuration de ce dossier n'est pas encore initialisée : la déclaration ne peut pas être enregistrée. Rouvrez le dossier dans un instant ; si le message persiste, contactez l'administrateur de la plateforme.`;
    case RubricDiagnosticKind.ExcludedFamilyWithAmount: {
      const excluded = detail ? familyFromServerName(detail) : null;
      const excludedName = excluded === null ? detail : familyLabel(excluded);
      return excludedName
        ? $localize`:@@accounting.monthly-declaration-compute.view-model.ts.la.famille.excludedname.n.est.pas.declaree.3f8a1d52:La famille « ${excludedName}:excludedName: » n'est pas déclarée par ce dossier : son montant vaut 0, alors que ses rubriques en auraient produit un.`
        : $localize`:@@accounting.monthly-declaration-compute.view-model.ts.une.famille.non.declaree.aurait.produit.8c4b7e03:Une famille que ce dossier ne déclare pas aurait produit un montant : il vaut 0.`;
    }
    case RubricDiagnosticKind.MissingRubricForFamily: {
      const family = detail ? familyFromServerName(detail) : null;
      const name = family === null ? detail : familyLabel(family);
      return name
        ? $localize`:@@accounting.monthly-declaration-compute.view-model.ts.la.famille.name.est.incluse.dans.la.decl.be171673:La famille « ${name}:name: » est incluse dans la déclaration, mais aucune de ses rubriques ne s'applique à la période.`
        : $localize`:@@accounting.monthly-declaration-compute.view-model.ts.une.famille.incluse.ne.porte.aucune.rubr.96ccde7f:Une famille incluse ne porte aucune rubrique applicable à la période.`;
    }
    default:
      return detail || $localize`:@@accounting.monthly-declaration-compute.view-model.ts.signalement.non.reconnu.par.cette.versio.11c46f7a:Signalement non reconnu par cette version de l'écran.`;
  }
}

/**
 * Signalements dédoublonnés. Le moteur répète le même compte inconnu sur chaque rubrique qui le
 * cite ; répéter la phrase autant de fois noierait les autres.
 */
export function distinctDiagnostics(
  diagnostics: readonly MonthlyDeclarationDiagnosticDto[] | null | undefined
): MonthlyDeclarationDiagnosticDto[] {
  const seen = new Set<string>();
  const out: MonthlyDeclarationDiagnosticDto[] = [];
  for (const d of diagnostics ?? []) {
    const key = `${d.kind}|${(d.detail ?? '').trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}

export function countBySeverity(
  diagnostics: readonly MonthlyDeclarationDiagnosticDto[] | null | undefined,
  severity: DmDiagnosticSeverity
): number {
  return distinctDiagnostics(diagnostics).filter(d => diagnosticSeverity(d.kind) === severity).length;
}

// ── Détail par famille ───────────────────────────────────────────────────────

export interface DmComputeFamilyGroup {
  family: MonthlyDeclarationFamily;
  label: string;
  lines: MonthlyDeclarationLineDto[];
  grossTotal: number;
  withheldTotal: number;
  /** Au moins une ligne attend une saisie manuelle : le total affiché est incomplet. */
  hasManualInput: boolean;
  errorCount: number;
  warningCount: number;
}

/** Regroupe les lignes par famille, dans l'ordre d'apparition renvoyé par le serveur. */
export function groupLinesByFamily(
  lines: readonly MonthlyDeclarationLineDto[] | null | undefined
): DmComputeFamilyGroup[] {
  const groups = new Map<MonthlyDeclarationFamily, DmComputeFamilyGroup>();
  for (const line of lines ?? []) {
    let group = groups.get(line.family);
    if (!group) {
      group = {
        family: line.family,
        label: familyLabel(line.family),
        lines: [],
        grossTotal: 0,
        withheldTotal: 0,
        hasManualInput: false,
        errorCount: 0,
        warningCount: 0
      };
      groups.set(line.family, group);
    }
    group.lines.push(line);
    group.grossTotal = round3(group.grossTotal + line.gross);
    group.withheldTotal = round3(group.withheldTotal + line.withheld);
    group.hasManualInput = group.hasManualInput || line.requiresManualInput;
    group.errorCount += countBySeverity(line.diagnostics, 'error');
    group.warningCount += countBySeverity(line.diagnostics, 'warning');
  }
  return [...groups.values()];
}

// ── Rapprochement détail / déclaration ───────────────────────────────────────

/**
 * Case de la déclaration alimentée par une famille. Reprend exactement la table de remontée du
 * serveur (`GetVatDeclarationQuery.ApplyRollUp`) ; `null` = famille qui n'alimente aucun scalaire.
 */
export function familyDeclaredAmount(
  d: VatDeclarationDto,
  family: MonthlyDeclarationFamily
): number | null {
  switch (family) {
    case MonthlyDeclarationFamily.Withholding:
      return d.withholdingTax ?? 0;
    case MonthlyDeclarationFamily.Tfp:
      return d.tfp ?? 0;
    case MonthlyDeclarationFamily.Foprolos:
      return d.foprolos ?? 0;
    case MonthlyDeclarationFamily.ConsumptionDuty:
      return d.consumptionDuty ?? 0;
    case MonthlyDeclarationFamily.OtherTurnoverTaxes:
      return d.fodec ?? 0;
    case MonthlyDeclarationFamily.StampDuty:
      return d.droitTimbre ?? 0;
    case MonthlyDeclarationFamily.HotelTax:
      return d.hotelTax ?? 0;
    case MonthlyDeclarationFamily.Tcl:
      return d.tcl ?? 0;
    case MonthlyDeclarationFamily.LicenceFee:
      return d.licenceFee ?? 0;
    // La T.V.A vient du module T.V.A, et « Autres renseignements » ne porte aucun impôt.
    default:
      return null;
  }
}

export interface DmReconciliationRow {
  family: MonthlyDeclarationFamily;
  label: string;
  /** Somme de la colonne « Retenue » des rubriques de la famille. */
  detailTotal: number;
  /** Montant porté par la déclaration pour cette famille, ou `null` si elle n'en alimente aucune. */
  declaredAmount: number | null;
  /** `detailTotal − declaredAmount`, en millimes. `null` quand la comparaison n'a pas de sens. */
  gapMillimes: number | null;
}

/**
 * Ce qu'une famille affiche à l'écran : son détail, la case qu'elle alimente, et la phrase qui dit
 * ce que l'écart entre les deux signifie. Le composant n'a plus qu'à rendre.
 */
export interface DmComputeFamilyView extends DmComputeFamilyGroup {
  declaredAmount: number | null;
  gapMillimes: number | null;
  gapText: string;
}

export function buildFamilyViews(d: VatDeclarationDto): DmComputeFamilyView[] {
  return groupLinesByFamily(d.lines).map(group => {
    const declaredAmount = familyDeclaredAmount(d, group.family);
    const row: DmReconciliationRow = {
      family: group.family,
      label: group.label,
      detailTotal: group.withheldTotal,
      declaredAmount,
      gapMillimes:
        declaredAmount === null ? null : Math.round((group.withheldTotal - declaredAmount) * 1000)
    };
    return {
      ...group,
      declaredAmount: row.declaredAmount,
      gapMillimes: row.gapMillimes,
      gapText: describeReconciliationGap(row)
    };
  });
}

export function buildReconciliation(d: VatDeclarationDto): DmReconciliationRow[] {
  return buildFamilyViews(d).map(v => ({
    family: v.family,
    label: v.label,
    detailTotal: v.withheldTotal,
    declaredAmount: v.declaredAmount,
    gapMillimes: v.gapMillimes
  }));
}

/** Millimes rendus en dinars, avec leur signe : c'est l'unité dans laquelle l'écart est mesuré. */
export function formatMillimes(millimes: number): string {
  const sign = millimes < 0 ? '−' : '';
  const abs = Math.abs(millimes);
  const dinars = Math.floor(abs / 1000);
  const rest = String(abs % 1000).padStart(3, '0');
  return `${sign}${dinars},${rest} DT`;
}

/**
 * Ce que l'écart d'une ligne de rapprochement veut dire. Le détail et la case déclarée sont le même
 * calcul : toute différence est une anomalie, et doit se dire comme telle.
 */
export function describeReconciliationGap(row: DmReconciliationRow): string {
  if (row.declaredAmount === null)
    return $localize`:@@accounting.monthly-declaration-compute.view-model.ts.cette.famille.n.alimente.aucune.case.chi.36184511:Cette famille n'alimente aucune case chiffrée de la déclaration.`;
  if (row.gapMillimes === 0) return $localize`:@@accounting.monthly-declaration-compute.view-model.ts.identique.au.montant.de.la.declaration.3a6bb283:Identique au montant de la déclaration.`;
  const gap = formatMillimes(row.gapMillimes ?? 0);
  return $localize`:@@accounting.monthly-declaration-compute.view-model.ts.ecart.de.gap.avec.la.case.declaree.alors.d16d1930:Écart de ${gap}:gap: avec la case déclarée, alors que les deux devraient être le même calcul.`;
}

// ── Verdict du calcul ────────────────────────────────────────────────────────

/** Phrase d'en-tête : d'où viennent les montants affichés, et ce qu'il faut en conclure. */
export function describeComputeOutcome(d: VatDeclarationDto): string {
  if (
    (d.monthlyDeclarationDiagnostics ?? []).some(
      x => x.kind === RubricDiagnosticKind.ConfigurationNotInitialized
    )
  ) {
    return $localize`:@@accounting.monthly-declaration-compute.view-model.ts.configuration.non.initialisee.les.montants.4b1c7a20:La configuration de ce dossier n'est pas encore initialisée : les montants ci-dessous ne font pas foi et la déclaration ne peut pas être enregistrée.`;
  }

  return $localize`:@@accounting.monthly-declaration-compute.view-model.ts.les.montants.ci.dessous.sont.ceux.que.la.f8290d4d:Les montants ci-dessous sont ceux que la configuration du dossier produit, et ce sont eux qui seront déclarés.`;
}
