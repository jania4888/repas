import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { CustomField, CustomFieldType } from '@shared/studio-runtime/studio-runtime.models';
import { AutomationAction, BridgeParamMapping } from '../studio.models';
import { StudioBridgeActionPickerComponent } from './studio-bridge-action-picker.component';

function field(key: string, extra: Partial<CustomField> = {}): CustomField {
  return {
    id: `id-${key}`, key, label: key, fieldType: CustomFieldType.Text, isRequired: false, isUnique: false,
    sortOrder: 0, rules: null, options: null, relation: null, isActive: true, ...extra
  };
}

@Component({
  standalone: true,
  imports: [StudioBridgeActionPickerComponent],
  template: `<app-studio-bridge-action-picker [actions]="actions" [fields]="fields" [allowTemplate]="allowTemplate"
    [(action)]="action" [(mapping)]="mapping" />`
})
class TestHostComponent {
  readonly actions: AutomationAction[] = [{
    name: 'create_invoice',
    description: 'Crée une facture',
    parameters: [
      { name: 'clientId', description: '', required: true },
      { name: 'note', description: '', required: false, allowedValues: ['a', 'b'] }
    ]
  }];
  readonly fields: CustomField[] = [field('client', { label: 'Client' }), field('old', { isActive: false })];
  allowTemplate = false;
  action: string | null = null;
  mapping: BridgeParamMapping[] = [];
}

/** Accès typé aux membres protected du picker (sondage uniquement). */
interface PickerProbe {
  sourceOptions(): ReadonlyArray<{ label: string; value: BridgeParamMapping['source'] }>;
  fieldOptions(): Array<{ label: string; value: string }>;
  setValue(param: string, value: string | null): void;
}

describe('StudioBridgeActionPickerComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let host: TestHostComponent;
  let picker: StudioBridgeActionPickerComponent;
  let probe: PickerProbe;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
      providers: [provideNoopAnimations()]
    }).compileComponents();
    fixture = TestBed.createComponent(TestHostComponent);
    host = fixture.componentInstance;
    picker = fixture.debugElement.query(By.directive(StudioBridgeActionPickerComponent)).componentInstance;
    probe = picker as unknown as PickerProbe;
    fixture.detectChanges();
  });

  it('liste les paramètres de l\'action choisie et émet un mappage sans lignes vides', () => {
    host.action = 'create_invoice';
    fixture.detectChanges();

    const rows = (fixture.nativeElement as HTMLElement).querySelectorAll('[data-testid^="bap-row-"]');
    expect(rows.length).toBe(2);

    probe.setValue('clientId', 'client');
    fixture.detectChanges();

    expect(host.mapping).toEqual([{ param: 'clientId', source: 'field', value: 'client' }]);
    expect(probe.fieldOptions().map(o => o.value)).toEqual(['client']); // champ inactif « old » non proposé
  });

  it('n\'offre la source « template » que si allowTemplate est vrai', () => {
    expect(probe.sourceOptions().map(o => o.value)).toEqual(['field', 'const']);

    host.allowTemplate = true;
    fixture.detectChanges();

    expect(probe.sourceOptions().map(o => o.value)).toEqual(['field', 'const', 'template']);
  });

  it('réinitialise le mappage quand l\'action change', () => {
    host.action = 'create_invoice';
    fixture.detectChanges();
    probe.setValue('clientId', 'client');
    fixture.detectChanges();
    expect(host.mapping.length).toBe(1);

    picker.onActionChange('other');
    fixture.detectChanges();

    expect(host.mapping).toEqual([]);
    expect(host.action).toBe('other');
  });
});
