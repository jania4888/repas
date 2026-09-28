import { BackendLabelPipe } from './backend-label.pipe';
import { BACKEND_DISPLAY_LABELS } from '@core/i18n/backend-display-labels.generated';

describe('BackendLabelPipe', () => {
  const html = document.documentElement;
  let previousLang: string | null;

  beforeEach(() => (previousLang = html.getAttribute('lang')));
  afterEach(() => (previousLang == null ? html.removeAttribute('lang') : html.setAttribute('lang', previousLang)));

  it('fr identity', () => {
    html.setAttribute('lang', 'fr');
    expect(new BackendLabelPipe().transform('X')).toBe('X');
    expect(new BackendLabelPipe().transform('Brouillon')).toBe('Brouillon');
  });

  it('renvoie null/undefined tels quels pour que `?? défaut` garde son effet', () => {
    const pipe = new BackendLabelPipe();
    for (const lang of ['fr', 'ar']) {
      html.setAttribute('lang', lang);
      expect(pipe.transform(null)).toBeNull();
      expect(pipe.transform(undefined)).toBeUndefined();
      expect(pipe.transform(null) ?? '—').toBe('—');
    }
  });

  it('ar : libellé connu traduit, libellé inconnu inchangé', () => {
    html.setAttribute('lang', 'ar');
    const pipe = new BackendLabelPipe();
    expect(pipe.transform('Brouillon')).toBe(BACKEND_DISPLAY_LABELS['Brouillon']);
    expect(pipe.transform('Libellé inconnu du générateur')).toBe('Libellé inconnu du générateur');
  });
});
