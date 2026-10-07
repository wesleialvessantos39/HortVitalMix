import { useState } from "react";
import type { ShellSession } from "../hooks/useSession";
import { api } from "../lib/api";
export function ConsumerAccessNotice({
  session,
  onNavigate,
}: {
  session: ShellSession | null;
  onNavigate: (to: string) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const registered = session?.roles.includes("consumer");
  async function enter() {
    setBusy(true);
    setError("");
    try {
      if (session) {
        await api("/v1/auth/logout", { method: "POST", body: "{}" });
        window.dispatchEvent(new Event("hvm:session-cleared"));
      }
      onNavigate(registered ? "/entrar/consumidor" : "/cadastro/consumidor");
    } catch {
      setError("Não foi possível encerrar o acesso atual. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="account-notice">
      <h1>Compras para consumidores</h1>
      <p>
        O portal do produtor reúne suas vendas, o caixa e os pedidos da loja.
        Para comprar de outro produtor, cadastre-se como consumidor e entre
        nesse portal.
      </p>
      {error && <p role="alert">{error}</p>}
      <button className="primary" disabled={busy} onClick={() => void enter()}>
        {busy
          ? "Preparando acesso…"
          : registered
            ? "Entrar como consumidor"
            : "Cadastrar-se como consumidor"}
      </button>
      {session?.activeRole === "producer" && (
        <button
          className="secondary"
          onClick={() => onNavigate("/produtor/vendas")}
        >
          Ir para Minhas vendas
        </button>
      )}
    </section>
  );
}
