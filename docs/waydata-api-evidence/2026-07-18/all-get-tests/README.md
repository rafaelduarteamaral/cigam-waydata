# Testes completos dos endpoints GET da WayData

> **Registro histórico imutável:** este diretório documenta a execução de 18/07/2026. Os arquivos JSON permanecem preservados para auditoria e não descrevem a situação atual da autenticação.

Execução: 18/07/2026  
Ambiente: homologação  
Base utilizada: `https://wayds.net/integraway/api/v1`

## Resultado geral

Foram executadas 15 consultas somente leitura, cobrindo todos os grupos identificados na documentação disponibilizada.

| Grupo | Consultas testadas | Resultado |
|---|---:|---:|
| Clientes | 2 | 401 |
| Remessas | 2 | 401 |
| Rotas | 4 | 401 |
| Pedidos | 4 | 401 |
| Trajetos | 1 | 401 |
| Ativos | 1 | 401 |
| Relatórios | 1 | 401 |

Todas as respostas apresentaram o mesmo diagnóstico no cabeçalho HTTP:

```text
Bearer error="invalid_token", error_description="The signature is invalid"
```

Esse resultado confirma que o servidor está acessível e reconhece o mecanismo Bearer, mas rejeita a assinatura do token fornecido no MIC. Como a autenticação ocorre antes do processamento dos parâmetros, ainda não foi possível validar os contratos e os dados retornados por cada endpoint.

## Evidências

Cada consulta possui um arquivo JSON individual contendo:

- data e hora;
- método e URL;
- cabeçalhos sanitizados;
- status HTTP;
- cabeçalho `WWW-Authenticate`;
- corpo retornado;
- eventual erro de transporte.

O arquivo `summary.json` consolida os 15 resultados. O Bearer Token não foi gravado; aparece apenas como `Bearer <REDACTED>`.

## Próxima ação registrada em 18/07/2026

Na data da execução, ficou registrada a necessidade de obter uma credencial de homologação aceita e repetir a bateria com códigos reais. Essa ação foi concluída na revalidação abaixo.

## Revalidação concluída em 08/08/2026

A nova execução pelo MCP do Kaivor confirmou a autenticação e os contratos de leitura: 12 endpoints retornaram `200`, três retornaram `204` e nenhum retornou `401`. A consulta específica de cliente passou a usar um código real; a consulta de rotas completas passou a respeitar a janela máxima de quatro dias.

Os resultados `204` ocorreram nas consultas de código de entrega, status de rota e trajetória com a massa utilizada. Eles indicam ausência de conteúdo correspondente, não erro de transporte ou autenticação.

As operações mutáveis permanecem pendentes de massa de homologação e autorização explícita para evitar alteração indevida de clientes, remessas, rotas e pedidos.
