using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Features.Accounting.Lettering;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Services;
using FactuTrust.Infrastructure.Tests.Fixtures;
using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services;

/// <summary>
/// Vérifie que le lettrage manuel rejoint la transaction ambiante (TenantUnitOfWork) et peut
/// lettrer des lignes d'écriture non encore commitées — scénario critique du paiement paie.
/// SQL Server requis (LocalDB éphémère) : InMemory ignore les transactions.
/// </summary>
public sealed class LetteringServiceAmbientTransactionTests : IDisposable
{
    private readonly SqlTestDatabase _sqlDb = new(nameof(LetteringServiceAmbientTransactionTests));
    private readonly string? _connectionString;
    private readonly bool _canRun;
    private readonly TenantAmbientTransaction _ambient = new();
    private readonly TenantDbContextFactory? _factory;
    private readonly TenantUnitOfWork? _unitOfWork;
    private readonly LetteringService? _lettering;

    public LetteringServiceAmbientTransactionTests()
    {
        _connectionString = _sqlDb.ConnectionString;
        _canRun = _sqlDb.CanRun;
        if (!_canRun)
            return;

        var tenantContext = new Mock<ITenantContext>();
        tenantContext.SetupGet(c => c.ConnectionString).Returns(_connectionString);

        var hostEnvironment = new Mock<IHostEnvironment>();
        hostEnvironment.SetupGet(e => e.EnvironmentName).Returns(Environments.Development);

        _factory = new TenantDbContextFactory(
            tenantContext.Object,
            new Mock<IMediator>().Object,
            _ambient,
            NullLogger<TenantDbContext>.Instance,
            NullLoggerFactory.Instance,
            new ConfigurationBuilder().Build(),
            hostEnvironment.Object);
        _unitOfWork = new TenantUnitOfWork(_factory, _ambient, NullLogger<TenantUnitOfWork>.Instance);
        _lettering = new LetteringService(_factory, _ambient);
    }

    [Fact]
    public async Task ManualLetterAsync_InsideUnitOfWork_LettersUncommittedLines()
    {
        if (!_canRun) return;

        var payroll421LineId = Guid.Empty;
        var payment421LineId = Guid.Empty;

        var result = await _unitOfWork!.ExecuteAsync(async ct =>
        {
            await using var ctx = _factory!.CreateContext();
            var period = AccountingPeriod.Create(2026, 8, new DateTime(2026, 8, 1), new DateTime(2026, 8, 31));
            ctx.AccountingPeriods.Add(period);

            var employeeId = Guid.NewGuid();
            var payrollEntry = JournalEntry.Create(
                1, "JOD", new DateTime(2026, 8, 1), "Engagement paie",
                period.Id, false, "PayrollRun", Guid.NewGuid(),
                new[]
                {
                    new JournalLineInput("640", "Charges", 1151.733m, 0m, null, ThirdPartyKind.None),
                    new JournalLineInput("4250001", "Salaire", 0m, 1151.733m, employeeId, ThirdPartyKind.Employee)
                }).Value;
            payrollEntry.SetAuditInfo("test", false);

            var paymentEntry = JournalEntry.Create(
                1, "JB", new DateTime(2026, 8, 5), "Paiement paie",
                period.Id, true, "PayrollPayment", Guid.NewGuid(),
                new[]
                {
                    new JournalLineInput("4250001", "Paiement", 1151.733m, 0m, employeeId, ThirdPartyKind.Employee),
                    new JournalLineInput("5321", "Banque", 0m, 1151.733m, null, ThirdPartyKind.None)
                }).Value;
            paymentEntry.SetAuditInfo("test", false);

            ctx.JournalEntries.AddRange(payrollEntry, paymentEntry);
            await ctx.SaveChangesAsync(ct);

            payroll421LineId = payrollEntry.Lines.Single(l => l.AccountNumber.StartsWith("425")).Id;
            payment421LineId = paymentEntry.Lines.Single(l => l.AccountNumber.StartsWith("425")).Id;

            return await _lettering!.ManualLetterAsync(new[] { payroll421LineId, payment421LineId }, cancellationToken: ct);
        });

        Assert.True(result.IsSuccess);

        await using var verify = _factory!.CreateIsolatedContext();
        var payrollCode = await verify.JournalEntryLines.AsNoTracking()
            .Where(l => l.Id == payroll421LineId)
            .Select(l => l.LetteringCode)
            .SingleAsync();
        var paymentCode = await verify.JournalEntryLines.AsNoTracking()
            .Where(l => l.Id == payment421LineId)
            .Select(l => l.LetteringCode)
            .SingleAsync();

        Assert.NotNull(payrollCode);
        Assert.Equal(payrollCode, paymentCode);
        Assert.True(await verify.LetteringGroups.AsNoTracking().AnyAsync(g => g.Code == payrollCode));
    }

