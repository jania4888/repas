import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { Meta, Title } from '@angular/platform-browser';
import { environment } from '@environments/environment';
import { LANDING_SEO_ATTR, LandingSeoService } from './landing-seo.service';

describe('LandingSeoService', () => {
  let service: LandingSeoService;
  let doc: Document;
  let title: Title;
  let meta: Meta;
  let originalArabicEnabled: boolean;

  const marked = (selector: string) => Array.from(doc.head.querySelectorAll(`${selector}[${LANDING_SEO_ATTR}="1"]`));

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(LandingSeoService);
    doc = TestBed.inject(DOCUMENT);
    title = TestBed.inject(Title);
    meta = TestBed.inject(Meta);
    originalArabicEnabled = environment.landing.arabicEnabled;
    title.setTitle('Titre initial');
    meta.updateTag({ name: 'description', content: 'Description initiale' });
  });

  afterEach(() => {
    service.restore();
    environment.landing.arabicEnabled = originalArabicEnabled;
    meta.removeTag('name="description"');
  });

  it("apply() pose le titre, la description, l'Open Graph, le canonical et les hreflang", () => {
    environment.landing.arabicEnabled = true;
    service.apply({ page: 'home', locale: 'fr', title: 'Titre FR', description: 'Description FR' });

    expect(title.getTitle()).toBe('Titre FR');
    expect(meta.getTag('name="description"')?.getAttribute('content')).toBe('Description FR');
    expect(meta.getTag('property="og:title"')?.getAttribute('content')).toBe('Titre FR');
    expect(meta.getTag('property="og:locale"')?.getAttribute('content')).toBe('fr_TN');
    expect(meta.getTag('property="og:locale:alternate"')?.getAttribute('content')).toBe('ar_TN');
    expect(meta.getTag('property="og:url"')?.getAttribute('content')).toBe(`${service.origin}/`);
    expect(meta.getTag('name="twitter:card"')?.getAttribute('content')).toBe('summary_large_image');

    const canonical = marked('link[rel="canonical"]');
    expect(canonical.length).toBe(1);
    expect(canonical[0].getAttribute('href')).toBe(`${service.origin}/`);

    const alternates = marked('link[rel="alternate"]').map(l => [l.getAttribute('hreflang'), l.getAttribute('href')]);
    expect(alternates).toEqual([
      ['fr-TN', `${service.origin}/`],
      ['ar-TN', `${service.origin}/ar`],
      ['x-default', `${service.origin}/`]
    ]);
  });

  it("n'émet ni hreflang ar-TN ni og:locale:alternate quand l'arabe est désactivé", () => {
    environment.landing.arabicEnabled = false;
    service.apply({ page: 'cabinets', locale: 'fr', title: 'Cabinets', description: 'Desc' });

    const hreflangs = marked('link[rel="alternate"]').map(l => l.getAttribute('hreflang'));
    expect(hreflangs).toEqual(['fr-TN', 'x-default']);
    expect(meta.getTag('property="og:locale:alternate"')).toBeNull();
    expect(marked('link[rel="canonical"]')[0].getAttribute('href')).toBe(`${service.origin}/cabinets-comptables`);
  });

  it('en arabe, le canonical et og:url pointent vers /ar et og:locale vaut ar_TN', () => {
    environment.landing.arabicEnabled = true;
    service.apply({ page: 'cabinets', locale: 'ar', title: 'عنوان', description: 'وصف' });

    expect(marked('link[rel="canonical"]')[0].getAttribute('href')).toBe(`${service.origin}/ar/cabinets-comptables`);
    expect(meta.getTag('property="og:url"')?.getAttribute('content')).toBe(`${service.origin}/ar/cabinets-comptables`);
    expect(meta.getTag('property="og:locale"')?.getAttribute('content')).toBe('ar_TN');
    expect(meta.getTag('property="og:locale:alternate"')?.getAttribute('content')).toBe('fr_TN');
    expect(doc.documentElement.innerHTML).not.toContain('undefined');
  });

  it("injecte le JSON-LD de l'accueil (Organization + SoftwareApplication, 3 offres) par textContent", () => {
    service.apply({ page: 'home', locale: 'fr', title: 'T', description: 'D' });
    const scripts = marked('script[type="application/ld+json"]');
    expect(scripts.length).toBe(1);
    const payload = JSON.parse(scripts[0].textContent ?? '{}');
    expect(payload['@graph'].map((n: { '@type': string }) => n['@type'])).toEqual(['Organization', 'SoftwareApplication']);
    expect(payload['@graph'][1].offers.map((o: { price: string }) => o.price)).toEqual(['0', '49', '468']);
    expect(payload['@graph'][1].inLanguage).toBe('fr-TN');
  });

  it('injecte un FAQPage sur la page cabinet à partir de la FAQ fournie', () => {
    service.apply({
      page: 'cabinets',
      locale: 'fr',
      title: 'T',
      description: 'D',
      faq: [{ question: 'Q1 ?', answer: 'R1.' }, { question: 'Q2 ?', answer: 'R2.' }]
    });
    const payload = JSON.parse(marked('script[type="application/ld+json"]')[0].textContent ?? '{}');
    expect(payload['@type']).toBe('FAQPage');
    expect(payload.mainEntity.length).toBe(2);
    expect(payload.mainEntity[1].acceptedAnswer.text).toBe('R2.');
  });

  it("n'injecte pas de FAQPage sans FAQ et n'exécute jamais de HTML", () => {
    service.apply({ page: 'cabinets', locale: 'fr', title: '<b>T</b>', description: 'D', faq: [] });
    expect(marked('script').length).toBe(0);
    expect(doc.head.querySelector('b')).toBeNull();
  });

  it('restore() rétablit le titre et la description initiaux et retire toutes les balises posées', () => {
    service.apply({ page: 'home', locale: 'fr', title: 'Titre FR', description: 'Description FR' });
    service.restore();

    expect(title.getTitle()).toBe('Titre initial');
    expect(meta.getTag('name="description"')?.getAttribute('content')).toBe('Description initiale');
    expect(doc.head.querySelectorAll(`[${LANDING_SEO_ATTR}="1"]`).length).toBe(0);
    expect(meta.getTag('property="og:title"')).toBeNull();
    expect(doc.head.querySelector('link[rel="canonical"]')).toBeNull();
  });

  it("apply() deux fois ne duplique rien (un seul canonical, une seule série d'alternates)", () => {
    service.apply({ page: 'home', locale: 'fr', title: 'A', description: 'A' });
    service.apply({ page: 'cabinets', locale: 'fr', title: 'B', description: 'B' });
    expect(marked('link[rel="canonical"]').length).toBe(1);
    expect(marked('link[rel="canonical"]')[0].getAttribute('href')).toBe(`${service.origin}/cabinets-comptables`);
    expect(marked('script[type="application/ld+json"]').length).toBe(0);
    expect(title.getTitle()).toBe('B');
    service.restore();
    expect(title.getTitle()).toBe('Titre initial');
  });

  it('restore() sans apply() est sans effet', () => {
    title.setTitle('Autre');
    service.restore();
    expect(title.getTitle()).toBe('Autre');
  });
});
