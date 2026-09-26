import { Directive, HostBinding } from '@angular/core';

/** Isole le contenu en LTR (montants, fractions, codes) en contexte RTL. */
@Directive({
  selector: '[appLtr]',
  standalone: true
})
export class LtrHostDirective {
  @HostBinding('attr.dir') readonly dir = 'ltr';
  @HostBinding('style.unicode-bidi') readonly bidi = 'isolate';
  @HostBinding('class.erp-ltr-isolate') readonly cls = true;
}
