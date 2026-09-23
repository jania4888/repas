using FactuTrust.Domain.Common;
using FactuTrust.Domain.Services;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.Events;
using FactuTrust.Domain.ValueObjects;

namespace FactuTrust.Domain.Entities;

/// <summary>
/// Represents a quote (devis) - a non-binding commercial proposal.
/// A quote can be converted to an invoice once accepted by the client.
/// </summary>
public sealed class Quote : AggregateRoot
{
    public QuoteNumber Number { get; private set; } = null!;
    public DateTime IssueDate { get; private set; }
    public DateTime ExpiryDate { get; private set; }
    public QuoteStatus Status { get; private set; }
    
    public Guid ClientId { get; private set; }
    public Client Client { get; private set; } = null!;

    public string? Reference { get; private set; }
    public string? Notes { get; private set; }
    public string? TermsAndConditions { get; private set; }
    
    private readonly List<string> _legalMentions = new();
    public IReadOnlyCollection<string> LegalMentions => _legalMentions.AsReadOnly();

    private readonly List<QuoteLine> _lines = new();
    public IReadOnlyCollection<QuoteLine> Lines => _lines.AsReadOnly();

    public Money SubTotal { get; private set; } = null!;

    /// <summary>FODEC agrégé des lignes — annoncé au devis, repris tel quel à la facture.</summary>
    public Money FodecAmount { get; private set; } = null!;

    public Money TotalVat { get; private set; } = null!;

    /// <summary>
    /// Timbre fiscal annoncé sur le devis, résolu depuis le catalogue de taxes du tenant à la
    /// création. Sans lui, la facture dépassait systématiquement le devis accepté du montant
    /// du timbre.
    /// </summary>
    public Money FiscalStampAmount { get; private set; } = null!;

    public Money TotalAmount { get; private set; } = null!;

    public DateTime? SentAt { get; private set; }
    public DateTime? AcceptedAt { get; private set; }
    public DateTime? RejectedAt { get; private set; }
    public string? RejectionReason { get; private set; }
    public DateTime? CancelledAt { get; private set; }
    public string? CancellationReason { get; private set; }

    /// <summary>
    /// The invoice created from this quote (if converted).
    /// </summary>
    public Guid? ConvertedInvoiceId { get; private set; }

    /// <summary>
    /// La commande client créée depuis ce devis (s'il a été transformé en commande).
    /// Miroir de <see cref="ConvertedInvoiceId"/> : un devis ne peut donner lieu qu'à un
    /// seul document de destination, facture ou commande.
    /// </summary>
    public Guid? ConvertedSalesOrderId { get; private set; }

    /// <summary>
    /// When the quote was converted to an invoice (traçabilité).
    /// </summary>
    public DateTime? ConvertedAt { get; private set; }

    /// <summary>
    /// When this quote was dispatched from a public storefront order, tracks the originating
    /// <c>StorefrontOrder.Id</c> (persisted in the Master database). Null for internally created quotes.
    /// </summary>
    public Guid? OriginStorefrontOrderId { get; private set; }

    private Quote() { }

    /// <summary>
    /// Marks this quote as originating from a public 3D storefront order. Idempotent: once set, never changes.
    /// </summary>
    public void AttachStorefrontOrigin(Guid storefrontOrderId)
    {
        if (storefrontOrderId == Guid.Empty)
            throw new ArgumentException("StorefrontOrderId invalide", nameof(storefrontOrderId));
        if (OriginStorefrontOrderId.HasValue)
            return;
        OriginStorefrontOrderId = storefrontOrderId;
    }

    public static Result<Quote> Create(
        QuoteNumber number,
        Client client,
        DateTime issueDate,
        DateTime expiryDate,
        string? reference = null,
        string? notes = null,
        string? termsAndConditions = null)
    {
        if (expiryDate <= issueDate)
            return Result.Failure<Quote>(Error.Validation("ExpiryDate", "La date d'expiration doit être postérieure à la date d'émission"));

        // Default validity: 30 days from issue date
        if (expiryDate < issueDate.AddDays(1))
            return Result.Failure<Quote>(Error.Validation("ExpiryDate", "La validité du devis doit être d'au moins 1 jour"));

        var quote = new Quote
        {
            Number = number,
            ClientId = client.Id,
            Client = client,
            IssueDate = issueDate.Date,
            ExpiryDate = expiryDate.Date,
            Status = QuoteStatus.Draft,
            Reference = reference?.Trim(),
            Notes = notes?.Trim(),
            TermsAndConditions = termsAndConditions?.Trim(),
            SubTotal = Money.Zero(),
            FodecAmount = Money.Zero(),
            TotalVat = Money.Zero(),
            FiscalStampAmount = Money.Zero(),
            TotalAmount = Money.Zero()
        };

        quote.AddDomainEvent(new QuoteCreatedEvent(quote.Id, quote.Number.Value, client.Id));

        return Result.Success(quote);
    }

