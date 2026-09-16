-- Repair local tenant after RemoveProjectsModule branch (idempotent)

IF COL_LENGTH(N'dbo.Invoices', N'SourceProjectId') IS NULL
    ALTER TABLE [Invoices] ADD [SourceProjectId] uniqueidentifier NULL;
IF COL_LENGTH(N'dbo.Invoices', N'SourceProjectBillingId') IS NULL
    ALTER TABLE [Invoices] ADD [SourceProjectBillingId] uniqueidentifier NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Invoices_SourceProjectId' AND object_id = OBJECT_ID(N'dbo.Invoices'))
    CREATE INDEX [IX_Invoices_SourceProjectId] ON [Invoices] ([SourceProjectId]) WHERE [SourceProjectId] IS NOT NULL;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Invoices_SourceProjectBillingId' AND object_id = OBJECT_ID(N'dbo.Invoices'))
    CREATE INDEX [IX_Invoices_SourceProjectBillingId] ON [Invoices] ([SourceProjectBillingId]) WHERE [SourceProjectBillingId] IS NOT NULL;
GO
IF COL_LENGTH(N'dbo.PurchaseOrders', N'ProjectId') IS NULL
    ALTER TABLE [PurchaseOrders] ADD [ProjectId] uniqueidentifier NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_PurchaseOrders_ProjectId' AND object_id = OBJECT_ID(N'dbo.PurchaseOrders'))
    CREATE INDEX [IX_PurchaseOrders_ProjectId] ON [PurchaseOrders] ([ProjectId]) WHERE [ProjectId] IS NOT NULL;
GO

IF OBJECT_ID(N'[dbo].[Projects]', N'U') IS NULL
BEGIN
    CREATE TABLE [Projects] (
        [Id] uniqueidentifier NOT NULL,
        [ClientId] uniqueidentifier NOT NULL,
        [Name] nvarchar(200) NOT NULL,
        [Description] nvarchar(4000) NULL,
        [Kind] int NOT NULL,
        [BillingMode] int NOT NULL,
        [Status] int NOT NULL,
        [StartDate] datetime2 NULL,
        [EndDate] datetime2 NULL,
        [BudgetHt] decimal(18,3) NOT NULL,
        [Currency] nvarchar(3) NOT NULL,
        [OwnerUserId] uniqueidentifier NULL,
        [SiteAddress] nvarchar(500) NULL,
        [ContractNumber] nvarchar(100) NULL,
        [CreatedAt] datetime2 NOT NULL,
        [UpdatedAt] datetime2 NULL,
        [CreatedBy] nvarchar(256) NULL,
        [UpdatedBy] nvarchar(256) NULL,
        [Version] int NOT NULL CONSTRAINT [DF_Projects_Version] DEFAULT 1,
        CONSTRAINT [PK_Projects] PRIMARY KEY ([Id])
    );
    CREATE INDEX [IX_Projects_ClientId] ON [Projects] ([ClientId]);
    CREATE INDEX [IX_Projects_Status] ON [Projects] ([Status]);
    CREATE INDEX [IX_Projects_Kind] ON [Projects] ([Kind]);
END
GO

IF OBJECT_ID(N'[dbo].[ProjectPhases]', N'U') IS NULL
BEGIN
    CREATE TABLE [ProjectPhases] (
        [Id] uniqueidentifier NOT NULL,
        [ProjectId] uniqueidentifier NOT NULL,
        [Name] nvarchar(80) NOT NULL,
        [SortOrder] int NOT NULL,
        [Color] nvarchar(20) NULL,
        [CreatedAt] datetime2 NOT NULL,
        [UpdatedAt] datetime2 NULL,
        [CreatedBy] nvarchar(256) NULL,
        [UpdatedBy] nvarchar(256) NULL,
        CONSTRAINT [PK_ProjectPhases] PRIMARY KEY ([Id])
    );
    CREATE INDEX [IX_ProjectPhases_ProjectId_SortOrder] ON [ProjectPhases] ([ProjectId], [SortOrder]);
END
GO

