import { Injectable } from '@angular/core';

/** Options d'une inscription à la capture clavier. */
export interface ScannerOptions {
  /** Longueur minimale d'un code pris en compte. Défaut 3. */
  minLength?: number;
  /** Délai d'inactivité au-delà duquel le tampon est vidé. Défaut 50 ms. */
  bufferMs?: number;
  /**
   * Ignorer les frappes lorsque le focus est dans un champ de saisie. Défaut `true`.
   *
   * À laisser à `true` en toutes circonstances sur un écran qui comporte des champs : sans
   * cela, la capture volerait les frappes destinées à une quantité ou à un prix.
   */
  ignoreWhenFocusInEditable?: boolean;
  /** Appelé avec le code complet, une fois `Enter` reçu. */
  onScan: (code: string) => void;
}

/** Jeton d'inscription. `unregister()` est idempotent. */
export interface ScannerRegistration {
  unregister(): void;
}

interface Registration {
  options: Required<Omit<ScannerOptions, 'onScan'>> & Pick<ScannerOptions, 'onScan'>;
  buffer: string;
  timeout: ReturnType<typeof setTimeout> | null;
}

/**
 * Détection d'une douchette branchée en émulation clavier : des frappes rapprochées terminées
 * par `Enter`.
 *
 * <p>
 * La logique de tampon est celle du point de vente, reprise à l'identique — c'est elle qui a
 * fait ses preuves en caisse. Ce service n'y ajoute que ce qui manquait pour la réutiliser
 * ailleurs : plusieurs écrans peuvent s'inscrire, et un seul écouteur clavier est posé sur le
 * document quel que soit leur nombre.
 * </p>
 *
 * <p>
 * Les inscriptions forment une <b>pile</b> : seule celle du sommet reçoit les scans. C'est ce
 * qui règle le cas d'une boîte de dialogue ouverte au-dessus d'un formulaire, où les deux
 * réagiraient sinon au même scan.
 * </p>
 */
@Injectable({ providedIn: 'root' })
export class BarcodeScannerService {
  private readonly stack: Registration[] = [];
  private readonly boundHandler = this.handleKeydown.bind(this);
  private listening = false;

  register(options: ScannerOptions): ScannerRegistration {
    const registration: Registration = {
      options: {
        minLength: options.minLength ?? 3,
        bufferMs: options.bufferMs ?? 50,
        ignoreWhenFocusInEditable: options.ignoreWhenFocusInEditable ?? true,
        onScan: options.onScan
      },
      buffer: '',
      timeout: null
    };

    this.stack.push(registration);
    this.startListening();

    let released = false;
    return {
      unregister: () => {
        if (released) return;
        released = true;

        this.clearBuffer(registration);
        const index = this.stack.indexOf(registration);
        if (index >= 0) this.stack.splice(index, 1);

        if (this.stack.length === 0) this.stopListening();
      }
    };
  }

  /** Inscription active, ou `undefined` si aucune. */
  private get active(): Registration | undefined {
    return this.stack[this.stack.length - 1];
  }

  private startListening(): void {
    if (this.listening || typeof document === 'undefined') return;
    document.addEventListener('keydown', this.boundHandler, true);
    this.listening = true;
  }

  private stopListening(): void {
    if (!this.listening || typeof document === 'undefined') return;
    document.removeEventListener('keydown', this.boundHandler, true);
    this.listening = false;
  }

  private handleKeydown(event: KeyboardEvent): void {
    const registration = this.active;
    if (!registration) return;

    const isEditable =
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement;
    const ignoreEditable = registration.options.ignoreWhenFocusInEditable;

    if (isEditable && ignoreEditable && event.key !== 'Enter') return;

    if (event.key === 'Enter') {
      if (isEditable && ignoreEditable) return;
      event.preventDefault();
      this.flushBuffer(registration);
      return;
    }

    if (
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !(isEditable && ignoreEditable)
    ) {
      this.appendToBuffer(registration, event.key);
    }
  }

  private appendToBuffer(registration: Registration, char: string): void {
    if (registration.timeout) clearTimeout(registration.timeout);
    registration.buffer += char;
    registration.timeout = setTimeout(
      () => this.clearBuffer(registration),
      registration.options.bufferMs
    );
  }

  private clearBuffer(registration: Registration): void {
    registration.buffer = '';
    if (registration.timeout) {
      clearTimeout(registration.timeout);
      registration.timeout = null;
    }
  }

  private flushBuffer(registration: Registration): void {
    if (registration.timeout) {
      clearTimeout(registration.timeout);
      registration.timeout = null;
    }
    const code = registration.buffer.trim();
    this.clearBuffer(registration);

    if (code.length < registration.options.minLength) return;

    registration.options.onScan(code);
  }
}
