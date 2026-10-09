
import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { signal, computed, DOCUMENT } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { AuthService, User } from '@core/services/auth.service';
import { AiChatSessionService } from './ai-chat-session.service';
import { AiChatService } from './ai-chat.service';
import { AiStreamService } from './ai-stream.service';
import { AssistantAgentScope, ChatRequest, ChatStreamEvent, ConfirmFirmReminderAction, MessageRole } from '../models/ai-chat.models';

describe('AiChatSessionService', () => {
  let service: AiChatSessionService;
  let chatApi: jasmine.SpyObj<AiChatService>;
  let streamMock: jasmine.SpyObj<AiStreamService>;

  const mockUser: User = {
    id: 'user-1',
    email: 'a@b.c',
    firstName: 'A',
    lastName: 'B',
    fullName: 'A B',
    role: 'User',
    roleDisplay: 'User',
    tenantId: 'tenant-1',
    companyName: 'Co',
    twoFactorEnabled: false
  };

  function setup(initialUser: User | null = mockUser): ReturnType<typeof signal<User | null>> {
    const userSig = signal<User | null>(initialUser);
    const authMock = {
      user: computed(() => userSig()),
      // Le service derive la surface HTTP du scope ET du mode : un onglet cabinet laisse ouvert
      // ne doit pas interroger l'assistant du cabinet depuis un dossier client.
      isDelegatedMode: () => userSig()?.accessMode === 'delegated'
    };

    chatApi = jasmine.createSpyObj<AiChatService>('AiChatService', [
      'getConfiguredStatus',
      'getActiveModel',
      'getConversations',
      'getConversation',
      'deleteConversation',
      'getDailyBriefing',
      'warmUp',
      'confirmFirmReminder'
    ]);
    chatApi.getConfiguredStatus.and.returnValue(
      of({
        hasOllamaModels: true,
        hasCloudProvider: false,
        isFullyConfigured: true
      })
    );
    chatApi.getActiveModel.and.returnValue(
      of({
        modelRef: 'ollama:m:latest',
        displayLabel: 'm:latest',
        supportsVision: false
      })
    );
    chatApi.getConversations.and.returnValue(of([]));
    chatApi.getConversation.and.returnValue(
      of({
        id: 'conv-default',
        title: 'T',
        createdAt: '2026-01-01T00:00:00Z',
        lastMessageAt: '2026-01-01T00:00:00Z',
        messages: []
      })
    );
    chatApi.getDailyBriefing.and.returnValue(
      of({
        upcomingRemindersCount: 0,
        nextReminders: [],
        totalClientBalances: 0,
        clientsWithBalanceCount: 0,
        agingOver90: 0,
        currency: 'EUR',
        generatedAtUtc: '2026-01-01T00:00:00Z'
      })
    );
    chatApi.warmUp.and.returnValue(of({ warmed: true }));
    chatApi.confirmFirmReminder.and.returnValue(
      of({ envoye: true, dossier: 'D', obligation: 'TVA', echeance: '2026-08-24', destinataire: 'S' })
    );

    streamMock = jasmine.createSpyObj<AiStreamService>('AiStreamService', ['streamChat']);
    streamMock.streamChat.and.returnValue(of());

    TestBed.configureTestingModule({
      providers: [
        AiChatSessionService,
        { provide: AuthService, useValue: authMock },
        { provide: AiChatService, useValue: chatApi },
        { provide: AiStreamService, useValue: streamMock },
        { provide: DOCUMENT, useValue: document }
      ]
    });

    service = TestBed.inject(AiChatSessionService);
    return userSig;
  }

  beforeEach(() => {
    setup();
    try {
      sessionStorage.removeItem('ft_ai_active_conv_user-1_tenant-1');
    } catch {
      // ignore
    }
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('content_replace replaces assistant bubble content', () => {
    streamMock.streamChat.and.returnValue(
      of(
        { type: 'content', content: 'Je' } as ChatStreamEvent,
        { type: 'content_replace', content: 'Je suis l\'assistant IA de InstaFact, prêt à analyser vos données commerciales et financières.' } as ChatStreamEvent,
        { type: 'done', conversationId: 'c1' } as ChatStreamEvent
      )
    );
    service.initialize();
    service.sendMessage('vous etes qui ?');
    const assistant = service.messages().find(m => m.role === MessageRole.Assistant);
    expect(assistant?.content).toContain('InstaFact');
    expect(assistant?.content).not.toBe('Je');
  });

  it('startNewConversation clears messages and activeConversationId', () => {
    service.messages.set([
      { id: '1', role: MessageRole.User, content: 'hi', createdAt: new Date() }
    ]);
    service.activeConversationId.set('conv-1');
    service.startNewConversation();
    expect(service.messages().length).toBe(0);
    expect(service.activeConversationId()).toBeUndefined();
  });

  it('sendMessage n\'envoie pas d\'agentScope en mode global (comportement historique)', () => {
    streamMock.streamChat.and.returnValue(
      of({ type: 'done', conversationId: 'c1' } as ChatStreamEvent)
    );
    service.initialize();
    service.sendMessage('CA du mois ?');
    const req = streamMock.streamChat.calls.mostRecent().args[0] as ChatRequest;
    expect(req.options?.agentScope).toBeUndefined();
  });

  it('sendMessage inclut agentScope dans les options quand un expert est actif', () => {
    streamMock.streamChat.and.returnValue(
      of({ type: 'done', conversationId: 'c1' } as ChatStreamEvent)
    );
    service.initialize();
    service.setAgentScope(AssistantAgentScope.Sales);
    service.sendMessage('CA du mois ?');
    const req = streamMock.streamChat.calls.mostRecent().args[0] as ChatRequest;
    expect(req.options?.agentScope).toBe(AssistantAgentScope.Sales);
  });

  it('setAgentScope démarre une nouvelle conversation, coupe la conformité et recharge la liste du scope', () => {
    service.initialize();
    service.setAssistantComplianceMode(true);
    service.activeConversationId.set('conv-1');
    service.messages.set([
      { id: '1', role: MessageRole.User, content: 'hi', createdAt: new Date() }
    ]);
    chatApi.getConversations.calls.reset();

    service.setAgentScope(AssistantAgentScope.Stock);

    expect(service.agentScope()).toBe(AssistantAgentScope.Stock);
    expect(service.activeConversationId()).toBeUndefined();
    expect(service.messages().length).toBe(0);
    expect(service.assistantComplianceMode()).toBeFalse();
    // Second argument = surface cabinet. Un expert de module reste sur la surface tenant.
    expect(chatApi.getConversations).toHaveBeenCalledWith(AssistantAgentScope.Stock, false);
  });

  it('le scope Chef de mission bascule la session sur la surface HTTP cabinet', () => {
    service.initialize();
    chatApi.getConversations.calls.reset();

    service.setAgentScope(AssistantAgentScope.FirmMission);

    expect(chatApi.getConversations).toHaveBeenCalledWith(AssistantAgentScope.FirmMission, true);
  });

  it('le scope Chef de mission reste sur la surface tenant en mode dossier delegue', () => {
    TestBed.resetTestingModule();
    const userSig = setup({ ...mockUser, accessMode: 'delegated', contextTenantId: 'tenant-9' });
    service.initialize();
    chatApi.getConversations.calls.reset();

    service.setAgentScope(AssistantAgentScope.FirmMission);

    expect(chatApi.getConversations).toHaveBeenCalledWith(AssistantAgentScope.FirmMission, false);
    expect(userSig()?.accessMode).toBe('delegated');
  });

  it('setAgentScope est un no-op quand le scope ne change pas', () => {
    service.initialize();
    service.setAgentScope(AssistantAgentScope.Crm);
    service.activeConversationId.set('conv-1');
    chatApi.getConversations.calls.reset();

    service.setAgentScope(AssistantAgentScope.Crm);

    expect(service.activeConversationId()).toBe('conv-1');
    expect(chatApi.getConversations).not.toHaveBeenCalled();
  });

  it('resetSessionForUserChange remet le scope à None', () => {
    service.initialize();
    service.setAgentScope(AssistantAgentScope.Treasury);
    service.resetSessionForUserChange();
    expect(service.agentScope()).toBe(AssistantAgentScope.None);
  });

  it('initialize does not call AI APIs when the user is not authenticated', () => {
    TestBed.resetTestingModule();
    setup(null);

    service.initialize();

    expect(chatApi.getConfiguredStatus).not.toHaveBeenCalled();
    expect(chatApi.getDailyBriefing).not.toHaveBeenCalled();
    expect(chatApi.getActiveModel).not.toHaveBeenCalled();
    expect(chatApi.getConversations).not.toHaveBeenCalled();
    expect(service.aiAvailable()).toBe(false);
  });

  it('initialize after an unauthenticated skip still bootstraps once a user is present', () => {
    TestBed.resetTestingModule();
    const userSig = setup(null);

    service.initialize();
    expect(chatApi.getConfiguredStatus).not.toHaveBeenCalled();

    userSig.set(mockUser);
    service.initialize();

    expect(chatApi.getConfiguredStatus).toHaveBeenCalled();
    expect(chatApi.getDailyBriefing).toHaveBeenCalled();
    expect(chatApi.getActiveModel).toHaveBeenCalled();
    expect(chatApi.getConversations).toHaveBeenCalled();
  });

  it('logout resets the session without re-initializing AI APIs', fakeAsync(() => {
    TestBed.resetTestingModule();
    const userSig = setup();
    TestBed.flushEffects();
    service.initialize();
    service.messages.set([
      { id: '1', role: MessageRole.User, content: 'hi', createdAt: new Date() }
    ]);
    chatApi.getConfiguredStatus.calls.reset();
    chatApi.getDailyBriefing.calls.reset();
    chatApi.getActiveModel.calls.reset();
    chatApi.getConversations.calls.reset();

    userSig.set(null);
    TestBed.flushEffects();
    flushMicrotasks();

    expect(service.messages()).toEqual([]);
    expect(chatApi.getConfiguredStatus).not.toHaveBeenCalled();
    expect(chatApi.getDailyBriefing).not.toHaveBeenCalled();
    expect(chatApi.getActiveModel).not.toHaveBeenCalled();
    expect(chatApi.getConversations).not.toHaveBeenCalled();
  }));

  it('account switch resets the session then re-initializes AI APIs', fakeAsync(() => {
    TestBed.resetTestingModule();
    const userSig = setup();
    TestBed.flushEffects();
    service.initialize();
    chatApi.getConfiguredStatus.calls.reset();
    chatApi.getDailyBriefing.calls.reset();
    chatApi.getActiveModel.calls.reset();
    chatApi.getConversations.calls.reset();

    userSig.set({ ...mockUser, id: 'user-2', tenantId: 'tenant-2' });
    TestBed.flushEffects();
    flushMicrotasks();

    expect(chatApi.getConfiguredStatus).toHaveBeenCalled();
    expect(chatApi.getDailyBriefing).toHaveBeenCalled();
    expect(chatApi.getActiveModel).toHaveBeenCalled();
    expect(chatApi.getConversations).toHaveBeenCalled();
  }));

  it('getConversations error clears the list without throwing', () => {
    chatApi.getConversations.and.returnValue(throwError(() => ({ status: 401 })));

    expect(() => service.initialize()).not.toThrow();
    expect(service.conversations()).toEqual([]);
  });

  it('sendMessage clears awaitingFirstToken after content and stores trace id', () => {
    streamMock.streamChat.and.callFake(
      (_req: unknown, onMeta?: (m: { traceId: string | null }) => void) => {
      onMeta?.({ traceId: 'trace-xyz' });
      return of(
        { type: 'content', content: 'hi' } as ChatStreamEvent,
        { type: 'done', conversationId: 'c1' } as ChatStreamEvent
      );
    });
    service.initialize();
    service.sendMessage('Hello');
    expect(service.lastStreamTraceId()).toBe('trace-xyz');
    expect(service.awaitingFirstToken()).toBe(false);
  });

  it('initialize warms the active Ollama model once', () => {
    service.initialize();
    expect(chatApi.warmUp).toHaveBeenCalledTimes(1);
  });

  it('sets aiAvailable from configured-status when only cloud is configured', () => {
    chatApi.getConfiguredStatus.and.returnValue(
      of({
        hasOllamaModels: false,
        hasCloudProvider: true,
        isFullyConfigured: true
      })
    );
    TestBed.resetTestingModule();
    setup();
    service.initialize();
    expect(service.aiAvailable()).toBe(true);
  });

  it('tracks backend phase events inside assistant progress timeline', () => {
    streamMock.streamChat.and.returnValue(
      of(
        {
          type: 'phase',
          phase: 'provider_availability',
          phaseStatus: 'completed',
          elapsedMs: 120
        } as ChatStreamEvent,
        {
          type: 'phase',
          phase: 'llm_stream_round',
          phaseStatus: 'running',
          round: 1
        } as ChatStreamEvent,
        {
          type: 'phase',
          phase: 'llm_stream_round',
          phaseStatus: 'completed',
          round: 1,
          elapsedMs: 2400,
          firstTokenMs: 850,
          hadToolCalls: true
        } as ChatStreamEvent,
        { type: 'done', conversationId: 'c1' } as ChatStreamEvent
      )
    );

    service.initialize();
    service.sendMessage('analyse');

    const assistant = service.messages().find(m => m.role === MessageRole.Assistant);
    expect(assistant?.progress?.status).toBe('completed');
    expect(assistant?.progress?.steps.length).toBe(2);
    expect(assistant?.progress?.steps[0]).toEqual(
      jasmine.objectContaining({
        code: 'provider_availability',
        status: 'completed',
        elapsedMs: 120
      })
    );
    expect(assistant?.progress?.steps[1]).toEqual(
      jasmine.objectContaining({
        code: 'llm_stream_round',
        status: 'completed',
        round: 1,
        elapsedMs: 2400,
        firstTokenMs: 850,
        hadToolCalls: true
      })
    );
  });

  /**
   * Manual regression (SPA): start a tool-heavy request, navigate away from /ai-assistant and back;
   * the response should continue to finish without false “completed” chips alone. New message while
   * streaming still replaces the stream. Logout clears session.
   */
  it('keeps isStreaming true after tool_call_end until done (no premature completion)', () => {
    streamMock.streamChat.and.returnValue(
      new Observable<ChatStreamEvent>(subscriber => {
        subscriber.next({
          type: 'tool_call_start',
          toolName: 'get_sales_revenue',
          toolCallId: 'c1'
        } as ChatStreamEvent);
        subscriber.next({
          type: 'tool_call_end',
          toolName: 'get_sales_revenue',
          toolCallId: 'c1'
        } as ChatStreamEvent);
      })
    );
    service.initialize();
    service.sendMessage('test');
    expect(service.isStreaming()).toBe(true);
    const assistant = service.messages().find(m => m.role === MessageRole.Assistant);
    expect(assistant?.isStreaming).toBe(true);
    expect(assistant?.toolCalls?.[0]?.status).toBe('completed');
    expect(assistant?.generationInterrupted).toBeFalsy();
  });

  it('abortActiveStream marks in-flight assistant message as generationInterrupted', () => {
    streamMock.streamChat.and.returnValue(new Observable<ChatStreamEvent>(() => {}));
    service.initialize();
    service.sendMessage('x');
    service.abortActiveStream();
    const assistant = service.messages().find(m => m.role === MessageRole.Assistant);
    expect(assistant?.generationInterrupted).toBe(true);
    expect(assistant?.isStreaming).toBe(false);
    expect(service.isStreaming()).toBe(false);
  });

  it('stopGeneration clears trace id and dashboard when stopping an active stream', () => {
    streamMock.streamChat.and.returnValue(new Observable<ChatStreamEvent>(() => {}));
    service.initialize();
    service.sendMessage('x');
    service.lastStreamTraceId.set('trace-keep');
    service.dashboardConfig.set({ title: 'Dash', sections: [] });
    service.stopGeneration();
    expect(service.lastStreamTraceId()).toBeNull();
    expect(service.dashboardConfig()).toBeNull();
  });

  it('abortActiveStream marks running tool calls as cancelled', () => {
    streamMock.streamChat.and.returnValue(
      new Observable<ChatStreamEvent>(subscriber => {
        subscriber.next({
          type: 'tool_call_start',
          toolName: 'get_stock_snapshot',
          toolCallId: 'c1'
        } as ChatStreamEvent);
      })
    );
    service.initialize();
    service.sendMessage('x');
    service.abortActiveStream();
    const assistant = service.messages().find(m => m.role === MessageRole.Assistant);
    expect(assistant?.toolCalls?.[0]?.status).toBe('cancelled');
  });

  it('sendMessage clears dashboard before starting a new request', () => {
    streamMock.streamChat.and.returnValue(of());
    service.initialize();
    service.dashboardConfig.set({ title: 'Previous', sections: [] });
    service.sendMessage('next');
    expect(service.dashboardConfig()).toBeNull();
  });

  it('sets generationInterrupted on stream error event', () => {
    streamMock.streamChat.and.returnValue(
      of({ type: 'error', error: 'fail' } as ChatStreamEvent)
    );
    service.initialize();
    service.sendMessage('x');
    const assistant = service.messages().find(m => m.role === MessageRole.Assistant);
    expect(assistant?.generationInterrupted).toBe(true);
    expect(assistant?.content).toBe('fail');
    expect(service.isStreaming()).toBe(false);
  });

  it('marks generationInterrupted when stream completes without done or error', () => {
    streamMock.streamChat.and.returnValue(
      of({ type: 'content', content: 'partial' } as ChatStreamEvent)
    );
    service.initialize();
    service.sendMessage('x');
    const assistant = service.messages().find(m => m.role === MessageRole.Assistant);
    expect(assistant?.isStreaming).toBe(false);
    expect(assistant?.generationInterrupted).toBe(true);
    expect(assistant?.content).toBe('partial');
    expect(service.isStreaming()).toBe(false);
  });

  it('hydrateFromConversationDetail maps DTO messages to ChatMessage', () => {
    const created = '2026-01-01T00:00:00Z';
    service.hydrateFromConversationDetail({
      id: 'c1',
      title: 'T',
      createdAt: created,
      lastMessageAt: created,
      selectedModel: 'm:latest',
      messages: [
        {
          id: 'm1',
          role: MessageRole.User,
          content: 'hello',
          createdAt: created
        }
      ]
    });
    expect(service.activeConversationId()).toBe('c1');
    expect(service.messages().length).toBe(1);
    expect(service.messages()[0].content).toBe('hello');
    expect(service.messages()[0].role).toBe(MessageRole.User);
  });

  it('hydrateFromConversationDetail normalizes string enum roles from API', () => {
    const created = '2026-01-01T00:00:00Z';
    service.hydrateFromConversationDetail({
      id: 'c1',
      title: 'T',
      createdAt: created,
      lastMessageAt: created,
      messages: [
        {
          id: 'u1',
          role: 'user' as unknown as MessageRole,
          content: 'hi',
          createdAt: created
        },
        {
          id: 't1',
          role: 'tool' as unknown as MessageRole,
          content: '[{"x":1}]',
          toolName: 'get_stock_snapshot',
          createdAt: created
        },
        {
          id: 'a1',
          role: 'assistant' as unknown as MessageRole,
          content: 'Done.',
          createdAt: created
        }
      ]
    });
    const msgs = service.messages();
    expect(msgs[0].role).toBe(MessageRole.User);
    expect(msgs[1].role).toBe(MessageRole.Tool);
    expect(msgs[2].role).toBe(MessageRole.Assistant);
  });

  it('sets parsedDashboard on assistant message when done and content has dashboard JSON', () => {
    const dash = { title: 'DashTitle', sections: [] };
    const body = `Résumé\n\`\`\`json\n${JSON.stringify(dash)}\n\`\`\``;
    streamMock.streamChat.and.returnValue(
      of(
        { type: 'content', content: body } as ChatStreamEvent,
        { type: 'done', conversationId: 'c1' } as ChatStreamEvent
      )
    );
    service.initialize();
    service.sendMessage('q');
    const assistant = service.messages().find(m => m.role === MessageRole.Assistant);
    expect(assistant?.parsedDashboard?.title).toBe('DashTitle');
  });

  it('hydrateFromConversationDetail sets parsedDashboard for assistant messages with dashboard JSON', () => {
    const dash = { title: 'Hydrated', sections: [] };
    const content = `Intro\n\`\`\`json\n${JSON.stringify(dash)}\n\`\`\``;
    const created = '2026-01-01T00:00:00Z';
    service.hydrateFromConversationDetail({
      id: 'c1',
      title: 'T',
      createdAt: created,
      lastMessageAt: created,
      messages: [
        {
          id: 'a1',
          role: MessageRole.Assistant,
          content,
          createdAt: created
        }
      ]
    });
    expect(service.messages()[0].parsedDashboard?.title).toBe('Hydrated');
  });

  it('hydrateFromConversationDetail finds dashboard JSON after a leading tool-data fence', () => {
    const dash = { title: 'AfterTool', sections: [] };
      const toolJson = JSON.stringify([{ productName: 'x', productId: 'x' }]);
    const content = `\`\`\`json\n${toolJson}\n\`\`\`\n\nSuite\n\`\`\`json\n${JSON.stringify(dash)}\n\`\`\``;
    const created = '2026-01-01T00:00:00Z';
    service.hydrateFromConversationDetail({
      id: 'c1',
      title: 'T',
      createdAt: created,
      lastMessageAt: created,
      messages: [
        {
          id: 'a1',
          role: MessageRole.Assistant,
          content,
          createdAt: created
        }
      ]
    });
    expect(service.messages()[0].parsedDashboard?.title).toBe('AfterTool');
  });

  it('dismissInlineDashboard sets hideInlineDashboard on assistant message', () => {
    service.messages.set([
      {
        id: 'a1',
        role: MessageRole.Assistant,
        content: '```json\n{"title":"T","sections":[]}\n```',
        createdAt: new Date(),
        parsedDashboard: { title: 'T', sections: [] }
      }
    ]);
    service.dismissInlineDashboard('a1');
    expect(service.messages()[0].hideInlineDashboard).toBe(true);
  });

  it('sets parsedDashboard from SSE "dashboard" event before the LLM emits any JSON fence', () => {
    const dashboard = {
      title: 'SSE Dash',
      sections: [{ type: 'chart' as const, title: 'C', data: {} }]
    };
    streamMock.streamChat.and.returnValue(
      of(
        { type: 'dashboard', dashboard: JSON.stringify(dashboard) } as ChatStreamEvent,
        {
          type: 'content',
          content: 'Analyse textuelle uniquement, pas de JSON.'
        } as ChatStreamEvent,
        { type: 'done', conversationId: 'c1' } as ChatStreamEvent
      )
    );
    service.initialize();
    service.sendMessage('graphique');
    const assistant = service.messages().find(m => m.role === MessageRole.Assistant);
    expect(assistant?.parsedDashboard?.title).toBe('SSE Dash');
    expect(assistant?.hideInlineDashboard).toBe(false);
  });

  it('ignores malformed "dashboard" SSE payloads without throwing', () => {
    streamMock.streamChat.and.returnValue(
      of(
        { type: 'dashboard', dashboard: '{ not valid json' } as ChatStreamEvent,
        {
          type: 'dashboard',
          dashboard: JSON.stringify({ title: 'NoSections' })
        } as ChatStreamEvent,
        { type: 'content', content: 'ok' } as ChatStreamEvent,
        { type: 'done', conversationId: 'c1' } as ChatStreamEvent
      )
    );
    service.initialize();
    expect(() => service.sendMessage('x')).not.toThrow();
    const assistant = service.messages().find(m => m.role === MessageRole.Assistant);
    expect(assistant?.parsedDashboard).toBeUndefined();
  });

  it('does not overwrite parsedDashboard from SSE event when the content also contains a dashboard fence', () => {
    const sseDashboard = { title: 'FromSSE', sections: [] };
    const fenceDashboard = { title: 'FromFence', sections: [] };
    const body = `Synthèse\n\`\`\`json\n${JSON.stringify(fenceDashboard)}\n\`\`\``;
    streamMock.streamChat.and.returnValue(
      of(
        { type: 'dashboard', dashboard: JSON.stringify(sseDashboard) } as ChatStreamEvent,
        { type: 'content', content: body } as ChatStreamEvent,
        { type: 'done', conversationId: 'c1' } as ChatStreamEvent
      )
    );
    service.initialize();
    service.sendMessage('q');
    const assistant = service.messages().find(m => m.role === MessageRole.Assistant);
    expect(assistant?.parsedDashboard?.title).toBe('FromSSE');
  });

  it('sendMessage with explicit volatileContext includes analysisSummary and backend screen block', () => {
    let capturedRequest: { message?: string; uiContext?: { analysisSummary?: string; screenId?: string } } =
      {};
    streamMock.streamChat.and.callFake((req: typeof capturedRequest) => {
      capturedRequest = req;
      return of({ type: 'done', conversationId: 'c1' } as ChatStreamEvent);
    });
    service.initialize();
    service.sendMessage({
      displayText: "Analyse de l'écran : Grand livre",
      backendText: 'Analyse écran',
      volatileContext: {
        screenId: 'accounting-ledger',
        analysisSummary: '{"schemaVersion":"1","screenId":"accounting-ledger","payload":{}}'
      }
    });

    expect(capturedRequest.uiContext?.screenId).toBe('accounting-ledger');
    expect(capturedRequest.uiContext?.analysisSummary).toContain('accounting-ledger');
    expect(capturedRequest.message).toBe('Analyse écran');

    const userMsg = service.messages().find(m => m.role === MessageRole.User);
    expect(userMsg?.content).toBe("Analyse de l'écran : Grand livre");
    expect(userMsg?.content).not.toContain('CONTEXTE ÉCRAN');
    expect(userMsg?.content).not.toContain('Analyse écran');
  });

  it('hydrateFromConversationDetail sanitizes persisted screen analysis user messages', () => {
    const created = '2026-01-01T00:00:00Z';
    const persisted = `Analyse les données du contexte écran joint à cette requête (bloc CONTEXTE ÉCRAN). Signale anomalies.\n\n[CONTEXTE ÉCRAN — accounting-ledger — non contractuel]\n{"rows":[]}\n[FIN CONTEXTE ÉCRAN]`;
    service.hydrateFromConversationDetail({
      id: 'c1',
      title: 'T',
      createdAt: created,
      lastMessageAt: created,
      messages: [
        {
          id: 'm1',
          role: MessageRole.User,
          content: persisted,
          createdAt: created
        }
      ]
    });
    expect(service.messages()[0].content).toBe("Analyse de l'écran : Grand livre");
  });

  it('reconciles client message ids with server ids after stream done', fakeAsync(() => {
    const serverConvId = '33333333-3333-3333-3333-333333333333';
    const serverUserId = '11111111-1111-1111-1111-111111111111';
    const serverAssistantId = '22222222-2222-2222-2222-222222222222';

    streamMock.streamChat.and.returnValue(
      of(
        { type: 'content', content: 'Bonjour' } as ChatStreamEvent,
        { type: 'done', conversationId: serverConvId } as ChatStreamEvent
      )
    );

    chatApi.getConversation.and.returnValue(
      of({
        id: serverConvId,
        title: 'T',
        createdAt: '2026-01-01T00:00:00Z',
        lastMessageAt: '2026-01-01T00:00:01Z',
        messages: [
          {
            id: serverUserId,
            role: MessageRole.User,
            content: 'Hello',
            createdAt: '2026-01-01T00:00:00Z'
          },
          {
            id: serverAssistantId,
            role: MessageRole.Assistant,
            content: 'Bonjour',
            createdAt: '2026-01-01T00:00:01Z'
          }
        ]
      })
    );

    service.sendMessage('Hello');
    tick();

    const msgs = service.messages();
    expect(msgs.length).toBe(2);
    expect(msgs[0].id).toBe(serverUserId);
    expect(msgs[0].serverSynced).toBeTrue();
    expect(msgs[1].id).toBe(serverAssistantId);
    expect(msgs[1].serverSynced).toBeTrue();
    expect(service.activeConversationId()).toBe(serverConvId);
  }));

  it('persiste la conversation active avec un suffixe dossier en mode délégué', () => {
    TestBed.resetTestingModule();
    setup({
      ...mockUser,
      accessMode: 'delegated',
      contextTenantId: 'ctx-tenant-a'
    });

    streamMock.streamChat.and.returnValue(
      of({ type: 'done', conversationId: 'conv-delegated' } as ChatStreamEvent)
    );
    service.initialize();
    service.sendMessage('Hello');

    expect(
      sessionStorage.getItem('ft_ai_active_conv_user-1_tenant-1_ctxctx-tenant-a')
    ).toBe('conv-delegated');
  });

  it('reset la session quand le dossier client change', fakeAsync(() => {
    TestBed.resetTestingModule();
    const userSig = setup({
      ...mockUser,
      accessMode: 'delegated',
      contextTenantId: 'ctx-a'
    });
    tick();

    service.initialize();
    service.setAgentScope(AssistantAgentScope.Accounting);
    service.activeConversationId.set('conv-a');
    service.messages.set([
      { id: '1', role: MessageRole.User, content: 'hi', createdAt: new Date() }
    ]);

    userSig.set({
      ...mockUser,
      accessMode: 'delegated',
      contextTenantId: 'ctx-b'
    });
    tick();

    expect(service.agentScope()).toBe(AssistantAgentScope.None);
    expect(service.activeConversationId()).toBeUndefined();
    expect(service.messages().length).toBe(0);
  }));

  // ── Lot 5 : routage client_actions confirm_firm_reminder + confirmation serveur ──────

  function confirmFirmReminderAction(nonce = 'n-1'): ConfirmFirmReminderAction {
    return {
      kind: 'confirm_firm_reminder',
      label: "Confirmer l'envoi de la relance",
      nonce,
      expiresAtUtc: new Date(Date.now() + 5 * 60_000).toISOString(),
      preview: { responsable: 'Sonia', dossier: 'D1', echeance: '2026-08-24', objet: '[Rappel] TVA CA3' }
    };
  }

  it('client_actions route l\'action confirm_firm_reminder vers firmReminderAction', () => {
    streamMock.streamChat.and.returnValue(
      of(
        {
          type: 'client_actions',
          clientActions: JSON.stringify([confirmFirmReminderAction('n-7')])
        } as ChatStreamEvent,
        { type: 'done', conversationId: 'c1' } as ChatStreamEvent
      )
    );
    service.initialize();
    service.sendMessage('relance Sonia pour la CA3');

    const assistant = service.messages().find(m => m.role === MessageRole.Assistant);
    expect(assistant?.firmReminderAction).toEqual(
      jasmine.objectContaining({ kind: 'confirm_firm_reminder', nonce: 'n-7' })
    );
  });

  it('client_actions sépare navigation (label+route) et confirm_firm_reminder', () => {
    streamMock.streamChat.and.returnValue(
      of(
        {
          type: 'client_actions',
          clientActions: JSON.stringify([
            { label: 'Ouvrir le dossier', route: '/firm/dossiers/1' },
            confirmFirmReminderAction('n-1')
          ])
        } as ChatStreamEvent,
        { type: 'done', conversationId: 'c1' } as ChatStreamEvent
      )
    );
    service.initialize();
    service.sendMessage('relance');

    const assistant = service.messages().find(m => m.role === MessageRole.Assistant);
    expect(assistant?.clientActions?.length).toBe(1);
    expect(assistant?.clientActions?.[0]?.route).toBe('/firm/dossiers/1');
    expect(assistant?.firmReminderAction?.nonce).toBe('n-1');
  });

  it('client_actions ignore une action confirm_firm_reminder sans nonce', () => {
    streamMock.streamChat.and.returnValue(
      of(
        {
          type: 'client_actions',
          clientActions: JSON.stringify([
            { kind: 'confirm_firm_reminder', label: 'x', preview: { responsable: 's', dossier: 'd', echeance: 'e', objet: 'o' } }
          ])
        } as ChatStreamEvent,
        { type: 'done', conversationId: 'c1' } as ChatStreamEvent
      )
    );
    service.initialize();
    service.sendMessage('relance');

    const assistant = service.messages().find(m => m.role === MessageRole.Assistant);
    expect(assistant?.firmReminderAction).toBeUndefined();
  });

  it('confirmFirmReminder bascule l\'état confirmé après succès serveur', () => {
    streamMock.streamChat.and.returnValue(
      of(
        {
          type: 'client_actions',
          clientActions: JSON.stringify([confirmFirmReminderAction('n-1')])
        } as ChatStreamEvent,
        { type: 'done', conversationId: 'c1' } as ChatStreamEvent
      )
    );
    service.initialize();
    service.sendMessage('relance');
    const id = service.messages().find(m => m.role === MessageRole.Assistant)!.id;

    chatApi.confirmFirmReminder.and.returnValue(
      of({ envoye: true, dossier: 'D1', obligation: 'TVA', echeance: '2026-08-24', destinataire: 'Sonia' })
    );
    service.confirmFirmReminder(id, 'n-1');

    const updated = service.messages().find(m => m.id === id);
    expect(updated?.firmReminderConfirmed).toBe(true);
    expect(updated?.firmReminderConfirming).toBe(false);
    expect(updated?.firmReminderError).toBeUndefined();
    expect(chatApi.confirmFirmReminder).toHaveBeenCalledWith('n-1');
  });

  it('confirmFirmReminder consigne l\'erreur sans marquer confirmé après échec serveur', () => {
    streamMock.streamChat.and.returnValue(
      of(
        {
          type: 'client_actions',
          clientActions: JSON.stringify([confirmFirmReminderAction('n-1')])
        } as ChatStreamEvent,
        { type: 'done', conversationId: 'c1' } as ChatStreamEvent
      )
    );
    service.initialize();
    service.sendMessage('relance');
    const id = service.messages().find(m => m.role === MessageRole.Assistant)!.id;

    chatApi.confirmFirmReminder.and.returnValue(
      throwError(() => ({ error: { message: 'Cette confirmation n\'est plus valide.' } }))
    );
    service.confirmFirmReminder(id, 'n-1');

    const updated = service.messages().find(m => m.id === id);
    expect(updated?.firmReminderConfirmed).toBeFalsy();
    expect(updated?.firmReminderConfirming).toBe(false);
    expect(updated?.firmReminderError).toContain('plus valide');
  });

  it('dismissFirmReminder retire l\'action en attente (le nonce expire côté serveur)', () => {
    streamMock.streamChat.and.returnValue(
      of(
        {
          type: 'client_actions',
          clientActions: JSON.stringify([confirmFirmReminderAction('n-1')])
        } as ChatStreamEvent,
        { type: 'done', conversationId: 'c1' } as ChatStreamEvent
      )
    );
    service.initialize();
    service.sendMessage('relance');
    const id = service.messages().find(m => m.role === MessageRole.Assistant)!.id;

    service.dismissFirmReminder(id);
    expect(service.messages().find(m => m.id === id)?.firmReminderAction).toBeUndefined();
    expect(chatApi.confirmFirmReminder).not.toHaveBeenCalled();
  });
});