    public Result AddLine(
        Product product,
        decimal quantity,
        Money? customUnitPrice = null,
        decimal? discountPercent = null,
        decimal fodecRatePercent = QuoteLine.DefaultFodecRatePercent,
        Guid? appliedPromotionId = null,
        string? appliedPromotionName = null)
    {
        if (!Status.CanBeEdited())
            return Result.Failure(Error.Validation("Status", "Ce devis ne peut plus être modifié"));

        var sellable = ProductCommercialGuards.EnsureCanAppearOnDocument(product);
        if (sellable.IsFailure)
            return sellable;

        if (quantity <= 0)
            return Result.Failure(Error.Validation("Quantity", "La quantité doit être supérieure à zéro"));

        var unitPrice = customUnitPrice ?? product.UnitPrice;
        var lineNumber = _lines.Count + 1;

        var lineResult = QuoteLine.Create(
            this,
            lineNumber,
            product,
            quantity,
            unitPrice,
            discountPercent,
            fodecRatePercent,
            appliedPromotionId,
            appliedPromotionName);

        if (lineResult.IsFailure)
            return Result.Failure(lineResult.Error);

        _lines.Add(lineResult.Value);
        RecalculateTotals();

        return Result.Success();
    }

    public Result RemoveLine(Guid lineId)
    {
        if (!Status.CanBeEdited())
            return Result.Failure(Error.Validation("Status", "Ce devis ne peut plus être modifié"));

        var line = _lines.FirstOrDefault(l => l.Id == lineId);
        if (line is null)
            return Result.Failure(Error.NotFound("QuoteLine", lineId));

        _lines.Remove(line);
        RenumberLines();
        RecalculateTotals();

        return Result.Success();
    }

    public Result UpdateLine(Guid lineId, decimal quantity, Money? customUnitPrice = null, decimal? discountPercent = null)
    {
        if (!Status.CanBeEdited())
            return Result.Failure(Error.Validation("Status", "Ce devis ne peut plus être modifié"));

        var line = _lines.FirstOrDefault(l => l.Id == lineId);
        if (line is null)
            return Result.Failure(Error.NotFound("QuoteLine", lineId));

        var result = line.Update(quantity, customUnitPrice, discountPercent);
        if (result.IsFailure)
            return result;

        RecalculateTotals();

        return Result.Success();
    }

    /// <summary>
    /// Adds a custom quote line without product reference.
    /// </summary>
    public Result AddCustomLine(
        string designation,
        string? description,
        decimal quantity,
        string unit,
        Money unitPrice,
        VatRate vatRate,
        decimal? discountPercent = null,
        bool isFodecApplicable = false,
        decimal fodecRatePercent = QuoteLine.DefaultFodecRatePercent)
    {
        if (!Status.CanBeEdited())
            return Result.Failure(Error.Validation("Status", "Ce devis ne peut plus être modifié"));

        if (quantity <= 0)
            return Result.Failure(Error.Validation("Quantity", "La quantité doit être supérieure à zéro"));

        if (string.IsNullOrWhiteSpace(designation))
            return Result.Failure(Error.Validation("Designation", "La désignation est obligatoire"));

        var lineNumber = _lines.Count + 1;

        var lineResult = QuoteLine.CreateCustom(
            this,
            lineNumber,
            designation.Trim(),
            description?.Trim(),
            quantity,
            unit,
            unitPrice,
            vatRate,
            discountPercent,
            isFodecApplicable,
            fodecRatePercent);

        if (lineResult.IsFailure)
            return Result.Failure(lineResult.Error);

        _lines.Add(lineResult.Value);
        RecalculateTotals();

        return Result.Success();
    }

    /// <summary>
    /// Fixe le timbre fiscal annoncé sur le devis (résolu depuis le catalogue de taxes du
    /// tenant). Refusé dès que le devis n'est plus modifiable, pour ne jamais altérer un
    /// document déjà transmis au client.
    /// </summary>
    public Result SetFiscalStampAmount(Money stamp)
    {
        if (!Status.CanBeEdited())
            return Result.Failure(Error.Validation("Status", "Ce devis ne peut plus être modifié"));

        if (stamp.Currency != SubTotal.Currency)
            return Result.Failure(Error.Validation("FiscalStampAmount", "La devise du timbre ne correspond pas au devis"));

        FiscalStampAmount = stamp;
        RecalculateTotals();
        return Result.Success();
    }

