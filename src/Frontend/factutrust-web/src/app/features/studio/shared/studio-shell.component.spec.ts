import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { providePrimeNG } from 'primeng/config';
import Aura from '@primeuix/themes/aura';
import { StudioApprovalsBadgeService } from '../approvals/studio-approvals-badge.service';
import { StudioShellComponent } from './studio-shell.component';

const INDIGO_600 = '#4f46e5';
const INDIGO_600_RGB = 'rgb(79, 70, 229)';

@Component({
  standalone: true,
  imports: [StudioShellComponent, ButtonModule],
  template: `
    <button pButton id="outside" label="Hors Studio"></button>
    <app-studio-shell>
      <!-- Le contenu est projeté par le router ; on teste ici la propagation des tokens. -->
    </app-studio-shell>
  `
})
class HostComponent {}

describe('StudioShellComponent (thème indigo scopé — D2)', () => {
  let fixture: ComponentFixture<HostComponent>;
  let shell: HTMLElement;
  let badgeStart: jasmine.Spy;

  beforeEach(async () => {
    badgeStart = jasmine.createSpy('start');
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        providePrimeNG({ theme: { preset: Aura } }),
        { provide: StudioApprovalsBadgeService, useValue: { start: badgeStart } }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    shell = fixture.nativeElement.querySelector('app-studio-shell');
  });

  function inside(html: string): HTMLElement {
    shell.insertAdjacentHTML('beforeend', html);
    return shell.lastElementChild as HTMLElement;
  }

  it('porte la classe studio-theme et redéfinit les tokens applicatifs en indigo', () => {
    expect(shell.classList.contains('studio-theme')).toBeTrue();
    const style = getComputedStyle(shell);
    expect(style.getPropertyValue('--color-primary-600').trim()).toBe(INDIGO_600);
    expect(style.getPropertyValue('--color-primary-50').trim()).toBe('#eef2ff');
    expect(style.getPropertyValue('--p-primary-color').trim()).toBe(INDIGO_600);
    expect(style.getPropertyValue('--p-primary-hover-color').trim()).toBe('#4338ca');
  });

  it('ne modifie pas les tokens globaux de l’application (:root reste bleu)', () => {
    expect(getComputedStyle(document.documentElement).getPropertyValue('--color-primary-600').trim()).toBe('#2563eb');
    const outside = fixture.nativeElement.querySelector('#outside') as HTMLElement;
    expect(getComputedStyle(outside).getPropertyValue('--color-primary-600').trim()).toBe('#2563eb');
    expect(getComputedStyle(outside).getPropertyValue('--p-primary-color').trim()).not.toBe(INDIGO_600);
  });

  it('résout les alias composants PrimeNG dérivés du primaire à l’intérieur de la coquille', () => {
    const probe = inside('<div></div>');
    const style = getComputedStyle(probe);
    expect(style.getPropertyValue('--p-button-primary-background').trim()).toBe(INDIGO_600);
    expect(style.getPropertyValue('--p-toggleswitch-checked-background').trim()).toBe(INDIGO_600);
    expect(style.getPropertyValue('--p-tabs-tab-active-color').trim()).toBe(INDIGO_600);
    expect(style.getPropertyValue('--p-highlight-background').trim()).toBe('#eef2ff');
    expect(style.getPropertyValue('--p-focus-ring-color').trim()).toBe(INDIGO_600);
  });

  it("démarre le badge d'approbations à l'ouverture du shell", () => {
    expect(badgeStart).toHaveBeenCalledTimes(1);
  });

  it('peint un bouton primaire en indigo dans la coquille et laisse le bouton extérieur inchangé', () => {
    const inner = inside('<button class="p-button" style="background: var(--p-button-primary-background)">Studio</button>');
    expect(getComputedStyle(inner).backgroundColor).toBe(INDIGO_600_RGB);
    const outside = fixture.nativeElement.querySelector('#outside') as HTMLElement;
    outside.style.background = 'var(--p-button-primary-background)';
    expect(getComputedStyle(outside).backgroundColor).not.toBe(INDIGO_600_RGB);
  });
});
