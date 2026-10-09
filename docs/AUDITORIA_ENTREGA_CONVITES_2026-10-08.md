# Entrega dos convites administrativos no Gmail

Verificação realizada em **8 de outubro de 2026, 22:31 no horário de Cuiabá** (**9 de outubro, 02:31 UTC**). Projeto Supabase: `xipbsazvymkqqfmfegwu`; aplicativo: `https://hortvitalmix.vercel.app/`.

## Resultado confirmado

O usuário informou que configurou o modelo no Supabase e que os convites recebidos no Gmail são classificados como spam. Isso confirma o relato de classificação pelo destinatário, mas não identifica, por si só, qual mecanismo de autenticação, reputação ou configuração está causando a classificação.

A integração TinyFish agora disponibiliza ferramentas de navegador. A consulta `list_profiles` retornou somente o perfil **Default**, `prof_33b3dce5817c4d04`, com `signed_in_sites: []` e `domain_count: 0`. Não há sessão autenticada comprovada do painel Supabase nesse perfil. Nenhuma automação foi iniciada para tentar contornar o acesso; nenhum segredo, senha SMTP, cookie ou token foi extraído.

As ferramentas Supabase desta sessão permitem consultar documentação, banco e funções, mas não disponibilizam leitura ou alteração da configuração Auth/SMTP hospedada. Portanto, **o provedor, o remetente, o domínio de envio, a habilitação do SMTP personalizado e a autenticação DNS atuais ainda não foram verificados**. Não é correto afirmar que falta SMTP, que o Gmail está configurado incorretamente ou que uma alteração de DNS foi aplicada.

Documentos históricos do repositório, como `TRILHA04_VALIDACAO.md`, citam SMTP/Gmail dentro do Supabase. São um registro do desenho anterior, não uma leitura da configuração hospedada nesta verificação.

## O que o aplicativo já faz

O envio administrativo usa o Supabase Auth por `inviteUserByEmail`, mantendo o transporte de autenticação no SMTP configurado no projeto. O modelo local `supabase/templates/invite.html` contém a marca, a função administrativa, as instruções de ativação e os links da própria ativação; não contém imagens remotas nem campanhas promocionais.

Alterar CSS, publicar o aplicativo na Vercel ou modificar o HTML local não muda SPF, DKIM, DMARC, reputação do remetente nem o modelo já hospedado. Nenhuma mudança de conteúdo foi aplicada apenas para prometer remoção do spam.

## Configuração necessária para investigar e corrigir

1. Verificar, no [SMTP Settings do projeto correto](https://supabase.com/dashboard/project/xipbsazvymkqqfmfegwu/auth/smtp), se o SMTP personalizado está habilitado e qual é o provedor, o endereço do remetente, o domínio e o nome de exibição. A leitura deve registrar somente esses dados de apresentação/configuração, sem revelar campos de senha ou credenciais.
2. Verificar no provedor a autorização do remetente e os registros DNS solicitados para autenticação. SPF e DKIM devem autorizar o serviço realmente usado, com alinhamento ao domínio do remetente quando aplicável. DMARC deve ser configurado conforme o domínio e os fluxos de e-mail existentes.
3. Consultar DNS público somente para o domínio confirmado do remetente e o seletor DKIM informado pelo provedor. O domínio `vercel.app` do endereço do site não deve ser usado como se fosse o domínio de envio. Não adivinhar seletores DKIM nem substituir registros SPF existentes.
4. Analisar os resultados de autenticação de uma mensagem já recebida no Gmail, especialmente `Authentication-Results`, `From`, `Return-Path` e o domínio `d=` de DKIM. Para compartilhamento, remover destinatários, identificadores, tokens e o corpo/URL do convite. Não publicar o cabeçalho integral se ele contiver dados pessoais.
5. Conferir no provedor a entrega, rejeição, bloqueio ou reputação, preservando o histórico e sem reenviar convites repetidamente como tentativa de melhorar a reputação.
6. Aplicar somente uma correção fundada nessas leituras, reabrir a configuração para confirmar persistência e repetir as consultas DNS. Não trocar fornecedor, comprar domínio, contratar plano, mudar política DMARC para `reject` nem desativar confirmação de e-mail sem analisar o efeito sobre os envios existentes.

Se o remetente for um endereço `@gmail.com`, a aplicação não controla o DNS desse domínio. Nesse caso, não é possível inserir SPF/DKIM/DMARC de `gmail.com` para o aplicativo; é preciso conferir a autorização do SMTP usado ou trabalhar com um domínio próprio e um provedor que o autentique.

## Limites e comprovação

Uma confirmação HTTP de envio pelo aplicativo demonstra que a solicitação foi aceita pelo serviço, não que o Gmail a colocou na Caixa de entrada. Mesmo com autenticação e remetente corretos, a classificação depende de fatores do serviço de destino e não pode ser garantida pelo aplicativo.

Nesta verificação não houve leitura autenticada do SMTP hospedado, consulta DNS de um remetente confirmado, alteração de produção nem envio real de convites. O acesso autenticado ao painel e a identificação do remetente/provedor são as dependências concretas para concluir a correção de entrega.

## Fontes atuais consultadas

- [Supabase — Send emails with custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp): o serviço padrão é destinado a testes; recomenda SMTP próprio para produção, autenticação SPF/DKIM/DMARC, conteúdo focado e separação dos envios de autenticação e marketing.
- [Supabase — Changes to Email Template Customisation on Free Tier, 3 de junho de 2026](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier): a restrição de modelos nos projetos Free novos com SMTP padrão não é, por si só, um diagnóstico de spam neste projeto.
- [Google — Diretrizes para remetentes de e-mail](https://support.google.com/a/answer/81126?hl=pt-BR): requisitos de autenticação, reputação e envio para entrega ao Gmail. SPF/DKIM/DMARC devem refletir o provedor real.
- [Guia de configuração do modelo deste aplicativo](GUIA_CONFIGURAR_CONVITE_SUPABASE.md).
