# Trilha 16 — área de entrega e frete geodésico

Implementação aditiva sobre a T15 em `2afcbad43d3954b6793fa96b678073623b9dda4d`, schema 50. Fonte: plano T12–T25 fornecido pelo titular, Trilha 16/Volume 3, e Livro-Raiz atualizado. Projeto Supabase único `xipbsazvymkqqfmfegwu`, Vercel Hobby, main/pdx1. Nenhum serviço pago, extensão geográfica, cron ou dependência novo.

Schema lógico **51**, **57 migrations**, hash **d1ef54620ad0fd0cf8f83e7c7e0396249166226f4be8c874b50ea622babc3f23**. Migration canônica criada pelo CLI: `20261005034322_trilha16_service_areas_freight.sql`; versão física Supabase **20261005040640**, com alias no verificador. Nenhuma migration anterior foi editada.

## Funcionalidade

- `fn_haversine_km`: SQL IMMUTABLE, STRICT, PARALLEL SAFE, SECURITY INVOKER, search_path fixado. Haversine estável em distâncias pequenas, zero e antípodas, usando raio terrestre de 6371 km.
- `app_service_areas`: um círculo geodésico por loja, raio de 1 a 150 km, ativação e revisão. Origem exclusivamente do GPS da sede do imóvel atualmente vinculado à loja T12/T08; a API não aceita coordenadas ou identidade do produtor no payload.
- `app_delivery_rules`: taxa base, valor/km e pedido mínimo em centavos; limiar opcional de gratuidade e preparo em horas. Configuração de área/regras/auditoria salva em uma transação, com lock da loja, revisão otimista e `commandId` idempotente. Replays revalidam identidade, conta e papel. Auditoria conserva revisão/digest, sem GPS ou endereço bruto.
- `calculateQuote(storeId, destinationAddressId, context, client?)`: contexto interno com pessoa/usuário autenticados e subtotal autoritativo do backend. Confere titularidade e GPS do endereço T07, elegibilidade atual da loja T12 e origem vigente. Fora do raio retorna `isEligible: false`, `fora_da_area_de_entrega` e taxa zero. A distância integral decide o raio; a distância exposta e persistida tem duas casas e a taxa usa `base + round(distanceKm × feePerKmCents)` com aritmética inteira de centavos. Gratuidade aplica-se a subtotal **maior ou igual** ao limiar dentro da área. O pedido mínimo é retornado como regra para o futuro checkout, sem criar um pedido nesta trilha.
- Cotações privadas com validade de **15 minutos**, reutilizando `RESERVATION_TTL_MINUTES` da T15 e relógio do banco. `getActiveQuote` valida titularidade, conta, prazo, elegibilidade, configuração e revisão/coordenadas do endereço. Reconfere expiração depois de adquirir os locks. Mudanças tornam a cotação inválida; área desabilitada, loja inelegível ou cache de sede desatualizado impedem cotação.
- Métodos internos aceitam o `PoolClient` de uma futura transação; o chamador controla BEGIN/COMMIT/ROLLBACK e fornece o subtotal calculado no backend. Não há endpoint público de cotação, carrinho, checkout ou descoberta T17.

## Interface e API

**Minha loja → Área de entrega e frete**, em `/produtor/loja/entrega`. Slider acessível, comparação imediata com o centro de Ariquemes, origem GPS somente para leitura, tarifas, gratuidade opcional, preparo e entrega habilitada. Salvamento retorna a distância confirmada pelo banco. Estados de carregamento, indisponibilidade, loja/GPS ausente, conflito e autenticação recente preservam dados; conflito exige recarga explícita. Comando mantido na confirmação de senha. `DeliveryEligibilityBadge` possui estilos próprios e mensagem amigável, pronto para reutilização futura.

| Método | Rota relativa | Acesso |
| --- | --- | --- |
| GET | `/producer/store/delivery` | Produtor titular; leitura pelo backend |
| PUT | `/producer/store/delivery` | Titular, origem confiável e autenticação recente |

Montagem nos prefixos `/v1`, `/api/v1`, `/_hvm_api/v1`. Dispatcher Vercel existente preservado; query validada pela URL normalizada, descontando somente os metadados internos. O painel municipal `/produtor/entrega` da T12 continua independente e intacto.

## Segurança e compatibilidade

RLS **ENABLE + FORCE** nas três tabelas. `authenticated` recebe somente SELECT das cotações, filtrado pelo titular do endereço. `anon` não tem acesso; áreas/regras são operacionais privadas e lidas pelo backend com autorização. Grants automáticos do Supabase foram explicitamente revogados já na migração inicial: backend SELECT/INSERT/UPDATE em áreas/regras e SELECT/INSERT em cotações, sem TRUNCATE/REFERENCES/TRIGGER. Função Haversine executável somente pelo backend.

Adequações ao estado canônico: FKs novas usam CASCADE para preservar exclusão de endereço/conta/imóvel/loja já homologada. A referência da origem evita reutilizar área de imóvel removido. `distance_km` da cotação usa NUMERIC(8,2), pois um destino fora do raio pode estar a mais de 9999,99 km; restringir ao NUMERIC(6,2) do exemplo impediria a resposta amigável. T08 continua protegendo edição do GPS homologado. Nenhuma função, policy, trigger, preço, produto, lote, município ou regra anterior foi substituída.

Imediatamente após DDL: digest e contagem idênticos nas **55 relações anteriores**, incluindo Auth; três tabelas novas vazias. Nenhuma fixture foi criada em produção. Advisors: nenhum WARN/ERROR novo; avisos anteriores permanecem. Dois INFO `rls_enabled_no_policy` correspondem às áreas/regras deliberadamente privadas, e cinco INFO de índices ainda não usados correspondem às novas tabelas vazias. Sem novas FKs sem índice. Referência de RLS: https://supabase.com/docs/guides/database/postgres/row-level-security.

## Verificação

- Typecheck completo, build, manifesto, verificação de segredos e bundle aprovados.
- T16: **35** testes de contratos/HTTP/montagem; **27** testes PostgreSQL; **14** testes de interface em 320/390/768/1440 px; **1** história completa com interface compilada, HTTP real, guardas existentes e PostgreSQL.
- Regressão PostgreSQL T12/T13/T14/T15: **22/20/18/26** aprovados; histórias completas T14 e T15 aprovadas.
- Regressão de navegador T12–T16: **86** aprovados, incluindo os 14 da T16.
- Suíte geral executada: **606 aprovados**, **144 pulados** por configuração de integração. As suítes locais PostgreSQL/histórias foram executadas separadamente; isso não declara execução de toda a homologação histórica dependente de credenciais reais.
- Ariquemes (-9.9133, -63.0408) ↔ Porto Velho (-8.7612, -63.9004): **159,081402025558 km** geodésicos. O “≈ 200 km” do manual não corresponde a Haversine entre esses centros; foi mantido o cálculo matemático correto, também conferido por cossenos esféricos e implementação TypeScript. Nenhuma distância rodoviária é inferida pelo motor.

Os testes locais recusam qualquer URL que não seja `127.0.0.1:55432/postgres`. A história completa simula apenas Supabase Auth/Storage externos, usando dados descartáveis locais. Produção será verificada anonimamente; não se usa uma conta real para fabricar pedidos ou dados de teste.

## Publicação

Migração canônica aplicada e auditorias aprovadas. Publicação na main e conferência da SHA exata/READY serão registradas no fechamento desta trilha, junto ao release canônico e à verificação do site publicado.
