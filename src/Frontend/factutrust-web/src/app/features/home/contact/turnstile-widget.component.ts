import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  inject,
  input,
  output,
  viewChild
} from '@angular/core';
import type { LandingLocale } from '../content/landing-copy.types';
import { TurnstileLoaderService } from './turnstile-loader.service';
import { TURNSTILE_ACTION, type TurnstileApi } from './turnstile.types';

/**
 * Widget Cloudflare Turnstile (rendu explicite). N'est instancié par le formulaire que si une clé de site
 * est configurée. `token` émet le jeton (ou `null` à l'expiration / erreur) ; `failed` si le script ne charge pas.
 */
@Component({
  selector: 'app-turnstile-widget',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div #host class="turnstile-host" [attr.aria-label]="ariaLabel()" role="group"></div>`,
  styles: [
    `
      :host {
        display: block;
      }
      .turnstile-host {
        min-block-size: 65px;
      }
    `
  ]
})
export class TurnstileWidgetComponent implements AfterViewInit, OnDestroy {
  readonly siteKey = input.required<string>();
  readonly locale = input<LandingLocale>('fr');
  readonly ariaLabel = input<string>('Vérification anti-robot');
  readonly action = input<string>(TURNSTILE_ACTION);

  /** Jeton obtenu, ou `null` (expiré / erreur / réinitialisé). */
  readonly token = output<string | null>();
  /** Script indisponible : le formulaire affiche `errors.turnstileUnavailable`. */
  readonly failed = output<void>();

  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('host');
  private readonly loader = inject(TurnstileLoaderService);
  private api: TurnstileApi | null = null;
  private widgetId: string | undefined;
  private destroyed = false;

  ngAfterViewInit(): void {
    this.loader.load().then(
      api => {
        if (this.destroyed) {
          return;
        }
        this.api = api;
        try {
          this.widgetId = api.render(this.host().nativeElement, {
            sitekey: this.siteKey(),
            action: this.action(),
            language: this.locale(),
            theme: 'light',
            'response-field': false,
            callback: t => this.token.emit(t),
            'expired-callback': () => this.token.emit(null),
            'error-callback': () => this.token.emit(null),
            'timeout-callback': () => this.token.emit(null)
          });
        } catch {
          this.failed.emit();
        }
      },
      () => {
        if (!this.destroyed) {
          this.failed.emit();
        }
      }
    );
  }

  /** À appeler après chaque soumission (un jeton est à usage unique). */
  reset(): void {
    this.token.emit(null);
    if (this.api && this.widgetId !== undefined) {
      try {
        this.api.reset(this.widgetId);
      } catch {
        /* widget déjà retiré */
      }
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.api && this.widgetId !== undefined) {
      try {
        this.api.remove(this.widgetId);
      } catch {
        /* ignore */
      }
    }
  }
}
