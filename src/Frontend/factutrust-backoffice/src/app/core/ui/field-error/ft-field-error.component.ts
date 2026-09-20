import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { AbstractControl } from '@angular/forms';
import { REGISTRATION_ERROR_MESSAGES } from '@core/registration/registration-validators';

/**
 * Message d'erreur d'un champ de formulaire.
 *
 * Le backoffice n'avait aucun affichage d'erreur par champ : les écrans se contentaient d'un
 * `markAllAsTouched()` sans rien montrer, ce qui laisse l'opérateur deviner quel champ bloque.
 *
 * N'affiche rien tant que le contrôle n'a pas été touché, pour ne pas couvrir un formulaire vierge
 * de rouge.
 */
@Component({
  selector: 'ft-field-error',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (message()) {
      <small class="ft-field-error" role="alert">{{ message() }}</small>
    }
  `,
  styles: [
    `
      .ft-field-error {
        display: block;
        margin-top: 0.25rem;
        color: var(--ft-danger-text, #f87171);
        font-size: 0.8125rem;
        line-height: 1.3;
      }
    `
  ]
})
export class FtFieldErrorComponent {
  /** Contrôle surveillé. */
  @Input({ required: true }) control!: AbstractControl | null;

  /** Messages supplémentaires ou surcharges, par clé d'erreur. */
  @Input() messages: Record<string, string> = {};

  protected message(): string | null {
    const control = this.control;
    if (!control || !control.errors) return null;
    if (!control.touched && !control.dirty) return null;

    const firstKey = Object.keys(control.errors)[0];
    if (!firstKey) return null;

    return this.messages[firstKey] ?? REGISTRATION_ERROR_MESSAGES[firstKey] ?? 'Valeur invalide.';
  }
}
