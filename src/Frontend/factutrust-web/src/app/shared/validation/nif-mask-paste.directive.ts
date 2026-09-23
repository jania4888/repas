import { Directive, ElementRef, inject, OnDestroy, OnInit } from '@angular/core';
import { NgControl } from '@angular/forms';
import { nifValueFromPaste } from './validation-rules';

/**
 * Intercepte le collage sur un p-inputMask de matricule fiscal.
 * La forme historique `1772793/W/A/M/000` est réécrite en `1772793W/A/M/000`
 * avant que le masque `9999999a/a/a/999` n'écarte le slash après les 7 chiffres.
 */
@Directive({
  selector: '[appNifMaskPaste]',
  standalone: true
})
export class NifMaskPasteDirective implements OnInit, OnDestroy {
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly ngControl = inject(NgControl, { optional: true, self: true });
  private readonly onPaste = (event: Event): void => this.handlePaste(event as ClipboardEvent);

  ngOnInit(): void {
    this.host.nativeElement.addEventListener('paste', this.onPaste, true);
  }

  ngOnDestroy(): void {
    this.host.nativeElement.removeEventListener('paste', this.onPaste, true);
  }

  private handlePaste(event: ClipboardEvent): void {
    const canonical = nifValueFromPaste(event.clipboardData?.getData('text') ?? '');
    if (!canonical) return;

    event.preventDefault();
    event.stopPropagation();
    const control = this.ngControl?.control;
    if (!control) return;
    control.setValue(canonical);
    control.updateValueAndValidity();
  }
}
