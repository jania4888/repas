import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  PLATFORM_ID,
  SimpleChanges,
  ViewChild,
  inject
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { MarkdownModule } from 'ngx-markdown';
import { ChatMessage, ClientNavAction, ConfirmFirmReminderAction, MessageRole } from '../../models/ai-chat.models';
import { TypingIndicatorComponent } from '../typing-indicator/typing-indicator.component';
import { AiDashboardRendererComponent } from '../ai-dashboard-renderer/ai-dashboard-renderer.component';
import { AssistantProgressTimelineComponent } from '../assistant-progress-timeline/assistant-progress-timeline.component';
import { ChatAttachmentCardComponent } from '../chat-attachment-card/chat-attachment-card.component';
import { AiChatSessionService } from '../../services/ai-chat-session.service';
import { MessageSelectionService } from '../../services/message-selection.service';
import {
  buildAssistantMarkdownForDisplay,
  closePartialFences,
  resolveAssistantDisplayState
} from '../../utils/assistant-message-display';
import { environment } from '@environments/environment';
import { getAiToolDisplayLabel, dedupeToolSources, DedupedToolSource } from '../../utils/assistant-progress-display';
import { writeTextToClipboard } from '../../utils/clipboard.util';
import { downloadCsv } from '../../utils/dashboard-table-csv';
import { htmlTablesToCsv } from '../../utils/markdown-html-tables-csv';
import { exportDashboardToXlsx, exportElementToPdf } from '../../utils/ai-assistant-export';

/**
 * Préfixe du repli honnête émis par la gate d'ancrage FirmMission (Lot 1.3,
 * `FirmUngroundedFallbackMessage` côté backend). Détecté sur le contenu final de la réponse pour
 * rendre la carte info « Je n'ai pas pu consulter les données… » (maquette
 * `grounding-repli-honnete-carte-info.html`) plutôt que le badge ambre générique.
 */
const FIRM_UNGROUNDED_FALLBACK_PREFIX = "Je n'ai pas pu consulter les données du cabinet";