    [Fact]
    public async Task ManualLetterAsync_InsideUnitOfWork_FailureRollsBackLettering()
    {
        if (!_canRun) return;

        var payroll421LineId = Guid.Empty;
        var payment421LineId = Guid.Empty;

        var result = await _unitOfWork!.ExecuteAsync(async ct =>
        {
            await using var ctx = _factory!.CreateContext();
            var period = AccountingPeriod.Create(2026, 8, new DateTime(2026, 8, 1), new DateTime(2026, 8, 31));
            ctx.AccountingPeriods.Add(period);

            var employeeId = Guid.NewGuid();
            var payrollEntry = JournalEntry.Create(
                1, "JOD", new DateTime(2026, 8, 1), "Engagement",
                period.Id, false, "PayrollRun", Guid.NewGuid(),
                new[]
                {
                    new JournalLineInput("640", "Charges", 100m, 0m, null, ThirdPartyKind.None),
                    new JournalLineInput("4250001", "Salaire", 0m, 100m, employeeId, ThirdPartyKind.Employee)
                }).Value;
            payrollEntry.SetAuditInfo("test", false);

            var paymentEntry = JournalEntry.Create(
                1, "JB", new DateTime(2026, 8, 5), "Paiement",
                period.Id, true, "PayrollPayment", Guid.NewGuid(),
                new[]
                {
                    new JournalLineInput("4250001", "Paiement", 100m, 0m, employeeId, ThirdPartyKind.Employee),
                    new JournalLineInput("5321", "Banque", 0m, 100m, null, ThirdPartyKind.None)
                }).Value;
            paymentEntry.SetAuditInfo("test", false);

            ctx.JournalEntries.AddRange(payrollEntry, paymentEntry);
            await ctx.SaveChangesAsync(ct);

            payroll421LineId = payrollEntry.Lines.Single(l => l.AccountNumber.StartsWith("425")).Id;
            payment421LineId = paymentEntry.Lines.Single(l => l.AccountNumber.StartsWith("425")).Id;

            var letterResult = await _lettering!.ManualLetterAsync(new[] { payroll421LineId, payment421LineId }, cancellationToken: ct);
            if (letterResult.IsFailure)
                return letterResult;

            return Result.Failure(Error.Validation("Test", "rollback simulé après lettrage"));
        });

        Assert.True(result.IsFailure);

        await using var verify = _factory!.CreateIsolatedContext();
        Assert.Equal(0, await verify.LetteringGroups.CountAsync());
        Assert.Equal(0, await verify.JournalEntries.CountAsync());
    }

