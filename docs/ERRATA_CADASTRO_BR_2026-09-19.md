# Errata funcional — Cadastro brasileiro e separação de acessos

Data: 2026-09-19.

Esta errata foi solicitada explicitamente pelo proprietário após a implementação inicial da Trilha 01. Ela prevalece sobre os rótulos e formatos anteriores nos pontos abaixo.

## CPF

- Interface: máscara automática `000.000.000-00`.
- Backend: aceita valor mascarado ou somente dígitos.
- Persistência: continua canônica em `cpf_normalized`, com 11 dígitos e validação de DV.
- A mesma função de máscara/normalização é compartilhada e deverá ser reutilizada quando os fluxos administrativos forem ativados.

## Celular

O produto passa a operar somente com celular brasileiro nesta etapa.

- Rótulo: **Celular com DDD**.
- Interface: máscara automática `(69) 99381-0921`.
- Backend: valida DDD + celular de 9 dígitos iniciado por 9.
- Persistência: continua em E.164, por exemplo `+5569993810921`.
- O DDI deixa de ser solicitado ao usuário; `+55` é acrescentado pelo backend.

## Forma de tratamento

A interface precisa apresentar rótulos gramaticais masculinos ou femininos:

- Produtor / Produtora;
- Consumidor / Consumidora;
- Administrador / Administradora;
- Super administrador / Super administradora.

Para evitar classificação incorreta de uma pessoa a partir do nome, o sistema **não infere sexo ou gênero pelo nome**. O cadastro coleta explicitamente `grammaticalTreatment = masculine | feminine`, utilizado apenas para linguagem de interface e nunca para autorização.

O banco registra essa preferência em `app_people.grammatical_treatment`.

## Produtor e imóvel

O campo anteriormente apresentado como **Nome da sua produção** passa a ser **Nome de seu imóvel**.

A alteração é estrutural:

- contrato: `propertyName`;
- banco: `app_producer_profiles.property_name`;
- a coluna anterior `brand_name` é renomeada por migration, não duplicada.

## Separação de telas

As abas combinadas deixam de ser o fluxo principal.

Rotas:

- `/entrar` — login público;
- `/cadastro/consumidor` — cadastro de consumidor/consumidora;
- `/cadastro/produtor` — cadastro de produtor/produtora;
- `/acesso/administracao` — tela administrativa pré-preparada;
- `/conta` — alias legado de login para compatibilidade;
- rotas de recuperação/confirmacão permanecem isoladas.

A tela administrativa é apenas preparação visual nesta etapa. Os campos ficam desativados e nenhum endpoint público de cadastro administrativo é criado. Quando a etapa administrativa for implementada, o perfil deverá continuar sendo derivado de autorização server-side, não de uma escolha feita na tela.

## Banco e schema

Migration adicionada:

`20260919224500_registration_br_profile.sql`

O schema lógico passa de **8 para 9** e o manifesto/hash de migrations é atualizado. A quantidade de tabelas `app_*` permanece 8.

## Critérios de aceite

- CPF digitado como `52998224725` aparece como `529.982.247-25`.
- celular digitado como `69993810921` aparece como `(69) 99381-0921`.
- API persiste telefone como `+5569993810921`.
- consumidor e produtor possuem páginas de cadastro distintas;
- login possui página própria;
- página administrativa existe e está desativada;
- cadastro de produtor usa `propertyName/property_name`;
- sessão devolve `grammaticalTreatment` e os rótulos de papel usam essa preferência;
- nenhum papel administrativo pode ser autoatribuído por cadastro público.
