# Homologação e go-live — CIGAM × WayData

Atualizado em 20/08/2026.

## O que já está pronto no software

- Worker + monitor + logs JSONL sanitizados
- ASMX CIGAM: `Cargas_Buscar`, `Cargas_BuscarDetalhes`, `Cargas_MudaSituacao`, `Acompanhamento_Criar`, `Empresas`
- WayData: cliente, `Roteirizacao/integracao`, retorno/canhoto, DELETE rota/pedido
- Lookup de empresa por código via paginação (o filtro `cd_empresa` da PANEBRAS é ignorado)
- Testes automatizados locais

## Bloqueio atual (WayData homologação)

Evidência reproduzida em 20/08/2026 com a carga `36858` e payload mínimo:

| Operação | Resultado |
|---|---|
| `PUT /cliente` (`002628`, `001277`) | Persiste; `GET /cliente/id` ok |
| `PUT /remessa/many` | Persiste; aparece em `GET /remessa?flagnaoroteirizado=true` |
| `PUT /Roteirizacao/integracao` | HTTP 200, remessas `situacao=sucesso`, **`codigoRoteirizacao=0`** |
| `GET /rota` e `/rota/capa` no mesmo período | Lista vazia |

Sem `codigoRoteirizacao > 0` o worker não pode gravar `route-map`, fazer PATCH, nem fechar o retorno no CIGAM.

### Texto sugerido para a WayData

> No ambiente `https://wayds.net/integraway/api/v1`, o `PUT /api/v1/Roteirizacao/integracao` responde 200 com remessas em `situacao: sucesso`, porém `codigoRoteirizacao` vem `0` e a rota não aparece em `GET /rota` nem `/rota/capa`. Cadastro de cliente e `PUT /remessa/many` persistem normalmente. Precisamos que a criação devolva um `CodigoRoteirizacao` > 0 consultável, como no exemplo da documentação (`940148`). Token de homologação PANEBRAS / IntegraWay.

## One-shot local (quando a WayData corrigir)

```bash
ENV_FILE=./.env SYNC_MODE=write SYNC_ONCE=true SYNC_ROUTE_IDS=36858 SYNC_MAX_ROUTES=1 \
  pnpm homolog:once
```

Não deixe `SYNC_MODE=write` permanente no `.env` até o aceite.

Checklist do ciclo vivo:

1. Clientes da rota existem na WayData com endereço
2. PUT cria rota e devolve código > 0
3. Código aparece em `data/runtime/route-map.json` e acompanhamento `INT` no CIGAM
4. `Cargas_MudaSituacao` marca a carga
5. Entrega de teste com canhoto → `Acompanhamento_Criar`
6. Segundo ciclo sem duplicar
7. Aceite PANEBRAS + CIGAM + WayData

## Go-live (após aceite)

1. SMTP: `SMTP_HOST`, `ALERT_RECIPIENTS` (e auth se houver)
2. Volume persistente em `DATA_DIRECTORY`
3. Segredos só no cofre / `.env` do servidor
4. Worker + monitor como serviços Windows separados; IIS só na frente do monitor. Ver [IIS_WINDOWS.md](./IIS_WINDOWS.md).
5. Plano de rollback: `SYNC_MODE=read_only`
6. Só então `SYNC_MODE=write` em produção (`restrito.waydatasolution.com.br`)

## Rollback imediato

```bash
SYNC_MODE=read_only
# ou SYNC_MODE=disabled
```

Reinicie o worker. Escrita para. Leitura/monitor continuam.
