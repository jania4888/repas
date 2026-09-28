import {
  Component,
  ElementRef,
  HostListener,
  Input,
  OnDestroy,
  OnInit,
  Renderer2,
  ViewChild,
  effect,
  inject,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { GlobalSearchResult, GlobalSearchService } from '../../services/global-search.service';
import { AuthService } from '../../services/auth.service';
import { AiAssistantShellService } from '@features/ai-assistant/services/ai-assistant-shell.service';
import { canUseAiAssistant } from '@features/ai-assistant/utils/ai-access.util';

export interface GlobalSearchDropdownPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

/** Pure positioning helper — unit-testable without DOM portal. */
export function computeGlobalSearchDropdownPosition(
  inputRect: Pick<DOMRect, 'left' | 'bottom' | 'width'>,
  options: {
    secondaryNavRect?: Pick<DOMRect, 'bottom' | 'height'> | null;
    viewportWidth?: number;
    viewportHeight?: number;
    gap?: number;
    viewportPad?: number;
    maxHeightCap?: number;
    secondaryNavMinWidth?: number;
  } = {}
): GlobalSearchDropdownPosition {
  const gap = options.gap ?? 8;
  const viewportPad = options.viewportPad ?? 8;
  const maxHeightCap = options.maxHeightCap ?? 420;
  const secondaryNavMinWidth = options.secondaryNavMinWidth ?? 992;
  const viewportWidth = options.viewportWidth ?? (typeof window !== 'undefined' ? window.innerWidth : 1280);
  const viewportHeight = options.viewportHeight ?? (typeof window !== 'undefined' ? window.innerHeight : 800);

  const navRect = options.secondaryNavRect;
  const navVisible =
    !!navRect && navRect.height > 0 && viewportWidth >= secondaryNavMinWidth;

  const top = navVisible ? navRect!.bottom + gap : inputRect.bottom + gap;
  const maxHeight = Math.max(120, Math.min(maxHeightCap, viewportHeight - top - viewportPad));
  const left = Math.max(viewportPad, inputRect.left);
  const width = Math.min(inputRect.width, viewportWidth - left - viewportPad);

  return { top, left, width, maxHeight };
}

@Component({
  selector: 'app-global-search',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    @if (searchService.isEnabled()) {
      <div class="global-search" [class.global-search--header]="mode === 'header'">
        <div class="global-search__input-wrap" #inputWrap>
          <i class="fa-solid fa-magnifying-glass global-search__icon" aria-hidden="true"></i>
          <input
            #searchInput
            type="search"
            class="global-search__input"
            [class.global-search__input--header]="mode === 'header'"
            [placeholder]="placeholder"
            [(ngModel)]="query"
            (focus)="onFocus()"
            (input)="onQueryChange()"
            (keydown)="onInputKeydown($event)"
            role="combobox"
            aria-autocomplete="list"
            [attr.aria-expanded]="dropdownOpen() || paletteOpen()"
            aria-label="Rechercher" i18n-aria-label="@@core.layout.global-search.global-search.rechercher.91f7d3e9" />
          @if (mode === 'header') {
            <kbd class="global-search__hint" aria-hidden="true" i18n="@@core.layout.global-search.global-search.ctrl.k.769b0d96">Ctrl+K</kbd>
          }
        </div>
      </div>

      @if (dropdownOpen() && mode === 'header' && !paletteOpen()) {
        <div
          #dropdownPanel
          class="global-search__dropdown"
          role="listbox"
          [class.global-search__dropdown--ready]="dropdownReady()"
          [style.top.px]="dropdownPos().top"
          [style.left.px]="dropdownPos().left"
          [style.width.px]="dropdownPos().width"
          [style.max-height.px]="dropdownPos().maxHeight">
          <ng-container *ngTemplateOutlet="resultsTemplate"></ng-container>
        </div>
      }

      @if (paletteOpen()) {
        <div class="global-search__backdrop" (click)="closeAll()" aria-hidden="true"></div>
        <div class="global-search__palette" role="dialog" aria-modal="true" aria-label="Recherche globale" i18n-aria-label="@@core.layout.global-search.global-search.recherche.globale.5de4b3c4">
          <div class="global-search__palette-inner">
            <div class="global-search__input-wrap global-search__input-wrap--palette">
              <i class="fa-solid fa-magnifying-glass global-search__icon" aria-hidden="true"></i>
              <input
                #paletteInput
                type="search"
                class="global-search__input global-search__input--palette"
                placeholder="Rechercher une page, un document, un client…" i18n-placeholder="@@core.layout.global-search.global-search.rechercher.une.page.un.document.un.client.b502d55c"
                [(ngModel)]="query"
                (input)="onQueryChange()"
                (keydown)="onInputKeydown($event)"
                autofocus />
            </div>
            <div class="global-search__palette-results" role="listbox">
              <ng-container *ngTemplateOutlet="resultsTemplate"></ng-container>
            </div>
          </div>
        </div>
      }
    }

    <ng-template #resultsTemplate>
      @if (loading()) {
        <div class="global-search__empty" i18n="@@core.layout.global-search.global-search.recherche.en.cours.a16747f0">Recherche en cours…</div>
      } @else if (displayResults().length === 0) {
        <div class="global-search__empty">
          @if (query.trim().length >= 2) {<ng-container i18n="@@core.layout.global-search.global-search.aucun.resultat.pour.5191921e">
            Aucun résultat pour « {{ query.trim() }} »
          </ng-container>} @else {<ng-container i18n="@@core.layout.global-search.global-search.tapez.pour.rechercher.ou.parcourez.les.r.967f77a8">
            Tapez pour rechercher ou parcourez les raccourcis
          </ng-container>}
        </div>
      } @else {
        @for (group of groupedResults(); track group.label) {
          <div class="global-search__group">
            <div class="global-search__group-label">{{ group.label }}</div>
            @for (item of group.items; track item.id) {
              <button
                type="button"
                class="global-search__item"
                [class.global-search__item--active]="item.id === activeId()"
                (click)="select(item)"
                (mouseenter)="activeId.set(item.id)"
                role="option">
                <i [class]="item.icon.includes('fa-') ? item.icon : 'fa-solid ' + item.icon" aria-hidden="true"></i>
                <span class="global-search__item-text">
                  <span class="global-search__item-title">{{ item.title }}</span>
                  @if (item.subtitle) {
                    <span class="global-search__item-sub">{{ item.subtitle }}</span>
                  }
                </span>
              </button>
            }
          </div>
        }
      }
    </ng-template>
  `,
  styles: [`
    .global-search { position: relative; flex: 1; max-width: 560px; }
    .global-search--header { margin: 0 auto; flex: 1; padding: 0 16px; }
    .global-search__input-wrap { position: relative; display: flex; align-items: center; }
    .global-search__icon { position: absolute; inset-inline-start: 14px; color: var(--color-text-secondary, #64748b); font-size: 14px; pointer-events: none; }
    .global-search__input {
      width: 100%; border: 1px solid var(--color-border-subtle, #e2e8f0); border-radius: 999px;
      padding-block: 10px; padding-inline: 40px 72px; background: rgba(255,255,255,0.9); font-size: 14px;
    }
    .global-search__input--header { min-width: 280px; }
    .global-search__input--palette { border-radius: 12px; padding-inline-start: 40px; font-size: 16px; }
    .global-search__hint {
      position: absolute; inset-inline-end: 12px; font-size: 11px; padding: 2px 6px; border-radius: 6px;
      border: 1px solid var(--color-border-subtle, #e2e8f0); color: var(--color-text-secondary, #64748b); background: #fff;
    }

    /* Mode header — style Cubic minimaliste sur dégradé topbar */
    .global-search--header .global-search__icon {
      color: var(--topbar-fg-muted, rgba(255, 255, 255, 0.75));
    }
    .global-search--header .global-search__input {
      background: transparent;
      border: none;
      border-radius: 0;
      color: var(--topbar-fg, #fff);
      padding-block: 6px; padding-inline: 40px 72px;
    }
    .global-search--header .global-search__input::placeholder {
      color: var(--topbar-fg-muted, rgba(255, 255, 255, 0.75));
    }
    .global-search--header .global-search__input:focus {
      outline: none;
      box-shadow: none;
    }
    .global-search--header .global-search__input-wrap:focus-within {
      background: rgba(255, 255, 255, 0.08);
      border-radius: 4px;
    }
    .global-search--header .global-search__hint {
      border: 1px solid var(--topbar-divider, rgba(255, 255, 255, 0.2));
      color: var(--topbar-fg-muted, rgba(255, 255, 255, 0.75));
      background: transparent;
    }
    /* Body-portaled: fixed under secondary-nav / input; styles stay encapsulated via _ngcontent attrs. */
    .global-search__dropdown {
      position: fixed;
      z-index: var(--z-global-search-dropdown, 1050);
      background: #fff; border: 1px solid var(--color-border-subtle, #e2e8f0); border-radius: 12px;
      box-shadow: 0 16px 40px rgba(15,23,42,0.12); overflow: auto; padding: 8px;
      box-sizing: border-box;
      visibility: hidden;
    }
    .global-search__dropdown--ready { visibility: visible; }
    .global-search__backdrop { position: fixed; inset: 0; background: rgba(15,23,42,0.45); z-index: 1300; }
    .global-search__palette {
      position: fixed; inset: 0; z-index: 1310; display: flex; align-items: flex-start; justify-content: center; padding: 10vh 16px;
    }
    .global-search__palette-inner {
      width: min(640px, 100%); background: rgba(255,255,255,0.96); backdrop-filter: blur(12px);
      border-radius: 16px; border: 1px solid var(--color-border-subtle, #e2e8f0);
      box-shadow: 0 24px 60px rgba(15,23,42,0.18); overflow: hidden;
    }
    .global-search__input-wrap--palette { padding: 16px 16px 8px; }
    .global-search__palette-results { max-height: 60vh; overflow: auto; padding: 0 8px 12px; }
    .global-search__group-label {
      font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
      color: var(--color-text-secondary, #64748b); padding: 8px 10px 4px;
    }
    .global-search__item {
      width: 100%; display: flex; align-items: flex-start; gap: 10px; border: none; background: transparent;
      text-align: start; padding: 10px; border-radius: 10px; cursor: pointer; color: inherit;
    }
    .global-search__item--active, .global-search__item:hover { background: var(--color-primary-50, #eff6ff); }
    .global-search__item i { width: 18px; margin-top: 2px; color: var(--color-primary-600, #2563eb); }
    .global-search__item-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .global-search__item-title { font-weight: 600; font-size: 14px; }
    .global-search__item-sub { font-size: 12px; color: var(--color-text-secondary, #64748b); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .global-search__empty { padding: 16px; color: var(--color-text-secondary, #64748b); font-size: 14px; }
    @media (max-width: 768px) {
      .global-search--header .global-search__input-wrap { display: none; }
      .global-search__hint { display: none; }
    }
  `]
})
export class GlobalSearchComponent implements OnInit, OnDestroy {
  @Input() mode: 'header' | 'mobile' = 'header';
  @Input() placeholder = $localize`:@@core.global-search.ts.rechercher.1d12cdfb:Rechercher…`;
  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;
  @ViewChild('paletteInput') paletteInput?: ElementRef<HTMLInputElement>;
  @ViewChild('inputWrap') inputWrap?: ElementRef<HTMLElement>;

  @ViewChild('dropdownPanel')
  set dropdownPanel(ref: ElementRef<HTMLElement> | undefined) {
    if (ref?.nativeElement) {
      this.attachDropdownToBody(ref.nativeElement);
      requestAnimationFrame(() => this.repositionDropdown());
    } else {
      this.dropdownEl = null;
      this.teardownResizeObserver();
    }
  }

  readonly searchService = inject(GlobalSearchService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly aiShell = inject(AiAssistantShellService);
  private readonly renderer = inject(Renderer2);
  private sub?: Subscription;
  private dropdownEl: HTMLElement | null = null;
  private resizeObserver?: ResizeObserver;
  private repositionRaf = 0;
  private readonly onScrollCapture = (event: Event): void => {
    const target = event.target;
    if (target instanceof Node && this.dropdownEl?.contains(target)) {
      return; // Ignore scrolling inside the results panel itself.
    }
    this.scheduleReposition();
  };

  query = '';
  readonly dropdownOpen = signal(false);
  readonly loading = signal(false);
  readonly displayResults = signal<GlobalSearchResult[]>([]);
  readonly activeId = signal<string | null>(null);
  readonly dropdownPos = signal<GlobalSearchDropdownPosition>({
    top: 0,
    left: 0,
    width: 0,
    maxHeight: 420
  });
  readonly dropdownReady = signal(false);

  paletteOpen = this.searchService.paletteOpen;

  constructor() {
    effect(() => {
      if (this.searchService.paletteOpen()) {
        this.dropdownOpen.set(false);
        this.dropdownReady.set(false);
        queueMicrotask(() => this.paletteInput?.nativeElement?.focus());
      }
    });

    effect(() => {
      if (this.dropdownOpen() && this.mode === 'header' && !this.paletteOpen()) {
        queueMicrotask(() => this.ensureResizeObserver());
      } else {
        this.teardownResizeObserver();
      }
    });
  }

  ngOnInit(): void {
    this.sub = this.searchService.documentResults$.subscribe(docs => {
      this.loading.set(false);
      this.displayResults.set(this.searchService.searchAll(this.query, docs));
      this.ensureActiveSelection();
    });
    // Capture phase: shell scrolls inside .midde_cont (does not bubble to window).
    document.addEventListener('scroll', this.onScrollCapture, true);
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    document.removeEventListener('scroll', this.onScrollCapture, true);
    this.teardownResizeObserver();
    this.detachDropdownFromBody();
    if (this.repositionRaf) {
      cancelAnimationFrame(this.repositionRaf);
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.dropdownOpen() || this.paletteOpen()) return;
    const target = event.target as Node;
    if (this.inputWrap?.nativeElement.contains(target)) return;
    if (this.dropdownEl?.contains(target)) return;
    this.dropdownOpen.set(false);
    this.dropdownReady.set(false);
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.scheduleReposition();
  }

  @HostListener('document:keydown', ['$event'])
  onGlobalKeydown(event: KeyboardEvent): void {
    if (!this.searchService.isEnabled()) return;
    const key = event.key;
    if (!key) return;

    const isK = key.toLowerCase() === 'k';
    if ((event.ctrlKey || event.metaKey) && isK) {
      if (this.router.url.includes('/projects/dashboard')) return;
      event.preventDefault();
      this.searchService.openPalette();
      this.dropdownOpen.set(false);
      this.dropdownReady.set(false);
      queueMicrotask(() => this.paletteInput?.nativeElement?.focus());
    }
    if (key === 'Escape') {
      this.closeAll();
    }
  }

  onFocus(): void {
    if (this.mode === 'header') {
      this.dropdownOpen.set(true);
      this.refreshResults();
      requestAnimationFrame(() => this.repositionDropdown());
    }
  }

  onQueryChange(): void {
    this.refreshResults();
    if (this.query.trim().length >= 2) {
      this.loading.set(true);
      this.searchService.requestDocumentSearch(this.query);
    } else {
      this.loading.set(false);
      this.displayResults.set(this.searchService.searchAll(this.query, []));
      this.ensureActiveSelection();
    }
  }

  onInputKeydown(event: KeyboardEvent): void {
    const results = this.displayResults();
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.moveSelection(1, results);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.moveSelection(-1, results);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const active = results.find(r => r.id === this.activeId());
      if (active) this.select(active);
    }
  }

  openPaletteFromMobile(): void {
    this.searchService.openPalette();
  }

  groupedResults(): { label: string; items: GlobalSearchResult[] }[] {
    const groups = new Map<string, GlobalSearchResult[]>();
    for (const item of this.displayResults()) {
      const label = item.group || $localize`:@@core.global-search.ts.autres.2f0dd042:Autres`;
      const list = groups.get(label) ?? [];
      list.push(item);
      groups.set(label, list);
    }
    return Array.from(groups.entries()).map(([label, items]) => ({ label, items }));
  }

  select(result: GlobalSearchResult): void {
    this.searchService.recordSelection(result);
    const nav = this.searchService.parseRouteSelection(result);
    this.closeAll();
    const normalizedRoute =
      nav.route.filter(Boolean).length === 0
        ? '/'
        : `/${nav.route.filter(Boolean).join('/')}`;
    if (
      canUseAiAssistant(this.auth) &&
      this.aiShell.isWorkspaceAiRoute(normalizedRoute)
    ) {
      this.aiShell.openAiGeneralTabFromRoute(normalizedRoute, {
        firmDelegated: this.auth.isAccountingFirm() && this.auth.isDelegatedMode()
      });
      return;
    }
    this.router.navigate(nav.route, { queryParams: nav.queryParams });
  }

  closeAll(): void {
    this.dropdownOpen.set(false);
    this.dropdownReady.set(false);
    this.searchService.closePalette();
  }

  /** Exposed for unit tests. */
  repositionDropdown(): void {
    if (!this.dropdownOpen() || this.mode !== 'header' || this.paletteOpen()) {
      this.dropdownReady.set(false);
      return;
    }
    const wrap = this.inputWrap?.nativeElement;
    if (!wrap) return;

    const inputRect = wrap.getBoundingClientRect();
    const secondaryNav = document.querySelector('app-secondary-nav .secondary-nav') as HTMLElement | null;
    const secondaryNavRect = secondaryNav?.getBoundingClientRect() ?? null;

    this.dropdownPos.set(
      computeGlobalSearchDropdownPosition(inputRect, {
        secondaryNavRect,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight
      })
    );
    this.dropdownReady.set(true);
  }

  private attachDropdownToBody(el: HTMLElement): void {
    this.dropdownEl = el;
    if (el.parentElement !== document.body) {
      this.renderer.appendChild(document.body, el);
    }
  }

  private detachDropdownFromBody(): void {
    if (this.dropdownEl?.parentElement === document.body) {
      this.renderer.removeChild(document.body, this.dropdownEl);
    }
    this.dropdownEl = null;
  }

  private scheduleReposition(): void {
    if (!this.dropdownOpen()) return;
    if (this.repositionRaf) cancelAnimationFrame(this.repositionRaf);
    this.repositionRaf = requestAnimationFrame(() => {
      this.repositionRaf = 0;
      this.repositionDropdown();
    });
  }

  private ensureResizeObserver(): void {
    if (typeof ResizeObserver === 'undefined') return;
    const wrap = this.inputWrap?.nativeElement;
    if (!wrap) return;
    if (!this.resizeObserver) {
      this.resizeObserver = new ResizeObserver(() => this.scheduleReposition());
    }
    this.resizeObserver.disconnect();
    this.resizeObserver.observe(wrap);
  }

  private teardownResizeObserver(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
  }

  private refreshResults(): void {
    if (this.query.trim().length < 2) {
      this.displayResults.set(this.searchService.searchAll(this.query, []));
      this.ensureActiveSelection();
    } else {
      this.displayResults.set(this.searchService.searchNavigation(this.query));
      this.ensureActiveSelection();
    }
  }

  private moveSelection(delta: number, results: GlobalSearchResult[]): void {
    if (!results.length) return;
    const idx = results.findIndex(r => r.id === this.activeId());
    const next = idx < 0 ? 0 : Math.max(0, Math.min(results.length - 1, idx + delta));
    this.activeId.set(results[next].id);
  }

  private ensureActiveSelection(): void {
    const results = this.displayResults();
    if (!results.length) {
      this.activeId.set(null);
      return;
    }
    if (!results.some(r => r.id === this.activeId())) {
      this.activeId.set(results[0].id);
    }
  }
}
