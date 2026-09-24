namespace FactuTrust.Domain.Enums;

/// <summary>Who authored a company-support message.</summary>
public enum CompanySupportAuthorSide
{
    Company = 0,
    Platform = 1
}

/// <summary>
/// Question, proposal or complaint from the company. Platform replies are always <see cref="Reply"/>.
/// </summary>
public enum CompanySupportCategory
{
    Question = 0,
    Proposal = 1,
    Complaint = 2,
    Reply = 3
}
