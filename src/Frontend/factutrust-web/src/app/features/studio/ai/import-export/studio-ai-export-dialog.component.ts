import { ChangeDetectionStrategy, Component, computed, effect, inject, input, model, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { StudioAiBuildService } from '../../studio-ai-build.service';
import { StudioService } from '../../studio.service';
import { CustomSystem } from '../../studio.models';
import { STUDIO_AI_LABELS, formatLabel } from '../studio-ai-labels';
import { slugify, studioAiHttpError } from '../studio-ai-spec.util';
import { StudioSystemExportDto } from '../studio-ai.models';

/**
 * Dialog « Exporter le système » (plan 3.4i1). Autonome : il ne dépend pas du store de session
 * (fourni au niveau de la page atelier) pour être réutilisable depuis le hub d'un système.
 *
 * - Clé préréglée (`systemKey`) ⇒ export immédiat ; clé absente ⇒ liste des systèmes dans un `p-select`.
 * - Aucun appel HTTP tant que le dialog n'est pas ouvert ; l'export est un `GET` pur.
 * - L'aperçu JSON est rendu par interpolation dans un `<pre>` (jamais `innerHTML`).
 * - Le fichier téléchargé contient la spec seule, nommée `studio-system-<clé>.json` comme le
 *   serveur (`?download=true`).
 */
@Component({
  selector: 'app-studio-ai-export-dialog',
  standalone: true,
  imports: [DialogModule, ButtonModule, CheckboxModule, SelectModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p-dialog
      [header]="labels.importExport.exportTitle"
      [(visible)]="visible"
      [modal]="true"
      [draggable]="false"
      [closable]="true"
      [style]="{ width: '640px', maxWidth: '95vw' }">
      <div class="saie">
        @if (systemKey() === null) {
          <div class="saie__field">
            <label for="saie-system">{{ labels.importExport.chooseSystem }}</label>
            @if (systemsLoaded() && systems().length === 0) {
              <p class="saie__empty">{{ labels.importExport.noSystem }}</p>
            } @else {
              <p-select
                inputId="saie-system"
                [options]="systems()"
                optionLabel="displayName"
                optionValue="key"
                appendTo="body"
                panelStyleClass="studio-theme"
                [ngModel]="selectedKey()"
                (ngModelChange)="selectedKey.set($event)"
                [disabled]="loading()"
                styleClass="saie__select"></p-select>
            }
          </div>
        }

        <div class="saie__seed">
          <p-checkbox
            inputId="saie-seed"
            [binary]="true"
            [ngModel]="includeSeed()"
            (ngModelChange)="includeSeed.set($event)"
            [disabled]="loading() || !selectedKey()"></p-checkbox>
          <label for="saie-seed">{{ labels.importExport.includeSeed }}</label>
        </div>

        @if (loading()) {
          <p class="saie__loading" role="status">
            <i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> {{ labels.importExport.exportLoading }}
          </p>
        } @else if (error()) {
          <div class="saie__error" role="alert">
            <p class="saie__error-title">{{ labels.importExport.exportFailed }}</p>
            <p class="saie__error-message">{{ error() }}</p>
          </div>
        } @else if (result()) {
          <p class="saie__counters">{{ countersText() }}</p>
          @if (warnings().length) {
            <p class="saie__warnings-title">{{ labels.importExport.exportWarnings }}</p>
            <ul class="saie__warnings">
              @for (warning of warnings(); track warning) {
                <li><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> {{ warning }}</li>
              }
            </ul>
          }
          <pre class="saie__json">{{ json() }}</pre>
          <p class="saie__file">{{ fileText() }}</p>
        }
      </div>
      <ng-template pTemplate="footer">
        <div class="saie__footer">
          <button
            pButton
            type="button"
            class="p-button-text"
            icon="fa-solid fa-xmark"
            [label]="labels.importExport.close"
            (click)="close()"></button>
          <span class="saie__footer-spacer"></span>
          <button
            pButton
            type="button"
            class="p-button-outlined"
            data-action="copy"
            [icon]="copied() ? 'fa-solid fa-check' : 'fa-regular fa-copy'"
            [label]="copied() ? labels.importExport.copied : labels.importExport.copy"
            [disabled]="loading() || !result()"
            (click)="copy()"></button>
          <button
            pButton
            type="button"
            data-action="download"
            icon="fa-solid fa-download"
            [label]="labels.importExport.download + ' .json'"
            [disabled]="loading() || !result()"
            (click)="download()"></button>
        </div>
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    .saie { display: flex; flex-direction: column; gap: var(--spacing-3); }
    .saie__field { display: flex; flex-direction: column; gap: var(--spacing-1); }
    .saie__field label, .saie__seed label {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      color: var(--color-neutral-800);
    }
    .saie__seed { display: flex; align-items: center; gap: var(--spacing-2); }
    .saie__seed label { cursor: pointer; }
    .saie__empty, .saie__loading, .saie__counters, .saie__file, .saie__warnings-title,
    .saie__error-title, .saie__error-message {
      margin: 0;
      font-size: var(--font-size-sm);
      color: var(--color-neutral-700);
    }
    .saie__loading { color: var(--color-neutral-500); }
    .saie__warnings-title { font-weight: var(--font-weight-semibold); }
    .saie__warnings {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);
      margin: 0;
      padding: 0;
      list-style: none;
      font-size: var(--font-size-sm);
      color: var(--color-warning-700, #b45309);
    }
    .saie__error { display: flex; flex-direction: column; gap: var(--spacing-1); }
    .saie__error-title { font-weight: var(--font-weight-semibold); color: var(--color-danger-700, #b91c1c); }
    .saie__json {
      margin: 0;
      padding: var(--spacing-3);
      max-height: 280px;
      overflow: auto;
      border: 1px solid var(--color-neutral-200);
      border-radius: var(--radius-md, 6px);
      background: var(--color-neutral-50);
      font-family: var(--font-family-mono, ui-monospace, monospace);
      font-size: var(--font-size-xs, 12px);
      line-height: 1.5;
      color: var(--color-neutral-800);
      white-space: pre;
    }
    .saie__file { color: var(--color-neutral-500); }
    .saie__footer { display: flex; align-items: center; gap: var(--spacing-2); }
    .saie__footer-spacer { flex: 1; }
  `]
})
export class StudioAiExportDialogComponent {
  private readonly builds = inject(StudioAiBuildService);
  private readonly studio = inject(StudioService);

  /** Ouverture pilotée par l'appelant (deux-sens : la croix et Échap referment aussi). */
  readonly visible = model(false);
  /** Clé préréglée depuis la carte résultat ou le hub ; `null` ⇒ choix dans un `p-select`. */
  readonly systemKey = input<string | null>(null);

  readonly selectedKey = signal<string | null>(null);
  readonly systems = signal<CustomSystem[]>([]);
  readonly includeSeed = signal(false);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly result = signal<StudioSystemExportDto | null>(null);
  readonly copied = signal(false);

  readonly json = computed(() => (this.result() ? JSON.stringify(this.result()!.spec, null, 2) : ''));
  readonly fileName = computed(() => `studio-system-${slugify(this.selectedKey() ?? 'export')}.json`);
  readonly countersText = computed(() => {
    const r = this.result();
    return r
      ? formatLabel(STUDIO_AI_LABELS.importExport.counters, {
          entities: r.entityCount,
          relations: r.relationCount,
          views: r.viewCount
        })
      : '';
  });

  protected readonly labels = STUDIO_AI_LABELS;
  protected readonly systemsLoaded = signal(false);
  protected readonly warnings = computed(() => this.result()?.warnings ?? []);
  protected readonly fileText = computed(() =>
    formatLabel(STUDIO_AI_LABELS.importExport.exportFile, { name: this.fileName() })
  );

  private copiedTimer: ReturnType<typeof setTimeout> | null = null;
  /** Export en vol ; annulé par un nouveau `load()` ou la fermeture (évite une réponse tardive). */
  private exportSub: Subscription | null = null;

  constructor() {
    // Ouverture / fermeture : préréglage de la clé, chargement de la liste, remise à zéro.
    effect(() => {
      const open = this.visible();
      untracked(() => (open ? this.onOpen() : this.onClose()));
    });
    // Nouvelle clé ou nouvelle valeur de « Inclure les données de départ » ⇒ export relancé.
    effect(() => {
      const open = this.visible();
      const key = this.selectedKey();
      this.includeSeed();
      untracked(() => {
        if (open && key) {
          this.load();
        }
      });
    });
  }

  /** `GET systems/{key}/export?includeSeed=` ; erreur ⇒ message utilisateur, aucun aperçu. */
  load(): void {
    const key = this.selectedKey();
    if (!key) {
      return;
    }
    this.exportSub?.unsubscribe();
    this.loading.set(true);
    this.error.set(null);
    this.result.set(null);
    this.copied.set(false);
    this.exportSub = this.builds.exportSystem(key, this.includeSeed()).subscribe({
      next: res => {
        this.result.set(res.data ?? null);
        this.loading.set(false);
      },
      error: err => {
        this.error.set(studioAiHttpError(err, 'generic'));
        this.loading.set(false);
      }
    });
  }

  /** Copie la spec indentée dans le presse-papiers ; « Copié » pendant 2 s. */
  async copy(): Promise<void> {
    if (!this.result()) {
      return;
    }
    try {
      await navigator.clipboard.writeText(this.json());
      this.copied.set(true);
      if (this.copiedTimer) {
        clearTimeout(this.copiedTimer);
      }
      this.copiedTimer = setTimeout(() => this.copied.set(false), 2000);
    } catch {
      this.copied.set(false);
    }
  }

  /** Téléchargement client : Blob `application/json` de la spec seule, nommé comme côté serveur. */
  download(): void {
    if (!this.result()) {
      return;
    }
    const blob = new Blob([this.json()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = this.fileName();
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  protected close(): void {
    this.visible.set(false);
  }

  private onOpen(): void {
    this.result.set(null);
    this.selectedKey.set(this.systemKey());
    this.systemsLoaded.set(false);
    if (this.systemKey() !== null) {
      return;
    }
    this.studio.listSystems().subscribe({
      next: res => {
        this.systems.set(res.data ?? []);
        this.systemsLoaded.set(true);
      },
      error: err => {
        this.systems.set([]);
        this.systemsLoaded.set(true);
        this.error.set(studioAiHttpError(err, 'generic'));
      }
    });
  }

  private onClose(): void {
    this.exportSub?.unsubscribe();
    this.exportSub = null;
    this.result.set(null);
    this.error.set(null);
    this.loading.set(false);
    this.copied.set(false);
  }
}
