import { ChangeDetectionStrategy, Component, computed, input, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { STUDIO_AI_LABELS, formatLabel } from '../studio-ai-labels';
import { ImportCustomSystemRequest, StudioSystemSpec, countSpec } from '../studio-ai.models';

/** Borne client = borne réelle du handler serveur (« La spec dépasse 256 Ko. ») — décision utilisateur 2026-09-15. */
export const IMPORT_MAX_BYTES = 256 * 1024;
/** `SupportedSpecVersion` serveur (`StudioSystemSpecExporter.cs`). */
export const SUPPORTED_SPEC_VERSION = 1;
/** `MaxDisplayNameOverrideLength` serveur. */
export const IMPORT_MAX_DISPLAY_NAME = 128;

/**
 * Dialog « Importer un système (JSON) » (plan 3.4j1). Le dialog n'appelle jamais l'API : il valide
 * localement le JSON (taille, syntaxe, objet, `specVersion`) puis émet `submitted` avec le corps de
 * `POST systems/import` ; la page relie l'événement au store et redescend `busy` / `serverError`.
 *
 * Sécurité (S-base) : un fichier de plus de 256 Ko n'est JAMAIS lu (`FileReader` non invoqué), le
 * texte collé est borné de la même façon ; aucune évaluation du JSON au-delà de `JSON.parse` ;
 * aucun `innerHTML` (tout est interpolé).
 */
@Component({
  selector: 'app-studio-ai-import-dialog',
  standalone: true,
  imports: [DialogModule, ButtonModule, CheckboxModule, InputTextModule, TextareaModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p-dialog
      [header]="labels.importExport.importTitle"
      [(visible)]="visible"
      [modal]="true"
      [draggable]="false"
      [closable]="!busy()"
      [style]="{ width: '640px', maxWidth: '95vw' }"
      (onHide)="reset()">
      <div class="saii">
        @if (fileName()) {
          <div class="saii__file">
            <i class="fa-regular fa-file-code" aria-hidden="true"></i>
            <span class="saii__file-name">{{ fileName() }}</span>
            <button
              pButton
              type="button"
              class="p-button-text p-button-sm"
              data-action="remove"
              icon="fa-solid fa-xmark"
              [label]="labels.importExport.remove"
              [disabled]="busy()"
              (click)="reset()"></button>
          </div>
        } @else {
          <label class="saii__drop" for="saii-file">
            <i class="fa-solid fa-file-arrow-up saii__drop-icon" aria-hidden="true"></i>
            <span class="saii__drop-title">{{ labels.importExport.dropJson }}</span>
            <input
              id="saii-file"
              class="saii__input"
              type="file"
              accept=".json,application/json"
              [disabled]="busy()"
              (change)="onFile($event)" />
          </label>
        }

        <div class="saii__field">
          <label for="saii-raw">{{ labels.importExport.pasteJson }}</label>
          <textarea
            id="saii-raw"
            pTextarea
            rows="7"
            class="saii__raw"
            spellcheck="false"
            [disabled]="busy()"
            [ngModel]="raw()"
            (ngModelChange)="onPaste($event)"></textarea>
        </div>

        @if (error()) {
          <p class="saii__error" role="alert">
            <i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i> {{ error() }}
          </p>
        } @else if (counters()) {
          <div class="saii__recognized" role="status">
            <p class="saii__recognized-title">
              <i class="fa-solid fa-circle-check" aria-hidden="true"></i> {{ labels.importExport.recognized }}
            </p>
            <p class="saii__counters">{{ countersText() }}</p>
            @if ((counters()?.seedRecords ?? 0) > 0) {
              <p class="saii__counters">{{ seedText() }}</p>
            }
          </div>
        }

        @if (serverError()) {
          <p class="saii__error saii__error--server" role="alert" data-role="server-error">
            <i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i> {{ serverError() }}
          </p>
        }

        <div class="saii__field">
          <label for="saii-name">{{ labels.importExport.displayName }}</label>
          <input
            id="saii-name"
            pInputText
            type="text"
            autocomplete="off"
            [attr.maxlength]="maxDisplayName"
            [disabled]="busy()"
            [ngModel]="displayNameOverride()"
            (ngModelChange)="displayNameOverride.set($event)" />
        </div>

        <div class="saii__seed">
          <p-checkbox
            inputId="saii-seed"
            [binary]="true"
            [ngModel]="includeSeed()"
            (ngModelChange)="includeSeed.set($event)"
            [disabled]="busy()"></p-checkbox>
          <label for="saii-seed">{{ labels.importExport.includeSeed }}</label>
        </div>
      </div>
      <ng-template pTemplate="footer">
        <div class="saii__footer">
          <button
            pButton
            type="button"
            class="p-button-text"
            icon="fa-solid fa-xmark"
            [label]="labels.confirm.cancel"
            [disabled]="busy()"
            (click)="close()"></button>
          <span class="saii__footer-spacer"></span>
          <button
            pButton
            type="button"
            data-action="import"
            [icon]="busy() ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-file-import'"
            [label]="labels.importExport.import"
            [disabled]="!canSubmit()"
            (click)="submit()"></button>
        </div>
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    .saii { display: flex; flex-direction: column; gap: var(--spacing-3); }
    .saii__drop {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--spacing-1);
      padding: var(--spacing-4);
      border: 2px dashed var(--color-neutral-300);
      border-radius: var(--radius-lg, 8px);
      background: var(--color-neutral-50);
      text-align: center;
      cursor: pointer;
    }
    .saii__drop:hover { border-color: var(--color-primary-400); background: var(--color-primary-50); }
    .saii__drop-icon { font-size: 1.25rem; color: var(--color-primary-600); }
    .saii__drop-title { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--color-neutral-800); }
    .saii__input { position: absolute; width: 1px; height: 1px; opacity: 0; overflow: hidden; }
    .saii__file {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      padding: var(--spacing-2) var(--spacing-3);
      border: 1px solid var(--color-neutral-200);
      border-radius: var(--radius-md, 6px);
      background: var(--color-neutral-50);
      font-size: var(--font-size-sm);
      color: var(--color-neutral-800);
    }
    .saii__file-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: var(--font-weight-medium); }
    .saii__field { display: flex; flex-direction: column; gap: var(--spacing-1); }
    .saii__field label, .saii__seed label {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      color: var(--color-neutral-800);
    }
    .saii__raw {
      width: 100%;
      resize: vertical;
      font-family: var(--font-family-mono, ui-monospace, monospace);
      font-size: var(--font-size-xs, 12px);
      line-height: 1.5;
    }
    .saii__seed { display: flex; align-items: center; gap: var(--spacing-2); }
    .saii__seed label { cursor: pointer; }
    .saii__error, .saii__counters, .saii__recognized-title {
      margin: 0;
      font-size: var(--font-size-sm);
      color: var(--color-neutral-700);
    }
    .saii__error { color: var(--color-danger-700, #b91c1c); }
    .saii__recognized { display: flex; flex-direction: column; gap: var(--spacing-1); }
    .saii__recognized-title { font-weight: var(--font-weight-semibold); color: var(--color-success-700, #15803d); }
    .saii__footer { display: flex; align-items: center; gap: var(--spacing-2); }
    .saii__footer-spacer { flex: 1; }
  `]
})
export class StudioAiImportDialogComponent {
  /** Ouverture pilotée par l'appelant (deux-sens : la croix et Échap referment aussi). */
  readonly visible = model(false);
  /** `true` pendant le `POST systems/import` du store. */
  readonly busy = input(false);
  /** Erreur du store après POST (400/413), affichée telle quelle (D12). */
  readonly serverError = input<string | null>(null);
  /** Corps de `POST systems/import` ; la page le relie à `store.importSystem(req)`. */
  readonly submitted = output<ImportCustomSystemRequest>();

  readonly fileName = signal<string | null>(null);
  /** Texte collé ou lu. */
  readonly raw = signal('');
  readonly error = signal<string | null>(null);
  readonly spec = signal<Record<string, unknown> | null>(null);
  readonly counters = computed(() => {
    const spec = this.spec();
    return spec && Array.isArray(spec['entities']) ? countSpec(spec as unknown as StudioSystemSpec) : null;
  });
  /** maxlength 128 (`MaxDisplayNameOverrideLength` serveur). */
  readonly displayNameOverride = signal('');
  /** Défaut serveur `includeSeed = true`. */
  readonly includeSeed = signal(true);
  readonly canSubmit = computed(() => !!this.spec() && !this.error() && !this.busy());
  /** Lecture de fichier en cours ; annulée par « Retirer » ou un nouveau fichier. */
  private reader: FileReader | null = null;

  protected readonly labels = STUDIO_AI_LABELS;
  protected readonly maxDisplayName = IMPORT_MAX_DISPLAY_NAME;
  protected readonly countersText = computed(() => {
    const c = this.counters();
    return c
      ? formatLabel(STUDIO_AI_LABELS.importExport.counters, { entities: c.entities, relations: c.relations, views: c.views })
      : '';
  });
  protected readonly seedText = computed(() => {
    const c = this.counters();
    return c ? formatLabel(STUDIO_AI_LABELS.importExport.seedRecords, { count: c.seedRecords }) : '';
  });

  /** Garde `file.size > 256 Ko` AVANT tout `FileReader` (S-base). */
  onFile(event: Event): void {
    const inputEl = event.target as HTMLInputElement | null;
    const file = inputEl?.files?.[0];
    if (inputEl) {
      inputEl.value = '';
    }
    if (!file) {
      return;
    }
    if (file.size > IMPORT_MAX_BYTES) {
      this.clearContent();
      this.error.set(STUDIO_AI_LABELS.importExport.tooLarge);
      return;
    }
    this.reader?.abort();
    const reader = new FileReader();
    this.reader = reader;
    reader.onload = () => {
      if (this.reader !== reader) {
        return;
      }
      this.reader = null;
      const text = String(reader.result ?? '');
      this.fileName.set(file.name);
      this.raw.set(text);
      this.parse(text);
    };
    reader.onerror = () => {
      if (this.reader !== reader) {
        return;
      }
      this.reader = null;
      this.error.set(STUDIO_AI_LABELS.importExport.invalidJson);
    };
    reader.readAsText(file);
  }

  /** Même garde sur `text.length` (UTF-16 ≈ octets, borne conservatrice). */
  onPaste(text: string): void {
    const value = text ?? '';
    this.raw.set(value);
    this.fileName.set(null);
    if (value.length > IMPORT_MAX_BYTES) {
      this.spec.set(null);
      this.error.set(STUDIO_AI_LABELS.importExport.tooLarge);
      return;
    }
    this.parse(value);
  }

  /** `submitted.emit({ spec, displayNameOverride: trim || null, includeSeed })`. */
  submit(): void {
    const spec = this.spec();
    if (!spec || !this.canSubmit()) {
      return;
    }
    const name = this.displayNameOverride().trim().slice(0, IMPORT_MAX_DISPLAY_NAME);
    this.submitted.emit({ spec, displayNameOverride: name || null, includeSeed: this.includeSeed() });
  }

  /** « Retirer » : vide le fichier, le texte, la spec et l'erreur. */
  reset(): void {
    this.clearContent();
    this.error.set(null);
  }

  protected close(): void {
    this.visible.set(false);
  }

  /**
   * `JSON.parse` ⇒ `invalidJson` ; non-objet ⇒ `notObject` ; enveloppe d'export (`spec` objet +
   * `systemKey`) ⇒ `.spec` ; `specVersion` présent et ≠ 1 ⇒ `badVersion` ; forme minimale
   * (`entities` tableau d'objets à `fields` tableau, `seed` absent ou tableau) sinon `invalidShape`.
   */
  private parse(text: string): void {
    this.spec.set(null);
    if (!text.trim()) {
      this.error.set(null);
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      this.error.set(STUDIO_AI_LABELS.importExport.invalidJson);
      return;
    }
    if (!isObject(parsed)) {
      this.error.set(STUDIO_AI_LABELS.importExport.notObject);
      return;
    }
    let spec: Record<string, unknown> = parsed;
    if (isObject(spec['spec']) && typeof spec['systemKey'] === 'string') {
      spec = spec['spec'];
    }
    const version = spec['specVersion'];
    if (version !== undefined && version !== null && version !== SUPPORTED_SPEC_VERSION) {
      this.error.set(STUDIO_AI_LABELS.importExport.badVersion);
      return;
    }
    if (!hasSpecShape(spec)) {
      this.error.set(STUDIO_AI_LABELS.importExport.invalidShape);
      return;
    }
    this.error.set(null);
    this.spec.set(spec);
  }

  private clearContent(): void {
    this.reader?.abort();
    this.reader = null;
    this.fileName.set(null);
    this.raw.set('');
    this.spec.set(null);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Forme minimale exigée par `countSpec` : évite un plantage du rendu sur un JSON quelconque. */
function hasSpecShape(spec: Record<string, unknown>): boolean {
  const entities = spec['entities'];
  if (!Array.isArray(entities) || !entities.every(e => isObject(e) && Array.isArray(e['fields']))) {
    return false;
  }
  const seed = spec['seed'];
  return seed === undefined || seed === null || Array.isArray(seed);
}
