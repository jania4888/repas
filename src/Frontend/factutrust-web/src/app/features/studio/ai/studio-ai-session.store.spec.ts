import { TestBed, discardPeriodicTasks, fakeAsync, tick } from '@angular/core/testing';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject, of, throwError } from 'rxjs';
import { AiChatService } from '@features/ai-assistant/services/ai-chat.service';
import { AiStreamService } from '@features/ai-assistant/services/ai-stream.service';
import { ChatAttachment, ChatStreamEvent } from '@features/ai-assistant/models/ai-chat.models';
import { StudioAiBuildService, StudioPlanSummary } from '../studio-ai-build.service';
import { StudioNavService } from '../studio-nav.service';
import { STUDIO_AI_LABELS } from './studio-ai-labels';
import { STUDIO_SPEC_LIMITS, StudioAppSpec, StudioDuplicateHint, StudioSystemSpec } from './studio-ai.models';
import { studioAiPlanPreviewFixture } from './preview/testing/studio-ai-spec.fixture';
import {
  STUDIO_AI_ADVANCED_MODEL_STORAGE_KEY,
  StudioAiSessionStore,
  normalizeSummary,
  parseActions,
  parsePlanSummary,
  parseStreamMeta,
  withSuffix
} from './studio-ai-session.store';

/** Spec renvoyée par `GET {id}/spec` dans les tests. */
function spec(): StudioSystemSpec {
  return {
    system: { displayName: 'Congés' },
    entities: [
      {
        ref: 'employe',
        displayName: 'Employé',
        displayNamePlural: 'Employés',
        fields: [{ key: 'nom', label: 'Nom', type: 'text', required: true, unique: false }]
      }
    ]
  };
}

function summary(over: Partial<StudioPlanSummary> = {}): StudioPlanSummary {
  return {
    kind: 'CreateSystem',
    title: 'Gestion des congés',
    steps: [],
    entities: [],
    warnings: [],
    ...over
  } as StudioPlanSummary;
}

function planEvent(planId = 'p-1'): ChatStreamEvent {
  return { type: 'studio_plan', content: JSON.stringify({ planId, summary: summary() }) };
}

