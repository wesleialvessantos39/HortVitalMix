import { PageLoading } from "../../components/PageLoading";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { CreditCard, Settings, ShieldCheck } from "lucide-react";
import { z } from "zod";
import type { AdminVerifySessionResponse } from "../../../shared/contracts/adminGovernance";
import {
  GatewayPreparationSchema,
  type CommercePolicy,
} from "../../../shared/contracts/commerce";
import { useSession } from "../../hooks/useSession";
import { api, type ApiFailure } from "../../lib/api";
import { commerceMessage, commerceMutation } from "../../lib/commerce";
import { AdminReauthentication } from "../../components/commerce/AdminReauthentication";
import { RefundPolicy } from "../../components/commerce/RefundPolicy";
import CasesPage from "./CasesPage";
import "./commerce.css";
type SettingsView = {
  revision: number;
  policy: CommercePolicy;
  gateway: z.infer<typeof GatewayPreparationSchema>;
  gatewayAvailable: boolean;
};
export default function AdminCommercePage({
  path,
  access,
  onNavigate,
}: {
  path: string;
  access: AdminVerifySessionResponse;
  onNavigate: (path: string) => void;
}) {
  const { session, loading } = useSession();
  const [settings, setSettings] = useState<SettingsView | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [reauth, setReauth] = useState(false);
  const flight = useRef(false);
  const configuration =
    path === "/admin/pagamentos" || path === "/admin/politica-reembolso";
  const policyAllowed =
    access.role === "platform_super_admin" ||
    access.sectors.includes("refund_management");
  const gatewayAllowed =
    access.role === "platform_super_admin" ||
    access.sectors.includes("payment_configuration");
  useEffect(() => {
    if (!configuration || !session) return;
    const controller = new AbortController();
    void api<SettingsView>("/v1/admin/commerce/settings", {
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) setSettings(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(commerceMessage(e));
      });
    return () => controller.abort();
  }, [configuration, session?.userId]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!session || !settings || flight.current) return;
    flight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const { version, ...policy } = settings.policy;
      void version;
      const result = await commerceMutation<SettingsView>(
        "/v1/admin/commerce/settings",
        {
          expectedRevision: settings.revision,
          policy,
          gateway: settings.gateway,
        },
        session.userId,
      );
      setSettings(result);
      setNotice(
        "Configuração salva e auditada. Novas regras valem para novos aceites; compras anteriores mantêm seus termos.",
      );
    } catch (e) {
      setError(commerceMessage(e));
      if (
        ["ADMIN_REAUTH_REQUIRED", "REAUTH_REQUIRED"].includes(
          (e as ApiFailure).message,
        )
      )
        setReauth(true);
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  if (loading && !session) return <PageLoading label="Conferindo sua conta administrativa…" />;
  if (!session)
    return (
      <p role="alert">
        Sua sessão administrativa não está disponível. Entre novamente.
      </p>
    );
  if (!configuration)
    return (
      <CasesPage
        key={path}
        kind={path === "/admin/reembolsos" ? "refund" : "complaint"}
        session={session}
        adminAccess={access}
        onNavigate={onNavigate}
      />
    );
  return (
    <section className="hvm-commerce admin-page">
      <header className="admin-department-header"><div>
      <span className="admin-kicker">Pagamentos e proteção da compra</span>
      <h1><CreditCard aria-hidden="true" />
        {path === "/admin/politica-reembolso"
          ? "Política de reembolso"
          : "Preparação dos pagamentos"}
      </h1>
      <p>
        Configure a proteção da compra e as referências da futura conta de
        recebimento da plataforma.
      </p>
      </div></header>
      {error && (
        <p role="alert" className="commerce-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="commerce-success">
          {notice}
        </p>
      )}
      {reauth && (
        <AdminReauthentication
          session={session}
          onConfirmed={() => {
            setReauth(false);
            setError("");
            setNotice("Identidade confirmada. Confira e salve sua edição.");
          }}
        />
      )}
      {!settings && !error && <PageLoading label="Carregando configuração…" />}
      {settings && (
        <form onSubmit={(event) => void save(event)}>
          <div className="commerce-grid">
            <article className="commerce-card">
              <h2>
                <ShieldCheck size={20} /> Proteção e retenção
              </h2>
              <fieldset disabled={!policyAllowed || busy}>
                <legend>Política comercial</legend>
                <label>
                  Arrependimento em compra online (dias após recebimento)
                  <input
                    type="number"
                    min={7}
                    max={60}
                    required
                    value={settings.policy.onlineWithdrawalDays}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        policy: {
                          ...settings.policy,
                          onlineWithdrawalDays: Number(event.target.value),
                        },
                      })
                    }
                  />
                </label>
                <label>
                  Devolução comercial presencial (dias; 0 = sem regra adicional)
                  <input
                    type="number"
                    min={0}
                    max={60}
                    required
                    value={settings.policy.inPersonReturnDays}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        policy: {
                          ...settings.policy,
                          inPersonReturnDays: Number(event.target.value),
                        },
                      })
                    }
                  />
                </label>
                <label>
                  Retenção após a entrega (dias)
                  <input
                    type="number"
                    min={7}
                    max={90}
                    required
                    value={settings.policy.holdingDays}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        policy: {
                          ...settings.policy,
                          holdingDays: Number(event.target.value),
                        },
                      })
                    }
                  />
                </label>
                <label>
                  Orientações adicionais ao cliente
                  <textarea
                    maxLength={4000}
                    value={settings.policy.additionalTerms}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        policy: {
                          ...settings.policy,
                          additionalTerms: event.target.value,
                        },
                      })
                    }
                  />
                </label>
              </fieldset>
              <p className="commerce-form-help">
                A política comercial não reduz direitos legais. Disputas
                bloqueiam o repasse. Compras online aguardam confirmação do
                recebimento para iniciar a retenção.
              </p>
              {!policyAllowed && (
                <p>
                  Para editar, é necessária a permissão Reembolsos e proteção da
                  compra.
                </p>
              )}
            </article>
            <article className="commerce-card">
              <h2>
                <CreditCard size={20} /> Conta central e maquininha
              </h2>
              <span className="commerce-tag">
                {settings.gatewayAvailable
                  ? "Gateway conectado"
                  : "Gateway ainda não conectado"}
              </span>
              <fieldset disabled={!gatewayAllowed || busy}>
                <legend>Preparar conexão</legend>
                <label>
                  Provedor desejado
                  <select
                    value={settings.gateway.provider}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        gateway: {
                          ...settings.gateway,
                          provider:
                            GatewayPreparationSchema.shape.provider.parse(
                              event.target.value,
                            ),
                        },
                      })
                    }
                  >
                    <option value="unselected">Ainda não escolhido</option>
                    <option value="mercado_pago">Mercado Pago</option>
                    <option value="efi">Efí Bank</option>
                    <option value="other">Outro provedor</option>
                  </select>
                </label>
                <label>
                  Nome da conta da plataforma
                  <input
                    maxLength={128}
                    value={settings.gateway.accountLabel}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        gateway: {
                          ...settings.gateway,
                          accountLabel: event.target.value,
                        },
                      })
                    }
                    placeholder="Conta que receberá e reterá os pagamentos"
                  />
                </label>
                <label>
                  Referência da conta no provedor
                  <input
                    maxLength={128}
                    value={settings.gateway.merchantReference}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        gateway: {
                          ...settings.gateway,
                          merchantReference: event.target.value,
                        },
                      })
                    }
                    placeholder="Preencher após criar a conta"
                  />
                </label>
                <label>
                  Chave Pix da conta central
                  <input
                    maxLength={255}
                    value={settings.gateway.platformPixKey}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        gateway: {
                          ...settings.gateway,
                          platformPixKey: event.target.value,
                        },
                      })
                    }
                    placeholder="Chave da plataforma; não use a chave do produtor"
                  />
                </label>
                <label>
                  Referência da maquininha vinculada
                  <input
                    maxLength={128}
                    value={settings.gateway.terminalReference}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        gateway: {
                          ...settings.gateway,
                          terminalReference: event.target.value,
                        },
                      })
                    }
                    placeholder="Preencher após vincular a maquininha"
                  />
                </label>
              </fieldset>
              <label>
                Credenciais privadas do provedor
                <input
                  type="password"
                  disabled
                  placeholder="Configuração protegida na ativação da integração"
                />
              </label>
              <p className="commerce-note">
                Essas referências preparam a conexão. Para ativar cobranças,
                estornos e repasses, será necessário conectar a conta ao
                provedor e habilitar a retenção contratada. Nenhum valor é
                movimentado ao salvar.
              </p>
              <p className="commerce-form-help">
                Cartões online usarão formulário protegido do provedor. O caixa
                usará a maquininha vinculada à mesma conta central.
              </p>
            </article>
          </div>
          <div className="commerce-actions">
            <button className="primary" disabled={busy}>
              {busy ? "Salvando…" : "Salvar preparação e política"}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() =>
                void api<SettingsView>("/v1/admin/commerce/settings")
                  .then((value) => {
                    setSettings(value);
                    setError("");
                  })
                  .catch((e) => setError(commerceMessage(e)))
              }
            >
              Recarregar configuração
            </button>
          </div>
          <RefundPolicy policy={settings.policy} />
        </form>
      )}
    </section>
  );
}
