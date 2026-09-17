using System.Text.RegularExpressions;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Domain.Entities;

/// <summary>
/// Compte sélectionné sur une colonne d'une rubrique, tel que l'écran le transmet.
/// </summary>
public sealed record RubricAccountInput(
    RubricAccountRole Role, string AccountNumber, RubricAccountMatchMode MatchMode);

/// <summary>
/// Rubrique paramétrable de la déclaration mensuelle : une ligne d'un onglet de l'écran
/// « Configuration DM », et la règle qui produit ses deux colonnes — montant brut et retenue —
/// pour une période donnée.
/// </summary>
/// <remarks>
/// <para>
/// <b>Une rubrique ne référence jamais une autre rubrique.</b> C'est la décision de conception
/// centrale : elle supprime le graphe de dépendances, donc la récursion, l'ordre d'évaluation
/// inter-lignes et la détection de cycle à l'exécution. Les seules dépendances possibles sont
/// internes à la rubrique, entre ses deux colonnes, et le seul cycle qu'elles peuvent former est
/// refusé à l'écriture.
/// </para>
/// <para>
/// L'entité ne calcule rien : elle décrit. L'évaluation vit dans
/// <c>MonthlyDeclarationRubricEvaluator</c>, fonction pure sans accès aux données.
/// </para>
/// </remarks>
public sealed class MonthlyDeclarationRubric : AggregateRoot
{
    public const int MaxCodeLength = 20;
    public const int MaxLabelLength = 200;
    public const int MaxReportCodeLength = 16;

    /// <summary>
    /// Plafond de comptes par (rubrique, rôle). Sans plafond, « une centaine de rubriques » n'est
    /// qu'une intention : c'est lui qui garantit que l'union des comptes reste très en deçà de la
    /// limite de paramètres d'une requête.
    /// </summary>
    public const int MaxAccountsPerRole = 20;

