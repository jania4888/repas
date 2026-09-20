using FactuTrust.Domain.Entities.Studio;
using FactuTrust.Domain.Entities.Studio.Workflows;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Persistence;

/// <summary>
/// EF Core mapping for the low-code "Studio" tables. Kept in its own partial file so the feature
/// is fully additive and isolated from the rest of the tenant schema. All five tables are new
/// (CreateTable-only migration); no existing entity mapping is touched.
/// </summary>
public partial class TenantDbContext
{
    public DbSet<CustomEntityDefinition> CustomEntityDefinitions => Set<CustomEntityDefinition>();
    public DbSet<CustomFieldDefinition> CustomFieldDefinitions => Set<CustomFieldDefinition>();
    public DbSet<CustomRecord> CustomRecords => Set<CustomRecord>();
    public DbSet<CustomFormDefinition> CustomFormDefinitions => Set<CustomFormDefinition>();
    public DbSet<CustomReportDefinition> CustomReportDefinitions => Set<CustomReportDefinition>();
    public DbSet<CustomViewDefinition> CustomViewDefinitions => Set<CustomViewDefinition>();
    public DbSet<CustomRecordViewDefinition> CustomRecordViewDefinitions => Set<CustomRecordViewDefinition>();
    public DbSet<CustomFieldSequence> CustomFieldSequences => Set<CustomFieldSequence>();
    public DbSet<CustomSystemDefinition> CustomSystemDefinitions => Set<CustomSystemDefinition>();
    public DbSet<CustomEntityAutomation> CustomEntityAutomations => Set<CustomEntityAutomation>();
    public DbSet<CustomAutomationRun> CustomAutomationRuns => Set<CustomAutomationRun>();
    public DbSet<StudioAiBuildPlan> StudioAiBuildPlans => Set<StudioAiBuildPlan>();
    public DbSet<StudioWorkflowDefinition> StudioWorkflowDefinitions => Set<StudioWorkflowDefinition>();
    public DbSet<StudioWorkflowInstance> StudioWorkflowInstances => Set<StudioWorkflowInstance>();
    public DbSet<StudioWorkflowStepRun> StudioWorkflowStepRuns => Set<StudioWorkflowStepRun>();
    public DbSet<StudioWorkflowApproval> StudioWorkflowApprovals => Set<StudioWorkflowApproval>();