@Component({
  selector: 'app-chat-message',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MarkdownModule,
    TypingIndicatorComponent,
    AiDashboardRendererComponent,
    AssistantProgressTimelineComponent,
    ChatAttachmentCardComponent
  ],
  template: `
    <div
      class="chat-message"
      [class.user]="message.role === MessageRole.User"
      [class.assistant]="message.role === MessageRole.Assistant"
      [class.tool]="message.role === MessageRole.Tool"
      [class.selectable]="canBeSelected()"
      [class.selected]="isMessageSelected()">
      @if (selection.isSelectionMode() && canBeSelected()) {
        <label class="message-select" [attr.aria-label]="'Sélectionner cette réponse'">
          <input
            type="checkbox"
            [checked]="isMessageSelected()"
            (change)="onSelectionToggle($event)" />
        </label>
      }
      <div class="message-avatar" aria-hidden="true">
        <i [class]="message.role === MessageRole.User ? 'fa-solid fa-user' : 'fa-solid fa-robot'"></i>
      </div>

      <div class="message-body">
        @if (message.role === MessageRole.User) {
          @if (message.attachments && message.attachments.length > 0) {
            <div class="message-attachments" role="list">
              @for (att of message.attachments; track att.id) {
                <app-chat-attachment-card role="listitem" [attachment]="att" [editable]="false" />
              }
            </div>
          }
          @if (message.content) {
            <div class="message-content user-content">{{ message.content }}</div>
          }
        } @else if (message.role === MessageRole.Tool) {
          <div class="tool-badge">
            <i class="fa-solid fa-wrench" aria-hidden="true"></i>
            <span>{{ message.toolName || 'Outil' }}</span>
          </div>
        } @else {

          <app-assistant-progress-timeline
            [progress]="message.progress"
            [toolCalls]="message.toolCalls || []"
            [isStreaming]="message.isStreaming === true"
            [connectingToModel]="connectingToModel"
          />

          @if (message.generationInterrupted) {
            <div class="generation-interrupted" role="status" aria-live="polite">
              <i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>
              <span i18n="@@ai-assistant.components.g.233.n.233.ration.interrompue.vous.pouvez.renvo.772cbb4d">G&#233;n&#233;ration interrompue. Vous pouvez renvoyer votre message.</span>
            </div>
          }

          <div class="assistant-export-root" #exportRoot>
            @if (message.parsedDashboard && !message.hideInlineDashboard) {
              <app-ai-dashboard-renderer
                [config]="message.parsedDashboard"
                variant="inline"
                (closed)="onDashboardClosed()"
              />
            }

            @if (message.hideInlineDashboard && message.parsedDashboard) {
              <button
                type="button"
                class="show-dashboard-btn"
                (click)="session.showInlineDashboard(message.id)"
                aria-label="Afficher le tableau de bord structur&#233;" i18n-aria-label="@@ai-assistant.components.afficher.le.tableau.de.bord.structure.7fc5fedc" i18n="@@ai-assistant.components.afficher.le.tableau.de.bord.7d6f5cb3"> Afficher le tableau de bord </button>
            }

            @if (showAssistantActions()) {
              <div class="assistant-toolbar">
                @if (markdownForDisplay.trim()) {
                  <button
                    type="button"
                    class="toolbar-btn"
                    (click)="copyFullMessage()"
                    [disabled]="copyInProgress"
                    aria-label="Copier la r&#233;ponse (texte brut)" i18n-aria-label="@@ai-assistant.components.copier.la.reponse.texte.brut.31f51cb3" i18n="@@ai-assistant.components.copier.037cfe77">
                    <i class="fa-regular fa-copy" aria-hidden="true"></i>
                    Copier
                  </button>
                  <button
                    type="button"
                    class="toolbar-btn"
                    (click)="copyAsTsv()"
                    [disabled]="copyInProgress"
                    aria-label="Copier pour Excel (TSV)" i18n-aria-label="@@ai-assistant.components.copier.pour.excel.tsv.7a0e5e2c" i18n="@@ai-assistant.components.tsv.18e411dc"> TSV </button>
                }
                @if (canExportMarkdownTables()) {
                  <button
                    type="button"
                    class="toolbar-btn"
                    (click)="exportMarkdownTablesCsv()"
                    aria-label="Exporter les tableaux Markdown en CSV" i18n-aria-label="@@ai-assistant.components.exporter.les.tableaux.markdown.en.csv.c9044b87" i18n="@@ai-assistant.components.csv.tableaux.750c7fe5"> CSV (tableaux) </button>
                }
                @if (message.parsedDashboard) {
                  <button
                    type="button"
                    class="toolbar-btn"
                    (click)="exportDashboardExcel()"
                    [disabled]="exportBusy"
                    aria-label="Exporter le tableau de bord en Excel" i18n-aria-label="@@ai-assistant.components.exporter.le.tableau.de.bord.en.excel.e917f7ca" i18n="@@ai-assistant.components.excel.a08e1111"> Excel </button>
                }
                <button
                  type="button"
                  class="toolbar-btn"
                  (click)="exportAssistantPdf()"
                  [disabled]="exportBusy"
                  aria-label="Exporter en PDF" i18n-aria-label="@@ai-assistant.components.exporter.en.pdf.66cf144b" i18n="@@ai-assistant.components.pdf.d613d88c"> PDF </button>
                @if (canExportSingleToPowerPoint()) {
                  <button
                    type="button"
                    class="toolbar-btn"
                    (click)="exportSingleToPowerPoint()"
                    [disabled]="exportBusy"
                    aria-label="Exporter en PowerPoint (cette réponse uniquement)" i18n-aria-label="@@ai-assistant.components.exporter.en.powerpoint.cette.reponse.uniquement.2e373cca" i18n="@@ai-assistant.components.ppt.4176ead5">
                    <i class="fa-solid fa-file-powerpoint" aria-hidden="true"></i>
                    PPT
                  </button>
                }
                @if (markdownForDisplay.trim()) {
                  <button
                    type="button"
                    class="toolbar-btn"
                    (click)="shareByEmail()"
                    aria-label="Partager par e-mail" i18n-aria-label="@@ai-assistant.components.partager.par.e.mail.e637050d" i18n="@@ai-assistant.components.e.mail.0d01e2e8"> E-mail </button>
                }
                <button
                  type="button"
                  class="toolbar-btn"
                  (click)="copyConversationLink()"
                  aria-label="Copier le lien de la conversation" i18n-aria-label="@@ai-assistant.components.copier.le.lien.de.la.conversation.b0e0c733" i18n="@@ai-assistant.components.lien.e2639e1d"> Lien </button>
                @if (!hideChartFollowUp && (markdownForDisplay.trim() || message.parsedDashboard)) {
                  <button
                    type="button"
                    class="toolbar-btn"
                    (click)="suggestChartFollowUp()"
                    aria-label="Demander un graphique &#224; partir de cette r&#233;ponse" i18n-aria-label="@@ai-assistant.components.demander.un.graphique.a.partir.de.cette.reponse.078f2af2" i18n="@@ai-assistant.components.graphique.fad32c3f"> Graphique </button>
                }
              </div>
            }

            @if (isHonestFallback && warnWhenUngrounded) {
              <div class="assistant-bubble-wrap">
                <div class="fallback-card" role="status" aria-live="polite">
                  <div class="fallback-icon" aria-hidden="true">
                    <i class="fa-solid fa-circle-info"></i>
                  </div>
                  <div class="fallback-body">
                    <p class="fallback-title" i18n="@@ai-assistant.components.je.n.ai.pas.pu.consulter.les.donn.233.es.du.cabi.1bf083c4">Je n'ai pas pu consulter les donn&#233;es du cabinet</p>
                    <p class="fallback-text">{{ message.content }}</p>
                    <div class="fallback-actions">
                      <button
                        type="button"
                        class="retry-btn"
                        (click)="resendOriginalQuestion()"
                        aria-label="R&#233;essayer la consultation des donn&#233;es du cabinet" i18n-aria-label="@@ai-assistant.components.reessayer.la.consultation.des.donnees.du.cabinet.925f6861" i18n="@@ai-assistant.components.reessayer.la.consultation.ed96c318">
                        <i class="fa-solid fa-rotate-right" aria-hidden="true"></i>
                        R&#233;essayer la consultation
                      </button>
                    </div>
                    <p class="fallback-hint" i18n="@@ai-assistant.components.aucune.donn.233.e.du.cabinet.n.a.233.t.233.utili.83fd5e0b">Aucune donn&#233;e du cabinet n'a &#233;t&#233; utilis&#233;e dans ce message.</p>
                  </div>
                </div>
              </div>
            } @else if (message.isStreaming && message.content.trim()) {
              <div class="assistant-bubble-wrap">
                <div class="message-content assistant-markdown streaming">
                  <markdown [data]="streamingMarkdown"></markdown>
                </div>
              </div>
            } @else if (renderedMarkdown) {
              <div class="assistant-bubble-wrap">
                <div class="message-content assistant-markdown" #mdRoot>
                  <markdown [data]="renderedMarkdown" (load)="onMarkdownRendered()"></markdown>
                </div>
              </div>
            } @else if (displayFallbackText) {
              <div class="assistant-bubble-wrap">
                <div class="message-content assistant-streaming-text">{{ displayFallbackText }}</div>
              </div>
            }
          </div>

          @if (message.firmReminderAction) {
            <section
              class="confirm-card"
              [class.confirmed]="message.firmReminderConfirmed"
              aria-labelledby="reminder-confirm-title">
              @if (message.firmReminderConfirmed) {
                <div class="confirm-header">
                  <div class="confirm-header-icon" aria-hidden="true">
                    <i class="fa-solid fa-check"></i>
                  </div>
                  <div>
                    <div class="confirm-title" id="reminder-confirm-title" i18n="@@ai-assistant.components.relance.envoy.233.e.1b4202d6">Relance envoy&#233;e</div>
                    <div class="confirm-subtitle" i18n="@@ai-assistant.components.rappel.f9151427">Rappel &#8212; {{ message.firmReminderAction.preview.dossier }}</div>
                  </div>
                </div>
                <div class="confirmed-status" role="status" aria-live="polite" i18n="@@ai-assistant.components.e.mail.envoye.a.consigne.dans.l.historiq.d1c500d1">
                  <i class="fa-solid fa-circle-check" aria-hidden="true"></i>
                  E-mail envoy&#233; &#224; {{ message.firmReminderAction.preview.responsable }}
                  <span class="meta">&#183; consign&#233; dans l'historique du dossier</span>
                </div>
              } @else {
                <div class="confirm-header">
                  <div class="confirm-header-icon" aria-hidden="true">
                    <i class="fa-solid fa-envelope"></i>
                  </div>
                  <div>
                    <div class="confirm-title" id="reminder-confirm-title" i18n="@@ai-assistant.components.confirmation.requise.8212.relance.d.233.ch.233.a.f75c8d7f">Confirmation requise &#8212; relance d'&#233;ch&#233;ance</div>
                    <div class="confirm-subtitle" i18n="@@ai-assistant.components.rappel.a.bdf3a41d">
                      Rappel &#224; {{ message.firmReminderAction.preview.responsable }} &#183; {{ message.firmReminderAction.preview.dossier }}
                    </div>
                  </div>
                </div>

                <div class="confirm-fields">
                  <span class="field-label" i18n="@@ai-assistant.components.destinataire.56579042">Destinataire</span>
                  <span class="field-value"><strong>{{ message.firmReminderAction.preview.responsable }}</strong></span>

                  <span class="field-label" i18n="@@ai-assistant.components.dossier.8ed65788">Dossier</span>
                  <span class="field-value">{{ message.firmReminderAction.preview.dossier }}</span>

                  <span class="field-label" i18n="@@ai-assistant.components.201.ch.233.ance.db6d7f72">&#201;ch&#233;ance</span>
                  <span class="field-value">{{ message.firmReminderAction.preview.echeance }}</span>

                  <span class="field-label" i18n="@@ai-assistant.components.aper.231.u.du.message.ca70afc6">Aper&#231;u du message</span>
                  <div class="message-preview" aria-label="Aper&#231;u de l'e-mail de relance" i18n-aria-label="@@ai-assistant.components.apercu.de.l.e.mail.de.relance.c3260922">
                    <p class="subject">{{ message.firmReminderAction.preview.objet }}</p>
                  </div>
                </div>

                @if (message.firmReminderError) {
                  <div class="confirm-error" role="alert">
                    <i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>
                    {{ message.firmReminderError }}
                  </div>
                }

                <div class="confirm-actions">
                  <button
                    type="button"
                    class="confirm-btn"
                    (click)="confirmReminder()"
                    [disabled]="message.firmReminderConfirming"
                    aria-label="Confirmer l'envoi de la relance" i18n-aria-label="@@ai-assistant.components.confirmer.l.envoi.de.la.relance.423e342c">
                    <i class="fa-solid fa-paper-plane" aria-hidden="true"></i>
                    @if (message.firmReminderConfirming) {<ng-container i18n="@@ai-assistant.components.envoi.8b2fd282"> Envoi&#8230; </ng-container>} @else {<ng-container i18n="@@ai-assistant.components.confirmer.l.envoi.7aacdc81"> Confirmer l'envoi </ng-container>}
                  </button>
                  <button
                    type="button"
                    class="cancel-btn"
                    (click)="cancelReminder()"
                    [disabled]="message.firmReminderConfirming"
                    aria-label="Annuler la relance, aucun e-mail ne sera envoy&#233;" i18n-aria-label="@@ai-assistant.components.annuler.la.relance.aucun.e.mail.ne.sera.envoye.1eec027c" i18n="@@ai-assistant.components.annuler.49ba3292"> Annuler </button>
                  <span class="confirm-expiry" aria-label="D&#233;lai avant expiration de la confirmation" i18n-aria-label="@@ai-assistant.components.delai.avant.expiration.de.la.confirmation.2be9f51b">
                    <i class="fa-regular fa-clock" aria-hidden="true"></i>
                    {{ reminderExpiryLabel }}
                  </span>
                </div>

                <div class="confirm-security-note" i18n="@@ai-assistant.components.l.envoi.n.est.d.233.clench.233.que.par.votre.cli.fd668660"> L'envoi n'est d&#233;clench&#233; que par votre clic &#8212; jamais automatiquement par l'assistant.
                  Un rappel d&#233;j&#224; envoy&#233; aujourd'hui pour cette &#233;ch&#233;ance ne sera pas dupliqu&#233;. </div>
              }
            </section>
          }

          @if (message.suggestedPrompts?.length) {
            <div class="suggested-prompts" role="group" aria-label="Suggestions de suite" i18n-aria-label="@@ai-assistant.components.suggestions.de.suite.4ad5af58">
              @for (p of message.suggestedPrompts; track $index) {
                <button type="button" class="nav-chip" (click)="session.sendSuggestedPrompt(p)">
                  {{ p }}
                </button>
              }
            </div>
          }

          @if (message.clientActions?.length) {
            <div class="client-actions" role="group" aria-label="Navigation sugg&#233;r&#233;e" i18n-aria-label="@@ai-assistant.components.navigation.suggeree.04a68d12">
              @for (a of message.clientActions; track $index) {
                <button type="button" class="nav-chip" (click)="navigateClientAction(a)">
                  {{ a.label }}
                </button>
              }
            </div>
          }

          @if (message.sources?.length) {
            <div class="sources-line" role="note" aria-label="Sources consult&#233;es pour cette r&#233;ponse" i18n-aria-label="@@ai-assistant.components.sources.consultees.pour.cette.reponse.289e2b76">
              <span class="sources-label" i18n="@@ai-assistant.components.sources.outils.c36b1648">Sources (outils)</span>
              @for (s of dedupedSources; track s.toolName) {
                <span class="src-tag" [attr.aria-label]="sourceChipAriaLabel(s)">{{ s.label }}@if (s.count > 1) { ×{{ s.count }}}</span>
              }
            </div>
          } @else if (showUngroundedWarning()) {
            <div class="sources-line unverified-line" role="note" aria-label="Statut de v&#233;rification de la r&#233;ponse" i18n-aria-label="@@ai-assistant.components.statut.de.verification.de.la.reponse.9c2dc758">
              <span
                class="unverified-badge"
                role="status"
                aria-label="R&#233;ponse non v&#233;rifi&#233;e &#8212; les donn&#233;es du cabinet n'ont pas &#233;t&#233; consult&#233;es" i18n-aria-label="@@ai-assistant.components.reponse.non.verifiee.les.donnees.du.cabinet.n.on.d3d018a8">
                <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                <span i18n="@@ai-assistant.components.r.233.ponse.non.v.233.rifi.233.e.8212.donn.233.e.874e5a52">R&#233;ponse non v&#233;rifi&#233;e &#8212; donn&#233;es non consult&#233;es</span>
              </span>
              <button
                type="button"
                class="regenerate-btn"
                (click)="resendOriginalQuestion()"
                aria-label="Relancer la question avec consultation des donn&#233;es du cabinet" i18n-aria-label="@@ai-assistant.components.relancer.la.question.avec.consultation.des.donne.6ccf3543" i18n="@@ai-assistant.components.relancer.avec.consultation.des.donnees.e466c9e5">
                <i class="fa-solid fa-rotate-right" aria-hidden="true"></i>
                Relancer avec consultation des donn&#233;es
              </button>
            </div>
          }

          @if (!message.content.trim() && message.isStreaming) {
            <app-typing-indicator />
          }
        }
      </div>
    </div>
  `,
  styles: [`
    .chat-message {
      display: flex;
      gap: 12px;
      padding: 12px 16px;
      animation: fadeIn 0.2s ease-out;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .chat-message.user {
      flex-direction: row-reverse;
    }

    .message-avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      font-size: 14px;
    }

    .user .message-avatar {
      background: var(--color-primary-100, #dbeafe);
      color: var(--color-primary-600, #2563eb);
    }

    .assistant .message-avatar {
      background: var(--ai-gradient, linear-gradient(135deg, #8b5cf6 0%, #d946ef 100%));
      color: #fff;
    }

    .tool .message-avatar {
      background: var(--color-neutral-100, #f3f4f6);
      color: var(--color-neutral-600, #4b5563);
    }

    .message-body {
      max-width: min(100%, 42rem);
      min-width: 0;
    }

    .assistant-bubble-wrap {
      position: relative;
    }

    .assistant-export-root {
      margin-bottom: 4px;
    }

    .suggested-prompts {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 10px;
    }

    .assistant-toolbar {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 6px;
      margin-bottom: 4px;
      opacity: 0;
      transition: opacity 0.15s;
    }

    .assistant-export-root:hover .assistant-toolbar,
    .assistant-export-root:focus-within .assistant-toolbar {
      opacity: 1;
    }

    .toolbar-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      font-size: 12px;
      font-weight: 500;
      color: var(--color-neutral-600, #4b5563);
      background: transparent;
      border: 1px solid var(--color-neutral-200, #e5e7eb);
      border-radius: 8px;
      cursor: pointer;
    }

    .toolbar-btn:hover:not(:disabled) {
      background: var(--color-neutral-50, #f9fafb);
    }

    .toolbar-btn:focus-visible {
      outline: 2px solid var(--color-primary-500, #3b82f6);
      outline-offset: 2px;
    }

    .toolbar-btn:disabled {
      opacity: 0.6;
      cursor: default;
    }

    .message-content {
      padding: 10px 14px;
      border-radius: 12px;
      font-size: 14px;
      line-height: 1.55;
      word-wrap: break-word;
    }

    .user-content {
      background: linear-gradient(135deg, var(--color-primary-600, #2563eb) 0%, var(--color-primary-700, #1d4ed8) 100%);
      color: #fff;
      border-bottom-right-radius: 4px;
      box-shadow: 0 4px 12px rgba(37, 99, 235, 0.18);
    }

    .assistant-streaming-text {
      white-space: pre-wrap;
      word-break: break-word;
    }

    .message-attachments {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 6px;
    }

    .assistant .message-content {
      background: var(--color-neutral-50, #f9fafb);
      border: 1px solid var(--color-neutral-200, #e5e7eb);
      border-bottom-left-radius: 4px;
    }

    :host ::ng-deep .assistant-markdown markdown {
      display: block;
    }

    :host ::ng-deep .assistant-markdown markdown pre {
      position: relative;
      margin: 8px 0;
      padding: 12px 12px 36px;
      border-radius: 8px;
      background: var(--color-neutral-900, #111827);
      color: var(--color-neutral-100, #f3f4f6);
      overflow-x: auto;
    }

    :host ::ng-deep .assistant-markdown markdown pre code {
      background: transparent;
      padding: 0;
      font-size: 13px;
    }

    :host ::ng-deep .assistant-markdown markdown .md-code-copy {
      position: absolute;
      right: 8px;
      bottom: 6px;
      padding: 4px 10px;
      font-size: 11px;
      font-weight: 500;
      color: var(--color-neutral-200, #e5e7eb);
      background: rgba(255, 255, 255, 0.12);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 6px;
      cursor: pointer;
    }

    :host ::ng-deep .assistant-markdown markdown .md-code-copy:hover {
      background: rgba(255, 255, 255, 0.2);
    }

    :host ::ng-deep .assistant-markdown markdown .md-code-copy:focus-visible {
      outline: 2px solid var(--color-primary-400, #60a5fa);
      outline-offset: 2px;
    }

    :host ::ng-deep .assistant-markdown markdown .md-table-scroll {
      display: block;
      width: 100%;
      overflow-x: auto;
      margin: 8px 0;
      -webkit-overflow-scrolling: touch;
      border-radius: 8px;
      border: 1px solid var(--color-neutral-200, #e5e7eb);
    }

    :host ::ng-deep .assistant-markdown markdown .md-table-scroll:focus-visible {
      outline: 2px solid var(--color-primary-500, #3b82f6);
      outline-offset: 2px;
    }

    :host ::ng-deep .assistant-markdown markdown table {
      width: 100%;
      border-collapse: collapse;
      margin: 0;
      font-size: 13px;
    }

    :host ::ng-deep .assistant-markdown markdown th,
    :host ::ng-deep .assistant-markdown markdown td {
      padding: 8px 10px;
      border: 1px solid var(--color-neutral-200, #e5e7eb);
      text-align: left;
    }

    :host ::ng-deep .assistant-markdown markdown th {
      background: var(--color-neutral-100, #f3f4f6);
      font-weight: 600;
    }

    :host ::ng-deep .assistant-markdown markdown h1,
    :host ::ng-deep .assistant-markdown markdown h2,
    :host ::ng-deep .assistant-markdown markdown h3 {
      margin: 12px 0 8px;
      font-weight: 600;
      color: var(--color-neutral-900, #111827);
      line-height: 1.3;
    }

    :host ::ng-deep .assistant-markdown markdown h1 { font-size: 1.25rem; }
    :host ::ng-deep .assistant-markdown markdown h2 { font-size: 1.1rem; }
    :host ::ng-deep .assistant-markdown markdown h3 { font-size: 1rem; }

    :host ::ng-deep .assistant-markdown markdown blockquote {
      margin: 8px 0;
      padding: 8px 12px;
      border-left: 3px solid var(--color-neutral-300, #d1d5db);
      color: var(--color-neutral-600, #4b5563);
      background: var(--color-neutral-50, #f9fafb);
      border-radius: 0 8px 8px 0;
    }

    :host ::ng-deep .assistant-markdown markdown .severity-critical {
      color: var(--color-danger-700, #b91c1c);
      font-weight: 700;
    }

    :host ::ng-deep .assistant-markdown markdown .severity-warning {
      color: var(--color-warning-800, #92400e);
      font-weight: 700;
    }

    :host ::ng-deep .assistant-markdown markdown .severity-ok {
      color: var(--color-success-700, #15803d);
      font-weight: 700;
    }

    :host ::ng-deep .assistant-markdown markdown hr {
      border: none;
      border-top: 1px solid var(--color-neutral-200, #e5e7eb);
      margin: 12px 0;
    }

    :host ::ng-deep .assistant-markdown markdown p { margin: 0 0 8px; }
    :host ::ng-deep .assistant-markdown markdown p:last-child { margin-bottom: 0; }

    :host ::ng-deep .assistant-markdown markdown code {
      background: var(--color-neutral-100, #f3f4f6);
      padding: 1px 4px;
      border-radius: 4px;
      font-size: 13px;
    }

    :host ::ng-deep .assistant-markdown markdown ul,
    :host ::ng-deep .assistant-markdown markdown ol {
      margin: 4px 0;
      padding-left: 20px;
    }

    :host ::ng-deep .assistant-markdown markdown strong { font-weight: 600; }

    /* Caret clignotant en fin de texte pendant le streaming */
    :host ::ng-deep .assistant-markdown.streaming markdown p:last-child::after,
    :host ::ng-deep .assistant-markdown.streaming markdown li:last-child::after,
    :host ::ng-deep .assistant-markdown.streaming markdown h1:last-child::after,
    :host ::ng-deep .assistant-markdown.streaming markdown h2:last-child::after,
    :host ::ng-deep .assistant-markdown.streaming markdown h3:last-child::after {
      content: '▍';
      display: inline-block;
      margin-left: 2px;
      color: var(--color-primary-500, #6366f1);
      animation: ft-caret-blink 1s steps(1) infinite;
    }
    @keyframes ft-caret-blink { 50% { opacity: 0; } }


    .generation-interrupted {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 8px 12px;
      margin-bottom: 8px;
      border-radius: 10px;
      font-size: 13px;
      line-height: 1.45;
      color: var(--color-neutral-700, #374151);
      background: var(--color-warning-50, #fffbeb);
      border: 1px solid var(--color-warning-200, #fde68a);
    }

    .generation-interrupted i {
      margin-top: 2px;
      color: var(--color-warning-600, #d97706);
      flex-shrink: 0;
    }

    .tool-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 8px;
      font-size: 12px;
      background: var(--color-neutral-50, #f9fafb);
      color: var(--color-neutral-500, #6b7280);
      font-style: italic;
    }


    .sources-line {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      margin-bottom: 8px;
      font-size: 11px;
      color: var(--color-neutral-500, #6b7280);
    }

    .sources-label {
      font-weight: 600;
      margin-right: 4px;
    }

    .src-tag {
      padding: 2px 8px;
      border-radius: 6px;
      background: var(--color-neutral-100, #f3f4f6);
      color: var(--color-neutral-700, #374151);
    }

    /* ── Lot 5 : badge ambre « réponse non vérifiée » (0 consultation) ─────────────────── */
    .unverified-line {
      gap: 8px;
    }

    .unverified-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 10px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      color: var(--color-warning-700, #b45309);
      background: var(--color-warning-50, #fffbeb);
      border: 1px solid var(--color-warning-200, #fde68a);
    }

    .unverified-badge i {
      font-size: 11px;
      color: var(--color-warning-600, #d97706);
    }

    .regenerate-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 12px;
      font-size: 12px;
      font-weight: 600;
      color: var(--ai-accent-600, #7c3aed);
      background: var(--ai-accent-50, #f5f3ff);
      border: 1px solid var(--ai-accent-200, #ddd6fe);
      border-radius: 999px;
      cursor: pointer;
      font-family: inherit;
    }

    .regenerate-btn:hover {
      background: var(--ai-accent-100, #ede9fe);
    }

    .regenerate-btn:focus-visible {
      outline: 2px solid var(--ai-accent-500, #8b5cf6);
      outline-offset: 2px;
    }

    .regenerate-btn i {
      font-size: 11px;
    }

    /* ── Lot 5 : carte repli honnête (gate d'ancrage FirmMission) ─────────────────────── */
    .fallback-card {
      display: flex;
      gap: 10px;
      align-items: flex-start;
      padding: 12px 14px;
      border-radius: 12px;
      border-bottom-left-radius: 4px;
      background: var(--color-info-50, #f0f9ff);
      border: 1px solid var(--color-info-200, #bae6fd);
      font-size: 14px;
      line-height: 1.55;
    }

    .fallback-icon {
      width: 28px;
      height: 28px;
      flex-shrink: 0;
      border-radius: 999px;
      background: var(--color-info-100, #e0f2fe);
      color: var(--color-info-600, #0284c7);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .fallback-icon i {
      font-size: 13px;
    }

    .fallback-body {
      min-width: 0;
    }

    .fallback-title {
      margin: 0 0 4px;
      font-size: 13px;
      font-weight: 700;
      color: var(--color-info-800, #075985);
    }

    .fallback-text {
      margin: 0;
      color: var(--color-neutral-700, #374151);
      white-space: pre-wrap;
      word-break: break-word;
    }

    .fallback-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 10px;
    }

    .retry-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 14px;
      font-size: 12px;
      font-weight: 600;
      color: #fff;
      background: var(--color-info-600, #0284c7);
      border: 1px solid var(--color-info-600, #0284c7);
      border-radius: 999px;
      cursor: pointer;
      font-family: inherit;
    }

    .retry-btn:hover {
      background: var(--color-info-700, #0369a1);
      border-color: var(--color-info-700, #0369a1);
    }

    .retry-btn:focus-visible {
      outline: 2px solid var(--color-info-500, #0ea5e9);
      outline-offset: 2px;
    }

    .retry-btn i {
      font-size: 11px;
    }

    .fallback-hint {
      margin: 8px 0 0;
      font-size: 12px;
      color: var(--color-neutral-500, #6b7280);
    }

    /* ── Lot 5 : carte de confirmation de relance (action en attente côté serveur) ────── */
    .confirm-card {
      margin-top: 10px;
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid var(--ai-accent-200, #ddd6fe);
      background: #fff;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05), 0 10px 24px rgba(124, 58, 237, 0.06);
    }

    .confirm-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      background: var(--ai-accent-50, #f5f3ff);
      border-bottom: 1px solid var(--ai-accent-200, #ddd6fe);
    }

    .confirm-header-icon {
      width: 28px;
      height: 28px;
      flex-shrink: 0;
      border-radius: 999px;
      background: var(--ai-accent-100, #ede9fe);
      color: var(--ai-accent-600, #7c3aed);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .confirm-header-icon i {
      font-size: 13px;
    }

    .confirm-title {
      font-size: 13px;
      font-weight: 700;
      color: var(--color-neutral-900, #111827);
    }

    .confirm-subtitle {
      margin-top: 1px;
      font-size: 11px;
      color: var(--color-neutral-500, #6b7280);
    }

    .confirm-fields {
      padding: 12px 14px 4px;
      display: grid;
      grid-template-columns: 130px 1fr;
      row-gap: 8px;
      column-gap: 12px;
      font-size: 13px;
    }

    .field-label {
      color: var(--color-neutral-500, #6b7280);
      font-size: 12px;
      font-weight: 600;
      padding-top: 1px;
    }

    .field-value {
      color: var(--color-neutral-800, #1f2937);
      min-width: 0;
    }

    .field-value strong {
      font-weight: 600;
    }

    .message-preview {
      grid-column: 1 / -1;
      margin-top: 2px;
      padding: 10px 12px;
      border-radius: 10px;
      background: var(--color-neutral-50, #f9fafb);
      border: 1px solid var(--color-neutral-200, #e5e7eb);
      font-size: 12.5px;
      line-height: 1.5;
      color: var(--color-neutral-700, #374151);
    }

    .message-preview .subject {
      font-weight: 600;
      color: var(--color-neutral-800, #1f2937);
      margin: 0;
    }

    .confirm-error {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin: 8px 14px 0;
      padding: 8px 10px;
      border-radius: 8px;
      font-size: 12.5px;
      line-height: 1.45;
      color: var(--color-danger-700, #b91c1c);
      background: var(--color-warning-50, #fffbeb);
      border: 1px solid var(--color-warning-200, #fde68a);
    }

    .confirm-error i {
      margin-top: 2px;
      flex-shrink: 0;
      color: var(--color-warning-600, #d97706);
    }

    .confirm-actions {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      padding: 12px 14px;
    }

    .confirm-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 16px;
      font-size: 12.5px;
      font-weight: 600;
      color: #fff;
      background: var(--ai-accent-600, #7c3aed);
      border: 1px solid var(--ai-accent-600, #7c3aed);
      border-radius: 999px;
      cursor: pointer;
      font-family: inherit;
      box-shadow: 0 2px 6px rgba(124, 58, 237, 0.25);
    }

    .confirm-btn:hover:not(:disabled) {
      background: var(--ai-accent-500, #8b5cf6);
      border-color: var(--ai-accent-500, #8b5cf6);
    }

    .confirm-btn:focus-visible {
      outline: 2px solid var(--ai-accent-500, #8b5cf6);
      outline-offset: 2px;
    }

    .confirm-btn:disabled {
      opacity: 0.6;
      cursor: default;
    }

    .confirm-btn i {
      font-size: 12px;
    }

    .cancel-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      font-size: 12.5px;
      font-weight: 600;
      color: var(--color-neutral-600, #4b5563);
      background: #fff;
      border: 1px solid var(--color-neutral-200, #e5e7eb);
      border-radius: 999px;
      cursor: pointer;
      font-family: inherit;
    }

    .cancel-btn:hover:not(:disabled) {
      background: var(--color-neutral-50, #f9fafb);
    }

    .cancel-btn:focus-visible {
      outline: 2px solid var(--color-primary-500, #3b82f6);
      outline-offset: 2px;
    }

    .cancel-btn:disabled {
      opacity: 0.6;
      cursor: default;
    }

    .confirm-expiry {
      margin-left: auto;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 11px;
      color: var(--color-neutral-500, #6b7280);
    }

    .confirm-expiry i {
      font-size: 11px;
    }

    .confirm-security-note {
      padding: 8px 14px;
      font-size: 11px;
      color: var(--color-neutral-500, #6b7280);
      border-top: 1px dashed var(--color-neutral-200, #e5e7eb);
      background: var(--color-neutral-50, #f9fafb);
    }

    /* ── État après confirmation (« Relance envoyée ») ────────────────────────────────── */
    .confirm-card.confirmed {
      border-color: var(--color-success-200, #bbf7d0);
      box-shadow: none;
    }

    .confirm-card.confirmed .confirm-header {
      background: var(--color-success-50, #f0fdf4);
      border-bottom-color: var(--color-success-200, #bbf7d0);
    }

    .confirm-card.confirmed .confirm-header-icon {
      background: var(--color-success-100, #dcfce7);
      color: var(--color-success-600, #16a34a);
    }

    .confirmed-status {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      font-size: 12.5px;
      font-weight: 600;
      color: var(--color-success-700, #15803d);
    }

    .confirmed-status i {
      font-size: 13px;
      color: var(--color-success-600, #16a34a);
      flex-shrink: 0;
    }

    .confirmed-status .meta {
      font-weight: 400;
      color: var(--color-neutral-500, #6b7280);
    }

    @media (max-width: 480px) {
      .confirm-fields {
        grid-template-columns: 110px 1fr;
      }
    }

    .message-select {
      display: inline-flex;
      align-items: flex-start;
      padding-top: 6px;
      padding-right: 4px;
      cursor: pointer;
      user-select: none;
    }

    .message-select input[type='checkbox'] {
      width: 16px;
      height: 16px;
      accent-color: var(--color-primary-600, #2563eb);
      cursor: pointer;
    }

    .chat-message.selectable {
      border-radius: 12px;
      transition: background 0.15s, box-shadow 0.15s;
    }

    .chat-message.selectable:hover {
      background: var(--color-neutral-50, #f9fafb);
    }

    .chat-message.selected {
      background: var(--color-primary-50, #eff6ff);
      box-shadow: inset 2px 0 0 var(--color-primary-500, #3b82f6);
    }
  `]
})
export class ChatMessageComponent implements OnChanges {
  @Input({ required: true }) message!: ChatMessage;
  @Input() connectingToModel = false;
  /** Active l'avertissement « réponse non ancrée » (badge ambre / carte repli honnête) — scope FirmMission. */
  @Input() warnWhenUngrounded = false;
  /** Masque le bouton « Graphique » (pas d'outil chart firm) — scope FirmMission. */
  @Input() hideChartFollowUp = false;

