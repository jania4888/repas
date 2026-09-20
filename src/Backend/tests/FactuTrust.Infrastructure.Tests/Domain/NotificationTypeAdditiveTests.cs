using FactuTrust.Domain.Enums;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Domain;

public sealed class NotificationTypeAdditiveTests
{
    [Fact]
    public void Studio_workflow_notification_types_are_appended_after_14()
    {
        Assert.Equal(15, (int)NotificationType.StudioWorkflowApprovalRequested);
        Assert.Equal(16, (int)NotificationType.StudioWorkflowApprovalDecided);
        Assert.Equal(17, (int)NotificationType.StudioWorkflowStepFailed);
        Assert.Equal(18, (int)NotificationType.StudioWorkflowMessage);
    }

    [Fact]
    public void Existing_values_zero_to_fourteen_are_unchanged()
    {
        Assert.Equal(0, (int)NotificationType.FirmAssignmentRequested);
        Assert.Equal(1, (int)NotificationType.FirmAssignmentAccepted);
        Assert.Equal(2, (int)NotificationType.FirmAssignmentRejected);
        Assert.Equal(3, (int)NotificationType.FirmAssignmentRevoked);
        Assert.Equal(4, (int)NotificationType.FirmAssignmentCancelled);
        Assert.Equal(5, (int)NotificationType.ExchangeMessageReceived);
        Assert.Equal(6, (int)NotificationType.ExchangeRequestCreated);
        Assert.Equal(7, (int)NotificationType.ExchangeRequestStatusChanged);
        Assert.Equal(8, (int)NotificationType.ExchangeTaskAssigned);
        Assert.Equal(9, (int)NotificationType.ExchangeThreadClosed);
        Assert.Equal(10, (int)NotificationType.ExchangeRequestCommented);
        Assert.Equal(11, (int)NotificationType.ExchangeDocumentShared);
        Assert.Equal(12, (int)NotificationType.ExchangeTaskCreated);
        Assert.Equal(13, (int)NotificationType.FirmLeaveRequestSubmitted);
        Assert.Equal(14, (int)NotificationType.FirmTimeSheetSubmitted);
    }
}
