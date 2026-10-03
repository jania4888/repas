import { DatePipe } from '@angular/common';
import { Component, ElementRef, OnDestroy, OnInit, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription, timer } from 'rxjs';
import {
  CompanySupportCategory,
  CompanySupportMessage,
  CompanySupportService
} from '@core/services/company-support.service';
import { CompanySupportBadgeService } from '@core/services/company-support-badge.service';

const MAX_ATTACHMENTS = 5;
const NEAR_BOTTOM_PX = 48;

const CATEGORY_LABEL: Record<CompanySupportCategory, string> = {
  Question: $localize`:@@assistance.assistance-page.ts.question.002ff598:Question`,
  Proposal: $localize`:@@assistance.assistance-page.ts.proposition.3e2cf2d2:Proposition`,
  Complaint: $localize`:@@assistance.assistance-page.ts.reclamation.33d37f8b:Réclamation`,
  Reply: $localize`:@@assistance.assistance-page.ts.reponse.e777631b:Réponse`
};

@Component({
  selector: 'app-assistance-page',
  standalone: true,
  imports: [FormsModule, DatePipe],
  template: `
    <section class="assist">
      <header class="assist-head">
        <h1 i18n="@@assistance.assistance-page.assistance.be6b37ba">Assistance</h1>
        <p i18n="@@assistance.assistance-page.posez.une.question.envoyez.une.proposition.ou.un.db9ac792">Posez une question, envoyez une proposition ou une réclamation à l'équipe InstaFact.</p>
      </header>

      @if (error()) {
        <p class="assist-error" role="alert">{{ error() }}</p>
      }

      <div
        #thread
        class="assist-thread"
        role="log"
        aria-live="polite"
        [attr.aria-busy]="loading()"
        (scroll)="onThreadScroll()">
        @if (loading()) {
          <p class="assist-status" i18n="@@assistance.assistance-page.chargement">Chargement…</p>
        } @else if (messages().length === 0) {
          <div class="assist-empty">
            <svg class="empty-icon" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
              <rect x="6" y="10" width="36" height="24" rx="6" fill="none" stroke="currentColor" stroke-width="2" />
              <path d="M14 34 L10 42 L22 34" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
            </svg>
            <p i18n="@@assistance.assistance-page.aucun.message.posez.une.question.envoyez.une.pro.0dad613d">Aucun message. Posez une question, envoyez une proposition ou une réclamation.</p>
          </div>
        }
        @for (message of messages(); track message.id) {
          <div class="bubble-row" [class.mine]="message.authorSide === 'Company'" [class.theirs]="message.authorSide === 'Platform'">
            <article class="bubble">
              <header>
                <strong>{{ message.authorSide === 'Platform' ? loc_ui_tern_assistance_be6b37 : message.authorDisplayName }}</strong>
                <span class="chip" [attr.data-category]="message.category">{{ label(message.category) }}</span>
                <time [attr.datetime]="message.sentAt">{{ message.sentAt | date: 'dd/MM/yyyy HH:mm' }}</time>
              </header>
              @if (message.body) {
                <p class="body">{{ message.body }}</p>
              }
              @if (message.attachments.length) {
                <ul class="attachments">
                  @for (file of message.attachments; track file.id) {
                    <li>
                      <button type="button" class="file-link" (click)="download(file.id, file.fileName)">
                        <span class="file-name">{{ file.fileName }}</span>
                        @if (formatSize(file.sizeBytes); as size) {
                          <span class="file-size">({{ size }})</span>
                        }
                      </button>
                    </li>
                  }
                </ul>
              }
            </article>
          </div>
        }
      </div>

      <form class="composer" (ngSubmit)="send()">
        <div class="composer-fields">
        <label class="field">
          <span i18n="@@assistance.assistance-page.type.3deb7456">Type</span>
          <select name="category" [(ngModel)]="category" [disabled]="sending()" required>
            <option value="Question" i18n="@@assistance.assistance-page.question.002ff598">Question</option>
            <option value="Proposal" i18n="@@assistance.assistance-page.proposition.3e2cf2d2">Proposition</option>
            <option value="Complaint" i18n="@@assistance.assistance-page.reclamation.33d37f8b">Réclamation</option>
          </select>
        </label>
        <label class="field">
          <span class="field-head">
            <span i18n="@@assistance.assistance-page.message.68f4145f">Message</span>
            <span class="counter">{{ body.length }}/4000</span>
          </span>
          <textarea
            name="body"
            rows="3"
            maxlength="4000"
            [(ngModel)]="body"
            [disabled]="sending()"
            placeholder="Votre message"
            i18n-placeholder="@@assistance.assistance-page.votre.message.65d92a68"></textarea>
        </label>
        <div class="field">
          <span id="assist-files-caption" i18n="@@assistance.assistance-page.fichiers.23a9d9fc">Fichiers</span>
          <div class="file-actions">
            <input
              #fileInput
              class="sr-only"
              type="file"
              multiple
              tabindex="-1"
              aria-labelledby="assist-files-caption"
              (change)="onFiles($event)" />
            <button type="button" class="attach" [disabled]="sending()" (click)="openFilePicker()">
              <ng-container i18n="@@assistance.assistance-page.joindre.des.fichiers">Joindre des fichiers</ng-container>
            </button>
          </div>
          <p class="hint" i18n="@@assistance.assistance-page.plafond.fichiers.rappel">Jusqu'à 5 fichiers. Le type et la taille sont vérifiés à l'envoi.</p>
          @if (files.length) {
            <p class="files" i18n="@@assistance.assistance-page.fichier.s.selectionne.s.d143cce6">{{ files.length }} fichier(s) sélectionné(s)</p>
            <ul class="file-chips">
              @for (file of files; track $index) {
                <li>
                  <span class="file-name">{{ file.name }}</span>
                  @if (formatSize(file.size); as size) {
                    <span class="file-size">{{ size }}</span>
                  }
                  <button type="button" class="chip-remove" [disabled]="sending()" (click)="removeFile($index)">
                    <ng-container i18n="@@assistance.assistance-page.retirer">Retirer</ng-container>
                  </button>
                </li>
              }
            </ul>
          }
          @if (fileLimitReached()) {
            <p class="file-notice" role="status" i18n="@@assistance.assistance-page.limite.cinq.fichiers">Seuls les 5 premiers fichiers seront envoyés.</p>
          }
        </div>
        </div>
        <div class="composer-actions">
          <button type="submit" class="send" [disabled]="!canSend() || sending()">
            @if (sending()) {
              <ng-container i18n="@@assistance.assistance-page.envoi.en.cours">Envoi…</ng-container>
            } @else {
              <ng-container i18n="@@assistance.assistance-page.envoyer.e9ce243b">Envoyer</ng-container>
            }
          </button>
        </div>
      </form>
    </section>
  `,
  styles: [`
    :host {
      /* Hauteur utile = viewport moins l'en-tête, la barre modules, le padding de .midde_cont
         et le padding bas du volet de travail. Le shell n'est pas modifié. */
      --assist-topbar: var(--topbar-height, 48px);
      --assist-secondary: var(--secondary-nav-height, 2.75rem);
      --assist-pad-block: calc(var(--spacing-6, 1.5rem) * 2);
      --assist-pane-pad: var(--spacing-6, 1.5rem);
      --assist-tabs: 0px;
      --assist-fudge: 2px;
      --assist-chrome: calc(
        var(--assist-topbar) + var(--assist-secondary) + var(--assist-pad-block) + var(--assist-pane-pad) + var(--assist-tabs) + var(--assist-fudge)
      );
      display: block;
      height: calc(100dvh - var(--assist-chrome));
      max-height: calc(100dvh - var(--assist-chrome));
      min-height: min(28rem, calc(100dvh - var(--assist-chrome)));
    }

    :host-context(.midde_cont--workspace) {
      --assist-tabs: calc(2.5rem + 1px);
      --assist-pad-block: var(--spacing-6, 1.5rem);
    }

    @media (max-width: 991.98px) {
      :host { --assist-secondary: 0px; }
    }

    @media (max-width: 768px) {
      :host {
        --assist-pad-block: calc(var(--spacing-4, 1rem) * 2);
        --assist-fudge: 16px;
      }
      :host-context(.midde_cont--workspace) { --assist-pad-block: var(--spacing-4, 1rem); }
    }

    .assist {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      height: 100%;
      max-width: 52rem;
      margin-inline: auto;
      overflow: hidden;
      color: var(--color-text-primary);
    }

    .assist-head,
    .assist-error,
    .composer {
      flex-shrink: 0;
    }

    .assist-head h1 {
      margin: 0;
      font-size: var(--font-size-2xl);
      font-weight: var(--font-weight-semibold);
      line-height: var(--line-height-tight);
      color: var(--color-text-primary);
    }

    .assist-head p {
      margin: 0.25rem 0 0;
      color: var(--color-text-secondary);
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-normal);
    }

    .assist-error {
      margin: 0;
      padding: 0.65rem 0.85rem;
      border-radius: var(--radius-lg);
      background: var(--color-error-50);
      color: var(--color-error-700);
      border: 1px solid color-mix(in srgb, var(--color-error-500) 35%, var(--color-white));
    }

    .assist-thread {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      padding: 1rem;
      background: var(--color-neutral-50);
      border: 1px solid var(--color-border-subtle);
      border-radius: var(--radius-xl);
    }

    .assist-empty,
    .assist-status {
      margin-block: auto;
      margin-inline: auto;
      max-width: 24rem;
      text-align: center;
      color: var(--color-text-secondary);
    }

    .assist-empty p,
    .assist-status {
      margin: 0;
    }

    .empty-icon {
      width: 2.5rem;
      height: 2.5rem;
      margin-block-end: 0.5rem;
      color: var(--color-neutral-400);
    }

    .bubble-row {
      display: flex;
    }

    .bubble-row.mine { justify-content: end; }
    .bubble-row.theirs { justify-content: start; }

    .bubble {
      max-width: 75%;
      border: 1px solid var(--color-border-subtle);
      border-radius: var(--radius-xl);
      padding: 0.75rem 1rem;
      background: var(--color-background-elevated);
      box-shadow: var(--shadow-sm);
    }

    .bubble-row.mine .bubble {
      background: var(--color-primary-50);
      border-color: var(--color-primary-200);
      border-inline-end: 3px solid var(--color-primary-600);
    }

    .bubble-row.theirs .bubble {
      border-inline-start: 3px solid var(--color-neutral-300);
    }

    .bubble header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.35rem 0.5rem;
      font-size: var(--font-size-xs);
      color: var(--color-text-secondary);
    }

    .bubble header strong {
      color: var(--color-text-primary);
      font-size: var(--font-size-sm);
    }

    .bubble time {
      margin-inline-start: auto;
    }

    .chip {
      border-radius: var(--radius-full);
      padding: 0.1rem 0.55rem;
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-semibold);
      background: var(--color-neutral-100);
      color: var(--color-neutral-700);
    }

    .chip[data-category='Question'] {
      background: var(--color-info-50);
      color: var(--color-info-700);
    }

    .chip[data-category='Proposal'] {
      background: color-mix(in srgb, var(--color-teal-500) 16%, var(--color-white));
      color: var(--color-teal-600);
    }

    .chip[data-category='Complaint'] {
      background: var(--color-warning-100);
      color: var(--color-warning-700);
    }

    .chip[data-category='Reply'] {
      background: var(--color-neutral-100);
      color: var(--color-neutral-700);
    }

    .body {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      margin: 0.5rem 0 0;
      color: var(--color-text-primary);
      font-size: var(--font-size-base);
      font-weight: var(--font-weight-normal);
    }

    .attachments,
    .file-chips {
      list-style: none;
      margin: 0.5rem 0 0;
      padding: 0;
    }

    .attachments {
      display: flex;
      flex-direction: column;
      align-items: start;
      gap: 0.35rem;
    }

    .file-link,
    .attach,
    .chip-remove,
    .send {
      font: inherit;
      cursor: pointer;
    }

    .file-link {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      max-width: 100%;
      padding: 0.3rem 0.55rem;
      border: 1px solid var(--color-border-subtle);
      border-radius: var(--radius-md);
      background: var(--color-background-elevated);
      color: var(--color-primary-700);
      font-size: var(--font-size-sm);
      text-align: start;
    }

    .file-link:hover,
    .attach:hover:not(:disabled),
    .chip-remove:hover:not(:disabled) {
      background: var(--color-neutral-50);
    }

    .file-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 16rem;
    }

    .file-size {
      flex-shrink: 0;
      color: var(--color-text-tertiary);
      font-size: var(--font-size-xs);
    }

    .composer {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      min-height: 0;
      max-height: 50%;
      overflow: hidden;
      padding: 0.875rem 1rem;
      background: var(--color-background-elevated);
      border: 1px solid var(--color-border-subtle);
      border-radius: var(--radius-xl);
      box-shadow: var(--shadow-sm);
    }

    .composer-fields {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      min-height: 0;
      overflow-y: auto;
    }

    .field {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      color: var(--color-text-secondary);
    }

    .field-head {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
    }

    .counter {
      margin-inline-start: auto;
      color: var(--color-text-tertiary);
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-normal);
      font-variant-numeric: tabular-nums;
    }

    select,
    textarea {
      width: 100%;
      box-sizing: border-box;
      font: inherit;
      font-weight: var(--font-weight-normal);
      color: var(--color-text-primary);
      background: var(--color-background-elevated);
      border: 1px solid var(--color-border-default);
      border-radius: var(--radius-lg);
      padding: 0.5rem 0.75rem;
    }

    textarea {
      resize: vertical;
      min-height: 4.5rem;
      max-height: 10rem;
    }

    select:focus-visible,
    textarea:focus-visible,
    .send:focus-visible,
    .attach:focus-visible,
    .file-link:focus-visible,
    .chip-remove:focus-visible {
      outline: 3px solid var(--color-primary-500);
      outline-offset: 2px;
    }

    .file-actions {
      position: relative;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem;
    }

    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
      border: 0;
    }

    .attach,
    .chip-remove,
    .send {
      min-height: 2.5rem;
      border-radius: var(--radius-lg);
    }

    .attach,
    .chip-remove {
      padding: 0.35rem 0.85rem;
      border: 1px solid var(--color-border-default);
      background: var(--color-background-elevated);
      color: var(--color-text-primary);
      font-weight: var(--font-weight-medium);
    }

    .hint,
    .files,
    .file-notice {
      margin: 0;
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-normal);
    }

    .hint,
    .files {
      color: var(--color-text-tertiary);
    }

    .file-notice {
      color: var(--color-warning-700);
    }

    .file-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }

    .file-chips li {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      max-width: 100%;
      padding-block: 0.15rem;
      padding-inline: 0.7rem 0.25rem;
      background: var(--color-neutral-100);
      border-radius: var(--radius-full);
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-normal);
      color: var(--color-text-primary);
    }

    .chip-remove {
      min-height: 2rem;
      padding: 0.15rem 0.55rem;
      border-radius: var(--radius-full);
    }

    .composer-actions {
      display: flex;
      flex-shrink: 0;
      justify-content: end;
    }

    .send {
      align-self: end;
      padding: 0.5rem 1.25rem;
      border: 1px solid var(--color-primary-600);
      background: var(--color-primary-600);
      color: var(--color-white);
      font-weight: var(--font-weight-semibold);
    }

    .send:hover:not(:disabled) {
      background: var(--color-primary-700);
      border-color: var(--color-primary-700);
    }

    .send:disabled,
    .attach:disabled,
    .chip-remove:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }

    @media (max-width: 640px) {
      .bubble { max-width: 100%; }
      .attach,
      .send,
      .chip-remove,
      .file-link {
        min-height: 2.75rem;
      }
      .composer-actions {
        padding-inline-end: 4.5rem;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .send,
      .attach,
      .file-link,
      .chip-remove {
        transition: none;
      }
    }
  `]
})
export class AssistancePageComponent implements OnInit, OnDestroy {
  readonly loc_ui_tern_assistance_be6b37 = $localize`:@@ui.tern.assistance.be6b37:Assistance`;
  private readonly support = inject(CompanySupportService);
  private readonly badge = inject(CompanySupportBadgeService);
  private readonly threadEl = viewChild<ElementRef<HTMLElement>>('thread');
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  readonly messages = signal<CompanySupportMessage[]>([]);
  readonly loading = signal(true);
  readonly sending = signal(false);
  readonly error = signal<string | null>(null);
  readonly fileLimitReached = signal(false);

