import {
  MonthlyDeclarationDiagnosticDto,
  MonthlyDeclarationFamily,
  MonthlyDeclarationLineDto,
  MonthlyDeclarationMode,
  MonthlyDeclarationSettingsDto,
  RubricDiagnosticKind,
  VatDeclarationDto
} from '../services/accounting.service';
import {
  DM_MAX_OVERRIDE_REASON_LENGTH,
  DM_MODE_OPTIONS,
  DmModeForm,
  buildReconciliation,
  countBySeverity,
  defaultComputePeriod,
  describeComputeOutcome,
  describeDiagnostic,
  describeRamp,
  describeReconciliationGap,
  diagnosticSeverity,
  distinctDiagnostics,
  familyDeclaredAmount,
  firstDayOfNextMonth,
  formatMillimes,
  groupLinesByFamily,
  isCleanParityRun,
  isComputablePeriod,
  needsOverrideReason,
  newModeForm,
  toModeRequest,
  validateModeForm
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

function settings(over: Partial<MonthlyDeclarationSettingsDto> = {}): MonthlyDeclarationSettingsDto {
  return {
    mode: MonthlyDeclarationMode.Parity,
    configuredSince: null,
    lastParityRunAt: null,
    lastParityMaxGapMillimes: 0,
    parityCleanStreak: 0,
    requiredCleanParityPeriods: 3,
    canSwitchToConfigured: false,
    parityOverrideBy: null,
    parityOverrideReason: null,
    configurableLinesEnabled: true,
    ...over
  } as MonthlyDeclarationSettingsDto;
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

    it("dit que l'écart est l'objet de la mesure en parité, et une anomalie en paramétré", () => {
      const row = {
        family: MonthlyDeclarationFamily.Tfp,
        label: 'TFP',
        detailTotal: 1.234,
        declaredAmount: 1,
        gapMillimes: 234
      };
      expect(describeReconciliationGap(row, MonthlyDeclarationMode.Parity)).toContain(
        'calcul historique'
      );
      expect(describeReconciliationGap(row, MonthlyDeclarationMode.Configured)).toContain(
        'le même calcul'
      );
    });

    it('ne commente pas un écart nul', () => {
      const row = {
        family: MonthlyDeclarationFamily.Tfp,
        label: 'TFP',
        detailTotal: 1,
        declaredAmount: 1,
        gapMillimes: 0
      };
      expect(describeReconciliationGap(row, MonthlyDeclarationMode.Parity)).toContain('Identique');
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
    it('dit que rien n’a bougé en calcul historique', () => {
      const text = describeComputeOutcome(
        declaration({ monthlyDeclarationMode: MonthlyDeclarationMode.Legacy })
      );
      expect(text).toContain("à l'ancienne");
    });

    it('distingue une parité sans écart d’une parité qui en montre un', () => {
      const clean = describeComputeOutcome(
        declaration({
          monthlyDeclarationMode: MonthlyDeclarationMode.Parity,
          parityMaxGapMillimes: 0
        })
      );
      const dirty = describeComputeOutcome(
        declaration({
          monthlyDeclarationMode: MonthlyDeclarationMode.Parity,
          parityMaxGapMillimes: 1234
        })
      );
      expect(clean).toContain('sans écart');
      expect(dirty).toContain('1,234 DT');
      expect(dirty).toContain('restent ceux du calcul historique');
    });

    it('annonce que les montants seront déclarés en mode paramétré', () => {
      const text = describeComputeOutcome(
        declaration({ monthlyDeclarationMode: MonthlyDeclarationMode.Configured })
      );
      expect(text).toContain('seront déclarés');
    });

    it("ne retient comme contrôle probant qu'une parité sans écart", () => {
      expect(
        isCleanParityRun(
          declaration({
            monthlyDeclarationMode: MonthlyDeclarationMode.Parity,
            parityMaxGapMillimes: 0
          })
        )
      ).toBe(true);
      expect(
        isCleanParityRun(
          declaration({
            monthlyDeclarationMode: MonthlyDeclarationMode.Parity,
            parityMaxGapMillimes: 1
          })
        )
      ).toBe(false);
      expect(
        isCleanParityRun(
          declaration({
            monthlyDeclarationMode: MonthlyDeclarationMode.Configured,
            parityMaxGapMillimes: 0
          })
        )
      ).toBe(false);
    });
  });

  describe('changement de régime', () => {
    it('propose les trois régimes', () => {
      expect(DM_MODE_OPTIONS.map(o => o.value)).toEqual([
        MonthlyDeclarationMode.Legacy,
        MonthlyDeclarationMode.Parity,
        MonthlyDeclarationMode.Configured
      ]);
    });

    it("propose le premier du mois suivant comme date d'effet", () => {
      expect(firstDayOfNextMonth(new Date(2026, 8, 15))).toBe('2026-10-01');
      expect(firstDayOfNextMonth(new Date(2026, 11, 3))).toBe('2027-01-01');
    });

    it('reprend la date d’effet déjà enregistrée si le dossier en a une', () => {
      const form = newModeForm(
        settings({
          mode: MonthlyDeclarationMode.Configured,
          configuredSince: '2026-07-01T00:00:00Z'
        }),
        new Date(2026, 8, 15)
      );
      expect(form.configuredSince).toBe('2026-07-01');
    });

    it('refuse la bascule directe depuis le calcul historique', () => {
      const form: DmModeForm = {
        mode: MonthlyDeclarationMode.Configured,
        configuredSince: '2026-10-01',
        overrideReason: null
      };
      const error = validateModeForm(form, settings({ mode: MonthlyDeclarationMode.Legacy }));
      expect(error).toContain('contrôle de parité');
    });

    it("exige une date d'effet au premier du mois", () => {
      const form: DmModeForm = {
        mode: MonthlyDeclarationMode.Configured,
        configuredSince: '2026-10-15',
        overrideReason: 'motif'
      };
      const error = validateModeForm(form, settings({ canSwitchToConfigured: true }));
      expect(error).toContain('premier jour');
    });

    it('exige un motif tant que la série de contrôles n’est pas atteinte', () => {
      const form: DmModeForm = {
        mode: MonthlyDeclarationMode.Configured,
        configuredSince: '2026-10-01',
        overrideReason: null
      };
      expect(needsOverrideReason(form, settings({ parityCleanStreak: 1 }))).toBe(true);
      const error = validateModeForm(form, settings({ parityCleanStreak: 1 }));
      expect(error).toContain('série actuelle : 1');
    });

    it('n’exige plus de motif une fois la série atteinte', () => {
      const form: DmModeForm = {
        mode: MonthlyDeclarationMode.Configured,
        configuredSince: '2026-10-01',
        overrideReason: null
      };
      const ok = settings({ parityCleanStreak: 3, canSwitchToConfigured: true });
      expect(needsOverrideReason(form, ok)).toBe(false);
      expect(validateModeForm(form, ok)).toBeNull();
    });

    it('refuse un motif plus long que ce que le domaine accepte', () => {
      const form: DmModeForm = {
        mode: MonthlyDeclarationMode.Configured,
        configuredSince: '2026-10-01',
        overrideReason: 'x'.repeat(DM_MAX_OVERRIDE_REASON_LENGTH + 1)
      };
      const error = validateModeForm(form, settings({ parityCleanStreak: 1 }));
      expect(error).toContain('500 caractères');
    });

    it('refuse de redemander le régime déjà en place', () => {
      const error = validateModeForm(
        { mode: MonthlyDeclarationMode.Parity, configuredSince: null, overrideReason: null },
        settings({ mode: MonthlyDeclarationMode.Parity })
      );
      expect(error).toContain('déjà dans ce régime');
    });

    it('laisse redemander le mode paramétré, dont la date d’effet peut changer', () => {
      const error = validateModeForm(
        {
          mode: MonthlyDeclarationMode.Configured,
          configuredSince: '2026-11-01',
          overrideReason: null
        },
        settings({ mode: MonthlyDeclarationMode.Configured, canSwitchToConfigured: true })
      );
      expect(error).toBeNull();
    });

    it("n'envoie ni date d'effet ni motif sur un retour au calcul historique", () => {
      const request = toModeRequest({
        mode: MonthlyDeclarationMode.Legacy,
        configuredSince: '2026-10-01',
        overrideReason: 'inutile ici'
      });
      expect(request).toEqual({
        mode: MonthlyDeclarationMode.Legacy,
        configuredSince: null,
        overrideReason: null
      });
    });

    it('transmet la date d’effet et le motif sur une bascule', () => {
      const request = toModeRequest({
        mode: MonthlyDeclarationMode.Configured,
        configuredSince: ' 2026-10-01 ',
        overrideReason: '  Dérogation validée par l’associé.  '
      });
      expect(request.configuredSince).toBe('2026-10-01');
      expect(request.overrideReason).toBe('Dérogation validée par l’associé.');
    });
  });

  describe('rampe', () => {
    it('dit que rien n’a commencé en calcul historique', () => {
      expect(describeRamp(settings({ mode: MonthlyDeclarationMode.Legacy }))).toContain(
        "n'a pas commencé"
      );
    });

    it('chiffre ce qu’il reste à faire en contrôle de parité', () => {
      const text = describeRamp(settings({ parityCleanStreak: 1 }));
      expect(text).toContain('1 sur 3');
      expect(text).toContain('Encore 2');
    });

    it('annonce la bascule ouverte une fois la série atteinte', () => {
      const text = describeRamp(settings({ parityCleanStreak: 3, canSwitchToConfigured: true }));
      expect(text).toContain('bascule est ouverte');
    });

    it('dit que la rampe est derrière un dossier déjà paramétré', () => {
      expect(describeRamp(settings({ mode: MonthlyDeclarationMode.Configured }))).toContain(
        'derrière lui'
      );
    });
  });
});
