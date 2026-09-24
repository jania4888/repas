import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { environment } from '@environments/environment';
// L'adresse de repli est locale-indépendante : la constante est exportée par les fichiers
// `content/fr/contact.ts` et `content/ar/contact.ts` (clé hors type figé `LandingContactCopy`).
import { CONTACT_FALLBACK_EMAIL, CONTACT_MAILTO_HREF } from '../content/fr/contact';
import type { ContactRequestSubject } from './contact-request.models';
import { ContactRequestFormComponent } from './contact-request-form.component';
import { LandingCopyBase } from '../shared/landing-copy-base';

/** En-tête de la section contact ; par défaut `t().contact.title` / `t().contact.lead`. */
export interface ContactRequestHeading {
  title: string;
  lead: string;
}

/**
 * Section publique `#contact` (plan § 6.4 / B.6.2), partagée entre l'accueil et la page cabinet :
 * - `environment.publicContact.enabled` ⇒ titre + `ContactRequestFormComponent` (qui lit `?objet=`) ;
 * - sinon ⇒ bloc de repli avec l'adresse e-mail (`mailto:`), sans formulaire.
 * `tabindex="-1"` permet au défilement du shell de donner le focus à la section.
 */
@Component({
  selector: 'app-contact-request-section',
  standalone: true,
  imports: [ContactRequestFormComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section id="contact" class="contact-request" tabindex="-1" aria-labelledby="contact-request-title">
      <div class="contact-request__inner">
        <header class="contact-request__head">
          <h2 id="contact-request-title">{{ effectiveHeading().title }}</h2>
          @if (enabled) {
            <p class="contact-request__lead">{{ effectiveHeading().lead }}</p>
          } @else {
            <p class="contact-request__lead">{{ disabledLead() }}</p>
            <p class="contact-request__alt">
              <a class="contact-request__mailto" dir="ltr" [href]="mailtoHref">{{ fallbackEmail }}</a>
            </p>
          }
        </header>
        @if (enabled) {
          <div class="contact-request__card">
            <app-contact-request-form [defaultSubject]="defaultSubject()" />
          </div>
        }
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .contact-request {
        padding-block: 5rem;
        padding-inline: 0;
        background:
          radial-gradient(55% 45% at 0% 0%, rgba(91, 104, 235, 0.1), transparent 65%),
          radial-gradient(45% 40% at 100% 100%, rgba(40, 225, 253, 0.14), transparent 65%),
          #f8fafc;
      }
      .contact-request:focus {
        outline: none;
      }
      .contact-request__inner {
        max-inline-size: 46rem;
        margin-inline: auto;
        padding-inline: 1.5rem;
      }
      .contact-request__head {
        text-align: center;
        margin-block-end: 2.5rem;
      }
      .contact-request__head h2 {
        margin-block: 0 0.85rem;
        margin-inline: 0;
        font-size: clamp(1.75rem, 3vw, 2.5rem);
        line-height: 1.15;
        font-weight: 800;
        letter-spacing: -0.02em;
        color: #0f172a;
      }
      .contact-request__lead {
        margin: 0;
        font-size: 1.05rem;
        color: #475569;
      }
      .contact-request__alt {
        margin-block: 1rem 0;
      }
      .contact-request__mailto {
        display: inline-flex;
        align-items: center;
        min-block-size: 44px;
        padding-inline: 1.25rem;
        border-radius: 999px;
        background: #2563eb;
        color: #fff;
        font-weight: 600;
        text-decoration: none;
        unicode-bidi: isolate;
      }
      .contact-request__mailto:hover {
        background: #1d4ed8;
      }
      .contact-request__mailto:focus-visible {
        outline: 3px solid #93c5fd;
        outline-offset: 2px;
      }
      .contact-request__card {
        background: #fff;
        border: 1px solid #f1f5f9;
        border-radius: 1rem;
        box-shadow: 0 10px 30px -12px rgba(15, 23, 42, 0.18);
        padding-block: 2rem;
        padding-inline: 2rem;
      }
      @media (max-width: 640px) {
        .contact-request {
          padding-block: 3.5rem;
        }
        .contact-request__card {
          padding-inline: 1.25rem;
        }
      }
    `
  ]
})
export class ContactRequestSectionComponent extends LandingCopyBase {
  /** Objet présélectionné quand l'URL ne porte pas de `?objet=` valide. */
  readonly defaultSubject = input<ContactRequestSubject>('acces-entreprise');
  /** En-tête localisé de la section (défaut : en-tête du dictionnaire contact). */
  readonly heading = input<ContactRequestHeading | undefined>(undefined);

  protected readonly enabled = environment.publicContact.enabled;
  protected readonly fallbackEmail = CONTACT_FALLBACK_EMAIL;
  protected readonly mailtoHref = CONTACT_MAILTO_HREF;


  protected readonly effectiveHeading = computed<ContactRequestHeading>(
    () => this.heading() ?? { title: this.t().contact.title, lead: this.t().contact.lead }
  );

  protected readonly disabledLead = computed(() =>
    this.copy.format(this.t().contact.errors.disabled, { email: CONTACT_FALLBACK_EMAIL })
  );
}
