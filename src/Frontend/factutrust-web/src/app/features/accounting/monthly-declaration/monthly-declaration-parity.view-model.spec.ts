import {
  MonthlyDeclarationFamily,
  MonthlyDeclarationParityMonthDto,
  MonthlyDeclarationParityReportDto,
  ParityVerdict
} from '../services/accounting.service';
import {
  defaultParityRange,
  describeParityReport,
  parityCsv,
  parityFileName,
  parityVerdictLabel,
  parityVerdictTone,
  validateParityRange,
  visibleParityFamilies
} from './monthly-declaration-parity.view-model';

function month(over: Partial<MonthlyDeclarationParityMonthDto> = {}): MonthlyDeclarationParityMonthDto {
  return {
    month: 7,
    savedStatus: null,
    verdict: ParityVerdict.Gap,
    error: null,
    families: [
      { family: MonthlyDeclarationFamily.Tcl, isIncluded: true, legacy: 2.38, configured: 2.38, gap: 0, verdict: ParityVerdict.Exact },
      { family: MonthlyDeclarationFamily.Withholding, isIncluded: true, legacy: 205, configured: 70, gap: -135, verdict: ParityVerdict.Gap },
      { family: MonthlyDeclarationFamily.HotelTax, isIncluded: false, legacy: 0, configured: 0, gap: 0, verdict: ParityVerdict.Exact }
    ],
    boxDifferences: [
      { key: 'Withholding.Total', legacy: '205,000', configured: '70,000', verdict: ParityVerdict.Gap }
    ],
    diagnostics: [],
    ...over
  };
}

function report(over: Partial<MonthlyDeclarationParityReportDto> = {}): MonthlyDeclarationParityReportDto {
  return {
    year: 2026,
    fromMonth: 7,
    toMonth: 7,
    generatedAtUtc: '2026-09-29T10:15:42.123Z',
    generatedBy: 'comptable@cabinet.tn',
    companyName: 'Ma Société; SARL',
    nif: '1234567/A/B/C/000',
    months: [month()],
    exactMonths: 0,
    roundingOnlyMonths: 0,
    monthsWithGap: 1,
    readyForRetirement: false,
    ...over
  };
}

describe('monthly-declaration-parity.view-model', () => {
  it('propose l’année en cours jusqu’au dernier mois échu, l’année écoulée en janvier', () => {
    expect(defaultParityRange(new Date(2026, 8, 29))).toEqual({ year: 2026, fromMonth: 1, toMonth: 8 });
    expect(defaultParityRange(new Date(2027, 0, 5))).toEqual({ year: 2026, fromMonth: 1, toMonth: 12 });
  });

  it('refuse une plage que le serveur refuserait', () => {
    expect(validateParityRange({ year: 2026, fromMonth: 1, toMonth: 12 })).toBeNull();
    expect(validateParityRange({ year: 1999, fromMonth: 1, toMonth: 2 })).not.toBeNull();
    expect(validateParityRange({ year: 2026, fromMonth: 0, toMonth: 2 })).not.toBeNull();
    expect(validateParityRange({ year: 2026, fromMonth: 1, toMonth: 13 })).not.toBeNull();
    expect(validateParityRange({ year: 2026, fromMonth: 8, toMonth: 7 })).not.toBeNull();
  });

  it('libelle et colore les trois verdicts', () => {
    expect(parityVerdictLabel(ParityVerdict.Exact)).toBe('Identique');
    expect(parityVerdictLabel(ParityVerdict.Rounding)).toBe('Arrondi prouvé');
    expect(parityVerdictLabel(ParityVerdict.Gap)).toBe('Écart');
    expect(parityVerdictTone(ParityVerdict.Gap)).toBe('error');
  });

  it('conclut au refus tant qu’un mois porte un écart', () => {
    expect(describeParityReport(report())).toContain('ne peut pas être retiré');
  });

  it('demande d’archiver la preuve quand le retrait est possible', () => {
    const ready = report({ readyForRetirement: true, monthsWithGap: 0, exactMonths: 1 });
    expect(describeParityReport(ready)).toContain('archivez-le');
  });

  it('masque les familles nulles des deux côtés, jamais celles qui diffèrent', () => {
    const shown = visibleParityFamilies(month()).map(f => f.family);
    expect(shown).toEqual([MonthlyDeclarationFamily.Tcl, MonthlyDeclarationFamily.Withholding]);
  });

  it('nomme le fichier de preuve par dossier, plage et horodatage', () => {
    expect(parityFileName(report(), 'json')).toBe('parite-dm_1234567ABC000_2026-07_2026-07_20260929101542.json');
  });

  it('exporte familles et cases en tableur, sans casser les colonnes', () => {
    const text = parityCsv(report());
    const lines = text.split('\n');

    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(lines[0]).toContain('"Ma Société; SARL"');
    expect(lines).toContain('Juillet 2026;Famille;Retenue à la source;Oui;205.000;70.000;-135.000;Écart');
    expect(lines).toContain('Juillet 2026;Case;Withholding.Total;;205,000;70,000;;Écart');
  });

  it('exporte la raison d’un mois non calculé', () => {
    const failed = report({ months: [month({ error: 'Rapport des ventes indisponible', families: [], boxDifferences: [] })] });
    expect(parityCsv(failed)).toContain('Juillet 2026;Erreur;Rapport des ventes indisponible');
  });
});
