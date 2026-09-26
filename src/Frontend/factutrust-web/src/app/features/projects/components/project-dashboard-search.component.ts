import {
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  inject,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  Subject,
  Subscription,
  debounceTime,
  distinctUntilChanged,
  switchMap,
  of,
  catchError
} from 'rxjs';
import { ProjectApiService, ProjectSearchResult } from '../project-api.service';

type ProjectSearchKind = 'Project' | 'Task' | 'Attachment';

@Component({
  selector: 'app-project-dashboard-search',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="proj-dash-search" [class.proj-dash-search--open]="dropdownOpen()">
      <div class="proj-dash-search__wrap" #inputWrap>
        <i class="fa-solid fa-magnifying-glass proj-dash-search__icon" aria-hidden="true"></i>
        <input
          #searchInput
          type="search"
          class="proj-dash-search__input"
          placeholder="Rechercher un projet, une tâche, un document…" i18n-placeholder="Rechercher un projet, une tâche, un document…"
          [(ngModel)]="query"
          (focus)="onFocus()"
          (input)="onQueryInput()"
          (keydown)="onInputKeydown($event)"
          role="combobox"
          aria-autocomplete="list"
          [attr.aria-expanded]="dropdownOpen()"
          aria-label="Rechercher un projet, une tâche ou un document" i18n-aria-label="Rechercher un projet, une tâche ou un document" />
        <kbd class="proj-dash-search__hint" aria-hidden="true" i18n="@@projects.components.ctrl.k.769b0d96">Ctrl+K</kbd>
      </div>

      @if (dropdownOpen()) {
        <div class="proj-dash-search__dropdown" role="listbox">
          @if (loading()) {
            <div class="proj-dash-search__empty" i18n="@@projects.components.recherche.en.cours.a16747f0">Recherche en cours…</div>
          } @else if (query.trim().length < 2) {
            <div class="proj-dash-search__empty" i18n="@@projects.components.saisissez.au.moins.2.caracteres.4196f7ef">Saisissez au moins 2 caractères</div>
          } @else if (groupedResults().length === 0) {
            <div class="proj-dash-search__empty" i18n="@@projects.components.aucun.resultat.dans.vos.projets.af8cf1ea">Aucun résultat dans vos projets</div>
          } @else {
            @for (group of groupedResults(); track group.label) {
              <div class="proj-dash-search__group">
                <div class="proj-dash-search__group-label">{{ group.label }}</div>
                @for (item of group.items; track item.id + item.kind) {
                  <button
                    type="button"
                    class="proj-dash-search__item"
                    [class.proj-dash-search__item--active]="item.id === activeId()"
                    (click)="select(item)"
                    (mouseenter)="activeId.set(item.id)"
                    role="option">
                    <i [class]="iconFor(item)" aria-hidden="true"></i>
                    <span class="proj-dash-search__item-text">
                      <span class="proj-dash-search__item-title">{{ item.title }}</span>
                      @if (item.subtitle) {
                        <span class="proj-dash-search__item-sub">{{ item.subtitle }}</span>
                      }
                    </span>
                  </button>
                }
              </div>
            }
          }
        </div>
      }
    </div>
  `
})
export class ProjectDashboardSearchComponent implements OnInit, OnDestroy {
  private readonly api = inject(ProjectApiService);
  private readonly router = inject(Router);
  private readonly query$ = new Subject<string>();
  private sub?: Subscription;

  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;
  @ViewChild('inputWrap') inputWrap?: ElementRef<HTMLElement>;

  query = '';
  readonly loading = signal(false);
  readonly dropdownOpen = signal(false);
  readonly results = signal<ProjectSearchResult[]>([]);
  readonly activeId = signal<string | null>(null);

  readonly groupedResults = computed(() => {
    const groups = new Map<string, ProjectSearchResult[]>();
    for (const item of this.results()) {
      const label = this.groupLabel(item);
      const list = groups.get(label) ?? [];
      list.push(item);
      groups.set(label, list);
    }
    const order = ['Projets', 'Tâches', 'Documents'];
    return order
      .filter(label => groups.has(label))
      .map(label => ({ label, items: groups.get(label)! }));
  });

  ngOnInit(): void {
    this.sub = this.query$.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      switchMap(q => {
        const trimmed = q.trim();
        if (trimmed.length < 2) {
          this.loading.set(false);
          this.results.set([]);
          return of(null);
        }
        this.loading.set(true);
        return this.api.search(trimmed).pipe(catchError(() => of(null)));
      })
    ).subscribe(res => {
      this.loading.set(false);
      if (res?.success && res.data) {
        this.results.set(res.data.results);
        this.activeId.set(res.data.results[0]?.id ?? null);
      } else if (res === null && this.query.trim().length < 2) {
        this.results.set([]);
        this.activeId.set(null);
      } else {
        this.results.set([]);
        this.activeId.set(null);
      }
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(event: KeyboardEvent): void {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return;
    if (!this.router.url.includes('/projects/dashboard')) return;
    event.preventDefault();
    event.stopPropagation();
    this.focusInput();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.dropdownOpen()) return;
    const target = event.target as Node;
    if (this.inputWrap?.nativeElement.contains(target)) return;
    this.dropdownOpen.set(false);
  }

  focusInput(): void {
    this.dropdownOpen.set(true);
    queueMicrotask(() => {
      const el = this.searchInput?.nativeElement;
      el?.focus();
      el?.select();
    });
  }

  onFocus(): void {
    this.dropdownOpen.set(true);
  }

  onQueryInput(): void {
    this.dropdownOpen.set(true);
    this.query$.next(this.query);
    if (this.query.trim().length < 2) {
      this.loading.set(false);
      this.results.set([]);
    }
  }

  onInputKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.dropdownOpen.set(false);
      return;
    }
    const flat = this.groupedResults().flatMap(g => g.items);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.moveSelection(1, flat);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.moveSelection(-1, flat);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const active = flat.find(r => r.id === this.activeId());
      if (active) this.select(active);
    }
  }

  select(result: ProjectSearchResult): void {
    const kind = this.normalizeKind(result.kind);
    if (kind === 'Project') {
      void this.router.navigate(['/projects', result.projectId]);
    } else if (kind === 'Task') {
      void this.router.navigate(['/projects', result.projectId, 'tasks', result.id]);
    } else {
      void this.router.navigate(['/projects', result.projectId], { queryParams: { tab: 'files' } });
    }
    this.dropdownOpen.set(false);
    this.query = '';
    this.results.set([]);
  }

  iconFor(item: ProjectSearchResult): string {
    const kind = this.normalizeKind(item.kind);
    if (kind === 'Task') return 'fa-solid fa-list-check';
    if (kind === 'Attachment') return 'fa-solid fa-file';
    return 'fa-solid fa-briefcase';
  }

  private moveSelection(delta: number, items: ProjectSearchResult[]): void {
    if (!items.length) return;
    const current = this.activeId();
    let idx = items.findIndex(r => r.id === current);
    if (idx < 0) idx = 0;
    else idx = (idx + delta + items.length) % items.length;
    this.activeId.set(items[idx].id);
  }

  private groupLabel(item: ProjectSearchResult): string {
    const kind = this.normalizeKind(item.kind);
    if (kind === 'Task') return 'Tâches';
    if (kind === 'Attachment') return 'Documents';
    return 'Projets';
  }

  private normalizeKind(kind: ProjectSearchResult['kind']): ProjectSearchKind {
    if (kind === 1 || kind === 'Task') return 'Task';
    if (kind === 2 || kind === 'Attachment') return 'Attachment';
    return 'Project';
  }
}
