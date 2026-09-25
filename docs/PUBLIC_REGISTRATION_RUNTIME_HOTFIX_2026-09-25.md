# Hotfix de cadastro público — Vercel e Google Studio

**Execução:** AUTH-REG-20260925-01  
**Escopo:** cadastro de Consumidor e Produtor.  
**Schema:** permanece 29; nenhuma migration nova é necessária.  
**Governança:** somente recursos gratuitos.

## Evidência da falha

O proprietário reportou dois sintomas simultâneos:

- Vercel: falha interna HTTP 500 ao cadastrar Consumidor ou Produtor;
- Google Studio: HTTP 403 apresentado como “Cadastro não autorizado”.

A inspeção do projeto canônico encontrou:

1. não houve criação recente em `auth.users`, `app_users`, `app_people` ou `app_user_role_assignments` nas tentativas atuais;
2. `auth_logs` não registrou chamada recente de cadastro, portanto as tentativas observadas falharam antes de alcançar o Supabase Auth;
3. o Livro-Raiz já registrava o mesmo HTTP 403 do proxy do Google Studio em 2026-09-20;
4. o contorno então homologado fazia fallback do cadastro público para um runtime fora do proxy do Studio;
5. esse fallback foi posteriormente removido por uma correção de segurança, e o código atual voltou a depender apenas dos aliases same-origin `/_hvm_api` e `/api`;
6. o cadastro Express atual também depende de `supabaseAdmin` no runtime Vercel. Login/sessão já possuíam fallbacks posteriores, mas o cadastro ainda encerrava quando o client privilegiado não estivesse disponível.

O conector Vercel desta sessão não possui autorização para os runtime logs do projeto, portanto não se atribui o HTTP 500 a uma variável específica sem evidência. A correção elimina o ponto único de falha sem abrir CORS geral no Express.

## Correção

### 1. Supabase Edge Function pública e estritamente limitada ao cadastro

Criada e implantada a função gratuita:

`public-registration`

Estado no Supabase canônico:
- status: ACTIVE;
- version: 1;
- `verify_jwt=false` porque este endpoint representa cadastro anônimo público, não uma ação autenticada;
- nenhum segredo é enviado ao frontend.

A função:
- aceita somente `consumer` ou `producer`;
- usa Zod `.strict()`;
- valida CPF Módulo 11, e-mail, celular brasileiro e senha forte;
- aceita somente os campos já existentes nos contratos públicos;
- cria identidade nova pelo Supabase Auth público `signUp`, preservando os limites do próprio Auth;
- conclui o domínio pela RPC service-role `complete_public_registration`;
- para CPF/e-mail existentes, exige a senha real da conta e e-mail confirmado antes de chamar `add_public_role_to_existing_identity`;
- jamais cria papel administrativo;
- usa apenas SMTP/Auth já centralizado no Supabase;
- em falha da RPC, compensa a identidade nova;
- não registra senha, CPF, e-mail ou celular em logs;
- devolve erros estruturados e requestId;
- permite CORS somente nesta função de cadastro público; o Express continua sem CORS público geral.

### 2. Transporte frontend resiliente

Criado `src/lib/publicRegistrationTransport.ts`.

Fluxo:
1. tenta a API same-origin normal;
2. somente em falha de infraestrutura/transporte — 403 de proxy, 404/405 de roteamento, 500/502/503/504, timeout/rede ou dependência indisponível — usa a função Edge;
3. erros reais de validação (400), conflito (409) e rate limit (429) não são mascarados com segunda tentativa;
4. o fallback usa `credentials: omit` e não transporta cookies;
5. apenas o cadastro Consumer/Producer usa esse caminho.

### 3. Fallback backend

`AuthService.register` também ganhou fallback para a mesma função Edge quando o client privilegiado do Supabase não está disponível no runtime Vercel.

Isso torna o endpoint Express funcional mesmo quando a configuração serverless não oferece o client privilegiado, sem mudar login, sessão ou administração.

### 4. Confirmação de e-mail

Quando a criação ocorreu pela Edge, o próprio Supabase Auth já aceitou o disparo da confirmação. A rota Express passou a respeitar `confirmationDispatchAccepted` para não enviar um segundo e-mail.

## Segurança

- sem wildcard CORS novo no Express;
- sem papel administrativo no fallback;
- Zod strict nos dois papéis;
- RPCs continuam executáveis apenas por service_role;
- service-role permanece exclusivamente dentro do Supabase Edge;
- browser recebe somente URL pública da Function;
- sem Google Maps, Mapbox, Twilio, Resend ou outro recurso pago;
- sem nova branch Supabase;
- sem preview Vercel;
- sem GitHub Actions automáticas.

## Testes versionados

- fallback Studio HTTP 403;
- fallback Vercel HTTP 500;
- Express continua primário quando saudável;
- validação 400 não dispara fallback;
- conflito 409 não dispara fallback;
- erro estruturado Edge é preservado;
- fallback server-side quando `supabaseAdmin` está indisponível;
- conflito Edge mapeado para o erro canônico;
- dispatcher Vercel inclui `register-consumer` e `register-producer`.

Gate local:
`npm run verify:registration:free`.

## Banco

Nenhum DDL novo. O schema lógico permanece **29**, com o hash e as 30 migrations atuais preservados.
