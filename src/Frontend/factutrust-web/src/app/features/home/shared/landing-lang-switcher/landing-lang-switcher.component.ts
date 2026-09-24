import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter } from 'rxjs';
import { environment } from '@environments/environment';
import { LandingLocaleService } from '@core/services/landing-locale.service';
import { LandingCopyService } from '../../content/landing-copy.service';
import {
  LANDING_DIR,
  LANDING_LANG_TAG,
  LANDING_LOCALES,
  type LandingLocale
} from '../../content/landing-copy.types';
import { localizedPath } from '../../i18n/landing-locale.util';

/**
 * Sélecteur de langue de la landing (plan D.4.6) : deux liens « FR » / « العربية »,
 * sans `<select>` ni menu déroulant — crawlable, accessible, un seul clic.
 * Le lien conserve le chemin courant (préfixe `/ar` ajouté/retiré), l'ancre et la query.
 * Rendu uniquement quand `environment.landing.arabicEnabled` (rollback sans code).
 */
@Component({
  selector: 'app-landing-lang-switcher',
  standalone: true,
  imports: [RouterLink],
  template: `
    @if (enabled) {
      <nav class="lang-switcher" [attr.aria-label]="t().shared.langSwitcher.label">
        @for (l of locales; track l) {
          <a
            class="lang-switcher__item"
            [routerLink]="targetPath(l)"
            [fragment]="fragment()"
            queryParamsHandling="preserve"
            [attr.lang]="l"
            [attr.dir]="dirOf(l)"
            [attr.hreflang]="langTagOf(l)"
            [attr.aria-current]="l === current() ? 'true' : null"
            [attr.aria-label]="t().shared.langSwitcher.switchTo[l]"
            [class.is-active]="l === current()"
            >{{ l === 'fr' ? t().shared.langSwitcher.fr : t().shared.langSwitcher.ar }}</a
          >
        }
      </nav>
    }
  `,
  styles: [
    `
      .lang-switcher {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
      }
      .lang-switcher__item {
        padding-inline: 0.5rem;
        padding-block: 0.25rem;
        border-radius: 999px;
        font-weight: 600;
        text-decoration: none;
        white-space: nowrap;
      }
      .lang-switcher__item.is-active {
        text-decoration: underline;
        text-underline-offset: 0.2em;
      }
      .lang-switcher__item:focus-visible {
        outline: 2px solid currentColor;
        outline-offset: 2px;
      }
    `
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LandingLangSwitcherComponent {
  protected readonly t = inject(LandingCopyService).t;
  private readonly router = inject(Router);
  private readonly loc = inject(LandingLocaleService);

  /** Le sélecteur disparaît complètement quand l'arabe est désactivé (rollback D.11). */
  readonly enabled = environment.landing?.arabicEnabled === true;
  readonly locales = LANDING_LOCALES;
  readonly current = this.loc.locale;
  /**
   * Ancre courante, portée par un signal : une navigation intra-page (fragment seul)
   * ne recrée pas l'en-tête et ne déclenche pas de CD OnPush — sans signal, l'ancre
   * resterait celle du premier rendu.
   */
  readonly fragment = signal<string | undefined>(undefined);

  constructor() {
    const readFragment = (): void => {
      this.fragment.set(this.router.parseUrl(this.router.url).fragment ?? undefined);
    };
    readFragment();
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed()
      )
      .subscribe(readFragment);
  }

  targetPath(l: LandingLocale): string {
    return localizedPath(this.router.url.split(/[?#]/)[0] ?? '/', l);
  }

  dirOf(l: LandingLocale): 'ltr' | 'rtl' {
    return LANDING_DIR[l];
  }

  langTagOf(l: LandingLocale): string {
    return LANDING_LANG_TAG[l];
  }
}
