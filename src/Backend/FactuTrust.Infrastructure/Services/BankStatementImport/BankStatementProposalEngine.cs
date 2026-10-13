using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using FactuTrust.Application.Features.AI;
using FactuTrust.Application.Features.Accounting.BankStatementImport;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.Services.Payroll;

namespace FactuTrust.Infrastructure.Services.BankStatementImport;

/// <summary>
/// Moteur de propositions (pur : aucune base, aucune IA) — testable sur des données en mémoire.
///
/// Priorité par ligne : écriture déjà générée &gt; ligne rapprochée &gt; écriture existante
/// correspondante (paiement saisi, paie, CNSS, effet…) &gt; doublon d'un autre relevé &gt; règle du
/// dossier &gt; catalogue tunisien &gt; cache de classification IA. Le moteur ne crée jamais de compte
/// et ne devine jamais un tiers en dessous du seuil de similarité : il le laisse « à compléter ».
/// </summary>
public static class BankStatementProposalEngine
{
    private const double ProbableNameScore = 0.9;
    private const double ToCheckNameScore = 0.8;

    /// <summary>Racines des comptes collectifs : un tiers (auxiliaire) est obligatoire.</summary>
    private static readonly string[] CollectiveRoots = { "411", "401", "413", "403", "425", "421" };

    public sealed record Line(
        Guid Id, DateOnly Date, DateOnly? ValueDate, string Description, string Reference, decimal Amount, bool IsDebit,
        bool IsReconciled, Guid? ReconciledJournalEntryLineId);

    public sealed record EntryRef(Guid EntryId, Guid? LineId, string JournalCode, int EntryNumber, DateOnly Date, bool IsDraft)
    {
        public BankLineEntryRefDto ToDto() => new(EntryId, LineId, $"{JournalCode}/{EntryNumber}", Date.ToDateTime(TimeOnly.MinValue), IsDraft);
    }

    /// <summary>Ligne d'écriture sur le compte banque, candidate à « déjà comptabilisée ».</summary>
    public sealed record BankJournalLine(
        Guid EntryId, Guid LineId, string JournalCode, int EntryNumber, DateOnly Date, decimal Debit, decimal Credit,
        string? PieceRef, string EntryLabel, string LineLabel, bool IsDraft);

    public sealed record Party(Guid Id, ThirdPartyKind Kind, string Name, string NormalizedName, string? AccountNumber);

    /// <summary>Paiement saisi dans InstaFact, avec son numéro de chèque / d'effet.</summary>
    public sealed record PaymentReference(string CanonicalNumber, Guid ThirdPartyId, ThirdPartyKind Kind, DateOnly Date, decimal Amount);

    public sealed record ChartAccount(string Label, bool IsActive);

    /// <summary>Contrepartie majoritaire déjà utilisée pour un libellé « cœur » / sens donnés (étape historique).</summary>
    public sealed record HistoryMatch(string AccountNumber, int Occurrences);

    /// <summary>Compte d'attente de repli (plan §3.9), résolu une seule fois, jamais créé.</summary>
    public const string SuspenseAccountRoot = "471";

    public sealed record Context
    {
        public required Guid StatementId { get; init; }
        public Guid? BankAccountId { get; init; }
        public required string BankGlAccount { get; init; }
        public IReadOnlyList<Line> Lines { get; init; } = Array.Empty<Line>();
        public IReadOnlyDictionary<Guid, EntryRef> GeneratedByLine { get; init; } = new Dictionary<Guid, EntryRef>();
        public IReadOnlyDictionary<Guid, EntryRef> EntriesByJournalLine { get; init; } = new Dictionary<Guid, EntryRef>();
        public IReadOnlySet<Guid> AlreadyImported { get; init; } = new HashSet<Guid>();
        public IReadOnlyList<BankJournalLine> BankJournalLines { get; init; } = Array.Empty<BankJournalLine>();
        public IReadOnlyList<BankPostingRule> DossierRules { get; init; } = Array.Empty<BankPostingRule>();
        public TunisianBankOperationCatalog Catalog { get; init; } = TunisianBankOperationCatalog.Default;
        public IReadOnlyDictionary<string, string?> AiCache { get; init; } = new Dictionary<string, string?>();
        public IReadOnlyDictionary<string, ChartAccount> Chart { get; init; } = new Dictionary<string, ChartAccount>();
        public IReadOnlyList<Party> Parties { get; init; } = Array.Empty<Party>();
        public IReadOnlyList<PaymentReference> Payments { get; init; } = Array.Empty<PaymentReference>();
        public IReadOnlyList<string> OtherBankNames { get; init; } = Array.Empty<string>();
        public IReadOnlySet<(int Year, int Month)> ClosedPeriods { get; init; } = new HashSet<(int, int)>();
        public IReadOnlySet<int> LockedYears { get; init; } = new HashSet<int>();
        public int WindowDays { get; init; } = 10;

