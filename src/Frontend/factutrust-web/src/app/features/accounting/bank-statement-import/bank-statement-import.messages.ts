/// <reference types="@angular/localize" />
import { LineConfidence, LineProposalSource, LineStatus } from './bank-statement-import.models';

/**
 * Textes affichés selon les CODES stables renvoyés par l'API (jamais selon le texte français du
 * serveur). Le message serveur reste visible en détail quand il apporte une donnée (montants…).
 */
export function importErrorMessage(code: string | null | undefined): string {
  switch (code) {
    case 'bank_statement_import.disabled':
      return $localize`:@@accounting.bank-statement-import.ts.l.import.de.releves.bancaires.n.est.pas.active.p.efb43f3b:L'import de relevés bancaires n'est pas activé pour ce dossier.`;
    case 'bank_statement_import.file_required':
      return $localize`:@@accounting.bank-statement-import.ts.choisissez.le.fichier.du.releve.c50d84c0:Choisissez le fichier du relevé.`;
    case 'bank_statement_import.file_too_large':
      return $localize`:@@accounting.bank-statement-import.ts.fichier.trop.volumineux.10.mo.au.maximum.b5daaeb5:Fichier trop volumineux (10 Mo au maximum).`;
    case 'bank_statement_import.file_rejected':
      return $localize`:@@accounting.bank-statement-import.ts.fichier.refuse.seuls.les.releves.pdf.ou.les.imag.4f83b3e2:Fichier refusé : seuls les relevés PDF ou les images PNG, JPEG et WEBP sont acceptés.`;
    case 'bank_statement_import.bank_account_not_found':
      return $localize`:@@accounting.bank-statement-import.ts.compte.bancaire.introuvable.3b4ee62b:Compte bancaire introuvable.`;
    case 'bank_statement_import.bank_account_inactive':
      return $localize`:@@accounting.bank-statement-import.ts.ce.compte.bancaire.est.desactive.f8f31b65:Ce compte bancaire est désactivé.`;
    case 'bank_statement_import.bank_account_without_gl_account':
      return $localize`:@@accounting.bank-statement-import.ts.ce.compte.bancaire.n.est.relie.a.aucun.compte.co.2c5c95df:Ce compte bancaire n'est relié à aucun compte comptable 532.`;
    case 'bank_statement_import.currency_not_supported':
      return $localize`:@@accounting.bank-statement-import.ts.seuls.les.comptes.et.releves.en.dinars.tnd.sont.e770356c:Seuls les comptes et relevés en dinars (TND) sont pris en charge.`;
    case 'bank_statement_import.journal_invalid':
    case 'bank_statement_posting.journal_invalid':
      return $localize`:@@accounting.bank-statement-import.ts.le.journal.choisi.n.est.pas.un.journal.de.banque.d72b87ab:Le journal choisi n'est pas un journal de banque actif.`;
    case 'bank_statement_import.already_imported':
      return $localize`:@@accounting.bank-statement-import.ts.ce.releve.a.deja.ete.importe.pour.ce.compte.banc.57eb25c1:Ce relevé a déjà été importé pour ce compte bancaire.`;
    case 'bank_statement_import.analysis_in_progress':
      return $localize`:@@accounting.bank-statement-import.ts.une.autre.lecture.ia.de.releve.est.en.cours.pour.76db0997:Une autre lecture IA de relevé est en cours pour ce dossier : réessayez dans quelques minutes.`;
    case 'bank_statement_import.session_not_found':
      return $localize`:@@accounting.bank-statement-import.ts.analyse.de.releve.introuvable.ou.expiree.6ea1c78a:Analyse de relevé introuvable ou expirée.`;
    case 'bank_statement_import.session_not_reviewable':
      return $localize`:@@accounting.bank-statement-import.ts.cette.analyse.n.est.plus.en.attente.de.relecture.6be1d24c:Cette analyse n'est plus en attente de relecture.`;
    case 'bank_statement_import.blocking_issues':
      return $localize`:@@accounting.bank-statement-import.ts.le.releve.ne.peut.pas.etre.enregistre.tant.que.d.990f3df2:Le relevé ne peut pas être enregistré tant que des contrôles bloquants subsistent.`;
    case 'bank_statement_import.storage':
      return $localize`:@@accounting.bank-statement-import.ts.le.fichier.n.a.pas.pu.etre.enregistre.sur.le.ser.598253f0:Le fichier n'a pas pu être enregistré sur le serveur.`;
    case 'bank_statement_posting.statement_not_found':
      return $localize`:@@accounting.bank-statement-import.ts.releve.introuvable.a1527944:Relevé introuvable.`;
    case 'bank_statement_posting.statement_without_gl_account':
      return $localize`:@@accounting.bank-statement-import.ts.ce.releve.n.est.relie.a.aucun.compte.comptable.5.dd1a2504:Ce relevé n'est relié à aucun compte comptable 532.`;
    case 'bank_statement_posting.drafts_disabled':
      return $localize`:@@accounting.bank-statement-import.ts.le.brouillard.est.desactive.les.ecritures.d.un.r.9e2641b0:Le brouillard est désactivé : les écritures d'un relevé ne peuvent être générées qu'en brouillard.`;
    case 'bank_statement_posting.ai_unavailable':
      return $localize`:@@accounting.bank-statement-import.ts.la.classification.par.l.ia.est.indisponible.pour.a391504b:La classification par l'IA est indisponible pour le moment.`;
    default:
      return $localize`:@@accounting.bank-statement-import.ts.l.operation.a.echoue.reessayez.ou.contactez.le.s.23720b33:L'opération a échoué. Réessayez ou contactez le support.`;
  }
}

