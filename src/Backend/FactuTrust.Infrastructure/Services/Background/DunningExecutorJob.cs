using System.Text.Json;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Billing;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Services.Billing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace FactuTrust.Infrastructure.Services.Background;

/// <summary>
/// Lot C6 — Job Hangfire quotidien : avance les états dunning selon la campagne active.
///
/// Algorithme :
/// <list type="number">
///   <item>Récupère la campagne active (ou crée la campagne par défaut si absente).</item>
///   <item>Pour chaque facture <c>Issued/Overdue</c> dont <c>DueDate &lt; UtcNow</c> et sans
///         <c>DunningState</c>, crée un nouveau cycle.</item>
///   <item>Pour chaque <c>DunningState.Outcome=Active</c> dont <c>NextActionAt &lt;= UtcNow</c>,
///         exécute l'action de l'étape courante (envoi e-mail, marquer PastDue, suspendre)
///         et programme la prochaine étape.</item>
///   <item>Si la facture est passée à <c>Paid</c>, marque le state en <c>Paid</c>.</item>
/// </list>
///
/// Programmé à 05h UTC chaque jour.
/// </summary>
public sealed class DunningExecutorJob
{
    private readonly MasterDbContext _db;
    private readonly IDunningCampaignService _campaignService;
    private readonly IEmailService _emailService;
    private readonly ILogger<DunningExecutorJob> _logger;

    public DunningExecutorJob(
        MasterDbContext db,
        IDunningCampaignService campaignService,
        IEmailService emailService,
        ILogger<DunningExecutorJob> logger)
    {
        _db = db;
        _campaignService = campaignService;
        _emailService = emailService;
        _logger = logger;
    }

    public async Task ExecuteAsync(CancellationToken cancellationToken = default)
    {
        await _campaignService.EnsureDefaultExistsAsync(cancellationToken);

        var campaign = await _db.DunningCampaigns
            .FirstOrDefaultAsync(c => c.IsActive, cancellationToken);
        if (campaign is null)
        {
            _logger.LogWarning("DunningExecutorJob: no active campaign — skipping");
            return;
        }

        var steps = DunningCampaignService.ParseSteps(campaign.StepsJson);
        if (steps.Count == 0)
        {
            _logger.LogWarning("DunningExecutorJob: campaign has no steps — skipping");
            return;
        }

        // Étape 1 : créer les nouveaux cycles pour les factures impayées sans état.
        var createdCycles = await CreateCyclesForOverdueInvoicesAsync(campaign, steps, cancellationToken);

        // Étape 2 : avancer les états actifs.
        var (executed, paid, suspended) = await AdvanceActiveStatesAsync(steps, cancellationToken);

        _logger.LogInformation(
            "DunningExecutorJob: created {Created}, executed {Executed} steps, marked {Paid} paid, {Suspended} suspended",
            createdCycles, executed, paid, suspended);
    }

    private async Task<int> CreateCyclesForOverdueInvoicesAsync(
        DunningCampaign campaign,
        List<DunningStep> steps,
        CancellationToken cancellationToken)
    {
        var nowUtc = DateTime.UtcNow;
        var firstStep = steps[0];
        var firstActionDate = nowUtc.Date.AddDays(firstStep.DaysAfterDueDate);

        // Factures impayées (Issued ou PartiallyPaid) avec DueDate < UtcNow et sans DunningState actif.
        var overdueInvoices = await _db.PlatformInvoices.AsNoTracking()
            .Where(i => i.DueDate.HasValue
                && i.DueDate.Value < nowUtc
                && (i.Status == PlatformInvoiceStatus.Issued
                    || i.Status == PlatformInvoiceStatus.PartiallyPaid
                    || i.Status == PlatformInvoiceStatus.Overdue)
                && i.BillingType == PlatformInvoiceBillingType.Subscription)
            .ToListAsync(cancellationToken);

        var existingStates = await _db.DunningStates.AsNoTracking()
            .Where(s => s.Outcome == DunningOutcome.Active)
            .Select(s => s.RelatedInvoiceId)
            .Where(id => id.HasValue)
            .Select(id => id!.Value)
            .ToListAsync(cancellationToken);
        var existingSet = new HashSet<Guid>(existingStates);

        var created = 0;
        foreach (var invoice in overdueInvoices)
        {
            if (existingSet.Contains(invoice.Id)) continue;

            var subscription = await _db.Subscriptions.AsNoTracking()
                .FirstOrDefaultAsync(s => s.TenantId == invoice.TenantId, cancellationToken);
            if (subscription is null) continue;

            var state = DunningState.Start(
                subscriptionId: subscription.Id,
                tenantId: invoice.TenantId,
                campaignId: campaign.Id,
                dueDate: invoice.DueDate!.Value,
                relatedInvoiceId: invoice.Id,
                firstActionAt: invoice.DueDate.Value.AddDays(firstStep.DaysAfterDueDate));
            _db.DunningStates.Add(state);
            created++;
        }
        if (created > 0) await _db.SaveChangesAsync(cancellationToken);
        return created;
    }

