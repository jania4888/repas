import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { StudioSystemHubComponent } from './studio-system-hub.component';
import { StudioService } from './studio.service';
import { StudioAiBuildService } from './studio-ai-build.service';
import { StudioAiCapabilitiesService } from './ai/studio-ai-capabilities.service';
import { STUDIO_AI_CAPABILITIES_FALLBACK, StudioAiCapabilitiesDto } from './ai/studio-ai.models';
import { StudioAiExportDialogComponent } from './ai/import-export/studio-ai-export-dialog.component';
import { studioSystemExportFixture } from './ai/preview/testing/studio-ai-spec.fixture';
import { CustomSystemDetail } from './studio.models';

const DETAIL: CustomSystemDetail = {
  system: {
    id: 's1', key: 'gestion_des_conges', displayName: 'Gestion des congés', icon: null, description: 'Congés et absences',
    onboardingSteps: null, isActive: true, entityCount: 0, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z'
  },
  entities: []
};

function capabilitiesStub(overrides: Partial<StudioAiCapabilitiesDto>, state: 'ready' | 'unavailable' = 'ready') {
  return {
    ensureLoaded: jasmine.createSpy('ensureLoaded'),
    state: signal(state).asReadonly(),
    capabilities: signal({ ...STUDIO_AI_CAPABILITIES_FALLBACK, ...overrides }).asReadonly()
  };
}

describe('StudioSystemHubComponent — actions Exporter / Dupliquer (3.4i2)', () => {
  let fixture: ComponentFixture<StudioSystemHubComponent>;

  function setup(systemExportEnabled: boolean, canDesign: boolean): void {
    const studio = jasmine.createSpyObj<StudioService>('StudioService', ['getSystem', 'listSystems']);
    studio.getSystem.and.returnValue(of({ success: true, data: DETAIL, message: null, errors: [] }));
    const builds = jasmine.createSpyObj<StudioAiBuildService>('StudioAiBuildService', ['exportSystem']);
    builds.exportSystem.and.returnValue(of({ success: true, data: studioSystemExportFixture(), message: null, errors: [] }));

    TestBed.configureTestingModule({
      imports: [StudioSystemHubComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: StudioService, useValue: studio },
        { provide: StudioAiBuildService, useValue: builds },
        { provide: StudioAiCapabilitiesService, useValue: capabilitiesStub({ systemExportEnabled }) },
        {
          provide: AuthService,
          useValue: { hasPermission: (p: string) => p === PERMISSIONS.studio.designEntities ? canDesign : false }
        },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ key: 'gestion_des_conges' }) } } }
      ]
    });
    fixture = TestBed.createComponent(StudioSystemHubComponent);
    fixture.detectChanges();
  }

  function action(name: 'export' | 'duplicate'): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-action="${name}"]`);
  }

  it('flag export coupé ⇒ aucune action Exporter/Dupliquer', () => {
    setup(false, true);
    expect(fixture.nativeElement.textContent).toContain('Gestion des congés');
    expect(action('export')).toBeNull();
    expect(action('duplicate')).toBeNull();
    expect(fixture.nativeElement.querySelector('app-studio-ai-export-dialog')).toBeNull();
  });

  it('flag actif mais sans studio:design_entities ⇒ aucune action', () => {
    setup(true, false);
    expect(action('export')).toBeNull();
    expect(action('duplicate')).toBeNull();
  });

  it('flag actif + permission ⇒ Exporter ouvre le dialog avec la clé du système', () => {
    setup(true, true);
    const exportButton = action('export') as HTMLButtonElement;
    expect(exportButton).not.toBeNull();
    expect(exportButton.textContent).toContain('Exporter (JSON)');

    exportButton.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.exportVisible()).toBeTrue();
    const dialog = fixture.debugElement.query(d => d.componentInstance instanceof StudioAiExportDialogComponent)
      .componentInstance as StudioAiExportDialogComponent;
    expect(dialog.visible()).toBeTrue();
    expect(dialog.systemKey()).toBe('gestion_des_conges');
  });

  it('Dupliquer pointe vers /studio/ai?duplicate=<clé>', () => {
    setup(true, true);
    const duplicate = action('duplicate') as HTMLAnchorElement;
    expect(duplicate).not.toBeNull();
    expect(duplicate.textContent).toContain('Dupliquer');
    expect(duplicate.getAttribute('href')).toBe('/studio/ai?duplicate=gestion_des_conges');
  });
});