  category: CompanySupportCategory = 'Question';
  body = '';
  files: File[] = [];

  private pollSub: Subscription | null = null;
  private lastSentAt: string | null = null;
  private stickToBottom = true;

  ngOnInit(): void {
    this.support.bootstrap().subscribe({
      next: r => {
        this.loading.set(false);
        if (!r.success || !r.data) {
          this.error.set($localize`:@@assistance.assistance-page.ts.impossible.de.charger.la.conversation.46fe4578:Impossible de charger la conversation.`);
          return;
        }
        this.messages.set(r.data.messages ?? []);
        this.rememberLast();
        this.markRead();
        this.scrollThreadToEnd();
      },
      error: () => {
        this.loading.set(false);
        this.error.set($localize`:@@assistance.assistance-page.ts.impossible.de.charger.la.conversation.46fe4578:Impossible de charger la conversation.`);
      }
    });

    this.pollSub = timer(20_000, 20_000).subscribe(() => {
      if (document.hidden || !this.lastSentAt) return;
      this.support.messagesAfter(this.lastSentAt).subscribe({
        next: r => {
          if (!r.success || !r.data?.length) return;
          const known = new Set(this.messages().map(m => m.id));
          const fresh = r.data.filter(m => !known.has(m.id));
          if (!fresh.length) return;
          this.messages.update(list => [...list, ...fresh]);
          this.rememberLast();
          this.markRead();
          this.scrollThreadToEnd();
        },
        error: () => {}
      });
    });
  }

