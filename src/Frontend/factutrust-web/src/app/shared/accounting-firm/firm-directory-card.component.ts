import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AccountingFirmDirectoryItem } from '@core/services/firm-assignment.service';
import {
  LANGUAGE_OPTIONS,
  PRACTICE_AREA_OPTIONS,
  TEAM_SIZE_OPTIONS,
  firmCodeLabel,
  firmInitials
} from './firm-directory.labels';

@Component({
  selector: 'app-firm-directory-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (firm(); as item) {
      <article
        class="fdc"
        [class.fdc--selected]="selected()"
        [attr.aria-pressed]="selectable() ? selected() : null"
        [attr.tabindex]="selectable() ? 0 : null"
        [attr.role]="selectable() ? 'button' : null"
        (click)="onChoose()"
        (keydown.enter)="onChoose()"
        (keydown.space)="$event.preventDefault(); onChoose()">
        <div class="fdc__head">
          <span class="fdc__avatar" aria-hidden="true">{{ initials(item.displayName) }}</span>
          <div class="fdc__identity">
            <h3 class="fdc__name">{{ item.displayName }}</h3>
            <p class="fdc__place">
              <i class="pi pi-map-marker" aria-hidden="true"></i>
              {{ item.city }}{{ item.city && item.governorate ? ', ' : '' }}{{ item.governorate }}
            </p>
          </div>
        </div>

        @if (item.sameGovernorate) {
          <p class="fdc__match">
            <i class="pi pi-check-circle" aria-hidden="true"></i>
            Même gouvernorat
          </p>
        }

        @if (chips(item).length) {
          <ul class="fdc__chips">
            @for (chip of chips(item); track chip) {
              <li>{{ chip }}</li>
            }
            @if (extraCount(item) > 0) {
              <li class="fdc__more">+{{ extraCount(item) }}</li>
            }
          </ul>
        }

        <p class="fdc__meta">
          @if (item.languages?.length) {
            <span>{{ languageLabels(item) }}</span>
          }
          @if (item.acceptsRemote) {
            <span i18n="@@shared.accounting-firm.firm-directory-card.accepte.le.distanciel.eabce959">Accepte le distanciel</span>
          }
          @if (item.teamSizeBand) {
            <span>{{ teamLabel(item.teamSizeBand) }}</span>
          }
          @if (item.yearsOfExperience != null) {
            <span>{{ item.yearsOfExperience }} ans d’expérience</span>
          }
        </p>

        @if (item.description) {
          <p class="fdc__desc">{{ item.description }}</p>
        }

        @if (item.professionalRegistrationNumber) {
          <p class="fdc__reg">N° d’inscription : {{ item.professionalRegistrationNumber }}</p>
        }

        @if (selectable()) {
          <span class="fdc__cta">{{ selected() ? 'Cabinet choisi' : 'Choisir ce cabinet' }}</span>
        }
      </article>
    }
  `,
  styles: [`
    .fdc {
      display: flex;
      flex-direction: column;
      gap: 10px;
      height: 100%;
      padding: 16px;
      background: var(--color-surface, #fff);
      border: 1px solid var(--color-border-subtle, #e2e8f0);
      border-radius: var(--radius-xl, 16px);
      text-align: left;
      color: inherit;
    }
    .fdc[role="button"] { cursor: pointer; width: 100%; font: inherit; }
    .fdc[role="button"]:hover { border-color: var(--color-primary-300, #93c5fd); }
    .fdc[role="button"]:focus-visible {
      outline: 2px solid var(--color-primary-600, #2563eb);
      outline-offset: 2px;
    }
    .fdc--selected { border-color: var(--color-primary-600, #2563eb); box-shadow: 0 0 0 1px var(--color-primary-600, #2563eb); }
    .fdc__head { display: flex; gap: 12px; align-items: flex-start; }
    .fdc__avatar {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      flex-shrink: 0;
      border-radius: 12px;
      background: var(--color-primary-50, #eff6ff);
      color: var(--color-primary-700, #1d4ed8);
      font-weight: 700;
    }
    .fdc__name { margin: 0; font-size: 1rem; font-weight: 650; color: var(--color-text-primary, #0f172a); }
    .fdc__place { margin: 2px 0 0; font-size: 0.85rem; color: var(--color-text-secondary, #64748b); }
    .fdc__place i { margin-right: 4px; }
    .fdc__match {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin: 0;
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--color-primary-800, #1e40af);
    }
    .fdc__chips { display: flex; flex-wrap: wrap; gap: 6px; list-style: none; margin: 0; padding: 0; }
    .fdc__chips li {
      padding: 2px 8px;
      border-radius: 999px;
      background: var(--color-neutral-100, #f1f5f9);
      color: var(--color-text-primary, #0f172a);
      font-size: 0.75rem;
    }
    .fdc__meta { display: flex; flex-wrap: wrap; gap: 8px 12px; margin: 0; font-size: 0.8rem; color: var(--color-text-secondary, #475569); }
    .fdc__desc {
      margin: 0;
      font-size: 0.875rem;
      color: var(--color-text-secondary, #334155);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .fdc__reg { margin: 0; font-size: 0.75rem; color: var(--color-text-tertiary, #64748b); }
    .fdc__cta { margin-top: auto; font-size: 0.85rem; font-weight: 600; color: var(--color-primary-700, #1d4ed8); }
  `]
})
export class FirmDirectoryCardComponent {
  readonly firm = input.required<AccountingFirmDirectoryItem>();
  readonly selected = input(false);
  readonly selectable = input(false);
  readonly choose = output<AccountingFirmDirectoryItem>();

  initials(name: string): string {
    return firmInitials(name);
  }

  chips(item: AccountingFirmDirectoryItem): string[] {
    const areas = item.practiceAreas ?? [];
    return areas.slice(0, 3).map(code => firmCodeLabel(PRACTICE_AREA_OPTIONS, code));
  }

  extraCount(item: AccountingFirmDirectoryItem): number {
    return Math.max(0, (item.practiceAreas?.length ?? 0) - 3);
  }

  languageLabels(item: AccountingFirmDirectoryItem): string {
    return (item.languages ?? []).map(code => firmCodeLabel(LANGUAGE_OPTIONS, code)).join(', ');
  }

  teamLabel(code: string): string {
    return firmCodeLabel(TEAM_SIZE_OPTIONS, code);
  }

  onChoose(): void {
    if (!this.selectable()) return;
    this.choose.emit(this.firm());
  }
}
