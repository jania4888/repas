using System.Text.RegularExpressions;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.Commands;
using FactuTrust.Application.Features.Accounting.Lettering;
using FactuTrust.Domain.Services.Accounting;
using FluentValidation;
using Microsoft.Extensions.Options;

namespace FactuTrust.Application.Features.Accounting.Validators;

public sealed class CreateSubAccountCommandValidator : AbstractValidator<CreateSubAccountCommand>
{
    public CreateSubAccountCommandValidator()
    {
        // Forme et plafond délégués à AccountNumberRules : même règle que ChartOfAccount.Create, donc
        // impossible de refuser ici ce que le domaine accepterait, ou l'inverse.
        RuleFor(x => x.Request.AccountNumber)
            .NotEmpty().WithMessage("Le numéro de compte est obligatoire.")
            .Matches(AccountNumberRules.Pattern)
            .WithMessage("Le numéro de compte doit être un numéro SCE (chiffres, points autorisés).")
            .Must(n => AccountNumberRules.DigitCount(n) <= AccountNumberRules.MaxDigits)
            .WithMessage(n =>
                $"Le compte « {n.Request.AccountNumber?.Trim()} » comporte "
                + $"{AccountNumberRules.DigitCount(n.Request.AccountNumber)} chiffres : un numéro de "
                + $"compte ne peut pas en dépasser {AccountNumberRules.MaxDigits}.");

        RuleFor(x => x.Request.Label)
            .NotEmpty().WithMessage("Le libellé est obligatoire.")
            .MaximumLength(200).WithMessage("Le libellé ne peut pas dépasser 200 caractères.");

        RuleFor(x => x.Request.AccountClass)
            .InclusiveBetween(1, 7).WithMessage("La classe de compte doit être entre 1 et 7.");

        RuleFor(x => x.Request.NatureType)
            .InclusiveBetween(0, 2).WithMessage("Le type de nature doit être entre 0 et 2.");

        RuleFor(x => x.Request.AccountType)
            .InclusiveBetween(0, 3).WithMessage("Le type de compte doit être entre 0 et 3.");
    }
}

public sealed class CreateManualJournalEntryCommandValidator : AbstractValidator<CreateManualJournalEntryCommand>
{
    private static readonly string[] ValidJournalCodes = { "JV", "JA", "JC", "JB", "JOD", "JIM", "JAN" };

    public CreateManualJournalEntryCommandValidator(IJournalRepository journals, IOptions<AccountingSettings> settings)
    {
        RuleFor(x => x.Request.JournalCode)
            .NotEmpty().WithMessage("Le code journal est obligatoire.")
            // Quand le catalogue de journaux est activé, valider contre le catalogue (superset des 7 seedés) ;
            // sinon, conserver la liste figée historique (aucune régression).
            .MustAsync(async (code, ct) =>
            {
                var c = (code ?? string.Empty).Trim().ToUpperInvariant();
                if (settings.Value.JournalCatalogEnabled)
                    return await journals.ExistsActiveJournalCodeAsync(c, ct);
                return ValidJournalCodes.Contains(c);
            })
            .WithMessage("Le code journal est inconnu ou inactif.");

        RuleFor(x => x.Request.EntryDate)
            .NotEmpty().WithMessage("La date est obligatoire.")
            .LessThanOrEqualTo(DateTime.UtcNow.Date.AddDays(1))
            .WithMessage("La date ne peut pas être dans le futur.");

        RuleFor(x => x.Request.Label)
            .NotEmpty().WithMessage("Le libellé est obligatoire.")
            .MaximumLength(500).WithMessage("Le libellé ne peut pas dépasser 500 caractères.");

        RuleFor(x => x.Request.PieceRef)
            .MaximumLength(50).WithMessage("La référence de pièce ne peut pas dépasser 50 caractères.");

        RuleFor(x => x.Request.Lines)
            .NotEmpty().WithMessage("Les lignes sont obligatoires.")
            .Must(lines => lines.Count >= 2)
            .WithMessage("Au moins deux lignes sont requises.");

        RuleFor(x => x.Request)
            .Must(r => ManualEntryLineRules.IsBalanced(r.Lines, r.CurrencyCode))
            .WithMessage("L'écriture doit être équilibrée (total débit = total crédit).")
            .When(x => x.Request.Lines.Count >= 2);

        RuleFor(x => x.Request)
            .Must(r => r.Lines.All(l => ManualEntryLineRules.HasSingleSide(l, r.CurrencyCode)))
            .WithMessage("Une ligne ne peut pas avoir simultanément un débit et un crédit.");

        RuleForEach(x => x.Request.Lines).ChildRules(line =>
        {
            line.RuleFor(l => l.AccountNumber)
                .NotEmpty().WithMessage("Le numéro de compte est obligatoire pour chaque ligne.");

            line.RuleFor(l => l.LineLabel)
                .NotEmpty().WithMessage("Le libellé est obligatoire pour chaque ligne.");
        });
    }
}

