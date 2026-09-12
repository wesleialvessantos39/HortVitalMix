# HortiVitalMix

Projeto greenfield conforme `HortiVitalMix_Manual_Mestre_Tecnico_Greenfield_v6.pdf`.

## Stack
React + TypeScript + Vite no frontend; Express modular no backend; Neon PostgreSQL; Vercel para deploy.

## Desenvolvimento
1. `npm install`
2. `npm run dev`

O preview do Google AI Studio não exige nenhuma variável de ambiente para iniciar. A aplicação usa defaults seguros para apresentação e API local.

A conexão com o Neon é uma configuração **somente do servidor/deploy**. Quando `DATABASE_URL` estiver presente no ambiente de execução do backend, a readiness valida o PostgreSQL real; quando não estiver, a apresentação continua disponível e `/api/ready` responde 503 sem simular persistência.

## Scripts
- `npm run dev`: frontend e API local.
- `npm run dev:web`: somente frontend.
- `npm run dev:api`: somente API.
- `npm run check`: typecheck, testes e build.

## Segurança
Segredos de banco nunca devem ser adicionados ao código, ao frontend ou a arquivos de exemplo rastreados pelo Git. A variável de conexão deve existir apenas no ambiente seguro do backend/deploy.


## Configuração global — OE-001-002
A configuração pública da plataforma é lida em `GET /api/v1/config` e usa uma fonte revisionada quando o Neon está conectado. A escrita administrativa fica em `PATCH /api/v1/admin/configuration` e exige autorização server-side com `platform.configuration.manage`, revisão esperada e commandId idempotente.

A tela `/admin/configuracao` já possui os estados visuais da configuração global, mas nenhuma identidade administrativa fictícia é criada nesta etapa: sem autenticação/principal real, a API de escrita retorna 403.

A migration `0002_oe_001_002_global_configuration.sql` cria a configuração singleton e a auditoria necessária. Contatos não confirmados permanecem nulos.