IF OBJECT_ID(N'[dbo].[ProjectTasks]', N'U') IS NULL
BEGIN
    CREATE TABLE [ProjectTasks] (
        [Id] uniqueidentifier NOT NULL,
        [ProjectId] uniqueidentifier NOT NULL,
        [PhaseId] uniqueidentifier NOT NULL,
        [ParentTaskId] uniqueidentifier NULL,
        [Title] nvarchar(300) NOT NULL,
        [Description] nvarchar(4000) NULL,
        [Status] int NOT NULL,
        [Priority] int NOT NULL,
        [DueDate] datetime2 NULL,
        [ProgressPercent] int NOT NULL,
        [AssigneeUserId] uniqueidentifier NULL,
        [EmployeeId] uniqueidentifier NULL,
        [EstimatedHours] decimal(18,2) NOT NULL,
        [CreatedAt] datetime2 NOT NULL,
        [UpdatedAt] datetime2 NULL,
        [CreatedBy] nvarchar(256) NULL,
        [UpdatedBy] nvarchar(256) NULL,
        CONSTRAINT [PK_ProjectTasks] PRIMARY KEY ([Id])
    );
    CREATE INDEX [IX_ProjectTasks_ProjectId] ON [ProjectTasks] ([ProjectId]);
    CREATE INDEX [IX_ProjectTasks_PhaseId] ON [ProjectTasks] ([PhaseId]);
    CREATE INDEX [IX_ProjectTasks_ParentTaskId] ON [ProjectTasks] ([ParentTaskId]);
    CREATE INDEX [IX_ProjectTasks_AssigneeUserId] ON [ProjectTasks] ([AssigneeUserId]);
END
GO

IF OBJECT_ID(N'[dbo].[ProjectTaskDependencies]', N'U') IS NULL
BEGIN
    CREATE TABLE [ProjectTaskDependencies] (
        [Id] uniqueidentifier NOT NULL,
        [PredecessorTaskId] uniqueidentifier NOT NULL,
        [SuccessorTaskId] uniqueidentifier NOT NULL,
        [CreatedAt] datetime2 NOT NULL,
        [UpdatedAt] datetime2 NULL,
        [CreatedBy] nvarchar(256) NULL,
        [UpdatedBy] nvarchar(256) NULL,
        CONSTRAINT [PK_ProjectTaskDependencies] PRIMARY KEY ([Id])
    );
    CREATE UNIQUE INDEX [IX_ProjectTaskDependencies_Pred_Succ] ON [ProjectTaskDependencies] ([PredecessorTaskId], [SuccessorTaskId]);
END
GO

IF OBJECT_ID(N'[dbo].[ProjectComments]', N'U') IS NULL
BEGIN
    CREATE TABLE [ProjectComments] (
        [Id] uniqueidentifier NOT NULL,
        [ProjectId] uniqueidentifier NOT NULL,
        [TaskId] uniqueidentifier NULL,
        [AuthorUserId] uniqueidentifier NOT NULL,
        [Body] nvarchar(4000) NOT NULL,
        [CreatedAt] datetime2 NOT NULL,
        [UpdatedAt] datetime2 NULL,
        [CreatedBy] nvarchar(256) NULL,
        [UpdatedBy] nvarchar(256) NULL,
        CONSTRAINT [PK_ProjectComments] PRIMARY KEY ([Id])
    );
    CREATE INDEX [IX_ProjectComments_ProjectId_CreatedAt] ON [ProjectComments] ([ProjectId], [CreatedAt]);
    CREATE INDEX [IX_ProjectComments_TaskId] ON [ProjectComments] ([TaskId]);
END
GO

IF OBJECT_ID(N'[dbo].[ProjectAttachments]', N'U') IS NULL
BEGIN
    CREATE TABLE [ProjectAttachments] (
        [Id] uniqueidentifier NOT NULL,
        [ProjectId] uniqueidentifier NOT NULL,
        [TaskId] uniqueidentifier NULL,
        [FileName] nvarchar(260) NOT NULL,
        [StoragePath] nvarchar(500) NOT NULL,
        [ContentType] nvarchar(200) NOT NULL,
        [SizeBytes] bigint NOT NULL,
        [UploadedByUserId] uniqueidentifier NOT NULL,
        [CreatedAt] datetime2 NOT NULL,
        [UpdatedAt] datetime2 NULL,
        [CreatedBy] nvarchar(256) NULL,
        [UpdatedBy] nvarchar(256) NULL,
        CONSTRAINT [PK_ProjectAttachments] PRIMARY KEY ([Id])
    );
    CREATE INDEX [IX_ProjectAttachments_ProjectId] ON [ProjectAttachments] ([ProjectId]);
    CREATE INDEX [IX_ProjectAttachments_TaskId] ON [ProjectAttachments] ([TaskId]);
END
GO

