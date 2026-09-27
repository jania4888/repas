import {
  Component,
  Output,
  EventEmitter,
  Input,
  inject,
  signal,
  OnDestroy,
  OnChanges,
  SimpleChanges,
  ViewChild,
  ElementRef,
  AfterViewChecked
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { createClientUuid } from '@core/utils/safe-random-uuid.util';
import { ChatSpeechTranscriptionService } from '../../services/chat-speech-transcription.service';
import { AiChatService } from '../../services/ai-chat.service';
import { ChatAttachmentCardComponent } from '../chat-attachment-card/chat-attachment-card.component';
import {
  buildDefaultPromptForAttachments,
  toChatAttachment
} from '../../utils/chat-attachment-payload.util';
import type { ChatAttachment } from '../../models/ai-chat.models';

export interface ChatInputSubmission {
  text: string;
  attachments: ChatAttachment[];
}

@Component({
  selector: 'app-chat-input',
  standalone: true,
  imports: [CommonModule, FormsModule, ChatAttachmentCardComponent],
  template: `
    <div class="chat-input-wrapper">
      <input
        #fileInput
        type="file"
        class="visually-hidden"
        tabindex="-1"
        accept=".txt,.csv,.pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx,text/plain,text/csv,application/pdf,image/png,image/jpeg,image/webp,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        (change)="onFileSelected($event)"
        aria-hidden="true" />

      @if (pendingAttachments().length > 0) {
        <div class="pending-attachments" role="list">
          @for (att of pendingAttachments(); track att.id) {
            <app-chat-attachment-card
              role="listitem"
              [attachment]="att"
              [editable]="true"
              (removed)="removeAttachment($event)"
            />
          }
        </div>
      }

      @if (extractingFileName()) {
        <div class="extracting" role="status" aria-live="polite" i18n="@@ai-assistant.components.extraction.de.1fd182f6">
          <i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>
          Extraction de {{ extractingFileName() }}…
        </div>
      }
      <div
        class="input-container"
        [class.input-container--dictating]="speech.listening()">
        <textarea
          #inputEl
          [(ngModel)]="text"
          (keydown)="onTextareaKeydown($event)"
          (input)="onTextareaInput($event)"
          [disabled]="disabled"
          placeholder="Posez une question sur vos données..." i18n-placeholder="@@ai-assistant.components.posez.une.question.sur.vos.donnees.e5155ffe"
          rows="1"
          [attr.aria-busy]="speech.listening()"
          [attr.aria-describedby]="speech.listening() ? 'ft-ai-dictation-hint' : null"
        ></textarea>
        <button
          type="button"
          class="attach-btn"
          [disabled]="disabled || isStreaming"
          (click)="openFilePicker()"
          aria-label="Joindre un document texte ou PDF pour extraction" i18n-aria-label="@@ai-assistant.components.joindre.un.document.texte.ou.pdf.pour.extraction.e066082e">
          <i class="fa-solid fa-paperclip" aria-hidden="true"></i>
        </button>
        @if (speechSupported) {
          <button
            type="button"
            class="mic-btn"
            [class.mic-btn--active]="speech.listening()"
            [disabled]="disabled"
            [attr.aria-pressed]="speech.listening()"
            [attr.aria-label]="speech.listening() ? loc_ui_tern_arreter_la_dictee_vocale_b1047b : loc_ui_tern_demarrer_la_dictee_vocale_5198f7"
            (click)="toggleDictation()"
          >
            <i class="fa-solid fa-microphone" aria-hidden="true"></i>
          </button>
        }
        @if (isStreaming) {
          <button
            type="button"
            class="stop-btn"
            (click)="emitStop()"
            aria-label="Arrêter la génération" i18n-aria-label="@@ai-assistant.components.arreter.la.generation.4aaf99b4"
          >
            <i class="fa-solid fa-stop" aria-hidden="true"></i>
          </button>
        } @else {
          <button
            type="button"
            class="send-btn"
            [disabled]="disabled || (!text.trim() && pendingAttachments().length === 0)"
            (click)="send()"
            aria-label="Envoyer le message" i18n-aria-label="@@ai-assistant.components.envoyer.le.message.64990849"
          >
            <i class="fa-solid fa-paper-plane" aria-hidden="true"></i>
          </button>
        }
      </div>
      @if (speech.listening()) {
        <div id="ft-ai-dictation-hint" class="dictation-hint" role="status" aria-live="polite" i18n="@@ai-assistant.components.dictee.active.verifiez.le.texte.dans.le.champ.av.b6da1861"> Dictée active — vérifiez le texte dans le champ avant d’envoyer. </div>
      }
      @if (speech.lastError(); as err) {
        <div class="speech-error" role="status" aria-live="polite">{{ err }}</div>
      }
      @if (extractError()) {
        <div class="speech-error" role="status" aria-live="polite">{{ extractError() }}</div>
      }
      <div class="input-hint">
        @if (isStreaming) {<ng-container i18n="@@ai-assistant.components.generation.en.cours.echap.pour.arreter.336f3a2c">
          Génération en cours &middot; Échap pour arrêter
        </ng-container>} @else {<ng-container i18n="@@ai-assistant.components.entree.pour.envoyer.shift.entree.pour.un.a8e85099">
          Entrée pour envoyer &middot; Shift+Entrée pour un retour à la ligne
          </ng-container>@if (speechSupported) {
            <span i18n="@@ai-assistant.components.middot.dictee.via.le.micro.chrome.edge.recommand.32a2d645"> &middot; Dictée via le micro (Chrome / Edge recommandés)</span>
          }
        }
      </div>
      <p class="input-disclaimer" role="note" i18n="@@ai-assistant.components.l.ia.peut.se.tromper.verifiez.les.reponses.et.le.7d4fa22f"> L’IA peut se tromper. Vérifiez les réponses et les montants avant toute décision. </p>
    </div>
  `,
  styles: [`
    .chat-input-wrapper {
      padding: var(--spacing-3) var(--spacing-4);
      border-top: 1px solid var(--color-border-subtle);
      background: var(--color-white);
    }

    .pending-attachments {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);
      margin-bottom: var(--spacing-2);
    }

    .extracting {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      padding: var(--spacing-2) var(--spacing-3);
      margin-bottom: var(--spacing-2);
      background: var(--color-primary-50);
      color: var(--color-primary-700);
      border: 1px solid var(--color-primary-100);
      border-radius: var(--radius-lg);
      font-size: var(--font-size-xs);
    }

    .input-container {
      display: flex;
      align-items: flex-end;
      gap: var(--spacing-2);
      background: var(--color-neutral-50);
      border: 1px solid var(--color-border-subtle);
      border-radius: var(--radius-xl);
      padding: var(--spacing-2) var(--spacing-3);
      box-shadow: var(--shadow-xs);
      transition:
        border-color var(--transition-fast),
        box-shadow var(--transition-fast);
    }

    .input-container:focus-within {
      border-color: var(--ai-accent-500, #8b5cf6);
      box-shadow: var(--shadow-sm), 0 0 0 3px rgb(139 92 246 / 0.18);
    }

    .input-container--dictating {
      border-color: var(--color-primary-400);
      box-shadow: 0 0 0 2px rgb(59 130 246 / 0.2);
    }

    textarea {
      flex: 1;
      border: none;
      background: transparent;
      resize: none;
      font-size: var(--font-size-sm);
      font-family: inherit;
      line-height: var(--line-height-normal);
      max-height: 120px;
      outline: none;
      color: var(--color-text-primary);
    }

    textarea::placeholder {
      color: var(--color-text-tertiary);
    }

    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    .dictation-hint {
      font-size: var(--font-size-xs);
      color: var(--color-primary-700);
      margin: 0 var(--spacing-1) var(--spacing-2);
      padding: var(--spacing-2) var(--spacing-3);
      border-radius: var(--radius-lg);
      background: var(--color-primary-50);
      border: 1px solid var(--color-primary-100);
    }

    .attach-btn {
      width: 36px;
      height: 36px;
      border-radius: var(--radius-lg);
      border: 1px solid var(--color-border-default);
      background: var(--color-white);
      color: var(--color-text-secondary);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: background-color 0.15s, border-color 0.15s, opacity 0.15s;
    }

    .attach-btn:hover:not(:disabled) {
      background: var(--color-neutral-100);
    }

    .attach-btn:focus-visible {
      outline: 2px solid var(--color-primary-500);
      outline-offset: 2px;
    }

    .attach-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .mic-btn {
      width: 36px;
      height: 36px;
      border-radius: var(--radius-lg);
      border: 1px solid var(--color-border-default);
      background: var(--color-white);
      color: var(--color-text-secondary);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: background-color 0.15s, border-color 0.15s, color 0.15s, opacity 0.15s;
    }

    .mic-btn:hover:not(:disabled) {
      background: var(--color-neutral-100);
      border-color: var(--color-border-strong);
    }

    .mic-btn:focus-visible {
      outline: 2px solid var(--color-primary-500);
      outline-offset: 2px;
    }

    .mic-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .mic-btn--active {
      background: var(--color-primary-50);
      border-color: var(--color-primary-500);
      color: var(--color-primary-700);
    }

    .send-btn {
      width: 40px;
      height: 40px;
      border-radius: var(--radius-full);
      border: none;
      background: var(--ai-gradient-strong, linear-gradient(135deg, #7c3aed 0%, #c026d3 100%));
      color: var(--color-white);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      box-shadow: var(--ai-glow, 0 8px 20px rgba(139, 92, 246, 0.35));
      transition: filter var(--transition-fast), opacity var(--transition-fast), box-shadow var(--transition-fast), transform var(--transition-fast);
    }

    .send-btn:hover:not(:disabled) {
      filter: brightness(1.06);
      transform: translateY(-1px);
      box-shadow: 0 10px 24px rgba(139, 92, 246, 0.45);
    }

    .send-btn:disabled {
      opacity: 0.45;
      cursor: not-allowed;
      box-shadow: none;
    }

    .send-btn:focus-visible {
      outline: 2px solid var(--color-primary-500);
      outline-offset: 2px;
    }

    .stop-btn {
      width: 40px;
      height: 40px;
      border-radius: var(--radius-full);
      border: none;
      background: var(--color-neutral-700);
      color: var(--color-white);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: background-color 0.15s, box-shadow 0.15s;
    }

    .stop-btn:hover {
      background: var(--color-neutral-800);
    }

    .stop-btn:focus-visible {
      outline: 2px solid var(--color-primary-500);
      outline-offset: 2px;
    }

    .speech-error {
      font-size: var(--font-size-xs);
      color: var(--color-error-600);
      margin-top: var(--spacing-2);
      padding: 0 var(--spacing-1);
    }

    .input-hint {
      font-size: var(--font-size-xs);
      color: var(--color-text-tertiary);
      margin-top: var(--spacing-2);
      text-align: center;
      line-height: var(--line-height-normal);
    }

    .input-disclaimer {
      margin: var(--spacing-2) 0 0;
      font-size: var(--font-size-xs);
      color: var(--color-text-tertiary);
      text-align: center;
      line-height: var(--line-height-normal);
    }
  `]
})
export class ChatInputComponent implements OnDestroy, OnChanges, AfterViewChecked {
  readonly loc_ui_tern_arreter_la_dictee_vocale_b1047b = $localize`:@@ui.tern.arreter.la.dictee.vocale.b1047b:Arrêter la dictée vocale`;
  readonly loc_ui_tern_demarrer_la_dictee_vocale_5198f7 = $localize`:@@ui.tern.demarrer.la.dictee.vocale.5198f7:Démarrer la dictée vocale`;
  @Input() disabled = false;
  /** When true, show stop control instead of send (typically mirrors assistant streaming). */
  @Input() isStreaming = false;
  /** True si le modèle ciblé supporte la vision (rend les pages en images base64 pour l'envoi). */
  @Input() modelSupportsVision = false;
  @Output() messageSent = new EventEmitter<ChatInputSubmission>();
  @Output() stopRequested = new EventEmitter<void>();

  @ViewChild('inputEl') private inputRef?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('fileInput') private fileInputRef?: ElementRef<HTMLInputElement>;

  readonly speech = inject(ChatSpeechTranscriptionService);
  private readonly chatService = inject(AiChatService);
  readonly speechSupported = this.speech.isSupported();

  readonly extractError = signal<string | null>(null);
  readonly extractingFileName = signal<string | null>(null);
  readonly pendingAttachments = signal<ChatAttachment[]>([]);

  text = '';
  private skipInputStop = false;
  private pendingResize = false;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['disabled'] && this.disabled) {
      this.speech.stop();
    }
  }

  ngAfterViewChecked(): void {
    if (this.pendingResize) {
      this.pendingResize = false;
      this.resizeTextareaElement();
    }
  }

  ngOnDestroy(): void {
    this.speech.stop();
  }

  onTextareaKeydown(event: KeyboardEvent): void {
    if (this.isStreaming && event.key === 'Escape') {
      event.preventDefault();
      this.emitStop();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.send();
    }
  }

  emitStop(): void {
    this.stopRequested.emit();
  }

  onTextareaInput(event: Event): void {
    this.autoResize(event);
    if (this.skipInputStop) {
      this.skipInputStop = false;
      return;
    }
    if (this.speech.listening()) {
      this.speech.stop();
    }
  }

  send(): void {
    const trimmed = this.text.trim();
    const attachments = this.pendingAttachments();
    if (this.disabled) return;
    if (!trimmed && attachments.length === 0) return;
    this.speech.stop();
    const text = trimmed || buildDefaultPromptForAttachments(attachments);
    this.messageSent.emit({ text, attachments });
    this.text = '';
    this.pendingAttachments.set([]);
  }

  removeAttachment(id: string): void {
    this.pendingAttachments.update(list => list.filter(a => a.id !== id));
  }

  openFilePicker(): void {
    this.extractError.set(null);
    this.fileInputRef?.nativeElement.click();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || this.disabled) {
      return;
    }
    this.extractError.set(null);
    this.extractingFileName.set(file.name);

    const renderImages = this.modelSupportsVision === true;
    this.chatService.extractDocument(file, { renderImages }).subscribe({
      next: res => {
        this.extractingFileName.set(null);
        const attachment = toChatAttachment(res, file, createClientUuid());
        this.pendingAttachments.update(list => [...list, attachment]);
      },
      error: () => {
        this.extractingFileName.set(null);
        this.extractError.set($localize`:@@ai-assistant.chat-input.ts.impossible.d.extraire.le.document.format.f1f4397a:Impossible d'extraire le document. Formats acceptés : .txt, .csv, .pdf, .png, .jpg, .jpeg, .webp, .docx, .xlsx (max 10 Mo).`);
      }
    });
  }

  toggleDictation(): void {
    if (this.disabled) return;
    if (this.speech.listening()) {
      this.speech.stop();
      return;
    }
    this.speech.start({
      baseText: this.text,
      onDisplayText: (full) => {
        this.skipInputStop = true;
        this.text = full;
        this.pendingResize = true;
      }
    });
  }

  private resizeTextareaElement(): void {
    const el = this.inputRef?.nativeElement;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }

  autoResize(event: Event): void {
    const el = event.target as HTMLTextAreaElement;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }
}
