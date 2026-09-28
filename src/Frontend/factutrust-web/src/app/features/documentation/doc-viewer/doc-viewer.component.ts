import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { MarkdownModule } from 'ngx-markdown';
import { DOC_CHAPTERS, getChapterById, DocChapter } from '../doc-chapters';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
@Component({
  selector: 'app-doc-viewer',
  standalone: true,
  imports: [CommonModule, RouterModule, MarkdownModule, BreadcrumbComponent],
  template: `
    <app-breadcrumb [items]="breadcrumbItems()"></app-breadcrumb>

    <div class="doc-layout">
      <nav class="doc-sidebar" aria-label="Navigation documentation" i18n-aria-label="@@documentation.doc-viewer.navigation.documentation.69061820">
        <a routerLink="/documentation" class="doc-sidebar-home">
          <i class="fa fa-home"></i>
          <span i18n="@@documentation.doc-viewer.guide.utilisateur.4808a56f">Guide utilisateur</span>
        </a>
        <ul class="doc-sidebar-list">
          @for (chapter of chapters; track chapter.id) {
            <li>
              <a
                [routerLink]="['/documentation', chapter.id]"
                routerLinkActive="active"
                [routerLinkActiveOptions]="{ exact: false }"
                class="doc-sidebar-link">
                <i [class]="'fa ' + chapter.icon"></i>
                <span>{{ chapter.title }}</span>
              </a>
            </li>
          }
        </ul>
      </nav>

      <main class="doc-content" role="main">
        @if (loading()) {
          <div class="doc-loading">
            <i class="fa fa-spinner fa-spin"></i>
            <p i18n="@@documentation.doc-viewer.chargement.a209b664">Chargement...</p>
          </div>
        } @else if (error()) {
          <div class="doc-error">
            <i class="fa fa-exclamation-triangle"></i>
            <h2 i18n="@@documentation.doc-viewer.document.introuvable.0eec5453">Document introuvable</h2>
            <p>{{ error() }}</p>
            <a routerLink="/documentation" class="doc-back-link" i18n="@@documentation.doc-viewer.retour.au.guide.231431d3">Retour au guide</a>
          </div>
        } @else if (content()) {
          <article class="doc-article markdown-body">
            <markdown [data]="content()!"></markdown>
          </article>
        }
      </main>
    </div>
  `,
  styles: [`
    .doc-layout {
      display: flex;
      gap: var(--spacing-6);
      min-height: 400px;
    }

    .doc-sidebar {
      flex-shrink: 0;
      width: 240px;
      background: var(--color-neutral-50);
      border-radius: var(--radius-xl);
      padding: var(--spacing-4);
      border: 1px solid var(--color-neutral-200);
    }

    .doc-sidebar-home {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      padding: var(--spacing-2) var(--spacing-3);
      color: var(--color-primary-600);
      text-decoration: none;
      font-weight: 600;
      border-radius: var(--radius-md);
      margin-bottom: var(--spacing-4);
      transition: background 0.15s ease;
    }

    .doc-sidebar-home:hover {
      background: var(--color-primary-50);
    }

    .doc-sidebar-list {
      list-style: none;
      padding: 0;
      margin: 0;
    }

    .doc-sidebar-list li {
      margin-bottom: 2px;
    }

    .doc-sidebar-link {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      padding: var(--spacing-2) var(--spacing-3);
      color: var(--color-neutral-700);
      text-decoration: none;
      border-radius: var(--radius-md);
      font-size: 0.9rem;
      transition: background 0.15s ease, color 0.15s ease;
    }

    .doc-sidebar-link:hover {
      background: var(--color-neutral-100);
      color: var(--color-primary-600);
    }

    .doc-sidebar-link.active {
      background: var(--color-primary-50);
      color: var(--color-primary-700);
      font-weight: 500;
    }

    .doc-content {
      flex: 1;
      min-width: 0;
      background: white;
      border-radius: var(--radius-xl);
      padding: var(--spacing-6);
      border: 1px solid var(--color-neutral-200);
    }

    .doc-loading, .doc-error {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 200px;
      gap: var(--spacing-3);
      color: var(--color-neutral-500);
    }

    .doc-error i, .doc-loading i {
      font-size: 2rem;
    }

    .doc-error h2 {
      margin: 0;
      font-size: 1.25rem;
      color: var(--color-neutral-700);
    }

    .doc-back-link {
      margin-top: var(--spacing-2);
      color: var(--color-primary-600);
      text-decoration: none;
    }

    .doc-back-link:hover {
      text-decoration: underline;
    }

    .doc-article {
      max-width: 720px;
    }

    .markdown-body :deep(h1) { font-size: 1.75rem; margin-top: 0; margin-bottom: 1rem; }
    .markdown-body :deep(h2) { font-size: 1.35rem; margin-top: 1.5rem; margin-bottom: 0.75rem; border-bottom: 1px solid var(--color-neutral-200); padding-bottom: 0.25rem; }
    .markdown-body :deep(h3) { font-size: 1.15rem; margin-top: 1.25rem; margin-bottom: 0.5rem; }
    .markdown-body :deep(p) { margin-bottom: 1rem; line-height: 1.6; }
    .markdown-body :deep(ul), .markdown-body :deep(ol) { margin-bottom: 1rem; padding-inline-start: 1.5rem; }
    .markdown-body :deep(table) { width: 100%; border-collapse: collapse; margin-bottom: 1rem; }
    .markdown-body :deep(th), .markdown-body :deep(td) { border: 1px solid var(--color-neutral-200); padding: 0.5rem 0.75rem; text-align: start; }
    .markdown-body :deep(th) { background: var(--color-neutral-50); font-weight: 600; }
    .markdown-body :deep(blockquote) { border-inline-start: 4px solid var(--color-primary-300); padding-inline-start: 1rem; margin: 1rem 0; color: var(--color-neutral-600); }
    .markdown-body :deep(img) { max-width: 100%; height: auto; border-radius: var(--radius-md); }
    .markdown-body :deep(a) { color: var(--color-primary-600); text-decoration: none; }
    .markdown-body :deep(a:hover) { text-decoration: underline; }
    .markdown-body :deep(hr) { border: none; border-top: 1px solid var(--color-neutral-200); margin: 1.5rem 0; }
  `]
})
export class DocViewerComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private http = inject(HttpClient);

  readonly chapters = DOC_CHAPTERS;
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly content = signal<string | null>(null);
  readonly currentChapter = signal<DocChapter | null>(null);

  readonly breadcrumbItems = computed<BreadcrumbItem[]>(() => {
    const chapter = this.currentChapter();
    const items: BreadcrumbItem[] = [
      { label: $localize`:@@documentation.doc-viewer.ts.accueil.a8ff8fd2:Accueil`, route: '/dashboard' },
      { label: $localize`:@@documentation.doc-viewer.ts.documentation.9e9cf322:Documentation`, route: '/documentation' }
    ];
    if (chapter) {
      items.push({ label: chapter.title });
    }
    return items;
  });

  ngOnInit(): void {
    this.route.paramMap.subscribe(params => {
      const id = params.get('chapterId');
      if (id) {
        this.loadChapter(id);
      } else {
        this.loading.set(false);
      }
    });
  }

  private loadChapter(id: string): void {
    const chapter = getChapterById(id);
    if (!chapter) {
      this.loading.set(false);
      this.error.set($localize`:@@documentation.doc-viewer.ts.chapitre.non.trouve.aac43b19:Chapitre non trouvé.`);
      this.currentChapter.set(null);
      return;
    }

    this.currentChapter.set(chapter);
    this.loading.set(true);
    this.error.set(null);

    this.http.get(`assets/docs/${chapter.file}`, { responseType: 'text' }).subscribe({
      next: (text) => {
        const adjustedContent = this.adjustImagePaths(text);
        this.content.set(adjustedContent);
        this.loading.set(false);
      },
      error: () => {
        this.error.set($localize`:@@documentation.doc-viewer.ts.impossible.de.charger.ce.document.2cf67ef2:Impossible de charger ce document.`);
        this.loading.set(false);
      }
    });
  }

  private adjustImagePaths(content: string): string {
    return content.replace(/\]\(\.\.\/screenshots\//g, '](/assets/docs/screenshots/');
  }
}
