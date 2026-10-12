import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { BulkLetteringResultDto, LetteringSuggestionDto, LetteringSuggestionLineDto } from '../../../services/accounting.service';
import { LETTERING_BULK_MAX_LINES_PER_GROUP, LetteringSuggestion } from '../../models/lettering-suggestions.models';
import { mapSuggestion } from '../../utils/lettering-suggestions';
import { LetteringBulkDialogComponent } from './lettering-bulk-dialog.component';

function sLine(id: string, over: Partial<LetteringSuggestionLineDto> = {}): LetteringSuggestionLineDto {
  return {
    lineId: id, entryId: `e-${id}`, entryDate: '2026-05-01T00:00:00', journalCode: 'JV', entryNumber: 3,
    pieceRef: `P-${id}`, label: id, debit: 0, credit: 0, debitInCurrency: 0, creditInCurrency: 0, ...over
  };
}

function suggestion(key: string, over: Partial<LetteringSuggestionDto> = {}): LetteringSuggestion {
  return mapSuggestion({
    key, kind: 'SameThirdPartyAmount', category: 'Exact', score: 50, confidence: 'High',
    accountNumber: '4111', currencyCode: 'TND', thirdPartyId: null, thirdPartyKind: 0, thirdPartyName: null,
    debitLines: [sLine(`d${key}`, { debit: 10 })], creditLines: [sLine(`c${key}`, { credit: 10 })],
    totalAmount: 10, localGap: 0, hasExchangeDifference: false, bulkEligible: true, reasons: [],
    ...over
  });
}

function report(over: Partial<BulkLetteringResultDto> = {}): BulkLetteringResultDto {
  return {
    requestId: 'r', total: 4, lettered: 1, alreadyLettered: 1, rejected: 1, notProcessed: 1,
    results: [
      { clientKey: 'a', status: 'Lettered', code: 'AB' },
      { clientKey: 'b', status: 'AlreadyLettered', code: 'AC' },
      { clientKey: 'c', status: 'Rejected', errorCode: 'LETTERING_ALREADY_LETTERED' },
      { clientKey: 'zz', status: 'NotProcessed' }
    ],
    ...over
  };
}

