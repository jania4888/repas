import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { STUDIO_AI_LABELS, formatLabel } from '../studio-ai-labels';
import { STUDIO_SPEC_LIMITS, StudioSpecEntity, StudioSystemSpec } from '../studio-ai.models';
import { StudioAiSeedCsvImportComponent } from './studio-ai-seed-csv-import.component';

/** Un bloc de données de référence prêt à afficher (10 premières valeurs seulement). */
interface StudioAiSeedBlock {
  entityRef: string;
  entityName: string;
  count: number;
  columns: { key: string; label: string }[];
  rows: Record<string, unknown>[];
  truncated: string | null;
  /** Table existante réutilisée (`existingKey`) : verrouillée, jamais d'import (3.4h). */
  locked: boolean;
}

/**
 * Onglet « Données de référence » (lecture, P1a) : par table, le nombre de valeurs initiales et un
 * extrait des 10 premières lignes.
 *
 * Les colonnes sont les champs de la table réellement présents dans les enregistrements : le
 * générateur n'alimente pas toujours tous les champs, et une colonne vide n'apprend rien. En mode
 * Personnaliser (3.4h), chaque bloc non verrouillé propose « Importer un CSV » qui déplie un
 * panneau inline (`app-studio-ai-seed-csv-import`) ; l'application remonte `seedReplace` (le store
 * remplace le bloc seed du brouillon) puis un avis « n lignes importées » s'affiche. Le collage
 * depuis un tableur arrive en P1b. Le rendu en lecture seule est strictement inchangé.
 */
@Component({
  selector: 'app-studio-ai-seed-tab',
  standalone: true,
  imports: [ButtonModule, TableModule, StudioAiSeedCsvImportComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './studio-ai-preview.scss',
  template: `
    @if (!blocks().length) {
      <p class="sai-hint">{{ labels.noSeed }}</p>
    } @else {
      @for (block of blocks(); track block.entityRef) {
        <div class="sai-block">
          <div class="sai-block__head">
            <i class="fa-solid fa-database" aria-hidden="true"></i>
            <span>{{ labels.referenceDataOf }} {{ block.entityName }}</span>
            <span class="sai-list__meta">{{ block.count }} / {{ maxSeed }} {{ labels.seedValues }}</span>
            @if (editable() && !block.locked) {
              <!-- 3.4h : import CSV par bloc (panneau inline, D20). -->
              <p-button
                [label]="csvLabels.title"
                icon="fa-solid fa-file-arrow-up"
                [outlined]="true"
                size="small"
                [attr.data-component-id]="'sai-seed-import-csv-' + block.entityRef"
                [attr.aria-expanded]="importOpenFor() === block.entityRef"
                (onClick)="toggleImport(block.entityRef)" />
            }
          </div>
          <p-table [value]="block.rows" styleClass="p-datatable-sm" responsiveLayout="scroll">
            <ng-template pTemplate="header">
              <tr>
                @for (col of block.columns; track col.key) {
                  <th scope="col">{{ col.label }}</th>
                }
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-row>
              <tr>
                @for (col of block.columns; track col.key) {
                  <td>{{ cell(row, col.key) }}</td>
                }
              </tr>
            </ng-template>
          </p-table>
          @if (block.truncated) {
            <p class="sai-hint">{{ block.truncated }}</p>
          }
          @if (importOpenFor() === block.entityRef) {
            @if (entityOf(block.entityRef); as entity) {
              <app-studio-ai-seed-csv-import
                [entity]="entity"
                (applied)="onImportApplied($event)"
                (cancelled)="closeImport()" />
            }
          }
          @if (appliedRef() === block.entityRef) {
            <p class="sai-hint sai-import__applied" role="status" data-component-id="sai-seed-import-applied">
              {{ appliedLabel() }}
            </p>
          }
        </div>
      }
    }
  `
})
export class StudioAiSeedTabComponent {
  readonly spec = input.required<StudioSystemSpec>();
  /** Mode Personnaliser (3.4h) : chaque bloc non verrouillé propose « Importer un CSV ». */
  readonly editable = input(false);

  /** Import CSV appliqué sur la table `ref` (le store remplace son bloc seed du brouillon). */
  readonly seedReplace = output<{ ref: string; records: Record<string, unknown>[] }>();

  readonly labels = STUDIO_AI_LABELS.preview;
  readonly csvLabels = STUDIO_AI_LABELS.csv;
  readonly maxSeed = STUDIO_SPEC_LIMITS.maxSeedRecords;

  /** `ref` de la table dont le panneau d'import est déplié (une seule à la fois). */
  readonly importOpenFor = signal<string | null>(null);
  /** Dernier import appliqué (`ref` + nombre de lignes) : avis « n lignes importées ». */
  private readonly appliedInfo = signal<{ ref: string; count: number } | null>(null);

  readonly appliedRef = computed(() => this.appliedInfo()?.ref ?? null);
  readonly appliedLabel = computed(() => {
    const info = this.appliedInfo();
    return info ? formatLabel(this.csvLabels.applied, { count: info.count }) : '';
  });

  readonly blocks = computed<StudioAiSeedBlock[]>(() => {
    const spec = this.spec();
    return (spec.seed ?? [])
      .filter(seed => (seed.records?.length ?? 0) > 0)
      .map(seed => {
        const entity = spec.entities.find(e => e.ref === seed.entityRef);
        const records = seed.records ?? [];
        const rows = records.slice(0, 10);
        const used = new Set<string>();
        for (const record of rows) {
          for (const key of Object.keys(record)) used.add(key);
        }
        const declared = (entity?.fields ?? []).filter(f => used.has(f.key)).map(f => ({ key: f.key, label: f.label }));
        const extra = [...used]
          .filter(key => !declared.some(c => c.key === key))
          .map(key => ({ key, label: key }));
        return {
          entityRef: seed.entityRef,
          entityName: entity?.displayNamePlural || entity?.displayName || seed.entityRef,
          count: records.length,
          columns: [...declared, ...extra],
          rows,
          truncated: records.length > rows.length
            ? formatLabel(STUDIO_AI_LABELS.preview.seedTruncated, { count: records.length })
            : null,
          locked: !!entity?.existingKey
        };
      });
  });

  /** Rend une valeur de seed lisible sans dépendre du type déclaré (le JSON peut être partiel). */
  cell(row: Record<string, unknown>, key: string): string {
    const value = row?.[key];
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'boolean') return value ? 'Oui' : 'Non';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  /** « Importer un CSV » : déplie/replie le panneau d'import du bloc (l'avis appliqué s'efface). */
  toggleImport(ref: string): void {
    this.appliedInfo.set(null);
    this.importOpenFor.update(current => (current === ref ? null : ref));
  }

  closeImport(): void {
    this.importOpenFor.set(null);
  }

  /** Application de l'import : remonte au store, referme le panneau et affiche la confirmation. */
  onImportApplied(event: { ref: string; records: Record<string, unknown>[] }): void {
    this.seedReplace.emit(event);
    this.importOpenFor.set(null);
    this.appliedInfo.set({ ref: event.ref, count: event.records.length });
  }

  /** Table courante du bloc (depuis la spec éventuellement en brouillon : champs à jour). */
  entityOf(ref: string): StudioSpecEntity | null {
    return this.spec().entities.find(e => e.ref === ref) ?? null;
  }
}
