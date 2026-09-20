import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { By } from '@angular/platform-browser';
import { environment } from '@environments/environment';
import { StudioRelationsPageComponent } from './studio-relations-page.component';

const API = `${environment.apiUrl}/studio`;

const entity = (id: string, key: string, name: string, kind = 'Standard') => ({
  id, key, displayName: name, displayNamePlural: name, icon: null, description: null,
  isActive: true, fieldCount: 0, createdAt: '', updatedAt: '', kind
});

const m2mForward = {
  kind: 'many_to_many', sourceEntityId: 'e1', sourceEntityKey: 'interventions', sourceLabel: 'Interventions',
  targetEntityId: 'e2', targetEntityKey: 'techniciens', targetLabel: 'Techniciens',
  fieldId: 'f1', fieldKey: 'intervention_id', isRequired: true, isUnique: false,
  junctionEntityId: 'j1', junctionEntityKey: 'intervention_technicien', junctionTargetFieldKey: 'technicien_id'
};
const m2mReverse = { ...m2mForward, sourceEntityId: 'e2', sourceEntityKey: 'techniciens', sourceLabel: 'Techniciens', targetEntityId: 'e1', targetEntityKey: 'interventions', targetLabel: 'Interventions', fieldKey: 'technicien_id', junctionTargetFieldKey: 'intervention_id' };

describe('StudioRelationsPageComponent', () => {
  let fixture: ComponentFixture<StudioRelationsPageComponent>;
  let component: StudioRelationsPageComponent;
  let httpMock: HttpTestingController;

  function setup(entities: unknown[], relationsByEntity: Record<string, unknown[]>): void {
    TestBed.configureTestingModule({
      imports: [StudioRelationsPageComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideNoopAnimations(), provideRouter([])]
    });
    fixture = TestBed.createComponent(StudioRelationsPageComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    httpMock.expectOne(`${API}/entities?includeInactive=false`).flush({ success: true, data: entities, message: null, errors: [] });
    Object.keys(relationsByEntity).forEach(id =>
      httpMock.expectOne(`${API}/entities/${id}/relations`).flush({ success: true, data: relationsByEntity[id], message: null, errors: [] }));
    fixture.detectChanges();
  }

  afterEach(() => httpMock.verify());

  it('charge les relations de chaque table non jonction et les dédoublonne', () => {
    setup([entity('e1', 'interventions', 'Interventions'), entity('e2', 'techniciens', 'Techniciens'), entity('j1', 'intervention_technicien', 'Lien', 'Junction')],
      { e1: [m2mForward], e2: [m2mReverse] });
    expect(component.relations().length).toBe(1);
    expect(component.relations()[0].junctionEntityKey).toBe('intervention_technicien');
    expect(fixture.debugElement.query(By.css('[data-testid="relation-diagram"]'))).not.toBeNull();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Plusieurs-à-plusieurs');
    expect(text.match(/Interventions × Techniciens|Interventions/g)?.length).toBeGreaterThan(0);
  });

  it('filtre par table', () => {
    setup([entity('e1', 'interventions', 'Interventions'), entity('e2', 'techniciens', 'Techniciens'), entity('e3', 'clients', 'Clients')],
      {
        e1: [m2mForward],
        e2: [m2mReverse],
        e3: [{ kind: 'many_to_one', sourceEntityId: 'e3', sourceEntityKey: 'clients', sourceLabel: 'Clients', targetEntityId: 'e1', targetEntityKey: 'interventions', targetLabel: 'Interventions', fieldId: 'f9', fieldKey: 'intervention_id', isRequired: false, isUnique: false }]
      });
    expect(component.relations().length).toBe(2);
    component.filterEntityId.set('e3');
    expect(component.filteredRelations().length).toBe(1);
    expect(component.filteredRelations()[0].kind).toBe('many_to_one');
    component.filterEntityId.set('e1');
    expect(component.filteredRelations().length).toBe(2);
  });

  it('état vide', () => {
    setup([], {});
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('[data-testid="relations-empty"]'))).not.toBeNull();
  });

  it('une 404 sur les relations d\'une table n\'empêche pas le rendu des autres', () => {
    TestBed.configureTestingModule({
      imports: [StudioRelationsPageComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideNoopAnimations(), provideRouter([])]
    });
    fixture = TestBed.createComponent(StudioRelationsPageComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    httpMock.expectOne(`${API}/entities?includeInactive=false`)
      .flush({ success: true, data: [entity('e1', 'interventions', 'Interventions'), entity('e2', 'techniciens', 'Techniciens')], message: null, errors: [] });
    httpMock.expectOne(`${API}/entities/e1/relations`).flush({ success: true, data: [m2mForward], message: null, errors: [] });
    httpMock.expectOne(`${API}/entities/e2/relations`).flush({ success: false, data: null, message: 'NotFound', errors: [] }, { status: 404, statusText: 'Not Found' });
    expect(component.loading()).toBeFalse();
    expect(component.relations().length).toBe(1);
  });
});