    /// <summary>
    /// p3-11 : dans une transaction ambiante (chemin sans prévalidation), le refus d'écart de
    /// change intervient avant toute écriture — rien n'est lettré, même si la transaction englobante
    /// est validée ensuite.
    /// </summary>
    [Fact]
    public async Task ManualLetterAsync_InsideUnitOfWork_RequireNoExchangeDifference_RejectsEuroGap()
    {
        if (!_canRun) return;

        var (invoiceId, paymentId) = (Guid.Empty, Guid.Empty);
        string? errorCode = null;

        var outcome = await _unitOfWork!.ExecuteAsync(async ct =>
        {
            await using var ctx = _factory!.CreateContext();
            var period = AccountingPeriod.Create(2026, 9, new DateTime(2026, 9, 1), new DateTime(2026, 9, 30));
            ctx.AccountingPeriods.Add(period);

            var invoice = JournalEntry.Create(
                1, "JV", new DateTime(2026, 9, 1), "Facture EUR", period.Id, false, "Manual", null,
                new[]
                {
                    new JournalLineInput("411", "Facture", 3000m, 0m, null, ThirdPartyKind.None, 1000m, 0m),
                    new JournalLineInput("707", "Vente", 0m, 3000m, null, ThirdPartyKind.None, 0m, 1000m)
                },
                currency: "EUR", exchangeRate: 3.0m).Value;
            var payment = JournalEntry.Create(
                2, "JB", new DateTime(2026, 9, 2), "Règlement EUR", period.Id, false, "Manual", null,
                new[]
                {
                    new JournalLineInput("532", "Banque", 3100m, 0m, null, ThirdPartyKind.None, 1000m, 0m),
                    new JournalLineInput("411", "Règlement", 0m, 3100m, null, ThirdPartyKind.None, 0m, 1000m)
                },
                currency: "EUR", exchangeRate: 3.1m).Value;
            invoice.SetAuditInfo("test", false);
            payment.SetAuditInfo("test", false);
            ctx.JournalEntries.AddRange(invoice, payment);
            await ctx.SaveChangesAsync(ct);

            invoiceId = invoice.Lines.Single(l => l.AccountNumber == "411").Id;
            paymentId = payment.Lines.Single(l => l.AccountNumber == "411").Id;

            var letter = await _lettering!.ManualLetterAsync(
                new[] { invoiceId, paymentId }, cancellationToken: ct, requireNoExchangeDifference: true);
            errorCode = letter.IsFailure ? letter.Error.Code : null;
            return Result.Success();
        });

        Assert.True(outcome.IsSuccess);
        Assert.Equal(LetteringErrorCodes.ExchangeDifference, errorCode);

        await using var verify = _factory!.CreateIsolatedContext();
        Assert.False(await verify.LetteringGroups.AsNoTracking().AnyAsync());
        var codes = await verify.JournalEntryLines.AsNoTracking()
            .Where(l => l.Id == invoiceId || l.Id == paymentId)
            .Select(l => l.LetteringCode).ToListAsync();
        Assert.Equal(2, codes.Count);
        Assert.All(codes, Assert.Null);
    }

    /// <summary>
    /// Plan §11 PR1 (SQL réel) : un délettrage réussi, exécuté dans la transaction ambiante du
    /// UoW, doit être annulé intégralement si l'opération englobante échoue ensuite — le groupe et
    /// le code de lettrage des lignes doivent être restaurés à l'identique.
    /// </summary>
    [Fact]
    public async Task Unletter_Isolated_UsesTransaction_RollbackOnFailure()
    {
        if (!_canRun) return;

        var (lineAId, lineBId) = (Guid.Empty, Guid.Empty);
        string? code = null;

        var setup = await _unitOfWork!.ExecuteAsync(async ct =>
        {
            await using var ctx = _factory!.CreateContext();
            var period = AccountingPeriod.Create(2026, 8, new DateTime(2026, 8, 1), new DateTime(2026, 8, 31));
            ctx.AccountingPeriods.Add(period);

            var entry = JournalEntry.Create(
                1, "JOA", new DateTime(2026, 8, 1), "Facture",
                period.Id, false, "Manual", Guid.NewGuid(),
                new[]
                {
                    new JournalLineInput("411", "Client", 300m, 0m, Guid.NewGuid(), ThirdPartyKind.Client),
                    new JournalLineInput("411", "Règlement", 0m, 300m, Guid.NewGuid(), ThirdPartyKind.Client)
                }).Value;
            entry.SetAuditInfo("test", false);
            ctx.JournalEntries.Add(entry);
            await ctx.SaveChangesAsync(ct);

            var lines = entry.Lines.ToList();
            lineAId = lines[0].Id;
            lineBId = lines[1].Id;

            var letterResult = await _lettering!.ManualLetterAsync(new[] { lineAId, lineBId }, cancellationToken: ct);
            if (letterResult.IsFailure)
                return Result.Failure<string>(letterResult.Error);

            code = letterResult.Value.Code;
            return Result.Success(code);
        });

        Assert.True(setup.IsSuccess);
        Assert.NotNull(code);

        var rollback = await _unitOfWork!.ExecuteAsync(async ct =>
        {
            var unletterResult = await _lettering!.UnletterAsync(code!, cancellationToken: ct);
            if (unletterResult.IsFailure)
                return Result.Failure(unletterResult.Error);

            // Échec simulé APRÈS le délettrage réussi : la transaction ambiante doit tout annuler.
            return Result.Failure(Error.Validation("Test", "rollback simulé après délettrage"));
        });

        Assert.True(rollback.IsFailure);

        await using var verify = _factory!.CreateIsolatedContext();
        var restoredGroup = await verify.LetteringGroups.AsNoTracking().SingleOrDefaultAsync(g => g.Code == code);
        Assert.NotNull(restoredGroup);

        var restoredLineA = await verify.JournalEntryLines.AsNoTracking().Where(l => l.Id == lineAId).Select(l => l.LetteringCode).SingleAsync();
        var restoredLineB = await verify.JournalEntryLines.AsNoTracking().Where(l => l.Id == lineBId).Select(l => l.LetteringCode).SingleAsync();
        Assert.Equal(code, restoredLineA);
        Assert.Equal(code, restoredLineB);
    }

