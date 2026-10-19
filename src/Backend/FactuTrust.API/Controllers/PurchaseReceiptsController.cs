using FactuTrust.API.Authorization;
using FactuTrust.Application.Common.Files;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.PurchaseReceipts.Commands;
using FactuTrust.Application.Features.PurchaseReceipts.Queries;
using FactuTrust.Application.Features.SupplierInvoices.Services;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using AuditActions = FactuTrust.Domain.Entities.AuditActions;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FactuTrust.API.Controllers;

/// <summary>
/// Controller for managing purchase receipts (bons de réception d'achat).
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class PurchaseReceiptsController : ControllerBase
{
    private const long MaxUploadBytes = 10 * 1024 * 1024;

    private readonly IMediator _mediator;
    private readonly IPurchaseReceiptRepository _purchaseReceiptRepository;
    private readonly IAuditService _auditService;
    private readonly ICurrentUser _currentUser;
    private readonly IConfiguration _configuration;
    private readonly IWebHostEnvironment _environment;
    private readonly ILogger<PurchaseReceiptsController> _logger;

    public PurchaseReceiptsController(
        IMediator mediator,
        IPurchaseReceiptRepository purchaseReceiptRepository,
        IAuditService auditService,
        ICurrentUser currentUser,
        IConfiguration configuration,
        IWebHostEnvironment environment,
        ILogger<PurchaseReceiptsController> logger)
    {
        _mediator = mediator;
        _purchaseReceiptRepository = purchaseReceiptRepository;
        _auditService = auditService;
        _currentUser = currentUser;
        _configuration = configuration;
        _environment = environment;
        _logger = logger;
    }

    /// <summary>
    /// Get paginated list of purchase receipts with optional search and filters.
    /// </summary>
    [HttpGet]
    [Authorize(Policy = PermissionPolicies.PurchaseReceiptsRead)]
    [ProducesResponseType(typeof(ApiResponse<PagedResult<PurchaseReceiptListDto>>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetPurchaseReceipts(
        [FromQuery] string? search,
        [FromQuery] PurchaseReceiptStatus? status,
        [FromQuery] Guid? supplierId,
        [FromQuery] Guid? purchaseOrderId,
        [FromQuery] DateTime? fromDate,
        [FromQuery] DateTime? toDate,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20,
        CancellationToken cancellationToken = default)
    {
        var query = new GetPurchaseReceiptsQuery(
            search, status, supplierId, purchaseOrderId, fromDate, toDate, page, pageSize);
        var result = await _mediator.Send(query, cancellationToken);
        return Ok(ApiResponse<PagedResult<PurchaseReceiptListDto>>.Ok(result));
    }

    /// <summary>
    /// Get aggregated totals for the purchase receipt list (entire filtered set).
    /// </summary>
    [HttpGet("summary")]
    [Authorize(Policy = PermissionPolicies.PurchaseReceiptsRead)]
    [ProducesResponseType(typeof(ApiResponse<PurchaseReceiptListSummaryDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetPurchaseReceiptsSummary(
        [FromQuery] string? search,
        [FromQuery] PurchaseReceiptStatus? status,
        [FromQuery] Guid? supplierId,
        [FromQuery] Guid? purchaseOrderId,
        [FromQuery] DateTime? fromDate,
        [FromQuery] DateTime? toDate,
        CancellationToken cancellationToken = default)
    {
        var query = new GetPurchaseReceiptsSummaryQuery(
            search, status, supplierId, purchaseOrderId, fromDate, toDate);
        var result = await _mediator.Send(query, cancellationToken);
        return Ok(ApiResponse<PurchaseReceiptListSummaryDto>.Ok(result));
    }

    /// <summary>
    /// Prefill a purchase receipt from a purchase order (pending quantities).
    /// </summary>
    [HttpGet("prefill-from-po/{purchaseOrderId:guid}")]
    [Authorize(Policy = PermissionPolicies.PurchaseReceiptsCreate)]
    [ProducesResponseType(typeof(ApiResponse<PurchaseReceiptPrefillDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> PrefillFromPurchaseOrder(
        Guid purchaseOrderId,
        CancellationToken cancellationToken)
    {
        var result = await _mediator.Send(
            new GetPurchaseReceiptPrefillFromPOQuery(purchaseOrderId),
            cancellationToken);

        if (result.IsFailure)
            return MapFailure(result.Error);

        return Ok(ApiResponse<PurchaseReceiptPrefillDto>.Ok(result.Value));
    }

    /// <summary>
    /// Get purchase receipt details by ID.
    /// </summary>
    [HttpGet("{id:guid}")]
    [Authorize(Policy = PermissionPolicies.PurchaseReceiptsRead)]
    [ProducesResponseType(typeof(ApiResponse<PurchaseReceiptDetailDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetPurchaseReceipt(Guid id, CancellationToken cancellationToken)
    {
        var result = await _mediator.Send(new GetPurchaseReceiptByIdQuery(id), cancellationToken);

        if (result.IsFailure)
            return NotFound(ApiResponse<PurchaseReceiptDetailDto>.Fail(result.Error.Description));

        return Ok(ApiResponse<PurchaseReceiptDetailDto>.Ok(result.Value));
    }

    /// <summary>
    /// Export purchase receipt as PDF.
    /// </summary>
    [HttpGet("{id:guid}/pdf")]
    [Authorize(Policy = PermissionPolicies.PurchaseReceiptsRead)]
    [ProducesResponseType(typeof(FileContentResult), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> ExportPdf(Guid id, CancellationToken cancellationToken)
    {
        var result = await _mediator.Send(new ExportPurchaseReceiptPdfQuery(id), cancellationToken);
        if (result.IsFailure)
            return MapFailure(result.Error);

        return File(result.Value.Content, result.Value.ContentType, result.Value.FileName);
    }

    /// <summary>
    /// Create a new purchase receipt.
    /// </summary>
    [HttpPost]
    [Authorize(Policy = PermissionPolicies.PurchaseReceiptsCreate)]
    [ProducesResponseType(typeof(ApiResponse<Guid>), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> CreatePurchaseReceipt(
        [FromBody] CreatePurchaseReceiptDto dto,
        CancellationToken cancellationToken)
    {
        var result = await _mediator.Send(new CreatePurchaseReceiptCommand(dto), cancellationToken);

        if (result.IsFailure)
            return BadRequest(ApiResponse<Guid>.Fail(result.Error.Description));

        _logger.LogInformation("Purchase receipt created with ID {PurchaseReceiptId}", result.Value);

        return CreatedAtAction(
            nameof(GetPurchaseReceipt),
            new { id = result.Value },
            ApiResponse<Guid>.Ok(result.Value, "Bon de réception créé avec succès."));
    }

    /// <summary>
    /// Update a draft purchase receipt.
    /// </summary>
    [HttpPut("{id:guid}")]
    [Authorize(Policy = PermissionPolicies.PurchaseReceiptsUpdate)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> UpdatePurchaseReceipt(
        Guid id,
        [FromBody] UpdatePurchaseReceiptDto dto,
        CancellationToken cancellationToken)
    {
        var result = await _mediator.Send(new UpdatePurchaseReceiptCommand(id, dto), cancellationToken);

        if (result.IsFailure)
            return MapFailure(result.Error);

        return Ok(ApiResponse<object>.Ok(null!, "Bon de réception mis à jour."));
    }

    /// <summary>
    /// Prefill data for creating a supplier invoice from a validated purchase receipt.
    /// </summary>
    [HttpGet("{id:guid}/supplier-invoice-prefill")]
    [Authorize(Policy = PermissionPolicies.SupplierInvoicesCreate)]
    [ProducesResponseType(typeof(ApiResponse<SupplierInvoicePrefillDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetSupplierInvoicePrefill(Guid id, CancellationToken cancellationToken)
    {
        var result = await _mediator.Send(
            new GetSupplierInvoicePrefillFromPurchaseReceiptQuery(id),
            cancellationToken);

        if (result.IsFailure)
            return MapFailure(result.Error);

        return Ok(ApiResponse<SupplierInvoicePrefillDto>.Ok(result.Value));
    }

    /// <summary>
    /// Create a supplier invoice from a validated purchase receipt.
    /// </summary>
    [HttpPost("{id:guid}/create-supplier-invoice")]
    [Authorize(Policy = PermissionPolicies.SupplierInvoicesCreate)]
    [ProducesResponseType(typeof(ApiResponse<SupplierInvoiceCreationResponse>), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<IActionResult> CreateSupplierInvoice(
        Guid id,
        [FromBody] CreateSupplierInvoiceFromReceiptRequest request,
        CancellationToken cancellationToken)
    {
        var command = new CreateSupplierInvoiceFromPurchaseReceiptCommand(
            id,
            request.InvoiceNumber,
            request.InvoiceDate,
            request.PaymentTermDays,
            request.ExternalReference,
            request.Notes,
            request.SendEmail ?? false,
            request.Lines,
            request.LineAssetClassifications,
            request.PaymentMethod,
            request.UseSuggestedNumber ?? false);

        var result = await _mediator.Send(command, cancellationToken);

        if (result.IsFailure)
            return MapFailure(result.Error);

        var payload = new SupplierInvoiceCreationResponse(result.Value.Id, result.Value.InvoiceNumber);
        _logger.LogInformation(
            "Supplier invoice created from PR {PurchaseReceiptId}: {InvoiceId} ({InvoiceNumber})",
            id, payload.Id, payload.InvoiceNumber);

        return CreatedAtAction(
            "GetSupplierInvoice",
            "SupplierInvoices",
            new { id = payload.Id },
            ApiResponse<SupplierInvoiceCreationResponse>.Ok(payload, "Facture fournisseur créée avec succès"));
    }

    /// <summary>
    /// Validate a draft purchase receipt (stock + PO imputation).
    /// </summary>
    [HttpPatch("{id:guid}/validate")]
    [Authorize(Policy = PermissionPolicies.PurchaseReceiptsUpdate)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> ValidatePurchaseReceipt(Guid id, CancellationToken cancellationToken)
    {
        var result = await _mediator.Send(new ValidatePurchaseReceiptCommand(id), cancellationToken);

        if (result.IsFailure)
            return MapFailure(result.Error);

        return Ok(ApiResponse<object>.Ok(null!, "Bon de réception validé."));
    }

    [HttpPost("{id:guid}/validate")]
    [Authorize(Policy = PermissionPolicies.PurchaseReceiptsUpdate)]
    public async Task<IActionResult> ValidatePurchaseReceiptWithAllocations(
        Guid id,
        [FromBody] IReadOnlyList<PurchaseReceiptLineAllocationsDto>? lineAllocations,
        CancellationToken cancellationToken)
    {
        var result = await _mediator.Send(new ValidatePurchaseReceiptCommand(id, lineAllocations), cancellationToken);

        if (result.IsFailure)
            return MapFailure(result.Error);

        return Ok(ApiResponse<object>.Ok(null!, "Bon de réception validé."));
    }

    /// <summary>
    /// Cancel a purchase receipt (reverses stock/PO if previously validated).
    /// </summary>
    [HttpPatch("{id:guid}/cancel")]
    [Authorize(Policy = PermissionPolicies.PurchaseReceiptsUpdate)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> CancelPurchaseReceipt(
        Guid id,
        [FromBody] CancelPurchaseReceiptRequest request,
        CancellationToken cancellationToken)
    {
        var result = await _mediator.Send(
            new CancelPurchaseReceiptCommand(id, request.Reason),
            cancellationToken);

        if (result.IsFailure)
            return MapFailure(result.Error);

        return Ok(ApiResponse<object>.Ok(null!, "Bon de réception annulé."));
    }

    /// <summary>
    /// Delete a draft purchase receipt.
    /// </summary>
    [HttpDelete("{id:guid}")]
    [Authorize(Policy = PermissionPolicies.PurchaseReceiptsDelete)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> DeletePurchaseReceipt(Guid id, CancellationToken cancellationToken)
    {
        var result = await _mediator.Send(new DeletePurchaseReceiptCommand(id), cancellationToken);

        if (result.IsFailure)
            return MapFailure(result.Error);

        _logger.LogInformation("Purchase receipt {PurchaseReceiptId} deleted", id);

        return Ok(ApiResponse<object>.Ok(null!, "Bon de réception supprimé."));
    }

    /// <summary>
    /// List attachments for a purchase receipt.
    /// </summary>
    [HttpGet("{id:guid}/attachments")]
    [Authorize(Policy = PermissionPolicies.PurchaseReceiptsRead)]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<PurchaseReceiptAttachmentDto>>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> ListAttachments(Guid id, CancellationToken cancellationToken)
    {
        var receipt = await _purchaseReceiptRepository.GetByIdWithDetailsAsync(id, cancellationToken);
        if (receipt is null)
            return NotFound(ApiResponse<object>.Fail("Bon de réception introuvable."));

        var items = receipt.Attachments
            .OrderByDescending(a => a.UploadedAt)
            .Select(a => new PurchaseReceiptAttachmentDto
            {
                Id = a.Id,
                FileName = a.FileName,
                ContentType = a.ContentType,
                SizeBytes = a.SizeBytes,
                UploadedAt = a.UploadedAt,
                UploadedBy = a.UploadedBy
            })
            .ToList();

        return Ok(ApiResponse<IReadOnlyList<PurchaseReceiptAttachmentDto>>.Ok(items));
    }

    /// <summary>
    /// Upload an attachment (PDF, JPG, PNG — max 10 Mo).
    /// </summary>
    [HttpPost("{id:guid}/attachments")]
    [Authorize(Policy = PermissionPolicies.PurchaseReceiptsUpdate)]
    [RequestSizeLimit(MaxUploadBytes + 512_000)]
    [ProducesResponseType(typeof(ApiResponse<Guid>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> UploadAttachment(
        Guid id,
        [FromForm] IFormFile file,
        CancellationToken cancellationToken)
    {
        if (file is null || file.Length == 0)
            return BadRequest(ApiResponse<Guid>.Fail("Fichier requis."));

        if (file.Length > MaxUploadBytes)
            return BadRequest(ApiResponse<Guid>.Fail("La taille maximale est de 10 Mo."));

        var receipt = await _purchaseReceiptRepository.GetByIdWithDetailsAsync(id, cancellationToken);
        if (receipt is null)
            return NotFound(ApiResponse<Guid>.Fail("Bon de réception introuvable."));

        UploadValidator.ValidationResult validation;
        await using (var headerStream = file.OpenReadStream())
        {
            var (header, bytesRead) = await UploadValidator.ReadHeaderAsync(
                headerStream, UploadValidator.RequiredHeaderBytes, cancellationToken);
            validation = UploadValidator.Validate(
                file.FileName, file.ContentType, file.Length, header.AsMemory(0, bytesRead), MaxUploadBytes);
        }

        if (!validation.IsValid)
            return BadRequest(ApiResponse<Guid>.Fail(validation.ErrorMessage!));

        var safeFileName = validation.SafeFileName!;
        var relativePath = Path.Combine(
            "purchase-receipts",
            id.ToString("N"),
            $"{Guid.NewGuid():N}_{safeFileName}").Replace('\\', '/');

        var basePath = _configuration["AccountingAttachments:BasePath"]
            ?? Path.Combine(_environment.ContentRootPath ?? AppContext.BaseDirectory, "App_Data", "attachments");
        var fullPath = Path.GetFullPath(Path.Combine(basePath, relativePath));
        Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);

        await using (var stream = file.OpenReadStream())
        await using (var fs = System.IO.File.Create(fullPath))
        {
            await stream.CopyToAsync(fs, cancellationToken);
        }

        var createResult = PurchaseReceiptAttachment.Create(
            receipt,
            safeFileName,
            file.ContentType,
            file.Length,
            relativePath,
            _currentUser.Email ?? _currentUser.UserId?.ToString());

        if (createResult.IsFailure)
        {
            if (System.IO.File.Exists(fullPath))
                System.IO.File.Delete(fullPath);
            return BadRequest(ApiResponse<Guid>.Fail(createResult.Error.Description));
        }

        var addResult = receipt.AddAttachment(createResult.Value);
        if (addResult.IsFailure)
        {
            if (System.IO.File.Exists(fullPath))
                System.IO.File.Delete(fullPath);
            return BadRequest(ApiResponse<Guid>.Fail(addResult.Error.Description));
        }

        await _purchaseReceiptRepository.UpdateAsync(receipt, cancellationToken);

        await _auditService.LogAsync(
            AuditActions.PurchaseReceipt.AttachmentAdded,
            "PurchaseReceipt",
            receipt.Id,
            newValues: new { AttachmentId = createResult.Value.Id, FileName = safeFileName },
            cancellationToken: cancellationToken);

        return Ok(ApiResponse<Guid>.Ok(createResult.Value.Id, "Pièce jointe ajoutée."));
    }

    /// <summary>
    /// Delete an attachment from a purchase receipt.
    /// </summary>
    [HttpDelete("{id:guid}/attachments/{attachmentId:guid}")]
    [Authorize(Policy = PermissionPolicies.PurchaseReceiptsUpdate)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> DeleteAttachment(
        Guid id,
        Guid attachmentId,
        CancellationToken cancellationToken)
    {
        var receipt = await _purchaseReceiptRepository.GetByIdWithDetailsAsync(id, cancellationToken);
        if (receipt is null)
            return NotFound(ApiResponse<object>.Fail("Bon de réception introuvable."));

        var attachment = receipt.Attachments.FirstOrDefault(a => a.Id == attachmentId);
        if (attachment is null)
            return NotFound(ApiResponse<object>.Fail("Pièce jointe introuvable."));

        var relativePath = attachment.StorageRelativePath;
        var removeResult = receipt.RemoveAttachment(attachmentId);
        if (removeResult.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(removeResult.Error.Description));

        await _purchaseReceiptRepository.UpdateAsync(receipt, cancellationToken);

        var basePath = _configuration["AccountingAttachments:BasePath"]
            ?? Path.Combine(_environment.ContentRootPath ?? AppContext.BaseDirectory, "App_Data", "attachments");
        var fullPath = Path.GetFullPath(Path.Combine(basePath, relativePath));
        if (System.IO.File.Exists(fullPath))
            System.IO.File.Delete(fullPath);

        await _auditService.LogAsync(
            AuditActions.PurchaseReceipt.AttachmentDeleted,
            "PurchaseReceipt",
            receipt.Id,
            newValues: new { AttachmentId = attachmentId },
            cancellationToken: cancellationToken);

        return Ok(ApiResponse<object>.Ok(null!, "Pièce jointe supprimée."));
    }

    private IActionResult MapFailure(Error error)
    {
        if (error.Code.EndsWith(".NotFound", StringComparison.Ordinal))
            return NotFound(ApiResponse<object>.Fail(error.Description, error.Code));
        if (string.Equals(error.Code, "Conflict", StringComparison.Ordinal))
        {
            var response = ApiResponse<object>.Fail(error.Description, error.Code);
            if (error.Metadata is { Count: > 0 })
                response = response with { Data = error.Metadata };
            return Conflict(response);
        }

        return BadRequest(ApiResponse<object>.Fail(error.Description, error.Code));
    }
}

/// <summary>
/// Response body for a successful supplier-invoice creation from a purchase document.
/// Carries the final invoice number actually persisted (which may differ from the caller's
/// input when the server auto-resolved or retried after a duplicate).
/// </summary>
public sealed record SupplierInvoiceCreationResponse(Guid Id, string InvoiceNumber);

/// <summary>
/// Request body for cancelling a purchase receipt.
/// </summary>
public sealed record CancelPurchaseReceiptRequest
{
    public string Reason { get; init; } = null!;
}

/// <summary>
/// Request body for creating a supplier invoice from a purchase receipt.
/// </summary>
public sealed record CreateSupplierInvoiceFromReceiptRequest
{
    public string InvoiceNumber { get; init; } = null!;
    public DateTime InvoiceDate { get; init; }
    public int PaymentTermDays { get; init; } = 30;
    public string? ExternalReference { get; init; }
    public string? Notes { get; init; }
    public bool? SendEmail { get; init; }
    public IReadOnlyList<CreateSupplierInvoiceLineSelection>? Lines { get; init; }
    public IReadOnlyList<SupplierInvoiceLineAssetRequest>? LineAssetClassifications { get; init; }
    public string? PaymentMethod { get; init; }
    public bool? UseSuggestedNumber { get; init; }
}
