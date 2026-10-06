# Trilha 20 preparada, caixa e proteção da compra

Implementação aditiva sobre `main@7f4e619effd6c68d42811be8f1cf385c378e7227`, schema 57. A referência de trilhas é o PDF **HortiVitalMix — Plano T12–T25**, T20, Volume 4: pagamentos e webhook; a esteira de preparo da T21 permanece fora desta entrega. O titular ampliou o escopo para caixa presencial, reembolsos, denúncias, fotos e login, e determinou **preparar os pagamentos sem ativar gateway**, pois ainda não possui a conta.

Supabase único: `HortVitalMix`, `xipbsazvymkqqfmfegwu`. Repositório: `wesleialvessantos39/HortVitalMix`. Vercel: projeto existente `hortvitalmix`, produção exclusivamente pela main, região `pdx1`. Não há serviço, dependência, plano, cobrança de infraestrutura ou credencial nova.

## O que pode ser usado

| Área | Caminho | Comportamento |
| --- | --- | --- |
| Caixa do produtor | `/produtor/caixa` | Produtos da própria loja, quantidade, preços do servidor, escolha de Pix do sistema ou crédito/débito pela futura maquininha vinculada. Prepara venda, compartilha revisão com o cliente e permite cancelar venda pendente. Sem dinheiro e sem botão para declarar pagamento. |
| Revisão presencial | `/pos/venda/:code` | Cliente autenticado confere itens e termos. A revisão é vinculada a uma única conta. Confirmar termos não registra recebimento financeiro nem reserva estoque. |
| Pagamento preparado | `/pagamentos/:intentId` | Método escolhido no checkout, campos de cartão desabilitados, espaço para Pix e prazo real da reserva. Sem QR Code fictício, captura de PAN/CVV ou cobrança. Alias `/pedidos/:id/pagamento`. |
| Compras e comprovantes | `/compras` | Intenções pendentes, compras efetivamente aprovadas, snapshots e datas da proteção. Confirmação do recebimento pelo cliente inicia a contagem configurada. Alias `/pedidos`. |
| Reembolsos | `/reembolsos` | Política pública acessível antes do login. Solicitação vinculada a compra própria, valor integral/parcial, motivo, descrição, histórico, mensagens e anexos privados. |
| Denúncias | `/denuncias` | Consumidor denuncia loja, produtor ou produto. Produtor denuncia cliente associado a uma transação da sua loja. Acesso privado por protocolo. |
| Gestão de reembolsos | `/admin/reembolsos` | Super administrador ou administrador com `refund_management`: análise, aprovação/rejeição com justificativa e revisão para evitar decisão concorrente. Aprovação não significa estorno concluído. |
| Gestão de denúncias | `/admin/denuncias` | Super administrador ou administrador com `complaint_management`: análise, solicitação de informações, resolução/arquivamento, mensagens e evidências. Encaminhamento à governança de contas exige a permissão própria. |
| Política | `/admin/politica-reembolso` | Edição por Super administrador ou administrador autorizado em reembolsos; versionamento e termos congelados por compra. |
| Conta e maquininha futuras | `/admin/pagamentos` | Referências não secretas do provedor, conta central, chave Pix e terminal, editáveis por `payment_configuration`. Salvar referências não ativa cobrança. |

As três permissões foram adicionadas à governança já existente. Concessão e revogação continuam pelos fluxos anteriores do Super administrador. A API reconfere conta ativa, sessão, papel, expiração e setor; decisões, anexos e configurações administrativas exigem autenticação recente. Os setores não concedem automaticamente bloqueio de contas nem acesso às outras áreas.

## Modelo confirmado pelo titular

- Compras online: **7 dias após receber os produtos** para arrependimento quando aplicável. A data final é exibida no comprovante; o cliente vê os termos antes de confirmar. As regras podem ampliar esse prazo, preservando o mínimo legal.
- Compras presenciais: não se atribui automaticamente o arrependimento da compra online. Defeitos, problemas e política comercial continuam atendidos; prazo comercial inicial de devolução imotivada é zero e pode ser ampliado.
- Problemas de qualidade, fraude, falta de itens, produto divergente ou não entrega permitem análise humana. A política não elimina garantias legais: referência de 30 dias para produtos não duráveis e contagem própria para vício oculto. Não existe indeferimento automático de vício oculto por uma data comercial.
- Retenção: **7 dias após a entrega/recebimento**, com bloqueio enquanto houver disputa ou reembolso pendente. Recebimento é registrado uma vez; não se pode adiantar ou regravar a data pelo navegador.
- Nenhum dinheiro é movimentado nesta preparação. `app_financial_holds` registra a obrigação interna futura; custódia, divisão, taxa e repasse dependem do contrato e das APIs do provedor.

