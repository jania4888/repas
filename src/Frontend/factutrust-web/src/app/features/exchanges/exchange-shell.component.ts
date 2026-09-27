/// <reference types="@angular/localize" />
import {
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, combineLatest, forkJoin, of, timer, EMPTY, TimeoutError } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, map, switchMap, timeout } from 'rxjs/operators';
import { AuthService } from '@core/services/auth.service';
import { erpCollatorCompare } from '@core/i18n/erp-format';
import { ExchangeBadgeService } from '@core/services/exchange-badge.service';
import {
  ExchangeAuditEvent,
  ExchangeBootstrap,
  ExchangeDocument,
  ExchangeMessage,
  ExchangeRequest,
  ExchangeService,
  ExchangeTask,
  ExchangeTaskStatus,
  ExchangeThreadDetail,
  ExchangeThreadListItem,
  FirmClientDossierLite,
  PagedExchangeMessages
} from '@core/services/exchange.service';
import { FirmAssignmentService, FirmClientDossier } from '@core/services/firm-assignment.service';
import {
  isActiveAssignment,
  isPendingAssignment
} from '@features/settings/accounting-firm/firm-assignment-status';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { StatusBadgeComponent } from '@shared/components/status-badge/status-badge.component';
import { ToastService } from '@core/services/toast.service';
import { environment } from '@environments/environment';
import { ExchangeRequestsPanelComponent } from './exchange-requests-panel.component';
import {
  auditEventLabel,
  canCompleteTask,
  documentIconClass,
  initialsFromName,
  isInternalNote,
  isThreadClosed,
  isThreadOpen,
  messageDayKey,
  messageDayLabel,
  participantRoleLabel,
  taskStatusBadge,
  taskStatusLabel as taskStatusLabelFn,
  threadStatusBadge,
  threadStatusLabel
} from './exchange-status';
import { EXCHANGE_TABS, ExchangeTabKey, parseExchangeTab } from './exchange-tabs';

const MESSAGE_PAGE_SIZE = 50;
const BADGE_REFRESH_DEBOUNCE_MS = 5000;
const BOOTSTRAP_TIMEOUT_MS = 30_000;

export interface FirmCompanyRow {
  assignmentId: string;
  companyTenantId: string;
  companyName: string;
  threadId?: string;
  status: number | string;
  lastActivityAt?: string;
  unreadCount: number;
}

export interface MessageFeedItem {
  kind: 'day' | 'message';
  dayLabel?: string;
  message?: ExchangeMessage;
}

