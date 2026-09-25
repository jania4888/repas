import {
  AccountBalanceSide,
  ChartOfAccountDto,
  MonthlyDeclarationFamily,
  MonthlyDeclarationMode,
  MonthlyDeclarationRubricDto,
  MonthlyDeclarationSettingsDto,
  PayrollContributionComponent,
  RubricAccountMatchMode,
  RubricAccountRole,
  RubricGrossKind,
  RubricWithheldKind
} from '../services/accounting.service';
import {
  DM_FAMILY_TABS,
  DmRubricForm,
  accountPickerOptions,
  buildRubricAccounts,
  countActiveRubrics,
  countSelectedAccounts,
  describeApplicability,
  describeGross,
  describeMode,
  describeWithheld,
  familyNeedsAttention,
  isConfigurableLinesActive,
  isFamilyIncluded,
  isFamilyOutOfEngineScope,
  isRubricUnsupported,
  modeLabel,
  newRubricForm,
  nextDisplayOrder,
  parsePrefixList,
  readAccountSelection,
  rubricsOfFamily,
  toCreateRequest,
  toDateInputValue,
  toRubricForm,
  toUpdateRequest,
  unknownAccountsOf,
  validateRubricForm
} from './monthly-declaration-config.view-model';

function rubric(overrides: Partial<MonthlyDeclarationRubricDto> = {}): MonthlyDeclarationRubricDto {
  return {
    id: 'r1',
    family: MonthlyDeclarationFamily.Tcl,
    code: 'F9_TCL',
    label: 'T.C.L sur chiffre d’affaires',
    reportCode: '*',
    grossKind: RubricGrossKind.Account,
    withheldKind: RubricWithheldKind.GrossTimesRate,
    grossSide: AccountBalanceSide.Credit,
    withheldSide: AccountBalanceSide.Credit,
    ratePercent: 0.2,
    fixedGrossAmount: null,
    fixedWithheldAmount: null,
    payrollComponent: null,
    withheldPayrollComponent: null,
    effectiveFrom: null,
    effectiveTo: null,
    isActive: true,
    displayOrder: 10,
    accounts: [
      { role: RubricAccountRole.Gross, accountNumber: '70', matchMode: RubricAccountMatchMode.Prefix }
    ],
    ...overrides
  };
}

function form(overrides: Partial<DmRubricForm> = {}): DmRubricForm {
  return {
    ...newRubricForm(MonthlyDeclarationFamily.Tcl, 10),
    code: 'F9_TCL',
    label: 'T.C.L',
    reportCode: '*',
    ratePercent: 0.2,
    grossAccounts: { exact: [], prefixes: '70' },
    ...overrides
  };
}

describe('monthly-declaration-config.view-model — catalogue des familles', () => {
  it('couvre les onze familles, sans doublon', () => {
    expect(DM_FAMILY_TABS.length).toBe(11);
    expect(new Set(DM_FAMILY_TABS.map(t => t.family)).size).toBe(11);
  });

  it('place « Autres informations » en dernier : ce n’est pas un impôt', () => {
    expect(DM_FAMILY_TABS[DM_FAMILY_TABS.length - 1].family).toBe(
      MonthlyDeclarationFamily.OtherInformation
    );
  });

  it('signale la T.V.A comme hors périmètre du moteur, et elle seule', () => {
    const outOfScope = DM_FAMILY_TABS.filter(t => isFamilyOutOfEngineScope(t.family));
    expect(outOfScope.map(t => t.family)).toEqual([MonthlyDeclarationFamily.Vat]);
  });
});

describe('monthly-declaration-config.view-model — dates', () => {
  it('extrait yyyy-MM-dd sans passer par Date (aucun décalage de fuseau)', () => {
    expect(toDateInputValue('2026-01-01T00:00:00')).toBe('2026-01-01');
    expect(toDateInputValue('2026-12-31T23:00:00Z')).toBe('2026-12-31');
  });

  it('rend null pour une valeur absente ou non datée', () => {
    expect(toDateInputValue(null)).toBeNull();
    expect(toDateInputValue('')).toBeNull();
    expect(toDateInputValue('pas-une-date')).toBeNull();
  });
});

