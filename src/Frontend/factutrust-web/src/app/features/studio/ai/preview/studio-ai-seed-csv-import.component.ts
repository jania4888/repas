import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { TableModule } from 'primeng/table';
import { Textarea } from 'primeng/textarea';
import { STUDIO_AI_LABELS, formatLabel } from '../studio-ai-labels';
import { StudioSpecEntity } from '../studio-ai.models';
import { ParsedCsv, parseCsv, slugify } from '../studio-ai-spec.util';

/** Taille maximale d'un fichier CSV proposé à la lecture (au-delà, le fichier n'est jamais lu). */
const CSV_MAX_FILE_BYTES = 512 * 1024;
/** Nombre de lignes de l'aperçu avant application. */
const CSV_PREVIEW_ROWS = 5;
/** Valeur de l'option « — ignorer — » du rapprochement colonne → champ. */
const IGNORE = '';

/**
 * Panneau inline « Importer un CSV » (3.4h, D20 — pas de `p-dialog`) dans un bloc de l'onglet
 * Données de référence. Le fichier est déposé (glisser-déposer), choisi (`input[type=file]`) ou
 * collé (`textarea`) ; les colonnes sont rapprochées des champs de la table (pré-rapprochement par
 * clé slugifiée ou par libellé insensible à la casse et aux accents, option « — ignorer — ») et
 * un aperçu de 5 lignes est rendu avant application.
 *
 * Sécurité : un fichier de plus de 512 Ko n'est JAMAIS lu (`FileReader` non invoqué), seuls les
 * fichiers `.csv` sont acceptés, le texte est borné par `parseCsv` (500 lignes / 64 Ko, avis
 * « Tronqué ») et les valeurs ne sont rendues que par interpolation (aucun `innerHTML`). Aucun
 * appel HTTP : « Remplacer les données de départ » émet `applied`, le store remplace le bloc seed
 * du brouillon (`replaceSeed`).
 */
