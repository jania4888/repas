using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;

namespace FactuTrust.Domain.Entities;

/// <summary>
/// Monthly VAT declaration snapshot (Tunisia).
/// </summary>
public sealed class VatDeclaration : AggregateRoot
{
    public int Year { get; private set; }
    public int Month { get; private set; }
    public Money CollectedVat19 { get; private set; } = null!;
    public Money CollectedVat13 { get; private set; } = null!;
    public Money CollectedVat7 { get; private set; } = null!;
    public Money DeductibleVatGoods { get; private set; } = null!;
    public Money DeductibleVatAssets { get; private set; } = null!;
    public Money PreviousCredit { get; private set; } = null!;
    public Money VatDue { get; private set; } = null!;
    public Money CreditToCarry { get; private set; } = null!;
    public VatDeclarationStatus Status { get; private set; }
    public DateTime? SubmittedAt { get; private set; }
    public DateTime? LockedAt { get; private set; }

    // ── Déclaration mensuelle unique (V2) : autres taxes de la même déclaration (en TND). ──
    /// <summary>FODEC (Fonds de Développement de la Compétitivité) — 1 % sur certaines assiettes.</summary>
    public decimal Fodec { get; private set; }
    /// <summary>Droit de timbre (sur factures).</summary>
    public decimal DroitTimbre { get; private set; }
    /// <summary>TCL (Taxe sur les établissements à caractère industriel, commercial ou professionnel).</summary>
    public decimal Tcl { get; private set; }
    /// <summary>TFP (Taxe de Formation Professionnelle) — assise sur les salaires, proposée depuis le cycle de paie validé du mois.</summary>
    public decimal Tfp { get; private set; }
    /// <summary>FOPROLOS (Fonds de Promotion des Logements pour Salariés) — assis sur les salaires, même source que la TFP.</summary>
    public decimal Foprolos { get; private set; }
    /// <summary>
    /// Retenues à la source opérées durant la période : factures fournisseurs (module RS) et
    /// traitements et salaires (IRPP + CSS du cycle de paie). Seul le total est déposé.
    /// </summary>
    public decimal WithholdingTax { get; private set; }
    /// <summary>Acomptes provisionnels (IS) déduits du total à payer.</summary>
    public decimal Acomptes { get; private set; }

    // ── Familles sans ligne dédiée avant la déclaration paramétrable ──────────
    // Le formulaire officiel a leurs cases depuis toujours ; le domaine ne les portait pas, faute
    // d'une source de calcul. Elles valent 0 pour tout dossier resté en calcul historique, ce qui
    // laisse « TotalToPay » inchangé à l'octet près.

    /// <summary>Droit de consommation.</summary>
    public decimal ConsumptionDuty { get; private set; }

    /// <summary>Taxe hôtelière.</summary>
    public decimal HotelTax { get; private set; }

    /// <summary>Droit de licence.</summary>
    public decimal LicenceFee { get; private set; }

    /// <summary>Version de la déclaration : 1 = initiale ; incrémentée à chaque rectificative.</summary>
    public int RevisionNumber { get; private set; } = 1;
    /// <summary>Vrai si la déclaration est une rectificative (au moins une révision appliquée).</summary>
    public bool IsRectificative { get; private set; }

    /// <summary>
    /// Calcul qui a produit la déclaration lors de son dernier enregistrement. C'est lui, et non le
    /// régime actuel du dossier, qui dit d'où viennent les montants d'un dépôt : une déclaration
    /// déposée sous le calcul historique le reste, quelle que soit la configuration d'aujourd'hui.
    /// </summary>
    public DeclarationCalculationOrigin CalculationOrigin { get; private set; } = DeclarationCalculationOrigin.Historic;

    /// <summary>Consigne le calcul qui vient de produire les montants enregistrés.</summary>
    public void SetCalculationOrigin(DeclarationCalculationOrigin origin)
    {
        if (!Enum.IsDefined(origin))
            throw new ArgumentOutOfRangeException(nameof(origin), origin, "Origine de calcul inconnue.");

        CalculationOrigin = origin;
    }

    private readonly List<VatDeclarationLine> _lines = new();

    /// <summary>
    /// Détail par rubrique figé au dépôt. Vide pour une déclaration produite par le calcul
    /// historique : il n'y a alors pas de rubrique à consigner.
    /// </summary>
    public IReadOnlyCollection<VatDeclarationLine> Lines => _lines.AsReadOnly();

    private VatDeclaration() { }

    public static VatDeclaration CreateDraft(
        int year,
        int month,
        Money collected19,
        Money collected13,
        Money collected7,
        Money deductibleGoods,
        Money deductibleAssets,
        Money previousCredit,
        string currency = Money.DefaultCurrency)
    {
        var sumCollected = collected19.Amount + collected13.Amount + collected7.Amount;
        var sumDed = deductibleGoods.Amount + deductibleAssets.Amount + previousCredit.Amount;
        var (vatDue, creditCarry) = ComputeNet(sumCollected, sumDed, currency);

        return new VatDeclaration
        {
            Year = year,
            Month = month,
            CollectedVat19 = collected19,
            CollectedVat13 = collected13,
            CollectedVat7 = collected7,
            DeductibleVatGoods = deductibleGoods,
            DeductibleVatAssets = deductibleAssets,
            PreviousCredit = previousCredit,
            VatDue = vatDue,
            CreditToCarry = creditCarry,
            Status = VatDeclarationStatus.Draft
        };
    }

    public void Submit()
    {
        if (Status != VatDeclarationStatus.Draft)
            return;
        Status = VatDeclarationStatus.Submitted;
        SubmittedAt = DateTime.UtcNow;
    }

    public void Lock()
    {
        Status = VatDeclarationStatus.Locked;
        LockedAt = DateTime.UtcNow;
    }

