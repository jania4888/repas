using FactuTrust.Domain.Auth;
using FactuTrust.Domain.Billing;
using FactuTrust.Domain.Communications;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Entities.AI;
using FactuTrust.Domain.Entities.Channels;
using FactuTrust.Domain.Entities.Storefront;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.Events;
using FactuTrust.Domain.ProductOnboarding;
using Microsoft.AspNetCore.DataProtection.EntityFrameworkCore;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Persistence;

/// <summary>
/// Master database context for tenant management and authentication.
/// Contains shared data across all tenants.
/// </summary>
public class MasterDbContext : IdentityDbContext<ApplicationUser, ApplicationRole, Guid>, IDataProtectionKeyContext
{
    public MasterDbContext(DbContextOptions<MasterDbContext> options) : base(options)
    {
    }

    public DbSet<Tenant> Tenants => Set<Tenant>();
    public DbSet<Subscription> Subscriptions => Set<Subscription>();
    public DbSet<TenantConnectionString> TenantConnectionStrings => Set<TenantConnectionString>();
    public DbSet<UserModuleGrant> UserModuleGrants => Set<UserModuleGrant>();
    public DbSet<ModuleGrantAuditEntry> ModuleGrantAuditEntries => Set<ModuleGrantAuditEntry>();
    public DbSet<PlatformActionAuditEntry> PlatformActionAuditEntries => Set<PlatformActionAuditEntry>();

    /// <summary>Plan §3.3 — per-tenant dismissals of module usage recommendations.</summary>
    public DbSet<ModuleRecommendationDismissal> ModuleRecommendationDismissals => Set<ModuleRecommendationDismissal>();
    public DbSet<AccountingFirmProfile> AccountingFirmProfiles => Set<AccountingFirmProfile>();
    public DbSet<FirmClientAssignment> FirmClientAssignments => Set<FirmClientAssignment>();
    public DbSet<UserNotification> UserNotifications => Set<UserNotification>();

    // Company ↔ Firm exchange workspace
    public DbSet<Domain.Entities.Exchange.ExchangeThread> ExchangeThreads => Set<Domain.Entities.Exchange.ExchangeThread>();
    public DbSet<Domain.Entities.Exchange.ExchangeMessage> ExchangeMessages => Set<Domain.Entities.Exchange.ExchangeMessage>();
    public DbSet<Domain.Entities.Exchange.ExchangeMessageRead> ExchangeMessageReads => Set<Domain.Entities.Exchange.ExchangeMessageRead>();
    public DbSet<Domain.Entities.Exchange.ExchangeRequest> ExchangeRequests => Set<Domain.Entities.Exchange.ExchangeRequest>();
    public DbSet<Domain.Entities.Exchange.ExchangeRequestComment> ExchangeRequestComments => Set<Domain.Entities.Exchange.ExchangeRequestComment>();
    public DbSet<Domain.Entities.Exchange.ExchangeTask> ExchangeTasks => Set<Domain.Entities.Exchange.ExchangeTask>();
    public DbSet<Domain.Entities.Exchange.ExchangeDocument> ExchangeDocuments => Set<Domain.Entities.Exchange.ExchangeDocument>();
    public DbSet<Domain.Entities.Exchange.ExchangeAuditEvent> ExchangeAuditEvents => Set<Domain.Entities.Exchange.ExchangeAuditEvent>();

    // Firm governance (cabinet TN)
    public DbSet<Domain.Entities.FirmGovernance.PermanentFile> PermanentFiles => Set<Domain.Entities.FirmGovernance.PermanentFile>();
    public DbSet<Domain.Entities.FirmGovernance.LegalRepresentative> LegalRepresentatives => Set<Domain.Entities.FirmGovernance.LegalRepresentative>();
    public DbSet<Domain.Entities.FirmGovernance.Shareholder> Shareholders => Set<Domain.Entities.FirmGovernance.Shareholder>();
    public DbSet<Domain.Entities.FirmGovernance.FirmTimeSheetEntry> FirmTimeSheetEntries => Set<Domain.Entities.FirmGovernance.FirmTimeSheetEntry>();
    public DbSet<Domain.Entities.FirmGovernance.FirmTimeSheetYearSettings> FirmTimeSheetYearSettings => Set<Domain.Entities.FirmGovernance.FirmTimeSheetYearSettings>();
    public DbSet<Domain.Entities.FirmGovernance.FirmTimeSheetPeriodLock> FirmTimeSheetPeriodLocks => Set<Domain.Entities.FirmGovernance.FirmTimeSheetPeriodLock>();
    public DbSet<Domain.Entities.FirmGovernance.FirmActivityCode> FirmActivityCodes => Set<Domain.Entities.FirmGovernance.FirmActivityCode>();
    public DbSet<Domain.Entities.FirmGovernance.FirmCollaboratorYearCost> FirmCollaboratorYearCosts => Set<Domain.Entities.FirmGovernance.FirmCollaboratorYearCost>();
    public DbSet<Domain.Entities.FirmGovernance.FirmExpenseNote> FirmExpenseNotes => Set<Domain.Entities.FirmGovernance.FirmExpenseNote>();
    public DbSet<Domain.Entities.FirmGovernance.FiscalCalendarRule> FiscalCalendarRules => Set<Domain.Entities.FirmGovernance.FiscalCalendarRule>();
    public DbSet<Domain.Entities.FirmGovernance.FirmCollaboratorProfile> FirmCollaboratorProfiles => Set<Domain.Entities.FirmGovernance.FirmCollaboratorProfile>();
    public DbSet<Domain.Entities.FirmGovernance.FirmCollaboratorLink> FirmCollaboratorLinks => Set<Domain.Entities.FirmGovernance.FirmCollaboratorLink>();
    public DbSet<Domain.Entities.FirmGovernance.FirmDossierAssignmentHistory> FirmDossierAssignmentHistories => Set<Domain.Entities.FirmGovernance.FirmDossierAssignmentHistory>();
    public DbSet<Domain.Entities.FirmGovernance.FirmDossierYearBudget> FirmDossierYearBudgets => Set<Domain.Entities.FirmGovernance.FirmDossierYearBudget>();
    public DbSet<Domain.Entities.FirmGovernance.FirmCollaboratorRentability> FirmCollaboratorRentabilities => Set<Domain.Entities.FirmGovernance.FirmCollaboratorRentability>();
    public DbSet<Domain.Entities.FirmGovernance.FirmCollaboratorRentabilityLine> FirmCollaboratorRentabilityLines => Set<Domain.Entities.FirmGovernance.FirmCollaboratorRentabilityLine>();
    public DbSet<Domain.Entities.FirmGovernance.FirmLeaveType> FirmLeaveTypes => Set<Domain.Entities.FirmGovernance.FirmLeaveType>();
    public DbSet<Domain.Entities.FirmGovernance.FirmLeaveSettings> FirmLeaveSettings => Set<Domain.Entities.FirmGovernance.FirmLeaveSettings>();
    public DbSet<Domain.Entities.FirmGovernance.FirmLeaveBalance> FirmLeaveBalances => Set<Domain.Entities.FirmGovernance.FirmLeaveBalance>();
    public DbSet<Domain.Entities.FirmGovernance.FirmLeaveRequest> FirmLeaveRequests => Set<Domain.Entities.FirmGovernance.FirmLeaveRequest>();
    public DbSet<Domain.Entities.FirmGovernance.FirmMissionBriefingLog> FirmMissionBriefingLogs => Set<Domain.Entities.FirmGovernance.FirmMissionBriefingLog>();

    // Public Virtual Street (3D storefront projection)
    public DbSet<StorefrontProfile> StorefrontProfiles => Set<StorefrontProfile>();
    public DbSet<StorefrontProduct> StorefrontProducts => Set<StorefrontProduct>();
    public DbSet<StorefrontOrder> StorefrontOrders => Set<StorefrontOrder>();
    public DbSet<StorefrontOrderItem> StorefrontOrderItems => Set<StorefrontOrderItem>();
    public DbSet<StorefrontPublishingConsent> StorefrontPublishingConsents => Set<StorefrontPublishingConsent>();
    public DbSet<StorefrontOutboxInboxEntry> StorefrontOutboxInboxEntries => Set<StorefrontOutboxInboxEntry>();

    // Data Protection Keys storage
    public DbSet<DataProtectionKey> DataProtectionKeys => Set<DataProtectionKey>();

    // Lot B2 — 2FA TOTP profile (one-to-one with ApplicationUser, only for platform admins)
    public DbSet<PlatformAdminProfile> PlatformAdminProfiles => Set<PlatformAdminProfile>();

    // Lot B4 — Active sessions tracking + failed login attempts (master DB, audit/security usage)
    public DbSet<UserSession> UserSessions => Set<UserSession>();
    public DbSet<FailedLoginAttempt> FailedLoginAttempts => Set<FailedLoginAttempt>();

    // Lot C1 — Configurable plans + per-plan limits/features/modules + per-tenant module overrides
    public DbSet<Plan> Plans => Set<Plan>();
    public DbSet<PlanLimit> PlanLimits => Set<PlanLimit>();
    public DbSet<PlanFeature> PlanFeatures => Set<PlanFeature>();
    public DbSet<PlanModule> PlanModules => Set<PlanModule>();
    public DbSet<TenantModuleOverride> TenantModuleOverrides => Set<TenantModuleOverride>();

    // Lot C2 — Email message audit log (master DB)
    public DbSet<EmailMessage> EmailMessages => Set<EmailMessage>();

    // Lot C3 — Coupons (codes promo) + redemptions + tenant credits
    public DbSet<Coupon> Coupons => Set<Coupon>();
    public DbSet<CouponRedemption> CouponRedemptions => Set<CouponRedemption>();
    public DbSet<TenantCredit> TenantCredits => Set<TenantCredit>();

    // Lot C4 — Platform invoicing : fiscal settings + invoice sequences + invoices + lines + receipts
    public DbSet<PlatformFiscalSettings> PlatformFiscalSettings => Set<PlatformFiscalSettings>();
    public DbSet<PlatformInvoiceSequence> PlatformInvoiceSequences => Set<PlatformInvoiceSequence>();
    public DbSet<PlatformInvoice> PlatformInvoices => Set<PlatformInvoice>();
    public DbSet<PlatformInvoiceLine> PlatformInvoiceLines => Set<PlatformInvoiceLine>();
    public DbSet<PlatformReceipt> PlatformReceipts => Set<PlatformReceipt>();

    // Lot C5 — Payment providers : Konnect / Paymee / Wire + intents + webhooks
    public DbSet<PaymentProviderConfig> PaymentProviderConfigs => Set<PaymentProviderConfig>();
    public DbSet<PaymentIntent> PaymentIntents => Set<PaymentIntent>();
    public DbSet<PaymentWebhookEvent> PaymentWebhookEvents => Set<PaymentWebhookEvent>();

    // Lot C6 — Renouvellement automatique + Dunning
    public DbSet<DunningCampaign> DunningCampaigns => Set<DunningCampaign>();
    public DbSet<DunningState> DunningStates => Set<DunningState>();

