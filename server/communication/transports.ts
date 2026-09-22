// HortiVitalMix — política operacional atual da Trilha 04.
//
// A aplicação NÃO envia e-mails diretamente por Resend, Gmail API ou Twilio.
// Todos os e-mails de autenticação e segurança usam exclusivamente Supabase Auth,
// que por sua vez utiliza o SMTP/Gmail já configurado no próprio projeto Supabase.
//
// Este módulo permanece apenas como marcador arquitetural para eventual evolução
// futura fora do fluxo de autenticação. Não lê variáveis de provider do runtime.

export type SecurityMailProvider = "supabase_auth";

export const securityMailProvider: SecurityMailProvider = "supabase_auth";

export const smsSecurityEnabled = false;
