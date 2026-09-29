# Validação de consultas em produção — 29/09/2026

Consultas GET autenticadas na base WayData configurada no `.env`, usando o cliente do projeto. Nenhuma escrita em produção foi executada.

| Consulta | Resultado inicial |
| --- | --- |
| `/rota/capa?dataInicial=2026-08-27&dataFinal=2026-08-27` | HTTP 200, lista vazia |
| `/rota/capa?dataInicial=2026-09-29&dataFinal=2026-09-29` | HTTP 200, 151 capas |
| `/rota?codigorota=5420566` | HTTP 200, uma rota, dois pedidos e uma foto |

O contrato real revelou campos ainda não reconhecidos pelo mapeamento:

- A capa identifica a rota com `codigo`.
- Os pedidos ficam em `entregas[].pedidos[]`; o código do cliente está na entrega.
- O pedido usa `codigo`; a data e a descrição do status ficam em `status.data` e `status.descricao`.
- Um pedido veio com `tipoStatus: 0` e `status.descricao: "Entregue"`; a descrição passou a ter prioridade.
- As fotos dos pedidos desse formato contêm `codigo` e `url`, sem `FormatoImagem`. O mapeamento aceita essas fotos como anexos de entrega. Fotos com formato explícito diferente de 3 continuam excluídas.

Esses formatos foram adicionados ao código e cobertos por testes com dados fictícios. Resultado local: 45 testes aprovados e verificação TypeScript aprovada.

As duas tentativas de repetir a consulta da rota 5420566 após o ajuste expiraram em 20 e 30 segundos. Portanto, a leitura inicial foi confirmada, mas a repetição dessa rota com o mapeamento corrigido ficou pendente por timeout.

A consulta de uma segunda rota obtida na capa, 5436498, também expirou em 15 segundos.

O token CIGAM está vazio. A criação de roteirização e a gravação de acompanhamento no CIGAM não foram homologadas. `SYNC_MODE` permanece `disabled`.
