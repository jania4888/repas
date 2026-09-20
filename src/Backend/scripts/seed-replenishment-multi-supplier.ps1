# Injecte 15 réapprovisionnements « En attente » répartis sur 5 fournisseurs démo.
# Usage :
#   .\src\Backend\scripts\seed-replenishment-multi-supplier.ps1
#   .\src\Backend\scripts\seed-replenishment-multi-supplier.ps1 -TenantDatabase FactuTrust_Tenant_XXXX

param(
    [string]$Server = "(localdb)\MSSQLLocalDB",
    [string]$TenantDatabase = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$sqlFile = Join-Path $repoRoot "docs\runbooks\sql\SeedReplenishmentMultiSupplier_Tenant.idempotent.sql"

if (-not (Test-Path $sqlFile)) {
    throw "Script SQL introuvable : $sqlFile"
}

if ([string]::IsNullOrWhiteSpace($TenantDatabase)) {
    $TenantDatabase = sqlcmd -S $Server -d FactuTrust_Master -Q "SET NOCOUNT ON; SELECT TOP 1 DatabaseName FROM Tenants ORDER BY CreatedAt DESC" -h -1 -W
    $TenantDatabase = ($TenantDatabase | Where-Object { $_ -match '^FactuTrust_Tenant_' } | Select-Object -First 1)
    if (-not $TenantDatabase) { throw "Aucun tenant trouvé dans FactuTrust_Master." }
    Write-Host "Tenant détecté : $TenantDatabase"
}

Write-Host "Exécution du seed réappro multi-fournisseurs sur $TenantDatabase ..."
sqlcmd -S $Server -d $TenantDatabase -i $sqlFile -b
if ($LASTEXITCODE -ne 0) { throw "sqlcmd a échoué (code $LASTEXITCODE)." }

Write-Host ""
Write-Host "Terminé. Ouvrez /forecasting/replenishment (filtre En attente)."
