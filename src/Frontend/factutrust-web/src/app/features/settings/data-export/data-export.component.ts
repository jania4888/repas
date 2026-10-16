/// <reference types="@angular/localize" />
import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { AuthService } from '@core/services/auth.service';
import { DataExportError, DataExportService } from '@core/services/data-export.service';
import { ToastService } from '@core/services/toast.service';
import { visibleExportDatasets } from '@core/data-export/data-export.catalog';

@Component({
  selector: 'app-data-export',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    PageHeaderComponent,
    BreadcrumbComponent,
    ButtonComponent
  ],
  template: `
    <app-breadcrumb [items]="breadcrumbItems"></app-breadcrumb>

    <app-page-header
      title="Mes données" i18n-title="@@dataExport.page.title"
      subtitle="Téléchargez une copie Excel des données que vous pouvez lire." i18n-subtitle="@@dataExport.page.subtitle">
    </app-page-header>

    <section class="export-card">
      <h2 i18n="@@dataExport.page.period">Période</h2>
      <p class="hint" i18n="@@dataExport.page.hint">
        Sans période, l'historique complet est inclus, dans la limite du volume autorisé. Une copie incomplète n'est jamais téléchargée.
      </p>
      <div class="dates">
        <label>
          <span i18n="@@dataExport.page.from">Du</span>
          <input type="date" name="fromDate" [(ngModel)]="fromDate" />
        </label>
        <label>
          <span i18n="@@dataExport.page.to">Au</span>
          <input type="date" name="toDate" [(ngModel)]="toDate" />
        </label>
      </div>

      <h2 i18n="@@dataExport.page.datasets">Jeux de données</h2>
      <ul class="datasets">
        @for (dataset of datasets(); track dataset.key) {
          <li>
            <label>
              <input
                type="checkbox"
                [checked]="isChecked(dataset.key)"
                (change)="toggle(dataset.key, $event)" />
              <span>{{ dataset.label }}</span>
            </label>
          </li>
        }
      </ul>

      <p class="disclaimer" i18n="@@dataExport.page.disclaimer">
        Copie de consultation. Ce fichier n'est pas un document fiscal.
      </p>

      <app-button
        variant="primary"
        icon="pi-download"
        iconPos="left"
        [disabled]="busy() || selectedCount() === 0"
        (click)="download()"
        i18n="@@dataExport.page.download">
        Télécharger le classeur
      </app-button>
    </section>
  `,
  styles: [`
    .export-card {
      max-width: 720px;
      padding: var(--spacing-6);
      border: 1px solid var(--color-neutral-200);
      border-radius: var(--radius-lg);
      background: var(--color-neutral-0, #fff);
    }

    h2 {
      margin: 0 0 var(--spacing-2);
      font-size: var(--font-size-lg);
    }

    .hint, .disclaimer {
      margin: 0 0 var(--spacing-4);
      color: var(--color-neutral-600);
      font-size: var(--font-size-sm);
    }

    .dates {
      display: flex;
      flex-wrap: wrap;
      gap: var(--spacing-4);
      margin-bottom: var(--spacing-6);
    }

    label {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-1);
      font-size: var(--font-size-sm);
    }

    .datasets {
      list-style: none;
      margin: 0 0 var(--spacing-4);
      padding: 0;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: var(--spacing-2);
    }

    .datasets label {
      flex-direction: row;
      align-items: center;
      gap: var(--spacing-2);
    }

    input[type="date"] {
      padding: var(--spacing-2) var(--spacing-3);
      border: 1px solid var(--color-neutral-300);
      border-radius: var(--radius-md);
      font: inherit;
    }
  `]
})
export class DataExportComponent {
  private readonly auth = inject(AuthService);
  private readonly exports = inject(DataExportService);
  private readonly toast = inject(ToastService);

  readonly breadcrumbItems: BreadcrumbItem[] = [
    { label: $localize`:@@settings.settings.ts.tableau.de.bord.a524057f:Tableau de bord`, route: '/dashboard', icon: 'pi-home' },
    { label: $localize`:@@settings.settings.ts.parametres.ef8f0121:Paramètres`, route: '/settings' },
    { label: $localize`:@@dataExport.page.title:Mes données` }
  ];

  readonly datasets = computed(() => visibleExportDatasets(this.auth));
  private readonly unchecked = signal<ReadonlySet<string>>(new Set());
  readonly busy = signal(false);

  fromDate = '';
  toDate = '';

  readonly selectedCount = computed(() =>
    this.datasets().filter(dataset => !this.unchecked().has(dataset.key)).length
  );

  isChecked(key: string): boolean {
    return !this.unchecked().has(key);
  }

  toggle(key: string, event: Event): void {
    const input = event.target as HTMLInputElement;
    const next = new Set(this.unchecked());
    if (input.checked) {
      next.delete(key);
    } else {
      next.add(key);
    }
    this.unchecked.set(next);
  }

  download(): void {
    if (this.busy()) {
      return;
    }
    if (this.fromDate && this.toDate && this.fromDate > this.toDate) {
      this.toast.add({
        severity: 'error',
        summary: $localize`:@@dataExport.error.title:Export impossible`,
        detail: $localize`:@@dataExport.error.dateOrder:La date de début doit précéder la date de fin.`
      });
      return;
    }
    const selected = this.datasets()
      .filter(dataset => this.isChecked(dataset.key))
      .map(dataset => dataset.key);
    if (selected.length === 0) {
      this.toast.add({
        severity: 'error',
        summary: $localize`:@@dataExport.error.title:Export impossible`,
        detail: $localize`:@@dataExport.error.emptySelection:Cochez au moins un jeu de données.`
      });
      return;
    }

    this.busy.set(true);
    this.exports.downloadBundle({
      fromDate: this.fromDate || null,
      toDate: this.toDate || null,
      datasets: selected
    }).subscribe({
      next: () => this.busy.set(false),
      error: (err: unknown) => {
        this.busy.set(false);
        this.toast.add({
          severity: 'error',
          summary: $localize`:@@dataExport.error.title:Export impossible`,
          detail: err instanceof DataExportError
            ? err.message
            : $localize`:@@dataExport.error.generic:L'export n'a pas pu être téléchargé.`
        });
      }
    });
  }
}