  ngOnDestroy(): void {
    this.pollSub?.unsubscribe();
  }

  label(category: CompanySupportCategory): string {
    return CATEGORY_LABEL[category] ?? category;
  }

  canSend(): boolean {
    return this.category !== 'Reply' && (this.body.trim().length > 0 || this.files.length > 0);
  }

  onFiles(event: Event): void {
    const input = event.target as HTMLInputElement;
    const selected = Array.from(input.files ?? []);
    this.fileLimitReached.set(selected.length > MAX_ATTACHMENTS);
    this.files = selected.slice(0, MAX_ATTACHMENTS);
  }

  removeFile(index: number): void {
    if (this.sending()) return;
    this.files = this.files.filter((_, i) => i !== index);
    if (!this.files.length) {
      this.fileLimitReached.set(false);
      this.clearFileInput();
    }
  }

  openFilePicker(): void {
    if (this.sending()) return;
    this.fileInput()?.nativeElement.click();
  }

  onThreadScroll(): void {
    const el = this.threadEl()?.nativeElement;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    this.stickToBottom = distance <= NEAR_BOTTOM_PX;
  }

  formatSize(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return '';
    if (bytes < 1024) return `${Math.round(bytes)} o`;
    if (bytes < 1024 * 1024) {
      const value = bytes / 1024;
      return `${value >= 10 ? Math.round(value) : value.toFixed(1)} Ko`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  }

  download(id: string, fileName: string): void {
    this.support.download(id).subscribe({
      next: blob => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.click();
        URL.revokeObjectURL(url);
      },
      error: () => this.error.set($localize`:@@assistance.assistance-page.ts.telechargement.impossible.49e7d29d:Téléchargement impossible.`)
    });
  }

