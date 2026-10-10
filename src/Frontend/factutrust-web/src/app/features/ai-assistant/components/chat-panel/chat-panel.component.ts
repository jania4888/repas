import {
  ChangeDetectionStrategy,
  Component,
  HostBinding,
  inject,
  ViewChild,
  ElementRef,
  AfterViewInit,
  OnChanges,
  OnDestroy,
  OnInit,
  Input,
  Output,
  EventEmitter,
  effect,
  SimpleChanges,
  computed,
  signal
} from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import { AiChatSessionService } from '../../services/ai-chat-session.service';
import { AiPromptFavoritesService } from '../../services/ai-prompt-favorites.service';
import { ChatMessageComponent } from '../chat-message/chat-message.component';
import { ChatInputComponent } from '../chat-input/chat-input.component';
import { ConversationListComponent } from '../conversation-list/conversation-list.component';
import { AssistantAgentScope, ChatMessage, MessageRole } from '../../models/ai-chat.models';
import { getAgentScopeConfig } from '../../config/agent-scopes.config';
import { MessageSelectionService, SelectedAssistantMessage } from '../../services/message-selection.service';
import { PowerPointExportDialogComponent } from '../powerpoint-export-dialog/powerpoint-export-dialog.component';
import { SuggestionCatalogComponent } from '../suggestion-catalog/suggestion-catalog.component';
import { buildAssistantMarkdownForDisplay } from '../../utils/assistant-message-display';
import { AI_ASSISTANT_ICON_CLASS } from '@core/constants/ai-assistant-brand';

