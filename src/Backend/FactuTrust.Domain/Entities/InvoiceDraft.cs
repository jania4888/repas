using System.Text.Json;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Domain.Entities;

/// <summary>
/// Represents an invoice draft for progressive saving during wizard completion.
/// Contains serialized step data that can be restored later.
/// </summary>
public sealed class InvoiceDraft : Entity
{
    /// <summary>
    /// Current wizard step (0-5).
    /// </summary>
    public int CurrentStep { get; private set; }

    /// <summary>
    /// Whether the draft has been converted to a final invoice.
    /// </summary>
    public bool IsConverted { get; private set; }

    /// <summary>
    /// The ID of the invoice created from this draft (if converted).
    /// </summary>
    public Guid? ConvertedInvoiceId { get; private set; }

    /// <summary>
    /// Invoice type (Invoice or CreditNote).
    /// </summary>
    public InvoiceType Type { get; private set; }

    /// <summary>
    /// Serialized step 1 data (metadata).
    /// </summary>
    public string? MetadataJson { get; private set; }

    /// <summary>
    /// Selected seller/company ID.
    /// </summary>
    public Guid? SellerId { get; private set; }

    /// <summary>
    /// Selected client ID (null if creating new client).
    /// </summary>
    public Guid? ClientId { get; private set; }

    /// <summary>
    /// Serialized new client data (if creating new client).
    /// </summary>
    public string? NewClientJson { get; private set; }

    /// <summary>
    /// Serialized invoice lines data.
    /// </summary>
    public string? LinesJson { get; private set; }

    /// <summary>
    /// Serialized payment and legal mentions data.
    /// </summary>
    public string? PaymentLegalJson { get; private set; }

    /// <summary>
    /// When the draft was last modified.
    /// </summary>
    public DateTime LastModifiedAt { get; private set; }

    /// <summary>
    /// When the draft expires and can be cleaned up.
    /// </summary>
    public DateTime ExpiresAt { get; private set; }

    /// <summary>
    /// Idempotency key to prevent duplicate submissions.
    /// </summary>
    public string? IdempotencyKey { get; private set; }

    /// <summary>
    /// Whether submission is in progress (for double-submit protection).
    /// </summary>
    public bool IsSubmitting { get; private set; }

    /// <summary>
    /// When submission started (for timeout detection).
    /// </summary>
    public DateTime? SubmissionStartedAt { get; private set; }

    private InvoiceDraft() { }

    /// <summary>
    /// Creates a new invoice draft.
    /// </summary>
    public static InvoiceDraft Create(InvoiceType type = InvoiceType.Standard)
    {
        return new InvoiceDraft
        {
            Id = Guid.NewGuid(),
            CurrentStep = 0,
            IsConverted = false,
            Type = type,
            LastModifiedAt = DateTime.UtcNow,
            ExpiresAt = DateTime.UtcNow.AddDays(30), // 30 days expiration
            IsSubmitting = false
        };
    }

    /// <summary>
    /// Updates the metadata step (step 1).
    /// </summary>
    public void UpdateMetadata(DraftMetadata metadata)
    {
        MetadataJson = JsonSerializer.Serialize(metadata);
        Type = metadata.Type;
        UpdateLastModified();
        if (CurrentStep < 1) CurrentStep = 0;
    }

    /// <summary>
    /// Updates the seller step (step 2).
    /// </summary>
    public void UpdateSeller(Guid sellerId)
    {
        SellerId = sellerId;
        UpdateLastModified();
        if (CurrentStep < 1) CurrentStep = 1;
    }

    /// <summary>
    /// Updates the client step (step 3).
    /// </summary>
    public void UpdateClient(Guid? clientId, DraftNewClient? newClient)
    {
        ClientId = clientId;
        NewClientJson = newClient != null ? JsonSerializer.Serialize(newClient) : null;
        UpdateLastModified();
        if (CurrentStep < 2) CurrentStep = 2;
    }

    /// <summary>
    /// Updates the lines step (step 4).
    /// </summary>
    public void UpdateLines(List<DraftInvoiceLine> lines)
    {
        LinesJson = JsonSerializer.Serialize(lines);
        UpdateLastModified();
        if (CurrentStep < 3) CurrentStep = 3;
    }

    /// <summary>
    /// Updates the payment/legal step (step 5).
    /// </summary>
    public void UpdatePaymentLegal(DraftPaymentLegal paymentLegal)
    {
        PaymentLegalJson = JsonSerializer.Serialize(paymentLegal);
        UpdateLastModified();
        if (CurrentStep < 4) CurrentStep = 4;
    }

    /// <summary>
    /// Marks the current step as complete and advances to the next.
    /// </summary>
    public void AdvanceStep()
    {
        if (CurrentStep < 5)
        {
            CurrentStep++;
            UpdateLastModified();
        }
    }

    /// <summary>
    /// Starts the submission process (for double-submit protection).
    /// </summary>
    public Result StartSubmission(string idempotencyKey)
    {
        if (IsConverted)
            return Result.Failure(Error.Conflict("Ce brouillon a déjà été converti en facture"));

        if (IsSubmitting)
        {
            // Check if submission timed out (more than 5 minutes)
            if (SubmissionStartedAt.HasValue && 
                DateTime.UtcNow - SubmissionStartedAt.Value > TimeSpan.FromMinutes(5))
            {
                // Allow retry after timeout
                IsSubmitting = false;
            }
            else
            {
                return Result.Failure(Error.Conflict("Une soumission est déjà en cours"));
            }
        }

        // Check idempotency
        if (!string.IsNullOrEmpty(IdempotencyKey) && IdempotencyKey == idempotencyKey)
        {
            return Result.Failure(Error.Conflict("Cette demande a déjà été traitée"));
        }

        IsSubmitting = true;
        SubmissionStartedAt = DateTime.UtcNow;
        IdempotencyKey = idempotencyKey;
        UpdateLastModified();

        return Result.Success();
    }