Referência legal: [Código de Defesa do Consumidor, arts. 18, 26 e 49](https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm). Termos adicionais permanecem editáveis e visíveis, sem substituir direitos legais.

## Banco e preservação

Migration CLI `20261006180831_trilha20_commerce_protection_prepared.sql`, aplicada no Supabase como **20261006191208**, com alias físico no validador; schema lógico **58**, **64 migrations**, hash **d18736b84cc19ccfc547f262843f1e5f048c4129086c6a091a568b14cd61b06e**.

Novas tabelas: `app_commerce_settings`, `app_commerce_receipts`, `app_pos_sales`, `app_payment_policy_acceptances`, `app_orders`, `app_financial_holds`, `app_payment_transactions`, `app_refund_requests`, `app_complaints`, `app_case_messages`, `app_case_history` e `app_case_evidence`. Os intents T19 são evoluídos, sem recriação: débito e origem exclusiva cotação **ou** venda presencial. Não há pedidos artificiais para as intenções antigas.

Todas as novas tabelas têm **ENABLE/FORCE RLS**. `authenticated` somente SELECT nas relações permitidas, isolando comprador/produtor ou autor da solicitação; registros financeiros brutos, recibos, configurações e metadados de anexos são somente backend. `service_role` recebe CRUD, sem TRUNCATE. A leitura administrativa passa pela API autorizada.

Snapshots de compra, aceite de política, recibos de comando, eventos financeiros, histórico e mensagens não podem ser reescritos. A exclusão de conta anterior continua funcionando por suas cascatas; referências de produtor/loja são anuladas quando necessário. O bucket `case-evidence` é privado, aceita JPG/PNG/WebP/PDF até 2 MB, no máximo dez anexos por protocolo. Download autorizado com assinatura curta e disposição de anexo. A fila de exclusão de Storage já existente recebe objetos após apagar a conta/protocolo ou após upload que não foi confirmado.

Os dados anteriores são comparados por contagem e digest em `TRILHA20_PRESERVACAO.json`. A comparação ignora somente os três novos setores, o novo bucket, a nova coluna nula do intent e a atualização da release. Não são criadas contas, compras, cartões, Pix ou uploads de teste em produção.

Após a aplicação, as **67 relações anteriores comparadas preservaram contagem e digest**; Auth permaneceu com cinco usuários e Storage com dez objetos anteriores. As 76 tabelas `app_*` têm ENABLE/FORCE RLS. Não há grant de INSERT/UPDATE/DELETE/TRUNCATE a anon/authenticated; grants legados de REFERENCES/TRIGGER em consentimentos/preferências não foram ampliados e permanecem registrados na evidência. Nenhuma policy ou privilégio de cliente anterior foi substituído.

## Segurança financeira e do pós-venda

`server/payments/gateway.ts` define a fronteira do futuro provedor e retorna **null**. `/payments/webhook` e `/payments/:id/start` retornam `GATEWAY_NOT_CONFIGURED`; preencher referências não altera isso. O corpo enviado pelo navegador nunca confirma pagamento.

A rotina interna de liquidação, disponível somente ao futuro adaptador, confere referência já persistida, método, moeda, total congelado, aceite e validade. Eventos são únicos por provedor/evento; um intent aprovado não cria pedidos duas vezes. Consumo das reservas, criação por loja, retenção, limpeza das quantidades compradas na cesta e registro financeiro ocorrem em uma transação SQL. O estoque foi descontado durante a reserva T15: a liquidação não faz uma segunda baixa. Reserva expirada aborta toda a operação.

Solicitação de reembolso bloqueia o repasse; aprovação marca `refund_pending`. Estorno total/parcial só é registrado após confirmação confiável do provedor. O processamento remoto atualmente falha por ausência de gateway. Produtos alimentícios devolvidos não são automaticamente recolocados no estoque. Resolver uma denúncia não libera valores se houver outra disputa ou reembolso aberto.