/** Libellé court d'un motif de refus à la génération d'une ligne. */
export function generationFailureMessage(code: string | null | undefined): string {
  switch (code) {
    case 'bank_statement_posting.account_invalid':
      return $localize`:@@accounting.bank-statement-import.ts.compte.absent.du.plan.desactive.ou.egal.au.compt.f3ce73fc:Compte absent du plan, désactivé ou égal au compte banque.`;
    case 'bank_statement_posting.third_party_required':
      return $localize`:@@accounting.bank-statement-import.ts.tiers.obligatoire.sur.ce.compte.collectif.d45c7165:Tiers obligatoire sur ce compte collectif.`;
    case 'bank_statement_posting.third_party_invalid':
      return $localize`:@@accounting.bank-statement-import.ts.tiers.introuvable.ou.incompatible.avec.le.compte.94342764:Tiers introuvable ou incompatible avec le compte.`;
    case 'bank_statement_posting.vat_invalid':
      return $localize`:@@accounting.bank-statement-import.ts.ventilation.de.tva.invalide.9524e7f7:Ventilation de TVA invalide.`;
    case 'bank_statement_posting.period_closed':
      return $localize`:@@accounting.bank-statement-import.ts.periode.close.ou.exercice.verrouille.e8e67fc2:Période close ou exercice verrouillé.`;
    case 'bank_statement_posting.already_posted':
      return $localize`:@@accounting.bank-statement-import.ts.deja.comptabilisee.322ce145:Déjà comptabilisée.`;
    case 'bank_statement_posting.line_not_found':
      return $localize`:@@accounting.bank-statement-import.ts.ligne.de.releve.introuvable.b695087e:Ligne de relevé introuvable.`;
    default:
      return $localize`:@@accounting.bank-statement-import.ts.echec.de.la.generation.94609f9d:Échec de la génération.`;
  }
}

export function lineStatusLabel(status: LineStatus): string {
  switch (status) {
    case 'Generated':
      return $localize`:@@accounting.bank-statement-import.ts.ecriture.generee.877cce34:Écriture générée`;
    case 'Reconciled':
      return $localize`:@@accounting.bank-statement-import.ts.rapprochee.bea87b65:Rapprochée`;
    case 'AlreadyPosted':
      return $localize`:@@accounting.bank-statement-import.ts.deja.comptabilisee.34aafa95:Déjà comptabilisée`;
    case 'Ambiguous':
      return $localize`:@@accounting.bank-statement-import.ts.a.verifier.plusieurs.ecritures.possibles.defa4f02:À vérifier : plusieurs écritures possibles`;
    case 'AlreadyImported':
      return $localize`:@@accounting.bank-statement-import.ts.deja.importee.d53242da:Déjà importée`;
    case 'Blocked':
      return $localize`:@@accounting.bank-statement-import.ts.periode.close.c00bb0eb:Période close`;
    case 'Proposed':
      return $localize`:@@accounting.bank-statement-import.ts.proposee.03b0c053:Proposée`;
    default:
      return $localize`:@@accounting.bank-statement-import.ts.a.completer.b06198e1:À compléter`;
  }
}

export function confidenceLabel(confidence: LineConfidence | null): string {
  switch (confidence) {
    case 'Certain':
      return $localize`:@@accounting.bank-statement-import.ts.certaine.7a5ff459:Certaine`;
    case 'Probable':
      return $localize`:@@accounting.bank-statement-import.ts.probable.3d996266:Probable`;
    case 'ToCheck':
      return $localize`:@@accounting.bank-statement-import.ts.a.verifier.8f5f7255:À vérifier`;
    default:
      return '';
  }
}