@Component({
  selector: 'app-chat-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    DecimalPipe,
    ChatMessageComponent,
    ChatInputComponent,
    ConversationListComponent,
    PowerPointExportDialogComponent,
    SuggestionCatalogComponent
  ],
  template: `
    <div
      class="chat-panel"
      [class.open]="isOpen || embedded"
      [class.embedded]="embedded"
      [class.embedded-workspace]="embedded && workspaceTab"
      [class.embedded-page]="embedded && pageFill">
      <div class="panel-backdrop" (click)="onBackdropClose()"></div>
      <div class="panel-container">
        <!-- Header -->
        <div class="panel-header">
          <div class="header-left">
            <button class="icon-btn" (click)="session.toggleSidebar()" title="Conversations" i18n-title="@@ai-assistant.components.conversations.07c59b44">
              <i class="fa-solid fa-clock-rotate-left"></i>
            </button>
            <div class="ai-avatar" aria-hidden="true">
              <i [class]="aiAssistantIconClass"></i>
            </div>
            <div class="header-titles">
              <h3>{{ headerTitle() }}</h3>
              <!-- Statut prêt/hors ligne uniquement — le nom technique (displayLabel/modelRef) n'est pas exposé à l'utilisateur.
                   activeModel reste chargé côté session pour vision et warm-up Ollama. -->
              <div class="ai-status" [class.offline]="session.aiAvailable() === false">
                <span class="ai-status-dot"></span>
                <span class="ai-status-text">{{ session.aiAvailable() === false ? loc_ui_tern_hors_ligne_2b3e7d : loc_ui_tern_modele_pret_0df9a1 }}</span>
                @if (scopeConfig(); as sc) {
                  <span class="scope-badge" [attr.title]="loc_ui_tern_assistant_expert_du_module_catalogue_et_pe_a73956 + sc.expertName">
                    <i [class]="sc.icon" aria-hidden="true"></i>
                    {{ sc.expertName }}
                  </span>
                }
              </div>
            </div>
          </div>
          <div class="header-actions">
            @if (scopeConfig()) {
              <button
                type="button"
                class="mode-chip"
                (click)="switchToGlobalAssistant()"
                title="Revenir à l'assistant global (tous les domaines)" i18n-title="@@ai-assistant.components.revenir.a.l.assistant.global.tous.les.domaines.28083c00" i18n="@@ai-assistant.components.assistant.global.0dc5a3f0"> Assistant global </button>
            } @else {
              <button
                type="button"
                class="mode-chip"
                [class.active]="session.assistantComplianceMode()"
                (click)="session.setAssistantComplianceMode(!session.assistantComplianceMode())"
                title="Mode conformité : sous-ensemble d’outils et consignes renforcées" i18n-title="@@ai-assistant.components.mode.conformite.sous.ensemble.d.outils.et.consig.c82156d3" i18n="@@ai-assistant.components.conformite.905cab8c"> Conformité </button>
            }
            @if (session.lastStreamTraceId(); as tid) {
              <button
                type="button"
                class="trace-chip"
                (click)="copyTraceId(tid)"
                [title]="screenAnalysisTraceTitle()" i18n="@@ai-assistant.components.trace.2f38169a"> Trace </button>
            }
            <button
              type="button"
              class="mode-chip"
              [class.active]="selection.isSelectionMode()"
              (click)="toggleSelectionMode()"
              [attr.aria-pressed]="selection.isSelectionMode()"
              title="Sélection multi-réponses (export PowerPoint)" i18n-title="@@ai-assistant.components.selection.multi.reponses.export.powerpoint.8e60cffd" i18n="@@ai-assistant.components.selection.ac0002b0"> Sélection </button>
            @if (!pageFill) {
              <button class="icon-btn" (click)="onCloseClick()" title="Fermer" i18n-title="@@ai-assistant.components.fermer.5ab4ec64">
                <i class="fa-solid fa-xmark"></i>
              </button>
            }
          </div>
        </div>

        @if (selection.isSelectionMode()) {
          <div
            class="selection-bar"
            role="toolbar"
            aria-label="Barre d'actions pour la sélection multi-réponses" i18n-aria-label="@@ai-assistant.components.barre.d.actions.pour.la.selection.multi.reponses.3ffb0105">
            <span class="selection-count"><ng-container i18n="@@ai-assistant.components.reponse.s.selectionnee.s.272c8013">
              {{ selection.count() }} réponse(s) sélectionnée(s)
              </ng-container>@if (selection.atLimit()) {
                <em class="selection-limit" i18n="@@ai-assistant.components.limite.atteinte.206cd640">— limite atteinte</em>
              }
            </span>
            <div class="selection-actions">
              <button
                type="button"
                class="selection-btn"
                (click)="selection.clear()"
                [disabled]="!selection.hasSelection()"
                aria-label="Vider la sélection" i18n-aria-label="@@ai-assistant.components.vider.la.selection.834a3e51" i18n="@@ai-assistant.components.effacer.fe23de7b"> Effacer </button>
              <button
                type="button"
                class="selection-btn primary"
                (click)="openExportDialog()"
                [disabled]="!selection.hasSelection()"
                aria-label="Exporter en PowerPoint" i18n-aria-label="@@ai-assistant.components.exporter.en.powerpoint.1032c468" i18n="@@ai-assistant.components.exporter.powerpoint.c0a138d4">
                <i class="fa-solid fa-file-powerpoint" aria-hidden="true"></i>
                Exporter PowerPoint
              </button>
            </div>
          </div>
        }

        <div class="panel-body">
          <!-- Conversation sidebar -->
          @if (session.showSidebar()) {
            <div class="sidebar-pane">
              <app-conversation-list
                [conversations]="session.conversations()"
                [activeConversationId]="session.activeConversationId()"
                (conversationSelected)="session.loadConversation($event)"
                (conversationDeleted)="session.deleteConversation($event)"
                (newConversation)="session.startNewConversation()"
              />
            </div>
          }

          <!-- Chat area -->
          <div class="chat-area">
            <div class="messages-container" #messagesContainer>
              @if (!session.messages().length) {
                <div class="welcome-state" [class.welcome-state--catalog]="scopedSuggestionCategories().length">
                  <div class="welcome-icon" aria-hidden="true">
                    <i [class]="aiAssistantIconClass"></i>
                  </div>
                  <h4>{{ welcomeTitle() }}</h4>
                  <p>{{ welcomeDescription() }}</p>
                  @if (!scopeConfig() && session.dailyBriefing(); as b) {
                    <div class="briefing-card" role="region" aria-label="Aperçu du jour" i18n-aria-label="@@ai-assistant.components.apercu.du.jour.be116976">
                      <div class="briefing-title" i18n="@@ai-assistant.components.apercu.du.jour.be116976">Aperçu du jour</div>
                      <ul class="briefing-list">
                        <li>
                          <ng-container i18n="@@ai-assistant.components.relances.a.venir.7.j.b31a456b"> Relances à venir (7 j.) : </ng-container>
                          <strong>{{ b.upcomingRemindersCount }}</strong>
                        </li>
                        <li i18n="@@ai-assistant.components.soldes.clients.comptes.7f786698">
                          <ng-container> Soldes clients : </ng-container>
                          <strong>{{ b.totalClientBalances | number: '1.3-3' }} {{ b.currency }}</strong>
                          ({{ b.clientsWithBalanceCount }} comptes)
                        </li>
                        <li>
                          <ng-container i18n="@@ai-assistant.components.creances.90.j.280f2d0f"> Créances +90 j. : </ng-container>
                          <strong>{{ b.agingOver90 | number: '1.3-3' }}</strong>
                        </li>
                      </ul>
                    </div>
                  }
                  @if (scopedSuggestionCategories().length) {
                    <app-suggestion-catalog
                      [categories]="scopedSuggestionCategories()"
                      (questionSelected)="session.sendMessage($event)" />
                  } @else {
                    <div class="suggestions">
                      @for (s of scopedSuggestions(); track s) {
                        <button class="suggestion-chip" lang="fr" dir="auto" (click)="session.sendMessage(s)">
                          {{ s }}
                        </button>
                      }
                    </div>
                  }
                  <div class="favorite-add" role="group" aria-label="Enregistrer une question favorite" i18n-aria-label="@@ai-assistant.components.enregistrer.une.question.favorite.c2d5ac73">
                    <input
                      #favInput
                      type="text"
                      class="favorite-input"
                      placeholder="Enregistrer une question favorite…" i18n-placeholder="@@ai-assistant.components.enregistrer.une.question.favorite.bd0517d1"
                      maxlength="500"
                      (keydown.enter)="addFavorite(favInput); $event.preventDefault()" />
                    <button type="button" class="favorite-save-btn" (click)="addFavorite(favInput)" i18n="@@ai-assistant.components.enregistrer.f7c8bcd8"> Enregistrer </button>
                  </div>
                  @if (promptFavorites.favorites().length) {
                    <div class="favorites-block" role="region" aria-label="Questions enregistrées" i18n-aria-label="@@ai-assistant.components.questions.enregistrees.b4f9d0eb">
                      <div class="favorites-title" i18n="@@ai-assistant.components.questions.enregistrees.b4f9d0eb">Questions enregistrées</div>
                      @for (f of promptFavorites.favorites(); track f.id) {
                        <div class="favorite-row">
                          <button type="button" class="favorite-chip" (click)="session.sendMessage(f.text)">
                            {{ f.text }}
                          </button>
                          <button
                            type="button"
                            class="favorite-remove"
                            (click)="promptFavorites.remove(f.id)"
                            [attr.aria-label]="loc_ui_tern_retirer_b55802 + f.text.slice(0, 40) + ' »'" i18n="@@ai-assistant.components.text.67fba2f3"> × </button>
                        </div>
                      }
                    </div>
                  }
                </div>
              }

              @for (msg of visibleMessages(); track msg.id) {
                <app-chat-message
                  [message]="msg"
                  [connectingToModel]="
                    session.awaitingFirstToken() &&
                    msg.role === MessageRole.Assistant &&
                    msg.isStreaming === true
                  "
                  [warnWhenUngrounded]="isFirmScope()"
                  [hideChartFollowUp]="isFirmScope()"
                  (exportSingleAsPowerPoint)="onExportSingleAsPowerPoint($event)"
                />
              }
            </div>

            <app-chat-input
              #chatInputRef
              [disabled]="session.isStreaming()"
              [isStreaming]="session.isStreaming()"
              [modelSupportsVision]="session.selectedModelSupportsVision()"
              (messageSent)="session.sendMessageWithAttachments($event)"
              (stopRequested)="session.stopGeneration()"
            />
          </div>
        </div>
      </div>

      <app-powerpoint-export-dialog
        [visible]="showExportDialog"
        [initialSelection]="dialogSelection()"
        (visibleChange)="onExportDialogVisibility($event)"
      />
    </div>
  `,
  styles: [`
    :host.chat-panel-host--fill {
      display: flex;
      flex-direction: column;
      flex: 1 1 auto;
      align-self: stretch;
      min-height: 0;
      height: 100%;
      overflow: hidden;
    }

    .chat-panel {
      position: fixed;
      top: 0;
      inset-inline-end: 0;
      bottom: 0;
      inset-inline-start: 0;
      z-index: 1000;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.2s;
    }

    .chat-panel.open {
      pointer-events: auto;
      opacity: 1;
    }

    .chat-panel.embedded {
      position: relative;
      display: flex;
      flex-direction: column;
      height: calc(100vh - 220px);
      min-height: 320px;
      z-index: 1;
      opacity: 1;
      pointer-events: auto;
    }

    .chat-panel.embedded.embedded-workspace {
      height: 100%;
      min-height: 0;
      flex: 1;
    }

    .chat-panel.embedded.embedded-page {
      height: 100%;
      min-height: 0;
      flex: 1;
    }

    .chat-panel.embedded .panel-container {
      flex: 1;
      min-height: 0;
      height: 100%;
    }

    .chat-panel.embedded.open {
      opacity: 1;
    }

    .panel-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.2);
    }

    .chat-panel.embedded .panel-backdrop {
      display: none;
    }

    .panel-container {
      position: absolute;
      inset-inline-end: 0;
      top: 0;
      bottom: 0;
      width: min(520px, 100vw);
      background: #fff;
      box-shadow: -4px 0 24px rgba(0, 0, 0, 0.12);
      display: flex;
      flex-direction: column;
      transform: translateX(100%);
      transition: transform 0.25s ease-out;
    }

    .chat-panel.open .panel-container {
      transform: translateX(0);
    }

    .chat-panel.embedded .panel-container {
      position: relative;
      width: 100%;
      transform: none;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08);
      border-radius: 12px;
      border: 1px solid var(--color-neutral-200, #e5e7eb);
      overflow: hidden;
    }

    .chat-panel.embedded.embedded-page .panel-container {
      width: 100%;
      height: 100%;
      border: 0;
      border-radius: 0;
      box-shadow: none;
    }

    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      flex-shrink: 0;
      min-width: 0;
      padding: 12px 16px;
      border-bottom: 1px solid var(--color-neutral-200, #e5e7eb);
      background: #fff;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 10px;
      flex: 1;
      min-width: 0;
    }

    .header-left h3 {
      margin: 0;
      font-size: 16px;
      font-weight: 600;
      color: var(--color-neutral-800, #1f2937);
    }

    .header-titles {
      display: flex;
      flex-direction: column;
      gap: 1px;
      min-width: 0;
    }

    .ai-avatar {
      width: 40px;
      height: 40px;
      border-radius: 14px;
      background: var(--ai-gradient, linear-gradient(135deg, #8b5cf6 0%, #d946ef 100%));
      box-shadow: var(--ai-glow, 0 8px 20px rgba(139, 92, 246, 0.35));
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      color: #fff;
      font-size: 18px;
    }

    .ai-status {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--color-neutral-500, #6b7280);
    }

    .ai-status-dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: #22c55e;
      box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.5);
      animation: aiPulse 2s cubic-bezier(0.215, 0.61, 0.355, 1) infinite;
      flex-shrink: 0;
    }

    .ai-status.offline {
      color: var(--color-error-600, #dc2626);
    }

    .ai-status.offline .ai-status-dot {
      background: var(--color-error-500, #ef4444);
      animation: none;
      box-shadow: none;
    }

    .scope-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-inline-start: 6px;
      padding: 1px 8px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      color: #7c3aed;
      background: rgba(124, 58, 237, 0.1);
      border: 1px solid rgba(124, 58, 237, 0.25);
      white-space: nowrap;
    }

    .scope-badge i {
      font-size: 10px;
    }

    @keyframes aiPulse {
      0%   { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.5); }
      70%  { box-shadow: 0 0 0 6px rgba(34, 197, 94, 0); }
      100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }
    }

    .header-actions {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      flex-shrink: 0;
      gap: 8px;
    }

    .header-actions > .icon-btn:last-child {
      flex-shrink: 0;
    }

    .icon-btn {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      border: 1px solid var(--color-neutral-200, #e5e7eb);
      background: #fff;
      color: var(--color-neutral-600, #4b5563);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s;
    }

    .icon-btn:hover {
      background: var(--color-neutral-50, #f9fafb);
      border-color: var(--color-neutral-300, #d1d5db);
    }

    .panel-body {
      flex: 1;
      display: flex;
      min-height: 0;
      overflow: hidden;
    }

    .sidebar-pane {
      width: 240px;
      border-inline-end: 1px solid var(--color-neutral-200, #e5e7eb);
      flex-shrink: 0;
      overflow-y: auto;
    }

    .chat-area {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
    }

    .chat-area > app-chat-input {
      flex-shrink: 0;
    }

    .messages-container {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 8px 0;
    }

    .welcome-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      padding: 32px 24px;
      text-align: center;
      color: var(--color-neutral-500, #6b7280);
    }

    .welcome-state--catalog {
      height: auto;
      min-height: 100%;
      justify-content: flex-start;
    }

    .welcome-icon {
      width: 72px;
      height: 72px;
      border-radius: 20px;
      background: var(--ai-gradient, linear-gradient(135deg, #8b5cf6 0%, #d946ef 100%));
      box-shadow: var(--ai-glow, 0 8px 20px rgba(139, 92, 246, 0.35));
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 16px;
      color: #fff;
      font-size: 28px;
    }

    .welcome-state h4 {
      margin: 0 0 8px;
      font-size: 16px;
      font-weight: 600;
      color: var(--color-neutral-800, #1f2937);
    }

    .chat-panel.embedded.embedded-page .welcome-state--catalog {
      align-items: center;
      padding: 40px 32px 24px;
    }

    .chat-panel.embedded.embedded-page .welcome-state h4 {
      font-size: 22px;
    }

    .chat-panel.embedded.embedded-page .welcome-state p {
      max-width: 1120px;
    }

    .chat-panel.embedded.embedded-page .welcome-state--catalog app-suggestion-catalog,
    .chat-panel.embedded.embedded-page .favorite-add,
    .chat-panel.embedded.embedded-page .favorites-block {
      width: 100%;
      max-width: 1120px;
    }

    .welcome-state p {
      margin: 0 0 16px;
      font-size: 13px;
      line-height: 1.5;
    }

    .suggestions {
      display: flex;
      flex-direction: column;
      gap: 8px;
      width: 100%;
    }

    .suggestion-chip {
      padding: 10px 14px;
      border: 1px solid var(--color-neutral-200, #e5e7eb);
      border-radius: 10px;
      background: #fff;
      text-align: start;
      font-size: 13px;
      color: var(--color-neutral-700, #374151);
      cursor: pointer;
      transition: all 0.15s;
    }

    .suggestion-chip:hover {
      border-color: var(--ai-accent-300, #c4b5fd);
      background: var(--ai-accent-50, #f5f3ff);
      color: var(--ai-accent-600, #7c3aed);
    }

    .favorite-add {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      width: 100%;
      max-width: 400px;
      margin-top: 12px;
    }

    .favorite-input {
      flex: 1;
      min-width: 160px;
      padding: 8px 10px;
      border-radius: 8px;
      border: 1px solid var(--color-neutral-200, #e5e7eb);
      font-size: 13px;
    }

    .favorite-save-btn {
      padding: 8px 12px;
      font-size: 12px;
      font-weight: 600;
      border-radius: 8px;
      border: 1px solid var(--color-primary-200, #bfdbfe);
      background: var(--color-primary-50, #eff6ff);
      color: var(--color-primary-800, #1e40af);
      cursor: pointer;
    }

    .favorites-block {
      width: 100%;
      max-width: 400px;
      margin-top: 14px;
      text-align: start;
    }

    .favorites-title {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--color-neutral-500, #6b7280);
      margin-bottom: 8px;
    }

    .favorite-row {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      margin-bottom: 6px;
    }

    .favorite-chip {
      flex: 1;
      text-align: start;
      padding: 6px 10px;
      border-radius: 8px;
      border: 1px solid var(--color-neutral-200, #e5e7eb);
      background: #fff;
      font-size: 12px;
      color: var(--color-neutral-700, #374151);
      cursor: pointer;
    }

    .favorite-chip:hover {
      border-color: var(--color-primary-300, #93c5fd);
      background: var(--color-primary-50, #eff6ff);
    }

    .favorite-remove {
      flex-shrink: 0;
      width: 28px;
      height: 28px;
      border: none;
      border-radius: 6px;
      background: var(--color-neutral-100, #f3f4f6);
      color: var(--color-neutral-500, #6b7280);
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
    }

    .briefing-card {
      width: 100%;
      max-width: 400px;
      margin-bottom: 16px;
      padding: 12px 14px;
      border-radius: 12px;
      border: 1px solid var(--color-neutral-200, #e5e7eb);
      background: var(--color-neutral-50, #f9fafb);
      text-align: start;
    }

    .briefing-title {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--color-neutral-500, #6b7280);
      margin-bottom: 8px;
    }

    .briefing-list {
      margin: 0;
      padding-inline-start: 1.1rem;
      font-size: 13px;
      color: var(--color-neutral-700, #374151);
      line-height: 1.5;
    }

    .mode-chip,
    .trace-chip {
      padding: 4px 10px;
      font-size: 11px;
      font-weight: 600;
      border-radius: 999px;
      border: 1px solid var(--color-neutral-200, #e5e7eb);
      background: #fff;
      color: var(--color-neutral-600, #4b5563);
      cursor: pointer;
    }

    .mode-chip.active {
      border-color: var(--ai-accent-300, #c4b5fd);
      background: var(--ai-accent-50, #f5f3ff);
      color: var(--ai-accent-600, #7c3aed);
    }

    .trace-chip:hover {
      border-color: var(--color-neutral-300, #d1d5db);
    }

    @media (max-width: 640px) {
      .panel-container { width: 100vw; }
      .sidebar-pane { width: 200px; }
    }

    .selection-bar {
      position: sticky;
      top: 0;
      z-index: 5;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
      gap: 12px;
      padding: 8px 16px;
      border-bottom: 1px solid var(--color-primary-200, #bfdbfe);
      background: var(--color-primary-50, #eff6ff);
      color: var(--color-primary-800, #1e40af);
      font-size: 13px;
    }

    .selection-count {
      font-weight: 600;
    }

    .selection-limit {
      font-style: italic;
      font-weight: 500;
      margin-inline-start: 4px;
      color: var(--color-warning-700, #92400e);
    }

    .selection-actions {
      display: flex;
      gap: 8px;
    }

    .selection-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      font-size: 12px;
      font-weight: 600;
      border-radius: 8px;
      border: 1px solid var(--color-primary-300, #93c5fd);
      background: #fff;
      color: var(--color-primary-700, #1d4ed8);
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s;
    }

    .selection-btn:hover:not(:disabled) {
      background: var(--color-primary-100, #dbeafe);
    }

    .selection-btn:focus-visible {
      outline: 2px solid var(--color-primary-500, #3b82f6);
      outline-offset: 2px;
    }

    .selection-btn.primary {
      background: var(--color-primary-600, #2563eb);
      color: #fff;
      border-color: var(--color-primary-600, #2563eb);
    }

    .selection-btn.primary:hover:not(:disabled) {
      background: var(--color-primary-700, #1d4ed8);
      border-color: var(--color-primary-700, #1d4ed8);
    }

    .selection-btn:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }
  `]
})
export class ChatPanelComponent implements AfterViewInit, OnInit, OnChanges, OnDestroy {
  readonly loc_ui_tern_hors_ligne_2b3e7d = $localize`:@@ui.tern.hors.ligne.2b3e7d:Hors ligne`;
  readonly loc_ui_tern_modele_pret_0df9a1 = $localize`:@@ui.tern.modele.pret.0df9a1:Modèle prêt`;
  readonly loc_ui_tern_assistant_expert_du_module_catalogue_et_pe_a73956 = $localize`:@@ui.tern.assistant.expert.du.module.catalogue.et.pe.a73956:Assistant expert du module — catalogue et persona `;
  readonly loc_ui_tern_retirer_b55802 = $localize`:@@ui.tern.retirer.b55802:Retirer « `;
  @HostBinding('class.chat-panel-host--fill')
  get hostFillClass(): boolean {
    return this.embedded;
  }

