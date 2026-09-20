import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { StudioService } from './studio.service';
import { CustomSystemDetail } from './studio.models';
import { StudioPageShellComponent } from './shared/studio-page-shell.component';
import { STUDIO_BREADCRUMBS } from './shared/studio-breadcrumb.util';
import { StudioAiCapabilitiesService } from './ai/studio-ai-capabilities.service';
import { STUDIO_AI_LABELS } from './ai/studio-ai-labels';
import { StudioAiExportDialogComponent } from './ai/import-export/studio-ai-export-dialog.component';
import { BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';

@Component({
  selector: 'app-studio-system-hub',
  standalone: true,
  imports: [CommonModule, RouterModule, ButtonModule, StudioPageShellComponent, StudioAiExportDialogComponent],
  template: `
    @if (detail(); as d) {
      <app-studio-page-shell
        [title]="d.system.displayName"
        [subtitle]="d.system.description ?? (d.entities.length + ' table(s)')"
        [breadcrumbs]="breadcrumbs()">
        @if (exportEnabled()) {
          <div studioActions class="studio-head-actions">
            <button pButton type="button" class="p-button-outlined" icon="fa-solid fa-file-export"
              data-action="export" [label]="labels.result.exportJson" (click)="exportVisible.set(true)"></button>
            <a pButton class="p-button-outlined" icon="fa-solid fa-copy"
              data-action="duplicate" [label]="labels.result.duplicate"
              [routerLink]="['/studio/ai']" [queryParams]="{ duplicate: d.system.key }"></a>
          </div>
        }
        <div class="hub">
          @if (d.system.onboardingSteps?.length) {
            <section class="hub-onboard">
              <h3>Pour démarrer</h3>
              <ol>
                @for (step of d.system.onboardingSteps; track step) {
                  <li>{{ step }}</li>
                }
              </ol>
            </section>
          }
          <section class="hub-grid">
            @for (e of d.entities; track e.id) {
              <article class="hub-card">
                <h4><i [class]="e.icon || 'fa-solid fa-table'"></i> {{ e.displayName }}</h4>
                <p>{{ e.fieldCount }} champ(s)</p>
                <div class="hub-card__actions">
                  <a pButton class="p-button-sm" icon="fa-solid fa-table" label="Données"
                    [routerLink]="['/studio/d', e.key]"></a>
                  <a pButton class="p-button-sm p-button-outlined" icon="fa-solid fa-wrench" label="Concevoir"
                    [routerLink]="['/studio', e.id]"></a>
                </div>
              </article>
            }
          </section>
        </div>
      </app-studio-page-shell>

      @if (exportEnabled()) {
        <app-studio-ai-export-dialog [(visible)]="exportVisible" [systemKey]="d.system.key" />
      }
    }
  `,
  styles: [`
    .hub { display: flex; flex-direction: column; gap: 1.5rem; }
    .hub-onboard { background: var(--surface-50); border: 1px solid var(--surface-200); border-radius: 10px; padding: 1rem 1.25rem; }
    .hub-onboard h3 { margin: 0 0 .5rem; font-size: 1rem; }
    .hub-onboard ol { margin: 0; padding-left: 1.25rem; }
    .hub-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 1rem; }
    .hub-card { border: 1px solid var(--surface-200); border-radius: 10px; padding: 1rem; background: var(--surface-0); }
    .hub-card h4 { margin: 0 0 .35rem; display: flex; align-items: center; gap: .5rem; }
    .hub-card p { margin: 0 0 .75rem; color: var(--text-color-secondary); font-size: .9rem; }
    .hub-card__actions { display: flex; flex-wrap: wrap; gap: .5rem; }
  `]
})
export class StudioSystemHubComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly studio = inject(StudioService);
  private readonly capabilities = inject(StudioAiCapabilitiesService);
  private readonly auth = inject(AuthService);

  protected readonly labels = STUDIO_AI_LABELS;

  readonly detail = signal<CustomSystemDetail | null>(null);
  readonly breadcrumbs = signal<BreadcrumbItem[]>(STUDIO_BREADCRUMBS.systemHub('Système'));
  readonly exportVisible = signal(false);

  /**
   * Exporter / Dupliquer : fail-closed sur le flag `systemExportEnabled` ET la permission
   * `studio:design_entities` (la route du hub n'exige que `custom_data:records_read`).
   */
  readonly exportEnabled = computed(() =>
    this.capabilities.state() === 'ready'
    && this.capabilities.capabilities().systemExportEnabled
    && this.auth.hasPermission(PERMISSIONS.studio.designEntities)
  );

  ngOnInit(): void {
    this.capabilities.ensureLoaded();
    const key = this.route.snapshot.paramMap.get('key');
    if (!key) return;
    this.studio.getSystem(key).subscribe({
      next: res => {
        if (res.success && res.data) {
          this.detail.set(res.data);
          this.breadcrumbs.set(STUDIO_BREADCRUMBS.systemHub(res.data.system.displayName));
        }
      }
    });
  }
}