@Component({
  selector: 'app-studio-ai-seed-csv-import',
  standalone: true,
  imports: [FormsModule, ButtonModule, SelectModule, TableModule, Textarea],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './studio-ai-preview.scss',
  template: `
    <section class="sai-import" data-component-id="sai-import-panel" [attr.aria-label]="labels.title">
      <div class="sai-import__head">
        <i class="fa-solid fa-file-csv" aria-hidden="true"></i>
        <span>{{ labels.title }} — {{ entity().displayName }}</span>
        <span class="sai-list__meta">{{ labels.hint }}</span>
      </div>
      <div class="sai-import__body">
        <div
          class="sai-drop"
          [class.sai-drop--over]="dragOver()"
          data-component-id="sai-import-dropzone"
          (dragover)="onDragOver($event)"
          (dragleave)="onDragLeave()"
          (drop)="onDrop($event)">
          <span class="sai-drop__icon" aria-hidden="true"><i class="fa-solid fa-file-arrow-up"></i></span>
          <div class="sai-drop__text">
            <strong>{{ fileName() ?? labels.drop }}</strong>
          </div>
          <p-button
            [label]="labels.choose"
            icon="fa-solid fa-upload"
            severity="secondary"
            size="small"
            [disabled]="disabled()"
            (onClick)="fileInput.click()" />
          <input
            #fileInput
            type="file"
            accept=".csv,text/csv"
            class="sr-only"
            data-component-id="sai-import-choose-file"
            [disabled]="disabled()"
            [attr.aria-label]="labels.choose"
            (change)="onFileChosen($event)" />
        </div>

        <div class="sai-import__paste">
          <span class="sai-hint">{{ labels.paste }}</span>
          <textarea
            pTextarea
            rows="3"
            class="sai-import__textarea"
            [ngModel]="pasted()"
            (ngModelChange)="onPaste($event)"
            [disabled]="disabled()"
            [attr.aria-label]="labels.paste"
            data-component-id="sai-import-paste"></textarea>
        </div>

        @if (error(); as message) {
          <div class="sai-banner sai-banner--error" role="alert">
            <i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>
            <span>{{ message }}</span>
          </div>
        }

        @if (parsed(); as csv) {
          @if (truncatedLabel(); as truncated) {
            <div class="sai-banner sai-banner--warn" role="status" data-component-id="sai-import-truncated">
              <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
              <span>{{ truncated }}</span>
            </div>
          }
          <div class="sai-grid">
            <div>
              <div class="sai-block__head">{{ labels.mapping }}</div>
              <table class="sai-table sai-import__mapping">
                <tbody>
                  @for (header of csv.headers; track $index; let i = $index) {
                    <tr>
                      <td>
                        <span class="sai-code">{{ header }}</span>
                        <span class="sai-hint sai-import__example">{{ exampleFor(i) }}</span>
                      </td>
                      <td>
                        <p-select
                          [options]="fieldOptions()"
                          [ngModel]="mapping()[i] ?? ''"
                          (ngModelChange)="onMappingChange(i, $event)"
                          optionLabel="label"
                          optionValue="value"
                          appendTo="body"
                          panelStyleClass="studio-theme"
                          [disabled]="disabled()"
                          [attr.aria-label]="header"
                          [attr.data-component-id]="'sai-import-map-' + i" />
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            <div>
              <div class="sai-block__head">{{ previewTitle() }}</div>
              <p-table [value]="previewRecords()" styleClass="p-datatable-sm" responsiveLayout="scroll">
                <ng-template pTemplate="header">
                  <tr>
                    @for (col of previewColumns(); track col.key) {
                      <th scope="col">{{ col.label }}</th>
                    }
                  </tr>
                </ng-template>
                <ng-template pTemplate="body" let-row>
                  <tr>
                    @for (col of previewColumns(); track col.key) {
                      <td>{{ previewCell(row, col.key) }}</td>
                    }
                  </tr>
                </ng-template>
              </p-table>
            </div>
          </div>
        }
      </div>
      <div class="sai-import__actions">
        <p-button
          [label]="labels.cancel"
          icon="fa-solid fa-xmark"
          severity="secondary"
          [text]="true"
          data-component-id="sai-import-cancel"
          (onClick)="cancel()" />
        <p-button
          [label]="labels.apply"
          icon="fa-solid fa-check"
          data-component-id="sai-import-apply"
          [disabled]="disabled() || !records().length"
          (onClick)="apply()" />
      </div>
    </section>
  `
})
export class StudioAiSeedCsvImportComponent {
  /** Table cible de l'import (les colonnes sont rapprochées de ses champs). */
  readonly entity = input.required<StudioSpecEntity>();
  /** Désactive dépôt, collage et application (ex. sauvegarde du brouillon en cours). */
  readonly disabled = input(false);

  /** « Remplacer les données de départ » : enregistrements mappés prêts pour `replaceSeed`. */
  readonly applied = output<{ ref: string; records: Record<string, unknown>[] }>();
  /** « Annuler » : le panneau est refermé par le parent. */
  readonly cancelled = output<void>();

  readonly labels = STUDIO_AI_LABELS.csv;

  readonly fileName = signal<string | null>(null);
  readonly pasted = signal('');
  readonly parsed = signal<ParsedCsv | null>(null);
  /** Rapprochement colonne → champ : `mapping()[i]` = clé du champ cible de la colonne `i`, '' = ignorée. */
  readonly mapping = signal<string[]>([]);
  readonly error = signal<string | null>(null);
  readonly dragOver = signal(false);

  /** Options du `p-select` de rapprochement : « — ignorer — » puis chaque champ de la table. */
  readonly fieldOptions = computed(() => [
    { value: IGNORE, label: this.labels.ignore },
    ...this.entity().fields.map(f => ({ value: f.key, label: f.label }))
  ]);

  /**
   * Enregistrements mappés : seules les colonnes rapprochées alimentent le résultat (cellule vide
   * ⇒ `null`), une ligne sans aucune valeur retenue est ignorée.
   */
  readonly records = computed<Record<string, unknown>[]>(() => {
    const csv = this.parsed();
    if (!csv) return [];
    const mapping = this.mapping();
    const records: Record<string, unknown>[] = [];
    for (const row of csv.rows) {
      const record: Record<string, unknown> = {};
      let filled = false;
      for (let i = 0; i < row.length; i++) {
        const key = mapping[i] ?? IGNORE;
        if (key === IGNORE) continue;
        const value = row[i].trim();
        record[key] = value === '' ? null : value;
        if (value !== '') filled = true;
      }
      if (filled) records.push(record);
    }
    return records;
  });