IF OBJECT_ID(N'[dbo].[ProjectMembers]', N'U') IS NULL
BEGIN
    CREATE TABLE [ProjectMembers] (
        [Id] uniqueidentifier NOT NULL,
        [ProjectId] uniqueidentifier NOT NULL,
        [UserId] uniqueidentifier NOT NULL,
        [Role] int NOT NULL,
        [SalesRate] decimal(18,3) NULL,
        [HourlyCost] decimal(18,3) NULL,
        [WeeklyCapacityHours] decimal(18,2) NOT NULL,
        [CreatedAt] datetime2 NOT NULL,
        [UpdatedAt] datetime2 NULL,
        [CreatedBy] nvarchar(256) NULL,
        [UpdatedBy] nvarchar(256) NULL,
        CONSTRAINT [PK_ProjectMembers] PRIMARY KEY ([Id])
    );
    CREATE UNIQUE INDEX [IX_ProjectMembers_ProjectId_UserId] ON [ProjectMembers] ([ProjectId], [UserId]);
END
GO

IF OBJECT_ID(N'[dbo].[ProjectTimeEntries]', N'U') IS NULL
BEGIN
    CREATE TABLE [ProjectTimeEntries] (
        [Id] uniqueidentifier NOT NULL,
        [ProjectId] uniqueidentifier NOT NULL,
        [TaskId] uniqueidentifier NULL,
        [UserId] uniqueidentifier NOT NULL,
        [WorkDate] datetime2 NOT NULL,
        [Hours] decimal(18,2) NOT NULL,
        [IsBillable] bit NOT NULL,
        [Notes] nvarchar(2000) NULL,
        [Status] int NOT NULL,
        [InvoicedInvoiceId] uniqueidentifier NULL,
        [SubmittedAt] datetime2 NULL,
        [ValidatedAt] datetime2 NULL,
        [CreatedAt] datetime2 NOT NULL,
        [UpdatedAt] datetime2 NULL,
        [CreatedBy] nvarchar(256) NULL,
        [UpdatedBy] nvarchar(256) NULL,
        CONSTRAINT [PK_ProjectTimeEntries] PRIMARY KEY ([Id])
    );
    CREATE INDEX [IX_ProjectTimeEntries_ProjectId_WorkDate] ON [ProjectTimeEntries] ([ProjectId], [WorkDate]);
    CREATE INDEX [IX_ProjectTimeEntries_UserId] ON [ProjectTimeEntries] ([UserId]);
    CREATE INDEX [IX_ProjectTimeEntries_Status] ON [ProjectTimeEntries] ([Status]);
    CREATE INDEX [IX_ProjectTimeEntries_InvoicedInvoiceId] ON [ProjectTimeEntries] ([InvoicedInvoiceId]) WHERE [InvoicedInvoiceId] IS NOT NULL;
END
GO

IF OBJECT_ID(N'[dbo].[ProjectCostLines]', N'U') IS NULL
BEGIN
    CREATE TABLE [ProjectCostLines] (
        [Id] uniqueidentifier NOT NULL,
        [ProjectId] uniqueidentifier NOT NULL,
        [Source] int NOT NULL,
        [SourceId] uniqueidentifier NULL,
        [Description] nvarchar(500) NOT NULL,
        [AmountHt] decimal(18,3) NOT NULL,
        [OccurredOn] datetime2 NOT NULL,
        [TimeEntryId] uniqueidentifier NULL,
        [CreatedAt] datetime2 NOT NULL,
        [UpdatedAt] datetime2 NULL,
        [CreatedBy] nvarchar(256) NULL,
        [UpdatedBy] nvarchar(256) NULL,
        CONSTRAINT [PK_ProjectCostLines] PRIMARY KEY ([Id])
    );
    CREATE INDEX [IX_ProjectCostLines_ProjectId] ON [ProjectCostLines] ([ProjectId]);
    CREATE INDEX [IX_ProjectCostLines_SourceId] ON [ProjectCostLines] ([SourceId]);
END
GO

IF OBJECT_ID(N'[dbo].[ProjectActivities]', N'U') IS NULL
BEGIN
    CREATE TABLE [ProjectActivities] (
        [Id] uniqueidentifier NOT NULL,
        [ProjectId] uniqueidentifier NOT NULL,
        [TaskId] uniqueidentifier NULL,
        [ActorUserId] uniqueidentifier NULL,
        [Type] nvarchar(80) NOT NULL,
        [Message] nvarchar(2000) NOT NULL,
        [CreatedAt] datetime2 NOT NULL,
        [UpdatedAt] datetime2 NULL,
        [CreatedBy] nvarchar(256) NULL,
        [UpdatedBy] nvarchar(256) NULL,
        CONSTRAINT [PK_ProjectActivities] PRIMARY KEY ([Id])
    );
    CREATE INDEX [IX_ProjectActivities_ProjectId_CreatedAt] ON [ProjectActivities] ([ProjectId], [CreatedAt]);
