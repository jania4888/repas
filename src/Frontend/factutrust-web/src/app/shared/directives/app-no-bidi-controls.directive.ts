import { Directive, ElementRef, HostListener, inject } from '@angular/core';

/** Retire les caractères de contrôle bidirectionnel (spoofing) des champs texte. */
const BIDI_CONTROLS = /[\u061C\u200E-\u200F\u202A-\u202E\u2066-\u2069]/g;

/**
 * Variante réutilisable hors DOM (soumissions de formulaires, pré-remplissages
 * issus de données extraites) : la directive ne voit que les saisies au clavier,
 * pas les valeurs injectées programmatiquement. Réinitialise lastIndex entre
 * deux appels (regex globale partagée).
 */
export function stripBidiControls(value: string): string {
  BIDI_CONTROLS.lastIndex = 0;
  return value.replace(BIDI_CONTROLS, '');
}

@Directive({
  selector: '[appNoBidiControls]',
  standalone: true
})
export class AppNoBidiControlsDirective {
  private readonly el = inject(ElementRef<HTMLInputElement | HTMLTextAreaElement>);

  @HostListener('input')
  onInput(): void {
    this.sanitize();
  }

  @HostListener('paste')
  onPaste(): void {
    queueMicrotask(() => this.sanitize());
  }

  private sanitize(): void {
    const node = this.el.nativeElement;
    const value = node.value;
    if (!value || !BIDI_CONTROLS.test(value)) {
      return;
    }
    BIDI_CONTROLS.lastIndex = 0;
    const cleaned = value.replace(BIDI_CONTROLS, '');
    if (cleaned !== value) {
      node.value = cleaned;
      node.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
}