/** Titre d'un signalement d'extraction ; le détail (montants, page) vient du message serveur. */
export function issueTitle(code: string): string {
  switch (code) {
    case 'statement.balance_mismatch':
      return $localize`:@@accounting.bank-statement-import.ts.controle.de.solde.en.echec.fcc7b22a:Contrôle de solde en échec`;
    case 'statement.total_debits_mismatch':
      return $localize`:@@accounting.bank-statement-import.ts.total.des.debits.different.du.releve.4cb48ca9:Total des débits différent du relevé`;
    case 'statement.total_credits_mismatch':
      return $localize`:@@accounting.bank-statement-import.ts.total.des.credits.different.du.releve.43846e1b:Total des crédits différent du relevé`;
    case 'statement.opening_not_found':
      return $localize`:@@accounting.bank-statement-import.ts.solde.initial.introuvable.88965f5f:Solde initial introuvable`;
    case 'statement.closing_not_found':
      return $localize`:@@accounting.bank-statement-import.ts.solde.final.introuvable.13b030ed:Solde final introuvable`;
    case 'statement.rib_mismatch':
      return $localize`:@@accounting.bank-statement-import.ts.releve.d.un.autre.compte.bancaire.0040e15e:Relevé d'un autre compte bancaire`;
    case 'statement.rib_not_found':
      return $localize`:@@accounting.bank-statement-import.ts.rib.introuvable.sur.le.releve.bb213e2b:RIB introuvable sur le relevé`;
    case 'statement.rib_invalid_key':
      return $localize`:@@accounting.bank-statement-import.ts.cle.rib.incoherente.688a759a:Clé RIB incohérente`;
    case 'statement.no_text_layer':
      return $localize`:@@accounting.bank-statement-import.ts.page.scannee.eb1fc456:Page scannée`;
    case 'statement.ai_unavailable':
      return $localize`:@@accounting.bank-statement-import.ts.lecture.ia.indisponible.63d10000:Lecture IA indisponible`;
    case 'statement.ai_page_failed':
      return $localize`:@@accounting.bank-statement-import.ts.page.non.lue.par.l.ia.b336bc68:Page non lue par l'IA`;
    case 'statement.ai_amount_not_grounded':
      return $localize`:@@accounting.bank-statement-import.ts.montant.a.verifier.3d450aa8:Montant à vérifier`;
    case 'statement.currency_not_supported':
      return $localize`:@@accounting.bank-statement-import.ts.devise.non.prise.en.charge.b6df1af0:Devise non prise en charge`;
    case 'statement.too_many_pages':
      return $localize`:@@accounting.bank-statement-import.ts.releve.trop.long.ccf4961d:Relevé trop long`;
    case 'statement.unreadable':
      return $localize`:@@accounting.bank-statement-import.ts.fichier.illisible.aded9791:Fichier illisible`;
    case 'statement.multiple_statements':
      return $localize`:@@accounting.bank-statement-import.ts.plusieurs.releves.dans.le.fichier.4a8dd23d:Plusieurs relevés dans le fichier`;
    case 'statement.too_many_statements':
      return $localize`:@@accounting.bank-statement-import.ts.trop.de.releves.dans.le.fichier.eb3973c2:Trop de relevés dans le fichier`;
    case 'statement.periods_overlap':
      return $localize`:@@accounting.bank-statement-import.ts.periodes.qui.se.chevauchent.8175af92:Périodes qui se chevauchent`;
    case 'statement.discontinuity':
      return $localize`:@@accounting.bank-statement-import.ts.solde.d.ouverture.discontinu.26349909:Solde d'ouverture discontinu`;
    case 'statement.no_transactions':
      return $localize`:@@accounting.bank-statement-import.ts.aucune.operation.trouvee.b492f86f:Aucune opération trouvée`;
    default:
      return $localize`:@@accounting.bank-statement-import.ts.signalement.19e0c078:Signalement`;
  }
}

/** Origine de la proposition (le détail du catalogue reste en info-bulle). */
export function proposalSourceLabel(source: LineProposalSource | null): string {
  switch (source) {
    case 'ExistingEntry':
      return $localize`:@@accounting.bank-statement-import.ts.ecriture.existante.0263c7b5:Écriture existante`;
    case 'DossierRule':
      return $localize`:@@accounting.bank-statement-import.ts.regle.du.dossier.878054a7:Règle du dossier`;
    case 'Catalog':
      return $localize`:@@accounting.bank-statement-import.ts.operation.bancaire.reconnue.791f5244:Opération bancaire reconnue`;
    case 'ThirdPartyMatch':
      return $localize`:@@accounting.bank-statement-import.ts.tiers.reconnu.c8bf88a3:Tiers reconnu`;
    case 'Ai':
      return $localize`:@@accounting.bank-statement-import.ts.suggestion.de.l.ia.7a2e0944:Suggestion de l'IA`;
    default:
      return '';
  }
}

/** Diagnostic d'une proposition, rédigé à partir de son code (jamais du texte serveur). */
export function proposalDiagnosticMessage(code: string, account: string | null): string {
  const number = account ?? '';
  switch (code) {
    case 'account_missing':
      return $localize`:@@accounting.bank-statement-import.ts.le.compte.propose.n.existe.pas.dans.le.plan.comp.c9a91a03:Le compte proposé n'existe pas dans le plan comptable du dossier : choisissez un compte existant.`;
    case 'account_inactive':
      return $localize`:@@accounting.bank-statement-import.ts.le.compte.est.desactive.df105897:Le compte ${number}:account: est désactivé.`;
    case 'period_closed':
      return $localize`:@@accounting.bank-statement-import.ts.periode.close.ou.exercice.verrouille.aucune.ecri.bb3d8ddf:Période close ou exercice verrouillé : aucune écriture ne peut y être passée.`;
    case 'third_party_required':
      return $localize`:@@accounting.bank-statement-import.ts.compte.collectif.precisez.le.tiers.be8367d1:Compte collectif : précisez le tiers.`;
    default:
      return $localize`:@@accounting.bank-statement-import.ts.point.a.verifier.3fd65f17:Point à vérifier.`;
  }
}
