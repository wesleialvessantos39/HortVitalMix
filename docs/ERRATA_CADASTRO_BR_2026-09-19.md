# Errata funcional — Cadastro brasileiro e separação de acessos

Data: 2026-09-19.

Esta errata reúne as decisões atuais do proprietário para os cadastros e acessos públicos. A decisão anterior de diferenciar masculino/feminino foi **revogada**.

## CPF

- Interface: máscara automática `000.000.000-00`.
- Backend: aceita valor mascarado ou somente dígitos.
- Persistência: continua canônica em `cpf_normalized`, com 11 dígitos e validação de DV.
- A mesma função de máscara/normalização deve ser reutilizada quando os fluxos administrativos forem ativados.

## Celular

O produto opera somente com celular brasileiro nesta etapa.

- Rótulo: **Celular com DDD**.
- Placeholder exibido dentro do campo: **`(00) 00000-0000`**.
- Conforme o usuário digita os 11 números, a máscara é aplicada automaticamente, por exemplo `(69) 99381-0921`.
- Backend valida DDD + celular de 9 dígitos iniciado por 9.
- Persistência continua em E.164, por exemplo `+5569993810921`.
- O DDI não é solicitado ao usuário; `+55` é acrescentado pelo backend.

## Nomes de perfis

Não existe seleção, detecção ou persistência de masculino/feminino.

Os nomes canônicos de interface são exclusivamente:

- **Consumidor**
- **Produtor**
- **Administrador**
- **Super administrador**

Esses nomes são rótulos de interface; autorização continua derivada exclusivamente dos papéis server-side.

## Produtor e imóvel

O campo anteriormente apresentado como **Nome da sua produção** permanece substituído por **Nome de seu imóvel**.

A alteração é estrutural:

- contrato: `propertyName`;
- banco: `app_producer_profiles.property_name`;
- a coluna antiga `brand_name` não é recriada.

## Separação de telas

As rotas permanecem separadas:

- `/entrar` — login público;
- `/cadastro/consumidor` — cadastro de Consumidor;
- `/cadastro/produtor` — cadastro de Produtor;
- `/acesso/administracao` — tela administrativa pré-preparada;
- `/conta` — alias legado de login;
- rotas de recuperação/confirmação permanecem isoladas.

A tela administrativa continua apenas preparada nesta etapa. Nenhum endpoint público de cadastro administrativo é criado.

## Banco e schema

Migrations relacionadas:

- `20260919224500_registration_br_profile.sql` — introduziu `property_name` e, temporariamente, um campo de tratamento;
- `20260919231000_remove_grammatical_treatment.sql` — remove definitivamente o campo de tratamento e sua constraint.

O schema lógico passa para **10**. A quantidade de tabelas `app_*` permanece 8.

## Critérios de aceite

- CPF digitado como `52998224725` aparece como `529.982.247-25`;
- o campo de celular vazio mostra `(00) 00000-0000`;
- celular digitado como `69993810921` aparece como `(69) 99381-0921`;
- API persiste telefone como `+5569993810921`;
- não existe campo masculino/feminino;
- sessão não devolve informação de tratamento;
- os rótulos são somente Consumidor, Produtor, Administrador e Super administrador;
- consumidor e produtor possuem páginas de cadastro distintas;
- login possui página própria;
- página administrativa existe e permanece desativada;
- cadastro de produtor usa `propertyName/property_name`;
- nenhum papel administrativo pode ser autoatribuído por cadastro público.
