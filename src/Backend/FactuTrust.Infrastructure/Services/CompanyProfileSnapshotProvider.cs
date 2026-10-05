using System.Text.Json;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace FactuTrust.Infrastructure.Services;

public sealed class CompanyProfileSnapshotProvider : ICompanyProfileSnapshotProvider
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false
    };

    private readonly MasterDbContext _masterContext;
    private readonly ITenantService _tenantService;
    private readonly ILogger<CompanyProfileSnapshotProvider> _logger;

    public CompanyProfileSnapshotProvider(
        MasterDbContext masterContext,
        ITenantService tenantService,
        ILogger<CompanyProfileSnapshotProvider> logger)
    {
        _masterContext = masterContext;
        _tenantService = tenantService;
        _logger = logger;
    }

    public async Task<CompanyProfileSnapshotDto> CaptureForCompanyTenantAsync(
        Guid companyTenantId, CancellationToken cancellationToken = default)
    {
        var tenant = await _masterContext.Tenants.AsNoTracking()
            .FirstOrDefaultAsync(t => t.Id == companyTenantId, cancellationToken);

        if (tenant is null || tenant.Kind != TenantKind.Company)
            throw new InvalidOperationException($"Société invalide : {companyTenantId}");

        Company? company = null;
        try
        {
            var conn = await _tenantService.GetConnectionStringAsync(companyTenantId, cancellationToken);
            if (!string.IsNullOrEmpty(conn))
            {
                await using var ctx = CreateTenantContext(conn);
                company = await ctx.Set<Company>().AsNoTracking()
                    .Where(c => c.IsDefault && c.IsActive)
                    .FirstOrDefaultAsync(cancellationToken);
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Impossible de lire la société par défaut pour le tenant {TenantId}", companyTenantId);
        }

        var tenantAddress = tenant.Address;
        var companyAddress = company?.Address;

        return new CompanyProfileSnapshotDto
        {
            SchemaVersion = 1,
            CapturedAtUtc = DateTime.UtcNow,
            CompanyName = tenant.CompanyName,
            TradeName = company?.TradeName,
            Nif = tenant.NIF.Value,
            TaxRegime = (int)tenant.TaxRegime,
            RneIdentifier = company?.CommerceRegistry,
            Street = CoalesceAddressField(tenantAddress.Street, companyAddress?.Street),
            StreetLine2 = CoalesceOptional(tenantAddress.StreetLine2, companyAddress?.StreetLine2),
            City = CoalesceAddressField(tenantAddress.City, companyAddress?.City),
            Governorate = CoalesceAddressField(tenantAddress.Governorate, companyAddress?.Governorate),
            PostalCode = CoalesceOptional(tenantAddress.PostalCode, companyAddress?.PostalCode),
            Email = tenant.Email?.Value,
            Phone = tenant.Phone?.Value ?? company?.Phone?.Value
        };
    }

    public CompanyProfileSnapshotDto? TryDeserialize(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
            return null;

        try
        {
            return JsonSerializer.Deserialize<CompanyProfileSnapshotDto>(json, JsonOptions);
        }
        catch (JsonException ex)
        {
            _logger.LogWarning(ex, "Snapshot société JSON invalide");
            return null;
        }
    }

    public string Serialize(CompanyProfileSnapshotDto snapshot) =>
        JsonSerializer.Serialize(snapshot, JsonOptions);

    private static string CoalesceAddressField(string? primary, string? fallback) =>
        !string.IsNullOrWhiteSpace(primary) ? primary.Trim()
        : !string.IsNullOrWhiteSpace(fallback) ? fallback.Trim()
        : string.Empty;

    private static string? CoalesceOptional(string? primary, string? fallback) =>
        !string.IsNullOrWhiteSpace(primary) ? primary.Trim()
        : string.IsNullOrWhiteSpace(fallback) ? null : fallback.Trim();

    private static TenantDbContext CreateTenantContext(string connectionString)
    {
        var options = new DbContextOptionsBuilder<TenantDbContext>()
            .UseSqlServer(connectionString)
            .Options;
        return new TenantDbContext(options);
    }
}