    // Configuration IA plateforme (modèle LLM global, singleton)
    public DbSet<PlatformAiSettings> PlatformAiSettings => Set<PlatformAiSettings>();

    /// <summary>Per-tenant Modal (Kimi) endpoint overrides (Master DB).</summary>
    public DbSet<TenantModalSettings> TenantModalSettings => Set<TenantModalSettings>();

    // Canaux externes (WhatsApp/Telegram) — index de routage master : identité externe → tenant/user.
    // Source de vérité du lien = tables channel de la base tenant (revalidées à chaque traitement).
    public DbSet<ChannelExternalRoute> ChannelExternalRoutes => Set<ChannelExternalRoute>();
    public DbSet<ChannelLinkCodePointer> ChannelLinkCodePointers => Set<ChannelLinkCodePointer>();

    // Phase 2 — moteur de règles sectorielles en base (plan §WP-B1)
    public DbSet<Domain.Entities.SectorRules.SectorSegment> SectorSegments => Set<Domain.Entities.SectorRules.SectorSegment>();
    public DbSet<Domain.Entities.SectorRules.SectorDomain> SectorDomains => Set<Domain.Entities.SectorRules.SectorDomain>();
    public DbSet<Domain.Entities.SectorRules.SectorSegmentDomain> SectorSegmentDomains => Set<Domain.Entities.SectorRules.SectorSegmentDomain>();
    public DbSet<Domain.Entities.SectorRules.SectorModuleRule> SectorModuleRules => Set<Domain.Entities.SectorRules.SectorModuleRule>();
    public DbSet<Domain.Entities.SectorRules.SectorModuleDependency> SectorModuleDependencies => Set<Domain.Entities.SectorRules.SectorModuleDependency>();
    public DbSet<Domain.Entities.SectorRules.SectorDefaultSetting> SectorDefaultSettings => Set<Domain.Entities.SectorRules.SectorDefaultSetting>();
    public DbSet<Domain.Entities.SectorRules.SectorTaxRegimeSuggestion> SectorTaxRegimeSuggestions => Set<Domain.Entities.SectorRules.SectorTaxRegimeSuggestion>();
    public DbSet<Domain.Entities.SectorRules.SectorDataTemplate> SectorDataTemplates => Set<Domain.Entities.SectorRules.SectorDataTemplate>();
    public DbSet<Domain.Entities.SectorRules.SectorDataTemplateItem> SectorDataTemplateItems => Set<Domain.Entities.SectorRules.SectorDataTemplateItem>();
    public DbSet<Domain.Entities.SectorRules.SectorRuleSetStamp> SectorRuleSetStamps => Set<Domain.Entities.SectorRules.SectorRuleSetStamp>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        // Ignore domain events - they are not database entities
        builder.Ignore<Domain.Common.DomainEvent>();
        builder.Ignore<TenantCreatedEvent>();
        builder.Ignore<TenantUpdatedEvent>();
        builder.Ignore<TenantDeactivatedEvent>();
        builder.Ignore<TenantReactivatedEvent>();
        builder.Ignore<StorefrontOptInCreatedEvent>();
        builder.Ignore<StorefrontSubmittedForReviewEvent>();
        builder.Ignore<StorefrontPublishedEvent>();
        builder.Ignore<StorefrontRejectedEvent>();
        builder.Ignore<StorefrontSuspendedEvent>();
        builder.Ignore<StorefrontUnpublishedEvent>();
        builder.Ignore<StorefrontProfileUpdatedEvent>();
        builder.Ignore<PublicOrderSubmittedEvent>();

