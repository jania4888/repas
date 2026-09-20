import { formatLabel, slugifyKey } from './studio-text.util';

describe('studio-text.util', () => {
  it("dérive une clé ASCII en minuscules avec le préfixe demandé si le premier caractère n'est pas une lettre", () => {
    expect(slugifyKey('2 roues', 'v_')).toBe('v_2_roues');
    expect(slugifyKey('Validation devis > 10 k€', 'wf_')).toBe('validation_devis_10_k');
    expect(slugifyKey('Équipe été', 'f_')).toBe('equipe_ete');
    expect(slugifyKey('  __  ', 'f_')).toBe('');
    expect(slugifyKey('', 'f_')).toBe('');
  });

  it('tronque la clé à 64 caractères, préfixe compris', () => {
    expect(slugifyKey('a'.repeat(80), 'f_')).toBe('a'.repeat(64));
    const withPrefix = slugifyKey('9' + 'b'.repeat(80), 'wf_');
    expect(withPrefix.length).toBe(64);
    expect(withPrefix.startsWith('wf_9')).toBeTrue();
  });

  it('interpole les {clés} et laisse les clés inconnues telles quelles', () => {
    expect(formatLabel('Workflow {state} — {count} instance(s)', { state: 'activé', count: 3 })).toBe('Workflow activé — 3 instance(s)');
    expect(formatLabel('Seuls les {count} premiers ({inconnu})', { count: 0 })).toBe('Seuls les 0 premiers ({inconnu})');
  });
});
