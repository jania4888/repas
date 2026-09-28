import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ConversationDto } from '../../models/ai-chat.models';
import { erpDateLocale } from '@core/i18n/erp-format';

@Component({
  selector: 'app-conversation-list',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="conversation-list">
      <div class="list-header">
        <h4 i18n="@@ai-assistant.components.conversations.07c59b44">Conversations</h4>
        <button class="new-btn" (click)="newConversation.emit()" title="Nouvelle conversation" i18n-title="@@ai-assistant.components.nouvelle.conversation.c886195f">
          <i class="fa-solid fa-plus"></i>
        </button>
      </div>

      @if (!conversations.length) {
        <div class="empty-state">
          <i class="fa-solid fa-comments"></i>
          <p i18n="@@ai-assistant.components.aucune.conversation.57643067">Aucune conversation</p>
        </div>
      }

      <div class="list-items">
        @for (conv of conversations; track conv.id) {
          <div
            class="conversation-item"
            [class.active]="conv.id === activeConversationId"
            (click)="conversationSelected.emit(conv.id)">
            <div class="conv-title">{{ conv.title }}</div>
            <div class="conv-meta" i18n="@@ai-assistant.components.messages.f0e56a4a">
              {{ conv.messageCount }} messages &middot; {{ formatDate(conv.lastMessageAt) }}
            </div>
            <button
              class="delete-btn"
              (click)="onDelete($event, conv.id)"
              title="Supprimer" i18n-title="@@ai-assistant.components.supprimer.1acfc1c7">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .conversation-list {
      display: flex;
      flex-direction: column;
      height: 100%;
    }

    .list-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--spacing-3) var(--spacing-4);
      border-bottom: 1px solid var(--color-border-subtle);
      background: linear-gradient(180deg, var(--color-white) 0%, var(--color-neutral-50) 100%);
    }

    .list-header h4 {
      margin: 0;
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
      letter-spacing: -0.02em;
    }

    .new-btn {
      width: 32px;
      height: 32px;
      border-radius: var(--radius-lg);
      border: 1px solid var(--color-border-subtle);
      background: var(--color-white);
      color: var(--color-text-secondary);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: var(--font-size-sm);
      transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
    }

    .new-btn:hover {
      background: var(--color-primary-50);
      border-color: var(--color-primary-300);
      color: var(--color-primary-600);
    }

    .new-btn:focus-visible {
      outline: 2px solid var(--color-primary-500);
      outline-offset: 2px;
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: var(--spacing-8) var(--spacing-4);
      color: var(--color-text-tertiary);
      gap: var(--spacing-2);
    }

    .empty-state i {
      font-size: var(--font-size-xl);
      opacity: 0.85;
    }

    .empty-state p {
      font-size: var(--font-size-sm);
      margin: 0;
    }

    .list-items {
      flex: 1;
      overflow-y: auto;
    }

    .conversation-item {
      position: relative;
      padding: var(--spacing-3) var(--spacing-4);
      cursor: pointer;
      border-bottom: 1px solid var(--color-border-subtle);
      transition: background-color var(--transition-fast);
    }

    .conversation-item:hover {
      background: var(--color-neutral-100);
    }

    .conversation-item.active {
      background: var(--color-primary-50);
      border-inline-start: 3px solid var(--color-primary-500);
    }

    .conv-title {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      color: var(--color-text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      padding-inline-end: 28px;
    }

    .conv-meta {
      font-size: var(--font-size-xs);
      color: var(--color-text-tertiary);
      margin-top: 2px;
    }

    .delete-btn {
      position: absolute;
      inset-inline-end: var(--spacing-2);
      top: 50%;
      transform: translateY(-50%);
      width: 28px;
      height: 28px;
      border: none;
      background: transparent;
      color: var(--color-text-tertiary);
      cursor: pointer;
      border-radius: var(--radius-md);
      display: none;
      align-items: center;
      justify-content: center;
      font-size: var(--font-size-xs);
    }

    .conversation-item:hover .delete-btn {
      display: flex;
    }

    .delete-btn:hover {
      color: var(--color-error-600);
      background: var(--color-error-50);
    }

    .delete-btn:focus-visible {
      display: flex;
      outline: 2px solid var(--color-primary-500);
      outline-offset: 2px;
    }
  `]
})
export class ConversationListComponent {
  @Input() conversations: ConversationDto[] = [];
  @Input() activeConversationId?: string;
  @Output() conversationSelected = new EventEmitter<string>();
  @Output() conversationDeleted = new EventEmitter<string>();
  @Output() newConversation = new EventEmitter<void>();

  onDelete(event: Event, id: string): void {
    event.stopPropagation();
    this.conversationDeleted.emit(id);
  }

  formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'maintenant';
    if (minutes < 60) return `il y a ${minutes}min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `il y a ${hours}h`;
    return date.toLocaleDateString(erpDateLocale('fr-FR'), { day: 'numeric', month: 'short' });
  }
}
