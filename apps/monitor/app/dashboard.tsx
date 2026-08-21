"use client";

import type { IntegrationEntity, IntegrationStatus, LogEvent } from "@cigam-waydata/shared";
import { Activity, AlertTriangle, ArrowUpRight, CheckCircle2, Clock3, Download, Eye, Filter, RefreshCw, RotateCcw, Search, ServerCog, Waypoints, X } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";

type DashboardProps = {
  initialEvents: LogEvent[];
  initialHealth: Record<string, unknown> | null;
  today: string;
};

const statusLabels: Record<IntegrationStatus, string> = {
  PENDING: "Pendente",
  PROCESSING: "Processando",
  SUCCESS: "Sucesso",
  ERROR: "Erro",
  CANCELLED: "Cancelado",
};

const entityLabels: Record<IntegrationEntity, string> = {
  CLIENT: "Cliente",
  SHIPMENT: "Remessa",
  ROUTE: "Rota",
  ORDER: "Pedido",
  RECEIPT: "Canhoto",
  SYSTEM: "Sistema",
};

const operationLabels = { CREATE: "Criação", READ: "Consulta", UPDATE: "Atualização", DELETE: "Exclusão", REPROCESS: "Reprocessamento", SYNC: "Sincronização" } as const;

function referenceOf(event: LogEvent): string {
  const reference = event.reference;
  return reference.invoice ?? reference.route ?? reference.order ?? reference.shipment ?? reference.client ?? event.correlationId;
}

function formatTime(timestamp: string): string {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(timestamp));
}

