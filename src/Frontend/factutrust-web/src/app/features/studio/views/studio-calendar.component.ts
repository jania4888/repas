import {
  ChangeDetectionStrategy, Component, ViewChild,
  computed, effect, inject, input, output, signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { SelectButtonModule } from 'primeng/selectbutton';
import { Popover, PopoverModule } from 'primeng/popover';
import { ViewportService } from '@core/services/viewport.service';
import { CustomField } from '../studio.models';
import { RecordViewCalendar, RecordViewCalendarEventDto } from './studio-record-views.models';
import { STUDIO_RUNTIME_LABELS } from '../shared/studio-runtime-labels';
import {
  CalendarMode, colorScaleIndex, eventsForDay, isMultiDay, isSameDay,
  parseIsoDate, rangeDays, rangeForMode, shiftAnchor, toIsoDate
} from './studio-calendar.util';

const DOW_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const PALETTE_SIZE = 6;
const MAX_INLINE_EVENTS = 3;
const NARROW_QUERY = '(max-width: 767px)';

interface DayVm {
  date: Date;
  iso: string;
  inCurrentMonth: boolean;
  isToday: boolean;
  isWeekend: boolean;
  events: RecordViewCalendarEventDto[];
  visibleEvents: RecordViewCalendarEventDto[];
  overflow: number;
}

interface LegendItem {
  value: string;
  label: string;
  colorIndex: number;
}

/**
 * Calendrier des vues enregistrées (2.5b). Aucune fonction de glisser-déposer (exclue du périmètre) :
 * navigation Mois/Semaine, plage envoyée au backend en ISO `yyyy-MM-dd` (`RECORD_VIEW_LIMITS.maxCalendarDays`
 * = 92 j), bascule forcée en semaine sous 768px, popover au clic sur un événement.
 */
@Component({
  selector: 'app-studio-calendar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, ButtonModule, SelectButtonModule, PopoverModule],
  template: `
    @if (truncated()) {
      <div class="runner-banner" role="status">
        <i class="fa-solid fa-circle-info"></i>
        <span>{{ labels.calendar.truncated }}</span>
      </div>
    }

    <div class="cal">
      <div class="cal__toolbar">
        <div class="cal__nav">
          <button type="button" class="p-button p-button-text p-button-sm" (click)="go(-1)" aria-label="Période précédente">
            <i class="fa-solid fa-chevron-left"></i>
          </button>
          <button type="button" class="p-button p-button-text p-button-sm" (click)="goToday()">{{ labels.calendar.today }}</button>
          <button type="button" class="p-button p-button-text p-button-sm" (click)="go(1)" aria-label="Période suivante">
            <i class="fa-solid fa-chevron-right"></i>
          </button>
        </div>
        <h3 class="cal__title" aria-live="polite">{{ title() }}</h3>
        @if (!narrow()) {
          <p-selectbutton
            [options]="modeOptions"
            [ngModel]="mode()"
            (ngModelChange)="setMode($event)"
            optionLabel="label"
            optionValue="value"
            [attr.aria-label]="'Basculer entre vue mois et semaine'">
          </p-selectbutton>
        }
      </div>

      @if (legend().length > 0) {
        <div class="cal__legend">
          <span class="cal__legend-title">Légende</span>
          @for (item of legend(); track item.value) {
            <span class="cal__legend-item">
              <span class="swatch" [class]="'sw-' + item.colorIndex"></span>
              {{ item.label }}
            </span>
          }
        </div>
      }

      @if (effectiveMode() === 'month') {
        <div class="cal-grid" role="grid" [attr.aria-label]="'Grille du mois, ' + title()">
          <div class="cal-grid__dow" role="row">
            @for (d of dowLabels; track d) {
              <span role="columnheader">{{ d }}</span>
            }
          </div>
          @for (week of weeks(); track $index) {
            <div class="cal-grid__row" role="row">
              @for (day of week; track day.iso) {
                <div
                  class="cal-day"
                  role="gridcell"
                  [class.cal-day--outside]="!day.inCurrentMonth"
                  [class.cal-day--weekend]="day.isWeekend"
                  [class.cal-day--today]="day.isToday">
                  <span class="cal-day__num">{{ day.date.getDate() }}</span>
                  @for (ev of day.visibleEvents; track ev.recordId) {
                    <button
                      type="button"
                      class="cal-ev"
                      [class]="'cal-ev--color-' + colorIndex(ev)"
                      [class.cal-ev--span]="isMulti(ev)"
                      aria-haspopup="dialog"
                      [attr.aria-label]="eventAriaLabel(ev)"
                      (click)="openEvent($event, ev)">
                      {{ ev.title }}
                    </button>
                  }
                  @if (day.overflow > 0) {
                    <button type="button" class="cal-day__more" (click)="toggleExpand(day.iso)">
                      +{{ day.overflow }} autre(s)
                    </button>
                  }
                </div>
              }
            </div>
          }
        </div>
      } @else {
        <div class="week-grid" role="grid" [attr.aria-label]="'Grille de la semaine, ' + title()">
          @for (day of weekDays(); track day.iso) {
            <div class="week-day" role="row" [class.week-day--weekend]="day.isWeekend" [class.week-day--today]="day.isToday">
              <div class="week-day__head" role="columnheader">
                <span class="week-day__dow">{{ dowLabels[($index)] }}</span>
                <span class="week-day__date">{{ day.date.getDate() }}</span>
              </div>
              <div class="week-day__body" role="gridcell">
                @for (ev of day.visibleEvents; track ev.recordId) {
                  <button
                    type="button"
                    class="cal-ev"
                    [class]="'cal-ev--color-' + colorIndex(ev)"
                    aria-haspopup="dialog"
                    [attr.aria-label]="eventAriaLabel(ev)"
                    (click)="openEvent($event, ev)">
                    {{ ev.title }}
                    @if (colorLabelOf(ev)) {
                      <small>{{ colorLabelOf(ev) }}</small>
                    }
                  </button>
                }
                @if (day.overflow > 0) {
                  <button type="button" class="cal-day__more" (click)="toggleExpand(day.iso)">
                    +{{ day.overflow }} autre(s)
                  </button>
                }
              </div>
            </div>
          }
        </div>
      }
    </div>

    <p-popover #eventPopover styleClass="studio-theme">
      @if (selectedEvent()) {
        <div class="cal-popover">
          <h4>{{ selectedEvent()!.title }}</h4>
          <p>{{ formatEventDates(selectedEvent()!) }}</p>
          @if (colorFieldLabel()) {
            <p class="cal-popover__color">{{ colorFieldLabel() }} : {{ selectedColorLabel() }}</p>
          }
          <button type="button" class="p-button p-button-sm" (click)="openRecord()">{{ labels.calendar.open }}</button>
        </div>
      }
    </p-popover>
  `,
  styleUrl: './studio-calendar.component.scss'
})
export class StudioCalendarComponent {
  private readonly router = inject(Router);

  readonly entityKey = input('');
  readonly calendar = input<RecordViewCalendar | null>(null);
  readonly events = input<RecordViewCalendarEventDto[]>([]);
  readonly allFields = input<CustomField[]>([]);
  readonly truncated = input(false);
  readonly loading = input(false);

  readonly rangeChange = output<{ rangeStart: string; rangeEnd: string }>();

  @ViewChild('eventPopover') private popover?: Popover;

  protected readonly labels = STUDIO_RUNTIME_LABELS;
  protected readonly dowLabels = DOW_LABELS;
  protected readonly modeOptions = [
    { label: this.labels.calendar.month, value: 'month' as CalendarMode },
    { label: this.labels.calendar.week, value: 'week' as CalendarMode }
  ];

  protected readonly mode = signal<CalendarMode>('month');
  protected readonly anchor = signal<Date>(new Date());
  /** 4.6T2 (D-44-56) : bascule semaine sous 768 px via ViewportService (seuil inchangé). */
  protected readonly narrow = inject(ViewportService).matches(NARROW_QUERY);
  protected readonly expanded = signal<Record<string, boolean>>({});
  protected readonly selectedEvent = signal<RecordViewCalendarEventDto | null>(null);

  protected readonly effectiveMode = computed<CalendarMode>(() => this.narrow() ? 'week' : this.mode());
  protected readonly range = computed(() => rangeForMode(this.effectiveMode(), this.anchor()));

  private lastEmittedRange: string | null = null;

  protected readonly title = computed(() => {
    const r = this.range();
    if (this.effectiveMode() === 'week') {
      return `${r.start.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} – ${r.end.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}`;
    }
    return this.anchor().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  });

  protected readonly weeks = computed<DayVm[][]>(() => {
    const days = rangeDays(this.range()).map(d => this.toDayVm(d));
    const chunks: DayVm[][] = [];
    for (let i = 0; i < days.length; i += 7) chunks.push(days.slice(i, i + 7));
    return chunks;
  });

  protected readonly weekDays = computed<DayVm[]>(() => rangeDays(this.range()).map(d => this.toDayVm(d)));

  protected readonly legend = computed<LegendItem[]>(() => {
    const key = this.calendar()?.colorFieldKey;
    const seen = new Map<string, LegendItem>();
    for (const ev of this.events()) {
      if (ev.colorValue === null || ev.colorValue === undefined || ev.colorValue === '') continue;
      if (seen.has(ev.colorValue)) continue;
      seen.set(ev.colorValue, {
        value: ev.colorValue,
        label: this.resolveColorLabel(ev.colorValue, key),
        colorIndex: colorScaleIndex(ev.colorValue, PALETTE_SIZE)
      });
    }
    return Array.from(seen.values());
  });

  protected readonly colorFieldLabel = computed(() => {
    const key = this.calendar()?.colorFieldKey;
    if (!key) return null;
    return this.allFields().find(f => f.key === key)?.label ?? key;
  });

  protected readonly selectedColorLabel = computed(() => {
    const ev = this.selectedEvent();
    if (!ev?.colorValue) return '';
    return this.resolveColorLabel(ev.colorValue, this.calendar()?.colorFieldKey);
  });

  constructor() {
    effect(() => {
      const r = this.range();
      const key = `${toIsoDate(r.start)}|${toIsoDate(r.end)}`;
      if (key !== this.lastEmittedRange) {
        this.lastEmittedRange = key;
        this.rangeChange.emit({ rangeStart: toIsoDate(r.start), rangeEnd: toIsoDate(r.end) });
      }
    });
  }

  setMode(mode: CalendarMode): void {
    this.mode.set(mode);
  }

  go(direction: 1 | -1): void {
    this.anchor.set(shiftAnchor(this.anchor(), this.effectiveMode(), direction));
  }

  goToday(): void {
    this.anchor.set(new Date());
  }

  toggleExpand(iso: string): void {
    this.expanded.update(m => ({ ...m, [iso]: !m[iso] }));
  }

  colorIndex(ev: RecordViewCalendarEventDto): number {
    return ev.colorValue ? colorScaleIndex(ev.colorValue, PALETTE_SIZE) : PALETTE_SIZE;
  }

  isMulti(ev: RecordViewCalendarEventDto): boolean {
    return isMultiDay(ev);
  }

  openEvent(event: Event, ev: RecordViewCalendarEventDto): void {
    this.selectedEvent.set(ev);
    this.popover?.toggle(event);
  }

  openRecord(): void {
    const ev = this.selectedEvent();
    const key = this.entityKey();
    if (!ev || !key) return;
    this.popover?.hide();
    this.router.navigate(['/studio/d', key, ev.recordId, 'edit']);
  }

  formatEventDates(ev: RecordViewCalendarEventDto): string {
    const start = parseIsoDate(ev.start).toLocaleDateString('fr-FR');
    if (!ev.end || ev.end === ev.start) return `le ${start}`;
    return `du ${start} au ${parseIsoDate(ev.end).toLocaleDateString('fr-FR')}`;
  }

  /** Libellé accessible d'un événement : titre + dates (+ couleur si configurée). */
  eventAriaLabel(ev: RecordViewCalendarEventDto): string {
    const color = this.resolveColorLabel(ev.colorValue ?? '', this.calendar()?.colorFieldKey);
    return color ? `${ev.title}, ${color}, ${this.formatEventDates(ev)}` : `${ev.title}, ${this.formatEventDates(ev)}`;
  }

  /** Libellé de la valeur de couleur d'un événement (option du champ `colorFieldKey`). */
  colorLabelOf(ev: RecordViewCalendarEventDto): string {
    return this.resolveColorLabel(ev.colorValue ?? '', this.calendar()?.colorFieldKey);
  }

  private toDayVm(date: Date): DayVm {
    const iso = toIsoDate(date);
    const all = eventsForDay(this.events(), date);
    const expanded = this.expanded()[iso] ?? false;
    const visible = expanded ? all : all.slice(0, MAX_INLINE_EVENTS);
    return {
      date,
      iso,
      inCurrentMonth: date.getMonth() === this.anchor().getMonth(),
      isToday: isSameDay(date, new Date()),
      isWeekend: date.getDay() === 0 || date.getDay() === 6,
      events: all,
      visibleEvents: visible,
      overflow: expanded ? 0 : Math.max(0, all.length - MAX_INLINE_EVENTS)
    };
  }

  private resolveColorLabel(value: string, fieldKey?: string | null): string {
    if (!fieldKey) return value;
    const field = this.allFields().find(f => f.key === fieldKey);
    const opt = field?.options?.find(o => o.value === value);
    return opt?.label ?? value;
  }
}
