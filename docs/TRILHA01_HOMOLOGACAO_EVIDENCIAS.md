# Trilha 01 — Evidências de Homologação

Data: 2026-09-19.

## Ambiente Supabase atualmente provisionado

Projeto: `HortVitalMix` (`xipbsazvymkqqfmfegwu`).

Este projeto está sendo tratado como candidato a **production**. Development e homologation ainda não foram criados porque o Supabase informou custo de **US$ 0,01344/h por branch**; a criação depende de confirmação financeira explícita.

## Banco — candidato production

Bloco A do Manual v10: **15/15 aprovado**.

- A1 extensões: 3/3.
- A2 tabelas `app_*`: 8/8.
- A3 RLS desabilitado: 0.
- A4 FORCE RLS desabilitado: 0.
- A5 trigger auditoria: presente.
- A6 trigger criação Auth: presente e testado em transação.
- A7 trigger deleção Auth: presente e testado em transação.
- A8 trigger bump config: presente e testado.
- A9 singleton config: exatamente 1.
- A10 papéis canônicos: consumer, platform_admin, platform_super_admin, producer.
- A11 release corrente duplicada: 0.
- A12 tabelas locais de credenciais: 0.
- A13 SECURITY DEFINER sem search_path: 0.
- A14 policies sem role explícito: 0.
- A15 linhas de auditoria contendo chaves de PII crua: 0.

## Invariantes destrutivos testados sem resíduos

Todos executados dentro de transação encerrada por `ROLLBACK`:

- auditoria rejeitou UPDATE;
- auditoria rejeitou DELETE;
- `command_id` duplicado violou unicidade;
- usuário A não enxergou pessoa/perfil de usuário B sob role `authenticated`;
- usuário A alterou campo de autoatendimento permitido;
- usuário A não conseguiu alterar `verification_status`;
- revision do singleton incrementou em mudança de negócio;
- INSERT em `auth.users` criou `app_users` ativo;
- DELETE em `auth.users` suspendeu o espelho e incrementou `authorization_revision`.

## Segurança adicional

O Supabase Advisor apontou `public.rls_auto_enable()` executável por roles públicos. Foi revogado `EXECUTE` de PUBLIC/anon/authenticated e preservado apenas para service_role. A nova auditoria removeu esse finding.

Os quatro findings remanescentes de SECURITY DEFINER (`has_role`, `current_person_id`, `is_platform_super_admin`, `is_any_platform_admin`) são funções previstas pelo próprio Manual v10 para uso pelas policies e possuem `search_path` fixado.

## Bloqueios para selagem final

- development Supabase independente;
- homologation Supabase independente;
- execução real de `npm ci`, `homologate` e build com lockfile;
- deployment Preview READY;
- deployment Production READY;
- releases e snapshots/dumps de cada ambiente;
- atualização final do Livro-Raiz e tag `trilha01-v1`.

Nenhum desses itens será marcado como concluído sem evidência executada.