    public Result Send()
    {
        if (!Status.CanBeSent())
            return Result.Failure(Error.Validation("Status", "Ce devis ne peut pas être envoyé dans son état actuel"));

        if (_lines.Count == 0)
            return Result.Failure(Error.Validation("Lines", "Le devis doit contenir au moins une ligne"));

        SentAt = DateTime.UtcNow;
        Status = QuoteStatus.Sent;

        AddDomainEvent(new QuoteSentEvent(Id, Number.Value, Client.Email?.Value ?? string.Empty));

        return Result.Success();
    }

    public Result Accept()
    {
        if (!Status.CanBeAccepted())
            return Result.Failure(Error.Validation("Status", "Ce devis ne peut pas être accepté dans son état actuel"));

        AcceptedAt = DateTime.UtcNow;
        Status = QuoteStatus.Accepted;

        AddDomainEvent(new QuoteAcceptedEvent(Id, Number.Value));

        return Result.Success();
    }

    public Result Reject(string? reason = null)
    {
        if (!Status.CanBeRejected())
            return Result.Failure(Error.Validation("Status", "Ce devis ne peut pas être refusé dans son état actuel"));

        RejectedAt = DateTime.UtcNow;
        RejectionReason = reason?.Trim();
        Status = QuoteStatus.Rejected;

        AddDomainEvent(new QuoteRejectedEvent(Id, Number.Value, reason));

        return Result.Success();
    }

    public Result Cancel(string reason)
    {
        if (!Status.CanBeCancelled())
            return Result.Failure(Error.Validation("Status", "Ce devis ne peut pas être annulé"));

        if (string.IsNullOrWhiteSpace(reason))
            return Result.Failure(Error.Validation("CancellationReason", "Le motif d'annulation est obligatoire"));

        CancelledAt = DateTime.UtcNow;
        CancellationReason = reason.Trim();
        Status = QuoteStatus.Cancelled;

        AddDomainEvent(new QuoteCancelledEvent(Id, Number.Value, reason));

        return Result.Success();
    }

    /// <summary>
    /// Marks this quote as converted to an invoice.
    /// This method should only be called during the conversion process.
    /// </summary>
    public void MarkAsConverted(Guid invoiceId)
    {
        if (Status != QuoteStatus.Accepted)
            throw new InvalidOperationException("Seuls les devis acceptés peuvent être transformés en facture");

        ConvertedInvoiceId = invoiceId;
        ConvertedAt = DateTime.UtcNow;
        Status = QuoteStatus.Converted;

        AddDomainEvent(new QuoteConvertedToInvoiceEvent(Id, Number.Value, invoiceId));
    }

    /// <summary>
    /// Marks this quote as converted to a sales order (commande client).
    /// This method should only be called during the conversion process.
    /// </summary>
    public void MarkAsConvertedToSalesOrder(Guid salesOrderId)
    {
        if (Status != QuoteStatus.Accepted)
            throw new InvalidOperationException("Seuls les devis acceptés peuvent être transformés en commande");

        ConvertedSalesOrderId = salesOrderId;
        ConvertedAt = DateTime.UtcNow;
        Status = QuoteStatus.Converted;

        AddDomainEvent(new QuoteConvertedToSalesOrderEvent(Id, Number.Value, salesOrderId));
    }

    public void UpdateNotes(string? notes, string? termsAndConditions)
    {
        if (Status.CanBeEdited())
        {
            Notes = notes?.Trim();
            TermsAndConditions = termsAndConditions?.Trim();
        }
    }

    /// <summary>
    /// Adds a legal mention to the quote.
    /// </summary>
    public void AddLegalMention(string mention)
    {
        if (!string.IsNullOrWhiteSpace(mention) && Status.CanBeEdited())
        {
            _legalMentions.Add(mention.Trim());
        }
    }

    public void CheckExpiration()
    {
        if (ExpiryDate < DateTime.UtcNow.Date && 
            Status is QuoteStatus.Sent or QuoteStatus.Draft)
        {
            Status = QuoteStatus.Expired;
            AddDomainEvent(new QuoteExpiredEvent(Id, Number.Value, ExpiryDate));
        }
    }

    public void ExtendValidity(DateTime newExpiryDate)
    {
        if (!Status.CanBeEdited())
            throw new InvalidOperationException("Ce devis ne peut plus être modifié");

        if (newExpiryDate <= IssueDate)
            throw new ArgumentException("La date d'expiration doit être postérieure à la date d'émission", nameof(newExpiryDate));

        ExpiryDate = newExpiryDate.Date;
    }

    /// <summary>
    /// Même formule que <c>Invoice.RecalculateTotals()</c> :
    /// TTC = HT + FODEC + TVA + timbre fiscal.
    /// </summary>

