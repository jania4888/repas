import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { CustomField, CustomFieldType } from '@shared/studio-runtime/studio-runtime.models';
import { RECORD_VIEW_LIMITS, RecordViewFilter } from '../views/studio-record-views.models';
import { StudioFilterBuilderComponent, filterValueKind, parseListValue } from './studio-filter-builder.component';

function field(key: string, fieldType: CustomFieldType, extra: Partial<CustomField> = {}): CustomField {
  return {
    id: `id-${key}`, key, label: key.toUpperCase(), fieldType, isRequired: false, isUnique: false,
    sortOrder: 0, rules: null, options: null, relation: null, isActive: true, ...extra
  };
}

const FIELDS: CustomField[] = [
  field('nom', CustomFieldType.Text),
  field('montant', CustomFieldType.Money),
  field('statut', CustomFieldType.Select, { options: [{ value: 'open', label: 'Ouvert' }, { value: 'done', label: 'Terminé' }] }),
  field('actif', CustomFieldType.Boolean),
  field('archive', CustomFieldType.Text, { isActive: false })
];

describe('StudioFilterBuilderComponent', () => {
  let fixture: ComponentFixture<StudioFilterBuilderComponent>;
  let component: StudioFilterBuilderComponent;
  let emitted: RecordViewFilter[][];

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [StudioFilterBuilderComponent] }).compileComponents();
    fixture = TestBed.createComponent(StudioFilterBuilderComponent);
    component = fixture.componentInstance;
    emitted = [];
    fixture.componentRef.setInput('fields', FIELDS);
    component.filters.subscribe(v => emitted.push(v));
    fixture.detectChanges();
  });

  it('affiche l’état vide puis ajoute une ligne sur le premier champ actif avec son premier opérateur', () => {
    expect(fixture.debugElement.query(By.css('.ffb__empty'))).not.toBeNull();

    component.add();
    fixture.detectChanges();

    expect(component.filters()).toEqual([{ fieldKey: 'nom', op: 'eq', value: null }]);
    expect(fixture.debugElement.queryAll(By.css('.ffb__row')).length).toBe(1);
    expect(emitted.length).toBe(1);
  });

  it('ne propose que les champs actifs', () => {
    expect(component.fieldOptions().map(o => o.key)).toEqual(['nom', 'montant', 'statut', 'actif']);
  });

  it('borne le nombre de filtres à RECORD_VIEW_LIMITS.maxFilters et l’indique', () => {
    fixture.componentRef.setInput('filters', Array.from({ length: RECORD_VIEW_LIMITS.maxFilters }, () => ({ fieldKey: 'nom', op: 'eq' as const, value: 'x' })));
    fixture.detectChanges();

    expect(component.canAdd()).toBeFalse();
    component.add();
    expect(component.filters().length).toBe(RECORD_VIEW_LIMITS.maxFilters);
    expect(fixture.debugElement.query(By.css('.ffb__limit'))).not.toBeNull();
  });

  it('changer de champ réinitialise la valeur et rabat l’opérateur sur un opérateur permis', () => {
    fixture.componentRef.setInput('filters', [{ fieldKey: 'nom', op: 'contains', value: 'abc' }]);
    fixture.detectChanges();

    component.setField(0, 'montant');

    // `contains` n'existe pas pour Money ⇒ premier opérateur permis (`eq`), valeur remise à null.
    expect(component.filters()).toEqual([{ fieldKey: 'montant', op: 'eq', value: null }]);
  });

  it('changer d’opérateur conserve la valeur si l’éditeur est identique, la vide sinon', () => {
    fixture.componentRef.setInput('filters', [{ fieldKey: 'montant', op: 'gt', value: 10 }]);
    fixture.detectChanges();

    component.setOp(0, 'lte');
    expect(component.filters()[0]).toEqual({ fieldKey: 'montant', op: 'lte', value: 10 });

    component.setOp(0, 'between');
    expect(component.filters()[0]).toEqual({ fieldKey: 'montant', op: 'between', value: null });

    component.setOp(0, 'is_empty');
    expect(component.filters()[0].value).toBeNull();
  });

  it('« between » produit un 2-uplet typé selon le champ', () => {
    fixture.componentRef.setInput('filters', [{ fieldKey: 'montant', op: 'between', value: null }]);
    fixture.detectChanges();

    component.setRange(0, 0, '5');
    component.setRange(0, 1, '20');

    expect(component.filters()[0].value).toEqual([5, 20]);
    expect(fixture.debugElement.queryAll(By.css('.ffb__value--half')).length).toBe(2);
  });

  it('« in » découpe la saisie en liste bornée à maxInValues', () => {
    fixture.componentRef.setInput('filters', [{ fieldKey: 'statut', op: 'in', value: null }]);
    fixture.detectChanges();

    component.setList(0, ' open, done ,, x ');
    expect(component.filters()[0].value).toEqual(['open', 'done', 'x']);

    const tooMany = Array.from({ length: RECORD_VIEW_LIMITS.maxInValues + 5 }, (_, i) => `v${i}`).join(',');
    expect(parseListValue(tooMany).length).toBe(RECORD_VIEW_LIMITS.maxInValues);
  });

  it('retire une ligne sans toucher aux autres', () => {
    fixture.componentRef.setInput('filters', [
      { fieldKey: 'nom', op: 'eq', value: 'a' },
      { fieldKey: 'actif', op: 'eq', value: true }
    ]);
    fixture.detectChanges();

    component.remove(0);

    expect(component.filters()).toEqual([{ fieldKey: 'actif', op: 'eq', value: true }]);
  });

  it('les opérateurs « vide / non vide » n’affichent aucun éditeur de valeur', () => {
    fixture.componentRef.setInput('filters', [{ fieldKey: 'nom', op: 'is_empty', value: null }]);
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('.ffb__value'))).toBeNull();
  });

  describe('filterValueKind', () => {
    it('déduit l’éditeur du couple type / opérateur', () => {
      expect(filterValueKind(FIELDS[0], 'is_not_empty')).toBe('none');
      expect(filterValueKind(FIELDS[1], 'between')).toBe('range');
      expect(filterValueKind(FIELDS[2], 'in')).toBe('list');
      expect(filterValueKind(FIELDS[2], 'eq')).toBe('option');
      expect(filterValueKind(FIELDS[2], 'contains')).toBe('text');
      expect(filterValueKind(FIELDS[3], 'eq')).toBe('boolean');
      expect(filterValueKind(FIELDS[1], 'gt')).toBe('number');
      expect(filterValueKind(field('d', CustomFieldType.Date), 'lt')).toBe('date');
      expect(filterValueKind(undefined, 'eq')).toBe('text');
    });
  });
});
