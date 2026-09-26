import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import {
  FiscalScheduleAttachmentDto,
  FiscalScheduleEntryDto,
  FiscalScheduleHistoryDto
} from '../services/fiscal-schedule.service';
import { FISCAL_REMINDER_CHANNEL_OPTIONS, formatFiscalAmount, formatFiscalDate, statusClass } from './fiscal-schedule.view-model';
import { FISCAL_SCHEDULE_SHARED_STYLES } from './fiscal-schedule-shared.styles';

@Component({
  selector: 'app-fiscal-schedule-detail',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="detail-panel" *ngIf="selected">
      <div class="detail-group">
        <h2 i18n="@@accounting.fiscal-schedule.detail.7c9a7c06">Detail</h2>
        <dl>
          <div><dt i18n="@@accounting.fiscal-schedule.type.d.obligation.790fbe09">Type d'obligation</dt><dd>{{ selected.obligationTypeDisplay }}</dd></div>
          <div><dt i18n="@@accounting.fiscal-schedule.periode.85e181b5">Periode</dt><dd>{{ selected.periodDisplay }}</dd></div>
          <div><dt i18n="@@accounting.fiscal-schedule.date.d.echeance.e0e8b824">Date d'echeance</dt><dd>{{ date(selected.dueDate) }}</dd></div>
          <div><dt i18n="@@accounting.fiscal-schedule.societe.45c9ec04">Societe</dt><dd>{{ selected.companyName || companyLabel }}</dd></div>
          <div><dt i18n="@@accounting.fiscal-schedule.montant.estime.b496eba3">Montant estime</dt><dd>{{ amount(selected.estimatedAmount, selected.currency) }}</dd></div>
          <div><dt i18n="@@accounting.fiscal-schedule.statut.659499f3">Statut</dt><dd><span class="status-pill" [ngClass]="statusClassName(selected.status)">{{ selected.statusDisplay }}</span></dd></div>
          <div><dt i18n="@@accounting.fiscal-schedule.responsable.44b58814">Responsable</dt><dd>{{ selected.responsibleName || '-' }}</dd></div>
          <div><dt i18n="@@accounting.fiscal-schedule.observations.461ebaa1">Observations</dt><dd>{{ selected.observations || '-' }}</dd></div>
        </dl>
      </div>
      <div class="detail-group">
        <h2 i18n="@@accounting.fiscal-schedule.pieces.jointes.c523abdf">Pieces jointes</h2>
        <div *ngIf="readOnlyAttachments" class="muted" i18n="@@accounting.fiscal-schedule.ouvrir.le.dossier.client.pour.consulter.ou.joind.f317e250">Ouvrir le dossier client pour consulter ou joindre les documents.</div>
        <ng-container *ngIf="!readOnlyAttachments">
          <label class="file-input">
            <i class="fa-solid fa-paperclip"></i>
            <span i18n="@@accounting.fiscal-schedule.joindre.un.document.5fb7d976">Joindre un document</span>
            <input type="file" (change)="fileSelected.emit($event)">
          </label>
          <div class="attachment-row" *ngFor="let attachment of attachments">
            <button class="link-row" type="button" (click)="downloadAttachment.emit(attachment)">
              <i class="fa-regular fa-file-lines"></i>{{ attachment.fileName }}
            </button>
            <button class="square-button danger-btn" type="button" title="Supprimer" i18n-title="Supprimer" (click)="deleteAttachment.emit(attachment)">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
          <div class="muted" *ngIf="attachments.length === 0" i18n="@@accounting.fiscal-schedule.aucune.piece.jointe.3ef4f99b">Aucune piece jointe</div>
        </ng-container>
      </div>
      <div class="detail-group">
        <h2 i18n="@@accounting.fiscal-schedule.actions.rapides.abe69a9c">Actions rapides</h2>
        <button class="quick-action" type="button" (click)="openSource.emit()">
          <i class="fa-solid fa-arrow-up-right-from-square"></i>{{ isFirmScope ? 'Ouvrir le dossier' : 'Ouvrir la declaration' }}
        </button>
        <button class="quick-action" type="button" (click)="deposit.emit()" [disabled]="!canMutate">
          <i class="fa-regular fa-circle-check"></i>Marquer comme deposee
        </button>
        <button class="quick-action" type="button" (click)="validate.emit()" [disabled]="!canMutate || !canValidate">
          <i class="fa-solid fa-stamp"></i>Marquer comme validee
        </button>
        <button class="quick-action" type="button" (click)="payment.emit()" [disabled]="!canMutate">
          <i class="fa-solid fa-coins"></i>Saisir le paiement
        </button>
        <button class="quick-action" type="button" (click)="reminder.emit()" [disabled]="!canMutate">
          <i class="fa-regular fa-bell"></i>Planifier un rappel
        </button>
      </div>
      <div class="detail-group">
        <h2 i18n="@@accounting.fiscal-schedule.historique.34f3a06a">Historique</h2>
        <div class="meta-history">
          <div>Créé le : {{ date(selected.createdAt) }} par {{ selected.createdBy || '-' }}</div>
          <div>Modifié le : {{ date(selected.updatedAt) }} par {{ selected.updatedBy || '-' }}</div>
          <div>Dernier rappel : {{ date(selected.lastReminderAt) }} via {{ reminderChannelLabel(selected.lastReminderChannel) }}</div>
        </div>
        <div class="history-row" *ngFor="let item of history">
          <strong>{{ date(item.createdAt) }}</strong>
          <span>{{ item.summary }}</span>
        </div>
        <div class="muted" *ngIf="readOnlyHistory" i18n="@@accounting.fiscal-schedule.historique.detaille.disponible.dans.le.dossier.c.ca1dce63">Historique detaille disponible dans le dossier client.</div>
        <div class="muted" *ngIf="!readOnlyHistory && history.length === 0" i18n="@@accounting.fiscal-schedule.aucun.historique.b806a0d9">Aucun historique.</div>
      </div>
    </section>
  `,
  styles: [FISCAL_SCHEDULE_SHARED_STYLES, `
    .detail-panel {
      display: grid;
      grid-template-columns: 1.25fr 1fr 1fr 1fr;
      gap: 0;
      margin-top: 14px;
      border: 1px solid #d8dee8;
      border-radius: 6px;
      background: #fff;
    }
    .detail-group {
      padding: 14px;
      border-right: 1px solid #e7ecf3;
      min-width: 0;
    }
    .detail-group:last-child { border-right: 0; }
    .detail-group h2 {
      margin: 0 0 10px;
      font-size: 13px;
      font-weight: 800;
      color: #111827;
    }
    dl { display: grid; gap: 9px; margin: 0; font-size: 12px; }
    dt { color: #64748b; font-weight: 700; }
    dd { margin: 2px 0 0; font-weight: 700; color: #1f2937; overflow-wrap: anywhere; }
    .quick-action, .link-row, .file-input {
      display: flex;
      width: 100%;
      align-items: center;
      gap: 8px;
      min-height: 32px;
      padding: 7px 8px;
      margin-bottom: 6px;
      font-size: 12px;
      text-align: left;
      color: #075985;
      background: transparent;
      border-color: transparent;
    }
    .file-input {
      border: 1px dashed #b8c4d3;
      border-radius: 6px;
      cursor: pointer;
    }
    .file-input input { display: none; }
    .attachment-row { display: flex; gap: 6px; align-items: center; }
    .attachment-row .link-row { flex: 1; margin-bottom: 0; }
    .danger-btn { color: #b42318; flex-shrink: 0; }
    .meta-history {
      display: grid;
      gap: 6px;
      margin-bottom: 12px;
      font-size: 12px;
      font-weight: 600;
      color: #475569;
    }
    .history-row {
      display: grid;
      gap: 3px;
      padding-bottom: 8px;
      margin-bottom: 8px;
      border-bottom: 1px solid #eef2f7;
      font-size: 12px;
    }
    .history-row strong { color: #64748b; font-size: 11px; }
    @media (max-width: 1180px) {
      .detail-panel { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 720px) {
      .detail-panel { grid-template-columns: 1fr; }
      .detail-group { border-right: 0; border-bottom: 1px solid #e7ecf3; }
    }
  `]
})
export class FiscalScheduleDetailComponent {
  @Input() selected: FiscalScheduleEntryDto | null = null;
  @Input() history: FiscalScheduleHistoryDto[] = [];
  @Input() attachments: FiscalScheduleAttachmentDto[] = [];
  @Input() isFirmScope = false;
  @Input() canMutate = false;
  @Input() canValidate = false;
  @Input() companyLabel = '-';
  @Input() readOnlyAttachments = false;
  @Input() readOnlyHistory = false;

  @Output() openSource = new EventEmitter<void>();
  @Output() deposit = new EventEmitter<void>();
  @Output() validate = new EventEmitter<void>();
  @Output() payment = new EventEmitter<void>();
  @Output() reminder = new EventEmitter<void>();
  @Output() fileSelected = new EventEmitter<Event>();
  @Output() downloadAttachment = new EventEmitter<FiscalScheduleAttachmentDto>();
  @Output() deleteAttachment = new EventEmitter<FiscalScheduleAttachmentDto>();

  private readonly reminderChannels = FISCAL_REMINDER_CHANNEL_OPTIONS;

  amount(value: number, currency = 'TND'): string {
    return formatFiscalAmount(value, currency);
  }

  date(value?: string | null): string {
    return formatFiscalDate(value);
  }

  statusClassName(status: number): string {
    return statusClass(status);
  }

  reminderChannelLabel(channel?: number | null): string {
    if (channel == null) return '-';
    return this.reminderChannels.find(c => c.value === channel)?.label ?? '-';
  }
}
