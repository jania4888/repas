import { clampMax, workflowErrorMessage } from './studio-workflow-http.util';

describe('studio-workflow-http.util', () => {
  it('lit le message dans error puis message de l\'enveloppe Studio', () => {
    expect(workflowErrorMessage({ error: { error: 'x' } })).toBe('x');
    expect(workflowErrorMessage({ error: { error: 'x', message: 'y' } })).toBe('x');
    expect(workflowErrorMessage({ error: { message: 'y' } })).toBe('y');
    expect(workflowErrorMessage({ error: 'corps chaîne' })).toBe('');
    expect(workflowErrorMessage(undefined)).toBe('');
  });

  it('borne max dans [1, upper]', () => {
    expect(clampMax(0)).toBe(1);
    expect(clampMax(-5)).toBe(1);
    expect(clampMax(50)).toBe(50);
    expect(clampMax(999)).toBe(100);
    expect(clampMax(150, 200)).toBe(150);
    expect(clampMax(999, 200)).toBe(200);
  });
});
