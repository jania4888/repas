import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { TableModule } from 'primeng/table';
import { SelectModule } from 'primeng/select';
import { FormsModule } from '@angular/forms';
import { StudioPageShellComponent } from '../shared/studio-page-shell.component';
import { STUDIO_BREADCRUMBS } from '../shared/studio-breadcrumb.util';
import { STUDIO_RUNTIME_LABELS } from '../shared/studio-runtime-labels';
import { StudioService } from '../studio.service';
import { CustomEntity } from '../studio.models';
import { EntityRelationDto, relationKindLabel } from './studio-relations.models';
import { StudioRelationDiagramComponent } from './studio-relation-diagram.component';
import { DiagramModel, toDiagram } from './studio-relation-diagram.model';

/**
 * Page `/studio/relations` (2.5g2, remplace le stub) : tableau Source / Type / Cible / Jonction
 * (N-N dédoublonnées par `junctionEntityId`), filtre par table, diagramme SVG compact. Les
 * relations sont chargées par table non-jonction (`forkJoin`, une 404 sur une table inactive n'y
 * fait pas échouer la page).
 */
@Component({
  selector: 'app-studio-relations-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, TableModule, SelectModule, StudioPageShellComponent, StudioRelationDiagramComponent],
  template: `
    <app-studio-page-shell [title]="labels.relations.title" subtitle="Cartographie des liens entre tables" [breadcrumbs]="breadcrumbs">
      <div studioActions class="studio-head-actions">
        <p-select [options]="entityOptions()" [ngModel]="filterEntityId()" (ngModelChange)="filterEntityId.set($event)"
          optionLabel="label" optionValue="value" [showClear]="true" placeholder="Filtrer par table" appendTo="body"
          panelStyleClass="studio-theme" data-testid="relations-filter" />
      </div>

      @if (!loading() && relations().length === 0) {
        <p class="studio-muted" data-testid="relations-empty">{{ labels.relations.empty }}</p>
      } @else {
        <div class="ft-table-card">
          <p-table [value]="filteredRelations()" [loading]="loading()" styleClass="p-datatable-sm">
            <ng-template pTemplate="header">
              <tr><th>Source</th><th>Type</th><th>Cible</th><th>Jonction</th></tr>
            </ng-template>
            <ng-template pTemplate="body" let-rel>
              <tr>
                <td>{{ rel.sourceLabel }}</td>
                <td>{{ kindLabel(rel.kind) }}</td>
                <td>{{ rel.targetLabel }}</td>
                <td>
                  @if (rel.junctionEntityKey) {
                    <code>{{ rel.junctionEntityKey }}</code>
                  } @else { — }
                </td>
              </tr>
            </ng-template>
            <ng-template pTemplate="emptymessage">
              <tr><td colspan="4" class="ft-empty">{{ labels.relations.empty }}</td></tr>
            </ng-template>
          </p-table>
        </div>
        @if (!loading()) {
          <div class="ft-table-card" data-testid="relations-diagram">
            <app-studio-relation-diagram [model]="diagram()" size="compact" [emptyLabel]="labels.relations.empty" />
          </div>
        }
      }
    </app-studio-page-shell>
  `,
  styleUrl: '../shared/studio-layout.scss'
})
export class StudioRelationsPageComponent implements OnInit {
  private readonly studio = inject(StudioService);

  readonly labels = STUDIO_RUNTIME_LABELS;
  readonly breadcrumbs = STUDIO_BREADCRUMBS.relations();
  readonly loading = signal(true);
  readonly entities = signal<CustomEntity[]>([]);
  readonly relations = signal<EntityRelationDto[]>([]);
  readonly filterEntityId = signal<string | null>(null);

  readonly entityOptions = computed(() =>
    this.entities().filter(e => e.kind !== 'Junction').map(e => ({ label: e.displayName, value: e.id })));

  readonly filteredRelations = computed(() => {
    const filter = this.filterEntityId();
    if (!filter) return this.relations();
    return this.relations().filter(r =>
      r.sourceEntityId === filter || r.targetEntityId === filter || r.junctionEntityId === filter);
  });

  readonly diagram = computed<DiagramModel>(() => toDiagram(this.entities(), this.filteredRelations()));

  ngOnInit(): void {
    this.studio.listEntities(false).subscribe({
      next: res => {
        if (!res.success) { this.loading.set(false); return; }
        const entities = res.data ?? [];
        this.entities.set(entities);
        const nonJunctions = entities.filter(e => e.kind !== 'Junction');
        if (nonJunctions.length === 0) { this.loading.set(false); return; }
        forkJoin(nonJunctions.map(e => this.studio.listEntityRelations(e.id).pipe(catchError(() => of(null)))))
          .subscribe(results => {
            const all = results.filter((r): r is NonNullable<typeof r> => !!r?.success).flatMap(r => r.data ?? []);
            const seen = new Set<string>();
            this.relations.set(all.filter(r => {
              if (r.kind !== 'many_to_many') return true;
              const key = r.junctionEntityId ?? `${r.sourceEntityId}:${r.targetEntityId}:${r.junctionEntityKey}`;
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            }));
            this.loading.set(false);
          });
      },
      error: () => this.loading.set(false)
    });
  }

  protected readonly kindLabel = relationKindLabel;
}
