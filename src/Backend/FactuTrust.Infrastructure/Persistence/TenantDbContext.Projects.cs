using FactuTrust.Domain.Entities.Projects;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Persistence;

public partial class TenantDbContext
{
    private static void ConfigureProjects(ModelBuilder builder)
    {
        builder.Entity<Project>(entity =>
        {
            entity.ToTable("Projects");
            entity.HasKey(p => p.Id);
            entity.Property(p => p.Name).HasMaxLength(200).IsRequired();
            entity.Property(p => p.Description).HasMaxLength(4000);
            entity.Property(p => p.Kind).HasConversion<int>().IsRequired();
            entity.Property(p => p.BillingMode).HasConversion<int>().IsRequired();
            entity.Property(p => p.Status).HasConversion<int>().IsRequired();
            entity.Property(p => p.BudgetHt).HasPrecision(18, 3);
            entity.Property(p => p.Currency).HasMaxLength(3).IsRequired();
            entity.Property(p => p.SiteAddress).HasMaxLength(500);
            entity.Property(p => p.ContractNumber).HasMaxLength(100);
            entity.Property(p => p.TimesheetsEnabled).IsRequired();
            entity.Property(p => p.AnalyticAccountCode).HasMaxLength(50);
            entity.Property(p => p.AllocatedHours).HasPrecision(18, 2);
            entity.HasIndex(p => p.SalesOrderId);
            entity.HasIndex(p => p.ClientId);
            entity.HasIndex(p => p.Status);
            entity.HasIndex(p => p.Kind);
            entity.Property(p => p.Version).IsConcurrencyToken();
        });

        builder.Entity<ProjectPhase>(entity =>
        {
            entity.ToTable("ProjectPhases");
            entity.HasKey(p => p.Id);
            entity.Property(p => p.Name).HasMaxLength(80).IsRequired();
            entity.Property(p => p.Color).HasMaxLength(20);
            entity.HasIndex(p => new { p.ProjectId, p.SortOrder });
        });

        builder.Entity<ProjectTask>(entity =>
        {
            entity.ToTable("ProjectTasks");
            entity.HasKey(t => t.Id);
            entity.Property(t => t.Title).HasMaxLength(300).IsRequired();
            entity.Property(t => t.Description).HasMaxLength(4000);
            entity.Property(t => t.Status).HasConversion<int>().IsRequired();
            entity.Property(t => t.Priority).HasConversion<int>().IsRequired();
            entity.Property(t => t.EstimatedHours).HasPrecision(18, 2);
            entity.Property(t => t.InvoicedBillingMethod).HasConversion<int>();
            entity.HasIndex(t => t.ProjectId);
            entity.HasIndex(t => t.PhaseId);
            entity.HasIndex(t => t.ParentTaskId);
            entity.HasIndex(t => t.AssigneeUserId);
            entity.HasIndex(t => t.InvoicedInvoiceId)
                .HasFilter("[InvoicedInvoiceId] IS NOT NULL");
        });

        builder.Entity<ProjectTaskDependency>(entity =>
        {
            entity.ToTable("ProjectTaskDependencies");
            entity.HasKey(d => d.Id);
            entity.HasIndex(d => new { d.PredecessorTaskId, d.SuccessorTaskId }).IsUnique();
        });

        builder.Entity<ProjectComment>(entity =>
        {
            entity.ToTable("ProjectComments");
            entity.HasKey(c => c.Id);
            entity.Property(c => c.Body).HasMaxLength(4000).IsRequired();
            entity.HasIndex(c => new { c.ProjectId, c.CreatedAt });
            entity.HasIndex(c => c.TaskId);
        });

        builder.Entity<ProjectAttachment>(entity =>
        {
            entity.ToTable("ProjectAttachments");
            entity.HasKey(a => a.Id);
            entity.Property(a => a.FileName).HasMaxLength(260).IsRequired();
            entity.Property(a => a.StoragePath).HasMaxLength(500).IsRequired();
            entity.Property(a => a.ContentType).HasMaxLength(200).IsRequired();
            entity.HasIndex(a => a.ProjectId);
            entity.HasIndex(a => a.TaskId);
        });

        builder.Entity<ProjectMember>(entity =>
        {
            entity.ToTable("ProjectMembers");
            entity.HasKey(m => m.Id);
            entity.Property(m => m.Role).HasConversion<int>().IsRequired();
            entity.Property(m => m.SalesRate).HasPrecision(18, 3);
            entity.Property(m => m.HourlyCost).HasPrecision(18, 3);
            entity.Property(m => m.WeeklyCapacityHours).HasPrecision(18, 2);
            entity.HasIndex(m => new { m.ProjectId, m.UserId }).IsUnique();
        });

        builder.Entity<ProjectTimeEntry>(entity =>
        {
            entity.ToTable("ProjectTimeEntries");
            entity.HasKey(t => t.Id);
            entity.Property(t => t.Hours).HasPrecision(18, 2);
            entity.Property(t => t.Notes).HasMaxLength(2000);
            entity.Property(t => t.Status).HasConversion<int>().IsRequired();
            entity.Property(t => t.EntrySource).HasConversion<int>().IsRequired();
            entity.Ignore(t => t.IsOpen);
            entity.Ignore(t => t.IsTimerRunning);
            entity.HasIndex(t => new { t.ProjectId, t.WorkDate });
            entity.HasIndex(t => t.SalesOrderLineId);
            entity.HasIndex(t => t.UserId);
            entity.HasIndex(t => t.Status);
            entity.HasIndex(t => t.InvoicedInvoiceId)
                .HasFilter("[InvoicedInvoiceId] IS NOT NULL");
        });

        builder.Entity<ProjectCostLine>(entity =>
        {
            entity.ToTable("ProjectCostLines");
            entity.HasKey(c => c.Id);
            entity.Property(c => c.Source).HasConversion<int>().IsRequired();
            entity.Property(c => c.Description).HasMaxLength(500).IsRequired();
            entity.Property(c => c.AmountHt).HasPrecision(18, 3);
            entity.HasIndex(c => c.ProjectId);
            entity.HasIndex(c => c.SourceId);
        });

        builder.Entity<ProjectActivity>(entity =>
        {
            entity.ToTable("ProjectActivities");
            entity.HasKey(a => a.Id);
            entity.Property(a => a.Type).HasMaxLength(80).IsRequired();
            entity.Property(a => a.Message).HasMaxLength(2000).IsRequired();
            entity.HasIndex(a => new { a.ProjectId, a.CreatedAt });
        });

        builder.Entity<ProjectMilestone>(entity =>
        {
            entity.ToTable("ProjectMilestones");
            entity.HasKey(m => m.Id);
            entity.Property(m => m.Name).HasMaxLength(200).IsRequired();
            entity.Property(m => m.Percent).HasPrecision(5, 2);
            entity.Property(m => m.AmountHt).HasPrecision(18, 3);
            entity.HasIndex(m => m.ProjectId);
            entity.HasIndex(m => m.InvoicedInvoiceId)
                .HasFilter("[InvoicedInvoiceId] IS NOT NULL");
            entity.HasIndex(m => m.SalesOrderLineId);
        });

        builder.Entity<ProjectSituation>(entity =>
        {
            entity.ToTable("ProjectSituations");
            entity.HasKey(s => s.Id);
            entity.Property(s => s.CumulativePercent).HasPrecision(5, 2);
            entity.Property(s => s.GrossAmountHt).HasPrecision(18, 3);
            entity.Property(s => s.RetainageAmountHt).HasPrecision(18, 3);
            entity.Property(s => s.Status).HasConversion<int>().IsRequired();
            entity.Ignore(s => s.NetAmountHt);
            entity.Ignore(s => s.VatAmount);
            entity.Ignore(s => s.TotalTtc);
            entity.HasIndex(s => new { s.ProjectId, s.Number }).IsUnique();
            entity.HasIndex(s => s.InvoiceId)
                .HasFilter("[InvoiceId] IS NOT NULL");
        });

        builder.Entity<ProjectSubcontractor>(entity =>
        {
            entity.ToTable("ProjectSubcontractors");
            entity.HasKey(s => s.Id);
            entity.Property(s => s.ContractReference).HasMaxLength(100);
            entity.Property(s => s.AmountHt).HasPrecision(18, 3);
            entity.Property(s => s.RetainagePercent).HasPrecision(5, 2);
            entity.HasIndex(s => s.ProjectId);
            entity.HasIndex(s => s.SupplierId);
        });

        builder.Entity<ProjectBilling>(entity =>
        {
            entity.ToTable("ProjectBillings");
            entity.HasKey(b => b.Id);
            entity.Property(b => b.Kind).HasConversion<int>().IsRequired();
            entity.Property(b => b.Notes).HasMaxLength(2000);
            entity.Property(b => b.AmountHt).HasPrecision(18, 3);
            entity.HasIndex(b => b.ProjectId);
            entity.HasIndex(b => b.InvoiceId);
        });

        builder.Entity<TenantTimesheetSettings>(entity =>
        {
            entity.ToTable("TenantTimesheetSettings");
            entity.HasKey(s => s.Id);
            entity.Property(s => s.EncodingMethod).HasConversion<int>().IsRequired();
            entity.Property(s => s.DefaultDailyWorkingHours).HasPrecision(18, 2);
            entity.Property(s => s.Version).IsConcurrencyToken();
        });

        builder.Entity<EmployeeBillingTimeTarget>(entity =>
        {
            entity.ToTable("EmployeeBillingTimeTargets");
            entity.HasKey(t => t.Id);
            entity.Property(t => t.TargetHours).HasPrecision(18, 2);
            entity.HasIndex(t => new { t.UserId, t.Year, t.Month }).IsUnique();
        });

        builder.Entity<TimesheetTip>(entity =>
        {
            entity.ToTable("TimesheetTips");
            entity.HasKey(t => t.Id);
            entity.Property(t => t.Text).HasMaxLength(500).IsRequired();
        });

        builder.Entity<ProjectUpdate>(entity =>
        {
            entity.ToTable("ProjectUpdates");
            entity.HasKey(u => u.Id);
            entity.Property(u => u.Status).HasConversion<int>().IsRequired();
            entity.Property(u => u.Description).HasMaxLength(8000);
            entity.HasIndex(u => u.ProjectId);
        });

        builder.Entity<TimeOffRequest>(entity =>
        {
            entity.ToTable("TimeOffRequests");
            entity.HasKey(r => r.Id);
            entity.Property(r => r.TypeName).HasMaxLength(100).IsRequired();
            entity.Property(r => r.HoursPerDay).HasPrecision(18, 2);
            entity.Property(r => r.Status).HasConversion<int>().IsRequired();
            entity.HasIndex(r => r.UserId);
        });
    }
}
