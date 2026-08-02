# AGENTS.md

## Purpose
This repository is a TypeScript monorepo for the Onramp FP Founders app.  
Use this document as the default operating guide for AI/code agents working in this codebase.

## Repository layout
- `packages/api` — Express + Prisma backend (TypeScript)
- `packages/web` — React + Vite frontend (TypeScript)
- Root workspace managed with npm workspaces + Turborepo

## Prerequisites
- Node.js `>=20`
- npm `10.x`
- Docker (for local PostgreSQL + Redis)

## Common commands (run from repo root)
- Install deps: `npm install`
- Start all services: `npm run dev`
- Build all packages: `npm run build`
- Lint all packages: `npm run lint`
- Test all packages: `npm run test`

## Package-level commands
### API (`packages/api`)
- Dev server: `npm run dev`
- Build: `npm run build`
- Lint: `npm run lint`
- Test: `npm run test`
- DB migrate (dev): `npm run db:migrate:dev`
- DB seed: `npm run db:seed`

### Web (`packages/web`)
- Dev server: `npm run dev`
- Build: `npm run build`
- Lint: `npm run lint`
- Test: `npm run test`

## Environment setup
1. `cp .env.example .env`
2. Start infra: `docker-compose up -d`
3. Run backend migrations before local development.

## Agent workflow expectations
- Keep changes focused and minimal.
- Prefer editing existing files over adding new abstractions.
- Run lint/tests relevant to touched areas before finalizing.
- Avoid introducing new dependencies unless required.
- Update docs when behavior or workflows change.

## Notes
- The README currently references `packages/workers`, but this directory is not present in the current repository state.