  @Input() isOpen = false;
  /** When true, panel is inline in the main layout (route /ai-assistant) instead of a slide-over overlay. */
  @Input() embedded = false;
  /** When true with embedded, panel fills the workspace tab pane (not a dedicated /ai-assistant route). */
  @Input() workspaceTab = false;
  /** When true with embedded, panel is the page surface (firm chef de mission), not a floating card. */
  @Input() pageFill = false;
  /**
   * Expert de module de cette surface (None = assistant global, comportement historique).
   * Appliqué à la session à l'init, à chaque changement d'input et à chaque (ré)ouverture.
   */
  @Input() agentScope: AssistantAgentScope = AssistantAgentScope.None;
  @Output() close = new EventEmitter<void>();

  @ViewChild('messagesContainer') messagesContainer?: ElementRef<HTMLDivElement>;
  @ViewChild('chatInputRef') chatInputRef?: ChatInputComponent;

  readonly session = inject(AiChatSessionService);
  readonly promptFavorites = inject(AiPromptFavoritesService);
  readonly selection = inject(MessageSelectionService);
  private readonly router = inject(Router);
  readonly MessageRole = MessageRole;
  readonly aiAssistantIconClass = AI_ASSISTANT_ICON_CLASS;

  /** Config UI de l'expert actif (undefined = assistant global). Dérivée de la session, pas de l'input. */
  readonly scopeConfig = computed(() => getAgentScopeConfig(this.session.agentScope()));

