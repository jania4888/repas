/// <reference types="@angular/localize" />
import { Injectable, inject } from '@angular/core';

import { ToastService } from '@core/services/toast.service';
import { BarcodeLookupResult } from './barcode-lookup.service';

const SOUND_PREFERENCE_KEY = 'factutrust:barcode-sound';

/**
 * Retour immédiat après un scan : un bip, et un message seulement lorsqu'il y a quelque chose
 * à dire.
 *
 * <p>
 * Le son est engendré par l'API Web Audio, sans aucun fichier binaire : rien à ajouter au
 * paquet, rien à charger, et un bip disponible dès le premier scan. Il compte autant que le
 * message à l'écran — au comptoir ou au quai de réception, l'opérateur regarde l'article, pas
 * l'écran, et c'est le son qui lui dit si le scan a porté.
 * </p>
 */
@Injectable({ providedIn: 'root' })
export class BarcodeFeedbackService {
  // ToastService et non le MessageService de PrimeNG : ce dernier n'est pas fourni à la
  // racine, il est déclaré écran par écran. En dépendre depuis un service racine imposerait
  // silencieusement sa présence à tout composant qui scanne — et ferait échouer l'injection
  // là où il manque.
  private readonly toastService = inject(ToastService);
  private audioContext: AudioContext | null = null;

  /** Le son est activé sauf refus explicite, conservé par navigateur. */
  isSoundEnabled(): boolean {
    try {
      return localStorage.getItem(SOUND_PREFERENCE_KEY) !== 'off';
    } catch {
      // Navigation privée, stockage bloqué : le son reste actif, c'est le défaut voulu.
      return true;
    }
  }

  setSoundEnabled(enabled: boolean): void {
    try {
      localStorage.setItem(SOUND_PREFERENCE_KEY, enabled ? 'on' : 'off');
    } catch {
      // Sans persistance, la préférence vaut pour la session en cours. Sans conséquence.
    }
  }

  /** Scan résolu : bip court et aigu, pas de message — la ligne ajoutée se voit. */
  success(detail?: string): void {
    this.beep(880, 0.08);
    if (detail) {
      this.toastService.add({
        severity: 'success',
        summary: $localize`:@@barcode-feedback.service.summary.Article ajou:Article ajouté`,
        detail,
        life: 1800
      });
    }
  }

  /** Scan refusé : double bip grave, et le motif toujours affiché. */
  failure(detail: string, summary = $localize`:@@shared.barcode-feedback.ts.scan.refuse.0b321781:Scan refusé`): void {
    this.beep(220, 0.12);
    setTimeout(() => this.beep(220, 0.12), 140);
    this.toastService.add({ severity: 'warn', summary, detail, life: 4000 });
  }

  /**
   * Traduit un résultat de résolution en retour utilisateur. Renvoie `true` si l'appelant peut
   * poursuivre (article utilisable).
   */
  report(result: BarcodeLookupResult, successDetail?: string): boolean {
    if (result.status === 'found') {
      this.success(successDetail ?? result.product?.name);
      return true;
    }

    this.failure(
      result.message,
      result.status === 'not_found' ? 'Article introuvable' : $localize`:@@shared.barcode-feedback.ts.scan.refuse.0b321781:Scan refusé`
    );
    return false;
  }

  private beep(frequency: number, durationSeconds: number): void {
    if (!this.isSoundEnabled()) return;

    try {
      this.audioContext ??= new AudioContext();
      const context = this.audioContext;

      // Le navigateur suspend le contexte tant qu'aucune interaction n'a eu lieu ; un scan en
      // est une, donc la reprise aboutit. L'échec éventuel ne doit rien interrompre.
      if (context.state === 'suspended') void context.resume();

      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = 'square';
      oscillator.frequency.value = frequency;
      gain.gain.value = 0.05;

      oscillator.connect(gain);
      gain.connect(context.destination);

      oscillator.start();
      oscillator.stop(context.currentTime + durationSeconds);
    } catch {
      // Audio indisponible (contexte non sécurisé, politique navigateur) : le message à
      // l'écran suffit. Un scan ne doit jamais échouer parce que le bip a échoué.
    }
  }
}
