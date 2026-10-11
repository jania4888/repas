using FactuTrust.Domain.Common;
using FactuTrust.Domain.ValueObjects;

namespace FactuTrust.Domain.Entities;

/// <summary>
/// Lettrage comptable (411/401).
/// </summary>
public sealed class LetteringGroup : AggregateRoot
{
    public string Code { get; private set; } = null!;
    public string AccountNumber { get; private set; } = null!;
    public Money Amount { get; private set; } = null!;
    public DateTime LetteredAt { get; private set; }

    /// <summary>
    /// Lettrage partiel : le groupe couvre un règlement incomplet (débits ≠ crédits).
    /// Code préfixé « P » ; se complète en délettrant puis relettrant l'ensemble soldé.
    /// </summary>
    public bool IsPartial { get; private set; }

    private readonly List<LetteringGroupMember> _members = new();
    public IReadOnlyCollection<LetteringGroupMember> Members => _members.AsReadOnly();

    private LetteringGroup() { }

    public static Result<LetteringGroup> Create(
        string code,
        string accountNumber,
        Money amount,
        IReadOnlyList<Guid> journalEntryLineIds,
        bool isPartial = false)
    {
        if (journalEntryLineIds.Count < 2)
            return Result.Failure<LetteringGroup>(Error.Validation("Lines", "Au moins deux lignes pour le lettrage"));

        code = code?.Trim() ?? string.Empty;
        accountNumber = accountNumber?.Trim() ?? string.Empty;
        if (string.IsNullOrEmpty(code) || string.IsNullOrEmpty(accountNumber))
            return Result.Failure<LetteringGroup>(Error.Validation("Code", "Code et compte obligatoires"));

        var g = new LetteringGroup
        {
            Code = code,
            AccountNumber = accountNumber,
            Amount = amount,
            LetteredAt = DateTime.UtcNow,
            IsPartial = isPartial
        };
        foreach (var id in journalEntryLineIds)
            g._members.Add(LetteringGroupMember.CreateForGroup(g, id));

        return Result.Success(g);
    }

    /// <summary>
    /// Ajoute de nouvelles lignes à un groupe existant (action « Compléter », D7). Les lignes déjà
    /// membres du groupe ne sont pas dupliquées.
    /// </summary>
    public Result AddMembers(IReadOnlyList<Guid> journalEntryLineIds)
    {
        var existing = _members.Select(m => m.JournalEntryLineId).ToHashSet();
        foreach (var id in journalEntryLineIds)
        {
            if (existing.Add(id))
                _members.Add(LetteringGroupMember.CreateForGroup(this, id));
        }

        return Result.Success();
    }

    /// <summary>
    /// Transforme un groupe partiel (« P ») en groupe définitif (« L ») avec le même numéro, à
    /// l'issue de la complétion (D7). Le montant est recalculé par l'appelant avec la même règle
    /// que <see cref="Create"/>.
    /// </summary>
    public Result Finalize(string newCode, Money amount)
    {
        newCode = newCode?.Trim() ?? string.Empty;
        if (string.IsNullOrEmpty(newCode))
            return Result.Failure(Error.Validation("Code", "Code obligatoire"));

        Code = newCode;
        Amount = amount;
        IsPartial = false;
        return Result.Success();
    }
}