  /** Vrai quand la session pilote l'agent cabinet Chef de mission (badge « non ancré » + pas de Graphique). */
  readonly isFirmScope = computed(
    () => this.session.agentScope() === AssistantAgentScope.FirmMission
  );

  readonly headerTitle = computed(() => this.scopeConfig()?.title ?? $localize`:@@ui.tern.assistant.ia.instafact.f7d399:Assistant IA InstaFact`);

  readonly welcomeTitle = computed(() => {
    const sc = this.scopeConfig();
    return sc ? $localize`:@@ui.tern.bienvenue.dans.l.ph.0ff1ca:Bienvenue dans l'${sc.title}:p0:` : $localize`:@@ui.tern.bienvenue.dans.l.assistant.ia.618a15:Bienvenue dans l'Assistant IA`;
  });

  readonly welcomeDescription = computed(() => {
    const sc = this.scopeConfig();
    if (!sc) {
      return $localize`:@@ai-assistant.chat-panel.ts.posez.des.questions.sur.vos.donnees.comm.0a9a5c21:Posez des questions sur vos données commerciales, financières ou de stock. Quelques exemples :`;
    }
    const themed = (sc.suggestionCategories?.length ?? 0) > 0;
    return themed
      ? $localize`:@@ui.tern.votre.ph.repond.aux.questions.de.son.domai.b85c50:Votre ${sc.expertName}:p0: répond aux questions de son domaine. Quelques exemples, classés par thème :`
      : $localize`:@@ui.tern.votre.ph.repond.aux.questions.de.son.domai.d94ff9:Votre ${sc.expertName}:p0: répond aux questions de son domaine. Quelques exemples :`;
  });

