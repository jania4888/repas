import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import { STUDIO_AI_LABELS } from '../studio-ai-labels';
import { StudioAiPreviewMode } from '../studio-ai.models';

/** Seuil (secondes) sous lequel la pilule d'expiration passe en alerte. */
const EXPIRY_WARN_SECONDS = 300;

interface ModeEntry {
  readonly id: StudioAiPreviewMode;
  readonly label: string;
  readonly icon: string;
}

/**
 * Barre de modes de l'aperçu (M1) : Aperçu / Tester / Personnaliser + pilule d'expiration.
 *
 * Composant de présentation pur : il ne connaît pas le store. Le mode actif est marqué par
 * `aria-pressed` ; les boutons sont désactivés quand le plan est expiré ou qu'une opération est en
 * cours. À 0 seconde la pilule affiche « Expiré » et propose « Régénérer » (⇒ `regenerate`).
 * « Tester » reste cliquable quand l'aperçu serveur est indisponible (mode dégradé local, Q1 b) :
 * seul un tooltip l'indique.
 */
@Component({
  selector: 'app-studio-ai-mode-bar',
  standalone: true,
  imports: [ButtonModule, TooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'sai-modebar-host' },
  styleUrl: './studio-ai-preview.scss',
  template: `
    <div class="sai-modebar" role="toolbar" [attr.aria-label]="labels.toolbar" [attr.aria-disabled]="locked() ? 'true' : null">
      @for (entry of entries; track entry.id) {
        <button
          type="button"
          class="sai-modebar__btn"
          [attr.data-mode]="entry.id"
          [attr.aria-pressed]="mode() === entry.id"
          [disabled]="locked() || disabledModes().includes(entry.id)"
          [pTooltip]="disabledModes().includes(entry.id) ? disabledTooltip() : (entry.id === 'test' && previewUnavailable() ? labels.previewUnavailable : '')"
          [tooltipDisabled]="!disabledModes().includes(entry.id) && (entry.id !== 'test' || !previewUnavailable())"
          tooltipPosition="bottom"
          (click)="select(entry.id)">
          <i [class]="entry.icon" aria-hidden="true"></i>
          <span>{{ entry.label }}</span>
          @if (entry.id === 'customize' && changeCount() > 0) {
            <span class="sai-modebar__badge" [attr.aria-label]="changeCount() + ' ' + labels.changes">{{ changeCount() }}</span>
          }
        </button>
      }
    </div>
    @if (expiresInSeconds() !== null) {
      <span
        class="sai-expiry"
        [class.sai-expiry--warn]="warn()"
        [class.sai-expiry--expired]="expired()"
        role="status"
        aria-live="polite"
        [attr.aria-label]="expiryAriaLabel()">
        <i class="fa-regular fa-clock" aria-hidden="true"></i>
        @if (expired()) {
          <span>{{ labels.expired }}</span>
        } @else {
          <span>{{ labels.expiresIn }} <span class="sai-expiry__time">{{ countdown() }}</span></span>
        }
      </span>
      @if (expired()) {
        <p-button
          size="small"
          icon="fa-solid fa-rotate-right"
          [label]="labels.regenerate"
          [disabled]="busy()"
          (onClick)="regenerate.emit()" />
      }
    }
  `
})
export class StudioAiModeBarComponent {
  readonly mode = input.required<StudioAiPreviewMode>();
  /** Secondes restantes ; `null` = pas d'échéance connue (pilule masquée). */
  readonly expiresInSeconds = input<number | null>(null);
  readonly changeCount = input(0);
  readonly previewUnavailable = input(false);
  readonly busy = input(false);
  /** Modes désactivés pour ce plan (4.4k1 : Tester/Personnaliser d'un plan Workflow, sans spec). */
  readonly disabledModes = input<readonly StudioAiPreviewMode[]>([]);
  /** Info-bulle commune des modes de `disabledModes` (ex. `soonForWorkflows`). */
  readonly disabledTooltip = input('');

  readonly modeChange = output<StudioAiPreviewMode>();
  readonly regenerate = output<void>();

  readonly labels = STUDIO_AI_LABELS.modes;

  readonly entries: readonly ModeEntry[] = [
    { id: 'preview', label: this.labels.preview, icon: 'fa-solid fa-eye' },
    { id: 'test', label: this.labels.test, icon: 'fa-solid fa-play' },
    { id: 'customize', label: this.labels.customize, icon: 'fa-solid fa-sliders' }
  ];

  readonly expired = computed(() => this.expiresInSeconds() === 0);
  readonly warn = computed(() => {
    const s = this.expiresInSeconds();
    return s !== null && s > 0 && s < EXPIRY_WARN_SECONDS;
  });
  readonly locked = computed(() => this.expired() || this.busy());

  /** « mm:ss » (les minutes peuvent dépasser 59). */
  readonly countdown = computed(() => {
    const s = Math.max(0, this.expiresInSeconds() ?? 0);
    const minutes = Math.floor(s / 60);
    const seconds = s % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  });

  /** Libellé lu par les lecteurs d'écran : « Expire dans 9 minutes 41 secondes ». */
  readonly expiryAriaLabel = computed(() => {
    const s = this.expiresInSeconds();
    if (s === null) return null;
    if (s === 0) return this.labels.expired;
    const minutes = Math.floor(s / 60);
    const seconds = s % 60;
    const parts: string[] = [];
    if (minutes > 0) parts.push(`${minutes} minute${minutes > 1 ? 's' : ''}`);
    if (seconds > 0 || minutes === 0) parts.push(`${seconds} seconde${seconds > 1 ? 's' : ''}`);
    return `${this.labels.expiresIn} ${parts.join(' ')}`;
  });

  select(mode: StudioAiPreviewMode): void {
    if (this.locked() || mode === this.mode()) return;
    this.modeChange.emit(mode);
  }
}
