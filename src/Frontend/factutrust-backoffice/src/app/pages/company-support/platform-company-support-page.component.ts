import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PlatformPermission } from '@core/models/platform.models';
import { PlatformPermissionsService } from '@core/services/platform-permissions.service';
import {
  PlatformCompanySupportService,
  PlatformSupportInboxItem,
  PlatformSupportMessage
} from '@core/services/platform-company-support.service';
import { PlatformCompanySupportBadgeService } from '@core/services/platform-company-support-badge.service';

const CATEGORY_LABEL: Record<string, string> = {
  Question: 'Question',
  Proposal: 'Proposition',
  Complaint: 'Réclamation',
  Reply: 'Réponse',
  '0': 'Question',
  '1': 'Proposition',
  '2': 'Réclamation',
  '3': 'Réponse'
};

@Component({
  selector: 'app-platform-company-support-page',
  standalone: true,
  imports: [DatePipe, FormsModule],
  template: `
    <section class="support">
      <h1>Assistance sociétés</h1>
      <div class="layout">
        <aside>
          @for (item of items(); track item.conversationId) {
            <button type="button" (click)="open(item)" [class.active]="item.companyTenantId === selectedId()">
              <strong>{{ item.companyName }}</strong>
              <span>{{ label(item.lastMessageCategory) }}</span>
              @if (item.unreadCount > 0) {
                <em>{{ item.unreadCount }}</em>
              }
              <small>{{ item.lastMessagePreview }}</small>
            </button>
          } @empty {
            <p>Aucune conversation.</p>
          }
        </aside>
        <div class="thread">
          @if (!selectedId()) {
            <p>Choisissez une société.</p>
          } @else {
            @for (message of messages(); track message.id) {
              <article>
                <header>
                  <strong>{{ message.authorDisplayName }}</strong>
                  <span>{{ label(message.category) }}</span>
                  <time>{{ message.sentAt | date: 'dd/MM/yyyy HH:mm' }}</time>
                </header>
                <p class="body">{{ message.body }}</p>
                @for (file of message.attachments; track file.id) {
                  <button type="button" (click)="download(file.id, file.fileName)">{{ file.fileName }}</button>
                }
              </article>
            }
            @if (canWrite()) {
              <form (ngSubmit)="send()">
                <textarea name="body" rows="3" maxlength="4000" [(ngModel)]="body" placeholder="Réponse"></textarea>
                <input type="file" multiple (change)="onFiles($event)" />
                <button type="submit" [disabled]="!canSend() || sending()">Répondre</button>
              </form>
            }
          }
        </div>
      </div>
      @if (error()) {
        <p role="alert">{{ error() }}</p>
      }
    </section>
  `,
  styles: [`
    .layout { display: grid; grid-template-columns: 18rem 1fr; gap: 1rem; }
    aside { display: flex; flex-direction: column; gap: 0.5rem; }
    aside button, article { text-align: left; border: 1px solid #e5e7eb; border-radius: 0.5rem; padding: 0.6rem; background: #fff; }
    aside button.active { border-color: #c2410c; }
    .body { white-space: pre-wrap; }
    form { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 1rem; }
    @media (max-width: 800px) { .layout { grid-template-columns: 1fr; } }
  `]
})
export class PlatformCompanySupportPageComponent implements OnInit {
  private readonly support = inject(PlatformCompanySupportService);
  private readonly permissions = inject(PlatformPermissionsService);
  private readonly badge = inject(PlatformCompanySupportBadgeService);

  readonly items = signal<PlatformSupportInboxItem[]>([]);
  readonly messages = signal<PlatformSupportMessage[]>([]);
  readonly selectedId = signal<string | null>(null);
  readonly sending = signal(false);
  readonly error = signal<string | null>(null);
  readonly canWrite = computed(() => this.permissions.has(PlatformPermission.CompanySupportWrite));

  body = '';
  files: File[] = [];

  ngOnInit(): void {
    this.support.inbox().subscribe({
      next: r => {
        if (r.success) this.items.set(r.data?.items ?? []);
      },
      error: () => this.error.set('Impossible de charger les conversations.')
    });
  }

  label(category: string | number | null): string {
    if (category === null || category === undefined) return '';
    return CATEGORY_LABEL[String(category)] ?? String(category);
  }

  canSend(): boolean {
    return this.body.trim().length > 0 || this.files.length > 0;
  }

  onFiles(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.files = Array.from(input.files ?? []).slice(0, 5);
  }

  open(item: PlatformSupportInboxItem): void {
    this.selectedId.set(item.companyTenantId);
    this.support.thread(item.companyTenantId).subscribe({
      next: r => {
        if (!r.success) return;
        this.messages.set(r.data?.messages ?? []);
        const last = this.messages().at(-1);
        if (last) {
          this.support.markRead(item.companyTenantId, last.sentAt).subscribe({
            next: () => this.badge.refresh(),
            error: () => {}
          });
        }
      },
      error: () => this.error.set('Impossible de charger la conversation.')
    });
  }

  send(): void {
    const tenantId = this.selectedId();
    if (!tenantId || !this.canWrite() || !this.canSend() || this.sending()) return;
    this.sending.set(true);
    this.support.reply(tenantId, this.body.trim(), crypto.randomUUID(), this.files).subscribe({
      next: r => {
        this.sending.set(false);
        if (!r.success || !r.data) {
          this.error.set('Envoi impossible.');
          return;
        }
        this.messages.update(list => [...list, r.data]);
        this.body = '';
        this.files = [];
      },
      error: () => {
        this.sending.set(false);
        this.error.set('Envoi impossible.');
      }
    });
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
}
