# Canhoto Panebras — 01/10/2026

Validação com consultas GET e a credencial local, sem gravar acompanhamentos no CIGAM.

## Evidência da API

- `https://wayds.net/integraway/api/v1/rota/capa?dataInicial=2026-09-20&dataFinal=2026-10-01` retornou HTTP 401.
- A mesma consulta em `https://restrito.waydatasolution.com.br/integraway/api/v1` retornou HTTP 200. Esse é o domínio configurado no ambiente local.
- A capa contém `nome=41561-1001`, `codigo=5445535` e também uma entrada separada `nome=1347610-1001`, `codigo=5445996`.
- `/rota?codigorota=5445535` retornou HTTP 200. Em `entregas[].pedidos[]`, o pedido `41561-4227`, cliente `008017`, tem `nfe=4227`, status `Entregue` e uma foto com `codigo=0`, URL e descrição, sem `statusMarcacao` nem `FormatoImagem`.
- A foto `https://restrito.waydatasolution.com.br/proxyway/api/v1/proxy/foto?codigoFoto=29618247&estabelecimento=915` retornou HTTP 200, `image/png`, 180800 bytes.
- O pedido `41561`, NF `449650`, cliente `000910`, consta na mesma rota com status `NaoInformado` e sem fotos.

O log `EXTCODE:PANEBRAS:41561:1347610` registra o código de roteirização no acompanhamento da NF `449650`. Ele não comprova registro do canhoto da NF `4227`. `CodigoRoteirizacao` e o `codigo` da capa são identificadores distintos; a consulta de detalhes usa o segundo.

## Correção e verificação

O mapeamento aceita fotos sem tipo em `entregas[].pedidos[].fotos` quando há uma URL HTTP(S) e o status de marcação não foi informado. Um status explícito continua sendo respeitado; fotos tipadas continuam exigindo `Realizado`.

Para fotos com `codigo=0`, a URL identifica o canhoto para idempotência, evitando que duas fotos da mesma NF sejam tratadas como a mesma foto. A associação continua usando o `nfe` do pedido que contém a foto.

O mapeamento corrigido foi executado sobre o retorno real e produziu um canhoto disponível para NF `4227`, mantendo NF `449650` sem canhoto. Testes de regressão cobrem associação por NF, múltiplas fotos com código zero, status pendente explícito, fotos tipadas e processamento idempotente do worker.

## Validação controlada

O script `scripts/validate-receipt.ts` consulta apenas a rota informada, seleciona os canhotos da NF escolhida, verifica o conteúdo da imagem e usa o mesmo processamento e idempotência do worker. Ele não executa o ciclo geral nem altera a configuração permanente.

Prévia sem gravação, inclusive quando não há credencial CIGAM:

```bash
node --import tsx scripts/validate-receipt.ts --route-code=5445535 --invoice=4227
```

Gravação limitada à NF escolhida, com `CIGAM_TOKEN` válido no `.env`:

```bash
node --import tsx scripts/validate-receipt.ts --route-code=5445535 --invoice=4227 --write
```

Para usar outro arquivo de configuração, informe `ENV_FILE=/caminho/arquivo.env` no comando. O mesmo `DATA_DIRECTORY` do worker deve ser usado para compartilhar a idempotência. A segunda execução de escrita omite o canhoto já registrado.

Na validação local, os 55 testes, a checagem de tipos de todos os pacotes e o build passaram. O build do monitor emitiu dois avisos de rastreamento de acesso dinâmico ao filesystem no pacote de logs.

O envio real ao CIGAM está pendente porque `CIGAM_TOKEN` está vazio na configuração local. A implantação no servidor Panebras também não foi executada.

## Canhotos que chegam depois e reprocessamento pelo monitor

A cada ciclo de escrita, o worker consulta novamente todas as capas da janela de `DELIVERY_LOOKBACK_DAYS` (padrão: quatro dias, incluindo o dia atual). A janela usa a data local, conforme `TZ`, com padrão `America/Sao_Paulo`. Mesmo uma rota que já teve um canhoto registrado volta a ser consultada enquanto estiver nessa janela; uma nova URL gera um novo registro somente para a NF do pedido. Canhotos já registrados são omitidos pela idempotência.

Rotas sem canhoto ou com falha de gravação continuam na lista persistente de pendências, inclusive fora da janela de datas. A consulta de canhotos ocorre antes da busca de novas cargas no CIGAM. Uma falha ao consultar uma rota WayData ou registrar uma NF não impede a verificação das demais.

O botão Reprocessar agora envia o código da rota WayData e a NF para eventos de retorno. O worker consulta novamente essa rota e processa apenas a NF escolhida. Solicitações antigas de pedido/canhoto que continham apenas a referência exibida recuperam o contexto do evento original nos logs. Se a foto ainda não chegou, o monitor registra a indisponibilidade e a rota continua pendente para os próximos ciclos. Para eventos de rota enviados ao CIGAM, o botão usa o identificador da carga, mesmo quando o evento também contém uma NF.

É necessário atualizar e reiniciar tanto o monitor quanto o worker no servidor para aplicar a correção do botão e da fila. O ciclo automático segue o intervalo configurado em `SYNC_INTERVAL_SECONDS` e requer `SYNC_MODE=write`.
