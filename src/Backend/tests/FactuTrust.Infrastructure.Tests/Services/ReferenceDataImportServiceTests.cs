using System.Text;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services;

/// <summary>
/// Import étendu (référentiels). Exigences : dry-run bloquant par cible, commit additif idempotent
/// (ré-import ⇒ 0 création), invariants du domaine respectés (adresse obligatoire, email facultatif
/// mais format invalide rejeté),
/// balance d'ouverture équilibrée et mutuellement exclusive avec la génération d'à-nouveaux.
/// </summary>
public sealed class ReferenceDataImportServiceTests
{
    private readonly string _dbName = $"RefImportDb_{Guid.NewGuid()}";
    private readonly TestTenantDbContextFactory _factory;

    public ReferenceDataImportServiceTests()
    {
        _factory = new TestTenantDbContextFactory(_dbName);
    }

    private sealed class TestTenantDbContextFactory : ITenantDbContextFactory
    {
        private readonly string _databaseName;
        public TestTenantDbContextFactory(string databaseName) => _databaseName = databaseName;
        public TenantDbContext CreateContext()
        {
            var options = new DbContextOptionsBuilder<TenantDbContext>()
                .UseInMemoryDatabase(databaseName: _databaseName)
                .Options;
            return new TenantDbContext(options);
        }
    }