    private static readonly Regex CodeRegex =
        new("^[A-Z0-9_]{1,20}$", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    /// <summary>Code rapport : « 1 », « 4.1 », « 17.2 », ou « * » (repli de famille).</summary>
    private static readonly Regex ReportCodeRegex =
        new(@"^(?:\*|[0-9]+(?:\.[0-9]+)*)$", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    public MonthlyDeclarationFamily Family { get; private set; }

    /// <summary>Code interne de la rubrique (« F5_1_3 »), unique dans le dossier.</summary>
    public string Code { get; private set; } = null!;

    public string Label { get; private set; } = null!;

    /// <summary>
    /// Code de la ligne sur le formulaire officiel. Volontairement <b>non unique</b> : plusieurs
    /// rubriques peuvent alimenter une même ligne réglementaire — la ventilation existante cumule
    /// déjà commissions et loyers sur l'article 4.
    /// </summary>
    public string ReportCode { get; private set; } = null!;

    public RubricGrossKind GrossKind { get; private set; }
    public RubricWithheldKind WithheldKind { get; private set; }
    public AccountBalanceSide GrossSide { get; private set; }
    public AccountBalanceSide WithheldSide { get; private set; }

    /// <summary>Taux en pourcentage. 100 est admis : l'article 19 retient 100 % de la TVA.</summary>
    public decimal RatePercent { get; private set; }

    /// <summary>
    /// Constante de la colonne brut quand <see cref="GrossKind"/> vaut <c>Fixed</c>.
    /// <c>null</c> ne vaut pas zéro : il signifie « à saisir au Calcul DM ». Cette distinction est
    /// le seul moyen de dire qu'une ligne attend une valeur plutôt que d'en porter une nulle.
    /// </summary>
    public decimal? FixedGrossAmount { get; private set; }

    /// <summary>Même convention que <see cref="FixedGrossAmount"/>, pour la colonne retenue.</summary>
    public decimal? FixedWithheldAmount { get; private set; }

    /// <summary>Valeur de paie de la colonne brut ; obligatoire si et seulement si le brut est de type paie.</summary>
    public PayrollContributionComponent? PayrollComponent { get; private set; }

    /// <summary>
    /// Valeur de paie de la colonne retenue ; obligatoire si et seulement si la retenue est de type
    /// paie. Distincte de <see cref="PayrollComponent"/> : l'article 1 lit le net imposable en brut
    /// et l'IRPP en retenue, l'article 3 le même net imposable et la CSS.
    /// </summary>
    public PayrollContributionComponent? WithheldPayrollComponent { get; private set; }

    /// <summary>
    /// Premier jour d'application. Absent de la maquette d'origine, ajouté délibérément : sans date
    /// de début, corriger un taux écraserait la règle qui a produit les déclarations passées.
    /// </summary>
    public DateTime? EffectiveFrom { get; private set; }

    /// <summary>Dernier jour d'application (« Maximum date d'application »).</summary>
    public DateTime? EffectiveTo { get; private set; }

    public bool IsActive { get; private set; }
    public int DisplayOrder { get; private set; }

    private readonly List<MonthlyDeclarationRubricAccount> _accounts = new();
    public IReadOnlyCollection<MonthlyDeclarationRubricAccount> Accounts => _accounts.AsReadOnly();

    private MonthlyDeclarationRubric() { }

    public static Result<MonthlyDeclarationRubric> Create(
        MonthlyDeclarationFamily family,
        string? code,
        string? label,
        string? reportCode,
        RubricGrossKind grossKind,
        RubricWithheldKind withheldKind,
        AccountBalanceSide grossSide,
        AccountBalanceSide withheldSide,
        decimal ratePercent,
        decimal? fixedGrossAmount,
        decimal? fixedWithheldAmount,
        PayrollContributionComponent? payrollComponent,
        PayrollContributionComponent? withheldPayrollComponent,
        DateTime? effectiveFrom,
        DateTime? effectiveTo,
        IReadOnlyList<RubricAccountInput>? accounts,
        int displayOrder = 0)
    {
        var rubric = new MonthlyDeclarationRubric { IsActive = true };
        var applied = rubric.Apply(
            family, code, label, reportCode, grossKind, withheldKind, grossSide, withheldSide,
            ratePercent, fixedGrossAmount, fixedWithheldAmount, payrollComponent, withheldPayrollComponent,
            effectiveFrom, effectiveTo, accounts, displayOrder);

        return applied.IsFailure
            ? Result.Failure<MonthlyDeclarationRubric>(applied.Error)
            : Result.Success(rubric);
    }

    /// <summary>
    /// Met à jour la rubrique. La famille et le code ne sont pas modifiables : le code est la clé
    /// qui relie la rubrique à ses lignes déjà déposées, et changer de famille reviendrait à
    /// déplacer un montant d'un impôt à un autre sous le même identifiant.
    /// </summary>
    public Result Update(
        string? label,
        string? reportCode,
        RubricGrossKind grossKind,
        RubricWithheldKind withheldKind,
        AccountBalanceSide grossSide,
        AccountBalanceSide withheldSide,
        decimal ratePercent,
        decimal? fixedGrossAmount,
        decimal? fixedWithheldAmount,
        PayrollContributionComponent? payrollComponent,
        PayrollContributionComponent? withheldPayrollComponent,
        DateTime? effectiveFrom,
        DateTime? effectiveTo,
        IReadOnlyList<RubricAccountInput>? accounts,
        int displayOrder)
        => Apply(
            Family, Code, label, reportCode, grossKind, withheldKind, grossSide, withheldSide,
            ratePercent, fixedGrossAmount, fixedWithheldAmount, payrollComponent, withheldPayrollComponent,
            effectiveFrom, effectiveTo, accounts, displayOrder);

    public void ToggleActive() => IsActive = !IsActive;

    /// <summary>
    /// La rubrique s'applique-t-elle au mois déclaré ?
    /// </summary>
    /// <remarks>
    /// Une rubrique dont la date maximale tombe le 15 juin s'applique à <b>tout</b> le mois de juin.
    /// Le choix est assumé : la déclaration a une maille mensuelle, et proratiser un mois
    /// inventerait une règle dont le formulaire n'a pas la case.
    /// </remarks>
    public bool IsApplicableTo(int year, int month)
    {
        var periodStart = new DateTime(year, month, 1);
        var periodEnd = periodStart.AddMonths(1).AddDays(-1);

        return IsActive
            && (EffectiveFrom is null || EffectiveFrom.Value.Date <= periodEnd)
            && (EffectiveTo is null || EffectiveTo.Value.Date >= periodStart);
    }

    /// <summary>Comptes d'un rôle donné, dans l'ordre de saisie.</summary>
    public IReadOnlyList<MonthlyDeclarationRubricAccount> AccountsFor(RubricAccountRole role) =>
        _accounts.Where(a => a.Role == role).ToList();

    // ── Interne ───────────────────────────────────────────────────────────────

    private Result Apply(
        MonthlyDeclarationFamily family,
        string? code,
        string? label,
        string? reportCode,
        RubricGrossKind grossKind,
        RubricWithheldKind withheldKind,
        AccountBalanceSide grossSide,
        AccountBalanceSide withheldSide,
        decimal ratePercent,
        decimal? fixedGrossAmount,
        decimal? fixedWithheldAmount,
        PayrollContributionComponent? payrollComponent,
        PayrollContributionComponent? withheldPayrollComponent,
        DateTime? effectiveFrom,
        DateTime? effectiveTo,
        IReadOnlyList<RubricAccountInput>? accounts,
        int displayOrder)
    {
        var normalizedCode = (code ?? string.Empty).Trim().ToUpperInvariant();
        var normalizedLabel = (label ?? string.Empty).Trim();
        var normalizedReportCode = (reportCode ?? string.Empty).Trim();
        var inputs = accounts ?? Array.Empty<RubricAccountInput>();

        var validation = Validate(
            family, normalizedCode, normalizedLabel, normalizedReportCode, grossKind, withheldKind,
            ratePercent, payrollComponent, withheldPayrollComponent, effectiveFrom, effectiveTo, inputs);
        if (validation.IsFailure)
            return validation;

        var built = BuildAccounts(inputs);
        if (built.IsFailure)
            return Result.Failure(built.Error);

        Family = family;
        Code = normalizedCode;
        Label = normalizedLabel;
        ReportCode = normalizedReportCode;
        GrossKind = grossKind;
        WithheldKind = withheldKind;
        GrossSide = grossSide;
        WithheldSide = withheldSide;
        RatePercent = ratePercent;
        FixedGrossAmount = fixedGrossAmount;
        FixedWithheldAmount = fixedWithheldAmount;
        PayrollComponent = grossKind == RubricGrossKind.Payroll ? payrollComponent : null;
        WithheldPayrollComponent = withheldKind == RubricWithheldKind.Payroll ? withheldPayrollComponent : null;
        EffectiveFrom = effectiveFrom?.Date;
        EffectiveTo = effectiveTo?.Date;
        DisplayOrder = displayOrder;

        ReplaceAccounts(built.Value);
        return Result.Success();
    }

    private static Result Validate(
        MonthlyDeclarationFamily family,
        string code,
        string label,
        string reportCode,
        RubricGrossKind grossKind,
        RubricWithheldKind withheldKind,
        decimal ratePercent,
        PayrollContributionComponent? payrollComponent,
        PayrollContributionComponent? withheldPayrollComponent,
        DateTime? effectiveFrom,
        DateTime? effectiveTo,
        IReadOnlyList<RubricAccountInput> accounts)
    {
        if (!Enum.IsDefined(family))
            return Result.Failure(Error.Validation("Family", "Famille de déclaration inconnue."));

        if (string.IsNullOrEmpty(code))
            return Result.Failure(Error.Validation("Code", "Le code de la rubrique est obligatoire."));
        if (!CodeRegex.IsMatch(code))
        {
            return Result.Failure(Error.Validation(
                "Code",
                $"Le code « {code} » est invalide : lettres, chiffres et « _ » uniquement, "
                + $"{MaxCodeLength} caractères au plus."));
        }

        if (string.IsNullOrEmpty(label))
            return Result.Failure(Error.Validation("Label", "Le libellé est obligatoire."));
        if (label.Length > MaxLabelLength)
        {
            return Result.Failure(Error.Validation(
                "Label", $"Le libellé ne peut pas dépasser {MaxLabelLength} caractères."));
        }

        if (string.IsNullOrEmpty(reportCode))
            return Result.Failure(Error.Validation("ReportCode", "Le code rapport est obligatoire."));
        if (reportCode.Length > MaxReportCodeLength || !ReportCodeRegex.IsMatch(reportCode))
        {
            return Result.Failure(Error.Validation(
                "ReportCode",
                $"Le code rapport « {reportCode} » est invalide : chiffres séparés par des points "
                + "(ex. « 17.2 »), ou « * » pour un repli de famille."));
        }

        if (ratePercent < 0m || ratePercent > 100m)
            return Result.Failure(Error.Validation("RatePercent", "Le taux doit être compris entre 0 et 100 %."));

        // Le cycle brut ↔ retenue. Refusé à l'écriture plutôt que détecté à l'exécution : la
        // combinaison n'a aucune lecture fiscale, et un refus nommé vaut mieux qu'un montant nul
        // découvert le jour du dépôt.
        if (grossKind == RubricGrossKind.WithheldOverRate && withheldKind == RubricWithheldKind.GrossTimesRate)
        {
            return Result.Failure(Error.Validation(
                "GrossKind",
                "Combinaison impossible : le brut serait déduit de la retenue et la retenue déduite "
                + "du brut. Fixez l'une des deux colonnes."));
        }

        if (grossKind == RubricGrossKind.WithheldOverRate && ratePercent <= 0m)
        {
            return Result.Failure(Error.Validation(
                "RatePercent", "Un brut déduit de la retenue exige un taux strictement positif."));
        }

        if (withheldKind == RubricWithheldKind.GrossTimesRate && ratePercent <= 0m)
        {
            return Result.Failure(Error.Validation(
                "RatePercent", "Une retenue calculée « brut × taux » exige un taux strictement positif."));
        }

        if (grossKind == RubricGrossKind.Payroll && payrollComponent is null)
        {
            return Result.Failure(Error.Validation(
                "PayrollComponent",
                "Un brut issu de la paie doit désigner la valeur du cycle à reprendre."));
        }

        if (payrollComponent is { } component && !Enum.IsDefined(component))
            return Result.Failure(Error.Validation("PayrollComponent", "Valeur de paie inconnue."));

        if (withheldKind == RubricWithheldKind.Payroll && withheldPayrollComponent is null)
        {
            return Result.Failure(Error.Validation(
                "WithheldPayrollComponent",
                "Une retenue issue de la paie doit désigner la valeur du cycle à reprendre."));
        }

        if (withheldPayrollComponent is { } withheldComponent && !Enum.IsDefined(withheldComponent))
            return Result.Failure(Error.Validation("WithheldPayrollComponent", "Valeur de paie inconnue."));

        if (effectiveFrom is not null && effectiveTo is not null
            && effectiveFrom.Value.Date > effectiveTo.Value.Date)
        {
            return Result.Failure(Error.Validation(
                "EffectiveTo", "La date maximale d'application précède la date de début."));
        }

        return ValidateAccountRequirements(grossKind, withheldKind, accounts);
    }

    private static Result ValidateAccountRequirements(
        RubricGrossKind grossKind,
        RubricWithheldKind withheldKind,
        IReadOnlyList<RubricAccountInput> accounts)
    {
        foreach (var role in new[] { RubricAccountRole.Gross, RubricAccountRole.Withheld })
        {
            var field = role == RubricAccountRole.Gross ? "GrossAccounts" : "WithheldAccounts";
            var count = accounts.Count(a => a.Role == role);
            var required = role == RubricAccountRole.Gross
                ? grossKind == RubricGrossKind.Account
                : withheldKind == RubricWithheldKind.Account;

            if (required && count == 0)
            {
                var column = role == RubricAccountRole.Gross ? "brut" : "retenue";
                return Result.Failure(Error.Validation(
                    field, $"Un montant {column} calculé sur comptes exige au moins un compte."));
            }

            if (count > MaxAccountsPerRole)
            {
                return Result.Failure(Error.Validation(
                    field, $"Une colonne ne peut pas retenir plus de {MaxAccountsPerRole} comptes."));
            }
        }

        return ValidateNoOverlapWithinColumn(accounts);
    }

    /// <summary>
    /// Refuse qu'une même colonne compte deux fois le même mouvement.
    /// </summary>
    /// <remarks>
    /// Le doublon franc n'est que le cas facile. Le cas dangereux est le recouvrement : « 61 » en
    /// racine et « 611 » en compte exact sur la même colonne additionneraient 611 deux fois, sans
    /// que rien ne le signale. Le contrôle ne vaut qu'à l'intérieur d'une colonne : deux rubriques
    /// distinctes peuvent légitimement viser le même compte — une déclaration n'est pas une
    /// partition du plan comptable.
    /// </remarks>
    private static Result ValidateNoOverlapWithinColumn(IReadOnlyList<RubricAccountInput> accounts)
    {
        var normalized = accounts
            .Select(a => (a.Role, Number: (a.AccountNumber ?? string.Empty).Trim(), a.MatchMode))
            .ToList();

        for (var i = 0; i < normalized.Count; i++)
        {
            for (var j = 0; j < normalized.Count; j++)
            {
                if (i == j || normalized[i].Role != normalized[j].Role)
                    continue;

                var (_, left, leftMode) = normalized[i];
                var (_, right, _) = normalized[j];

                var duplicate = string.Equals(left, right, StringComparison.Ordinal) && i < j;
                var covered = leftMode == RubricAccountMatchMode.Prefix
                    && !string.Equals(left, right, StringComparison.Ordinal)
                    && right.StartsWith(left, StringComparison.Ordinal);

                if (duplicate)
                {
                    return Result.Failure(Error.Validation(
                        "Accounts", $"Compte en doublon sur la même colonne : « {left} »."));
                }

                if (covered)
                {
                    return Result.Failure(Error.Validation(
                        "Accounts",
                        $"Recouvrement sur la même colonne : « {right} » est déjà compris dans la "
                        + $"racine « {left} ». Le mouvement serait compté deux fois."));
                }
            }
        }

        return Result.Success();
    }

    private static Result<List<MonthlyDeclarationRubricAccount>> BuildAccounts(
        IReadOnlyList<RubricAccountInput> inputs)
    {
        var built = new List<MonthlyDeclarationRubricAccount>(inputs.Count);
        foreach (var input in inputs)
        {
            var account = MonthlyDeclarationRubricAccount.Create(
                input.Role, input.AccountNumber, input.MatchMode);
            if (account.IsFailure)
                return Result.Failure<List<MonthlyDeclarationRubricAccount>>(account.Error);

            built.Add(account.Value);
        }

        return Result.Success(built);
    }

    private void ReplaceAccounts(List<MonthlyDeclarationRubricAccount> accounts)
    {
        _accounts.Clear();
        foreach (var account in accounts)
        {
            account.AttachTo(Id);
            _accounts.Add(account);
        }
    }
}
