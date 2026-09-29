namespace FactuTrust.Application.DTOs;

/// <summary>
/// Rapport de parité : pour chaque mois, le calcul historique face au calcul paramétré tel qu'il
/// sera une fois l'historique retiré. C'est la preuve exigée avant ce retrait — à exporter et
/// archiver, car elle ne sera plus régénérable ensuite.
/// </summary>
public sealed record MonthlyDeclarationParityReportDto
{
    public int Year { get; init; }
    public int FromMonth { get; init; }
    public int ToMonth { get; init; }

    public DateTime GeneratedAtUtc { get; init; }
    public string GeneratedBy { get; init; } = string.Empty;
    public string CompanyName { get; init; } = string.Empty;
    public string Nif { get; init; } = string.Empty;

    public IReadOnlyList<MonthlyDeclarationParityMonthDto> Months { get; init; } =
        Array.Empty<MonthlyDeclarationParityMonthDto>();

    /// <summary>Mois identiques au millime, familles et cases du formulaire.</summary>
    public int ExactMonths { get; init; }

    /// <summary>Mois dont les seuls écarts sont prouvés dus à la règle d'arrondi.</summary>
    public int RoundingOnlyMonths { get; init; }

    /// <summary>Mois portant au moins un écart non expliqué, ou non calculés.</summary>
    public int MonthsWithGap { get; init; }

    /// <summary>Aucun écart hors arrondi prouvé sur la plage contrôlée.</summary>
    public bool ReadyForRetirement { get; init; }
}

/// <summary>Verdict d'une comparaison : 0 = identique, 1 = arrondi prouvé, 2 = écart.</summary>
public sealed record MonthlyDeclarationParityMonthDto
{
    public int Month { get; init; }

    /// <summary>Statut de la déclaration enregistrée pour ce mois, <c>null</c> si aucune.</summary>
    public int? SavedStatus { get; init; }

    public int Verdict { get; init; }

    /// <summary>Motif, quand le mois n'a pas pu être calculé.</summary>
    public string? Error { get; init; }

    public IReadOnlyList<MonthlyDeclarationParityFamilyDto> Families { get; init; } =
        Array.Empty<MonthlyDeclarationParityFamilyDto>();

    /// <summary>Cases du formulaire officiel qui diffèrent — seulement celles-là.</summary>
    public IReadOnlyList<MonthlyDeclarationParityBoxDto> BoxDifferences { get; init; } =
        Array.Empty<MonthlyDeclarationParityBoxDto>();

    /// <summary>Signalements du calcul paramétré (famille sans rubrique, double lecture…).</summary>
    public IReadOnlyList<MonthlyDeclarationDiagnosticDto> Diagnostics { get; init; } =
        Array.Empty<MonthlyDeclarationDiagnosticDto>();
}

public sealed record MonthlyDeclarationParityFamilyDto
{
    public int Family { get; init; }

    /// <summary>Famille cochée dans la configuration. Non cochée, elle vaudra 0 après le retrait.</summary>
    public bool IsIncluded { get; init; }

    public decimal Legacy { get; init; }
    public decimal Configured { get; init; }

    /// <summary>Paramétré − historique.</summary>
    public decimal Gap { get; init; }

    public int Verdict { get; init; }
}

public sealed record MonthlyDeclarationParityBoxDto
{
    /// <summary>Clé de la case dans la carte du millésime (« Withholding.Line5.Amount »).</summary>
    public string Key { get; init; } = string.Empty;

    /// <summary>Valeur telle que tamponnée ; <c>null</c> = case vide.</summary>
    public string? Legacy { get; init; }
    public string? Configured { get; init; }

    public int Verdict { get; init; }
}