    /// <summary>
    /// Plan §11 PR1 (SQL réel) : deux lettrages concurrents qui ciblent tous les deux la MÊME ligne
    /// (A, partagée) doivent se sérialiser via la transaction Serializable — un seul doit réussir,
    /// l'autre doit échouer explicitement (pas de doublon silencieux, pas de deadlock non géré).
    /// </summary>
    [Fact]
    public async Task ConcurrentLetter_SameLine_OnlyOneSucceeds()
    {
        if (!_canRun) return;

        var (lineAId, lineBId, lineCId) = (Guid.Empty, Guid.Empty, Guid.Empty);

        await using (var ctx = _factory!.CreateIsolatedContext())
        {
            var period = AccountingPeriod.Create(2026, 8, new DateTime(2026, 8, 1), new DateTime(2026, 8, 31));
            ctx.AccountingPeriods.Add(period);

            var entry = JournalEntry.Create(
                1, "JOA", new DateTime(2026, 8, 1), "Facture multi-règlement",
                period.Id, false, "Manual", Guid.NewGuid(),
                new[]
                {
                    new JournalLineInput("411", "Client", 100m, 0m, Guid.NewGuid(), ThirdPartyKind.Client),
                    new JournalLineInput("411", "Règlement 1", 0m, 100m, Guid.NewGuid(), ThirdPartyKind.Client),
                    new JournalLineInput("411", "Règlement 2", 0m, 100m, Guid.NewGuid(), ThirdPartyKind.Client),
                    new JournalLineInput("411", "Autre client", 100m, 0m, Guid.NewGuid(), ThirdPartyKind.Client)
                }).Value;
            entry.SetAuditInfo("test", false);
            ctx.JournalEntries.Add(entry);
            await ctx.SaveChangesAsync();

            var lines = entry.Lines.ToList();
            lineAId = lines[0].Id;
            lineBId = lines[1].Id;
            lineCId = lines[2].Id;
        }

        // Deux tentatives concurrentes partagent la ligne A : (A, B) et (A, C). Chaque appel ouvre
        // sa propre transaction Serializable (chemin non-ambiant de ManualLetterAsync).
        var taskAB = _lettering!.ManualLetterAsync(new[] { lineAId, lineBId });
        var taskAC = _lettering!.ManualLetterAsync(new[] { lineAId, lineCId });
        await Task.WhenAll(taskAB, taskAC);

        var results = new[] { taskAB.Result, taskAC.Result };
        Assert.Single(results, r => r.IsSuccess);
        Assert.Single(results, r => r.IsFailure);
        Assert.Equal(LetteringErrorCodes.AlreadyLettered, results.Single(r => r.IsFailure).Error.Code);

        await using var verify = _factory!.CreateIsolatedContext();
        Assert.Equal(1, await verify.LetteringGroups.CountAsync());
        var codeA = await verify.JournalEntryLines.AsNoTracking().Where(l => l.Id == lineAId).Select(l => l.LetteringCode).SingleAsync();
        Assert.NotNull(codeA);
    }

