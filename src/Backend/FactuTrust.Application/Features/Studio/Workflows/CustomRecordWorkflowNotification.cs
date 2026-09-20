using FactuTrust.Domain.Enums;
using MediatR;

namespace FactuTrust.Application.Features.Studio.Workflows;

/// <summary>
/// Notification de cycle de vie d'un enregistrement Studio dédiée aux workflows (D5) — séparée
/// de <c>CustomRecordLifecycleNotification</c> (Pont ERP legacy, jamais modifié en 4.1).
/// Publiée après persistance par <see cref="StudioWorkflowLifecycle"/> ; le marqueur ambiant
/// <c>StudioWorkflowExecutionScope</c> fournit <see cref="OriginWorkflowInstanceId"/> et
/// <see cref="Depth"/> pour l'anti-boucle.
/// </summary>
public sealed record CustomRecordWorkflowNotification(
    Guid TenantId,
    Guid EntityDefinitionId,
    Guid RecordId,
    string DataJson,
    string? PreviousDataJson,
    StudioAutomationTrigger Trigger,
    Guid? RunBy,
    Guid? OriginWorkflowInstanceId,
    int Depth) : INotification;
