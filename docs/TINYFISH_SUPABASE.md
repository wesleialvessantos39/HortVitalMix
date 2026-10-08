# TinyFish — integração segura ao Supabase do HortVitalMix

**Projeto canônico:** `xipbsazvymkqqfmfegwu`  
**Edge Function:** `tinyfish-free`  
**Objetivo:** acesso server-side às APIs TinyFish Search e Fetch, sem ativar serviços pagos.

## Estado

A função está implantada. A integração externa só funciona depois que o proprietário configura a variável protegida `TINYFISH_API_KEY` no Supabase. Enquanto a variável não for configurada, a função devolve `TINYFISH_KEY_NOT_CONFIGURED` para operações externas. Nenhuma chamada paga é realizada por esta função.

## Segurança

- Exige JWT Supabase válido (verify_jwt habilitado) e valida novamente o usuário na Auth.
- Só aceita o Super Administrador com `app_admin_principals` + `app_user_role_assignments` ativo e `app_users.status = 'active'`.
- Nunca devolve a chave da TinyFish, nem a persiste no banco ou a envia ao frontend.
- Browser/Agent/Monitor/Research estão **deliberadamente fora do escopo** para evitar gastos.
- Limita tamanho, tempo, quantidade de URLs e origem de acesso; recusa URLs privadas e HTTP.
- Não altera tabelas, migrations, dados existentes ou políticas RLS.

## Configuração necessária (somente proprietário do Supabase)

1. Acesse [Edge Function Secrets — HortVitalMix](https://supabase.com/dashboard/project/xipbsazvymkqqfmfegwu/settings/functions) (ou o painel de Edge Functions > Secrets).
2. Crie/obtenha uma chave TinyFish em [TinyFish API Keys](https://agent.tinyfish.ai/api-keys).
3. Registre no Supabase a variável secreta `TINYFISH_API_KEY` com o valor da sua chave. **Nunca publique o valor no GitHub, código Vite/Vercel nem neste documento.**
4. No frontend, a invocação deve usar o token Auth do Super Administrador. Não utilize credenciais privilegiadas no navegador.
5. Teste status sem consumo TinyFish:

```ts
const { data, error } = await supabase.functions.invoke('tinyfish-free', {
  body: { operation: 'status' }
});
// data.connected === true indica que a chave foi disponibilizada à Edge Function
```

## Operações permitidas

```ts
// TinyFish Search (API gratuita):
await supabase.functions.invoke('tinyfish-free', {
  body: { operation: 'search', query: 'hortaliças orgânicas em Rondônia' }
});

// TinyFish Fetch (API gratuita; 1 a 3 URLs HTTPS públicas):
await supabase.functions.invoke('tinyfish-free', {
  body: { operation: 'fetch', urls: ['https://www.embrapa.br/'] }
});
```

URLs/consultas só devem ser enviados por sessão legítima de Super Administrador. Nem consumidores nem produtores podem acionar a função diretamente.

## Validação e limitações

- A implantação de função não comprova que a credencial TinyFish existe; é necessário o teste autenticado depois do cadastro do segredo.
- Não há integração de tela ou tarefas automáticas; isso deve ser projetado em etapa separada, respeitando o fluxo de autorização do HortVitalMix.
- Search e Fetch foram identificados como gratuitos na documentação TinyFish de outubro/2026; confirme cota e política de preços da conta antes de aumentar o uso.
- A função faz chamadas sob demanda, não agendadas, e não cria projeto ou branch pagos no Supabase.

**Documentação oficial:** [TinyFish APIs](https://docs.tinyfish.ai/llms.txt) · [Supabase Edge Function Secrets](https://supabase.com/docs/guides/functions/secrets).
