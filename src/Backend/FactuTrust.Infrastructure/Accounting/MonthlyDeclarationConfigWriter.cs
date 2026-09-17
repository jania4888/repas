using FactuTrust.Application.Features.Accounting.MonthlyDeclaration;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Accounting;

/// <summary>
/// Écrit un jeu de rubriques dans le dossier courant — le point d'écriture unique de la
/// duplication inter-dossiers et de l'import de modèle.
/// </summary>
/// <remarks>
/// <para>
/// <b>Insérer ou remplacer, jamais supprimer en masse.</b> Une rubrique absente du jeu entrant est
/// laissée intacte : un fichier partiel ne doit pas vider la configuration d'un dossier. C'est
/// aussi ce qui rend l'opération rejouable, et donc ce qui tient lieu de transaction lorsque la
/// source vit dans une autre base.
/// </para>
/// <para>
/// Les deux appelants écrivent exactement la même chose ; seule leur source diffère. Les garder
/// séparés ferait diverger, au premier champ ajouté, ce que produit un import de ce que produit une
/// duplication — pour la même configuration.
/// </para>
/// </remarks>
internal static class MonthlyDeclarationConfigWriter
{
    /// <summary>
    /// Applique les rubriques, puis les inclusions de familles, et enregistre le tout en une fois.
    /// </summary>
    /// <param name="families">
    /// Vide lorsque l'appelant ne transporte pas les inclusions. Une famille absente de la liste
    /// n'est pas touchée : l'inclusion est une décision du dossier, et un jeu entrant muet à son
    /// sujet ne doit pas la révoquer.
    /// </param>
    public static async Task<MonthlyDeclarationConfigApplyResult> ApplyAsync(
        TenantDbContext destination,
        IReadOnlyList<MonthlyDeclarationRubricDraft> drafts,
        IReadOnlyList<MonthlyDeclarationFamilyDraft> families,
        bool overwrite,
        string user,
        CancellationToken cancellationToken)
    {
        var existing = await destination.MonthlyDeclarationRubrics
            .Include(r => r.Accounts)
            .ToDictionaryAsync(r => r.Code, StringComparer.Ordinal, cancellationToken);

        var knownAccounts = (await destination.ChartOfAccounts
                .AsNoTracking()
                .Select(a => a.AccountNumber)
                .ToListAsync(cancellationToken))
            .ToHashSet(StringComparer.Ordinal);

        var skipped = new List<string>();
        var unknownAccounts = new SortedSet<string>(StringComparer.Ordinal);
        var inserted = 0;
        var replaced = 0;

        foreach (var draft in drafts)
        {
            foreach (var account in draft.Accounts)
            {
                // Les comptes copiés qui n'existent pas au plan de destination sont créés quand
                // même : les retirer effacerait l'indication de ce qui devrait exister.
                if (account.MatchMode == RubricAccountMatchMode.Exact
                    && !knownAccounts.Contains(account.AccountNumber))
                {
                    unknownAccounts.Add(account.AccountNumber);
                }
            }

            if (existing.TryGetValue(draft.Code, out var target))
            {
                if (!overwrite)
                {
                    skipped.Add(draft.Code);
                    continue;
                }

                var updated = target.Update(
                    draft.Label, draft.ReportCode, draft.GrossKind, draft.WithheldKind,
                    draft.GrossSide, draft.WithheldSide, draft.RatePercent,
                    draft.FixedGrossAmount, draft.FixedWithheldAmount,
                    draft.PayrollComponent, draft.WithheldPayrollComponent,
                    draft.EffectiveFrom, draft.EffectiveTo, draft.Accounts, draft.DisplayOrder);

                if (updated.IsFailure)
                {
                    skipped.Add(draft.Code);
                    continue;
                }

                var staleAccounts = await destination.MonthlyDeclarationRubricAccounts
                    .Where(a => a.RubricId == target.Id)
                    .ToListAsync(cancellationToken);
                destination.MonthlyDeclarationRubricAccounts.RemoveRange(staleAccounts);
                foreach (var account in target.Accounts)
                    destination.Entry(account).State = EntityState.Added;

                // L'état actif ne suit que si la source le dit : `Update` ne le touche pas, et une
                // source muette ne doit pas réactiver une rubrique que le dossier a écartée.
                if (draft.IsActive is { } wanted && target.IsActive != wanted)
                    target.ToggleActive();

                target.SetAuditInfo(user, isUpdate: true);
                replaced++;
                continue;
            }

            // Identifiants neufs : jamais ceux de la source. Les espaces de clés des bases sont
            // indépendants, et recopier un identifiant rendrait deux dossiers indiscernables dans
            // un export d'audit.
            var created = MonthlyDeclarationRubric.Create(
                draft.Family, draft.Code, draft.Label, draft.ReportCode,
                draft.GrossKind, draft.WithheldKind, draft.GrossSide, draft.WithheldSide,
                draft.RatePercent, draft.FixedGrossAmount, draft.FixedWithheldAmount,
                draft.PayrollComponent, draft.WithheldPayrollComponent,
                draft.EffectiveFrom, draft.EffectiveTo, draft.Accounts, draft.DisplayOrder);

            if (created.IsFailure)
            {
                skipped.Add(draft.Code);
                continue;
            }

            // `Create` rend toujours une rubrique active ; seul un fichier qui demande
            // explicitement l'inverse la désactive.
            if (draft.IsActive == false)
                created.Value.ToggleActive();

            created.Value.SetAuditInfo(user);
            destination.MonthlyDeclarationRubrics.Add(created.Value);
            inserted++;
        }

        var familiesChanged = await ApplyFamiliesAsync(destination, families, user, cancellationToken);

        await destination.SaveChangesAsync(cancellationToken);

        return new MonthlyDeclarationConfigApplyResult(
            inserted, replaced, skipped, unknownAccounts.ToList(), familiesChanged);
    }

    /// <summary>
    /// Aligne les inclusions de familles sur celles du jeu entrant.
    /// </summary>
    /// <remarks>
    /// Une inclusion qui ne change rien n'est pas réécrite : la ligne porterait sinon une date de
    /// modification et un auteur pour un import qui ne l'a pas touchée, et l'audit ne saurait plus
    /// distinguer « importé » de « décidé par le comptable ».
    /// </remarks>
    private static async Task<int> ApplyFamiliesAsync(
        TenantDbContext destination,
        IReadOnlyList<MonthlyDeclarationFamilyDraft> families,
        string user,
        CancellationToken cancellationToken)
    {
        if (families.Count == 0)
            return 0;

        var existing = await destination.MonthlyDeclarationFamilySettings
            .ToDictionaryAsync(f => f.Family, cancellationToken);

        var changed = 0;
        foreach (var draft in families)
        {
            if (existing.TryGetValue(draft.Family, out var setting))
            {
                if (setting.IsIncluded == draft.IsIncluded)
                    continue;

                setting.SetIncluded(draft.IsIncluded);
                setting.SetAuditInfo(user, isUpdate: true);
                changed++;
                continue;
            }

            var created = MonthlyDeclarationFamilySetting.Create(draft.Family, draft.IsIncluded);
            if (created.IsFailure)
                continue;

            created.Value.SetAuditInfo(user);
            destination.MonthlyDeclarationFamilySettings.Add(created.Value);
            changed++;
        }

        return changed;
    }
}

/// <summary>Compte rendu d'une écriture de configuration.</summary>
internal sealed record MonthlyDeclarationConfigApplyResult(
    int Inserted,
    int Replaced,
    IReadOnlyList<string> SkippedCodes,
    IReadOnlyList<string> UnknownAccounts,
    int FamiliesChanged);
