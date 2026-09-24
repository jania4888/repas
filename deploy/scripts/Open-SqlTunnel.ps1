<#
.SYNOPSIS
    Ouvre un tunnel SSH vers le SQL Server de production (instafact.shop), pour SSMS.

.DESCRIPTION
    SQL Server tourne dans un conteneur Docker SANS aucun port publie : il n'est pas joignable
    depuis Internet, et doit le rester (un port publie par Docker contourne le pare-feu UFW).
    Ce script ouvre un tunnel SSH chiffre entre un port local de ce poste et le conteneur, dont il
    retrouve lui-meme l'adresse : elle change si le conteneur est recree.

    Le tunnel reste ouvert tant que cette fenetre est ouverte. Ctrl+C ou la fermeture de la
    fenetre coupe l'acces. Il n'ecoute que sur 127.0.0.1 : les autres machines du reseau local
    ne peuvent pas s'en servir.

    Dans SSMS :
        Nom du serveur    127.0.0.1,14330   (virgule avant le port ; PAS localhost, resolu en IPv6)
        Authentification  Authentification SQL Server
        Chiffrement       Obligatoire, et cocher "Faire confiance au certificat du serveur"
                          (certificat auto-signe du conteneur ; le trafic est deja chiffre par SSH)

    Codes de sortie : 0 tunnel ferme normalement, 3 erreur avant ouverture, 255 connexion perdue.

.PARAMETER LocalPort
    Port local du tunnel. Par defaut 14330.
.PARAMETER NoPause
    Ne pas attendre Entree avant de fermer la fenetre en cas d'erreur.

.EXAMPLE
    .\deploy\scripts\Open-SqlTunnel.ps1
.EXAMPLE
    .\deploy\scripts\Open-SqlTunnel.ps1 -LocalPort 14331
#>
[CmdletBinding()]
param(
    [ValidateRange(1024, 65535)][int]$LocalPort = 14330,
    [string]$Server = '187.124.214.123',
    [string]$User = 'deploy',
    [string]$Domain = 'instafact.shop',
    [string]$Container = 'factutrust-sqlserver',
    [switch]$NoPause
)

$ErrorActionPreference = 'Stop'

function Wait-BeforeClose {
    # Lance depuis Visual Studio, la fenetre se refermerait avant qu'on ait pu lire l'erreur.
    if (-not $NoPause -and [Environment]::UserInteractive -and -not [Console]::IsInputRedirected) {
        [void](Read-Host 'Appuyer sur Entree pour fermer')
    }
}

function Fail([string]$Message, [int]$Code = 3) {
    Write-Host ''
    Write-Host "ECHEC : $Message"
    Write-Host ''
    Wait-BeforeClose
    exit $Code
}

Write-Host "==== TUNNEL SQL SERVER DE PRODUCTION -> $User@$Server ($Domain) ===="

$ssh = Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'
if (-not (Test-Path $ssh)) {
    $found = Get-Command ssh -ErrorAction SilentlyContinue
    if ($found) { $ssh = $found.Source } else { Fail 'client ssh introuvable' }
}
$sshOptions = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=20')

# --- 1. Le domaine pointe-t-il bien sur ce serveur ? ------------------------------------------
# Garde-fou issu d'un incident reel : un serveur mal identifie apres une reprise de contexte.
Write-Host "[1/4] $Domain doit pointer sur $Server"
try {
    $ips = @(Resolve-DnsName -Name $Domain -Type A -Server 8.8.8.8 -DnsOnly -ErrorAction Stop |
        Where-Object { $_.Type -eq 'A' } | ForEach-Object { $_.IPAddress })
} catch {
    Fail "resolution DNS de $Domain impossible : $($_.Exception.Message)"
}
if ($ips -notcontains $Server) {
    Fail "$Domain pointe sur $($ips -join ', ') et non sur $Server : ce n est pas le serveur de production"
}
Write-Host "      $Domain -> $($ips -join ', ')"

# --- 2. Port local libre ----------------------------------------------------------------------
Write-Host "[2/4] Port local $LocalPort"
$busy = @(Get-NetTCPConnection -LocalPort $LocalPort -State Listen -ErrorAction SilentlyContinue)
if ($busy.Count -gt 0) {
    $owners = ($busy | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
        $p = Get-CimInstance Win32_Process -Filter "ProcessId = $_" -ErrorAction SilentlyContinue
        if ($p) { "$($p.Name) (PID $_)" } else { "PID $_" }
    }) -join ', '
    Fail "le port $LocalPort est deja utilise ($owners). Un tunnel est peut-etre deja ouvert ; sinon relancer avec -LocalPort 14331"
}
Write-Host '      libre'

# --- 3. Etat et adresse du conteneur ----------------------------------------------------------
Write-Host "[3/4] Conteneur $Container"
# Aucun guillemet double : Windows PowerShell 5.1 les transmet mal aux executables natifs.
$query = 'docker inspect -f ''{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{end}} {{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'' ' + $Container
$previous = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
    $answer = ((& $ssh @sshOptions "$User@$Server" $query 2>&1) | ForEach-Object { "$_" }) -join ' '
    $queryCode = $LASTEXITCODE
} finally {
    $ErrorActionPreference = $previous
}
if ($queryCode -ne 0) { Fail "interrogation du serveur impossible (cle, empreinte d hote ?) : $answer" }
$parts = @($answer.Trim() -split '\s+')
$state = $parts[0]
$ip = $parts[$parts.Count - 1]
if ($state -ne 'running/healthy') { Fail "le conteneur $Container n est pas en service (etat : $state)" }
if ($ip -notmatch '^(\d{1,3}\.){3}\d{1,3}$') { Fail "adresse du conteneur illisible : $answer" }
Write-Host "      $state, adresse $ip"

# --- 4. Tunnel --------------------------------------------------------------------------------
Write-Host "[4/4] Tunnel 127.0.0.1:${LocalPort} -> ${ip}:1433 via $User@$Server"
Write-Host ''
Write-Host '  Dans SSMS :'
Write-Host "    Nom du serveur    : 127.0.0.1,$LocalPort"
Write-Host '    Authentification  : Authentification SQL Server'
Write-Host '    Chiffrement       : Obligatoire, et cocher Faire confiance au certificat du serveur'
Write-Host '    Compte sa         : ligne MSSQL_SA_PASSWORD de votre copie hors serveur du .env'
Write-Host ''
Write-Host '  RAPPEL : c est la PRODUCTION. Lire librement ; avant toute ecriture, sauvegarder.'
Write-Host '  Ne jamais modifier AuditLogs (chaine d empreintes) ni la structure des tables (migrations EF).'
Write-Host ''
Write-Host '  TUNNEL OUVERT. Ctrl+C ou fermer cette fenetre pour couper l acces.'

$started = Get-Date
$code = $null
try {
    & $ssh @sshOptions -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 `
        -L "127.0.0.1:${LocalPort}:${ip}:1433" "$User@$Server"
    $code = $LASTEXITCODE
} finally {
    Write-Host ''
    Write-Host ('  Tunnel ferme apres {0:hh\:mm\:ss}.' -f ((Get-Date) - $started))
}
if ($code -ne 0) { Fail "le tunnel s est arrete avec le code $code (connexion perdue ou port refuse)" $code }
exit 0
