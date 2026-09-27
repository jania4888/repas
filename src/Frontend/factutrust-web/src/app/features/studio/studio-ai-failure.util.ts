/**
 * Lecture « métier » d'un échec de l'Assistant Studio.
 *
 * Pourquoi ce module existe : jusqu'ici toute panne — spécification incomplète, droit manquant,
 * fournisseur IA arrêté, délai SQL dépassé — se présentait sous le même titre « L'état n'a pas pu
 * être calculé », avec le message serveur brut (« Indiquez soit `preset`, soit `source` ») et un
 * bouton « Réessayer » générique. L'utilisateur ne savait ni ce qui s'était passé, ni quoi faire.
 *
 * Ce module classe l'échec à partir de ce que le protocole ACTUEL fournit déjà (statut HTTP avant
 * le flux, phase `provider_availability` échouée, carte `studio_report_error`, texte du message) et
 * accepte, de façon additive, les champs `code` / `stage` / `retryable` que le backend pourra
 * émettre plus tard : un code explicite prime toujours sur l'heuristique textuelle.
 *
 * Fonctions pures, sans dépendance Angular : testables unitairement.
 */

export type StudioFailureKind =
  /** La demande est comprise partiellement : il manque le sujet, la ventilation ou la source. */
  | 'clarification'
  /** Droits insuffisants : réessayer ou reformuler ne change rien. */
  | 'forbidden'
  /** Fournisseur / moteur IA indisponible ou mal configuré : aucun état n'a été calculé. */
  | 'provider'
  /** Le moteur de calcul a dépassé le délai imparti. */
  | 'timeout'
  /** Fonction désactivée côté serveur. */
  | 'disabled'
  /** Session expirée : reconnexion nécessaire. */
  | 'session'
  /** Erreur de calcul, serveur, réseau ou protocole. */
  | 'server';

/** Ce que la carte d'échec affiche : jamais de preset, de source, de SQL ni de nom d'outil. */
export interface StudioFailureView {
  kind: StudioFailureKind;
  /** Catégorie stable pour le diagnostic (non sensible). */
  code: string;
  /** Sur-titre court : « Précision nécessaire », « Accès non autorisé »… */
  eyebrow: string;
  title: string;
  /** Message utilisateur expurgé. */
  message: string;
  /** Prochaine étape concrète. */
  hint: string;
  /** Étape interrompue, en langage utilisateur. */
  stage: string;
  /** Une relance manuelle a-t-elle un sens ? Jamais pour une validation, un 403 ou une session expirée. */
  retryable: boolean;
  /** Les états prêts à l'emploi proposés par le serveur ont-ils un sens dans ce contexte ? */
  showSuggestions: boolean;
  /** Détail technique NON sensible (message serveur expurgé) montré uniquement dans le diagnostic. */
  detail?: string;
}

export interface StudioFailureContext {
  /** Message brut : carte `studio_report_error`, événement SSE `error` ou erreur HTTP. */
  message?: string | null;
  /** Code métier additif éventuellement fourni par le backend. */
  code?: string | null;
  /** Étape additive éventuellement fournie par le backend. */
  stage?: string | null;
  /** Indicateur additif éventuel : le serveur sait mieux que nous si la panne est transitoire. */
  retryable?: boolean | null;
  /** Statut HTTP quand l'échec précède l'ouverture du flux SSE. */
  httpStatus?: number | null;
  /** Vrai si le flux a signalé `phase: provider_availability / failed` avant l'erreur. */
  providerFailed?: boolean;
  /** Vrai si l'échec vient d'une carte d'état (`studio_report_error`). */
  fromReportTool?: boolean;
}

/** Codes métier stables ; miroir des codes prévus côté serveur, tolérant aux variantes. */
const CODE_KINDS: Record<string, StudioFailureKind> = {
  REPORT_SOURCE_REQUIRED: 'clarification',
  REPORT_AMBIGUOUS: 'clarification',
  REPORT_UNSUPPORTED: 'clarification',
  REPORT_INVALID_SPEC: 'clarification',
  REPORT_SCHEMA_CHANGED: 'clarification',
  REPORT_FORBIDDEN: 'forbidden',
  ACCESS_DENIED: 'forbidden',
  AI_PROVIDER_UNAVAILABLE: 'provider',
  REPORT_TIMEOUT: 'timeout',
  REPORT_EXECUTION_TIMEOUT: 'timeout',
  REPORT_FEATURE_DISABLED: 'disabled',
  SESSION_EXPIRED: 'session',
  RATE_LIMITED: 'server',
  NETWORK_ERROR: 'server',
  REPORT_EXECUTION_FAILED: 'server'
};

