import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '@core/services/auth.service';
import { FirmSettingsComponent } from './firm-settings.component';

describe('FirmSettingsComponent', () => {
  async function setup(isFirmManager: boolean): Promise<ComponentFixture<FirmSettingsComponent>> {
    await TestBed.configureTestingModule({
      imports: [FirmSettingsComponent],
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: { isFirmManager: () => isFirmManager }
        }
      ]
    }).compileComponents();

    const fixture = TestBed.createComponent(FirmSettingsComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('shows Collaborateurs card for FirmManager', async () => {
    const fixture = await setup(true);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Fiche annuaire');
    expect(text).toContain('Collaborateurs');
    expect(text).toContain('Types d’activité');
    expect(fixture.nativeElement.querySelector('a[href="/firm/collaborateurs"]')).toBeTruthy();
  });

  it('hides Collaborateurs card for FirmAccountant', async () => {
    const fixture = await setup(false);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).not.toContain('Collaborateurs');
    expect(text).not.toContain('Types d’activité');
    expect(fixture.nativeElement.querySelector('a[href="/firm/collaborateurs"]')).toBeNull();
  });
});