    private static void ConfigureStudio(ModelBuilder builder)
    {
        builder.Entity<CustomSystemDefinition>(entity =>
        {
            entity.ToTable("CustomSystemDefinitions");
            entity.HasKey(e => e.Id);

            entity.Property(e => e.Key).HasMaxLength(64).IsRequired();
            entity.Property(e => e.DisplayName).HasMaxLength(128).IsRequired();
            entity.Property(e => e.Icon).HasMaxLength(64);
            entity.Property(e => e.Description).HasMaxLength(1024);
            entity.Property(e => e.OnboardingJson).HasColumnType("nvarchar(max)");

            entity.Property(e => e.RowVersion).IsRowVersion();

            entity.HasIndex(e => new { e.TenantId, e.Key }).IsUnique();
            entity.HasQueryFilter(e => !e.IsDeleted);
        });

        builder.Entity<CustomEntityDefinition>(entity =>
        {
            entity.ToTable("CustomEntityDefinitions");
            entity.HasKey(e => e.Id);

            entity.Property(e => e.Key).HasMaxLength(64).IsRequired();
            entity.Property(e => e.DisplayName).HasMaxLength(128).IsRequired();
            entity.Property(e => e.DisplayNamePlural).HasMaxLength(128).IsRequired();
            entity.Property(e => e.Icon).HasMaxLength(64);
            entity.Property(e => e.Description).HasMaxLength(512);

            // PR 2.1 (N‑N) : nature de l'entité (0 = Standard, 1 = Junction). Défaut SQL 0 pour que
            // les lignes existantes restent des tables standard sans backfill.
            entity.Property(e => e.Kind)
                .HasConversion<int>()
                .HasDefaultValue(Domain.Enums.CustomEntityKind.Standard);

            entity.Property(e => e.RowVersion).IsRowVersion();

            entity.HasIndex(e => new { e.TenantId, e.Key }).IsUnique();
            entity.HasIndex(e => new { e.TenantId, e.SystemId });
            entity.HasIndex(e => new { e.TenantId, e.Kind });

            // Soft-delete filter on this NEW table only (does not affect existing entities).
            entity.HasQueryFilter(e => !e.IsDeleted);
        });

        builder.Entity<CustomFieldDefinition>(entity =>
        {
            entity.ToTable("CustomFieldDefinitions");
            entity.HasKey(e => e.Id);

            entity.Property(e => e.Key).HasMaxLength(64).IsRequired();
            entity.Property(e => e.Label).HasMaxLength(128).IsRequired();
            entity.Property(e => e.FieldType).HasConversion<int>();
            entity.Property(e => e.ValidationRulesJson).HasColumnType("nvarchar(max)");
            entity.Property(e => e.OptionsJson).HasColumnType("nvarchar(max)");
            entity.Property(e => e.DefaultValueJson).HasColumnType("nvarchar(max)");

            entity.Property(e => e.RowVersion).IsRowVersion();

            entity.HasIndex(e => new { e.TenantId, e.EntityDefinitionId, e.Key }).IsUnique();
            entity.HasIndex(e => new { e.TenantId, e.EntityDefinitionId, e.SortOrder });
        });

        builder.Entity<CustomRecord>(entity =>
        {
            entity.ToTable("CustomRecords");
            entity.HasKey(e => e.Id);

            entity.Property(e => e.DataJson).HasColumnType("nvarchar(max)").IsRequired();
            entity.Property(e => e.RowVersion).IsRowVersion();

            // Hot list path: filter by tenant + entity + not-deleted.
            entity.HasIndex(e => new { e.TenantId, e.EntityDefinitionId, e.IsDeleted });

            // Soft-delete filter on this NEW table only.
            entity.HasQueryFilter(e => !e.IsDeleted);
        });

        builder.Entity<CustomFormDefinition>(entity =>
        {
            entity.ToTable("CustomFormDefinitions");
            entity.HasKey(e => e.Id);

            entity.Property(e => e.Key).HasMaxLength(64).IsRequired();
            entity.Property(e => e.DisplayName).HasMaxLength(128).IsRequired();
            entity.Property(e => e.LayoutJson).HasColumnType("nvarchar(max)").IsRequired();

            entity.Property(e => e.RowVersion).IsRowVersion();

            entity.HasIndex(e => new { e.TenantId, e.Key }).IsUnique();
            entity.HasIndex(e => new { e.TenantId, e.EntityDefinitionId });
        });

        builder.Entity<CustomReportDefinition>(entity =>
        {
            entity.ToTable("CustomReportDefinitions");
            entity.HasKey(e => e.Id);

            entity.Property(e => e.Key).HasMaxLength(64).IsRequired();
            entity.Property(e => e.DisplayName).HasMaxLength(128).IsRequired();
            entity.Property(e => e.DataSourceKind).HasConversion<int>();
            entity.Property(e => e.DataSourceRef).HasMaxLength(128).IsRequired();
            entity.Property(e => e.DefinitionJson).HasColumnType("nvarchar(max)").IsRequired();

            entity.Property(e => e.RowVersion).IsRowVersion();

            entity.HasIndex(e => new { e.TenantId, e.Key }).IsUnique();
        });

        builder.Entity<CustomViewDefinition>(entity =>
        {
            entity.ToTable("CustomViewDefinitions");
            entity.HasKey(e => e.Id);

            entity.Property(e => e.Key).HasMaxLength(64).IsRequired();
            entity.Property(e => e.DisplayName).HasMaxLength(128).IsRequired();
            entity.Property(e => e.SourceTable).HasMaxLength(128).IsRequired();
            entity.Property(e => e.DefinitionJson).HasColumnType("nvarchar(max)").IsRequired();

            entity.Property(e => e.RowVersion).IsRowVersion();

            entity.HasIndex(e => new { e.TenantId, e.Key }).IsUnique();
        });

        // PR 2.3 (vues enregistrées) : vues Liste / Kanban / Calendrier d'une table Studio. Table NOUVELLE,
        // FK cascade vers CustomEntityDefinitions, clé unique par (tenant, table) parmi les vues non supprimées.
        builder.Entity<CustomRecordViewDefinition>(entity =>
        {
            entity.ToTable("CustomRecordViewDefinitions");
            entity.HasKey(e => e.Id);

            entity.Property(e => e.Key).HasMaxLength(64).IsRequired();
            entity.Property(e => e.DisplayName).HasMaxLength(128).IsRequired();
            entity.Property(e => e.Mode).HasConversion<int>();
            entity.Property(e => e.DefinitionJson).HasColumnType("nvarchar(max)").IsRequired();

            entity.Property(e => e.RowVersion).IsRowVersion();

            entity.HasOne<CustomEntityDefinition>()
                .WithMany()
                .HasForeignKey(e => e.EntityDefinitionId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("FK_CustomRecordViewDefinitions_CustomEntityDefinitions");

            entity.HasIndex(e => new { e.TenantId, e.EntityDefinitionId, e.Key })
                .IsUnique()
                .HasDatabaseName("UX_CustomRecordViewDefinitions_Tenant_Entity_Key")
                .HasFilter("[IsDeleted] = 0");
            entity.HasIndex(e => new { e.TenantId, e.EntityDefinitionId, e.IsDefault })
                .HasDatabaseName("IX_CustomRecordViewDefinitions_Tenant_Entity_Default");

            // Soft-delete filter on this NEW table only.
            entity.HasQueryFilter(e => !e.IsDeleted);
        });

        builder.Entity<CustomFieldSequence>(entity =>
        {
            entity.ToTable("CustomFieldSequences");
            entity.HasKey(e => e.Id);

            entity.Property(e => e.FieldKey).HasMaxLength(64).IsRequired();
            entity.Property(e => e.CurrentValue).IsRequired();

            entity.Property(e => e.RowVersion).IsRowVersion();

            // One counter per (tenant, entity, field) — the atomic allocator upserts on this key.
            entity.HasIndex(e => new { e.TenantId, e.EntityDefinitionId, e.FieldKey }).IsUnique();
        });

        builder.Entity<CustomEntityAutomation>(entity =>
        {
            entity.ToTable("CustomEntityAutomations");
            entity.HasKey(e => e.Id);

            entity.Property(e => e.Name).HasMaxLength(128).IsRequired();
            entity.Property(e => e.Trigger).HasConversion<int>();
            entity.Property(e => e.ActionKey).HasMaxLength(64).IsRequired();
            entity.Property(e => e.MappingJson).HasColumnType("nvarchar(max)").IsRequired();
            entity.Property(e => e.ConditionJson).HasColumnType("nvarchar(max)");
            entity.Property(e => e.ScheduleJson).HasColumnType("nvarchar(max)");

            entity.Property(e => e.RowVersion).IsRowVersion();

            entity.HasIndex(e => new { e.TenantId, e.EntityDefinitionId });
        });

        builder.Entity<CustomAutomationRun>(entity =>
        {
            entity.ToTable("CustomAutomationRuns");
            entity.HasKey(e => e.Id);

            entity.Property(e => e.Status).HasConversion<int>();
            entity.Property(e => e.ResultJson).HasColumnType("nvarchar(max)");
            entity.Property(e => e.Error).HasColumnType("nvarchar(max)");
            entity.Property(e => e.IdempotencyKey).HasMaxLength(128);

            // Lookups: runs of an automation, and "did this record already run successfully?" (idempotency).
            entity.HasIndex(e => new { e.TenantId, e.AutomationId, e.RecordId });
        });

        builder.Entity<StudioAiBuildPlan>(entity =>
        {
            entity.ToTable("StudioAiBuildPlans");
            entity.HasKey(e => e.Id);

            entity.Property(e => e.Kind).HasConversion<int>();
            entity.Property(e => e.Status).HasConversion<int>();
            entity.Property(e => e.SpecJson).HasColumnType("nvarchar(max)").IsRequired();
            entity.Property(e => e.SummaryJson).HasColumnType("nvarchar(max)").IsRequired();
            entity.Property(e => e.ResultJson).HasColumnType("nvarchar(max)");
            entity.Property(e => e.ErrorMessage).HasMaxLength(2048);

            // La transition Pending → Executing s'appuie sur ce jeton pour bloquer la double confirmation.
            entity.Property(e => e.RowVersion).IsRowVersion();

            entity.HasIndex(e => new { e.TenantId, e.Status, e.CreatedAt });
        });

        // PR 4.1 (workflows Studio) : définitions, instances, exécutions d'étapes (append-only) et
        // approbations. Tables NOUVELLES et autonomes : aucune FK, aucune navigation (S-contract),
        // enums stockés en int. Noms d'index figés (annexe A-41 §0.4).
        builder.Entity<StudioWorkflowDefinition>(entity =>
        {
            entity.ToTable("StudioWorkflowDefinitions");
            entity.HasKey(e => e.Id);

            entity.Property(e => e.Key).HasMaxLength(64).IsRequired();
            entity.Property(e => e.Name).HasMaxLength(128).IsRequired();
            entity.Property(e => e.Description).HasMaxLength(512);
            entity.Property(e => e.Trigger).HasConversion<int>();
            entity.Property(e => e.TriggerConfigJson).HasMaxLength(2048).IsRequired().HasDefaultValue("{}");
            entity.Property(e => e.StepsJson).HasColumnType("nvarchar(max)").IsRequired();
            entity.Property(e => e.Version).HasDefaultValue(1);

            entity.Property(e => e.RowVersion).IsRowVersion();

            entity.HasIndex(e => new { e.TenantId, e.EntityDefinitionId, e.Key })
                .IsUnique()
                .HasDatabaseName("UX_StudioWorkflowDefinitions_Tenant_Entity_Key")
                .HasFilter("[IsDeleted] = 0");
            entity.HasIndex(e => new { e.TenantId, e.EntityDefinitionId, e.Trigger, e.IsActive })
                .HasDatabaseName("IX_StudioWorkflowDefinitions_Tenant_Entity_Trigger_Active");

            // Soft-delete filter on this NEW table only.
            entity.HasQueryFilter(e => !e.IsDeleted);
        });

        builder.Entity<StudioWorkflowInstance>(entity =>
        {
            entity.ToTable("StudioWorkflowInstances");
            entity.HasKey(e => e.Id);

            entity.Property(e => e.TriggerKind).HasConversion<int>();
            entity.Property(e => e.Status).HasConversion<int>();
            entity.Property(e => e.CurrentStepKey).HasMaxLength(64);
            entity.Property(e => e.ContextJson).HasColumnType("nvarchar(max)").IsRequired();
            entity.Property(e => e.Error).HasMaxLength(2000);
            entity.Property(e => e.Depth).HasDefaultValue(0);

            // Le bail (TryLease/ReleaseLease) du job de reprise s'appuie sur ce jeton.
            entity.Property(e => e.RowVersion).IsRowVersion();

            entity.HasIndex(e => new { e.TenantId, e.Status, e.DueAt })
                .HasDatabaseName("IX_StudioWorkflowInstances_Tenant_Status_DueAt");
            entity.HasIndex(e => new { e.TenantId, e.RecordId, e.StartedAt })
                .HasDatabaseName("IX_StudioWorkflowInstances_Tenant_Record_StartedAt");
            entity.HasIndex(e => new { e.TenantId, e.WorkflowDefinitionId, e.StartedAt })
                .HasDatabaseName("IX_StudioWorkflowInstances_Tenant_Definition_StartedAt");
        });

        builder.Entity<StudioWorkflowStepRun>(entity =>
        {
            entity.ToTable("StudioWorkflowStepRuns");
            entity.HasKey(e => e.Id);

            entity.Property(e => e.StepKey).HasMaxLength(64).IsRequired();
            entity.Property(e => e.StepType).HasMaxLength(32).IsRequired();
            entity.Property(e => e.Status).HasConversion<int>();
            entity.Property(e => e.Outcome).HasMaxLength(16);
            entity.Property(e => e.InputJson).HasColumnType("nvarchar(max)");
            entity.Property(e => e.ResultJson).HasColumnType("nvarchar(max)");
            entity.Property(e => e.Error).HasMaxLength(2000);

            // Table append-only : pas de RowVersion, pas de filtre de suppression logique.
            entity.HasIndex(e => new { e.TenantId, e.InstanceId, e.StepIndex })
                .HasDatabaseName("IX_StudioWorkflowStepRuns_Tenant_Instance_Step");
        });

        builder.Entity<StudioWorkflowApproval>(entity =>
        {
            entity.ToTable("StudioWorkflowApprovals");
            entity.HasKey(e => e.Id);

            entity.Property(e => e.StepKey).HasMaxLength(64).IsRequired();
            entity.Property(e => e.AssigneeRole).HasMaxLength(32);
            entity.Property(e => e.Title).HasMaxLength(200).IsRequired();
            entity.Property(e => e.Message).HasMaxLength(1000);
            entity.Property(e => e.Status).HasConversion<int>();
            entity.Property(e => e.Comment).HasMaxLength(2000);

            // La décision (Decide depuis Pending) s'appuie sur ce jeton contre les doubles clics.
            entity.Property(e => e.RowVersion).IsRowVersion();

            entity.HasIndex(e => new { e.TenantId, e.AssigneeUserId, e.Status })
                .HasDatabaseName("IX_StudioWorkflowApprovals_Tenant_AssigneeUser_Status");
            entity.HasIndex(e => new { e.TenantId, e.AssigneeRole, e.Status })
                .HasDatabaseName("IX_StudioWorkflowApprovals_Tenant_AssigneeRole_Status");
            entity.HasIndex(e => new { e.TenantId, e.InstanceId })
                .HasDatabaseName("IX_StudioWorkflowApprovals_Tenant_Instance");
        });
    }
}
