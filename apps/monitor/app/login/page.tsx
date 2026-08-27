"use client";

import { LockKeyhole, Waypoints } from "lucide-react";
import { FormEvent, useState } from "react";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Derive the published prefix from the current URL. This also works when
  // the monitor is deployed below an IIS virtual application.
  const apiBase = typeof window === "undefined"
    ? "/WayData/monitor"
    : window.location.pathname.replace(/\/login\/?$/, "") || "/WayData/monitor";

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${apiBase}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
      if (!response.ok) { setError("Usuário ou senha inválidos."); return; }
      window.location.assign(apiBase);
    } catch { setError("Não foi possível validar o acesso. Tente novamente."); }
    finally { setLoading(false); }
  }

  return (
    <main className="login-shell">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-brand"><span className="login-mark"><Waypoints size={22} /></span><div><small>OPERAÇÃO LOGÍSTICA</small><strong>CIGAM <i>×</i> WayData</strong></div></div>
        <div className="login-copy"><span><LockKeyhole size={15} /> Área restrita</span><h1 id="login-title">Acompanhe a operação com segurança.</h1><p>Use as credenciais autorizadas para consultar eventos, rotas e ocorrências da integração.</p></div>
        <form className="login-form" onSubmit={login}>
          <label>Usuário<input name="username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required /></label>
          <label>Senha<input name="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          {error && <p className="login-error" role="alert">{error}</p>}
          <button className="login-submit" type="submit" disabled={loading}>{loading ? "Validando acesso…" : "Entrar no monitor"}</button>
        </form>
        <p className="login-footnote">Acesso monitorado · Dados operacionais protegidos</p>
      </section>
    </main>
  );
}
