namespace FactuTrust.Domain.Enums;

/// <summary>
/// Type of an in-app user notification (extensible beyond the firm-assignment flow).
/// </summary>
public enum NotificationType
{
    FirmAssignmentRequested = 0,
    FirmAssignmentAccepted = 1,
    FirmAssignmentRejected = 2,
    FirmAssignmentRevoked = 3,
    FirmAssignmentCancelled = 4,
    ExchangeMessageReceived = 5,
    ExchangeRequestCreated = 6,
    ExchangeRequestStatusChanged = 7,
    ExchangeTaskAssigned = 8,
    ExchangeThreadClosed = 9,
    ExchangeRequestCommented = 10,
    ExchangeDocumentShared = 11,
    ExchangeTaskCreated = 12,
    FirmLeaveRequestSubmitted = 13,
    FirmTimeSheetSubmitted = 14,
    StudioWorkflowApprovalRequested = 15,
    StudioWorkflowApprovalDecided = 16,
    StudioWorkflowStepFailed = 17,
    StudioWorkflowMessage = 18
}
