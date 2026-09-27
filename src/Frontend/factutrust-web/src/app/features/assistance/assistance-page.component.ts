import { DatePipe } from '@angular/common';
import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription, timer } from 'rxjs';
import {
  CompanySupportCategory,
  CompanySupportMessage,
  CompanySupportService
} from '@core/services/company-support.service';
import { CompanySupportBadgeService } from '@core/services/company-support-badge.service';

const CATEGORY_LABEL: Record<CompanySupportCategory, string> = {
  Question: 'Question',
  Proposal: 'Proposition',
  Complaint: 'Réclamation',
  Reply: 'Réponse'
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

      <div class="assist-thread" role="log" aria-live="polite">
        @if (!loading() && messages().length === 0) {
          <p class="assist-empty" i18n="@@assistance.assistance-page.aucun.message.posez.une.question.envoyez.une.pro.0dad613d">Aucun message. Posez une question, envoyez une proposition ou une réclamation.</p>
        }
        @for (message of messages(); track message.id) {
          <article class="bubble" [class.mine]="message.authorSide === 'Company'" [class.theirs]="message.authorSide === 'Platform'">
            <header>
              <strong>{{ message.authorSide === 'Platform' ? loc_ui_tern_assistance_be6b37 : message.authorDisplayName }}</strong>
              <span class="chip">{{ label(message.category) }}</span>
              <time>{{ message.sentAt | date: 'dd/MM/yyyy HH:mm' }}</time>
            </header>
            @if (message.body) {
              <p class="body">{{ message.body }}</p>
            }
            @if (message.attachments.length) {
              <ul>
                @for (file of message.attachments; track file.id) {
                  <li><button type="button" (click)="download(file.id, file.fileName)">{{ file.fileName }}</button></li>
                }
              </ul>
            }
          </article>
        }
      </div>

      <form class="composer" (ngSubmit)="send()">
        <label>
          <ng-container i18n="@@assistance.assistance-page.type.3deb7456"> Type </ng-container>
          <select name="category" [(ngModel)]="category" required>
            <option value="Question" i18n="@@assistance.assistance-page.question.002ff598">Question</option>
            <option value="Proposal" i18n="@@assistance.assistance-page.proposition.3e2cf2d2">Proposition</option>
            <option value="Complaint" i18n="@@assistance.assistance-page.reclamation.33d37f8b">Réclamation</option>
          </select>
        </label>
        <label class="grow">
          <ng-container i18n="@@assistance.assistance-page.message.68f4145f"> Message </ng-container>
          <textarea name="body" rows="3" maxlength="4000" [(ngModel)]="body" placeholder="Votre message" i18n-placeholder="@@assistance.assistance-page.votre.message.65d92a68"></textarea>
        </label>
        <label>
          <ng-container i18n="@@assistance.assistance-page.fichiers.23a9d9fc"> Fichiers </ng-container>
          <input type="file" multiple (change)="onFiles($event)" />
        </label>
        @if (files.length) {
          <p class="files">{{ files.length }} fichier(s) sélectionné(s)</p>
        }
        <button type="submit" [disabled]="!canSend() || sending()" i18n="@@assistance.assistance-page.envoyer.e9ce243b">Envoyer</button>
      </form>
    </section>
  `,
  styles: [`
    .assist { display: flex; flex-direction: column; gap: 1rem; max-width: 52rem; margin: 0 auto; }
    .assist-head h1 { margin: 0 0 0.25rem; }
    .assist-head p, .assist-empty { color: #4b5563; }
    .assist-error { color: #991b1b; }
    .assist-thread { display: flex; flex-direction: column; gap: 0.75rem; min-height: 16rem; }
    .bubble { border: 1px solid #e5e7eb; border-radius: 0.75rem; padding: 0.75rem 1rem; background: #fff; }
    .bubble.mine { margin-left: 2rem; }
    .bubble.theirs { margin-right: 2rem; background: #f8fafc; }
    .bubble header { display: flex; gap: 0.5rem; align-items: baseline; flex-wrap: wrap; font-size: 0.85rem; }
    .chip { background: #eef2ff; color: #3730a3; border-radius: 999px; padding: 0.1rem 0.5rem; }
    .body { white-space: pre-wrap; margin: 0.5rem 0 0; }
    .composer { display: flex; flex-direction: column; gap: 0.5rem; }
    .composer button { align-self: flex-start; }
    textarea, select { width: 100%; }
  `]
})
export class AssistancePageComponent implements OnInit, OnDestroy {
  readonly loc_ui_tern_assistance_be6b37 = $localize`:@@ui.tern.assistance.be6b37:Assistance`;
  private readonly support = inject(CompanySupportService);
  private readonly badge = inject(CompanySupportBadgeService);

  readonly messages = signal<CompanySupportMessage[]>([]);
  readonly loading = signal(true);
  readonly sending = signal(false);
  readonly error = signal<string | null>(null);

  category: CompanySupportCategory = 'Question';
  body = '';
  files: File[] = [];

  private pollSub: Subscription | null = null;
  private lastSentAt: string | null = null;

  ngOnInit(): void {
    this.support.bootstrap().subscribe({
      next: r => {
        this.loading.set(false);
        if (!r.success || !r.data) {
          this.error.set('Impossible de charger la conversation.');
          return;
        }
        this.messages.set(r.data.messages ?? []);
        this.rememberLast();
        this.markRead();
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Impossible de charger la conversation.');
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
    this.files = Array.from(input.files ?? []).slice(0, 5);
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
      error: () => this.error.set('Téléchargement impossible.')
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
          this.error.set(r.message || 'Envoi impossible.');
          return;
        }
        this.messages.update(list => list.some(m => m.id === r.data.id) ? list : [...list, r.data]);
        this.body = '';
        this.files = [];
        this.rememberLast();
        this.badge.refresh();
      },
      error: () => {
        this.sending.set(false);
        this.error.set('Envoi impossible.');
      }
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
