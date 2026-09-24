import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { LandingLocaleService } from '@core/services/landing-locale.service';
import { LandingScrollService } from '@core/services/landing-scroll.service';
import { PublicRegistrationStatusService } from '@core/services/public-registration-status.service';
import { LandingCopyService } from '../content/landing-copy.service';
import { cabinetsPath, homePath } from '../i18n/landing-locale.util';
import { PublicFooterComponent } from '../public-footer/public-footer.component';
import { PublicHeaderComponent } from '../public-header/public-header.component';
import { ContactRequestSectionComponent } from '../contact/contact-request-section.component';
import { LandingCtaComponent } from '../shared/landing-cta/landing-cta.component';

/**
 * Page publique « Cabinets comptables » (plan § 6.2 / B.3) — `/cabinets-comptables` (+ `/ar/…`).
 * Huit sections ancrées (`top` → `contact`) entre le header et le footer partagés, enveloppées
 * dans `.chain-theme-root` (le thème Chain est chargé par le shell de la landing).
 * Les sections s'animent via `IntersectionObserver` (classe `cab-reveal` → `is-visible`),
 * avec repli « tout visible » quand `prefers-reduced-motion` est actif — jamais de classe `wow`.
 * Toute la copie vient de `t().cabinets.*` / `t().shared.*` ; la FAQ alimente aussi le
 * JSON-LD `FAQPage` émis par le shell (`LandingSeoService`) — garder les deux en phase.
 */
