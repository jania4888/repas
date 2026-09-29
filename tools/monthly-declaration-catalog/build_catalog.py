# -*- coding: utf-8 -*-
"""Genere le catalogue standard des rubriques de la declaration mensuelle (Tunisie)."""
import json, io

VAT_COLLECTED = "436711"
VAT_DEDUCTIBLE_GOODS = "43666"
VAT_DEDUCTIBLE_ASSETS = "43662"
FODEC = "43652"
STAMP_ON_SALE = "4371"
RENT = "613"

def acc(number, mode="Exact"):
    return {"number": number, "mode": mode}

def R(code, family, label, report,
      gross="Fixed", withheld="Fixed", rate=0,
      gross_side="Credit", withheld_side="Credit",
      payroll=None, withheld_payroll=None, gross_accounts=None, withheld_accounts=None):
    r = {
        "code": code, "family": family, "label": label, "reportCode": report,
        "grossKind": gross, "withheldKind": withheld,
        "grossSide": gross_side, "withheldSide": withheld_side,
        "ratePercent": rate,
    }
    if payroll:
        r["payrollComponent"] = payroll
    if withheld_payroll:
        r["withheldPayrollComponent"] = withheld_payroll
    r["grossAccounts"] = gross_accounts or []
    r["withheldAccounts"] = withheld_accounts or []
    return r

rubrics = []

rubrics += [
    R("F1_1", "Withholding", "Traitements, salaires, pensions et rentes viageres ayant subi une retenue a la source selon le regime commun", "1",
      gross="Payroll", withheld="Payroll",
      payroll="SalariesNetTaxableBase", withheld_payroll="WithholdingIrpp"),
    R("F1_3", "Withholding", "Contribution sociale de solidarite", "3",
      gross="Payroll", withheld="Payroll",
      payroll="SalariesNetTaxableBase", withheld_payroll="WithholdingCss"),
    R("F1_4_1", "Withholding", "Commissions, courtages, loyers et remunerations des activites non commerciales : servis aux residents et aux etablis (personnes physiques)", "4.1",
      gross="Account", withheld="GrossTimesRate", rate=10, gross_side="Debit",
      gross_accounts=[acc(RENT, "Prefix")]),
    R("F1_4_2", "Withholding", "Commissions, courtages, loyers et remunerations des activites non commerciales : servis aux residents et aux etablis (personnes morales)", "4.2"),
    R("F1_5", "Withholding", "Honoraires servis aux personnes physiques non soumises au regime reel", "5",
      withheld="GrossTimesRate", rate=10),
    R("F1_6", "Withholding", "Honoraires servis aux personnes morales et aux personnes physiques soumises au regime reel et remunerations servies aux artistes et createurs", "6",
      withheld="GrossTimesRate", rate=3),
    R("F1_8", "Withholding", "Remunerations et primes attribuees aux membres des conseils, des directoires et des comites", "8",
      withheld="GrossTimesRate", rate=20),
    R("F1_10", "Withholding", "Revenus de capitaux mobiliers", "10",
      withheld="GrossTimesRate", rate=20),
    R("F1_12", "Withholding", "Dividendes et revenus assimiles", "12",
      withheld="GrossTimesRate", rate=10),
    R("F1_16", "Withholding", "Revenus des immeubles batis et non batis", "16",
      withheld="GrossTimesRate", rate=15),
    R("F1_17_1", "Withholding", "Sommes versees pour l'acquisition de biens, equipements, fournitures et services egaux ou superieurs a 1 000 dinars, TVA comprise", "17.1",
      withheld="GrossTimesRate", rate=1),
    R("F1_17_2", "Withholding", "Sommes versees pour l'acquisition de biens, equipements, fournitures et services egaux ou superieurs a 1 000 dinars (taux reduit)", "17.2",
      withheld="GrossTimesRate", rate=0.5),
    R("F1_17_3", "Withholding", "Sommes versees pour l'acquisition de biens, equipements, fournitures et services egaux ou superieurs a 1 000 dinars (taux majore)", "17.3",
      withheld="GrossTimesRate", rate=1.5),
    R("F1_18", "Withholding", "Retenue au titre de la TVA sur les montants payes dans le cadre des marches publics", "18",
      withheld="GrossTimesRate", rate=25),
    R("F1_19", "Withholding", "Retenue au titre de la TVA sur les operations realisees avec les personnes non etablies en Tunisie", "19",
      withheld="GrossTimesRate", rate=100),
    R("F1_24", "Withholding", "Plus-values immobilieres et de cession de titres", "24",
      withheld="GrossTimesRate", rate=10),
    R("F1_25", "Withholding", "Sommes servies aux personnes non residentes et non etablies en Tunisie", "25",
      withheld="GrossTimesRate", rate=15),
]

