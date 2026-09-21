# Estratégia Free de Ambientes — HortiVitalMix

Data de consolidação: 2026-09-21.

## Decisão operacional

O projeto utiliza, nesta fase:

- Supabase Free;
- GitHub como repositório/versionamento;
- Vercel Free.

Nenhum recurso pago é requisito para continuar a implementação.

O Manual Mestre Técnico v10 já prevê a estratégia Free-Tier: GitHub Actions não é dependência, deploys automáticos de branches são restritos, e snapshots manuais substituem PITR enquanto o projeto estiver no plano Free.

## GitHub

- Não usar GitHub Actions como gate canônico.
- `.github/workflows/ci.yml` foi removido.
- Não armazenar secrets de Supabase em workflows.
- Gate diário: `npm run verify:free`.
- Gate integral: `npm run homologate` em development isolado.

## Supabase

A topologia lógica continua:

```text
development -> homologation -> production
```

No plano Free, essa topologia pode ser implementada com projetos independentes em vez de Preview Branches pagas.

### Estado visível na conexão atual

Em 2026-09-21, apenas o projeto `HortVitalMix` (`xipbsazvymkqqfmfegwu`) aparece como `ACTIVE_HEALTHY`.

Os antigos projetos development/homologation registrados no Livro-Raiz não estão atualmente visíveis na conexão desta auditoria e, portanto, não devem ser tratados como ativos sem nova verificação.

### Regra de segurança

Se não houver um development isolado disponível:

- não executar fixtures destrutivas em production;
- não forçar “31/31” por skip;
- continuar com `verify:free`;
- aguardar capacidade Free para uma integração real antes da homologação final.

### Snapshots

No Free:

- snapshot manual antes de migration relevante;
- migrations sempre aditivas;
- nunca presumir PITR;
- nunca rebaixar schema para corresponder ao número histórico de uma trilha.

## Vercel

O `vercel.json` mantém deployment Git somente da `main`, com todas as demais branches desabilitadas.

Isso reduz consumo de cota e segue a prevenção do manual para `api-deployments-free-per-day`.

A conexão Vercel atualmente acessível retorna zero projetos; por isso nenhum deployment novo é alegado como evidência até que um projeto seja novamente visível/conectado.

## Validação sem custo

```sh
npm ci --no-audit --no-fund
npm run verify:free
```

Esse fluxo não exige:

- GitHub Actions;
- banco de integration;
- branch paga;
- secrets em GitHub.

## Homologação completa

A homologação completa continua real, não simulada. Quando houver development isolado:

```sh
HVM_INTEGRATION_ENABLED=true \
HVM_PROD_PROJECT_REF=<prod-ref> \
SUPABASE_PROJECT_REF=<dev-ref> \
npm run homologate
```

Depois seguem promotion, deployment Vercel, `verify:deploy`, release, snapshot e tag.