    private ReferenceDataImportService BuildService(bool enabled = true)
    {
        var periodService = new Mock<IAccountingPeriodService>();
        periodService.Setup(x => x.EnsureOpenPeriodAsync(It.IsAny<DateTime>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((DateTime d, CancellationToken _) =>
            {
                var p = AccountingPeriod.Create(d.Year, d.Month, new DateTime(d.Year, d.Month, 1), new DateTime(d.Year, d.Month, 28));
                p.SetAuditInfo("test", false);
                return Result.Success(p);
            });
        var projection = new Mock<IBankGlTreasuryProjectionService>();
        projection.Setup(p => p.EnsureMissingAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(new BankGlProjectionEnsureResult(0, 0)));
        return new ReferenceDataImportService(_factory, periodService.Object,
            Options.Create(new AccountingSettings { DossierImportEnabled = enabled }),
            projection.Object,
            NullLogger<ReferenceDataImportService>.Instance);
    }

    private void SeedChart(params string[] accounts)
    {
        using var ctx = _factory.CreateContext();
        foreach (var a in accounts)
            ctx.ChartOfAccounts.Add(ChartOfAccount.Create(a, $"Compte {a}", int.Parse(a[..1]), null, AccountNatureType.Debit).Value);
        ctx.SaveChanges();
    }

    private static byte[] Csv(string content) => Encoding.UTF8.GetBytes(content);

    // ── Plan comptable ────────────────────────────────────────────────────────

    [Fact]
    public async Task Chart_Preview_FlagsInvalidClassAndAccount()
    {
        var csv = Csv("compte;libelle;classe;nature\n6132;Loyer;6;debit\nABC;Mauvais;9;debit\n");
        var preview = await BuildService().PreviewAsync(csv, ReferenceImportTarget.ChartOfAccounts, JournalImportFormat.Csv);

        Assert.True(preview.IsSuccess);
        Assert.False(preview.Value.CanCommit);               // ligne 3 invalide (compte non numérique, classe 9)
        Assert.Equal(2, preview.Value.TotalRows);
    }

    [Fact]
    public async Task Chart_Commit_CreatesThenIsIdempotent()
    {
        var csv = Csv("compte;libelle;classe;nature\n6132;Loyer;6;debit\n707;Ventes;7;credit\n");

        var first = await BuildService().CommitAsync(csv, ReferenceImportTarget.ChartOfAccounts, JournalImportFormat.Csv);
        Assert.True(first.IsSuccess);
        Assert.Equal(2, first.Value.CreatedCount);

        var second = await BuildService().CommitAsync(csv, ReferenceImportTarget.ChartOfAccounts, JournalImportFormat.Csv);
        Assert.True(second.IsSuccess);
        Assert.Equal(0, second.Value.CreatedCount);          // idempotent : rien de recréé
        Assert.Equal(2, second.Value.SkippedCount);

        using var ctx = _factory.CreateContext();
        Assert.Equal(2, await ctx.ChartOfAccounts.CountAsync());
        Assert.Equal(AccountNatureType.Credit, (await ctx.ChartOfAccounts.SingleAsync(c => c.AccountNumber == "707")).NatureType);
    }

    // ── Plan tiers ────────────────────────────────────────────────────────────

    [Fact]
    public async Task ThirdParties_BlankEmail_IsAllowed_InvalidEmailOrMissingAddress_IsBlocked()
    {
        var blank = Csv("type;nom;email;rue;ville;gouvernorat\nclient;Sans Email;;Rue A;Tunis;Tunis\nfournisseur;Bon;bon@x.tn;Rue B;Sfax;Sfax\n");
        var blankPreview = await BuildService().PreviewAsync(blank, ReferenceImportTarget.ThirdParties, JournalImportFormat.Csv);
        Assert.True(blankPreview.IsSuccess);
        Assert.True(blankPreview.Value.CanCommit);
        Assert.DoesNotContain(blankPreview.Value.Issues, i => i.Message.Contains("Email"));

        var committed = await BuildService().CommitAsync(blank, ReferenceImportTarget.ThirdParties, JournalImportFormat.Csv);
        Assert.True(committed.IsSuccess);
        using (var ctx = _factory.CreateContext())
        {
            var client = await ctx.Clients.SingleAsync();
            Assert.Null(client.Email);
        }

        var invalid = Csv("type;nom;email;rue;ville;gouvernorat\nclient;Mauvais;pas-un-email;Rue A;Tunis;Tunis\n");
        var invalidPreview = await BuildService().PreviewAsync(invalid, ReferenceImportTarget.ThirdParties, JournalImportFormat.Csv);
        Assert.True(invalidPreview.IsSuccess);
        Assert.False(invalidPreview.Value.CanCommit);
        Assert.Contains(invalidPreview.Value.Issues, i => i.Message.Contains("Email invalide"));

        var noAddress = Csv("type;nom;email;rue;ville;gouvernorat\nclient;Sans Adresse;ok@x.tn;;;\n");
        var addressPreview = await BuildService().PreviewAsync(noAddress, ReferenceImportTarget.ThirdParties, JournalImportFormat.Csv);
        Assert.True(addressPreview.IsSuccess);
        Assert.False(addressPreview.Value.CanCommit);
        Assert.Contains(addressPreview.Value.Issues, i => i.Message.Contains("Adresse"));
    }

    [Fact]
    public async Task ThirdParties_Commit_CreatesClientAndSupplier_ThenIdempotent()
    {
        // Alpha SA : NIF valide (format NNNNNNN/L/A/M/NNN) → client professionnel ; Beta SARL sans NIF → particulier.
        var csv = Csv("type;nom;email;rue;ville;gouvernorat;nif\nclient;Alpha SA;alpha@x.tn;Rue A;Tunis;Tunis;1234567/A/B/C/000\nfournisseur;Beta SARL;beta@x.tn;Rue B;Sfax;Sfax;\n");

        var first = await BuildService().CommitAsync(csv, ReferenceImportTarget.ThirdParties, JournalImportFormat.Csv);
        Assert.True(first.IsSuccess);
        Assert.Equal(2, first.Value.CreatedCount);

        var second = await BuildService().CommitAsync(csv, ReferenceImportTarget.ThirdParties, JournalImportFormat.Csv);
        Assert.True(second.IsSuccess);
        Assert.Equal(0, second.Value.CreatedCount);          // idempotent par nom
        Assert.Equal(2, second.Value.SkippedCount);

        using var ctx = _factory.CreateContext();
        Assert.Equal(1, await ctx.Clients.CountAsync());
        Assert.Equal(1, await ctx.Suppliers.CountAsync());
    }

    // ── Balance d'ouverture ───────────────────────────────────────────────────

    [Fact]
    public async Task OpeningBalance_MissingFiscalYear_IsRejected()
    {
        SeedChart("4111", "101");
        var csv = Csv("compte;debit;credit\n4111;1000;0\n101;0;1000\n");
        var preview = await BuildService().PreviewAsync(csv, ReferenceImportTarget.OpeningBalance, JournalImportFormat.Csv);

        Assert.True(preview.IsFailure);   // exercice obligatoire
    }

    [Fact]
    public async Task OpeningBalance_Unbalanced_IsBlocked()
    {
        SeedChart("4111", "101");
        var csv = Csv("compte;debit;credit\n4111;1000;0\n101;0;800\n");
        var preview = await BuildService().PreviewAsync(csv, ReferenceImportTarget.OpeningBalance, JournalImportFormat.Csv, 2026);

        Assert.True(preview.IsSuccess);
        Assert.False(preview.Value.CanCommit);
        Assert.Contains(preview.Value.Issues, i => i.Message.Contains("déséquilibrée"));
    }

    [Fact]
    public async Task OpeningBalance_Commit_CreatesDraftJanEntry_ThenRefusesSecond()
    {
        SeedChart("4111", "101");
        var csv = Csv("compte;debit;credit\n4111;1000;0\n101;0;1000\n");

        var first = await BuildService().CommitAsync(csv, ReferenceImportTarget.OpeningBalance, JournalImportFormat.Csv, 2026);
        Assert.True(first.IsSuccess);
        Assert.Equal(2, first.Value.CreatedCount);

        using (var ctx = _factory.CreateContext())
        {
            var entry = await ctx.JournalEntries.Include(e => e.Lines).SingleAsync();
            Assert.Equal("JAN", entry.JournalCode);
            Assert.Equal(JournalEntryStatus.Brouillon, entry.Status);
            Assert.Equal(new DateTime(2026, 1, 1), entry.EntryDate);
            Assert.Equal(AccountingService.SourceOpeningBalance, entry.SourceEntityType);
        }

        // Deuxième import pour le même exercice : refusé (à-nouveau déjà présent).
        var second = await BuildService().PreviewAsync(csv, ReferenceImportTarget.OpeningBalance, JournalImportFormat.Csv, 2026);
        Assert.True(second.IsSuccess);
        Assert.False(second.Value.CanCommit);
        Assert.Contains(second.Value.Issues, i => i.Message.Contains("existe déjà"));
    }

    // ── Garde globale ─────────────────────────────────────────────────────────

    [Fact]
    public async Task Disabled_ReturnsFailure()
    {
        var csv = Csv("compte;libelle;classe;nature\n6132;Loyer;6;debit\n");
        var preview = await BuildService(enabled: false).PreviewAsync(csv, ReferenceImportTarget.ChartOfAccounts, JournalImportFormat.Csv);
        Assert.True(preview.IsFailure);
    }

    [Fact]
    public async Task MissingRequiredColumn_IsReported()
    {
        var csv = Csv("compte;classe\n6132;6\n");   // libellé manquant
        var preview = await BuildService().PreviewAsync(csv, ReferenceImportTarget.ChartOfAccounts, JournalImportFormat.Csv);

        Assert.True(preview.IsSuccess);
        Assert.False(preview.Value.CanCommit);
        Assert.Contains(preview.Value.Issues, i => i.Message.Contains("Colonne obligatoire"));
    }
}
