/// <reference types="@angular/localize" />
import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  inject,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { StatusBadgeComponent } from '@shared/components/status-badge/status-badge.component';
import { ToastService } from '@core/services/toast.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import {
  ExchangeAuditEvent,
  ExchangeDocument,
  ExchangeParticipant,
  ExchangeRequest,
  ExchangeRequestCategory,
  ExchangeRequestComment,
  ExchangeRequestPriority,
  ExchangeRequestStatus,
  ExchangeService,
  ExchangeThreadDetail
} from '@core/services/exchange.service';
import {
  RequestListFilter,
  assigneeDisplayName,
  auditEventBelongsToRequest,
  auditEventLabel,
  canAssignRequest,
  canResolveRequest,
  canResumeRequest,
  canSetWaiting,
  categoryLabel,
  documentIconClass,
  formatFileSize,
  initialsFromName,
  isPriorityHigh,
  isRequestActionable,
  isRequestOpen,
  isThreadOpen,
  parseExchangeRequestStatus,
  priorityLabel,
  requestMatchesFilter,
  requestStatusBadge,
  requestStatusLabel
} from './exchange-status';

@Component({
  selector: 'app-exchange-requests-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, EmptyStateComponent, ButtonComponent, StatusBadgeComponent],
  templateUrl: './exchange-requests-panel.component.html',
  styleUrl: './exchange-requests-panel.component.scss'
})
export class ExchangeRequestsPanelComponent implements OnChanges {
  private readonly exchange = inject(ExchangeService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmationService);

  @Input({ required: true }) thread!: ExchangeThreadDetail;
  @Input() threadOpen = true;
  @Input() isFirm = false;
  @Input() requests: ExchangeRequest[] = [];
  @Input() documents: ExchangeDocument[] = [];
  @Input() history: ExchangeAuditEvent[] = [];
  @Input() participants: ExchangeParticipant[] = [];
  @Input() openCreateForm = false;
  @Input() selectedRequestId: string | null = null;

  @Output() openCreateFormChange = new EventEmitter<boolean>();
  @Output() selectedChange = new EventEmitter<string | null>();
  @Output() created = new EventEmitter<ExchangeRequest>();
  @Output() statusChanged = new EventEmitter<ExchangeRequest>();
  @Output() assigned = new EventEmitter<ExchangeRequest>();
  @Output() uploaded = new EventEmitter<ExchangeDocument>();

  readonly filters: { id: RequestListFilter; label: string }[] = [
    { id: 'all', label: 'Toutes' },
    { id: 'active', label: 'Actives' },
    { id: 'open', label: 'Ouvertes' },
    { id: 'inProgress', label: 'En cours' },
    { id: 'waiting', label: 'En attente' },
    { id: 'resolved', label: 'Résolues' },
    { id: 'closed', label: 'Clôturées' }
  ];

  readonly filter = signal<RequestListFilter>('all');
  readonly search = signal('');
  readonly newTitle = signal('');
  readonly newDescription = signal('');
  readonly newCategory = signal<ExchangeRequestCategory>(0);
  readonly newPriority = signal<ExchangeRequestPriority>(1);
  readonly titleError = signal<string | null>(null);
  readonly creating = signal(false);
  readonly statusBusyId = signal<string | null>(null);
  readonly commentBody = signal('');
  readonly comments = signal<ExchangeRequestComment[]>([]);
  readonly commentsLoading = signal(false);
  readonly postingComment = signal(false);
  readonly assignUserId = signal('');
  readonly uploading = signal(false);

