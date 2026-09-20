import {
  instanceStatusSeverity,
  isOpenInstance,
  SAVE_AS_REGEX,
  slugifyWorkflowKey,
  STEP_KEY_REGEX
} from './studio-workflows.models';

describe('studio-workflows.models', () => {
  it('classe les statuts d\'instance ouverts et terminés', () => {
    expect(isOpenInstance('running')).toBeTrue();
    expect(isOpenInstance('waiting')).toBeTrue();
    expect(isOpenInstance('waiting_approval')).toBeTrue();
    expect(isOpenInstance('completed')).toBeFalse();
    expect(isOpenInstance('failed')).toBeFalse();
    expect(isOpenInstance('cancelled')).toBeFalse();

    expect(instanceStatusSeverity('failed')).toBe('danger');
    expect(instanceStatusSeverity('completed')).toBe('success');
  });

  it('valide la forme des clés d\'étape et des noms saveResultAs', () => {
    expect(STEP_KEY_REGEX.test('a1')).toBeTrue();
    expect(STEP_KEY_REGEX.test('valider_devis')).toBeTrue();
    expect(STEP_KEY_REGEX.test('étape')).toBeFalse();
    expect(STEP_KEY_REGEX.test('1abc')).toBeFalse();
    expect(STEP_KEY_REGEX.test('a')).toBeFalse();
    expect(STEP_KEY_REGEX.test('a'.repeat(65))).toBeFalse();

    expect(SAVE_AS_REGEX.test('r')).toBeTrue();
    expect(SAVE_AS_REGEX.test('r'.repeat(33))).toBeFalse();
  });

  it('dérive une clé de workflow depuis le nom (slug wf_ si chiffre initial)', () => {
    expect(slugifyWorkflowKey('Validation devis > 10 k€')).toBe('validation_devis_10_k');
    expect(slugifyWorkflowKey('2e relance')).toBe('wf_2e_relance');
    expect(slugifyWorkflowKey('')).toBe('');
  });
});
