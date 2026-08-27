#Requires -RunAsAdministrator
param(
  [string]$InstallRoot = "C:\inetpub\wwwroot\CGPortaisPanebras\WayData\cigam-waydata",
  [string]$SiteName = "CGPortaisPanebras",
  [string]$PublicHost = "panebrasportais.cigam.cloud"
)

$ErrorActionPreference = "Continue"
$physical = Join-Path $InstallRoot "deploy\iis"
$monitorXml = Join-Path $InstallRoot "deploy\windows\cigam-monitor.xml"
$rootEnv = Join-Path $InstallRoot ".env"
$monitorEnv = Join-Path $InstallRoot "apps\monitor\.env.production.local"

function Sync-MonitorLoginEnvironment {
  if (-not (Test-Path $rootEnv)) {
    Write-Host "Arquivo .env nao encontrado; configuracao de login nao foi sincronizada."
    return
  }

  $wanted = @("MONITOR_USERNAME", "MONITOR_PASSWORD", "MONITOR_AUTH_SECRET")
  $values = @{}
  foreach ($line in Get-Content $rootEnv) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
      if ($wanted -contains $Matches[1]) { $values[$Matches[1]] = $Matches[2] }
    }
  }

  if ($wanted | Where-Object { -not $values.ContainsKey($_) -or [string]::IsNullOrWhiteSpace($values[$_]) }) {
    Write-Host "Login nao ativado: defina MONITOR_USERNAME, MONITOR_PASSWORD e MONITOR_AUTH_SECRET no .env."
    return
  }

  $wanted | ForEach-Object { "$_=$($values[$_])" } | Set-Content -Path $monitorEnv -Encoding utf8
  Write-Host "Configuracao de login sincronizada para apps\monitor\.env.production.local"
}

Write-Host "=== 1. ARR / PROXY ==="
$arr = Get-WebGlobalModule -Name "ApplicationRequestRouting" -ErrorAction SilentlyContinue
if (-not $arr) { $arr = Get-WebGlobalModule | Where-Object { $_.Name -match "ApplicationRequestRouting|RequestRouting" } }
if ($arr) { $arr | Format-Table Name, Image } else { Write-Host "ARR NAO INSTALADO. Sem isso o IIS nao faz proxy para a porta 3000." }

try {
  Set-WebConfigurationProperty -PSPath "MACHINE/WEBROOT/APPHOST" -Filter "system.webServer/proxy" -Name "enabled" -Value $true
  Set-WebConfigurationProperty -PSPath "MACHINE/WEBROOT/APPHOST" -Filter "system.webServer/proxy" -Name "preserveHostHeader" -Value $true
  Set-WebConfigurationProperty -PSPath "MACHINE/WEBROOT/APPHOST" -Filter "system.webServer/proxy" -Name "reverseRewriteHostInResponseHeaders" -Value $true
  Get-WebConfigurationProperty -PSPath "MACHINE/WEBROOT/APPHOST" -Filter "system.webServer/proxy" -Name "enabled"
} catch {
  Write-Host "Falha ao ligar o proxy:" $_.Exception.Message
}

Write-Host "=== 2. APLICATIVO IIS ==="
Import-Module WebAdministration
if (-not (Test-Path $physical)) { throw "Pasta ausente: $physical" }
$appPath = "IIS:\Sites\$SiteName\WayData\monitor"
if (Test-Path $appPath) {
  Write-Host "Aplicativo ja existe: $appPath"
  Set-ItemProperty $appPath -Name physicalPath -Value $physical
} else {
  New-Item $appPath -Type Application -PhysicalPath $physical
  Write-Host "Aplicativo criado: /WayData/monitor -> $physical"
}
try {
  Set-WebConfigurationProperty -Filter "system.webServer/security/authentication/anonymousAuthentication" -Name Enabled -Value $true -PSPath $appPath
} catch { Write-Host "Anonimo (pode ignorar):" $_.Exception.Message }

Get-WebApplication -Site $SiteName | Format-Table Path, PhysicalPath

Write-Host "=== 3. SERVICO MONITOR ==="
Sync-MonitorLoginEnvironment
if (Test-Path $monitorXml) {
  if (-not (Select-String -Path $monitorXml -Pattern "NEXT_PUBLIC_BASE_PATH" -Quiet)) {
    (Get-Content $monitorXml -Raw) -replace "</service>", "  <env name=`"NEXT_PUBLIC_BASE_PATH`" value=`"/WayData/monitor`"/>`r`n</service>" |
      Set-Content $monitorXml -Encoding UTF8
  }
}
Restart-Service cigam-waydata-monitor -ErrorAction SilentlyContinue
Start-Sleep 6

Write-Host "=== 4. TESTES ==="
Write-Host "-- Node /WayData/monitor/api/health --"
curl.exe -sS -D - http://127.0.0.1:3000/WayData/monitor/api/health -o -
Write-Host ""
Write-Host "-- Node / (deve 404 se o basePath estiver ativo) --"
curl.exe -sS -o NUL -w "status=%{http_code}`n" http://127.0.0.1:3000/api/health
Write-Host "-- IIS com Host do portal --"
curl.exe -sS -k -D - -H "Host: $PublicHost" "https://127.0.0.1/WayData/monitor/api/health" -o -
Write-Host ""
Write-Host "-- IIS publico --"
curl.exe -sS -k -D - "https://$PublicHost/WayData/monitor/api/health" -o -
Write-Host ""
Write-Host "Abra: https://$PublicHost/WayData/monitor"