Denúncias não aplicam sanção automática. O acesso à conta denunciada usa a governança de segurança anterior, com a permissão própria e seu histórico. Clientes não podem pesquisar qualquer pessoa privada; o seletor de clientes do produtor deriva dos pedidos da sua loja. Filas de denúncias/reembolsos são paginadas e filtradas sem truncar os protocolos antigos.

Comandos possuem UUID e hash de payload persistidos; repetição preserva o resultado, divergência retorna conflito. Origem é verificada nas mutações, com exceção limitada ao caminho exato do webhook futuro. Contratos estritos recusam identidade, preço, campos extras e dados de cartão. O limite maior de JSON aplica-se apenas ao upload de evidência; os demais endpoints preservam 32 KB.

## Fotos e login

Os dados das vitrines passam a ser exibidos sem aguardar a preparação conjunta das fotos, que continua em paralelo. Assinaturas válidas dos buckets de produto/loja são reaproveitadas também após recarga, por sessão e por até cinco minutos, respeitando a expiração do token. URLs de outro domínio/bucket são rejeitadas e logout limpa o cache. Fotos principais mantêm prioridade; imagens fora da área visível continuam com carregamento progressivo. Nenhuma foto anterior foi removida, regravada ou tornada pública.

Medição da produção anterior à publicação: API de destaques 3.103 ms na primeira leitura; foto de produto 50.574 bytes, 1.179 ms inicial/85 ms seguinte; capa 316.108 bytes, 1.443 ms inicial/43 ms seguinte, com CDN HIT. Isso identifica benefício do reaproveitamento; não é uma promessa de imagem instantânea em qualquer rede nem medição do código novo em produção.

Login de consumidor/produtor abre `/`; login administrativo mantém `/admin/painel`. Ícone de conta informa sessão ativa e papel em desktop e mobile, inclusive dentro do portal administrativo. Os cadastros e a revisão de identidade anteriores foram preservados.

## Validação reproduzível

```sh
npm run typecheck
npm run build
npm run test:t20:unit
# Banco descartável exclusivamente local, porta 55432:
HVM_T20_LOCAL_DATABASE_URL=postgresql://postgres:t20_disposable@127.0.0.1:55432/postgres npm run test:t20:postgres
HVM_T20_LOCAL_DATABASE_URL=postgresql://postgres:t20_disposable@127.0.0.1:55432/postgres npm run test:t20:story
npm run test:t20:e2e
```

Evidências verificadas: 22 cenários novos PostgreSQL, 14 HTTP, 7 contratos, 2 persistência de mídia e uma história React → API/sessão/permissão → PostgreSQL. A história usa adaptador **isolado de Auth/Storage e confirmação sintética somente no banco descartável** para testar pedidos e reembolsos; a produção não contém provedor simulado. Foram conferidos propriedade, RLS, falta de estoque/validade, consumo único, evento repetido, valores divergentes, revisão presencial, autorização revogada, aprovação sem falsa devolução, estorno parcial idempotente, anexos privados e repetição do décimo upload.

34 cenários T20 em 320/390/768/1440 px passaram, incluindo os quatro logins em mobile/desktop e a política pública antes do login; inspeção visual dos fluxos de reembolso e administração. 52 cenários afetados de cesta/checkout/mídia passaram entre a execução conjunta e a repetição isolada de uma interação de abas. Histórias reais T19/T20 preservadas. Suíte geral: **760 passaram/283 condicionais não executados**; PostgreSQL local **203 + 15 = 218** cenários passaram. A suíte de mídia exige banco vazio e foi executada isoladamente após a rodada conjunta; a contaminação de fixtures da rodada conjunta não foi tratada como sucesso. Replay das 64 migrations em banco limpo, build, TypeScript global e de produção, manifesto, verificação de segredos e cold start aprovados.

## Ativação financeira futura

Esta entrega não homologa cobrança, QR Pix real, captura de cartão, maquininha, custódia, saque ou devolução bancária. A conta ainda não existe. Para ativar será necessário escolher provedor sem mensalidade, validar a retenção/divisão por contrato, implementar seu adaptador, configurar credenciais **somente no servidor**, implementar a criação/reconciliação de cobranças e a reserva presencial, incorporar campos de cartão hospedados/tokenizados e testar em sandbox antes da produção.

