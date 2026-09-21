# Refreshes the pre-migrated tenant template used for fast registration provisioning.
# Run after deployments that include new tenant EF migrations.
param(
    [string]$ApiBaseUrl = "http://localhost:5000"
)

Write-Host "Tenant template maintenance is handled by Hangfire job 'tenant-template-maintenance'."
Write-Host "To refresh immediately after deploy, trigger EnsureTenantTemplate via the API host startup or run:"
Write-Host "  dotnet run --project src/Backend/FactuTrust.API -- tenant-template-maintenance"
Write-Host ""
Write-Host "Ensure SQL Server login has BACKUP DATABASE and RESTORE DATABASE permissions."
