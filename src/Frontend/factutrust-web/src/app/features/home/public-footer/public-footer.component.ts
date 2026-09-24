import { Component, ChangeDetectionStrategy, computed, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { environment } from '../../../../environments/environment';
import { BRAND } from '@core/constants/brand';
import { LandingLocaleService } from '@core/services/landing-locale.service';
import { LandingCopyService } from '../content/landing-copy.service';
import { cabinetsPath, homePath } from '../i18n/landing-locale.util';

/**
 * Pied de page public partagé (plan A.3.3 / TB2) : marque + 4 colonnes
 * (Produit, Segments, Ressources, Légal) issues de `t().shared.footer`, copyright dynamique.
 * Les ancres passent par `routerLink` + `fragment` (le shell fait défiler avec l'offset header).
 */
@Component({
  selector: 'app-public-footer',
  standalone: true,
  imports: [RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <footer id="footer" class="public-footer" role="contentinfo">
      <div class="footer-container">
        <div class="footer-grid">
          <div class="footer-brand">
            <div class="brand-logo">
              <img
                [src]="brand.logoLockupOnDark"
                [alt]="t().shared.footer.logoAlt"
                class="brand-lockup-img"
                width="1984"
                height="793"
                loading="lazy"
                decoding="async" />
            </div>
            <p class="brand-tagline">{{ t().shared.footer.baseline }}</p>
          </div>

          <nav class="footer-col" aria-labelledby="footer-product">
            <h2 id="footer-product" class="footer-title">{{ t().shared.footer.product.title }}</h2>
            <ul class="footer-links">
              <li><a [routerLink]="homeUrl()" fragment="modules">{{ t().shared.footer.product.modules }}</a></li>
              <li><a [routerLink]="homeUrl()" fragment="nouveautes">{{ t().shared.footer.product.newFeatures }}</a></li>
              <li><a [routerLink]="homeUrl()" fragment="tarifs">{{ t().shared.footer.product.pricing }}</a></li>
              <li><a [routerLink]="homeUrl()" fragment="securite-detail">{{ t().shared.footer.product.security }}</a></li>
              <li><a [routerLink]="homeUrl()" fragment="faq">{{ t().shared.footer.product.faq }}</a></li>
            </ul>
          </nav>

          <nav class="footer-col" aria-labelledby="footer-segments">
            <h2 id="footer-segments" class="footer-title">{{ t().shared.footer.segments.title }}</h2>
            <ul class="footer-links">
              <li><a [routerLink]="homeUrl()" fragment="cas-usage">{{ t().shared.footer.segments.sme }}</a></li>
              <li><a [routerLink]="cabinetsUrl()">{{ t().shared.footer.segments.cabinets }}</a></li>
              @if (storefrontEnabled) {
                <li><a routerLink="/visite-virtuelle">{{ t().shared.footer.segments.virtualTour }}</a></li>
              }
            </ul>
          </nav>

          <nav class="footer-col" aria-labelledby="footer-resources">
            <h2 id="footer-resources" class="footer-title">{{ t().shared.footer.resources.title }}</h2>
            <ul class="footer-links">
              <li><a [routerLink]="homeUrl()" fragment="faq">{{ t().shared.footer.resources.faq }}</a></li>
              <li><a [routerLink]="homeUrl()" fragment="contact">{{ t().shared.footer.resources.contact }}</a></li>
              <li><a routerLink="/auth/login">{{ t().shared.footer.resources.login }}</a></li>
            </ul>
          </nav>

          <nav class="footer-col" aria-labelledby="footer-legal">
            <h2 id="footer-legal" class="footer-title">{{ t().shared.footer.legal.title }}</h2>
            <ul class="footer-links">
              <li><a routerLink="/legal/terms">{{ t().shared.footer.legal.terms }}</a></li>
              <li><a routerLink="/legal/terms">{{ t().shared.footer.legal.legalNotice }}</a></li>
            </ul>
          </nav>
        </div>

        <div class="footer-bottom">
          <div class="copyright">
            <span>{{ copyright }}</span>
          </div>
        </div>
      </div>
    </footer>
  `,
  styles: [`
    .public-footer {
      background: #0f172a;
      color: #cbd5e1;
      padding: var(--spacing-16) var(--spacing-6) var(--spacing-8);
      position: relative;
      overflow: hidden;
    }

    .public-footer::before {
      content: '';
      position: absolute;
      inset-block-start: 0;
      inset-inline: 0;
      height: 4px;
      background: linear-gradient(90deg, var(--color-primary-500), #06b6d4, #14b8a6); /* rtl-ok : dégradé décoratif */
    }

    .footer-container {
      max-width: 1280px;
      margin: 0 auto;
      position: relative;
      z-index: 1;
    }

    .footer-grid {
      display: grid;
      grid-template-columns: 2fr 1fr 1fr 1fr 1fr;
      gap: var(--spacing-8);
      padding-bottom: var(--spacing-10);
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }

    .footer-brand {
      max-width: 360px;
    }

    .brand-logo {
      display: flex;
      align-items: center;
      gap: var(--spacing-3);
      margin-bottom: var(--spacing-4);
    }

    .brand-lockup-img {
      max-height: 48px;
      max-width: 220px;
      width: auto;
      height: auto;
      object-fit: contain;
    }

    .brand-tagline {
      font-size: var(--font-size-sm);
      line-height: var(--line-height-relaxed);
      color: #94a3b8;
      margin: 0;
    }

    .footer-title {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: white;
      margin: 0 0 var(--spacing-4) 0;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    .footer-links {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);

      li {
        font-size: var(--font-size-sm);
      }

      a {
        color: #94a3b8;
        text-decoration: none;
        transition: color var(--transition-normal);

        &:hover {
          color: white;
        }

        &:focus-visible {
          color: white;
          outline: 2px solid var(--color-primary-300);
          outline-offset: 2px;
          border-radius: var(--radius-sm);
        }
      }
    }

    .footer-bottom {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--spacing-4);
      padding-top: var(--spacing-6);
    }

    .copyright {
      font-size: var(--font-size-sm);
      color: #94a3b8;
    }

    @media (max-width: 1024px) {
      .footer-grid {
        grid-template-columns: 1fr 1fr;
      }

      .footer-brand {
        grid-column: 1 / -1;
        max-width: none;
      }
    }

    @media (max-width: 768px) {
      .public-footer {
        padding: var(--spacing-10) var(--spacing-4) var(--spacing-6);
      }

      .footer-grid {
        grid-template-columns: 1fr;
        gap: var(--spacing-6);
      }
    }
  `]
})
export class PublicFooterComponent {
  private readonly copy = inject(LandingCopyService);
  private readonly localeService = inject(LandingLocaleService);

  readonly storefrontEnabled = environment.storefrontEnabled;
  readonly brand = BRAND;

  protected readonly t = this.copy.t;
  protected readonly homeUrl = computed(() => homePath(this.localeService.locale()));
  protected readonly cabinetsUrl = computed(() => cabinetsPath(this.localeService.locale()));
  protected readonly copyright = computed(() =>
    this.copy.format(this.t().shared.footer.copyright, { year: new Date().getFullYear() })
  );
}
