import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LOCALE_ID } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeFrTN from '@angular/common/locales/fr-TN';
import localeFrTNExtra from '@angular/common/locales/extra/fr-TN';
import { BalanceIndicatorComponent } from './balance-indicator.component';

// main.ts n'est pas chargé sous Karma : sans cet enregistrement, le pipe `number` n'a pas les
// données fr-TN et les assertions porteraient sur un formatage anglo-saxon.
registerLocaleData(localeFrTN, 'fr-TN', localeFrTNExtra);

describe('BalanceIndicatorComponent', () => {
  let fixture: ComponentFixture<BalanceIndicatorComponent>;

  function create(debit: number, credit: number, canAutoBalance = false): void {
    fixture = TestBed.createComponent(BalanceIndicatorComponent);
    fixture.componentRef.setInput('totalDebit', debit);
    fixture.componentRef.setInput('totalCredit', credit);
    fixture.componentRef.setInput('canAutoBalance', canAutoBalance);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BalanceIndicatorComponent],
      providers: [{ provide: LOCALE_ID, useValue: 'fr-TN' }]
    }).compileComponents();
  });

  it('shows neutral empty state when totals are zero', () => {
    create(0, 0);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Saisissez vos lignes');
    expect(el.querySelector('.me-empty')).toBeTruthy();
    expect(el.querySelector('.me-unbalanced')).toBeFalsy();
  });

  it('shows unbalanced state with gap', () => {
    create(100, 50);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Écart');
    expect(el.querySelector('.me-unbalanced')).toBeTruthy();
  });

  it('shows balanced state when debit equals credit and positive', () => {
    create(100, 100);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Écriture équilibrée');
    expect(el.querySelector('.me-balanced')).toBeTruthy();
  });

  it('shows the neutral balanced label without the save hint when requested', () => {
    fixture = TestBed.createComponent(BalanceIndicatorComponent);
    fixture.componentRef.setInput('totalDebit', 100);
    fixture.componentRef.setInput('totalCredit', 100);
    fixture.componentRef.setInput('neutralBalancedLabel', true);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Écriture équilibrée');
    expect(el.textContent).not.toContain('vous pouvez enregistrer');
    expect(el.querySelector('.me-balanced')).toBeTruthy();
  });

  it('keeps the save hint by default', () => {
    create(100, 100);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('vous pouvez enregistrer');
  });

  it('shows auto-balance button when enabled', () => {
    create(100, 50, true);
    const btn = fixture.nativeElement.querySelector('.me-auto-balance-btn');
    expect(btn).toBeTruthy();
  });

  /**
   * L'écart s'apprécie sur les montants SAISIS. L'afficher en dinar donnait un nombre qui
   * n'existait dans aucune des deux devises : « 600,000 TND » pour un écart de 600,00 EUR.
   */
  describe('devise de l’écart', () => {
    function createWithCurrency(debit: number, credit: number, code: string, format: string): void {
      fixture = TestBed.createComponent(BalanceIndicatorComponent);
      fixture.componentRef.setInput('totalDebit', debit);
      fixture.componentRef.setInput('totalCredit', credit);
      fixture.componentRef.setInput('currencyCode', code);
      fixture.componentRef.setInput('amountFormat', format);
      fixture.detectChanges();
    }

    function text(): string {
      return (fixture.nativeElement as HTMLElement).textContent ?? '';
    }

    it('reste en dinar au millime quand aucune devise n’est passée', () => {
      // Non-régression mono-devise : les appelants qui ignorent les nouvelles entrées.
      create(100, 50);

      expect(text()).toContain('TND');
      expect(text()).toContain('50,000');
    });

    it('porte la devise de saisie et ses décimales', () => {
      // Le cas du ticket : 1 000 EUR au débit, 400 au crédit.
      createWithCurrency(1000, 400, 'EUR', '1.2-2');

      expect(text()).toContain('600,00');
      expect(text()).toContain('EUR');
      expect(text()).not.toContain('TND');
      expect(text()).not.toContain('600,000');
    });
  });
});
