import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { By } from '@angular/platform-browser';
import { MessageService } from 'primeng/api';
import { environment } from '@environments/environment';
import { StudioEntityListComponent } from './studio-entity-list.component';

const entity = (id: string, key: string, name: string, kind = 'Standard') => ({
  id, key, displayName: name, displayNamePlural: name, icon: null, description: null,
  isActive: true, fieldCount: 1, createdAt: '', updatedAt: '', kind
});

const list = [
  entity('e1', 'interventions', 'Interventions'),
  entity('j1', 'intervention_technicien', 'Intervention × Technicien', 'Junction'),
  entity('e2', 'techniciens', 'Techniciens')
];

describe('StudioEntityListComponent — jonctions (2.5g2)', () => {
  let fixture: ComponentFixture<StudioEntityListComponent>;
  let component: StudioEntityListComponent;
  let httpMock: HttpTestingController;

  function setup(entities: unknown[]): void {
    TestBed.configureTestingModule({
      imports: [StudioEntityListComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideNoopAnimations(), provideRouter([]), MessageService]
    });
    fixture = TestBed.createComponent(StudioEntityListComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    httpMock.expectOne(`${environment.apiUrl}/studio/entities?includeInactive=true`)
      .flush({ success: true, data: entities, message: null, errors: [] });
    fixture.detectChanges();
  }

  afterEach(() => httpMock.verify());

  it('masque les jonctions par défaut', () => {
    setup(list);
    expect(component.hideJunctions()).toBeTrue();
    expect(component.visibleEntities().map(e => e.id)).toEqual(['e1', 'e2']);
    expect(fixture.debugElement.query(By.css('[data-testid="junction-badge"]'))).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Interventions');
    expect(fixture.nativeElement.textContent).not.toContain('Lien —');
  });

  it('la case affiche les jonctions avec le badge Jonction', () => {
    setup(list);
    component.hideJunctions.set(false);
    fixture.detectChanges();
    expect(component.visibleEntities().length).toBe(3);
    const badge = fixture.debugElement.query(By.css('[data-testid="junction-badge"]'));
    expect(badge.nativeElement.textContent).toContain('Jonction');
    expect(fixture.debugElement.query(By.css('[data-testid="hide-junctions"]'))).not.toBeNull();
  });

  it('l\'état vide dépend de la liste complète (jonctions seules ≠ liste vide)', () => {
    setup([entity('j1', 'intervention_technicien', 'Lien', 'Junction')]);
    // `entities()` non vide ⇒ pas d'empty-state même si la vue filtrée est vide.
    expect(fixture.debugElement.query(By.css('app-empty-state'))).toBeNull();
    expect(component.visibleEntities().length).toBe(0);
  });
});