    /// <summary>
    /// Plan §11 PR1 (SQL réel) : deux lettrages concurrents sur des lignes totalement disjointes
    /// doivent tous les deux réussir, avec des codes distincts (pas de collision sur `NextCodeAsync`
    /// malgré le verrou `UPDLOCK, HOLDLOCK` partagé).
    /// </summary>
    [Fact]
    public async Task ConcurrentLetter_DistinctLines_GetDistinctCodes()
    {
        if (!_canRun) return;

        var (lineAId, lineBId, lineCId, lineDId) = (Guid.Empty, Guid.Empty, Guid.Empty, Guid.Empty);

        await using (var ctx = _factory!.CreateIsolatedContext())
        {
            var period = AccountingPeriod.Create(2026, 8, new DateTime(2026, 8, 1), new DateTime(2026, 8, 31));
            ctx.AccountingPeriods.Add(period);

            var entry1 = JournalEntry.Create(
                1, "JOA", new DateTime(2026, 8, 1), "Facture 1",
                period.Id, false, "Manual", Guid.NewGuid(),
                new[]
                {
                    new JournalLineInput("411", "Client 1", 150m, 0m, Guid.NewGuid(), ThirdPartyKind.Client),
                    new JournalLineInput("411", "Règlement 1", 0m, 150m, Guid.NewGuid(), ThirdPartyKind.Client)
                }).Value;
            entry1.SetAuditInfo("test", false);

            var entry2 = JournalEntry.Create(
                2, "JOA", new DateTime(2026, 8, 2), "Facture 2",
                period.Id, false, "Manual", Guid.NewGuid(),
                new[]
                {
                    new JournalLineInput("411", "Client 2", 250m, 0m, Guid.NewGuid(), ThirdPartyKind.Client),
                    new JournalLineInput("411", "Règlement 2", 0m, 250m, Guid.NewGuid(), ThirdPartyKind.Client)
                }).Value;
            entry2.SetAuditInfo("test", false);

            ctx.JournalEntries.AddRange(entry1, entry2);
            await ctx.SaveChangesAsync();

            lineAId = entry1.Lines.First().Id;
            lineBId = entry1.Lines.Last().Id;
            lineCId = entry2.Lines.First().Id;
            lineDId = entry2.Lines.Last().Id;
        }

        var taskAB = _lettering!.ManualLetterAsync(new[] { lineAId, lineBId });
        var taskCD = _lettering!.ManualLetterAsync(new[] { lineCId, lineDId });
        await Task.WhenAll(taskAB, taskCD);

        Assert.True(taskAB.Result.IsSuccess);
        Assert.True(taskCD.Result.IsSuccess);
        Assert.NotEqual(taskAB.Result.Value.Code, taskCD.Result.Value.Code);

        await using var verify = _factory!.CreateIsolatedContext();
        var distinctCodes = await verify.LetteringGroups.AsNoTracking().Select(g => g.Code).Distinct().CountAsync();
        Assert.Equal(2, distinctCodes);
    }

    /// <summary>
    /// Plan §11 PR1 (SQL réel) : `NextCodeAsync` doit continuer à fonctionner correctement au-delà
    /// de 99 999 (le format `D5` n'est qu'une largeur MINIMALE, pas un plafond, et le `SUBSTRING`
    /// SQL extrait la partie numérique quelle que soit sa longueur).
    /// </summary>
    [Fact]
    public async Task NextCode_Relational_UsesMaxNotFullScan()
    {
        if (!_canRun) return;

        Guid lineAId, lineBId;

        await using (var ctx = _factory!.CreateIsolatedContext())
        {
            var period = AccountingPeriod.Create(2026, 8, new DateTime(2026, 8, 1), new DateTime(2026, 8, 31));
            ctx.AccountingPeriods.Add(period);

            var existingEntry = JournalEntry.Create(
                1, "JOA", new DateTime(2026, 8, 1), "Historique au-delà de 99999",
                period.Id, false, "Manual", Guid.NewGuid(),
                new[]
                {
                    new JournalLineInput("411", "Client", 50m, 0m, Guid.NewGuid(), ThirdPartyKind.Client),
                    new JournalLineInput("411", "Règlement", 0m, 50m, Guid.NewGuid(), ThirdPartyKind.Client)
                }).Value;
            existingEntry.SetAuditInfo("test", false);
            ctx.JournalEntries.Add(existingEntry);
            await ctx.SaveChangesAsync();

            var existingLines = existingEntry.Lines.ToList();
            existingLines[0].SetLetteringCode("L100000");
            existingLines[1].SetLetteringCode("L100000");
            var existingGroup = LetteringGroup.Create(
                "L100000", "411", Money.Create(50m),
                new[] { existingLines[0].Id, existingLines[1].Id }).Value;
            ctx.LetteringGroups.Add(existingGroup);
            await ctx.SaveChangesAsync();

            var newEntry = JournalEntry.Create(
                2, "JOA", new DateTime(2026, 8, 2), "Nouvelle facture",
                period.Id, false, "Manual", Guid.NewGuid(),
                new[]
                {
                    new JournalLineInput("411", "Client", 60m, 0m, Guid.NewGuid(), ThirdPartyKind.Client),
                    new JournalLineInput("411", "Règlement", 0m, 60m, Guid.NewGuid(), ThirdPartyKind.Client)
                }).Value;
            newEntry.SetAuditInfo("test", false);
            ctx.JournalEntries.Add(newEntry);
            await ctx.SaveChangesAsync();

            lineAId = newEntry.Lines.First().Id;
            lineBId = newEntry.Lines.Last().Id;
        }

        var result = await _lettering!.ManualLetterAsync(new[] { lineAId, lineBId });

        Assert.True(result.IsSuccess);
        Assert.Equal("L100001", result.Value.Code);
    }

