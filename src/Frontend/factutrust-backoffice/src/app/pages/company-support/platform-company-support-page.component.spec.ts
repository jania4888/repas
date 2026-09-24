import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { PlatformCompanySupportPageComponent } from './platform-company-support-page.component';
import { PlatformPermissionsService } from '@core/services/platform-permissions.service';
import { PlatformPermission } from '@core/models/platform.models';

describe('PlatformCompanySupportPageComponent', () => {
  let fixture: ComponentFixture<PlatformCompanySupportPageComponent>;

  function setup(permissions: string[]): void {
    TestBed.configureTestingModule({
      imports: [PlatformCompanySupportPageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: PlatformPermissionsService,
          useValue: {
            has: (key: string) => permissions.includes(key),
            isLoaded: signal(true)
          }
        }
      ]
    });
    fixture = TestBed.createComponent(PlatformCompanySupportPageComponent);
    fixture.detectChanges();
  }

  it('hides the composer without write permission', () => {
    setup([PlatformPermission.CompanySupportRead]);
    const component = fixture.componentInstance;
    component['selectedId'].set('tenant-1');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
  });

  it('shows the composer with write permission once a company is selected', () => {
    setup([PlatformPermission.CompanySupportRead, PlatformPermission.CompanySupportWrite]);
    fixture.componentInstance['selectedId'].set('tenant-1');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('form')).not.toBeNull();
  });
});
