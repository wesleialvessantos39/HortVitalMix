# Estratégia de CI/CD Free-Tier — Volume 01 / Trilhas 01 e 02

Data de consolidação: 2026-09-21.

## Decisão arquitetural canônica

O HortiVitalMix **não depende de GitHub Actions** durante a fase Free.

Essa decisão segue o Manual Mestre Técnico v10, que registra como armadilha conhecida a execução do GitHub Actions encerrando antes do primeiro step (`steps: []`, `runner_id: 0`) e determina:

- workflow de CI removido do repositório;
- validação executável localmente;
- gate canônico por `npm run homologate`;
- build do Vercel como validação adicional do deployment;
- nenhum secret de Supabase enviado a GitHub Actions.

O arquivo `.github/workflows/ci.yml` foi removido em 2026-09-21.

## Gates disponíveis

| Comando | Uso | Banco real |
| --- | --- | --- |
| `npm ci --no-audit --no-fund` | instalação determinística | não |
| `npm run verify:free` | gate diário gratuito: migrations manifest + typecheck + security + unit tests + build | não |
| `npm run test:t02:unit` | 13 casos unitários/contratuais da Trilha 02 | não |
| `npm run test:t02:integration` | 18 casos de integração da Trilha 02 | sim, somente development |
| `npm run test:t02` | suíte completa da Trilha 02; falha se integração real não estiver habilitada | sim, somente development |
| `npm run homologate` | gate integral do manual: preflight, migrations, testes, cobertura, build, foundation e E2E | sim, somente development |
| `npm run verify:foundation` | gates atuais da fundação, schema lógico 14 | sim |
| `npm run verify:deploy -- --url=<url> --sha=<sha> --schema=14` | valida health/ready/config pós-deploy | deployment |

## Uso diário sem custo

No Google AI Studio ou ambiente local:

```sh
npm ci --no-audit --no-fund
npm run verify:free
```

Esse comando não exige service role, pooler, banco de testes nem GitHub Actions.

Ele é uma validação de qualidade local e **não substitui** a homologação de integração.

## Integração real

Para a suíte completa da Trilha 02 ou `homologate`, usar exclusivamente um projeto Supabase de **development isolado**, nunca production.

Variáveis de controle:

```text
HVM_INTEGRATION_ENABLED=true
HVM_PROD_PROJECT_REF=<project-ref-de-production>
SUPABASE_PROJECT_REF=<project-ref-de-development>
```

Além delas, o runtime de integration exige as credenciais do próprio projeto development por meio do gerenciador seguro do ambiente.

Regras:

1. `HVM_INTEGRATION_ENABLED=true` é obrigatório.
2. `APP_ENV` deve resolver para `development`.
3. `HVM_PROD_PROJECT_REF` é obrigatório como trava de segurança.
4. `SUPABASE_PROJECT_REF` não pode ser igual a `HVM_PROD_PROJECT_REF`.
5. Teste pulado não vale como homologação.
6. Nenhuma credencial privilegiada deve ser versionada.

## Trilha 02

A antiga ambiguidade de `npm run test:t02` foi eliminada.

Antes, a suíte podia executar com `HVM_INTEGRATION_ENABLED=false` e marcar os testes de integração como skipped. Agora:

- `test:t02:unit` roda apenas os 13 casos sem banco;
- `test:t02:integration` exige integração real;
- `test:t02` encadeia os dois e não pode representar falsamente “31/31” sem development real.

## Vercel Free

O `vercel.json` mantém:

```json
"git": {
  "deploymentEnabled": {
    "main": true,
    "*": false
  }
}
```

Assim, branches de trabalho não consomem cota de preview automaticamente. O deployment de produção é deliberado e deve ocorrer somente após os gates aplicáveis.

A conexão Vercel acessível ao ChatGPT em 2026-09-21 retorna zero projetos. Isso é um estado da conexão atual, não autorização para inventar evidência de deploy.

## Supabase Free

Não usar recurso pago como condição de desenvolvimento.

- Preview Branch paga não é requisito operacional durante a fase Free.
- Quando houver ambientes Free isolados, usar projetos distintos para development/homologation/production.
- Se não houver development isolado ativo, **não executar testes destrutivos em production**.
- No plano Free, snapshots de segurança são manuais antes de migrations relevantes.
- Migrations permanecem aditivas; nunca rebaixar o schema para reproduzir número histórico de trilha.

## Critério de homologação

`verify:free` aprovado significa “código local validado sem dependências pagas”.

“HOMOLOGADA” continua exigindo as evidências reais previstas pelo manual: integração em ambiente não produtivo, foundation, deployment verificável, release, snapshot aplicável e Livro-Raiz atualizado.