/// <summary>
/// Validateur de la modification d'un brouillon. Il n'existait pas : la modification ne reposait
/// que sur les contrôles du domaine, et les écarts de forme remontaient donc plus tard et avec des
/// messages différents de ceux de la création.
/// </summary>
public sealed class UpdateDraftJournalEntryCommandValidator : AbstractValidator<UpdateDraftJournalEntryCommand>
{
    public UpdateDraftJournalEntryCommandValidator()
    {
        RuleFor(x => x.Request.Label)
            .NotEmpty().WithMessage("Le libellé est obligatoire.")
            .MaximumLength(500).WithMessage("Le libellé ne peut pas dépasser 500 caractères.");

        RuleFor(x => x.Request.PieceRef)
            .MaximumLength(50).WithMessage("La référence de pièce ne peut pas dépasser 50 caractères.");

        RuleFor(x => x.Request.Lines)
            .NotEmpty().WithMessage("Les lignes sont obligatoires.")
            .Must(lines => lines.Count >= 2)
            .WithMessage("Au moins deux lignes sont requises.");

        RuleFor(x => x.Request)
            .Must(r => ManualEntryLineRules.IsBalanced(r.Lines, r.CurrencyCode))
            .WithMessage("L'écriture doit être équilibrée (total débit = total crédit).")
            .When(x => x.Request.Lines.Count >= 2);

        RuleFor(x => x.Request)
            .Must(r => r.Lines.All(l => ManualEntryLineRules.HasSingleSide(l, r.CurrencyCode)))
            .WithMessage("Une ligne ne peut pas avoir simultanément un débit et un crédit.");

        RuleForEach(x => x.Request.Lines).ChildRules(line =>
        {
            line.RuleFor(l => l.AccountNumber)
                .NotEmpty().WithMessage("Le numéro de compte est obligatoire pour chaque ligne.");

            line.RuleFor(l => l.LineLabel)
                .NotEmpty().WithMessage("Le libellé est obligatoire pour chaque ligne.");
        });
    }
}

public sealed class SaveVatDeclarationCommandValidator : AbstractValidator<SaveVatDeclarationCommand>
{
    public SaveVatDeclarationCommandValidator()
    {
        RuleFor(x => x.Request.Year)
            .InclusiveBetween(2000, 2100).WithMessage("L'année doit être entre 2000 et 2100.");

        RuleFor(x => x.Request.Month)
            .InclusiveBetween(1, 12).WithMessage("Le mois doit être entre 1 et 12.");
    }
}

public sealed class UpdateAccountLabelCommandValidator : AbstractValidator<UpdateAccountLabelCommand>
{
    public UpdateAccountLabelCommandValidator()
    {
        RuleFor(x => x.Label)
            .NotEmpty().WithMessage("Le libellé est obligatoire.")
            .MaximumLength(200).WithMessage("Le libellé ne peut pas dépasser 200 caractères.");
    }
}