export function Dashboard({ initialEvents, initialHealth, today }: DashboardProps) {
  const [events, setEvents] = useState(initialEvents);
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [status, setStatus] = useState("ALL");
  const [entity, setEntity] = useState("ALL");
  const [operation, setOperation] = useState("ALL");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<LogEvent | null>(null);
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const filtered = useMemo(() => events.filter((event) => {
    if (status !== "ALL" && event.status !== status) return false;
    if (entity !== "ALL" && event.entity !== entity) return false;
    if (operation !== "ALL" && event.operation !== operation) return false;
    const haystack = `${event.correlationId} ${referenceOf(event)} ${event.message}`.toLowerCase();
    return haystack.includes(search.toLowerCase());
  }), [entity, events, operation, search, status]);

  const metrics = useMemo(() => ({
    success: events.filter((event) => event.status === "SUCCESS").length,
    errors: events.filter((event) => event.status === "ERROR").length,
    pending: events.filter((event) => event.status === "PENDING" || event.status === "PROCESSING").length,
  }), [events]);
  const pageSize = 25;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visibleEvents = filtered.slice((page - 1) * pageSize, page * pageSize);
  const isReadOnly = initialHealth?.syncMode === "READ_ONLY";
  const apiBase = process.env.NEXT_PUBLIC_BASE_PATH ?? "/WayData/monitor";
  useEffect(() => setPage(1), [dateFrom, dateTo, status, entity, operation, search]);

  function refresh() {
    startTransition(async () => {
      const response = await fetch(`${apiBase}/api/logs?from=${dateFrom}&to=${dateTo}`, { cache: "no-store" });
      const data = await response.json() as { events: LogEvent[] };
      setEvents(data.events);
      setNotice("Dados atualizados agora.");
    });
  }

  function reprocess(event: LogEvent) {
    startTransition(async () => {
      const response = await fetch(`${apiBase}/api/reprocess`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ correlationId: event.correlationId, entity: event.entity, reference: referenceOf(event) }),
      });
      setNotice(response.ok ? `Reprocessamento solicitado para ${referenceOf(event)}.` : "Não foi possível solicitar o reprocessamento.");
    });
  }

  function exportLogs() {
    window.location.assign(`${apiBase}/api/export?from=${dateFrom}&to=${dateTo}`);
  }

  const workerSeen = typeof initialHealth?.lastSeenAt === "string" ? formatTime(initialHealth.lastSeenAt) : "sem sinal";
  const syncMode = initialHealth?.syncMode === "READ_ONLY" ? "Somente leitura" : initialHealth?.syncMode === "WRITE" ? "Escrita ativa" : "Desativado";

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand-mark"><Waypoints size={23} strokeWidth={2.4} /></div>
        <div className="brand-copy">
          <span className="eyebrow">OPERAÇÃO LOGÍSTICA</span>
          <h1>CIGAM <span>×</span> WayData</h1>
        </div>
        <div className="worker-state">
          <span className="pulse" />
          <div><strong>Worker {initialHealth ? "conectado" : "aguardando"}</strong><small>{syncMode} · último sinal: {workerSeen}</small></div>
        </div>
      </header>

      <section className="hero">
        <div>
          <span className="section-tag"><Activity size={14} /> Monitor de integração</span>
          <h2>Controle cada envio.<br /><em>Resolva o que importa.</em></h2>
          <p>Rastreabilidade operacional entre o ERP e a execução de entregas.</p>
        </div>
        <div className="hero-orbit" aria-hidden="true"><ServerCog /><span /><ArrowUpRight /></div>
      </section>

      <section className="filter-panel">
        <div className="panel-title"><Filter size={16} /><strong>Filtros operacionais</strong><span>{filtered.length} ocorrências</span></div>
        <div className="filter-grid">
          <label>Data inicial<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
          <label>Data final<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
          <label>Status<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="ALL">Todos</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Entidade<select value={entity} onChange={(event) => setEntity(event.target.value)}><option value="ALL">Todas</option>{Object.entries(entityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Operação<select value={operation} onChange={(event) => setOperation(event.target.value)}><option value="ALL">Todas</option>{Object.entries(operationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="search-field">Referência<Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Rota, pedido, NF ou cliente" /></label>
          <button className="primary-button" onClick={refresh} disabled={isPending}><RefreshCw size={16} className={isPending ? "spin" : ""} />Atualizar</button>
          <button className="secondary-button" onClick={exportLogs}><Download size={16} />Exportar</button>
        </div>
      </section>

      <section className="metrics">
        <article className="metric metric-success"><span><CheckCircle2 /></span><div><small>ENVIADOS NO PERÍODO</small><strong>{metrics.success.toLocaleString("pt-BR")}</strong><p>Processamentos concluídos</p></div></article>
        <article className="metric metric-error"><span><AlertTriangle /></span><div><small>ERROS</small><strong>{metrics.errors.toLocaleString("pt-BR")}</strong><p>Precisam de atenção</p></div></article>
        <article className="metric metric-pending"><span><Clock3 /></span><div><small>PENDENTES</small><strong>{metrics.pending.toLocaleString("pt-BR")}</strong><p>Na fila ou processando</p></div></article>
        <article className="metric metric-sync"><span><RefreshCw /></span><div><small>ÚLTIMO SINAL</small><strong className="metric-time">{workerSeen}</strong><p>Saúde do serviço</p></div></article>
      </section>

      {notice && <button className="notice" onClick={() => setNotice(null)}>{notice}<span>×</span></button>}

      <section className="log-panel">
        <div className="log-heading"><div><span className="live-dot" />Fluxo de integração</div><small>Eventos mais recentes primeiro</small></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Data / hora</th><th>Operação</th><th>Tipo</th><th>Referência</th><th>Tent.</th><th>Status</th><th>Mensagem</th><th>Ação</th></tr></thead>
            <tbody>
              {visibleEvents.map((event) => (
                <tr key={event.id}>
                  <td className="mono">{formatTime(event.timestamp)}</td>
                  <td><span className="method">{event.request?.method ?? event.operation}</span><small className="endpoint">{event.request?.endpoint ?? event.direction}</small></td>
                  <td>{entityLabels[event.entity]}</td>
                  <td className="reference">{referenceOf(event)}</td>
                  <td className="mono">{String(event.attempt).padStart(2, "0")}</td>
                  <td><span className={`status status-${event.status.toLowerCase()}`}>{statusLabels[event.status]}</span></td>
                  <td className="message">{event.message}</td>
                  <td><div className="row-actions"><button className="reprocess" onClick={() => setSelected(event)}><Eye size={14} />Detalhes</button><button className="reprocess" onClick={() => reprocess(event)} disabled={isPending || isReadOnly} title={isReadOnly ? "Disponível após homologação da escrita" : undefined}><RotateCcw size={14} />Reprocessar</button></div></td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={8}><div className="empty"><Waypoints /><strong>Nenhum evento encontrado</strong><span>Ajuste os filtros ou execute o worker de demonstração.</span></div></td></tr>}
            </tbody>
          </table>
        </div>
        <footer className="table-footer"><span>Total: <strong>{filtered.length}</strong></span><span>Sucesso: <strong>{metrics.success}</strong></span><span>Erro: <strong>{metrics.errors}</strong></span><span>Pendente: <strong>{metrics.pending}</strong></span><div className="pagination"><button onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1}>Anterior</button><span>Página <strong>{page}</strong> de <strong>{pageCount}</strong></span><button onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={page === pageCount}>Próxima</button></div></footer>
      </section>
      {selected && <aside className="detail-drawer" aria-label="Detalhes do evento"><header><div><small>EVENTO DE INTEGRAÇÃO</small><strong>{referenceOf(selected)}</strong></div><button aria-label="Fechar detalhes" onClick={() => setSelected(null)}><X /></button></header><dl><div><dt>Correlação</dt><dd>{selected.correlationId}</dd></div><div><dt>Data e hora</dt><dd>{formatTime(selected.timestamp)}</dd></div><div><dt>Direção</dt><dd>{selected.direction}</dd></div><div><dt>Entidade</dt><dd>{entityLabels[selected.entity]}</dd></div><div><dt>Operação</dt><dd>{operationLabels[selected.operation]}</dd></div><div><dt>Tentativa</dt><dd>{selected.attempt}</dd></div><div><dt>Status HTTP</dt><dd>{selected.httpStatus ?? "—"}</dd></div><div><dt>Duração</dt><dd>{selected.durationMs != null ? `${selected.durationMs} ms` : "—"}</dd></div><div className="detail-message"><dt>Mensagem</dt><dd>{selected.message}</dd></div></dl><footer><button className="primary-button" disabled={isReadOnly} onClick={() => reprocess(selected)}><RotateCcw size={15} />{isReadOnly ? "Escrita não homologada" : "Reprocessar evento"}</button></footer></aside>}
    </main>
  );
}
