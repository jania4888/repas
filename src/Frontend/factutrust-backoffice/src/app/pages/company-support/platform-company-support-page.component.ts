import { DatePipe } from '@angular/common';
import { Component, DestroyRef, ElementRef, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { PlatformPermission } from '@core/models/platform.models';
import { PlatformPermissionsService } from '@core/services/platform-permissions.service';
import {
  PlatformCompanySupportService,
  PlatformSupportInboxItem,
  PlatformSupportMessage
} from '@core/services/platform-company-support.service';
import { PlatformCompanySupportBadgeService } from '@core/services/platform-company-support-badge.service';
import { FtPageHeaderComponent } from '@core/ui/page-header/ft-page-header.component';
import { EMPTY, Subject, catchError, debounceTime, distinctUntilChanged, map, switchMap } from 'rxjs';

const PAGE_SIZE = 50;

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
  imports: [DatePipe, FormsModule, FtPageHeaderComponent],
  template: `
    <section class="support">
      <ft-page-header
        title="Assistance sociétés"
        subtitle="Conversations des sociétés avec l'équipe plateforme."
      >
        <ng-container ftActions>
          <button type="button" class="ghost" (click)="refresh()">Actualiser</button>
        </ng-container>
      </ft-page-header>

      <div class="layout" [class.thread-open]="threadOpen()">
        <aside class="inbox" [attr.aria-busy]="loadingList()">
          <div class="filters">
            <label class="search-label">
              <span class="sr-only">Rechercher une société</span>
              <input
                type="search"
                name="companySearch"
                maxlength="100"
                autocomplete="off"
                placeholder="Rechercher une société"
                [(ngModel)]="searchText"
                (ngModelChange)="onSearchChange($event)"
              />
            </label>
            <label class="check">
              <input
                type="checkbox"
                name="unreadOnly"
                [ngModel]="unreadOnly()"
                (ngModelChange)="setUnreadOnly($event)"
              />
              Non lues
            </label>
            <label class="category-filter">
              <span class="sr-only">Catégorie</span>
              <select name="category" [ngModel]="category()" (ngModelChange)="setCategory($event)">
                <option value="">Toutes les catégories</option>
                <option value="Question">Question</option>
                <option value="Proposal">Proposition</option>
                <option value="Complaint">Réclamation</option>
                <option value="Reply">Réponse</option>
              </select>
            </label>
          </div>

          @if (listError(); as err) {
            <p class="alert" role="alert">{{ err }}</p>
          }

          <div class="inbox-scroll">
            @if (loadingList() && !items().length) {
              <p class="muted">Chargement des conversations…</p>
            } @else if (!listError() || items().length) {
              @for (item of items(); track item.conversationId) {
                <button
                  type="button"
                  class="inbox-item"
                  [class.active]="item.companyTenantId === selectedId()"
                  [attr.aria-current]="item.companyTenantId === selectedId() ? 'true' : null"
                  (click)="open(item)"
                >
                  <span class="inbox-top">
                    <strong class="company-name">{{ item.companyName }}</strong>
                    @if (item.unreadCount > 0) {
                      <span class="unread">{{ item.unreadCount }}</span>
                    }
                  </span>
                  <span class="inbox-meta">
                    <span class="chip" [attr.data-category]="categoryKey(item.lastMessageCategory)">
                      {{ label(item.lastMessageCategory) }}
                    </span>
                    @if (item.lastMessageAt) {
                      <time [attr.datetime]="item.lastMessageAt">{{ item.lastMessageAt | date: 'dd/MM/yyyy HH:mm' }}</time>
                    }
                  </span>
                  @if (item.lastMessagePreview) {
                    <small class="preview">{{ item.lastMessagePreview }}</small>
                  }
                </button>
              } @empty {
                <p class="muted empty-copy">{{ emptyLabel() }}</p>
              }
            }
          </div>

          @if (showPager()) {
            <footer class="pager">
              <button type="button" (click)="prevPage()" [disabled]="page() <= 1">Précédent</button>
              <span>Page {{ page() }} / {{ pageCount() }}</span>
              <button type="button" class="pager-next" (click)="nextPage()" [disabled]="page() >= pageCount()">Suivant</button>
            </footer>
          }
        </aside>

        <div class="thread">
          @if (!selectedId()) {
            <p class="empty-center">Choisissez une société dans la liste.</p>
          } @else {
            <header class="thread-head">
              <button type="button" class="back" (click)="backToList()">Retour aux sociétés</button>
              <div class="thread-title">
                <strong>{{ headerName() || 'Société' }}</strong>
                @if (headerCategory() !== null && headerCategory() !== undefined && label(headerCategory())) {
                  <span class="chip" [attr.data-category]="categoryKey(headerCategory())">
                    {{ label(headerCategory()) }}
                  </span>
                }
                @if (headerUnread() > 0) {
                  <span class="unread">{{ headerUnread() }} non lu{{ headerUnread() > 1 ? 's' : '' }}</span>
                }
              </div>
            </header>

            @if (threadError(); as err) {
              <p class="alert" role="alert">{{ err }}</p>
            }

            <div #threadScroll class="messages" role="log" (scroll)="onThreadScroll()">
              @if (messages().length === 50) {
                <p class="history-note">50 derniers messages</p>
              }
              @if (loadingThread() && !messages().length) {
                <p class="muted">Chargement de la conversation…</p>
              }
              @for (message of messages(); track message.id) {
                <article
                  class="bubble"
                  [class.platform]="isPlatform(message.authorSide)"
                  [class.company]="!isPlatform(message.authorSide)"
                >
                  <header>
                    <strong>{{ message.authorDisplayName }}</strong>
                    <span class="chip" [attr.data-category]="categoryKey(message.category)">
                      {{ label(message.category) }}
                    </span>
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
                            {{ file.fileName }}
                            <span>({{ formatSize(file.sizeBytes) }})</span>
                          </button>
                        </li>
                      }
                    </ul>
                  }
                </article>
              }
            </div>

            @if (canWrite()) {
              <form class="composer" (ngSubmit)="send()">
                <label for="support-reply">Réponse</label>
                <textarea
                  id="support-reply"
                  name="body"
                  rows="3"
                  maxlength="4000"
                  [(ngModel)]="body"
                  placeholder="Réponse"
                ></textarea>
                <label class="file-field">
                  Fichiers
                  <input #fileInput type="file" multiple (change)="onFiles($event)" />
                </label>
                @if (files.length) {
                  <ul class="file-list">
                    @for (file of files; track $index) {
                      <li>
                        <span>{{ file.name }}</span>
                        <button type="button" (click)="removeFile($index)">Retirer</button>
                      </li>
                    }
                  </ul>
                }
                <button type="submit" class="send" [disabled]="!canSend() || sending()">Répondre</button>
              </form>
            } @else {
              <p class="readonly">Lecture seule</p>
            }
          }
        </div>
      </div>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .support {
      display: flex;
      flex-direction: column;
      height: calc(100dvh - 11rem);
      min-height: 28rem;
      overflow: hidden;
      color: var(--ft-text);
      color-scheme: dark;
    }
    .layout {
      flex: 1;
      min-height: 0;
      display: grid;
      grid-template-columns: minmax(16rem, 22rem) 1fr;
      gap: 1rem;
      overflow: hidden;
    }
    .inbox, .thread {
      min-height: 0;
      display: flex;
      flex-direction: column;
      background: var(--ft-surface);
      color: var(--ft-text);
      border: 1px solid var(--ft-border);
      border-radius: var(--ft-radius);
      overflow: hidden;
    }
    .filters {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      padding: 0.75rem;
      border-bottom: 1px solid var(--ft-border);
    }
    .search-label, .category-filter { display: block; }
    input[type='search'], select, textarea, input[type='file'] {
      width: 100%;
      box-sizing: border-box;
      background: var(--ft-surface-2);
      color: var(--ft-text);
      border: 1px solid var(--ft-border);
      border-radius: var(--ft-radius-sm);
      padding: 0.45rem 0.6rem;
      font: inherit;
    }
    textarea { resize: vertical; }
    .check {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      color: var(--ft-text-muted);
      font-size: 0.9rem;
    }
    .check input { width: auto; accent-color: var(--ft-accent); }
    .inbox-scroll, .messages {
      flex: 1;
      min-height: 0;
      overflow: auto;
    }
    .inbox-scroll {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      padding: 0.75rem;
    }
    .inbox-item, .bubble, .ghost, .pager button, .file-link, .file-list button, .back, .send {
      font: inherit;
    }
    .inbox-item {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      width: 100%;
      text-align: left;
      cursor: pointer;
      color: var(--ft-text);
      background: var(--ft-surface-2);
      border: 1px solid var(--ft-border);
      border-radius: var(--ft-radius-sm);
      padding: 0.65rem 0.75rem;
    }
    .inbox-item:hover { background: var(--ft-hover-surface); }
    .inbox-item.active {
      border-color: var(--ft-accent);
      background: var(--ft-accent-surface);
    }
    .inbox-top, .inbox-meta, .thread-title, .bubble header {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      flex-wrap: wrap;
    }
    .inbox-top { justify-content: space-between; }
    .company-name { font-size: 0.95rem; }
    .inbox-meta, .preview, .muted, .history-note, .readonly, .bubble header {
      color: var(--ft-text-muted);
      font-size: 0.8rem;
    }
    .preview {
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .unread {
      background: #c2410c;
      color: #fff;
      border-radius: var(--ft-radius-pill);
      padding: 0.05rem 0.45rem;
      font-size: 0.75rem;
      font-style: normal;
      font-weight: 650;
    }
    .chip {
      border-radius: var(--ft-radius-pill);
      padding: 0.05rem 0.45rem;
      background: var(--ft-info-surface);
      color: var(--ft-info-text);
      border: 1px solid var(--ft-info-border);
    }
    .chip[data-category='Proposal'] {
      background: var(--ft-accent-surface);
      color: var(--ft-accent);
      border-color: var(--ft-accent-border);
    }
    .chip[data-category='Complaint'] {
      background: var(--ft-warning-surface);
      color: var(--ft-warning-text);
      border-color: var(--ft-warning-border);
    }
    .chip[data-category='Reply'] {
      background: var(--ft-neutral-surface);
      color: var(--ft-neutral-text);
      border-color: var(--ft-neutral-border);
    }
    .pager {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      padding: 0.6rem 0.75rem;
      border-top: 1px solid var(--ft-border);
      color: var(--ft-text-muted);
      font-size: 0.85rem;
    }
    .ghost, .pager button, .back, .file-list button {
      background: transparent;
      color: var(--ft-text);
      border: 1px solid var(--ft-border);
      border-radius: var(--ft-radius-sm);
      padding: 0.35rem 0.7rem;
      cursor: pointer;
    }
    .ghost:hover, .pager button:hover:not(:disabled), .back:hover, .file-list button:hover {
      background: var(--ft-hover-surface);
    }
    .pager button:disabled, .send:disabled { opacity: 0.45; cursor: not-allowed; }
    .thread-head {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 0.5rem;
      padding: 0.75rem 1rem;
      border-bottom: 1px solid var(--ft-border);
    }
    .back { display: none; }
    .empty-center {
      margin: auto;
      color: var(--ft-text-muted);
      padding: 1rem;
    }
    .messages {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      padding: 1rem;
    }
    .history-note, .muted { margin: 0; }
    .bubble {
      max-width: min(36rem, 88%);
      border: 1px solid var(--ft-border);
      border-radius: var(--ft-radius);
      padding: 0.75rem 0.9rem;
      background: var(--ft-surface-3);
      color: var(--ft-text);
    }
    .bubble.company { margin-right: auto; }
    .bubble.platform {
      margin-left: auto;
      background: var(--ft-accent-surface);
    }
    .body {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      margin: 0.45rem 0 0;
      color: var(--ft-text);
    }
    .attachments, .file-list {
      list-style: none;
      margin: 0.45rem 0 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }
    .file-link {
      background: transparent;
      color: var(--ft-accent);
      border: 0;
      padding: 0;
      cursor: pointer;
      text-align: left;
    }
    .composer, .readonly {
      padding: 0.75rem 1rem 1rem;
      border-top: 1px solid var(--ft-border);
    }
    .composer {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .composer label, .file-field { font-size: 0.85rem; color: var(--ft-text-muted); }
    .file-list { margin: 0; }
    .file-list li {
      display: flex;
      justify-content: space-between;
      gap: 0.5rem;
      align-items: center;
      color: var(--ft-text);
    }
    .send {
      align-self: flex-start;
      background: var(--ft-accent);
      color: var(--ft-text-on-accent);
      border: 0;
      border-radius: var(--ft-radius-sm);
      padding: 0.45rem 0.9rem;
      font-weight: 650;
      cursor: pointer;
    }
    .alert {
      margin: 0.75rem 0.75rem 0;
      color: var(--ft-danger-text);
      background: var(--ft-danger-surface);
      border: 1px solid var(--ft-danger-border);
      border-radius: var(--ft-radius-sm);
      padding: 0.5rem 0.75rem;
    }
    .sr-only {
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
    @media (max-width: 800px) {
      .layout { grid-template-columns: 1fr; }
      .layout.thread-open .inbox { display: none; }
      .layout:not(.thread-open) .thread { display: none; }
      .back { display: inline-flex; }
    }
  `]
})
export class PlatformCompanySupportPageComponent implements OnInit {
  private readonly support = inject(PlatformCompanySupportService);
  private readonly permissions = inject(PlatformPermissionsService);
  private readonly badge = inject(PlatformCompanySupportBadgeService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly inboxTick = new Subject<void>();
  private readonly threadTick = new Subject<string>();
  private readonly searchChanges = new Subject<string>();
  private pinnedToBottom = true;

  @ViewChild('threadScroll') private threadScroll?: ElementRef<HTMLElement>;
  @ViewChild('fileInput') private fileInput?: ElementRef<HTMLInputElement>;

  readonly items = signal<PlatformSupportInboxItem[]>([]);
  readonly messages = signal<PlatformSupportMessage[]>([]);
  readonly selectedId = signal<string | null>(null);
  readonly sending = signal(false);
  readonly loadingList = signal(false);
  readonly loadingThread = signal(false);
  readonly listError = signal<string | null>(null);
  readonly threadError = signal<string | null>(null);
  readonly totalCount = signal(0);
  readonly page = signal(1);
  readonly unreadOnly = signal(false);
  readonly category = signal('');
  readonly appliedSearch = signal('');
  readonly threadOpen = signal(false);
  readonly headerName = signal('');
  readonly headerCategory = signal<string | number | null>(null);
  readonly headerUnread = signal(0);
  readonly canWrite = computed(() => this.permissions.has(PlatformPermission.CompanySupportWrite));
  readonly pageCount = computed(() => Math.max(1, Math.ceil(this.totalCount() / PAGE_SIZE)));
  readonly showPager = computed(() => this.totalCount() > PAGE_SIZE);

  searchText = '';
  body = '';
  files: File[] = [];

  ngOnInit(): void {
    this.inboxTick.pipe(
      switchMap(() => {
        this.loadingList.set(true);
        return this.support.inbox(this.inboxQuery()).pipe(
          catchError(() => {
            this.loadingList.set(false);
            this.listError.set('Impossible de charger les conversations.');
            return EMPTY;
          })
        );
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(response => {
      this.loadingList.set(false);
      if (!response.success) {
        this.listError.set('Impossible de charger les conversations.');
        return;
      }
      this.listError.set(null);
      this.items.set(response.data?.items ?? []);
      this.totalCount.set(response.data?.totalCount ?? 0);
    });

    this.searchChanges.pipe(
      debounceTime(300),
      map(value => value.trim().slice(0, 100)),
      distinctUntilChanged(),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(value => {
      this.appliedSearch.set(value);
      this.page.set(1);
      this.inboxTick.next();
    });

    this.threadTick.pipe(
      switchMap(tenantId => {
        this.loadingThread.set(true);
        this.threadError.set(null);
        return this.support.thread(tenantId).pipe(
          map(response => ({ tenantId, response })),
          catchError(() => {
            this.loadingThread.set(false);
            if (this.selectedId() === tenantId) {
              this.threadError.set('Impossible de charger la conversation.');
            }
            return EMPTY;
          })
        );
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(({ tenantId, response }) => {
      if (this.selectedId() !== tenantId) return;
      this.loadingThread.set(false);
      if (!response.success) {
        this.threadError.set('Impossible de charger la conversation.');
        return;
      }
      this.threadError.set(null);
      this.messages.set(response.data?.messages ?? []);
      const last = this.messages().at(-1);
      if (last) this.markConversationRead(tenantId, last.sentAt);
      this.scrollThreadToEnd(true);
    });

    this.inboxTick.next();
  }

  label(category: string | number | null): string {
    if (category === null || category === undefined) return '';
    return CATEGORY_LABEL[String(category)] ?? String(category);
  }

  categoryKey(category: string | number | null): string {
    const raw = String(category ?? '');
    if (raw === '0' || raw === 'Question') return 'Question';
    if (raw === '1' || raw === 'Proposal') return 'Proposal';
    if (raw === '2' || raw === 'Complaint') return 'Complaint';
    if (raw === '3' || raw === 'Reply') return 'Reply';
    return raw;
  }

  isPlatform(side: string | number): boolean {
    return side === 'Platform' || side === 1 || side === '1';
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

  emptyLabel(): string {
    if (this.appliedSearch() || this.unreadOnly() || this.category()) return 'Aucun résultat.';
    return 'Aucune conversation.';
  }

  canSend(): boolean {
    return this.body.trim().length > 0 || this.files.length > 0;
  }

  onSearchChange(value: string): void {
    this.searchChanges.next(value);
  }

  setUnreadOnly(value: boolean): void {
    this.unreadOnly.set(value);
    this.page.set(1);
    this.inboxTick.next();
  }

  setCategory(value: string): void {
    this.category.set(value);
    this.page.set(1);
    this.inboxTick.next();
  }

  refresh(): void {
    this.inboxTick.next();
  }

  prevPage(): void {
    if (this.page() <= 1) return;
    this.page.update(page => page - 1);
    this.inboxTick.next();
  }

  nextPage(): void {
    if (this.page() >= this.pageCount()) return;
    this.page.update(page => page + 1);
    this.inboxTick.next();
  }

  backToList(): void {
    this.threadOpen.set(false);
  }

  onThreadScroll(): void {
    const el = this.threadScroll?.nativeElement;
    if (!el) return;
    this.pinnedToBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 80;
  }

  onFiles(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.files = Array.from(input.files ?? []).slice(0, 5);
  }

  removeFile(index: number): void {
    this.files = this.files.filter((_, i) => i !== index);
    this.clearFileInput();
  }

  open(item: PlatformSupportInboxItem): void {
    this.selectedId.set(item.companyTenantId);
    this.headerName.set(item.companyName);
    this.headerCategory.set(item.lastMessageCategory);
    this.headerUnread.set(item.unreadCount);
    this.threadOpen.set(true);
    this.pinnedToBottom = true;
    this.messages.set([]);
    this.threadTick.next(item.companyTenantId);
  }

  send(): void {
    const tenantId = this.selectedId();
    if (!tenantId || !this.canWrite() || !this.canSend() || this.sending()) return;
    this.sending.set(true);
    this.threadError.set(null);
    const draftFiles = this.files.slice();
    this.support.reply(tenantId, this.body.trim(), crypto.randomUUID(), draftFiles).pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: response => {
        this.sending.set(false);
        if (this.selectedId() !== tenantId) return;
        if (!response.success || !response.data) {
          this.threadError.set('Envoi impossible.');
          return;
        }
        this.messages.update(list => list.some(message => message.id === response.data.id) ? list : [...list, response.data]);
        this.body = '';
        this.files = [];
        this.clearFileInput();
        this.scrollThreadToEnd(this.pinnedToBottom);
      },
      error: () => {
        this.sending.set(false);
        if (this.selectedId() === tenantId) this.threadError.set('Envoi impossible.');
      }
    });
  }

  download(id: string, fileName: string): void {
    this.support.download(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: blob => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = this.safeFileName(fileName);
        link.click();
        URL.revokeObjectURL(url);
      },
      error: () => this.threadError.set('Téléchargement impossible.')
    });
  }

  private inboxQuery() {
    return {
      companyName: this.appliedSearch(),
      unreadOnly: this.unreadOnly(),
      category: this.category(),
      page: this.page(),
      pageSize: PAGE_SIZE
    };
  }

  private markConversationRead(tenantId: string, readAt: string): void {
    if (this.selectedId() !== tenantId) return;
    this.support.markRead(tenantId, readAt).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: response => {
        if (!response.success) return;
        this.items.update(list => list.map(item =>
          item.companyTenantId === tenantId ? { ...item, unreadCount: 0 } : item));
        if (this.selectedId() === tenantId) this.headerUnread.set(0);
        this.badge.refresh();
      },
      error: () => {}
    });
  }

  private scrollThreadToEnd(force: boolean): void {
    setTimeout(() => {
      const el = this.threadScroll?.nativeElement;
      if (!el || (!force && !this.pinnedToBottom)) return;
      el.scrollTop = el.scrollHeight;
      this.pinnedToBottom = true;
    });
  }

  private clearFileInput(): void {
    const input = this.fileInput?.nativeElement;
    if (input) input.value = '';
  }

  private safeFileName(fileName: string): string {
    const base = fileName.split(/[/\\]/).pop() ?? '';
    const cleaned = base.replace(/["'`]/g, '').replace(/[\r\n]/g, '').trim();
    if (!cleaned || cleaned === '.' || cleaned === '..') return 'fichier';
    return cleaned;
  }
}