public sealed class LetterAccountEntriesCommandValidator : AbstractValidator<LetterAccountEntriesCommand>
{
    public LetterAccountEntriesCommandValidator()
    {
        RuleFor(x => x.JournalEntryLineIds)
            .NotEmpty().WithMessage("Au moins une ligne est requise.")
            .Must(ids => ids.Count >= 2)
            .WithMessage("Au moins deux lignes sont requises pour le lettrage.")
            .Must(ids => ids.Count <= 500)
            .WithMessage("500 lignes au maximum peuvent être lettrées en une seule fois.")
            .Must(ids => ids.All(id => id != Guid.Empty))
            .WithMessage("Identifiant de ligne invalide.")
            .Must(ids => ids.Distinct().Count() == ids.Count)
            .WithMessage("Une même ligne est sélectionnée plusieurs fois.");

        // Plan §4.3 : seules Manual et Suggestion sont acceptées depuis le corps HTTP de
        // POST letter. Bulk n'est admis qu'avec un BulkRequestId, que seul le handler de masse
        // renseigne (le contrôleur ne le transmet jamais). DraftUpdate/PayrollCancellation/
        // Automatic/ExchangeDifference ne viennent que de flux internes qui n'empruntent pas
        // cette commande.
        RuleFor(x => x.Origin)
            .Must((cmd, o) => o == LetteringOrigin.Manual
                              || o == LetteringOrigin.Suggestion
                              || (o == LetteringOrigin.Bulk && cmd.BulkRequestId is not null))
            .WithMessage("Origine de lettrage invalide.");

        // Annexe C §4 : la voie de masse ne lettre que des groupes soldés, sans écart de change.
        // Condition sur BulkRequestId aussi : un corps HTTP « Bulk » (sans identifiant) reçoit le
        // seul message « Origine de lettrage invalide », pas des messages sur des champs internes.
        When(x => x.Origin == LetteringOrigin.Bulk && x.BulkRequestId is not null, () =>
        {
            RuleFor(x => x.RequireNoExchangeDifference)
                .Equal(true).WithMessage("Le lettrage en masse doit refuser les écarts de change.");
            RuleFor(x => x.AllowPartial)
                .Equal(false).WithMessage("Le lettrage en masse n'accepte pas de lettrage partiel.");
        });

        RuleFor(x => x.BulkRequestId)
            .Must(id => id != Guid.Empty)
            .When(x => x.BulkRequestId is not null)
            .WithMessage("Identifiant de lot invalide.");

        // L'audit « Lettered » porte BulkRequestId : il ne doit désigner qu'un groupe d'un lot.
        RuleFor(x => x.BulkRequestId)
            .Null()
            .When(x => x.Origin != LetteringOrigin.Bulk)
            .WithMessage("L'identifiant de lot est réservé au lettrage en masse.");

        RuleFor(x => x.SuggestionKey)
            .MaximumLength(32).WithMessage("La clé de proposition ne peut pas dépasser 32 caractères.");
    }
}

/// <summary>
/// Validation du lot de lettrage en masse (plan v2, Phase 3, annexe C §4). Une seule erreur rejette
/// toute la requête (400), avant tout lettrage.
/// </summary>
/// <remarks>
/// Les plafonds viennent des réglages, ramenés dans leurs bornes dures
/// (<see cref="LetteringSuggestionSettings.Clamped"/>) : une configuration hors bornes ne peut pas
/// élargir un lot au-delà de 200 groupes, 50 lignes par groupe et 2 000 lignes.
/// </remarks>
public sealed class BulkLetterCommandValidator : AbstractValidator<BulkLetterCommand>
{
    public const int ClientKeyMaxLength = 32;

    // Classe de caractères simple, sans groupe ni alternative : aucun retour arrière possible.
    private static readonly Regex ClientKeyPattern = new("^[A-Za-z0-9_-]+$", RegexOptions.Compiled);

    public BulkLetterCommandValidator(IOptions<AccountingSettings> settings)
    {
        var caps = settings.Value.LetteringSuggestions.Clamped();
        var maxGroups = caps.BulkMaxGroups;
        var maxLinesPerGroup = caps.BulkMaxLinesPerGroup;
        var maxTotalLines = caps.BulkMaxTotalLines;

        RuleFor(x => x.RequestId)
            .NotEmpty().WithMessage("L'identifiant de lot est obligatoire.");

        // Cascade Stop : après un NotNull en échec, les règles suivantes ne lisent pas la liste.
        RuleFor(x => x.Groups)
            .Cascade(CascadeMode.Stop)
            .NotNull().WithMessage("Au moins un groupe est requis.")
            .Must(g => g.Count >= 1).WithMessage("Au moins un groupe est requis.")
            .Must(g => g.Count <= maxGroups)
            .WithMessage($"{maxGroups} groupes au maximum peuvent être lettrés en une seule fois.");

        RuleForEach(x => x.Groups)
            .NotNull().WithMessage("Groupe invalide.");

        // Where : un élément null (JSON « null ») est signalé ci-dessus, jamais passé aux règles.
        RuleForEach(x => x.Groups).Where(g => g is not null).ChildRules(group =>
        {
            group.RuleFor(g => g.ClientKey)
                .Cascade(CascadeMode.Stop)
                .NotEmpty().WithMessage("La clé de proposition est obligatoire.")
                .MaximumLength(ClientKeyMaxLength)
                .WithMessage($"La clé de proposition ne peut pas dépasser {ClientKeyMaxLength} caractères.")
                .Must(k => ClientKeyPattern.IsMatch(k))
                .WithMessage("La clé de proposition contient des caractères invalides.");

            group.RuleFor(g => g.JournalEntryLineIds)
                .Cascade(CascadeMode.Stop)
                .NotNull().WithMessage("Au moins deux lignes sont requises par groupe.")
                .Must(ids => ids.Count >= 2).WithMessage("Au moins deux lignes sont requises par groupe.")
                .Must(ids => ids.Count <= maxLinesPerGroup)
                .WithMessage($"{maxLinesPerGroup} lignes au maximum par groupe.")
                .Must(ids => ids.All(id => id != Guid.Empty)).WithMessage("Identifiant de ligne invalide.")
                .Must(ids => ids.Distinct().Count() == ids.Count)
                .WithMessage("Une même ligne est sélectionnée plusieurs fois dans un groupe.");
        });

        // Contrôles inter-groupes : seulement si la liste est utilisable (les règles ci-dessus
        // signalent déjà une liste ou un groupe manquant).
        When(x => x.Groups is not null && x.Groups.All(g => g is not null), () =>
        {
            RuleFor(x => x.Groups)
                .Must(g => g.Sum(x => x.JournalEntryLineIds?.Count ?? 0) <= maxTotalLines)
                .WithMessage($"{maxTotalLines} lignes au maximum peuvent être lettrées en une seule fois.")
                .Must(NoLineInTwoGroups)
                .WithMessage("Une même ligne apparaît dans plusieurs groupes.")
                .Must(g => g.Where(x => !string.IsNullOrEmpty(x.ClientKey))
                            .Select(x => x.ClientKey).Distinct(StringComparer.Ordinal).Count()
                           == g.Count(x => !string.IsNullOrEmpty(x.ClientKey)))
                .WithMessage("Une même clé de proposition apparaît dans plusieurs groupes.");
        });
    }