describe('monthly-declaration-config.view-model — comptes d’une colonne', () => {
  it('sépare les comptes exacts des racines', () => {
    const selection = readAccountSelection(
      [
        { role: RubricAccountRole.Gross, accountNumber: '7071', matchMode: RubricAccountMatchMode.Exact },
        { role: RubricAccountRole.Gross, accountNumber: '61', matchMode: RubricAccountMatchMode.Prefix },
        { role: RubricAccountRole.Withheld, accountNumber: '4366', matchMode: RubricAccountMatchMode.Exact }
      ],
      RubricAccountRole.Gross
    );

    expect(selection.exact).toEqual(['7071']);
    expect(selection.prefixes).toBe('61');
  });

  it('découpe les racines sur « ; » en ignorant les blancs', () => {
    expect(parsePrefixList(' 70 ; 71;; 72 ')).toEqual(['70', '71', '72']);
    expect(parsePrefixList(null)).toEqual([]);
  });

  it('reconstruit les deux rôles avec leur mode de rapprochement', () => {
    const accounts = buildRubricAccounts(
      form({
        grossAccounts: { exact: ['7071'], prefixes: '70' },
        withheldAccounts: { exact: ['4366'], prefixes: '' }
      })
    );

    expect(accounts).toEqual([
      { role: RubricAccountRole.Gross, accountNumber: '7071', matchMode: RubricAccountMatchMode.Exact },
      { role: RubricAccountRole.Gross, accountNumber: '70', matchMode: RubricAccountMatchMode.Prefix },
      { role: RubricAccountRole.Withheld, accountNumber: '4366', matchMode: RubricAccountMatchMode.Exact }
    ]);
  });

  it('écarte les entrées vides du sélecteur', () => {
    expect(countSelectedAccounts({ exact: ['', '  '], prefixes: ' ; ' })).toBe(0);
    expect(countSelectedAccounts({ exact: ['701'], prefixes: '70;71' })).toBe(3);
  });
});

describe('monthly-declaration-config.view-model — aller-retour DTO ↔ formulaire', () => {
  it('restitue la rubrique à l’identique', () => {
    const source = rubric({
      effectiveFrom: '2026-01-01T00:00:00',
      effectiveTo: '2026-06-15T00:00:00',
      accounts: [
        { role: RubricAccountRole.Gross, accountNumber: '70', matchMode: RubricAccountMatchMode.Prefix },
        { role: RubricAccountRole.Withheld, accountNumber: '4367', matchMode: RubricAccountMatchMode.Exact }
      ]
    });

    const draft = toRubricForm(source);

    expect(draft.id).toBe('r1');
    expect(draft.effectiveFrom).toBe('2026-01-01');
    expect(draft.effectiveTo).toBe('2026-06-15');
    expect(draft.grossAccounts.prefixes).toBe('70');
    expect(draft.withheldAccounts.exact).toEqual(['4367']);
    expect(toUpdateRequest(draft).accounts).toEqual(source.accounts);
  });

  it('normalise le code en majuscules à la création', () => {
    expect(toCreateRequest(form({ code: ' f9_tcl ' })).code).toBe('F9_TCL');
  });

  it('n’envoie pas la famille ni le code dans une modification', () => {
    const payload = toUpdateRequest(form({ id: 'r1' })) as Record<string, unknown>;
    expect(payload['family']).toBeUndefined();
    expect(payload['code']).toBeUndefined();
  });

  it('abandonne un composant de paie devenu inutile après changement de type', () => {
    // Le comptable choisit « Valeur de paie », sélectionne le net imposable, puis revient sur
    // « Solde de comptes » : le résidu ne doit pas partir au serveur.
    const payload = toUpdateRequest(
      form({
        grossKind: RubricGrossKind.Account,
        payrollComponent: PayrollContributionComponent.SalariesNetTaxableBase,
        withheldKind: RubricWithheldKind.GrossTimesRate,
        withheldPayrollComponent: PayrollContributionComponent.WithholdingIrpp
      })
    );

    expect(payload.payrollComponent).toBeNull();
    expect(payload.withheldPayrollComponent).toBeNull();
  });

  it('conserve le composant de paie quand la colonne l’utilise', () => {
    const payload = toUpdateRequest(
      form({
        grossKind: RubricGrossKind.Payroll,
        payrollComponent: PayrollContributionComponent.SalariesNetTaxableBase,
        withheldKind: RubricWithheldKind.Payroll,
        withheldPayrollComponent: PayrollContributionComponent.WithholdingIrpp
      })
    );

    expect(payload.payrollComponent).toBe(PayrollContributionComponent.SalariesNetTaxableBase);
    expect(payload.withheldPayrollComponent).toBe(PayrollContributionComponent.WithholdingIrpp);
  });

  it('distingue « valeur fixe nulle » de « saisie au Calcul DM »', () => {
    expect(toUpdateRequest(form({ fixedGrossAmount: 0 })).fixedGrossAmount).toBe(0);
    expect(toUpdateRequest(form({ fixedGrossAmount: null })).fixedGrossAmount).toBeNull();
  });
});

