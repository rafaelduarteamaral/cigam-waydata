# CIGAM x WayData

Integração logística TypeScript entre as APIs do CIGAM e da WayData, com worker independente, monitor Next.js e auditoria em arquivos JSONL diários.

## Início rápido

Use o Node 23. O `.env` da raiz já precisa estar preenchido (não versionar credenciais).

```bash
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
nvm use 23
cd /Users/rafaelduarteamaral/www/cigam
```

Primeira vez (só se faltar `node_modules`):

```bash
pnpm install
```

Ambiente demo local (sem APIs reais):

```bash
cp .env.example .env
pnpm seed:demo
pnpm dev:monitor
```

## Subir o ambiente no dia a dia

Dois terminais. O monitor fica em <http://127.0.0.1:3000>.

Terminal 1 — monitor:

```bash
cd /Users/rafaelduarteamaral/www/cigam/apps/monitor
./node_modules/.bin/next dev -H 127.0.0.1 -p 3000
```

Terminal 2 — worker em leitura (usa o `SYNC_MODE` do `.env`; com `read_only` não grava na WayData):

```bash
cd /Users/rafaelduarteamaral/www/cigam/apps/worker
./node_modules/.bin/tsx src/main.ts
```

Se o `pnpm` estiver no PATH, o equivalente é:

```bash
cd /Users/rafaelduarteamaral/www/cigam
pnpm dev:monitor
pnpm start:worker
```

`pnpm dev:worker` sobe o worker com reload (`tsx watch`). Prefira `pnpm start:worker` ou o `tsx src/main.ts` acima para um ciclo estável.

## Homologação one-shot (escrita)

Não altere o `.env` permanente. Este comando sobe, sincroniza a carga da allowlist e encerra. A escrita não fica ligada.

```bash
cd /Users/rafaelduarteamaral/www/cigam
ENV_FILE=/Users/rafaelduarteamaral/www/cigam/.env \
SYNC_MODE=write \
SYNC_ONCE=true \
SYNC_ROUTE_IDS=36858 \
SYNC_MAX_ROUTES=1 \
./node_modules/.bin/tsx scripts/homolog-once.ts
```

Equivalente com `pnpm`:

```bash
ENV_FILE=/Users/rafaelduarteamaral/www/cigam/.env \
SYNC_MODE=write SYNC_ONCE=true SYNC_ROUTE_IDS=36858 SYNC_MAX_ROUTES=1 \
  pnpm homolog:once
```

Deixe `SYNC_MODE=write` só neste comando. No `.env` permanente continue `read_only` até o aceite.

## Validação

```bash
cd /Users/rafaelduarteamaral/www/cigam
pnpm test
pnpm typecheck
pnpm build
```

## Documentação

- [Implementação](docs/IMPLEMENTACAO_CIGAM_WAYDATA.md)
- [Pendências](docs/PENDENCIAS_CIGAM_WAYDATA.md)
- [Homologação e go-live](docs/HOMOLOGACAO_GOLIVE.md)
- [Produção no IIS (Windows)](docs/IIS_WINDOWS.md)

## Segurança

- Não versionar `.env`.
- Não registrar Bearer Tokens ou canhotos em Base64.
- Manter `data/` em volume persistente e fora da área pública.
- A integração externa permanece desabilitada até a configuração dos contratos CIGAM, massa controlada e aprovação funcional. O Bearer validado deve permanecer apenas no cofre/ambiente local.

## Ativação controlada

1. Configure os caminhos oficiais do CIGAM no `.env`.
2. Informe credenciais pelo cofre de segredos, nunca em arquivos versionados.
3. Valide primeiro em homologação com `SYNC_MODE=read_only`.
4. Libere escrita só com massa aprovada e `CodigoRoteirizacao` real na WayData.
5. One-shot: `pnpm homolog:once` (allowlist `SYNC_ROUTE_IDS`, não altera o `.env` permanente).
6. Após aceite, ative `SYNC_MODE=write` e acompanhe no monitor.

O monitor aceita `MONITOR_API_KEY` quando a infraestrutura injeta `x-monitor-key`. Sem essa variável, mantenha o serviço restrito à rede interna/VPN e protegido pelo proxy corporativo.

## Produção no IIS (Windows)

O IIS faz reverse proxy para o monitor em `127.0.0.1:3000`. O worker sobe como **serviço Windows**, não como site IIS. Passo a passo: [docs/IIS_WINDOWS.md](docs/IIS_WINDOWS.md).

```powershell
pnpm install
pnpm --filter @cigam-waydata/monitor build
pnpm start:prod:monitor
pnpm start:prod:worker
```