const DEFAULT_CODES: Record<StudioFailureKind, string> = {
  clarification: 'REPORT_SOURCE_REQUIRED',
  forbidden: 'ACCESS_DENIED',
  provider: 'AI_PROVIDER_UNAVAILABLE',
  timeout: 'REPORT_TIMEOUT',
  disabled: 'REPORT_FEATURE_DISABLED',
  session: 'SESSION_EXPIRED',
  server: 'REPORT_EXECUTION_FAILED'
};

/** Minuscules sans diacritiques, apostrophes unifiées : les motifs ci-dessous sont écrits ainsi. */
export function normalizeFailureText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’‘`]/g, "'")
    .toLowerCase();
}

const FORBIDDEN_PATTERNS = [
  /vous n'avez pas (le droit|acces|la permission)/,
  /n'est pas ouverte aux etats/,
  /acces (refuse|interdit|non autorise)/,
  /non autorise/,
  /\bforbidden\b/,
  /\b403\b/
];

const DISABLED_PATTERNS = [
  /n'est pas active/,
  /ne sont pas actives/,
  /pas active[es]? sur/,
  /moteur d'etats indisponible/,
  /desactive/
];

const PROVIDER_PATTERNS = [
  /moteur ia/,
  /fournisseur (ia|llm)/,
  /fournisseur .* non gere/,
  /modele configure/,
  /cle api/,
  /openrouter/,
  /\bollama\b/,
  /\bcursor\b/,
  /\bmodal\b/,
  /\bllm\b/,
  /aucun modele/
];

const TIMEOUT_PATTERNS = [
  /depasse le delai/,
  /delai imparti/,
  /temps imparti/,
  /\btimeout\b/,
  /trop de temps/
];

const CLARIFICATION_PATTERNS = [
  /spec_json/,
  /indiquez soit/,
  /\bpreset\b/,
  /\bsource\b.*(requis|invalide)/,
  /nom de source invalide/,
  /specification d'etat invalide/,
  /aucun des regroupements/,
  /aucune colonne exploitable/,
  /trop de tables liees/,
  /aucun lien \(cle etrangere\)/,
  /introuvable dans la base/,
  /n'est pas disponible sur cette base/,
  /il me manque/,
  /precisez/
];

const SESSION_PATTERNS = [/session expiree/, /reconnect/, /\b401\b/];

function matchesAny(normalized: string, patterns: RegExp[]): boolean {
  return patterns.some(p => p.test(normalized));
}

/** Identifiants techniques (Table_Colonne, CamelCase), SQL, JSON ou noms d'outils : jamais à l'écran. */
export function looksTechnical(text: string): boolean {
  // Les noms de produit/fournisseur s'écrivent en CamelCase sans être des identifiants techniques.
  const scrubbed = text.replace(/\b(InstaFact|FactuTrust|OpenRouter|Ollama|Cursor|Modal)\b/g, '');
  return /[A-Za-z]+_[A-Za-z0-9_]+/.test(scrubbed)
    || /\b[A-Z][a-z0-9]+[A-Z][A-Za-z0-9]*\b/.test(scrubbed)
    || /\b(SELECT|FROM|WHERE|JOIN|GROUP BY|ORDER BY)\b/.test(text)
    || /[{}[\]]/.test(text)
    || /studio_[a-z_]+/i.test(text)
    || /\bjson\b/i.test(text)
    || /\bstack ?trace\b/i.test(text)
    || /\bexception\b/i.test(text)
    || /https?:\/\//i.test(text);
}

/**
 * Réécrit les messages serveur connus pour être techniques et neutralise ce qui pourrait fuir
 * (identifiants de schéma, JSON, SQL, noms d'outils). Renvoie une chaîne vide quand le message ne
 * peut pas être montré tel quel : l'appelant utilise alors la phrase par défaut de la catégorie.
 */
export function sanitizeStudioFailureMessage(raw: string | null | undefined): string {
  if (!raw) return '';
  let text = raw.trim().replace(/^erreur\s*:\s*/i, '').replace(/`/g, '').trim();
  if (!text) return '';
  const n = normalizeFailureText(text);

  if (/spec_json/.test(n) || /indiquez soit/.test(n) || /specification d'etat invalide/.test(n)) {
    return "Je n'ai pas pu déterminer quelles données analyser.";
  }
  if (/^nom de source invalide/.test(n) || /introuvable dans la base/.test(n) || /n'est pas ouverte aux etats/.test(n)) {
    return "La source demandée n'est pas disponible pour les états.";
  }
  if (/aucun des regroupements demandes n'existe/.test(n)) {
    return "Certaines ventilations demandées n'existent pas sur la source analysée.";
  }
  if (/aucun lien \(cle etrangere\)/.test(n)) {
    return 'Les données demandées ne peuvent pas être reliées entre elles dans cet état.';
  }
  if (/trop de tables liees/.test(n)) {
    return "L'état demandé relie trop de tables à la fois.";
  }
  if (/aucune colonne exploitable/.test(n)) {
    return "Aucune colonne exploitable n'a été trouvée pour cet état.";
  }
  if (/vous n'avez pas acces aux donnees/.test(n)) {
    // Le domaine cité (« Paie », « Ventes »…) est un libellé métier, pas un identifiant : on le garde.
    return text;
  }
  if (/n'est pas disponible sur cette base/.test(n)) {
    return "Cet état n'est pas disponible sur vos données : une information qu'il utilise est absente ou inaccessible.";
  }

  // Filet de sécurité : tout ce qui ressemble à un identifiant, du SQL, du JSON ou un nom d'outil
  // est remplacé par la phrase par défaut de la catégorie plutôt que montré.
  if (looksTechnical(text)) return '';

  text = text.replace(/\s{2,}/g, ' ').trim();
  if (!/[.!?…]$/.test(text)) text += '.';
  return text;
}

