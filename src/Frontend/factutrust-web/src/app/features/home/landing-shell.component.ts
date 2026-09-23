import { ChangeDetectionStrategy, Component, DestroyRef, OnDestroy, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, ActivatedRouteSnapshot, NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { HomeThemeService } from '@core/services/home-theme.service';
import { LandingLocaleService } from '@core/services/landing-locale.service';
import { LandingScrollService } from '@core/services/landing-scroll.service';
import { LandingSeoService, type LandingSeoPage } from '@core/services/landing-seo.service';
import { LandingCopyService } from './content/landing-copy.service';
import type { LandingLocale } from './content/landing-copy.types';

/**
 * Coquille commune des pages publiques de la landing (`''` = FR, `ar` = AR).
 * Possède le cycle de vie transverse : langue/direction, thème Chain (LTR/RTL), SEO et défilement.
 * Le shell survit à la navigation `/` ↔ `/cabinets-comptables` (pas de rechargement du thème)
 * et est détruit à la sortie de la landing : `restore()` rétablit `html[lang=fr][dir=ltr]`.
 */
@Component({
  selector: 'app-landing-shell',
  standalone: true,
  imports: [RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.is-loading-copy]': 'copy.locale() !== locale.locale()' },
  template: `<router-outlet />`
})
export class LandingShellComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly theme = inject(HomeThemeService);
  private readonly seo = inject(LandingSeoService);
  private readonly scroll = inject(LandingScrollService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly locale = inject(LandingLocaleService);
  protected readonly copy = inject(LandingCopyService);

  private lastPagePath: string | null = null;

  ngOnInit(): void {
    const locale = this.resolveLocale();
    this.copy.use(locale);
    this.locale.apply(locale);
    this.theme.cancelPendingUnload();
    this.theme.loadChainTheme(locale);
    this.syncWithChild();
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => this.syncWithChild());
  }

  ngOnDestroy(): void {
    this.seo.restore();
    this.theme.unloadChainTheme();
    this.locale.restore();
    this.copy.use('fr');
  }

  private resolveLocale(): LandingLocale {
    const value = this.route.snapshot.data['locale'];
    return value === 'ar' ? 'ar' : 'fr';
  }

  /** Applique le SEO de la page enfant la plus profonde et gère ancre / haut de page. */
  private syncWithChild(): void {
    let child: ActivatedRoute = this.route;
    while (child.firstChild) {
      child = child.firstChild;
    }
    const snapshot: ActivatedRouteSnapshot = child.snapshot;
    const page: LandingSeoPage = snapshot.data['seoPage'] === 'cabinets' ? 'cabinets' : 'home';
    const locale = this.locale.locale();
    const t = this.copy.t();
    const seoCopy = page === 'cabinets' ? t.seo.cabinets : t.seo.home;
    this.seo.apply({
      page,
      locale,
      title: seoCopy.title,
      description: seoCopy.description,
      faq: page === 'cabinets' ? t.cabinets.faq.items : undefined
    });

    const pagePath = this.router.url.split(/[?#]/)[0];
    const pageChanged = this.lastPagePath !== null && this.lastPagePath !== pagePath;
    this.lastPagePath = pagePath;

    const fragment = snapshot.fragment;
    if (fragment) {
      this.scroll.scrollToAnchor(fragment);
    } else if (pageChanged) {
      this.scroll.scrollToTop();
    }
  }
}