    /// <summary>
    /// Plan §11 PR1 (non-régression du chemin ambiant) : un lot de paie qui lettre plusieurs
    /// groupes successifs dans la MÊME transaction ambiante doit produire des codes distincts
    /// (la visibilité de `NextCodeAsync` sur les lignes déjà sauvegardées dans la même transaction
    /// doit rester correcte, même avec plusieurs `DbContext` enrôlés successivement).
    /// </summary>
    [Fact]
    public async Task AmbientPayrollBatch_MultipleGroups_DistinctCodes()
    {
        if (!_canRun) return;

        var result = await _unitOfWork!.ExecuteAsync(async ct =>
        {
            await using var ctx = _factory!.CreateContext();
            var period = AccountingPeriod.Create(2026, 8, new DateTime(2026, 8, 1), new DateTime(2026, 8, 31));
            ctx.AccountingPeriods.Add(period);

            var employee1 = Guid.NewGuid();
            var employee2 = Guid.NewGuid();

            var payrollEntry = JournalEntry.Create(
                1, "JOD", new DateTime(2026, 8, 1), "Engagement paie lot",
                period.Id, false, "PayrollRun", Guid.NewGuid(),
                new[]
                {
                    new JournalLineInput("640", "Charges 1", 100m, 0m, null, ThirdPartyKind.None),
                    new JournalLineInput("4250001", "Salaire 1", 0m, 100m, employee1, ThirdPartyKind.Employee),
                    new JournalLineInput("640", "Charges 2", 200m, 0m, null, ThirdPartyKind.None),
                    new JournalLineInput("4250002", "Salaire 2", 0m, 200m, employee2, ThirdPartyKind.Employee)
                }).Value;
            payrollEntry.SetAuditInfo("test", false);

            var paymentEntry = JournalEntry.Create(
                1, "JB", new DateTime(2026, 8, 5), "Paiement paie lot",
                period.Id, true, "PayrollPayment", Guid.NewGuid(),
                new[]
                {
                    new JournalLineInput("4250001", "Paiement 1", 100m, 0m, employee1, ThirdPartyKind.Employee),
                    new JournalLineInput("4250002", "Paiement 2", 200m, 0m, employee2, ThirdPartyKind.Employee),
                    new JournalLineInput("5321", "Banque", 0m, 300m, null, ThirdPartyKind.None)
                }).Value;
            paymentEntry.SetAuditInfo("test", false);

            ctx.JournalEntries.AddRange(payrollEntry, paymentEntry);
            await ctx.SaveChangesAsync(ct);

            var payroll1 = payrollEntry.Lines.Single(l => l.AccountNumber == "4250001").Id;
            var payment1 = paymentEntry.Lines.Single(l => l.AccountNumber == "4250001").Id;
            var payroll2 = payrollEntry.Lines.Single(l => l.AccountNumber == "4250002").Id;
            var payment2 = paymentEntry.Lines.Single(l => l.AccountNumber == "4250002").Id;

            var letter1 = await _lettering!.ManualLetterAsync(new[] { payroll1, payment1 }, origin: LetteringOrigin.Automatic, cancellationToken: ct);
            if (letter1.IsFailure)
                return Result.Failure<(string, string)>(letter1.Error);

            var letter2 = await _lettering!.ManualLetterAsync(new[] { payroll2, payment2 }, origin: LetteringOrigin.Automatic, cancellationToken: ct);
            if (letter2.IsFailure)
                return Result.Failure<(string, string)>(letter2.Error);

            return Result.Success((letter1.Value.Code, letter2.Value.Code));
        });

        Assert.True(result.IsSuccess);
        Assert.NotEqual(result.Value.Item1, result.Value.Item2);

        await using var verify = _factory!.CreateIsolatedContext();
        var distinctCodes = await verify.LetteringGroups.AsNoTracking().Select(g => g.Code).Distinct().CountAsync();
        Assert.Equal(2, distinctCodes);
    }

