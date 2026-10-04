# Trilha 13 — Taxonomia oficial de alimentos

Implementação aditiva sobre `main@f92467cc276bf167641684fd5197e96098d02d49` (T12, schema lógico 47). A T13 avança o schema lógico para 48, com 53 migrations. A missão normativa é a Trilha 13 do plano T12–T25 fornecido pelo proprietário, Volume 3; o Livro-Raiz anterior permanece preservado.

## Comportamento entregue

O catálogo é global. A nova `app_categories` não contém vínculo com loja, produtor, preço ou estoque. A migration `20261004133608_trilha13_categories_taxonomy.sql`, criada pelo Supabase CLI 2.117.0, acrescenta somente essa tabela, seus índices, grants, policy e as cinco categorias canônicas:

| Ordem | Slug | Nome | Ícone |
| --- | --- | --- | --- |
| 1 | hortalicas-folhosas | Hortaliças folhosas | leaf |
| 2 | legumes-picados | Legumes picados | knife |
| 3 | mix-prontos | Mix prontos | bowl |
| 4 | temperos-e-ervas | Temperos e ervas | sparkles |
| 5 | frutas | Frutas | sun |

O Super Admin pode criar, editar, desativar e reativar categorias em `/admin/categorias`. O slug só pode ser editado na API administrativa e permanece no histórico antes/depois. Não há rota DELETE. Desativar exige revisão corrente, autenticação recente e confirmação quando houver impacto; a contagem é recalculada durante a transação.

A vitrine consulta o catálogo real, com SVG inline, skeleton, estado vazio, recuperação de erro e seleção por UUID. A navegação é vertical a partir de 768 px e usa carrossel tátil abaixo disso. O catálogo é atualizado ao recuperar o foco, ao mudar a visibilidade e a cada 30 segundos enquanto a página está visível. Uma categoria que sai da resposta pública é removida do menu; a seleção volta a “Todos os produtos”.

## Segurança, concorrência e auditoria

- RLS `ENABLE` e `FORCE`. `anon` e `authenticated` recebem somente SELECT e veem exclusivamente categorias ativas. Mesmo um Super Admin autenticado não ganha mutação direta no banco.
- O backend revalida principal administrativo, papel ativo/validez e situação efetiva da conta dentro da transação. Escritas exigem autenticação nos últimos 15 minutos.
- Criação, edição, desativação e reativação gravam, atomicamente, eventos `category.created`, `category.updated`, `category.deactivated` e `category.reactivated` em `app_audit_events`, com ator, request ID, hash do IP e snapshots redigidos pelo mecanismo existente.
- `expectedRevision` rejeita edições concorrentes com HTTP 409. A interface preserva o formulário e exige recarregamento explícito para substituir a edição local.
- `commandId` e fingerprint impedem duplicação de comando e reutilização do mesmo identificador para outro payload. A autorização também é revalidada em replays.
- Parent inexistente e ciclos diretos/indiretos retornam 422. Uma CTE recursiva valida descendentes; o lock transacional global impede ciclos formados por dois reparentamentos concorrentes.
- Desativar uma categoria não altera os filhos. Filhos ativos aparecem como raízes no menu público enquanto o pai estiver inativo, preservando `parent_id`. A reativação recompõe a árvore. O relatório inclui essa quantidade e exige confirmação.
- Sem `app_products`, o impacto em produtos é realmente zero. O serviço já consulta `category_id` e `is_published` quando a tabela da T14 existir. A fixture de compatibilidade aparece apenas no PostgreSQL local descartável e é removida ao final do teste.

## API

Os endpoints são montados em `/v1`, `/api/v1` e `/_hvm_api/v1`; os dois últimos mantêm a compatibilidade dos transportes existentes.

| Método | Endpoint relativo | Acesso |
| --- | --- | --- |
| GET | /categories | Público; árvore ativa ordenada; no-store |
| GET | /admin/categories | Super Admin; ativas e inativas |
| POST | /admin/categories | Super Admin recente; criação |
| PATCH | /admin/categories/:id | Super Admin recente; edição com revisão |
| GET | /admin/categories/:id/impact | Super Admin; relatório de desativação |
| POST | /admin/categories/:id/deactivate | Super Admin recente; revisão e confirmação |
| POST | /admin/categories/:id/reactivate | Super Admin recente; revisão |

Os contratos estritos estão em `shared/contracts/category.ts`. A identificação do ator provém exclusivamente do middleware administrativo existente; nenhum payload aceita produtor, loja, papel ou troca direta de `isActive`. As respostas são validadas também no frontend.

## Validação

As evidências consolidadas de regressão e publicação estão em `TRILHA13_REGRESSAO.json` e na entrada final da T13 no Livro-Raiz.

