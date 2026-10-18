using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.Services.Accounting;
using FactuTrust.Domain.ValueObjects;

namespace FactuTrust.Domain.Entities;

/// <summary>
/// SCE (Tunisia) chart of accounts row.
/// </summary>
public sealed class ChartOfAccount : Entity
{
    public string AccountNumber { get; private set; } = null!;
    public string Label { get; private set; } = null!;
    public int AccountClass { get; private set; }
    public string? ParentAccountNumber { get; private set; }
    public AccountNatureType NatureType { get; private set; }
    public bool IsSystem { get; private set; }
    public bool IsActive { get; private set; }
    public int Level { get; private set; }

    // ── Attributs « façon Axeane » (additifs, défauts rétro-compatibles). ──
    /// <summary>Nature métier du compte (général/client/fournisseur/autre).</summary>
    public AccountType AccountType { get; private set; } = AccountType.General;
    /// <summary>Vrai si le compte est un compte auxiliaire (rattaché à un compte collectif).</summary>
    public bool IsAuxiliary { get; private set; }
    /// <summary>Compte d'affectation (compte collectif de rattachement) pour un compte auxiliaire.</summary>
    public string? AffectationAccountNumber { get; private set; }

    /// <summary>Matricule fiscal (forme canonique affichée, ex. <c>1525071P/B/M/000</c>), limité aux comptes auxiliaires Client/Fournisseur.</summary>
    public string? FiscalId { get; private set; }
    /// <summary>Forme normalisée (lettres et chiffres, majuscules) du matricule, utilisée pour l'unicité et le rapprochement à l'import.</summary>
    public string? FiscalIdNormalized { get; private set; }

    private ChartOfAccount() { }

    /// <summary>
    /// Lettres et chiffres seuls, en majuscules. Même règle pour la forme canonique et la forme
    /// historique — utilisée par <see cref="SetFiscalId"/> et exposée publiquement pour que les
    /// handlers applicatifs effectuent la même normalisation avant une recherche de doublon.
    /// </summary>
    public static string NormalizeFiscalId(string canonical) =>
        new(canonical.Where(char.IsLetterOrDigit).Select(char.ToUpperInvariant).ToArray());

    public static Result<ChartOfAccount> Create(
        string accountNumber,
        string label,
        int accountClass,
        string? parentAccountNumber,
        AccountNatureType natureType,
        bool isSystem = false,
        AccountType accountType = AccountType.General,
        bool isAuxiliary = false,
        string? affectationAccountNumber = null,
        string? fiscalId = null)
    {
        accountNumber = accountNumber?.Trim() ?? string.Empty;
        if (string.IsNullOrEmpty(accountNumber))
            return Result.Failure<ChartOfAccount>(Error.Validation("AccountNumber", "Le numéro de compte est obligatoire"));

        // Invariant de forme (au plus 8 chiffres) porté ici et pas seulement dans les validators :
        // les chemins d'auto-création (AccountingService.TryAutoCreateSubAccountAsync,
        // EnsureEmployeeAuxiliaryAccountsAsync) appellent cette fabrique directement, sans passer
        // par FluentValidation. C'est ce contournement qui a laissé entrer des comptes à 10 chiffres.
        var shape = AccountNumberRules.Validate(accountNumber);
        if (shape.IsFailure)
            return Result.Failure<ChartOfAccount>(shape.Error);

        if (accountClass is < 1 or > 7)
            return Result.Failure<ChartOfAccount>(Error.Validation("AccountClass", "La classe doit être entre 1 et 7"));

        label = label?.Trim() ?? string.Empty;
        if (string.IsNullOrEmpty(label))
            return Result.Failure<ChartOfAccount>(Error.Validation("Label", "Le libellé est obligatoire"));

        parentAccountNumber = string.IsNullOrWhiteSpace(parentAccountNumber) ? null : parentAccountNumber.Trim();
        if (parentAccountNumber is not null && !accountNumber.StartsWith(parentAccountNumber, StringComparison.Ordinal))
            return Result.Failure<ChartOfAccount>(Error.Validation("ParentAccountNumber", "Le numéro doit commencer par le compte parent"));

        var level = accountNumber.Length;
        affectationAccountNumber = string.IsNullOrWhiteSpace(affectationAccountNumber) ? null : affectationAccountNumber.Trim();

        var account = new ChartOfAccount
        {
            AccountNumber = accountNumber,
            Label = label,
            AccountClass = accountClass,
            ParentAccountNumber = parentAccountNumber,
            NatureType = natureType,
            IsSystem = isSystem,
            IsActive = true,
            Level = level,
            AccountType = accountType,
            IsAuxiliary = isAuxiliary,
            AffectationAccountNumber = affectationAccountNumber
        };

        // Un MF fourni sur un compte qui ne le supporte pas est refusé, jamais ignoré en silence.
        if (!string.IsNullOrWhiteSpace(fiscalId))
        {
            var setFiscalId = account.SetFiscalId(fiscalId);
            if (setFiscalId.IsFailure)
                return Result.Failure<ChartOfAccount>(setFiscalId.Error);
        }

        return Result.Success(account);
    }

    public Result UpdateLabel(string label)
    {
        if (IsSystem)
            return Result.Failure(Error.Validation("IsSystem", "Un compte système ne peut pas être renommé"));

        label = label?.Trim() ?? string.Empty;
        if (string.IsNullOrEmpty(label))
            return Result.Failure(Error.Validation("Label", "Le libellé est obligatoire"));

        Label = label;
        return Result.Success();
    }

    /// <summary>Bascule l'état actif/inactif. Sans effet sur un compte système.</summary>
    public void ToggleActive()
    {
        if (!IsSystem)
            IsActive = !IsActive;
    }

    /// <summary>
    /// Pose ou efface le matricule fiscal (D1, D3). Une valeur vide/espaces efface toujours les
    /// deux colonnes, même sur un compte qui ne supporterait pas la saisie d'un MF (effacer reste
    /// permis). Une valeur non vide n'est acceptée que sur un compte auxiliaire Client ou
    /// Fournisseur, non système, avec le préfixe attendu (41 pour Client, 40 pour Fournisseur) —
    /// même préfixes que ceux proposés par le formulaire, pour que le rapprochement à l'import
    /// retrouve toujours le compte.
    /// </summary>
    public Result SetFiscalId(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            FiscalId = null;
            FiscalIdNormalized = null;
            return Result.Success();
        }

        if (IsSystem)
            return Result.Failure(Error.Validation("FiscalId", "Un compte système ne peut pas porter de matricule fiscal."));

        if (!IsAuxiliary || AccountType is not (AccountType.Client or AccountType.Supplier))
            return Result.Failure(Error.Validation(
                "FiscalId", "Le matricule fiscal n'est saisissable que sur un compte auxiliaire Client ou Fournisseur."));

        var expectedPrefix = AccountType == AccountType.Client ? "41" : "40";
        if (!AccountNumber.StartsWith(expectedPrefix, StringComparison.Ordinal))
            return Result.Failure(Error.Validation(
                "FiscalId",
                $"Le compte {AccountNumber} ne commence pas par « {expectedPrefix} » : le matricule fiscal ne "
                + "pourrait pas être retrouvé à l'import."));

        var nif = NIF.Create(raw);
        if (nif.IsFailure)
            return Result.Failure(Error.Validation("FiscalId", NIF.FormatError));

        FiscalId = nif.Value.Value;
        FiscalIdNormalized = NormalizeFiscalId(FiscalId);
        return Result.Success();
    }
}