@Component({
  selector: 'app-cabinets-page',
  standalone: true,
  imports: [
    RouterLink,
    PublicHeaderComponent,
    PublicFooterComponent,
    ContactRequestSectionComponent,
    LandingCtaComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="chain-theme-root landing-page landing-page--cabinets">
      <app-public-header />
      <main>
        <!-- 1 · Hero -->
        <section id="top" class="cab-hero" aria-labelledby="cab-hero-title">
          <div class="cab-container cab-hero__grid">
            <div class="cab-reveal">
              <p class="cab-kicker">{{ t().cabinets.hero.kicker }}</p>
              <h1 id="cab-hero-title" class="cab-hero__title">{{ t().cabinets.hero.title }}</h1>
              <p class="cab-hero__subtitle">{{ t().cabinets.hero.subtitle }}</p>
              <ul class="cab-hero__bullets">
                @for (bullet of t().cabinets.hero.bullets; track bullet) {
                  <li>
                    <span class="cab-check" aria-hidden="true">✓</span>
                    <span>{{ bullet }}</span>
                  </li>
                }
              </ul>
              <div class="cab-hero__ctas">
                <app-landing-cta
                  audience="firm"
                  cssClass="cab-btn cab-btn--gradient"
                  [contactPath]="cabinetsPath()"
                />
                <a class="cab-btn cab-btn--ghost" href="#fonctionnement" (click)="scrollTo($event, 'fonctionnement')">
                  {{ t().cabinets.hero.secondaryCta }}
                </a>
              </div>
              @if (registration.loaded() && registration.firmOpen()) {
                <p class="cab-hero__note">{{ t().cabinets.hero.openNote }}</p>
              }
            </div>
          </div>
        </section>

        <!-- 2 · Comment ça marche -->
        <section id="fonctionnement" class="cab-section" aria-labelledby="cab-steps-title">
          <div class="cab-container">
            <header class="cab-section__head cab-reveal">
              <h2 id="cab-steps-title">{{ t().cabinets.howItWorks.title }}</h2>
            </header>
            <ol class="cab-steps">
              @for (step of t().cabinets.howItWorks.steps; track step.title; let index = $index) {
                <li class="cab-step cab-reveal">
                  <span class="cab-step__num" aria-hidden="true">{{ index + 1 }}</span>
                  <h3 class="cab-step__title">{{ step.title }}</h3>
                  <p class="cab-step__text">{{ step.text }}</p>
                </li>
              }
            </ol>
          </div>
        </section>

        <!-- 3 · Fonctionnalités cabinet -->
        <section id="fonctionnalites-cabinet" class="cab-section cab-section--alt" aria-labelledby="cab-features-title">
          <div class="cab-container">
            <header class="cab-section__head cab-reveal">
              <h2 id="cab-features-title">{{ t().cabinets.features.title }}</h2>
              <p class="cab-section__lead">{{ t().cabinets.features.subtitle }}</p>
            </header>
            <div class="cab-families">
              @for (family of t().cabinets.features.families; track family.title) {
                <article class="cab-family cab-reveal">
                  <h3 class="cab-family__title">
                    {{ splitActivation(family.title).text }}
                    @if (splitActivation(family.title).flagged) {
                      <span class="cab-flag">{{ t().shared.common.uponActivation }}</span>
                    }
                  </h3>
                  <ul class="cab-family__list">
                    @for (item of family.items; track item) {
                      <li>
                        <span>{{ splitActivation(item).text }}</span>
                        @if (splitActivation(item).flagged) {
                          <span class="cab-flag">{{ t().shared.common.uponActivation }}</span>
                        }
                      </li>
                    }
                  </ul>
                </article>
              }
            </div>
            <p class="cab-footnote cab-reveal">{{ featuresFootnote() }}</p>
          </div>
        </section>

        <!-- 4 · Rôles -->
        <section id="roles" class="cab-section" aria-labelledby="cab-roles-title">
          <div class="cab-container">
            <header class="cab-section__head cab-reveal">
              <h2 id="cab-roles-title">{{ t().cabinets.roles.title }}</h2>
            </header>
            <div class="cab-roles">
              @for (card of t().cabinets.roles.cards; track card.title) {
                <article class="cab-role cab-reveal">
                  <h3 class="cab-role__title">
                    {{ splitActivation(card.title).text }}
                    @if (splitActivation(card.title).flagged) {
                      <span class="cab-flag">{{ t().shared.common.uponActivation }}</span>
                    }
                  </h3>
                  <p class="cab-role__text">{{ card.text }}</p>
                </article>
              }
            </div>
            <p class="cab-roles__banner cab-reveal">{{ t().cabinets.roles.banner }}</p>
          </div>
        </section>

        <!-- 5 · Sécurité & isolation -->
        <section id="securite-cabinet" class="cab-section cab-section--dark" aria-labelledby="cab-security-title">
          <div class="cab-container">
            <header class="cab-section__head cab-reveal">
              <h2 id="cab-security-title">{{ t().cabinets.security.title }}</h2>
            </header>
            <div class="cab-facts">
              @for (fact of t().cabinets.security.facts; track fact.title) {
                <article class="cab-fact cab-reveal">
                  <h3 class="cab-fact__title">{{ fact.title }}</h3>
                  <p class="cab-fact__text">{{ fact.text }}</p>
                </article>
              }
            </div>
            <p class="cab-ai-note cab-reveal">{{ t().cabinets.security.aiNote }}</p>
            <p class="cab-reveal cab-security__more">
              <a class="cab-link-more" [routerLink]="homePath()" fragment="securite-detail">
                {{ t().cabinets.security.moreLink }}
              </a>
            </p>
          </div>
        </section>

        <!-- 6 · Offre cabinet -->
        <section id="offre-cabinet" class="cab-section" aria-labelledby="cab-offer-title">
          <div class="cab-container">
            <div class="cab-offer cab-reveal">
              <div class="cab-offer__body">
                <h2 id="cab-offer-title" class="cab-offer__title">{{ t().cabinets.offer.title }}</h2>
                <p class="cab-offer__text">{{ t().cabinets.offer.text }}</p>
                <ul class="cab-offer__list">
                  @for (bullet of t().cabinets.offer.bullets; track bullet) {
                    <li>
                      <span class="cab-check" aria-hidden="true">✓</span>
                      <span>{{ bullet }}</span>
                    </li>
                  }
                </ul>
                <p class="cab-offer__note">{{ t().cabinets.offer.note }}</p>
                <a class="cab-offer__pricing" [routerLink]="homePath()" fragment="tarifs">
                  {{ t().cabinets.offer.pricingLink }}
                </a>
              </div>
              <div class="cab-offer__cta">
                <app-landing-cta
                  audience="firm"
                  [forceContact]="true"
                  cssClass="cab-btn cab-btn--light"
                  [closedLabelOverride]="t().cabinets.offer.cta"
                  [contactPath]="cabinetsPath()"
                />
              </div>
            </div>
          </div>
        </section>

        <!-- 7 · FAQ cabinet -->
        <section id="faq-cabinet" class="cab-section cab-section--alt" aria-labelledby="cab-faq-title">
          <div class="cab-container">
            <header class="cab-section__head cab-reveal">
              <h2 id="cab-faq-title">{{ t().cabinets.faq.title }}</h2>
            </header>
            <div class="cab-faq">
              @for (item of t().cabinets.faq.items; track item.question) {
                <details class="faq-item cab-reveal">
                  <summary class="faq-question">{{ item.question }}</summary>
                  <div class="faq-answer">
                    <p>{{ item.answer }}</p>
                  </div>
                </details>
              }
            </div>
          </div>
        </section>

        <!-- 8 · Contact (démo cabinet présélectionnée) -->
        <app-contact-request-section defaultSubject="demo-cabinet" [heading]="t().cabinets.contact" />
      </main>
      <app-public-footer />
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .landing-page--cabinets {
        min-block-size: 100vh;
        background: #fff;
      }
      .cab-container {
        max-inline-size: 72rem;
        margin-inline: auto;
        padding-inline: 1.5rem;
      }

      /* Apparition au défilement (IntersectionObserver) — jamais de classe wow. */
      .cab-reveal {
        opacity: 0;
        transform: translateY(1.25rem);
        transition:
          opacity 0.5s ease,
          transform 0.5s ease;
      }
      .cab-reveal.is-visible {
        opacity: 1;
        transform: none;
      }
      @media (prefers-reduced-motion: reduce) {
        .cab-reveal {
          opacity: 1;
          transform: none;
          transition: none;
        }
      }

      /* ----- Hero (fond sombre, cf. maquette cabinet) ----- */
      .cab-hero {
        position: relative;
        overflow: hidden;
        padding-block: 7rem 6rem;
        background:
          radial-gradient(45% 55% at 85% 10%, rgba(40, 225, 253, 0.18), transparent 65%),
          radial-gradient(55% 50% at 10% 95%, rgba(91, 104, 235, 0.22), transparent 65%),
          linear-gradient(120deg, #0f172a 0%, #1e3a8a 100%);
        color: #e2e8f0;
      }
      .cab-hero__grid {
        display: grid;
      }
      .cab-kicker {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        margin-block: 0 1.25rem;
        margin-inline: 0;
        padding-block: 0.3rem;
        padding-inline: 0.75rem;
        border-radius: 999px;
        background: rgba(96, 165, 250, 0.12);
        border: 1px solid rgba(147, 197, 253, 0.35);
        color: #93c5fd;
        font-size: 0.75rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .cab-hero__title {
        margin-block: 0 1.25rem;
        margin-inline: 0;
        max-inline-size: 46rem;
        font-size: clamp(2.25rem, 4.6vw, 3.75rem);
        line-height: 1.08;
        font-weight: 800;
        letter-spacing: -0.02em;
        color: #fff;
      }
      .cab-hero__subtitle {
        margin-block: 0 1.75rem;
        margin-inline: 0;
        max-inline-size: 38rem;
        font-size: 1.15rem;
        line-height: 1.6;
        color: #cbd5e1;
      }
      .cab-hero__bullets {
        display: grid;
        gap: 0.6rem;
        margin-block: 0 2rem;
        margin-inline: 0;
        padding: 0;
        list-style: none;
      }
      .cab-hero__bullets li {
        display: flex;
        align-items: flex-start;
        gap: 0.6rem;
        font-size: 0.95rem;
        font-weight: 600;
        color: #e2e8f0;
      }
      .cab-check {
        flex: none;
        display: inline-grid;
        place-items: center;
        inline-size: 1.25rem;
        block-size: 1.25rem;
        margin-block-start: 0.1rem;
        border-radius: 50%;
        background: rgba(34, 197, 94, 0.18);
        color: #4ade80;
        font-size: 0.75rem;
      }
      .cab-hero__ctas {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        align-items: center;
      }
      .cab-hero__note {
        margin-block: 1rem 0;
        margin-inline: 0;
        font-size: 0.9rem;
        color: #94a3b8;
      }
      .cab-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.55rem;
        min-block-size: 48px;
        padding-block: 0;
        padding-inline: 1.5rem;
        border-radius: 999px;
        border: 1px solid transparent;
        font-size: 0.95rem;
        font-weight: 600;
        text-decoration: none;
        cursor: pointer;
        white-space: nowrap;
      }
      .cab-btn:focus-visible {
        outline: 3px solid #93c5fd;
        outline-offset: 2px;
      }
      .cab-btn--gradient {
        background: linear-gradient(105deg, #5b68eb 0%, #28e1fd 100%);
        color: #fff;
        box-shadow: 0 10px 20px -10px rgba(91, 104, 235, 0.7);
      }
      .cab-btn--gradient:hover {
        filter: saturate(1.1) brightness(1.02);
      }
      .cab-btn--ghost {
        background: transparent;
        color: #e2e8f0;
        border-color: rgba(226, 232, 240, 0.4);
      }
      .cab-btn--ghost:hover {
        background: rgba(226, 232, 240, 0.08);
        border-color: rgba(226, 232, 240, 0.7);
      }
      .cab-btn--light {
        background: #fff;
        color: #1d4ed8;
      }
      .cab-btn--light:hover {
        background: #eff6ff;
      }

      /* ----- Sections ----- */
      .cab-section {
        padding-block: 5rem;
      }
      .cab-section--alt {
        background: #f8fafc;
      }
      .cab-section--dark {
        background: linear-gradient(120deg, #0f172a 0%, #1e3a8a 100%);
        color: #cbd5e1;
      }
      .cab-section__head {
        max-inline-size: 46rem;
        margin-inline: auto;
        margin-block-end: 3rem;
        text-align: center;
      }
      .cab-section__head h2 {
        margin-block: 0 0.85rem;
        margin-inline: 0;
        font-size: clamp(1.75rem, 3vw, 2.5rem);
        line-height: 1.15;
        font-weight: 800;
        letter-spacing: -0.02em;
        color: #0f172a;
      }
      .cab-section--dark .cab-section__head h2 {
        color: #fff;
      }
      .cab-section__lead {
        margin: 0;
        font-size: 1.05rem;
        color: #475569;
      }
      .cab-section--dark .cab-section__lead {
        color: #cbd5e1;
      }

      /* Étapes */
      .cab-steps {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 1.5rem;
        margin: 0;
        padding: 0;
        list-style: none;
        counter-reset: cab-step;
      }
      .cab-step {
        background: #fff;
        border: 1px solid #e2e8f0;
        border-radius: 1rem;
        padding-block: 1.75rem;
        padding-inline: 1.5rem;
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05);
      }
      .cab-step__num {
        display: inline-grid;
        place-items: center;
        inline-size: 2.25rem;
        block-size: 2.25rem;
        margin-block-end: 1rem;
        border-radius: 50%;
        background: linear-gradient(105deg, #5b68eb 0%, #28e1fd 100%);
        color: #fff;
        font-weight: 700;
      }
      .cab-step__title {
        margin-block: 0 0.5rem;
        margin-inline: 0;
        font-size: 1.15rem;
        font-weight: 700;
        color: #0f172a;
      }
      .cab-step__text {
        margin: 0;
        color: #475569;
        line-height: 1.6;
      }

      /* Familles de fonctionnalités */
      .cab-families {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 1.5rem;
      }
      .cab-family {
        background: #fff;
        border: 1px solid #e2e8f0;
        border-radius: 1rem;
        padding-block: 1.75rem;
        padding-inline: 1.5rem;
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05);
      }
      .cab-family__title {
        margin-block: 0 1rem;
        margin-inline: 0;
        font-size: 1.15rem;
        font-weight: 700;
        color: #0f172a;
      }
      .cab-family__list {
        display: grid;
        gap: 0.55rem;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .cab-family__list li {
        position: relative;
        padding-inline-start: 1.1rem;
        color: #475569;
        line-height: 1.55;
        font-size: 0.95rem;
      }
      .cab-family__list li::before {
        content: '';
        position: absolute;
        inset-inline-start: 0;
        inset-block-start: 0.6em;
        inline-size: 0.45rem;
        block-size: 0.45rem;
        border-radius: 50%;
        background: #2563eb;
      }
      .cab-flag {
        display: inline-block;
        margin-inline-start: 0.35rem;
        font-size: 0.8em;
        font-weight: 600;
        color: #2563eb;
        white-space: nowrap;
      }
      .cab-footnote {
        margin-block: 1.75rem 0;
        margin-inline: 0;
        text-align: center;
        font-size: 0.85rem;
        color: #64748b;
      }

      /* Rôles */
      .cab-roles {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 1.5rem;
      }
      .cab-role {
        background: #fff;
        border: 1px solid #e2e8f0;
        border-block-start: 3px solid #2563eb;
        border-radius: 1rem;
        padding-block: 1.75rem;
        padding-inline: 1.5rem;
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05);
      }
      .cab-role__title {
        margin-block: 0 0.6rem;
        margin-inline: 0;
        font-size: 1.15rem;
        font-weight: 700;
        color: #0f172a;
      }
      .cab-role__text {
        margin: 0;
        color: #475569;
        line-height: 1.6;
      }
      .cab-roles__banner {
        margin-block: 1.75rem 0;
        margin-inline: auto;
        max-inline-size: 52rem;
        padding-block: 1rem;
        padding-inline: 1.25rem;
        border-radius: 0.75rem;
        background: #eff6ff;
        border: 1px solid #dbeafe;
        color: #1e40af;
        text-align: center;
        font-size: 0.95rem;
        font-weight: 600;
      }

      /* Sécurité (section sombre) */
      .cab-facts {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 1.5rem;
      }
      .cab-fact {
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(226, 232, 240, 0.16);
        border-radius: 1rem;
        padding-block: 1.5rem;
        padding-inline: 1.5rem;
      }
      .cab-fact__title {
        margin-block: 0 0.5rem;
        margin-inline: 0;
        font-size: 1.05rem;
        font-weight: 700;
        color: #fff;
      }
      .cab-fact__text {
        margin: 0;
        color: #cbd5e1;
        line-height: 1.6;
      }
      .cab-ai-note {
        margin-block: 1.75rem 0;
        margin-inline: auto;
        max-inline-size: 52rem;
        padding-block: 1rem;
        padding-inline: 1.25rem;
        border-radius: 0.75rem;
        background: rgba(96, 165, 250, 0.1);
        border: 1px solid rgba(147, 197, 253, 0.3);
        color: #dbeafe;
        font-size: 0.95rem;
        text-align: center;
      }
      .cab-security__more {
        margin-block: 1.75rem 0;
        text-align: center;
      }
      .cab-link-more {
        display: inline-flex;
        align-items: center;
        min-block-size: 44px;
        padding-inline: 1rem;
        color: #93c5fd;
        font-weight: 600;
      }
      .cab-link-more:hover {
        color: #bfdbfe;
      }

      /* Offre cabinet */
      .cab-offer {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 2.5rem;
        align-items: center;
        padding-block: 2.5rem;
        padding-inline: 2.5rem;
        border-radius: 1.5rem;
        background: linear-gradient(120deg, #0f172a 0%, #1e3a8a 100%);
        color: #cbd5e1;
        box-shadow: 0 14px 34px rgba(15, 23, 42, 0.18);
      }
      .cab-offer__title {
        margin-block: 0 0.75rem;
        margin-inline: 0;
        font-size: 1.6rem;
        font-weight: 800;
        color: #fff;
      }
      .cab-offer__text {
        margin-block: 0 1.25rem;
        margin-inline: 0;
        color: #cbd5e1;
        line-height: 1.6;
      }
      .cab-offer__list {
        display: grid;
        gap: 0.6rem;
        margin-block: 0 1.25rem;
        margin-inline: 0;
        padding: 0;
        list-style: none;
      }
      .cab-offer__list li {
        display: flex;
        align-items: flex-start;
        gap: 0.6rem;
        color: #e2e8f0;
      }
      .cab-offer__note {
        margin-block: 0 1rem;
        margin-inline: 0;
        font-size: 0.85rem;
        color: #94a3b8;
      }
      .cab-offer__pricing {
        color: #93c5fd;
        font-weight: 600;
      }
      .cab-offer__pricing:hover {
        color: #bfdbfe;
      }
      .cab-offer__cta {
        display: grid;
        justify-items: center;
        min-inline-size: 16rem;
      }

      /* FAQ */
      .cab-faq {
        display: grid;
        gap: 1rem;
        max-inline-size: 52rem;
        margin-inline: auto;
      }
      .faq-item {
        background: #fff;
        border: 1px solid #e2e8f0;
        border-radius: 0.75rem;
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05);
      }
      .faq-item[open] {
        border-color: #bfdbfe;
      }
      .faq-question {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        padding-block: 1.1rem;
        padding-inline: 1.25rem;
        cursor: pointer;
        list-style: none;
        font-weight: 700;
        color: #0f172a;
        min-block-size: 44px;
      }
      .faq-question::-webkit-details-marker {
        display: none;
      }
      .faq-question::after {
        content: '';
        flex: none;
        inline-size: 0.55rem;
        block-size: 0.55rem;
        border-inline-end: 2px solid #2563eb;
        border-block-end: 2px solid #2563eb;
        transform: rotate(45deg);
        transition: transform 0.2s;
      }
      .faq-item[open] .faq-question::after {
        transform: rotate(-135deg);
      }
      @media (prefers-reduced-motion: reduce) {
        .faq-question::after {
          transition: none;
        }
      }
      .faq-question:focus-visible {
        outline: 3px solid #93c5fd;
        outline-offset: 2px;
        border-radius: 0.75rem;
      }
      .faq-answer {
        padding-block: 0 1.1rem;
        padding-inline: 1.25rem;
      }
      .faq-answer p {
        margin: 0;
        color: #475569;
        line-height: 1.65;
      }

      @media (max-width: 991.98px) {
        .cab-steps,
        .cab-roles,
        .cab-families,
        .cab-facts {
          grid-template-columns: 1fr;
        }
        .cab-offer {
          grid-template-columns: 1fr;
          padding-inline: 1.5rem;
        }
        .cab-offer__cta {
          justify-items: stretch;
          min-inline-size: 0;
        }
      }
      @media (max-width: 640px) {
        .cab-hero {
          padding-block: 4.5rem 4rem;
        }
        .cab-section {
          padding-block: 3.5rem;
        }
        .cab-container {
          padding-inline: 1rem;
        }
      }
    `
  ]
})
export class CabinetsPageComponent implements AfterViewInit {
  private readonly host = inject(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly scroll = inject(LandingScrollService);
  private readonly localeService = inject(LandingLocaleService);
  protected readonly registration = inject(PublicRegistrationStatusService);
  protected readonly t = inject(LandingCopyService).t;

  protected readonly cabinetsPath = computed(() => cabinetsPath(this.localeService.locale()));
  protected readonly homePath = computed(() => homePath(this.localeService.locale()));

  constructor() {
    // L'état d'inscription pilote l'affichage de la note sous le CTA ouvert (et le CTA lui-même).
    this.registration.ensureLoaded();
  }

  ngAfterViewInit(): void {
    const root = this.host.nativeElement as HTMLElement;
    const targets = Array.from(root.querySelectorAll<HTMLElement>('.cab-reveal'));
    if (targets.length === 0) {
      return;
    }
    if (this.scroll.prefersReducedMotion() || typeof IntersectionObserver === 'undefined') {
      targets.forEach(el => el.classList.add('is-visible'));
      return;
    }
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            (entry.target as HTMLElement).classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.1 }
    );
    targets.forEach(el => observer.observe(el));
    this.destroyRef.onDestroy(() => observer.disconnect());
  }

  /** Défilement vers une ancre de la page (offset header géré par le service partagé). */
  protected scrollTo(event: Event, id: string): void {
    event.preventDefault();
    this.scroll.scrollToAnchor(id);
  }

  /**
   * La copie marque les fonctions sous flag par le suffixe `features.activationMark` (« * ») :
   * le marqueur est retiré du texte et remplacé par la pastille « (selon activation) »
   * (`shared.common.uponActivation`).
   */
  protected splitActivation(text: string): { text: string; flagged: boolean } {
    const mark = this.t().cabinets.features.activationMark;
    const trimmed = text.trimEnd();
    if (mark && trimmed.endsWith(mark)) {
      return { text: trimmed.slice(0, trimmed.length - mark.length).trimEnd(), flagged: true };
    }
    return { text, flagged: false };
  }

  /** Note de bas de section sans le marqueur d'appel en tête (remplacé par les pastilles). */
  protected featuresFootnote(): string {
    const note = this.t().cabinets.features.footnote;
    const mark = this.t().cabinets.features.activationMark;
    return mark && note.startsWith(mark) ? note.slice(mark.length).trimStart() : note;
  }
}
