/// <reference types="@angular/localize" />
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ButtonModule } from 'primeng/button';
import { ToastModule } from 'primeng/toast';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { DocumentTemplateService } from '@core/services/document-template.service';
import {
  DOCUMENT_TYPE_TABS,
  DocumentTemplateCatalogItemDto,
  PrintableDocumentType
} from './models/document-template.models';

@Component({
  selector: 'app-document-templates',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ButtonModule,
    ToastModule,
    ProgressSpinnerModule,
    PageHeaderComponent,
    BreadcrumbComponent
  ],
  template: `
    <app-breadcrumb [items]="breadcrumbItems"></app-breadcrumb>

    <app-page-header
      title="Modèles de documents" i18n-title="Modèles de documents"
      subtitle="Choisissez le modèle visuel utilisé pour imprimer chaque type de document">
      <div class="header-actions">
        <p-button label="Retour" i18n-label="Retour" icon="pi pi-arrow-left" [outlined]="true" routerLink="/settings"></p-button>
        @if (canUpdate()) {
          <p-button
            label="Enregistrer" i18n-label="Enregistrer"
            icon="pi pi-check"
            (onClick)="save()"
            [loading]="saving()"
            [disabled]="loading() || saving() || !selectedKey()">
          </p-button>
        }
      </div>
    </app-page-header>

    <!-- Onglets par type de document -->
    <div class="doc-tabs">
      @for (tab of tabs; track tab.type) {
        <button
          class="doc-tab"
          [class.active]="selectedType() === tab.type"
          (click)="selectType(tab.type)">
          <i [class]="tab.icon"></i>
          <span>{{ tab.label }}</span>
        </button>
      }
    </div>

    @if (loading()) {
      <div class="loading"><p-progressSpinner styleClass="spinner"></p-progressSpinner></div>
    } @else {
      <div class="templates-layout">
        <!-- Galerie de modèles -->
        <div class="gallery">
          @for (item of catalogForType(); track item.key) {
            <button
              class="template-card"
              [class.selected]="selectedKey() === item.key"
              (click)="selectTemplate(item.key)">
              <div class="card-head">
                <span class="card-name">{{ item.name }}</span>
                @if (currentSavedKey() === item.key) {
                  <span class="badge-current" i18n="@@settings.templates.actuel.8a432ab2">Actuel</span>
                }
                @if (selectedKey() === item.key) {
                  <i class="pi pi-check-circle check"></i>
                }
              </div>
              <p class="card-desc">{{ item.description }}</p>
            </button>
          }
        </div>

        <!-- Aperçu live -->
        <div class="preview-pane">
          <div class="preview-toolbar">
            <span>Aperçu — {{ selectedTemplateName() }}</span>
            @if (previewLoading()) { <i class="pi pi-spin pi-spinner"></i> }
          </div>
          @if (previewUrl()) {
            <iframe [src]="previewUrl()" title="Aperçu du modèle" i18n-title="Aperçu du modèle" class="preview-frame"></iframe>
          } @else {
            <div class="preview-empty">
              <i class="pi pi-file-pdf"></i>
              <p i18n="@@settings.templates.selectionnez.un.modele.pour.afficher.l.apercu.f9616fd1">Sélectionnez un modèle pour afficher l'aperçu.</p>
            </div>
          }
        </div>
      </div>
    }

    <p-toast></p-toast>
  `,
  styles: [`
    .header-actions { display: flex; gap: var(--spacing-2); }
    .doc-tabs {
      display: flex; flex-wrap: wrap; gap: var(--spacing-2);
      margin-bottom: var(--spacing-4);
    }
    .doc-tab {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 8px 14px; border-radius: var(--radius-lg);
      border: 1px solid var(--color-neutral-200); background: white;
      cursor: pointer; font-size: var(--font-size-sm); color: var(--color-neutral-700);
      transition: all var(--transition-fast);
    }
    .doc-tab:hover { border-color: var(--color-primary-300); }
    .doc-tab.active { background: var(--color-primary-500); color: white; border-color: var(--color-primary-500); }

    .templates-layout { display: grid; grid-template-columns: minmax(280px, 360px) 1fr; gap: var(--spacing-4); align-items: start; }
    @media (max-width: 900px) { .templates-layout { grid-template-columns: 1fr; } }

    .gallery { display: flex; flex-direction: column; gap: var(--spacing-3); }
    .template-card {
      text-align: left; padding: var(--spacing-4); border-radius: var(--radius-xl);
      border: 1px solid var(--color-neutral-200); background: white; cursor: pointer;
      transition: all var(--transition-fast);
    }
    .template-card:hover { border-color: var(--color-primary-300); box-shadow: var(--shadow-sm); }
    .template-card.selected { border-color: var(--color-primary-500); box-shadow: var(--shadow-md); }
    .card-head { display: flex; align-items: center; gap: 8px; }
    .card-name { font-weight: var(--font-weight-semibold); color: var(--color-neutral-900); flex: 1; }
    .badge-current {
      font-size: 11px; padding: 2px 8px; border-radius: 999px;
      background: var(--color-success-100, #d1fae5); color: var(--color-success-700, #047857);
    }
    .check { color: var(--color-primary-500); }
    .card-desc { margin: 6px 0 0; font-size: var(--font-size-sm); color: var(--color-neutral-500); }

    .preview-pane {
      border: 1px solid var(--color-neutral-200); border-radius: var(--radius-xl);
      background: var(--color-neutral-50, #fafafa); overflow: hidden; min-height: 540px;
      display: flex; flex-direction: column;
    }
    .preview-toolbar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 14px; border-bottom: 1px solid var(--color-neutral-200);
      font-size: var(--font-size-sm); color: var(--color-neutral-700); background: white;
    }
    .preview-frame { width: 100%; height: 640px; border: 0; background: white; }
    .preview-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: var(--color-neutral-400); }
    .preview-empty i { font-size: 2rem; }
    .loading { display: flex; justify-content: center; padding: var(--spacing-8); }
  `]
})
export class DocumentTemplatesComponent implements OnInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly service = inject(DocumentTemplateService);
  private readonly toast = inject(ToastService);
  private readonly errorHandler = inject(ErrorHandlerService);
  private readonly sanitizer = inject(DomSanitizer);

  readonly tabs = DOCUMENT_TYPE_TABS;
  breadcrumbItems: BreadcrumbItem[] = [
    { label: 'Tableau de bord', route: '/dashboard', icon: 'pi-home' },
    { label: 'Paramètres', route: '/settings' },
    { label: 'Modèles de documents' }
  ];

  loading = signal(true);
  saving = signal(false);
  previewLoading = signal(false);

  catalog = signal<DocumentTemplateCatalogItemDto[]>([]);
  preferences = signal<Record<string, string>>({});
  selectedType = signal<PrintableDocumentType>('SalesInvoice');
  selectedKey = signal<string>('');
  previewUrl = signal<SafeResourceUrl | null>(null);

  private currentObjectUrl: string | null = null;

  catalogForType = computed(() =>
    this.catalog().filter(c => c.supportedDocumentTypes.includes(this.selectedType())));

  currentSavedKey = computed(() => this.preferences()[this.selectedType()] ?? '');

  selectedTemplateName = computed(() => {
    const item = this.catalog().find(c => c.key === this.selectedKey());
    return item?.name ?? '—';
  });

  canUpdate = computed(() => this.auth.hasPermission(PERMISSIONS.settings.update));

  ngOnInit(): void {
    this.loadAll();
  }

  ngOnDestroy(): void {
    this.revokeObjectUrl();
  }

  private showError(err: unknown): void {
    this.toast.add({ severity: 'error', summary: $localize`:@@templates.component.summary.Erreur:Erreur`, detail: this.errorHandler.extractErrorMessage(err) });
  }

  private loadAll(): void {
    this.loading.set(true);
    this.service.getCatalog().subscribe({
      next: (catRes) => {
        this.catalog.set(catRes.data ?? []);
        this.service.getPreferences().subscribe({
          next: (prefRes) => {
            const map: Record<string, string> = {};
            for (const p of prefRes.data ?? []) {
              map[p.documentType] = p.templateKey;
            }
            this.preferences.set(map);
            this.loading.set(false);
            this.applyTypeSelection(this.selectedType());
          },
          error: (err) => { this.loading.set(false); this.showError(err); }
        });
      },
      error: (err) => { this.loading.set(false); this.showError(err); }
    });
  }

  selectType(type: PrintableDocumentType): void {
    if (this.selectedType() === type) return;
    this.selectedType.set(type);
    this.applyTypeSelection(type);
  }

  private applyTypeSelection(type: PrintableDocumentType): void {
    const list = this.catalogForType();
    const preferred = this.preferences()[type];
    const key = preferred && list.some(c => c.key === preferred)
      ? preferred
      : list[0]?.key ?? '';
    this.selectedKey.set(key);
    this.refreshPreview();
  }

  selectTemplate(key: string): void {
    if (this.selectedKey() === key) return;
    this.selectedKey.set(key);
    this.refreshPreview();
  }

  private refreshPreview(): void {
    const key = this.selectedKey();
    if (!key) { this.setPreviewUrl(null); return; }
    this.previewLoading.set(true);
    this.service.preview(this.selectedType(), key).subscribe({
      next: (blob) => {
        this.setPreviewUrl(URL.createObjectURL(blob));
        this.previewLoading.set(false);
      },
      error: (err) => {
        this.previewLoading.set(false);
        this.setPreviewUrl(null);
        this.showError(err);
      }
    });
  }

  private setPreviewUrl(url: string | null): void {
    this.revokeObjectUrl();
    if (url) {
      this.currentObjectUrl = url;
      this.previewUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(url));
    } else {
      this.previewUrl.set(null);
    }
  }

  private revokeObjectUrl(): void {
    if (this.currentObjectUrl) {
      URL.revokeObjectURL(this.currentObjectUrl);
      this.currentObjectUrl = null;
    }
  }

  save(): void {
    const type = this.selectedType();
    const key = this.selectedKey();
    if (!key) return;
    this.saving.set(true);
    this.service.save(type, { templateKey: key }).subscribe({
      next: (res) => {
        this.saving.set(false);
        if (res.success && res.data) {
          this.preferences.update(m => ({ ...m, [type]: res.data!.templateKey }));
          this.toast.add({ severity: 'success', summary: $localize`:@@templates.component.summary.Mod_le_enregistr:Modèle enregistré`, detail: `Modèle « ${res.data.templateName} » appliqué.` });
        } else {
          this.toast.add({ severity: 'error', summary: $localize`:@@templates.component.summary.Erreur:Erreur`, detail: res.message ?? $localize`:@@ui.tern.echec.de.l.enregistrement.92ba0d:Échec de l'enregistrement.` });
        }
      },
      error: (err) => { this.saving.set(false); this.showError(err); }
    });
  }
}
