import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { signal } from '@angular/core';
import { environment } from '@environments/environment';
import { MessageService } from 'primeng/api';
import { AuthService } from '@core/services/auth.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { StudioRecordListComponent } from './studio-record-list.component';
import { StudioAiCapabilitiesService } from './ai/studio-ai-capabilities.service';
import { STUDIO_AI_CAPABILITIES_FALLBACK, StudioAiCapabilitiesDto } from './ai/studio-ai.models';
import { CustomEntitySchema } from './studio.models';
import { RecordViewDefinition } from './views/studio-record-views.models';

const definition: RecordViewDefinition = {
  columns: [{ fieldKey: 'nom', hidden: false }],
  filters: [],
  sort: [],
  searchEnabled: true,
  pageSize: 25
};

function schema(withViews: boolean, isDefault = true): CustomEntitySchema {
  return {
    entity: {
      id: 'e1', key: 'interventions', displayName: 'Intervention', displayNamePlural: 'Interventions',
      icon: null, description: null, isActive: true, fieldCount: 1, createdAt: '', updatedAt: ''
    },
    fields: [
      { id: 'f1', key: 'nom', label: 'Nom', fieldType: 0, isRequired: false, isUnique: false, sortOrder: 0, rules: null, options: null, relation: null, isActive: true }
    ],
    form: { sections: [] } as any,
    relations: [],
    views: withViews ? [
      { id: 'v1', key: 'v1', displayName: 'Actifs', mode: 'List', definition, isDefault, isActive: true, rowVersion: 'AAA', updatedAt: '' }
    ] : []
  };
}

function capabilitiesStub(overrides: Partial<StudioAiCapabilitiesDto>, state: 'unknown' | 'loading' | 'ready' | 'unavailable' = 'ready') {
  return {
    ensureLoaded: () => {},
    state: signal(state).asReadonly(),
    capabilities: signal({ ...STUDIO_AI_CAPABILITIES_FALLBACK, ...overrides }).asReadonly()
  };
}

