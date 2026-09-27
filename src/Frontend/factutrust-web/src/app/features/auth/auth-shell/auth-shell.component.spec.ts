import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthShellComponent } from './auth-shell.component';
import {
  AuthShellConfig,
  LOGIN_AUTH_SHELL_CONFIG,
  REGISTER_AUTH_SHELL_CONFIG,
  REGISTER_FIRM_AUTH_SHELL_CONFIG,
} from './auth-shell.config';

describe('AuthShellComponent', () => {
  let fixture: ComponentFixture<AuthShellComponent>;

  const formCard = (): HTMLElement | null =>
    (fixture.nativeElement as HTMLElement).querySelector('.auth-form-card');

  const renderWithConfig = (config: AuthShellConfig): void => {
    fixture.componentInstance.config = config;
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AuthShellComponent],
      // Sélecteur de langue (ErpLocaleService → authentification et préférences via HTTP).
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(AuthShellComponent);
    renderWithConfig(LOGIN_AUTH_SHELL_CONFIG);
  });

  it('should render hero title from config', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain(LOGIN_AUTH_SHELL_CONFIG.title);
  });

  it('should render the badge in the hero, not the header', () => {
    const el: HTMLElement = fixture.nativeElement;
    const header = el.querySelector('.auth-page-header');
    const hero = el.querySelector('.auth-hero-panel');
    expect(header?.textContent).not.toContain(LOGIN_AUTH_SHELL_CONFIG.badge);
    expect(hero?.textContent).toContain(LOGIN_AUTH_SHELL_CONFIG.badge);
  });

  it('should render feature descriptions', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Tableaux de bord intelligents');
    expect(el.textContent).toContain('Suivez vos indicateurs clés en temps réel');
  });

  it('should render trust footer titles and subtitles', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Sécurité garantie');
    expect(el.textContent).toContain('Vos données sont chiffrées');
    expect(el.textContent).toContain('Support 7j/7');
  });

  it('should not render a hero SVG image', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.auth-hero-panel__image')).toBeNull();
    expect(el.querySelector('.auth-page__photo')).not.toBeNull();
  });

  it('does not mark the login form card as wide or internally scrollable', () => {
    const card = formCard();
    expect(card).not.toBeNull();
    expect(card!.classList.contains('auth-form-card--wide')).toBeFalse();
    expect(card!.classList.contains('auth-form-card--scrollable')).toBeFalse();
  });

  it('marks the register wizard card as wide without an internal scrollbar', () => {
    renderWithConfig(REGISTER_AUTH_SHELL_CONFIG);
    const card = formCard();
    expect(card).not.toBeNull();
    expect(card!.classList.contains('auth-form-card--wide')).toBeTrue();
    expect(card!.classList.contains('auth-form-card--scrollable')).toBeFalse();
  });

  it('marks the register-firm wizard card as wide without an internal scrollbar', () => {
    renderWithConfig(REGISTER_FIRM_AUTH_SHELL_CONFIG);
    const card = formCard();
    expect(card).not.toBeNull();
    expect(card!.classList.contains('auth-form-card--wide')).toBeTrue();
    expect(card!.classList.contains('auth-form-card--scrollable')).toBeFalse();
  });

  it('does not mark a compact config without flags as internally scrollable', () => {
    renderWithConfig({
      badge: 'Sécurisé',
      title: 'Page compacte',
    });
    const card = formCard();
    expect(card).not.toBeNull();
    expect(card!.classList.contains('auth-form-card--wide')).toBeFalse();
    expect(card!.classList.contains('auth-form-card--scrollable')).toBeFalse();
  });

  it('honours an explicit scrollableFormCard override on a compact card', () => {
    renderWithConfig({
      badge: 'Sécurisé',
      title: 'Page compacte longue',
      wideFormCard: false,
      scrollableFormCard: true,
    });
    const card = formCard();
    expect(card).not.toBeNull();
    expect(card!.classList.contains('auth-form-card--wide')).toBeFalse();
    expect(card!.classList.contains('auth-form-card--scrollable')).toBeTrue();
  });
});
