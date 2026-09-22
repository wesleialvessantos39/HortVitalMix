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
