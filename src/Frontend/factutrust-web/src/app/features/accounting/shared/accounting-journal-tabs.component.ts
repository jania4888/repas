import { Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TooltipModule } from 'primeng/tooltip';
import {
  AccountingJournalTab,
  AccountingJournalTabChange
} from './accounting-journal-tabs.model';

@Component({
  selector: 'app-accounting-journal-tabs',
  standalone: true,
  imports: [CommonModule, TooltipModule],
  styleUrls: ['./_accounting-tabs.scss'],
  template: `
    <div class="accounting-tabs-wrap">
      <div
        #tabList
        class="accounting-tabs-wrap__list"
        role="tablist"
        [attr.aria-label]="ariaLabel"
        (keydown)="onKeydown($event)">
        @for (tab of tabs; track tab.code; let i = $index) {
          <button
            type="button"
            role="tab"
            class="accounting-tab"
            [class.is-active]="i === activeIndex"
            [attr.aria-selected]="i === activeIndex"
            [attr.tabindex]="i === activeIndex ? 0 : -1"
            [attr.id]="'accounting-journal-tab-' + tab.code"
            [attr.aria-controls]="panelIdPrefix + tab.code"
            [pTooltip]="tab.code + ' — ' + tab.label"
            tooltipPosition="bottom"
            (click)="selectTab(i)">
            <i [class]="tab.icon" aria-hidden="true"></i>
            <span class="accounting-tab__text">
              <span class="accounting-tab__code">{{ tab.code }}</span>
              <span class="accounting-tab__label">{{ tab.label }}</span>
              <span class="accounting-tab__label-short">{{ tab.shortLabel }}</span>
            </span>
          </button>
        }
      </div>
    </div>
  `
})
export class AccountingJournalTabsComponent {
  @Input({ required: true }) tabs!: readonly AccountingJournalTab[];
  @Input() activeIndex = 0;
  @Input() ariaLabel = $localize`:@@accounting.accounting-journal-tabs.ts.journaux.auxiliaires.a7120594:Journaux auxiliaires`;
  @Input() panelIdPrefix = 'sub-journal-panel-';

  @Output() tabChange = new EventEmitter<AccountingJournalTabChange>();

  @ViewChild('tabList') tabListRef?: ElementRef<HTMLElement>;

  selectTab(index: number): void {
    if (index === this.activeIndex || index < 0 || index >= this.tabs.length) {
      return;
    }
    this.tabChange.emit({ index, code: this.tabs[index].code });
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
