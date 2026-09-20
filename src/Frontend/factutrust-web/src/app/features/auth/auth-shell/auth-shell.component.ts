import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { LogoComponent } from '@shared/components/logo/logo.component';
import { BRAND } from '@core/constants/brand';
import {
  AUTH_HERO_OFFICE,
  AUTH_HERO_OFFICE_FALLBACK,
  AuthShellConfig,
} from './auth-shell.config';

@Component({
  selector: 'app-auth-shell',
  standalone: true,
  imports: [CommonModule, RouterModule, LogoComponent],
  templateUrl: './auth-shell.component.html',
  styleUrl: './auth-shell.component.scss',
})
export class AuthShellComponent {
  readonly brand = BRAND;
  readonly photoLayer = `image-set(url("${AUTH_HERO_OFFICE}") type("image/webp"), url("${AUTH_HERO_OFFICE_FALLBACK}") type("image/jpeg"))`;

  @Input({ required: true }) config!: AuthShellConfig;

  badgeClass(): string {
    const variant = this.config.badgeVariant ?? 'secure';
    return `auth-page-header__badge auth-page-header__badge--${variant}`;
  }

  isFormCardScrollable(): boolean {
    return this.config.scrollableFormCard ?? this.config.wideFormCard === true;
  }
}