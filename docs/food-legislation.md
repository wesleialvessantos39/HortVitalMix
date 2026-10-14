# Legislação e segurança dos alimentos no HortiVitalMix

Referências verificadas em 13/10/2026. Abrangência: Brasil, com complementos estaduais e municipais configurados pelo departamento. A biblioteca é uma seleção de referências relevantes, e não um levantamento exaustivo das normas de cada município. Enquadramento, licenciamento e exigências técnicas precisam ser confirmados para a atividade, alimento e local de produção.

| Tema | Referências e aplicação |
| --- | --- |
| Boas práticas na produção | Portaria SVS/MS 326/1997 e RDC 275/2002: instalações, higiene e procedimentos de estabelecimentos produtores/industrializadores. |
| Serviços de alimentação | RDC 216/2004, quando a atividade estiver nesse enquadramento; não é regra universal para toda indústria. |
| Pequenos empreendimentos | RDC 49/2013: inclusão produtiva com segurança sanitária; não representa dispensa automática das exigências. |
| Água | [Portaria GM/MS 888/2021 e alterações](https://www.gov.br/saude/pt-br/composicao/svsa/saude-ambiental/vigiagua/legislacao): potabilidade e controle conforme origem e uso. |
| Microbiologia | RDC 724/2022 e IN 161/2022, com alterações: padrões por alimento e aplicação dos controles. |
| Contaminantes | RDC 722/2022 e IN 160/2022, com alterações: limites e requisitos aplicáveis a cada alimento. |
| Frutas, vegetais e cogumelos | RDC 726/2022, quando aplicável ao produto e processamento. |
| Chás, ervas e especiarias | RDC 716/2022 e IN 159/2022, com alterações: espécies, partes e usos autorizados. |
| Grãos, cereais e farinhas | RDC 711/2022 e requisitos correspondentes de contaminantes, microbiologia e rotulagem. |
| Alimentos preparados | RDC 719/2022, quando aplicável, além do enquadramento da atividade e dos ingredientes. |
| Rastreabilidade vegetal | [INC Anvisa/MAPA 2/2018, alterada pela INC 1/2019](https://www.gov.br/agricultura/pt-br/assuntos/camaras-setoriais-tematicas/documentos/camaras-setoriais/hortalicas/2019/56deg-ro-hortalicas/inc-02-2018-e-01-2019-rastreabilidade.pdf): origem e registros da cadeia de vegetais frescos. |
| Rotulagem | RDC 727/2022: informações gerais e alergênicos; RDC 429/2020 e IN 75/2020: rotulagem nutricional, considerando exceções. Lei 10.674/2003: glúten. |
| Embalagens | [RDC 91/2001 e regulamentos por material](https://www.gov.br/anvisa/pt-br/setorregulado/regularizacao/alimentos/embalagens): aptidão ao contato com alimentos. |
| Regularização Anvisa/SNVS | [RDC 843/2024 e IN 281/2024](https://www.gov.br/anvisa/pt-br/setorregulado/regularizacao/alimentos/dispensa-de-registro/): registro, notificação ou comunicação conforme a categoria. Licenciamento local é uma verificação distinta. |
| Sucos, polpas e outras bebidas | Lei 8.918/1994 e [Decreto 12.709/2025](https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2025/decreto/d12709.htm), mais padrões específicos do MAPA. O Decreto 6.871/2009 foi revogado pelo novo decreto; não é apresentado como regulamentação geral vigente. |
| Sucos e polpas artesanais familiares | Lei 13.648/2018 e Decreto 10.026/2019, conforme seus critérios; consultar as [orientações e atualizações do MAPA](https://www.gov.br/agricultura/pt-br/assuntos/inspecao/produtos-vegetal/legislacao-programas-nacionais-e-seguranca-dos-alimentos-1/legislacao/bebidas). |
| Origem animal | Lei 1.283/1950 e [RIISPOA, Decreto 9.013/2017 e alterações](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2017/decreto/d9013.htm). Verificar serviço de inspeção, alcance territorial e requisitos de regimes artesanais. |
| Orgânicos | Lei 10.831/2003, Decreto 6.323/2007 e [normas complementares do MAPA](https://www.gov.br/agricultura/pt-br/assuntos/sustentabilidade/organicos/legislacao-organicos). Não anunciar como orgânico sem verificar a comprovação aplicável. |
| Insumos agrícolas | [Lei 14.785/2023](https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2023/lei/l14785.htm), monografias e limites de resíduos aplicáveis. |
| Recolhimento | [RDC 655/2022](https://www.gov.br/anvisa/pt-br/assuntos/noticias-anvisa/2022/rdc-655-2022): providências e comunicações aplicáveis quando houver risco. A pausa da plataforma não substitui recolhimento oficial ou atendimento aos compradores. |
| Consumidor e comércio eletrônico | [Lei 8.078/1990](https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm), especialmente informação, segurança e responsabilidade; Decreto 7.962/2013. Os artigos 25 e 51 impedem renúncias incompatíveis com os direitos do consumidor. |
| Meio ambiente | Lei 12.305/2010 e Lei 9.605/1998, conforme obrigações, resíduos e impactos da atividade. Um termo privado não afasta deveres legais. |

As normas Anvisa e suas alterações devem ser consultadas no [AnvisaLegis](https://www.gov.br/anvisa/pt-br/assuntos/alimentos/legislacao). A competência varia: vigilância sanitária, MAPA e serviços de inspeção não são intercambiáveis.

## Funcionamento do departamento

- Acesso `/admin/legislacoes`, com poder `food_legislation`. Superadministrador tem acesso conforme a governança existente; administradores precisam receber esse poder, respeitando bloqueios explícitos.
- Regras selecionadas por família, processo, categoria e local de produção. Todas as restrições preenchidas precisam coincidir. O município usa comparação normalizada, sem diferenciar acentos e maiúsculas.
- Salvar rascunho preserva a regra publicada anterior. Publicar cria uma versão imutável; os produtos atingidos precisam aceitar os cuidados vigentes. A regra geral permanece ativa.
- Materiais educativos admitem desenhos, texto, imagens, vídeos enviados e YouTube, com escolha de público e abrangência. Arquivos ficam em bucket privado, com upload autorizado e exibição após publicação.
- Acompanhamento permite pausar e liberar oferta com justificativa auditada. A liberação não dispensa um aceite ainda pendente.
- Os aceites guardam versões, cuidados, termos, produto e momento da declaração. Não são licença, certificação ou inspeção oficial.
- Vitrine, carrinho, estoque reservado e checkout verificam a disponibilidade. Pedidos históricos continuam preservados.

## Ensinamentos e publicação

O produtor encontra `/produtor/legislacoes` e confirma o checklist ao publicar o produto. A classificação e a conservação precisam estar salvas. Alterações relevantes invalidam a declaração anterior; preço e foto não mudam os cuidados por si só. A área pública `/cuidados-com-alimentos` e as informações de cada produto orientam o consumidor.

Os termos definem deveres do produtor e a atuação de intermediação do HortiVitalMix. A ressalva sobre direitos do consumidor e responsabilidades legais acompanha todos os aceites, inclusive os termos complementares editados pelo departamento.