  readonly scopedSuggestions = computed(() => this.scopeConfig()?.suggestions ?? this.suggestions);

  readonly scopedSuggestionCategories = computed(
    () => this.scopeConfig()?.suggestionCategories ?? []
  );

  showExportDialog = false;

  /** When set, overrides the global multi-select store for a single-message export flow. */
  private readonly singleMessageOverride = signal<SelectedAssistantMessage[] | null>(null);

  readonly dialogSelection = computed<SelectedAssistantMessage[]>(() => {
    const override = this.singleMessageOverride();
    return override ?? this.selection.selections();
  });

  /** Hides tool payloads and empty assistant placeholders from the transcript. */
  readonly visibleMessages = computed(() =>
    this.session.messages().filter(m => this.isMessageVisibleInTranscript(m))
  );

  private messagesResizeObserver?: ResizeObserver;
  private scrollRafPending = false;

  addFavorite(el: HTMLInputElement): void {
    this.promptFavorites.add(el.value);
    el.value = '';
  }

  readonly suggestions = [
    'Quel est mon chiffre d\'affaires ce mois-ci ?',
    'Quels sont mes 5 meilleurs clients ?',
    'Affiche-moi l\'état du stock actuel',
    'Génère un tableau de bord des ventes du dernier trimestre'
  ];

