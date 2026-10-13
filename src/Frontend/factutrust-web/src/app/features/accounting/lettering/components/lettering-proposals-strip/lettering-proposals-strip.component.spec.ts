import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LetteringSuggestionDto, LetteringSuggestionLineDto } from '../../../services/accounting.service';
import { LetteringSuggestion } from '../../models/lettering-suggestions.models';
import { mapSuggestion } from '../../utils/lettering-suggestions';
import { LetteringProposalsStripComponent } from './lettering-proposals-strip.component';

function sLine(id: string, over: Partial<LetteringSuggestionLineDto> = {}): LetteringSuggestionLineDto {
  return {
    lineId: id, entryId: `e-${id}`, entryDate: '2026-05-01T00:00:00', journalCode: 'JV', entryNumber: 7,
    pieceRef: null, label: id, debit: 0, credit: 0, debitInCurrency: 0, creditInCurrency: 0, ...over
  };
}

function suggestion(key: string, over: Partial<LetteringSuggestionDto> = {}): LetteringSuggestion {
  return mapSuggestion({
    key, kind: 'SameThirdPartyAmount', category: 'Exact', score: 90, confidence: 'High',
    accountNumber: '4111', currencyCode: 'TND', thirdPartyId: null, thirdPartyKind: 0, thirdPartyName: null,
    debitLines: [sLine(`d-${key}`, { debit: 1250.5, pieceRef: 'FAC-001' })],
    creditLines: [sLine(`c-${key}`, { credit: 1250.5, pieceRef: 'REG-001' })],
    totalAmount: 1250.5, localGap: 0, hasExchangeDifference: false, bulkEligible: true,
    reasons: [{ code: 'SameAmount', args: { amount: '1250.5', currency: 'TND' } }],
    ...over
  });
}

