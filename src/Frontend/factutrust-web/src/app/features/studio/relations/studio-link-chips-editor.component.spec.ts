import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { MessageService } from 'primeng/api';
import { environment } from '@environments/environment';
import { StudioLinkChipsEditorComponent } from './studio-link-chips-editor.component';
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

const junctionPage = (items: unknown[]) => ({
  success: true, data: { items, page: 1, pageSize: 50, totalCount: items.length, totalPages: 1 }, message: null, errors: []
});
const junction = (id: string, targetId: string, quantite?: number) => ({
  id,
  data: quantite === undefined
    ? { intervention_id: 'rec-1', technicien_id: targetId }
    : { intervention_id: 'rec-1', technicien_id: targetId, quantite },
  createdAt: '2026-01-02T00:00:00Z', updatedAt: '', rowVersion: 'AA'
});
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

describe('StudioLinkChipsEditorComponent (v1.1 / D-47-40, R4)', () => {
  let fixture: ComponentFixture<StudioLinkChipsEditorComponent>;
  let component: StudioLinkChipsEditorComponent;
  let httpMock: HttpTestingController;
  let toast: MessageService;

  function setup(canWrite: boolean, items: unknown[] = [junction('j1', 't1', 3)], withAttribute = true): void {
    TestBed.configureTestingModule({
      imports: [StudioLinkChipsEditorComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideNoopAnimations(), MessageService]
    });
    fixture = TestBed.createComponent(StudioLinkChipsEditorComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('relation', rel);
    fixture.componentRef.setInput('recordId', 'rec-1');
    fixture.componentRef.setInput('canWrite', canWrite);
    httpMock = TestBed.inject(HttpTestingController);
    toast = TestBed.inject(MessageService);
    fixture.detectChanges();
    httpMock.expectOne(`${base}/intervention_technicien?page=1&pageSize=50&filterField=intervention_id&filterValue=rec-1`)
      .flush(junctionPage(items));
    httpMock.expectOne(`${base}/intervention_technicien/schema`).flush(schemaBody(withAttribute));
    drainTargets();
    fixture.detectChanges();
  }

  function drainTargets(): void {
    httpMock.match(r => r.urlWithParams.startsWith(`${base}/techniciens?page=1`)).forEach(req => {
      if (!req.cancelled) req.flush(targets);
    });
  }

  afterEach(() => httpMock.verify());

  it('charge les puces au montage : libellés résolus, quantité affichée', () => {
    setup(true);
    expect(component.rows().length).toBe(1);
    expect(component.rows()[0].targetLabel).toBe('Ben Ali');
    expect(component.rows()[0].attributeValue).toBe(3);
    const chip = fixture.debugElement.query(By.css('[data-testid="chip-t1"]'));
    expect(chip.nativeElement.textContent).toContain('Ben Ali');
    expect(fixture.debugElement.query(By.css('[data-testid="chip-attr-t1"]')).nativeElement.textContent).toContain('3');
  });

  it('ajout : POST jonction avec la quantité puis rafraîchit', () => {
    setup(true);
    component.selectedTarget.set('t2');
    component.newAttributeValue.set(5);
    component.add();
    const post = httpMock.expectOne(`${base}/intervention_technicien`);
    expect(post.request.body).toEqual({ data: { intervention_id: 'rec-1', technicien_id: 't2', quantite: 5 } });
    post.flush({ success: true, data: junction('j2', 't2', 5), message: null, errors: [] });
    httpMock.expectOne(`${base}/intervention_technicien?page=1&pageSize=50&filterField=intervention_id&filterValue=rec-1`)
      .flush(junctionPage([junction('j1', 't1', 3), junction('j2', 't2', 5)]));
    drainTargets();
    expect(component.rows().length).toBe(2);
    expect(component.newAttributeValue()).toBeNull();
  });

  it('ajout d\'un doublon ⇒ 409 « Lien déjà existant. » en ligne, puces inchangées', () => {
    setup(true);
    component.selectedTarget.set('t1');
    component.add();
    httpMock.expectOne(`${base}/intervention_technicien`).flush(
      { success: false, data: null, message: 'Lien déjà existant.', errors: [], code: 'record.duplicate_link' },
      { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();
    expect(component.error()).toBe('Lien déjà existant.');
    expect(component.rows().length).toBe(1);
    expect(fixture.debugElement.query(By.css('[data-testid="chips-error"]')).nativeElement.textContent)
      .toContain('Lien déjà existant.');
  });

  it('retrait : DELETE jonction/{id} retire la puce et toast de succès (hôte de la fiche)', () => {
    setup(true);
    const spy = spyOn(toast, 'add');
    component.remove(component.rows()[0]);
    const del = httpMock.expectOne(`${base}/intervention_technicien/j1`);
    expect(del.request.method).toBe('DELETE');
    del.flush(null, { status: 204, statusText: 'No Content' });
    expect(component.rows().length).toBe(0);
    expect(spy).toHaveBeenCalledWith(jasmine.objectContaining({ severity: 'success' }));
  });

  it('édition de la quantité au clic ⇒ PATCH avec le rowVersion, puce mise à jour', () => {
    setup(true);
    fixture.debugElement.query(By.css('[data-testid="chip-attr-t1"]')).nativeElement.click();
    expect(component.editingAttr()).toBe('j1');
    expect(component.editAttrValue()).toBe(3);

    component.editAttrValue.set(9);
    component.saveAttribute(component.rows()[0]);
    const patch = httpMock.expectOne(`${base}/intervention_technicien/j1`);
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({ data: { quantite: 9 }, rowVersion: 'AA' });
    patch.flush({ success: true, data: { ...junction('j1', 't1', 9), rowVersion: 'BB' }, message: null, errors: [] });
    expect(component.rows()[0].attributeValue).toBe(9);
    expect(component.rows()[0].rowVersion).toBe('BB');
    expect(component.editingAttr()).toBeNull();
  });

  it('PATCH en 409 périmé ⇒ « Modifié entre-temps » en ligne + rechargement', () => {
    setup(true);
    component.beginAttributeEdit(component.rows()[0]);
    component.saveAttribute(component.rows()[0]);
    httpMock.expectOne(`${base}/intervention_technicien/j1`).flush(
      { success: false, data: null, message: 'Conflit', errors: [], code: 'Conflict' },
      { status: 409, statusText: 'Conflict' });
    expect(component.error()).toBe('Modifié entre-temps — liste rechargée.');
    httpMock.expectOne(`${base}/intervention_technicien?page=1&pageSize=50&filterField=intervention_id&filterValue=rec-1`)
      .flush(junctionPage([junction('j1', 't1', 3)]));
    drainTargets();
    expect(component.rows().length).toBe(1);
  });

  it('sans canWrite : puces en lecture seule (pas d\'ajout, ni croix, ni édition)', () => {
    setup(false);
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('[data-testid="chip-add"]'))).toBeNull();
    expect(fixture.debugElement.query(By.css('[data-testid="chip-remove-t1"]'))).toBeNull();
    expect(fixture.debugElement.query(By.css('[data-testid="chip-attr-input"]'))).toBeNull();
    // La quantité reste affichée mais le clic n'ouvre pas l'édition.
    const qty = fixture.debugElement.query(By.css('[data-testid="chip-attr-t1"]'));
    expect(qty).not.toBeNull();
    qty.nativeElement.click();
    expect(component.editingAttr()).toBeNull();
  });

  it('sans attribut sur la jonction : aucune quantité affichée (rendu v1)', () => {
    setup(true, [junction('j1', 't1')], false);
    fixture.detectChanges();
    expect(component.attribute()).toBeNull();
    expect(component.rows()[0].attributeValue).toBeUndefined();
    expect(fixture.debugElement.query(By.css('[data-testid="chip-attr-t1"]'))).toBeNull();
    expect(fixture.debugElement.query(By.css('[data-testid="chip-t1"]')).nativeElement.textContent).not.toContain('·');
  });
});
