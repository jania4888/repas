using FactuTrust.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Persistence;

/// <summary>
/// Mapping EF Core de l'import IA de relevés bancaires (sessions d'analyse, règles d'affectation
/// du dossier, cache de classification IA) et de l'index d'idempotence des écritures générées.
/// Isolé dans un partial : retirer la fonctionnalité ne demande que de supprimer ce fichier et
/// l'appel à <see cref="ConfigureBankStatementImport"/>.
/// </summary>
public partial class TenantDbContext
{
    /// <summary>Source des écritures générées depuis une ligne de relevé (1 ligne ⇒ 1 écriture).</summary>
    public const string BankStatementLineSourceType = "BankStatementLine";

    public DbSet<BankStatementImportSession> BankStatementImportSessions => Set<BankStatementImportSession>();
    public DbSet<BankPostingRule> BankPostingRules => Set<BankPostingRule>();
    public DbSet<BankLabelClassification> BankLabelClassifications => Set<BankLabelClassification>();
    public DbSet<BankStatementTabularMapping> BankStatementTabularMappings => Set<BankStatementTabularMapping>();

    private static void ConfigureBankStatementImport(ModelBuilder builder)
    {
        builder.Entity<BankStatementImportSession>(entity =>
        {
            entity.ToTable("BankStatementImportSessions");
            entity.Property(e => e.CreatedBy).HasMaxLength(256);
            entity.Property(e => e.UpdatedBy).HasMaxLength(256);
            entity.HasKey(e => e.Id);
            entity.Property(e => e.JournalCode).HasMaxLength(10).IsRequired();
            entity.Property(e => e.FileName).HasMaxLength(BankStatementImportSession.FileNameMaxLength).IsRequired();
            entity.Property(e => e.FileHash).HasMaxLength(64).IsRequired();
            entity.Property(e => e.ContentType).HasMaxLength(100).IsRequired();
            entity.Property(e => e.StoragePath).HasMaxLength(400);
            entity.Property(e => e.Status).HasConversion<int>();
            entity.Property(e => e.ExtractionMethod).HasMaxLength(20);
            entity.Property(e => e.ProfileId).HasMaxLength(50);
            entity.Property(e => e.AiProviderKind).HasMaxLength(20);
            entity.Property(e => e.ErrorCode).HasMaxLength(100);
            entity.Property(e => e.RowVersion).IsRowVersion();
            entity.HasIndex(e => new { e.BankAccountId, e.FileHash });
            entity.HasIndex(e => new { e.Status, e.ExpiresAt });
        });

        builder.Entity<BankPostingRule>(entity =>
        {
            entity.ToTable("BankPostingRules");
            entity.Property(e => e.CreatedBy).HasMaxLength(256);
            entity.Property(e => e.UpdatedBy).HasMaxLength(256);
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Direction).HasConversion<int>();
            entity.Property(e => e.MatchKind).HasConversion<int>();
            entity.Property(e => e.Pattern).HasMaxLength(BankPostingRule.PatternMaxLength).IsRequired();
            entity.Property(e => e.AccountNumber).HasMaxLength(BankPostingRule.AccountNumberMaxLength).IsRequired();
            entity.Property(e => e.ThirdPartyKind).HasConversion<int>();
            entity.Property(e => e.VatAccountNumber).HasMaxLength(BankPostingRule.AccountNumberMaxLength);
            // Une seule règle par (banque, sens, type de correspondance, motif) ; BankAccountId NULL
            // (toutes banques) est traité comme une valeur à part entière par l'index filtré SQL.
            entity.HasIndex(e => new { e.BankAccountId, e.Direction, e.MatchKind, e.Pattern })
                .IsUnique()
                .HasDatabaseName("IX_BankPostingRules_Scope_Pattern");
        });

        builder.Entity<BankLabelClassification>(entity =>
        {
            entity.ToTable("BankLabelClassifications");
            entity.Property(e => e.CreatedBy).HasMaxLength(256);
            entity.Property(e => e.UpdatedBy).HasMaxLength(256);
            entity.HasKey(e => e.Id);
            entity.Property(e => e.LabelHash).HasMaxLength(64).IsRequired();
            entity.Property(e => e.NormalizedLabel).HasMaxLength(BankLabelClassification.NormalizedLabelMaxLength).IsRequired();
            entity.Property(e => e.AccountNumber).HasMaxLength(20);
            entity.Property(e => e.ModelRef).HasMaxLength(200).IsRequired();
            entity.HasIndex(e => e.LabelHash).IsUnique();
        });

        builder.Entity<BankStatementTabularMapping>(entity =>
        {
            entity.ToTable("BankStatementTabularMappings");
            entity.Property(e => e.CreatedBy).HasMaxLength(256);
            entity.Property(e => e.UpdatedBy).HasMaxLength(256);
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Format).HasMaxLength(BankStatementTabularMapping.FormatMaxLength).IsRequired();
            entity.Property(e => e.MappingJson).HasMaxLength(BankStatementTabularMapping.MappingJsonMaxLength).IsRequired();
            entity.HasIndex(e => e.BankAccountId).IsUnique().HasDatabaseName("IX_BankStatementTabularMappings_BankAccountId");
        });

        // Idempotence en base : une ligne de relevé ne porte qu'UNE écriture non extournée.
        // Index nommé, distinct de l'index paie existant sur les mêmes colonnes (non modifié).
        builder.Entity<JournalEntry>()
            .HasIndex(e => new { e.SourceEntityType, e.SourceEntityId }, "IX_JournalEntries_BankStatementLineSource")
            .IsUnique()
            .HasFilter($"[IsReversed] = 0 AND [SourceEntityType] = N'{BankStatementLineSourceType}'");
    }
}
