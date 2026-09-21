# Porte qualité locale FactuTrust — reproduit .github/workflows/ci.yml avant de pousser.
#
# Pourquoi la faire tourner : un run CI complet coûte ~47 minutes facturées (le job backend
# tourne sur windows-latest, facturé ×2). Sur un dépôt privé en plan Free, cela fait ~42 runs
# par mois. Découvrir une compilation cassée en poussant, c'est payer 47 minutes pour lire un
# message que cette porte donne gratuitement.
#
# Usage :
#   powershell -File scripts\verify-all.ps1                      # arrêt à la 1re étape rouge
#   powershell -File scripts\verify-all.ps1 -ContinueOnError     # tout jouer, recap complet
#   powershell -File scripts\verify-all.ps1 -CleanInstall        # npm ci, comme la CI
#
# -ContinueOnError : la CI lance ses 4 jobs EN PARALLÈLE — un backend rouge n'empêche pas les
#   jobs Angular de s'exécuter. En mode arrêt-au-premier-échec, ce script ne prédit donc qu'une
#   fraction du résultat distant, et sur un poste avec une ligne de base de tests déjà rouges il
#   n'atteint jamais les étapes frontend. Ce commutateur rétablit la fidélité.
#
# -CleanInstall : la CI repart d'un node_modules vide (`npm ci --legacy-peer-deps`), ce script
#   réutilise l'existant. C'est exactement l'écart qui a fait échouer l'étape `npm ci` en CI
#   alors que tout passait en local. Lent, mais c'est le seul mode réellement fidèle.
#
# NON couvert ici : le job « Web Playwright smoke ». Il exige un SQL Server accessible et l'API
#   démarrée en arrière-plan (scripts/ci/wait-for-sql.sh, start-api-e2e.sh, e2e-register-user.sh,
#   tous en bash). Le simuler à moitié donnerait une fausse assurance : il reste à vérifier sur
#   le premier run distant.

param(
    [switch]$ContinueOnError,
    [switch]$CleanInstall
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$webDir = Join-Path $root 'src\Frontend\factutrust-web'
$boDir = Join-Path $root 'src\Frontend\factutrust-backoffice'
$sln = Join-Path $root 'src\Backend\FactuTrust.sln'
$steps = @()
$failures = @()

function Write-Summary {
    Write-Host "`n=== RECAPITULATIF ===" -ForegroundColor Green
    $script:steps | ForEach-Object { Write-Host $_ }
    if ($script:failures.Count -gt 0) {
        Write-Host "`n$($script:failures.Count) etape(s) en echec :" -ForegroundColor Red
        $script:failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
        Write-Host "`nRelever les NOMS des tests rouges et les comparer a la ligne de base connue" -ForegroundColor Yellow
        Write-Host "de ce poste : un compteur ne distingue pas une regression d'un echec preexistant." -ForegroundColor Yellow
    }
    else {
        Write-Host "Toutes les verifications sont passees." -ForegroundColor Green
    }
}

function Invoke-Step {
    param([string]$Name, [scriptblock]$Action)
    Write-Host "`n=== $Name ===" -ForegroundColor Cyan
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $global:LASTEXITCODE = 0
    $threw = $false
    try { & $Action }
    catch { Write-Host $_.Exception.Message -ForegroundColor Red; $threw = $true }
    $sw.Stop()
    $secs = [int]$sw.Elapsed.TotalSeconds

    if ($threw -or $LASTEXITCODE -ne 0) {
        $code = if ($LASTEXITCODE -ne 0) { $LASTEXITCODE } else { 1 }
        Write-Host "ECHEC : $Name (exit $code)" -ForegroundColor Red
        $script:steps += "[ECHEC] $Name ($secs s)"
        $script:failures += $Name
        if (-not $ContinueOnError) {
            Write-Summary
            Write-Host "`nArret a la premiere etape rouge. Relancer avec -ContinueOnError pour tout jouer." -ForegroundColor Yellow
            exit $code
        }
    }
    else {
        $script:steps += "[OK]    $Name ($secs s)"
    }
}

# --- Backend ---------------------------------------------------------------------------
# Aligné sur ci.yml : configuration Release, solution entière, et la double sérialisation
# (-m:1 côté MSBuild + collections xUnit non parallèles). Les deux projets de test partagent
# un seul serveur LocalDB ; l'un des deux contrôles seul laisse encore des rafales de
# provisionnement concurrentes. Lancer les projets séparément en Debug, comme le faisait la
# version précédente de ce script, ne prédisait pas le distant.
Invoke-Step "Backend : build (Release)" {
    dotnet build $sln --configuration Release --nologo -v q
}
Invoke-Step "Backend : tests (solution, serialises)" {
    dotnet test $sln --configuration Release --no-build --nologo -v minimal `
        -m:1 -- xUnit.ParallelizeTestCollections=false
}

# --- Web -------------------------------------------------------------------------------
if ($CleanInstall) {
    Invoke-Step "Web : npm ci" {
        Push-Location $webDir
        try { npm ci --legacy-peer-deps } finally { Pop-Location }
    }
}
Invoke-Step "Web : npm audit (critical)" {
    Push-Location $webDir
    try { npm audit --audit-level=critical } finally { Pop-Location }
}
# Ferme la 2e moitié du contrat de parité sectorielle. sector-catalog-parity.spec.ts épingle
# le catalogue statique frontend contre sa COPIE du snapshot backend, mais ne peut pas
# atteindre le fichier backend (hors du rootDir Angular). Sans cette étape, une dérive entre
# les deux arbres passe inaperçue en local et n'est vue qu'en CI. Invocation identique à
# ci.yml, chemin relatif compris : le script résout ses fichiers depuis le répertoire courant.
Invoke-Step "Web : parite catalogue sectoriel" {
    Push-Location $webDir
    try { node ../../../scripts/ci/check-sector-catalog-parity.mjs } finally { Pop-Location }
}
Invoke-Step "Web : specs Jasmine (headless)" {
    Push-Location $webDir
    try { npx ng test --watch=false --browsers=ChromeHeadless } finally { Pop-Location }
}
Invoke-Step "Web : build production" {
    Push-Location $webDir
    try { npm run build:prod } finally { Pop-Location }
}

# --- Backoffice ------------------------------------------------------------------------
if ($CleanInstall) {
    Invoke-Step "Backoffice : npm ci" {
        Push-Location $boDir
        try { npm ci --legacy-peer-deps } finally { Pop-Location }
    }
}
Invoke-Step "Backoffice : npm audit (critical)" {
    Push-Location $boDir
    try { npm audit --audit-level=critical } finally { Pop-Location }
}
Invoke-Step "Backoffice : build production" {
    Push-Location $boDir
    try { npx ng build --configuration production } finally { Pop-Location }
}

Write-Summary
if ($failures.Count -gt 0) { exit 1 }
