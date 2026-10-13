import { importErrorMessage, issueTitle, sessionFailureMessage } from './bank-statement-import.messages';

describe('bank-statement-import.messages', () => {
  describe('issueTitle', () => {
    it('titre les signalements de la lecture IA page par page', () => {
      expect(issueTitle('statement.ai_page_empty')).toBe('Page sans opération');
      expect(issueTitle('statement.ai_page_truncated')).toBe('Page peut-être incomplète');
      expect(issueTitle('statement.ai_summary_line_dropped')).toBe('Ligne de solde non importée');
      expect(issueTitle('statement.ai_possible_duplicate')).toBe('Doublon possible entre deux pages');
      expect(issueTitle('statement.ai_text_fallback')).toBe('Page lue en secours');
      expect(issueTitle('statement.ai_line_needs_review')).toBe('Ligne à corriger');
      expect(issueTitle('statement.ai_unavailable')).toBe('Lecture IA indisponible');
    });

    it('titre les signalements de lignes et d’en-tête', () => {
      expect(issueTitle('statement.line_ambiguous_side')).toBe('Sens d\'une opération incertain');
      expect(issueTitle('statement.currency_not_found')).toBe('Devise non trouvée sur le relevé');
      expect(issueTitle('statement.line_invalid_date')).toBe('Date d\'opération illisible');
      expect(issueTitle('statement.orphan_amount')).toBe('Montant sans opération associée');
      expect(issueTitle('statement.line_no_amount')).toBe('Opération sans montant');
      expect(issueTitle('statement.line_several_amounts')).toBe('Plusieurs montants sur une opération');
      expect(issueTitle('statement.assumed_balance_sign')).toBe('Signe d\'un solde supposé');
    });

    it('garde les titres historiques et un repli générique', () => {
      expect(issueTitle('statement.rib_mismatch')).toBe('Relevé d\'un autre compte bancaire');
      expect(issueTitle('statement.balance_mismatch')).toBe('Contrôle de solde en échec');
      expect(issueTitle('statement.code_inconnu')).toBe('Signalement');
    });
  });

  describe('importErrorMessage', () => {
    it('explique les refus de l’enregistrement d’un relevé lu par l’IA', () => {
      expect(importErrorMessage('bank_statement_import.balance_warning_not_acknowledged')).toBe('L\'enregistrement nécessite de confirmer l\'écart de solde.');
      expect(importErrorMessage('bank_statement_import.correction_not_allowed')).toContain('lue directement dans le PDF');
      expect(importErrorMessage('bank_statement_import.same_bank_account')).toContain('Relancer l\'analyse');
    });

    it('conserve le message des contrôles bloquants et le repli', () => {
      expect(importErrorMessage('bank_statement_import.blocking_issues')).toContain('contrôles bloquants');
      expect(importErrorMessage(null)).toContain('L\'opération a échoué');
    });

    it('explique le chevauchement entre lignes cochées et exclues à la génération', () => {
      expect(importErrorMessage('bank_statement_posting.atomic_overlap')).toContain('Rechargez la page');
    });
  });

  describe('sessionFailureMessage', () => {
    it('décrit l’échec selon le code de la session', () => {
      expect(sessionFailureMessage('ai_unavailable')).toContain('indisponible');
      expect(sessionFailureMessage('ai_unavailable')).toContain('aucune page n\'a été lue');
      expect(sessionFailureMessage('ai_timeout')).toContain('temps alloué');
      expect(sessionFailureMessage('ai_failed')).toContain('a échoué');
    });

    it('reste muet pour un code inconnu ou absent', () => {
      expect(sessionFailureMessage(null)).toBe('');
      expect(sessionFailureMessage(undefined)).toBe('');
      expect(sessionFailureMessage('autre')).toBe('');
    });
  });
});