  readonly previewRecords = computed(() => this.records().slice(0, CSV_PREVIEW_ROWS));

  /** Champs cibles des colonnes rapprochées (ordre du fichier, sans doublon) pour l'aperçu. */
  readonly previewColumns = computed<{ key: string; label: string }[]>(() => {
    const fields = this.entity().fields;
    const seen = new Set<string>();
    const columns: { key: string; label: string }[] = [];
    for (const key of this.mapping()) {
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const field = fields.find(f => f.key === key);
      if (field) columns.push({ key, label: field.label });
    }
    return columns;
  });

  readonly previewTitle = computed(() =>
    formatLabel(this.labels.preview, { count: this.parsed()?.rows.length ?? 0 }));

  readonly truncatedLabel = computed(() => {
    const csv = this.parsed();
    return csv?.truncated ? formatLabel(this.labels.truncated, { count: csv.rows.length }) : null;
  });

  // ---- Sources (dépôt, fichier, collage) -----------------------------------------------------------

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (!this.disabled()) this.dragOver.set(true);
  }

  onDragLeave(): void {
    this.dragOver.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(false);
    if (this.disabled()) return;
    const file = event.dataTransfer?.files?.[0];
    if (file) this.readFile(file);
  }

  onFileChosen(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    // Réinitialise l'input pour qu'un nouveau choix du même fichier redéclenche `change`.
    input.value = '';
    if (file) this.readFile(file);
  }

  onPaste(text: string): void {
    this.pasted.set(text);
    if (!text.trim()) { this.reset(); return; }
    this.applyParsed(parseCsv(text), null);
  }

  // ---- Rapprochement et application ----------------------------------------------------------------

  onMappingChange(index: number, key: string | null): void {
    this.mapping.update(current => current.map((k, i) => (i === index ? key ?? IGNORE : k)));
  }

  apply(): void {
    if (this.disabled()) return;
    const records = this.records();
    if (!records.length) return;
    this.applied.emit({ ref: this.entity().ref, records });
  }

  cancel(): void {
    this.cancelled.emit();
  }

  /** Exemple affiché face à chaque colonne : la valeur de la première ligne (vide ⇒ « — »). */
  exampleFor(index: number): string {
    const value = this.parsed()?.rows[0]?.[index] ?? '';
    return value === '' ? '—' : value;
  }

  /** Cellule d'aperçu : interpolation uniquement, jamais de HTML. */
  previewCell(row: Record<string, unknown>, key: string): string {
    const value = row[key];
    return value === null || value === undefined || value === '' ? '—' : String(value);
  }

  /**
   * Gardes AVANT lecture (S-base) : un fichier de plus de 512 Ko n'est jamais ouvert, et seule une
   * extension `.csv` ou un type `text/csv` passe. Le texte est ensuite borné par `parseCsv`.
   */
  private readFile(file: File): void {
    if (file.size > CSV_MAX_FILE_BYTES) {
      this.error.set(this.labels.tooLarge);
      this.reset();
      return;
    }
    if (!file.name.toLowerCase().endsWith('.csv') && file.type !== 'text/csv') {
      this.error.set(this.labels.notCsv);
      this.reset();
      return;
    }
    const reader = new FileReader();
    reader.onload = () => this.applyParsed(parseCsv(String(reader.result ?? '')), file.name);
    reader.readAsText(file);
  }

  private applyParsed(parsed: ParsedCsv, fileName: string | null): void {
    this.error.set(null);
    if (!parsed.headers.length) { this.reset(); return; }
    this.fileName.set(fileName);
    this.parsed.set(parsed);
    this.mapping.set(this.autoMap(parsed.headers));
  }

  private reset(): void {
    this.fileName.set(null);
    this.parsed.set(null);
    this.mapping.set([]);
  }

  /**
   * Pré-rapprochement d'une colonne : clé du champ égale à l'en-tête slugifié, sinon libellé du
   * champ égal à l'en-tête (insensible à la casse et aux accents, via `slugify`), sinon ignorée.
   */
  private autoMap(headers: string[]): string[] {
    const fields = this.entity().fields;
    return headers.map(header => {
      const slug = slugify(header);
      return (fields.find(f => f.key === slug) ?? fields.find(f => slugify(f.label) === slug))?.key ?? IGNORE;
    });
  }
}
