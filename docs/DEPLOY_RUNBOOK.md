# Deploy e homologação — Trilha 01

## Pré-requisitos

1. Configurar três ambientes Supabase reais e isolados conforme o manual. A conta atual só disponibilizou o projeto raiz. Provisionamento pago não foi autorizado.
2. Vincular `wesleialvessantos39/HortVitalMix` à Vercel. A consulta da equipe conectada não retornou projetos nesta execução.
3. Configurar os valores de `.env.example` no Google Studio e na Vercel, separados por ambiente. Manter Node 24 e instalação `npm ci`.
4. A origem exata de cada preview deve constar em `APP_ALLOWED_ORIGINS`. Não usar wildcard de domínio para mutações autenticadas.

## Desenvolvimento e validação

Sincronizar GitHub no Studio, executar `npm ci`, configurar os segredos e iniciar `npm run dev`. API e interface compartilham a porta 3000.

Aplicar migrations primeiro em development com Supabase CLI, depois conferir o manifesto. Em cada ambiente, aplicar também os hardenings idempotentes de `supabase/hardening/` (ACL e comentários sensíveis). Antes de qualquer banco que já tenha dados, produzir backup privado com a ferramenta administrativa; não versionar dumps com PII. Nesta execução o schema de aplicação estava vazio antes das oito migrations; não se declarou snapshot remoto criado.

Executar `HVM_INTEGRATION_ENABLED=true npm run homologate` no projeto development isolado. O gate falha quando credenciais estão ausentes, quando a integração real está desabilitada ou quando o project ref coincide com production.

## Promoção sequencial

- Somente depois da validação em development, aplicar as migrations em homologation.
- Conferir `npm run preflight`, `npm run verify:foundation`, build, Playwright e smoke tests no preview criado deliberadamente. `vercel.json` não habilita deploy automático de branches diferentes de `main`.
- Somente após a aprovação em homologation, promover para production.
- Não modificar migrations já aplicadas. Qualquer correção subsequente precisa de migration aditiva e atualização do manifesto.

## Release verificável

Após deployment correspondente pronto, registrar a release com SHA real e tag contendo o SHA curto. Exemplo de sintaxe (substituir valores):

```sh
npm run release:current -- --tag trilha01-v1-dev-SHA7 --environment development --sha SHA40 --by operador
npm run verify:deploy -- --url https://URL-DA-IMPLANTACAO --sha SHA40 --schema 8
```

O script de release aceita `--flag valor` e `--flag=valor`. Valida histórico remoto, calcula hash, trava a atualização concorrente e troca a release corrente na mesma transação. O readiness verifica ambiente, versão, hash e SHA quando configurado; ausência de release retorna 503.

O arquivo `vercel.json` encaminha SPA sem capturar `/api`; `api/[...path].ts` atende a API Express no mesmo domínio. Nenhuma segunda porta ou reescrita de cookies para domínio externo.

## Se houver cota esgotada

Manter o commit e build aprovados. O término da cota não agenda, por si só, um redeploy automático: após a liberação, disparar deployment do commit validado e executar os gates. Não cadastrar automação sem necessidade ou afirmar que a Vercel fará o redeploy automaticamente.

## Selagem

Registrar no Livro Raiz evidências de cada ambiente, deployment READY, SHA, migration hash, resultados dos testes e backups reais. Somente então criar a tag de homologação. **Nesta execução, a tag e as releases de homologação não foram criadas.**