describe('monthly-declaration-config.view-model — validation de confort', () => {
  it('accepte une rubrique complète', () => {
    expect(validateRubricForm(form())).toBeNull();
  });

  it('refuse un code hors format à la création, et ne le contrôle plus en modification', () => {
    expect(validateRubricForm(form({ code: 'f9 tcl' }))).toContain('Le code est invalide');
    expect(validateRubricForm(form({ id: 'r1', code: 'f9 tcl' }))).toBeNull();
  });

  it('refuse un code rapport qui n’est ni un numéro d’article ni « * »', () => {
    expect(validateRubricForm(form({ reportCode: '17.2' }))).toBeNull();
    expect(validateRubricForm(form({ reportCode: '*' }))).toBeNull();
    expect(validateRubricForm(form({ reportCode: 'A17' }))).toContain('code rapport');
  });

  it('refuse le 2-cycle brut ↔ retenue', () => {
    const message = validateRubricForm(
      form({
        grossKind: RubricGrossKind.WithheldOverRate,
        withheldKind: RubricWithheldKind.GrossTimesRate
      })
    );
    expect(message).toContain('Combinaison impossible');
  });

  it('exige un taux strictement positif pour les calculs dérivés', () => {
    expect(
      validateRubricForm(form({ withheldKind: RubricWithheldKind.GrossTimesRate, ratePercent: 0 }))
    ).toContain('taux strictement positif');
    expect(
      validateRubricForm(
        form({
          grossKind: RubricGrossKind.WithheldOverRate,
          withheldKind: RubricWithheldKind.Fixed,
          ratePercent: 0
        })
      )
    ).toContain('taux strictement positif');
  });

  it('borne le taux à 100 % inclus (article 19, non-résidents)', () => {
    expect(validateRubricForm(form({ ratePercent: 100 }))).toBeNull();
    expect(validateRubricForm(form({ ratePercent: 100.01 }))).toContain('entre 0 et 100');
    expect(validateRubricForm(form({ ratePercent: -1 }))).toContain('entre 0 et 100');
  });

  it('exige le composant de paie quand la colonne est de type paie', () => {
    expect(
      validateRubricForm(form({ grossKind: RubricGrossKind.Payroll, payrollComponent: null }))
    ).toContain('valeur du cycle');
    expect(
      validateRubricForm(
        form({ withheldKind: RubricWithheldKind.Payroll, withheldPayrollComponent: null })
      )
    ).toContain('valeur du cycle');
  });

  it('exige au moins un compte quand la colonne est calculée sur comptes', () => {
    expect(
      validateRubricForm(
        form({ grossKind: RubricGrossKind.Account, grossAccounts: { exact: [], prefixes: '' } })
      )
    ).toContain('au moins un compte');
    expect(
      validateRubricForm(
        form({
          grossKind: RubricGrossKind.Fixed,
          withheldKind: RubricWithheldKind.Account,
          withheldAccounts: { exact: [], prefixes: '' }
        })
      )
    ).toContain('au moins un compte');
  });

  it('plafonne une colonne à vingt comptes', () => {
    const many = Array.from({ length: 21 }, (_, i) => `70${i}`);
    expect(
      validateRubricForm(form({ grossAccounts: { exact: many, prefixes: '' } }))
    ).toContain('plus de 20 comptes');
  });

  it('refuse une date maximale antérieure à la date de début', () => {
    expect(
      validateRubricForm(form({ effectiveFrom: '2026-06-01', effectiveTo: '2026-01-31' }))
    ).toContain('précède la date de début');
    expect(
      validateRubricForm(form({ effectiveFrom: '2026-01-01', effectiveTo: '2026-06-30' }))
    ).toBeNull();
  });
});