  constructor() {
    effect(() => {
      this.visibleMessages();
      this.scheduleScrollToBottom();
    });
  }

  ngOnInit(): void {
    this.session.requestWarmUpActiveModel();
    this.applyAgentScopeInput();
  }

  ngAfterViewInit(): void {
    const el = this.messagesContainer?.nativeElement;
    if (!el || typeof ResizeObserver === 'undefined') {
      return;
    }
    this.messagesResizeObserver = new ResizeObserver(() => this.scheduleScrollToBottom());
    this.messagesResizeObserver.observe(el);
  }

  ngOnDestroy(): void {
    this.messagesResizeObserver?.disconnect();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen']?.currentValue === true) {
      this.session.requestWarmUpActiveModel();
      // Ré-applique le scope de la surface à chaque ouverture (l'utilisateur a pu repasser en global).
      this.applyAgentScopeInput();
    }
    if (changes['agentScope'] && !changes['agentScope'].firstChange) {
      this.applyAgentScopeInput();
    }
  }

  /** Propage le scope de la surface vers la session + l'espace de favoris correspondant. */
  private applyAgentScopeInput(): void {
    this.session.setAgentScope(this.agentScope);
    this.promptFavorites.setScope(getAgentScopeConfig(this.agentScope)?.slug ?? null);
  }

  /**
   * Revient à l'assistant global : sur une page dédiée (/ai-assistant/<slug>), navigue vers
   * /ai-assistant ; en panneau flottant, bascule la session en place (le scope du module est
   * ré-appliqué à la prochaine ouverture de la bulle).
   */
  switchToGlobalAssistant(): void {
    if (this.embedded && !this.workspaceTab) {
      void this.router.navigate(['/ai-assistant']);
      return;
    }
    this.session.setAgentScope(AssistantAgentScope.None);
    this.promptFavorites.setScope(null);
  }

  private isMessageVisibleInTranscript(m: ChatMessage): boolean {
    if (m.role === MessageRole.Tool) {
      return false;
    }
    if (m.role === MessageRole.Assistant && this.isHiddenEmptyAssistantPlaceholder(m)) {
      return false;
    }
    return true;
  }

  private isHiddenEmptyAssistantPlaceholder(m: ChatMessage): boolean {
    if (m.content?.trim()) {
      return false;
    }
    if (m.isStreaming) {
      return false;
    }
    if (m.generationInterrupted) {
      return false;
    }
    if (m.parsedDashboard) {
      return false;
    }
    if (m.toolCalls?.length) {
      return false;
    }
    if (m.clientActions?.length || m.sources?.length || m.firmReminderAction) {
      return false;
    }
    if (m.progress?.steps?.length) {
      return false;
    }
    return true;
  }

  async copyTraceId(id: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(id);
    } catch {
      /* ignore */
    }
  }

  screenAnalysisTraceTitle(): string {
    const trace = this.session.lastScreenAnalysisTrace();
    const base = $localize`:@@ai-assistant.chat-panel.ts.copier.l.identifiant.de.correlation.supp.8c60e2eb:Copier l’identifiant de corrélation (support / logs)`;
    if (!trace) {
      return base;
    }
    return $localize`:@@ai-assistant.chat-panel.ts.base.ecran.screenid.schema.schemaversion.464e5861:${base}:base: — écran: ${trace.screenId}:screenId:, schema: ${trace.schemaVersion}:schemaVersion:, payload: ${trace.payloadBytes}:payloadBytes: o${trace.truncated ? $localize`:@@ui.tern.tronque.d0a5cd: (tronqué)` : ''}:p:`;
  }

  /** Stream SSE continues in AiChatSessionService when this panel is destroyed (route change). */

  onBackdropClose(): void {
    if (!this.embedded) {
      this.close.emit();
    }
  }

  onCloseClick(): void {
    this.close.emit();
  }

  private scheduleScrollToBottom(): void {
    if (this.scrollRafPending) {
      return;
    }
    this.scrollRafPending = true;
    requestAnimationFrame(() => {
      this.scrollRafPending = false;
      this.scrollToBottom();
    });
  }

  private scrollToBottom(): void {
    const el = this.messagesContainer?.nativeElement;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }

  toggleSelectionMode(): void {
    this.selection.toggleSelectionMode();
  }

  openExportDialog(): void {
    if (!this.selection.hasSelection()) return;
    void this.openExportDialogAsync();
  }

  private async openExportDialogAsync(): Promise<void> {
    await this.session.reconcileActiveConversation();
    if (!this.selection.hasSelection()) return;
    this.singleMessageOverride.set(null);
    this.showExportDialog = true;
  }

  onExportSingleAsPowerPoint(message: ChatMessage): void {
    void this.exportSingleAsPowerPointAsync(message);
  }

  private async exportSingleAsPowerPointAsync(message: ChatMessage): Promise<void> {
    const indexBefore = this.session.messages().findIndex(m => m.id === message.id);
    await this.session.reconcileActiveConversation();
    const target =
      indexBefore >= 0 ? this.session.messages()[indexBefore] : this.findAssistantMessage(message);
    if (!target || target.role !== MessageRole.Assistant) {
      return;
    }
    const entry = this.syncSelectionMetadata(target);
    if (!this.canExportSelection(entry)) {
      return;
    }
    this.singleMessageOverride.set([entry]);
    this.showExportDialog = true;
  }

  private findAssistantMessage(message: ChatMessage): ChatMessage | undefined {
    const prefix = message.content.replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!prefix) {
      return undefined;
    }
    return this.session.messages().find(
      m =>
        m.role === MessageRole.Assistant &&
        m.content.replace(/\s+/g, ' ').trim().slice(0, 120) === prefix
    );
  }

  private canExportSelection(entry: SelectedAssistantMessage): boolean {
    return this.isValidGuid(entry.conversationId) && this.isValidGuid(entry.messageId);
  }

  private isValidGuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value
    );
  }

  onExportDialogVisibility(visible: boolean): void {
    this.showExportDialog = visible;
    if (!visible) {
      this.singleMessageOverride.set(null);
    }
  }

  /**
   * Captures the currently visible assistant messages into the selection store. Used by the
   * `<app-chat-message>` to enable cross-conversation selection by ensuring the message metadata
   * (conversation title, preview) is always present in the store entry.
   */
  syncSelectionMetadata(message: ChatMessage): SelectedAssistantMessage {
    const conversationId = this.session.activeConversationId() ?? '';
    const conversationTitle = this.session.conversations()
      .find(c => c.id === conversationId)?.title
      ?? $localize`:@@ui.tern.conversation.2a20c7:Conversation`;

    const previewSource = buildAssistantMarkdownForDisplay(message.content) || message.content;
    const preview = previewSource.replace(/\s+/g, ' ').trim().slice(0, 140);

    return {
      conversationId,
      messageId: message.id,
      conversationTitle,
      preview,
      createdAt: message.createdAt instanceof Date
        ? message.createdAt.toISOString()
        : new Date().toISOString()
    };
  }
}
