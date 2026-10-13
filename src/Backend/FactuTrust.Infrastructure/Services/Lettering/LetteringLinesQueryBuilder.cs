using FactuTrust.Application.Features.Accounting.Lettering;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Services.Lettering;

/// <summary>
/// Requête filtrée des lignes de lettrage, partagée par l'écran (<c>GET lettering/lines</c>) et,
/// en Phase 3, par le chargeur des candidats aux propositions. Extraction littérale de
/// l'ancienne méthode privée de <see cref="LetteringQueryService"/> : aucun changement de
/// comportement, seul l'affichage des brouillons devient un paramètre.
/// </summary>
internal static class LetteringLinesQueryBuilder
{
    internal static IQueryable<JournalEntryLine> Build(TenantDbContext ctx, GetLetteringLinesQuery query, bool showDrafts)
    {
        var account = (query.Account ?? string.Empty).Trim();
        var q = ctx.JournalEntryLines.AsNoTracking().AsQueryable();

        q = query.AccountMatch == LetteringAccountMatch.Prefix
            ? q.Where(l => l.AccountNumber.StartsWith(account))
            : q.Where(l => l.AccountNumber == account);

        var from = query.From.Date;
        var toExclusive = query.To.Date.AddDays(1);
        q = q.Where(l => l.JournalEntry.EntryDate >= from && l.JournalEntry.EntryDate < toExclusive);

        if (!showDrafts)
            q = q.Where(l => l.JournalEntry.Status != JournalEntryStatus.Brouillon);

        q = query.State switch
        {
            LetteringStateFilter.Unlettered => q.Where(l => l.LetteringCode == null || l.LetteringCode == string.Empty),
            LetteringStateFilter.Partial => q.Where(l => l.LetteringCode != null && l.LetteringCode.StartsWith("P")),
            LetteringStateFilter.Lettered => q.Where(l => l.LetteringCode != null && l.LetteringCode != string.Empty && !l.LetteringCode.StartsWith("P")),
            _ => q
        };

        if (!string.IsNullOrWhiteSpace(query.JournalCode))
        {
            var jc = query.JournalCode.Trim().ToUpperInvariant();
            q = q.Where(l => l.JournalEntry.JournalCode == jc);
        }

        var (sourceTypes, includeManual, includeOther) = LetteringSourceCategories.ResolveFilter(query.SourceCategories);
        if (sourceTypes.Count > 0 || includeManual || includeOther)
        {
            var knownTypes = LetteringSourceCategories.KnownSourceEntityTypes;
            q = q.Where(l =>
                sourceTypes.Contains(l.JournalEntry.SourceEntityType!)
                || (includeManual && l.JournalEntry.SourceEntityType == null)
                || (includeOther && l.JournalEntry.SourceEntityType != null && !knownTypes.Contains(l.JournalEntry.SourceEntityType)));
        }

        if (query.ThirdPartyId.HasValue)
        {
            var tid = query.ThirdPartyId.Value;
            var tkind = query.ThirdPartyKind!.Value;
            q = q.Where(l => l.ThirdPartyId == tid && l.ThirdPartyKind == tkind);
        }

        q = query.Side switch
        {
            LetteringSideFilter.Debit => q.Where(l => l.DebitAmount.Amount > 0),
            LetteringSideFilter.Credit => q.Where(l => l.CreditAmount.Amount > 0),
            _ => q
        };

        if (query.MinAmount.HasValue)
        {
            var mn = query.MinAmount.Value;
            q = q.Where(l => l.DebitAmount.Amount + l.CreditAmount.Amount >= mn);
        }
        if (query.MaxAmount.HasValue)
        {
            var mx = query.MaxAmount.Value;
            q = q.Where(l => l.DebitAmount.Amount + l.CreditAmount.Amount <= mx);
        }

        if (!string.IsNullOrWhiteSpace(query.Search))
        {
            var term = query.Search.Trim();
            if (int.TryParse(term, out var entryNumber))
            {
                q = q.Where(l => l.JournalEntry.EntryNumber == entryNumber
                    || l.Label.Contains(term) || l.JournalEntry.Label.Contains(term)
                    || (l.JournalEntry.PieceRef != null && l.JournalEntry.PieceRef.Contains(term)));
            }
            else
            {
                q = q.Where(l => l.Label.Contains(term) || l.JournalEntry.Label.Contains(term)
                    || (l.JournalEntry.PieceRef != null && l.JournalEntry.PieceRef.Contains(term)));
            }
        }

        return q;
    }
}