rubrics += [
    R("F2_1", "Tfp", "Industrie manufacturiere", "1",
      gross="Payroll", withheld="GrossTimesRate", rate=1, payroll="PayrollTaxBase"),
    R("F2_2", "Tfp", "Autres activites", "2",
      gross="Payroll", withheld="GrossTimesRate", rate=2, payroll="PayrollTaxBase"),
]

rubrics += [
    R("F3_1", "Foprolos", "Fonds de promotion des logements pour les salaries", "1",
      gross="Payroll", withheld="GrossTimesRate", rate=1, payroll="PayrollTaxBase"),
]

rubrics += [
    R("F4_1", "ConsumptionDuty", "Produits soumis au droit de consommation - production locale", "1"),
    R("F4_2", "ConsumptionDuty", "Produits soumis au droit de consommation - importation", "2"),
]

rubrics += [
    R("F5_1_1", "Vat", "Chiffre d'affaires soumis a la TVA 7 %", "1.1", withheld="GrossTimesRate", rate=7),
    R("F5_1_2", "Vat", "Chiffre d'affaires soumis a la TVA 13 %", "1.2", withheld="GrossTimesRate", rate=13),
    R("F5_1_3", "Vat", "Chiffre d'affaires soumis a la TVA 19 %", "1.3",
      withheld="Account", withheld_accounts=[acc(VAT_COLLECTED)]),
    R("F5_2_1", "Vat", "Achats soumis a la TVA - achat d'immeubles", "2.1"),
    R("F5_2_2", "Vat", "Achats soumis a la TVA - achat d'equipements locaux", "2.2",
      withheld="Account", withheld_side="Debit", withheld_accounts=[acc(VAT_DEDUCTIBLE_ASSETS)]),
    R("F5_2_3", "Vat", "Achats soumis a la TVA - achat d'equipements importes", "2.3"),
    R("F5_2_4", "Vat", "Achats soumis a la TVA - autres achats locaux", "2.4",
      withheld="Account", withheld_side="Debit", withheld_accounts=[acc(VAT_DEDUCTIBLE_GOODS)]),
    R("F5_2_5", "Vat", "Achats soumis a la TVA - autres achats importes", "2.5"),
]

rubrics += [
    R("F6_1", "OtherTurnoverTaxes", "Fonds de developpement de la competitivite (FODEC)", "1",
      withheld="Account", withheld_accounts=[acc(FODEC)]),
]

rubrics += [
    R("F7_1", "StampDuty", "Droit de timbre sur factures", "1",
      withheld="Account", withheld_accounts=[acc(STAMP_ON_SALE)]),
]

rubrics += [
    R("F8_1", "HotelTax", "Taxe hoteliere", "1", withheld="GrossTimesRate", rate=2),
]

rubrics += [
    R("F9_3_1", "Tcl", "Le chiffre d'affaires brut local", "3.1", withheld="GrossTimesRate", rate=0.2),
    R("F9_3_2", "Tcl", "Le chiffre d'affaires des societes totalement exportatrices", "3.2", withheld="GrossTimesRate", rate=0.1),
]

rubrics += [
    R("F10_1", "LicenceFee", "Droit de licence sur les debits de boissons", "1"),
]

rubrics += [
    R("F11_1", "OtherInformation", "Achats en suspension de la TVA", "1"),
    R("F11_2", "OtherInformation", "Achats en suspension de la TVA au titre des biens et equipements entrant dans les composantes des marches realises a l'etranger", "2"),
    R("F11_3", "OtherInformation", "Achats exoneres", "3"),
    R("F11_4", "OtherInformation", "Les achats de la part des non assujettis a la TVA", "4"),
    R("F11_5", "OtherInformation", "Autres achats net de TVA soumis a la TVA et ne donnant pas droit a la deduction", "5"),
    R("F11_6", "OtherInformation", "Exportation de marchandises et de services", "6"),
    R("F11_7", "OtherInformation", "Ventes en suspension de TVA", "7"),
    R("F11_8", "OtherInformation", "Chiffre d'affaires exonere de la TVA", "8"),
]

for i, r in enumerate(rubrics):
    r["displayOrder"] = i

doc = {
    "catalogVersion": "tn-2026-v1",
    "_note": (
        "Catalogue standard des rubriques de la declaration mensuelle (Tunisie). Amorce par "
        "MonthlyDeclarationRubricInitializer : insertion seule par code, jamais de mise a jour ni "
        "de suppression. Les familles restent NON INCLUSES par defaut : rien n'est calcule tant "
        "qu'un dossier ne les coche pas. Les taux et les comptes sont des valeurs de depart, a "
        "confirmer dossier par dossier avant toute bascule."
    ),
    "rubrics": rubrics,
}

