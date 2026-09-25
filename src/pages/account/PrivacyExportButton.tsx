import { useState, type FormEvent } from "react";
import { Download, Eye, EyeOff, X } from "lucide-react";
import { api } from "../../lib/api";

export function PrivacyExportButton({
  onNotice,
}: {
  onNotice: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [reauthOpen, setReauthOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [reauthError, setReauthError] = useState("");

  async function downloadExport() {
    const data = await api<unknown>("/v1/account/profile?export=1");
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    try {
      const link = document.createElement("a");
      link.href = url;
      link.download = "hortivitalmix-meus-dados.json";
      link.click();
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function requestExport() {
    setBusy(true);
    onNotice("");
    try {
      await downloadExport();
    } catch (error) {
      if ((error as Error).message === "RECENT_AUTH_REQUIRED") {
        setReauthError("");
        setReauthOpen(true);
      } else {
        onNotice("Não foi possível gerar a exportação.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function reauthenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setReauthError("");
    try {
      await api("/v1/account/reauthenticate", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      setPassword("");
      setReauthOpen(false);
      await downloadExport();
      onNotice("Identidade confirmada. Seus dados foram exportados.");
    } catch (error) {
      const code = (error as Error).message;
      setReauthError(
        code === "INVALID_CREDENTIALS"
          ? "Senha incorreta. Tente novamente."
          : "Não foi possível confirmar sua identidade agora.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        className="secondary account-export"
        disabled={busy}
        onClick={() => void requestExport()}
      >
        <Download />
        {busy ? "Preparando…" : "Exportar meus dados (JSON)"}
      </button>

      {reauthOpen && (
        <div className="account-sheet-backdrop" role="presentation">
          <form className="account-sheet" onSubmit={reauthenticate}>
            <header>
              <div>
                <span className="eyebrow">Proteção LGPD</span>
                <h2>Confirme sua identidade</h2>
              </div>
              <button
                type="button"
                aria-label="Fechar"
                onClick={() => {
                  setPassword("");
                  setReauthError("");
                  setReauthOpen(false);
                }}
              >
                <X />
              </button>
            </header>
            <p>
              Para exportar seus dados pessoais, confirme sua senha. A
              confirmação vale por 15 minutos somente nesta sessão.
            </p>
            <label>
              Senha atual
              <span className="password-input">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  minLength={1}
                  maxLength={128}
                  required
                  autoFocus
                />
                <button
                  type="button"
                  className="password-toggle"
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  onClick={() => setShowPassword((value) => !value)}
                >
                  {showPassword ? <EyeOff /> : <Eye />}
                </button>
              </span>
            </label>
            {reauthError && (
              <p role="alert" className="field-error">
                {reauthError}
              </p>
            )}
            <button className="primary" disabled={busy}>
              {busy ? "Confirmando…" : "Confirmar e exportar"}
            </button>
          </form>
        </div>
      )}
    </>
  );
}
