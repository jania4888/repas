import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Injectable, inject, PLATFORM_ID, signal, effect } from '@angular/core';
import { Subscription, fromEvent, firstValueFrom } from 'rxjs';
import { debounceTime, filter } from 'rxjs/operators';
import { AuthService, User } from '@core/services/auth.service';
import { createClientUuid } from '@core/utils/safe-random-uuid.util';
import { AiChatService } from './ai-chat.service';
import { AiStreamService } from './ai-stream.service';
import { AiUiContextService } from './ai-ui-context.service';
import { AiVolatileAnalysisStore, VolatileAnalysisPending } from './ai-volatile-analysis.store';
import { MessageSelectionService } from './message-selection.service';
import { appendVolatileScreenBlock } from '../utils/ai-volatile-analysis-payload.util';
import { buildAttachmentRequests, composeBackendMessage } from '../utils/chat-attachment-payload.util';
import { shouldDeduplicateContextInMessage } from '../utils/ai-screen-analysis-config';
import { sanitizeUserMessageForDisplay } from '../utils/ai-message-display-sanitizer.util';
import {
  AssistantAgentScope,
  AssistantMode,
  AssistantPhaseStatus,
  ChatAttachment,
  ChatAttachmentRequest,
  ChatMessage,
  MessageRole,
  ConversationDto,
  ActiveToolCall,
  ChatStreamEvent,
  ChatRequestOptions,
  ClientNavAction,
  ConfirmFirmReminderAction,
  DashboardConfig,
  SourceRef,
  AiActiveModelDto,
  ConversationDetailDto,
  ChatMessageDto,
  DailyAiBriefing,
  ChatUiContext,
  AssistantProgressTimeline,
  AssistantProgressStep
} from '../models/ai-chat.models';
import {
  extractDashboardConfig,
  extractSuggestedPromptsFromContent,
  isDashboardConfig,
  stripNonDashboardJsonFences,
  measureVisibleProseLength,
  MIN_MEANINGFUL_ASSISTANT_CHARS
} from '../utils/assistant-message-display';
import { getAssistantPhaseLabel } from '../utils/assistant-progress-display';
import { parseMessageRole } from '../utils/message-role.util';
import { environment } from '@environments/environment';

const AI_WARM_UP_TTL_MS = 5 * 60 * 1000;
const CONTENT_BATCH_MS = 16;

export interface SendMessageInput {
  /** Base text when displayText and backendText are not split. */
  text?: string;
  /** Text shown in the user chat bubble. Defaults to text or backendText. */
  displayText?: string;
  /** Text sent to the API as the user message base. Defaults to text or displayText. */
  backendText?: string;
  attachments?: ChatAttachment[];
  volatileContext?: VolatileAnalysisPending;
  /** When true, sends AssistantMode.ScreenAnalysis to the API. */
  screenAnalysis?: boolean;
  /** When true, marks this as a conversational follow-up (suggested-prompt click). */
  conversationalFollowUp?: boolean;
}

interface NormalizedSendMessageInput {
  displayText: string;
  backendText: string;
  attachments?: ChatAttachment[];
  volatileContext?: VolatileAnalysisPending;
  screenAnalysis?: boolean;
  conversationalFollowUp?: boolean;
}

export interface ScreenAnalysisTraceInfo {
  screenId: string;
  schemaVersion: string;
  payloadBytes: number;
  truncated: boolean;
  toolsUsed?: string[];
}

/**
 * Chat state and SSE subscription live in this singleton; they survive route changes.
 * Abort the stream only on logout/account switch, or implicitly when sending a new message.
 */
