using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Domain.Entities;

public enum BankPostingRuleDirection
{
    Any = 0,

    /// <summary>Débit du relevé (sortie d'argent).</summary>
    Debit = 1,

    /// <summary>Crédit du relevé (entrée d'argent).</summary>
    Credit = 2
}

/// <summary>Correspondance sur le libellé NORMALISÉ — volontairement sans expression régulière (aucun risque ReDoS).</summary>
public enum BankPostingRuleMatchKind
{
    Contains = 0,
    StartsWith = 1,
    Exact = 2
}

/// <summary>
/// Règle d'affectation d'une opération bancaire, propre au dossier : « tel libellé ⇒ tel compte
/// (et tel tiers) ». Créée quand l'utilisateur coche « Mémoriser » en relecture ; prioritaire sur
/// le catalogue et sur l'IA.
/// </summary>
public sealed class BankPostingRule : Entity
{
    public const int PatternMaxLength = 200;
    public const int AccountNumberMaxLength = 20;

    /// <summary>Null = toutes les banques du dossier.</summary>
    public Guid? BankAccountId { get; private set; }

    public BankPostingRuleDirection Direction { get; private set; }
    public BankPostingRuleMatchKind MatchKind { get; private set; }

    /// <summary>Motif normalisé (majuscules, sans accents, sans numéros variables).</summary>
    public string Pattern { get; private set; } = null!;

    public string AccountNumber { get; private set; } = null!;
    public Guid? ThirdPartyId { get; private set; }
    public ThirdPartyKind ThirdPartyKind { get; private set; }

    /// <summary>Ventiler la TVA incluse (« DONT TVA ») : HT sur <see cref="AccountNumber"/>, TVA sur <see cref="VatAccountNumber"/>.</summary>
    public bool SplitEmbeddedVat { get; private set; }

    public string? VatAccountNumber { get; private set; }
    public int Priority { get; private set; }
    public bool IsActive { get; private set; }
    public int UsageCount { get; private set; }
    public DateTime? LastUsedAt { get; private set; }

    private BankPostingRule() { }

    public static BankPostingRule Create(
        Guid? bankAccountId,
        BankPostingRuleDirection direction,
        BankPostingRuleMatchKind matchKind,
        string normalizedPattern,
        string accountNumber,
        Guid? thirdPartyId,
        ThirdPartyKind thirdPartyKind,
        bool splitEmbeddedVat,
        string? vatAccountNumber,
        int priority = 0)
    {
        var rule = new BankPostingRule { BankAccountId = bankAccountId, IsActive = true };
        rule.Update(direction, matchKind, normalizedPattern, accountNumber, thirdPartyId, thirdPartyKind, splitEmbeddedVat, vatAccountNumber, priority);
        return rule;
    }

    public void Update(
        BankPostingRuleDirection direction,
        BankPostingRuleMatchKind matchKind,
        string normalizedPattern,
        string accountNumber,
        Guid? thirdPartyId,
        ThirdPartyKind thirdPartyKind,
        bool splitEmbeddedVat,
        string? vatAccountNumber,
        int priority)
    {
        var pattern = normalizedPattern?.Trim() ?? string.Empty;
        if (pattern.Length < 3)
            throw new ArgumentException("Le motif doit compter au moins 3 caractères.", nameof(normalizedPattern));
        if (pattern.Length > PatternMaxLength)
            throw new ArgumentException($"Le motif dépasse {PatternMaxLength} caractères.", nameof(normalizedPattern));

        var account = accountNumber?.Trim() ?? string.Empty;
        if (account.Length is 0 or > AccountNumberMaxLength || !account.All(char.IsDigit))
            throw new ArgumentException("Numéro de compte invalide.", nameof(accountNumber));
        if (thirdPartyId is not null && thirdPartyKind == ThirdPartyKind.None)
            throw new ArgumentException("Le type de tiers est requis.", nameof(thirdPartyKind));
        if (splitEmbeddedVat && (string.IsNullOrWhiteSpace(vatAccountNumber) || !vatAccountNumber.Trim().All(char.IsDigit)))
            throw new ArgumentException("Le compte de TVA est requis pour ventiler la TVA incluse.", nameof(vatAccountNumber));

        Direction = direction;
        MatchKind = matchKind;
        Pattern = pattern;
        AccountNumber = account;
        ThirdPartyId = thirdPartyId;
        ThirdPartyKind = thirdPartyId is null ? ThirdPartyKind.None : thirdPartyKind;
        SplitEmbeddedVat = splitEmbeddedVat;
        VatAccountNumber = splitEmbeddedVat ? vatAccountNumber!.Trim() : null;
        Priority = priority;
    }

    public void Deactivate() => IsActive = false;

    public void Activate() => IsActive = true;

    public void RecordUse(DateTime at)
    {
        UsageCount++;
        LastUsedAt = at;
    }

    /// <summary>La règle s'applique-t-elle à ce libellé normalisé et à ce sens ?</summary>
    public bool Matches(string normalizedLabel, bool isDebit)
    {
        if (!IsActive || string.IsNullOrEmpty(normalizedLabel))
            return false;
        if (Direction == BankPostingRuleDirection.Debit && !isDebit)
            return false;
        if (Direction == BankPostingRuleDirection.Credit && isDebit)
            return false;

        return MatchKind switch
        {
            BankPostingRuleMatchKind.Exact => string.Equals(normalizedLabel, Pattern, StringComparison.Ordinal),
            BankPostingRuleMatchKind.StartsWith => normalizedLabel.StartsWith(Pattern, StringComparison.Ordinal),
            _ => normalizedLabel.Contains(Pattern, StringComparison.Ordinal)
        };
    }
}