    private async Task<(int Executed, int Paid, int Suspended)> AdvanceActiveStatesAsync(
        List<DunningStep> steps,
        CancellationToken cancellationToken)
    {
        var nowUtc = DateTime.UtcNow;
        var dueStates = await _db.DunningStates
            .Where(s => s.Outcome == DunningOutcome.Active && s.NextActionAt <= nowUtc)
            .OrderBy(s => s.NextActionAt)
            .Take(500) // sécurité : on borne par exécution
            .ToListAsync(cancellationToken);

        if (dueStates.Count == 0) return (0, 0, 0);

        var executed = 0;
        var paid = 0;
        var suspended = 0;

        foreach (var state in dueStates)
        {
            cancellationToken.ThrowIfCancellationRequested();

            // 1. Vérifie d'abord si la facture associée est désormais payée → arrête le cycle.
            if (state.RelatedInvoiceId.HasValue)
            {
                var invoice = await _db.PlatformInvoices.AsNoTracking()
                    .Where(i => i.Id == state.RelatedInvoiceId.Value)
                    .Select(i => new { i.Status })
                    .FirstOrDefaultAsync(cancellationToken);
                if (invoice?.Status == PlatformInvoiceStatus.Paid
                    || invoice?.Status == PlatformInvoiceStatus.Cancelled
                    || invoice?.Status == PlatformInvoiceStatus.Refunded)
                {
                    state.MarkPaid();
                    paid++;
                    continue;
                }
            }

            // 2. Étape hors-bornes → fin de campagne (giveup).
            if (state.CurrentStepIndex >= steps.Count)
            {
                state.MarkGiveUp("Toutes les étapes exécutées sans paiement.");
                continue;
            }

            var currentStep = steps[state.CurrentStepIndex];
            try
            {
                await ExecuteStepAsync(state, currentStep, cancellationToken);
                executed++;

                if (currentStep.Action == DunningStepAction.SuspendSubscription)
                {
                    state.MarkSuspended();
                    suspended++;
                    continue;
                }

                // Programme la prochaine étape (si elle existe).
                var nextIndex = state.CurrentStepIndex + 1;
                if (nextIndex >= steps.Count)
                {
                    state.MarkGiveUp("Dernière étape atteinte sans paiement.");
                }
                else
                {
                    var nextStep = steps[nextIndex];
                    var nextActionAt = state.DueDate.AddDays(nextStep.DaysAfterDueDate);
                    state.AdvanceTo(nextIndex, nextActionAt);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "DunningExecutor: step failed for state {Id}", state.Id);
                state.RecordError(ex.Message);
                // On laisse NextActionAt inchangé → réessaiera demain.
            }
        }

        await _db.SaveChangesAsync(cancellationToken);
        return (executed, paid, suspended);
    }

    private async Task ExecuteStepAsync(DunningState state, DunningStep step, CancellationToken cancellationToken)
    {
        switch (step.Action)
        {
            case DunningStepAction.SendEmail:
                if (!string.IsNullOrWhiteSpace(step.EmailTemplateCode))
                {
                    var tenant = await _db.Tenants.AsNoTracking()
                        .Where(t => t.Id == state.TenantId)
                        .Select(t => new { t.CompanyName, EmailValue = t.Email != null ? t.Email.Value : null })
                        .FirstOrDefaultAsync(cancellationToken);
                    if (tenant is not null && !string.IsNullOrWhiteSpace(tenant.EmailValue))
                    {
                        var variables = new Dictionary<string, object?>
                        {
                            ["tenantName"] = tenant.CompanyName,
                            ["dueDate"] = state.DueDate.ToString("dd/MM/yyyy"),
                            ["stepLabel"] = step.Label
                        };
                        // Invoque IEmailService — on ne casse pas le flux si l'envoi échoue.
                        try
                        {
                            await _emailService.EnqueueTemplatedAsync(
                                toEmail: tenant.EmailValue,
                                toName: tenant.CompanyName,
                                templateCode: step.EmailTemplateCode!,
                                model: variables,
                                relatedTenantId: state.TenantId,
                                cancellationToken: cancellationToken);
                            state.RecordEmailSent();
                        }
                        catch (Exception ex)
                        {
                            _logger.LogWarning(ex, "Dunning email enqueue failed for tenant {Tenant}", state.TenantId);
                            state.RecordError($"Email enqueue failed: {ex.Message}");
                        }
                    }
                }
                break;

            case DunningStepAction.MarkPastDue:
                {
                    var subscription = await _db.Subscriptions
                        .FirstOrDefaultAsync(s => s.Id == state.SubscriptionId, cancellationToken);
                    if (subscription is not null && subscription.Status != SubscriptionStatus.PastDue)
                    {
                        var result = subscription.MarkPastDue();
                        if (result.IsFailure)
                            state.RecordError($"MarkPastDue failed: {result.Error.Description}");
                    }
                }
                break;

            case DunningStepAction.SuspendSubscription:
                {
                    var subscription = await _db.Subscriptions
                        .FirstOrDefaultAsync(s => s.Id == state.SubscriptionId, cancellationToken);
                    if (subscription is not null && subscription.Status != SubscriptionStatus.Suspended)
                    {
                        var result = subscription.Suspend("Suspension automatique — paiement non reçu après dunning.");
                        if (result.IsFailure)
                            state.RecordError($"Suspend failed: {result.Error.Description}");
                    }
                }
                break;
        }
    }
}
