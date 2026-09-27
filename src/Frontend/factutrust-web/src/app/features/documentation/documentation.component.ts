import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { DOC_CHAPTERS } from './doc-chapters';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent } from '@shared/components/breadcrumb/breadcrumb.component';

@Component({
  selector: 'app-documentation',
  standalone: true,
  imports: [CommonModule, RouterModule, PageHeaderComponent, BreadcrumbComponent],
  template: `
    <app-breadcrumb [items]="breadcrumbItems"></app-breadcrumb>

    <app-page-header
      title="Documentation" i18n-title="Documentation"
      subtitle="Guide utilisateur pour découvrir et maîtriser InstaFact">
    </app-page-header>

    <div class="doc-intro">
      <p>
        <ng-container i18n="@@documentation.documentation.ce.guide.est.concu.pour.les.c5fa5126"> Ce guide est conçu pour les </ng-container> <strong i18n="@@documentation.documentation.utilisateurs.novices.4eb3b140">utilisateurs novices</strong> et les personnes non-informaticiennes.
        Chaque action est expliquée simplement, avec des captures d'écran pour vous guider.
      </p>
    </div>

    <div class="doc-grid">
      @for (chapter of chapters; track chapter.id) {
        <a [routerLink]="['/documentation', chapter.id]" class="doc-card">
          <div class="doc-card-icon">
            <i [class]="'fa ' + chapter.icon"></i>
          </div>
          <div class="doc-card-content">
            <h3>{{ chapter.title }}</h3>
            @if (chapter.description) {
              <p>{{ chapter.description }}</p>
            }
          </div>
          <i class="pi pi-chevron-right doc-card-arrow"></i>
        </a>
      }
    </div>
  `,
  styles: [`
    .doc-intro {
      margin-bottom: var(--spacing-6);
      padding: var(--spacing-4);
      background: var(--color-primary-50);
      border-radius: var(--radius-xl);
      border-left: 4px solid var(--color-primary-500);
    }

    .doc-intro p {
      margin: 0;
      color: var(--color-neutral-700);
      line-height: 1.6;
    }

    .doc-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: var(--spacing-4);
    }

    .doc-card {
      display: flex;
      align-items: center;
      gap: var(--spacing-4);
      padding: var(--spacing-5);
      background: white;
      border-radius: var(--radius-xl);
      border: 1px solid var(--color-neutral-200);
      text-decoration: none;
      transition: all var(--transition-fast);
    }

    .doc-card:hover {
      border-color: var(--color-primary-300);
      box-shadow: var(--shadow-md);
      transform: translateY(-2px);
    }

    .doc-card-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 48px;
      height: 48px;
      border-radius: var(--radius-lg);
      background: var(--color-primary-100);
      color: var(--color-primary-600);
      flex-shrink: 0;
    }

    .doc-card-icon i {
      font-size: 1.25rem;
    }

    .doc-card-content {
      flex: 1;
      min-width: 0;
    }

    .doc-card-content h3 {
      margin: 0 0 0.25rem 0;
      font-size: 1.1rem;
      font-weight: 600;
      color: var(--color-neutral-800);
    }

    .doc-card-content p {
      margin: 0;
      font-size: 0.9rem;
      color: var(--color-neutral-600);
      line-height: 1.4;
    }

    .doc-card-arrow {
      color: var(--color-neutral-400);
      font-size: 0.9rem;
    }
  `]
})
export class DocumentationComponent {
  readonly chapters = DOC_CHAPTERS;
  readonly breadcrumbItems = [
    { label: 'Accueil', route: '/dashboard' },
    { label: 'Documentation', route: undefined }
  ];
}