    /// <summary>Renseigne les autres taxes de la déclaration mensuelle unique (montants négatifs ramenés à 0).</summary>
    public void SetAdditionalTaxes(
        decimal fodec, decimal droitTimbre, decimal tcl, decimal tfp,
        decimal foprolos, decimal withholdingTax, decimal acomptes)
    {
        Fodec = Math.Max(0m, fodec);
        DroitTimbre = Math.Max(0m, droitTimbre);
        Tcl = Math.Max(0m, tcl);
        Tfp = Math.Max(0m, tfp);
        Foprolos = Math.Max(0m, foprolos);
        WithholdingTax = Math.Max(0m, withholdingTax);
        Acomptes = Math.Max(0m, acomptes);
    }

    /// <summary>
    /// Renseigne les familles que seul le moteur paramétré sait produire (droit de consommation,
    /// taxe hôtelière, droit de licence). Méthode distincte de
    /// <see cref="SetAdditionalTaxes(decimal, decimal, decimal, decimal, decimal, decimal, decimal)"/>
    /// pour que le chemin historique n'ait pas à la connaître : un appelant qui ne l'invoque pas
    /// laisse les trois montants à zéro, et le total à payer strictement inchangé.
    /// </summary>
    public void SetConfiguredFamilyTaxes(decimal consumptionDuty, decimal hotelTax, decimal licenceFee)
    {
        ConsumptionDuty = Math.Max(0m, consumptionDuty);
        HotelTax = Math.Max(0m, hotelTax);
        LicenceFee = Math.Max(0m, licenceFee);
    }

    /// <summary>
    /// Applique une rectificative EN PLACE : recalcule la TVA à partir des nouveaux montants, met à jour
    /// les autres taxes, incrémente la version, repasse en brouillon (re-soumission possible).
    /// </summary>
    public void ApplyRevision(
        Money collected19, Money collected13, Money collected7,
        Money deductibleGoods, Money deductibleAssets, Money previousCredit,
        decimal fodec, decimal droitTimbre, decimal tcl, decimal tfp,
        decimal foprolos, decimal withholdingTax, decimal acomptes)
    {
        var currency = collected19.Currency;
        CollectedVat19 = collected19;
        CollectedVat13 = collected13;
        CollectedVat7 = collected7;
        DeductibleVatGoods = deductibleGoods;
        DeductibleVatAssets = deductibleAssets;
        PreviousCredit = previousCredit;

        var sumCollected = collected19.Amount + collected13.Amount + collected7.Amount;
        var sumDed = deductibleGoods.Amount + deductibleAssets.Amount + previousCredit.Amount;
        (VatDue, CreditToCarry) = ComputeNet(sumCollected, sumDed, currency);

        SetAdditionalTaxes(fodec, droitTimbre, tcl, tfp, foprolos, withholdingTax, acomptes);

        RevisionNumber += 1;
        IsRectificative = true;
        Status = VatDeclarationStatus.Draft;
        SubmittedAt = null;
        LockedAt = null;
    }

    /// <summary>
    /// Met à jour un BROUILLON en place : recalcule la TVA à partir des montants fournis (recalculés
    /// depuis les écritures) sans sémantique rectificative — <see cref="RevisionNumber"/>,
    /// <see cref="IsRectificative"/> et <see cref="Status"/> restent inchangés. Les autres taxes sont
    /// posées séparément via <see cref="SetAdditionalTaxes"/>. Refuse si la déclaration n'est plus au
    /// statut brouillon (une déclaration soumise se corrige par rectificative).
    /// </summary>
    public Result UpdateDraft(
        Money collected19, Money collected13, Money collected7,
        Money deductibleGoods, Money deductibleAssets, Money previousCredit)
    {
        if (Status != VatDeclarationStatus.Draft)
            return Result.Failure(Error.Validation("Status",
                "Seul un brouillon peut être mis à jour ; une déclaration soumise se corrige par rectificative."));

        var currency = collected19.Currency;
        CollectedVat19 = collected19;
        CollectedVat13 = collected13;
        CollectedVat7 = collected7;
        DeductibleVatGoods = deductibleGoods;
        DeductibleVatAssets = deductibleAssets;
        PreviousCredit = previousCredit;

        var sumCollected = collected19.Amount + collected13.Amount + collected7.Amount;
        var sumDed = deductibleGoods.Amount + deductibleAssets.Amount + previousCredit.Amount;
        (VatDue, CreditToCarry) = ComputeNet(sumCollected, sumDed, currency);

        return Result.Success();
    }

    /// <summary>
    /// Remplace le détail par rubrique de la déclaration.
    /// </summary>
    /// <remarks>
    /// Purge puis réinsertion, plutôt qu'un rapprochement ligne à ligne : le détail est un
    /// instantané, pas un objet qu'on modifie. Une rectificative en produit un nouveau, et
    /// <see cref="RevisionNumber"/> suffit à distinguer les versions — un historique de lignes
    /// ferait double emploi avec le journal d'audit.
    /// </remarks>
    public void ReplaceLines(IReadOnlyList<VatDeclarationLine>? lines)
    {
        _lines.Clear();
        if (lines is null)
            return;

        foreach (var line in lines)
        {
            line.AttachTo(Id);
            _lines.Add(line);
        }
    }

    /// <summary>Calcule (TVA due, crédit à reporter) : si le net est positif, TVA due ; sinon, crédit reporté.</summary>
    private static (Money VatDue, Money CreditToCarry) ComputeNet(decimal sumCollected, decimal sumDeductible, string currency)
    {
        var net = sumCollected - sumDeductible;
        return net >= 0
            ? (Money.Create(net, currency), Money.Zero(currency))
            : (Money.Zero(currency), Money.Create(-net, currency));
    }
}
