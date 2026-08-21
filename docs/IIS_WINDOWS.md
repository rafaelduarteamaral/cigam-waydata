# Produção no IIS (Windows)

Guia do que funcionou no servidor da Panebras (`CIGAM-PANEBRAS`). O IIS **não hospeda** o Node. Ele só publica o monitor já em execução.

## Arquitetura

| Peça | Onde | Porta / URL |
|---|---|---|
| Monitor Next.js | Serviço Windows `cigam-waydata-monitor` | só `127.0.0.1:3000` |
| Worker | Serviço Windows `cigam-waydata-worker` | nenhuma |
| IIS (`CGPortaisPanebras`) | reverse proxy HTTPS | `https://panebrasportais.cigam.cloud/WayData/monitor` |

Não crie um site IIS novo. Não altere Bindings do portal CIGAM. O monitor entra como **aplicativo** no site que já existe.

```
Browser  →  IIS :443  (CGPortaisPanebras /WayData/monitor)
                ↓  URL Rewrite + ARR
         Node 127.0.0.1:3000/WayData/monitor
```

## Caminhos no servidor Panebras

```
Instalação:  C:\inetpub\wwwroot\CGPortaisPanebras\WayData\cigam-waydata
Dados:       C:\inetpub\wwwroot\CGPortaisPanebras\WayData\cigam-waydata\data
.env:        C:\inetpub\wwwroot\CGPortaisPanebras\WayData\cigam-waydata\.env
Proxy IIS:   C:\inetpub\wwwroot\CGPortaisPanebras\WayData\cigam-waydata\deploy\iis
URL pública: https://panebrasportais.cigam.cloud/WayData/monitor
```

O physical path do aplicativo IIS é **somente** `deploy\iis` (o `web.config`). Não aponte o site para a raiz do repositório, para `data\` nem para `apps\monitor`.

## 1. Pré-requisitos

- Windows Server com IIS
- Node.js 22 LTS (64-bit)
- Corepack / pnpm 11.9.0
- [URL Rewrite](https://www.iis.net/downloads/microsoft/url-rewrite) — já costuma estar no servidor
- **[Application Request Routing 3.0 x64](https://www.microsoft.com/en-us/download/details.aspx?id=47333)** — obrigatório
- [WinSW](https://github.com/winsw/winsw/releases): prefira `WinSW-x64.exe` (não precisa de .NET). Se usar `WinSW.NET8.exe`, instale o **.NET 8 Runtime**, não o SDK

Sem o ARR o PowerShell mostra:

```text
O objeto de configuração de destino 'system.webServer/proxy' não foi encontrado
```

URL Rewrite sozinho **não** encaminha para a porta 3000. Instale o MSI `requestRouter_amd64.msi`. Se pedir dependência, instale antes o [Web Farm Framework 1.1 x64](https://download.microsoft.com/download/5/7/0/57065640-4665-4980-a2f1-4d5940b577b0/webfarm_v1.1_amd64_en_us.msi). Depois `iisreset`.

O aviso `Download a .NET SDK` no WinSW.NET8 **não** é erro da aplicação.

## 2. Código e `.env`

Repositório: https://github.com/rafaelduarteamaral/cigam-waydata

O `.env` fica na **raiz do código**. Não versionar. Não enviar token por WhatsApp. Modelo: `deploy/windows/env.iis.example`.

Obrigatório no Windows:

```env
NODE_ENV=production
TZ=America/Sao_Paulo
DATA_DIRECTORY=C:\inetpub\wwwroot\CGPortaisPanebras\WayData\cigam-waydata\data
SYNC_MODE=read_only
NEXT_PUBLIC_BASE_PATH=/WayData/monitor
```

`DATA_DIRECTORY` tem que terminar em `\data`. Se apontar só para a raiz do projeto, o worker grava `runtime\worker-health.json` num lugar e o monitor lê outro: o health fica `{"status":"unknown","worker":null}`.

```powershell
$root = "C:\inetpub\wwwroot\CGPortaisPanebras\WayData\cigam-waydata"
New-Item -ItemType Directory -Force -Path "$root\data\logs","$root\data\runtime","$root\data\reprocess","$root\deploy\windows\logs" | Out-Null
```

## 3. Build e serviços Windows

```powershell
cd C:\inetpub\wwwroot\CGPortaisPanebras\WayData\cigam-waydata
corepack enable
corepack prepare pnpm@11.9.0 --activate
pnpm install
$env:NEXT_PUBLIC_BASE_PATH="/WayData/monitor"
pnpm --filter @cigam-waydata/monitor build
```

O worker sobe pelo `tsx`; não precisa de `next build` nele.

Serviços (WinSW em `deploy\windows`):

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\windows\install-services.ps1 `
  -InstallRoot C:\inetpub\wwwroot\CGPortaisPanebras\WayData\cigam-waydata