    /// <summary>
    /// Revue PR 1 (2e passe, SQL réel) : la complétion rejoint la transaction ambiante, comme le
    /// lettrage — un groupe « P » créé dans l'unité de travail peut être complété par une ligne
    /// elle-même non encore commitée, et le tout est commité (ou annulé) d'un seul tenant.
    /// </summary>
    [Fact]
    public async Task CompletePartial_InsideUnitOfWork_CompletesUncommittedLine()
    {
        if (!_canRun) return;

        string? partialCode = null;
        Guid extraLineId = Guid.Empty;

        var result = await _unitOfWork!.ExecuteAsync(async ct =>
        {
            await using var ctx = _factory!.CreateContext();
            var period = AccountingPeriod.Create(2026, 8, new DateTime(2026, 8, 1), new DateTime(2026, 8, 31));
            ctx.AccountingPeriods.Add(period);

            var entry = JournalEntry.Create(
                1, "JOA", new DateTime(2026, 8, 1), "Facture et règlements",
                period.Id, false, "Manual", Guid.NewGuid(),
                new[]
                {
                    new JournalLineInput("411", "Facture", 100m, 0m, Guid.NewGuid(), ThirdPartyKind.Client),
                    new JournalLineInput("411", "Règlement 1", 0m, 60m, Guid.NewGuid(), ThirdPartyKind.Client),
                    new JournalLineInput("411", "Règlement 2", 0m, 40m, Guid.NewGuid(), ThirdPartyKind.Client)
                }).Value;
            entry.SetAuditInfo("test", false);
            ctx.JournalEntries.Add(entry);
            await ctx.SaveChangesAsync(ct);

            var debit = entry.Lines.Single(l => l.DebitAmount.Amount == 100m).Id;
            var credit60 = entry.Lines.Single(l => l.CreditAmount.Amount == 60m).Id;
            var credit40 = entry.Lines.Single(l => l.CreditAmount.Amount == 40m).Id;
            extraLineId = credit40;

            var letterResult = await _lettering!.ManualLetterAsync(
                new[] { debit, credit60 }, allowPartial: true, cancellationToken: ct);
            if (letterResult.IsFailure)
                return Result.Failure<string>(letterResult.Error);
            partialCode = letterResult.Value.Code;

            // Complétion DANS la même transaction ambiante : la ligne ajoutée n'est pas commitée.
            var completeResult = await _lettering!.CompletePartialAsync(
                partialCode, new[] { credit40 }, allowPartial: false, cancellationToken: ct);
            return completeResult.IsFailure
                ? Result.Failure<string>(completeResult.Error)
                : Result.Success(completeResult.Value.Code);
        });

        Assert.True(result.IsSuccess, result.Error?.Description);
        Assert.NotNull(partialCode);
        Assert.Equal($"L{partialCode!.AsSpan(1)}", result.Value);

        await using var verify = _factory!.CreateIsolatedContext();
        var group = await verify.LetteringGroups.AsNoTracking().SingleAsync(g => g.Code == result.Value);
        Assert.False(group.IsPartial);
        Assert.Equal(100m, group.Amount.Amount);
        var extraCode = await verify.JournalEntryLines.AsNoTracking()
            .Where(l => l.Id == extraLineId)
            .Select(l => l.LetteringCode)
            .SingleAsync();
        Assert.Equal(result.Value, extraCode);
    }