    private static bool NoLineInTwoGroups(IReadOnlyList<BulkLetterGroup> groups)
    {
        var seen = new HashSet<Guid>();
        foreach (var group in groups)
        {
            // Distinct par groupe : un doublon interne est signalé par la règle du groupe.
            foreach (var id in (group.JournalEntryLineIds ?? Array.Empty<Guid>()).Distinct())
            {
                if (!seen.Add(id))
                    return false;
            }
        }
        return true;
    }
}

/// <summary>
/// Règle partagée du format de code de lettrage « L00001 » / « P00001 » (plan §4.6) : une seule
/// implémentation pour le délettrage (<see cref="UnletterAccountEntriesCommandValidator"/>) et la
/// consultation de groupe (<see cref="GetLetteringGroupQueryValidator"/>).
/// </summary>
internal static class LetteringCodeRule
{
    private static readonly Regex CodePattern = new("^[LP]\\d{5,15}$", RegexOptions.Compiled);

    internal static IRuleBuilderOptions<T, string> LetteringCode<T>(this IRuleBuilder<T, string> rule) =>
        rule.NotEmpty().WithMessage("Le code de lettrage est obligatoire.")
            .MaximumLength(16).WithMessage("Le code de lettrage ne peut pas dépasser 16 caractères.")
            .Must(code => CodePattern.IsMatch(code.Trim().ToUpperInvariant()))
            .WithMessage("Le code de lettrage doit être au format L00001 ou P00001.");
}

public sealed class UnletterAccountEntriesCommandValidator : AbstractValidator<UnletterAccountEntriesCommand>
{
    public UnletterAccountEntriesCommandValidator()
    {
        RuleFor(x => x.Code).LetteringCode();
    }
}

public sealed class CompletePartialLetteringCommandValidator : AbstractValidator<CompletePartialLetteringCommand>
{
    private static readonly Regex PartialCodePattern = new("^P\\d{5,15}$", RegexOptions.Compiled);

    public CompletePartialLetteringCommandValidator()
    {
        RuleFor(x => x.Code)
            .NotEmpty().WithMessage("Le code du groupe partiel est obligatoire.")
            .MaximumLength(16).WithMessage("Le code de lettrage ne peut pas dépasser 16 caractères.")
            .Must(code => PartialCodePattern.IsMatch(code.Trim().ToUpperInvariant()))
            .WithMessage("Seul un groupe partiel (code « P ») peut être complété.");

        RuleFor(x => x.JournalEntryLineIds)
            .NotEmpty().WithMessage("Au moins une nouvelle ligne est requise.")
            .Must(ids => ids.Count <= 500)
            .WithMessage("500 lignes au maximum peuvent être ajoutées en une seule fois.")
            .Must(ids => ids.All(id => id != Guid.Empty))
            .WithMessage("Identifiant de ligne invalide.")
            .Must(ids => ids.Distinct().Count() == ids.Count)
            .WithMessage("Une même ligne est sélectionnée plusieurs fois.");
    }
}

