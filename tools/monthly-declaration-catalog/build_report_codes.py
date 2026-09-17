# -*- coding: utf-8 -*-
"""Genere la carte code rapport -> cases du formulaire officiel (millesime 2026)."""
import json, io

def T(family, code, base, amount, recap):
    return {"family": family, "reportCode": code, "base": base, "amount": amount, "recap": recap}

targets = []

# Retenue a la source : articles numerotes du formulaire.
withholding = [
    ("1", "Line1"), ("3", "Line3"),
    ("4.1", "Line4Individuals"), ("4.2", "Line4Entities"),
    ("5", "Line5"), ("6", "Line6"), ("8", "Line8"),
    ("10", "Line10"), ("12", "Line12"), ("16", "Line16"),
    ("17.1", "Line17Rate1"), ("17.2", "Line17Rate05"), ("17.3", "Line17Rate15"),
    ("18", "Line18"), ("19", "Line19"), ("24", "Line24"), ("25", "Line25"),
]
for code, line in withholding:
    targets.append(T("Withholding", code,
                     f"Withholding.{line}.Base", f"Withholding.{line}.Amount", "Withholding"))

# T.F.P : deux lignes exclusives (1 % industries manufacturieres, 2 % autres activites).
targets.append(T("Tfp", "1", "Tfp.Manufacturing.Base", "Tfp.Manufacturing.Amount", "Tfp"))
targets.append(T("Tfp", "2", "Tfp.Other.Base", "Tfp.Other.Amount", "Tfp"))

targets.append(T("Foprolos", "1", "Foprolos.Base", "Foprolos.Amount", "Foprolos"))

# T.V.A : suffixes propres a la famille (Due cote collecte, Deductible cote achats).
for code, rate in [("1.1", "Rate7"), ("1.2", "Rate13"), ("1.3", "Rate19")]:
    targets.append(T("Vat", code, f"Vat.{rate}.Base", f"Vat.{rate}.Due", "Vat"))
for code, kind in [("2.1", "RealEstate"), ("2.2", "EquipmentLocal"), ("2.3", "EquipmentImported"),
                   ("2.4", "OtherLocal"), ("2.5", "OtherImported")]:
    targets.append(T("Vat", code, f"Vat.Purchase.{kind}.Base", f"Vat.Purchase.{kind}.Deductible", "Vat"))

targets.append(T("OtherTurnoverTaxes", "1", "Fodec.Base", "Fodec.Amount", "OtherDuties"))

# Familles sans case de detail dans le millesime 2026 : seul le recapitulatif les recoit.
# "*" vaut repli de famille, quel que soit le code rapport de la rubrique.
for family, recap in [("ConsumptionDuty", "ConsumptionDuty"), ("StampDuty", "StampDuty"),
                      ("HotelTax", "HotelTax"), ("Tcl", "Tcl"), ("LicenceFee", "LicenceFee")]:
    targets.append(T(family, "*", None, None, recap))

doc = {
    "formVersion": "mensuelle-2026",
    "_note": (
        "Correspondance code rapport -> cases du formulaire officiel. Le code rapport est celui que "
        "le comptable lit sur le formulaire ; les cles de cases appartiennent au millesime et vivent "
        "donc ici, PAS dans la configuration des dossiers. Un nouveau millesime se traite en "
        "remplacant le triplet (gabarit PDF, carte geometrique, cette carte). "
        "reportCode '*' = repli de famille : la famille n'a pas de case de detail dans ce millesime, "
        "son montant ne rejoint que la ligne du recapitulatif. "
        "La famille OtherInformation est absente a dessein : declarative, elle ne porte aucun "
        "montant a payer et n'a pas de case calibree."
    ),
    "targets": targets,
}

out = json.dumps(doc, ensure_ascii=False, indent=2) + "\n"
path = "src/Backend/FactuTrust.Application/Features/Accounting/OfficialForm/Builtin/mensuelle-2026.report-codes.json"
import os
os.makedirs(os.path.dirname(path), exist_ok=True)
with io.open(path, "w", encoding="utf-8", newline="\r\n") as f:
    f.write(out)
print("cibles:", len(targets))
