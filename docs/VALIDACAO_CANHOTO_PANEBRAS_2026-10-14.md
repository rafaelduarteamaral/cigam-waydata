# Validação de canhoto Panebras — 2026-10-14 (NF 452229, rota 5473776)

## Sintoma

A WayData publicou o canhoto da NF `452229` (pedido `42352`, cliente `001524`, rota `42352-1009`, código `5473776`) em 13/10/2026, mas o worker não registrou o anexo no CIGAM.

## Evidência da API (GET, credencial local)

- `/rota/capa?dataInicial=2026-10-09&dataFinal=2026-10-09` retornou a capa `42352-1009` com `codigo=5473776`, status `AguardandoAbertura`.
- `/rota?codigorota=5473776`: em `entregas[1]` (`codigo=52877626`, cliente `001524`) o campo `statusMarcacao` da **parada** é `Pendente`, enquanto o **pedido** `42352` tem `status.descricao=Entregue`, `status.motivo=Realizado`, `status.data=2026-10-13T11:39:48` e uma foto `codigo=0` com URL HTTP(S) e sem `statusMarcacao`.
- Na rota validada em 01/10 (`5445535`), a parada da NF `4227` tinha `statusMarcacao=Realizado`; por isso o canhoto foi aceito naquele caso.

## Causa

`mapIntegraWayDeliveries` copiava `entregas[].statusMarcacao` para cada pedido sem marcação própria. Em `isReceiptReady`, esse valor herdado (`Pendente`) tinha precedência sobre a regra de foto sem tipo, e a foto da NF `452229` era descartada: `receiptPending=true`, sem `receiptUrl`.

## Correção

A marcação da parada só é herdada quando o pedido não tem status próprio (`status.descricao` ausente ou `NaoInformado` e sem `status.data`). Um pedido marcado individualmente (`Entregue`, com data) passa a aceitar a foto publicada mesmo com a parada `Pendente`. Um `statusMarcacao` explícito na foto ou no pedido continua respeitado, e fotos tipadas continuam exigindo `Realizado`.

Resultado do mapeamento sobre o retorno real:

| | antes | depois |
|---|---|---|
| NF 452229 | `receiptPending=true`, sem URL | `receiptPending=false`, URL do canhoto |
| NF 452230 | `receiptPending=true`, sem URL | inalterado |

`scripts/validate-receipt.ts --route-code=5473776 --invoice=452229` (preview) baixou a foto: `image/png`, 305.636 bytes.

## Próximos passos

1. Publicar o build no servidor Panebras e reiniciar o serviço do worker.
2. A rota `5473776` permanece em `data/runtime/pending-receipt-routes.json`, então o próximo ciclo reconsulta o código mesmo fora da janela de quatro dias. Se não estiver, usar o botão Reprocessar no monitor ou `validate-receipt.ts --write`.
