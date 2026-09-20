import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { MessageService } from 'primeng/api';
import { environment } from '@environments/environment';
import { StudioLinkedRecordsTabComponent } from './studio-linked-records-tab.component';
import { EntityRelationDto } from './studio-relations.models';

const rel: EntityRelationDto = {
  kind: 'many_to_many',
  sourceEntityId: 'e1', sourceEntityKey: 'interventions', sourceLabel: 'Interventions',
  targetEntityId: 'e2', targetEntityKey: 'techniciens', targetLabel: 'Techniciens',
  fieldId: 'f1', fieldKey: 'intervention_id', isRequired: true, isUnique: false,
  junctionEntityId: 'j1', junctionEntityKey: 'intervention_technicien',
  junctionTargetFieldId: 'f2', junctionTargetFieldKey: 'technicien_id'
};

const base = `${environment.apiUrl}/studio/records`;

const junctionPage = (items: unknown[], totalCount: number) => ({
  success: true, data: { items, page: 1, pageSize: 50, totalCount, totalPages: 1 }, message: null, errors: []
});
const junction = (id: string, targetId: string) => ({
  id, data: { intervention_id: 'rec-1', technicien_id: targetId }, createdAt: '2026-01-02T00:00:00Z', updatedAt: '', rowVersion: 'AA'
});
const junctionAttr = (id: string, targetId: string, quantite: number) => ({
  id, data: { intervention_id: 'rec-1', technicien_id: targetId, quantite },
  createdAt: '2026-01-02T00:00:00Z', updatedAt: '', rowVersion: 'AA'
});

/** Schéma de la jonction : les deux liaisons `RelationCustom`, + l'attribut `Number` si demandé. */
const schemaBody = (withAttribute: boolean) => ({
  success: true,
  data: {
    entity: { id: 'j1', key: 'intervention_technicien' },
    fields: [
      { id: 'f1', key: 'intervention_id', label: 'Intervention', fieldType: 'RelationCustom', isRequired: true, isUnique: false, sortOrder: 0, isActive: true },
      { id: 'f2', key: 'technicien_id', label: 'Technicien', fieldType: 'RelationCustom', isRequired: true, isUnique: false, sortOrder: 1, isActive: true },
      ...(withAttribute
        ? [{ id: 'f3', key: 'quantite', label: 'Quantité', fieldType: 'Number', isRequired: false, isUnique: false, sortOrder: 2, isActive: true }]
        : [])
    ],
    form: null
  },
  message: null, errors: []
});

const targets = { success: true, data: { items: [
  { id: 't1', data: { nom: 'Ben Ali' }, createdAt: '', updatedAt: '' },
  { id: 't2', data: { nom: 'Sassi' }, createdAt: '', updatedAt: '' }
], page: 1, pageSize: 20, totalCount: 2, totalPages: 1 }, message: null, errors: [] };

