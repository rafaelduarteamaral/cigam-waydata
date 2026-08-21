# Pendências para conclusão da integração CIGAM × WayData

## Status

Atualizado em 20/08/2026.

O software local cobre os cinco ASMX oficiais do CIGAM, o adaptador IntegraWay v3, as regras de roteirização, a correspondência N:N, o tratamento explícito de HTTP 400/404/409/500, a retenção de logs, o fallback do código externo e o lookup de `Empresas` por paginação (porque `cd_empresa` é ignorado na PANEBRAS). Os testes automatizados e o modo somente leitura continuam sendo a trilha segura.

**Bloqueio crítico atual:** na homologação WayData (`wayds.net`), `PUT /Roteirizacao/integracao` responde 200 com remessas em sucesso, mas devolve `codigoRoteirizacao=0` e a rota não fica consultável. Cliente e `remessa/many` persistem. Sem código > 0 o ciclo vivo não fecha.

Este documento não contém tokens, senhas ou outras credenciais.

## Fontes oficiais analisadas

- [API IntegraWay — versão 3.0](https://doc.clickup.com/90132427503/p/h/2ky4zcqf-11733/5dcc66a3125a9b8)
- [Roteirização externa — Roteirizacao/Integracao](https://doc.clickup.com/90132427503/p/h/2ky4zcqf-11813/cec7523e08bfe18)
- Runbook operacional: [HOMOLOGACAO_GOLIVE.md](./HOMOLOGACAO_GOLIVE.md)

## 1. Bloqueios externos obrigatórios

- [x] Receber o contrato oficial do CIGAM para registrar o acompanhamento ou histórico da nota fiscal.
- [x] Receber o contrato oficial do CIGAM para anexar ou vincular o canhoto à nota fiscal correta.
- [x] Receber o contrato oficial do CIGAM para gravar o estado da integração e o código externo retornado pela WayData.
- [x] Confirmar, para cada endpoint CIGAM, autenticação, método HTTP, URL, campos obrigatórios, limites, respostas e erros esperados.
- [ ] Confirmar se o CIGAM passará a persistir o `CodigoRoteirizacao` da WayData em campo próprio; hoje o código vai para `data/runtime/route-map.json` e para um acompanhamento `INT` na primeira NF da carga, porque `Cargas_MudaSituacao` não tem esse campo.
- [x] Definir massa controlada de homologação (`36858`, clientes `001277`/`002628`, placa `JIU9241`).
- [x] Obter token e executar `PUT`/`PATCH`/`DELETE` na WayData de homologação (clientes e remessas ok; roteirização quebrada no retorno do código).
- [ ] **WayData:** corrigir `PUT /Roteirizacao/integracao` para devolver `CodigoRoteirizacao > 0` e rota consultável.
- [ ] Confirmar as políticas de produção para SMTP, retenção de logs, armazenamento temporário de canhotos, implantação e suporte.

## 2. Adequação ao contrato real da IntegraWay v3

- [x] Criar um adaptador para a resposta aninhada da WayData: rota → pedidos → marcações → fotos.
- [x] Normalizar `CodigoRota`, identificação do pedido e da nota, `TipoStatus`, `DataEntrega` e demais referências necessárias.
- [x] Localizar o canhoto em `Marcacao.Fotos` ou `Fotos` quando `Tipo.FormatoImagem` for igual a `3`.
- [x] Extrair e validar a URL do canhoto sem registrar a URL completa ou credenciais nos logs.
- [x] Mapear os estados oficiais: não informado, entregue, não entregue, parcial e reentrega.
- [x] Definir o comportamento para respostas sem marcação, sem fotos, sem canhoto ou com mais de um canhoto.
- [x] Atualizar os testes contratuais com exemplos reais e sanitizados da IntegraWay v3.

## 3. Validação da roteirização externa

- [x] Usar `codigoRoteirizacao = 0` na criação e o código retornado pela WayData nas atualizações.
- [x] Confirmar `PUT` para criação e `PATCH` para atualização, considerando a inconsistência presente em um exemplo da documentação.
- [x] Validar o limite de 199 clientes únicos por veículo, em vez de tratar apenas a quantidade bruta de remessas.
- [x] Garantir que os clientes inicial, final e de todas as remessas existam antes do envio da rota.
- [x] Validar nome da rota com até 30 caracteres e unicidade por dia.
- [x] Validar códigos de clientes com até 18 caracteres.
- [x] Validar CNPJ no formato exigido pela API.
- [x] Validar datas inicial e final, remessas, itens, descrições e quantidades positivas.
- [x] Tratar de forma explícita as respostas `400`, `404`, `409` e `500`.
- [x] Corrigir datas iguais à meia-noite (`dataFinal` → fim do dia) e remessas com número duplicado.
- [ ] Obter `CodigoRoteirizacao > 0` real na homologação WayData.

## 4. Regras de correspondência e idempotência

- [x] Homologar qual campo da WayData corresponde ao pedido, à entrega e à nota fiscal do CIGAM.
- [x] Definir como tratar uma entrega associada a várias notas fiscais.
- [x] Definir como tratar uma nota fiscal associada a várias entregas ou canhotos.
- [x] Definir o comportamento quando rota, pedido, entrega ou nota fiscal não forem encontrados.
- [x] Criar uma chave idempotente estável para impedir acompanhamento, status ou anexo duplicado.
- [x] Confirmar quando uma entrega parcial ou uma reentrega deve gerar novo acompanhamento ou substituir o anterior.

Regras adotadas no software:

- pedido = `codigoPedido`; nota = `nfe` / `NotaFiscal`; rota = `CodigoRota`;
- uma entrega com várias NFs gera um acompanhamento por NF;
- uma NF com vários canhotos gera um anexo por `receiptId`;
- `404` em carga, rota, pedido ou NF é ignorado de forma idempotente e registrado;
- `PARCIAL` e `REENTREGA` geram novo acompanhamento; não substituem o anterior;
- `NAO_INFORMADO` sem canhoto não gera acompanhamento.

## 5. Fluxo completo de retorno

- [x] Consultar rotas e resultados de entrega na WayData.
- [x] Identificar a entrega e a nota fiscal correspondentes.
- [x] Localizar o canhoto pelo tipo oficial da IntegraWay v3.
- [x] Baixar o arquivo com autenticação e limites de segurança.
- [x] Validar origem, protocolo, tipo MIME, assinatura do arquivo e tamanho máximo.
- [x] Criar o acompanhamento da nota fiscal no CIGAM.
- [x] Anexar o canhoto à nota fiscal correta.
- [x] Persistir o estado da integração e as referências externas no CIGAM.
- [x] Registrar evidência sanitizada de sucesso ou encaminhar a falha para reprocessamento.

## 6. Segurança e confiabilidade

- [x] Manter tokens, senhas, cookies, cabeçalhos de autorização e conteúdo binário fora dos logs e respostas do monitor.
- [x] Restringir downloads de canhoto a origens e protocolos autorizados.
- [x] Impedir redirecionamentos para destinos privados ou não autorizados.
- [x] Limitar tempo, tamanho e quantidade de downloads concorrentes.
- [x] Manter retentativas limitadas, com atraso progressivo, apenas para falhas transitórias.
- [x] Manter fila durável para falhas reprocessáveis e trilha de auditoria por tentativa.
- [x] Manter operações destrutivas e escrita real desabilitadas até a aprovação da homologação.
- [x] Confirmar limpeza e retenção dos arquivos temporários de canhoto.

O download do canhoto permanece em memória. Arquivos residuais em `DATA_DIRECTORY/tmp/receipts` e JSONL mais antigos que `LOG_RETENTION_DAYS` são removidos a cada ciclo.

## 7. Homologação ponta a ponta real

- [x] Tentar criar rota controlada na homologação (`36858` + payload mínimo).
- [x] Confirmar cadastro dos clientes `001277` e `002628` na WayData.
- [ ] Criar rota com `CodigoRoteirizacao > 0` e consultável.
- [ ] Atualizar a rota e verificar se o código externo foi preservado.
- [ ] Consultar o processamento da rota e os pedidos retornados.
- [ ] Produzir ou selecionar uma entrega de teste com canhoto disponível.
- [ ] Recuperar o canhoto real pela estrutura documentada da IntegraWay v3.
- [ ] Registrar o acompanhamento e anexar o arquivo a uma nota fiscal de teste no CIGAM.
- [ ] Repetir o ciclo e comprovar que não há duplicação.
- [ ] Testar entrega parcial, não entrega, reentrega e ausência de canhoto.
- [ ] Testar falha temporária, credencial inválida, payload inválido e reprocessamento manual.
- [ ] Validar visualmente o resultado no CIGAM, na WayData e no monitor.
- [ ] Registrar aceite funcional da PANEBRAS, CIGAM e WayData.

Os cenários acima já possuem cobertura automatizada contra mocks locais. O envio real trava no retorno do código da roteirização.

## 8. Operação e go-live

- [ ] Configurar SMTP e validar alertas sem exposição de dados sensíveis.
- [ ] Definir responsáveis, horários, limites, alertas e procedimento de recuperação.
- [x] Definir retenção e rotação dos arquivos JSONL e temporários.
- [x] Documentar runbook de homologação, rollback e go-live (`docs/HOMOLOGACAO_GOLIVE.md`).
- [x] Disponibilizar one-shot controlado (`pnpm homolog:once`).
- [ ] Preparar ambiente, segredo, volume persistente e execução automática do worker em produção.
- [ ] Executar treinamento do monitor, reprocessamento e consulta de evidências.
- [ ] Executar novamente typecheck, testes, build, smoke e jornada ponta a ponta no ambiente candidato.
- [ ] Aprovar plano de retorno para modo somente leitura em caso de falha.
- [ ] Habilitar escrita apenas após o aceite formal e acompanhar os primeiros ciclos de produção.

O worker verifica o SMTP na subida quando `SMTP_HOST` e `ALERT_RECIPIENTS` estão definidos. Sem essas variáveis, os alertas permanecem desligados.

## Critérios para considerar concluído

A integração somente poderá ser considerada pronta para produção quando:

1. os três contratos de escrita do CIGAM estiverem implementados e homologados;
2. o adaptador da resposta real da IntegraWay v3 estiver coberto por testes;
3. uma rota controlada tiver completado o fluxo WayData → canhoto → acompanhamento/anexo no CIGAM;
4. a repetição do ciclo não criar dados duplicados;
5. os cenários de erro e reprocessamento tiverem sido validados;
6. não houver credenciais ou conteúdo sensível nos logs;
7. houver aceite funcional e autorização formal para ativar a escrita;
8. o plano operacional, de retenção, alertas e recuperação estiver aprovado.

## Próxima ação recomendada

1. Enviar o texto do bloqueio em `docs/HOMOLOGACAO_GOLIVE.md` para a WayData.
2. Quando `CodigoRoteirizacao > 0` voltar a funcionar: `pnpm homolog:once`.
3. Validar canhoto + aceite + SMTP/deploy.
4. Só então `SYNC_MODE=write` em produção.
