# primeteam-ops

> CLI squad para operar a plataforma PrimeTeam via Claude Code. Substitui editores visuais (LP, Automação, Radar) e acelera operações rotineiras do time.

**Status:** 🚧 Fase 1 — Foundation (v0.1.0)

---

## O que é

`primeteam-ops` é um squad do framework [AIOS Squad Creator](https://github.com/ArchPrime-official/PrimeSquads-squad-creator) que roda dentro do Claude Code. Ele conversa com o Supabase da plataforma PrimeTeam (`primeteam.archprime.io`) **como se fosse o próprio usuário** — respeitando RLS e permissões reais do banco.

### Para quem é

Todos os 10 colaboradores da ArchPrime:

- **Pablo (owner)** — acesso total
- **Joyce / Larissa / Adriana (financeiro)** — Finance, Tasks, Profile
- **Sandra (marketing)** — Marketing, Landing Pages, Automação
- **Miriam / Daniel / Yuri (comercial)** — CRM, Agenda, Leads
- **Jessica / Andrea (CS)** — Students, Tickets, Onboarding forms

Cada pessoa só enxerga e mexe no que sua role permite no Supabase — porque o squad usa o JWT real dela. Não há privilégio adicional.

### O que ele faz de diferente

Em vez de você abrir o site `primeteam.archprime.io` no browser e clicar em forms, você conversa com o squad via terminal:

```
/ptOps:tasks list --urgent
/ptOps:finance create-transaction -250 "Bonus Jessica" --category Equipe
/ptOps:content build-lp --template evento --slug immersione-roma-2026
```

O resultado aparece imediatamente na plataforma web (LP publicada, transação lançada, etc.). O browser vira só **viewer** — o trabalho acontece aqui.

---

## Quando usar este squad vs os outros

| Demanda | Squad |
|---------|-------|
| **Executar** algo na plataforma (CRUD, publish, sync, reports) | `/ptOps` (este) |
| **Pensar estratégia** de Meta Ads / marketing pago | `/metaAds` |
| **Pensar estratégia** de negócio, posicionamento, financeira | `/stratMgmt` |
| **Refatorar/melhorar** a plataforma (código, design, schema) | `/ptImprove` |
| **Criar** vídeo/storytelling complexo | `/videoCreative` |

**Regra:** "Os squads de expertise pensam. O `/ptOps` faz."

Decision tree completo: [`docs/platform-analysis/SQUAD-DECISION-TREE-2026-04-22.md`](../../docs/platform-analysis/SQUAD-DECISION-TREE-2026-04-22.md) no repo PrimeTeam.

---

## Setup inicial (cada colaborador faz UMA vez)

### 1. Clone do repo

```bash
git clone https://github.com/ArchPrime-official/PrimeSquads-primeteam-ops.git
```

### 2. Instalar dependências

```bash
cd PrimeSquads-primeteam-ops
npm install
```

### 3. Login com sua conta Google ArchPrime

```bash
npx primeteam-ops login
```

O que vai acontecer:
- CLI abre um servidor local em `http://localhost:54321`
- Seu browser abre automaticamente com a tela de login Google
- Você faz login com seu e-mail `@archprime.io` (mesmo que você usa no `primeteam.archprime.io`)
- Google redireciona para o callback → CLI captura o JWT
- JWT salvo em `~/.primeteam/session.json` (chmod 600, não versionado)
- Servidor local fecha

### 4. Confirmar login

```bash
npx primeteam-ops whoami
```

Deve mostrar seu e-mail e sua role (`owner`, `financeiro`, `marketing`, `comercial`, ou `cs`).

### 5. Ativar no Claude Code

Depois do login, use o slash command `/ptOps` no Claude Code para ativar o chief. Ele tria sua demanda e roteia.

---

## Arquitetura (resumo)

```
primeteam-ops/
├── agents/              (Tier 0 chief + Tier 1-3 specialists)
├── tasks/               (Tasks estruturadas 8 campos HO-TP-001)
├── workflows/           (Workflows multi-fase hub-and-spoke)
├── checklists/          (Handoff quality gate blocker)
├── data/                (Central rules, schemas, modules inventory)
├── templates/           (LP blocks, automation flows, radar slides)
└── config.yaml          (handoff_protocol + tier_validation)
```

**Topologia:** hub-and-spoke — **todos** os specialists retornam ao `ops-chief` com announcement prescrito e output package padronizado. Nenhum specialist encadeia diretamente para outro.

Detalhes da arquitetura: [`docs/platform-analysis/PRIMETEAM-OPS-PLAN-VALIDATION-2026-04-22.md`](../../docs/platform-analysis/PRIMETEAM-OPS-PLAN-VALIDATION-2026-04-22.md) no repo PrimeTeam.

---

## Segurança & privacidade

### O que este repo CONTÉM (safe para GitHub público)

- Código Python/TypeScript do CLI
- Instruções dos agents (markdown)
- Schemas JSON de referência
- `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` — **públicas por design** (já aparecem no browser de `primeteam.archprime.io`)

### O que este repo NÃO CONTÉM

- ❌ `SUPABASE_SERVICE_ROLE_KEY` (NUNCA)
- ❌ Credenciais de usuário (ficam em `~/.primeteam/session.json` local, fora do repo)
- ❌ URLs ou tokens hardcoded

### Como a segurança funciona

A **anon key** sozinha não dá acesso a nada — toda query passa pelas policies RLS do Supabase. O JWT pessoal de cada usuário é o que dá acesso aos dados dele. Sem JWT válido, o Supabase retorna 401.

Isso é o mesmo modelo de segurança que `primeteam.archprime.io` usa no browser. O squad é só outro cliente consumindo a mesma API.

---

## Comandos principais

```bash
# Autenticação
npx primeteam-ops login              # Login Google OAuth
npx primeteam-ops whoami             # Mostra usuário + role
npx primeteam-ops logout             # Limpa session local

# Ativação no Claude Code
/ptOps                               # Chief (orquestrador)
/ptOps:auth                          # Auth specialist direto
/ptOps:<outro-specialist>            # Quando os outros agents forem adicionados
```

---

## Status atual e roadmap

### ✅ Fase 0 — Remediação de segurança (completa)
- PR #951 PrimeTeam: RLS em 5 tabelas + 3 policies permissivas removidas
- PR #952 PrimeTeam: `verify_jwt` em chat-ai + get-revolut-balances

### 🚧 Fase 1 — Foundation (em progresso)
- [x] Estrutura de diretórios
- [x] `config.yaml` com `handoff_protocol`
- [ ] Central rules document (`data/primeteam-platform-rules.md`)
- [ ] Handoff infrastructure (template, quality gate, smoke test)
- [ ] `ops-chief` (Tier 0)
- [ ] `auth-specialist` (Tier 1)

### ⏳ Fase 2 — Operational MVP
- `platform-specialist` (tasks + finance + CS + admin + imports)
- `sales-specialist`, `integration-specialist`, `quality-guardian`
- `wf-platform-operation.yaml`
- 4-5 tasks estruturadas

### ⏳ Fase 3 — Builder capability
- `content-builder`, `design-guardian`
- Templates LP + automation flows
- `wf-build-sales-page.yaml` multi-agent

### ⏳ Fase 4 — Strategic
- `wf-platform-audit.yaml`
- AI chat agent

---

## Contribuindo

Este squad é um **submodule git** apontando para este repo source-of-truth.

Para contribuir:

```bash
# 1. Clone local do squad (não do submodule dentro do PrimeTeam)
git clone https://github.com/ArchPrime-official/PrimeSquads-primeteam-ops

# 2. Branch para mudanças
cd PrimeSquads-primeteam-ops
git checkout -b feat/minha-melhoria

# 3. Desenvolver + commitar

# 4. Push + PR no repo do squad
git push -u origin feat/minha-melhoria
gh pr create --fill

# 5. Após merge, propagar para os projetos que consomem o submodule
cd /Users/pablo/PrimeTeam
bump-all-squads.sh --auto-merge
```

---

## Licença & contato

Uso interno ArchPrime. Dúvidas: **pablo@archprime.io**

**Documentação completa:**
- Decision tree: `docs/platform-analysis/SQUAD-DECISION-TREE-2026-04-22.md` (no repo PrimeTeam)
- Arquitetura: `docs/platform-analysis/PRIMETEAM-OPS-PLAN-VALIDATION-2026-04-22.md`
- Auditoria CLI: `docs/platform-analysis/PRIMETEAM-CLI-FEASIBILITY-AUDIT-2026-04-22.md`
