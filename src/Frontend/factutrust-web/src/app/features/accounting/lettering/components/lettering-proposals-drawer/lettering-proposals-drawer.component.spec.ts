import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ErpLocaleService } from '@core/i18n/erp-locale.service';
import { LetteringSuggestionDto, LetteringSuggestionLineDto } from '../../../services/accounting.service';
import { LetteringSuggestion } from '../../models/lettering-suggestions.models';
import { mapSuggestion } from '../../utils/lettering-suggestions';
import { LETTERING_PROPOSALS_PAGE_SIZE, LetteringProposalsDrawerComponent } from './lettering-proposals-drawer.component';

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

function many(n: number): LetteringSuggestion[] {
  return Array.from({ length: n }, (_, i) => suggestion(`k${String(i).padStart(3, '0')}`, { score: 1000 - i }));
}

describe('LetteringProposalsDrawerComponent', () => {
  let fixture: ComponentFixture<LetteringProposalsDrawerComponent>;
  let component: LetteringProposalsDrawerComponent;
  const rtl = signal(false);

  const q = (testId: string) => document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  const qa = (testId: string) => Array.from(document.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`));
  const innerButton = (host: HTMLElement) => host.querySelector('button') as HTMLButtonElement;
  // Le tiroir s'attache à <body> (appendTo) et l'animation de sortie peut le laisser dans le
  // document partagé par tous les fichiers de spec : on retire les restes avant et après chaque test.
  const removeLeftovers = () =>
    document.querySelectorAll('.lettering-proposals-drawer, .p-drawer-mask').forEach(e => e.remove());

  function set(inputs: Record<string, unknown>): void {
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
  }

  beforeEach(() => {
    removeLeftovers();
    rtl.set(false);
    TestBed.configureTestingModule({
      imports: [LetteringProposalsDrawerComponent],
      providers: [provideNoopAnimations(), { provide: ErpLocaleService, useValue: { isRtl: () => rtl() } }]
    });
    fixture = TestBed.createComponent(LetteringProposalsDrawerComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('suggestions', []);
  });

  afterEach(() => {
    fixture.destroy();
    removeLeftovers();
  });

  describe('tri, filtres et pagination', () => {
    it('trie par score décroissant, puis par clé', () => {
      set({ suggestions: [suggestion('b', { score: 10 }), suggestion('c', { score: 90 }), suggestion('a', { score: 10 })] });
      expect(component.sorted().map(s => s.key)).toEqual(['c', 'a', 'b']);
    });

    it('filtre par catégorie et par confiance, et revient à la première page', () => {
      set({
        suggestions: [
          suggestion('e1', { category: 'Exact', confidence: 'High' }),
          suggestion('m1', { category: 'Multiple', confidence: 'Medium' }),
          suggestion('s1', { category: 'SameAmount', confidence: 'Low' }),
          suggestion('e2', { category: 'Exact', confidence: 'Low' })
        ]
      });
      component.page.set(3);

      component.setCategory('Exact');
      expect(component.filtered().map(s => s.key).sort()).toEqual(['e1', 'e2']);
      expect(component.page()).toBe(0);

      component.setConfidence('Low');
      expect(component.filtered().map(s => s.key)).toEqual(['e2']);

      component.resetFilters();
      expect(component.filtered().length).toBe(4);
    });

    it('une valeur de filtre inconnue revient à « Toutes »', () => {
      component.setCategory('Bogus');
      component.setConfidence('<script>');
      expect(component.category()).toBe('all');
      expect(component.confidence()).toBe('all');
    });

    it(`pagine par ${LETTERING_PROPOSALS_PAGE_SIZE} et borne la navigation`, () => {
      set({ suggestions: many(45) });

      expect(component.pageCount()).toBe(3);
      expect(component.pageItems().length).toBe(LETTERING_PROPOSALS_PAGE_SIZE);
      component.previousPage();
      expect(component.currentPage()).toBe(0);
      component.nextPage();
      component.nextPage();
      component.nextPage();
      expect(component.currentPage()).toBe(2);
      expect(component.pageItems().length).toBe(5);
      expect(component.rangeStart()).toBe(41);
      expect(component.rangeEnd()).toBe(45);
    });

    it('une liste raccourcie ne laisse jamais une page vide', () => {
      set({ suggestions: many(45) });
      component.nextPage();
      component.nextPage();
      set({ suggestions: many(25) });

      expect(component.currentPage()).toBe(1);
      expect(component.pageItems().length).toBe(5);
    });

    it('200 propositions : 10 pages', () => {
      set({ suggestions: many(200) });
      expect(component.pageCount()).toBe(10);
    });
  });

  describe('détail', () => {
    it('déplie et replie le détail ; une nouvelle liste replie tout', () => {
      set({ suggestions: [suggestion('k1')] });
      component.toggleDetails('k1');
      expect(component.isExpanded('k1')).toBeTrue();
      component.toggleDetails('k1');
      expect(component.isExpanded('k1')).toBeFalse();

      component.toggleDetails('k1');
      set({ suggestions: [suggestion('k1'), suggestion('k2')] });
      expect(component.isExpanded('k1')).toBeFalse();
    });
  });

  describe('position (RTL)', () => {
    it("vaut 'right' en LTR et 'left' en RTL", () => {
      expect(component.position()).toBe('right');
      rtl.set(true);
      expect(component.position()).toBe('left');
    });
  });

  describe('rendu', () => {
    it('affiche une ligne par proposition de la page, avec toutes les raisons dans le détail', () => {
      set({
        visible: true,
        suggestions: [
          suggestion('k1', {
            score: 90,
            thirdPartyName: 'Client SA',
            reasons: [
              { code: 'SameThirdParty', args: {} },
              { code: 'ExactAmount', args: { amount: '10', currency: 'TND' } }
            ]
          }),
          suggestion('k2', { score: 10 })
        ]
      });

      const items = qa('lettering-proposals-drawer-item');
      expect(items.length).toBe(2);
      expect(items[0].textContent).toContain('Client SA');
      expect(items[0].textContent).toContain('10.000 TND');
      expect(q('lettering-proposals-drawer-count')?.textContent?.trim()).toBe('2');

      const toggle = qa('lettering-proposals-drawer-toggle')[0];
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      toggle.click();
      fixture.detectChanges();

      const reasons = q('lettering-proposals-drawer-reasons');
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(reasons?.id).toBe(toggle.getAttribute('aria-controls') as string);
      expect(reasons?.querySelectorAll('li').length).toBe(2);
      expect(reasons?.textContent).toContain('Même tiers des deux côtés.');
      expect(reasons?.textContent).toContain('Montant identique : 10.000 TND.');
    });

    it('« Sélectionner » et « Valider » émettent la proposition', () => {
      const s = suggestion('k1');
      set({ visible: true, suggestions: [s], canCreate: true, canValidate: true });
      const selected: LetteringSuggestion[] = [];
      const validated: LetteringSuggestion[] = [];
      component.selectSuggestion.subscribe(v => selected.push(v));
      component.validateSuggestion.subscribe(v => validated.push(v));

      innerButton(q('lettering-proposals-drawer-select')!).click();
      innerButton(q('lettering-proposals-drawer-validate')!).click();

      expect(selected).toEqual([s]);
      expect(validated).toEqual([s]);
    });

    it('« Valider » désactivé sans droit (info-bulle) ou pendant une action', () => {
      set({ visible: true, suggestions: [suggestion('k1')], canCreate: false, canValidate: false });
      const host = q('lettering-proposals-drawer-validate')!;
      expect(innerButton(q('lettering-proposals-drawer-select')!).disabled).toBeTrue();
      expect(innerButton(host).disabled).toBeTrue();
      expect(host.parentElement?.getAttribute('title')).toContain('Comptabilité : création');

      set({ canCreate: true, busyKey: 'k1' });
      expect(innerButton(host).disabled).toBeTrue();
      expect(host.parentElement?.getAttribute('title')).toBeNull();
    });

    it('filtre via la liste déroulante', () => {
      set({
        visible: true,
        suggestions: [suggestion('e1', { category: 'Exact' }), suggestion('m1', { category: 'Multiple' })]
      });
      const select = q('lettering-proposals-filter-category') as unknown as HTMLSelectElement;
      select.value = 'Multiple';
      select.dispatchEvent(new Event('change'));
      fixture.detectChanges();

      expect(qa('lettering-proposals-drawer-item').length).toBe(1);
    });

    it('aucun résultat après filtre : message et « Effacer les critères »', () => {
      set({ visible: true, suggestions: [suggestion('e1', { category: 'Exact' })] });
      component.setCategory('Multiple');
      fixture.detectChanges();

      const noMatch = q('lettering-proposals-drawer-no-match')!;
      expect(noMatch).not.toBeNull();
      (noMatch.querySelector('button') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(qa('lettering-proposals-drawer-item').length).toBe(1);
    });

    it('pagination : boutons et plage affichée', () => {
      set({ visible: true, suggestions: many(25) });
      expect(q('lettering-proposals-drawer-range')?.textContent).toContain('1–20 sur 25');
      expect(innerButton(q('lettering-proposals-drawer-prev')!).disabled).toBeTrue();

      innerButton(q('lettering-proposals-drawer-next')!).click();
      fixture.detectChanges();

      expect(q('lettering-proposals-drawer-range')?.textContent).toContain('21–25 sur 25');
      expect(qa('lettering-proposals-drawer-item').length).toBe(5);
    });

    it('pas de pagination pour une seule page', () => {
      set({ visible: true, suggestions: many(3) });
      expect(q('lettering-proposals-drawer-next')).toBeNull();
    });

    it('états : vide, erreur, note de troncature', () => {
      set({ visible: true, suggestions: [] });
      expect(q('lettering-proposals-drawer-empty')).not.toBeNull();

      set({ suggestions: [suggestion('k1')], truncated: true });
      expect(q('lettering-proposals-drawer-truncated')).not.toBeNull();

      set({ error: 'Service indisponible' });
      expect(q('lettering-proposals-drawer-error')?.getAttribute('role')).toBe('alert');
      expect(q('lettering-proposals-drawer-truncated')).toBeNull();
      expect(qa('lettering-proposals-drawer-item').length).toBe(0);
    });

    it('lettrage en masse : masqué par défaut ; visible, il émet openBulk', () => {
      set({ visible: true, suggestions: [suggestion('k1')], canCreate: true, canValidate: true, bulkEligibleCount: 1 });
      expect(q('lettering-proposals-open-bulk')).toBeNull();

      set({ showBulk: true });
      let opened = 0;
      component.openBulk.subscribe(() => opened++);
      innerButton(q('lettering-proposals-open-bulk')!).click();
      expect(opened).toBe(1);

      set({ bulkEligibleCount: 0 });
      expect(innerButton(q('lettering-proposals-open-bulk')!).disabled).toBeTrue();
    });
  });
});