describe('monthly-declaration-config.view-model — lecture d’une rubrique', () => {
  it('décrit un brut lu sur comptes avec son sens', () => {
    expect(describeGross(rubric())).toBe('crédits de 70…');
  });

  it('décrit un brut de paie par la valeur du cycle', () => {
    expect(
      describeGross(
        rubric({
          grossKind: RubricGrossKind.Payroll,
          payrollComponent: PayrollContributionComponent.SalariesNetTaxableBase
        })
      )
    ).toBe('Paie — Net imposable');
  });

  it('distingue une valeur fixe nulle d’une saisie attendue', () => {
    expect(describeGross(rubric({ grossKind: RubricGrossKind.Fixed, fixedGrossAmount: 0 }))).toBe(
      'Valeur fixe 0'
    );
    expect(describeGross(rubric({ grossKind: RubricGrossKind.Fixed, fixedGrossAmount: null }))).toBe(
      'Saisie au Calcul DM'
    );
  });

  it('décrit la retenue dérivée du brut', () => {
    expect(describeWithheld(rubric())).toBe('Brut × 0.2 %');
  });

  it('signale la combinaison non prise en charge', () => {
    const unsupported = rubric({ withheldKind: RubricWithheldKind.WithheldOverRate });
    expect(isRubricUnsupported(unsupported)).toBe(true);
    expect(describeWithheld(unsupported)).toBe('Non pris en charge');
    expect(isRubricUnsupported(rubric())).toBe(false);
  });

  it('décrit la période d’application', () => {
    expect(describeApplicability(rubric())).toBe('Toutes périodes');
    expect(describeApplicability(rubric({ effectiveFrom: '2026-01-01T00:00:00' }))).toBe(
      'À partir du 2026-01-01'
    );
    expect(
      describeApplicability(
        rubric({ effectiveFrom: '2026-01-01T00:00:00', effectiveTo: '2026-06-30T00:00:00' })
      )
    ).toBe('2026-01-01 → 2026-06-30');
  });
});

describe('monthly-declaration-config.view-model — lecture de la configuration', () => {
  const rubrics = [
    rubric({ id: 'a', code: 'B', family: MonthlyDeclarationFamily.Tcl, displayOrder: 20 }),
    rubric({ id: 'b', code: 'A', family: MonthlyDeclarationFamily.Tcl, displayOrder: 10 }),
    rubric({ id: 'c', code: 'C', family: MonthlyDeclarationFamily.Tfp, displayOrder: 10 }),
    rubric({ id: 'd', code: 'D', family: MonthlyDeclarationFamily.Tcl, displayOrder: 10, isActive: false })
  ];

  it('filtre par famille et trie par ordre puis par code', () => {
    const ofTcl = rubricsOfFamily(rubrics, MonthlyDeclarationFamily.Tcl);
    expect(ofTcl.map(r => r.code)).toEqual(['A', 'D', 'B']);
  });

  it('ne compte que les rubriques actives de la famille', () => {
    expect(countActiveRubrics(rubrics, MonthlyDeclarationFamily.Tcl)).toBe(2);
    expect(countActiveRubrics(rubrics, MonthlyDeclarationFamily.Vat)).toBe(0);
  });

  it('calcule le prochain ordre d’affichage par famille', () => {
    expect(nextDisplayOrder(rubrics, MonthlyDeclarationFamily.Tcl)).toBe(30);
    expect(nextDisplayOrder(rubrics, MonthlyDeclarationFamily.Vat)).toBe(10);
  });

  it('lit l’inclusion d’une famille, non incluse par défaut', () => {
    const families = [{ family: MonthlyDeclarationFamily.Tcl, isIncluded: true }];
    expect(isFamilyIncluded(families, MonthlyDeclarationFamily.Tcl)).toBe(true);
    expect(isFamilyIncluded(families, MonthlyDeclarationFamily.Tfp)).toBe(false);
    expect(isFamilyIncluded([], MonthlyDeclarationFamily.Tcl)).toBe(false);
  });

  it('signale une famille incluse sans rubrique active', () => {
    const families = [
      { family: MonthlyDeclarationFamily.Tcl, isIncluded: true },
      { family: MonthlyDeclarationFamily.HotelTax, isIncluded: true },
      { family: MonthlyDeclarationFamily.Vat, isIncluded: false }
    ];

    // Incluse et pourvue : rien à signaler.
    expect(familyNeedsAttention(families, rubrics, MonthlyDeclarationFamily.Tcl)).toBe(false);
    // Incluse et vide : en mode paramétré, l'enregistrement sera refusé.
    expect(familyNeedsAttention(families, rubrics, MonthlyDeclarationFamily.HotelTax)).toBe(true);
    // Non incluse et vide : c'est le cas normal, aucune alerte.
    expect(familyNeedsAttention(families, rubrics, MonthlyDeclarationFamily.Vat)).toBe(false);
  });
});