public sealed class GetLetteringLinesQueryValidator : AbstractValidator<GetLetteringLinesQuery>
{
    public GetLetteringLinesQueryValidator()
    {
        RuleFor(x => x.Account)
            .NotEmpty().WithMessage("Le compte est obligatoire.")
            .MaximumLength(32).WithMessage("Le compte ne peut pas dépasser 32 caractères.")
            .Matches("^\\d{1,32}$").WithMessage("Le compte doit être composé de chiffres.");

        // Bornes de période obligatoires (plan §4.1) : sans elles, un appel « nu » balaierait tout
        // l'historique du compte — exactement le comportement que la refonte supprime.
        RuleFor(x => x.From)
            .NotEmpty().WithMessage("La date de début est obligatoire.");

        RuleFor(x => x.To)
            .NotEmpty().WithMessage("La date de fin est obligatoire.")
            .GreaterThanOrEqualTo(x => x.From).WithMessage("La date de fin doit être postérieure ou égale à la date de début.");

        RuleFor(x => x)
            .Must(x => (x.To.Date - x.From.Date).TotalDays <= 732)
            .WithMessage("La période ne peut pas dépasser 732 jours.");

        RuleFor(x => x.PageSize)
            .InclusiveBetween(1, 2000).WithMessage("La taille de page doit être entre 1 et 2000.");

        RuleFor(x => x.Page)
            .GreaterThanOrEqualTo(1).WithMessage("Le numéro de page doit être au moins 1.");

        RuleFor(x => x)
            .Must(x => !x.MinAmount.HasValue || !x.MaxAmount.HasValue || x.MinAmount.Value <= x.MaxAmount.Value)
            .WithMessage("Le montant minimum doit être inférieur ou égal au montant maximum.");

        RuleFor(x => x.Search)
            .MaximumLength(100).WithMessage("La recherche ne peut pas dépasser 100 caractères.");

        RuleFor(x => x)
            .Must(x => !x.ThirdPartyId.HasValue || x.ThirdPartyKind.HasValue)
            .WithMessage("Le type de tiers est obligatoire si un tiers est précisé.");
    }
}

/// <summary>
/// <c>GET api/accounting/lettering/suggestions</c> (plan v2, Phase 3, annexe C §3) : mêmes règles de
/// filtre que <c>lettering/lines</c> (compte et période obligatoires, période ≤ 732 jours), plus une
/// borne sur le nombre de propositions demandées.
/// </summary>
public sealed class GetLetteringSuggestionsQueryValidator : AbstractValidator<GetLetteringSuggestionsQuery>
{
    public const int MaxResultsLimit = 200;

    public GetLetteringSuggestionsQueryValidator()
    {
        RuleFor(x => x.Filter)
            .NotNull().WithMessage("Le filtre est obligatoire.")
            .SetValidator(new GetLetteringLinesQueryValidator());

        RuleFor(x => x.MaxResults)
            .InclusiveBetween(1, MaxResultsLimit)
            .WithMessage($"Le nombre de propositions doit être entre 1 et {MaxResultsLimit}.");
    }
}

/// <summary>
/// <c>GET api/accounting/lettering/groups/{code}</c> : le code est normalisé en majuscules puis
/// validé au format L/P + 5 à 15 chiffres (même règle que <see cref="UnletterAccountEntriesCommandValidator"/>),
/// afin qu'un segment d'URL arbitraire soit rejeté en 400 et non en 404 « introuvable ».
/// </summary>
public sealed class GetLetteringGroupQueryValidator : AbstractValidator<GetLetteringGroupQuery>
{
    public GetLetteringGroupQueryValidator()
    {
        RuleFor(x => x.Code).LetteringCode();
    }
}

public sealed class ReverseJournalEntryCommandValidator : AbstractValidator<ReverseJournalEntryCommand>
{
    public ReverseJournalEntryCommandValidator()
    {
        RuleFor(x => x.Id)
            .NotEmpty().WithMessage("L'écriture à extourner est obligatoire.");

        RuleFor(x => x.Reason)
            .NotEmpty().WithMessage("Le motif de l'extourne est obligatoire.")
            .MaximumLength(400).WithMessage("Le motif ne peut pas dépasser 400 caractères.");
    }
}

public sealed class CloseAnnualPeriodCommandValidator : AbstractValidator<CloseAnnualPeriodCommand>
{
    public CloseAnnualPeriodCommandValidator()
    {
        RuleFor(x => x.FiscalYear)
            .InclusiveBetween(2000, 2100).WithMessage("L'exercice doit être entre 2000 et 2100.");
    }
}