    /// <summary>
    /// Revue PR 1 (2e passe, SQL réel) : une complétion et un lettrage concurrents sur la MÊME
    /// ligne doivent se sérialiser — exactement un des deux réussit, l'autre échoue en
    /// <c>LETTERING_ALREADY_LETTERED</c> (course perdue détectée, jamais de double lettrage).
    /// </summary>
    [Fact]
    public async Task ConcurrentCompleteAndLetter_SameLine_OnlyOneSucceeds()
    {
        if (!_canRun) return;

        string partialCode;
        Guid sharedLineId, otherLineId;

        await using (var ctx = _factory!.CreateIsolatedContext())
        {
            var period = AccountingPeriod.Create(2026, 8, new DateTime(2026, 8, 1), new DateTime(2026, 8, 31));
            ctx.AccountingPeriods.Add(period);

            var entry = JournalEntry.Create(
                1, "JOA", new DateTime(2026, 8, 1), "Facture multi-règlement",
                period.Id, false, "Manual", Guid.NewGuid(),
                new[]
                {
                    new JournalLineInput("411", "Facture", 100m, 0m, Guid.NewGuid(), ThirdPartyKind.Client),
                    new JournalLineInput("411", "Règlement 1", 0m, 60m, Guid.NewGuid(), ThirdPartyKind.Client),
                    new JournalLineInput("411", "Règlement 2", 0m, 40m, Guid.NewGuid(), ThirdPartyKind.Client),
                    new JournalLineInput("411", "Avoir", 40m, 0m, Guid.NewGuid(), ThirdPartyKind.Client),
                    // Équilibrage de l'écriture (140 débit = 140 crédit) — hors compte lettré.
                    new JournalLineInput("707", "Vente", 0m, 40m, null, ThirdPartyKind.None)
                }).Value;
            entry.SetAuditInfo("test", false);
            ctx.JournalEntries.Add(entry);
            await ctx.SaveChangesAsync();

            var debit100 = entry.Lines.Single(l => l.DebitAmount.Amount == 100m).Id;
            var credit60 = entry.Lines.Single(l => l.CreditAmount.Amount == 60m).Id;
            sharedLineId = entry.Lines.Single(l => l.AccountNumber == "411" && l.CreditAmount.Amount == 40m).Id;
            otherLineId = entry.Lines.Single(l => l.AccountNumber == "411" && l.DebitAmount.Amount == 40m).Id;

            var letter = await _lettering!.ManualLetterAsync(new[] { debit100, credit60 }, allowPartial: true);
            Assert.True(letter.IsSuccess, letter.Error?.Description);
            partialCode = letter.Value.Code;
        }

        // Complétion (P + règlement 2 → équilibré) contre lettrage (règlement 2 + avoir) : même
        // ligne partagée, un seul gagnant.
        var completeTask = _lettering!.CompletePartialAsync(partialCode, new[] { sharedLineId }, allowPartial: false);
        var letterTask = _lettering!.ManualLetterAsync(new[] { sharedLineId, otherLineId });
        await Task.WhenAll(completeTask, letterTask);

        var results = new[] { completeTask.Result, letterTask.Result };
        Assert.Single(results, r => r.IsSuccess);
        var loser = Assert.Single(results, r => r.IsFailure);
        Assert.Equal(LetteringErrorCodes.AlreadyLettered, loser.Error.Code);

        await using var verify = _factory!.CreateIsolatedContext();
        var sharedCode = await verify.JournalEntryLines.AsNoTracking()
            .Where(l => l.Id == sharedLineId)
            .Select(l => l.LetteringCode)
            .SingleAsync();
        Assert.NotNull(sharedCode);
        // Exactement un groupe contient la ligne partagée.
        var membershipCount = await verify.LetteringGroupMembers.AsNoTracking()
            .CountAsync(m => m.JournalEntryLineId == sharedLineId);
        Assert.Equal(1, membershipCount);
    }

    public void Dispose() => _sqlDb.Dispose();
}