out = json.dumps(doc, ensure_ascii=False, indent=2) + "\n"
path = "src/Backend/FactuTrust.Infrastructure/Resources/Accounting/monthly-declaration-rubrics-tn.json"
with io.open(path, "w", encoding="utf-8", newline="\r\n") as f:
    f.write(out)
print("rubriques:", len(rubrics))

# ── Catalogue v2 : le calcul historique reproduit par la configuration ─────────
#
# La v1 ci-dessus reste la REFERENCE : c'est a elle que la montee compare chaque rubrique d'un
# dossier pour savoir si le comptable l'a retouchee. Elle ne doit donc jamais changer.
#
# La v2 reprend la v1 et ne modifie que les rubriques qui, en v1, ne reproduisaient pas le calcul
# historique. Les taux legaux des rubriques de retenue a la source sont conserves a titre
# informatif : leur retenue vient desormais du rapport RS, pas d'un taux.
import copy

def documents(r, gross=None, withheld=None):
    if gross:
        r["grossKind"] = "Document"
        r["grossDocumentSource"] = gross
        r["grossAccounts"] = []
    if withheld:
        r["withheldKind"] = "Document"
        r["withheldDocumentSource"] = withheld
        r["withheldAccounts"] = []
    return r

def payroll_both(r, gross_component, withheld_component):
    r["grossKind"] = "Payroll"
    r["payrollComponent"] = gross_component
    r["withheldKind"] = "Payroll"
    r["withheldPayrollComponent"] = withheld_component
    return r

RS = {  # code -> compartiment du rapport RS (partition de WithholdingReportPartition)
    "F1_4_2": "CommissionsAndRents",
    "F1_5": "FeesOther",
    "F1_6": "FeesRealRegime",
    "F1_10": "CapitalIncome",
    "F1_12": "Dividends",
    "F1_16": "RealEstate",
    "F1_17_1": "PurchasesRate1",
    "F1_17_2": "PurchasesRate05",
    "F1_17_3": "PurchasesRate15",
    "F1_18": "VatOther",
    "F1_19": "VatFull",
    "F1_24": "CapitalGains",
    "F1_25": "NonResidents",
}

v2 = []
for r in copy.deepcopy(rubrics):
    code = r["code"]
    if code in RS:
        bucket = RS[code]
        documents(r, gross="Withholding%sBase" % bucket, withheld="Withholding%sAmount" % bucket)
    elif code == "F2_1":
        payroll_both(r, "PayrollTaxBaseManufacturing", "TfpManufacturing")
    elif code == "F2_2":
        payroll_both(r, "PayrollTaxBaseOtherActivities", "TfpOtherActivities")
    elif code == "F3_1":
        r["withheldKind"] = "Payroll"
        r["withheldPayrollComponent"] = "Foprolos"
    elif code == "F6_1":
        documents(r, gross="FodecFormBase", withheld="FodecAmount")
    elif code == "F7_1":
        r["fixedGrossAmount"] = 0
        documents(r, withheld="FiscalStampAmount")
    elif code == "F9_3_1":
        # Le taux est celui de la plateforme au moment de la montee (AccountingSettings), pas 0,2 %
        # en dur : c'est lui que le calcul historique applique.
        documents(r, gross="SalesGrossBase")
    v2.append(r)

    if code == "F1_1":
        new = R("F1_1_RS", "Withholding",
                "Traitements et salaires retenus hors cycle de paie (rapport de retenue a la source)", "1")
        documents(new, gross="WithholdingSalariesBase", withheld="WithholdingSalariesAmount")
        new["displayOrder"] = r["displayOrder"]
        v2.append(new)
    if code == "F1_25":
        new = R("F1_RS_AUTRES", "Withholding",
                "Autres retenues a la source du rapport, sans ligne dediee (jeux, autres categories, taux non reconnus)", "*")
        documents(new, gross="WithholdingRemainderBase", withheld="WithholdingRemainderAmount")
        new["displayOrder"] = r["displayOrder"]
        v2.append(new)

doc_v2 = {
    "catalogVersion": "tn-2026-v2",
    "_note": (
        "Catalogue v2 : reproduit le calcul historique par la configuration (origine documents, TFP "
        "par activite, FOPROLOS de la paie). Applique par MonthlyDeclarationCatalogUpgrade, famille "
        "par famille, aux seules familles dont toutes les rubriques v1 sont intactes ; jamais aux "
        "rubriques retouchees par le comptable."
    ),
    "rubrics": v2,
}

out_v2 = json.dumps(doc_v2, ensure_ascii=False, indent=2) + "\n"
path_v2 = "src/Backend/FactuTrust.Infrastructure/Resources/Accounting/monthly-declaration-rubrics-tn-v2.json"
with io.open(path_v2, "w", encoding="utf-8", newline="\r\n") as f:
    f.write(out_v2)
print("rubriques v2:", len(v2))
