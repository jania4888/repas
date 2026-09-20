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
import { ButtonComponent } from '@shared/components/button/button.component';
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

  function setup(recordViewsEnabled: boolean, canDesignForms = true, state: 'unknown' | 'loading' | 'ready' | 'unavailable' = 'ready',
    canDesign = false, workflowsEnabled = false, recordsWrite = true): void {
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
              p === PERMISSIONS.customData.recordsWrite ? recordsWrite :
              p === PERMISSIONS.studio.designForms ? canDesignForms :
              p === PERMISSIONS.studio.designEntities ? canDesign : false
          }
        },
        { provide: StudioAiCapabilitiesService, useValue: capabilitiesStub({ recordViewsEnabled, workflowsEnabled }, state) },
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

  it('reste strictement sur la liste brute quand le schéma ne porte aucune vue (régression, capacités ignorées)', () => {
    setup(false);
    httpMock.expectOne(`${environment.apiUrl}/studio/records/interventions/schema`).flush({ success: true, data: schema(false), message: null, errors: [] });
    httpMock.expectOne(req => req.url === `${environment.apiUrl}/studio/records/interventions`)
      .flush({ success: true, data: { items: [], totalCount: 0 }, message: null, errors: [] });
    fixture.detectChanges();

    httpMock.expectNone(req => req.url.includes('/run'));
    expect(fixture.debugElement.query(By.css('app-studio-view-switcher'))).toBeNull();
    expect(fixture.debugElement.query(By.css('app-dynamic-table'))).not.toBeNull();
  });

  it('affiche le sélecteur de vues dès que le schéma expose des vues', () => {
    setup(true);
    httpMock.expectOne(`${environment.apiUrl}/studio/records/interventions/schema`).flush({ success: true, data: schema(true, false), message: null, errors: [] });
    httpMock.expectOne(req => req.url === `${environment.apiUrl}/studio/records/interventions`)
      .flush({ success: true, data: { items: [], totalCount: 0 }, message: null, errors: [] });
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('app-studio-view-switcher'))).not.toBeNull();
  });

  it('masque le sélecteur quand aucune vue n’existe', () => {
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

  // ---- Runtime piloté par le schéma (A-Q1) : les capacités ne conditionnent que la conception ----

  /** Bouton « Nouvelle vue » / « Modifier la vue » (conception), s'il est rendu. */
  function viewDesignButton() {
    return fixture.debugElement.queryAll(By.css('app-button'))
      .find(b => /Nouvelle vue|Modifier la vue/.test(b.nativeElement.textContent));
  }

  function flushSchemaWithViewsAndRun(): void {
    httpMock.expectOne(`${environment.apiUrl}/studio/records/interventions/schema`).flush({ success: true, data: schema(true), message: null, errors: [] });
    httpMock.expectOne(req => req.url === `${environment.apiUrl}/studio/records/interventions`)
      .flush({ success: true, data: { items: [], totalCount: 0 }, message: null, errors: [] });
    fixture.detectChanges();
    httpMock.expectOne(`${environment.apiUrl}/studio/records/interventions/views/v1/run`)
      .flush({ success: true, data: { mode: 'List', items: [], total: 0, page: 1, pageSize: 25, truncated: false }, message: null, errors: [] });
    fixture.detectChanges();
  }

  it('monte le runner sur ?view= même quand les capacités sont encore en chargement (sans bouton de conception)', () => {
    setup(true, true, 'loading');
    queryParamMap$.next(convertToParamMap({ view: 'v1' }));
    flushSchemaWithViewsAndRun();

    expect(fixture.debugElement.query(By.css('app-studio-record-view-runner'))).not.toBeNull();
    expect(fixture.debugElement.query(By.css('app-studio-view-switcher'))).not.toBeNull();
    // Une seule instance de app-dynamic-table : celle imbriquée dans le runner (mode Liste).
    expect(fixture.debugElement.queryAll(By.css('app-dynamic-table')).length).toBe(1);
    expect(viewDesignButton()).toBeUndefined();
  });

  it('monte le runner quand les capacités sont indisponibles (rôle « données » sans accès Studio, 403 sur /capabilities)', () => {
    setup(true, true, 'unavailable');
    queryParamMap$.next(convertToParamMap({ view: 'v1' }));
    flushSchemaWithViewsAndRun();

    expect(fixture.debugElement.query(By.css('app-studio-record-view-runner'))).not.toBeNull();
    expect(fixture.debugElement.query(By.css('app-studio-view-switcher'))).not.toBeNull();
    expect(viewDesignButton()).toBeUndefined();
  });

  it('monte le runner quand la capacité est false mais que le schéma porte des vues ; seul le bouton de conception est masqué', () => {
    setup(false);
    queryParamMap$.next(convertToParamMap({ view: 'v1' }));
    flushSchemaWithViewsAndRun();

    expect(fixture.debugElement.query(By.css('app-studio-record-view-runner'))).not.toBeNull();
    expect(viewDesignButton()).toBeUndefined();
  });

  it('affiche le bouton de conception uniquement quand les capacités sont prêtes et la permission accordée', () => {
    setup(true, true, 'ready');
    flushSchemaWithViewsAndRun();

    expect(viewDesignButton()).toBeDefined();
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

  it('lecteur sans recordsWrite : l’œil « Voir » pointe vers /view (D-47-94)', () => {
    setup(false, true, 'ready', false, false, false);
    httpMock.expectOne(`${environment.apiUrl}/studio/records/interventions/schema`).flush({ success: true, data: schema(false), message: null, errors: [] });
    httpMock.expectOne(req => req.url === `${environment.apiUrl}/studio/records/interventions`)
      .flush({ success: true, data: { items: [{ id: 'r1', data: { nom: 'X' } }], totalCount: 1 }, message: null, errors: [] });
    fixture.detectChanges();

    const cmp = fixture.componentInstance;
    expect(cmp.canWrite()).toBe(false);
    cmp.view({ id: 'r1', data: {} } as never);
    expect(router.navigate).toHaveBeenCalledWith(['/studio/d', 'interventions', 'r1', 'view']);
    cmp.edit({ id: 'r1', data: {} } as never);
    expect(router.navigate).toHaveBeenCalledWith(['/studio/d', 'interventions', 'r1', 'edit']);
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

  // ---- Accès workflows (4.4i) : capacité workflowsEnabled + studio:design_entities ----

  it('affiche le bouton Workflows pour un concepteur quand la capacité est vraie', () => {
    setup(false, true, 'ready', true, true);
    httpMock.expectOne(`${environment.apiUrl}/studio/records/interventions/schema`).flush({ success: true, data: schema(false), message: null, errors: [] });
    httpMock.expectOne(req => req.url === `${environment.apiUrl}/studio/records/interventions`)
      .flush({ success: true, data: { items: [], totalCount: 0 }, message: null, errors: [] });
    fixture.detectChanges();

    const btn = fixture.debugElement.query(By.css('[data-testid="wf-open"]'));
    expect(btn).not.toBeNull();
    expect(btn.nativeElement.textContent).toContain('Workflows');
    const button = btn.componentInstance as ButtonComponent;
    // Le hub 4.4d pré-filtre sur l'identifiant de table (?entity=<id>, H-5 / D-44-85).
    expect(button.routerLink).toEqual(['/studio', 'workflows']);
    expect(button.queryParams).toEqual({ entity: 'e1' });
  });

  it('masque le bouton Workflows sans studio:design_entities même capacité vraie', () => {
    setup(false, true, 'ready', false, true);
    httpMock.expectOne(`${environment.apiUrl}/studio/records/interventions/schema`).flush({ success: true, data: schema(false), message: null, errors: [] });
    httpMock.expectOne(req => req.url === `${environment.apiUrl}/studio/records/interventions`)
      .flush({ success: true, data: { items: [], totalCount: 0 }, message: null, errors: [] });
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('[data-testid="wf-open"]'))).toBeNull();
  });
});
