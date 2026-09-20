import { ChangeDetectionStrategy, Component, computed, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { StudioService } from '../../studio.service';
import { CustomSystem } from '../../studio.models';
import { STUDIO_AI_LABELS, formatLabel } from '../studio-ai-labels';
import { studioAiHttpError } from '../studio-ai-spec.util';

/** Borne serveur du nom de la copie (`MaxDisplayNameOverrideLength`). */
export const DUPLICATE_MAX_DISPLAY_NAME = 128;

/** Corps émis vers la page ⇒ `store.duplicateSystem(key, displayName)`. */
export interface StudioAiDuplicateRequest {
  key: string;
  displayName: string | null;
}

/**
 * Dialog « Dupliquer un système » (plan 3.4j2). Le dialog n'appelle pas l'API de duplication :
 * il émet `submitted` et la page relie l'événement au store (`POST systems/{key}/duplicate`).
 *
 * - Clé préréglée (`systemKey`, carte résultat ou `?duplicate=`) ⇒ pas de `p-select` ; clé absente
 *   (rail) ⇒ liste des systèmes. La liste est chargée à l'ouverture dans les deux cas : elle sert
 *   aussi à résoudre le nom affiché du système source (« <nom> (copie) »).
 * - Nom borné à 128 caractères avec compteur ; vide ⇒ `null` (nom par défaut côté serveur).
 * - Aucun `innerHTML` ; aucun appel réseau tant que le dialog est fermé.
 */
@Component({
  selector: 'app-studio-ai-duplicate-dialog',
  standalone: true,
  imports: [DialogModule, ButtonModule, InputTextModule, SelectModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p-dialog
      [header]="labels.importExport.duplicateTitle"
      [(visible)]="visible"
      [modal]="true"
      [draggable]="false"
      [closable]="!busy()"
      [style]="{ width: '520px', maxWidth: '95vw' }">
      <div class="said">
        @if (systemKey() === null) {
          <div class="said__field">
            <label for="said-system">{{ labels.importExport.chooseSystem }}</label>
            <p-select
              inputId="said-system"
              [options]="systems()"
              optionLabel="displayName"
              optionValue="key"
              appendTo="body"
              panelStyleClass="studio-theme"
              [ngModel]="selectedKey()"
              (ngModelChange)="selectedKey.set($event)"
              [disabled]="busy()"
              styleClass="said__select"></p-select>
          </div>
        } @else {
          <div class="said__source" data-role="source">
            <i class="fa-solid fa-layer-group said__source-icon" aria-hidden="true"></i>
            <div class="said__source-body">
              <span class="said__source-eyebrow">{{ labels.importExport.duplicateSource }}</span>
              <span class="said__source-name">{{ sourceName() }}</span>
              @if (sourceSystem(); as source) {
                <span class="said__source-meta">{{ entitiesText(source.entityCount) }}</span>
              }
            </div>
          </div>
        }

        @if (error()) {
          <p class="said__error" role="alert">
            <i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i> {{ error() }}
          </p>
        }

        <div class="said__field">
          <div class="said__field-row">
            <label for="said-name">{{ labels.importExport.copyName }}</label>
            <span class="said__counter" aria-live="polite" data-role="name-counter">{{ counterText() }}</span>
          </div>
          <input
            id="said-name"
            pInputText
            type="text"
            autocomplete="off"
            [attr.maxlength]="maxDisplayName"
            [placeholder]="placeholder()"
            [disabled]="busy()"
            [ngModel]="displayName()"
            (ngModelChange)="onNameChange($event)" />
        </div>

        <p class="said__note">
          <i class="fa-solid fa-circle-info" aria-hidden="true"></i> {{ labels.importExport.duplicateNote }}
        </p>
      </div>
      <ng-template pTemplate="footer">
        <div class="said__footer">
          <button
            pButton
            type="button"
            class="p-button-text"
            icon="fa-solid fa-xmark"
            [label]="labels.confirm.cancel"
            [disabled]="busy()"
            (click)="close()"></button>
          <span class="said__footer-spacer"></span>
          <button
            pButton
            type="button"
            data-action="duplicate"
            [icon]="busy() ? 'fa-solid fa-spinner fa-spin' : 'fa-regular fa-clone'"
            [label]="labels.importExport.createCopy"
            [disabled]="!canSubmit()"
            (click)="submit()"></button>
        </div>
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    .said { display: flex; flex-direction: column; gap: var(--spacing-3); }
    .said__field { display: flex; flex-direction: column; gap: var(--spacing-1); }
    .said__field-row { display: flex; align-items: baseline; justify-content: space-between; gap: var(--spacing-2); }
    .said__field label {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      color: var(--color-neutral-800);
    }
    .said__counter { font-size: var(--font-size-xs, 12px); color: var(--color-neutral-500); font-variant-numeric: tabular-nums; }
    .said__source {
      display: flex;
      align-items: flex-start;
      gap: var(--spacing-3);
      padding: var(--spacing-3);
      border: 1px solid var(--color-neutral-200);
      border-radius: var(--radius-md, 6px);
      background: var(--color-neutral-50);
    }
    .said__source-icon { margin-top: 2px; color: var(--color-primary-600); }
    .said__source-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .said__source-eyebrow { font-size: var(--font-size-xs, 12px); text-transform: uppercase; letter-spacing: .04em; color: var(--color-neutral-500); }
    .said__source-name { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--color-neutral-900); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .said__source-meta { font-size: var(--font-size-xs, 12px); color: var(--color-neutral-600); }
    .said__error, .said__note { margin: 0; font-size: var(--font-size-sm); color: var(--color-neutral-700); }
    .said__error { color: var(--color-danger-700, #b91c1c); }
    .said__note {
      display: flex;
      gap: var(--spacing-2);
      padding: var(--spacing-2) var(--spacing-3);
      border-radius: var(--radius-md, 6px);
      background: var(--color-primary-50);
      color: var(--color-primary-800, var(--color-neutral-800));
    }
    .said__footer { display: flex; align-items: center; gap: var(--spacing-2); }
    .said__footer-spacer { flex: 1; }
  `]
})
export class StudioAiDuplicateDialogComponent {
  private readonly studio = inject(StudioService);

  /** Ouverture pilotée par l'appelant (deux-sens : la croix et Échap referment aussi). */
  readonly visible = model(false);
  /** `true` pendant le `POST systems/{key}/duplicate` du store. */
  readonly busy = input(false);
  /** Clé préréglée depuis la carte résultat ou `?duplicate=` ; `null` ⇒ choix dans un `p-select`. */
  readonly systemKey = input<string | null>(null);
  /** `{ key, displayName|null }` ; la page le relie à `store.duplicateSystem(key, displayName)`. */
  readonly submitted = output<StudioAiDuplicateRequest>();

  readonly systems = signal<CustomSystem[]>([]);
  readonly selectedKey = signal<string | null>(null);
  /** Nom saisi ; vide ⇒ `null` (défaut serveur « <nom> (copie) »). */
  readonly displayName = signal('');
  readonly error = signal<string | null>(null);
  readonly canSubmit = computed(() => !!this.selectedKey() && !this.busy());

  protected readonly labels = STUDIO_AI_LABELS;
  protected readonly maxDisplayName = DUPLICATE_MAX_DISPLAY_NAME;
  /** Système source résolu depuis la liste (nom affiché) ; `null` tant que la liste n'est pas chargée. */
  protected readonly sourceSystem = computed(() => {
    const key = this.selectedKey();
    return key ? this.systems().find(s => s.key === key) ?? null : null;
  });
  protected readonly sourceName = computed(() => this.sourceSystem()?.displayName ?? this.selectedKey() ?? '');
  /** « <nom> (copie) » — le nom proposé par défaut si le champ reste vide. */
  readonly placeholder = computed(() => {
    const name = this.sourceName();
    return name ? formatLabel(STUDIO_AI_LABELS.importExport.copySuffix, { name }) : '';
  });
  protected readonly counterText = computed(() =>
    formatLabel(STUDIO_AI_LABELS.importExport.nameCounter, { count: this.displayName().length, max: DUPLICATE_MAX_DISPLAY_NAME })
  );

  constructor() {
    effect(() => {
      const open = this.visible();
      untracked(() => (open ? this.onOpen() : this.reset()));
    });
  }

  /** Borne client 128 caractères (le `maxlength` natif ne couvre pas les affectations programmatiques). */
  onNameChange(value: string): void {
    this.displayName.set((value ?? '').slice(0, DUPLICATE_MAX_DISPLAY_NAME));
  }

  submit(): void {
    const key = this.selectedKey();
    if (!key || this.busy()) {
      return;
    }
    const name = this.displayName().trim();
    this.submitted.emit({ key, displayName: name.length ? name : null });
  }

  reset(): void {
    this.displayName.set('');
    this.error.set(null);
    this.selectedKey.set(null);
    this.systems.set([]);
  }

  protected entitiesText(count: number): string {
    return formatLabel(STUDIO_AI_LABELS.importExport.entitiesCount, { count });
  }

  protected close(): void {
    this.visible.set(false);
  }

  private onOpen(): void {
    this.reset();
    this.selectedKey.set(this.systemKey());
    this.studio.listSystems().subscribe({
      next: res => this.systems.set(res.data ?? []),
      error: err => {
        this.systems.set([]);
        this.error.set(studioAiHttpError(err, 'generic'));
      }
    });
  }
}
