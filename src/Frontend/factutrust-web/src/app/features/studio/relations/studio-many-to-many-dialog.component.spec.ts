import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { environment } from '@environments/environment';
import { StudioManyToManyDialogComponent } from './studio-many-to-many-dialog.component';
import { ManyToManyRelationDto } from '../studio.models';
import { CustomEntity } from '../studio.models';

const entity = (id: string, key: string, name: string, kind?: 'Standard' | 'Junction'): CustomEntity => ({
  id, key, displayName: name, displayNamePlural: name, icon: null, description: null,
  isActive: true, fieldCount: 0, createdAt: '', updatedAt: '', kind: kind ?? 'Standard'
});

const source = entity('e1', 'interventions', 'Interventions');
const target = entity('e2', 'techniciens', 'Techniciens');
const junction = entity('j1', 'intervention_technicien', 'Intervention × Technicien', 'Junction');

const API = `${environment.apiUrl}/studio/entities/e1/relations/many-to-many`;

describe('StudioManyToManyDialogComponent', () => {
  let fixture: ComponentFixture<StudioManyToManyDialogComponent>;
  let component: StudioManyToManyDialogComponent;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StudioManyToManyDialogComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideNoopAnimations()]
    }).compileComponents();
    fixture = TestBed.createComponent(StudioManyToManyDialogComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('sourceEntity', source);
    fixture.componentRef.setInput('entities', [source, target, junction]);
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => httpMock.verify());

  it('exclut la source et les jonctions des cibles ; clé par défaut {source}_{cible}', () => {
    expect(component.targetOptions().map(o => o.label)).toEqual(['Techniciens']);
    expect(component.canSubmit()).toBeFalse();

    component.targetEntityId.set('e2');
    expect(component.defaultJunctionKey()).toBe('interventions_techniciens');
    expect(component.canSubmit()).toBeTrue();
  });

  it('ne préfixe jamais la clé par défaut de « v_ » (D-46-F04 : convention serveur {a}_{b} sans préfixe)', () => {
    component.targetEntityId.set('e2');
    const key = component.defaultJunctionKey();
    expect(key.startsWith('v_')).toBeFalse();
    expect(key).toBe('interventions_techniciens');
  });

  it('POST relations/many-to-many avec targetEntityId et champs optionnels nettoyés ; succès ⇒ émet created et ferme', () => {
    component.visible.set(true);
    component.targetEntityId.set('e2');
    component.label.set('  ');
    component.junctionKey.set('');
    let emitted = false;
    component.created.subscribe(() => emitted = true);

    component.submit();
    const req = httpMock.expectOne(API);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ targetEntityId: 'e2', label: null, junctionKey: null, junctionDisplayName: null, junctionAttributeLabel: null });
    req.flush({ success: true, data: { junction, sourceField: {}, targetField: {} }, message: null, errors: [] });
    expect(emitted).toBeTrue();
    expect(component.visible()).toBeFalse();
  });

  it('409 ⇒ duplicateKey en ligne ; 400 ⇒ message serveur', () => {
    component.targetEntityId.set('e2');

    component.submit();
    httpMock.expectOne(API).flush({ success: false, data: null, message: 'Conflict', errors: [] }, { status: 409, statusText: 'Conflict' });
    expect(component.error()).toBe('Une table de liaison porte déjà cette clé.');
    expect(component.saving()).toBeFalse();

    component.submit();
    httpMock.expectOne(API).flush(
      { success: false, data: null, message: 'Une table ne peut pas être reliée à elle-même.', errors: [] },
      { status: 400, statusText: 'Bad Request' });
    expect(component.error()).toBe('Une table ne peut pas être reliée à elle-même.');
  });

  it('attribut vide ⇒ junctionAttributeLabel null (comportement v1 inchangé)', () => {
    component.targetEntityId.set('e2');
    component.junctionAttribute.set('   ');
    component.submit();
    const req = httpMock.expectOne(API);
    expect(req.request.body.junctionAttributeLabel).toBeNull();
    req.flush({ success: true, data: { junction, sourceField: {}, targetField: {}, attributeField: null }, message: null, errors: [] });
  });

  it('attribut saisi ⇒ envoyé trimmé ; succès ⇒ attributeField propagé à created', () => {
    component.targetEntityId.set('e2');
    component.junctionAttribute.set('  Quantité  ');
    let dto: ManyToManyRelationDto | undefined;
    component.created.subscribe(d => dto = d);

    component.submit();
    const req = httpMock.expectOne(API);
    expect(req.request.body.junctionAttributeLabel).toBe('Quantité');
    const attributeField = { id: 'f-q', key: 'quantit', label: 'Quantité', fieldType: 2 };
    req.flush({ success: true, data: { junction, sourceField: {}, targetField: {}, attributeField }, message: null, errors: [] });
    expect(dto?.attributeField?.key).toBe('quantit');
  });

  it("le bloc « Bientôt » n'est plus rendu — l'attribut est un input actif", () => {
    // Le contenu du p-dialog n'est rendu (dans le body) que lorsque le dialogue est visible.
    component.visible.set(true);
    fixture.detectChanges();
    const input = document.querySelector('[data-testid="m2m-attribute"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.disabled).toBeFalse();
    expect(input.placeholder).toBe('Quantité');
    expect(document.querySelector('.p-dialog')?.textContent).not.toContain('Bientôt');
  });

  it('clé de jonction invalide ⇒ submit bloqué', () => {
    component.targetEntityId.set('e2');
    component.junctionKey.set('1bad');
    expect(component.junctionKeyValid()).toBeFalse();
    expect(component.canSubmit()).toBeFalse();
    component.junctionKey.set('ma_cle');
    expect(component.canSubmit()).toBeTrue();
  });
});
