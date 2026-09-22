function htmlShell(content: string) {
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f5f3e8;font-family:Arial,Helvetica,sans-serif;color:#143D24;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#f5f3e8;">
<tr><td align="center" style="padding:28px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:18px;">
<tr><td style="padding:28px;">
<p style="font-size:22px;line-height:28px;font-weight:700;color:#143D24;margin:0 0 20px;">Horti<span style="color:#f28c28;">Vital</span>Mix</p>
${content}
<p style="font-size:12px;line-height:18px;color:#6b7280;margin:28px 0 0;">Mensagem automática de segurança. Nunca compartilhe códigos ou links de acesso.</p>
</td></tr></table></td></tr></table></body></html>`;
}

export type RenderedTemplate = { subject: string; html: string; text: string };

export function renderContactVerificationEmail(params: {
  otp: string;
  magicLink: string;
  maskedDestination: string;
  expiresInMinutes: number;
}): RenderedTemplate {
  const html = htmlShell(`
<h1 style="font-size:20px;line-height:28px;color:#143D24;margin:0 0 8px;">Confirme seu e-mail</h1>
<p style="font-size:14px;line-height:22px;color:#4b5563;margin:0 0 18px;">Use o código abaixo ou o link seguro. Os dois confirmam a mesma solicitação.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="#eef7ef" style="background-color:#eef7ef;padding:18px;border-radius:12px;">
<p style="font-size:12px;line-height:18px;color:#4b5563;margin:0 0 6px;">Código de 6 dígitos</p>
<p style="font-size:30px;line-height:36px;letter-spacing:8px;font-weight:700;color:#143D24;margin:0;">${params.otp}</p>
</td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding-top:22px;">
<a href="${params.magicLink}" style="display:inline-block;background-color:#1B4D2E;color:#ffffff;font-size:14px;line-height:20px;font-weight:700;padding:14px 24px;border-radius:10px;text-decoration:none;">Confirmar meu e-mail</a>
</td></tr></table>
<p style="font-size:12px;line-height:18px;color:#6b7280;margin:20px 0 0;text-align:center;">Destino: ${params.maskedDestination}<br>Expira em ${params.expiresInMinutes} minutos.</p>`);
  const text = `HortiVitalMix — Confirme seu e-mail\n\nCódigo: ${params.otp}\nLink: ${params.magicLink}\n\nExpira em ${params.expiresInMinutes} minutos.`;
  return { subject: "Confirme seu e-mail — HortiVitalMix", html, text };
}

export function renderPasswordRecoveryEmail(params: {
  magicLink: string;
  expiresInMinutes: number;
}): RenderedTemplate {
  const html = htmlShell(`
<h1 style="font-size:20px;line-height:28px;color:#143D24;margin:0 0 8px;">Redefinir sua senha</h1>
<p style="font-size:14px;line-height:22px;color:#4b5563;margin:0 0 20px;">Recebemos um pedido para redefinir sua senha. Se não foi você, ignore esta mensagem.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding-top:8px;">
<a href="${params.magicLink}" style="display:inline-block;background-color:#1B4D2E;color:#ffffff;font-size:14px;line-height:20px;font-weight:700;padding:14px 24px;border-radius:10px;text-decoration:none;">Redefinir minha senha</a>
</td></tr></table>
<p style="font-size:12px;line-height:18px;color:#6b7280;margin:20px 0 0;text-align:center;">Este link expira em ${params.expiresInMinutes} minutos.<br>Todas as sessões ativas serão encerradas após a redefinição.</p>`);
  return {
    subject: "Redefinir senha — HortiVitalMix",
    html,
    text: `HortiVitalMix — Redefinir senha\n\nAcesse: ${params.magicLink}\n\nO link expira em ${params.expiresInMinutes} minutos.`,
  };
}

export function renderPhoneOtpSms(otp: string, expiresInMinutes: number): string {
  return `HortiVitalMix: seu codigo e ${otp}. Expira em ${expiresInMinutes} min. Nao compartilhe.`;
}


export function renderAdminMfaEmail(params: {
  otp: string;
  expiresInMinutes: number;
}): RenderedTemplate {
  const html = htmlShell(`
<h1 style="font-size:20px;color:#143D24;margin:0 0 8px;">Confirmação de acesso administrativo</h1>
<p style="font-size:14px;color:#4b5563;margin:0 0 20px;line-height:1.5;">
Detectamos uma tentativa de login no portal administrativo. Digite o código abaixo para confirmar.
Se não foi você, ignore este e-mail — sua senha continua válida e ninguém entra sem este código.
</p>
<div style="text-align:center;margin:24px 0;">
  <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;margin-bottom:8px;">Código MFA</div>
  <div style="display:inline-block;font-size:32px;font-weight:900;letter-spacing:8px;color:#1B4D2E;background:#E8F5E9;padding:14px 20px;border-radius:12px;font-family:monospace;">
    ${params.otp}
  </div>
</div>
<p style="font-size:12px;color:#6b7280;margin-top:20px;text-align:center;">
Expira em ${params.expiresInMinutes} minutos.<br/>Nunca compartilhe este código com ninguém.
</p>`);
  const text = `HortiVitalMix — Código MFA

Seu código: ${params.otp}
Expira em ${params.expiresInMinutes} minutos.`;

  return {
    subject: "Código de acesso administrativo — HortiVitalMix",
    html,
    text,
  };
}

export function renderAdminInviteEmail(params: {
  inviteLink: string;
  targetRole: "platform_admin" | "platform_super_admin";
  sectors: string[];
  expiresInHours: number;
}): RenderedTemplate {
  const roleLabel =
    params.targetRole === "platform_super_admin"
      ? "Super Administrador"
      : "Administrador Setorial";

  const sectorsBlock = params.sectors.length
    ? `<div style="background:#F8F9FA;border-radius:10px;padding:14px 16px;margin:20px 0;">
<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;margin-bottom:6px;">Setores atribuídos</div>
<ul style="margin:0;padding-left:18px;font-size:13px;color:#1f2937;">
${params.sectors.map((sector) => `<li><code>${sector}</code></li>`).join("")}
</ul></div>`
    : "";

  const html = htmlShell(`
<h1 style="font-size:20px;color:#143D24;margin:0 0 8px;">Convite administrativo</h1>
<p style="font-size:14px;color:#4b5563;margin:0 0 12px;line-height:1.5;">
Você foi convidado(a) para atuar como <strong>${roleLabel}</strong> no HortiVitalMix.
</p>
${sectorsBlock}
<div style="text-align:center;margin:24px 0;">
<a href="${params.inviteLink}" style="display:inline-block;background:#1B4D2E;color:#ffffff;font-size:14px;font-weight:700;padding:14px 24px;border-radius:10px;text-decoration:none;">Aceitar convite</a>
</div>
<p style="font-size:12px;color:#6b7280;margin-top:20px;text-align:center;">
Este convite expira em ${params.expiresInHours} horas e só pode ser usado uma vez.
</p>`);

  const text = `HortiVitalMix — Convite administrativo

Papel: ${roleLabel}
${params.sectors.length ? `Setores: ${params.sectors.join(", ")}\n` : ""}Aceite: ${params.inviteLink}

Expira em ${params.expiresInHours} horas.`;

  return {
    subject: `Convite ${roleLabel} — HortiVitalMix`,
    html,
    text,
  };
}