- 51 testes novos de contratos e fronteira HTTP: dados malformados, campos adicionais, autorização, sessão, CSRF, revisão, erros de ciclo, impacto e ausência de DELETE.
- 20 testes com PostgreSQL 17 real: seed, grants, RLS, auditoria, rollback, idempotência, concorrência, ciclo indireto, validade do papel, desativação, reativação e compatibilidade futura.
- Uma história completa usa a aplicação React compilada, navegador Chromium, HTTP real, middleware administrativo, serviço e PostgreSQL real: cria, edita slug, desativa, verifica menu público, reativa e confere os quatro eventos de auditoria. Apenas o provedor externo Supabase Auth é adaptado para credenciais sintéticas locais.
- 20 testes de navegador da T13: 320/390/768/1440 px sem overflow; CRUD, skeleton, erro/vazio, slug, conflito sem perder campos, confirmação de impacto, reautenticação e bloqueio do Administrador setorial.
- Os 22 testes PostgreSQL da T12 passaram antes e depois da T13. O hash das lojas e dos horários anteriores permaneceu idêntico na aplicação da migration local.
- Suíte geral final: 471 passaram e 73 foram explicitamente ignorados por dependerem de configuração local/remota. Na comparação completa Playwright, a base teve 130 sucessos/48 falhas e a entrega teve 150 sucessos/47 falhas: todas as 47 também falharam na base, sem falha nova. A suíte ampla continua vermelha por casos anteriores; isso não constitui homologação integral das trilhas anteriores. A verificação final dedicada T12/T13 teve 36 sucessos (16 + 20).
- Typecheck integral, build, inicialização da API sem `require(ESM)` e varredura de segredos passaram.

Duas expectativas de teste anteriores foram atualizadas sem mudar comportamento de produção: o teste T07 passou a reconhecer a verificação de inicialização já introduzida na T12, que falhava na base; o teste PostgreSQL T12 verifica agora a quantidade de migrations do manifesto, em vez de fixá-la em 52.

### Reprodução gratuita e segura

```sh
npm run test:t13:unit
npm run migrations:verify
npm run typecheck:app
npm run security:check
npm run verify:t12:store:runtime
npx vite build
node --import tsx scripts/check-bundle.ts
HVM_T13_LOCAL_DATABASE_URL=<URL_LOCAL_DESCARTAVEL> npm run test:t13:postgres
HVM_T13_LOCAL_DATABASE_URL=<URL_LOCAL_DESCARTAVEL> npm run test:t13:story
npm run test:t13:e2e
```

As suítes PostgreSQL recusam URLs fora de `127.0.0.1:55432/postgres`; não aceitam Supabase nem execução contra produção. Usam banco descartável com todas as migrations da base aplicadas, sem remover dados reais.

## Preservação e limites da entrega

Nenhuma migration antiga foi reescrita. Nenhuma tabela, função, policy, grant ou registro de T01–T12 foi removido pela migration. Os contadores e hashes de loja, horários, pessoas, usuários, perfis, imóveis, documentos, localidades e auditoria técnica são comparados antes e depois no Supabase canônico.

Não há dependência nova. Supabase gratuito e Vercel Hobby, região `pdx1`, publicação exclusivamente na `main` e guardas de custo existentes permanecem vigentes. A inicialização segura da API da T12 continua no build da Vercel.

O cadastro de produtos, preços, estoque e vínculos comerciais da T14 não é iniciado. A seleção de categoria atualiza a navegação e o título da vitrine; a consulta de produtos será integrada na trilha correspondente.

## Aplicação no Supabase canônico

Migration aplicada em 04/10/2026, versão física `20261004142901`, associada à versão canônica `20261004133608`. Histórico remoto completo validado: 53 migrations, schema 48 e hash `e957840c37f1929afba4c4da1290daeb28dfad9b8fdc8418227c885ebe412665`. As cinco categorias oficiais estão ativas e ordenadas. RLS habilitado/forçado, somente SELECT para anon/authenticated e nenhuma tabela pública sem RLS. Nenhum achado novo de segurança foi introduzido. Os dez grupos de registros anteriores mantiveram contadores e hashes idênticos, incluindo a loja existente e seus sete horários.

## Publicação funcional

[PR #70](https://github.com/wesleialvessantos39/HortVitalMix/pull/70) integrado à main `a6364b20eb673f1a7500023691375571f6e76bf8`. Deployment `dpl_FKsZcr18keg9YuUrDCmVRX7Mn7gA` READY, production, pdx1, em [hortvitalmix.vercel.app](https://hortvitalmix.vercel.app). Release funcional `t13-v48-a6364b2`, schema 48; health/ready/config conferidos pelo script de deploy. A API pública retorna as cinco categorias em ordem; a gestão anônima retorna 401. Navegador publicado confirmou seleção de Frutas e redirecionamento do acesso administrativo sem sessão, sem erro JavaScript. Os contadores e hashes anteriores continuaram idênticos após a publicação. O fechamento documental mantém código/schema/hash e sincroniza a SHA final da main pela release corrente, após deployment READY.