```

O script acha o `WinSW.exe` sozinho. Se o serviço já existir, ele só atualiza o XML e reinicia. “O serviço especificado já existe” é normal.

Health **depois** do `basePath` (o `/api/health` na raiz passa a 404):

```powershell
curl.exe http://127.0.0.1:3000/WayData/monitor/api/health
```

Tem que vir JSON com `worker` preenchido, não `null`.

## 4. Publicar no IIS que já existe

Não clique em **URL Rewrite**, **Redirecionamento HTTP** nem **Bindings** no site `CGPortaisPanebras` / pasta `/WayData`. Isso altera o portal CIGAM.

1. Instale o ARR e, no servidor **CIGAM-PANEBRAS** (topo da árvore, não no site): **Application Request Routing Cache** → **Server Proxy Settings** → **Enable proxy** → Apply.
2. Physical path do aplicativo: `...\cigam-waydata\deploy\iis`.
3. Alias: `monitor` debaixo de `WayData` → URL `/WayData/monitor`.
4. App pool: **No Managed Code**.

Tudo isso o script faz:

```powershell
cd C:\inetpub\wwwroot\CGPortaisPanebras\WayData\cigam-waydata
$env:NEXT_PUBLIC_BASE_PATH="/WayData/monitor"
pnpm --filter @cigam-waydata/monitor build
powershell -ExecutionPolicy Bypass -File .\deploy\windows\publish-iis-monitor.ps1
```

O `web.config` reescreve para `http://127.0.0.1:3000/WayData/monitor/...`. A porta 3000 não deve ficar aberta na internet.

URL pública:

**https://panebrasportais.cigam.cloud/WayData/monitor**

`/WayData` e `/WayData/cigam-waydata` continuam 403 — não são o monitor.

## 5. Firewall e NTFS

- Entrada pública: só 80/443 no IIS.
- `127.0.0.1:3000` não precisa de regra de entrada.
- A conta do serviço (Local System ou dedicada) precisa de leitura no código e escrita em `DATA_DIRECTORY` e `deploy\windows\logs`.
- Saída HTTPS para CIGAM (`*.cigam.cloud`) e WayData (`wayds.net` / `restrito.waydatasolution.com.br`).

## 6. Atualizar a aplicação

```powershell
cd C:\inetpub\wwwroot\CGPortaisPanebras\WayData\cigam-waydata
git pull
$env:NEXT_PUBLIC_BASE_PATH="/WayData/monitor"
pnpm install
pnpm --filter @cigam-waydata/monitor build
Restart-Service cigam-waydata-monitor, cigam-waydata-worker
```

`git pull` sozinho **não** atualiza o front. Sempre rebuild do monitor. Não apague `data\runtime\route-map.json`. Não recicle o IIS para atualizar o worker.

## 7. Comandos úteis

```powershell
Get-Service cigam-waydata-*
Restart-Service cigam-waydata-monitor, cigam-waydata-worker
Stop-Service cigam-waydata-worker
Get-Content C:\inetpub\wwwroot\CGPortaisPanebras\WayData\cigam-waydata\deploy\windows\logs\*.log -Tail 80
curl.exe http://127.0.0.1:3000/WayData/monitor/api/health
```

Rollback de escrita: no `.env`, `SYNC_MODE=read_only` e `Restart-Service cigam-waydata-worker`.

## 8. Checklist

1. ARR instalado e **Enable proxy** = True
2. `DATA_DIRECTORY=...\cigam-waydata\data` (igual no `.env` e no XML do monitor)
3. `worker-health.json` em `data\runtime\` (não na raiz do repo)
4. `pnpm --filter @cigam-waydata/monitor build` com `NEXT_PUBLIC_BASE_PATH=/WayData/monitor`
5. `curl.exe http://127.0.0.1:3000/WayData/monitor/api/health` com `worker` ≠ null
6. Aplicativo IIS `/WayData/monitor` aponta para `deploy\iis`
7. Browser: `https://panebrasportais.cigam.cloud/WayData/monitor`
8. `SYNC_MODE=read_only` no primeiro dia; `write` só depois do aceite

## 9. Problemas que já apareceram

| Sintoma | Causa | O que fazer |
|---|---|---|
| `system.webServer/proxy` não encontrado | ARR ausente | Instalar ARR 3.0 x64 e `iisreset` |
| Health `worker: null` | `DATA_DIRECTORY` sem `\data` | Ajustar `.env`, reiniciar os dois serviços |
| `Download a .NET SDK` | WinSW.NET8 sem Runtime 8 | Usar `WinSW-x64.exe` |
| “O serviço especificado já existe” | WinSW tentou instalar de novo | Ignorar; serviço já está lá |
| `Invoke-WebRequest` quebra no PowerShell antigo | Falta `-UseBasicParsing` | Usar `curl.exe` |
| 403 em `/WayData` ou na pasta do código | Pasta sem `index.html` | Abrir `/WayData/monitor` |
| Front local ok, URL pública em branco | Proxy desligado ou app IIS errado | ARR Enable proxy + `publish-iis-monitor.ps1` |
| `/api/health` na porta 3000 dá 404 | `basePath` ativo | Usar `/WayData/monitor/api/health` |
| CSS/`/api` caem no portal CIGAM | Monitor buildado sem `basePath` | Rebuild com `NEXT_PUBLIC_BASE_PATH` |
