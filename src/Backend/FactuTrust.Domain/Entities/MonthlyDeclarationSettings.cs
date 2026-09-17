using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Domain.Entities;

/// <summary>
/// Régime de calcul de la déclaration mensuelle pour un dossier — singleton par tenant.
/// </summary>
/// <remarks>
/// <para>
/// L'absence de ligne vaut <see cref="MonthlyDeclarationMode.Legacy"/> : un dossier jamais
/// paramétré conserve exactement son calcul actuel, sans qu'aucune écriture soit nécessaire.
/// </para>
/// <para>
/// <b>Pourquoi une rampe et non une bascule.</b> Le moteur paramétré remplace le calcul câblé en
/// dur. Basculer sec transformerait toute rubrique oubliée en zéro silencieux — et un zéro
/// silencieux sur une déclaration part à la recette des finances. Le mode
/// <see cref="MonthlyDeclarationMode.Parity"/> fait tourner les deux calculs côte à côte sans rien
/// changer aux montants déclarés, jusqu'à ce que l'écart soit nul sur
/// <see cref="RequiredCleanParityPeriods"/> périodes consécutives.
/// </para>
/// </remarks>
public sealed class MonthlyDeclarationSettings : Entity
{
    /// <summary>Nombre de périodes consécutives sans écart exigé avant le passage en configuré.</summary>
    public const int RequiredCleanParityPeriods = 3;

    public const int MaxOverrideReasonLength = 500;

    public MonthlyDeclarationMode Mode { get; private set; } = MonthlyDeclarationMode.Legacy;

    /// <summary>
    /// Premier jour du mois à partir duquel le moteur paramétré fait foi. Les périodes antérieures
    /// restent calculées comme avant, de sorte qu'une déclaration ancienne rouverte se recalcule à
    /// l'identique.
    /// </summary>
    public DateTime? ConfiguredSince { get; private set; }

    /// <summary>Période du dernier contrôle de parité, au format <c>année × 100 + mois</c>.</summary>
    public int LastParityPeriodKey { get; private set; }

    public DateTime? LastParityRunAt { get; private set; }

    /// <summary>Écart maximal constaté au dernier contrôle, exprimé en millimes.</summary>
    public long LastParityMaxGapMillimes { get; private set; }

    /// <summary>Périodes consécutives sans écart accumulées à ce jour.</summary>
    public int ParityCleanStreak { get; private set; }

    public string? ParityOverrideBy { get; private set; }
    public string? ParityOverrideReason { get; private set; }

    private MonthlyDeclarationSettings() { }

    /// <summary>Réglage par défaut d'un dossier : calcul historique, aucun contrôle passé.</summary>
    public static MonthlyDeclarationSettings CreateDefault() => new();

    /// <summary>Le dossier remplit-il la condition de passage en mode configuré ?</summary>
    public bool CanSwitchToConfigured => ParityCleanStreak >= RequiredCleanParityPeriods;

    /// <summary>
    /// Enregistre le résultat d'un contrôle de parité sur une période.
    /// </summary>
    /// <remarks>
    /// La série ne s'allonge que sur une période <b>postérieure et contiguë</b> à la précédente :
    /// contrôler janvier, puis juin, puis décembre ne prouve rien sur les mois sautés. Rejouer la
    /// même période ne rallonge pas la série non plus — mais un écart, lui, la remet à zéro quelle
    /// que soit la période contrôlée.
    /// </remarks>
    public Result RecordParityRun(int year, int month, long maxGapMillimes)
    {
        if (month is < 1 or > 12)
            return Result.Failure(Error.Validation("Month", "Mois hors bornes."));
        if (maxGapMillimes < 0)
            return Result.Failure(Error.Validation("MaxGapMillimes", "L'écart ne peut pas être négatif."));

        var periodKey = (year * 100) + month;
        LastParityRunAt = DateTime.UtcNow;
        LastParityMaxGapMillimes = maxGapMillimes;

        if (maxGapMillimes != 0)
        {
            ParityCleanStreak = 0;
            LastParityPeriodKey = Math.Max(LastParityPeriodKey, periodKey);
            return Result.Success();
        }

        if (periodKey <= LastParityPeriodKey)
            return Result.Success(); // Rejeu ou période antérieure : rien à créditer.

        ParityCleanStreak = periodKey == NextPeriodKey(LastParityPeriodKey)
            ? ParityCleanStreak + 1
            : 1;
        LastParityPeriodKey = periodKey;
        return Result.Success();
    }

