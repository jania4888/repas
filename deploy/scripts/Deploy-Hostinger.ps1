<#
.SYNOPSIS
    Deploie FactuTrust sur le VPS Hostinger (instafact.shop), de facon controlee.

.DESCRIPTION
    S'execute sur le poste Windows, directement ou depuis Visual Studio (Outils > Outils externes).

    Verifie localement la version cible, que le domaine pointe bien sur le serveur vise, puis
    lance SUR LE SERVEUR deploy/scripts/deploy.sh extrait de cette meme version. Toute la logique
    (sauvegarde, construction, bascule, porte GO/NO-GO, retour arriere) vit dans ce script serveur.

    Le script serveur tourne detache (nohup) : si la connexion ou Visual Studio se coupe, le
    deploiement va au bout, retour arriere compris, et son journal reste sur le serveur dans
    /opt/factutrust/logs.

    Codes de sortie :
        0  succes, ou version deja en service
        1  abandon avant bascule : la production n'a pas ete modifiee
        2  echec apres bascule : retour arriere automatique effectue
        3  erreur locale (git, DNS, SSH) : rien n'a ete lance
      255  connexion SSH perdue en cours de route : le deploiement continue sur le serveur

.PARAMETER Ref
    Version a deployer : branche distante, etiquette ou SHA. Par defaut origin/main.
.PARAMETER DryRun
    Deploiement a blanc : controles et construction des images, puis retour a l'etat initial.
.PARAMETER AcceptMigrations
    Obligatoire si la version ajoute des migrations EF. A n'utiliser qu'apres les avoir revues
    et pre-controlees sur les donnees de production.
.PARAMETER BuildAll
    Reconstruit les trois images meme si leur code n'a pas change.
.PARAMETER AllowUnmerged
    Autorise une version hors d'origin/main, en mode a blanc UNIQUEMENT (tester une PR avant fusion).

.EXAMPLE
    .\deploy\scripts\Deploy-Hostinger.ps1 -DryRun
.EXAMPLE
    .\deploy\scripts\Deploy-Hostinger.ps1
.EXAMPLE
    .\deploy\scripts\Deploy-Hostinger.ps1 -Ref origin/ma-branche -DryRun -AllowUnmerged
#>
[CmdletBinding()]
param(
    [string]$Ref = 'origin/main',
    [switch]$DryRun,
    [switch]$AcceptMigrations,
    [switch]$BuildAll,
    [switch]$AllowUnmerged,
    [string]$Server = '187.124.214.123',
    [string]$User = 'deploy',
    [string]$Domain = 'instafact.shop'
)

$ErrorActionPreference = 'Stop'

function Fail([string]$Message) {
    Write-Host ''
    Write-Host "ECHEC : $Message"
    Write-Host 'Rien n a ete lance sur le serveur.'
    exit 3
}

function Invoke-Git {
    # git ecrit sur stderr meme quand tout va bien : sous Windows PowerShell 5.1, rediriger
    # stderr avec ErrorActionPreference=Stop leverait une exception. On juge sur le code.
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { $output = & git @args 2>&1 } finally { $ErrorActionPreference = $previous }
    return @{ Code = $LASTEXITCODE; Output = (($output | ForEach-Object { "$_" }) -join "`n").Trim() }
}

$mode = if ($DryRun) { 'A BLANC' } else { 'REEL' }
Write-Host "==== DEPLOIEMENT FACTUTRUST ($mode) -> $User@$Server ($Domain) ===="

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail 'git introuvable dans le PATH' }
$ssh = Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'
if (-not (Test-Path $ssh)) {
    $found = Get-Command ssh -ErrorAction SilentlyContinue
    if ($found) { $ssh = $found.Source } else { Fail 'client ssh introuvable' }
}

$r = Invoke-Git rev-parse --show-toplevel
if ($r.Code -ne 0) { Fail 'lancer ce script depuis le depot FactuTrust' }
Set-Location $r.Output

# --- 1. Version cible -------------------------------------------------------------------------
Write-Host '[1/4] Version cible'
$r = Invoke-Git fetch --quiet origin
if ($r.Code -ne 0) { Fail "git fetch impossible : $($r.Output)" }

$r = Invoke-Git rev-parse --verify --quiet "$Ref^{commit}"
if ($r.Code -ne 0) { Fail "version introuvable : $Ref" }
$sha = $r.Output
$short = $sha.Substring(0, 7)
Write-Host "      $short  $((Invoke-Git log -1 --format=%s $sha).Output)"