    /// <summary>
    /// Remise de pied de document, en pourcentage de la base HT. Exclusive du montant fixe.
    /// </summary>
    public decimal? GlobalDiscountPercent { get; private set; }

    /// <summary>
    /// Remise de pied effectivement appliquée, en montant. Renseignée dans les deux cas : saisie
    /// directe, ou dérivée du pourcentage. C'est ce montant qui figure au pied du document.
    /// </summary>
    public Money GlobalDiscountAmount { get; private set; } = Money.Zero();

    /// <summary>Total HT AVANT remise de pied — le « sous-total » affiché au-dessus de la remise.</summary>
    public Money SubTotalBeforeGlobalDiscount => SubTotal.Add(GlobalDiscountAmount);

    /// <summary>
    /// Pose (ou retire) la remise de pied. Elle est répartie sur les lignes au prorata de leur
    /// base HT, de sorte que le FODEC et la TVA portent sur ce qui est réellement facturé.
    ///
    /// Un seul mode à la fois : passer un pourcentage écrase un montant, et inversement. Les
    /// deux à la fois est refusé plutôt que départagé en silence.
    /// </summary>
    public Result SetGlobalDiscount(decimal? percent, Money? amount)
    {
        if (percent.HasValue && amount is { Amount: > 0 })
        {
            return Result.Failure(Error.Validation("GlobalDiscount",
                "Choisissez un pourcentage OU un montant de remise, pas les deux"));
        }

        if (percent is < 0 or > 100)
            return Result.Failure(Error.Validation("GlobalDiscountPercent", "La remise doit être comprise entre 0 % et 100 %"));

        if (amount is { Amount: < 0 })
            return Result.Failure(Error.Validation("GlobalDiscountAmount", "La remise ne peut pas être négative"));

        GlobalDiscountPercent = percent is > 0 ? percent : null;

        // Le montant demandé est stocké dans GlobalDiscountAmount, qui EST persisté : au
        // rechargement du document, la remise se rejoue donc à l'identique. Un champ privé non
        // persisté aurait été effacé au premier recalcul après relecture.
        GlobalDiscountAmount = amount is { Amount: > 0 } ? amount : Money.Zero();

        RecalculateTotals();
        return Result.Success();
    }

    /// <summary>
    /// Répartit la remise de pied sur les lignes. Rejouée à chaque recalcul : ajouter une ligne
    /// change la base, donc les parts. Sans remise, chaque ligne reçoit zéro et se calcule
    /// exactement comme avant la tranche 5B.
    /// </summary>
    private void ApplyGlobalDiscountToLines()
    {
        if (_lines.Count == 0)
        {
            GlobalDiscountAmount = Money.Zero();
            return;
        }

        var currency = _lines[0].SubTotal.Currency;
        var bases = _lines.Select(l => l.SubTotalBeforeGlobalDiscount.Amount).ToList();
        var totalBase = bases.Sum();

        var requested = GlobalDiscountPercent.HasValue
            ? GlobalDiscountAllocator.FromPercent(totalBase, GlobalDiscountPercent.Value)
            : GlobalDiscountAmount.Amount;

        var parts = GlobalDiscountAllocator.Allocate(bases, requested);

        for (var i = 0; i < _lines.Count; i++)
            _lines[i].SetAllocatedGlobalDiscount(Money.Create(parts[i], currency));

        GlobalDiscountAmount = Money.Create(parts.Sum(), currency);
    }

    private void RecalculateTotals()
    {
        ApplyGlobalDiscountToLines();

        var currency = Money.DefaultCurrency;

        SubTotal = _lines.Aggregate(
            Money.Zero(currency),
            (sum, line) => sum.Add(line.SubTotal));

        FodecAmount = _lines.Aggregate(
            Money.Zero(currency),
            (sum, line) => sum.Add(line.FodecAmount));

        TotalVat = _lines.Aggregate(
            Money.Zero(currency),
            (sum, line) => sum.Add(line.VatAmount));

        var stamp = FiscalStampAmount.Currency == currency
            ? FiscalStampAmount.Amount
            : 0m;

        TotalAmount = Money.FromSignedAmount(
            SubTotal.Amount + FodecAmount.Amount + TotalVat.Amount + stamp,
            currency);
    }

    private void RenumberLines()
    {
        for (int i = 0; i < _lines.Count; i++)
        {
            _lines[i].SetLineNumber(i + 1);
        }
    }

    public Dictionary<VatRate, Money> GetVatBreakdown()
    {
        return _lines
            .GroupBy(l => l.VatRate)
            .ToDictionary(
                g => g.Key,
                g => g.Aggregate(Money.Zero(), (sum, line) => sum.Add(line.VatAmount)));
    }
}