  /** Emitted when the user clicks the PPT toolbar button for this single message. */
  @Output() exportSingleAsPowerPoint = new EventEmitter<ChatMessage>();

  @ViewChild('mdRoot') mdRoot?: ElementRef<HTMLElement>;
  @ViewChild('exportRoot') exportRoot?: ElementRef<HTMLElement>;

  readonly MessageRole = MessageRole;
  readonly session = inject(AiChatSessionService);
  readonly selection = inject(MessageSelectionService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly router = inject(Router);
  private readonly cdr = inject(ChangeDetectorRef);
  copyInProgress = false;
  exportBusy = false;
  markdownHasTables = false;
  renderedMarkdown = '';
  displayFallbackText = '';
  /** Markdown rendu EN DIRECT pendant le streaming (fences partielles fermées temporairement). */
  streamingMarkdown = '';

  ngOnChanges(changes: SimpleChanges): void {
    const messageChange = changes['message'];
    if (!messageChange) {
      return;
    }
    if (this.message.isStreaming) {
      // Rendu markdown progressif : le backend streame des segments sûrs déjà assainis ;
      // on se contente de fermer une éventuelle fence ``` ouverte pour un rendu stable.
      this.streamingMarkdown = closePartialFences(this.message.content ?? '');
      this.cdr.markForCheck();
      return;
    }
    this.streamingMarkdown = '';
    const prev = messageChange.previousValue as ChatMessage | undefined;
    const contentChanged = prev?.content !== this.message.content;
    // Réponses livrées via `content_replace` (synthèse / fallback / fast-path) : le contenu est
    // posé pendant le streaming puis `done` bascule isStreaming sans le changer. Sans ce test,
    // refreshAssistantDisplayContent() ne tournerait jamais → renderedMarkdown/displayFallbackText
    // resteraient vides → corps blanc. On recalcule donc aussi à la finalisation du streaming.
    // On n'arrive ici que si this.message.isStreaming est faux (cf. early return ci-dessus) :
    // si le précédent état streamait, c'est que le streaming vient de se terminer.
    const streamingJustEnded = prev?.isStreaming === true;
    if (messageChange.firstChange || contentChanged || streamingJustEnded) {
      this.refreshAssistantDisplayContent();
      this.cdr.markForCheck();
    }
  }

  private refreshAssistantDisplayContent(): void {
    const raw = this.message.content ?? '';
    const state = resolveAssistantDisplayState(raw, {
      smartJsonFallback: environment.aiAssistantSmartJsonFallbackEnabled !== false,
      hasParsedDashboard: !!this.message.parsedDashboard
    });
    this.renderedMarkdown = state.renderedMarkdown;
    this.displayFallbackText = state.displayFallbackText;
  }

  canBeSelected(): boolean {
    return this.message.role === MessageRole.Assistant && !this.message.isStreaming;
  }

  isMessageSelected(): boolean {
    const id = this.session.activeConversationId();
    if (!id) return false;
    return this.selection.isSelected(id, this.message.id);
  }

  canExportSingleToPowerPoint(): boolean {
    return this.message.role === MessageRole.Assistant
      && !this.message.isStreaming
      && (this.markdownForDisplay.trim().length > 0 || !!this.message.parsedDashboard);
  }

  onSelectionToggle(event: Event): void {
    const id = this.session.activeConversationId();
    if (!id) return;
    const conversationTitle = this.session.conversations().find(c => c.id === id)?.title ?? $localize`:@@ui.tern.conversation.2a20c7:Conversation`;
    const preview = (this.markdownForDisplay || this.message.content || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 140);
    const checked = (event.target as HTMLInputElement)?.checked === true;
    if (checked) {
      this.selection.add({
        conversationId: id,
        messageId: this.message.id,
        conversationTitle,
        preview,
        createdAt: this.message.createdAt instanceof Date
          ? this.message.createdAt.toISOString()
          : new Date().toISOString()
      });
    } else {
      this.selection.remove(id, this.message.id);
    }
  }

  exportSingleToPowerPoint(): void {
    if (!this.canExportSingleToPowerPoint() || this.exportBusy) return;
    this.exportSingleAsPowerPoint.emit(this.message);
  }

  get markdownForDisplay(): string {
    return (
      this.renderedMarkdown
      || this.displayFallbackText
      || buildAssistantMarkdownForDisplay(this.message.content, {
        smartJsonFallback: environment.aiAssistantSmartJsonFallbackEnabled !== false
      })
    );
  }


  showAssistantActions(): boolean {
    if (this.message.isStreaming) {
      return false;
    }
    // Le repli honnête est rendu en carte info dédiée : pas de barre d'export (Copier/PDF/…).
    if (this.isHonestFallback) {
      return false;
    }
    return !!(
      this.markdownForDisplay?.trim() ||
      this.message.parsedDashboard
    );
  }

  canExportMarkdownTables(): boolean {
    return !this.message.isStreaming && this.markdownHasTables;
  }

  onDashboardClosed(): void {
    this.session.dismissInlineDashboard(this.message.id);
  }

  async copyFullMessage(): Promise<void> {
    const text = this.markdownForDisplay?.trim();
    if (!text || this.copyInProgress) {
      return;
    }
    this.copyInProgress = true;
    try {
      await writeTextToClipboard(text, this.platformId);
    } finally {
      this.copyInProgress = false;
    }
  }

  async copyAsTsv(): Promise<void> {
    const host = this.mdRoot?.nativeElement;
    const text = this.markdownForDisplay?.trim();
    if (!text || this.copyInProgress) {
      return;
    }
    this.copyInProgress = true;
    try {
      if (host) {
        const csv = htmlTablesToCsv(host);
        if (csv) {
          const tsv = csv
            .split(/\r?\n/)
            .map(line => (line.startsWith('#') ? line : line.split(';').join('\t')))
            .join('\n');
          await writeTextToClipboard(tsv, this.platformId);
          return;
        }
      }
      await writeTextToClipboard(text, this.platformId);
    } finally {
      this.copyInProgress = false;
    }
  }

  exportMarkdownTablesCsv(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const host = this.mdRoot?.nativeElement;
    if (!host) {
      return;
    }
    const csv = htmlTablesToCsv(host);
    if (!csv) {
      return;
    }
    downloadCsv(`tableaux-${this.slugifyShort(this.message.id)}`, csv);
  }

  async exportDashboardExcel(): Promise<void> {
    const d = this.message.parsedDashboard;
    if (!d || this.exportBusy) {
      return;
    }
    this.exportBusy = true;
    try {
      await exportDashboardToXlsx(d, `export-${this.slugifyShort(d.title)}`);
    } finally {
      this.exportBusy = false;
    }
  }

  async exportAssistantPdf(): Promise<void> {
    const el = this.exportRoot?.nativeElement;
    if (!el || this.exportBusy) {
      return;
    }
    this.exportBusy = true;
    try {
      await exportElementToPdf(el, `assistant-${this.slugifyShort(this.message.id)}`);
    } finally {
      this.exportBusy = false;
    }
  }

  shareByEmail(): void {
    const body = encodeURIComponent(this.markdownForDisplay?.trim() ?? '');
    const subject = encodeURIComponent(`${environment.appName} - Assistant IA`);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  }

  async copyConversationLink(): Promise<void> {
    const id = this.session.activeConversationId();
    if (!id || !isPlatformBrowser(this.platformId)) {
      return;
    }
    const url = `${window.location.origin}/ai-assistant?conversationId=${encodeURIComponent(id)}`;
    await writeTextToClipboard(url, this.platformId);
  }

  suggestChartFollowUp(): void {
    // Formulation volontairement sans « ajouter » (déclencheur de l'heuristique de mutation backend)
    // et avec « graphique » + generate_dashboard_config → route vers l'intent Chart (lecture seule).
    this.session.sendMessage(
      "A partir des chiffres ci-dessus, genere un graphique pertinent (barres, lignes ou camembert) avec generate_dashboard_config."
    );
  }

  private slugifyShort(s: string): string {
    return (
      s
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .slice(0, 48) || 'export'
    );
  }

  onMarkdownRendered(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    queueMicrotask(() => {
      const host = this.mdRoot?.nativeElement;
      this.markdownHasTables = !!host?.querySelector('markdown table');
      this.wrapMarkdownTables();
      this.attachCodeCopyButtons();
    });
  }

  private wrapMarkdownTables(): void {
    const host = this.mdRoot?.nativeElement;
    if (!host) {
      return;
    }
    const tables = host.querySelectorAll<HTMLTableElement>(
      'markdown table:not(.md-table-scroll table)'
    );
    tables.forEach(table => {
      if (table.closest('.md-table-scroll')) {
        return;
      }
      const wrap = document.createElement('div');
      wrap.className = 'md-table-scroll';
      wrap.tabIndex = 0;
      wrap.setAttribute('role', 'region');
      wrap.setAttribute('aria-label', 'Tableau defilable');
      table.parentNode?.insertBefore(wrap, table);
      wrap.appendChild(table);
    });
  }

  private attachCodeCopyButtons(): void {
    const host = this.mdRoot?.nativeElement;
    if (!host) {
      return;
    }
    const pres = host.querySelectorAll<HTMLPreElement>('markdown pre:not([data-ft-code-copy])');
    pres.forEach(pre => {
      pre.setAttribute('data-ft-code-copy', '1');
      const code = pre.querySelector('code');
      const text = code?.textContent ?? '';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'md-code-copy';
      btn.setAttribute('aria-label', $localize`:@@ai-assistant.chat-message.ts.copier.le.code.ffdfce13:Copier le code`);
      btn.textContent = 'Copier';
      btn.addEventListener('click', () => {
        void writeTextToClipboard(text, this.platformId);
      });
      pre.appendChild(btn);
    });
  }

  getToolLabel(name: string): string {
    return getAiToolDisplayLabel(name);
  }

  /** Chips sources agrégées par outil (« Prévision du CA ×3 » au lieu de 3 chips identiques). */
  get dedupedSources(): DedupedToolSource[] {
    return dedupeToolSources(this.message.sources);
  }

  navigateClientAction(action: ClientNavAction): void {
    let url = action.route.startsWith('/') ? action.route : `/${action.route}`;
    if (action.queryParams && Object.keys(action.queryParams).length > 0) {
      const q = new URLSearchParams(action.queryParams).toString();
      url += url.includes('?') ? `&${q}` : `?${q}`;
    }
    void this.router.navigateByUrl(url);
  }

  // ── Lot 5 : ancrage visible (badge « non vérifiée », repli honnête, relance en attente) ──────

  /** Repli honnête de la gate d'ancrage FirmMission : contenu final commençant par le préfixe dédié. */
  get isHonestFallback(): boolean {
    return (
      this.message.role === MessageRole.Assistant &&
      !this.message.isStreaming &&
      this.message.content.trim().startsWith(FIRM_UNGROUNDED_FALLBACK_PREFIX)
    );
  }

  /**
   * Voyant ambre « réponse non vérifiée » : réponse assistant terminée, avec du contenu mais sans
   * sources ni aucun appel d'outil abouti. Non affiché pour le repli honnête (carte dédiée) ni
   * hors scope FirmMission (warnWhenUngrounded).
   */
  showUngroundedWarning(): boolean {
    if (!this.warnWhenUngrounded || this.message.role !== MessageRole.Assistant) {
      return false;
    }
    if (this.message.isStreaming || this.isHonestFallback) {
      return false;
    }
    // Une relance en attente de confirmation est issue de l'outil send_fiscal_deadline_reminder :
    // la carte de confirmation est le rendu pertinent, pas le badge « non vérifiée ».
    if (this.message.firmReminderAction) {
      return false;
    }
    if (!this.message.content.trim()) {
      return false;
    }
    if (this.message.sources && this.message.sources.length > 0) {
      return false;
    }
    if ((this.message.toolCalls || []).some(tc => tc.status === 'completed')) {
      return false;
    }
    return true;
  }

  /** Libellé accessible du délai d'expiration (calculé depuis expiresAtUtc ; non réactif en v1). */
  get reminderExpiryLabel(): string {
    const action = this.message.firmReminderAction;
    if (!action?.expiresAtUtc) {
      return $localize`:@@ai-assistant.chat-message.ts.expire.dans.5.min.d79f5d42:Expire dans 5 min`;
    }
    const t = Date.parse(action.expiresAtUtc);
    if (Number.isNaN(t)) {
      return $localize`:@@ai-assistant.chat-message.ts.expire.dans.5.min.d79f5d42:Expire dans 5 min`;
    }
    const mins = Math.round((t - Date.now()) / 60000);
    return mins > 0 ? $localize`:@@ui.tern.expire.dans.ph.min.2d8ebb:Expire dans ${mins}:p0: min` : $localize`:@@ui.tern.expiree.1f0808:Expirée`;
  }

  sourceChipAriaLabel(s: DedupedToolSource): string {
    return `Source : ${s.label}${s.count > 1 ? $localize`:@@ui.tern.ph.consultations.93f2ee: (${s.count}:p0: consultations)` : ''}`;
  }

  /** Relance la question utilisateur à l'origine de cette réponse (force la consultation des données). */
  resendOriginalQuestion(): void {
    const question = this.findOriginalQuestion();
    if (question) {
      this.session.sendMessage(question);
    }
  }

  private findOriginalQuestion(): string | null {
    const msgs = this.session.messages();
    const idx = msgs.findIndex(m => m.id === this.message.id);
    if (idx < 0) {
      return null;
    }
    for (let i = idx - 1; i >= 0; i--) {
      if (msgs[i].role === MessageRole.User) {
        return msgs[i].content;
      }
    }
    return null;
  }

  /** Confirme l'envoi de la relance (POST /api/firm/ai/reminders/confirm avec le nonce, usage unique). */
  confirmReminder(): void {
    const action = this.message.firmReminderAction;
    if (!action || this.message.firmReminderConfirming || this.message.firmReminderConfirmed) {
      return;
    }
    this.session.confirmFirmReminder(this.message.id, action.nonce);
  }

  /** Annule la relance en attente (aucun envoi ; le nonce expire de lui-même côté serveur). */
  cancelReminder(): void {
    if (this.message.firmReminderConfirming || this.message.firmReminderConfirmed) {
      return;
    }
    this.session.dismissFirmReminder(this.message.id);
  }
}