$r = Invoke-Git branch -r --contains $sha
if ($r.Code -ne 0 -or [string]::IsNullOrWhiteSpace($r.Output)) {
    Fail "$short n est sur aucune branche distante : la pousser d abord"
}
$r = Invoke-Git merge-base --is-ancestor $sha origin/main
if ($r.Code -ne 0) {
    if ($DryRun -and $AllowUnmerged) {
        Write-Host '      [ATTENTION] version hors d origin/main : toleree en mode a blanc uniquement'
    } else {
        Fail "$short n est pas sur origin/main. Seul du code fusionne se deploie (pour tester une branche : -DryRun -AllowUnmerged)"
    }
}
$r = Invoke-Git cat-file -e "${sha}:deploy/scripts/deploy.sh"
if ($r.Code -ne 0) { Fail 'deploy/scripts/deploy.sh absent de cette version' }

# --- 2. Le domaine pointe-t-il bien sur ce serveur ? ------------------------------------------
# Garde-fou issu d'un incident reel : un serveur mal identifie apres une reprise de contexte.
Write-Host "[2/4] $Domain doit pointer sur $Server"
try {
    $ips = @(Resolve-DnsName -Name $Domain -Type A -Server 8.8.8.8 -DnsOnly -ErrorAction Stop |
        Where-Object { $_.Type -eq 'A' } | ForEach-Object { $_.IPAddress })
} catch {
    Fail "resolution DNS de $Domain impossible : $($_.Exception.Message)"
}
if ($ips -notcontains $Server) {
    Fail "$Domain pointe sur $($ips -join ', ') et non sur $Server : refus de deployer sur un serveur qui ne sert pas le site"
}
Write-Host "      $Domain -> $($ips -join ', ')"

# --- 3. Connexion SSH -------------------------------------------------------------------------
Write-Host "[3/4] Connexion SSH $User@$Server"
$sshOptions = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=20',
                '-o', 'ServerAliveInterval=30', '-T')
& $ssh @sshOptions "$User@$Server" 'hostname'
if ($LASTEXITCODE -ne 0) { Fail "connexion SSH a $User@$Server impossible (cle, empreinte d hote ?)" }

# --- 4. Lancement du script serveur, detache ---------------------------------------------------
$flags = @()
if ($DryRun) { $flags += '--dry-run' }
if ($AcceptMigrations) { $flags += '--accept-migrations' }
if ($BuildAll) { $flags += '--build-all' }
if ($AllowUnmerged) { $flags += '--allow-unmerged' }
$log = "logs/deploy-$short-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"

# Aucun guillemet double ici : Windows PowerShell 5.1 les transmet mal aux executables natifs.
# Lignes separees par LF uniquement : un CR ferait echouer bash.
$remote = @(
    'set -e'
    'cd /opt/factutrust'
    'mkdir -p logs'
    'export GIT_SSH_COMMAND=''ssh -i /home/deploy/.ssh/id_ed25519_deploykey -o BatchMode=yes'''
    'git -C src fetch -q origin'
    'git -C src cat-file -e __SHA__^{commit}'
    'git -C src show __SHA__:deploy/scripts/deploy.sh > .deploy-run.sh'
    'set +e'
    'nohup bash .deploy-run.sh __SHA__ __FLAGS__ > __LOG__ 2>&1 < /dev/null &'
    'pid=$!'
    'tail --pid=$pid -n +1 -f __LOG__'
    'wait $pid'
    'exit $?'
) -join "`n"
$remote = $remote.Replace('__SHA__', $sha).Replace('__FLAGS__', ($flags -join ' ')).Replace('__LOG__', $log)

Write-Host "[4/4] Lancement sur le serveur : deploy.sh $short $($flags -join ' ')"
Write-Host "      journal conserve sur le serveur : /opt/factutrust/$log"
Write-Host ''
& $ssh @sshOptions "$User@$Server" $remote
$code = $LASTEXITCODE

Write-Host ''
switch ($code) {
    0       { Write-Host 'RESULTAT : succes.' }
    1       { Write-Host 'RESULTAT : abandon avant bascule. La production n a pas ete modifiee.' }
    2       { Write-Host 'RESULTAT : echec apres bascule. RETOUR ARRIERE EFFECTUE : voir le journal ci-dessus.' }
    255     { Write-Host "RESULTAT : connexion SSH perdue. Le deploiement continue sur le serveur : /opt/factutrust/$log" }
    default { Write-Host "RESULTAT : code de sortie inattendu $code. Journal : /opt/factutrust/$log" }
}
exit $code
