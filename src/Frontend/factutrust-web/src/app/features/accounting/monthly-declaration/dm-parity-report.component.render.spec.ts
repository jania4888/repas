import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import {
  AccountingService,
  MonthlyDeclarationFamily,
  MonthlyDeclarationParityReportDto,
  ParityVerdict
} from '../services/accounting.service';
import { DmParityReportComponent } from './dm-parity-report.component';

function report(ready: boolean): MonthlyDeclarationParityReportDto {
  return {
    year: 2026,
    fromMonth: 6,
    toMonth: 7,
    generatedAtUtc: '2026-09-29T10:15:42Z',
    generatedBy: 'comptable@cabinet.tn',
    companyName: 'Ma Société SARL',
    nif: '1234567/A/B/C/000',
    months: [
      {
        month: 6,
        savedStatus: 1,
        verdict: ParityVerdict.Exact,
        families: [
          { family: MonthlyDeclarationFamily.Tcl, isIncluded: true, legacy: 2.38, configured: 2.38, gap: 0, verdict: ParityVerdict.Exact }
        ],
        boxDifferences: [],
        diagnostics: []
      },
      {
        month: 7,
        savedStatus: null,
        verdict: ready ? ParityVerdict.Exact : ParityVerdict.Gap,
        families: [
          {
            family: MonthlyDeclarationFamily.Withholding,
            isIncluded: true,
            legacy: 205,
            configured: ready ? 205 : 70,
            gap: ready ? 0 : -135,
            verdict: ready ? ParityVerdict.Exact : ParityVerdict.Gap
          }
        ],
        boxDifferences: ready
          ? []
          : [{ key: 'Withholding.Total', legacy: '205,000', configured: '70,000', verdict: ParityVerdict.Gap }],
        diagnostics: []
      }
    ],
    exactMonths: ready ? 2 : 1,
    roundingOnlyMonths: 0,
    monthsWithGap: ready ? 0 : 1,
    readyForRetirement: ready
  };
}

describe('DmParityReportComponent render', () => {
  let fixture: ComponentFixture<DmParityReportComponent>;
  let api: { getMonthlyDeclarationParityReport: jasmine.Spy };

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  function runButton(): HTMLButtonElement {
    const buttons = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'));
    return buttons.find(b => (b.textContent ?? '').includes('Lancer le contrôle'))!;
  }

  async function setUp(ready: boolean, disabled = false): Promise<void> {
    api = {
      getMonthlyDeclarationParityReport: jasmine
        .createSpy('getMonthlyDeclarationParityReport')
        .and.returnValue(of({ success: true, data: report(ready) }))
    };

    await TestBed.configureTestingModule({
      imports: [DmParityReportComponent],
      providers: [
        { provide: AccountingService, useValue: api },
        { provide: ErrorHandlerService, useValue: { extractErrorMessage: () => 'Erreur réseau' } }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(DmParityReportComponent);
    fixture.componentInstance.disabled = disabled;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('lance le contrôle sur la plage saisie et montre les écarts ouverts', async () => {
    await setUp(false);
    fixture.componentInstance.year = 2026;
    fixture.componentInstance.fromMonth = 6;
    fixture.componentInstance.toMonth = 7;
    fixture.detectChanges();

    runButton().click();
    fixture.detectChanges();

    expect(api.getMonthlyDeclarationParityReport).toHaveBeenCalledWith(2026, 6, 7);
    expect(text()).toContain('ne peut pas être retiré');
    expect(text()).toContain('Withholding.Total');

    const months = (fixture.nativeElement as HTMLElement).querySelectorAll('details');
    expect(months.length).toBe(2);
    // Un mois sans écart reste replié ; un mois en écart s'ouvre de lui-même.
    expect((months[0] as HTMLDetailsElement).open).toBeFalse();
    expect((months[1] as HTMLDetailsElement).open).toBeTrue();
  });

  it('invite à archiver la preuve quand aucun écart ne subsiste', async () => {
    await setUp(true);

    runButton().click();
    fixture.detectChanges();

    expect(text()).toContain('archivez-le');
    expect(text()).toContain('Exporter la preuve (JSON)');
  });

  it('ne propose pas le contrôle hors du cabinet délégué', async () => {
    await setUp(false, true);

    expect(runButton().disabled).toBeTrue();
  });
});
