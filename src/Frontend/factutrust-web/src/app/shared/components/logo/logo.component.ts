import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BRAND, brandAlt } from '@core/constants/brand';

export type LogoSize = 'small' | 'medium' | 'large' | 'xlarge';
export type LogoVariant = 'lockup' | 'icon-only';

@Component({
  selector: 'app-logo',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <a
      [routerLink]="routerLink"
      class="logo"
      [class.logo-small]="size === 'small'"
      [class.logo-medium]="size === 'medium'"
      [class.logo-large]="size === 'large'"
      [class.logo-xlarge]="size === 'xlarge'"
      [class.logo-icon-only]="variant === 'icon-only'"
      [attr.aria-label]="ariaLabelValue"
      [title]="titleValue">
      <img
        [src]="effectiveLogoPath"
        [alt]="altValue"
        class="logo-image"
        loading="eager"
        fetchpriority="high">
    </a>
  `,
  styles: [`
    .logo {
      display: inline-flex;
      align-items: center;
      text-decoration: none;
      transition: transform var(--transition-normal);
      color: inherit;

      &:hover {
        transform: scale(1.03);

        .logo-image {
          filter: drop-shadow(0 4px 12px rgba(0, 102, 255, 0.25));
        }
      }

      &:focus-visible {
        outline: 2px solid var(--brand-primary, #0066FF);
        outline-offset: 4px;
        border-radius: var(--radius-md);
      }
    }

    .logo-image {
      display: block;
      height: auto;
      width: auto;
      object-fit: contain;
      transition: filter var(--transition-normal);
    }

    .logo-small .logo-image {
      max-height: 32px;
      max-width: 160px;
    }

    .logo-medium .logo-image {
      max-height: 48px;
      max-width: 240px;
    }

    .logo-large .logo-image {
      max-height: 64px;
      max-width: 320px;
    }

    .logo-xlarge .logo-image {
      max-height: 80px;
      max-width: 400px;
    }

    .logo-icon-only .logo-image {
      max-height: 32px;
      max-width: 32px;
      width: 32px;
      height: 32px;
      object-fit: contain;
    }

    .logo-icon-only.logo-medium .logo-image {
      max-height: 40px;
      max-width: 40px;
      width: 40px;
      height: 40px;
    }

    .logo-icon-only.logo-large .logo-image {
      max-height: 48px;
      max-width: 48px;
      width: 48px;
      height: 48px;
    }

    @media (max-width: 768px) {
      .logo-small .logo-image {
        max-height: 28px;
        max-width: 140px;
      }

      .logo-medium .logo-image {
        max-height: 40px;
        max-width: 200px;
      }

      .logo-large .logo-image {
        max-height: 52px;
        max-width: 260px;
      }

      .logo-xlarge .logo-image {
        max-height: 64px;
        max-width: 320px;
      }
    }
  `]
})
export class LogoComponent {
  @Input() size: LogoSize = 'large';
  @Input() variant: LogoVariant = 'lockup';
  @Input() routerLink: string | string[] = '/';
  @Input() ariaLabel?: string;
  @Input() title?: string;
  @Input() alt?: string;
  @Input() logoUrl?: string;

  get effectiveLogoPath(): string {
    if (this.logoUrl) {
      return this.logoUrl;
    }
    return this.variant === 'icon-only' ? BRAND.logoIcon : BRAND.logoLockup;
  }

  get ariaLabelValue(): string {
    return this.ariaLabel || $localize`:@@shared.logo.ts.name.retour.a.l.accueil.ca103ba9:${BRAND.name}:name: — Retour à l'accueil`;
  }

  get titleValue(): string {
    return this.title || BRAND.name;
  }

  get altValue(): string {
    return this.alt || brandAlt(BRAND.taglineLong);
  }
}
