import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { CdkDragDrop } from '@angular/cdk/drag-drop';
import { environment } from '@environments/environment';
import { MessageService } from 'primeng/api';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { StudioKanbanBoardComponent } from './studio-kanban-board.component';
import { RecordViewKanban, RecordViewKanbanGroupDto } from './studio-record-views.models';
import { CustomField, CustomRecord } from '../studio.models';

const kanban: RecordViewKanban = {
  groupByFieldKey: 'statut',
  titleFieldKey: 'nom',
  cardFieldKeys: ['montant'],
  showEmptyGroup: true
};

const fields: CustomField[] = [
  { id: 'f1', key: 'statut', label: 'Statut', fieldType: 7, isRequired: false, isUnique: false, sortOrder: 0, rules: null, options: [{ value: 'a', label: 'À planifier' }, { value: 'b', label: 'Terminé' }], relation: null, isActive: true },
  { id: 'f2', key: 'nom', label: 'Nom', fieldType: 0, isRequired: false, isUnique: false, sortOrder: 1, rules: null, options: null, relation: null, isActive: true },
  { id: 'f3', key: 'montant', label: 'Montant', fieldType: 2, isRequired: false, isUnique: false, sortOrder: 2, rules: null, options: null, relation: null, isActive: true }
];

function record(id: string, nom: string, statut: string, rowVersion = 'R1'): CustomRecord {
  return { id, data: { nom, statut, montant: 10 }, createdAt: '2026-01-01', updatedAt: '2026-01-01', rowVersion };
}

function groups(): RecordViewKanbanGroupDto[] {
  return [
    { value: 'a', label: 'À planifier', count: 1, items: [record('r1', 'Fiche 1', 'a')] },
    { value: 'b', label: 'Terminé', count: 0, items: [] },
    { value: null, label: 'Sans valeur', count: 0, items: [] }
  ];
}

