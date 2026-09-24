import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { environment } from '@environments/environment';
import { LANDING_PRICING } from '@features/home/content/landing-pricing';
import { LANDING_LANG_TAG, type LandingLocale } from '@features/home/content/landing-copy.types';
import { cabinetsPath, homePath } from '@features/home/i18n/landing-locale.util';

export type LandingSeoPage = 'home' | 'cabinets';

export interface LandingSeoFaqItem {
  question: string;
  answer: string;
}

export interface LandingSeoInput {
  page: LandingSeoPage;
  locale: LandingLocale;
  /** Textes déjà localisés (`t().seo.home` / `t().seo.cabinets`). */
  title: string;
  description: string;
  /** Page cabinet : alimente le bloc JSON-LD `FAQPage`. */
  faq?: readonly LandingSeoFaqItem[];
}

/** Marqueur posé sur chaque balise créée ou modifiée par le service (retirée par `restore()`). */
export const LANDING_SEO_MARKER = 'landingSeo';
/** Attribut HTML correspondant (`data-landing-seo="1"`), utilisé par les tests e2e. */
export const LANDING_SEO_ATTR = 'data-landing-seo';
export const LANDING_OG_IMAGE_PATH = '/assets/branding/og-instafact.png';
export const LANDING_LOGO_PATH = '/assets/branding/instafact-lockup.png';

const OG_LOCALE: Record<LandingLocale, string> = { fr: 'fr_TN', ar: 'ar_TN' };

/**
 * Métadonnées SEO des pages publiques de la landing (titre, description, Open Graph, Twitter,
 * canonical, hreflang, JSON-LD). Tout ce qui est posé est retiré par `restore()` afin que
 * l'application connectée (dashboard, POS…) ne déclare ni alternates ni balises sociales.
 * Le JSON-LD est injecté par `textContent` — jamais par `innerHTML`.
 */
@Injectable({ providedIn: 'root' })
export class LandingSeoService {
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly doc = inject(DOCUMENT);

  private previousTitle: string | null = null;
  private previousCanonical: { el: Element; href: string | null } | null = null;
  /** Contenus d'origine des balises meta préexistantes (index.html) mises à jour en place. */
  private previousMetaContent: Array<{ el: HTMLMetaElement; content: string | null }> = [];
  private created: Element[] = [];
  private applied = false;

  /** Origine absolue (sans slash final) : clé d'environnement, sinon l'origine courante. */
  get origin(): string {
    const configured = (environment.publicSiteOrigin ?? '').replace(/\/+$/, '');
    if (configured) {
      return configured;
    }
    return this.doc.defaultView?.location?.origin ?? '';
  }

  /** URL absolue et canonique d'une page dans une langue (`/` → `{origin}/`, AR → `{origin}/ar`). */
  absoluteUrl(page: LandingSeoPage, locale: LandingLocale): string {
    const path = page === 'home' ? homePath(locale) : cabinetsPath(locale);
    return `${this.origin}${path}`;
  }

  apply(input: LandingSeoInput): void {
    this.restore();
    this.applied = true;

    this.previousTitle = this.title.getTitle();
    this.title.setTitle(input.title);

    const url = this.absoluteUrl(input.page, input.locale);
    const image = `${this.origin}${LANDING_OG_IMAGE_PATH}`;
    const alternate: LandingLocale = input.locale === 'ar' ? 'fr' : 'ar';

    this.upsertMeta({ name: 'description', content: input.description });
    this.upsertMeta({ name: 'robots', content: 'index,follow' });
    this.upsertMeta({ property: 'og:type', content: 'website' });
    this.upsertMeta({ property: 'og:site_name', content: 'InstaFact' });
    this.upsertMeta({ property: 'og:title', content: input.title });
    this.upsertMeta({ property: 'og:description', content: input.description });
    this.upsertMeta({ property: 'og:url', content: url });
    this.upsertMeta({ property: 'og:image', content: image });
    this.upsertMeta({ property: 'og:locale', content: OG_LOCALE[input.locale] });
    if (environment.landing.arabicEnabled) {
      this.upsertMeta({ property: 'og:locale:alternate', content: OG_LOCALE[alternate] });
    }
    this.upsertMeta({ name: 'twitter:card', content: 'summary_large_image' });
    this.upsertMeta({ name: 'twitter:title', content: input.title });
    this.upsertMeta({ name: 'twitter:description', content: input.description });
    this.upsertMeta({ name: 'twitter:image', content: image });

    this.upsertCanonical(url);
    this.addLink({ rel: 'alternate', hreflang: LANDING_LANG_TAG.fr, href: this.absoluteUrl(input.page, 'fr') });
    if (environment.landing.arabicEnabled) {
      this.addLink({ rel: 'alternate', hreflang: LANDING_LANG_TAG.ar, href: this.absoluteUrl(input.page, 'ar') });
    }
    this.addLink({ rel: 'alternate', hreflang: 'x-default', href: this.absoluteUrl(input.page, 'fr') });

    if (input.page === 'home') {
      this.addJsonLd(this.buildHomeJsonLd(input));
    } else if (input.faq?.length) {
      this.addJsonLd(this.buildFaqJsonLd(input.faq));
    }
  }