@Component({
  selector: 'app-exchange-shell',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    EmptyStateComponent,
    ButtonComponent,
    StatusBadgeComponent,
    ExchangeRequestsPanelComponent
  ],
  templateUrl: './exchange-shell.component.html',
  styleUrl: './exchange-shell.component.scss'
})
export class ExchangeShellComponent implements OnInit, OnDestroy {
  private readonly exchange = inject(ExchangeService);
  private readonly badge = inject(ExchangeBadgeService);
  private readonly toast = inject(ToastService);
  readonly auth = inject(AuthService);
  private readonly assignments = inject(FirmAssignmentService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly tabs = EXCHANGE_TABS;
  readonly isFirm = computed(() => this.auth.isAccountingFirm());
  readonly canClose = computed(() => {
    const role = this.auth.user()?.role;
    return role === 'Administrator' || role === 'FirmManager';
  });
  readonly canInternalNote = computed(() => this.isFirm());

  readonly threads = signal<ExchangeThreadListItem[]>([]);
  readonly firmCompanies = signal<FirmCompanyRow[]>([]);
  readonly activeThread = signal<ExchangeThreadDetail | null>(null);
  readonly messages = signal<ExchangeMessage[]>([]);
  readonly requests = signal<ExchangeRequest[]>([]);
  readonly tasks = signal<ExchangeTask[]>([]);
  readonly documents = signal<ExchangeDocument[]>([]);
  readonly history = signal<ExchangeAuditEvent[]>([]);
  readonly loading = signal(false);
  readonly contentLoading = signal(false);
  readonly sending = signal(false);
  readonly error = signal<string | null>(null);
  readonly emptyHint = signal<string | null>(null);
  readonly activeTab = signal<ExchangeTabKey>('conversation');
  readonly composerMode = signal<'message' | 'note'>('message');
  readonly draft = signal('');
  readonly pendingFiles = signal<File[]>([]);
  readonly search = signal('');
  readonly showNewRequest = signal(false);
  readonly showNewTask = signal(false);
  readonly selectedRequestId = signal<string | null>(null);
  readonly newTaskTitle = signal('');
  readonly newTaskDue = signal('');
  readonly messagesHasMore = signal(false);
  readonly loadingOlder = signal(false);

  readonly filteredFirmCompanies = computed(() => {
    const q = this.search().trim().toLowerCase();
    const list = this.firmCompanies();
    if (!q) return list;
    return list.filter(c => c.companyName.toLowerCase().includes(q));
  });

  readonly messageFeed = computed((): MessageFeedItem[] => {
    const items: MessageFeedItem[] = [];
    let lastDay: string | null = null;
    for (const m of this.messages()) {
      const key = messageDayKey(m.sentAt);
      if (key !== lastDay) {
        items.push({ kind: 'day', dayLabel: messageDayLabel(m.sentAt) });
        lastDay = key;
      }
      items.push({ kind: 'message', message: m });
    }
    return items;
  });

  readonly recentDocuments = computed(() => this.documents().slice(0, 5));

  private pollSub: Subscription | null = null;
  private navigationSub: Subscription | null = null;
  private requestQuerySub: Subscription | null = null;
  private inFlightBootstrapSub: Subscription | null = null;
  private badgeRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private lastBootstrappedThreadId: string | null | undefined = undefined;

  ngOnInit(): void {
    // Fusionne paramMap + queryParamMap : à l'init, les deux flux émettent leur valeur
    // initiale de manière synchrone. Sans le debounceTime(0), on déclencherait DEUX
    // bootstrap consécutifs (thread, puis tab) — cause identifiée de la concurrence
    // DbContext observée sur /api/exchanges/bootstrap. distinctUntilChanged sur le tuple
    // absorbe aussi les ré-émissions bruit de fond du router (queryParamsHandling: preserve).
    this.navigationSub = combineLatest([this.route.paramMap, this.route.queryParamMap])
      .pipe(
        debounceTime(0),
        map(([params, query]) => ({
          threadId: params.get('threadId'),
          tab: parseExchangeTab(query.get('tab'))
        })),
        distinctUntilChanged((a, b) => a.threadId === b.threadId && a.tab === b.tab)
      )
      .subscribe(({ threadId, tab }) => {
        // Toute navigation annule le bootstrap en cours (équivalent switchMap sur la
        // sous-chaîne d'appels HTTP internes). La réponse tardive du précédent bootstrap
        // ne sera plus appliquée à l'état du composant.
        this.inFlightBootstrapSub?.unsubscribe();
        this.inFlightBootstrapSub = null;

        if (tab !== this.activeTab()) {
          this.activeTab.set(tab);
        }

        const threadChanged = threadId !== this.lastBootstrappedThreadId;
        if (threadChanged) {
          this.selectedRequestId.set(null);
          this.bootstrap(threadId);
          return;
        }

        // Pur changement d'onglet : ne surtout pas re-bootstrapper (source de doublons),
        // se contenter de charger les données de l'onglet si un thread est déjà actif.
        const resolvedThreadId = this.activeThread()?.id ?? threadId;
        if (resolvedThreadId && tab !== 'conversation') {
          this.loadTabData(resolvedThreadId, tab);
        }
      });

    this.requestQuerySub = this.route.queryParamMap
      .pipe(
        map(query => query.get('requestId')),
        distinctUntilChanged()
      )
      .subscribe(id => this.selectedRequestId.set(id));
  }

  ngOnDestroy(): void {
    this.pollSub?.unsubscribe();
    this.navigationSub?.unsubscribe();
    this.requestQuerySub?.unsubscribe();
    this.inFlightBootstrapSub?.unsubscribe();
    if (this.badgeRefreshTimer) clearTimeout(this.badgeRefreshTimer);
  }

  isOpen = isThreadOpen;
  isClosed = isThreadClosed;
  isNote = isInternalNote;
  canFinishTask = canCompleteTask;
  statusLabel = threadStatusLabel;
  initials = initialsFromName;
  auditEventLabel = auditEventLabel;
  roleLabel = participantRoleLabel;
  taskBadge = taskStatusBadge;
  threadBadge = threadStatusBadge;
  docIcon = documentIconClass;

  selectThread(threadId: string): void {
    const base = this.isFirm() ? '/firm/exchanges' : '/exchanges';
    void this.router.navigate([base, threadId], {
      queryParamsHandling: 'preserve'
    });
  }

  openFirmCompany(row: FirmCompanyRow): void {
    if (row.threadId) {
      this.selectThread(row.threadId);
      return;
    }
    this.loading.set(true);
    this.exchange.ensureThread(row.assignmentId).subscribe({
      next: eRes => {
        if (!eRes.success) {
          this.loading.set(false);
          this.error.set(eRes.message || 'Impossible de créer l’échange');
          return;
        }
        this.selectThread(eRes.data.id);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Impossible de créer l’échange');
      }
    });
  }

  onFirmCompanySelect(assignmentId: string): void {
    const row = this.firmCompanies().find(c => c.assignmentId === assignmentId);
    if (row) this.openFirmCompany(row);
  }

  setTab(tab: ExchangeTabKey): void {
    this.activeTab.set(tab);
    const base = this.isFirm() ? '/firm/exchanges' : '/exchanges';
    const threadId = this.activeThread()?.id;
    const commands = threadId ? [base, threadId] : [base];

    if (tab === 'conversation') {
      void this.router.navigate(commands, {
        queryParams: { tab: null, requestId: null },
        queryParamsHandling: 'merge'
      });
    } else if (tab === 'demandes') {
      void this.router.navigate(commands, {
        queryParams: { tab },
        queryParamsHandling: 'merge'
      });
    } else {
      void this.router.navigate(commands, {
        queryParams: { tab, requestId: null },
        queryParamsHandling: 'merge'
      });
    }

    if (threadId) this.loadTabData(threadId, tab);
  }

  send(): void {
    const thread = this.activeThread();
    const body = this.draft().trim();
    const files = this.pendingFiles();
    if (!thread || (!body && files.length === 0) || this.sending()) return;
    if (!isThreadOpen(thread.status)) return;

    const visibility =
      this.composerMode() === 'note' && this.canInternalNote() ? 'InternalNote' : 'ClientVisible';
    const text = body || (files.length ? $localize`:@@ui.tern.piece.jointe.882014:(Pièce jointe)` : '');
    this.sending.set(true);
    this.error.set(null);

    this.exchange.sendMessage(thread.id, text, visibility).subscribe({
      next: r => {
        if (!r.success) {
          this.sending.set(false);
          this.error.set(r.message || 'Envoi impossible');
          return;
        }
        const messageId = r.data.id;
        this.draft.set('');
        const toUpload = [...files];
        this.pendingFiles.set([]);

        if (toUpload.length === 0) {
          this.messages.update(m => [...m, r.data]);
          this.sending.set(false);
          this.badge.invalidate();
          return;
        }

        let remaining = toUpload.length;
        const attachments: ExchangeDocument[] = [];
        for (const file of toUpload) {
          this.exchange.uploadDocument(thread.id, file, messageId).subscribe({
            next: up => {
              if (up.success) attachments.push(up.data);
              remaining--;
              if (remaining === 0) {
                this.messages.update(m => [
                  ...m,
                  { ...r.data, attachments: [...(r.data.attachments ?? []), ...attachments] }
                ]);
                this.documents.update(d => [...attachments, ...d]);
                this.sending.set(false);
                this.badge.invalidate();
              }
            },
            error: () => {
              remaining--;
              if (remaining === 0) {
                this.messages.update(m => [...m, r.data]);
                this.sending.set(false);
                this.error.set('Message envoyé, mais une pièce jointe a échoué');
                this.badge.invalidate();
              }
            }
          });
        }
      },
      error: () => {
        this.sending.set(false);
        this.error.set('Envoi impossible');
      }
    });
  }

  onComposerFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.pendingFiles.update(list => [...list, file]);
    input.value = '';
  }

