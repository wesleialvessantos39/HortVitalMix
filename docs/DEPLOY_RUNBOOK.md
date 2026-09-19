# Runbook de Deploy — Volume 01 / Trilha 01

## Ordem obrigatória

A promoção é sequencial e bloqueante:

`development → homologation → production`

Não é permitido promover quando um gate do ambiente anterior falha.

## Development

1. Preencher `.env.local` exclusivamente com credenciais de development.
2. Aplicar as 8 migrations versionadas.
3. Executar `HVM_INTEGRATION_ENABLED=true npm run homologate`.
4. Registrar release `trilha01-v1-dev-<sha7>` com `schema_version=8`.
5. Criar snapshot/dump de segurança sem PII.
6. Registrar evidências no Livro-Raiz.

## Homologation

1. Usar credenciais distintas das de development e production.
2. Aplicar exatamente as mesmas 8 migrations.
3. Executar `verify:foundation` e testes de integração.
4. Fazer deployment Preview deliberado.
5. Executar smoke tests de `/api/health`, `/api/ready` e `/api/v1/config`.
6. Registrar release `trilha01-v1-hml-<sha7>`.
7. Criar snapshot/dump sem PII.

## Production

1. Somente após development e homologation aprovados.
2. Aplicar migrations na production.
3. Executar `verify:foundation`.
4. Promover/mesclar o SHA aprovado para `main`.
5. Fazer deployment production deliberado.
6. Somente após deployment `READY`, registrar release `trilha01-v1` com SHA completo, `schema_version=8` e hash da cadeia de migrations.
7. Executar `verify:deploy --sha=<sha> --url=<production-url> --schema=8`.
8. Criar snapshot/dump sem PII.
9. Atualizar Livro-Raiz e criar tag `trilha01-v1`.

## Bloqueios

- Um ambiente Supabase não pode representar os três ambientes do manual.
- Não reutilizar secrets entre ambientes.
- Não declarar build/test/deploy aprovado sem execução real.
- Rollback destrutivo de banco é permitido apenas em development.
