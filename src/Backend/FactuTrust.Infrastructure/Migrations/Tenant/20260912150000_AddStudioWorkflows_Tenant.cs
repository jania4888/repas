using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FactuTrust.Infrastructure.Migrations.Tenant
{
    /// <summary>
    /// Studio IA — PR 4.1 (workflows Studio) : crée les quatre tables autonomes
    /// <c>StudioWorkflowDefinitions</c> (définitions : clé, déclencheur, <c>StepsJson</c>, version,
    /// suppression logique), <c>StudioWorkflowInstances</c> (exécutions : pointeur d'étape, contexte,
    /// <c>DueAt</c> / <c>LeasedAt</c> / <c>LastRemindedAt</c> pour la reprise différée, chaînage
    /// <c>Depth</c> / <c>OriginInstanceId</c>), <c>StudioWorkflowStepRuns</c> (exécutions d'étapes,
    /// append-only, sans <c>RowVersion</c>) et <c>StudioWorkflowApprovals</c> (approbations :
    /// assignation utilisateur/rôle, décision, échéance), ainsi que les 9 index aux noms figés
    /// (annexe A-41 §0.4), dont la clé unique filtrée
    /// <c>(TenantId, EntityDefinitionId, Key) WHERE IsDeleted = 0</c> des définitions. Aucune clé
    /// étrangère (tables autonomes, S-contract), aucune donnée existante touchée. Écrite à la main
    /// (pas de <c>dotnet ef migrations add</c>), idempotente, jumeau SQL :
    /// <c>docs/runbooks/sql/AddStudioWorkflows_Tenant.idempotent.sql</c>.
    /// </summary>
    [DbContext(typeof(TenantDbContext))]
    [Migration("20260912150000_AddStudioWorkflows_Tenant")]
    public partial class AddStudioWorkflows_Tenant : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
IF OBJECT_ID(N'[dbo].[StudioWorkflowDefinitions]', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[StudioWorkflowDefinitions] (
        [Id] uniqueidentifier NOT NULL,
        [TenantId] uniqueidentifier NOT NULL,
        [EntityDefinitionId] uniqueidentifier NOT NULL,
        [Key] nvarchar(64) NOT NULL,
        [Name] nvarchar(128) NOT NULL,
        [Description] nvarchar(512) NULL,
        [Trigger] int NOT NULL,
        [TriggerConfigJson] nvarchar(2048) NOT NULL CONSTRAINT [DF_StudioWorkflowDefinitions_TriggerConfigJson] DEFAULT (N'{}'),
        [StepsJson] nvarchar(max) NOT NULL,
        [Version] int NOT NULL CONSTRAINT [DF_StudioWorkflowDefinitions_Version] DEFAULT (1),
        [IsActive] bit NOT NULL,
        [IsDeleted] bit NOT NULL CONSTRAINT [DF_StudioWorkflowDefinitions_IsDeleted] DEFAULT (0),
        [DeletedAt] datetime2 NULL,
        [CreatedBy] uniqueidentifier NULL,
        [UpdatedBy] uniqueidentifier NULL,
        [CreatedAt] datetime2 NOT NULL,
        [UpdatedAt] datetime2 NOT NULL,
        [RowVersion] rowversion NOT NULL,
        CONSTRAINT [PK_StudioWorkflowDefinitions] PRIMARY KEY ([Id])
    );
END;
""");

            migrationBuilder.Sql("""
IF OBJECT_ID(N'[dbo].[StudioWorkflowInstances]', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[StudioWorkflowInstances] (
        [Id] uniqueidentifier NOT NULL,
        [TenantId] uniqueidentifier NOT NULL,
        [WorkflowDefinitionId] uniqueidentifier NOT NULL,
        [DefinitionVersion] int NOT NULL,
        [EntityDefinitionId] uniqueidentifier NOT NULL,
        [RecordId] uniqueidentifier NOT NULL,
        [TriggerKind] int NOT NULL,
        [Status] int NOT NULL,
        [CurrentStepIndex] int NOT NULL,
        [CurrentStepKey] nvarchar(64) NULL,
        [ContextJson] nvarchar(max) NOT NULL,
        [DueAt] datetime2 NULL,
        [LeasedAt] datetime2 NULL,
        [LastRemindedAt] datetime2 NULL,
        [StartedBy] uniqueidentifier NULL,
        [StartedAt] datetime2 NOT NULL,
        [UpdatedAt] datetime2 NOT NULL,
        [CompletedAt] datetime2 NULL,
        [Depth] int NOT NULL CONSTRAINT [DF_StudioWorkflowInstances_Depth] DEFAULT (0),
        [OriginInstanceId] uniqueidentifier NULL,
        [Error] nvarchar(2000) NULL,
        [RowVersion] rowversion NOT NULL,
        CONSTRAINT [PK_StudioWorkflowInstances] PRIMARY KEY ([Id])
    );
END;
""");

            migrationBuilder.Sql("""
IF OBJECT_ID(N'[dbo].[StudioWorkflowStepRuns]', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[StudioWorkflowStepRuns] (
        [Id] uniqueidentifier NOT NULL,
        [TenantId] uniqueidentifier NOT NULL,
        [InstanceId] uniqueidentifier NOT NULL,
        [StepIndex] int NOT NULL,
        [StepKey] nvarchar(64) NOT NULL,
        [StepType] nvarchar(32) NOT NULL,
        [Status] int NOT NULL,
        [Outcome] nvarchar(16) NULL,
        [InputJson] nvarchar(max) NULL,
        [ResultJson] nvarchar(max) NULL,
        [Error] nvarchar(2000) NULL,
        [StartedAt] datetime2 NOT NULL,
        [FinishedAt] datetime2 NOT NULL,
        [RunBy] uniqueidentifier NULL,
        CONSTRAINT [PK_StudioWorkflowStepRuns] PRIMARY KEY ([Id])
    );
END;
""");

            migrationBuilder.Sql("""
IF OBJECT_ID(N'[dbo].[StudioWorkflowApprovals]', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[StudioWorkflowApprovals] (
        [Id] uniqueidentifier NOT NULL,
        [TenantId] uniqueidentifier NOT NULL,
        [InstanceId] uniqueidentifier NOT NULL,
        [StepKey] nvarchar(64) NOT NULL,
        [AssigneeUserId] uniqueidentifier NULL,
        [AssigneeRole] nvarchar(32) NULL,
        [Title] nvarchar(200) NOT NULL,
        [Message] nvarchar(1000) NULL,
        [Status] int NOT NULL,
        [DecidedBy] uniqueidentifier NULL,
        [DecidedAt] datetime2 NULL,
        [Comment] nvarchar(2000) NULL,
        [DueAt] datetime2 NULL,
        [CreatedAt] datetime2 NOT NULL,
        [RowVersion] rowversion NOT NULL,
        CONSTRAINT [PK_StudioWorkflowApprovals] PRIMARY KEY ([Id])
    );
END;
""");

            migrationBuilder.Sql("""
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE [name] = N'UX_StudioWorkflowDefinitions_Tenant_Entity_Key' AND [object_id] = OBJECT_ID(N'[dbo].[StudioWorkflowDefinitions]'))
    CREATE UNIQUE INDEX [UX_StudioWorkflowDefinitions_Tenant_Entity_Key]
        ON [dbo].[StudioWorkflowDefinitions] ([TenantId], [EntityDefinitionId], [Key])
        WHERE [IsDeleted] = 0;
""");

            migrationBuilder.Sql("""
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE [name] = N'IX_StudioWorkflowDefinitions_Tenant_Entity_Trigger_Active' AND [object_id] = OBJECT_ID(N'[dbo].[StudioWorkflowDefinitions]'))
    CREATE INDEX [IX_StudioWorkflowDefinitions_Tenant_Entity_Trigger_Active]
        ON [dbo].[StudioWorkflowDefinitions] ([TenantId], [EntityDefinitionId], [Trigger], [IsActive]);
""");

            migrationBuilder.Sql("""
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE [name] = N'IX_StudioWorkflowInstances_Tenant_Status_DueAt' AND [object_id] = OBJECT_ID(N'[dbo].[StudioWorkflowInstances]'))
    CREATE INDEX [IX_StudioWorkflowInstances_Tenant_Status_DueAt]
        ON [dbo].[StudioWorkflowInstances] ([TenantId], [Status], [DueAt]);
""");

            migrationBuilder.Sql("""
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE [name] = N'IX_StudioWorkflowInstances_Tenant_Record_StartedAt' AND [object_id] = OBJECT_ID(N'[dbo].[StudioWorkflowInstances]'))
    CREATE INDEX [IX_StudioWorkflowInstances_Tenant_Record_StartedAt]
        ON [dbo].[StudioWorkflowInstances] ([TenantId], [RecordId], [StartedAt]);
""");

            migrationBuilder.Sql("""
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE [name] = N'IX_StudioWorkflowInstances_Tenant_Definition_StartedAt' AND [object_id] = OBJECT_ID(N'[dbo].[StudioWorkflowInstances]'))
    CREATE INDEX [IX_StudioWorkflowInstances_Tenant_Definition_StartedAt]
        ON [dbo].[StudioWorkflowInstances] ([TenantId], [WorkflowDefinitionId], [StartedAt]);
