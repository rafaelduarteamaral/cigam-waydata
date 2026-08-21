#Requires -RunAsAdministrator
param(
  [string]$InstallRoot = "C:\apps\cigam-waydata",
  [string]$DataDirectory = "",
  [string]$NodeExe = "$env:ProgramFiles\nodejs\node.exe",
  [string]$WinSwExe = ""
)

$ErrorActionPreference = "Stop"
if (-not $DataDirectory) { $DataDirectory = Join-Path $InstallRoot "data" }

$monitorNext = Join-Path $InstallRoot "apps\monitor\node_modules\next\dist\bin\next"
$workerTsx = Join-Path $InstallRoot "apps\worker\node_modules\tsx\dist\cli.mjs"
if (-not (Test-Path $workerTsx)) {
  $tsxCmd = Join-Path $InstallRoot "apps\worker\node_modules\.bin\tsx.cmd"
  if (Test-Path $tsxCmd) { $workerTsx = $tsxCmd }
}
$envFile = Join-Path $InstallRoot ".env"
$logPath = Join-Path $InstallRoot "deploy\windows\logs"
$deployDir = Join-Path $InstallRoot "deploy\windows"
if (-not $WinSwExe) {
  foreach ($candidate in @((Join-Path $deployDir "WinSW.exe"), (Join-Path $deployDir "WinSW-x64.exe"), (Join-Path $deployDir "WinSW.NET8.exe"))) {
    if (Test-Path $candidate) { $WinSwExe = $candidate; break }
  }
}

if (-not (Test-Path $NodeExe)) { throw "Node.js não encontrado em $NodeExe. Instale o Node 22 LTS." }
if (-not (Test-Path $monitorNext)) { throw "Build do monitor ausente. Rode pnpm install e pnpm --filter @cigam-waydata/monitor build." }
if (-not (Test-Path $workerTsx)) { throw "tsx do worker ausente. Rode pnpm install na raiz do repositório." }
if (-not (Test-Path $envFile)) { throw "Arquivo .env ausente em $envFile." }

New-Item -ItemType Directory -Force -Path $logPath, $DataDirectory | Out-Null

function Write-ServiceXml([string]$Id, [string]$Name, [string]$Description, [string]$Arguments, [string]$WorkingDirectory, [hashtable]$EnvVars, [string]$OutFile) {
  $envXml = ($EnvVars.GetEnumerator() | ForEach-Object { "  <env name=`"$($_.Key)`" value=`"$($_.Value)`"/>" }) -join "`n"
  @"
<service>
  <id>$Id</id>
  <name>$Name</name>
  <description>$Description</description>
  <executable>$NodeExe</executable>
  <arguments>$Arguments</arguments>
  <workingdirectory>$WorkingDirectory</workingdirectory>
  <logpath>$logPath</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>10240</sizeThreshold>
    <keepFiles>8</keepFiles>
  </log>
  <onfailure action="restart" delay="10 sec"/>
  <stoptimeout>20 sec</stoptimeout>
$envXml
</service>
"@ | Set-Content -Path $OutFile -Encoding UTF8
}

Write-ServiceXml `
  -Id "cigam-waydata-monitor" `
  -Name "CIGAM WayData Monitor" `
  -Description "Monitor Next.js da integração CIGAM x WayData (127.0.0.1:3000)." `
  -Arguments "`"$monitorNext`" start -H 127.0.0.1 -p 3000" `
  -WorkingDirectory (Join-Path $InstallRoot "apps\monitor") `
  -EnvVars @{ NODE_ENV = "production"; TZ = "America/Sao_Paulo"; DATA_DIRECTORY = $DataDirectory; NEXT_PUBLIC_BASE_PATH = "/WayData/monitor" } `
  -OutFile (Join-Path $deployDir "CigamWayData.Monitor.xml")

Write-ServiceXml `
  -Id "cigam-waydata-worker" `
  -Name "CIGAM WayData Worker" `
  -Description "Worker de sincronizacao CIGAM x WayData." `
  -Arguments "`"$workerTsx`" src/main.ts" `
  -WorkingDirectory (Join-Path $InstallRoot "apps\worker") `
  -EnvVars @{ NODE_ENV = "production"; TZ = "America/Sao_Paulo"; ENV_FILE = $envFile } `
  -OutFile (Join-Path $deployDir "CigamWayData.Worker.xml")

Write-Host "XML dos serviços atualizado em $deployDir"
Write-Host "DATA_DIRECTORY=$DataDirectory"
Write-Host "ENV_FILE=$envFile"

if (-not $WinSwExe) {
  Write-Host ""
  Write-Host "Baixe o WinSW (WinSW.NET8.exe) em https://github.com/winsw/winsw/releases"
  Write-Host "Copie para: $deployDir\WinSW.exe"
  Write-Host ""
  Write-Host "Depois, neste PowerShell:"
  Write-Host "  Copy-Item $deployDir\WinSW.exe $deployDir\cigam-monitor.exe"
  Write-Host "  Copy-Item $deployDir\WinSW.exe $deployDir\cigam-worker.exe"
  Write-Host "  Copy-Item $deployDir\CigamWayData.Monitor.xml $deployDir\cigam-monitor.xml"
  Write-Host "  Copy-Item $deployDir\CigamWayData.Worker.xml $deployDir\cigam-worker.xml"
  Write-Host "  & $deployDir\cigam-monitor.exe install"
  Write-Host "  & $deployDir\cigam-worker.exe install"
  Write-Host "  Start-Service cigam-waydata-monitor"
  Write-Host "  Start-Service cigam-waydata-worker"
  exit 0
}

$monitorExe = Join-Path $deployDir "cigam-monitor.exe"
$workerExe = Join-Path $deployDir "cigam-worker.exe"
Copy-Item $WinSwExe $monitorExe -Force
Copy-Item $WinSwExe $workerExe -Force
Copy-Item (Join-Path $deployDir "CigamWayData.Monitor.xml") (Join-Path $deployDir "cigam-monitor.xml") -Force
Copy-Item (Join-Path $deployDir "CigamWayData.Worker.xml") (Join-Path $deployDir "cigam-worker.xml") -Force

function Install-OrRefresh([string]$Exe, [string]$ServiceName) {
  $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  if ($svc) {
    if ($svc.Status -ne "Stopped") { Stop-Service $ServiceName -Force }
    Start-Service $ServiceName
    return
  }
  & $Exe install
  Start-Service $ServiceName
}

Install-OrRefresh $monitorExe "cigam-waydata-monitor"
Install-OrRefresh $workerExe "cigam-waydata-worker"
Get-Service cigam-waydata-monitor, cigam-waydata-worker | Format-Table Name, Status, StartType
Write-Host "Health local: http://127.0.0.1:3000/api/health"
