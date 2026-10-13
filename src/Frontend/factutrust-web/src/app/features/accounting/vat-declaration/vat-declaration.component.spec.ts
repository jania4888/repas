import {
  buildChartSegments,
  buildCompanyFromAuth,
  buildDivergenceRows,
  buildDocLinks,
  buildTaxRows,
  canSubmitDeclaration,
  clampExtrasValue,
  computeTotalToPay,
  hasSuggestionMismatch,
  isSubmittedOrLocked,
  payrollHint,
  resolveCompanyDisplay,
  round3,
  shiftPeriod,
  statusLabel,
  suggestedTaxAmount
} from './vat-declaration.view-model';
import { User } from '@core/services/auth.service';

describe('vat-declaration.view-model', () => {
  const baseDto = {
    year: 2026,
    month: 5,
    collectedVat19: 657.02,
    collectedVat13: 67.6,
    collectedVat7: 601.65,
    deductibleVatGoods: 0,
    deductibleVatAssets: 0,
    previousCredit: 0,
    vatDue: 1326.27,
    creditToCarry: 0,
    currency: 'TND',
    status: 0,
    fodec: 125.73,
    droitTimbre: 7,
    tcl: 27.799,
    tfp: 0,
    foprolos: 0,
    withholdingTax: 0,
    acomptes: 0,
    totalToPay: 1486.799,
    version: 1,
    isRectificative: false,
    monthlyDeclarationV2Enabled: true,
    filingDeadline: '2026-06-22',
    declarationTypeDisplay: 'Déclaration mensuelle unique',
    collectedVatBreakdown: [
      { ratePercent: 19, taxableBase: 3458, vatAmount: 657.02 },
      { ratePercent: 13, taxableBase: 520, vatAmount: 67.6 },
      { ratePercent: 7, taxableBase: 8595, vatAmount: 601.65 }
    ],
    deductiblePurchasesTaxableBase: 0,
    salesTaxableBase: 12573,
    salesGrossBase: 13899.27,
    fodecTaxableBase: 8000
  };

  const extras = {
    fodec: 125.73,
    droitTimbre: 7,
    tcl: 27.799,
    tfp: 0,
    foprolos: 0,
    withholdingTax: 0,
    acomptes: 0
  };

  /**
   * Déclaration déposée dont les montants ont divergé depuis : le cycle de paie a été clôturé
   * après le dépôt (TFP/FOPROLOS restés à 0) et les ventes ont augmenté (TCL sous-évaluée).
   */
  const suggestedDto = {
    ...baseDto,
    payrollTaxBase: 168,
    tfpRatePercent: 1,
    foprolosRatePercent: 1,
    payrollSalariesGrossBase: 168,
    suggested: {
      collectedVat19: 657.02,
      collectedVat13: 67.6,
      collectedVat7: 601.65,
      deductibleVatGoods: 0,
      deductibleVatAssets: 0,
      previousCredit: 0,
      vatDue: 1326.27,
      creditToCarry: 0,
      fodec: 300.5,
      droitTimbre: 7,
      tcl: 188.617,
      tfp: 1.68,
      foprolos: 1.68,
      withholdingTax: 112.65,
      totalToPay: 1938.397,
      payrollRunExists: true,
      payrollRunStatus: 3,
      payrollRunStatusDisplay: 'Clôturé',
      payrollRunUsable: true
    }
  };

  it('computeTotalToPay matches backend formula', () => {
    expect(computeTotalToPay(baseDto, extras)).toBeCloseTo(1486.799, 3);
  });

  it('computeTotalToPay floors at zero', () => {
    expect(computeTotalToPay({ ...baseDto, vatDue: 0 }, { ...extras, acomptes: 999 })).toBe(0);
  });

  describe('familles produites par le seul calcul paramétré', () => {
    // Droit de consommation, taxe hôtelière, droit de licence : pas de champ de saisie, mais
    // comprises dans le total déposé par le serveur.
    const withConfiguredFamilies = {
      ...suggestedDto,
      consumptionDuty: 10,
      hotelTax: 20,
      licenceFee: 0,
      suggested: { ...suggestedDto.suggested, consumptionDuty: 10, hotelTax: 25, licenceFee: 5 }
    };

    it('computeTotalToPay les additionne, comme le serveur', () => {
      expect(computeTotalToPay(withConfiguredFamilies, extras)).toBeCloseTo(1486.799 + 30, 3);
    });

    it('buildTaxRows les affiche en lecture seule dès qu’un montant existe', () => {
      const rows = buildTaxRows(withConfiguredFamilies, extras, 1516.799);

      const hotel = rows.find(r => r.taxLabel === 'Taxe hôtelière');
      expect(hotel?.netAmount).toBe(20);
      expect(hotel?.editableKey).toBeUndefined();
      // Déclaré 0 mais recalculé 5 : la ligne reste visible pour que l'écart se voie.
      expect(rows.some(r => r.taxLabel === 'Droit de licence')).toBe(true);
    });

    it('buildTaxRows les tait quand elles valent zéro de part et d’autre', () => {
      const rows = buildTaxRows(baseDto, extras, 1486.799);
      expect(rows.some(r => r.taxLabel === 'Droit de consommation')).toBe(false);
      expect(rows.some(r => r.taxLabel === 'Taxe hôtelière')).toBe(false);
    });

    it('buildDivergenceRows signale leur écart avec le recalcul', () => {
      const labels = buildDivergenceRows(withConfiguredFamilies).map(r => r.label);

      expect(labels).toContain('Taxe hôtelière');
      expect(labels).toContain('Droit de licence');
      expect(labels).not.toContain('Droit de consommation');
    });
  });

  it('clampExtrasValue rejects negatives', () => {
    expect(clampExtrasValue(-5)).toBe(0);
    expect(clampExtrasValue(12.5)).toBe(12.5);
  });

  it('shiftPeriod navigates across year boundary', () => {
    expect(shiftPeriod(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftPeriod(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
  });

  it('buildTaxRows includes V2 taxes when enabled', () => {
    const rows = buildTaxRows(baseDto, extras, 1486.799);
    expect(rows.some(r => r.taxLabel === 'FODEC')).toBe(true);
    expect(rows.find(r => r.taxLabel === 'TOTAL À PAYER')?.netAmount).toBeCloseTo(1486.799, 3);
  });

  it('round3 arrondit au millime', () => {
    expect(round3(565.2999)).toBe(565.3);
    expect(round3(133.04142)).toBe(133.041);
  });

  it('suggestedTaxAmount calcule Base × Taux et renvoie null si donnée absente', () => {
    // FODEC 1 % sur base HT, TCL 0,2 % sur base TTC.
    expect(suggestedTaxAmount(56530, 1)).toBe(565.3);
    expect(suggestedTaxAmount(66520.7, 0.2)).toBe(133.041);
    expect(suggestedTaxAmount(null, 1)).toBeNull();
    expect(suggestedTaxAmount(1000, null)).toBeNull();
  });

  it('hasSuggestionMismatch détecte un écart > 0,001 entre saisi et suggéré', () => {
    expect(hasSuggestionMismatch(292.6, 565.3)).toBe(true);
    expect(hasSuggestionMismatch(565.3, 565.3)).toBe(false);
    expect(hasSuggestionMismatch(null, 565.3)).toBe(false);
  });

  it('buildTaxRows lit la suggestion depuis le backend, sans la recalculer', () => {
    // Le backend est seul à connaître la source réelle de chaque taxe. Recalculer « base × taux »
    // ici produisait un second chiffre : c'est ce qui affichait « 292,600 saisi / 0,000 suggéré »
    // sur le FODEC, dont le préremplissage ne vient pas de la base FODEC des lignes.
    const rows = buildTaxRows(suggestedDto, extras, 1486.799, 1, 0.2);

    expect(rows.find(r => r.taxLabel === 'FODEC')?.suggestedAmount).toBe(300.5);
    expect(rows.find(r => r.taxLabel === 'TCL')?.suggestedAmount).toBe(188.617);
    expect(rows.find(r => r.taxLabel === 'TFP')?.suggestedAmount).toBe(1.68);
    expect(rows.find(r => r.taxLabel === 'FOPROLOS')?.suggestedAmount).toBe(1.68);
    expect(rows.find(r => r.taxLabel === 'Retenues à la source (RS)')?.suggestedAmount).toBe(112.65);
  });

  it('buildTaxRows sans bloc calculé ne propose aucune suggestion', () => {
    const rows = buildTaxRows(baseDto, extras, 1486.799, 1, 0.2);
    expect(rows.find(r => r.taxLabel === 'FODEC')?.suggestedAmount).toBeNull();
    expect(rows.find(r => r.taxLabel === 'TCL')?.suggestedAmount).toBeNull();
  });

  it('buildTaxRows expose la masse salariale et le taux sur les lignes TFP/FOPROLOS', () => {
    const rows = buildTaxRows(suggestedDto, extras, 1486.799, 1, 0.2);
    const tfp = rows.find(r => r.taxLabel === 'TFP');
    const foprolos = rows.find(r => r.taxLabel === 'FOPROLOS');

    expect(tfp?.taxableBase).toBe(168);
    expect(tfp?.ratePercent).toBe(1);
    expect(foprolos?.taxableBase).toBe(168);
    expect(foprolos?.ratePercent).toBe(1);
  });

  it('buildDivergenceRows liste les lignes déposées qui s’écartent du recalcul', () => {
    // Cas Ste Bouzgarou 07/2026 : TFP/FOPROLOS gelés à 0, TCL gelée sous sa valeur courante.
    const rows = buildDivergenceRows(suggestedDto);
    const labels = rows.map(r => r.label);

    expect(labels).toContain('TFP');
    expect(labels).toContain('FOPROLOS');
    expect(labels).toContain('TCL');
    expect(rows.find(r => r.label === 'TFP')).toEqual({ label: 'TFP', declared: 0, computed: 1.68 });
    // Le droit de timbre est identique de part et d'autre : pas d'écart à signaler.
    expect(labels).not.toContain('Droit de timbre');
  });

  it('buildDivergenceRows ne signale rien sans bloc calculé', () => {
    expect(buildDivergenceRows(baseDto)).toEqual([]);
  });

  it('payrollHint invite à valider un cycle de paie non validé', () => {
    const withCalculatedRun = {
      ...suggestedDto,
      suggested: {
        ...suggestedDto.suggested,
        payrollRunUsable: false,
        payrollRunStatusDisplay: 'Calculé'
      }
    };

    expect(payrollHint(withCalculatedRun)).toContain('Calculé');
    expect(payrollHint(withCalculatedRun)).toContain('Validez le cycle');
  });

  it('payrollHint signale l’absence de cycle de paie', () => {
    const withoutRun = {
      ...suggestedDto,
      suggested: { ...suggestedDto.suggested, payrollRunExists: false, payrollRunUsable: false }
    };

    expect(payrollHint(withoutRun)).toContain('Aucun cycle de paie');
  });

  it('payrollHint reste muet quand le cycle est exploitable', () => {
    expect(payrollHint(suggestedDto)).toBeNull();
  });

  it('buildTaxRows ajoute une ligne "Crédit de TVA à reporter" quand creditToCarry > 0', () => {
    const withCredit = { ...baseDto, vatDue: 0, creditToCarry: 340.5 };
    const rows = buildTaxRows(withCredit, extras, 0);
    const credit = rows.find(r => r.taxLabel === 'Crédit de TVA à reporter');
    expect(credit).toBeTruthy();
    expect(credit?.deductibleAmount).toBe(340.5);
    // Absente quand il n'y a pas de crédit.
    expect(buildTaxRows(baseDto, extras, 1486.799).some(r => r.taxLabel === 'Crédit de TVA à reporter')).toBe(false);
  });

  it('buildChartSegments filters zero values', () => {
    const segments = buildChartSegments(baseDto, extras, 1486.799);
    expect(segments.every(s => s.value > 0)).toBe(true);
    expect(segments.some(s => s.label === 'TVA due')).toBe(true);
  });

  it('statusLabel maps known statuses', () => {
    expect(statusLabel(0)).toBe('Brouillon');
    expect(statusLabel(1)).toBe('Soumise');
    expect(statusLabel(2)).toBe('Verrouillée');
  });

  it('resolveCompanyDisplay prefers DTO over company and auth', () => {
    const dto = {
      ...baseDto,
      companyName: 'DTO Société',
      nif: '111/A/B/C/000',
      taxRegimeDisplay: 'Réel',
      tradeName: 'Commerce'
    };
    const company = {
      companyName: 'Settings Société',
      nif: '222/A/B/C/000',
      taxRegimeDisplay: 'Forfaitaire',
      tradeName: 'Autre'
    } as never;
    const auth = { contextCompanyName: 'Auth Société', companyName: 'Native' } as User;

    const resolved = resolveCompanyDisplay(dto, company, auth);
    expect(resolved.companyName).toBe('DTO Société');
    expect(resolved.nif).toBe('111/A/B/C/000');
    expect(resolved.taxRegimeDisplay).toBe('Réel');
    expect(resolved.tradeName).toBe('Commerce');
  });

  it('resolveCompanyDisplay falls back to auth when DTO and company are absent', () => {
    const auth = { contextCompanyName: 'Client Dossier', companyName: 'Cabinet' } as User;
    const resolved = resolveCompanyDisplay(null, null, auth);
    expect(resolved.companyName).toBe('Client Dossier');
    expect(resolved.nif).toBeNull();
  });

  it('buildCompanyFromAuth uses contextCompanyName for delegated cabinet', () => {
    const auth = { contextCompanyName: 'Ste Bouzgarou', companyName: 'Cabinet ABC' } as User;
    const display = buildCompanyFromAuth(auth);
    expect(display.companyName).toBe('Ste Bouzgarou');
    expect(display.nif).toBeNull();
  });

  it('canSubmitDeclaration is true only for a draft (status 0)', () => {
    expect(canSubmitDeclaration(0)).toBeTrue();
    expect(canSubmitDeclaration(1)).toBeFalse(); // soumise
    expect(canSubmitDeclaration(2)).toBeFalse(); // verrouillée
  });

  it('isSubmittedOrLocked is true for submitted and locked only', () => {
    expect(isSubmittedOrLocked(0)).toBeFalse();
    expect(isSubmittedOrLocked(1)).toBeTrue();
    expect(isSubmittedOrLocked(2)).toBeTrue();
  });

  it('buildDocLinks includes the fiscal schedule link with period query params', () => {
    const links = buildDocLinks(baseDto as never, 2026, 7);
    const schedule = links.find(l => l.route === '/accounting/fiscal-schedule');

    expect(schedule).toBeTruthy();
    expect(schedule!.queryParams).toEqual({ fiscalYear: '2026', periodMonth: '7' });
    // Déclaration en brouillon (status 0) → suivi neutre ; soumise (status 1) → « Déposée ».
    expect(schedule!.statusLabel).toBe('À suivre');
    const submitted = buildDocLinks({ ...baseDto, status: 1 } as never, 2026, 7)
      .find(l => l.route === '/accounting/fiscal-schedule');
    expect(submitted!.statusLabel).toBe('Déposée');
    expect(submitted!.status).toBe('ok');
  });
});
