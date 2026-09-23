import { Injectable, computed, signal } from '@angular/core';
import { environment } from '@environments/environment';
import { LANDING_COPY_FR } from './landing-copy.fr';
import type { LandingCopy, LandingLocale, RichText } from './landing-copy.types';

/**
 * Fournit le dictionnaire de la landing (FR statique, AR chargé à la demande).
 * `t()` est un signal : les templates lisent `t().home.hero.title`.
 */
@Injectable({ providedIn: 'root' })
export class LandingCopyService {
  private readonly dictionaries = new Map<LandingLocale, LandingCopy>([['fr', LANDING_COPY_FR]]);
  private readonly currentLocale = signal<LandingLocale>('fr');
  private arLoading: Promise<LandingCopy> | null = null;

  /** Locale courante du dictionnaire (peut différer d'une requête en cours de chargement). */
  readonly locale = this.currentLocale.asReadonly();

  /** Dictionnaire courant — retombe sur FR tant que l'AR n'est pas chargé. */
  readonly t = computed<LandingCopy>(() => this.dictionaries.get(this.currentLocale()) ?? LANDING_COPY_FR);

  /** Charge (une seule fois) le dictionnaire `locale` et le rend courant. */
  async ensureLoaded(locale: LandingLocale): Promise<LandingCopy> {
    if (locale === 'ar' && !environment.landing.arabicEnabled) {
      locale = 'fr';
    }
    const cached = this.dictionaries.get(locale);
    if (cached) {
      this.currentLocale.set(locale);
      return cached;
    }
    // Seul l'AR est différé aujourd'hui.
    this.arLoading ??= import('./landing-copy.ar').then(m => {
      this.dictionaries.set('ar', m.LANDING_COPY_AR);
      return m.LANDING_COPY_AR;
    });
    try {
      const copy = await this.arLoading;
      this.currentLocale.set(locale);
      return copy;
    } catch (err) {
      this.arLoading = null;
      console.error('[LandingCopyService] chargement du dictionnaire AR impossible, repli FR', err);
      this.currentLocale.set('fr');
      return LANDING_COPY_FR;
    }
  }

  /** Bascule synchrone sur une locale déjà chargée (sinon lance le chargement). */
  use(locale: LandingLocale): void {
    if (this.dictionaries.has(locale)) {
      this.currentLocale.set(locale);
    } else {
      void this.ensureLoaded(locale);
    }
  }

  isLoaded(locale: LandingLocale): boolean {
    return this.dictionaries.has(locale);
  }

  /** Remplace `{name}` par `params[name]` (les valeurs sont converties en chaîne). Les placeholders inconnus sont laissés. */
  format(template: string, params: Record<string, string | number>): string {
    return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in params ? String(params[key]) : match));
  }

  /**
   * Convertit un texte contenant `**gras**`, `_italique_` et `[[ltr]]` (sigles/chiffres à isoler en RTL)
   * en segments pour `<app-landing-rich>`. Aucun HTML n'est interprété.
   */
  rich(text: string): RichText {
    const segments: { text: string; kind?: 'strong' | 'em' | 'ltr' }[] = [];
    const re = /\*\*(.+?)\*\*|_(.+?)_|\[\[(.+?)\]\]/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) {
        segments.push({ text: text.slice(last, m.index) });
      }
      if (m[1] !== undefined) {
        segments.push({ text: m[1], kind: 'strong' });
      } else if (m[2] !== undefined) {
        segments.push({ text: m[2], kind: 'em' });
      } else if (m[3] !== undefined) {
        segments.push({ text: m[3], kind: 'ltr' });
      }
      last = m.index + m[0].length;
    }
    if (last < text.length) {
      segments.push({ text: text.slice(last) });
    }
    return segments;
  }
}
