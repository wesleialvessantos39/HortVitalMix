# Deploy e homologação — Trilha 01

## Topologia Free autorizada

Não usar Supabase Preview Branches pagas. A rotação documentada em [FREE_TIER_ENVIRONMENT_STRATEGY.md](FREE_TIER_ENVIRONMENT_STRATEGY.md) usa projetos Free independentes:

1. development + homologation ativos;
2. production pausado temporariamente;
3. após aprovação de dev/homolog, pausar development;
4. restaurar production;
5. executar a fase production.

Nunca compartilhar credenciais entre ambientes.

## Estado atual

- development `ldtcsrlxfpflzhnbjjnp`: schema v8 + A1–A15 + testes SQL transacionais aprovados.
- homologation `vcbcbbnbboxoimqmuibm`: schema v8 + A1–A15 + testes SQL transacionais aprovados.
- production `xipbsazvymkqqfmfegwu`: preservado e temporariamente pausado.
- nenhuma release final ou tag criada.
- Vercel conectado ao ChatGPT ainda retorna 0 projetos; o domínio público `hortvitalmix.vercel.app` responde, porém o deployment não é resolvido pela equipe conectada.

## Gate de development

Com Node 24 e segredos do projeto development:

```sh
npm ci --no-audit --no-fund
flag exclusiva de integração=true npm run homologate
```

Obrigatório configurar `referência protegida de production=xipbsazvymkqqfmfegwu`. O gate deve executar cobertura V8, build, foundation e Playwright.

Somente após aprovação completa registrar a release de development e produzir a evidência de snapshot/backup disponível no plano.

## Gate de homologation

Usar exclusivamente credenciais do projeto homologation. Executar preflight/foundation e smoke tests no preview Vercel deliberado. Não executar fixtures destrutivas em homologation.

Somente após aprovação registrar a release `trilha01-v1-hml-<sha7>`.

## Gate de production

Após aprovação de development e homologation:

1. pausar development;
2. restaurar `xipbsazvymkqqfmfegwu`;
3. conferir schema/foundation novamente;
4. configurar variáveis production na Vercel;
5. realizar deploy production deliberado;
6. aguardar estado READY;
7. registrar `trilha01-v1`;
8. executar `verify:deploy --sha=<sha> --schema=8`;
9. registrar snapshot/backup ou justificativa formal, conforme disponibilidade real do plano.

## Vercel

`vercel.json` mantém auto-deploy somente de `main`. Previews permanecem deliberados. Não promover branch de código nem criar tag somente porque o banco passou A1–A15.

## Selagem

Atualizar Livro-Raiz com SHA, migration hash, resultados, releases, evidências de backup/snapshot e deployment READY. A tag `trilha01-v1` é o último passo.
