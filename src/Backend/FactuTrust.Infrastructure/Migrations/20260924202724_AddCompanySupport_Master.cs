using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FactuTrust.Infrastructure.Migrations;

/// <summary>
/// Fil unique société ↔ backoffice. Tables nouvelles uniquement.
/// Le diff EF initial mélangeait des colonnes déjà livrées par des migrations SQL ;
/// ce script ne crée que les cinq tables Assistance.
/// </summary>
public partial class AddCompanySupport_Master : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql("""
IF OBJECT_ID(N'dbo.CompanySupportConversations', N'U') IS NULL
BEGIN
    CREATE TABLE [CompanySupportConversations] (
        [Id] uniqueidentifier NOT NULL,
        [CompanyTenantId] uniqueidentifier NOT NULL,
        [LastMessageAt] datetime2 NULL,
        [LastMessagePreview] nvarchar(160) NULL,
        [LastMessageCategory] int NULL,
        [LastAuthorSide] int NULL,
        [CreatedAt] datetime2 NOT NULL,
        [UpdatedAt] datetime2 NULL,
        [CreatedBy] nvarchar(max) NULL,
        [UpdatedBy] nvarchar(max) NULL,
        [Version] int NOT NULL,
        CONSTRAINT [PK_CompanySupportConversations] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_CompanySupportConversations_Tenants_CompanyTenantId]
            FOREIGN KEY ([CompanyTenantId]) REFERENCES [Tenants] ([Id]) ON DELETE NO ACTION
    );
    CREATE UNIQUE INDEX [IX_CompanySupportConversations_CompanyTenantId]
        ON [CompanySupportConversations] ([CompanyTenantId]);
    CREATE INDEX [IX_CompanySupportConversations_LastMessageAt]
        ON [CompanySupportConversations] ([LastMessageAt]);
END
""");

        migrationBuilder.Sql("""
IF OBJECT_ID(N'dbo.CompanySupportMessages', N'U') IS NULL
BEGIN
    CREATE TABLE [CompanySupportMessages] (
        [Id] uniqueidentifier NOT NULL,
        [ConversationId] uniqueidentifier NOT NULL,
        [AuthorUserId] uniqueidentifier NOT NULL,
        [AuthorSide] int NOT NULL,
        [AuthorDisplayName] nvarchar(200) NOT NULL,
        [Category] int NOT NULL,
        [Body] nvarchar(4000) NOT NULL,
        [SentAt] datetime2 NOT NULL,
        [ClientRequestId] uniqueidentifier NULL,
        [CreatedAt] datetime2 NOT NULL,
        [UpdatedAt] datetime2 NULL,
        [CreatedBy] nvarchar(max) NULL,
        [UpdatedBy] nvarchar(max) NULL,
        CONSTRAINT [PK_CompanySupportMessages] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_CompanySupportMessages_CompanySupportConversations_ConversationId]
            FOREIGN KEY ([ConversationId]) REFERENCES [CompanySupportConversations] ([Id]) ON DELETE CASCADE
    );
    CREATE INDEX [IX_CompanySupportMessages_ConversationId_SentAt]
        ON [CompanySupportMessages] ([ConversationId], [SentAt]);
    CREATE UNIQUE INDEX [IX_CompanySupportMessages_ConversationId_ClientRequestId]
        ON [CompanySupportMessages] ([ConversationId], [ClientRequestId])
        WHERE [ClientRequestId] IS NOT NULL;
END
""");

        migrationBuilder.Sql("""
IF OBJECT_ID(N'dbo.CompanySupportAttachments', N'U') IS NULL
BEGIN
    CREATE TABLE [CompanySupportAttachments] (
        [Id] uniqueidentifier NOT NULL,
        [MessageId] uniqueidentifier NOT NULL,
        [FileName] nvarchar(260) NOT NULL,
        [StoragePath] nvarchar(500) NOT NULL,
        [ContentType] nvarchar(120) NOT NULL,
        [SizeBytes] bigint NOT NULL,
        [UploadedByUserId] uniqueidentifier NOT NULL,
        [CreatedAt] datetime2 NOT NULL,
        [UpdatedAt] datetime2 NULL,
        [CreatedBy] nvarchar(max) NULL,
        [UpdatedBy] nvarchar(max) NULL,
        CONSTRAINT [PK_CompanySupportAttachments] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_CompanySupportAttachments_CompanySupportMessages_MessageId]
            FOREIGN KEY ([MessageId]) REFERENCES [CompanySupportMessages] ([Id]) ON DELETE CASCADE
    );
    CREATE INDEX [IX_CompanySupportAttachments_MessageId]
        ON [CompanySupportAttachments] ([MessageId]);
END
""");

        migrationBuilder.Sql("""
IF OBJECT_ID(N'dbo.CompanySupportReadCursors', N'U') IS NULL
BEGIN
    CREATE TABLE [CompanySupportReadCursors] (
        [Id] uniqueidentifier NOT NULL,
        [ConversationId] uniqueidentifier NOT NULL,
        [UserId] uniqueidentifier NOT NULL,
        [LastReadAt] datetime2 NOT NULL,
        [CreatedAt] datetime2 NOT NULL,
        [UpdatedAt] datetime2 NULL,
        [CreatedBy] nvarchar(max) NULL,
        [UpdatedBy] nvarchar(max) NULL,
        CONSTRAINT [PK_CompanySupportReadCursors] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_CompanySupportReadCursors_CompanySupportConversations_ConversationId]
            FOREIGN KEY ([ConversationId]) REFERENCES [CompanySupportConversations] ([Id]) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX [IX_CompanySupportReadCursors_ConversationId_UserId]
        ON [CompanySupportReadCursors] ([ConversationId], [UserId]);
END
""");

        migrationBuilder.Sql("""
IF OBJECT_ID(N'dbo.CompanySupportAuditEvents', N'U') IS NULL
BEGIN
    CREATE TABLE [CompanySupportAuditEvents] (
        [Id] uniqueidentifier NOT NULL,
        [ConversationId] uniqueidentifier NOT NULL,
        [MessageId] uniqueidentifier NULL,
        [AttachmentId] uniqueidentifier NULL,
        [ActorUserId] uniqueidentifier NOT NULL,
        [ActorSide] int NOT NULL,
        [Action] nvarchar(80) NOT NULL,
        [OccurredAt] datetime2 NOT NULL,
        [CreatedAt] datetime2 NOT NULL,
        [UpdatedAt] datetime2 NULL,
        [CreatedBy] nvarchar(max) NULL,
        [UpdatedBy] nvarchar(max) NULL,
        CONSTRAINT [PK_CompanySupportAuditEvents] PRIMARY KEY ([Id])
    );
    CREATE INDEX [IX_CompanySupportAuditEvents_ConversationId_OccurredAt]
        ON [CompanySupportAuditEvents] ([ConversationId], [OccurredAt]);
END
""");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql("""
IF OBJECT_ID(N'dbo.CompanySupportAttachments', N'U') IS NOT NULL DROP TABLE [CompanySupportAttachments];
IF OBJECT_ID(N'dbo.CompanySupportReadCursors', N'U') IS NOT NULL DROP TABLE [CompanySupportReadCursors];
IF OBJECT_ID(N'dbo.CompanySupportAuditEvents', N'U') IS NOT NULL DROP TABLE [CompanySupportAuditEvents];
IF OBJECT_ID(N'dbo.CompanySupportMessages', N'U') IS NOT NULL DROP TABLE [CompanySupportMessages];
IF OBJECT_ID(N'dbo.CompanySupportConversations', N'U') IS NOT NULL DROP TABLE [CompanySupportConversations];
""");
    }
}
