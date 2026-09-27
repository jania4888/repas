import {
  MonthlyDeclarationDiagnosticDto,
  MonthlyDeclarationFamily,
  MonthlyDeclarationLineDto,
  MonthlyDeclarationMode,
  MonthlyDeclarationSettingsDto,
  RubricDiagnosticKind,
  SetMonthlyDeclarationModeRequest,
  VatDeclarationDto
} from '../services/accounting.service';
import { familyLabel, modeLabel } from './monthly-declaration-config.view-model';
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
    // La T.V.A reste au calcul historique, et « Autres renseignements » ne porte aucun impôt.
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
 * ce que l'écart entre les deux signifie dans le régime courant. Le composant n'a plus qu'à rendre.
 */
export interface DmComputeFamilyView extends DmComputeFamilyGroup {
  declaredAmount: number | null;
  gapMillimes: number | null;
  gapText: string;
}

export function buildFamilyViews(d: VatDeclarationDto): DmComputeFamilyView[] {
  const mode = d.monthlyDeclarationMode ?? MonthlyDeclarationMode.Legacy;
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
      gapText: describeReconciliationGap(row, mode)
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
 * Ce que l'écart d'une ligne de rapprochement veut dire — et cela dépend entièrement du régime.
 * En contrôle de parité, l'écart **est** l'objet de la mesure ; en mode paramétré, le détail et la
 * case déclarée sont le même calcul, et toute différence est une anomalie à dire comme telle.
 */
export function describeReconciliationGap(
  row: DmReconciliationRow,
  mode: MonthlyDeclarationMode
): string {
  if (row.declaredAmount === null)
    return $localize`:@@accounting.monthly-declaration-compute.view-model.ts.cette.famille.n.alimente.aucune.case.chi.36184511:Cette famille n'alimente aucune case chiffrée de la déclaration.`;
  if (row.gapMillimes === 0) return $localize`:@@accounting.monthly-declaration-compute.view-model.ts.identique.au.montant.de.la.declaration.3a6bb283:Identique au montant de la déclaration.`;
  const gap = formatMillimes(row.gapMillimes ?? 0);
  if (mode === MonthlyDeclarationMode.Parity)
    return $localize`:@@accounting.monthly-declaration-compute.view-model.ts.ecart.de.gap.avec.le.calcul.historique.q.d05499f7:Écart de ${gap}:gap: avec le calcul historique, qui reste le montant déclaré.`;
  if (mode === MonthlyDeclarationMode.Configured)
    return $localize`:@@accounting.monthly-declaration-compute.view-model.ts.ecart.de.gap.avec.la.case.declaree.alors.d16d1930:Écart de ${gap}:gap: avec la case déclarée, alors que les deux devraient être le même calcul.`;
  return $localize`:@@accounting.monthly-declaration-compute.view-model.ts.ecart.de.gap.avec.la.case.declaree.2efc40f5:Écart de ${gap}:gap: avec la case déclarée.`;
}

// ── Verdict du calcul ────────────────────────────────────────────────────────

/** Phrase d'en-tête : d'où viennent les montants affichés, et ce qu'il faut en conclure. */
export function describeComputeOutcome(d: VatDeclarationDto): string {
  const mode = d.monthlyDeclarationMode ?? MonthlyDeclarationMode.Legacy;
  switch (mode) {
    case MonthlyDeclarationMode.Legacy:
      return $localize`:@@accounting.monthly-declaration-compute.view-model.ts.cette.periode.est.calculee.a.l.ancienne.b4d8792d:Cette période est calculée à l'ancienne : la configuration du dossier n'a déplacé aucun montant.`;
    case MonthlyDeclarationMode.Parity:
      return (d.parityMaxGapMillimes ?? 0) === 0
        ? $localize`:@@accounting.monthly-declaration-compute.view-model.ts.controle.de.parite.sans.ecart.la.configu.a30e50b3:Contrôle de parité sans écart : la configuration reproduit exactement le calcul historique sur cette période.`
        : $localize`:@@accounting.monthly-declaration-compute.view-model.ts.controle.de.parite.ecart.maximal.de.form.2b0e4869:Contrôle de parité : écart maximal de ${formatMillimes(d.parityMaxGapMillimes ?? 0)}:formatMillimes: entre les deux calculs. Les montants déclarés restent ceux du calcul historique.`;
    case MonthlyDeclarationMode.Configured:
      return $localize`:@@accounting.monthly-declaration-compute.view-model.ts.les.montants.ci.dessous.sont.ceux.que.la.f8290d4d:Les montants ci-dessous sont ceux que la configuration du dossier produit, et ce sont eux qui seront déclarés.`;
    default:
      return '';
  }
}

/** Un contrôle de parité sans écart allonge la série ; c'est la seule chose qui la fait avancer. */
export function isCleanParityRun(d: VatDeclarationDto): boolean {
  return (
    (d.monthlyDeclarationMode ?? MonthlyDeclarationMode.Legacy) === MonthlyDeclarationMode.Parity &&
    (d.parityMaxGapMillimes ?? 0) === 0
  );
}

// ── Changement de régime ─────────────────────────────────────────────────────

export interface DmModeForm {
  mode: MonthlyDeclarationMode;
  /** Premier jour du mois d'effet, au format `yyyy-MM-dd` attendu par le champ date. */
  configuredSince: string | null;
  overrideReason: string | null;
}

/** Longueur maximale du motif de dérogation, alignée sur `MonthlyDeclarationSettings`. */
export const DM_MAX_OVERRIDE_REASON_LENGTH = 500;

export const DM_MODE_OPTIONS: readonly { label: string; value: MonthlyDeclarationMode }[] = [
  { label: modeLabel(MonthlyDeclarationMode.Legacy), value: MonthlyDeclarationMode.Legacy },
  { label: modeLabel(MonthlyDeclarationMode.Parity), value: MonthlyDeclarationMode.Parity },
  { label: modeLabel(MonthlyDeclarationMode.Configured), value: MonthlyDeclarationMode.Configured }
];

/** Premier jour du mois suivant : date d'effet par défaut d'une bascule. */
export function firstDayOfNextMonth(today: Date): string {
  const next = shiftPeriod(today.getFullYear(), today.getMonth() + 1, 1);
  return `${next.year}-${String(next.month).padStart(2, '0')}-01`;
}

export function newModeForm(settings: MonthlyDeclarationSettingsDto, today: Date): DmModeForm {
  return {
    mode: settings.mode,
    configuredSince: settings.configuredSince
      ? settings.configuredSince.slice(0, 10)
      : firstDayOfNextMonth(today),
    overrideReason: settings.parityOverrideReason ?? null
  };
}

/** La dérogation n'est exigée que pour passer en paramétré sans la série de contrôles requise. */
export function needsOverrideReason(
  form: DmModeForm,
  settings: MonthlyDeclarationSettingsDto
): boolean {
  return form.mode === MonthlyDeclarationMode.Configured && !settings.canSwitchToConfigured;
}

/**
 * Reprend les règles de `MonthlyDeclarationSettings` pour épargner un aller-retour sur une erreur
 * évidente. Confort de saisie seulement : le serveur revalide tout et reste seul juge.
 */
export function validateModeForm(
  form: DmModeForm,
  settings: MonthlyDeclarationSettingsDto
): string | null {
  if (form.mode === settings.mode && form.mode !== MonthlyDeclarationMode.Configured)
    return $localize`:@@accounting.monthly-declaration-compute.view-model.ts.le.dossier.est.deja.dans.ce.regime.86e13a75:Le dossier est déjà dans ce régime.`;

  if (form.mode !== MonthlyDeclarationMode.Configured) return null;

  if (settings.mode === MonthlyDeclarationMode.Legacy) {
    return (
      $localize`:@@accounting.monthly-declaration-compute.view-model.ts.passez.d.abord.le.dossier.en.controle.de.482faec7:Passez d'abord le dossier en contrôle de parité : la bascule directe ne permet aucune comparaison avec le calcul en place.`
    );
  }

  const since = (form.configuredSince ?? '').trim();
  if (!since) return $localize`:@@accounting.monthly-declaration-compute.view-model.ts.la.date.d.effet.est.requise.pour.passer.2764b6a8:La date d'effet est requise pour passer en calcul paramétré.`;
  if (!/^\d{4}-\d{2}-01$/.test(since)) return $localize`:@@accounting.monthly-declaration-compute.view-model.ts.la.date.d.effet.doit.etre.le.premier.jou.db8ff117:La date d'effet doit être le premier jour d'un mois.`;

  if (needsOverrideReason(form, settings)) {
    const reason = (form.overrideReason ?? '').trim();
    if (!reason) {
      return (
        $localize`:@@accounting.monthly-declaration-compute.view-model.ts.requiredcleanparityperiods.periodes.cons.38919651:${settings.requiredCleanParityPeriods}:requiredCleanParityPeriods: périodes consécutives sans écart sont requises (série actuelle : ${settings.parityCleanStreak}:parityCleanStreak:). À défaut, un motif de dérogation est exigé.`
      );
    }
    if (reason.length > DM_MAX_OVERRIDE_REASON_LENGTH)
      return $localize`:@@accounting.monthly-declaration-compute.view-model.ts.le.motif.ne.peut.pas.depasser.dm.max.ove.23459365:Le motif ne peut pas dépasser ${DM_MAX_OVERRIDE_REASON_LENGTH}:DM_MAX_OVERRIDE_REASON_LENGTH: caractères.`;
  }

  return null;
}

export function toModeRequest(form: DmModeForm): SetMonthlyDeclarationModeRequest {
  const configured = form.mode === MonthlyDeclarationMode.Configured;
  const reason = (form.overrideReason ?? '').trim();
  return {
    mode: form.mode,
    configuredSince: configured ? (form.configuredSince ?? '').trim() || null : null,
    overrideReason: configured && reason ? reason : null
  };
}

/** État de la rampe, en une phrase : ce qu'il reste à faire avant de pouvoir basculer. */
export function describeRamp(settings: MonthlyDeclarationSettingsDto): string {
  if (settings.mode === MonthlyDeclarationMode.Configured)
    return $localize`:@@accounting.monthly-declaration-compute.view-model.ts.le.dossier.est.en.calcul.parametre.la.ra.06099595:Le dossier est en calcul paramétré ; la rampe est derrière lui.`;
  if (settings.mode === MonthlyDeclarationMode.Legacy)
    return $localize`:@@accounting.monthly-declaration-compute.view-model.ts.le.controle.de.parite.n.a.pas.commence.a.b2828062:Le contrôle de parité n'a pas commencé : aucune comparaison n'a encore été enregistrée.`;
  if (settings.canSwitchToConfigured)
    return $localize`:@@accounting.monthly-declaration-compute.view-model.ts.serie.atteinte.paritycleanstreak.periode.7c17ba43:Série atteinte : ${settings.parityCleanStreak}:parityCleanStreak: périodes consécutives sans écart. La bascule est ouverte.`;
  const missing = settings.requiredCleanParityPeriods - settings.parityCleanStreak;
  return (
    $localize`:@@accounting.monthly-declaration-compute.view-model.ts.serie.en.cours.paritycleanstreak.sur.req.9ce7f0e5:Série en cours : ${settings.parityCleanStreak}:parityCleanStreak: sur ${settings.requiredCleanParityPeriods}:requiredCleanParityPeriods: périodes consécutives sans écart. Encore ${missing}:missing: période(s), ou une dérogation motivée.`
  );
}
