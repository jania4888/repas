import {
  MonthlyDeclarationDiagnosticDto,
  MonthlyDeclarationFamily,
  MonthlyDeclarationLineDto,
  RubricDiagnosticKind,
  VatDeclarationDto
} from '../services/accounting.service';
import {
  buildReconciliation,
  countBySeverity,
  defaultComputePeriod,
  describeComputeOutcome,
  describeDiagnostic,
  describeReconciliationGap,
  diagnosticSeverity,
  distinctDiagnostics,
  familyDeclaredAmount,
  formatMillimes,
  groupLinesByFamily,
  isComputablePeriod
} from './monthly-declaration-compute.view-model';

function line(over: Partial<MonthlyDeclarationLineDto> = {}): MonthlyDeclarationLineDto {
  return {
    rubricId: '11111111-1111-1111-1111-111111111111',
    code: 'F1_1',
    label: 'Honoraires',
    family: MonthlyDeclarationFamily.Withholding,
    reportCode: '1.1',
    gross: 0,
    withheld: 0,
    ratePercentApplied: 0,
    requiresManualInput: false,
    diagnostics: [],
    ...over
  };
}

function declaration(over: Partial<VatDeclarationDto> = {}): VatDeclarationDto {
  return {
    year: 2026,
    month: 8,
    collectedVat19: 0,
    collectedVat13: 0,
    collectedVat7: 0,
    deductibleVatGoods: 0,
    deductibleVatAssets: 0,
    previousCredit: 0,
    vatDue: 0,
    creditToCarry: 0,
    currency: 'TND',
    status: 0,
    fodec: 0,
    droitTimbre: 0,
    tcl: 0,
    tfp: 0,
    foprolos: 0,
    withholdingTax: 0,
    acomptes: 0,
    totalToPay: 0,
    version: 1,
    isRectificative: false,
    monthlyDeclarationV2Enabled: true,
    filingDeadline: '2026-09-28T00:00:00Z',
    declarationTypeDisplay: 'Mensuelle',
    collectedVatBreakdown: [],
    deductiblePurchasesTaxableBase: 0,
    salesTaxableBase: 0,
    salesGrossBase: 0,
    ...over
  } as VatDeclarationDto;
}