A assinatura do webhook deve seguir o protocolo real do provedor, validar ambiente e recuperar o pagamento na API autenticada antes de retornar `VerifiedPayment`. Prazo Pix e reserva precisam ser compatíveis; a pesquisa do Mercado Pago identificou validade mínima de 30 minutos frente às reservas T19 de 15. Nenhuma reserva expirada pode ser ressuscitada. Ativar repasses exige confirmação financeira, término da carência e ausência de disputa; a passagem do tempo sozinha não transfere dinheiro.

## Publicação e conferência em produção — 2026-10-06

Publicada pela main nos [PRs 83](https://github.com/wesleialvessantos39/HortVitalMix/pull/83) e [84](https://github.com/wesleialvessantos39/HortVitalMix/pull/84). SHA funcional conferida: **788cea45dd8cb4603f5cea76b988b7d82bc9d9ed**, tree **294da7446451c9a7346957cf0853a5cea1b2b3b0**, deployment **dpl_FHAohFUX1FWtBKD7dyLTBdeiTrt6**, **READY / production / main / pdx1** em [hortvitalmix.vercel.app](https://hortvitalmix.vercel.app). A release `t20-prepared-v58-788cea4` foi registrada somente após READY. O fechamento documental mantém esse código e recebe o selo da SHA corrente após seu próprio READY.

O verificador CLI passou em **health/ready/config**, schema 58 e SHA exata, com o proxy de rede do executor configurado. Nove verificações adicionais pelo navegador passaram: endpoints públicos 200; compras, caixa, administração, reembolsos e denúncias sem sessão 401; webhook com aprovação forjada 503 `GATEWAY_NOT_CONFIGURED`. Nenhum lançamento financeiro foi produzido.

Navegador real em **390/1440 px**: `/reembolsos` e `/denuncias` acessíveis, política legível antes do login; home, `/produtos` e loja real com fotos de produto/capa carregadas. **Dez combinações página/largura**, sem erro JavaScript ou overflow. A conferência encontrou e corrigiu a política inicialmente escondida de visitantes; dois testes adicionais comprovam o ajuste. Áreas autenticadas foram homologadas nos testes locais com API e PostgreSQL; não se declara teste autenticado de contas reais em produção.

Amostra pós-publicação pelo proxy do executor: todas as fotos visíveis da home carregadas em **2.546 ms mobile / 1.189 ms desktop**, recarga em **953/917 ms**, com reaproveitamento de assinaturas e sinais de cache de memória. Catálogo com foto em **823/764 ms** e loja com capa/produto em **1.413/1.354 ms**. São amostras, não garantia de imagem instantânea nem benchmark estatístico. Nenhuma URL assinada, token ou identificação privada integra a evidência.

Logs do deployment sem grupos `error/fatal` na janela consultada de dez minutos. Reconfirmação do banco: **76 tabelas ENABLE/FORCE RLS**, zero grants DML de cliente, **64 migrations**, cinco usuários Auth e dez objetos de mídia anteriores. A comparação imediatamente após a migration permanece **67/67 relações preservadas**. Depois da publicação houve uso autenticado concorrente, registrado pelos eventos `checkout.quoted`, `checkout.confirmed`, `payment.policy_accepted` e `cart.remove`; os digests finais de Auth/cesta/cotação/reserva refletem essa atividade e não são declarados iguais ao baseline. Pedidos aprovados, eventos financeiros, retenções, vendas de caixa e objetos de evidência continuam zero no instante conferido. As verificações de produção não criaram conta, compra, cartão ou upload de teste.

Advisors preservados: quatro WARN nos helpers SECURITY DEFINER anteriores, um WARN de proteção de senha vazada e 22 WARN de policies permissivas anteriores. Não houve WARN/ERROR novo da T20. INFO de RLS sem policy inclui quatro tabelas novas deliberadamente exclusivas do backend; índices novos ainda sem uso aparecem como INFO. Os achados e links de correção estão em `TRILHA20_PRESERVACAO.json`. Supabase Preview foi ignorado e Vercel cancelou os previews pelo filtro main; CodeRabbit indicou revisão não executada. Não se apresenta esses estados como revisão independente aprovada.