describe('LetteringBulkDialogComponent', () => {
  let fixture: ComponentFixture<LetteringBulkDialogComponent>;
  let component: LetteringBulkDialogComponent;

  const q = (testId: string) => document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  const qa = (testId: string) => Array.from(document.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`));
  const innerButton = (host: HTMLElement | null) => host?.querySelector('button') as HTMLButtonElement;
  // Le dialogue s'attache à <body> (appendTo) : on retire les restes avant et après chaque test.
  const removeLeftovers = () =>
    document.querySelectorAll('.lettering-bulk-dialog, .p-dialog-mask').forEach(e => e.remove());

  function set(inputs: Record<string, unknown>): void {
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
  }

  function collect<T>(emitter: { subscribe(fn: (v: T) => void): unknown }): T[] {
    const out: T[] = [];
    emitter.subscribe(v => out.push(v));
    return out;
  }

  beforeEach(() => {
    removeLeftovers();
    TestBed.configureTestingModule({
      imports: [LetteringBulkDialogComponent],
      providers: [provideNoopAnimations()]
    });
    fixture = TestBed.createComponent(LetteringBulkDialogComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('suggestions', []);
  });

  afterEach(() => {
    fixture.destroy();
    removeLeftovers();
  });

  describe('vue « choix »', () => {
    const ok = suggestion('a', { score: 90 });
    const fx = suggestion('fx', { score: 80, bulkEligible: false, hasExchangeDifference: true });
    const big = suggestion('big', {
      score: 70,
      debitLines: Array.from({ length: LETTERING_BULK_MAX_LINES_PER_GROUP }, (_, i) => sLine(`bd${i}`, { debit: 1 })),
      creditLines: [sLine('bc', { credit: LETTERING_BULK_MAX_LINES_PER_GROUP })]
    });
    const other = suggestion('o', { score: 60, bulkEligible: false });
    const overlap = suggestion('ov', { score: 50, debitLines: [sLine('da', { debit: 10 })] });
    const free = suggestion('f', { score: 40, confidence: 'Medium' });

    beforeEach(() => {
      set({ visible: true, suggestions: [free, overlap, other, big, fx, ok], selection: new Set(['a']), selectedCount: 1, lineCount: 2 });
    });

    it('trie par score, coche la sélection et grise chaque proposition bloquée avec sa raison', () => {
      const rows = qa('lettering-bulk-row');
      expect(rows.length).toBe(6);
      const checks = qa('lettering-bulk-check') as HTMLInputElement[];
      expect(checks.map(c => c.id)).toEqual([
        'lettering-bulk-a', 'lettering-bulk-fx', 'lettering-bulk-big', 'lettering-bulk-o', 'lettering-bulk-ov', 'lettering-bulk-f'
      ]);
      expect(checks.map(c => c.checked)).toEqual([true, false, false, false, false, false]);
      expect(checks.map(c => c.disabled)).toEqual([false, true, true, true, true, false]);

      const why = (key: string) => document.getElementById(`lettering-bulk-${key}-why`)?.textContent?.trim();
      expect(why('fx')).toContain('Écart de change');
      expect(why('big')).toContain('Trop de lignes');
      expect(why('o')).toContain('Non éligible');
      expect(why('ov')).toContain('déjà dans le lot');
      expect(why('a')).toBeUndefined();
      expect(checks[1].getAttribute('aria-describedby')).toBe('lettering-bulk-fx-why');
      expect(checks[0].getAttribute('aria-describedby')).toBeNull();
    });

    it('cocher émet la clé ; les boutons de sélection émettent', () => {
      const toggled = collect(component.toggle);
      const all = collect(component.selectAll);
      const none = collect(component.clearAll);

      (qa('lettering-bulk-check')[5] as HTMLInputElement).click();
      q('lettering-bulk-select-all')?.click();
      q('lettering-bulk-clear')?.click();

      expect(toggled).toEqual(['f']);
      expect(all.length).toBe(1);
      expect(none.length).toBe(1);
    });

    it('« Continuer » est désactivé sans proposition cochée', () => {
      set({ selection: new Set<string>(), selectedCount: 0 });
      expect(innerButton(q('lettering-bulk-next')).disabled).toBeTrue();
      expect((q('lettering-bulk-clear') as HTMLButtonElement).disabled).toBeTrue();
      component.toConfirm();
      expect(component.step()).toBe('choose');
    });

    it('« Annuler » ferme le dialogue', () => {
      const closed = collect(component.visibleChange);
      innerButton(q('lettering-bulk-cancel')).click();
      expect(closed).toEqual([false]);
    });
  });

  it('récapitulatif : un total par devise, jamais additionnés, et les comptes touchés', () => {
    set({
      visible: true,
      suggestions: [suggestion('a')],
      selection: new Set(['a']),
      selectedCount: 3,
      lineCount: 7,
      totals: new Map([['TND', 100.5], ['EUR', 50]]),
      accounts: ['4111', '4011']
    });

    const totals = qa('lettering-bulk-total').map(e => e.textContent?.trim() ?? '');
    expect(totals.length).toBe(2);
    expect(totals[0]).toContain('TND');
    expect(totals[0]).toContain('100');
    expect(totals[1]).toContain('EUR');
    expect(totals[1]).toContain('50');
    expect(q('lettering-bulk-accounts')?.textContent).toContain('4111, 4011');
    expect(q('lettering-bulk-summary')?.textContent).toContain('3 propositions cochées · 7 lignes');

    set({ selectedCount: 1, lineCount: 1 });
    expect(q('lettering-bulk-summary')?.textContent).toContain('1 proposition cochée · 1 ligne');
  });

  describe('vue « confirmation »', () => {
    beforeEach(() => {
      set({ visible: true, suggestions: [suggestion('a')], selection: new Set(['a']), selectedCount: 1, lineCount: 2, canRun: true });
      innerButton(q('lettering-bulk-next')).click();
      fixture.detectChanges();
    });

    it('demande une confirmation explicite avant tout envoi, au singulier pour une proposition', () => {
      expect(component.step()).toBe('confirm');
      expect(q('lettering-bulk-confirm-question')?.textContent?.trim()).toBe('Lettrer 1 proposition (2 lignes) ?');
      expect(q('lettering-bulk-confirm')?.textContent).toContain('définitif');
      expect(q('lettering-bulk-list')).toBeNull();
    });

    it('« Confirmer le lettrage » émet run une seule fois par clic ; rien sans canRun ni pendant l\'envoi', () => {
      const runs = collect(component.run);
      innerButton(q('lettering-bulk-run')).click();
      expect(runs.length).toBe(1);

      set({ running: true });
      component.confirm();
      set({ running: false, canRun: false });
      expect(innerButton(q('lettering-bulk-run')).disabled).toBeTrue();
      component.confirm();
      expect(runs.length).toBe(1);
    });

    it('focus : la question reçoit le focus à l\'entrée de la vue (le bouton « Continuer » a disparu)', () => {
      expect(document.activeElement).toBe(q('lettering-bulk-confirm-question'));
    });

    it('focus : « Retour » le place sur l\'introduction du choix', () => {
      innerButton(q('lettering-bulk-back')).click();
      fixture.detectChanges();
      expect(document.activeElement).toBe(q('lettering-bulk-intro'));
    });

    it('focus : une erreur (« Confirmer » remplacé par « Réessayer ») reçoit le focus', () => {
      set({ canRetry: true, error: 'Coupure.' });
      expect(document.activeElement).toBe(q('lettering-bulk-error'));
    });

    it('focus : le rapport reçoit le focus à son arrivée', () => {
      set({ result: report() });
      expect(document.activeElement).toBe(q('lettering-bulk-report-summary'));
    });

    it('« Retour » revient au choix, sauf pendant l\'envoi', () => {
      set({ running: true });
      component.back();
      expect(component.step()).toBe('confirm');
      set({ running: false });
      innerButton(q('lettering-bulk-back')).click();
      fixture.detectChanges();
      expect(component.step()).toBe('choose');
    });

    it('après une coupure : « Réessayer » remplace « Confirmer » et l\'erreur est annoncée', () => {
      const retries = collect(component.retry);
      set({ canRetry: true, error: 'Le serveur n\'a pas confirmé le lot.' });

      expect(q('lettering-bulk-run')).toBeNull();
      expect(q('lettering-bulk-error')?.getAttribute('role')).toBe('alert');
      innerButton(q('lettering-bulk-retry')).click();
      expect(retries.length).toBe(1);
    });

    it('pendant l\'envoi : fermeture refusée (croix, Échap et sortie programmatique)', () => {
      const closed = collect(component.visibleChange);
      set({ running: true });

      component.close();
      component.onVisibleChange(false);

      expect(closed).toEqual([]);
      expect(document.querySelector('.lettering-bulk-dialog .p-dialog-close-button')).toBeNull();
      expect(q('lettering-bulk-dialog')?.getAttribute('aria-busy')).toBe('true');
    });

    it('chaque réouverture repart de la vue « choix »', () => {
      set({ visible: false });
      set({ visible: true });
      expect(component.step()).toBe('choose');
    });
  });

  describe('rapport', () => {
    beforeEach(() => {
      set({
        visible: true,
        suggestions: [suggestion('a'), suggestion('b'), suggestion('c')],
        selection: new Set(['a', 'b', 'c']),
        selectedCount: 3,
        result: report()
      });
    });

    it('affiche les compteurs et le résultat de chaque proposition', () => {
      expect(q('lettering-bulk-count-lettered')?.textContent?.trim()).toBe('1');
      expect(q('lettering-bulk-count-already')?.textContent?.trim()).toBe('1');
      expect(q('lettering-bulk-count-rejected')?.textContent?.trim()).toBe('1');
      expect(q('lettering-bulk-count-not-processed')?.textContent?.trim()).toBe('1');

      const results = qa('lettering-bulk-result');
      expect(results.map(r => r.getAttribute('data-status'))).toEqual(['Lettered', 'AlreadyLettered', 'Rejected', 'NotProcessed']);
      expect(results[0].textContent).toContain('AB');
      expect(results[1].textContent).toContain('AC');
      expect(results[2].textContent).toContain('déjà lettrée');
      // Le rapport n'annonce pas un rechargement qui n'a lieu qu'à la fermeture.
      expect(results[2].textContent).not.toContain('actualisée');
      expect(results[3].textContent).toContain('zz');
      expect(q('lettering-bulk-report-summary')?.textContent).toContain('Lettrées : 1');
      expect(q('lettering-bulk-not-processed-hint')).not.toBeNull();
      expect(q('lettering-bulk-list')).toBeNull();
      expect(q('lettering-bulk-run')).toBeNull();
    });

    it('rapport sans proposition non traitée : pas d\'indication de relance', () => {
      set({ result: report({ notProcessed: 0, results: [{ clientKey: 'a', status: 'Lettered', code: 'AB' }] }) });
      expect(q('lettering-bulk-not-processed-hint')).toBeNull();
    });

    it('refus sans code connu : texte générique', () => {
      set({ result: report({ results: [{ clientKey: 'a', status: 'Rejected', errorCode: 'X' }] }) });
      expect(qa('lettering-bulk-result')[0].textContent).toContain('contrôles du serveur');
    });

    it('« Fermer » ferme le dialogue', () => {
      const closed = collect(component.visibleChange);
      innerButton(q('lettering-bulk-close')).click();
      expect(closed).toEqual([false]);
    });
  });
});