""");

            migrationBuilder.Sql("""
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE [name] = N'IX_StudioWorkflowStepRuns_Tenant_Instance_Step' AND [object_id] = OBJECT_ID(N'[dbo].[StudioWorkflowStepRuns]'))
    CREATE INDEX [IX_StudioWorkflowStepRuns_Tenant_Instance_Step]
        ON [dbo].[StudioWorkflowStepRuns] ([TenantId], [InstanceId], [StepIndex]);
""");

            migrationBuilder.Sql("""
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE [name] = N'IX_StudioWorkflowApprovals_Tenant_AssigneeUser_Status' AND [object_id] = OBJECT_ID(N'[dbo].[StudioWorkflowApprovals]'))
    CREATE INDEX [IX_StudioWorkflowApprovals_Tenant_AssigneeUser_Status]
        ON [dbo].[StudioWorkflowApprovals] ([TenantId], [AssigneeUserId], [Status]);
""");

            migrationBuilder.Sql("""
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE [name] = N'IX_StudioWorkflowApprovals_Tenant_AssigneeRole_Status' AND [object_id] = OBJECT_ID(N'[dbo].[StudioWorkflowApprovals]'))
    CREATE INDEX [IX_StudioWorkflowApprovals_Tenant_AssigneeRole_Status]
        ON [dbo].[StudioWorkflowApprovals] ([TenantId], [AssigneeRole], [Status]);
""");

            migrationBuilder.Sql("""
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE [name] = N'IX_StudioWorkflowApprovals_Tenant_Instance' AND [object_id] = OBJECT_ID(N'[dbo].[StudioWorkflowApprovals]'))
    CREATE INDEX [IX_StudioWorkflowApprovals_Tenant_Instance]
        ON [dbo].[StudioWorkflowApprovals] ([TenantId], [InstanceId]);
""");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Les index tombent avec les tables ; gardé pour qu'un rollback rejoué ne casse pas.
            migrationBuilder.Sql("DROP TABLE IF EXISTS [dbo].[StudioWorkflowApprovals];");
            migrationBuilder.Sql("DROP TABLE IF EXISTS [dbo].[StudioWorkflowStepRuns];");
            migrationBuilder.Sql("DROP TABLE IF EXISTS [dbo].[StudioWorkflowInstances];");
            migrationBuilder.Sql("DROP TABLE IF EXISTS [dbo].[StudioWorkflowDefinitions];");
        }
    }
}