  readonly statusLabel = requestStatusLabel;
  readonly badge = requestStatusBadge;
  readonly catLabel = categoryLabel;
  readonly prioLabel = priorityLabel;
  readonly isHigh = isPriorityHigh;
  readonly fileIcon = documentIconClass;
  readonly fileSize = formatFileSize;
  readonly initials = initialsFromName;
  readonly auditLabel = auditEventLabel;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['selectedRequestId'] || changes['thread']) {
      this.loadComments();
    }
  }

  get threadIsOpen(): boolean {
    return this.threadOpen && isThreadOpen(this.thread?.status);
  }

  filteredRequests(): ExchangeRequest[] {
    const f = this.filter();
    const q = this.search();
    return this.requests.filter(r =>
      requestMatchesFilter(r.status, f, q, r.title, r.description ?? '', r.number)
    );
  }

  selectedRequest(): ExchangeRequest | null {
    const id = this.selectedRequestId;
    if (!id) return null;
    return this.requests.find(r => r.id === id) ?? null;
  }

  requestDocs(requestId: string): ExchangeDocument[] {
    return this.documents.filter(d => d.requestId === requestId);
  }

  requestActivity(request: ExchangeRequest): ExchangeAuditEvent[] {
    return this.history.filter(h => auditEventBelongsToRequest(h.eventType, h.payloadJson, request));
  }

  authorName(userId: string): string {
    return assigneeDisplayName(this.resolvedParticipants(), userId);
  }

  assigneeName(request: ExchangeRequest): string {
    return assigneeDisplayName(this.resolvedParticipants(), request.assigneeUserId);
  }

  firmParticipants(): ExchangeParticipant[] {
    return this.resolvedParticipants().filter(p => {
      const side = (p.side ?? '').toLowerCase();
      if (side === 'firm') return true;
      const role = (p.role ?? '').toLowerCase();
      return role.startsWith('firm');
    });
  }

  private resolvedParticipants(): ExchangeParticipant[] {
    if (this.participants.length > 0) return this.participants;
    return this.thread?.participants ?? [];
  }

  filterCount(id: RequestListFilter): number {
    return this.requests.filter(r =>
      requestMatchesFilter(r.status, id, '', r.title, r.description ?? '', r.number)
    ).length;
  }

  openCreate(): void {
    this.openCreateFormChange.emit(true);
    this.titleError.set(null);
  }

  cancelCreate(): void {
    this.openCreateFormChange.emit(false);
    this.newTitle.set('');
    this.newDescription.set('');
    this.newCategory.set(0);
    this.newPriority.set(1);
    this.titleError.set(null);
  }

  selectRequest(id: string | null): void {
    this.selectedChange.emit(id);
  }

  setCategory(value: number | string): void {
    this.newCategory.set(+value as ExchangeRequestCategory);
  }

  setPriority(value: number | string): void {
    this.newPriority.set(+value as ExchangeRequestPriority);
  }

  createRequest(): void {
    const title = this.newTitle().trim();
    if (!title) {
      this.titleError.set('Le titre est obligatoire');
      return;
    }
    if (!this.thread || this.creating()) return;
    this.titleError.set(null);
    this.creating.set(true);
    this.exchange
      .createRequest(this.thread.id, {
        title,
        description: this.newDescription().trim() || undefined,
        category: this.newCategory(),
        priority: this.newPriority()
      })
      .subscribe({
        next: r => {
          this.creating.set(false);
          if (!r.success) {
            this.toast.add({
              severity: 'error',
              summary: $localize`:@@exchange-requests-panel.component.summary.Demande:Demande`,
              detail: r.message || 'Impossible de créer la demande'
            });
            return;
          }
          this.toast.add({ severity: 'success', summary: $localize`:@@exchange-requests-panel.component.summary.Demande:Demande`, detail: $localize`:@@exchange-requests-panel.component.detail.Demande_cr_e:Demande créée` });
          this.created.emit(r.data);
          this.cancelCreate();
          this.selectedChange.emit(r.data.id);
        },
        error: () => {
          this.creating.set(false);
          this.toast.add({
            severity: 'error',
            summary: $localize`:@@exchange-requests-panel.component.summary.Demande:Demande`,
            detail: $localize`:@@exchange-requests-panel.component.detail.Impossible_de_cr:Impossible de créer la demande`
          });
        }
      });
  }

  canTakeCharge(req: ExchangeRequest): boolean {
    return this.threadIsOpen && isRequestOpen(req.status);
  }

  canResolve(req: ExchangeRequest): boolean {
    return this.threadIsOpen && canResolveRequest(req.status);
  }

  canWait(req: ExchangeRequest): boolean {
    return this.threadIsOpen && canSetWaiting(req.status);
  }

  canResume(req: ExchangeRequest): boolean {
    return this.threadIsOpen && canResumeRequest(req.status);
  }

  canAssign(req: ExchangeRequest): boolean {
    return this.threadIsOpen && canAssignRequest(req.status, this.isFirm);
  }

  canClose(req: ExchangeRequest): boolean {
    return this.threadIsOpen && isRequestActionable(req.status);
  }

  canComment(req: ExchangeRequest): boolean {
    return this.threadIsOpen && parseExchangeRequestStatus(req.status) !== 'Closed';
  }

  changeStatus(req: ExchangeRequest, status: ExchangeRequestStatus): void {
    if (status === 'Closed') {
      this.confirm.confirm({
        header: `Clôturer la demande #${req.number}`,
        message: 'Cette action est irréversible. La demande ne pourra plus changer de statut.',
        acceptLabel: $localize`:@@exchange-requests-panel.component.acceptLabel.Clôturer:Clôturer`,
        rejectLabel: $localize`:@@exchange-requests-panel.component.rejectLabel.Annuler:Annuler`,
        acceptButtonStyleClass: 'btn-danger',
        accept: () => this.applyStatus(req, status)
      });
      return;
    }
    this.applyStatus(req, status);
  }

  assignToSelected(req: ExchangeRequest): void {
    const assigneeUserId = this.assignUserId().trim();
    if (!assigneeUserId || !this.thread) return;
    this.statusBusyId.set(req.id);
    this.exchange.assignRequest(this.thread.id, req.id, assigneeUserId).subscribe({
      next: r => {
        this.statusBusyId.set(null);
        if (!r.success) {
          this.toast.add({
            severity: 'error',
            summary: $localize`:@@exchange-requests-panel.component.summary.Assignation:Assignation`,
            detail: r.message || 'Impossible d’assigner la demande'
          });
          return;
        }
        this.toast.add({ severity: 'success', summary: $localize`:@@exchange-requests-panel.component.summary.Assignation:Assignation`, detail: $localize`:@@exchange-requests-panel.component.detail.Demande_assign_e:Demande assignée` });
        this.assigned.emit(r.data);
      },
      error: () => {
        this.statusBusyId.set(null);
        this.toast.add({
          severity: 'error',
          summary: $localize`:@@exchange-requests-panel.component.summary.Assignation:Assignation`,
          detail: $localize`:@@exchange-requests-panel.component.detail.Impossible_d_ass:Impossible d’assigner la demande`
        });
      }
    });
  }

  onAttachSelected(req: ExchangeRequest, event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !this.thread) return;
    this.uploading.set(true);
    this.exchange.uploadDocument(this.thread.id, file, undefined, req.id).subscribe({
      next: r => {
        this.uploading.set(false);
        if (!r.success) {
          this.toast.add({
            severity: 'error',
            summary: $localize`:@@exchange-requests-panel.component.summary.Pi_ce_jointe:Pièce jointe`,
            detail: r.message || 'Upload impossible'
          });
          return;
        }
        this.toast.add({ severity: 'success', summary: $localize`:@@exchange-requests-panel.component.summary.Pi_ce_jointe:Pièce jointe`, detail: $localize`:@@exchange-requests-panel.component.detail.Document_ajout_:Document ajouté` });
        this.uploaded.emit(r.data);
      },
      error: () => {
        this.uploading.set(false);
        this.toast.add({
          severity: 'error',
          summary: $localize`:@@exchange-requests-panel.component.summary.Pi_ce_jointe:Pièce jointe`,
          detail: $localize`:@@exchange-requests-panel.component.detail.Upload impos:Upload impossible`
        });
      }
    });
  }

  downloadDoc(doc: ExchangeDocument): void {
    if (!this.thread) return;
    this.exchange.downloadDocument(this.thread.id, doc.id).subscribe({
      next: blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = doc.fileName;
        a.click();
        URL.revokeObjectURL(url);
      },
      error: () =>
        this.toast.add({
          severity: 'error',
          summary: $localize`:@@exchange-requests-panel.component.summary.T_l_chargement:Téléchargement`,
          detail: $localize`:@@exchange-requests-panel.component.detail.Impossible_de_t_:Impossible de télécharger le document`
        })
    });
  }

  postComment(req: ExchangeRequest): void {
    const body = this.commentBody().trim();
    if (!body || !this.thread || this.postingComment()) return;
    this.postingComment.set(true);
    this.exchange.addRequestComment(this.thread.id, req.id, body).subscribe({
      next: r => {
        this.postingComment.set(false);
        if (!r.success) {
          this.toast.add({
            severity: 'error',
            summary: $localize`:@@exchange-requests-panel.component.summary.Commentaire:Commentaire`,
            detail: r.message || 'Impossible d’ajouter le commentaire'
          });
          return;
        }
        this.comments.update(list => [...list, r.data]);
        this.commentBody.set('');
      },
      error: () => {
        this.postingComment.set(false);
        this.toast.add({
          severity: 'error',
          summary: $localize`:@@exchange-requests-panel.component.summary.Commentaire:Commentaire`,
          detail: $localize`:@@exchange-requests-panel.component.detail.Impossible_d_ajo:Impossible d’ajouter le commentaire`
        });
      }
    });
  }

  private applyStatus(req: ExchangeRequest, status: ExchangeRequestStatus): void {
    if (!this.thread) return;
    this.statusBusyId.set(req.id);
    this.exchange.changeRequestStatus(this.thread.id, req.id, status).subscribe({
      next: r => {
        this.statusBusyId.set(null);
        if (!r.success) {
          this.toast.add({
            severity: 'error',
            summary: $localize`:@@exchange-requests-panel.component.summary.Statut:Statut`,
            detail: r.message || 'Impossible de mettre à jour le statut'
          });
          return;
        }
        this.toast.add({
          severity: 'success',
          summary: $localize`:@@exchange-requests-panel.component.summary.Statut:Statut`,
          detail: `Demande ${requestStatusLabel(status).toLowerCase()}`
        });
        this.statusChanged.emit(r.data);
      },
      error: () => {
        this.statusBusyId.set(null);
        this.toast.add({
          severity: 'error',
          summary: $localize`:@@exchange-requests-panel.component.summary.Statut:Statut`,
          detail: $localize`:@@exchange-requests-panel.component.detail.Impossible d:Impossible de mettre à jour le statut`
        });
      }
    });
  }

  private loadComments(): void {
    const id = this.selectedRequestId;
    if (!id || !this.thread) {
      this.comments.set([]);
      return;
    }
    this.commentsLoading.set(true);
    this.exchange.listRequestComments(this.thread.id, id).subscribe({
      next: r => {
        this.commentsLoading.set(false);
        if (!r.success) {
          this.comments.set([]);
          this.toast.add({
            severity: 'error',
            summary: $localize`:@@exchange-requests-panel.component.summary.Commentaires:Commentaires`,
            detail: r.message || 'Impossible de charger les commentaires'
          });
          return;
        }
        this.comments.set(r.data);
      },
      error: () => {
        this.commentsLoading.set(false);
        this.comments.set([]);
        this.toast.add({
          severity: 'error',
          summary: $localize`:@@exchange-requests-panel.component.summary.Commentaires:Commentaires`,
          detail: $localize`:@@exchange-requests-panel.component.detail.Impossible_de_ch:Impossible de charger les commentaires`
        });
      }
    });
  }
}