describe('monthly-declaration-compute.view-model', () => {
  describe('période', () => {
    it("propose le mois écoulé, pas le mois courant qui serait forcément incomplet", () => {
      expect(defaultComputePeriod(new Date(2026, 8, 15))).toEqual({ year: 2026, month: 8 });
    });

    it('recule sur décembre de l’année précédente en janvier', () => {
      expect(defaultComputePeriod(new Date(2026, 0, 3))).toEqual({ year: 2025, month: 12 });
    });

    it('reprend les bornes que le serveur applique', () => {
      expect(isComputablePeriod({ year: 2026, month: 8 })).toBe(true);
      expect(isComputablePeriod({ year: 1999, month: 8 })).toBe(false);
      expect(isComputablePeriod({ year: 2101, month: 8 })).toBe(false);
      expect(isComputablePeriod({ year: 2026, month: 0 })).toBe(false);
      expect(isComputablePeriod({ year: 2026, month: 13 })).toBe(false);
      expect(isComputablePeriod({ year: 2026.5, month: 8 })).toBe(false);
    });
  });

  describe('signalements', () => {
    it('classe en erreur ce qui fausse le montant, en avertissement ce qui le commente', () => {
      expect(diagnosticSeverity(RubricDiagnosticKind.UnknownAccount)).toBe('error');
      expect(diagnosticSeverity(RubricDiagnosticKind.RateRequired)).toBe('error');
      expect(diagnosticSeverity(RubricDiagnosticKind.UnsupportedCombination)).toBe('error');
      expect(diagnosticSeverity(RubricDiagnosticKind.MissingRubricForFamily)).toBe('error');
      expect(diagnosticSeverity(RubricDiagnosticKind.PayrollRunNotUsable)).toBe('warning');
      expect(diagnosticSeverity(RubricDiagnosticKind.UnmappedReportCode)).toBe('warning');
      expect(diagnosticSeverity(RubricDiagnosticKind.SuppressedFromForm)).toBe('warning');
    });

    it('cite le compte fautif dans la phrase', () => {
      const text = describeDiagnostic({ kind: RubricDiagnosticKind.UnknownAccount, detail: '706100' });
      expect(text).toContain('706100');
      expect(text).toContain('plan comptable');
    });

    it("retraduit le nom technique de famille envoyé par le serveur", () => {
      const text = describeDiagnostic({
        kind: RubricDiagnosticKind.MissingRubricForFamily,
        detail: 'Tfp'
      });
      // Le libellé rendu est celui de l'onglet à ouvrir pour corriger, pas le jeton du serveur.
      expect(text).toContain('« T.F.P »');
      expect(text).not.toContain('Tfp');
    });

    it("garde le détail brut si le nom de famille n'est pas reconnu", () => {
      const text = describeDiagnostic({
        kind: RubricDiagnosticKind.MissingRubricForFamily,
        detail: 'FamilleInventee'
      });
      expect(text).toContain('FamilleInventee');
    });

    it('reste lisible quand le serveur ne joint aucun détail', () => {
      for (const kind of [0, 1, 2, 3, 4, 5, 6] as RubricDiagnosticKind[]) {
        const text = describeDiagnostic({ kind, detail: null });
        expect(text.length).toBeGreaterThan(10);
      }
    });

    it('dédoublonne le même signalement répété sur plusieurs rubriques', () => {
      const diagnostics: MonthlyDeclarationDiagnosticDto[] = [
        { kind: RubricDiagnosticKind.UnknownAccount, detail: '706100' },
        { kind: RubricDiagnosticKind.UnknownAccount, detail: '706100' },
        { kind: RubricDiagnosticKind.UnknownAccount, detail: '706200' }
      ];
      expect(distinctDiagnostics(diagnostics).length).toBe(2);
    });

    it('compte par gravité après dédoublonnage', () => {
      const diagnostics: MonthlyDeclarationDiagnosticDto[] = [
        { kind: RubricDiagnosticKind.UnknownAccount, detail: '706100' },
        { kind: RubricDiagnosticKind.UnknownAccount, detail: '706100' },
        { kind: RubricDiagnosticKind.PayrollRunNotUsable, detail: null }
      ];
      expect(countBySeverity(diagnostics, 'error')).toBe(1);
      expect(countBySeverity(diagnostics, 'warning')).toBe(1);
    });

    it('supporte une liste absente', () => {
      expect(distinctDiagnostics(null)).toEqual([]);
      expect(countBySeverity(undefined, 'error')).toBe(0);
    });
  });

  describe('groupement par famille', () => {
    it('totalise le brut et la retenue de chaque famille', () => {
      const groups = groupLinesByFamily([
        line({ code: 'A', gross: 1000, withheld: 100 }),
        line({ code: 'B', gross: 500.5, withheld: 50.25 }),
        line({ code: 'C', family: MonthlyDeclarationFamily.Tfp, gross: 2000, withheld: 20 })
      ]);
      expect(groups.length).toBe(2);
      expect(groups[0].withheldTotal).toBe(150.25);
      expect(groups[0].grossTotal).toBe(1500.5);
      expect(groups[1].family).toBe(MonthlyDeclarationFamily.Tfp);
      expect(groups[1].withheldTotal).toBe(20);
    });

    it('somme au millime sans dérive flottante', () => {
      const groups = groupLinesByFamily([
        line({ withheld: 0.1 }),
        line({ withheld: 0.2 })
      ]);
      expect(groups[0].withheldTotal).toBe(0.3);
    });

    it('remonte la saisie manuelle et les compteurs de signalements', () => {
      const groups = groupLinesByFamily([
        line({ requiresManualInput: true }),
        line({
          diagnostics: [
            { kind: RubricDiagnosticKind.UnknownAccount, detail: '706100' },
            { kind: RubricDiagnosticKind.PayrollRunNotUsable, detail: null }
          ]
        })
      ]);
      expect(groups[0].hasManualInput).toBe(true);
      expect(groups[0].errorCount).toBe(1);
      expect(groups[0].warningCount).toBe(1);
    });

    it('rend une liste vide en calcul historique', () => {
      expect(groupLinesByFamily(undefined)).toEqual([]);
    });
  });

  describe('rapprochement avec la déclaration', () => {
    it('reprend la table de remontée du serveur, famille par famille', () => {
      const d = declaration({
        withholdingTax: 1,
        tfp: 2,
        foprolos: 3,
        consumptionDuty: 4,
        fodec: 6,
        droitTimbre: 7,
        hotelTax: 8,
        tcl: 9,
        licenceFee: 10
      });
      expect(familyDeclaredAmount(d, MonthlyDeclarationFamily.Withholding)).toBe(1);
      expect(familyDeclaredAmount(d, MonthlyDeclarationFamily.Tfp)).toBe(2);
      expect(familyDeclaredAmount(d, MonthlyDeclarationFamily.Foprolos)).toBe(3);
      expect(familyDeclaredAmount(d, MonthlyDeclarationFamily.ConsumptionDuty)).toBe(4);
      expect(familyDeclaredAmount(d, MonthlyDeclarationFamily.OtherTurnoverTaxes)).toBe(6);
      expect(familyDeclaredAmount(d, MonthlyDeclarationFamily.StampDuty)).toBe(7);
      expect(familyDeclaredAmount(d, MonthlyDeclarationFamily.HotelTax)).toBe(8);
      expect(familyDeclaredAmount(d, MonthlyDeclarationFamily.Tcl)).toBe(9);
      expect(familyDeclaredAmount(d, MonthlyDeclarationFamily.LicenceFee)).toBe(10);
    });

    it("n'associe aucune case à la T.V.A ni aux autres renseignements", () => {
      const d = declaration({ vatDue: 500 });
      expect(familyDeclaredAmount(d, MonthlyDeclarationFamily.Vat)).toBeNull();
      expect(familyDeclaredAmount(d, MonthlyDeclarationFamily.OtherInformation)).toBeNull();
    });

    it("mesure l'écart en millimes entre le détail et la case déclarée", () => {
      const d = declaration({
        tfp: 1.0,
        lines: [line({ family: MonthlyDeclarationFamily.Tfp, withheld: 1.234 })]
      });
      const rows = buildReconciliation(d);
      expect(rows.length).toBe(1);
      expect(rows[0].detailTotal).toBe(1.234);
      expect(rows[0].declaredAmount).toBe(1);
      expect(rows[0].gapMillimes).toBe(234);
    });

    it('laisse l’écart indéfini sur une famille qui n’alimente aucune case', () => {
      const d = declaration({
        lines: [line({ family: MonthlyDeclarationFamily.Vat, withheld: 900 })]
      });
      expect(buildReconciliation(d)[0].gapMillimes).toBeNull();
    });

    it("dit qu'un écart est une anomalie : détail et case déclarée sont le même calcul", () => {
      const row = {
        family: MonthlyDeclarationFamily.Tfp,
        label: 'TFP',
        detailTotal: 1.234,
        declaredAmount: 1,
        gapMillimes: 234
      };
      expect(describeReconciliationGap(row)).toContain('le même calcul');
      expect(describeReconciliationGap(row)).toContain('0,234 DT');
    });

    it('ne commente pas un écart nul', () => {
      const row = {
        family: MonthlyDeclarationFamily.Tfp,
        label: 'TFP',
        detailTotal: 1,
        declaredAmount: 1,
        gapMillimes: 0
      };
      expect(describeReconciliationGap(row)).toContain('Identique');
    });
  });

  describe('millimes', () => {
    it('rend les millimes en dinars à trois décimales', () => {
      expect(formatMillimes(0)).toBe('0,000 DT');
      expect(formatMillimes(234)).toBe('0,234 DT');
      expect(formatMillimes(1234)).toBe('1,234 DT');
      expect(formatMillimes(-1234)).toBe('−1,234 DT');
    });
  });

  describe('verdict du calcul', () => {
    it('annonce que les montants affichés seront déclarés', () => {
      expect(describeComputeOutcome(declaration({}))).toContain('seront déclarés');
    });

    it("dit qu'une configuration non initialisée interdit l'enregistrement", () => {
      const text = describeComputeOutcome(
        declaration({
          monthlyDeclarationDiagnostics: [
            { kind: RubricDiagnosticKind.ConfigurationNotInitialized, detail: null }
          ]
        })
      );
      expect(text).toContain("n'est pas encore initialisée");
      expect(text).toContain('ne peut pas être enregistrée');
    });
  });

  describe('familles non déclarées', () => {
    it("dit qu'une famille décochée aurait produit un montant, et qu'il vaut 0", () => {
      const text = describeDiagnostic({
        kind: RubricDiagnosticKind.ExcludedFamilyWithAmount,
        detail: 'Tfp'
      });
      expect(text).toContain('T.F.P');
      expect(text).toContain('vaut 0');
    });

    it('est un avertissement, pas une erreur : le montant reste juste', () => {
      expect(diagnosticSeverity(RubricDiagnosticKind.ExcludedFamilyWithAmount)).toBe('warning');
      expect(diagnosticSeverity(RubricDiagnosticKind.ConfigurationNotInitialized)).toBe('error');
    });
  });
});

describe('monthly-declaration-compute.view-model — double lecture', () => {
  it('traite la double lecture d’une source comme une erreur, avec la phrase du serveur', () => {
    const detail = 'La rubrique F1_1 reprendrait « IRPP retenu par la paie », déjà reprise par la rubrique F1_1B.';

    expect(diagnosticSeverity(RubricDiagnosticKind.DuplicateSourceRead)).toBe('error');
    expect(describeDiagnostic({ kind: RubricDiagnosticKind.DuplicateSourceRead, detail })).toBe(detail);
  });
});