@Injectable({ providedIn: 'root' })
export class AiChatSessionService {
  private readonly auth = inject(AuthService);
  private readonly chatService = inject(AiChatService);
  private readonly streamService = inject(AiStreamService);
  private readonly uiContextService = inject(AiUiContextService);
  private readonly volatileAnalysisStore = inject(AiVolatileAnalysisStore);
  private readonly messageSelection = inject(MessageSelectionService);
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);

  readonly conversations = signal<ConversationDto[]>([]);
  readonly messages = signal<ChatMessage[]>([]);
  readonly activeConversationId = signal<string | undefined>(undefined);
  readonly isStreaming = signal(false);
  readonly showSidebar = signal(false);
  readonly aiAvailable = signal<boolean | null>(null);
  /** Modèle IA actif pour le tenant, configuré dans le back-office (GET /ai/active-model). */
  readonly activeModel = signal<AiActiveModelDto | null>(null);
  readonly dashboardConfig = signal<DashboardConfig | null>(null);
  /** Set when POST /ai/chat returns; matches server logs (X-Trace-Id). */
  readonly lastStreamTraceId = signal<string | null>(null);
  readonly lastScreenAnalysisTrace = signal<ScreenAnalysisTraceInfo | null>(null);
  /** True until first content chunk or tool activity; improves perceived latency. */
  readonly awaitingFirstToken = signal(false);
  /** When true, next chat uses compliance tool subset + prompt on the API. */
  readonly assistantComplianceMode = signal(false);
  readonly dailyBriefing = signal<DailyAiBriefing | null>(null);
  /**
   * Expert de module actif (assistants par module). None = assistant global (comportement historique).
   * Changer de scope démarre une nouvelle conversation et recharge l'historique du scope.
   */
  readonly agentScope = signal<AssistantAgentScope>(AssistantAgentScope.None);

  private streamSub?: Subscription;
  private contentBatchBuffer = '';
  private contentBatchAssistantId: string | null = null;
  private contentBatchTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly progressTimelineEnabled = environment.aiAssistantProgressTimelineEnabled !== false;
  private readonly warmUpEnabled = environment.aiAssistantWarmUpEnabled !== false;
  private readonly contentResyncEnabled = environment.aiAssistantContentResyncEnabled !== false;
  private readonly warmUpRequestedAt = new Map<string, number>();
  private hydrationAttempted = false;
  private initDone = false;

  constructor() {
    const auth = inject(AuthService);
    let prevUid: string | null | undefined = undefined;
    let prevCtxId: string | null | undefined = undefined;
    let prevAccessMode: User['accessMode'] | null | undefined = undefined;
    effect(
      () => {
        const user = auth.user();
        const uid = user?.id ?? null;
        const ctxId = user?.contextTenantId ?? null;
        const accessMode = user?.accessMode ?? null;
        if (prevUid !== undefined) {
          const accountSwitch =
            prevUid !== null && uid !== null && prevUid !== uid;
          const logout = prevUid !== null && uid === null;
          const dossierSwitch =
            uid !== null &&
            (prevCtxId !== ctxId || prevAccessMode !== accessMode);
          if (logout) {
            this.resetSessionForUserChange();
          } else if (accountSwitch || dossierSwitch) {
            this.resetSessionForUserChange();
            queueMicrotask(() => this.initialize());
          }
        }
        prevUid = uid;
        prevCtxId = ctxId;
        prevAccessMode = accessMode;
      }
    );

    if (isPlatformBrowser(this.platformId)) {
      fromEvent(this.document, 'visibilitychange')
        .pipe(
          debounceTime(300),
          filter(() => this.document.visibilityState === 'visible')
        )
        .subscribe(() => this.resyncActiveConversationAfterVisibility());
    }
  }

  /** User-facing alias: stops the in-flight assistant response and aborts the HTTP stream. */
  stopGeneration(): void {
    this.abortActiveStream();
  }

  /**
   * Clears the SSE subscription (logout / account switch). Messages still streaming are
   * marked interrupted so the UI does not look like a normal completion.
   */
  abortActiveStream(): void {
    const wasStreaming = this.isStreaming();
    this.flushContentBatch();
    this.streamSub?.unsubscribe();
    this.streamSub = undefined;
    if (wasStreaming) {
      this.isStreaming.set(false);
      this.awaitingFirstToken.set(false);
      this.lastStreamTraceId.set(null);
      this.clearDashboard();
      const activeAssistantId = this.findStreamingAssistantMessageId();
      if (activeAssistantId) {
        this.finalizeAssistantMessage(activeAssistantId, 'cancelled', {
          generationInterrupted: true
        });
      }
    }
  }

  initialize(): void {
    if (this.initDone) {
      return;
    }
    if (!this.auth.user()) {
      this.aiAvailable.set(false);
      return;
    }
    this.initDone = true;
    this.chatService.getConfiguredStatus().subscribe({
      next: res => this.aiAvailable.set(res.isFullyConfigured),
      error: () => this.aiAvailable.set(false)
    });
    this.syncConversationListFromApi();
    this.refreshDailyBriefing();
    this.loadActiveModel();
  }

  /**
   * Loads the tenant active AI model (configured in the back-office) and triggers
   * conversation hydration. Called once via `initialize()`.
   */
  private loadActiveModel(): void {
    this.chatService.getActiveModel().subscribe({
      next: model => {
        this.activeModel.set(model);
        this.requestWarmUpActiveModel();
        this.tryHydrateFromStorage();
      },
      error: () => {
        this.activeModel.set(null);
        this.tryHydrateFromStorage();
      }
    });
  }

  /** After login / when user context is ready; safe to call multiple times. */
  tryHydrateFromStorage(): void {
    if (this.hydrationAttempted) {
      return;
    }
    const id = this.readStoredActiveConversationId();
    if (!id) {
      this.hydrationAttempted = true;
      return;
    }
    this.hydrationAttempted = true;
    this.chatService.getConversation(id, this.isFirmSurface()).subscribe({
      next: detail => {
        this.hydrateFromConversationDetail(detail);
        this.shouldPersistActiveConversationId(detail.id);
      },
      error: () => {
        this.clearStoredActiveConversationId();
      }
    });
  }

  toggleSidebar(): void {
    this.showSidebar.update(v => !v);
    if (this.showSidebar()) {
      this.syncConversationListFromApi();
    }
  }

  /**
   * Vrai quand la session pilote l'agent cabinet : la surface HTTP est alors `/firm/ai`, permissionnée
   * séparément. Dérivé du scope plutôt que stocké dans un signal distinct, pour qu'il ne puisse pas
   * diverger du scope actif.
   */
  private isFirmSurface(): boolean {
    return this.agentScope() === AssistantAgentScope.FirmMission;
  }

  private apiBasePath(): string {
    return this.isFirmSurface() ? '/firm/ai' : '/ai';
  }

  syncConversationListFromApi(): void {
    const requestedScope = this.agentScope();
    this.chatService.getConversations(requestedScope, this.isFirmSurface()).subscribe({
      next: convs => {
        // Garde anti-course : n'applique la liste que si le scope n'a pas changé entre-temps.
        if (this.agentScope() === requestedScope) {
          this.conversations.set(convs);
        }
      },
      error: () => this.conversations.set([])
    });
  }

  refreshDailyBriefing(): void {
    this.chatService.getDailyBriefing().subscribe({
      next: b => this.dailyBriefing.set(b),
      error: () => this.dailyBriefing.set(null)
    });
  }

  setAssistantComplianceMode(on: boolean): void {
    this.assistantComplianceMode.set(on);
  }

  /**
   * Bascule l'expert de module actif. No-op si inchangé ; sinon : arrêt du stream en cours,
   * nouvelle conversation, mode conformité désactivé (fonctionnalité globale uniquement) et
   * rechargement de la liste des conversations du scope.
   */
  setAgentScope(scope: AssistantAgentScope): void {
    if (this.agentScope() === scope) {
      return;
    }
    this.abortActiveStream();
    this.agentScope.set(scope);
    if (scope !== AssistantAgentScope.None) {
      this.assistantComplianceMode.set(false);
    }
    this.startNewConversation();
    this.syncConversationListFromApi();
  }

  loadConversation(id: string): void {
    this.chatService.getConversation(id, this.isFirmSurface()).subscribe({
      next: detail => {
        this.hydrateFromConversationDetail(detail);
        this.shouldPersistActiveConversationId(detail.id);
        this.showSidebar.set(false);
      }
    });
  }

  deleteConversation(id: string): void {
    this.chatService.deleteConversation(id, this.isFirmSurface()).subscribe({
      next: () => {
        this.conversations.update(convs => convs.filter(c => c.id !== id));
        if (this.activeConversationId() === id) {
          this.activeConversationId.set(undefined);
          this.messages.set([]);
          this.clearStoredActiveConversationId();
        }
      }
    });
  }

  setLastScreenAnalysisTrace(info: ScreenAnalysisTraceInfo | null): void {
    this.lastScreenAnalysisTrace.set(info);
  }

  startNewConversation(): void {
    this.activeConversationId.set(undefined);
    this.messages.set([]);
    this.clearStoredActiveConversationId();
    this.showSidebar.set(false);
  }

  /** Vrai si le modèle IA actif supporte l'entrée image (vision). */
  selectedModelSupportsVision(): boolean {
    return this.activeModel()?.supportsVision === true;
  }

  /** Variante publique acceptant un objet { text, attachments } depuis chat-input. */
  sendMessageWithAttachments(submission: { text: string; attachments: ChatAttachment[] }): void {
    this.sendMessage(submission.text, submission.attachments);
  }

  /**
   * Envoie un prompt suggéré comme suivi conversationnel : le backend route vers l'intent Synthesis
   * (catalogue restreint) pour répondre à partir de l'analyse déjà présente, sans dériver vers des
   * outils hors-contexte.
   */
  sendSuggestedPrompt(prompt: string): void {
    this.sendMessage({ text: prompt, conversationalFollowUp: true });
  }

  /**
   * Confirme une relance d'échéance en attente (carte « action en attente ») : POST
   * `/api/firm/ai/reminders/confirm` avec le nonce, puis bascule le message sur l'état confirmé.
   * Le nonce est à usage unique côté serveur (consommation atomique) : un deuxième clic ne renvoie
   * pas l'e-mail. Un échec transitoire laisse le nonce valide tant qu'il n'a pas expiré.
   */
  confirmFirmReminder(messageId: string, nonce: string): void {
    if (!nonce) {
      return;
    }
    this.updateAssistantMessage(messageId, {
      firmReminderConfirming: true,
      firmReminderError: undefined
    });
    this.chatService.confirmFirmReminder(nonce).subscribe({
      next: () => {
        this.updateAssistantMessage(messageId, {
          firmReminderConfirming: false,
          firmReminderConfirmed: true,
          firmReminderError: undefined
        });
      },
      error: (err: unknown) => {
        this.updateAssistantMessage(messageId, {
          firmReminderConfirming: false,
          firmReminderError: this.resolveConfirmReminderErrorMessage(err)
        });
      }
    });
  }

  /** Annule localement une relance en attente : aucun appel serveur, le nonce expire de lui-même. */
  dismissFirmReminder(messageId: string): void {
    this.updateAssistantMessage(messageId, {
      firmReminderAction: undefined,
      firmReminderError: undefined
    });
  }

  private resolveConfirmReminderErrorMessage(err: unknown): string {
    const e = err as { error?: { message?: string }; message?: string } | null;
    return e?.error?.message || e?.message || $localize`:@@ai-assistant.ai-chat-session.ts.la.confirmation.de.la.relance.a.echoue.a8e4be33:La confirmation de la relance a échoué.`;
  }

  sendMessage(
    input: string | SendMessageInput,
    attachments?: ChatAttachment[],
    volatileContext?: VolatileAnalysisPending
  ): void {
    if (this.isStreaming()) {
      return;
    }

    const normalized = this.normalizeSendMessageInput(input, attachments, volatileContext);

    this.clearDashboard();

    const visionCapable = this.selectedModelSupportsVision();
    const pendingVolatile =
      normalized.volatileContext ?? this.volatileAnalysisStore.takePendingForSend();
    let messageForBackend = composeBackendMessage(normalized.backendText, normalized.attachments);
    if (pendingVolatile) {
      messageForBackend = appendVolatileScreenBlock(
        messageForBackend,
        pendingVolatile.screenId,
        pendingVolatile.analysisSummary,
        shouldDeduplicateContextInMessage()
      );
    }
    const attachmentsPayload = buildAttachmentRequests(normalized.attachments, visionCapable);

    const userMsg: ChatMessage = {
      id: createClientUuid(),
      role: MessageRole.User,
      content: normalized.displayText,
      createdAt: new Date(),
      ...(normalized.attachments && normalized.attachments.length > 0
        ? { attachments: normalized.attachments }
        : {})
    };

    this.messages.update(msgs => [...msgs, userMsg]);

    const assistantMsg: ChatMessage = {
      id: createClientUuid(),
      role: MessageRole.Assistant,
      content: '',
      createdAt: new Date(),
      isStreaming: true,
      toolCalls: [],
      ...(this.progressTimelineEnabled
        ? {
            progress: {
              status: 'running' as const,
              steps: []
            }
          }
        : {})
    };

    this.messages.update(msgs => [...msgs, assistantMsg]);
    this.isStreaming.set(true);
    this.awaitingFirstToken.set(true);
    this.lastStreamTraceId.set(null);

    this.streamSub?.unsubscribe();

    let receivedTerminalStreamEvent = false;
    const baseContext = this.uiContextService.buildSnapshot();
    const uiContext = mergeVolatileAnalysisIntoContext(baseContext, pendingVolatile);
    const isScreenAnalysis =
      normalized.screenAnalysis === true || !!pendingVolatile;
    const isConversationalFollowUp =
      normalized.conversationalFollowUp === true && !this.assistantComplianceMode() && !isScreenAnalysis;
    const baseOptions: ChatRequestOptions | undefined = this.assistantComplianceMode()
      ? { assistantMode: AssistantMode.Compliance }
      : isScreenAnalysis
        ? { assistantMode: AssistantMode.ScreenAnalysis }
        : isConversationalFollowUp
          ? { conversationalFollowUp: true }
          : undefined;
    // Expert de module : transmis aussi en ScreenAnalysis (ignoré côté serveur pour outils/prompt,
    // mais la conversation créée est classée dans l'historique du scope actif).
    const activeScope = this.agentScope();
    const options: ChatRequestOptions | undefined =
      activeScope !== AssistantAgentScope.None
        ? { ...(baseOptions ?? {}), agentScope: activeScope }
        : baseOptions;

    this.streamSub = this.streamService
      .streamChat(
        {
          conversationId: this.activeConversationId() || undefined,
          message: messageForBackend,
          ...(uiContext ? { uiContext } : {}),
          ...(options ? { options } : {}),
          ...(attachmentsPayload.length > 0 ? { attachments: attachmentsPayload } : {})
        },
        meta => this.lastStreamTraceId.set(meta.traceId),
        this.apiBasePath()
      )
      .subscribe({
        next: (event: ChatStreamEvent) => {
          if (event.type === 'done' || event.type === 'error') {
            receivedTerminalStreamEvent = true;
          }
          this.handleStreamEvent(event, assistantMsg.id);
        },
        error: (err: unknown) => {
          this.flushContentBatch();
          this.finalizeAssistantMessage(assistantMsg.id, 'failed', {
            content: this.resolveStreamErrorMessage(err),
            generationInterrupted: true
          });
          this.isStreaming.set(false);
          this.awaitingFirstToken.set(false);
        },
        complete: () => {
          this.flushContentBatch();
          this.isStreaming.set(false);
          this.awaitingFirstToken.set(false);
          if (!receivedTerminalStreamEvent) {
            this.finalizeAssistantOnAbnormalStreamEnd(assistantMsg.id);
          }
        }
      });
  }

  private normalizeSendMessageInput(
    input: string | SendMessageInput,
    attachments?: ChatAttachment[],
    volatileContext?: VolatileAnalysisPending
  ): NormalizedSendMessageInput {
    if (typeof input === 'string') {
      return {
        displayText: input,
        backendText: input,
        attachments,
        volatileContext
      };
    }

    const baseText = input.text ?? input.displayText ?? input.backendText ?? '';
    return {
      displayText: input.displayText ?? baseText,
      backendText: input.backendText ?? baseText,
      attachments: input.attachments ?? attachments,
      volatileContext: input.volatileContext ?? volatileContext,
      screenAnalysis: input.screenAnalysis,
      conversationalFollowUp: input.conversationalFollowUp
    };
  }

  /**
   * When the HTTP/SSE stream closes without a terminal `done` or `error` event (proxy drop,
   * tab discard, etc.), ensure the assistant bubble is not left in a perpetual "streaming" state.
   */
  private finalizeAssistantOnAbnormalStreamEnd(assistantMsgId: string): void {
    this.finalizeAssistantMessage(assistantMsgId, 'cancelled', {
      generationInterrupted: true
    });
  }

  /** Message d'erreur adapté au statut HTTP du flux IA (401 / 403 / 429), sinon message générique. */
  private resolveStreamErrorMessage(err: unknown): string {
    const status = (err as { httpStatus?: number } | null)?.httpStatus;
    const message = (err as Error | null)?.message;
    if (status === 401) {
      return $localize`:@@ai-assistant.ai-chat-session.ts.session.expiree.veuillez.vous.reconnecte.be32677a:Session expirée. Veuillez vous reconnecter, puis renvoyer votre message.`;
    }
    if (status === 403) {
      if (message && !message.startsWith('HTTP 403')) {
        return message;
      }
      return $localize`:@@ai-assistant.ai-chat-session.ts.action.non.autorisee.en.mode.dossier.cli.e08597d7:Action non autorisée en mode dossier client.`;
    }
    if (status === 429) {
      return $localize`:@@ai-assistant.ai-chat-session.ts.trop.de.requetes.vers.l.assistant.ia.pat.ebb869db:Trop de requêtes vers l’assistant IA. Patientez un instant avant de réessayer.`;
    }
    return $localize`:@@ai-assistant.ai-chat-session.ts.une.erreur.est.survenue.veuillez.essayer.431c8d83:Une erreur est survenue. Veuillez essayer de nouveau.`;
  }

  /**
   * After returning to the tab, reload the active conversation from the API when the UI may be
   * stale (interrupted generation or stuck streaming flags) while the server has persisted state.
   */
  private resyncActiveConversationAfterVisibility(): void {
    if (this.isStreaming()) {
      return;
    }
    const id = this.activeConversationId();
    if (!id) {
      return;
    }
    const msgs = this.messages();
    const lastAssistant = [...msgs].reverse().find(m => m.role === MessageRole.Assistant);
    if (!lastAssistant) {
      return;
    }
    const needsResync =
      lastAssistant.isStreaming === true ||
      (lastAssistant.generationInterrupted === true && !lastAssistant.content?.trim());

    if (!needsResync) {
      return;
    }

    this.chatService.getConversation(id).subscribe({
      next: detail => {
        if (detail.id !== id) {
          return;
        }
        this.hydrateFromConversationDetail(detail);
        this.syncConversationListFromApi();
      },
      error: () => {
        /* keep local state */
      }
    });
  }

  private handleStreamEvent(event: ChatStreamEvent, assistantMsgId: string): void {
    switch (event.type) {
      case 'phase':
        if (!this.progressTimelineEnabled || !event.phase) {
          break;
        }
        this.messages.update(msgs =>
          msgs.map(m =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  progress: this.mergePhaseIntoProgress(m.progress, event)
                }
              : m
          )
        );
        break;

      case 'content':
        this.scheduleContentBatch(assistantMsgId, event.content || '');
        break;

      case 'content_replace':
        this.flushContentBatch();
        this.messages.update(msgs =>
          msgs.map(m =>
            m.id === assistantMsgId ? { ...m, content: event.content ?? '' } : m
          )
        );
        break;

      case 'tool_call_start': {
        this.awaitingFirstToken.set(false);
        const tc: ActiveToolCall = {
          name: event.toolName || '',
          callId: event.toolCallId || '',
          status: 'running'
        };
        this.messages.update(msgs =>
          msgs.map(m =>
            m.id === assistantMsgId ? { ...m, toolCalls: [...(m.toolCalls || []), tc] } : m
          )
        );
        break;
      }

      case 'tool_call_end':
        this.messages.update(msgs =>
          msgs.map(m =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  toolCalls: (m.toolCalls || []).map(tc =>
                    tc.callId === event.toolCallId
                      ? {
                          ...tc,
                          status: 'completed' as const,
                          ...(typeof event.elapsedMs === 'number' ? { elapsedMs: event.elapsedMs } : {})
                        }
                      : tc
                  )
                }
              : m
          )
        );
        break;

      case 'done':
        this.flushContentBatch();
        this.awaitingFirstToken.set(false);
        this.finalizeAssistantMessage(assistantMsgId, 'completed', {
          generationInterrupted: false
        });
        if (event.conversationId) {
          this.activeConversationId.set(event.conversationId);
          this.shouldPersistActiveConversationId(event.conversationId);
          this.reconcileMessagesWithServer(event.conversationId);
        }
        this.isStreaming.set(false);
        this.syncConversationListFromApi();
        this.tryParseDashboard(assistantMsgId);
        break;

      case 'error':
        this.flushContentBatch();
        this.awaitingFirstToken.set(false);
        this.finalizeAssistantMessage(assistantMsgId, 'failed', {
          content: event.error || 'Erreur inconnue',
          generationInterrupted: true
        });
        this.isStreaming.set(false);
        break;

      case 'heartbeat':
        break;

      case 'client_actions': {
        let navActions: ClientNavAction[] = [];
        let reminderAction: ConfirmFirmReminderAction | undefined;
        try {
          const raw = event.clientActions;
          if (raw) {
            const parsed = JSON.parse(raw) as unknown;
            if (Array.isArray(parsed)) {
              for (const a of parsed) {
                if (!a || typeof a !== 'object') {
                  continue;
                }
                // Action de relance en attente de confirmation (Lot 4.3 / 5.3) : discriminée par
                // `kind`, jamais par `route` (qu'elle ne porte pas). On ne conserve que la première.
                if (
                  (a as ConfirmFirmReminderAction).kind === 'confirm_firm_reminder' &&
                  typeof (a as ConfirmFirmReminderAction).nonce === 'string' &&
                  !!(a as ConfirmFirmReminderAction).preview
                ) {
                  reminderAction ??= a as ConfirmFirmReminderAction;
                  continue;
                }
                if (
                  typeof (a as ClientNavAction).label === 'string' &&
                  typeof (a as ClientNavAction).route === 'string'
                ) {
                  navActions.push(a as ClientNavAction);
                }
              }
            }
          }
        } catch {
          navActions = [];
          reminderAction = undefined;
        }
        if (navActions.length > 0 || reminderAction) {
          this.messages.update(msgs =>
            msgs.map(m =>
              m.id === assistantMsgId
                ? {
                    ...m,
                    ...(navActions.length > 0 ? { clientActions: navActions } : {}),
                    ...(reminderAction ? { firmReminderAction: reminderAction } : {})
                  }
                : m
            )
          );
        }
        break;
      }

      case 'suggested_prompts': {
        let prompts: string[] = [];
        try {
          const raw = event.suggestedPrompts;
          if (raw) {
            const parsed = JSON.parse(raw) as unknown;
            if (Array.isArray(parsed)) {
              prompts = parsed.filter((p): p is string => typeof p === 'string' && p.trim().length > 0);
            }
          }
        } catch {
          prompts = [];
        }
        if (prompts.length > 0) {
          this.messages.update(msgs =>
            msgs.map(m =>
              m.id === assistantMsgId ? { ...m, suggestedPrompts: prompts } : m
            )
          );
        }
        break;
      }

      case 'dashboard': {
        if (!event.dashboard) {
          break;
        }
        try {
          const parsed = JSON.parse(event.dashboard) as unknown;
          if (!isDashboardConfig(parsed)) {
            break;
          }
          this.messages.update(msgs =>
            msgs.map(m =>
              m.id === assistantMsgId && !m.parsedDashboard
                ? { ...m, parsedDashboard: parsed, hideInlineDashboard: false }
                : m
            )
          );
        } catch {
          // Malformed dashboard payload — ignore silently; the fallback parse on `done` will retry.
        }
        break;
      }

      case 'sources': {
        let refs: SourceRef[] = [];
        try {
          const raw = event.sources;
          if (raw) {
            const parsed = JSON.parse(raw) as unknown;
            if (Array.isArray(parsed)) {
              refs = parsed.filter(
                (s): s is SourceRef =>
                  !!s &&
                  typeof s === 'object' &&
                  typeof (s as SourceRef).toolName === 'string' &&
                  typeof (s as SourceRef).toolCallId === 'string'
              );
            }
          }
        } catch {
          refs = [];
        }
        if (refs.length > 0) {
          this.messages.update(msgs =>
            msgs.map(m => (m.id === assistantMsgId ? { ...m, sources: refs } : m))
          );
        }
        break;
      }

      default:
        break;
    }
  }

  private scheduleContentBatch(assistantMsgId: string, chunk: string): void {
    if (!chunk) {
      return;
    }
    if (this.contentBatchAssistantId !== assistantMsgId) {
      this.flushContentBatch();
      this.contentBatchAssistantId = assistantMsgId;
    }
    this.contentBatchBuffer += chunk;
    if (this.contentBatchTimer !== null) {
      return;
    }
    this.contentBatchTimer = setTimeout(() => this.flushContentBatch(), CONTENT_BATCH_MS);
  }

  private flushContentBatch(): void {
    if (this.contentBatchTimer !== null) {
      clearTimeout(this.contentBatchTimer);
      this.contentBatchTimer = null;
    }
    const assistantMsgId = this.contentBatchAssistantId;
    const chunk = this.contentBatchBuffer;
    this.contentBatchBuffer = '';
    if (!assistantMsgId || !chunk) {
      return;
    }
    this.awaitingFirstToken.set(false);
    this.messages.update(msgs =>
      msgs.map(m =>
        m.id === assistantMsgId ? { ...m, content: m.content + chunk } : m
      )
    );
  }

  private updateAssistantMessage(id: string, updates: Partial<ChatMessage>): void {
    this.messages.update(msgs => msgs.map(m => (m.id === id ? { ...m, ...updates } : m)));
  }

  private findStreamingAssistantMessageId(): string | null {
    const activeAssistant = [...this.messages()]
      .reverse()
      .find(message => message.role === MessageRole.Assistant && message.isStreaming);
    return activeAssistant?.id ?? null;
  }

  private finalizeAssistantMessage(
    assistantMessageId: string,
    status: AssistantPhaseStatus,
    updates: Partial<ChatMessage> = {}
  ): void {
    this.messages.update(msgs =>
      msgs.map(message => {
        if (message.id !== assistantMessageId || message.role !== MessageRole.Assistant) {
          return message;
        }

        const toolCalls =
          status === 'completed' || !message.toolCalls?.length
            ? message.toolCalls
            : message.toolCalls.map(toolCall =>
                toolCall.status === 'running'
                  ? { ...toolCall, status: 'cancelled' as const }
                  : toolCall
              );

        return {
          ...message,
          ...updates,
          isStreaming: false,
          ...(toolCalls !== undefined ? { toolCalls } : {}),
          ...(this.progressTimelineEnabled
            ? { progress: this.finalizeProgressTimeline(message.progress, status) }
            : {})
        };
      })
    );
  }

  requestWarmUpActiveModel(force = false): void {
    if (!this.warmUpEnabled) {
      return;
    }

    const modelRef = this.activeModel()?.modelRef ?? null;
    if (!this.shouldWarmUpModel(modelRef)) {
      return;
    }

    const now = Date.now();
    const lastRequestedAt = this.warmUpRequestedAt.get(modelRef);
    if (!force && typeof lastRequestedAt === 'number' && now - lastRequestedAt < AI_WARM_UP_TTL_MS) {
      return;
    }

    this.warmUpRequestedAt.set(modelRef, now);
    this.chatService.warmUp().subscribe({
      error: () => this.warmUpRequestedAt.delete(modelRef)
    });
  }

  private shouldWarmUpModel(modelRef: string | null): modelRef is string {
    if (!modelRef?.trim()) {
      return false;
    }

    return modelRef.startsWith('ollama:');
  }

  private mergePhaseIntoProgress(
    current: AssistantProgressTimeline | undefined,
    event: ChatStreamEvent
  ): AssistantProgressTimeline {
    const code = event.phase?.trim();
    if (!code) {
      return current ?? { status: 'running', steps: [] };
    }

    const status = this.normalizePhaseStatus(event.phaseStatus);
    const key = this.buildProgressStepKey(code, event.round);
    const nextStep: AssistantProgressStep = {
      key,
      code,
      label: getAssistantPhaseLabel(code),
      status,
      ...(typeof event.elapsedMs === 'number' ? { elapsedMs: event.elapsedMs } : {}),
      ...(typeof event.round === 'number' ? { round: event.round } : {}),
      ...(event.firstTokenMs !== undefined ? { firstTokenMs: event.firstTokenMs } : {}),
      ...(typeof event.hadToolCalls === 'boolean' ? { hadToolCalls: event.hadToolCalls } : {}),
      ...(event.detail?.trim() ? { detail: event.detail.trim() } : {})
    };

    const steps = current?.steps ?? [];
    const existingIndex = steps.findIndex(step => step.key === key);
    const nextSteps =
      existingIndex >= 0
        ? steps.map((step, index) => (index === existingIndex ? { ...step, ...nextStep } : step))
        : [...steps, nextStep];

    return {
      status: status === 'failed' || status === 'cancelled' ? status : 'running',
      steps: nextSteps
    };
  }

  private finalizeProgressTimeline(
    progress: AssistantProgressTimeline | undefined,
    status: AssistantPhaseStatus
  ): AssistantProgressTimeline | undefined {
    if (!progress) {
      return undefined;
    }

    return {
      status,
      steps: progress.steps.map(step =>
        step.status === 'running'
          ? {
              ...step,
              status: status === 'completed' ? 'completed' : status
            }
          : step
      )
    };
  }

  private buildProgressStepKey(code: string, round?: number): string {
    return typeof round === 'number' ? `${code}:${round}` : code;
  }

  private normalizePhaseStatus(status: ChatStreamEvent['phaseStatus']): AssistantPhaseStatus {
    switch (status) {
      case 'running':
      case 'completed':
      case 'failed':
      case 'cancelled':
        return status;
      default:
        return 'completed';
    }
  }

  private tryParseDashboard(msgId: string): void {
    const msg = this.messages().find(m => m.id === msgId);
    if (!msg || msg.parsedDashboard) {
      return;
    }
    const extracted = extractDashboardConfig(stripNonDashboardJsonFences(msg.content));
    if (!extracted) {
      return;
    }
    this.updateAssistantMessage(msgId, { parsedDashboard: extracted.config });
  }

  /** User closed the inline dashboard chip for this assistant message. */
  dismissInlineDashboard(messageId: string): void {
    this.messages.update(msgs =>
      msgs.map(m =>
        m.id === messageId && m.role === MessageRole.Assistant
          ? { ...m, hideInlineDashboard: true }
          : m
      )
    );
  }

  /** Restore inline dashboard after the user hid it. */
  showInlineDashboard(messageId: string): void {
    this.messages.update(msgs =>
      msgs.map(m =>
        m.id === messageId && m.role === MessageRole.Assistant
          ? { ...m, hideInlineDashboard: false }
          : m
      )
    );
  }

  hydrateFromConversationDetail(detail: ConversationDetailDto): void {
    this.activeConversationId.set(detail.id);
    this.messages.set(detail.messages.map(m => this.mapDtoToChatMessage(m)));
  }

  /**
   * Re-fetches the active conversation and remaps local (client-generated) message ids to the
   * ids persisted by the backend. Required for PowerPoint export immediately after streaming.
   */
  reconcileActiveConversation(): Promise<void> {
    const conversationId = this.activeConversationId();
    if (!conversationId) {
      return Promise.resolve();
    }
    return firstValueFrom(this.chatService.getConversation(conversationId))
      .then(detail => this.applyServerMessageIdReconciliation(detail))
      .catch(() => undefined);
  }

  /**
   * Loads conversation detail from the API and reconciles message ids without replacing UI state.
   */
  private reconcileMessagesWithServer(conversationId: string): void {
    this.chatService.getConversation(conversationId).subscribe({
      next: detail => {
        this.applyServerMessageIdReconciliation(detail);
        if (this.contentResyncEnabled) {
          this.applyServerContentReconciliation(detail);
        }
      },
      error: () => {
        /* keep local ids; export may retry reconcile */
      }
    });
  }

  /**
   * When the client bubble is too short but the server persisted an enhanced body, replace local content.
   */
  private applyServerContentReconciliation(detail: ConversationDetailDto): void {
    const activeId = this.activeConversationId();
    if (!activeId || detail.id !== activeId) {
      return;
    }

    const localMessages = this.messages();
    const serverMessages = detail.messages;
    if (localMessages.length === 0 || serverMessages.length === 0) {
      return;
    }

    const lastLocalAssistant = [...localMessages]
      .reverse()
      .find(m => m.role === MessageRole.Assistant && !m.isStreaming);
    const lastServerAssistant = [...serverMessages]
      .reverse()
      .find(m => parseMessageRole(m.role) === MessageRole.Assistant);

    if (!lastLocalAssistant || !lastServerAssistant) {
      return;
    }

    const localVisible = measureVisibleProseLength(lastLocalAssistant.content);
    const serverVisible = measureVisibleProseLength(lastServerAssistant.content);
    if (localVisible >= MIN_MEANINGFUL_ASSISTANT_CHARS || serverVisible <= localVisible) {
      return;
    }

    this.messages.update(msgs =>
      msgs.map(m =>
        m.id === lastLocalAssistant.id
          ? { ...m, content: lastServerAssistant.content, serverSynced: true }
          : m
      )
    );
  }

  private applyServerMessageIdReconciliation(detail: ConversationDetailDto): void {
    const activeId = this.activeConversationId();
    if (!activeId || detail.id !== activeId) {
      return;
    }

    const localMessages = this.messages();
    const serverMessages = detail.messages;
    if (localMessages.length === 0 || serverMessages.length === 0) {
      return;
    }

    const remap = this.buildMessageIdRemap(localMessages, serverMessages);
    if (remap.size === 0) {
      return;
    }

    this.messages.update(msgs =>
      msgs.map(message => {
        const serverId = remap.get(message.id);
        if (!serverId) {
          return message;
        }
        return { ...message, id: serverId, serverSynced: true };
      })
    );

    for (const [clientId, serverId] of remap) {
      this.messageSelection.remapMessageId(clientId, serverId);
    }
  }

  private buildMessageIdRemap(
    localMessages: ChatMessage[],
    serverMessages: ChatMessageDto[]
  ): Map<string, string> {
    const remap = new Map<string, string>();
    const pairCount = Math.min(localMessages.length, serverMessages.length);

    for (let index = 0; index < pairCount; index++) {
      const local = localMessages[index];
      const server = serverMessages[index];
      const serverRole = parseMessageRole(server.role);

      if (local.role !== serverRole || local.id === server.id) {
        continue;
      }

      if (this.messagesMatchForReconciliation(local, server)) {
        remap.set(local.id, server.id);
      }
    }

    if (remap.size === 0 && localMessages.length <= serverMessages.length) {
      const offset = serverMessages.length - localMessages.length;
      for (let index = 0; index < localMessages.length; index++) {
        const local = localMessages[index];
        const server = serverMessages[offset + index];
        const serverRole = parseMessageRole(server.role);

        if (local.role !== serverRole || local.id === server.id) {
          continue;
        }

        if (this.messagesMatchForReconciliation(local, server)) {
          remap.set(local.id, server.id);
        }
      }
    }

    return remap;
  }

  private messagesMatchForReconciliation(local: ChatMessage, server: ChatMessageDto): boolean {
    const localContent = this.normalizeContentForReconciliation(local.role, local.content);
    const serverContent = this.normalizeContentForReconciliation(
      parseMessageRole(server.role),
      server.content
    );

    if (!localContent && !serverContent) {
      return true;
    }

    if (localContent === serverContent) {
      return true;
    }

    const prefixLength = Math.min(120, localContent.length, serverContent.length);
    if (prefixLength > 0) {
      return localContent.slice(0, prefixLength) === serverContent.slice(0, prefixLength);
    }

    return false;
  }

  private normalizeContentForReconciliation(role: MessageRole, content: string): string {
    const normalized =
      role === MessageRole.User ? sanitizeUserMessageForDisplay(content) : content;
    return normalized.replace(/\s+/g, ' ').trim();
  }

  private mapDtoToChatMessage(m: ChatMessageDto): ChatMessage {
    const role = parseMessageRole(m.role);
    const content =
      role === MessageRole.User ? sanitizeUserMessageForDisplay(m.content) : m.content;
    const base: ChatMessage = {
      id: m.id,
      role,
      content,
      createdAt: new Date(m.createdAt),
      toolName: m.toolName,
      serverSynced: true
    };
    if (role !== MessageRole.Assistant) {
      return base;
    }
    const prompts = extractSuggestedPromptsFromContent(m.content);
    const withPrompts: ChatMessage =
      prompts.length > 0 ? { ...base, suggestedPrompts: prompts } : base;
    const extracted = extractDashboardConfig(stripNonDashboardJsonFences(m.content));
    if (!extracted) {
      return withPrompts;
    }
    return { ...withPrompts, parsedDashboard: extracted.config };
  }

  clearDashboard(): void {
    this.dashboardConfig.set(null);
  }

  private storageKeyActiveConversation(): string | null {
    const u = this.auth.user();
    if (!u?.id) {
      return null;
    }
    // Clé historique inchangée pour l'assistant global ; suffixe par scope pour les experts de module
    // (évite de rouvrir une conversation Ventes dans le panneau global et inversement).
    const scope = this.agentScope();
    const scopeSuffix = scope !== AssistantAgentScope.None ? `_scope${scope}` : '';
    const dossierSuffix =
      u.accessMode === 'delegated' && u.contextTenantId
        ? `_ctx${u.contextTenantId}`
        : '';
    return `ft_ai_active_conv_${u.id}_${u.tenantId}${dossierSuffix}${scopeSuffix}`;
  }

  private readStoredActiveConversationId(): string | null {
    const key = this.storageKeyActiveConversation();
    if (!key) {
      return null;
    }
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private shouldPersistActiveConversationId(id: string): void {
    const key = this.storageKeyActiveConversation();
    if (!key) {
      return;
    }
    try {
      sessionStorage.setItem(key, id);
    } catch {
      // ignore
    }
  }

  private clearStoredActiveConversationId(): void {
    const key = this.storageKeyActiveConversation();
    if (!key) {
      return;
    }
    try {
      sessionStorage.removeItem(key);
    } catch {
      // ignore
    }
  }

  /** Call on logout if we add a hook; optional explicit clear. */
  resetSessionForUserChange(): void {
    this.volatileAnalysisStore.clear();
    this.abortActiveStream();
    this.awaitingFirstToken.set(false);
    this.lastStreamTraceId.set(null);
    this.messages.set([]);
    this.activeConversationId.set(undefined);
    this.conversations.set([]);
    this.dashboardConfig.set(null);
    this.dailyBriefing.set(null);
    this.assistantComplianceMode.set(false);
    this.agentScope.set(AssistantAgentScope.None);
    this.hydrationAttempted = false;
    this.initDone = false;
    this.activeModel.set(null);
    this.warmUpRequestedAt.clear();
    const key = this.storageKeyActiveConversation();
    if (key) {
      try {
        sessionStorage.removeItem(key);
      } catch {
        // ignore
      }
    }
  }
}

function mergeVolatileAnalysisIntoContext(
  base: ChatUiContext | undefined,
  pending: import('./ai-volatile-analysis.store').VolatileAnalysisPending | null
): ChatUiContext | undefined {
  if (!pending) {
    return base;
  }
  return {
    ...base,
    screenId: pending.screenId || base?.screenId,
    analysisSummary: pending.analysisSummary
  };
}

