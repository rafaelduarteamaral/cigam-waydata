# Evidências das consultas da API WayData

> **Registro histórico imutável:** este diretório preserva o resultado observado em 18/07/2026. Ele não representa o estado atual da credencial nem deve ter seus arquivos JSON reescritos.

Data da execução: 18/07/2026  
Ambiente: homologação  
Operações executadas: somente leitura (`GET`)

## Resultado

As cinco consultas documentadas foram executadas nas URLs de homologação fornecidas. Todas retornaram `401 Unauthorized`.

O cabeçalho de autenticação retornado pelo servidor informa:

```text
Bearer error="invalid_token", error_description="The signature is invalid"
```

O token foi encontrado integralmente no MIC, possui três segmentos JWT e seu payload é decodificável. O mesmo resultado ocorreu nas duas bases indicadas pela documentação:

- `https://wayds.net/integraway/api`
- `https://wayds.net:8081/integraway/api`

Isso indica que a API está acessível, mas a credencial presente no MIC não é aceita atualmente. É necessário solicitar um novo Bearer Token de homologação à WayData.

## Consultas tentadas

| Evidência | Operação | Resultado |
|---|---|---:|
| `clientes_pagina_1.json` | Listar clientes, página 1 | 401 |
| `cliente_exemplo_id.json` | Buscar cliente pelo código de exemplo | 401 |
| `remessas.json` | Consultar remessas | 401 |
| `rotas_capa_periodo.json` | Consultar capas de rota por período | 401 |
| `rota_exemplo_completa.json` | Consultar rota completa pelo código de exemplo | 401 |

Cada arquivo contém URL, método, horário, status HTTP e corpo retornado. A credencial foi substituída por `Bearer <REDACTED>` e não foi gravada nas evidências.

## Próxima execução registrada em 18/07/2026

Na data da execução, ficou registrado que, após receber uma credencial válida, as consultas deveriam ser repetidas e códigos reais retornados pela listagem deveriam ser usados para capturar exemplos completos de cliente e rota. Essa ação foi concluída na revalidação abaixo.

Operações de criação, atualização ou exclusão (`PUT`, `PATCH` e `DELETE`) continuaram condicionadas a autorização específica e dados de teste previamente combinados, pois modificam o ambiente de homologação.

## Revalidação em 08/08/2026

A credencial de homologação posteriormente fornecida foi armazenada de forma cifrada no Kaivor e aceita pela API. A bateria ampliada, executada pelo MCP do Kaivor, obteve:

- 15 consultas `GET` executadas;
- 12 respostas `200`;
- três respostas `204`;
- nenhuma resposta `401`.

A busca específica de cliente foi repetida com um código real e retornou `200`. A consulta de rotas completas foi ajustada para uma janela de quatro dias, limite aceito pela API, e também retornou `200`. Os três `204` ocorreram em consultas sem conteúdo disponível para os parâmetros usados, não em falhas de autenticação.

O próximo passo é homologar `PUT`, `PATCH` e `DELETE` com massa controlada e autorização funcional, cobrindo cadastro/alteração de cliente, rota/pedido, cancelamento, retorno de entrega e canhoto.