describe('LetteringProposalsStripComponent', () => {
  let fixture: ComponentFixture<LetteringProposalsStripComponent>;
  let component: LetteringProposalsStripComponent;

  const el = (): HTMLElement => fixture.nativeElement;
  const q = (testId: string) => el().querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  const qa = (testId: string) => Array.from(el().querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`));
  const validateButton = (index = 0) =>
    qa('lettering-proposal-validate')[index].querySelector('button') as HTMLButtonElement;

  function set(inputs: Record<string, unknown>): void {
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [LetteringProposalsStripComponent] });
    fixture = TestBed.createComponent(LetteringProposalsStripComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('suggestions', []);
  });

  it('affiche une carte par proposition et le badge du total trouvé', () => {
    set({ suggestions: [suggestion('k1'), suggestion('k2'), suggestion('k3')], totalFound: 12 });

    expect(qa('lettering-proposal-card').length).toBe(3);
    expect(q('lettering-proposals-badge')?.textContent?.trim()).toBe('12');
    expect(el().textContent).toContain('Propositions de lettrage');
    expect(el().textContent).not.toMatch(/\bIA\b/);
  });

  it('carte : catégorie, pièces, montant à 3 décimales, confiance en texte, raison principale', () => {
    set({ suggestions: [suggestion('k1')], totalFound: 1 });
    const card = qa('lettering-proposal-card')[0].textContent ?? '';

    expect(card).toContain('Correspondance exacte');
    expect(card).toContain('FAC-001');
    expect(card).toContain('REG-001');
    expect(card).toContain('1,250.500 TND');
    expect(card).toContain('Confiance élevée');
    expect(card).toContain('01/05/2026');
    expect(q('lettering-proposal-fx')).toBeNull();
  });

  it('affiche « + n écriture(s) » et le numéro d\'écriture sans pièce', () => {
    set({
      suggestions: [suggestion('k1', {
        debitLines: [sLine('d1', { debit: 50 }), sLine('d2', { debit: 50 })],
        creditLines: [sLine('c1', { credit: 100, pieceRef: 'REG-9' })]
      })]
    });
    const card = qa('lettering-proposal-card')[0].textContent ?? '';
    expect(card).toContain('N° 7 + 1 écriture(s)');
    expect(card).toContain('REG-9');
  });

  it('signale l\'écart de change', () => {
    set({ suggestions: [suggestion('k1', { hasExchangeDifference: true, currencyCode: 'EUR' })] });
    expect(q('lettering-proposal-fx')).not.toBeNull();
  });

  it('le corps de carte est un bouton avec un aria-label complet, sans répétition', () => {
    set({ suggestions: [suggestion('k1')] });
    const body = q('lettering-proposal-select') as HTMLButtonElement;
    const label = body.getAttribute('aria-label') ?? '';

    expect(body.tagName).toBe('BUTTON');
    expect(body.type).toBe('button');
    expect(label).toContain('Correspondance exacte');
    expect(label).toContain('FAC-001');
    expect(label).toContain('1,250.500 TND');
    expect(label).toContain('Confiance élevée');
    expect(label).not.toContain('Confiance Confiance');
  });

  it('clic sur la carte → selectSuggestion', () => {
    const s = suggestion('k1');
    set({ suggestions: [s], canCreate: true });
    const emitted: LetteringSuggestion[] = [];
    component.selectSuggestion.subscribe(v => emitted.push(v));

    q('lettering-proposal-select')!.click();

    expect(emitted).toEqual([s]);
  });

  it('lecture seule : le corps de carte est désactivé (les volets ne sont pas sélectionnables)', () => {
    set({ suggestions: [suggestion('k1')], canCreate: false });
    const emitted: LetteringSuggestion[] = [];
    component.selectSuggestion.subscribe(v => emitted.push(v));

    const body = q('lettering-proposal-select') as HTMLButtonElement;
    expect(body.disabled).toBeTrue();
    body.click();
    expect(emitted).toEqual([]);
  });

  it('le bouton de carte est décrit par la raison et l\'écart de change (lecteurs d\'écran)', () => {
    set({ suggestions: [suggestion('k1', { hasExchangeDifference: true, currencyCode: 'EUR' })] });
    const body = q('lettering-proposal-select') as HTMLButtonElement;
    const ids = (body.getAttribute('aria-describedby') ?? '').split(' ');

    expect(ids.length).toBe(2);
    const texts = ids.map(id => el().querySelector(`#${id}`)?.textContent ?? '');
    expect(texts[0]).toContain('Rapprochement détecté');
    expect(texts[1]).toContain('Écart de change');
  });

  it('« Valider » → validateSuggestion quand la validation est possible', () => {
    const s = suggestion('k1');
    set({ suggestions: [s], canCreate: true, canValidate: true });
    const emitted: LetteringSuggestion[] = [];
    component.validateSuggestion.subscribe(v => emitted.push(v));

    expect(validateButton().disabled).toBeFalse();
    validateButton().click();

    expect(emitted).toEqual([s]);
  });

  it('« Valider » désactivé sans droit, avec une info-bulle explicative', () => {
    set({ suggestions: [suggestion('k1')], canCreate: false, canValidate: false });

    expect(validateButton().disabled).toBeTrue();
    const wrapper = qa('lettering-proposal-validate')[0].parentElement as HTMLElement;
    expect(wrapper.getAttribute('title')).toContain('Comptabilité : création');
  });

  it('« Valider » désactivé sans info-bulle de droit quand une action est en cours', () => {
    set({ suggestions: [suggestion('k1'), suggestion('k2')], canCreate: true, canValidate: false, busyKey: 'k1' });

    expect(validateButton(0).disabled).toBeTrue();
    expect(validateButton(1).disabled).toBeTrue();
    expect(qa('lettering-proposal-card')[0].classList).toContain('proposals__card--busy');
    expect((qa('lettering-proposal-validate')[0].parentElement as HTMLElement).getAttribute('title')).toBeNull();
  });

  it('« Voir toutes les propositions » → showAll ; absent sans liste ou en erreur', () => {
    set({ suggestions: [suggestion('k1')], totalFound: 9 });
    let shown = 0;
    component.showAll.subscribe(() => shown++);

    const link = q('lettering-proposals-show-all')!;
    expect(link.textContent).toContain('(9)');
    link.click();
    expect(shown).toBe(1);

    set({ error: 'x' });
    expect(q('lettering-proposals-show-all')).toBeNull();
    set({ error: null, suggestions: [] });
    expect(q('lettering-proposals-show-all')).toBeNull();
  });

  describe('états', () => {
    it('chargement sans liste : indicateur annoncé, pas de badge', () => {
      set({ loading: true, totalFound: 4 });
      expect(q('lettering-proposals-loading')).not.toBeNull();
      expect(q('lettering-proposals-badge')).toBeNull();
      expect(q('lettering-proposals-strip')?.getAttribute('aria-busy')).toBe('true');
    });

    it('recalcul avec une liste : les cartes restent affichées', () => {
      set({ suggestions: [suggestion('k1')], loading: true });
      expect(q('lettering-proposals-loading')).toBeNull();
      expect(qa('lettering-proposal-card').length).toBe(1);
    });

    it('erreur : message en alerte, pas de cartes ni de note de troncature', () => {
      set({ suggestions: [suggestion('k1')], error: 'Service indisponible', truncated: true });
      expect(q('lettering-proposals-error')?.textContent).toContain('Service indisponible');
      expect(q('lettering-proposals-error')?.getAttribute('role')).toBe('alert');
      expect(qa('lettering-proposal-card').length).toBe(0);
      expect(q('lettering-proposals-truncated')).toBeNull();
    });

    it('vide : message neutre', () => {
      set({ suggestions: [] });
      expect(q('lettering-proposals-empty')?.textContent).toContain('Aucune proposition');
    });

    it('troncature : texte selon la raison', () => {
      set({ suggestions: [suggestion('k1')], truncated: true, truncationReason: 'TimeFuse' });
      expect(q('lettering-proposals-truncated')?.textContent).toContain('délai atteint');
      set({ truncationReason: 'CandidateCap' });
      expect(q('lettering-proposals-truncated')?.textContent).toContain('Trop de lignes');
      set({ truncationReason: null });
      expect(q('lettering-proposals-truncated')?.textContent).toContain('Recherche limitée');
    });
  });

  describe('messages après un clic', () => {
    it('« Sélection remplacée » + « Annuler » → undo', () => {
      set({ suggestions: [suggestion('k1')], notice: 'selected', canUndo: true });
      let undone = 0;
      component.undo.subscribe(() => undone++);

      expect(q('lettering-proposals-notice-selected')).not.toBeNull();
      q('lettering-proposals-undo')!.click();

      expect(undone).toBe(1);
    });

    it('« Sélection remplacée » masqué quand l\'annulation n\'est plus possible', () => {
      set({ suggestions: [suggestion('k1')], notice: 'selected', canUndo: false });
      expect(q('lettering-proposals-notice-selected')).toBeNull();
    });

    it('lignes non affichées : message et bouton « Fermer » → dismissNotice', () => {
      set({ suggestions: [suggestion('k1')], notice: 'linesNotVisible' });
      let dismissed = 0;
      component.dismissNotice.subscribe(() => dismissed++);

      const notice = q('lettering-proposals-notice-hidden')!;
      expect(notice.textContent).toContain('ne sont pas affichées');
      (notice.querySelector('button') as HTMLButtonElement).click();

      expect(dismissed).toBe(1);
    });

    it('complétion en cours : message qui dit de la terminer ou de l\'annuler', () => {
      set({ suggestions: [suggestion('k1')], notice: 'completion' });
      expect(q('lettering-proposals-notice-completion')?.textContent).toContain('terminez-la ou annulez-la');
    });

    it('action en cours : message dédié', () => {
      set({ suggestions: [suggestion('k1')], notice: 'busy' });
      expect(q('lettering-proposals-notice-busy')).not.toBeNull();
    });
  });
});
