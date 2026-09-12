# HortiVitalMix

Projeto greenfield conforme `HortiVitalMix_Manual_Mestre_Tecnico_Greenfield_v6.pdf`.

## Stack
React + TypeScript + Vite no frontend; Express modular no backend; Neon PostgreSQL; Vercel para deploy.

## Desenvolvimento
1. `npm install`
2. Configure `DATABASE_URL` apenas no ambiente do servidor quando precisar de persistência real.
3. `npm run dev:full`

Sem `DATABASE_URL`, a página pública permanece disponível e `/api/ready` retorna 503, conforme OE-001-001.

## Validação
`npm run check`