interface KindDetection { kind: StudioFailureKind; code?: string; }

function detectKind(ctx: StudioFailureContext): KindDetection {
  const explicit = ctx.code?.trim().toUpperCase();
  if (explicit && CODE_KINDS[explicit]) return { kind: CODE_KINDS[explicit], code: explicit };

  const status = ctx.httpStatus ?? null;
  if (status === 401) return { kind: 'session' };
  if (status === 403) return { kind: 'forbidden' };
  if (status !== null && status >= 400 && status < 500 && status !== 429 && status !== 408) {
    return { kind: 'clarification', code: 'REPORT_INVALID_SPEC' };
  }

  if (ctx.providerFailed) return { kind: 'provider' };

  const n = normalizeFailureText(ctx.message ?? '');
  if (n) {
    // « Une donnée qu'il utilise est absente, ou vous n'avez pas accès… » : ambigu par nature, on
    // ne le range pas dans les refus (les autres états restent proposables).
    if (/n'est pas disponible sur cette base/.test(n)) return { kind: 'clarification', code: 'REPORT_UNSUPPORTED' };
    if (matchesAny(n, SESSION_PATTERNS)) return { kind: 'session' };
    if (matchesAny(n, FORBIDDEN_PATTERNS)) return { kind: 'forbidden' };
    if (matchesAny(n, PROVIDER_PATTERNS)) return { kind: 'provider' };
    if (matchesAny(n, DISABLED_PATTERNS)) return { kind: 'disabled' };
    if (matchesAny(n, TIMEOUT_PATTERNS)) return { kind: 'timeout' };
    if (matchesAny(n, CLARIFICATION_PATTERNS)) {
      const missingInput = /spec_json|indiquez soit|specification d'etat invalide|il me manque|precisez/.test(n);
      return { kind: 'clarification', code: missingInput ? 'REPORT_SOURCE_REQUIRED' : 'REPORT_INVALID_SPEC' };
    }
  }
  return { kind: 'server' };
}

/**
 * Compose la lecture UI d'un échec. Un `retryable` explicite du serveur est respecté, sauf pour
 * les catégories où relancer n'a jamais de sens (droits, validation, session) : là, même un
 * serveur optimiste ne fait pas réapparaître le bouton.
 */
export function classifyStudioFailure(ctx: StudioFailureContext): StudioFailureView {
  const detection = detectKind(ctx);
  const kind = detection.kind;
  const explicitCode = ctx.code?.trim().toUpperCase();
  const code = explicitCode && explicitCode.length <= 64 && /^[A-Z0-9_]+$/.test(explicitCode)
    ? explicitCode
    : detection.code ?? DEFAULT_CODES[kind];
  const cleaned = sanitizeStudioFailureMessage(ctx.message);
  const status = ctx.httpStatus ?? null;
  const stageOverride = ctx.stage?.trim() && !looksTechnical(ctx.stage) ? ctx.stage.trim() : null;

  let view: StudioFailureView;
  switch (kind) {
    case 'clarification':
      view = {
        kind, code,
        eyebrow: $localize`:@@studio.studio-ai-failure.ts.precision.necessaire.b552b373:Précision nécessaire`,
        title: $localize`:@@studio.studio-ai-failure.ts.votre.demande.doit.etre.precisee.5389d7ac:Votre demande doit être précisée`,
        message: cleaned || $localize`:@@studio.studio-ai-failure.ts.je.n.ai.pas.pu.determiner.quelles.donnee.4b0860e5:Je n'ai pas pu déterminer quelles données analyser.`,
        hint: $localize`:@@studio.studio-ai-failure.ts.indiquez.le.sujet.ventes.achats.encaisse.355a3d14:Indiquez le sujet (ventes, achats, encaissements…), la ventilation souhaitée `
          + $localize`:@@studio.studio-ai-failure.ts.par.annee.par.client.par.produit.et.si.b.972e045a:(par année, par client, par produit…) et, si besoin, la période. `
          + $localize`:@@studio.studio-ai-failure.ts.vous.pouvez.aussi.partir.d.un.etat.pret.81e501d7:Vous pouvez aussi partir d'un état prêt à l'emploi.`,
        stage: 'Compréhension de la demande',
        retryable: false,
        showSuggestions: true
      };
      break;
    case 'forbidden':
      view = {
        kind, code,
        eyebrow: $localize`:@@studio.studio-ai-failure.ts.acces.non.autorise.951229a5:Accès non autorisé`,
        title: $localize`:@@studio.studio-ai-failure.ts.vous.ne.pouvez.pas.consulter.cet.etat.8d00f46c:Vous ne pouvez pas consulter cet état`,
        message: cleaned || $localize`:@@studio.studio-ai-failure.ts.votre.compte.ne.dispose.pas.des.droits.n.dbaa1ce9:Votre compte ne dispose pas des droits nécessaires dans l'espace actif.`,
        hint: $localize`:@@studio.studio-ai-failure.ts.demandez.a.un.administrateur.de.verifier.18ac6c21:Demandez à un administrateur de vérifier vos droits de consultation des états et des `
          + $localize`:@@studio.studio-ai-failure.ts.donnees.concernees.reessayer.ou.reformul.8fbfd6e3:données concernées. Réessayer ou reformuler la demande ne modifie pas vos droits.`,
        stage: 'Contrôle des autorisations',
        retryable: false,
        showSuggestions: false
      };
      break;
    case 'provider':
      view = {
        kind, code,
        eyebrow: $localize`:@@studio.studio-ai-failure.ts.service.ia.indisponible.1b49af44:Service IA indisponible`,
        title: $localize`:@@studio.studio-ai-failure.ts.la.preparation.de.la.demande.a.ete.inter.15137ea7:La préparation de la demande a été interrompue`,
        message: $localize`:@@studio.studio-ai-failure.ts.le.fournisseur.ia.est.momentanement.indi.305c864a:Le fournisseur IA est momentanément indisponible. Aucun état n'a été calculé et rien n'a été enregistré.`,
        hint: $localize`:@@studio.studio-ai-failure.ts.vous.pouvez.reessayer.une.fois.a.votre.i.8817db8a:Vous pouvez réessayer une fois, à votre initiative. Sans l'assistant, le concepteur d'états `
          + $localize`:@@studio.studio-ai-failure.ts.reste.disponible.bdc6c5e7:reste disponible.`,
        stage: 'Préparation de la demande',
        retryable: true,
        showSuggestions: false,
        // Le texte serveur est destiné à l'exploitant (clé API, service arrêté…) : il va au diagnostic.
        detail: cleaned || undefined
      };
      break;
    case 'timeout':
      view = {
        kind, code,
        eyebrow: $localize`:@@studio.studio-ai-failure.ts.moteur.de.calcul.delai.depasse.30dcb5a2:Moteur de calcul · délai dépassé`,
        title: $localize`:@@studio.studio-ai-failure.ts.le.calcul.de.l.etat.n.a.pas.abouti.dca8e126:Le calcul de l'état n'a pas abouti`,
        message: cleaned || $localize`:@@studio.studio-ai-failure.ts.le.calcul.de.l.etat.a.depasse.le.delai.i.86c79e73:Le calcul de l'état a dépassé le délai imparti. Aucun résultat partiel n'est présenté.`,
        hint: $localize`:@@studio.studio-ai-failure.ts.restreignez.la.periode.une.seule.annee.p.4daa7098:Restreignez la période (une seule année, par exemple) ou le nombre de colonnes, puis relancez. `
          + $localize`:@@studio.studio-ai-failure.ts.aucun.nouvel.appel.a.l.ia.n.est.necessai.bed39f7b:Aucun nouvel appel à l'IA n'est nécessaire pour un état prêt à l'emploi.`,
        stage: "Exécution de l'état",
        retryable: true,
        showSuggestions: true
      };
      break;
    case 'disabled':
      view = {
        kind, code,
        eyebrow: $localize`:@@studio.studio-ai-failure.ts.fonction.non.disponible.9f74ecbf:Fonction non disponible`,
        title: $localize`:@@studio.studio-ai-failure.ts.les.etats.assistes.ne.sont.pas.disponibl.ff710646:Les états assistés ne sont pas disponibles ici`,
        message: cleaned || $localize`:@@studio.studio-ai-failure.ts.cette.fonction.n.est.pas.activee.sur.ce.4ab80f08:Cette fonction n'est pas activée sur ce serveur.`,
        hint: $localize`:@@studio.studio-ai-failure.ts.contactez.l.administrateur.de.la.platefo.16a42f23:Contactez l'administrateur de la plateforme, ou préparez votre état depuis le concepteur d'états.`,
        stage: 'Vérification de la configuration',
        retryable: false,
        showSuggestions: false
      };
      break;
    case 'session':
      view = {
        kind, code,
        eyebrow: $localize`:@@studio.studio-ai-failure.ts.session.expiree.6344d1b8:Session expirée`,
        title: $localize`:@@studio.studio-ai-failure.ts.reconnectez.vous.pour.continuer.af454362:Reconnectez-vous pour continuer`,
        message: cleaned || $localize`:@@studio.studio-ai-failure.ts.votre.session.a.expire.avant.que.la.dema.df944348:Votre session a expiré avant que la demande soit traitée.`,
        hint: $localize`:@@studio.studio-ai-failure.ts.votre.demande.reste.dans.le.fil.reconnec.757ee80f:Votre demande reste dans le fil : reconnectez-vous, puis renvoyez-la.`,
        stage: 'Authentification',
        retryable: false,
        showSuggestions: false
      };
      break;
    default:
      if (status === 429) {
        view = {
          kind, code: explicitCode && CODE_KINDS[explicitCode] ? code : 'RATE_LIMITED',
          eyebrow: $localize`:@@studio.studio-ai-failure.ts.trop.de.demandes.7afdec59:Trop de demandes`,
          title: $localize`:@@studio.studio-ai-failure.ts.l.assistant.est.momentanement.sature.ab9bb9ce:L'assistant est momentanément saturé`,
          message: cleaned || $localize`:@@studio.studio-ai-failure.ts.trop.de.requetes.ont.ete.envoyees.a.l.as.1a32856d:Trop de requêtes ont été envoyées à l'assistant en peu de temps.`,
          hint: $localize`:@@studio.studio-ai-failure.ts.patientez.quelques.instants.avant.de.ree.e22fb2c3:Patientez quelques instants avant de réessayer. Rien n'a été enregistré.`,
          stage: 'Envoi de la demande',
          retryable: true,
          showSuggestions: false
        };
      } else if (status === null && isNetworkMessage(ctx.message)) {
        view = {
          kind, code: 'NETWORK_ERROR',
          eyebrow: $localize`:@@studio.studio-ai-failure.ts.connexion.interrompue.696e9399:Connexion interrompue`,
          title: $localize`:@@studio.studio-ai-failure.ts.la.liaison.avec.le.serveur.a.ete.coupee.3e87a2a2:La liaison avec le serveur a été coupée`,
          message: $localize`:@@studio.studio-ai-failure.ts.la.connexion.a.ete.interrompue.avant.la.63da23b4:La connexion a été interrompue avant la fin du traitement. Aucun résultat partiel n'est présenté.`,
          hint: $localize`:@@studio.studio-ai-failure.ts.verifiez.votre.connexion.puis.reessayez.0584b628:Vérifiez votre connexion, puis réessayez une fois.`,
          stage: 'Transport de la réponse',
          retryable: true,
          showSuggestions: false
        };
      } else {
        view = {
          kind, code,
          eyebrow: $localize`:@@studio.studio-ai-failure.ts.erreur.de.calcul.abb6ad49:Erreur de calcul`,
          title: $localize`:@@studio.studio-ai-failure.ts.l.etat.n.a.pas.pu.etre.calcule.d961ea39:L'état n'a pas pu être calculé`,
          message: cleaned || $localize`:@@studio.studio-ai-failure.ts.une.erreur.est.survenue.pendant.le.calcu.1dbaaab8:Une erreur est survenue pendant le calcul. Aucun résultat partiel n'est présenté et rien n'a été enregistré.`,
          hint: $localize`:@@studio.studio-ai-failure.ts.vous.pouvez.reessayer.une.fois.si.l.erre.0e53cd7d:Vous pouvez réessayer une fois. Si l'erreur persiste, transmettez le diagnostic au support.`,
          stage: status !== null && status >= 500 ? 'Traitement serveur' : "Exécution de l'état",
          retryable: true,
          showSuggestions: !!ctx.fromReportTool
        };
      }
  }

  if (stageOverride) view.stage = stageOverride;

  // Un serveur qui déclare la panne non transitoire retire la relance ; l'inverse n'est accordé
  // que pour les catégories où relancer peut effectivement changer quelque chose.
  if (ctx.retryable === false) view.retryable = false;
  else if (ctx.retryable === true && (kind === 'server' || kind === 'provider' || kind === 'timeout')) view.retryable = true;

  return view;
}

function isNetworkMessage(message: string | null | undefined): boolean {
  if (!message) return false;
  const n = normalizeFailureText(message);
  return /failed to fetch|networkerror|network error|load failed|no response body|connexion/.test(n);
}

/** Texte du bouton « Copier le diagnostic » : catégorie, référence, étape — rien d'autre. */
export function buildStudioDiagnostic(view: StudioFailureView, traceId?: string | null): string {
  const lines = [
    `Catégorie : ${view.code}`,
    `Référence : ${traceId?.trim() || 'non disponible'}`,
    `Étape interrompue : ${view.stage}`,
    'Relance automatique : désactivée'
  ];
  if (view.detail) lines.push(`Détail : ${view.detail}`);
  return lines.join('\n');
}

/** Texte de la demande d'accès à transmettre à un administrateur : aucun contenu métier. */
export function buildStudioAccessRequest(traceId?: string | null): string {
  return [
    "Demande d'accès — Assistant Studio (états)",
    "Je n'ai pas pu consulter un état depuis l'Assistant Studio : mes droits de consultation des états "
      + 'ou des données concernées semblent insuffisants.',
    'Merci de vérifier mes autorisations dans l\'espace actif.',
    `Référence : ${traceId?.trim() || 'non disponible'}`
  ].join('\n');
}

/** « du 01/01/2022 au 06/09/2026 » à partir des bornes ISO renvoyées par le serveur. */
export function formatStudioPeriod(period?: { from?: string | null; to?: string | null } | null): string {
  if (!period) return '';
  const from = formatIsoDate(period.from);
  const to = formatIsoDate(period.to);
  if (from && to) return `du ${from} au ${to}`;
  if (from) return `à partir du ${from}`;
  if (to) return `jusqu'au ${to}`;
  return '';
}

function formatIsoDate(value?: string | null): string {
  if (!value) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}