describe('StudioKanbanBoardComponent', () => {
  let fixture: ComponentFixture<StudioKanbanBoardComponent>;
  let component: StudioKanbanBoardComponent;
  let httpMock: HttpTestingController;

  function setup(canWrite: boolean): void {
    TestBed.configureTestingModule({
      imports: [StudioKanbanBoardComponent, HttpClientTestingModule],
      providers: [
        MessageService,
        provideNoopAnimations(),
        { provide: AuthService, useValue: { hasPermission: (p: string) => p === PERMISSIONS.customData.recordsWrite ? canWrite : false } }
      ]
    });
    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(StudioKanbanBoardComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('entityKey', 'interventions');
    fixture.componentRef.setInput('kanban', kanban);
    fixture.componentRef.setInput('groups', groups());
    fixture.componentRef.setInput('allFields', fields);
    fixture.componentRef.setInput('truncated', false);
    fixture.detectChanges();
  }

  afterEach(() => httpMock?.verify());

  it('affiche les colonnes reçues avec « Sans valeur » pour value=null', () => {
    setup(true);
    const titles = fixture.debugElement.queryAll(By.css('.kanban-col__title')).map(e => e.nativeElement.textContent.trim());
    expect(titles).toEqual(['À planifier', 'Terminé', 'Sans valeur']);
  });

  it("affiche la bannière de troncature quand truncated=true", () => {
    setup(true);
    fixture.componentRef.setInput('truncated', true);
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('.runner-banner'))).toBeTruthy();
  });

  it('désactive le glisser-déposer sans la permission custom_records:write', () => {
    setup(false);
    const dropLists = fixture.debugElement.queryAll(By.css('.kanban-col__body'));
    expect(component['canDragDrop']()).toBe(false);
    expect(fixture.debugElement.query(By.css('.kcard__menu'))).toBeFalsy();
  });

  it('déplace une fiche : appelle patchRecord avec le champ de regroupement et le rowVersion', () => {
    setup(true);
    component['moveCard'](record('r1', 'Fiche 1', 'a'), 'a', 'b');
    const req = httpMock.expectOne(`${environment.apiUrl}/studio/records/interventions/r1`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ data: { statut: 'b' }, rowVersion: 'R1' });
    req.flush({ success: true, data: record('r1', 'Fiche 1', 'b', 'R2'), message: null, errors: [] });
  });

  it('conflit 409 : la fiche revient dans sa colonne d’origine et `reload` est émis', () => {
    setup(true);
    let reloaded = false;
    component.reload.subscribe(() => reloaded = true);
    component['moveCard'](record('r1', 'Fiche 1', 'a'), 'a', 'b');
    const req = httpMock.expectOne(`${environment.apiUrl}/studio/records/interventions/r1`);
    req.flush({ message: 'conflict' }, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();
    expect(reloaded).toBe(true);
    const groupA = fixture.debugElement.queryAll(By.css('.kanban-col'))[0];
    expect(groupA.nativeElement.textContent).toContain('Fiche 1');
  });

  it('erreur générique (hors 409) : rollback sans émettre `reload`', () => {
    setup(true);
    let reloaded = false;
    component.reload.subscribe(() => reloaded = true);
    component['moveCard'](record('r1', 'Fiche 1', 'a'), 'a', 'b');
    const req = httpMock.expectOne(`${environment.apiUrl}/studio/records/interventions/r1`);
    req.flush({ message: 'boom' }, { status: 500, statusText: 'Server Error' });
    expect(reloaded).toBe(false);
  });

  it('deux déplacements en vol : l’échec du premier ne restaure que sa propre fiche', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [StudioKanbanBoardComponent, HttpClientTestingModule],
      providers: [
        MessageService,
        provideNoopAnimations(),
        { provide: AuthService, useValue: { hasPermission: () => true } }
      ]
    });
    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(StudioKanbanBoardComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('entityKey', 'interventions');
    fixture.componentRef.setInput('kanban', kanban);
    fixture.componentRef.setInput('groups', [
      { value: 'a', label: 'À planifier', count: 2, items: [record('r1', 'Fiche 1', 'a'), record('r2', 'Fiche 2', 'a')] },
      { value: 'b', label: 'Terminé', count: 0, items: [] },
      { value: null, label: 'Sans valeur', count: 0, items: [] }
    ]);
    fixture.componentRef.setInput('allFields', fields);
    fixture.detectChanges();

    // Deux déplacements rapides a → b, le premier PATCH échoue (500) pendant que le second est en vol.
    component['moveCard'](record('r1', 'Fiche 1', 'a'), 'a', 'b');
    component['moveCard'](record('r2', 'Fiche 2', 'a'), 'a', 'b');
    httpMock.expectOne(`${environment.apiUrl}/studio/records/interventions/r1`)
      .flush({ message: 'boom' }, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    let text = fixture.debugElement.queryAll(By.css('.kanban-col')).map(c => c.nativeElement.textContent);
    expect(text[0]).toContain('Fiche 1');   // r1 restaurée dans « À planifier »
    expect(text[0]).not.toContain('Fiche 2'); // r2 reste dans « Terminé » (move B intact)
    expect(text[1]).toContain('Fiche 2');

    // Le second déplacement aboutit ensuite normalement.
    httpMock.expectOne(`${environment.apiUrl}/studio/records/interventions/r2`)
      .flush({ success: true, data: record('r2', 'Fiche 2', 'b', 'R2'), message: null, errors: [] });
    fixture.detectChanges();
    text = fixture.debugElement.queryAll(By.css('.kanban-col')).map(c => c.nativeElement.textContent);
    expect(text[1]).toContain('Fiche 2');
    expect(text[0]).toContain('Fiche 1');
  });

  it('le menu « Déplacer vers… » déclenche le même PATCH que le glisser-déposer', () => {
    setup(true);
    component.openMoveMenu(new Event('click'), record('r1', 'Fiche 1', 'a'), 'a');
    const items = component['moveMenuItems']();
    const target = items.find(i => i.label === 'Terminé');
    target?.command?.({} as any);
    const req = httpMock.expectOne(`${environment.apiUrl}/studio/records/interventions/r1`);
    expect(req.request.body).toEqual({ data: { statut: 'b' }, rowVersion: 'R1' });
    req.flush({ success: true, data: record('r1', 'Fiche 1', 'b', 'R2'), message: null, errors: [] });
  });

  it('met à jour le message aria-live lors d’un déplacement', () => {
    setup(true);
    component['moveCard'](record('r1', 'Fiche 1', 'a'), 'a', 'b');
    expect(component['liveMessage']()).toContain('Terminé');
    const req = httpMock.expectOne(`${environment.apiUrl}/studio/records/interventions/r1`);
    req.flush({ success: true, data: record('r1', 'Fiche 1', 'b', 'R2'), message: null, errors: [] });
  });

  it('drop vers une autre colonne déclenche le PATCH optimiste', () => {
    setup(true);
    const rec = component['localGroups']()[0].items[0];
    const event = {
      previousContainer: { data: [rec] },
      container: { data: [] },
      item: { data: rec },
      previousIndex: 0,
      currentIndex: 0
    } as unknown as CdkDragDrop<CustomRecord[]>;
    component.drop(event, 'b');
    const req = httpMock.expectOne(`${environment.apiUrl}/studio/records/interventions/r1`);
    expect(req.request.body).toEqual({ data: { statut: 'b' }, rowVersion: 'R1' });
    req.flush({ success: true, data: record('r1', 'Fiche 1', 'b', 'R2'), message: null, errors: [] });
    expect(component['localGroups']()[1].items.map(i => i.id)).toContain('r1');
  });

  it('drop dans la même colonne réordonne sans appel réseau', () => {
    setup(true);
    const rec = component['localGroups']()[0].items[0];
    const sameList = { data: [rec] };
    const event = {
      previousContainer: sameList,
      container: sameList,
      item: { data: rec },
      previousIndex: 0,
      currentIndex: 0
    } as unknown as CdkDragDrop<CustomRecord[]>;
    component.drop(event, 'a');
    httpMock.expectNone(`${environment.apiUrl}/studio/records/interventions/r1`);
  });

  it('révélation progressive : 25 cartes puis « Afficher plus » en dévoile 25 de plus', () => {
    setup(true);
    const many: CustomRecord[] = [];
    for (let i = 0; i < 30; i++) many.push(record(`r${i}`, `Fiche ${i}`, 'a'));
    fixture.componentRef.setInput('groups', [
      { value: 'a', label: 'À planifier', count: 30, items: many },
      { value: 'b', label: 'Terminé', count: 0, items: [] }
    ]);
    fixture.detectChanges();

    expect(component['columns']()[0].visibleItems.length).toBe(25);
    expect(component['columns']()[0].remaining).toBe(5);

    component.showMore('a');
    fixture.detectChanges();
    expect(component['columns']()[0].visibleItems.length).toBe(30);
    expect(component['columns']()[0].remaining).toBe(0);
  });
});