  /**
   * Retire toutes les balises posées par `apply()` et restaure titre/description initiaux.
   * Les balises statiques d'`index.html` (canonical, OG, Twitter) sont des replis pour les
   * crawlers sans JavaScript : elles restent en place (seules les valeurs sont restaurées).
   */
  restore(): void {
    if (!this.applied) {
      return;
    }
    this.applied = false;

    if (this.previousTitle !== null) {
      this.title.setTitle(this.previousTitle);
      this.previousTitle = null;
    }
    for (const el of this.created) {
      el.remove();
    }
    this.created = [];

    if (this.previousCanonical) {
      if (this.previousCanonical.href === null) {
        this.previousCanonical.el.removeAttribute('href');
      } else {
        this.previousCanonical.el.setAttribute('href', this.previousCanonical.href);
      }
      delete (this.previousCanonical.el as HTMLElement).dataset[LANDING_SEO_MARKER];
      this.previousCanonical = null;
    }

    // Balises préexistantes (replis statiques d'index.html) : restauration de la valeur.
    // Balises créées par apply() : retrait pur et simple.
    for (const tag of this.meta.getTags(`${LANDING_SEO_ATTR}="1"`) ?? []) {
      const entry = this.previousMetaContent.find(e => e.el === tag);
      if (entry) {
        if (entry.content === null) {
          tag.removeAttribute('content');
        } else {
          tag.setAttribute('content', entry.content);
        }
        delete (tag as HTMLMetaElement).dataset[LANDING_SEO_MARKER];
      } else {
        tag.remove();
      }
    }
    this.previousMetaContent = [];
  }

  private upsertMeta(def: { name?: string; property?: string; content: string }): void {
    const selector = def.name ? `name="${def.name}"` : `property="${def.property}"`;
    const existing = this.meta.getTag(selector);
    if (existing && existing.dataset[LANDING_SEO_MARKER] !== '1') {
      this.previousMetaContent.push({ el: existing, content: existing.getAttribute('content') });
    }
    const el = this.meta.updateTag(def, selector);
    if (el) {
      el.dataset[LANDING_SEO_MARKER] = '1';
    }
  }

  /**
   * Canonical unique : si la balise statique d'`index.html` existe, elle est mise à jour
   * en place (marquée pour restauration) ; sinon une balise est créée. Jamais de doublon.
   */
  private upsertCanonical(href: string): void {
    const existing = this.doc.head.querySelector(`link[rel="canonical"]:not([${LANDING_SEO_ATTR}])`);
    if (existing) {
      this.previousCanonical = { el: existing, href: existing.getAttribute('href') };
      existing.setAttribute('href', href);
      (existing as HTMLElement).dataset[LANDING_SEO_MARKER] = '1';
      return;
    }
    this.addLink({ rel: 'canonical', href });
  }

  private addLink(attrs: Record<string, string>): void {
    const link = this.doc.createElement('link');
    for (const [key, value] of Object.entries(attrs)) {
      link.setAttribute(key, value);
    }
    link.dataset[LANDING_SEO_MARKER] = '1';
    this.doc.head.appendChild(link);
    this.created.push(link);
  }

  private addJsonLd(payload: object): void {
    const script = this.doc.createElement('script');
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(payload);
    script.dataset[LANDING_SEO_MARKER] = '1';
    this.doc.head.appendChild(script);
    this.created.push(script);
  }

  private buildHomeJsonLd(input: LandingSeoInput): object {
    const origin = this.origin;
    const languages = environment.landing.arabicEnabled ? ['fr', 'ar'] : ['fr'];
    const currency = LANDING_PRICING.currency;
    return {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Organization',
          '@id': `${origin}/#organization`,
          name: 'InstaFact',
          url: `${origin}/`,
          logo: `${origin}${LANDING_LOGO_PATH}`,
          areaServed: 'TN',
          availableLanguage: languages
        },
        {
          '@type': 'SoftwareApplication',
          name: 'InstaFact',
          description: input.description,
          url: this.absoluteUrl('home', input.locale),
          applicationCategory: 'BusinessApplication',
          operatingSystem: 'Web',
          inLanguage: LANDING_LANG_TAG[input.locale],
          publisher: { '@id': `${origin}/#organization` },
          offers: [
            { '@type': 'Offer', name: 'Gratuit', price: String(LANDING_PRICING.free.priceMonthly), priceCurrency: currency },
            {
              '@type': 'Offer',
              name: 'Mensuel',
              price: String(LANDING_PRICING.monthly.priceMonthly),
              priceCurrency: currency,
              priceSpecification: {
                '@type': 'UnitPriceSpecification',
                price: String(LANDING_PRICING.monthly.priceMonthly),
                priceCurrency: currency,
                billingDuration: 'P1M'
              }
            },
            {
              '@type': 'Offer',
              name: 'Annuel',
              price: String(LANDING_PRICING.annual.priceAnnual),
              priceCurrency: currency,
              priceSpecification: {
                '@type': 'UnitPriceSpecification',
                price: String(LANDING_PRICING.annual.priceAnnual),
                priceCurrency: currency,
                billingDuration: 'P1Y'
              }
            }
          ]
        }
      ]
    };
  }

  private buildFaqJsonLd(faq: readonly LandingSeoFaqItem[]): object {
    return {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faq.map(item => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: { '@type': 'Answer', text: item.answer }
      }))
    };
  }
}
