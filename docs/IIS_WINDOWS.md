# Produção no IIS (Windows)

A aplicação tem **dois processos**. O IIS só publica o monitor. O worker não pode viver no application pool: recycle, idle timeout e limite de CPU/memória interrompem o ciclo de sincronização.

| Processo | Onde roda | Porta |
|---|---|---|
| Monitor Next.js (`next start`) | Serviço Windows, só em localhost | `127.0.0.1:3000` |
| Worker (`tsx src/main.ts`) | Serviço Windows | nenhuma |
| IIS | Reverse proxy + HTTPS | `80` / `443` |

Caminho sugerido no servidor: `C:\apps\cigam-waydata`. Dados persistentes: `C:\apps\cigam-waydata\data` (ou outro disco, desde que **o mesmo** `DATA_DIRECTORY` no monitor e no worker).

## 1. Pré-requisitos no Windows

- Windows Server com IIS
- [Node.js 22 LTS](https://nodejs.org/) (64-bit). Node 23 também serve.
- Corepack / pnpm 11.9.0
- [URL Rewrite](https://www.iis.net/downloads/microsoft/url-rewrite)
- [Application Request Routing (ARR)](https://www.iis.net/downloads/microsoft/application-request-routing)
- [WinSW](https://github.com/winsw/winsw/releases) (`WinSW.NET8.exe` ou `WinSW.NET4.exe` se não houver .NET 8)

No PowerShell **como Administrador**:

```powershell
corepack enable
corepack prepare pnpm@11.9.0 --activate
node -v
pnpm -v
```

No IIS Manager: **ARR** → Server Proxy Settings → marque **Enable proxy**. Sem isso o `web.config` de rewrite não funciona.

Se o `pnpm install` falhar por symlink, ative o Developer Mode do Windows ou rode:

```powershell
pnpm config set node-linker hoisted
```

## 2. Copiar o código e o `.env`

1. Copie o repositório para `C:\apps\cigam-waydata`.
2. Coloque o `.env` **na raiz** (não versionar). Ajuste pelo menos:

```env
NODE_ENV=production
TZ=America/Sao_Paulo
DATA_DIRECTORY=C:\apps\cigam-waydata\data
SYNC_MODE=read_only
```

Em produção da WayData, `WAYDATA_BASE_URL` deve apontar para `https://restrito.waydatasolution.com.br/...` só depois do aceite. Até lá deixe `SYNC_MODE=read_only`.

3. Crie as pastas de dados:

```powershell
New-Item -ItemType Directory -Force -Path C:\apps\cigam-waydata\data\logs, C:\apps\cigam-waydata\data\runtime, C:\apps\cigam-waydata\data\reprocess, C:\apps\cigam-waydata\deploy\windows\logs
```

## 3. Build de produção

```powershell
cd C:\apps\cigam-waydata
pnpm install
pnpm --filter @cigam-waydata/monitor build
```

O worker sobe pelo `tsx` a partir do TypeScript; não precisa de `next build` nele.

Teste local **antes** do IIS, em dois `cmd`:

```bat
C:\apps\cigam-waydata\deploy\windows\start-monitor.cmd
C:\apps\cigam-waydata\deploy\windows\start-worker.cmd
```

Abra `http://127.0.0.1:3000/api/health`. Deve devolver JSON com `worker`. Pare os dois `cmd` (Ctrl+C) antes de instalar os serviços.

## 4. Serviços Windows (monitor + worker)

Os XML de exemplo estão em `deploy/windows/`. O script reescreve os caminhos:

```powershell
cd C:\apps\cigam-waydata
powershell -ExecutionPolicy Bypass -File .\deploy\windows\install-services.ps1 -InstallRoot C:\apps\cigam-waydata
```

Baixe o WinSW, copie como `deploy\windows\WinSW.exe` e instale:

```powershell
$d = "C:\apps\cigam-waydata\deploy\windows"
Copy-Item $d\WinSW.exe $d\cigam-monitor.exe
Copy-Item $d\WinSW.exe $d\cigam-worker.exe
Copy-Item $d\CigamWayData.Monitor.xml $d\cigam-monitor.xml
Copy-Item $d\CigamWayData.Worker.xml $d\cigam-worker.xml
& $d\cigam-monitor.exe install
& $d\cigam-worker.exe install
Start-Service cigam-waydata-monitor
Start-Service cigam-waydata-worker
Get-Service cigam-waydata-*
```

Confirme de novo `http://127.0.0.1:3000/api/health`.

Comandos úteis:

```powershell
Restart-Service cigam-waydata-monitor, cigam-waydata-worker
Stop-Service cigam-waydata-worker          # para a escrita/leitura imediatamente
Get-Content C:\apps\cigam-waydata\deploy\windows\logs\*.log -Tail 80
```

Rollback: no `.env` deixe `SYNC_MODE=read_only` (ou `disabled`) e `Restart-Service cigam-waydata-worker`.

## 5. Site IIS (HTTPS na frente)

1. Crie um site, por exemplo **cigam-waydata**.
2. Physical path: `C:\apps\cigam-waydata\deploy\iis` (só o `web.config` de reverse proxy; **não** aponte para `data\`).
3. Binding: HTTP 80 e HTTPS 443 com o certificado corporativo.
4. Application pool: **No Managed Code**, Integrated. Idle timeout = `0`. Regular recycle: desative ou coloque numa janela controlada — o recycle **não** mata o worker (serviço separado), mas derruba o proxy até o IIS voltar.
5. Copie `deploy\iis\web.config` para a pasta física do site se ainda não estiver lá.

O rewrite manda tudo para `http://127.0.0.1:3000`. O Node não deve ficar exposto na placa de rede pública.

Restrinja o monitor à VPN/rede interna. Se quiser chave extra, defina `MONITOR_API_KEY` no `.env` e envie `x-monitor-key` no proxy corporativo.

## 6. Firewall e permissões NTFS

- Entrada pública: só 80/443 no IIS.
- `127.0.0.1:3000` não precisa de regra de firewall de entrada.
- A conta do serviço Windows (Local System, ou uma conta dedicada) precisa de **leitura** no código e **escrita** em `DATA_DIRECTORY` e `deploy\windows\logs`.
- Saída HTTPS para CIGAM (`*.cigam.cloud`) e WayData (`wayds.net` / `restrito.waydatasolution.com.br`).

## 7. Checklist de go-live

1. `pnpm --filter @cigam-waydata/monitor build` ok
2. `http://127.0.0.1:3000/api/health` ok
3. Site IIS responde o monitor
4. Worker `RUNNING` em `Get-Service`
5. `SYNC_MODE=read_only` no primeiro dia
6. SMTP (`SMTP_HOST`, `ALERT_RECIPIENTS`) se houver alerta
7. Só então `SYNC_MODE=write` e `Restart-Service cigam-waydata-worker`

## 8. Atualizar a aplicação

```powershell
Stop-Service cigam-waydata-monitor, cigam-waydata-worker
cd C:\apps\cigam-waydata
git pull
pnpm install
pnpm --filter @cigam-waydata/monitor build
Start-Service cigam-waydata-monitor, cigam-waydata-worker
```

Não recicle o IIS para atualizar o worker. O `data\` permanece; não apague `route-map.json`.
