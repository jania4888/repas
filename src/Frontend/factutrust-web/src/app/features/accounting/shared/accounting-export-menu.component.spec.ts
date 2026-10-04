import { DOCUMENT } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { AccountingExportMenuComponent } from './accounting-export-menu.component';

describe('AccountingExportMenuComponent', () => {
  let fixture: ComponentFixture<AccountingExportMenuComponent>;
  let component: AccountingExportMenuComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AccountingExportMenuComponent],
      providers: [
        provideNoopAnimations(),
        { provide: DOCUMENT, useValue: document }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(AccountingExportMenuComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders app-button trigger with export label', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-button')).toBeTruthy();
    expect(el.textContent).toContain('Exporter');
  });

  it('emits exportFormat when a menu item is chosen', () => {
    const spy = jasmine.createSpy('exportFormat');
    component.exportFormat.subscribe(spy);
    component.items[0].command?.({} as never);
    expect(spy).toHaveBeenCalledWith('pdf');
    component.items[1].command?.({} as never);
    expect(spy).toHaveBeenCalledWith('excel');
    component.items[2].command?.({} as never);
    expect(spy).toHaveBeenCalledWith('csv');
  });
});
