import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterModule } from '@angular/router';
import { LandingLocaleService } from '@core/services/landing-locale.service';
import { PublicRegistrationStatusService } from '@core/services/public-registration-status.service';
import { homePath } from '../../i18n/landing-locale.util';
import { LANDING_PRICING } from '../../content/landing-pricing';
import { LandingCopyBase } from '../../shared/landing-copy-base';

/** v2 : la valeur a changé (bandeau « Nouveautés » quand les inscriptions sont fermées). */
const STORAGE_KEY = 'factutrust_promo_banner_dismissed_v2';
const REAPPEAR_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours

/**
 * Bandeau d'annonce (plan A.5.11) :
 * - inscriptions ouvertes → offre de lancement + lien `/auth/register` (jamais mort : le statut est connu) ;
 * - fermées → « Nouveautés {year} » + lien vers `#nouveautes`.
 * Fermeture persistée 7 jours dans localStorage.
 */
@Component({
  selector: 'app-promo-banner',
  standalone: true,
  imports: [RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <aside class="promo-banner" role="region" [attr.aria-label]="t().home.promo.region">
        <div class="promo-banner-inner">
          <p class="promo-text">
            @if (registrationOpen()) {
              {{ openText() }}
            } @else {
              {{ closedText() }}
            }
          </p>
          @if (registrationOpen()) {
            <a routerLink="/auth/register" class="promo-cta">
              {{ t().home.promo.open.cta }}
              <i class="pi pi-arrow-right" aria-hidden="true"></i>
            </a>
          } @else {
            <a [routerLink]="homeUrl()" fragment="nouveautes" class="promo-cta">
              {{ t().home.promo.closed.cta }}
              <i class="pi pi-arrow-right" aria-hidden="true"></i>
            </a>
          }
          <button type="button" class="promo-close" [attr.aria-label]="t().home.promo.dismiss" (click)="dismiss()">
            <span aria-hidden="true">×</span>
          </button>
        </div>
      </aside>
    }
  `,
  styles: [`
    .promo-banner {
      width: 100%;
      background: linear-gradient(90deg, #5b68eb 0%, #1d4ed8 100%);
      color: #ffffff;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.1);
      position: relative;
      z-index: 1100;
    }

    .promo-banner-inner {
      max-width: 1280px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.65rem 1.25rem;
    }

    .promo-text {
      flex: 1;
      margin: 0;
      font-size: 0.92rem;
      line-height: 1.45;
      color: #ffffff;
    }

    .promo-cta {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.45rem 1rem;
      border-radius: 999px;
      background: #ffffff;
      color: #1e3a8a;
      text-decoration: none;
      font-weight: 700;
      font-size: 0.9rem;
      flex-shrink: 0;
      transition: transform 0.2s ease, box-shadow 0.2s ease;

      i {
        font-size: 0.8rem;
        transition: transform 0.2s ease;
      }
    }

    .promo-cta:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 10px rgba(15, 23, 42, 0.15);
    }

    .promo-cta:hover i {
      transform: translateX(2px); /* rtl-ok : micro-mouvement décoratif */
    }

    .promo-cta:focus-visible {
      outline: 2px solid #ffffff;
      outline-offset: 2px;
    }

    .promo-close {
      flex-shrink: 0;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.15);
      border: none;
      color: #ffffff;
      font-size: 1.4rem;
      line-height: 1;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.2s ease;
    }

    .promo-close:hover {
      background: rgba(255, 255, 255, 0.3);
    }

    .promo-close:focus-visible {
      outline: 2px solid #ffffff;
      outline-offset: 2px;
    }

    @media (prefers-reduced-motion: reduce) {
      .promo-cta,
      .promo-cta i,
      .promo-close {
        transition: none;
      }
      .promo-cta:hover,
      .promo-cta:hover i {
        transform: none;
      }
    }

    @media (max-width: 768px) {
      .promo-banner-inner {
        flex-wrap: wrap;
        gap: 0.5rem;
        padding: 0.65rem 0.85rem;
      }

      .promo-text {
        flex: 1 1 100%;
        order: 2;
        font-size: 0.85rem;
      }

      .promo-cta {
        order: 3;
        font-size: 0.85rem;
        padding: 0.4rem 0.85rem;
      }

      .promo-close {
        order: 4;
        width: 28px;
        height: 28px;
        font-size: 1.2rem;
      }
    }
  `]
})
export class PromoBannerComponent extends LandingCopyBase implements OnInit {
  private readonly status = inject(PublicRegistrationStatusService);
  private readonly localeService = inject(LandingLocaleService);

  protected readonly visible = signal(true);
  protected readonly registrationOpen = computed(() => this.status.companyOpen() || this.status.firmOpen());
  protected readonly homeUrl = computed(() => homePath(this.localeService.locale()));
  protected readonly closedText = computed(() =>
    this.copy.format(this.t().home.promo.closed.text, { year: new Date().getFullYear() })
  );
  /** Texte ouvert : les deux `{count}` = quotas gratuits (factures = devis = 10). */
  protected readonly openText = computed(() =>
    this.copy.format(this.t().home.promo.open.text, { count: LANDING_PRICING.free.maxInvoicesPerMonth })
  );

  constructor() {
    super();
    this.status.ensureLoaded();
  }

  ngOnInit(): void {
    if (typeof window === 'undefined') return;
    try {
      const dismissedAt = window.localStorage.getItem(STORAGE_KEY);
      if (dismissedAt) {
        const elapsed = Date.now() - Number(dismissedAt);
        if (!isNaN(elapsed) && elapsed < REAPPEAR_AFTER_MS) {
          this.visible.set(false);
        }
      }
    } catch {
      // localStorage indisponible (mode privé) → on garde le bandeau visible
    }
  }

  dismiss(): void {
    this.visible.set(false);
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(STORAGE_KEY, String(Date.now()));
    } catch {
      // ignore
    }
  }
}