    /// <summary>
    /// Marks the draft as successfully converted to an invoice.
    /// </summary>
    public void MarkAsConverted(Guid invoiceId)
    {
        IsConverted = true;
        ConvertedInvoiceId = invoiceId;
        IsSubmitting = false;
        CurrentStep = 5;
        UpdateLastModified();
    }

    /// <summary>
    /// Cancels an ongoing submission (on error).
    /// </summary>
    public void CancelSubmission()
    {
        IsSubmitting = false;
        SubmissionStartedAt = null;
        IdempotencyKey = null;
        UpdateLastModified();
    }

    /// <summary>
    /// Gets the metadata from JSON.
    /// </summary>
    public DraftMetadata? GetMetadata()
    {
        return string.IsNullOrEmpty(MetadataJson) 
            ? null 
            : JsonSerializer.Deserialize<DraftMetadata>(MetadataJson);
    }

    /// <summary>
    /// Gets the new client data from JSON.
    /// </summary>
    public DraftNewClient? GetNewClient()
    {
        return string.IsNullOrEmpty(NewClientJson) 
            ? null 
            : JsonSerializer.Deserialize<DraftNewClient>(NewClientJson);
    }

    /// <summary>
    /// Gets the invoice lines from JSON.
    /// </summary>
    public List<DraftInvoiceLine> GetLines()
    {
        return string.IsNullOrEmpty(LinesJson) 
            ? new List<DraftInvoiceLine>() 
            : JsonSerializer.Deserialize<List<DraftInvoiceLine>>(LinesJson) ?? new();
    }

    /// <summary>
    /// Gets the payment/legal data from JSON.
    /// </summary>
    public DraftPaymentLegal? GetPaymentLegal()
    {
        return string.IsNullOrEmpty(PaymentLegalJson) 
            ? null 
            : JsonSerializer.Deserialize<DraftPaymentLegal>(PaymentLegalJson);
    }

    /// <summary>
    /// Extends the draft expiration.
    /// </summary>
    public void ExtendExpiration(int days = 30)
    {
        ExpiresAt = DateTime.UtcNow.AddDays(days);
        UpdateLastModified();
    }

    /// <summary>
    /// Checks if the draft has expired.
    /// </summary>
    public bool IsExpired => DateTime.UtcNow > ExpiresAt;

    /// <summary>
    /// Checks if all required steps are complete.
    /// </summary>
    public bool IsComplete => 
        !string.IsNullOrEmpty(MetadataJson) &&
        SellerId.HasValue &&
        (ClientId.HasValue || !string.IsNullOrEmpty(NewClientJson)) &&
        !string.IsNullOrEmpty(LinesJson) &&
        !string.IsNullOrEmpty(PaymentLegalJson);

    private void UpdateLastModified()
    {
        LastModifiedAt = DateTime.UtcNow;
    }
}

#region Draft Data Models

/// <summary>
/// Draft metadata (step 1).
/// </summary>
public sealed record DraftMetadata
{
    public InvoiceType Type { get; init; }
    public DateTime IssueDate { get; init; }
    public DateTime? DueDate { get; init; }
    public string Currency { get; init; } = "TND";
    public string? InternalReference { get; init; }
    public Guid? LinkedInvoiceId { get; init; }
    /// <summary>Optional warehouse for stock deduction when the invoice is validated.</summary>
    public Guid? WarehouseId { get; init; }
    /// <summary>Optional POS cash-register session (vacation) when the invoice is submitted from POS.</summary>
    public Guid? CashRegisterSessionId { get; init; }
}

/// <summary>
/// Draft new client data (step 3).
/// </summary>
public sealed record DraftNewClient
{
    public string Name { get; init; } = null!;
    public string TaxType { get; init; } = null!;
    public string? Nif { get; init; }
    public string Street { get; init; } = null!;
    public string? StreetLine2 { get; init; }
    public string? PostalCode { get; init; }
    public string City { get; init; } = null!;
    public string Governorate { get; init; } = null!;
    public string? Email { get; init; }
    public string? Phone { get; init; }
    public string? ContactPerson { get; init; }
}

/// <summary>
/// Draft invoice line (step 4).
/// </summary>
public sealed record DraftInvoiceLine
{
    public string? ProductId { get; init; }
    public string Designation { get; init; } = null!;
    public string? Description { get; init; }
    public decimal Quantity { get; init; }
    public string? Unit { get; init; }
    public decimal UnitPriceHT { get; init; }
    /// <summary>True when the user manually set the unit price (bypasses server price resolver on submit).</summary>
    public bool PriceOverridden { get; init; }
    public string? DiscountType { get; init; }
    public decimal? DiscountValue { get; init; }
    public int VatRate { get; init; }
    public bool FodecApplicable { get; init; }
}

/// <summary>
/// Draft payment and legal data (step 5).
/// </summary>
public sealed record DraftPaymentLegal
{
    public string PaymentMethod { get; init; } = null!;
    public string? PaymentTerms { get; init; }
    public int? DaysUntilDue { get; init; }
    public string? BankName { get; init; }
    public string? Iban { get; init; }
    public string? Rib { get; init; }
    public string? PurchaseOrderRef { get; init; }
    public string? VatMention { get; init; }
    public string? ExemptionMention { get; init; }
    public string? CustomMention { get; init; }
}

#endregion