  send(): void {
    if (!this.canSend() || this.sending()) return;
    this.sending.set(true);
    this.error.set(null);
    const requestId = crypto.randomUUID();
    this.support.post(this.category, this.body.trim(), requestId, this.files).subscribe({
      next: r => {
        this.sending.set(false);
        if (!r.success || !r.data) {
          this.error.set(r.message || $localize`:@@assistance.assistance-page.ts.envoi.impossible.87446704:Envoi impossible.`);
          return;
        }
        this.messages.update(list => list.some(m => m.id === r.data.id) ? list : [...list, r.data]);
        this.body = '';
        this.files = [];
        this.fileLimitReached.set(false);
        this.clearFileInput();
        this.rememberLast();
        this.badge.refresh();
        this.scrollThreadToEnd();
      },
      error: () => {
        this.sending.set(false);
        this.error.set($localize`:@@assistance.assistance-page.ts.envoi.impossible.87446704:Envoi impossible.`);
      }
    });
  }

  private clearFileInput(): void {
    const input = this.fileInput()?.nativeElement;
    if (input) input.value = '';
  }

  private scrollThreadToEnd(): void {
    if (!this.stickToBottom) return;
    queueMicrotask(() => {
      const el = this.threadEl()?.nativeElement;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    });
  }

  private rememberLast(): void {
    const list = this.messages();
    this.lastSentAt = list.length ? list[list.length - 1].sentAt : null;
  }

  private markRead(): void {
    const last = this.lastSentAt;
    if (!last) return;
    this.support.markRead(last).subscribe({ next: () => this.badge.refresh(), error: () => {} });
  }
}