describe('StudioAiSessionStore', () => {
  let store: StudioAiSessionStore;
  let stream: jasmine.SpyObj<AiStreamService>;
  let builds: jasmine.SpyObj<StudioAiBuildService>;
  let nav: jasmine.SpyObj<StudioNavService>;
  let chat: jasmine.SpyObj<AiChatService>;

  const specResponse = (rowVersion = 'rv-1') => ({
    success: true,
    data: { id: 'p-1', kind: 'CreateSystem', status: 'Pending', expiresAt: '2026-09-09T10:00:00Z', rowVersion, spec: spec() },
    message: null,
    errors: []
  });

  beforeEach(() => {
    stream = jasmine.createSpyObj<AiStreamService>('AiStreamService', ['streamChat']);
    builds = jasmine.createSpyObj<StudioAiBuildService>('StudioAiBuildService', [
      'confirm', 'cancel', 'cancelPending', 'getPlanSpec', 'updatePlanSpec', 'listPlans', 'createFromTemplate', 'getPlan',
      'getPlanPreview', 'replayPlan', 'importSystem', 'duplicateSystem'
    ]);
    nav = jasmine.createSpyObj<StudioNavService>('StudioNavService', ['refresh']);
    chat = jasmine.createSpyObj<AiChatService>('AiChatService', ['deleteConversation']);

    stream.streamChat.and.returnValue(of());
    builds.getPlanSpec.and.returnValue(of(specResponse()) as never);
    builds.confirm.and.returnValue(of() as never);
    builds.cancel.and.returnValue(of({ success: true, data: null, message: null, errors: [] }) as never);
    builds.cancelPending.and.returnValue(of({ success: true, data: 1, message: null, errors: [] }) as never);
    builds.listPlans.and.returnValue(of({
      success: true, message: null, errors: [],
      data: { items: [], page: 1, pageSize: 5, totalCount: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false }
    }) as never);
    chat.deleteConversation.and.returnValue(of(undefined));
    localStorage.removeItem(STUDIO_AI_ADVANCED_MODEL_STORAGE_KEY);

    TestBed.configureTestingModule({
      providers: [
        StudioAiSessionStore,
        { provide: AiStreamService, useValue: stream },
        { provide: StudioAiBuildService, useValue: builds },
        { provide: StudioNavService, useValue: nav },
        { provide: AiChatService, useValue: chat },
        { provide: Router, useValue: { navigate: jasmine.createSpy('navigate'), navigateByUrl: jasmine.createSpy('navigateByUrl') } }
      ]
    });
    store = TestBed.inject(StudioAiSessionStore);
  });

  describe('send', () => {
    it('ignores an empty message', () => {
      store.send('   ');
      expect(stream.streamChat).not.toHaveBeenCalled();
      expect(store.phase()).toBe('idle');
    });

    it('switches to planning and pushes the user message', () => {
      const events = new Subject<ChatStreamEvent>();
      stream.streamChat.and.returnValue(events.asObservable());

      store.send('Créer un système de congés', { intent: 'system' });

      expect(store.phase()).toBe('planning');
      expect(store.status()).toBe(STUDIO_AI_LABELS.status.analyzing);
      expect(store.intent()).toBe('system');
      expect(store.timeline()).toEqual([{ kind: 'text', role: 'user', text: 'Créer un système de congés' }]);
      expect(stream.streamChat.calls.mostRecent().args[0].message).toBe('Créer un système de congés');
    });

    it('shows only the prompt in the timeline but sends the attachment text to the backend', () => {
      const events = new Subject<ChatStreamEvent>();
      stream.streamChat.and.returnValue(events.asObservable());
      const attachment: ChatAttachment = {
        id: 'a1', fileName: 'clients.csv', format: 'csv', sizeBytes: 10, pageCount: 1,
        ocrApplied: false, truncated: false, fullText: 'nom;ville', pages: [], warnings: []
      };

      store.send('Importe ces clients', { attachments: [attachment] });

      expect(store.timeline()).toEqual([{ kind: 'text', role: 'user', text: 'Importe ces clients' }]);
      expect(store.lastPrompt()).toBe('Importe ces clients');
      const request = stream.streamChat.calls.mostRecent().args[0];
      expect(request.message).toContain('Importe ces clients');
      expect(request.message).toContain('[PIÈCE JOINTE : clients.csv]');
      expect(request.message).toContain('nom;ville');
      expect(request.attachments).toEqual([jasmine.objectContaining({ fileName: 'clients.csv', format: 'csv' })]);

      // « Réessayer » renvoie la même demande AVEC ses pièces jointes.
      events.error(new Error('boom'));
      store.retry();
      const retried = stream.streamChat.calls.mostRecent().args[0];
      expect(retried.message).toContain('[PIÈCE JOINTE : clients.csv]');
      expect(retried.attachments?.length).toBe(1);
    });

    it('unsubscribes from the open chat stream when destroyed', () => {
      const events = new Subject<ChatStreamEvent>();
      stream.streamChat.and.returnValue(events.asObservable());
      store.send('Créer');
      expect(events.observed).toBeTrue();

      store.ngOnDestroy();

      expect(events.observed).toBeFalse();
    });

    it('moves to awaiting_confirmation on studio_plan and loads the spec', () => {
      const events = new Subject<ChatStreamEvent>();
      stream.streamChat.and.returnValue(events.asObservable());

      store.send('Créer un système de congés');
      events.next(planEvent());

      expect(store.phase()).toBe('awaiting_confirmation');
      expect(store.status()).toBe(STUDIO_AI_LABELS.status.awaitingValidation);
      expect(builds.getPlanSpec).toHaveBeenCalledWith('p-1');
      expect(store.plan()?.planId).toBe('p-1');
      expect(store.plan()?.rowVersion).toBe('rv-1');
      expect(store.plan()?.expiresAt).toBe('2026-09-09T10:00:00Z');
      expect(store.spec()?.entities.length).toBe(1);
      expect(store.draft()).toEqual(store.spec());
      expect(store.draft()).not.toBe(store.spec());
      expect(store.counters().entities).toBe(1);
      expect(store.dirty()).toBeFalse();
      expect(store.canConfirm()).toBeTrue();
      expect(store.canEdit()).toBeTrue();
    });

    it('reports an unreadable spec payload', () => {
      const events = new Subject<ChatStreamEvent>();
      stream.streamChat.and.returnValue(events.asObservable());
      builds.getPlanSpec.and.returnValue(of({ success: true, data: { spec: 'pas du json' }, message: null, errors: [] }) as never);

      store.send('Créer');
      events.next(planEvent());

      expect(store.error()).toBe(STUDIO_AI_LABELS.errors.invalidSpec);
      expect(store.spec()).toBeNull();
    });

    it('tolère un plan Workflow sans spec lisible : pas d’erreur, spec nulle, canConfirm vrai', () => {
      const events = new Subject<ChatStreamEvent>();
      stream.streamChat.and.returnValue(events.asObservable());
      builds.getPlanSpec.and.returnValue(of({
        success: true,
        data: { kind: 'Workflow', spec: '{"workflows":[]}', rowVersion: 'v2', expiresAt: null },
        message: null,
        errors: []
      }) as never);

      store.send('Créer un workflow');
      events.next({ type: 'studio_plan', content: JSON.stringify({ planId: 'p-1', summary: summary({ kind: 'Workflow' }) }) });

      expect(store.error()).withContext('D12 : un plan Workflow n’a pas de StudioSystemSpec').toBeNull();
      expect(store.spec()).toBeNull();
      expect(store.plan()?.kind).toBe('Workflow');
      expect(store.plan()?.rowVersion).toBe('v2');
      expect(store.canConfirm()).withContext('canConfirm ne dépend pas de la spec').toBeTrue();
      expect(store.canEdit()).toBeFalse();
    });

    it('keeps the plan when the chat stream fails after the plan arrived', () => {
      const events = new Subject<ChatStreamEvent>();
      stream.streamChat.and.returnValue(events.asObservable());

      store.send('Créer');
      events.next(planEvent());
      events.error(new Error('flux coupé'));

      expect(store.phase()).toBe('awaiting_confirmation');
      expect(store.error()).toBe('flux coupé');
      expect(store.plan()?.planId).toBe('p-1');
    });

    it('fails when the chat stream errors before any plan', () => {
      const events = new Subject<ChatStreamEvent>();
      stream.streamChat.and.returnValue(events.asObservable());

      store.send('Créer');
      events.error(new Error('flux coupé'));

      expect(store.phase()).toBe('failed');
      expect(store.plan()).toBeNull();
    });

    it('flushes the assistant text and refreshes the nav when no plan was produced', () => {
      const events = new Subject<ChatStreamEvent>();
      stream.streamChat.and.returnValue(events.asObservable());

      store.send('Bonjour');
      events.next({ type: 'content', content: 'Voici ' });
      events.next({ type: 'content', content: 'la réponse.' });
      events.next({ type: 'done', conversationId: 'c-1' });
      events.complete();

      expect(store.conversationId()).toBe('c-1');
      expect(store.timeline()[1]).toEqual({ kind: 'text', role: 'assistant', text: 'Voici la réponse.' });
      expect(nav.refresh).toHaveBeenCalled();
      expect(store.phase()).toBe('idle');
    });

    it('ignores content_replace after a failure card in the same turn, but not on the next turn', () => {
      const events = new Subject<ChatStreamEvent>();
      stream.streamChat.and.returnValue(events.asObservable());
      store.send('Rapport CA');
      events.next({ type: 'studio_report_error', content: JSON.stringify({ message: 'Aucune donnée', suggestions: [] }) });
      events.next({ type: 'content_replace', content: 'Texte à ignorer' });
      events.next({ type: 'done' });
      events.complete();
      expect(store.timeline().filter(i => i.kind === 'text' && i.role === 'assistant')).toEqual([]);
      expect(store.phase()).toBe('idle');

      const next = new Subject<ChatStreamEvent>();
      stream.streamChat.and.returnValue(next.asObservable());
      store.send('Rapport CA 2025');
      next.next({ type: 'content_replace', content: 'Voici le rapport' });
      next.next({ type: 'done' });
      expect(store.timeline().pop()).toEqual({ kind: 'text', role: 'assistant', text: 'Voici le rapport' });
    });

    it('collects suggestions and client actions', () => {
      const events = new Subject<ChatStreamEvent>();
      stream.streamChat.and.returnValue(events.asObservable());

      store.send('Créer');
      events.next({ type: 'suggested_prompts', suggestedPrompts: JSON.stringify(['Ajouter un rapport', 42]) });
      events.next({ type: 'client_actions', clientActions: JSON.stringify([{ label: 'Ouvrir', route: '/studio' }, { label: 'Non', route: 'studio' }]) });

      expect(store.suggestions()).toEqual(['Ajouter un rapport']);
      expect(store.actions()).toEqual([{ label: 'Ouvrir', route: '/studio' }]);
    });
  });

  describe('confirm', () => {
    function withPlan(): Subject<ChatStreamEvent> {
      const chat = new Subject<ChatStreamEvent>();
      stream.streamChat.and.returnValue(chat.asObservable());
      store.send('Créer');
      chat.next(planEvent());
      return chat;
    }

    it('executes the plan then completes and refreshes the nav', () => {
      withPlan();
      const exec = new Subject<ChatStreamEvent>();
      builds.confirm.and.returnValue(exec.asObservable() as never);

      store.confirm();
      expect(store.phase()).toBe('executing');
      expect(store.status()).toBe(STUDIO_AI_LABELS.status.creating);
      expect(builds.confirm).toHaveBeenCalledWith('p-1');

      exec.next({ type: 'studio_progress', content: JSON.stringify({ phase: 'entities', label: 'Tables', status: 'running' }) });
      exec.next({ type: 'studio_progress', content: JSON.stringify({ phase: 'entities', label: 'Tables', status: 'done' }) });
      exec.next({
        type: 'studio_result',
        content: JSON.stringify({
          success: true, systemKey: 'conges', systemUrl: '/studio/systems/conges', displayName: 'Congés',
          entityCount: 1, entities: [], warnings: [], message: 'ok'
        })
      });
      exec.complete();

      expect(store.buildSteps().length).toBe(1);
      expect(store.buildSteps()[0].status).toBe('done');
      expect(store.phase()).toBe('completed');
      expect(store.resultUrl()).toBe('/studio/systems/conges');
      expect(store.timeline().some(i => i.kind === 'system' && i.text === STUDIO_AI_LABELS.status.created)).toBeTrue();
      expect(nav.refresh).toHaveBeenCalled();
    });

    it('resultUrl pointe vers le premier workflow créé pour un résultat workflow', () => {
      store.result.set({
        success: true,
        workflows: [{ id: 'w1', key: 'validation_conges', entityKey: 'demandes_conge', name: 'Validation des congés', stepCount: 3 }],
        openUrl: '/studio/workflows',
        warnings: [],
        message: 'Workflow créé.'
      });
      expect(store.resultUrl()).toBe('/studio/workflows/w1');

      store.result.set({ workflows: [] });
      expect(store.resultUrl()).toBeNull();
    });

    it('fails and clears the plan when the execution stream errors', () => {
      withPlan();
      builds.confirm.and.returnValue(throwError(() => new Error('boom')) as never);

      store.confirm();

      expect(store.phase()).toBe('failed');
      expect(store.error()).toBe('boom');
      expect(store.plan()).toBeNull();
      expect(store.spec()).toBeNull();
      expect(store.draft()).toBeNull();
    });

    it('fails on an error event inside the execution stream', () => {
      withPlan();
      const exec = new Subject<ChatStreamEvent>();
      builds.confirm.and.returnValue(exec.asObservable() as never);

      store.confirm();
      exec.next({ type: 'error', error: 'quota' });

      expect(store.phase()).toBe('failed');
      expect(store.error()).toBe('quota');
    });

    it('does nothing while the draft is dirty', () => {
      withPlan();
      const draft = store.draft()!;
      store.startEditing();
      store.updateDraft({ ...draft, system: { displayName: 'Autre' } });

      expect(store.dirty()).toBeTrue();
      expect(store.canConfirm()).toBeFalse();
      store.confirm();
      expect(builds.confirm).not.toHaveBeenCalled();
    });
  });

  describe('cancelPlan / resetConversation', () => {
    function withPlan(): void {
      const chat = new Subject<ChatStreamEvent>();
      stream.streamChat.and.returnValue(chat.asObservable());
      store.send('Créer');
      chat.next(planEvent());
    }

    it('cancels the plan, returns to idle and logs a system item', () => {
      withPlan();

      store.cancelPlan();

      expect(builds.cancel).toHaveBeenCalledWith('p-1');
      expect(store.phase()).toBe('idle');
      expect(store.plan()).toBeNull();
      expect(store.timeline().pop()).toEqual({ kind: 'system', text: STUDIO_AI_LABELS.status.planCancelled });
    });

    it('closes the preview even when the cancel call fails', () => {
      withPlan();
      builds.cancel.and.returnValue(throwError(() => new HttpErrorResponse({ status: 500 })) as never);

      store.cancelPlan();

      expect(store.phase()).toBe('idle');
      expect(store.plan()).toBeNull();
    });

    it('cancels the pending plans before resetting the conversation', () => {
      withPlan();

      store.resetConversation();

      expect(builds.cancelPending).toHaveBeenCalled();
      expect(store.phase()).toBe('idle');
      expect(store.timeline()).toEqual([]);
      expect(store.plan()).toBeNull();
      expect(store.conversationId()).toBeUndefined();
      expect(store.lastPrompt()).toBe('');
    });

    it('always cancels the pending plans server-side (other sessions may have left some) but only deletes an existing conversation', () => {
      builds.cancelPending.and.returnValue(of({ success: true, data: 0, message: null, errors: [] }) as never);
      const counts: number[] = [];

      store.resetConversation(count => counts.push(count));

      expect(builds.cancelPending).toHaveBeenCalled();
      expect(chat.deleteConversation).not.toHaveBeenCalled();
      expect(counts).toEqual([0]);
      expect(store.phase()).toBe('idle');
    });

    it('deletes the current conversation after cancel-pending and reports the cancelled count', () => {
      const events = new Subject<ChatStreamEvent>();
      stream.streamChat.and.returnValue(events.asObservable());
      store.send('Créer');
      events.next({ type: 'done', content: '', conversationId: 'conv-9' });
      builds.cancelPending.and.returnValue(of({ success: true, data: 2, message: null, errors: [] }) as never);
      const counts: number[] = [];

      store.resetConversation(count => counts.push(count));

      expect(builds.cancelPending).toHaveBeenCalledBefore(chat.deleteConversation);
      expect(chat.deleteConversation).toHaveBeenCalledWith('conv-9');
      expect(counts).toEqual([2]);
      expect(store.conversationId()).toBeUndefined();
      expect(store.timeline()).toEqual([]);
    });

    it('still resets when cancel-pending or the conversation deletion fail', () => {
      const events = new Subject<ChatStreamEvent>();
      stream.streamChat.and.returnValue(events.asObservable());
      store.send('Créer');
      events.next({ type: 'done', content: '', conversationId: 'conv-9' });
      builds.cancelPending.and.returnValue(throwError(() => new HttpErrorResponse({ status: 500 })) as never);
      chat.deleteConversation.and.returnValue(throwError(() => new HttpErrorResponse({ status: 404 })));
      const counts: number[] = [];

      store.resetConversation(count => counts.push(count));

      expect(counts).toEqual([0]);
      expect(store.phase()).toBe('idle');
      expect(store.timeline()).toEqual([]);
    });
  });

  describe('advanced model (D3)', () => {
    it('sends useAdvancedModel and studioIntent with the chat request', () => {
      store.setAdvancedModel(true);
      store.send('Créer un système', { intent: 'system' });

      const request = stream.streamChat.calls.mostRecent().args[0];
      expect(request.options).toEqual(jasmine.objectContaining({ useAdvancedModel: true, studioIntent: 'system' }));
    });

    it('persists the preference in localStorage and reads it back at construction', () => {
      store.setAdvancedModel(true);
      expect(localStorage.getItem(STUDIO_AI_ADVANCED_MODEL_STORAGE_KEY)).toBe('1');

      const fresh = TestBed.runInInjectionContext(() => new StudioAiSessionStore());
      expect(fresh.useAdvancedModel()).toBeTrue();
      fresh.ngOnDestroy();

      store.setAdvancedModel(false);
      expect(localStorage.getItem(STUDIO_AI_ADVANCED_MODEL_STORAGE_KEY)).toBeNull();
    });

    it('reads the meta event and exposes the fallback when the server downgraded the model', () => {
      const events = new Subject<ChatStreamEvent>();
      stream.streamChat.and.returnValue(events.asObservable());
      store.setAdvancedModel(true);

      store.send('Créer');
      expect(store.usedAdvancedModel()).toBeNull();
      events.next({ type: 'meta', content: JSON.stringify({ usedAdvancedModel: false, advancedModelFallbackReason: 'unavailable', model: 'GPT-4.1 mini' }) });

      expect(store.usedAdvancedModel()).toBeFalse();
      expect(store.advancedModelFallbackReason()).toBe('unavailable');
      expect(store.advancedModelFellBack()).toBeTrue();
    });

    it('does not flag a fallback when the advanced model was not requested', () => {
      const events = new Subject<ChatStreamEvent>();
      stream.streamChat.and.returnValue(events.asObservable());

      store.send('Créer');
      events.next({ type: 'meta', content: JSON.stringify({ usedAdvancedModel: false }) });

      expect(store.usedAdvancedModel()).toBeFalse();
      expect(store.advancedModelFellBack()).toBeFalse();
    });

    it('parseStreamMeta rejects payloads without a boolean usedAdvancedModel', () => {
      expect(parseStreamMeta('pas du json')).toBeNull();
      expect(parseStreamMeta(JSON.stringify({ usedAdvancedModel: 'oui' }))).toBeNull();
      expect(parseStreamMeta(JSON.stringify({ usedAdvancedModel: true }))).toEqual(jasmine.objectContaining({ usedAdvancedModel: true }));
    });
  });

  describe('history (rail)', () => {
    it('loads the last plans and refreshes them after a plan arrives', () => {
      builds.listPlans.and.returnValue(of({
        success: true, message: null, errors: [],
        data: {
          items: [{ id: 'p-9', kind: 'CreateSystem', status: 'Pending', title: 'Congés', entityCount: 2, createdAt: '2026-09-11T10:00:00Z', expiresAt: '2026-09-12T10:00:00Z' }],
          page: 1, pageSize: 5, totalCount: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false
        }
      }) as never);

      store.loadHistory();

      expect(builds.listPlans).toHaveBeenCalledWith({ page: 1, pageSize: 5 });
      expect(store.history().length).toBe(1);
      expect(store.historyError()).toBeNull();

      const events = new Subject<ChatStreamEvent>();
      stream.streamChat.and.returnValue(events.asObservable());
      store.send('Créer');
      events.next(planEvent());
      expect(builds.listPlans).toHaveBeenCalledTimes(2);
    });

    it('tolerates a failing history endpoint', () => {
      builds.listPlans.and.returnValue(throwError(() => new HttpErrorResponse({ status: 500 })) as never);

      store.loadHistory();

      expect(store.history()).toEqual([]);
      expect(store.historyError()).toBe(STUDIO_AI_LABELS.rail.historyLoadFailed);
      expect(store.historyLoading()).toBeFalse();
    });
  });

  describe('duplicates (R21)', () => {
    const hint: StudioDuplicateHint = {
      specRef: 'employe', specDisplayName: 'Employé', existingKey: 'employes', existingDisplayName: 'Employés', reason: 'same_name'
    };

    function withDuplicatePlan(): void {
      const events = new Subject<ChatStreamEvent>();
      stream.streamChat.and.returnValue(events.asObservable());
      builds.updatePlanSpec.and.returnValue(of(specResponse('rv-2')) as never);
      store.send('Créer');
      events.next({ type: 'studio_plan', content: JSON.stringify({ planId: 'p-1', summary: summary({ duplicates: [hint] } as never) }) });
    }

    it('exposes the server hints of the current plan', () => {
      withDuplicatePlan();
      expect(store.duplicates()).toEqual([hint]);
    });

    it('« Réutiliser » pins existingKey on the entity and saves the draft', () => {
      withDuplicatePlan();

      store.reuseExistingTable(hint);

      expect(builds.updatePlanSpec).toHaveBeenCalled();
      const sent = JSON.parse(builds.updatePlanSpec.calls.mostRecent().args[1]) as StudioSystemSpec;
      expect(sent.entities[0].existingKey).toBe('employes');
      expect(store.timeline().pop()?.kind).toBe('system');
    });

    it('« Créer quand même » suffixes the display names, hides the hint and highlights the entity', () => {
      withDuplicatePlan();

      store.renameDuplicate(hint);

      const sent = JSON.parse(builds.updatePlanSpec.calls.mostRecent().args[1]) as StudioSystemSpec;
      expect(sent.entities[0].displayName).toBe('Employé (2)');
      expect(sent.entities[0].displayNamePlural).toBe('Employés (2)');
      expect(store.duplicates()).toEqual([]);
      expect(store.highlightedEntityRef()).toBe('employe');
    });

    it('withSuffix is idempotent', () => {
      expect(withSuffix('Clients', '(2)')).toBe('Clients (2)');
      expect(withSuffix('Clients (2)', '(2)')).toBe('Clients (2)');
      expect(withSuffix('', '(2)')).toBe('');
    });
  });

  describe('abandonPlanAndSend (A19)', () => {
    it('cancels the pending plan, logs it and sends the new request', () => {
      const first = new Subject<ChatStreamEvent>();
      stream.streamChat.and.returnValue(first.asObservable());
      store.send('Créer');
      first.next(planEvent());
      const second = new Subject<ChatStreamEvent>();
      stream.streamChat.and.returnValue(second.asObservable());

      store.abandonPlanAndSend('Plutôt un système de notes de frais', { intent: 'system' });

      expect(builds.cancel).toHaveBeenCalledWith('p-1');
      expect(store.plan()).toBeNull();
      expect(store.phase()).toBe('planning');
      expect(stream.streamChat).toHaveBeenCalledTimes(2);
      expect(stream.streamChat.calls.mostRecent().args[0].message).toBe('Plutôt un système de notes de frais');
      const texts = store.timeline().map(item => (item as { text?: string }).text);
      expect(texts).toContain(STUDIO_AI_LABELS.status.planCancelled);
    });

    it('simply sends when no plan is pending', () => {
      store.abandonPlanAndSend('Créer', {});
      expect(builds.cancel).not.toHaveBeenCalled();
      expect(stream.streamChat).toHaveBeenCalledTimes(1);
    });
  });

  describe('createFromTemplate', () => {
    it('opens the template plan in awaiting_confirmation with its spec', () => {
      builds.createFromTemplate.and.returnValue(of({
        success: true, message: null, errors: [],
        data: {
          plan: { id: 'p-t', kind: 'CreateSystem', status: 'Pending', summaryJson: JSON.stringify(summary({ title: 'CRM' })), expiresAt: '2026-09-12T10:00:00Z', createdAt: '2026-09-11T10:00:00Z' },
          spec: { id: 'p-t', kind: 'CreateSystem', status: 'Pending', expiresAt: '2026-09-12T10:00:00Z', rowVersion: 'rv-t', spec: spec() }
        }
      }) as never);

      store.createFromTemplate('crm');

      expect(builds.createFromTemplate).toHaveBeenCalledWith('crm');
      expect(store.phase()).toBe('awaiting_confirmation');
      expect(store.plan()?.planId).toBe('p-t');
      expect(store.plan()?.rowVersion).toBe('rv-t');
      expect(store.spec()?.entities.length).toBe(1);
      expect(store.timeline().pop()).toEqual({ kind: 'system', text: STUDIO_AI_LABELS.templates.opened });
    });

    it('reports a failure without leaving the page stuck in planning', () => {
      builds.createFromTemplate.and.returnValue(throwError(() => new HttpErrorResponse({ status: 500 })) as never);

      store.createFromTemplate('crm');

      expect(store.phase()).toBe('idle');
      expect(store.error()).toBeTruthy();
    });
  });

  describe('saveDraft', () => {
    function editedPlan(): StudioSystemSpec {
      const chat = new Subject<ChatStreamEvent>();
      stream.streamChat.and.returnValue(chat.asObservable());
      store.send('Créer');
      chat.next(planEvent());
      store.startEditing();
      const next: StudioSystemSpec = { ...store.draft()!, system: { displayName: 'Congés 2026' } };
      store.updateDraft(next);
      return next;
    }

    it('saves the draft, refreshes the rowVersion and logs the confirmation', () => {
      const next = editedPlan();
      const saved = { ...next, system: { displayName: 'Congés 2026' } };
      builds.updatePlanSpec.and.returnValue(of({
        success: true,
        data: {
          plan: { summaryJson: JSON.stringify(summary({ title: 'Congés 2026', warnings: ['Vérifiez les soldes.'] })) },
          spec: { rowVersion: 'rv-2', expiresAt: '2026-09-09T12:00:00Z', spec: saved }
        },
        message: null,
        errors: []
      }) as never);

      store.saveDraft();

      expect(builds.updatePlanSpec).toHaveBeenCalled();
      const args = builds.updatePlanSpec.calls.mostRecent().args;
      expect(args[0]).toBe('p-1');
      expect(JSON.parse(args[1] as string).system.displayName).toBe('Congés 2026');
      expect(args[2]).toBe('rv-1');
      expect(store.plan()?.rowVersion).toBe('rv-2');
      expect(store.plan()?.summary.title).toBe('Congés 2026');
      expect(store.dirty()).toBeFalse();
      expect(store.phase()).toBe('awaiting_confirmation');
      expect(store.validation()).toEqual({ warnings: ['Vérifiez les soldes.'], errors: [], pending: false });
      expect(store.warnings()).toEqual(['Vérifiez les soldes.']);
      expect(store.timeline().pop()).toEqual({ kind: 'system', text: STUDIO_AI_LABELS.status.draftSaved });
    });

    it('sends a CreateApp plan back in its { entity, fields } shape', () => {
      const app: StudioAppSpec = {
        entity: { displayName: 'Contrat', displayNamePlural: 'Contrats', icon: 'fa-solid fa-file' },
        fields: [{ key: 'titre', label: 'Titre', type: 'text', required: true, unique: false }]
      };
      builds.getPlanSpec.and.returnValue(of({
        success: true,
        data: { id: 'p-1', kind: 'CreateApp', status: 'Pending', expiresAt: '2026-09-09T10:00:00Z', rowVersion: 'rv-1', spec: app },
        message: null,
        errors: []
      }) as never);
      const chat = new Subject<ChatStreamEvent>();
      stream.streamChat.and.returnValue(chat.asObservable());
      store.send('Créer une table contrats');
      chat.next({ type: 'studio_plan', content: JSON.stringify({ planId: 'p-1', summary: summary({ kind: 'CreateApp', title: 'Contrat' }) }) });
      expect(store.plan()?.kind).toBe('CreateApp');
      expect(store.spec()?.entities[0].ref).toBe('entity');

      store.startEditing();
      const draft = structuredClone(store.draft()!);
      draft.entities[0].fields.push({ key: 'montant', label: 'Montant', type: 'money', required: false, unique: false });
      store.updateDraft(draft);
      builds.updatePlanSpec.and.returnValue(of() as never);

      store.saveDraft();

      const sent = JSON.parse(builds.updatePlanSpec.calls.mostRecent().args[1] as string);
      expect(sent.system).toBeUndefined();
      expect(sent.entities).toBeUndefined();
      expect(sent.entity).toEqual({ displayName: 'Contrat', displayNamePlural: 'Contrats', icon: 'fa-solid fa-file' });
      expect(sent.fields.map((f: { key: string }) => f.key)).toEqual(['titre', 'montant']);
    });

    it('surfaces the conflict message on 409 without losing the draft', () => {
      const next = editedPlan();
      builds.updatePlanSpec.and.returnValue(throwError(() => new HttpErrorResponse({ status: 409 })) as never);

      store.saveDraft();

      expect(store.validation().errors).toEqual([STUDIO_AI_LABELS.errors.conflict]);
      expect(store.validation().pending).toBeFalse();
      expect(store.draft()?.system.displayName).toBe(next.system.displayName);
      expect(store.dirty()).toBeTrue();
    });

    it('reports a non successful envelope', () => {
      editedPlan();
      builds.updatePlanSpec.and.returnValue(of({ success: false, data: null, message: 'ko', errors: [] }) as never);

      store.saveDraft();

      expect(store.validation().errors).toEqual([STUDIO_AI_LABELS.errors.generic]);
    });

    it('does nothing when the draft is unchanged', () => {
      const chat = new Subject<ChatStreamEvent>();
      stream.streamChat.and.returnValue(chat.asObservable());
      store.send('Créer');
      chat.next(planEvent());

      store.saveDraft();

      expect(builds.updatePlanSpec).not.toHaveBeenCalled();
    });

    it('resetDraft restores the server spec and leaves editing mode', () => {
      editedPlan();
      expect(store.dirty()).toBeTrue();

      store.resetDraft();

      expect(store.dirty()).toBeFalse();
      expect(store.phase()).toBe('awaiting_confirmation');
      expect(store.draft()).toEqual(store.spec());
    });
  });

  describe('openPlan', () => {
    it('reopens a pending plan and loads its spec', () => {
      store.openPlan('p-7', 'CreateSystem', summary({ title: 'Congés' }), '2026-09-10T10:00:00Z');

      expect(store.phase()).toBe('awaiting_confirmation');
      expect(store.plan()?.planId).toBe('p-7');
      expect(builds.getPlanSpec).toHaveBeenCalledWith('p-7');
      expect(store.spec()).not.toBeNull();
    });

    it('maps an HTTP failure to a French message', () => {
      builds.getPlanSpec.and.returnValue(throwError(() => new HttpErrorResponse({ status: 404 })) as never);

      store.openPlan('p-7', 'CreateSystem', summary());

      expect(store.error()).toBe(STUDIO_AI_LABELS.errors.planNotFound);
      expect(store.specLoading()).toBeFalse();
    });
  });

  it('un seul `studio_plan` rendu par événement (2.5i) : deux événements successifs ⇒ remplacement, pas de doublon', () => {
    const events = new Subject<ChatStreamEvent>();
    stream.streamChat.and.returnValue(events.asObservable());
    builds.getPlanSpec.and.returnValue(of({
      success: true,
      data: { spec: JSON.stringify({ entities: [{ key: 'conges' }] }), rowVersion: 'rv-1', expiresAt: '2026-09-09T10:00:00Z' },
      message: null, errors: []
    }) as never);

    store.send('Créer un système de congés');
    events.next(planEvent('p-1'));
    events.next(planEvent('p-1'));
    events.next(planEvent('p-2'));

    // Chaque événement est appliqué une fois : un seul plan courant, la dernière émission gagne.
    expect(store.phase()).toBe('awaiting_confirmation');
    expect(store.plan()?.planId).toBe('p-2');
    expect(builds.getPlanSpec.calls.count()).toBe(3);
    expect(store.draft()?.entities.length).toBe(1);
  });

  describe('aperçu enrichi (3.4b) : mode, aperçu serveur, compte à rebours, rejeu', () => {
    const previewResponse = () => ({ success: true, data: studioAiPlanPreviewFixture(), message: null, errors: [] });
    const creationResponse = (planId = 'p-r') => ({
      success: true, message: null, errors: [],
      data: {
        plan: { id: planId, kind: 'CreateSystem', status: 'Pending', summaryJson: JSON.stringify(summary({ title: 'Rejoué' })), expiresAt: '2026-09-16T10:00:00Z', createdAt: '2026-09-15T10:00:00Z' },
        spec: { id: planId, kind: 'CreateSystem', status: 'Pending', expiresAt: '2026-09-16T10:00:00Z', rowVersion: 'rv-r', spec: spec() }
      }
    });
    /** Plan ouvert depuis « Mes projets » : `GET {id}/spec` répond immédiatement avec `spec()`. */
    function openPlan(expiresAt: string | null = null): void {
      store.openPlan('p-1', 'CreateSystem', summary(), expiresAt);
    }

    it('setMode(customize) démarre l’édition et changeCount suit diffSpec', () => {
      openPlan();
      expect(store.mode()).toBe('preview');
      expect(store.changeCount()).toBe(0);

      store.setMode('customize');
      expect(store.mode()).toBe('customize');
      expect(store.phase()).toBe('editing');

      const draft = structuredClone(store.draft()!);
      draft.entities[0].fields.push({ key: 'email', label: 'E-mail', type: 'text', required: false, unique: false });
      store.updateDraft(draft);
      expect(store.changeCount()).toBe(1);
      expect(store.changes()[0].kind).toBe('added');

      // Revenir à « Aperçu » conserve le brouillon : le badge `dirty` reste visible.
      store.setMode('preview');
      expect(store.mode()).toBe('preview');
      expect(store.dirty()).toBeTrue();
      expect(store.changeCount()).toBe(1);
    });

    it('setMode(test) charge l’aperçu serveur une seule fois', () => {
      builds.getPlanPreview.and.returnValue(of(previewResponse()) as never);
      openPlan();

      store.setMode('test');
      store.setMode('preview');
      store.setMode('test');

      expect(builds.getPlanPreview).toHaveBeenCalledTimes(1);
      expect(builds.getPlanPreview).toHaveBeenCalledWith('p-1');
      expect(store.preview()?.planId).toBe('p-preview-1');
      expect(store.previewLoading()).toBeFalse();
      expect(store.previewUnavailable()).toBeFalse();
    });

    it('aperçu 404 ⇒ previewUnavailable sans erreur globale', () => {
      builds.getPlanPreview.and.returnValue(throwError(() => new HttpErrorResponse({ status: 404 })) as never);
      openPlan();

      store.setMode('test');
      store.setMode('test');

      expect(builds.getPlanPreview).toHaveBeenCalledTimes(1);
      expect(store.mode()).toBe('test');
      expect(store.previewUnavailable()).toBeTrue();
      expect(store.preview()).toBeNull();
      expect(store.previewLoading()).toBeFalse();
      expect(store.error()).toBeNull();
    });

    it('le compte à rebours décroît depuis expiresAt et expired passe à vrai à 0', fakeAsync(() => {
      openPlan(new Date(Date.now() + 3000).toISOString());

      expect(store.expiresInSeconds()).toBe(3);
      expect(store.expired()).toBeFalse();

      tick(1000);
      expect(store.expiresInSeconds()).toBe(2);
      tick(2000);
      expect(store.expiresInSeconds()).toBe(0);
      expect(store.expired()).toBeTrue();
      // Jamais négatif : la valeur est recalculée depuis l'échéance, pas décrémentée.
      tick(5000);
      expect(store.expiresInSeconds()).toBe(0);

      discardPeriodicTasks();
    }));

    it('un plan expiré ne peut plus être validé', fakeAsync(() => {
      openPlan(new Date(Date.now() + 1000).toISOString());
      expect(store.canConfirm()).toBeTrue();

      tick(1000);

      expect(store.expired()).toBeTrue();
      expect(store.canConfirm()).toBeFalse();
      discardPeriodicTasks();
    }));

    it('replay 201 ouvre le nouveau plan comme un modèle', () => {
      builds.replayPlan.and.returnValue(of(creationResponse('p-r')) as never);

      store.replay('p-old');

      expect(builds.replayPlan).toHaveBeenCalledWith('p-old');
      expect(store.phase()).toBe('awaiting_confirmation');
      expect(store.plan()?.planId).toBe('p-r');
      expect(store.plan()?.rowVersion).toBe('rv-r');
      expect(store.spec()?.entities.length).toBe(1);
      expect(store.timeline().pop()).toEqual({ kind: 'system', text: STUDIO_AI_LABELS.replay.done });
    });

    it('replay 409 affiche le message de conflit', () => {
      builds.replayPlan.and.returnValue(throwError(() => new HttpErrorResponse({ status: 409 })) as never);

      store.replay('p-old');

      expect(store.phase()).toBe('idle');
      expect(store.plan()).toBeNull();
      expect(store.error()).toBe(STUDIO_AI_LABELS.replay.conflict);
    });

    it('clearPlanState arrête le compte à rebours', fakeAsync(() => {
      builds.getPlanPreview.and.returnValue(of(previewResponse()) as never);
      openPlan(new Date(Date.now() + 60_000).toISOString());
      store.setMode('test');
      expect(store.expiresInSeconds()).toBe(60);

      // `cancelPlan` passe par `clearPlanState()` : plus de plan, plus d'échéance, mode et aperçu remis à zéro.
      store.cancelPlan();

      expect(store.expiresInSeconds()).toBeNull();
      expect(store.expired()).toBeFalse();
      expect(store.mode()).toBe('preview');
      expect(store.preview()).toBeNull();
      tick(2000);
      expect(store.expiresInSeconds()).toBeNull();
      discardPeriodicTasks();
    }));
  });

  describe('mode Personnaliser : mutations du brouillon (3.4g1)', () => {
    /** Plan ouvert avec la spec chargée (`GET {id}/spec` répond immédiatement avec `spec()`). */
    function openPlan(): void {
      store.openPlan('p-1', 'CreateSystem', summary());
    }

    it('updateField/addField/removeField mutent le brouillon et changeCount suit', () => {
      openPlan();
      store.setMode('customize');
      expect(store.changeCount()).toBe(0);

      // Renommage inline : la clé ne change jamais, le diff compte un « changed ».
      store.updateField('employe', 'nom', { label: 'Nom complet' });
      expect(store.draft()?.entities[0].fields[0]).toEqual(jasmine.objectContaining({ key: 'nom', label: 'Nom complet' }));
      expect(store.changeCount()).toBe(1);
      expect(store.changes()[0].kind).toBe('changed');

      // Ajout explicite : la clé fournie est conservée (sans doublon), le diff compte un « added ».
      store.addField('employe', { key: 'email', label: 'E-mail', type: 'text', required: false, unique: false });
      expect(store.draft()?.entities[0].fields.map(f => f.key)).toEqual(['nom', 'email']);
      expect(store.changeCount()).toBe(2);

      // « Retirer » un champ connu du serveur : marqué removed (restaurable), le rename disparaît du diff.
      store.removeField('employe', 'nom');
      expect(store.draft()?.entities[0].fields.map(f => f.key)).toEqual(['email']);
      expect(store.changeCount()).toBe(2);
      expect(store.changes().map(c => c.kind).sort()).toEqual(['added', 'removed']);

      // « Rétablir » : le champ revient à sa position d'origine, avec son renommage (« changed » à nouveau).
      store.removeField('employe', 'nom');
      expect(store.draft()?.entities[0].fields.map(f => f.key)).toEqual(['nom', 'email']);
      expect(store.draft()?.entities[0].fields[0].label).toBe('Nom complet');
      expect(store.changeCount()).toBe(2);

      // Un champ ajouté pendant cette session est supprimé définitivement (rien à rétablir).
      store.removeField('employe', 'email');
      expect(store.draft()?.entities[0].fields.map(f => f.key)).toEqual(['nom']);
      expect(store.changeCount()).toBe(1);

      // Sans champ fourni, « Ajouter un champ » crée « Nouveau champ » avec une clé slugifiée unique.
      store.addField('employe');
      store.addField('employe');
      expect(store.draft()?.entities[0].fields.map(f => f.key)).toEqual(['nom', 'nouveau_champ', 'nouveau_champ_2']);
      expect(store.draft()?.entities[0].fields[1]).toEqual(jasmine.objectContaining({
        label: STUDIO_AI_LABELS.customize.newField, type: 'text', required: false, unique: false
      }));

      // Une table existante (`existingKey`) est verrouillée : aucune mutation n'aboutit.
      const before = store.draft();
      store.updateField('inconnue', 'nom', { label: 'X' });
      expect(store.draft()).toBe(before);
    });

    it('reorderFields et updateView mutent le brouillon', () => {
      // Spec dédiée : 3 champs et une vue filtrée sur la table « employe ».
      const custom = spec();
      custom.entities[0].fields = [
        { key: 'a', label: 'A', type: 'text', required: false, unique: false },
        { key: 'b', label: 'B', type: 'text', required: false, unique: false },
        { key: 'c', label: 'C', type: 'text', required: false, unique: false }
      ];
      custom.entities[0].views = [{ name: 'Tout', mode: 'list', filters: [{ field: 'a', op: 'eq', value: 'x' }] }];
      builds.getPlanSpec.and.returnValue(of({
        success: true,
        data: { id: 'p-1', kind: 'CreateSystem', status: 'Pending', expiresAt: '2026-09-09T10:00:00Z', rowVersion: 'rv-1', spec: custom },
        message: null,
        errors: []
      }) as never);
      openPlan();
      store.setMode('customize');
      expect(store.changeCount()).toBe(0);

      // Réordonnancement : déplacement immuable 0 → 2, les clés ne changent pas ; le diff signale
      // l'ordre des champs (sinon un réordonnancement seul resterait impossible à enregistrer).
      store.reorderFields('employe', 0, 2);
      expect(store.draft()?.entities[0].fields.map(f => f.key)).toEqual(['b', 'c', 'a']);
      expect(store.changes().map(c => c.path)).toEqual(['entities.employe.fields']);
      expect(store.changeCount()).toBe(1);

      // Patch d'une vue : les clés non visées par le patch sont conservées.
      store.updateView('employe', 0, { filters: [{ field: 'b', op: 'neq', value: 'y' }] });
      expect(store.draft()?.entities[0].views?.[0]).toEqual({
        name: 'Tout', mode: 'list', filters: [{ field: 'b', op: 'neq', value: 'y' }]
      });
      expect(store.changes().map(c => c.path).sort()).toEqual(['entities.employe.fields', 'entities.employe.views']);
      expect(store.changeCount()).toBe(2);

      // Index hors bornes, table inconnue ou positions invalides : aucun effet (même référence).
      const before = store.draft();
      store.updateView('employe', 5, { filters: [] });
      store.updateView('employe', -1, { filters: [] });
      store.reorderFields('employe', 0, 9);
      store.reorderFields('employe', 1, 1);
      store.reorderFields('inconnue', 0, 1);
      expect(store.draft()).toBe(before);
      expect(store.changeCount()).toBe(2);
    });
  });

  describe('mode Personnaliser : import CSV des données de départ (3.4h)', () => {
    /** Plan ouvert avec la spec chargée (`GET {id}/spec` répond immédiatement avec `spec()`). */
    function openPlan(): void {
      store.openPlan('p-1', 'CreateSystem', summary());
    }

    it('replaceSeed remplace le bloc seed et changeCount suit', () => {
      // Spec dédiée : un bloc seed existant sur la table « employe ».
      const custom = spec();
      custom.seed = [{ entityRef: 'employe', records: [{ nom: 'Dupont' }] }];
      builds.getPlanSpec.and.returnValue(of({
        success: true,
        data: { id: 'p-1', kind: 'CreateSystem', status: 'Pending', expiresAt: '2026-09-09T10:00:00Z', rowVersion: 'rv-1', spec: custom },
        message: null,
        errors: []
      }) as never);
      openPlan();
      store.setMode('customize');
      expect(store.changeCount()).toBe(0);

      // Remplacement : l'ancien bloc est retiré, le nouveau ajouté ; le diff voit « seed.employe »,
      // ce qui alimente le compteur du pied et « Enregistrer le brouillon ».
      store.replaceSeed('employe', [{ nom: 'Martin' }, { nom: 'Bernard' }]);
      expect(store.draft()?.seed).toEqual([{ entityRef: 'employe', records: [{ nom: 'Martin' }, { nom: 'Bernard' }] }]);
      expect(store.changeCount()).toBe(1);
      expect(store.changes()[0].path).toBe('seed.employe');
      // La spec de base (serveur) n'est jamais touchée.
      expect(store.spec()?.seed).toEqual([{ entityRef: 'employe', records: [{ nom: 'Dupont' }] }]);

      // Table inconnue : aucun effet (même référence de brouillon).
      const before = store.draft();
      store.replaceSeed('inconnue', [{ nom: 'X' }]);
      expect(store.draft()).toBe(before);

      // Borne serveur : au-delà de `maxSeedRecords`, le bloc est tronqué.
      const many = Array.from({ length: STUDIO_SPEC_LIMITS.maxSeedRecords + 50 }, (_, i) => ({ nom: `N${i}` }));
      store.replaceSeed('employe', many);
      expect(store.draft()?.seed?.[0].records.length).toBe(STUDIO_SPEC_LIMITS.maxSeedRecords);
    });
  });

  describe('pure helpers', () => {
    it('normalizeSummary fills the missing collections', () => {
      const normalized = normalizeSummary({ title: 'X' } as StudioPlanSummary);
      expect(normalized).toEqual({ kind: '', title: 'X', steps: [], entities: [], warnings: [], duplicates: [], workflows: [] });
    });

    it('parsePlanSummary reads a JSON summary and rejects junk', () => {
      expect(parsePlanSummary(JSON.stringify({ title: 'X' }))?.title).toBe('X');
      expect(parsePlanSummary('pas du json')).toBeNull();
      expect(parsePlanSummary(null)).toBeNull();
      expect(parsePlanSummary('')).toBeNull();
    });

    it('parseActions keeps only absolute routes', () => {
      expect(parseActions(JSON.stringify([
        { label: 'Ouvrir', route: '/studio/systems/conges' },
        { label: 'Relatif', route: 'studio' },
        { label: 42, route: '/x' }
      ]))).toEqual([{ label: 'Ouvrir', route: '/studio/systems/conges' }]);
      expect(parseActions('pas du json')).toEqual([]);
      expect(parseActions(undefined)).toEqual([]);
    });
  });
});
