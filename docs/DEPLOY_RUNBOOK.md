# Deploy e homologação — Free-Tier

Data de consolidação: 2026-09-21.

## Princípio

Enquanto o HortiVitalMix estiver em planos gratuitos, nenhuma etapa deve depender de GitHub Actions, Supabase Preview Branch paga ou deploy automático de branches.

O fluxo segue o Manual Mestre Técnico v10:

1. validar localmente;
2. validar integração em development isolado quando esse ambiente estiver disponível;
3. promover banco de forma sequencial;
4. deploy Vercel deliberado;
5. validar deployment;
6. registrar release e evidências;
7. atualizar Livro-Raiz.

## Estado conectado verificado em 2026-09-21

### Supabase

A conexão atual expõe um único projeto ativo:

- `HortVitalMix`
- project ref `xipbsazvymkqqfmfegwu`
- status `ACTIVE_HEALTHY`
- schema lógico atual do repositório: **14**

Nenhum projeto development/homologation está atualmente visível pela conexão usada nesta auditoria.

**Consequência:** a suíte destrutiva de integração não deve ser executada contra esse projeto se ele for production.

### Vercel

A equipe conectada `wesleialvessantos' projects` retorna atualmente **0 projetos**.

Portanto não há deployment da Trilha 02 verificável por essa conexão neste momento.

### GitHub

GitHub é usado como repositório/versionamento. O workflow automático de GitHub Actions foi removido conforme a estratégia Free-Tier do manual.

## Gate diário gratuito

Executar no Google AI Studio ou local:

```sh
npm ci --no-audit --no-fund
npm run verify:free
```

O gate executa migrations manifest, typecheck, security check, testes unitários e build, sem exigir credenciais de banco.

## Gate de development real

Quando houver um projeto Supabase development isolado:

```sh
HVM_INTEGRATION_ENABLED=true \
HVM_PROD_PROJECT_REF=<prod-ref> \
SUPABASE_PROJECT_REF=<dev-ref> \
npm run homologate
```

As demais credenciais do development devem estar no gerenciador seguro do ambiente.

O script recusa:

- integração não explicitamente habilitada;
- ambiente diferente de development;
- ausência do ref de production;
- uso do mesmo project ref de production.

## Trilha 02

Para validar especificamente a Trilha 02:

```sh
npm run test:t02:unit
```

Sem banco real, esse comando valida os 13 casos unitários/contratuais.

Para os 31 casos completos:

```sh
HVM_INTEGRATION_ENABLED=true \
HVM_PROD_PROJECT_REF=<prod-ref> \
SUPABASE_PROJECT_REF=<dev-ref> \
npm run test:t02
```

A suíte completa não é considerada aprovada se a integração estiver skipped.

## Promoção Supabase no Free

O modelo lógico continua development → homologation → production.

Durante o Free, a implementação física pode usar projetos Free independentes, respeitando a cota disponível. Se não houver vaga:

1. preservar production;
2. não testar destrutivamente nela;
3. ativar/criar development apenas quando houver capacidade gratuita;
4. registrar snapshot manual antes de migration relevante;
5. promover somente após o gate anterior passar.

Nunca compartilhar credenciais entre ambientes.

## Vercel

O `vercel.json` restringe deployments Git:

- `main: true`;
- `*: false`.

Isso evita consumo de cota com previews de branches.

Após um deployment real:

```sh
npm run verify:deploy -- --url=https://<deployment> --sha=<commit-sha> --schema=14
```

Somente depois de `health`, `ready` e `config` válidos a release pode ser selada.

## Backup Free

O Manual v10 registra que PITR é recurso de plano superior e que no Free o snapshot manual é obrigatório antes de migration em production.

Por isso:

- migrations devem ser aditivas;
- registrar snapshot/backup manual possível no plano;
- não declarar rollback automático/PITR quando ele não existir.

## Selagem

Atualizar o Livro-Raiz com:

- commit SHA;
- migration history hash;
- resultado de `verify:free`;
- resultado da integração real quando executada;
- resultado de foundation;
- snapshot/backup aplicável;
- deployment READY;
- release registrada;
- tag final somente no último passo.

Nenhuma evidência deve ser simulada.
