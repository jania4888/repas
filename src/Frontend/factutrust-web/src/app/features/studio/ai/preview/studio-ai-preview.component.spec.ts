import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AiChatService } from '@features/ai-assistant/services/ai-chat.service';
import { AiStreamService } from '@features/ai-assistant/services/ai-stream.service';
import { StudioAiBuildService } from '../../studio-ai-build.service';
import { StudioNavService } from '../../studio-nav.service';
import { StudioAiSessionStore } from '../studio-ai-session.store';
import { STUDIO_AI_LABELS } from '../studio-ai-labels';
import { StudioAiPreviewComponent } from './studio-ai-preview.component';
import { studioAiSpecFixture, studioAiSpecWithViewsFixture } from './testing/studio-ai-spec.fixture';
import { StudioSystemSpec } from '../studio-ai.models';

describe('StudioAiPreviewComponent', () => {
  let fixture: ComponentFixture<StudioAiPreviewComponent>;
  let store: StudioAiSessionStore;

  beforeEach(async () => {
    const stream = jasmine.createSpyObj<AiStreamService>('AiStreamService', ['streamChat']);
    stream.streamChat.and.returnValue(of());
    const builds = jasmine.createSpyObj<StudioAiBuildService>('StudioAiBuildService', [
      'getPlanSpec', 'confirm', 'cancel', 'getCapabilities'
    ]);
    builds.getPlanSpec.and.returnValue(of());
    builds.cancel.and.returnValue(of());
    builds.getCapabilities.and.returnValue(of());
    const nav = jasmine.createSpyObj<StudioNavService>('StudioNavService', ['refresh']);
    const chat = jasmine.createSpyObj<AiChatService>('AiChatService', ['deleteConversation']);

    await TestBed.configureTestingModule({
      imports: [StudioAiPreviewComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        StudioAiSessionStore,
        { provide: AiStreamService, useValue: stream },
        { provide: StudioAiBuildService, useValue: builds },
        { provide: StudioNavService, useValue: nav },
        { provide: AiChatService, useValue: chat }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(StudioAiPreviewComponent);
    store = fixture.componentInstance.store;
    fixture.detectChanges();
  });

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  /** Amène le store dans l'état « proposition reçue, en attente de validation ». */
  function loadPlan(spec: StudioSystemSpec = studioAiSpecFixture()): void {
    store.plan.set({
      planId: 'plan-1',
      kind: 'CreateSystem',
      expiresAt: null,
      rowVersion: 'v1',
      summary: {
        kind: 'CreateSystem',
        title: 'Gestion des congés',
        steps: [],
        entities: [],
        warnings: ['Le champ « Indemnité » n’a pas de devise explicite.']
      }
    });
    store.spec.set(spec);
    store.draft.set(spec);
    store.phase.set('awaiting_confirmation');
    fixture.detectChanges();
  }

  it('shows the empty state while no plan has been received', () => {
    expect(text()).toContain(STUDIO_AI_LABELS.preview.emptyTitle);
    expect(text()).toContain(STUDIO_AI_LABELS.preview.emptyHint);
    expect((fixture.nativeElement as HTMLElement).querySelector('p-tabs')).toBeNull();
  });

  it('shows the capability banner when the preview is disabled by the administrator', () => {
    expect(text()).toContain(STUDIO_AI_LABELS.capabilities.previewDisabled);
  });

  it('renders the header, the counters and the plan warnings once a plan is loaded', () => {
    loadPlan();

    expect(text()).toContain('Gestion des congés');
    const chips = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.sai-chip')
    ).map(el => el.textContent?.replace(/\s+/g, ' ').trim());
    expect(chips).toContain(`2 ${STUDIO_AI_LABELS.preview.tables}`);
    expect(chips).toContain(`8 ${STUDIO_AI_LABELS.preview.fields}`);
    expect(chips).toContain(`2 ${STUDIO_AI_LABELS.preview.relations}`);
    expect(text()).toContain('devise explicite');
  });

  it('rend dix onglets dont un seul désactivé (Pages)', () => {
    loadPlan();

    const tabs = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('p-tab')).map(
      tab => tab.textContent?.replace(/\s+/g, ' ').trim() ?? ''
    );
    expect(tabs.length).toBe(10);
    expect(tabs.some(l => l.includes('Vues'))).toBeTrue();
    expect(tabs.indexOf(tabs.find(l => l.includes('Vues'))!))
      .withContext('« Vues » précède « Workflow »')
      .toBeLessThan(tabs.indexOf(tabs.find(l => l.includes('Workflow'))!));

    const disabled = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('p-tab.p-disabled')
    ).map(tab => tab.textContent?.replace(/\s+/g, ' ').trim() ?? '');
    expect(disabled.length).toBe(1);
    expect(disabled[0]).toContain('Pages');
    expect(disabled[0]).toContain(STUDIO_AI_LABELS.soon);
    expect(tabs.find(l => l.includes('Workflow'))).not.toContain(STUDIO_AI_LABELS.soon);
  });

  it('compte les vues dans l’onglet et la puce', () => {
    loadPlan(studioAiSpecWithViewsFixture());
    const host = fixture.nativeElement as HTMLElement;

    const viewsTab = Array.from(host.querySelectorAll('p-tab'))
      .map(tab => tab.textContent?.replace(/\s+/g, ' ').trim() ?? '')
      .find(l => l.includes('Vues'));
    expect(viewsTab).toContain('2');
    expect(fixture.componentInstance.tabCount('views')).toBe(2);
    expect(fixture.componentInstance.tabCount('workflow')).withContext('aucun workflow ⇒ pas de compteur').toBeNull();

    const chips = Array.from(host.querySelectorAll('.sai-chips .sai-chip')).map(
      el => el.textContent?.replace(/\s+/g, ' ').trim()
    );
    expect(chips).toContain(`2 ${STUDIO_AI_LABELS.views.title}`);
  });

  it('affiche la barre de modes à la place du bouton Modifier', () => {
    loadPlan();
    const emitted: number[] = [];
    fixture.componentInstance.confirmRequested.subscribe(() => emitted.push(1));
    const host = fixture.nativeElement as HTMLElement;

    const buttons = Array.from(host.querySelectorAll('button'));
    const create = buttons.find(b => b.textContent?.includes(STUDIO_AI_LABELS.preview.createNow));
    const edit = buttons.find(b => b.textContent?.trim() === STUDIO_AI_LABELS.preview.edit);
    expect(edit).withContext('l’ancien bouton « Modifier » a disparu').toBeUndefined();
    expect(host.querySelector('app-studio-ai-mode-bar')).not.toBeNull();

    const modes = Array.from(host.querySelectorAll<HTMLButtonElement>('.sai-modebar__btn'));
    expect(modes.length).toBe(3);
    expect(modes.find(b => b.dataset['mode'] === 'preview')?.getAttribute('aria-pressed')).toBe('true');

    modes.find(b => b.dataset['mode'] === 'customize')?.click();
    fixture.detectChanges();
    expect(store.mode()).toBe('customize');
    expect(store.phase()).withContext('Personnaliser démarre l’édition').toBe('editing');
    expect(text()).toContain(STUDIO_AI_LABELS.preview.editingSubtitle);

    expect(create?.disabled).withContext('canConfirm est vrai en attente de validation').toBeFalse();
    create?.click();
    expect(emitted.length).toBe(1);
  });

  it('bloque Créer maintenant quand le plan est expiré', () => {
    loadPlan();
    store.expiresInSeconds.set(0);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    const create = Array.from(host.querySelectorAll('button'))
      .find(b => b.textContent?.includes(STUDIO_AI_LABELS.preview.createNow));
    expect(create?.disabled).toBeTrue();
    expect(fixture.componentInstance.confirmTooltip()).toBe(STUDIO_AI_LABELS.preview.expired);
    expect(text()).toContain(STUDIO_AI_LABELS.modes.expired);
    expect(Array.from(host.querySelectorAll<HTMLButtonElement>('.sai-modebar__btn')).every(b => b.disabled)).toBeTrue();
  });

  it('erreur de brouillon (409) affichée dans un bandeau d’erreur', () => {
    loadPlan();
    store.validation.set({ warnings: [], errors: [STUDIO_AI_LABELS.errors.conflict], pending: false });
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    const banners = Array.from(host.querySelectorAll('[data-testid="sai-validation-error"]'));
    expect(banners.length).toBe(1);
    expect(banners[0].getAttribute('role')).toBe('alert');
    expect(banners[0].classList.contains('sai-banner--error')).toBeTrue();
    expect(banners[0].textContent).toContain(STUDIO_AI_LABELS.errors.conflict);
  });

  it('switches to the Tables tab when the overview asks to open an entity', () => {
    loadPlan();
    const opened: string[] = [];
    fixture.componentInstance.openEntity.subscribe(ref => opened.push(ref));

    fixture.componentInstance.selectEntity('demandes');
    fixture.detectChanges();

    expect(fixture.componentInstance.activeTab()).toBe('tables');
    expect(fixture.componentInstance.selectedRef()).toBe('demandes');
    expect(opened).toEqual(['demandes']);
  });

  it('shows a skeleton while the detailed spec is still loading', () => {
    store.plan.set({
      planId: 'plan-1',
      kind: 'CreateSystem',
      expiresAt: null,
      rowVersion: null,
      summary: { kind: 'CreateSystem', title: 'Gestion des congés', steps: [], entities: [], warnings: [] }
    });
    store.specLoading.set(true);
    fixture.detectChanges();

    expect(text()).toContain(STUDIO_AI_LABELS.preview.loadingSpec);
    expect((fixture.nativeElement as HTMLElement).querySelector('p-skeleton')).not.toBeNull();
  });

  /** Amène le store dans l'état « plan Workflow sans spec » (4.4k1 : le résumé seul alimente l'aperçu). */
  function loadWorkflowPlan(): void {
    store.plan.set({
      planId: 'plan-1',
      kind: 'Workflow',
      expiresAt: null,
      rowVersion: 'v1',
      summary: {
        kind: 'Workflow',
        title: 'Validation congés',
        steps: [],
        entities: [],
        warnings: [],
        workflows: [
          {
            key: 'validation-conges', name: 'Validation des congés', trigger: 'on_create', isActive: false,
            stepCount: 2,
            steps: [
              { key: 'appro', type: 'approval', label: 'Approbation du manager' },
              { key: 'notif', type: 'notify', label: 'Notifier le salarié' }
            ]
          }
        ]
      }
    });
    store.spec.set(null);
    store.draft.set(null);
    store.specLoading.set(false);
    store.phase.set('awaiting_confirmation');
    fixture.detectChanges();
  }

  it('affiche l’onglet Workflow seul et garde « Créer maintenant » actif pour un plan Workflow sans spec', () => {
    loadWorkflowPlan();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('[data-testid="sai-workflow-only"]')).not.toBeNull();
    expect(host.querySelector('p-tabs')).withContext('les dix onglets ne sont pas rendus').toBeNull();
    expect(host.querySelector('p-skeleton')).withContext('le skeleton est court-circuité').toBeNull();
    expect(host.querySelector('[data-component-id="sai-workflow-cards"]')).not.toBeNull();
    expect(text()).toContain('Validation des congés');

    const create = Array.from(host.querySelectorAll('button'))
      .find(b => b.textContent?.includes(STUDIO_AI_LABELS.preview.createNow));
    expect(create?.disabled).withContext('canConfirm ne dépend pas de la spec').toBeFalse();
  });

  it('désactive Tester et Personnaliser pour un plan Workflow', () => {
    loadWorkflowPlan();
    const host = fixture.nativeElement as HTMLElement;

    const modes = Array.from(host.querySelectorAll<HTMLButtonElement>('.sai-modebar__btn'));
    expect(modes.find(b => b.dataset['mode'] === 'test')?.disabled)
      .withContext('Tester exige une spec').toBeTrue();
    expect(modes.find(b => b.dataset['mode'] === 'customize')?.disabled)
      .withContext('Personnaliser exige une spec').toBeTrue();
    expect(modes.find(b => b.dataset['mode'] === 'preview')?.disabled).toBeFalse();
  });
});
