import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MessageService } from 'primeng/api';
import { environment } from '@environments/environment';
import { StudioAutomationsComponent } from './studio-automations.component';
import { Automation, AutomationAction, AutomationTrigger } from './studio.models';

const API = `${environment.apiUrl}/studio`;

const ACTIONS: AutomationAction[] = [{
  name: 'create_invoice',
  description: 'Crée une facture',
  parameters: [
    { name: 'clientId', description: 'Client', required: true },
    { name: 'note', description: 'Note', required: false, allowedValues: ['a', 'b'] }
  ]
}];

const A1: Automation = {
  id: 'a1', name: 'Facturation', trigger: AutomationTrigger.OnCreate, actionKey: 'create_invoice',
  mapping: [{ param: 'clientId', source: 'field', value: 'client' }], runOnce: true, isActive: true
};

describe('StudioAutomationsComponent', () => {
  let fixture: ComponentFixture<StudioAutomationsComponent>;
  let component: StudioAutomationsComponent;
  let httpMock: HttpTestingController;

  function setup(automations: Automation[] = []): void {
    TestBed.configureTestingModule({
      imports: [StudioAutomationsComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideNoopAnimations(),
        MessageService,
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'e1' }) } } }
      ]
    });
    fixture = TestBed.createComponent(StudioAutomationsComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();

    httpMock.expectOne(`${API}/entities/e1`)
      .flush({ success: true, data: { id: 'e1', key: 'factures', displayName: 'Factures' }, message: null, errors: [] });
    const fieldsReq = httpMock.expectOne(r => r.url === `${API}/entities/e1/fields`);
    expect(fieldsReq.request.params.get('includeInactive')).toBe('false');
    fieldsReq.flush({
      success: true,
      data: [{ id: 'f1', key: 'client', label: 'Client', fieldType: 0, isRequired: false, isUnique: false, sortOrder: 0, rules: null, options: null, relation: null, isActive: true }],
      message: null, errors: []
    });
    httpMock.expectOne(`${API}/automations/actions`)
      .flush({ success: true, data: ACTIONS, message: null, errors: [] });
    httpMock.expectOne(`${API}/entities/e1/automations`)
      .flush({ success: true, data: automations, message: null, errors: [] });
    fixture.detectChanges();
  }

  afterEach(() => httpMock.verify());

  it('charge la table, les champs, les actions et les automations à l\'ouverture', () => {
    setup([A1]);

    expect(component.entity()?.displayName).toBe('Factures');
    expect(component.fields().map(f => f.key)).toEqual(['client']);
    expect(component.actions().map(a => a.name)).toEqual(['create_invoice']);
    expect(component.automations().map(a => a.id)).toEqual(['a1']);
  });

  it('ouvre une automation existante et renvoie le même mappage au PUT (non-régression)', () => {
    setup([A1]);

    component.openEdit(A1);
    fixture.detectChanges();
    component.save();

    const req = httpMock.expectOne(`${API}/entities/e1/automations/a1`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body.actionKey).toBe('create_invoice');
    expect(req.request.body.mapping).toEqual([{ param: 'clientId', source: 'field', value: 'client' }]);
    req.flush({ success: true, data: A1, message: null, errors: [] });

    httpMock.expectOne(`${API}/entities/e1/automations`)
      .flush({ success: true, data: [A1], message: null, errors: [] });
  });
});
