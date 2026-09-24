import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LandingLocaleService } from '@core/services/landing-locale.service';
import { PublicRegistrationStatusService } from '@core/services/public-registration-status.service';
import type { ContactRequestSubject } from '../../contact/contact-request.models';
import { LandingCopyService } from '../../content/landing-copy.service';
import { homePath } from '../../i18n/landing-locale.util';

export type LandingCtaAudience = 'company' | 'firm';

/**
 * Bouton d'appel à l'action unique de la landing (plan § 4.2).
 * - inscriptions ouvertes → `/auth/register` ou `/auth/register-firm` (`data-cta-state="open"`) ;
 * - fermées (ou `forceContact`) → `contactPath` + `?objet=…#contact` (`data-cta-state="closed"`) ;
 * - squelette `aria-hidden` tant que le statut n'est pas connu (sauf `forceContact`).
 * Ne pointe jamais vers une inscription fermée.
 */
@Component({
  selector: 'app-landing-cta',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (showSkeleton()) {
      <span class="landing-cta landing-cta--skeleton {{ cssClass() }}" aria-hidden="true" data-cta-state="loading">{{ skeletonLabel() }}</span>
    } @else if (isOpen()) {
      <a class="landing-cta {{ cssClass() }}" [routerLink]="openLink()" data-cta-state="open">{{ openLabel() }}</a>
    } @else {
      <a
        class="landing-cta {{ cssClass() }}"
        [routerLink]="contactTarget()"
        [queryParams]="{ objet: subject() }"
        fragment="contact"
        data-cta-state="closed"
        >{{ closedLabel() }}</a
      >
    }
  `,
  styles: [
    `
      :host {
        display: inline-block;
      }
      .landing-cta--skeleton {
        display: inline-block;
        min-inline-size: 12rem;
        min-block-size: 2.75rem;
        border-radius: 999px;
        color: transparent !important;
        pointer-events: none;
        background: linear-gradient(90deg, rgba(0, 0, 0, 0.06), rgba(0, 0, 0, 0.12), rgba(0, 0, 0, 0.06)) !important;
        background-size: 24rem 100% !important;
      }
      @media (prefers-reduced-motion: no-preference) {
        .landing-cta--skeleton {
          animation: cta-shimmer 1.2s infinite linear;
        }
      }
      @keyframes cta-shimmer {
        from {
          background-position: -12rem 0;
        }
        to {
          background-position: 12rem 0;
        }
      }
    `
  ]
})
export class LandingCtaComponent {
  /** Cible commerciale : PME (`register`) ou cabinet (`register-firm`). */
  readonly audience = input<LandingCtaAudience>('company');
  /** Classes du thème Chain réutilisées telles quelles (`main-button`, `gradient-button`, `pricing-button primary`…). */
  readonly cssClass = input<string>('main-button');
  /** Objet imposé pour l'état fermé (ex. `entreprise` sur la bannière Plan Entreprise). */
  readonly subjectOverride = input<ContactRequestSubject | undefined>(undefined);
  /** `true` = toujours vers le formulaire de contact, quel que soit l'état d'inscription. */
  readonly forceContact = input<boolean>(false);
  readonly openLabelOverride = input<string | undefined>(undefined);
  readonly closedLabelOverride = input<string | undefined>(undefined);
  /** Page portant le formulaire `#contact` (défaut : accueil localisé). */
  readonly contactPath = input<string | undefined>(undefined);

  protected readonly status = inject(PublicRegistrationStatusService);
  private readonly copy = inject(LandingCopyService);
  private readonly localeService = inject(LandingLocaleService);

  protected readonly showSkeleton = computed(() => !this.forceContact() && !this.status.loaded());
  protected readonly isOpen = computed(
    () => !this.forceContact() && (this.audience() === 'firm' ? this.status.firmOpen() : this.status.companyOpen())
  );
  protected readonly openLink = computed(() => (this.audience() === 'firm' ? '/auth/register-firm' : '/auth/register'));
  protected readonly subject = computed<ContactRequestSubject>(
    () => this.subjectOverride() ?? (this.audience() === 'firm' ? 'demo-cabinet' : 'acces-entreprise')
  );
  protected readonly contactTarget = computed(() => this.contactPath() ?? homePath(this.localeService.locale()));
  protected readonly openLabel = computed(() => this.openLabelOverride() ?? this.copy.t().shared.cta[this.audience()].open);
  protected readonly closedLabel = computed(
    () => this.closedLabelOverride() ?? this.copy.t().shared.cta[this.audience()].closed
  );
  /** Texte transparent du squelette : réserve la même largeur que le libellé final. */
  protected readonly skeletonLabel = computed(() => this.closedLabel());

  constructor() {
    this.status.ensureLoaded();
  }
}