        // Rename Identity tables to more meaningful names
        builder.Entity<ApplicationUser>(entity =>
        {
            entity.ToTable("Users");
            entity.Property(u => u.FirstName).HasMaxLength(100).IsRequired();
            entity.Property(u => u.LastName).HasMaxLength(100).IsRequired();
            entity.Property(u => u.ProductOnboardingStatus)
                .HasConversion<byte>()
                .HasDefaultValue(ProductOnboardingStatus.Completed);
            entity.Property(u => u.ProductOnboardingVersion).HasDefaultValue(1);
            entity.Property(u => u.ProductOnboardingChecklistJson).HasMaxLength(2000);
            entity.HasIndex(u => u.Email).IsUnique();
            entity.HasIndex(u => new { u.TenantId, u.PortalClientId });
            entity.Property(u => u.PortalInviteTokenHash).HasMaxLength(64);
            entity.HasMany(u => u.ModuleGrants)
                .WithOne()
                .HasForeignKey(g => g.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<ApplicationRole>(entity =>
        {
            entity.ToTable("Roles");
        });

        builder.Entity<IdentityUserRole<Guid>>(entity =>
        {
            entity.ToTable("UserRoles");
        });

        builder.Entity<IdentityUserClaim<Guid>>(entity =>
        {
            entity.ToTable("UserClaims");
        });

        builder.Entity<IdentityUserLogin<Guid>>(entity =>
        {
            entity.ToTable("UserLogins");
        });

        builder.Entity<IdentityRoleClaim<Guid>>(entity =>
        {
            entity.ToTable("RoleClaims");
        });

        builder.Entity<IdentityUserToken<Guid>>(entity =>
        {
            entity.ToTable("UserTokens");
        });

        // Tenant configuration
        builder.Entity<Tenant>(entity =>
        {
            entity.ToTable("Tenants");
            entity.HasKey(t => t.Id);
            
            entity.Property(t => t.CompanyName)
                .HasMaxLength(200)
                .IsRequired();

            entity.Property(t => t.DatabaseName)
                .HasMaxLength(100)
                .IsRequired();

            entity.HasIndex(t => t.DatabaseName).IsUnique();

            entity.Property(t => t.Kind)
                .HasDefaultValue(TenantKind.Company)
                .IsRequired();

            entity.HasIndex(t => t.Kind);

            entity.HasIndex(t => t.ManagedByFirmTenantId)
                .HasFilter("[ManagedByFirmTenantId] IS NOT NULL");
            entity.Ignore(t => t.IsFirmManaged);

            // Sector-aware registration wizard (plan §6.1 B2) — additive, nullable.
            entity.Property(t => t.CompanySegment).HasMaxLength(50);
            entity.Property(t => t.BusinessDomain).HasMaxLength(50);
            entity.Property(t => t.SectorCatalogVersion).HasMaxLength(50);

            // Réponses de profilage de l'inscription (lot 3) — toutes nullables : une colonne à NULL
            // signifie « pas de réponse », jamais « non ». Aucun index : ces colonnes ne filtrent
            // aucune requête chaude, elles servent au rejeu de la recommandation et à l'analyse.
            entity.Property(t => t.HeadcountBand).HasMaxLength(10);

            // Provisioning mini-saga (plan §1.5) — additive, defaults Ready so every pre-existing
            // row (and every non-restructured creation flow) reads as already-provisioned.
            entity.Property(t => t.ProvisioningStatus)
                .HasDefaultValue(TenantProvisioningStatus.Ready)
                .IsRequired();

            // Value object configurations
            entity.OwnsOne(t => t.NIF, nif =>
            {
                nif.Property(n => n.Value)
                    .HasColumnName("NIF")
                    .HasMaxLength(20)
                    .IsRequired();

                // NIF uniqueness (plan §1.4): unique only among ACTIVE tenants — mirrors the
                // application-level rule FirmManagedClientService already enforces (a deactivated
                // tenant's NIF can be reused, e.g. re-registering after a closure). Also filtered on
                // NIF IS NOT NULL for safety even though every creation path requires a valid NIF
                // value object today. Guards the race between the controller's pre-check and the
                // actual insert (two concurrent registrations with the same NIF) — surfaced by the
                // controller as a 409, not a generic 500.
                nif.HasIndex(n => n.Value)
                    .IsUnique()
                    .HasDatabaseName("IX_Tenants_NIF")
                    .HasFilter("[NIF] IS NOT NULL AND [IsActive] = 1");
            });

            entity.OwnsOne(t => t.Address, addr =>
            {
                addr.Property(a => a.Street).HasColumnName("Street").HasMaxLength(200).IsRequired();
                addr.Property(a => a.StreetLine2).HasColumnName("StreetLine2").HasMaxLength(200);
                addr.Property(a => a.City).HasColumnName("City").HasMaxLength(100).IsRequired();
                addr.Property(a => a.PostalCode).HasColumnName("PostalCode").HasMaxLength(20);
                addr.Property(a => a.Governorate).HasColumnName("Governorate").HasMaxLength(100).IsRequired();
                addr.Property(a => a.Country).HasColumnName("Country").HasMaxLength(100).IsRequired();
            });

            entity.OwnsOne(t => t.Email, email =>
            {
                email.Property(e => e.Value)
                    .HasColumnName("Email")
                    .HasMaxLength(256)
                    .IsRequired();
            });

            entity.OwnsOne(t => t.Phone, phone =>
            {
                phone.Property(p => p.Value)
                    .HasColumnName("Phone")
                    .HasMaxLength(20)
                    .IsRequired();
                phone.Ignore(p => p.CountryCode);
                phone.Ignore(p => p.LocalNumber);
            });
        });

        // Subscription configuration
        builder.Entity<Subscription>(entity =>
        {
            entity.ToTable("Subscriptions");
            entity.HasKey(s => s.Id);

            entity.OwnsOne(s => s.MonthlyPrice, price =>
            {
                price.Property(p => p.Amount).HasColumnName("MonthlyPriceAmount").HasPrecision(18, 3);
                price.Property(p => p.Currency).HasColumnName("MonthlyPriceCurrency").HasMaxLength(3);
            });

            entity.OwnsOne(s => s.AnnualPrice, price =>
            {
                price.Property(p => p.Amount).HasColumnName("AnnualPriceAmount").HasPrecision(18, 3);
                price.Property(p => p.Currency).HasColumnName("AnnualPriceCurrency").HasMaxLength(3);
            });

            // Lot C1 — FK rétro-compatible vers Plans (NULL accepté ; pas de cascade :
            // un Archive d'un Plan ne casse pas les subscriptions historiques).
            entity.HasIndex(s => s.PlanId);
            entity.HasOne<Plan>()
                .WithMany()
                .HasForeignKey(s => s.PlanId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        // TenantConnectionString configuration
        builder.Entity<TenantConnectionString>(entity =>
        {
            entity.ToTable("TenantConnectionStrings");
            entity.HasKey(t => t.Id);
            
            entity.Property(t => t.EncryptedConnectionString)
                .HasMaxLength(1000)
                .IsRequired();

            entity.HasIndex(t => t.TenantId).IsUnique();
        });

        builder.Entity<AccountingFirmProfile>(entity =>
        {
            entity.ToTable("AccountingFirmProfiles");
            entity.HasKey(p => p.Id);
            entity.HasIndex(p => p.TenantId).IsUnique();
            entity.Property(p => p.DisplayName).HasMaxLength(200).IsRequired();
            entity.Property(p => p.Description).HasMaxLength(2000);
            entity.Property(p => p.City).HasMaxLength(100).IsRequired();
            entity.Property(p => p.Governorate).HasMaxLength(100).IsRequired();
            entity.Property(p => p.ProfessionalRegistrationNumber).HasMaxLength(100);
            entity.Property(p => p.ContactEmail).HasMaxLength(256).IsRequired();
            entity.Property(p => p.ContactPhone).HasMaxLength(20).IsRequired();
            entity.HasIndex(p => new { p.IsPublicInDirectory, p.City });
        });

        builder.Entity<FirmClientAssignment>(entity =>
        {
            entity.ToTable("FirmClientAssignments");
            entity.HasKey(a => a.Id);
            entity.HasIndex(a => new { a.CompanyTenantId, a.FirmTenantId, a.Status });
            entity.HasIndex(a => a.FirmTenantId);
            entity.Property(a => a.Notes).HasMaxLength(1000);
            entity.Property(a => a.RejectionReason).HasMaxLength(500);
            entity.Property(a => a.Origin)
                .HasDefaultValue(FirmAssignmentOrigin.CompanyRequest)
                .IsRequired();
            entity.Property(a => a.CompanyProfileSnapshotJson).HasColumnType("nvarchar(max)");
            entity.Property(a => a.CompanyProfileCapturedAt).HasColumnType("datetime2");

            // Une seule liaison « ouverte » (pending=0 ou active=1) par société — garde anti-course au niveau DB.
            entity.HasIndex(a => a.CompanyTenantId)
                .IsUnique()
                .HasFilter("[Status] IN (0, 1)")
                .HasDatabaseName("IX_FirmClientAssignments_CompanyTenantId_Open");
        });

        ConfigureFirmGovernance(builder);

        builder.Entity<UserNotification>(entity =>
        {
            entity.ToTable("UserNotifications");
            entity.HasKey(n => n.Id);
            entity.Property(n => n.RecipientRole).HasMaxLength(UserNotification.RecipientRoleMaxLength);
            entity.Property(n => n.Title).HasMaxLength(UserNotification.TitleMaxLength).IsRequired();
            entity.Property(n => n.Body).HasMaxLength(UserNotification.BodyMaxLength).IsRequired();
            entity.Property(n => n.LinkUrl).HasMaxLength(UserNotification.LinkUrlMaxLength);
            entity.HasIndex(n => new { n.RecipientTenantId, n.ReadAt });
            entity.HasIndex(n => new { n.RecipientTenantId, n.CreatedAt }).IsDescending(false, true);
            entity.HasIndex(n => new { n.RecipientTenantId, n.RecipientUserId, n.CreatedAt }).IsDescending(false, false, true);
        });

        ConfigureExchange(builder);

        builder.Entity<UserModuleGrant>(entity =>
        {
            entity.ToTable("UserModuleGrants");
            entity.HasKey(g => g.Id);
            entity.HasIndex(g => new { g.UserId, g.Module }).IsUnique();
            entity.Property(g => g.EnabledFeatureKeys).HasMaxLength(2000);
        });

        // Plan §2.2 — audit trail for module-grant changes made via CompanyModulesController.
        builder.Entity<ModuleGrantAuditEntry>(entity =>
        {
            entity.ToTable("ModuleGrantAuditEntries");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Action).HasMaxLength(100).IsRequired();
            entity.Property(e => e.DiffJson).HasColumnType("nvarchar(max)").IsRequired();
            entity.HasIndex(e => new { e.TenantId, e.CreatedAtUtc });
        });

        // Audit des actions d'administration plateforme (creation de dossier, reprise de
        // provisionnement). En base maitre car l'action precede l'existence de la base du tenant.
        builder.Entity<PlatformActionAuditEntry>(entity =>
        {
            entity.ToTable("PlatformActionAuditEntries");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Action).HasMaxLength(100).IsRequired();
            entity.Property(e => e.Outcome).HasMaxLength(32).IsRequired();
            entity.Property(e => e.ActorEmail).HasMaxLength(256);
            entity.Property(e => e.CorrelationId).HasMaxLength(64);
            entity.Property(e => e.DetailsJson).HasColumnType("nvarchar(max)").IsRequired();
            entity.HasIndex(e => e.CreatedAtUtc);
            entity.HasIndex(e => e.TargetTenantId);
        });

        // Plan §3.3 — per-tenant dismissal of module usage recommendations; never resurfaces once dismissed.
        builder.Entity<ModuleRecommendationDismissal>(entity =>
        {
            entity.ToTable("ModuleRecommendationDismissals");
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => new { e.TenantId, e.Module }).IsUnique();
        });

        // Lot B2 — Platform admin 2FA profile (1-to-1 avec ApplicationUser).
        builder.Entity<PlatformAdminProfile>(entity =>
        {
            entity.ToTable("PlatformAdminProfiles");
            entity.HasKey(p => p.Id);
            entity.HasIndex(p => p.UserId).IsUnique();

            entity.Property(p => p.MfaSecretEncrypted).HasMaxLength(500);
            entity.Property(p => p.RecoveryCodesJson).HasMaxLength(4000);
        });

        // Lot B4 — User active sessions tracking
        builder.Entity<UserSession>(entity =>
        {
            entity.ToTable("UserSessions");
            entity.HasKey(s => s.Id);
            entity.HasIndex(s => s.JwtId).IsUnique();
            entity.HasIndex(s => new { s.UserId, s.RevokedAt });
            entity.HasIndex(s => s.ExpiresAt);

            entity.Property(s => s.IpAddress).HasMaxLength(45).IsRequired();
            entity.Property(s => s.UserAgent).HasMaxLength(500);
            entity.Property(s => s.RefreshTokenHash).HasMaxLength(128);
            entity.Property(s => s.RevocationReason).HasMaxLength(300);
        });

        // Lot B4 — Failed login attempts (security audit)
        builder.Entity<FailedLoginAttempt>(entity =>
        {
            entity.ToTable("FailedLoginAttempts");
            entity.HasKey(a => a.Id);
            entity.HasIndex(a => new { a.Email, a.AttemptAt });
            entity.HasIndex(a => new { a.IpAddress, a.AttemptAt });
            entity.HasIndex(a => a.AttemptAt);

            entity.Property(a => a.Email).HasMaxLength(254).IsRequired();
            entity.Property(a => a.IpAddress).HasMaxLength(45).IsRequired();
            entity.Property(a => a.UserAgent).HasMaxLength(500);
        });

        // Lot C1 — Plan configurable + relations cascade
        builder.Entity<Plan>(entity =>
        {
            entity.ToTable("Plans");
            entity.HasKey(p => p.Id);
            entity.HasIndex(p => p.Code).IsUnique();

            entity.Property(p => p.Code).HasMaxLength(50).IsRequired();
            entity.Property(p => p.Name).HasMaxLength(100).IsRequired();
            entity.Property(p => p.Description).HasMaxLength(500);
            entity.Property(p => p.BasePriceTND).HasPrecision(18, 3);
            entity.Property(p => p.Currency).HasMaxLength(3).IsRequired();
            entity.Property(p => p.BillingPeriod).HasConversion<int>();

            entity.HasMany(p => p.Limits)
                .WithOne()
                .HasForeignKey(l => l.PlanId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasMany(p => p.Features)
                .WithOne()
                .HasForeignKey(f => f.PlanId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasMany(p => p.Modules)
                .WithOne()
                .HasForeignKey(m => m.PlanId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<PlanLimit>(entity =>
        {
            entity.ToTable("PlanLimits");
            entity.HasKey(l => l.Id);
            entity.HasIndex(l => new { l.PlanId, l.Key }).IsUnique();
            entity.Property(l => l.Key).HasMaxLength(100).IsRequired();
            entity.Property(l => l.Value).HasMaxLength(200).IsRequired();
        });

        builder.Entity<PlanFeature>(entity =>
        {
            entity.ToTable("PlanFeatures");
            entity.HasKey(f => f.Id);
            entity.HasIndex(f => new { f.PlanId, f.FeatureKey }).IsUnique();
            entity.Property(f => f.FeatureKey).HasMaxLength(100).IsRequired();
        });

        builder.Entity<PlanModule>(entity =>
        {
            entity.ToTable("PlanModules");
            entity.HasKey(m => m.Id);
            entity.HasIndex(m => new { m.PlanId, m.Module }).IsUnique();
        });

        builder.Entity<TenantModuleOverride>(entity =>
        {
            entity.ToTable("TenantModuleOverrides");
            entity.HasKey(o => o.Id);
            entity.HasIndex(o => new { o.TenantId, o.Module }).IsUnique();
            entity.HasIndex(o => o.ExpiresAt);
            entity.Property(o => o.Reason).HasMaxLength(300);
        });

        // Lot C2 — Email messages log
        builder.Entity<EmailMessage>(entity =>
        {
            entity.ToTable("EmailMessages");
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => new { e.RelatedTenantId, e.CreatedAt });
            entity.HasIndex(e => new { e.Status, e.CreatedAt });
            entity.HasIndex(e => e.CreatedAt);

            entity.Property(e => e.ToEmail).HasMaxLength(254).IsRequired();
            entity.Property(e => e.ToName).HasMaxLength(200);
            entity.Property(e => e.TemplateCode).HasMaxLength(80).IsRequired();
            entity.Property(e => e.Subject).HasMaxLength(500).IsRequired();
            entity.Property(e => e.ProviderMessageId).HasMaxLength(200);
            entity.Property(e => e.ErrorMessage).HasMaxLength(2000);
            entity.Property(e => e.Status).HasConversion<int>();
        });

        // Lot C3 — Coupons + redemptions + credits
        builder.Entity<Coupon>(entity =>
        {
            entity.ToTable("Coupons");
            entity.HasKey(c => c.Id);
            entity.HasIndex(c => c.Code).IsUnique();
            entity.HasIndex(c => new { c.IsActive, c.ValidTo });

            entity.Property(c => c.Code).HasMaxLength(40).IsRequired();
            entity.Property(c => c.Type).HasConversion<int>();
            entity.Property(c => c.Value).HasPrecision(18, 3);
            entity.Property(c => c.Notes).HasMaxLength(500);
        });

        builder.Entity<CouponRedemption>(entity =>
        {
            entity.ToTable("CouponRedemptions");
            entity.HasKey(r => r.Id);
            entity.HasIndex(r => new { r.CouponId, r.TenantId }).IsUnique();
            entity.HasIndex(r => new { r.TenantId, r.RedeemedAt });

            entity.Property(r => r.AmountSavedTND).HasPrecision(18, 3);

            entity.HasOne<Coupon>()
                .WithMany()
                .HasForeignKey(r => r.CouponId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<TenantCredit>(entity =>
        {
            entity.ToTable("TenantCredits");
            entity.HasKey(c => c.Id);
            entity.HasIndex(c => new { c.TenantId, c.ExpiresAt });
            entity.HasIndex(c => c.RevokedAt);

            entity.Property(c => c.AmountTND).HasPrecision(18, 3);
            entity.Property(c => c.ConsumedAmountTND).HasPrecision(18, 3);
            entity.Property(c => c.Reason).HasMaxLength(500).IsRequired();
            entity.Property(c => c.RevocationReason).HasMaxLength(500);
        });

        // Lot C4 — Platform fiscal settings (singleton ; pas d'index unique car Id seul suffit, l'admin force 1 seule ligne)
        builder.Entity<PlatformFiscalSettings>(entity =>
        {
            entity.ToTable("PlatformFiscalSettings");
            entity.HasKey(p => p.Id);
            entity.Property(p => p.Nif).HasMaxLength(40).IsRequired();
            entity.Property(p => p.CodeTva).HasMaxLength(40);
            entity.Property(p => p.CompanyName).HasMaxLength(200).IsRequired();
            entity.Property(p => p.Address).HasMaxLength(500).IsRequired();
            entity.Property(p => p.Phone).HasMaxLength(40);
            entity.Property(p => p.Email).HasMaxLength(254);
            entity.Property(p => p.Website).HasMaxLength(254);
            entity.Property(p => p.Iban).HasMaxLength(60);
            entity.Property(p => p.BankName).HasMaxLength(120);
            entity.Property(p => p.DefaultVatRate).HasPrecision(5, 2);
            entity.Property(p => p.TimbreFiscalAmount).HasPrecision(18, 3);
            entity.Property(p => p.ClientWithholdingRate).HasPrecision(5, 2);
            entity.Property(p => p.InvoiceNumberPrefix).HasMaxLength(10).IsRequired();
            entity.Property(p => p.ReceiptNumberPrefix).HasMaxLength(10).IsRequired();
            entity.Property(p => p.LegalMentions).HasMaxLength(2000);
        });

        // Configuration IA plateforme (singleton ; pas d'index unique, l'admin force 1 seule ligne)
        builder.Entity<PlatformAiSettings>(entity =>
        {
            entity.ToTable("PlatformAiSettings");
            entity.HasKey(p => p.Id);
            entity.Property(p => p.DefaultModelRef).HasMaxLength(500);
            entity.Property(p => p.InvoiceImportModelRef).HasMaxLength(500);
            entity.Property(p => p.StudioAiModelRef).HasMaxLength(500);
            entity.Property(p => p.StudioAiAdvancedModelRef).HasMaxLength(500);
            entity.Property(p => p.InferenceDevice).HasConversion<int>().HasDefaultValue(Domain.Enums.OllamaInferenceDevice.Gpu);
            entity.Property(p => p.OpenRouterIsEnabled).HasDefaultValue(false);
            entity.Property(p => p.OpenRouterDisplayName).HasMaxLength(200);
            entity.Property(p => p.OpenRouterBaseUrl).HasMaxLength(500);
            entity.Property(p => p.OpenRouterEncryptedApiKey).HasMaxLength(4000);
            entity.Property(p => p.OpenRouterApiKeyLast4).HasMaxLength(4);
            entity.Property(p => p.CursorIsEnabled).HasDefaultValue(false);
            entity.Property(p => p.CursorDisplayName).HasMaxLength(200);
            entity.Property(p => p.CursorEncryptedApiKey).HasMaxLength(4000);
            entity.Property(p => p.CursorApiKeyLast4).HasMaxLength(4);
            entity.Property(p => p.ModalIsEnabled).HasDefaultValue(false);
            entity.Property(p => p.ModalDisplayName).HasMaxLength(200);
            entity.Property(p => p.ModalBaseUrl).HasMaxLength(500);
            entity.Property(p => p.ModalEncryptedApiKey).HasMaxLength(4000);
            entity.Property(p => p.ModalApiKeyLast4).HasMaxLength(4);
            entity.Property(p => p.CreatedBy).HasMaxLength(450);
            entity.Property(p => p.UpdatedBy).HasMaxLength(450);
        });

        builder.Entity<TenantModalSettings>(entity =>
        {
            entity.ToTable("TenantModalSettings");
            entity.HasKey(p => p.Id);
            entity.HasIndex(p => p.TenantId).IsUnique();
            entity.Property(p => p.DisplayName).HasMaxLength(200);
            entity.Property(p => p.BaseUrl).HasMaxLength(500);
            entity.Property(p => p.EncryptedApiKey).HasMaxLength(4000);
            entity.Property(p => p.ApiKeyLast4).HasMaxLength(4);
            entity.Property(p => p.IsEnabled).HasDefaultValue(false);
            entity.Property(p => p.CreatedBy).HasMaxLength(450);
            entity.Property(p => p.UpdatedBy).HasMaxLength(450);
            entity.HasOne<Tenant>()
                .WithMany()
                .HasForeignKey(p => p.TenantId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        // Canaux externes — routage master (identité externe → tenant/user)
        builder.Entity<ChannelExternalRoute>(entity =>
        {
            entity.ToTable("ChannelExternalRoutes");
            entity.HasKey(r => r.Id);
            entity.HasIndex(r => new { r.ChannelType, r.ExternalUserId }).IsUnique();
            entity.HasIndex(r => new { r.UserId, r.ChannelType });
            entity.HasIndex(r => new { r.TenantId, r.ChannelType, r.IsActive });

            entity.Property(r => r.ChannelType).HasConversion<int>();
            entity.Property(r => r.ExternalUserId).HasMaxLength(128).IsRequired();
            entity.Property(r => r.CreatedBy).HasMaxLength(450);
            entity.Property(r => r.UpdatedBy).HasMaxLength(450);
        });

        // Canaux externes — pointeur master de code de liaison (hash → tenant/user)
        builder.Entity<ChannelLinkCodePointer>(entity =>
        {
            entity.ToTable("ChannelLinkCodePointers");
            entity.HasKey(p => p.Id);
            entity.HasIndex(p => new { p.ChannelType, p.CodeHash });
            entity.HasIndex(p => p.ExpiresAt);

            entity.Property(p => p.ChannelType).HasConversion<int>();
            entity.Property(p => p.CodeHash).HasMaxLength(128).IsRequired();
            entity.Property(p => p.CreatedBy).HasMaxLength(450);
            entity.Property(p => p.UpdatedBy).HasMaxLength(450);
        });

        // Lot C4 — Platform invoice sequence (numérotation séquentielle par année)
        builder.Entity<PlatformInvoiceSequence>(entity =>
        {
            entity.ToTable("PlatformInvoiceSequences");
            entity.HasKey(s => s.Id);
            entity.HasIndex(s => new { s.DocumentType, s.Year }).IsUnique();
            entity.Property(s => s.DocumentType).HasMaxLength(20).IsRequired();
            entity.Property(s => s.RowVersion).IsRowVersion();
        });

        // Lot C4 — Platform invoices + lines (cascade)
        builder.Entity<PlatformInvoice>(entity =>
        {
            entity.ToTable("PlatformInvoices");
            entity.HasKey(i => i.Id);
            entity.HasIndex(i => i.Number).IsUnique().HasFilter("[Number] IS NOT NULL");
            entity.HasIndex(i => new { i.TenantId, i.InvoiceDate });
            entity.HasIndex(i => new { i.Status, i.DueDate });
            entity.HasIndex(i => i.SequenceYear);

            entity.Property(i => i.Number).HasMaxLength(40);
            entity.Property(i => i.BillingType).HasConversion<int>();
            entity.Property(i => i.Status).HasConversion<int>();
            entity.Property(i => i.SubtotalHT).HasPrecision(18, 3);
            entity.Property(i => i.VatAmount).HasPrecision(18, 3);
            entity.Property(i => i.DiscountAmount).HasPrecision(18, 3);
            entity.Property(i => i.CreditsApplied).HasPrecision(18, 3);
            entity.Property(i => i.StampDuty).HasPrecision(18, 3);
            entity.Property(i => i.TotalTTC).HasPrecision(18, 3);
            entity.Property(i => i.PdfStorageKey).HasMaxLength(300);
            entity.Property(i => i.LegalMentions).HasMaxLength(2000);
            entity.Property(i => i.FiscalSnapshotJson).HasColumnType("nvarchar(max)");
            entity.Property(i => i.CancelledReason).HasMaxLength(500);

            entity.HasMany(i => i.Lines)
                .WithOne()
                .HasForeignKey(l => l.InvoiceId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasMany(i => i.Receipts)
                .WithOne()
                .HasForeignKey(r => r.InvoiceId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.Navigation(i => i.Lines).UsePropertyAccessMode(PropertyAccessMode.Field);
            entity.Navigation(i => i.Receipts).UsePropertyAccessMode(PropertyAccessMode.Field);
        });

        builder.Entity<PlatformInvoiceLine>(entity =>
        {
            entity.ToTable("PlatformInvoiceLines");
            entity.HasKey(l => l.Id);
            entity.HasIndex(l => l.InvoiceId);

            entity.Property(l => l.Description).HasMaxLength(500).IsRequired();
            entity.Property(l => l.Quantity).HasPrecision(18, 3);
            entity.Property(l => l.UnitPriceHT).HasPrecision(18, 3);
            entity.Property(l => l.VatRate).HasPrecision(5, 2);
            entity.Property(l => l.LineTotalHT).HasPrecision(18, 3);
            entity.Property(l => l.LineTotalTTC).HasPrecision(18, 3);
        });

        // Lot C4 — Platform receipts (paiements rattachés à une facture)
        builder.Entity<PlatformReceipt>(entity =>
        {
            entity.ToTable("PlatformReceipts");
            entity.HasKey(r => r.Id);
            entity.HasIndex(r => r.ReceiptNumber).IsUnique();
            entity.HasIndex(r => new { r.InvoiceId, r.PaymentDate });

            entity.Property(r => r.ReceiptNumber).HasMaxLength(40).IsRequired();
            entity.Property(r => r.Method).HasConversion<int>();
            entity.Property(r => r.Status).HasConversion<int>();
            entity.Property(r => r.Reference).HasMaxLength(120);
            entity.Property(r => r.AmountTND).HasPrecision(18, 3);
            entity.Property(r => r.ProviderTxId).HasMaxLength(120);
            entity.Property(r => r.ProviderPayload).HasColumnType("nvarchar(max)");
            entity.Property(r => r.PdfStorageKey).HasMaxLength(300);
            entity.Property(r => r.CancelledReason).HasMaxLength(500);
        });

        // Lot C5 — Payment provider config (1 ligne par provider connu)
        builder.Entity<PaymentProviderConfig>(entity =>
        {
            entity.ToTable("PaymentProviderConfigs");
            entity.HasKey(p => p.Id);
            entity.HasIndex(p => p.ProviderCode).IsUnique();

            entity.Property(p => p.ProviderCode).HasMaxLength(20).IsRequired();
            entity.Property(p => p.DisplayName).HasMaxLength(120).IsRequired();
            entity.Property(p => p.EncryptedSecretsJson).HasColumnType("nvarchar(max)");
            entity.Property(p => p.WebhookSecretEncrypted).HasMaxLength(500);
            entity.Property(p => p.AllowedReturnDomain).HasMaxLength(254);
        });

        // Lot C5 — Payment intents (1 par tentative de paiement)
        builder.Entity<PaymentIntent>(entity =>
        {
            entity.ToTable("PaymentIntents");
            entity.HasKey(i => i.Id);
            entity.HasIndex(i => i.IdempotencyKey).IsUnique();
            entity.HasIndex(i => new { i.InvoiceId, i.Status });
            entity.HasIndex(i => new { i.TenantId, i.CreatedAt });
            entity.HasIndex(i => new { i.ProviderCode, i.ProviderRef });

            entity.Property(i => i.ProviderCode).HasMaxLength(20).IsRequired();
            entity.Property(i => i.ProviderRef).HasMaxLength(120);
            entity.Property(i => i.AmountTND).HasPrecision(18, 3);
            entity.Property(i => i.Status).HasConversion<int>();
            entity.Property(i => i.IdempotencyKey).HasMaxLength(80).IsRequired();
            entity.Property(i => i.ReturnUrl).HasMaxLength(500);
            entity.Property(i => i.RedirectUrl).HasMaxLength(500);
            entity.Property(i => i.RawProviderPayload).HasColumnType("nvarchar(max)");
            entity.Property(i => i.FailureReason).HasMaxLength(500);
        });

        // Lot C5 — Payment webhook events (idempotence stricte)
        builder.Entity<PaymentWebhookEvent>(entity =>
        {
            entity.ToTable("PaymentWebhookEvents");
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => new { e.ProviderCode, e.ProviderEventId }).IsUnique();
            entity.HasIndex(e => e.ReceivedAt);

            entity.Property(e => e.ProviderCode).HasMaxLength(20).IsRequired();
            entity.Property(e => e.ProviderEventId).HasMaxLength(120).IsRequired();
            entity.Property(e => e.Payload).HasColumnType("nvarchar(max)").IsRequired();
            entity.Property(e => e.ProcessingError).HasMaxLength(2000);
        });

        // Lot C6 — Dunning campaigns + per-subscription states
        builder.Entity<DunningCampaign>(entity =>
        {
            entity.ToTable("DunningCampaigns");
            entity.HasKey(c => c.Id);
            entity.HasIndex(c => c.IsActive);
            entity.Property(c => c.Name).HasMaxLength(120).IsRequired();
            entity.Property(c => c.Description).HasMaxLength(500);
            entity.Property(c => c.StepsJson).HasColumnType("nvarchar(max)").IsRequired();
        });

        builder.Entity<DunningState>(entity =>
        {
            entity.ToTable("DunningStates");
            entity.HasKey(s => s.Id);
            entity.HasIndex(s => new { s.SubscriptionId, s.Outcome });
            entity.HasIndex(s => new { s.Outcome, s.NextActionAt });
            entity.HasIndex(s => s.TenantId);

            entity.Property(s => s.Outcome).HasConversion<int>();
            entity.Property(s => s.LastError).HasMaxLength(1000);
        });

        ConfigureStorefrontProfile(builder);
        ConfigureStorefrontProduct(builder);
        ConfigureStorefrontOrder(builder);
        ConfigureStorefrontOrderItem(builder);
        ConfigureStorefrontPublishingConsent(builder);
        ConfigureStorefrontOutboxInboxEntry(builder);

        // DOIT rester la dernière étape : normalise toutes les clés Guid.Id des entités du domaine
        // en ValueGenerated.Never (le constructeur d'Entity a déjà positionné l'Id). Voir
        // PersistenceConventions.ApplyClientGeneratedGuidKeys pour le détail. Les types Identity
        // ASP.NET (ApplicationUser/Role, IdentityUserRole, ...) n'héritent pas d'Entity et sont
        // donc épargnés.
        PersistenceConventions.ApplyClientGeneratedGuidKeys(builder);
    }

    private static void ConfigureStorefrontProfile(ModelBuilder builder)
    {
        builder.Entity<StorefrontProfile>(entity =>
        {
            entity.ToTable("StorefrontProfiles");
            entity.HasKey(p => p.Id);

            entity.HasIndex(p => p.TenantId).IsUnique();
            entity.HasIndex(p => p.Slug).IsUnique();
            entity.HasIndex(p => new { p.Status, p.Category });
            entity.HasIndex(p => p.StreetPositionIndex)
                .IsUnique()
                .HasFilter("[StreetPositionIndex] IS NOT NULL AND [Status] = 2");

            entity.Property(p => p.TenantId).IsRequired();
            entity.Property(p => p.Slug).HasMaxLength(60).IsRequired();
            entity.Property(p => p.DisplayName).HasMaxLength(StorefrontProfile.DisplayNameMaxLength).IsRequired();
            entity.Property(p => p.Tagline).HasMaxLength(StorefrontProfile.TaglineMaxLength);
            entity.Property(p => p.DescriptionMarkdown).HasMaxLength(StorefrontProfile.DescriptionMaxLength);
            entity.Property(p => p.BrandPrimaryColorHex).HasMaxLength(7).IsRequired();
            entity.Property(p => p.BrandSecondaryColorHex).HasMaxLength(7).IsRequired();
            entity.Property(p => p.PublicLogoUrl).HasMaxLength(500);
            entity.Property(p => p.PublicCoverImageUrl).HasMaxLength(500);
            entity.Property(p => p.PublicContactEmail).HasMaxLength(256).IsRequired();
            entity.Property(p => p.PublicContactPhone).HasMaxLength(30);
            entity.Property(p => p.PublicContactWhatsApp).HasMaxLength(30);
            entity.Property(p => p.Category).HasConversion<int>();
            entity.Property(p => p.Status).HasConversion<int>();
            entity.Property(p => p.FacadeTheme).HasConversion<int>();
            entity.Property(p => p.OrderSubmissionEnabled).HasDefaultValue(true);
            entity.Property(p => p.RejectionReason).HasMaxLength(StorefrontProfile.RejectionReasonMaxLength);
            entity.Property(p => p.SuspensionReason).HasMaxLength(StorefrontProfile.RejectionReasonMaxLength);
            entity.Property(p => p.ConsentVersion).HasMaxLength(40).IsRequired();

            entity.HasOne<Tenant>()
                .WithOne()
                .HasForeignKey<StorefrontProfile>(p => p.TenantId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }

    private static void ConfigureStorefrontProduct(ModelBuilder builder)
    {
        builder.Entity<StorefrontProduct>(entity =>
        {
            entity.ToTable("StorefrontProducts");
            entity.HasKey(p => p.Id);

            entity.HasIndex(p => new { p.StorefrontProfileId, p.SourceProductId }).IsUnique();
            entity.HasIndex(p => new { p.StorefrontProfileId, p.Slug }).IsUnique();
            entity.HasIndex(p => new { p.IsVisible, p.StorefrontProfileId });

            entity.Property(p => p.StorefrontProfileId).IsRequired();
            entity.Property(p => p.TenantId).IsRequired();
            entity.Property(p => p.SourceProductId).IsRequired();
            entity.Property(p => p.Slug).HasMaxLength(120).IsRequired();
            entity.Property(p => p.Name).HasMaxLength(StorefrontProduct.NameMaxLength).IsRequired();
            entity.Property(p => p.DescriptionSanitized).HasMaxLength(StorefrontProduct.DescriptionMaxLength);
            entity.Property(p => p.PriceAmount).HasPrecision(18, 3);
            entity.Property(p => p.PriceCurrency).HasMaxLength(3).IsRequired();
            entity.Property(p => p.PublicImageUrl).HasMaxLength(500);
            entity.Property(p => p.ImageHash).HasMaxLength(64);
            entity.Property(p => p.CategoryLabel).HasMaxLength(100);
            entity.Property(p => p.StockDisplayStatus).HasConversion<int>();

            entity.HasOne<StorefrontProfile>()
                .WithMany()
                .HasForeignKey(p => p.StorefrontProfileId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }

    private static void ConfigureStorefrontOrder(ModelBuilder builder)
    {
        builder.Entity<StorefrontOrder>(entity =>
        {
            entity.ToTable("StorefrontOrders");
            entity.HasKey(o => o.Id);

            entity.HasIndex(o => o.SubmittedAt);
            entity.HasIndex(o => o.Status);

            entity.Property(o => o.GuestFullName).HasMaxLength(StorefrontOrder.GuestNameMaxLength).IsRequired();
            entity.Property(o => o.GuestEmail).HasMaxLength(256).IsRequired();
            entity.Property(o => o.GuestPhone).HasMaxLength(30).IsRequired();
            entity.Property(o => o.GuestNotes).HasMaxLength(StorefrontOrder.GuestNotesMaxLength);
            entity.Property(o => o.Status).HasConversion<int>();
            entity.Property(o => o.IpAddressHash).HasMaxLength(64);
            entity.Property(o => o.UserAgentHash).HasMaxLength(64);
            entity.Property(o => o.TenantDispatchResultsJson)
                .HasColumnType("nvarchar(max)")
                .IsRequired();

            entity.OwnsOne(o => o.GuestDeliveryAddress, addr =>
            {
                addr.Property(a => a.Street).HasColumnName("DeliveryStreet").HasMaxLength(200).IsRequired();
                addr.Property(a => a.StreetLine2).HasColumnName("DeliveryStreetLine2").HasMaxLength(200);
                addr.Property(a => a.City).HasColumnName("DeliveryCity").HasMaxLength(100).IsRequired();
                addr.Property(a => a.PostalCode).HasColumnName("DeliveryPostalCode").HasMaxLength(20);
                addr.Property(a => a.Governorate).HasColumnName("DeliveryGovernorate").HasMaxLength(100).IsRequired();
                addr.Property(a => a.Country).HasColumnName("DeliveryCountry").HasMaxLength(100).IsRequired();
            });

            entity.HasMany(o => o.Items)
                .WithOne()
                .HasForeignKey(i => i.StorefrontOrderId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.Navigation(o => o.Items).UsePropertyAccessMode(PropertyAccessMode.Field);
        });
    }

    private static void ConfigureStorefrontOrderItem(ModelBuilder builder)
    {
        builder.Entity<StorefrontOrderItem>(entity =>
        {
            entity.ToTable("StorefrontOrderItems");
            entity.HasKey(i => i.Id);

            entity.HasIndex(i => i.StorefrontOrderId);
            entity.HasIndex(i => i.TenantId);

            entity.Property(i => i.ProductName).HasMaxLength(200).IsRequired();
            entity.Property(i => i.Currency).HasMaxLength(3).IsRequired();
            entity.Property(i => i.Quantity).HasPrecision(18, 3);
            entity.Property(i => i.UnitPriceAmount).HasPrecision(18, 3);
        });
    }

    private static void ConfigureStorefrontPublishingConsent(ModelBuilder builder)
    {
        builder.Entity<StorefrontPublishingConsent>(entity =>
        {
            entity.ToTable("StorefrontPublishingConsents");
            entity.HasKey(c => c.Id);

            entity.HasIndex(c => c.TenantId);
            entity.HasIndex(c => c.StorefrontProfileId);

            entity.Property(c => c.TermsVersion).HasMaxLength(40).IsRequired();
            entity.Property(c => c.IpAddressHash).HasMaxLength(64);
            entity.Property(c => c.UserAgent).HasMaxLength(300);
        });
    }

    private static void ConfigureStorefrontOutboxInboxEntry(ModelBuilder builder)
    {
        builder.Entity<StorefrontOutboxInboxEntry>(entity =>
        {
            entity.ToTable("StorefrontOutboxInboxEntries");
            entity.HasKey(e => e.Id);

            entity.HasIndex(e => new { e.TenantId, e.AggregateType, e.AggregateId, e.SourceVersion })
                .IsUnique();

            entity.Property(e => e.AggregateType).HasMaxLength(80).IsRequired();
        });
    }

    private static void ConfigureFirmGovernance(ModelBuilder builder)
    {
        builder.Entity<Domain.Entities.FirmGovernance.PermanentFile>(entity =>
        {
            entity.ToTable("PermanentFiles");
            entity.HasKey(p => p.Id);
            entity.HasIndex(p => p.FirmClientAssignmentId).IsUnique();
            entity.HasIndex(p => p.FirmTenantId);
            entity.Property(p => p.CompanyName).HasMaxLength(200);
            entity.Property(p => p.Nif).HasMaxLength(30);
            entity.Property(p => p.RneIdentifier).HasMaxLength(50);
            entity.Property(p => p.Currency).HasMaxLength(3).HasDefaultValue("TND");
            entity.Property(p => p.ShareCapital).HasPrecision(18, 3);
            entity.Property(p => p.Street).HasMaxLength(200);
            entity.Property(p => p.City).HasMaxLength(100);
            entity.Property(p => p.Governorate).HasMaxLength(100);
            entity.Property(p => p.PostalCode).HasMaxLength(10);
            entity.Property(p => p.TaxOffice).HasMaxLength(200);
            entity.Property(p => p.CurrentLegalAct).HasMaxLength(200);
            entity.Property(p => p.MissionStatus).HasMaxLength(200);
            entity.Property(p => p.ResignationNotes).HasMaxLength(2000);
            entity.Property(p => p.BillingNotes).HasMaxLength(2000);
            entity.Property(p => p.AnnualFeeAmount).HasPrecision(18, 3);
            entity.Property(p => p.AssignedAccountantName).HasMaxLength(200);
        });

        builder.Entity<Domain.Entities.FirmGovernance.LegalRepresentative>(entity =>
        {
            entity.ToTable("LegalRepresentatives");
            entity.HasKey(r => r.Id);
            entity.HasIndex(r => r.PermanentFileId);
            entity.Property(r => r.LastName).HasMaxLength(100).IsRequired();
            entity.Property(r => r.FirstName).HasMaxLength(100).IsRequired();
            entity.Property(r => r.Cin).HasMaxLength(20);
            entity.Property(r => r.Nationality).HasMaxLength(100);
            entity.Property(r => r.Email).HasMaxLength(256);
            entity.Property(r => r.Phone).HasMaxLength(20);
            entity.Property(r => r.CnssNumber).HasMaxLength(30);
            entity.Property(r => r.Role).HasMaxLength(100);
        });

        builder.Entity<Domain.Entities.FirmGovernance.Shareholder>(entity =>
        {
            entity.ToTable("Shareholders");
            entity.HasKey(s => s.Id);
            entity.HasIndex(s => s.PermanentFileId);
            entity.Property(s => s.Name).HasMaxLength(200).IsRequired();
            entity.Property(s => s.CinOrNif).HasMaxLength(30);
            entity.Property(s => s.ShareCount).HasPrecision(18, 3);
            entity.Property(s => s.SharePercentage).HasPrecision(5, 2);
        });

        builder.Entity<Domain.Entities.FirmGovernance.FirmTimeSheetEntry>(entity =>
        {
            entity.ToTable("FirmTimeSheetEntries");
            entity.HasKey(t => t.Id);
            entity.HasIndex(t => new { t.FirmTenantId, t.WorkDate });
            entity.Property(t => t.UserDisplayName).HasMaxLength(200).IsRequired();
            entity.Property(t => t.ClientCompanyName).HasMaxLength(200);
            entity.Property(t => t.Hours).HasPrecision(9, 3);
            entity.Property(t => t.ActivityCode).HasMaxLength(50);
            entity.Property(t => t.Notes).HasMaxLength(1000);
            entity.Property(t => t.ValidatedByDisplayName).HasMaxLength(200);
            entity.Property(t => t.WorkLocation).HasMaxLength(20);
            entity.Property(t => t.Tags).HasMaxLength(200);
            entity.Property(t => t.Status).HasConversion<int>();
            // Sert les cumuls jour et semaine ISO d'un collaborateur lors du contrôle de saisie.
            entity.HasIndex(t => new { t.FirmTenantId, t.UserId, t.WorkDate });
            entity.HasIndex(t => new { t.FirmTenantId, t.UserId, t.TimerStartedAtUtc });
        });

        builder.Entity<Domain.Entities.FirmGovernance.FirmTimeSheetYearSettings>(entity =>
        {
            entity.ToTable("FirmTimeSheetYearSettings");
            entity.HasKey(s => s.Id);
            entity.HasIndex(s => new { s.FirmTenantId, s.Year }).IsUnique();
            entity.Property(s => s.WeeklyRegime).HasConversion<int>();
            entity.Property(s => s.MaxDailyHours).HasPrecision(9, 3);
            entity.Property(s => s.MaxWeeklyHours).HasPrecision(9, 3);
            entity.Property(s => s.PaidLeaveDaysPerYear).HasPrecision(9, 3);
            entity.Property(s => s.PublicHolidayDaysPerYear).HasPrecision(9, 3);
            entity.Property(s => s.ProductivityRatePercent).HasPrecision(9, 3);
            entity.Property(s => s.CnssEmployerRate).HasPrecision(9, 3);
            entity.Property(s => s.TfpRate).HasPrecision(9, 3);
            entity.Property(s => s.FoprolosRate).HasPrecision(9, 3);
            entity.Property(s => s.WorkAccidentRate).HasPrecision(9, 3);
            entity.Property(s => s.CssEmployerRate).HasPrecision(9, 3);
            entity.Ignore(s => s.AnnualWorkingDays);
            entity.Ignore(s => s.AnnualBaseHours);
            entity.Ignore(s => s.DailyHours);
            entity.Ignore(s => s.AnnualProductiveHours);
            entity.Ignore(s => s.TotalEmployerChargeRate);
        });

        builder.Entity<Domain.Entities.FirmGovernance.FirmMissionBriefingLog>(entity =>
        {
            entity.ToTable("FirmMissionBriefingLogs");
            entity.HasKey(b => b.Id);
            // C'est CET index qui porte l'anti-doublon du brief quotidien, pas le code du job :
            // un redéclenchement Hangfire se solde par une violation d'unicité, pas par un doublon.
            entity.HasIndex(b => new { b.FirmTenantId, b.RecipientUserId, b.BriefingDate }).IsUnique();
            entity.Property(b => b.BriefingDate).HasColumnType("date");
            entity.Property(b => b.Channel).HasConversion<int>();
        });

        builder.Entity<Domain.Entities.FirmGovernance.FirmCollaboratorYearCost>(entity =>
        {
            entity.ToTable("FirmCollaboratorYearCosts");
            entity.HasKey(c => c.Id);
            entity.HasIndex(c => new { c.FirmTenantId, c.CollaboratorUserId, c.Year }).IsUnique();
            entity.Property(c => c.GrossAnnualSalary).HasPrecision(18, 3);
            entity.Property(c => c.EmployerContributions).HasPrecision(18, 3);
            entity.Property(c => c.PayrollExtras).HasPrecision(18, 3);
            entity.Property(c => c.HourlyRateOverride).HasPrecision(18, 3);
            entity.Property(c => c.OverrideJustification).HasMaxLength(500);
            entity.Property(c => c.Source).HasConversion<int>();
            entity.Ignore(c => c.TotalEmployerCost);
        });

        builder.Entity<Domain.Entities.FirmGovernance.FirmActivityCode>(entity =>
        {
            entity.ToTable("FirmActivityCodes");
            entity.HasKey(a => a.Id);
            entity.HasIndex(a => new { a.FirmTenantId, a.Code }).IsUnique();
            entity.Property(a => a.Code).HasMaxLength(50).IsRequired();
            entity.Property(a => a.Label).HasMaxLength(200).IsRequired();
            entity.Property(a => a.Category).HasConversion<int>();
            entity.Property(a => a.DefaultUnitPrice).HasColumnType("decimal(18,3)");
        });

        builder.Entity<Domain.Entities.FirmGovernance.FirmTimeSheetPeriodLock>(entity =>
        {
            entity.ToTable("FirmTimeSheetPeriodLocks");
            entity.HasKey(p => p.Id);
            entity.HasIndex(p => new { p.FirmTenantId, p.Year, p.Month }).IsUnique();
            entity.Property(p => p.LockedByDisplayName).HasMaxLength(200).IsRequired();
            entity.Property(p => p.UnlockedByDisplayName).HasMaxLength(200);
            entity.Property(p => p.LockReason).HasMaxLength(500);
            entity.Property(p => p.UnlockReason).HasMaxLength(500);
        });

        builder.Entity<Domain.Entities.FirmGovernance.FirmExpenseNote>(entity =>
        {
            entity.ToTable("FirmExpenseNotes");
            entity.HasKey(n => n.Id);
            entity.HasIndex(n => new { n.FirmTenantId, n.FirmClientAssignmentId, n.PeriodYear, n.PeriodMonth }).IsUnique();
            entity.Property(n => n.CompanyName).HasMaxLength(200).IsRequired();
            entity.Property(n => n.RepresentativeName).HasMaxLength(200);
            entity.Property(n => n.TotalToReimburse).HasPrecision(18, 3);
            entity.Property(n => n.MixedCharges).HasPrecision(18, 3);
            entity.Property(n => n.OperatingExpenses).HasPrecision(18, 3);
            entity.Property(n => n.MileageAllowance).HasPrecision(18, 3);
            entity.Property(n => n.SalesAmount).HasPrecision(18, 3);
            entity.Property(n => n.Notes).HasMaxLength(2000);
        });

        builder.Entity<Domain.Entities.FirmGovernance.FiscalCalendarRule>(entity =>
        {
            entity.ToTable("FiscalCalendarRules");
            entity.HasKey(r => r.Id);
            entity.HasIndex(r => new { r.ObligationType, r.ApplicableTaxRegime });
            entity.Property(r => r.Label).HasMaxLength(200);
        });

        builder.Entity<Domain.Entities.FirmGovernance.FirmCollaboratorProfile>(entity =>
        {
            entity.ToTable("FirmCollaboratorProfiles");
            entity.HasKey(p => p.UserId);
            entity.Property(p => p.Qualification).HasMaxLength(200).IsRequired();
            entity.Property(p => p.PhoneLandline).HasMaxLength(40);
            entity.Property(p => p.AddressLine).HasMaxLength(300);
            entity.Property(p => p.PostalCode).HasMaxLength(20);
            entity.Property(p => p.City).HasMaxLength(100);
            entity.Property(p => p.Country).HasMaxLength(100);
            entity.Property(p => p.CniFileName).HasMaxLength(260);
            entity.Property(p => p.CniContentType).HasMaxLength(100);
            entity.Property(p => p.HourlyCostRate).HasPrecision(18, 3);
            entity.Property(p => p.PayrollLinkSource).HasConversion<int>();
            entity.HasIndex(p => p.PayrollEmployeeId);
            entity.HasOne<ApplicationUser>()
                .WithMany()
                .HasForeignKey(p => p.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<Domain.Entities.FirmGovernance.FirmCollaboratorLink>(entity =>
        {
            entity.ToTable("FirmCollaboratorLinks");
            entity.HasKey(l => l.Id);
            entity.HasIndex(l => new { l.ParentUserId, l.ChildUserId }).IsUnique();
            entity.HasIndex(l => l.ChildUserId);
            entity.HasOne<ApplicationUser>()
                .WithMany()
                .HasForeignKey(l => l.ParentUserId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ApplicationUser>()
                .WithMany()
                .HasForeignKey(l => l.ChildUserId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        builder.Entity<Domain.Entities.FirmGovernance.FirmDossierAssignmentHistory>(entity =>
        {
            entity.ToTable("FirmDossierAssignmentHistories");
            entity.HasKey(h => h.Id);
            entity.Property(h => h.AccountantDisplayName).HasMaxLength(200);
            entity.HasIndex(h => new { h.FirmTenantId, h.FirmClientAssignmentId, h.EndedAt });
            entity.HasIndex(h => h.AccountantUserId);
        });

        builder.Entity<Domain.Entities.FirmGovernance.FirmDossierYearBudget>(entity =>
        {
            entity.ToTable("FirmDossierYearBudgets");
            entity.HasKey(b => b.Id);
            entity.HasIndex(b => new { b.FirmClientAssignmentId, b.Year }).IsUnique();
            entity.HasIndex(b => new { b.FirmTenantId, b.Year });
            entity.Property(b => b.BudgetAnnuel).HasPrecision(18, 3);
        });

        builder.Entity<Domain.Entities.FirmGovernance.FirmCollaboratorRentability>(entity =>
        {
            entity.ToTable("FirmCollaboratorRentabilities");
            entity.HasKey(r => r.Id);
            entity.HasIndex(r => new { r.FirmTenantId, r.CollaboratorUserId, r.Year }).IsUnique();
            entity.Property(r => r.CollaboratorDisplayName).HasMaxLength(200).IsRequired();
            entity.Property(r => r.Rentability).HasPrecision(18, 3);
            entity.Property(r => r.LegacyRentability).HasPrecision(18, 3);
            entity.HasMany(r => r.Lines)
                .WithOne()
                .HasForeignKey(l => l.CollaboratorRentabilityId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.Navigation(r => r.Lines).HasField("_lines").UsePropertyAccessMode(PropertyAccessMode.Field);
        });

        builder.Entity<Domain.Entities.FirmGovernance.FirmCollaboratorRentabilityLine>(entity =>
        {
            entity.ToTable("FirmCollaboratorRentabilityLines");
            entity.HasKey(l => l.Id);
            entity.HasIndex(l => new { l.CollaboratorRentabilityId, l.ReferenceCode, l.LineCollaboratorUserId });
            entity.Property(l => l.Value).HasPrecision(18, 3);
            entity.Property(l => l.ReferenceCode).HasConversion<int>();
        });

        builder.Entity<Domain.Entities.FirmGovernance.FirmLeaveType>(entity =>
        {
            entity.ToTable("FirmLeaveTypes");
            entity.HasKey(t => t.Id);
            entity.HasIndex(t => new { t.FirmTenantId, t.Code }).IsUnique();
            entity.Property(t => t.Code).HasMaxLength(30).IsRequired();
            entity.Property(t => t.Label).HasMaxLength(200).IsRequired();
            entity.Property(t => t.ColorHex).HasMaxLength(9).IsRequired();
            entity.Property(t => t.PayrollLeaveType).HasConversion<int?>();
        });

        builder.Entity<Domain.Entities.FirmGovernance.FirmLeaveSettings>(entity =>
        {
            entity.ToTable("FirmLeaveSettings");
            entity.HasKey(s => s.Id);
            entity.HasIndex(s => new { s.FirmTenantId, s.Year }).IsUnique();
            entity.Property(s => s.DefaultAnnualPaidDays).HasPrecision(9, 3);
            entity.Property(s => s.MaxCarryOverDays).HasPrecision(9, 3);
        });

        builder.Entity<Domain.Entities.FirmGovernance.FirmLeaveBalance>(entity =>
        {
            entity.ToTable("FirmLeaveBalances");
            entity.HasKey(b => b.Id);
            entity.HasIndex(b => new { b.FirmTenantId, b.UserId, b.Year }).IsUnique();
            entity.Property(b => b.OpeningBalanceDays).HasPrecision(9, 3);
            entity.Property(b => b.AdjustmentDays).HasPrecision(9, 3);
            entity.Property(b => b.Notes).HasMaxLength(500);
        });

        builder.Entity<Domain.Entities.FirmGovernance.FirmLeaveRequest>(entity =>
        {
            entity.ToTable("FirmLeaveRequests");
            entity.HasKey(r => r.Id);
            entity.HasIndex(r => new { r.FirmTenantId, r.UserId, r.StartDate });
            entity.HasIndex(r => new { r.FirmTenantId, r.Status });
            entity.Property(r => r.Days).HasPrecision(6, 2);
            entity.Property(r => r.Reason).HasMaxLength(500);
            entity.Property(r => r.ProcessedByName).HasMaxLength(200);
            entity.Property(r => r.RejectionReason).HasMaxLength(500);
            entity.Property(r => r.Status).HasConversion<int>();
            entity.Property(r => r.StartUnit).HasConversion<int>();
            entity.Property(r => r.EndUnit).HasConversion<int>();
            entity.Property(r => r.PayrollMirrorState).HasConversion<int>();
            entity.Property(r => r.PayrollMirrorMessage).HasMaxLength(400);
            // Le rapprochement liste d'abord les reports en échec ou bloqués.
            entity.HasIndex(r => new { r.FirmTenantId, r.PayrollMirrorState });
        });

    }

    private static void ConfigureExchange(ModelBuilder builder)
    {
        builder.Entity<Domain.Entities.Exchange.ExchangeThread>(entity =>
        {
            entity.ToTable("ExchangeThreads");
            entity.HasKey(t => t.Id);
            entity.HasIndex(t => t.FirmClientAssignmentId).IsUnique();
            entity.HasIndex(t => new { t.FirmTenantId, t.Status });
            entity.HasIndex(t => new { t.CompanyTenantId, t.Status });
            entity.HasIndex(t => new { t.CompanyTenantId, t.LastActivityAt })
                .IsDescending(false, true)
                .HasDatabaseName("IX_ExchangeThreads_CompanyTenantId_LastActivityAt");
            entity.Property(t => t.Subject).HasMaxLength(Domain.Entities.Exchange.ExchangeThread.SubjectMaxLength);
            entity.Property(t => t.Status).HasConversion<int>();
        });

        builder.Entity<Domain.Entities.Exchange.ExchangeMessage>(entity =>
        {
            entity.ToTable("ExchangeMessages");
            entity.HasKey(m => m.Id);
            entity.HasIndex(m => new { m.ThreadId, m.SentAt });
            entity.HasIndex(m => new { m.ThreadId, m.Visibility, m.SentAt })
                .HasDatabaseName("IX_ExchangeMessages_ThreadId_Visibility_SentAt");
            entity.Property(m => m.AuthorDisplayName).HasMaxLength(Domain.Entities.Exchange.ExchangeMessage.AuthorDisplayNameMaxLength).IsRequired();
            entity.Property(m => m.Body).HasMaxLength(Domain.Entities.Exchange.ExchangeMessage.BodyMaxLength).IsRequired();
            entity.Property(m => m.Visibility).HasConversion<int>();
        });

        builder.Entity<Domain.Entities.Exchange.ExchangeMessageRead>(entity =>
        {
            entity.ToTable("ExchangeMessageReads");
            entity.HasKey(r => r.Id);
            entity.HasIndex(r => new { r.MessageId, r.UserId }).IsUnique();
            entity.HasIndex(r => new { r.UserId, r.MessageId })
                .HasDatabaseName("IX_ExchangeMessageReads_UserId_MessageId");
        });

        builder.Entity<Domain.Entities.Exchange.ExchangeRequest>(entity =>
        {
            entity.ToTable("ExchangeRequests");
            entity.HasKey(r => r.Id);
            entity.HasIndex(r => new { r.ThreadId, r.Number }).IsUnique();
            entity.HasIndex(r => new { r.ThreadId, r.Status });
            entity.Property(r => r.Title).HasMaxLength(Domain.Entities.Exchange.ExchangeRequest.TitleMaxLength).IsRequired();
            entity.Property(r => r.Description).HasMaxLength(Domain.Entities.Exchange.ExchangeRequest.DescriptionMaxLength).IsRequired();
            entity.Property(r => r.Category).HasConversion<int>();
            entity.Property(r => r.Priority).HasConversion<int>();
            entity.Property(r => r.Status).HasConversion<int>();
        });

        builder.Entity<Domain.Entities.Exchange.ExchangeRequestComment>(entity =>
        {
            entity.ToTable("ExchangeRequestComments");
            entity.HasKey(c => c.Id);
            entity.HasIndex(c => new { c.RequestId, c.CreatedAt });
            entity.Property(c => c.Body).HasMaxLength(Domain.Entities.Exchange.ExchangeRequestComment.BodyMaxLength).IsRequired();
            entity.Property(c => c.AuthorDisplayName).HasMaxLength(Domain.Entities.Exchange.ExchangeRequestComment.AuthorDisplayNameMaxLength).IsRequired();
        });

        builder.Entity<Domain.Entities.Exchange.ExchangeTask>(entity =>
        {
            entity.ToTable("ExchangeTasks");
            entity.HasKey(t => t.Id);
            entity.HasIndex(t => new { t.ThreadId, t.Status });
            entity.Property(t => t.Title).HasMaxLength(Domain.Entities.Exchange.ExchangeTask.TitleMaxLength).IsRequired();
            entity.Property(t => t.Description).HasMaxLength(Domain.Entities.Exchange.ExchangeTask.DescriptionMaxLength);
            entity.Property(t => t.Status).HasConversion<int>();
        });

        builder.Entity<Domain.Entities.Exchange.ExchangeDocument>(entity =>
        {
            entity.ToTable("ExchangeDocuments");
            entity.HasKey(d => d.Id);
            entity.HasIndex(d => d.ThreadId);
            entity.HasIndex(d => d.MessageId);
            entity.Property(d => d.FileName).HasMaxLength(Domain.Entities.Exchange.ExchangeDocument.FileNameMaxLength).IsRequired();
            entity.Property(d => d.StoragePath).HasMaxLength(Domain.Entities.Exchange.ExchangeDocument.StoragePathMaxLength).IsRequired();
            entity.Property(d => d.ContentType).HasMaxLength(Domain.Entities.Exchange.ExchangeDocument.ContentTypeMaxLength).IsRequired();
        });

        builder.Entity<Domain.Entities.Exchange.ExchangeAuditEvent>(entity =>
        {
            entity.ToTable("ExchangeAuditEvents");
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => new { e.ThreadId, e.OccurredAt });
            entity.Property(e => e.ActorDisplayName).HasMaxLength(Domain.Entities.Exchange.ExchangeAuditEvent.ActorDisplayNameMaxLength).IsRequired();
            entity.Property(e => e.PayloadJson).HasMaxLength(Domain.Entities.Exchange.ExchangeAuditEvent.PayloadMaxLength);
            entity.Property(e => e.EventType).HasConversion<int>();
        });

        // Phase 2 — moteur de règles sectorielles en base (plan §WP-B1). Ces tables restent sans
        // propriété de navigation (même convention que ChannelExternalRoute's TenantId/UserId) pour
        // que le modèle reste simple à éditer à la main à côté de la migration/du snapshot, MAIS
        // les clés étrangères de la migration sont déclarées côté modèle (HasOne/WithMany sans
        // navigation). C'est indispensable : EF ordonne les INSERT via un tri topologique basé sur
        // les FK DU MODÈLE. Sans elles, il n'a aucune arête et émet un lot par type d'entité dans
        // l'ordre ordinal des noms de types — ce qui plaçait SectorDataTemplateItems avant
        // SectorDataTemplates et SectorModuleRules avant SectorSegments, faisant échouer le seed
        // initial sur une violation de FK (SQL 547). Les noms de contraintes sont épinglés via
        // HasConstraintName pour coller à ceux déjà créés par AddSectorRuleTables_Master.
        builder.Entity<Domain.Entities.SectorRules.SectorSegment>(entity =>
        {
            entity.ToTable("SectorSegments");
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.Code).IsUnique();
            entity.Property(e => e.Code).HasMaxLength(50).IsRequired();
            entity.Property(e => e.LabelFr).HasMaxLength(100).IsRequired();
            entity.Property(e => e.DescriptionFr).HasMaxLength(300).IsRequired();
            entity.Property(e => e.IconKey).HasMaxLength(50).IsRequired();
            entity.Property(e => e.DefaultWarehouseName).HasMaxLength(100);
            entity.Property(e => e.CreatedBy).HasMaxLength(450);
            entity.Property(e => e.UpdatedBy).HasMaxLength(450);
        });

        builder.Entity<Domain.Entities.SectorRules.SectorDomain>(entity =>
        {
            entity.ToTable("SectorDomains");
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.Code).IsUnique();
            entity.Property(e => e.Code).HasMaxLength(50).IsRequired();
            entity.Property(e => e.LabelFr).HasMaxLength(100).IsRequired();
            entity.Property(e => e.CreatedBy).HasMaxLength(450);
            entity.Property(e => e.UpdatedBy).HasMaxLength(450);
        });

        builder.Entity<Domain.Entities.SectorRules.SectorSegmentDomain>(entity =>
        {
            entity.ToTable("SectorSegmentDomains");
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => new { e.SegmentId, e.DomainId }).IsUnique();
            entity.Property(e => e.CreatedBy).HasMaxLength(450);
            entity.Property(e => e.UpdatedBy).HasMaxLength(450);

            entity.HasOne<Domain.Entities.SectorRules.SectorSegment>()
                .WithMany()
                .HasForeignKey(e => e.SegmentId)
                .HasConstraintName("FK_SectorSegmentDomains_SectorSegments")
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne<Domain.Entities.SectorRules.SectorDomain>()
                .WithMany()
                .HasForeignKey(e => e.DomainId)
                .HasConstraintName("FK_SectorSegmentDomains_SectorDomains")
                .OnDelete(DeleteBehavior.Restrict);
        });

        builder.Entity<Domain.Entities.SectorRules.SectorModuleRule>(entity =>
        {
            entity.ToTable("SectorModuleRules");
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => new { e.RuleKind, e.SegmentId, e.DomainId, e.ModuleId }).IsUnique();
            entity.Property(e => e.RuleKind).HasConversion<int>();
            entity.Property(e => e.CreatedBy).HasMaxLength(450);
            entity.Property(e => e.UpdatedBy).HasMaxLength(450);

            // SegmentId/DomainId sont Guid? : EF en déduit des relations optionnelles, ce que le
            // CHECK CK_SectorModuleRules_Kind impose déjà (exactement l'un des deux est renseigné).
            entity.HasOne<Domain.Entities.SectorRules.SectorSegment>()
                .WithMany()
                .HasForeignKey(e => e.SegmentId)
                .HasConstraintName("FK_SectorModuleRules_SectorSegments")
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne<Domain.Entities.SectorRules.SectorDomain>()
                .WithMany()
                .HasForeignKey(e => e.DomainId)
                .HasConstraintName("FK_SectorModuleRules_SectorDomains")
                .OnDelete(DeleteBehavior.Restrict);
        });

        builder.Entity<Domain.Entities.SectorRules.SectorModuleDependency>(entity =>
        {
            entity.ToTable("SectorModuleDependencies");
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => new { e.ModuleId, e.RequiredModuleId }).IsUnique();
            entity.Property(e => e.CreatedBy).HasMaxLength(450);
            entity.Property(e => e.UpdatedBy).HasMaxLength(450);
        });

        builder.Entity<Domain.Entities.SectorRules.SectorDefaultSetting>(entity =>
        {
            entity.ToTable("SectorDefaultSettings");
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => new { e.SegmentCode, e.DomainCode, e.SettingKey }).IsUnique();
            entity.Property(e => e.SegmentCode).HasMaxLength(50);
            entity.Property(e => e.DomainCode).HasMaxLength(50);
            entity.Property(e => e.SettingKey).HasMaxLength(100).IsRequired();
            entity.Property(e => e.ValueType).HasMaxLength(20).IsRequired();
            entity.Property(e => e.CreatedBy).HasMaxLength(450);
            entity.Property(e => e.UpdatedBy).HasMaxLength(450);
        });

        // Plan §3.1 — segment → suggested tax regime rows (informational, admin-editable).
        builder.Entity<Domain.Entities.SectorRules.SectorTaxRegimeSuggestion>(entity =>
        {
            entity.ToTable("SectorTaxRegimeSuggestions");
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => new { e.SegmentCode, e.Regime }).IsUnique();
            entity.Property(e => e.SegmentCode).HasMaxLength(50).IsRequired();
            entity.Property(e => e.NoteFr).HasMaxLength(500).IsRequired();
            entity.Property(e => e.CreatedBy).HasMaxLength(450);
            entity.Property(e => e.UpdatedBy).HasMaxLength(450);
        });

        builder.Entity<Domain.Entities.SectorRules.SectorDataTemplate>(entity =>
        {
            entity.ToTable("SectorDataTemplates");
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.Code).IsUnique();
            entity.Property(e => e.Code).HasMaxLength(50).IsRequired();
            entity.Property(e => e.SegmentCode).HasMaxLength(50);
            entity.Property(e => e.DomainCode).HasMaxLength(50);
            entity.Property(e => e.LabelFr).HasMaxLength(150).IsRequired();
            entity.Property(e => e.DescriptionFr).HasMaxLength(300);
            entity.Property(e => e.CreatedBy).HasMaxLength(450);
            entity.Property(e => e.UpdatedBy).HasMaxLength(450);
        });

        builder.Entity<Domain.Entities.SectorRules.SectorDataTemplateItem>(entity =>
        {
            entity.ToTable("SectorDataTemplateItems");
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.TemplateId);
            // At most one ACTIVE row per natural key (TemplateId, ItemKind, SortOrder).
            // Inactive rows are soft-deactivated (catalog removal / admin template replacement)
            // and may share a key, hence the filtered uniqueness on IsActive.
            entity.HasIndex(e => new { e.TemplateId, e.ItemKind, e.SortOrder })
                .IsUnique()
                .HasFilter("[IsActive] = 1");
            entity.Property(e => e.ItemKind).HasMaxLength(30).IsRequired();
            entity.Property(e => e.PayloadJson).IsRequired();
            entity.Property(e => e.CreatedBy).HasMaxLength(450);
            entity.Property(e => e.UpdatedBy).HasMaxLength(450);

            // Seule FK en CASCADE du lot (cf. AddSectorRuleTables_Master).
            entity.HasOne<Domain.Entities.SectorRules.SectorDataTemplate>()
                .WithMany()
                .HasForeignKey(e => e.TemplateId)
                .HasConstraintName("FK_SectorDataTemplateItems_SectorDataTemplates")
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<Domain.Entities.SectorRules.SectorRuleSetStamp>(entity =>
        {
            entity.ToTable("SectorRuleSetStamps");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.UpdatedBy).HasMaxLength(450);
            entity.Property(e => e.CatalogContentHash).HasMaxLength(64);
        });
    }
}

/// <summary>
/// Application user with extended properties.
/// </summary>
public class ApplicationUser : IdentityUser<Guid>
{
    public string FirstName { get; set; } = null!;
    public string LastName { get; set; } = null!;
    public Guid TenantId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? LastLoginAt { get; set; }
    public bool IsActive { get; set; } = true;

    /// <summary>CRM client this portal user is bound to. Null for staff accounts.</summary>
    public Guid? PortalClientId { get; set; }

    /// <summary>SHA-256 (hex) of the one-time portal invitation token.</summary>
    public string? PortalInviteTokenHash { get; set; }

    public DateTime? PortalInviteExpiresAt { get; set; }
    public string? RefreshToken { get; set; }
    public DateTime? RefreshTokenExpiryTime { get; set; }

    /// <summary>
    /// SQL default is <see cref="ProductOnboardingStatus.Completed"/> so existing rows are not
    /// prompted. Call <see cref="ApplyNewInteractiveProductOnboarding"/> for new interactive users.
    /// </summary>
    public ProductOnboardingStatus ProductOnboardingStatus { get; set; } = ProductOnboardingStatus.Completed;

    public int ProductOnboardingVersion { get; set; } = ProductOnboardingDefaults.CatalogVersion;

    public string? ProductOnboardingChecklistJson { get; set; }

    public DateTime? ProductOnboardingUpdatedAt { get; set; }

    public ICollection<UserModuleGrant> ModuleGrants { get; set; } = new List<UserModuleGrant>();

    public void ApplyNewInteractiveProductOnboarding()
    {
        var seed = ProductOnboardingDefaults.ForNewInteractiveUser();
        ProductOnboardingStatus = seed.Status;
        ProductOnboardingVersion = seed.Version;
        ProductOnboardingChecklistJson = seed.ChecklistJson;
        ProductOnboardingUpdatedAt = seed.UpdatedAt;
    }
}

/// <summary>
/// Application role with extended properties.
/// </summary>
public class ApplicationRole : IdentityRole<Guid>
{
    public string? Description { get; set; }
}

/// <summary>
/// Stores encrypted connection strings for tenant databases.
/// </summary>
public class TenantConnectionString
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public string EncryptedConnectionString { get; set; } = null!;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
}
