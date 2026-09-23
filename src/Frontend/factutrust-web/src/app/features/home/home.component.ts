import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { PublicHeaderComponent } from './public-header/public-header.component';
import { environment } from '../../../environments/environment';
import { BRAND } from '@core/constants/brand';

// Bandeau promo (top de page)
import { PromoBannerComponent } from './sections/promo-banner/promo-banner.component';

// Nouveaux composants enrichis (insérés après le top Chain et avant le footer Chain)
import { TrustLogosSectionComponent } from './sections/trust-logos-section/trust-logos-section.component';
import { ProblemSolutionSectionComponent } from './sections/problem-solution-section/problem-solution-section.component';
import { ModuleShowcaseSectionComponent } from './sections/module-showcase-section/module-showcase-section.component';
import { FeaturesSectionComponent } from './sections/features-section/features-section.component';
import { AiSpotlightSectionComponent } from './sections/ai-spotlight-section/ai-spotlight-section.component';
import { ForecastingSpotlightSectionComponent } from './sections/forecasting-spotlight-section/forecasting-spotlight-section.component';
import { SimplicitySectionComponent } from './sections/simplicity-section/simplicity-section.component';
import { UseCasesSectionComponent } from './sections/use-cases-section/use-cases-section.component';
import { ComparisonSectionComponent } from './sections/comparison-section/comparison-section.component';
import { ComplianceSectionComponent } from './sections/compliance-section/compliance-section.component';
import { SecuritySectionComponent } from './sections/security-section/security-section.component';
import { IntegrationsSectionComponent } from './sections/integrations-section/integrations-section.component';
import { StatsSectionComponent } from './sections/stats-section/stats-section.component';
import { TrustSectionComponent } from './sections/trust-section/trust-section.component';
import { PricingSectionComponent } from './sections/pricing-section/pricing-section.component';
import { FaqSectionComponent } from './sections/faq-section/faq-section.component';
import { CtaSectionComponent } from './sections/cta-section/cta-section.component';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    PublicHeaderComponent,
    PromoBannerComponent,
    // Nouveaux composants enrichis
    TrustLogosSectionComponent,
    ProblemSolutionSectionComponent,
    ModuleShowcaseSectionComponent,
    FeaturesSectionComponent,
    AiSpotlightSectionComponent,
    ForecastingSpotlightSectionComponent,
    SimplicitySectionComponent,
    UseCasesSectionComponent,
    ComparisonSectionComponent,
    ComplianceSectionComponent,
    SecuritySectionComponent,
    IntegrationsSectionComponent,
    StatsSectionComponent,
    TrustSectionComponent,
    PricingSectionComponent,
    FaqSectionComponent,
    CtaSectionComponent
  ],
  template: `
    <div class="chain-theme-root">
      <app-promo-banner></app-promo-banner>
      <app-public-header></app-public-header>

      <div class="main-banner wow fadeIn" id="top" data-wow-duration="1s" data-wow-delay="0.5s">
        <div class="container">
          <div class="row">
            <div class="col-lg-12">
              <div class="row">
                <div class="col-lg-6 align-self-center">
                  <div class="left-content show-up header-text wow fadeInLeft" data-wow-duration="1s" data-wow-delay="1s">
                    <div class="row">
                      <div class="col-lg-12">
                        <h2>La <em>suite tout-en-un</em> pour facturer, gérer et <em>prévoir</em> votre activité</h2>
                        <p>Facturation conforme TEJ, comptabilité, stock, CRM, IA et prévisions intelligentes — réunis dans <strong>une seule plateforme</strong> pensée pour les PME tunisiennes. Configuration en 5 minutes, <strong>10 factures gratuites par mois</strong>.</p>
                      </div>
                      <div class="col-lg-12">
                        <div class="white-button first-button scroll-to-section wow fadeInUp" data-wow-duration="1s" data-wow-delay="1.2s">
                          <a routerLink="/auth/register">Démarrer gratuitement — 10 factures/mois <i class="fa fa-rocket"></i></a>
                        </div>
                        <div class="white-button scroll-to-section wow fadeInUp" data-wow-duration="1s" data-wow-delay="1.4s">
                          <a href="#modules">Voir les 10 modules <i class="fa fa-arrow-down"></i></a>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div class="col-lg-6">
                  <div class="right-image wow fadeInRight" data-wow-duration="1s" data-wow-delay="0.5s">
                    <img src="assets/theme/chain/assets/images/slider-dec.svg" alt="Interface InstaFact - Création et gestion de factures électroniques">
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <section class="trust-strip" aria-label="Indicateurs clés InstaFact">
        <div class="trust-strip-inner">
          <div class="trust-strip-stats">
            <span><strong>28</strong> Modules métier</span>
            <span class="sep" aria-hidden="true">·</span>
            <span><strong>150+</strong> Fonctionnalités</span>
            <span class="sep" aria-hidden="true">·</span>
            <span><strong>10</strong> Rôles utilisateurs</span>
          </div>
          <div class="trust-strip-badges">
            <span><span class="emoji" aria-hidden="true">🇹🇳</span>Conforme TEJ</span>
            <span class="sep" aria-hidden="true">·</span>
            <span><span class="emoji" aria-hidden="true">🛡️</span>RGPD</span>
            <span class="sep" aria-hidden="true">·</span>
            <span><span class="emoji" aria-hidden="true">⚖️</span>Audit chain immuable</span>
          </div>
        </div>
      </section>

      @if (storefrontEnabled) {
        <section class="section virtual-street-cta" aria-labelledby="virtual-street-heading">
          <div class="container">
            <div class="row align-items-center gy-4">
              <div class="col-lg-5 order-lg-2 text-center">
                <div class="street-preview" role="img" aria-label="Aperçu stylisé de façades sur une rue isométrique">
                  <span class="facade f1" aria-hidden="true"></span>
                  <span class="facade f2" aria-hidden="true"></span>
                  <span class="facade f3" aria-hidden="true"></span>
                </div>
              </div>
              <div class="col-lg-7 order-lg-1">
                <h3 id="virtual-street-heading">Découvrez la Rue InstaFact en 3D</h3>
                <p>
                  Parcourez les vitrines publiques des entreprises partenaires (opt-in, données publiques uniquement).
                  Une version liste accessible est proposée depuis la même entrée — sans charger WebGL sur cette page.
                </p>
                <div class="white-button scroll-to-section d-inline-block">
                  <a routerLink="/visite-virtuelle">Visite virtuelle <i class="fa fa-cube" aria-hidden="true"></i></a>
                </div>
              </div>
            </div>
          </div>
        </section>
      }

      <app-pricing-section></app-pricing-section>

      <div id="about" class="about-us section">
        <div class="container">
          <div class="row">
            <div class="col-lg-6 align-self-center">
              <div class="section-heading wow fadeInLeft" data-wow-duration="1s" data-wow-delay="0.5s">
                <h4>Une plateforme conçue pour les <em>PME tunisiennes</em></h4>
                <img src="assets/theme/chain/assets/images/heading-line-dec.png" alt="">
                <p><strong>28 modules métier intégrés</strong> : facturation, devis, achats, stock multi-entrepôts, comptabilité (FEC), POS, CRM, IA et forecasting. <strong>Conforme TEJ et eIDAS, hébergement sécurisé, audit chain immuable.</strong> De la TPE en croissance au cabinet comptable multi-clients, InstaFact grandit avec vous.</p>
                <div class="gradient-button"><a routerLink="/auth/register">Créer un compte gratuit</a></div>
              </div>
            </div>
            <div class="col-lg-6">
              <div class="right-image wow fadeInRight" data-wow-duration="1s" data-wow-delay="0.5s">
                <img src="assets/theme/chain/assets/images/about-right-dec.png" alt="">
              </div>
            </div>
          </div>
        </div>
      </div>

      <div id="securite" class="services section">
        <div class="container">
          <div class="row">
            <div class="col-lg-8 offset-lg-2">
              <div class="section-heading wow fadeInUp" data-wow-duration="1s" data-wow-delay="0.5s">
                <h4>Sécurité <em>et conformité</em></h4>
                <img src="assets/theme/chain/assets/images/heading-line-dec.png" alt="">
                <p>Vos données sont protégées par les standards de l'industrie. <strong>Chiffrement TLS, audit chain immuable, conformité TEJ et eIDAS.</strong></p>
              </div>
              <div class="security-mini-badges">
                <span class="security-mini-badge"><span class="emoji" aria-hidden="true">🔐</span> Chiffrement TLS</span>
                <span class="security-mini-badge"><span class="emoji" aria-hidden="true">🛡️</span> Multi-tenant isolé</span>
                <span class="security-mini-badge"><span class="emoji" aria-hidden="true">⚖️</span> Audit chain</span>
                <span class="security-mini-badge"><span class="emoji" aria-hidden="true">🇹🇳</span> Conforme TEJ</span>
              </div>
              <p class="security-mini-link">
                <a href="#securite-detail" aria-label="Voir tout le détail sécurité">Voir tout le détail sécurité <i class="fa fa-arrow-down" aria-hidden="true"></i></a>
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- ============================================================== -->
      <!-- COUCHE ENRICHIE : 14 composants enrichis                            -->
      <!-- (ancien Pricing Chain supprimé : la PricingSection enrichie     -->
      <!-- présente les vrais plans avec id #tarifs)                       -->
      <!-- ============================================================== -->
      <div class="enriched-sections">
        <app-trust-logos-section></app-trust-logos-section>
        <app-problem-solution-section></app-problem-solution-section>
        <app-module-showcase-section></app-module-showcase-section>
        <app-features-section></app-features-section>
        <app-ai-spotlight-section></app-ai-spotlight-section>
        <app-forecasting-spotlight-section></app-forecasting-spotlight-section>
        <app-simplicity-section></app-simplicity-section>
        <app-use-cases-section></app-use-cases-section>
        <app-comparison-section></app-comparison-section>
        <app-compliance-section></app-compliance-section>
        <app-security-section></app-security-section>
        <app-integrations-section></app-integrations-section>
        <app-stats-section></app-stats-section>
        <app-trust-section></app-trust-section>
        <app-faq-section></app-faq-section>
        <app-cta-section></app-cta-section>
      </div>

      <footer id="newsletter">
        <div class="container">
          <div class="row">
            <div class="col-lg-8 offset-lg-2">
              <div class="section-heading wow fadeInDown" data-wow-duration="1s" data-wow-delay="0.5s">
                <h4>Prêt à simplifier votre facturation ?</h4>
              </div>
            </div>
            <div class="col-lg-6 offset-lg-3">
              <div class="gradient-button wow fadeInUp" data-wow-duration="1s" data-wow-delay="0.8s" style="text-align: center;">
                <a routerLink="/auth/register">Créer un compte gratuit</a>
              </div>
            </div>
          </div>
          <div class="row">
            <div class="col-lg-3">
              <div class="footer-widget wow fadeInUp" data-wow-duration="1s" data-wow-delay="0.2s">
                <h4>Produit</h4>
                <ul>
                  <li><a href="#modules">Fonctionnalités</a></li>
                  <li><a href="#tarifs">Tarifs</a></li>
                  <li><a href="#securite">Sécurité</a></li>
                </ul>
              </div>
            </div>
            <div class="col-lg-3">
              <div class="footer-widget wow fadeInUp" data-wow-duration="1s" data-wow-delay="0.4s">
                <h4>Entreprise</h4>
                <ul>
                  <li><a href="#about">À propos</a></li>
                  <li><a routerLink="/auth/login">Connexion</a></li>
                  <li><a routerLink="/auth/register">Créer un compte</a></li>
                </ul>
              </div>
            </div>
            <div class="col-lg-3">
              <div class="footer-widget wow fadeInUp" data-wow-duration="1s" data-wow-delay="0.6s">
                <h4>Support</h4>
                <ul>
                  <li><a href="#faq">FAQ</a></li>
                  <li><a routerLink="/auth/login">Espace client</a></li>
                </ul>
              </div>
            </div>
            <div class="col-lg-3">
              <div class="footer-widget wow fadeInUp" data-wow-duration="1s" data-wow-delay="0.8s">
                <h4>{{ brand.name }}</h4>
                <div class="logo wow flipInX" data-wow-duration="1s" data-wow-delay="1.2s"><img [src]="brand.logoLockup" [alt]="brand.name + ' — ' + brand.taglineLong"></div>
                <p>La facturation électronique simple, sécurisée et conforme pour les entreprises tunisiennes.</p>
              </div>
            </div>
            <div class="col-lg-12">
              <div class="copyright-text">
                <p>&copy; {{ currentYear }} InstaFact. Tous droits réservés. <a routerLink="/legal/terms">Mentions légales</a> · <a routerLink="/legal/terms">CGU</a></p>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  `,
  styles: [`
    .chain-theme-root {
      min-height: 100vh;
    }
    /* Footer logo: transparent background */
    .footer-widget .logo {
      background: transparent;
      background-color: transparent;
    }
    /* Footer logo: preserve aspect ratio (new logo wider with tagline), allow readable size; invert for dark background; -30% vs original */
    .footer-widget .logo img {
      background: transparent;
      background-color: transparent;
      object-fit: contain;
      max-width: 224px; /* 320px * 0.7 */
      max-height: 134px; /* 192px * 0.7 */
      filter: brightness(0) invert(1);
    }
    .virtual-street-cta {
      padding: 2.5rem 0;
      background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);
      border-top: 1px solid #bae6fd;
      border-bottom: 1px solid #bae6fd;
    }
    .virtual-street-cta h3 {
      font-size: 1.35rem;
      font-weight: 700;
      margin-bottom: 0.75rem;
      color: #0c4a6e;
    }
    .virtual-street-cta p {
      color: #334155;
      line-height: 1.55;
    }
    .street-preview {
      display: inline-flex;
      align-items: flex-end;
      justify-content: center;
      gap: 0.65rem;
      padding: 1.25rem 1.5rem 0.75rem;
      border-radius: 1rem;
      background: linear-gradient(180deg, #e0f2fe 0%, #bae6fd 100%);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.65);
    }
    .street-preview .facade {
      display: block;
      width: 3.25rem;
      border-radius: 0.35rem 0.35rem 0 0;
      transform: skewX(-8deg);
      box-shadow: 0 6px 14px rgba(15, 23, 42, 0.12);
      animation: facade-float 3.2s ease-in-out infinite;
    }
    .street-preview .f1 {
      height: 4.5rem;
      background: linear-gradient(180deg, #38bdf8, #0284c7);
      animation-delay: 0s;
    }
    .street-preview .f2 {
      height: 5.75rem;
      background: linear-gradient(180deg, #a78bfa, #6366f1);
      animation-delay: 0.2s;
    }
    .street-preview .f3 {
      height: 4rem;
      background: linear-gradient(180deg, #34d399, #059669);
      animation-delay: 0.4s;
    }
    @keyframes facade-float {
      0%,
      100% {
        transform: skewX(-8deg) translateY(0);
      }
      50% {
        transform: skewX(-8deg) translateY(-6px);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .street-preview .facade {
        animation: none;
      }
    }

    /* Mini-badges sécurité (Chain #securite enrichi) */
    .security-mini-badges {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      justify-content: center;
      margin-top: 1.25rem;
    }
    .security-mini-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.45rem 0.9rem;
      border-radius: 999px;
      background: #ffffff;
      border: 1px solid #cbd5e1;
      color: #0f172a;
      font-size: 0.85rem;
      font-weight: 600;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    }
    .security-mini-badge .emoji {
      font-size: 1rem;
      line-height: 1;
    }
    .security-mini-link {
      text-align: center;
      margin-top: 1rem;
      font-size: 0.95rem;
    }
    .security-mini-link a {
      color: #1d4ed8;
      text-decoration: none;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      transition: color 0.2s ease;
    }
    .security-mini-link a:hover {
      color: #1e40af;
      text-decoration: underline;
    }

    /* Trust strip above-the-fold */
    .trust-strip {
      background: #f8fafc;
      border-top: 1px solid #e2e8f0;
      border-bottom: 1px solid #e2e8f0;
      padding: 1rem 1.25rem;
    }
    .trust-strip-inner {
      max-width: 1180px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      align-items: center;
      text-align: center;
    }
    .trust-strip-stats,
    .trust-strip-badges {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      align-items: center;
      gap: 0.4rem 1rem;
      color: #334155;
      font-size: 0.95rem;
    }
    .trust-strip-stats strong {
      color: #0f172a;
      font-weight: 700;
      margin-right: 0.25rem;
    }
    .trust-strip-stats .sep,
    .trust-strip-badges .sep {
      color: #94a3b8;
    }
    .trust-strip-badges {
      font-weight: 600;
      color: #1e293b;
    }
    .trust-strip-badges .emoji {
      margin-right: 0.3rem;
    }

    @media (max-width: 600px) {
      .trust-strip-stats,
      .trust-strip-badges {
        gap: 0.3rem 0.7rem;
        font-size: 0.85rem;
      }
      .trust-strip-stats .sep,
      .trust-strip-badges .sep {
        display: none;
      }
    }
  `]
})
/** Le thème Chain, la langue et le SEO sont gérés par `LandingShellComponent` (route parente). */
export class HomeComponent {
  readonly storefrontEnabled = environment.storefrontEnabled;
  readonly brand = BRAND;

  currentYear = new Date().getFullYear();
}