describe('StudioRecordListComponent', () => {
  let fixture: ComponentFixture<StudioRecordListComponent>;
  let httpMock: HttpTestingController;
  let router: Router;
  let queryParamMap$: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  function setup(recordViewsEnabled: boolean, canDesignForms = true, state: 'unknown' | 'loading' | 'ready' | 'unavailable' = 'ready'): void {
    queryParamMap$ = new BehaviorSubject(convertToParamMap({}));

    TestBed.configureTestingModule({
      imports: [StudioRecordListComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        MessageService,
        { provide: ConfirmationService, useValue: { confirm: () => {} } },
        {
          provide: AuthService,
          useValue: {
            hasPermission: (p: string) =>
              p === PERMISSIONS.customData.recordsWrite ? true :
              p === PERMISSIONS.studio.designForms ? canDesignForms : false
          }
        },
        { provide: StudioAiCapabilitiesService, useValue: capabilitiesStub({ recordViewsEnabled }, state) },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { paramMap: convertToParamMap({ key: 'interventions' }) },
            queryParamMap: queryParamMap$.asObservable()
          }
        }
      ]
    });

    router = TestBed.inject(Router);
    spyOn(router, 'navigate').and.resolveTo(true);

    fixture = TestBed.createComponent(StudioRecordListComponent);
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  }

  afterEach(() => httpMock.verify());

  it('masque le sélecteur de vues quand recordViewsEnabled=false (régression)', () => {
    setup(false);
    httpMock.expectOne(`${environment.apiUrl}/studio/records/interventions/schema`).flush({ success: true, data: schema(true), message: null, errors: [] });
    httpMock.expectOne(req => req.url === `${environment.apiUrl}/studio/records/interventions`)
      .flush({ success: true, data: { items: [], totalCount: 0 }, message: null, errors: [] });
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('app-studio-view-switcher'))).toBeNull();
    expect(fixture.debugElement.query(By.css('app-dynamic-table'))).not.toBeNull();
  });

  it('affiche le sélecteur de vues quand recordViewsEnabled=true et qu’il existe des vues', () => {
    setup(true);
    httpMock.expectOne(`${environment.apiUrl}/studio/records/interventions/schema`).flush({ success: true, data: schema(true, false), message: null, errors: [] });
    httpMock.expectOne(req => req.url === `${environment.apiUrl}/studio/records/interventions`)
      .flush({ success: true, data: { items: [], totalCount: 0 }, message: null, errors: [] });
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('app-studio-view-switcher'))).not.toBeNull();
  });

  it('masque le sélecteur quand recordViewsEnabled=true mais qu’aucune vue n’existe', () => {
    setup(true);
    httpMock.expectOne(`${environment.apiUrl}/studio/records/interventions/schema`).flush({ success: true, data: schema(false), message: null, errors: [] });
    httpMock.expectOne(req => req.url === `${environment.apiUrl}/studio/records/interventions`)
      .flush({ success: true, data: { items: [], totalCount: 0 }, message: null, errors: [] });
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('app-studio-view-switcher'))).toBeNull();
  });

  it('bascule vers le runner de vue et affiche « Modifier la vue » quand ?view= correspond à une vue enregistrée', () => {
    setup(true);
    httpMock.expectOne(`${environment.apiUrl}/studio/records/interventions/schema`).flush({ success: true, data: schema(true), message: null, errors: [] });
    httpMock.expectOne(req => req.url === `${environment.apiUrl}/studio/records/interventions`)
      .flush({ success: true, data: { items: [], totalCount: 0 }, message: null, errors: [] });
    fixture.detectChanges();

    queryParamMap$.next(convertToParamMap({ view: 'v1' }));
    fixture.detectChanges();
    // Le runner (mode Liste) délègue lui-même à app-dynamic-table (imbriqué) — une seule instance
    // doit exister, celle du runner, plus l'ancien tableau « brut » de la page ne doit plus l'être.
    httpMock.expectOne(`${environment.apiUrl}/studio/records/interventions/views/v1/run`)
      .flush({ success: true, data: { mode: 'List', items: [], total: 0, page: 1, pageSize: 25, truncated: false }, message: null, errors: [] });
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('app-studio-record-view-runner'))).not.toBeNull();
    expect(fixture.debugElement.queryAll(By.css('app-dynamic-table')).length).toBe(1);
    const button = fixture.debugElement.query(By.css('app-button'));
    expect(button.nativeElement.textContent).toContain('Modifier la vue');
  });

  it('masque le bouton de vue quand l’utilisateur n’a pas la permission studio:design_forms', () => {
    setup(true, false);
    httpMock.expectOne(`${environment.apiUrl}/studio/records/interventions/schema`).flush({ success: true, data: schema(true, false), message: null, errors: [] });
    httpMock.expectOne(req => req.url === `${environment.apiUrl}/studio/records/interventions`)
      .flush({ success: true, data: { items: [], totalCount: 0 }, message: null, errors: [] });
    fixture.detectChanges();

    const buttons = fixture.debugElement.queryAll(By.css('app-button'));
    expect(buttons.some(b => b.nativeElement.textContent.includes('Nouvelle vue'))).toBeFalse();
  });

  it('navigue avec queryParamsHandling=merge quand le switcher change de vue', () => {
    setup(true);
    httpMock.expectOne(`${environment.apiUrl}/studio/records/interventions/schema`).flush({ success: true, data: schema(true, false), message: null, errors: [] });
    httpMock.expectOne(req => req.url === `${environment.apiUrl}/studio/records/interventions`)
      .flush({ success: true, data: { items: [], totalCount: 0 }, message: null, errors: [] });
    fixture.detectChanges();

    fixture.componentInstance.onSwitchView('v1');

    expect(router.navigate).toHaveBeenCalledWith([], jasmine.objectContaining({
      queryParams: { view: 'v1' },
      queryParamsHandling: 'merge'
    }));
  });

  // ---- Repli capacités (zéro régression) ----

  it('ignore ?view= tant que les capacités sont en chargement (aucun runner, aucun /run)', () => {
    setup(true, true, 'loading');
    queryParamMap$.next(convertToParamMap({ view: 'v1' }));
    httpMock.expectOne(`${environment.apiUrl}/studio/records/interventions/schema`).flush({ success: true, data: schema(true), message: null, errors: [] });
    httpMock.expectOne(req => req.url === `${environment.apiUrl}/studio/records/interventions`)
      .flush({ success: true, data: { items: [], totalCount: 0 }, message: null, errors: [] });
    fixture.detectChanges();

    httpMock.expectNone(req => req.url.includes('/run'));
    expect(fixture.debugElement.query(By.css('app-studio-record-view-runner'))).toBeNull();
    expect(fixture.debugElement.query(By.css('app-dynamic-table'))).not.toBeNull();
  });

  it('ignore ?view= quand les capacités sont indisponibles', () => {
    setup(true, true, 'unavailable');
    queryParamMap$.next(convertToParamMap({ view: 'v1' }));
    httpMock.expectOne(`${environment.apiUrl}/studio/records/interventions/schema`).flush({ success: true, data: schema(true), message: null, errors: [] });
    httpMock.expectOne(req => req.url === `${environment.apiUrl}/studio/records/interventions`)
      .flush({ success: true, data: { items: [], totalCount: 0 }, message: null, errors: [] });
    fixture.detectChanges();

    httpMock.expectNone(req => req.url.includes('/run'));
    expect(fixture.debugElement.query(By.css('app-studio-record-view-runner'))).toBeNull();
    expect(fixture.debugElement.query(By.css('app-studio-view-switcher'))).toBeNull();
  });

  it('ignore ?view= quand la capacité est false', () => {
    setup(false);
    queryParamMap$.next(convertToParamMap({ view: 'v1' }));
    httpMock.expectOne(`${environment.apiUrl}/studio/records/interventions/schema`).flush({ success: true, data: schema(true), message: null, errors: [] });
    httpMock.expectOne(req => req.url === `${environment.apiUrl}/studio/records/interventions`)
      .flush({ success: true, data: { items: [], totalCount: 0 }, message: null, errors: [] });
    fixture.detectChanges();

    httpMock.expectNone(req => req.url.includes('/run'));
    expect(fixture.debugElement.query(By.css('app-studio-record-view-runner'))).toBeNull();
  });

  // ---- Sélection effective de la vue ----

  it('active la vue par défaut quand aucun paramètre ?view= (sans toucher la liste brute)', () => {
    setup(true);
    httpMock.expectOne(`${environment.apiUrl}/studio/records/interventions/schema`).flush({ success: true, data: schema(true), message: null, errors: [] });
    httpMock.expectOne(req => req.url === `${environment.apiUrl}/studio/records/interventions`)
      .flush({ success: true, data: { items: [], totalCount: 0 }, message: null, errors: [] });
    fixture.detectChanges();

    // v1 est isDefault=true dans schema(true) : le runner s'active sans paramètre.
    httpMock.expectOne(`${environment.apiUrl}/studio/records/interventions/views/v1/run`)
      .flush({ success: true, data: { mode: 'List', items: [], total: 0, page: 1, pageSize: 25, truncated: false }, message: null, errors: [] });
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('app-studio-record-view-runner'))).not.toBeNull();
    expect(fixture.debugElement.query(By.css('#studio-view-panel'))).not.toBeNull();
  });

  it('le paramètre ?view= explicite l’emporte sur la vue par défaut', () => {
    setup(true);
    queryParamMap$.next(convertToParamMap({ view: 'v2' }));
    httpMock.expectOne(`${environment.apiUrl}/studio/records/interventions/schema`).flush({ success: true, data: schema(true), message: null, errors: [] });
    httpMock.expectOne(req => req.url === `${environment.apiUrl}/studio/records/interventions`)
      .flush({ success: true, data: { items: [], totalCount: 0 }, message: null, errors: [] });
    fixture.detectChanges();

    // v2 n'existe pas : la vue par défaut (v1) s'applique.
    httpMock.expectOne(`${environment.apiUrl}/studio/records/interventions/views/v1/run`)
      .flush({ success: true, data: { mode: 'List', items: [], total: 0, page: 1, pageSize: 25, truncated: false }, message: null, errors: [] });
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('app-studio-record-view-runner'))).not.toBeNull();
  });

  it('reste sur la « Liste » brute quand aucune vue n’est par défaut', () => {
    setup(true);
    const s = schema(true);
    s.views![0].isDefault = false;
    httpMock.expectOne(`${environment.apiUrl}/studio/records/interventions/schema`).flush({ success: true, data: s, message: null, errors: [] });
    httpMock.expectOne(req => req.url === `${environment.apiUrl}/studio/records/interventions`)
      .flush({ success: true, data: { items: [], totalCount: 0 }, message: null, errors: [] });
    fixture.detectChanges();

    httpMock.expectNone(req => req.url.includes('/run'));
    expect(fixture.debugElement.query(By.css('app-studio-record-view-runner'))).toBeNull();
    expect(fixture.debugElement.query(By.css('app-dynamic-table'))).not.toBeNull();
  });

  // ---- Routage des contrôles vers la vue active ----

  it('route la recherche vers le runner quand une vue est active', () => {
    setup(true);
    httpMock.expectOne(`${environment.apiUrl}/studio/records/interventions/schema`).flush({ success: true, data: schema(true), message: null, errors: [] });
    httpMock.expectOne(req => req.url === `${environment.apiUrl}/studio/records/interventions`)
      .flush({ success: true, data: { items: [], totalCount: 0 }, message: null, errors: [] });
    fixture.detectChanges();
    httpMock.expectOne(`${environment.apiUrl}/studio/records/interventions/views/v1/run`)
      .flush({ success: true, data: { mode: 'List', items: [], total: 0, page: 1, pageSize: 25, truncated: false }, message: null, errors: [] });
    fixture.detectChanges();

    // ngModel met à jour `search` puis la détection propage l'input au runner avant le clic.
    fixture.componentInstance.search = 'pump';
    fixture.detectChanges();
    fixture.componentInstance.reload();
    fixture.detectChanges();

    const req = httpMock.expectOne(`${environment.apiUrl}/studio/records/interventions/views/v1/run`);
    expect(req.request.body.search).toBe('pump');
    req.flush({ success: true, data: { mode: 'List', items: [], total: 0, page: 1, pageSize: 25, truncated: false }, message: null, errors: [] });
    httpMock.expectNone(r => r.url === `${environment.apiUrl}/studio/records/interventions`);
  });

  it('le sous-titre reflète le total de la vue active et l’export est masqué', () => {
    setup(true);
    httpMock.expectOne(`${environment.apiUrl}/studio/records/interventions/schema`).flush({ success: true, data: schema(true), message: null, errors: [] });
    httpMock.expectOne(req => req.url === `${environment.apiUrl}/studio/records/interventions`)
      .flush({ success: true, data: { items: [], totalCount: 999 }, message: null, errors: [] });
    fixture.detectChanges();
    httpMock.expectOne(`${environment.apiUrl}/studio/records/interventions/views/v1/run`)
      .flush({ success: true, data: { mode: 'List', items: [], total: 3, page: 1, pageSize: 25, truncated: false }, message: null, errors: [] });
    fixture.detectChanges();

    expect(fixture.componentInstance.subtitleTotal()).toBe(3);
    expect(fixture.nativeElement.textContent).toContain('3 enregistrement(s)');
    expect(fixture.debugElement.query(By.css('p-menu'))).toBeNull();
  });
});