END
GO

IF OBJECT_ID(N'[dbo].[ProjectMilestones]', N'U') IS NULL
BEGIN
    CREATE TABLE [ProjectMilestones] (
        [Id] uniqueidentifier NOT NULL,
        [ProjectId] uniqueidentifier NOT NULL,
        [Name] nvarchar(200) NOT NULL,
        [Percent] decimal(5,2) NOT NULL,
        [AmountHt] decimal(18,3) NOT NULL,
        [DueDate] datetime2 NULL,
        [InvoicedInvoiceId] uniqueidentifier NULL,
        [CreatedAt] datetime2 NOT NULL,
        [UpdatedAt] datetime2 NULL,
        [CreatedBy] nvarchar(256) NULL,
        [UpdatedBy] nvarchar(256) NULL,
        CONSTRAINT [PK_ProjectMilestones] PRIMARY KEY ([Id])
    );
    CREATE INDEX [IX_ProjectMilestones_ProjectId] ON [ProjectMilestones] ([ProjectId]);
    CREATE INDEX [IX_ProjectMilestones_InvoicedInvoiceId] ON [ProjectMilestones] ([InvoicedInvoiceId]) WHERE [InvoicedInvoiceId] IS NOT NULL;
END
GO

IF OBJECT_ID(N'[dbo].[ProjectSituations]', N'U') IS NULL
BEGIN
    CREATE TABLE [ProjectSituations] (
        [Id] uniqueidentifier NOT NULL,
        [ProjectId] uniqueidentifier NOT NULL,
        [Number] int NOT NULL,
        [PeriodStart] datetime2 NOT NULL,
        [PeriodEnd] datetime2 NOT NULL,
        [CumulativePercent] decimal(5,2) NOT NULL,
        [GrossAmountHt] decimal(18,3) NOT NULL,
        [RetainageAmountHt] decimal(18,3) NOT NULL,
        [VatRatePercent] int NOT NULL,
        [Status] int NOT NULL,
        [InvoiceId] uniqueidentifier NULL,
        [CreatedAt] datetime2 NOT NULL,
        [UpdatedAt] datetime2 NULL,
        [CreatedBy] nvarchar(256) NULL,
        [UpdatedBy] nvarchar(256) NULL,
        CONSTRAINT [PK_ProjectSituations] PRIMARY KEY ([Id])
    );
    CREATE UNIQUE INDEX [IX_ProjectSituations_ProjectId_Number] ON [ProjectSituations] ([ProjectId], [Number]);
    CREATE INDEX [IX_ProjectSituations_InvoiceId] ON [ProjectSituations] ([InvoiceId]) WHERE [InvoiceId] IS NOT NULL;
END
GO

IF OBJECT_ID(N'[dbo].[ProjectSubcontractors]', N'U') IS NULL
BEGIN
    CREATE TABLE [ProjectSubcontractors] (
        [Id] uniqueidentifier NOT NULL,
        [ProjectId] uniqueidentifier NOT NULL,
        [SupplierId] uniqueidentifier NOT NULL,
        [ContractReference] nvarchar(100) NULL,
        [AmountHt] decimal(18,3) NOT NULL,
        [RetainagePercent] decimal(5,2) NOT NULL,
        [CreatedAt] datetime2 NOT NULL,
        [UpdatedAt] datetime2 NULL,
        [CreatedBy] nvarchar(256) NULL,
        [UpdatedBy] nvarchar(256) NULL,
        CONSTRAINT [PK_ProjectSubcontractors] PRIMARY KEY ([Id])
    );
    CREATE INDEX [IX_ProjectSubcontractors_ProjectId] ON [ProjectSubcontractors] ([ProjectId]);
    CREATE INDEX [IX_ProjectSubcontractors_SupplierId] ON [ProjectSubcontractors] ([SupplierId]);
END
GO

