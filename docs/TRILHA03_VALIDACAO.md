# Volume 01 — Trilha 03 — Validação Técnica

Fonte normativa: MANUAL MESTRE TÉCNICO v10 — TRILHAS 01 A 06.

## Baseline preservado
A implementação parte do estado homologado da Trilha 02 (schema lógico 14) e preserva identidade multi-papel já adiantada, confirmação, recuperação, código de segurança, configuração global/auditoria e os portais separados já existentes.

## Entregas
- normalização compartilhada de CPF/e-mail/celular;
- validação matemática de CPF mantida no cliente e servidor;
- cadastro público estrito e separado Consumer/Producer;
- rota `/cadastro` de escolha explícita;
- sessão real Supabase Auth + JWT + cookies HttpOnly;
- endpoints separados `/v1/auth/login` e `/v1/auth/admin-login`;
- bloqueio de papel administrativo no login público antes de autenticar;
- rate limit 10 tentativas/15 minutos por hash de IP;
- cookie `HttpOnly + Secure em produção + SameSite=Lax`;
- hook reativo de sessão;
- migration T03 sem novas tabelas;
- testes unitários e integração isolada.

## Banco
Migration: `20260922002647_trilha03_identity_hardening.sql`. Schema lógico: 15.

## Não regressão
Os fluxos reais de confirmação, recuperação e reautenticação já implementados são preservados; não são substituídos pelos stubs históricos da T03.
