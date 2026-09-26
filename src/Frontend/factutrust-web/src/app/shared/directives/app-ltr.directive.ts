import { Directive, ElementRef, OnInit, Renderer2, inject } from '@angular/core';

/** Isole montants, NIF, RIB, codes en LTR dans une UI RTL. */
@Directive({
  selector: '[appLtr]',
  standalone: true
})
export class AppLtrDirective implements OnInit {
  private readonly el = inject(ElementRef<HTMLElement>);
  private readonly renderer = inject(Renderer2);

  ngOnInit(): void {
    this.renderer.setAttribute(this.el.nativeElement, 'dir', 'ltr');
    this.renderer.setStyle(this.el.nativeElement, 'unicode-bidi', 'isolate');
  }
}
