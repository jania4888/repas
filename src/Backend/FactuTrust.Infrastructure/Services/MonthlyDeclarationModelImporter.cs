using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Features.Accounting.MonthlyDeclaration;
using FactuTrust.Domain.Common;
using FactuTrust.Infrastructure.Accounting;
using FactuTrust.Infrastructure.MultiTenancy;

namespace FactuTrust.Infrastructure.Services;

/// <summary>
/// Écrit un modèle d'intégration DM analysé dans le dossier courant.
/// </summary>
/// <remarks>
/// Passe par le même point d'écriture que la duplication inter-dossiers
/// (<see cref="MonthlyDeclarationConfigWriter"/>) : même politique « insérer ou remplacer, jamais
/// supprimer en masse », et donc même propriété de rejouabilité. Deux chemins d'écriture auraient
/// fini par produire deux configurations différentes pour le même paramétrage.
/// </remarks>
public sealed class MonthlyDeclarationModelImporter : IMonthlyDeclarationModelImporter
{
    private readonly ITenantDbContextFactory _contextFactory;
    private readonly ICurrentUser _currentUser;

    public MonthlyDeclarationModelImporter(
        ITenantDbContextFactory contextFactory, ICurrentUser currentUser)
    {
        _contextFactory = contextFactory;
        _currentUser = currentUser;
    }

    public async Task<Result<MonthlyDeclarationModelImportOutcome>> ImportAsync(
        IReadOnlyList<MonthlyDeclarationRubricDraft> rubrics,
        IReadOnlyList<MonthlyDeclarationFamilyDraft> families,
        bool overwrite,
        CancellationToken cancellationToken = default)
    {
        await using var destination = _contextFactory.CreateContext();

        var applied = await MonthlyDeclarationConfigWriter.ApplyAsync(
            destination, rubrics, families, overwrite,
            _currentUser.Email ?? "system", cancellationToken);

        return Result.Success(new MonthlyDeclarationModelImportOutcome(
            applied.Inserted, applied.Replaced, applied.SkippedCodes,
            applied.UnknownAccounts, applied.FamiliesChanged));
    }
}
