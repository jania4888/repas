import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, signal } from '@angular/core';
import type { ChatAttachment } from '../../models/ai-chat.models';

/**
 * Carte compacte affichant une pièce jointe (avant ou après envoi).
 *
 * Modes :
 * - editable=true  : bouton « Supprimer » visible (état pré-envoi dans chat-input).
 * - editable=false : lecture seule (affichage historique dans une bulle utilisateur).
 *
 * Le texte extrait est dépliable via un bouton « Voir le texte extrait ».
 */
@Component({
  selector: 'app-chat-attachment-card',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="card" [attr.aria-label]="ariaLabel">
      <div class="card__header">
        <i class="fa-solid {{ icon }} card__icon" aria-hidden="true"></i>
        <div class="card__meta">
          <div class="card__name" [title]="attachment.fileName">{{ attachment.fileName }}</div>
          <div class="card__badges">
            <span class="badge badge--neutral">{{ formatLabel }}</span>
            @if (attachment.pageCount > 1) {
              <span class="badge badge--neutral">{{ attachment.pageCount }} pages</span>
            }
            <span class="badge badge--neutral">{{ sizeLabel }}</span>
            @if (attachment.ocrApplied) {
              <span class="badge badge--info" title="Reconnaissance optique appliquée (document scanné)" i18n-title="@@ai-assistant.components.reconnaissance.optique.appliquee.document.scanne.69412bf1" i18n="@@ai-assistant.components.ocr.fd470836">OCR</span>
            }
            @if (attachment.truncated) {
              <span class="badge badge--warning" title="Texte tronqué à la limite max" i18n-title="@@ai-assistant.components.texte.tronque.a.la.limite.max.67374c96" i18n="@@ai-assistant.components.tronque.cf5dabd4">Tronqué</span>
            }
          </div>
        </div>
        <div class="card__actions">
          <button
            type="button"
            class="btn-ghost"
            (click)="toggleExpanded()"
            [attr.aria-expanded]="expanded()"
            [attr.aria-label]="expanded() ? loc_ui_tern_masquer_le_texte_extrait_9e2022 : loc_ui_tern_voir_le_texte_extrait_f7e1e7"
          >
            <i class="fa-solid" [class.fa-chevron-down]="!expanded()" [class.fa-chevron-up]="expanded()" aria-hidden="true"></i>
            <span>{{ expanded() ? loc_ui_tern_masquer_adb05f : loc_ui_tern_voir_8a754f }} le texte</span>
          </button>
          @if (editable) {
            <button
              type="button"
              class="btn-ghost btn-ghost--danger"
              (click)="emitRemove()"
              aria-label="Supprimer cette pièce jointe" i18n-aria-label="@@ai-assistant.components.supprimer.cette.piece.jointe.4b3f3917"
            >
              <i class="fa-solid fa-xmark" aria-hidden="true"></i>
            </button>
          }
        </div>
      </div>

      @if (attachment.warnings.length > 0) {
        <div class="warnings" role="status">
          <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
          <ul>
            @for (w of attachment.warnings; track w) {
              <li>{{ w }}</li>
            }
          </ul>
        </div>
      }

      @if (expanded()) {
        <pre class="extract" tabindex="0">{{ attachment.fullText || '(aucun texte extrait)' }}</pre>
      }
    </article>
  `,
  styles: [`
    .card {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);
      padding: var(--spacing-2) var(--spacing-3);
      background: var(--color-neutral-50);
      border: 1px solid var(--color-border-subtle);
      border-radius: var(--radius-lg);
    }
    .card__header { display: flex; gap: var(--spacing-2); align-items: center; }
    .card__icon { font-size: 1.25rem; color: var(--color-primary-600); flex-shrink: 0; }
    .card__meta { flex: 1; min-width: 0; }
    .card__name {
      font-weight: 600;
      font-size: var(--font-size-sm);
      color: var(--color-text-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .card__badges { display: flex; flex-wrap: wrap; gap: var(--spacing-1); margin-top: 2px; }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      font-size: var(--font-size-xs);
      border-radius: var(--radius-full);
      line-height: 1.4;
    }
    .badge--neutral {
      background: var(--color-white);
      color: var(--color-text-secondary);
      border: 1px solid var(--color-border-subtle);
    }
    .badge--info {
      background: var(--color-primary-50);
      color: var(--color-primary-700);
      border: 1px solid var(--color-primary-100);
    }
    .badge--warning {
      background: var(--color-warning-50, #fef3c7);
      color: var(--color-warning-700, #92400e);
      border: 1px solid var(--color-warning-200, #fde68a);
    }
    .card__actions { display: flex; gap: var(--spacing-1); align-items: center; flex-shrink: 0; }
    .btn-ghost {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      font-size: var(--font-size-xs);
      background: transparent;
      border: 1px solid transparent;
      border-radius: var(--radius-md);
      color: var(--color-text-secondary);
      cursor: pointer;
      transition: background-color 0.15s, color 0.15s, border-color 0.15s;
    }
    .btn-ghost:hover { background: var(--color-neutral-100); border-color: var(--color-border-subtle); }
    .btn-ghost--danger:hover {
      background: var(--color-error-50, #fef2f2);
      color: var(--color-error-700, #991b1b);
      border-color: var(--color-error-200, #fecaca);
    }
    .warnings {
      display: flex;
      gap: var(--spacing-2);
      padding: var(--spacing-2);
      background: var(--color-warning-50, #fef3c7);
      color: var(--color-warning-700, #92400e);
      border: 1px solid var(--color-warning-200, #fde68a);
      border-radius: var(--radius-md);
      font-size: var(--font-size-xs);
    }
    .warnings ul { margin: 0; padding-left: var(--spacing-3); }
    .extract {
      max-height: 240px;
      overflow: auto;
      padding: var(--spacing-2);
      font-family: var(--font-family-mono, ui-monospace, monospace);
      font-size: var(--font-size-xs);
      line-height: var(--line-height-normal);
      background: var(--color-white);
      border: 1px solid var(--color-border-subtle);
      border-radius: var(--radius-md);
      white-space: pre-wrap;
      word-break: break-word;
      margin: 0;
      color: var(--color-text-primary);
    }
  `]
})
export class ChatAttachmentCardComponent {
  readonly loc_ui_tern_masquer_le_texte_extrait_9e2022 = $localize`:@@ui.tern.masquer.le.texte.extrait.9e2022:Masquer le texte extrait`;
  readonly loc_ui_tern_voir_le_texte_extrait_f7e1e7 = $localize`:@@ui.tern.voir.le.texte.extrait.f7e1e7:Voir le texte extrait`;
  readonly loc_ui_tern_masquer_adb05f = $localize`:@@ui.tern.masquer.adb05f:Masquer`;
  readonly loc_ui_tern_voir_8a754f = $localize`:@@ui.tern.voir.8a754f:Voir`;
  @Input({ required: true }) attachment!: ChatAttachment;
  @Input() editable = false;
  @Output() removed = new EventEmitter<string>();

  readonly expanded = signal(false);

  toggleExpanded(): void {
    this.expanded.update(v => !v);
  }

  emitRemove(): void {
    this.removed.emit(this.attachment.id);
  }

  get icon(): string {
    switch (this.attachment.format) {
      case 'pdf': return 'fa-file-pdf';
      case 'image': return 'fa-file-image';
      case 'docx': return 'fa-file-word';
      case 'xlsx': return 'fa-file-excel';
      case 'csv': return 'fa-file-csv';
      case 'txt': return 'fa-file-lines';
      default: return 'fa-file';
    }
  }

  get formatLabel(): string {
    switch (this.attachment.format) {
      case 'pdf': return 'PDF';
      case 'image': return 'Image';
      case 'docx': return 'Word';
      case 'xlsx': return 'Excel';
      case 'csv': return 'CSV';
      case 'txt': return 'Texte';
      default: return this.attachment.format?.toUpperCase() || 'Fichier';
    }
  }

  get sizeLabel(): string {
    const b = this.attachment.sizeBytes;
    if (!b || b <= 0) return '—';
    if (b < 1024) return `${b} o`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} Ko`;
    return `${(b / (1024 * 1024)).toFixed(1)} Mo`;
  }

  get ariaLabel(): string {
    return `Pièce jointe ${this.attachment.fileName}, ${this.formatLabel}, ${this.sizeLabel}`;
  }
}
