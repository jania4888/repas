import { Component, ElementRef, Input, Output, EventEmitter, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TooltipModule } from 'primeng/tooltip';
import { NumberingDocumentTab } from '../models/numbering.models';

@Component({
  selector: 'app-numbering-doc-tabs',
  standalone: true,
  imports: [CommonModule, TooltipModule],
  styleUrls: ['../_numbering-tabs.scss'],
  template: `
    <div
      #tabList
      class="numbering-tabs-wrap"
      role="tablist"
      aria-label="Types de documents" i18n-aria-label="Types de documents"
      (keydown)="onKeydown($event)">
      @for (tab of tabs; track tab.documentType; let i = $index) {
        <button
          type="button"
          role="tab"
          class="numbering-tab"
          [class.is-active]="i === activeIndex"
          [attr.aria-selected]="i === activeIndex"
          [attr.tabindex]="i === activeIndex ? 0 : -1"
          [attr.id]="'numbering-tab-' + tab.documentType"
          [attr.aria-controls]="'numbering-panel-' + tab.documentType"
          [pTooltip]="tab.label"
          tooltipPosition="bottom"
          (click)="selectTab(i)">
          <i [class]="tab.icon" aria-hidden="true"></i>
          <span class="numbering-tab__label-full">{{ tab.label }}</span>
          <span class="numbering-tab__label-short">{{ tab.shortLabel }}</span>
          @if (lockedByIndex?.[i]) {
            <i class="pi pi-lock numbering-tab__lock" aria-label="Format verrouille" i18n-aria-label="Format verrouille"></i>
          }
        </button>
      }
    </div>
  `
})
export class NumberingDocTabsComponent {
  @Input({ required: true }) tabs!: readonly NumberingDocumentTab[];
  @Input() activeIndex = 0;
  @Input() lockedByIndex: readonly boolean[] | null = null;

  @Output() activeIndexChange = new EventEmitter<number>();
  @Output() tabChange = new EventEmitter<number>();

  @ViewChild('tabList') tabListRef?: ElementRef<HTMLElement>;

  selectTab(index: number): void {
    if (index === this.activeIndex || index < 0 || index >= this.tabs.length) {
      return;
    }
    this.activeIndex = index;
    this.activeIndexChange.emit(index);
    this.tabChange.emit(index);
    this.focusTabButton(index);
  }

  onKeydown(event: KeyboardEvent): void {
    const count = this.tabs.length;
    if (count === 0) {
      return;
    }

    let next = this.activeIndex;

    switch (event.key) {
      case 'ArrowRight':
        next = (this.activeIndex + 1) % count;
        break;
      case 'ArrowLeft':
        next = (this.activeIndex - 1 + count) % count;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = count - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    this.selectTab(next);
  }

  private focusTabButton(index: number): void {
    const el = this.tabListRef?.nativeElement;
    if (!el) {
      return;
    }
    const buttons = el.querySelectorAll<HTMLButtonElement>('button[role="tab"]');
    buttons[index]?.focus();
  }
}