  removePendingFile(index: number): void {
    this.pendingFiles.update(list => list.filter((_, i) => i !== index));
  }

  onShareDocumentSelected(event: Event): void {
    const thread = this.activeThread();
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!thread || !file) return;
    this.exchange.uploadDocument(thread.id, file).subscribe({
      next: r => {
        if (r.success) {
          this.documents.update(d => [r.data, ...d]);
          this.setTab('documents');
        } else {
          this.error.set(r.message || 'Upload impossible');
        }
        input.value = '';
      },
      error: () => {
        this.error.set('Upload impossible');
        input.value = '';
      }
    });
  }

  downloadDoc(doc: ExchangeDocument): void {
    const thread = this.activeThread();
    if (!thread) return;
    this.exchange.downloadDocument(thread.id, doc.id).subscribe({
      next: blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = doc.fileName;
        a.click();
        URL.revokeObjectURL(url);
      }
    });
  }

  onRequestCreated(req: ExchangeRequest): void {
    this.requests.update(list => [req, ...list]);
    this.badge.invalidate();
  }

  onRequestUpdated(req: ExchangeRequest): void {
    this.requests.update(list => list.map(x => (x.id === req.id ? req : x)));
    this.badge.invalidate();
  }

  onRequestDocumentUploaded(doc: ExchangeDocument): void {
    this.documents.update(list => [doc, ...list]);
  }

  selectRequest(id: string | null): void {
    const base = this.isFirm() ? '/firm/exchanges' : '/exchanges';
    const threadId = this.activeThread()?.id;
    const commands = threadId ? [base, threadId] : [base];
    void this.router.navigate(commands, {
      queryParams: { requestId: id },
      queryParamsHandling: 'merge'
    });
  }

  createTask(asAppointment = false): void {
    const thread = this.activeThread();
    const title = this.newTaskTitle().trim() || (asAppointment ? $localize`:@@ui.tern.rendez.vous.59342b:Rendez-vous` : '');
    if (!thread || !title) return;
    this.exchange
      .createTask(thread.id, {
        title,
        dueDate: this.newTaskDue() || undefined
      })
      .subscribe({
        next: r => {
          if (r.success) {
            this.tasks.update(list => [r.data, ...list]);
            this.showNewTask.set(false);
            this.newTaskTitle.set('');
            this.newTaskDue.set('');
            this.setTab('taches');
          }
        }
      });
  }

  changeTaskStatus(task: ExchangeTask, status: ExchangeTaskStatus): void {
    const thread = this.activeThread();
    if (!thread) return;
    this.exchange.changeTaskStatus(thread.id, task.id, status).subscribe({
      next: r => {
        if (r.success) {
          this.tasks.update(list => list.map(x => (x.id === task.id ? r.data : x)));
        }
      }
    });
  }

  closeExchange(): void {
    const thread = this.activeThread();
    if (!thread || !this.canClose()) return;
    this.exchange.closeThread(thread.id).subscribe({
      next: r => {
        if (r.success) this.reloadActive(thread.id);
      }
    });
  }

  reopenExchange(): void {
    const thread = this.activeThread();
    if (!thread || !this.canClose()) return;
    this.exchange.reopenThread(thread.id).subscribe({
      next: r => {
        if (r.success) this.reloadActive(thread.id);
      }
    });
  }

  formatBytes(n: number): string {
    if (n < 1024) return `${n} o`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`;
    return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
  }

  taskStatusLabel(s: ExchangeTaskStatus): string {
    return taskStatusLabelFn(s);
  }

  isTaskOverdue(task: ExchangeTask): boolean {
    if (!task.dueDate || !canCompleteTask(task.status)) return false;
    const due = new Date(task.dueDate);
    if (Number.isNaN(due.getTime())) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return due < today;
  }

  feedTrackKey(item: MessageFeedItem, index: number): string {
    if (item.kind === 'day') return `day-${item.dayLabel}-${index}`;
    return item.message?.id ?? `msg-${index}`;
  }

  loadOlderMessages(): void {
    const threadId = this.activeThread()?.id;
    const oldest = this.messages()[0]?.sentAt;
    if (!threadId || !oldest || this.loadingOlder() || !this.messagesHasMore()) return;

    this.loadingOlder.set(true);
    this.exchange.getMessages(threadId, { before: oldest, limit: MESSAGE_PAGE_SIZE }).subscribe({
      next: r => {
        this.loadingOlder.set(false);
        if (!r.success) return;
        const page = r.data;
        this.messagesHasMore.set(!!page.hasMore);
        const older = page.items ?? [];
        if (older.length === 0) {
          this.messagesHasMore.set(false);
          return;
        }
        const existingIds = new Set(this.messages().map(m => m.id));
        const merged = [...older.filter(m => !existingIds.has(m.id)), ...this.messages()];
        this.messages.set(merged);
      },
      error: () => this.loadingOlder.set(false)
    });
  }

  private bootstrap(threadId: string | null): void {
    // Idempotence : même thread déjà chargé avec succès → skip. Le flux navigation
    // fusionné garantit qu'on ne re-bootstrap plus pour du bruit route (queryParams,
    // navigations preserve). La garde suppressNextBootstrap n'est plus nécessaire.
    if (threadId === this.lastBootstrappedThreadId && this.activeThread()?.id === threadId) {
      return;
    }
    this.lastBootstrappedThreadId = threadId;

    this.loading.set(true);
    this.contentLoading.set(true);
    this.error.set(null);
    this.emptyHint.set(null);
    this.perfMark('exchange.bootstrap.start');

    if (environment.featureFlags?.exchangeBootstrapV2) {
      this.bootstrapV2(threadId);
      return;
    }

    if (this.isFirm()) {
      this.bootstrapFirmLegacy(threadId);
      return;
    }

    this.bootstrapCompanyLegacy(threadId);
  }

  private bootstrapV2(threadId: string | null): void {
    const tab = this.activeTab();
    this.inFlightBootstrapSub?.unsubscribe();
    this.inFlightBootstrapSub = this.exchange
      .getBootstrap(threadId, tab === 'conversation' ? null : tab)
      .pipe(
        timeout(BOOTSTRAP_TIMEOUT_MS),
        catchError(err => {
          const timedOut = err instanceof TimeoutError || err?.name === 'TimeoutError';
          this.loading.set(false);
          this.contentLoading.set(false);
          this.error.set(
            timedOut
              ? $localize`:@@ui.tern.le.chargement.prend.plus.de.temps.que.prev.72d1a5:Le chargement prend plus de temps que prévu. Réessayez.`
              : $localize`:@@ui.tern.impossible.de.charger.les.echanges.41f2d1:Impossible de charger les échanges`
          );
          return EMPTY;
        })
      )
      .subscribe({
        next: res => {
          if (!res.success) {
            this.loading.set(false);
            this.contentLoading.set(false);
            this.error.set(res.message || 'Impossible de charger les échanges');
            return;
          }
          this.applyBootstrap(res.data, threadId);
        }
      });
  }

  /** Relance le bootstrap après timeout / erreur réseau. */
  retryBootstrap(): void {
    this.error.set(null);
    this.emptyHint.set(null);
    this.lastBootstrappedThreadId = undefined;
    const threadId = this.route.snapshot.paramMap.get('threadId');
    this.bootstrap(threadId);
  }

  private applyBootstrap(data: ExchangeBootstrap, requestedThreadId: string | null): void {
    if (data.emptyHint) {
      this.loading.set(false);
      this.contentLoading.set(false);
      this.emptyHint.set(data.emptyHint);
      return;
    }

    const threadList = data.threads ?? [];
    this.threads.set(threadList);

    if (this.isFirm()) {
      const clients = (data.firmClients ?? []) as FirmClientDossierLite[];
      this.firmCompanies.set(this.mergeFirmCompanies(clients, threadList));
    }

    const active = data.activeThread ?? null;
    if (!active) {
      this.loading.set(false);
      this.contentLoading.set(false);
      this.emptyHint.set(data.emptyHint || 'Aucun échange disponible.');
      return;
    }

    this.activeThread.set(active);
    this.perfMark('exchange.thread.ready');
    this.applyPagedMessages(data.messages ?? null);
    if (data.requests) this.requests.set(data.requests);
    if (data.tasks) this.tasks.set(data.tasks);
    if (data.documents) this.documents.set(data.documents);
    if (data.history) this.history.set(data.history);

    this.syncCanonicalUrl(active.id, requestedThreadId);
    this.loading.set(false);
    this.contentLoading.set(false);
    this.perfMark('exchange.messages.ready');
    this.perfMark('exchange.tti');
    this.deferMarkUnread(active.id);
    this.startPolling(active.id);
    this.deferBadgeRefresh();
  }

  private bootstrapFirmLegacy(threadId: string | null): void {
    this.inFlightBootstrapSub?.unsubscribe();
    this.inFlightBootstrapSub = forkJoin({
      threads: this.exchange.listThreads().pipe(
        catchError(() => of({ success: false, data: [] as ExchangeThreadListItem[], message: null, errors: [] as string[] }))
      ),
      clients: this.assignments.getActiveClients().pipe(
        catchError(() => of({ success: false, data: [] as FirmClientDossier[], message: null, errors: [] as string[] }))
      )
    }).subscribe({
      next: res => {
        const threadList = res.threads.success ? res.threads.data : [];
        const clients = res.clients.success ? res.clients.data : [];
        this.threads.set(threadList);
        this.firmCompanies.set(this.mergeFirmCompanies(clients, threadList));

        if (clients.length === 0 && threadList.length === 0) {
          this.loading.set(false);
          this.contentLoading.set(false);
          this.emptyHint.set('Aucun dossier client actif pour démarrer un échange.');
          return;
        }

        if (threadId) {
          this.reloadActive(threadId);
          return;
        }

        const firstWithThread = this.firmCompanies().find(c => c.threadId);
        if (firstWithThread?.threadId) {
          this.syncCanonicalUrl(firstWithThread.threadId, null);
          this.reloadActive(firstWithThread.threadId);
          return;
        }

        const first = this.firmCompanies()[0];
        if (first) {
          this.openFirmCompany(first);
        } else {
          this.loading.set(false);
          this.contentLoading.set(false);
        }
      },
      error: () => {
        this.loading.set(false);
        this.contentLoading.set(false);
        this.error.set('Impossible de charger les échanges');
      }
    });
  }

  private mergeFirmCompanies(
    clients: Array<FirmClientDossier | FirmClientDossierLite>,
    threadList: ExchangeThreadListItem[]
  ): FirmCompanyRow[] {
    const byAssignment = new Map(threadList.map(t => [t.firmClientAssignmentId, t]));
    const rows: FirmCompanyRow[] = clients.map(c => {
      const t = byAssignment.get(c.assignmentId);
      return {
        assignmentId: c.assignmentId,
        companyTenantId: c.companyTenantId,
        companyName: c.companyName,
        threadId: t?.id,
        status: t?.status ?? 'Open',
        lastActivityAt: t?.lastActivityAt,
        unreadCount: t?.unreadCount ?? 0
      };
    });

    for (const t of threadList) {
      if (!rows.some(r => r.assignmentId === t.firmClientAssignmentId)) {
        rows.push({
          assignmentId: t.firmClientAssignmentId,
          companyTenantId: t.companyTenantId,
          companyName: t.counterpartName,
          threadId: t.id,
          status: t.status,
          lastActivityAt: t.lastActivityAt,
          unreadCount: t.unreadCount
        });
      }
    }

    return rows.sort((a, b) => erpCollatorCompare(a.companyName, b.companyName));
  }

  private bootstrapCompanyLegacy(threadId: string | null): void {
    this.inFlightBootstrapSub?.unsubscribe();
    this.inFlightBootstrapSub = this.assignments.getCompanyCurrent().subscribe({
      next: aRes => {
        const assignment = aRes.success ? aRes.data : null;
        if (!assignment) {
          this.loading.set(false);
          this.contentLoading.set(false);
          this.emptyHint.set(
            'Liez un cabinet comptable dans Paramètres → Cabinet comptable pour ouvrir les échanges.'
          );
          return;
        }
        if (isPendingAssignment(assignment.status)) {
          this.loading.set(false);
          this.contentLoading.set(false);
          this.emptyHint.set(
            'Votre demande de liaison est en attente d’acceptation par le cabinet.'
          );
          return;
        }
        if (!isActiveAssignment(assignment.status)) {
          this.loading.set(false);
          this.contentLoading.set(false);
          this.emptyHint.set(
            'Liez un cabinet comptable dans Paramètres → Cabinet comptable pour ouvrir les échanges.'
          );
          return;
        }
        this.exchange.ensureThread().subscribe({
          next: eRes => {
            if (!eRes.success) {
              this.loading.set(false);
              this.contentLoading.set(false);
              this.error.set(eRes.message || 'Impossible d’ouvrir l’échange');
              return;
            }
            this.activeThread.set(eRes.data);
            this.perfMark('exchange.thread.ready');
            this.syncCanonicalUrl(eRes.data.id, threadId);
            this.loadThreadContent(eRes.data.id);
          },
          error: () => {
            this.loading.set(false);
            this.contentLoading.set(false);
            this.error.set('Impossible d’ouvrir l’échange');
          }
        });
      },
      error: () => {
        this.loading.set(false);
        this.contentLoading.set(false);
        this.emptyHint.set('Impossible de vérifier la liaison cabinet.');
      }
    });
  }

  private reloadActive(threadId: string): void {
    this.loading.set(true);
    this.contentLoading.set(true);
    this.exchange.getThread(threadId).subscribe({
      next: r => {
        if (!r.success) {
          this.loading.set(false);
          this.contentLoading.set(false);
          this.error.set(r.message || 'Échange introuvable');
          return;
        }
        this.activeThread.set(r.data);
        this.perfMark('exchange.thread.ready');
        this.loadThreadContent(threadId);
      },
      error: () => {
        this.loading.set(false);
        this.contentLoading.set(false);
        this.error.set('Échange introuvable');
      }
    });
  }

  /** Conversation-first: unblock UI after messages; load other tabs lazily. */
  private loadThreadContent(threadId: string): void {
    this.exchange.getMessages(threadId, { limit: MESSAGE_PAGE_SIZE }).subscribe({
      next: res => {
        if (res.success) {
          this.applyPagedMessages(res.data);
        } else {
          this.messages.set([]);
          this.messagesHasMore.set(false);
          this.error.set(res.message || 'Impossible de charger les messages');
        }
        this.loading.set(false);
        this.contentLoading.set(false);
        this.perfMark('exchange.messages.ready');
        this.perfMark('exchange.tti');
        this.deferMarkUnread(threadId);
        this.startPolling(threadId);
        this.deferBadgeRefresh();

        const tab = this.activeTab();
        if (tab !== 'conversation') {
          this.loadTabData(threadId, tab);
        }
      },
      error: () => {
        this.loading.set(false);
        this.contentLoading.set(false);
      }
    });
  }

  private applyPagedMessages(page: PagedExchangeMessages | null): void {
    if (!page) {
      this.messages.set([]);
      this.messagesHasMore.set(false);
      return;
    }
    this.messages.set(page.items ?? []);
    this.messagesHasMore.set(!!page.hasMore);
  }

  private loadTabData(threadId: string, tab: ExchangeTabKey): void {
    if (tab === 'demandes') {
      forkJoin({
        requests: this.exchange.listRequests(threadId),
        documents: this.exchange.listDocuments(threadId),
        history: this.exchange.getHistory(threadId)
      }).subscribe({
        next: ({ requests, documents, history }) => {
          if (requests.success) this.requests.set(requests.data);
          else
            this.toast.add({
              severity: 'error',
              summary: $localize`:@@exchange-shell.component.summary.Demandes:Demandes`,
              detail: requests.message || 'Impossible de charger les demandes'
            });
          if (documents.success) this.documents.set(documents.data);
          if (history.success) this.history.set(history.data);
        },
        error: () =>
          this.toast.add({
            severity: 'error',
            summary: $localize`:@@exchange-shell.component.summary.Demandes:Demandes`,
            detail: $localize`:@@exchange-shell.component.detail.Impossible_de_ch:Impossible de charger les demandes`
          })
      });
    } else if (tab === 'taches') {
      this.exchange.listTasks(threadId).subscribe(r => {
        if (r.success) this.tasks.set(r.data);
      });
    } else if (tab === 'documents') {
      this.exchange.listDocuments(threadId).subscribe(r => {
        if (r.success) this.documents.set(r.data);
      });
    } else if (tab === 'historique') {
      this.exchange.getHistory(threadId).subscribe(r => {
        if (r.success) this.history.set(r.data);
      });
    }
  }

  private deferMarkUnread(threadId: string): void {
    const me = this.auth.user()?.id;
    if (!me) return;
    const unreadIds = this.messages()
      .filter(m => m.authorUserId !== me && !m.readReceipts.some(r => r.userId === me))
      .map(m => m.id);
    if (unreadIds.length === 0) return;

    // Prefer batch endpoint; fall back to limited parallel markRead.
    this.exchange.markReadBatch(threadId, unreadIds).subscribe({
      error: () => {
        const chunk = unreadIds.slice(0, 5);
        for (const id of chunk) {
          this.exchange.markRead(threadId, id).subscribe();
        }
      }
    });
  }

  private deferBadgeRefresh(): void {
    if (this.badgeRefreshTimer) clearTimeout(this.badgeRefreshTimer);
    this.badgeRefreshTimer = setTimeout(() => {
      this.badge.invalidate();
      this.badgeRefreshTimer = null;
    }, BADGE_REFRESH_DEBOUNCE_MS);
  }

  private startPolling(threadId: string): void {
    this.pollSub?.unsubscribe();
    this.pollSub = timer(12000, 12000)
      .pipe(
        switchMap(() => {
          const lastSentAt = this.messages().at(-1)?.sentAt;
          return this.exchange.getMessages(threadId, lastSentAt ? { after: lastSentAt } : { limit: MESSAGE_PAGE_SIZE });
        })
      )
      .subscribe({
        next: r => {
          if (!r.success) return;
          const incoming = r.data.items ?? [];
          if (incoming.length === 0) return;
          const lastSentAt = this.messages().at(-1)?.sentAt;
          if (lastSentAt) {
            const existingIds = new Set(this.messages().map(m => m.id));
            const appended = incoming.filter(m => !existingIds.has(m.id));
            if (appended.length) {
              this.messages.update(m => [...m, ...appended]);
              this.deferMarkUnread(threadId);
              this.deferBadgeRefresh();
            }
          } else {
            this.applyPagedMessages(r.data);
            this.deferMarkUnread(threadId);
            this.deferBadgeRefresh();
          }
        }
      });
  }

  private syncCanonicalUrl(threadId: string, currentThreadId: string | null): void {
    if (currentThreadId === threadId) return;
    // On aligne l'URL sur le thread résolu par le serveur. La garde d'idempotence dans
    // bootstrap() (lastBootstrappedThreadId + activeThread.id) évite tout re-fetch : plus
    // besoin de suppressNextBootstrap. Le nouveau flux navigationSub émet une seule fois
    // grâce au distinctUntilChanged sur le tuple [threadId, tab].
    this.lastBootstrappedThreadId = threadId;
    const base = this.isFirm() ? '/firm/exchanges' : '/exchanges';
    void this.router.navigate([base, threadId], {
      replaceUrl: !currentThreadId,
      queryParamsHandling: 'preserve'
    });
  }

  private perfMark(name: string): void {
    try {
      performance.mark(name);
      if (!environment.production) {
        // eslint-disable-next-line no-console
        console.debug(`[exchanges-perf] ${name}`, performance.now().toFixed(0));
      }
    } catch {
      /* ignore */
    }
  }
}
