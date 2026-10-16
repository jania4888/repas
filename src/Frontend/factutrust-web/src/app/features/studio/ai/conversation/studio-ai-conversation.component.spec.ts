import { TestBed, fakeAsync, flushMicrotasks } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { StudioAiTimelineItem } from '../studio-ai-session.store';
import { StudioAiConversationComponent } from './studio-ai-conversation.component';

const FAILURE_ITEM: StudioAiTimelineItem = {
  kind: 'failure',
  failure: {
    message: 'Une erreur est survenue pendant le calcul.',
    suggestions: [{ preset: 'ventes_annee', label: 'Ventes par année', prompt: 'Ventes par année' }],
    retryable: true
  }
};

const ITEMS: StudioAiTimelineItem[] = [
  { kind: 'text', role: 'user', text: 'Créer un système de congés' },
  { kind: 'text', role: 'assistant', text: 'Voici la proposition.' },
  FAILURE_ITEM
];

describe('StudioAiConversationComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StudioAiConversationComponent],
      providers: [provideNoopAnimations()]
    }).compileComponents();
  });

  function create(items: StudioAiTimelineItem[] = ITEMS) {
    const fixture = TestBed.createComponent(StudioAiConversationComponent);
    fixture.componentRef.setInput('items', items);
    fixture.componentRef.setInput('suggestions', ['Ajoute un champ « Motif »']);
    fixture.componentRef.setInput('lastPrompt', 'Créer un système de congés');
    fixture.detectChanges();
    return fixture;
  }

  it('rend les bulles utilisateur / assistant et la carte d’échec classée', () => {
    const fixture = create();
    const text = fixture.nativeElement.textContent as string;
    expect(fixture.nativeElement.querySelectorAll('.saic__bubble').length).toBe(2);
    expect(fixture.nativeElement.querySelector('.saic__bubble--user')?.textContent).toContain('Créer un système de congés');
    expect(text).toContain('Erreur de calcul');
    expect(text).toContain('Réessayer');
  });

  it('émet « retry » depuis la carte d’échec et « useSuggestion » depuis une reformulation', () => {
    const fixture = create();
    let retries = 0;
    const suggestions: string[] = [];
    fixture.componentInstance.retry.subscribe(() => retries++);
    fixture.componentInstance.useSuggestion.subscribe(prompt => suggestions.push(prompt));

    (fixture.nativeElement.querySelector('.saic__retry') as HTMLButtonElement).click();
    (fixture.nativeElement.querySelector('.saic__failure .saic__chip') as HTMLButtonElement).click();

    expect(retries).toBe(1);
    expect(suggestions).toEqual(['Ventes par année']);
  });

  it('émet « usePrompt » depuis une puce de suggestion', () => {
    const fixture = create([]);
    const prompts: string[] = [];
    fixture.componentInstance.usePrompt.subscribe(prompt => prompts.push(prompt));

    (fixture.nativeElement.querySelector('.saic__chip') as HTMLButtonElement).click();

    expect(prompts).toEqual(['Ajoute un champ « Motif »']);
  });

  it('affiche la ligne de statut pendant le travail et la bannière d’erreur', () => {
    const fixture = create();
    fixture.componentRef.setInput('busy', true);
    fixture.componentRef.setInput('status', 'Analyse de votre demande…');
    fixture.componentRef.setInput('error', 'Trop de demandes.');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.saic__status').textContent).toContain('Analyse de votre demande…');
    expect(fixture.nativeElement.querySelector('.saic__error').textContent).toContain('Trop de demandes.');
  });

  it('replie le fil au clic sur l’en-tête', () => {
    const scrollIntoView = spyOn(Element.prototype, 'scrollIntoView');
    const scrollTo = spyOn(window, 'scrollTo');
    const fixture = create();
    (fixture.nativeElement.querySelector('.saic__toggle') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(fixture.componentInstance.collapsed()).toBeTrue();
    expect(fixture.nativeElement.querySelector('.saic__body')).toBeNull();
    expect(fixture.nativeElement.querySelector('.saic__toggle').textContent).toContain('Afficher la conversation');
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('aligne la dernière question en haut du fil, sans descendre jusqu’au bas du tableau', fakeAsync(() => {
    const scrollIntoView = spyOn(Element.prototype, 'scrollIntoView');
    const pageY = window.scrollY;
    const earlier: StudioAiTimelineItem[] = Array.from({ length: 8 }, (_, i) => ({
      kind: 'text' as const,
      role: 'assistant' as const,
      text: `Tour précédent ${i} — ${'ligne '.repeat(12)}`
    }));
    const items: StudioAiTimelineItem[] = [
      ...earlier,
      { kind: 'text', role: 'user', text: 'Créer un rapport d’articles par fournisseur' },
      {
        kind: 'report',
        report: {
          success: true,
          title: 'Achats par fournisseur',
          source: 'purchases',
          sourceLabel: 'Achats',
          result: {
            columns: [
              { key: 'name', label: 'Fournisseur', kind: 'dimension' },
              { key: 'total', label: 'Total', kind: 'measure', numeric: true }
            ],
            rows: [{ name: 'Ste samir', total: 6770.55 }, { name: 'Ste Mbarki', total: 583.1 }],
            totalRows: 2
          },
          warnings: [],
          message: ''
        }
      }
    ];

    const fixture = create(items);
    const report = fixture.nativeElement.querySelector('.saic__report') as HTMLElement;
    report.style.minHeight = '40rem';
    TestBed.flushEffects();
    flushMicrotasks();

    const body = fixture.nativeElement.querySelector('.saic__body') as HTMLElement;
    const users = body.querySelectorAll('.saic__bubble--user');
    const lastUser = users[users.length - 1] as HTMLElement;
    const delta = lastUser.getBoundingClientRect().top - body.getBoundingClientRect().top;
    expect(Math.abs(delta)).toBeLessThan(2);
    expect(body.scrollTop).toBeLessThan(body.scrollHeight - body.clientHeight);
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(window.scrollY).toBe(pageY);
  }));
});
