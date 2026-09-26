import { Component, EventEmitter, Input, Output, computed, signal, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  PowerPointTemplate,
  PowerPointTemplateInfo,
  PowerPointThemeCategory,
  PowerPointThemeEngine
} from '../../models/ai-chat.models';

type CategoryFilter = 'all' | PowerPointThemeCategory;

interface FilterChip {
  id: CategoryFilter;
  label: string;
}

/**
 * Dokie-style theme gallery: 16:9 thumbnail previews, search, category filters.
 */
@Component({
  selector: 'app-powerpoint-theme-picker',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="ppt-theme-picker">
      <div class="ppt-theme-toolbar">
        <label class="ppt-theme-search">
          <span class="visually-hidden" i18n="@@ai-assistant.components.rechercher.un.theme.85517ba8">Rechercher un thème</span>
          <input
            type="search"
            [value]="searchQuery()"
            (input)="onSearchInput($event)"
            placeholder="Rechercher un thème…" i18n-placeholder="Rechercher un thème…"
            autocomplete="off"
            aria-label="Rechercher un thème" i18n-aria-label="Rechercher un thème" />
        </label>
        <div class="ppt-theme-filters" role="toolbar" aria-label="Filtrer les thèmes" i18n-aria-label="Filtrer les thèmes">
          @for (chip of filterChips; track chip.id) {
            <button
              type="button"
              class="ppt-theme-filter"
              [class.active]="activeFilter() === chip.id"
              [attr.aria-pressed]="activeFilter() === chip.id"
              (click)="setFilter(chip.id)">
              {{ chip.label }}
            </button>
          }
        </div>
      </div>

      @if (filteredTemplates().length === 0) {
        <p class="ppt-theme-empty" i18n="@@ai-assistant.components.aucun.theme.ne.correspond.a.votre.recherche.c23ce894">Aucun thème ne correspond à votre recherche.</p>
      } @else {
        <div
          class="ppt-theme-grid"
          role="radiogroup"
          aria-label="Thème visuel de la présentation" i18n-aria-label="Thème visuel de la présentation"
          (keydown)="onGridKeydown($event)">
          @for (tpl of filteredTemplates(); track tpl.id; let i = $index) {
            <button
              type="button"
              class="ppt-theme-card"
              role="radio"
              [attr.aria-checked]="selected === tpl.id"
              [class.selected]="selected === tpl.id"
              [attr.data-index]="i"
              [attr.aria-label]="tpl.name + ' — ' + tpl.description"
              (click)="selectTheme(tpl.id)"
              (focus)="focusedIndex.set(i)">
              <div class="ppt-theme-preview-wrap">
                @if (effectiveThumbnailUrl(tpl); as src) {
                  <img
                    class="ppt-theme-thumb"
                    [src]="src"
                    [alt]="'Aperçu du thème ' + tpl.name"
                    loading="lazy"
                    decoding="async"
                    (error)="onThumbnailError(tpl.key)" />
                } @else {
                  <div
                    class="ppt-theme-preview ppt-theme-preview-fallback"
                    [style.background]="previewBackground(tpl)"
                    [style.--title-color]="titleColor(tpl)"
                    [style.--body-color]="bodyColor(tpl)"
                    [style.--link-color]="tpl.linkColorHex"
                    [style.--title-font]="tpl.titleFontFamily"
                    [style.--body-font]="tpl.bodyFontFamily">
                    <span class="ppt-theme-preview-title" i18n="@@ai-assistant.components.titre.eb97899a">Titre</span>
                    <span class="ppt-theme-preview-body">
                      Corps et <span class="ppt-theme-preview-link" i18n="@@ai-assistant.components.lien.80bf0c8d">lien</span>
                    </span>
                  </div>
                }
                @if (selected === tpl.id) {
                  <span class="ppt-theme-check" aria-hidden="true" i18n="@@ai-assistant.components.text.698a8799">✓</span>
                }
                @if (tpl.engine === PowerPointThemeEngine.Hybrid) {
                  <span class="ppt-theme-badge" aria-hidden="true" i18n="@@ai-assistant.components.master.78f3842f">Master</span>
                }
              </div>
              <span class="ppt-theme-name">{{ tpl.name }}</span>
              <span class="ppt-theme-desc">{{ tpl.description }}</span>
            </button>
          }
        </div>
      }
    </div>
  `,
  styleUrls: ['./powerpoint-theme-picker.component.scss']
})
export class PowerPointThemePickerComponent implements OnChanges {
  @Input({ required: true }) templates: PowerPointTemplateInfo[] = [];
  @Input() selected: PowerPointTemplate = PowerPointTemplate.Standard;
  @Output() selectedChange = new EventEmitter<PowerPointTemplate>();

  protected readonly PowerPointThemeEngine = PowerPointThemeEngine;
  protected readonly activeFilter = signal<CategoryFilter>('all');
  protected readonly searchQuery = signal('');
  protected readonly focusedIndex = signal(0);
  private readonly failedThumbnailKeys = signal<ReadonlySet<string>>(new Set());

  protected readonly filterChips: FilterChip[] = [
    { id: 'all', label: 'Tous' },
    { id: PowerPointThemeCategory.Light, label: 'Clair' },
    { id: PowerPointThemeCategory.Dark, label: 'Sombre' },
    { id: PowerPointThemeCategory.Premium, label: 'Premium' },
    { id: PowerPointThemeCategory.Vibrant, label: 'Coloré' }
  ];

  protected readonly filteredTemplates = computed(() => {
    const filter = this.activeFilter();
    const query = this.searchQuery().trim().toLowerCase();
    let sorted = [...this.templates].sort((a, b) => a.sortOrder - b.sortOrder);

    if (filter !== 'all') {
      sorted = sorted.filter(t => t.category === filter);
    }

    if (query) {
      sorted = sorted.filter(
        t =>
          t.name.toLowerCase().includes(query) ||
          t.description.toLowerCase().includes(query) ||
          t.key.toLowerCase().includes(query)
      );
    }

    return sorted;
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['templates']) {
      this.failedThumbnailKeys.set(new Set());
      this.loadPreviewFonts();
    }
  }

  protected setFilter(filter: CategoryFilter): void {
    this.activeFilter.set(filter);
    this.focusedIndex.set(0);
  }

  protected onSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchQuery.set(value);
    this.focusedIndex.set(0);
  }

  protected selectTheme(id: PowerPointTemplate): void {
    this.selected = id;
    this.selectedChange.emit(id);
  }

  protected effectiveThumbnailUrl(tpl: PowerPointTemplateInfo): string | null {
    if (this.failedThumbnailKeys().has(tpl.key)) {
      return null;
    }
    return tpl.previewThumbnailUrl ?? null;
  }

  protected onThumbnailError(themeKey: string): void {
    const next = new Set(this.failedThumbnailKeys());
    next.add(themeKey);
    this.failedThumbnailKeys.set(next);
  }

  protected previewBackground(tpl: PowerPointTemplateInfo): string {
    return tpl.previewGradientCss ?? tpl.backgroundColorHex;
  }

  protected titleColor(tpl: PowerPointTemplateInfo): string {
    return tpl.isDark ? '#FFFFFF' : tpl.primaryColorHex;
  }

  protected bodyColor(tpl: PowerPointTemplateInfo): string {
    return tpl.onSurfaceColorHex;
  }

  protected onGridKeydown(event: KeyboardEvent): void {
    const list = this.filteredTemplates();
    if (list.length === 0) return;

    const cols = 3;
    let idx = this.focusedIndex();

    switch (event.key) {
      case 'ArrowRight':
        idx = Math.min(idx + 1, list.length - 1);
        break;
      case 'ArrowLeft':
        idx = Math.max(idx - 1, 0);
        break;
      case 'ArrowDown':
        idx = Math.min(idx + cols, list.length - 1);
        break;
      case 'ArrowUp':
        idx = Math.max(idx - cols, 0);
        break;
      case ' ':
      case 'Enter':
        event.preventDefault();
        this.selectTheme(list[idx].id);
        return;
      default:
        return;
    }

    event.preventDefault();
    this.focusedIndex.set(idx);
    this.focusCard(idx);
  }

  private focusCard(index: number): void {
    if (typeof document === 'undefined') return;
    const el = document.querySelector<HTMLElement>(`.ppt-theme-card[data-index="${index}"]`);
    el?.focus();
  }

  private loadPreviewFonts(): void {
    if (typeof document === 'undefined') return;
    const families = new Set<string>();
    for (const tpl of this.templates) {
      if (tpl.titleFontFamily && tpl.titleFontFamily !== 'Inter') {
        families.add(tpl.titleFontFamily.replace(/ /g, '+'));
      }
      if (tpl.bodyFontFamily && tpl.bodyFontFamily !== 'Inter' && tpl.bodyFontFamily !== tpl.titleFontFamily) {
        families.add(tpl.bodyFontFamily.replace(/ /g, '+'));
      }
    }
    if (families.size === 0) return;

    const href = `https://fonts.googleapis.com/css2?${[...families]
      .map(f => `family=${f}:wght@400;600;700`)
      .join('&')}&display=swap`;
    const id = 'ppt-theme-google-fonts';
    if (document.getElementById(id)) return;

    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }
}
