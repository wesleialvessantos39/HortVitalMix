# Correções de papéis, Minhas vendas, reembolsos e notificações

Implementação aditiva sobre `e53b712ef30c08ca07dc79ad71830a75922b3027` (T24/schema 62). Schema lógico **63**, **69 migrations**, hash **3363f83f98ec91afabc8043d9f75ecee680842b1e4a5b63fe809c889b945e379**. Migration `20261007140032_roles_sales_notifications.sql`. Mapa completo: [MAPA_SISTEMA_NOTIFICACOES.md](MAPA_SISTEMA_NOTIFICACOES.md).

## Comportamento entregue

- Produtor usa **Minhas vendas**, caixa e pedidos da loja. Compras, checkout, acompanhamento de compra e avaliações exigem cadastro e portal consumidor; cookie não concede papel. Login de produtor não importa cesta de consumidor.
- **Minhas vendas** consolida vendas online/presenciais confirmadas, valores retidos/em análise/reembolsados e revisões pendentes do caixa. Pedidos e reembolsos têm links filtrados pela venda e titular reais. Valores encerrados de retenção não são anunciados como repasse recebido.
- **Reembolsos das minhas vendas** é leitura: etapas genéricas, valores e contatos enviados especificamente pela administração. Descrição, identidade do solicitante, mensagens/anexos privados, notas administrativas e referência de gateway ficam fora dessa projeção.
- Admin de `refund_management` ou Super administrador pode iniciar contato separado ao vendedor, com autenticação recente, origem protegida, comando idempotente e histórico imutável. Produtor não decide/edita o reembolso.
- Central e sino preparados para os quatro papéis, filtros/lidas/paginação, destinos contextuais e contagem própria. A revogação de setor é verificada no banco, inclusive para leitura de IDs antigos. Triggers nativos integram compras, vendas, logística, reembolsos, denúncias, avaliações, assinaturas, imóveis/documentos, conta, estoque e administração.
- Badge da cesta conta opções/linhas, enquanto quantidade, subtotal, HortiMix e estoque mantêm seus cálculos reais. Uma opção com oito unidades conta **1**; adicionar outra opção passa a **2**.

## Verificação

- **850 testes unitários/contratos/rotas** aprovados na rodada geral. Suites SQL/browser dependentes de banco são executadas separadamente, sem marcar skips como sucessos.
- **17 testes novos em PostgreSQL 17**: papel consumidor obrigatório, quantidades e subtotal, isolamento de vendas, estados logísticos/avaliação, quatro papéis/setores, privacidade, idempotência de contato, leitura por titular, watermark, revogação de setor, RLS/sem DML, conteúdo imutável, rollback, trabalho pendente, ciclos e anexos privados.
- **136 regressões SQL anteriores**: cesta 18, checkout 25, comércio 22, pedidos 19, logística 11, assinaturas 20 e avaliações 21. Replay limpo das 69 migrations em banco local descartável para cada suite.
- História nova **navegador → HTTP/serviços reais → PostgreSQL → navegador** aprovada: quatro papéis, venda vinculada a pedidos/caixa, reembolso solicitado pelo consumidor, mensagem privada, contato administrativo separado, produtor somente acompanha, notificações lidas persistidas, badge 2 com quantidade total 5. Somente transporte Auth/Data API tem adaptador local; APIs comerciais não são interceptadas nessa história.
- Histórias anteriores de **assinaturas/Pix T23** e **avaliação/reputação/moderação T24** aprovadas com serviços e PostgreSQL reais locais.
- **83 cenários de interfaces anteriores** aprovados entre a rodada e a verificação dirigida do único carregamento que excedeu o prazo de 5s em execução concorrente. Cesta, checkout, pagamento, caixa, reembolsos, pedidos, login e políticas em 320/390/768/1440px. Sem relaxar timeout/asserts.
- Telas novas de vendas, reembolso do produtor e notificações dos quatro papéis verificadas em **320, 390, 768 e 1440px**, sem overflow e sem erros JavaScript. O sino foi ajustado para todas as rotas e o cabeçalho administrativo para caber em 320px.
- TypeScript global/de produção, manifesto/hash, build gratuito, verificação de segredos/bundle e cold start CommonJS/ESM aprovados.

As expectativas antigas do badge foram atualizadas para a regra solicitada, mantendo as verificações independentes de quantidade/subtotal/concorrência. Fixtures locais de produtores usados como compradores agora cadastram explicitamente `consumer`; os novos testes cobrem produtor sem esse cadastro e produtor com os dois papéis no portal errado. Alteração de erro HTTP 401→403 para sessão administrativa em compra reflete papel inadequado, não perda de autenticação.

## Preservação e publicação

As 68 migrations anteriores foram comparadas byte a byte com a base e permanecem idênticas; hash anterior `efa1d2600ff63af3d6225da0535b17aab35f52232013a81c6196edec106b2833`. As duas tabelas novas têm ENABLE/FORCE, authenticated SELECT e backend para mutações. Sem fixture/reset na produção, sem alteração de dependências/lockfile, configuração Vercel, processamento de imagens ou preços iniciais de planos. Supabase canônico `xipbsazvymkqqfmfegwu`; publicação exclusiva na `main`/`pdx1`.

Snapshot prévio: **94 relações** de domínio/Auth/Storage, **5 usuários Auth**, **10 objetos Storage**. Comparação pós-migration, versão física, PR, SHA, deployment e selo verificados estão registrados em `CORRECOES_PRESERVACAO.json` e no Livro-Raiz. Migration aplicada no Supabase canônico como **20261007163252**; **94/94 relações anteriores mantêm contagem e digest**. Agora há **92/92 tabelas app_* com ENABLE/FORCE**, zero DML de clientes, zero execução de cliente no emissor e zero acesso anônimo ao schema privado. Nenhum aviso/caso fictício foi criado na produção. Advisories mantêm **5 WARN de segurança e 25 WARN de performance**, sem novos WARN/FKs sem índice; somente cinco novos índices ainda sem uso geram INFO. Código publicado na **main**, PR **#95**, SHA **4bbade19b34fd6ad687f2629dde8b1ded54edf92**, deployment **dpl_2h6x1HEWevXNkE9rZkSXHMSBBNo3 READY/pdx1**. Health/ready/config aprovados no domínio oficial com schema 63. APIs privadas novas recusam sessão ausente (401/no-store); telas novas carregam em quatro larguras sem erros JavaScript. Zero grupos de erros de runtime no deployment verificado. Após publicação, **93/93 relações de negócio/Auth/Storage permanecem idênticas**; somente `app_releases` recebeu o selo de release, preservando o histórico anterior. O fechamento documental mantém o selo no SHA vigente da main.

Gateway e custos permanecem como homologados na T24. Nomes/preços comerciais continuam para configuração posterior no painel, conforme escolha do usuário. As notificações são internas; comunicações de segurança Auth e link de WhatsApp existentes seguem as regras anteriores.