describe('monthly-declaration-config.view-model — régime du dossier', () => {
  function settings(
    overrides: Partial<MonthlyDeclarationSettingsDto> = {}
  ): MonthlyDeclarationSettingsDto {
    return {
      mode: MonthlyDeclarationMode.Legacy,
      configuredSince: null,
      lastParityRunAt: null,
      lastParityMaxGapMillimes: 0,
      parityCleanStreak: 0,
      requiredCleanParityPeriods: 3,
      canSwitchToConfigured: false,
      parityOverrideBy: null,
      parityOverrideReason: null,
      configurableLinesEnabled: true,
      ...overrides
    };
  }

  it('nomme les trois régimes', () => {
    expect(modeLabel(MonthlyDeclarationMode.Legacy)).toBe('Calcul historique');
    expect(modeLabel(MonthlyDeclarationMode.Parity)).toBe('Contrôle de parité');
    expect(modeLabel(MonthlyDeclarationMode.Configured)).toBe('Calcul paramétré');
  });

  it('dit en mode historique que la configuration ne déplace aucun montant', () => {
    expect(describeMode(settings())).toContain('ne déplace aucun montant');
  });

  it('affiche la progression de la rampe en contrôle de parité', () => {
    const text = describeMode(
      settings({ mode: MonthlyDeclarationMode.Parity, parityCleanStreak: 2 })
    );
    expect(text).toContain('2 période(s) sans écart sur les 3 requises');
  });

  it('date la bascule en mode paramétré', () => {
    const text = describeMode(
      settings({ mode: MonthlyDeclarationMode.Configured, configuredSince: '2026-09-01T00:00:00' })
    );
    expect(text).toContain('2026-09-01');
  });

  it('lit l’interrupteur de la plateforme, et tient des réglages absents pour « indisponible »', () => {
    expect(isConfigurableLinesActive(settings())).toBe(true);
    expect(isConfigurableLinesActive(settings({ configurableLinesEnabled: false }))).toBe(false);
    expect(isConfigurableLinesActive(null)).toBe(false);
    expect(isConfigurableLinesActive(undefined)).toBe(false);
  });
});

describe('monthly-declaration-config.view-model — plan comptable', () => {
  const chart: ChartOfAccountDto[] = [
    {
      id: '1',
      accountNumber: '7071',
      label: 'Ventes de marchandises',
      accountClass: 7,
      natureType: 0,
      isSystem: false,
      isActive: true,
      level: 4
    },
    {
      id: '2',
      accountNumber: '4366',
      label: 'TVA déductible',
      accountClass: 4,
      natureType: 0,
      isSystem: false,
      isActive: true,
      level: 4
    },
    {
      id: '3',
      accountNumber: '9999',
      label: 'Compte clos',
      accountClass: 9,
      natureType: 0,
      isSystem: false,
      isActive: false,
      level: 4
    }
  ];

  it('propose les comptes actifs, triés, libellé compris', () => {
    const options = accountPickerOptions(chart);
    expect(options.map(o => o.value)).toEqual(['4366', '7071']);
    expect(options[1].label).toBe('7071 — Ventes de marchandises');
  });

  it('signale les comptes exacts absents du plan, jamais les racines', () => {
    const known = new Set(['7071']);
    const target = rubric({
      accounts: [
        { role: RubricAccountRole.Gross, accountNumber: '7071', matchMode: RubricAccountMatchMode.Exact },
        { role: RubricAccountRole.Gross, accountNumber: '7072', matchMode: RubricAccountMatchMode.Exact },
        // Une racine n'est pas un compte : « 70 » peut n'exister nulle part au plan sans que la
        // rubrique soit fautive.
        { role: RubricAccountRole.Gross, accountNumber: '70', matchMode: RubricAccountMatchMode.Prefix }
      ]
    });

    expect(unknownAccountsOf(target, known)).toEqual(['7072']);
  });
});
