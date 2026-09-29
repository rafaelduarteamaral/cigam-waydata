/** Payload sanitizado no formato aninhado da IntegraWay v3 (rota → pedidos → marcações → fotos). */
export const integraWayV3Sanitized = {
  CodigoRota: 940148,
  Pedidos: [
    {
      codigoPedido: "36858",
      nfe: "434673,434675",
      codigoCliente: "001277",
      TipoStatus: 1,
      DataEntrega: "2026-08-03T14:00:00",
      Marcacao: {
        Fotos: [
          { Id: "foto-1", Tipo: { FormatoImagem: 1 }, Url: "https://wayds.net/foto-comum.jpg" },
          { Id: "canhoto-1", statusMarcacao: "Realizado", Tipo: { FormatoImagem: 3 }, Url: "https://wayds.net/canhoto-1.png" },
          { Id: "canhoto-2", statusMarcacao: "Realizado", Tipo: { FormatoImagem: 3 }, Url: "https://wayds.net/canhoto-2.png" },
        ],
      },
    },
    {
      codigoPedido: "36859",
      NotaFiscal: "434674",
      TipoStatus: "parcial",
      DataEntrega: "2026-08-03T15:10:00",
    },
    {
      codigoPedido: "36860",
      NotaFiscal: "434676",
      TipoStatus: "reentrega",
      DataEntrega: "2026-08-03T16:40:00",
    },
    {
      codigoPedido: "36861",
      NotaFiscal: "434677",
      TipoStatus: 0,
    },
  ],
};