IF OBJECT_ID(N'[dbo].[ProjectBillings]', N'U') IS NULL
BEGIN
    CREATE TABLE [ProjectBillings] (
        [Id] uniqueidentifier NOT NULL,
        [ProjectId] uniqueidentifier NOT NULL,
        [Kind] int NOT NULL,
        [InvoiceId] uniqueidentifier NOT NULL,
        [Notes] nvarchar(2000) NULL,
        [AmountHt] decimal(18,3) NOT NULL,
        [CreatedAt] datetime2 NOT NULL,
        [UpdatedAt] datetime2 NULL,
        [CreatedBy] nvarchar(256) NULL,
        [UpdatedBy] nvarchar(256) NULL,
        CONSTRAINT [PK_ProjectBillings] PRIMARY KEY ([Id])
    );
    CREATE INDEX [IX_ProjectBillings_ProjectId] ON [ProjectBillings] ([ProjectId]);
    CREATE INDEX [IX_ProjectBillings_InvoiceId] ON [ProjectBillings] ([InvoiceId]);
END
GO

IF COL_LENGTH(N'dbo.ProjectTasks', N'InvoicedInvoiceId') IS NULL
    ALTER TABLE [ProjectTasks] ADD [InvoicedInvoiceId] uniqueidentifier NULL;
IF COL_LENGTH(N'dbo.ProjectTasks', N'InvoicedBillingMethod') IS NULL
    ALTER TABLE [ProjectTasks] ADD [InvoicedBillingMethod] int NULL;
GO
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_ProjectTasks_InvoicedInvoiceId'
      AND object_id = OBJECT_ID(N'dbo.ProjectTasks'))
    CREATE INDEX [IX_ProjectTasks_InvoicedInvoiceId] ON [ProjectTasks] ([InvoicedInvoiceId])
    WHERE [InvoicedInvoiceId] IS NOT NULL;
GO

IF COL_LENGTH(N'dbo.Projects', N'TimesheetsEnabled') IS NULL
    ALTER TABLE [Projects] ADD [TimesheetsEnabled] bit NOT NULL CONSTRAINT [DF_Projects_TimesheetsEnabled] DEFAULT (1);
GO

IF COL_LENGTH(N'dbo.ProjectMembers', N'SalesRate') IS NULL
    ALTER TABLE [ProjectMembers] ADD [SalesRate] decimal(18,3) NULL;
GO
IF COL_LENGTH(N'dbo.ProjectMembers', N'DailyRate') IS NOT NULL
BEGIN
    UPDATE [ProjectMembers]
    SET [SalesRate] = [DailyRate]
    WHERE [SalesRate] IS NULL AND [DailyRate] IS NOT NULL AND [DailyRate] > 0;

    UPDATE [ProjectMembers]
    SET [SalesRate] = [HourlyCost] * 8
    WHERE [SalesRate] IS NULL AND [HourlyCost] IS NOT NULL AND [HourlyCost] > 0;

    UPDATE [ProjectMembers]
    SET [HourlyCost] = ROUND([DailyRate] / 8, 3)
    WHERE ([HourlyCost] IS NULL OR [HourlyCost] <= 0)
      AND [DailyRate] IS NOT NULL AND [DailyRate] > 0;
END
GO
IF COL_LENGTH(N'dbo.ProjectMembers', N'DailyRate') IS NOT NULL
    ALTER TABLE [ProjectMembers] DROP COLUMN [DailyRate];
GO

IF NOT EXISTS (SELECT 1 FROM __EFMigrationsHistory WHERE MigrationId = N'20260818120000_AddProjectsModule_Tenant')
    INSERT INTO __EFMigrationsHistory (MigrationId, ProductVersion) VALUES (N'20260818120000_AddProjectsModule_Tenant', N'8.0.0');
IF NOT EXISTS (SELECT 1 FROM __EFMigrationsHistory WHERE MigrationId = N'20260903190000_AddProjectTaskBillingState_Tenant')
    INSERT INTO __EFMigrationsHistory (MigrationId, ProductVersion) VALUES (N'20260903190000_AddProjectTaskBillingState_Tenant', N'8.0.0');
IF NOT EXISTS (SELECT 1 FROM __EFMigrationsHistory WHERE MigrationId = N'20260905180000_AddProjectBillableTimesheetsFlags_Tenant')
    INSERT INTO __EFMigrationsHistory (MigrationId, ProductVersion) VALUES (N'20260905180000_AddProjectBillableTimesheetsFlags_Tenant', N'8.0.0');
IF NOT EXISTS (SELECT 1 FROM __EFMigrationsHistory WHERE MigrationId = N'20260906120000_SplitProjectMemberSalesRate_Tenant')
    INSERT INTO __EFMigrationsHistory (MigrationId, ProductVersion) VALUES (N'20260906120000_SplitProjectMemberSalesRate_Tenant', N'8.0.0');
GO
