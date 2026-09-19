import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  ViewChild,
  AfterViewInit
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { InputTextModule } from 'primeng/inputtext';

/**
 * Champ de scan à poser en tête d'une grille de lignes.
 *
 * <p>
 * C'est un simple champ de saisie, pas une interception globale du clavier. Sur un écran de
 * document, l'utilisateur est presque toujours <b>dans</b> un champ — quantité, prix,
 * désignation — et une capture globale devrait alors annuler après coup ce que le navigateur a
 * déjà inséré. C'est le vecteur de régression le plus sérieux de toute cette fonctionnalité :
 * une douchette qui vole les frappes d'un champ prix corrompt des documents.
 * </p>
 *
 * <p>
 * Ici, la douchette tape dans ce champ et envoie <c>Enter</c> : aucune heuristique de vitesse
 * de frappe, un comportement visible, et la saisie manuelle du code reste possible. Le champ
 * reprend le focus après chaque scan pour permettre d'enchaîner sans souris.
 * </p>
 *
 * <p>Le point de vente, lui, conserve sa capture globale : il occupe l'écran entier et n'a pas
 * d'autre champ à protéger.</p>
 */
@Component({
  selector: 'ft-barcode-scan-field',
  standalone: true,
  imports: [CommonModule, FormsModule, InputTextModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ft-barcode-scan-field">
      <span class="p-input-icon-left w-100">
        <i class="pi pi-barcode" aria-hidden="true"></i>
        <input
          #input
          pInputText
          type="text"
          class="w-100"
          [attr.aria-label]="placeholder"
          [placeholder]="placeholder"
          [disabled]="disabled"
          [(ngModel)]="value"
          (keyup.enter)="emit()"
          autocomplete="off"
          spellcheck="false" />
      </span>
    </div>
  `,
  styles: [
    `
      .ft-barcode-scan-field {
        display: block;
      }
      .w-100 {
        width: 100%;
      }
    `
  ]
})
export class BarcodeScanFieldComponent implements AfterViewInit {
  @Input() placeholder = 'Scanner ou saisir un code-barres';
  @Input() autoFocus = true;
  @Input() disabled = false;
  /** Vider le champ après chaque scan. Défaut `true`. */
  @Input() clearOnScan = true;

  @Output() scanned = new EventEmitter<string>();

  @ViewChild('input') private inputRef?: ElementRef<HTMLInputElement>;

  value = '';

  ngAfterViewInit(): void {
    if (this.autoFocus) this.focus();
  }

  /** Rend le focus au champ. Appelé par le parent après un scan traité ailleurs. */
  focus(): void {
    // Différé d'un tour de boucle : au premier affichage comme après un scan, le champ peut
    // encore être en train d'être (ré)attaché quand on demande le focus.
    setTimeout(() => this.inputRef?.nativeElement.focus(), 0);
  }

  emit(): void {
    const code = this.value.trim();
    if (!code) return;

    this.scanned.emit(code);

    if (this.clearOnScan) this.value = '';
    this.focus();
  }
}