    /// <summary>Active le mode de recette : les deux calculs tournent, les montants ne bougent pas.</summary>
    public Result SwitchToParity()
    {
        if (Mode == MonthlyDeclarationMode.Parity)
            return Result.Success();

        Mode = MonthlyDeclarationMode.Parity;
        ConfiguredSince = null;
        ParityOverrideBy = null;
        ParityOverrideReason = null;
        return Result.Success();
    }

    /// <summary>Revient au calcul historique. Les déclarations déjà déposées ne sont pas touchées.</summary>
    public Result SwitchToLegacy()
    {
        Mode = MonthlyDeclarationMode.Legacy;
        ConfiguredSince = null;
        ParityOverrideBy = null;
        ParityOverrideReason = null;
        return Result.Success();
    }

    /// <summary>
    /// Fait du moteur paramétré la source unique, à compter de <paramref name="configuredSince"/>.
    /// </summary>
    /// <param name="configuredSince">Premier jour du mois d'effet.</param>
    /// <param name="overrideBy">Auteur de la dérogation, si la série de parité n'est pas atteinte.</param>
    /// <param name="overrideReason">Motif de la dérogation, conservé pour l'audit.</param>
    /// <remarks>
    /// Le passage direct depuis <see cref="MonthlyDeclarationMode.Legacy"/> est refusé : sans un
    /// contrôle de parité au moins, rien n'atteste que la configuration du dossier reproduit ce que
    /// ses déclarations portaient jusque-là.
    /// </remarks>
    public Result SwitchToConfigured(DateTime configuredSince, string? overrideBy, string? overrideReason)
    {
        if (Mode == MonthlyDeclarationMode.Legacy)
        {
            return Result.Failure(Error.Validation(
                "Mode",
                "Passez d'abord le dossier en contrôle de parité : la bascule directe ne permet "
                + "aucune comparaison avec le calcul en place."));
        }

        var effective = configuredSince.Date;
        if (effective.Day != 1)
        {
            return Result.Failure(Error.Validation(
                "ConfiguredSince", "La date d'effet doit être le premier jour d'un mois."));
        }

        if (!CanSwitchToConfigured)
        {
            var by = (overrideBy ?? string.Empty).Trim();
            var reason = (overrideReason ?? string.Empty).Trim();

            if (string.IsNullOrEmpty(by) || string.IsNullOrEmpty(reason))
            {
                return Result.Failure(Error.Validation(
                    "ParityOverrideReason",
                    $"{RequiredCleanParityPeriods} périodes consécutives sans écart sont requises "
                    + $"(série actuelle : {ParityCleanStreak}). À défaut, une dérogation nominative "
                    + "et motivée est exigée."));
            }

            if (reason.Length > MaxOverrideReasonLength)
            {
                return Result.Failure(Error.Validation(
                    "ParityOverrideReason",
                    $"Le motif ne peut pas dépasser {MaxOverrideReasonLength} caractères."));
            }

            ParityOverrideBy = by;
            ParityOverrideReason = reason;
        }
        else
        {
            ParityOverrideBy = null;
            ParityOverrideReason = null;
        }

        Mode = MonthlyDeclarationMode.Configured;
        ConfiguredSince = effective;
        return Result.Success();
    }

    /// <summary>
    /// Mode effectif pour une période donnée. Une période antérieure à
    /// <see cref="ConfiguredSince"/> reste calculée comme avant la bascule, pour qu'une déclaration
    /// ancienne rouverte se recalcule à l'identique.
    /// </summary>
    public MonthlyDeclarationMode ResolveModeFor(int year, int month)
    {
        if (Mode != MonthlyDeclarationMode.Configured || ConfiguredSince is null)
            return Mode;

        var periodStart = new DateTime(year, month, 1);
        return periodStart >= ConfiguredSince.Value.Date
            ? MonthlyDeclarationMode.Configured
            : MonthlyDeclarationMode.Legacy;
    }

    private static int NextPeriodKey(int periodKey)
    {
        if (periodKey <= 0)
            return 0;

        var year = periodKey / 100;
        var month = periodKey % 100;
        return month >= 12 ? ((year + 1) * 100) + 1 : (year * 100) + month + 1;
    }
}