describe('StudioLinkedRecordsTabComponent', () => {
  let fixture: ComponentFixture<StudioLinkedRecordsTabComponent>;
  let component: StudioLinkedRecordsTabComponent;
  let httpMock: HttpTestingController;

  function setup(canWrite: boolean, items: unknown[] = [junction('j1', 't1')], totalCount = 1, withAttribute = false): void {
    TestBed.configureTestingModule({
      imports: [StudioLinkedRecordsTabComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideNoopAnimations(), MessageService]
    });
    fixture = TestBed.createComponent(StudioLinkedRecordsTabComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('relation', rel);
    fixture.componentRef.setInput('recordId', 'rec-1');
    fixture.componentRef.setInput('canWrite', canWrite);
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    httpMock.expectOne(`${base}/intervention_technicien?page=1&pageSize=50&filterField=intervention_id&filterValue=rec-1`)
      .flush(junctionPage(items, totalCount));
    // v1.1 : lecture de l'attribut de liaison via le schéma de la jonction (sans attribut ⇒ rendu v1).
    httpMock.expectOne(`${base}/intervention_technicien/schema`).flush(schemaBody(withAttribute));
    drainTargets(); // options initiales + résolution des libellés (même URL)
    fixture.detectChanges();
  }

  function drainTargets(): void {
    // Options du sélecteur (pageSize=20) et passe de résolution des libellés (pageSize=200).
    httpMock.match(r => r.urlWithParams.startsWith(`${base}/techniciens?page=1`)).forEach(req => {
      if (!req.cancelled) req.flush(targets);
    });
  }

  afterEach(() => httpMock.verify());

  it('charge les liens au montage et résout les libellés cibles', () => {
    setup(true);
    fixture.detectChanges();
    expect(component.rows()).toEqual([{ junctionRecordId: 'j1', targetId: 't1', targetLabel: 'Ben Ali', rowVersion: 'AA', createdAt: '2026-01-02T00:00:00Z' }]);
    const row = fixture.debugElement.query(By.css('[data-testid="linked-row-t1"]'));
    expect(row.nativeElement.textContent).toContain('Ben Ali');
    expect(fixture.debugElement.query(By.css('[data-testid="linked-truncated"]'))).toBeNull();
    // Régression 2.5i : la feuille studio-layout.scss doit être chargée par CE composant
    // (encapsulation émulée) — sinon les lignes « Liés » ne sont pas stylées (libellé et date
    // accolés, sans carte).
    expect(getComputedStyle(row.nativeElement).display).toBe('flex');
  });

  it('masque Ajouter/Retirer sans canWrite', () => {
    setup(false);
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('[data-testid="linked-add"]'))).toBeNull();
    expect(fixture.debugElement.query(By.css('[data-testid="linked-remove"]'))).toBeNull();
    expect(fixture.debugElement.query(By.css('[data-testid="linked-row-t1"]'))).not.toBeNull();
  });

  it('ajout : POST sur la jonction puis rafraîchit ; 409 record.duplicate_link ⇒ message duplicate en ligne, liste inchangée', () => {
    setup(true);
    fixture.detectChanges();

    component.selectedTarget.set('t2');
    component.add();
    const post = httpMock.expectOne(`${base}/intervention_technicien`);
    expect(post.request.method).toBe('POST');
    expect(post.request.body).toEqual({ data: { intervention_id: 'rec-1', technicien_id: 't2' } });
    post.flush({ success: true, data: junction('j2', 't2'), message: null, errors: [] });
    httpMock.expectOne(`${base}/intervention_technicien?page=1&pageSize=50&filterField=intervention_id&filterValue=rec-1`)
      .flush(junctionPage([junction('j1', 't1'), junction('j2', 't2')], 2));
    drainTargets();
    expect(component.rows().length).toBe(2);
    expect(component.error()).toBeNull();

    component.selectedTarget.set('t1');
    component.add();
    httpMock.expectOne(`${base}/intervention_technicien`).flush(
      { success: false, data: null, message: 'Lien déjà existant.', errors: [], code: 'record.duplicate_link' },
      { status: 409, statusText: 'Conflict' });
    expect(component.error()).toBe('Lien déjà existant.');
    expect(component.rows().length).toBe(2);
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('[data-testid="linked-error"]')).nativeElement.textContent).toContain('Lien déjà existant.');
  });

  // ---- v1.1 / D-47-40 : attribut de liaison (affichage, ajout, édition PATCH) ----

  it('affiche la quantité quand la jonction porte un attribut', () => {
    setup(true, [junctionAttr('j1', 't1', 3)], 1, true);
    fixture.detectChanges();
    expect(component.attribute()?.key).toBe('quantite');
    expect(component.rows()[0].attributeValue).toBe(3);
    const value = fixture.debugElement.query(By.css('[data-testid="linked-attr-t1"]'));
    expect(value.nativeElement.textContent).toContain('3');
    expect(fixture.debugElement.query(By.css('[data-testid="linked-attr-input"]'))).not.toBeNull();
    expect(fixture.debugElement.query(By.css('[data-testid="linked-attr-edit-t1"]'))).not.toBeNull();
  });

  it('ajout avec quantité : le POST porte la clé attribut', () => {
    setup(true, [], 0, true);
    component.selectedTarget.set('t2');
    component.newAttributeValue.set(5);
    component.add();
    const post = httpMock.expectOne(`${base}/intervention_technicien`);
    expect(post.request.body).toEqual({ data: { intervention_id: 'rec-1', technicien_id: 't2', quantite: 5 } });
    post.flush({ success: true, data: junctionAttr('j2', 't2', 5), message: null, errors: [] });
    httpMock.expectOne(`${base}/intervention_technicien?page=1&pageSize=50&filterField=intervention_id&filterValue=rec-1`)
      .flush(junctionPage([junctionAttr('j2', 't2', 5)], 1));
    drainTargets();
    expect(component.newAttributeValue()).toBeNull();
    expect(component.rows()[0].attributeValue).toBe(5);
  });

  it('édition inline : PATCH { quantite } avec le rowVersion de la ligne, ligne mise à jour', () => {
    setup(true, [junctionAttr('j1', 't1', 3)], 1, true);
    fixture.detectChanges();
    component.beginAttributeEdit(component.rows()[0]);
    expect(component.editingAttr()).toBe('j1');
    expect(component.editAttrValue()).toBe(3);

    component.editAttrValue.set(7);
    component.saveAttribute(component.rows()[0]);
    const patch = httpMock.expectOne(`${base}/intervention_technicien/j1`);
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({ data: { quantite: 7 }, rowVersion: 'AA' });
    patch.flush({ success: true, data: { ...junctionAttr('j1', 't1', 7), rowVersion: 'BB' }, message: null, errors: [] });

    expect(component.editingAttr()).toBeNull();
    expect(component.rows()[0].attributeValue).toBe(7);
    expect(component.rows()[0].rowVersion).toBe('BB');
  });

  it('édition inline : 409 jeton périmé ⇒ « Modifié entre-temps » en ligne + rechargement', () => {
    setup(true, [junctionAttr('j1', 't1', 3)], 1, true);
    component.beginAttributeEdit(component.rows()[0]);
    component.saveAttribute(component.rows()[0]);
    httpMock.expectOne(`${base}/intervention_technicien/j1`).flush(
      { success: false, data: null, message: 'Conflit', errors: [], code: 'Conflict' },
      { status: 409, statusText: 'Conflict' });

    expect(component.error()).toBe('Modifié entre-temps — liste rechargée.');
    expect(component.editingAttr()).toBeNull();
    httpMock.expectOne(`${base}/intervention_technicien?page=1&pageSize=50&filterField=intervention_id&filterValue=rec-1`)
      .flush(junctionPage([junctionAttr('j1', 't1', 3)], 1));
    drainTargets();
    expect(component.rows()[0].attributeValue).toBe(3);
  });

  it('retrait : DELETE jonction/{id} retire la ligne ; bandeau tronqué si totalCount > pageSize', () => {
    setup(true, [junction('j1', 't1')], 51);
    fixture.detectChanges();
    expect(component.truncated()).toBeTrue();
    expect(fixture.debugElement.query(By.css('[data-testid="linked-truncated"]'))).not.toBeNull();

    component.remove(component.rows()[0]);
    const del = httpMock.expectOne(`${base}/intervention_technicien/j1`);
    expect(del.request.method).toBe('DELETE');
    del.flush(null, { status: 204, statusText: 'No Content' });
    expect(component.rows().length).toBe(0);
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('[data-testid="linked-empty"]'))).not.toBeNull();
  });
});
