import { Injectable, computed, inject, signal } from '@angular/core';
import { StudioAiBuildService } from '../studio-ai-build.service';
import { STUDIO_AI_CAPABILITIES_FALLBACK, StudioAiCapabilitiesDto } from './studio-ai.models';

export type StudioAiCapabilitiesState = 'unknown' | 'loading' | 'ready' | 'unavailable';

/**
 * Cache des capacités Studio IA (`GET api/ai/studio/capabilities`) pour la session.
 *
 * Un seul appel réseau par session : l'aiguillage `/studio/ai` (legacy vs atelier), les cartes
 * d'intention et les bannières de l'aperçu lisent le même état. Toute erreur (404 quand le flag
 * `EnableStudioAiWorkbench` est faux, 401/403, réseau…) se traduit par `workbenchEnabled=false`
 * — l'atelier ne s'affiche jamais « à moitié » : on retombe sur la page legacy.
 */
@Injectable({ providedIn: 'root' })
export class StudioAiCapabilitiesService {
  private readonly builds = inject(StudioAiBuildService);

  private readonly _state = signal<StudioAiCapabilitiesState>('unknown');
  private readonly _capabilities = signal<StudioAiCapabilitiesDto>(STUDIO_AI_CAPABILITIES_FALLBACK);

  readonly state = this._state.asReadonly();
  readonly capabilities = this._capabilities.asReadonly();
  readonly loading = computed(() => this._state() === 'unknown' || this._state() === 'loading');
  readonly workbenchEnabled = computed(() => this._state() === 'ready' && this._capabilities().workbenchEnabled);
  readonly workflowsEnabled = computed(() => this._state() === 'ready' && this._capabilities().workflowsEnabled === true);
  readonly workflowToolsEnabled = computed(() => this._state() === 'ready' && this._capabilities().workflowToolsEnabled === true);

  /** Charge une fois ; les appels suivants sont sans effet tant que `reset()` n'est pas invoqué. */
  ensureLoaded(): void {
    if (this._state() !== 'unknown') return;
    this._state.set('loading');
    this.builds.getCapabilities().subscribe({
      next: res => {
        if (res?.success && res.data) {
          this._capabilities.set({ ...STUDIO_AI_CAPABILITIES_FALLBACK, ...res.data });
          this._state.set('ready');
        } else {
          this.markUnavailable();
        }
      },
      error: () => this.markUnavailable()
    });
  }

  /** Oublie le cache (ex. changement de tenant / reconnexion). */
  reset(): void {
    this._state.set('unknown');
    this._capabilities.set(STUDIO_AI_CAPABILITIES_FALLBACK);
  }

  private markUnavailable(): void {
    this._capabilities.set(STUDIO_AI_CAPABILITIES_FALLBACK);
    this._state.set('unavailable');
  }
}