        /// <summary>Options d'assistance (défaut <see cref="BankProposalOptions.None"/> : sortie identique à l'historique).</summary>
        public BankProposalOptions Options { get; init; } = BankProposalOptions.None;

        /// <summary>Contrepartie majoritaire par (libellé « cœur », sens), consommée seulement si <c>Options.IncludeHistory</c>.</summary>
        public IReadOnlyDictionary<(string Core, bool IsDebit), HistoryMatch> History { get; init; } =
            new Dictionary<(string, bool), HistoryMatch>();
    }

    /// <summary>Clé de cache IA d'un libellé : « cœur » normalisé (sans numéros) + sens.</summary>
    public static string LabelHash(string label, bool isDebit) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(BankLabelNormalizer.Core(label) + "|" + (isDebit ? "D" : "C"))));

    public static IReadOnlyList<BankLineProposalDto> Propose(Context ctx)
    {
        var ordered = ctx.Lines.OrderBy(l => l.Date).ThenBy(l => l.Amount).ToList();
        var matches = MatchExistingEntries(ctx, ordered);
        return ordered.Select(line => ProposeLine(ctx, line, matches)).ToList();
    }

    // ── Déjà comptabilisé ───────────────────────────────────────────────────────────────────

    private sealed record ExistingMatch(BankJournalLine? Entry, int CandidateCount, bool ByReference);

    /// <summary>
    /// Appariement glouton par date avec les écritures existantes sur le compte banque : montant
    /// exact au millime, sens cohérent (sortie relevé ⇔ crédit banque), fenêtre de dates ; le
    /// numéro de chèque / d'effet départage. Plusieurs candidats sans départage ⇒ ambigu, aucun
    /// rattachement automatique.
    /// </summary>
    private static Dictionary<Guid, ExistingMatch> MatchExistingEntries(Context ctx, IReadOnlyList<Line> lines)
    {
        var result = new Dictionary<Guid, ExistingMatch>();
        var claimed = new HashSet<Guid>();
        foreach (var line in lines)
        {
            if (ctx.GeneratedByLine.ContainsKey(line.Id) || line.IsReconciled)
                continue;

            var candidates = ctx.BankJournalLines
                .Where(c => !claimed.Contains(c.LineId)
                            && (line.IsDebit ? c.Credit == line.Amount && c.Debit == 0 : c.Debit == line.Amount && c.Credit == 0)
                            && WithinWindow(c.Date, line, ctx.WindowDays))
                .ToList();
            if (candidates.Count == 0)
                continue;

            var reference = BankLabelReferences.Extract(line.Description);
            var byReference = reference is null
                ? new List<BankJournalLine>()
                : candidates.Where(c => MentionsNumber(c, reference.Number)).ToList();

            BankJournalLine? chosen = null;
            var viaReference = false;
            if (byReference.Count == 1)
            {
                chosen = byReference[0];
                viaReference = true;
            }
            else if (candidates.Count == 1)
            {
                chosen = candidates[0];
            }

            if (chosen is not null)
            {
                claimed.Add(chosen.LineId);
                result[line.Id] = new ExistingMatch(chosen, 1, viaReference);
            }
            else
            {
                result[line.Id] = new ExistingMatch(null, candidates.Count, false);
            }
        }

        return result;
    }

    private static bool WithinWindow(DateOnly date, Line line, int windowDays)
    {
        bool Near(DateOnly anchor) => Math.Abs(date.DayNumber - anchor.DayNumber) <= windowDays;
        return Near(line.Date) || (line.ValueDate is { } v && Near(v));
    }

    private static bool MentionsNumber(BankJournalLine candidate, string number)
    {
        var canonical = BankLabelReferences.Canonical(number);
        return ContainsNumber(candidate.PieceRef, canonical) || ContainsNumber(candidate.EntryLabel, canonical) || ContainsNumber(candidate.LineLabel, canonical);
    }

    private static bool ContainsNumber(string? text, string canonical)
    {
        if (string.IsNullOrWhiteSpace(text))
            return false;
        var digits = new StringBuilder();
        foreach (var ch in text + " ")
        {
            if (char.IsDigit(ch))
            {
                digits.Append(ch);
                continue;
            }

            if (digits.Length > 0 && BankLabelReferences.Canonical(digits.ToString()) == canonical)
                return true;
            digits.Clear();
        }

        return false;
    }

    // ── Proposition d'une ligne ─────────────────────────────────────────────────────────────

    private static BankLineProposalDto ProposeLine(Context ctx, Line line, IReadOnlyDictionary<Guid, ExistingMatch> matches)
    {
        var dto = new BankLineProposalDto
        {
            LineId = line.Id,
            TransactionDate = line.Date.ToDateTime(TimeOnly.MinValue),
            ValueDate = line.ValueDate?.ToDateTime(TimeOnly.MinValue),
            Label = line.Description,
            Reference = line.Reference,
            Amount = line.Amount,
            IsDebit = line.IsDebit,
            IsReconciled = line.IsReconciled
        };

        if (ctx.GeneratedByLine.TryGetValue(line.Id, out var generated))
        {
            return dto with
            {
                Status = BankLineStatuses.Generated,
                GeneratedEntry = generated.ToDto(),
                Explanation = generated.IsDraft
                    ? $"Écriture {generated.JournalCode}/{generated.EntryNumber} générée (brouillard, à valider)."
                    : $"Écriture {generated.JournalCode}/{generated.EntryNumber} générée et validée."
            };
        }

        if (line.IsReconciled)
        {
            var entry = line.ReconciledJournalEntryLineId is { } jl && ctx.EntriesByJournalLine.TryGetValue(jl, out var e) ? e : null;
            return dto with
            {
                Status = BankLineStatuses.Reconciled,
                ExistingEntry = entry?.ToDto(),
                Explanation = entry is null ? "Ligne déjà rapprochée." : $"Ligne rapprochée de l'écriture {entry.JournalCode}/{entry.EntryNumber}."
            };
        }

        if (matches.TryGetValue(line.Id, out var match))
        {
            if (match.Entry is { } existing)
            {
                return dto with
                {
                    Status = BankLineStatuses.AlreadyPosted,
                    Confidence = match.ByReference ? BankLineConfidences.Certain : BankLineConfidences.Probable,
                    Source = BankLineSources.ExistingEntry,
                    ExistingEntry = new BankLineEntryRefDto(existing.EntryId, existing.LineId,
                        $"{existing.JournalCode}/{existing.EntryNumber}", existing.Date.ToDateTime(TimeOnly.MinValue), existing.IsDraft),
                    Explanation = $"Déjà comptabilisée : écriture {existing.JournalCode}/{existing.EntryNumber} du {existing.Date:dd/MM/yyyy}"
                                  + (match.ByReference ? " (même n° de chèque / d'effet)." : " (même montant, date proche).")
                                  + " Aucune écriture à créer : à rapprocher."
                };
            }

            return dto with
            {
                Status = BankLineStatuses.Ambiguous,
                Confidence = BankLineConfidences.ToCheck,
                Source = BankLineSources.ExistingEntry,
                CandidateCount = match.CandidateCount,
                Explanation = $"{match.CandidateCount} écritures existantes de même montant à des dates proches : vérifiez si l'opération est déjà comptabilisée avant d'en créer une."
            };
        }

        if (ctx.AlreadyImported.Contains(line.Id))
        {
            return dto with
            {
                Status = BankLineStatuses.AlreadyImported,
                Explanation = "La même opération figure déjà dans un autre relevé enregistré de ce compte : elle n'est pas comptabilisée deux fois."
            };
        }

        var classified = Classify(ctx, line);
        return Finalize(ctx, line, dto, classified);
    }

    private sealed record Classification(
        string? AccountRoot,
        Guid? ThirdPartyId,
        ThirdPartyKind ThirdPartyKind,
        string? ThirdPartyName,
        string Confidence,
        string? Source,
        string Explanation,
        string? VatAccount,
        decimal? ImpliedVatRate);

    private static Classification Classify(Context ctx, Line line)
    {
        var normalized = BankLabelNormalizer.Normalize(line.Description);
        var core = BankLabelNormalizer.Core(line.Description);

        // 1. Règle du dossier (apprise) : la plus spécifique l'emporte.
        var rule = ctx.DossierRules
            .Where(r => r.IsActive && (r.BankAccountId is null || r.BankAccountId == ctx.BankAccountId))
            .Where(r => r.Matches(r.MatchKind == BankPostingRuleMatchKind.Exact ? core : normalized, line.IsDebit))
            .OrderByDescending(r => (int)r.MatchKind)
            .ThenByDescending(r => r.Pattern.Length)
            .ThenByDescending(r => r.Priority)
            .ThenByDescending(r => r.BankAccountId.HasValue)
            .FirstOrDefault();
        if (rule is not null)
        {
            var name = rule.ThirdPartyId is { } id ? ctx.Parties.FirstOrDefault(p => p.Id == id && p.Kind == rule.ThirdPartyKind)?.Name : null;
            return new Classification(rule.AccountNumber, rule.ThirdPartyId, rule.ThirdPartyKind, name,
                BankLineConfidences.Certain, BankLineSources.DossierRule,
                $"Règle du dossier « {rule.Pattern} » ⇒ {rule.AccountNumber}.",
                rule.SplitEmbeddedVat ? rule.VatAccountNumber : null,
                rule.SplitEmbeddedVat ? BankStatementEmbeddedVat.BankCommissionVatRate : null);
        }

        // 2. Catalogue tunisien.
        var catalogRule = ctx.Catalog.Match(line.Description, line.IsDebit);
        if (catalogRule is not null)
            return FromCatalog(ctx, line, catalogRule);

        // 3. Historique du dossier (assist=full) : contrepartie déjà utilisée pour ce libellé / ce sens.
        if (ctx.Options.IncludeHistory && ctx.History.TryGetValue((core, line.IsDebit), out var history))
        {
            var historyConfidence = history.Occurrences >= 2 ? BankLineConfidences.Probable : BankLineConfidences.ToCheck;
            return new Classification(history.AccountNumber, null, ThirdPartyKind.None, null, historyConfidence, BankLineSources.History,
                $"Déjà comptabilisé {history.Occurrences} fois en 6xx pour ce libellé.", null, null);
        }

        // 4. Cache de classification IA (libellé distinct déjà classé).
        if (ctx.AiCache.TryGetValue(LabelHash(line.Description, line.IsDebit), out var aiAccount) && !string.IsNullOrWhiteSpace(aiAccount))
        {
            var party = PartyKindOf(aiAccount);
            var resolved = party == BankOperationParty.None ? null : ResolveParty(ctx, line, party);
            return new Classification(resolved?.AccountNumber ?? aiAccount, resolved?.Id, resolved?.Kind ?? ThirdPartyKind.None, resolved?.Name,
                BankLineConfidences.ToCheck, BankLineSources.Ai,
                $"Suggestion de l'IA : {aiAccount} — à vérifier.", null, null);
        }

        return new Classification(null, null, ThirdPartyKind.None, null, BankLineConfidences.ToCheck, null,
            "Aucune règle ne reconnaît cette opération : choisissez le compte (ou lancez la classification IA).", null, null);
    }

    private static Classification FromCatalog(Context ctx, Line line, BankOperationRule rule)
    {
        var confidence = rule.Confidence == "probable" ? BankLineConfidences.Probable : BankLineConfidences.ToCheck;

        if (rule.Party == BankOperationParty.None)
            return new Classification(rule.Account, null, ThirdPartyKind.None, null, confidence, BankLineSources.Catalog, rule.Explanation, rule.VatAccount, rule.ImpliedVatRate);

        // Virement entre deux comptes bancaires du dossier ⇒ virement interne (58), pas un tiers.
        if (rule.Id is "transfer-received" or "transfer-sent")
        {
            var partyName = BankLabelPartyExtractor.Extract(line.Description);
            if (partyName is not null && ctx.OtherBankNames.Any(b => partyName.Contains(b, StringComparison.Ordinal)))
            {
                return new Classification("58", null, ThirdPartyKind.None, null, BankLineConfidences.Probable, BankLineSources.Catalog,
                    $"Virement depuis / vers un autre compte bancaire du dossier ({partyName}) : virement interne (58).", null, null);
            }
        }

        var resolved = ResolveParty(ctx, line, rule.Party);
        if (resolved is null)
        {
            return new Classification(rule.Account, null, ToKind(rule.Party), null, BankLineConfidences.ToCheck, BankLineSources.Catalog,
                rule.Explanation + " Tiers à préciser.", rule.VatAccount, rule.ImpliedVatRate);
        }

        // Le compte d'effets (413 / 403) reste celui du catalogue ; sinon le collectif propre au tiers.
        var account = rule.Account is "413" or "403" ? rule.Account : resolved.AccountNumber ?? rule.Account;
        var finalConfidence = resolved.Certain ? BankLineConfidences.Certain : Min(confidence, resolved.Confidence);
        return new Classification(account, resolved.Id, resolved.Kind, resolved.Name, finalConfidence,
            resolved.Certain ? BankLineSources.ThirdPartyMatch : BankLineSources.Catalog,
            rule.Explanation + " " + resolved.Explanation, rule.VatAccount, rule.ImpliedVatRate);
    }

    private sealed record ResolvedParty(Guid Id, ThirdPartyKind Kind, string Name, string? AccountNumber, string Confidence, bool Certain, string Explanation);

    /// <summary>Tiers : n° de chèque / d'effet d'un paiement saisi (certain), sinon nom du libellé (similarité).</summary>
    private static ResolvedParty? ResolveParty(Context ctx, Line line, BankOperationParty partyKind)
    {
        var kind = ToKind(partyKind);
        var candidates = ctx.Parties.Where(p => p.Kind == kind).ToList();
        if (candidates.Count == 0)
            return null;

        var reference = BankLabelReferences.Extract(line.Description);
        if (reference is not null && kind is ThirdPartyKind.Client or ThirdPartyKind.Supplier)
        {
            var canonical = BankLabelReferences.Canonical(reference.Number);
            var payment = ctx.Payments
                .Where(p => p.Kind == kind && p.CanonicalNumber == canonical)
                .OrderBy(p => Math.Abs(p.Date.DayNumber - line.Date.DayNumber))
                .FirstOrDefault();
            var party = payment is null ? null : candidates.FirstOrDefault(c => c.Id == payment.ThirdPartyId);
            if (party is not null)
            {
                return new ResolvedParty(party.Id, party.Kind, party.Name, party.AccountNumber, BankLineConfidences.Certain, true,
                    $"Tiers {party.Name} reconnu par le n° {reference.Number} d'un paiement saisi le {payment!.Date:dd/MM/yyyy}.");
            }
        }

        var name = BankLabelPartyExtractor.Extract(line.Description);
        if (name is null)
            return null;

        var best = candidates
            .Select(c => (Party: c, Score: NameScore(name, c.NormalizedName)))
            .OrderByDescending(x => x.Score)
            .FirstOrDefault();
        if (best.Party is null || best.Score < ToCheckNameScore)
            return null;

        // Deux tiers aussi proches l'un que l'autre : on ne choisit pas à la place de l'utilisateur.
        var runnerUp = candidates.Where(c => c.Id != best.Party.Id).Select(c => NameScore(name, c.NormalizedName)).DefaultIfEmpty(0).Max();
        if (runnerUp >= best.Score - 0.02)
            return null;

        var confidence = best.Score >= ProbableNameScore ? BankLineConfidences.Probable : BankLineConfidences.ToCheck;
        return new ResolvedParty(best.Party.Id, best.Party.Kind, best.Party.Name, best.Party.AccountNumber, confidence, false,
            $"Tiers {best.Party.Name} rapproché du nom « {name} » du libellé ({best.Score.ToString("P0", CultureInfo.GetCultureInfo("fr-FR"))}).");
    }

    /// <summary>Similarité de noms normalisés ; un nom inclus mot pour mot dans l'autre (≥ 2 mots) vaut 0,85.</summary>
    internal static double NameScore(string extracted, string normalizedPartyName)
    {
        var score = InvoiceImportParsing.Similarity(extracted, normalizedPartyName);
        var a = extracted.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var b = normalizedPartyName.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var shorter = a.Length <= b.Length ? a : b;
        var longer = a.Length <= b.Length ? b : a;
        if (shorter.Length >= 2 && shorter.All(t => longer.Contains(t, StringComparer.Ordinal)))
            score = Math.Max(score, 0.85);
        return score;
    }

    // ── Finalisation : compte, TVA, période, statut ──────────────────────────────────────────

    private static BankLineProposalDto Finalize(Context ctx, Line line, BankLineProposalDto dto, Classification c)
    {
        var diagnostics = new List<BankLineDiagnosticDto>();
        string? account = null;
        string? accountLabel = null;
        var accountStatus = "none";
        if (c.AccountRoot is { } root)
        {
            (account, accountLabel, accountStatus) = ResolveAccount(ctx, root);
            if (accountStatus == "missing")
                diagnostics.Add(new("account_missing", "warning", $"Le compte {root} n'existe pas dans le plan comptable du dossier : choisissez un compte existant."));
            else if (accountStatus == "inactive")
                diagnostics.Add(new("account_inactive", "warning", $"Le compte {account} est désactivé."));
        }

        var requiresThirdParty = account is not null && CollectiveRoots.Any(r => account.StartsWith(r, StringComparison.Ordinal));
        BankLineVatSplitDto? vat = null;
        if (line.IsDebit && c.VatAccount is not null)
        {
            vat = VatSplit(line, c.VatAccount, c.ImpliedVatRate);
            if (vat is not null && !ctx.Chart.TryGetValue(vat.VatAccountNumber, out _))
            {
                var (vatAccount, _, vatStatus) = ResolveAccount(ctx, vat.VatAccountNumber);
                vat = vatStatus == "found" ? vat with { VatAccountNumber = vatAccount! } : null;
            }
        }

        var confidence = c.Confidence;
        var explanation = c.Explanation;
        var source = c.Source;
        var thirdPartyId = c.ThirdPartyId;
        var thirdPartyKind = c.ThirdPartyId is null ? ThirdPartyKind.None : c.ThirdPartyKind;
        var thirdPartyName = c.ThirdPartyName;
        if (vat is { Implied: true })
        {
            confidence = BankLineConfidences.ToCheck;
            explanation += " TVA déduite au taux de 19 % (non imprimée sur le relevé) : à vérifier.";
        }

        var periodBlocked = ctx.LockedYears.Contains(line.Date.Year) || ctx.ClosedPeriods.Contains((line.Date.Year, line.Date.Month));
        if (periodBlocked)
            diagnostics.Add(new("period_closed", "blocking", $"La période {line.Date:MM/yyyy} est close ou l'exercice est verrouillé : aucune écriture ne peut y être passée."));

        // Repli explicite sur le compte d'attente 471 (assist=full) : compte introuvable/inactif, ou
        // compte collectif sans tiers identifié. Jamais créé : si 471 est absent ou désactivé, on
        // laisse la ligne « à compléter » avec un diagnostic dédié.
        var needsFallback = !periodBlocked && (accountStatus != "found" || (requiresThirdParty && thirdPartyId is null));
        if (needsFallback && ctx.Options.SuspenseFallback)
        {
            var (suspenseAccount, suspenseLabel, suspenseStatus) = ResolveAccount(ctx, SuspenseAccountRoot);
            if (suspenseStatus == "found")
            {
                account = suspenseAccount;
                accountLabel = suspenseLabel;
                accountStatus = "found";
                requiresThirdParty = false;
                thirdPartyId = null;
                thirdPartyKind = ThirdPartyKind.None;
                thirdPartyName = null;
                source = BankLineSources.Fallback;
                confidence = BankLineConfidences.ToCheck;
                explanation = "Compte ou tiers non identifié : affecté au compte d'attente 471, à reclasser.";
                diagnostics.RemoveAll(d => d.Code is "account_missing" or "account_inactive");
                diagnostics.Add(new("suspense_account", "warning", "Compte d'attente : à reclasser."));
            }
            else
            {
                diagnostics.Add(new("suspense_missing", "warning", "Le compte d'attente 471 n'existe pas ou est désactivé dans le plan comptable du dossier."));
            }
        }

        string status;
        if (periodBlocked)
            status = BankLineStatuses.Blocked;
        else if (accountStatus != "found" || (requiresThirdParty && thirdPartyId is null))
            status = BankLineStatuses.ToComplete;
        else
            status = BankLineStatuses.Proposed;

        if (requiresThirdParty && thirdPartyId is null && accountStatus == "found")
            diagnostics.Add(new("third_party_required", "warning", $"Le compte {account} est un compte collectif : précisez le tiers."));

        return dto with
        {
            Status = status,
            Confidence = source is null ? null : confidence,
            Source = source,
            Explanation = explanation,
            AccountNumber = account,
            AccountLabel = accountLabel,
            AccountStatus = accountStatus,
            ThirdPartyId = thirdPartyId,
            ThirdPartyKind = thirdPartyKind,
            ThirdPartyName = thirdPartyName,
            RequiresThirdParty = requiresThirdParty,
            VatSplit = vat,
            Diagnostics = diagnostics,
            // Le repli 471 (confiance ToCheck par construction) reste coché par défaut : conforme au
            // choix « sinon 471 » du dossier et à la maquette (§3.9 du plan).
            SelectedByDefault = status == BankLineStatuses.Proposed
                                && (confidence is BankLineConfidences.Certain or BankLineConfidences.Probable
                                    || source == BankLineSources.Fallback)
        };
    }

    /// <summary>TVA lue (« DONT TVA ») si cohérente ; sinon TVA réputée incluse seulement si le calcul tombe juste au millime.</summary>
    private static BankLineVatSplitDto? VatSplit(Line line, string vatAccount, decimal? impliedRate)
    {
        var printed = BankStatementEmbeddedVat.TryRead(line.Description, line.Amount);
        if (printed is { RateConsistent: true })
            return new BankLineVatSplitDto(printed.NetAmount, printed.VatAmount, vatAccount, Implied: false);

        if (impliedRate is { } rate && printed is null)
        {
            var net = Math.Round(line.Amount / (1 + rate), 3, MidpointRounding.AwayFromZero);
            var vat = line.Amount - net;
            if (vat > 0 && Math.Round(net * rate, 3, MidpointRounding.AwayFromZero) == vat)
                return new BankLineVatSplitDto(net, vat, vatAccount, Implied: true);
        }

        return null;
    }

    /// <summary>
    /// Compte du plan du dossier pour une racine NCT 01 : le compte lui-même s'il existe et est
    /// actif ; sinon son unique sous-compte actif ; sinon son parent actif le plus précis. Jamais créé.
    /// </summary>
    internal static (string? Account, string? Label, string Status) ResolveAccount(Context ctx, string root)
    {
        if (ctx.Chart.TryGetValue(root, out var exact))
            return (root, exact.Label, exact.IsActive ? "found" : "inactive");

        var children = ctx.Chart.Where(kv => kv.Value.IsActive && kv.Key.StartsWith(root, StringComparison.Ordinal)).ToList();
        if (children.Count == 1)
            return (children[0].Key, children[0].Value.Label, "found");

        for (var length = root.Length - 1; length >= 3; length--)
        {
            var parent = root[..length];
            if (ctx.Chart.TryGetValue(parent, out var p) && p.IsActive)
                return (parent, p.Label, "found");
        }

        return (root, null, "missing");
    }

    private static BankOperationParty PartyKindOf(string account) => account switch
    {
        _ when account.StartsWith("411", StringComparison.Ordinal) || account.StartsWith("413", StringComparison.Ordinal) => BankOperationParty.Client,
        _ when account.StartsWith("401", StringComparison.Ordinal) || account.StartsWith("403", StringComparison.Ordinal) => BankOperationParty.Supplier,
        _ when account.StartsWith(PayrollJournalEntryBuilder.PersonnelPayableAccount, StringComparison.Ordinal) => BankOperationParty.Employee,
        _ => BankOperationParty.None
    };

    private static ThirdPartyKind ToKind(BankOperationParty party) => party switch
    {
        BankOperationParty.Client => ThirdPartyKind.Client,
        BankOperationParty.Supplier => ThirdPartyKind.Supplier,
        BankOperationParty.Employee => ThirdPartyKind.Employee,
        _ => ThirdPartyKind.None
    };

    private static string Min(string a, string b) =>
        a == BankLineConfidences.ToCheck || b == BankLineConfidences.ToCheck ? BankLineConfidences.ToCheck
        : a == BankLineConfidences.Probable || b == BankLineConfidences.Probable ? BankLineConfidences.Probable
        : BankLineConfidences.Certain;
}
