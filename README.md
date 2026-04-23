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

Decision tree completo: [`docs/platform-analysis/SQUAD-DECISION-TREE-2026-04-22.md`](https://github.com/ByPabloRuanL/primeteam/blob/main/docs/platform-analysis/SQUAD-DECISION-TREE-2026-04-22.md) no repo PrimeTeam.

---

## Setup inicial (cada colaborador faz UMA vez)

> Este repo é **standalone**: ele NÃO é submodule do `primeteam`. Cada colaborador clona este repo direto na sua máquina e abre o Claude Code nele — o workspace do squad é o próprio repo.

### 1. Clone do repo

```bash
# Escolha onde clonar — sugestão: ~/archprime/primeteam-ops
mkdir -p ~/archprime && cd ~/archprime
git clone https://github.com/ArchPrime-official/PrimeSquads-primeteam-ops.git primeteam-ops
cd primeteam-ops
```

### 2. Instalar deps da CLI de auth

```bash
npm install
```

### 3. Login Google OAuth

```bash
npm run login
```

O que acontece:
- CLI abre servidor local em `http://localhost:54321/callback` (loopback, só sua máquina)
- Navegador abre com tela de login Google (via Supabase OAuth PKCE)
- Você faz login com seu e-mail `@archprime.io`
- JWT salvo em `~/.primeteam/session.json` (chmod 600, fora do repo)
- Servidor local fecha

### 4. Confirmar sessão

```bash
npm run whoami
```

Mostra email + roles (`owner`, `financeiro`, `marketing`, `comercial`, `cs`) + expiração.

### 5. Abrir no Claude Code

```bash
claude
```

O Claude Code detecta automaticamente os slash commands em `.claude/commands/PrimeteamOps/` (symlinks para `agents/`, `tasks/`, `checklists/` do próprio repo).

### 6. Ativar o chief

No Claude Code digite:

```
/PrimeteamOps:agents:ops-chief
```

O ops-chief verifica auth (checa `~/.primeteam/session.json`) antes de rotear demandas que tocam o Supabase.

### Logout

```bash
npm run logout
```

Remove a session local + invalida no Supabase (best-effort).

---

> **Admin (Pablo):** antes do primeiro login funcionar em qualquer máquina, precisa adicionar `http://localhost:54321/callback` na allowlist de Redirect URLs no dashboard do Supabase. Ver [SETUP-ADMIN.md](./SETUP-ADMIN.md) para o passo a passo completo.

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

### CLI de auth (terminal)

```bash
npm run login      # Login Google OAuth (browser-callback, PKCE)
npm run whoami     # Mostra usuário + roles + expiração
npm run logout     # Remove session local
```

Ver `cli/` para código-fonte e `SETUP-ADMIN.md` para config inicial.

### No Claude Code

```
/PrimeteamOps:agents:ops-chief            # Chief (orquestrador Tier 0)
/PrimeteamOps:agents:auth-specialist      # Auth specialist direto
/PrimeteamOps:checklists:handoff-quality-gate
/PrimeteamOps:tasks:test-handoff-flow
```

Mais specialists serão adicionados nas Fases 2-4 do roadmap abaixo.

---

## Status atual e roadmap

### ✅ Fase 0 — Remediação de segurança (completa)
- PR #951 PrimeTeam: RLS em 5 tabelas + 3 policies permissivas removidas
- PR #952 PrimeTeam: `verify_jwt` em chat-ai + get-revolut-balances

### ✅ Fase 1 — Foundation (completa)
- [x] Estrutura de diretórios
- [x] `config.yaml` com `handoff_protocol`
- [x] Central rules document (`data/primeteam-platform-rules.md`, 870L)
- [x] Handoff infrastructure (template, quality gate, smoke test)
- [x] `ops-chief` (Tier 0, 725L)
- [x] `auth-specialist` (Tier 1, 521L)
- [x] Standalone workspace (`.claude/commands/PrimeteamOps/` symlinks)

### 🚧 Fase 2 — Operational MVP (em progresso)
- [x] **Sprint 1:** CLI de auth (`npm run login/whoami/logout`) — PKCE OAuth Google via Supabase
- [x] **Sprint 1:** `ops-chief` refinado com Auth Verification Protocol
- [x] **Sprint 2:** `platform-specialist` (scope: Tasks module — 526L, 3 smoke tests, 3 output examples)
- [x] **Sprint 2:** `tasks/create-task.md` (HO-TP-001 template — anatomia 8 campos + 3 exemplos)
- [x] **Sprint 3:** expandir `platform-specialist` para **Finance** module — 870L total, 5 smoke tests, 5 output examples, 6 playbooks Finance
- [x] **Sprint 3:** `tasks/create-finance-transaction.md` + `tasks/list-tasks.md` + `tasks/complete-task.md`
- [x] **Sprint 4:** `sales-specialist` (CRM — leads + opportunities + pipeline, 696L, 3 smoke tests, 10 playbooks)
- [x] **Sprint 4:** `tasks/create-lead.md` + `tasks/move-opportunity-stage.md`
- [x] **Sprint 5:** `quality-guardian` (Tier 3 — audit specialist, 571L, canonical 5 sections + 5 extensions)
- [x] **Sprint 5:** `wf-platform-operation.yaml` (workflow principal multi-fase, 408L, 7 phases, 8 invariants, 4 exemplos end-to-end)
- [x] **Sprint 6:** `platform-specialist` expandido com **CS module** — 1177L, 9 playbooks CS, 2 novos smoke tests, 2 novos output examples
- [x] **Sprint 6:** `tasks/list-students.md` (HO-TP-001 CS read-only — filtros health/manager/onboarding/check-in, 5 exemplos)
- [x] **Sprint 7:** `content-builder` (Tier 2 — marketing specialist, LPs) — 659L, 10 playbooks, 3 smoke tests. **Cobre role marketing (Sandra)**
- [x] **Sprint 7:** `tasks/create-landing-page.md` (HO-TP-001 — slug validation, uniqueness, always active=false)
- [x] **Sprint 8:** `integration-specialist` (Tier 3 — external boundary) — 632L, 7 playbooks, 3 smoke tests. Escopo Sprint 8: **Google Calendar** (read cache + staleness + trigger re-sync)
- [x] **Sprint 8:** `tasks/list-calendar-events.md` (HO-TP-001 read-only com sync_status pre-check)
- [x] **Sprint 9:** `integration-specialist` expandido com **Revolut** — 963L, 15 playbooks, 6 smoke tests
- [x] **Sprint 9:** `tasks/list-revolut-balances.md` (HO-TP-001 com discrepancy flagging + staleness 15min)
- [x] **Sprint 10:** `integration-specialist` expandido com **Meta Ads** — 25 playbooks total, 8 smoke tests, trindade de boundaries completa
- [x] **Sprint 10:** `tasks/list-meta-campaigns.md` (HO-TP-001 com aggregates + underperformer flags)
- [x] **Sprint 11:** 3 workflows dedicados — `wf-finance-recurrence.yaml` + `wf-onboarding-approval.yaml` + `wf-customer-churn.yaml`
- [x] **Sprint 12:** `automation-specialist` (Tier 2 — flows + email templates) + `tasks/list-automation-flows.md`
- [x] **Sprint 13:** `admin-specialist` (Tier 3 OWNER-ONLY) + `imports-specialist` (Tier 3)
- [x] **Sprint 14:** `wf-currency-convert.yaml` (multi-specialist: platform + integration + guardian)
- [x] **Sprint 15:** External mutations — Meta Ads (pause/resume/budget) + Google Calendar (create/update/delete event) + automation_flows nodes/edges edit. **Revolut transferências PERMANENTEMENTE OUT (by design)**.
- [x] **Sprint 16:** Phone/Calls integration (VAPI + Ringover + telephony_calls) + `wf-watch-channel-rotation.yaml`. 4 boundaries externas completas.
- [x] **Sprint 17:** `wf-meta-ab-test.yaml` + `FINAL-STATE.md` — Fase 2 scope completo
- [x] **Sprint 18 (UX polish):** postinstall banner + ops-chief auto-offer login em background
- [x] **Sprint 19 (handoff):** `data/edge-functions-required.md` + `data/migrations-required.md` — **v1.0.0 Fase 2 squad-side COMPLETA**
- [x] **Sprint 20 (observability):** activity logging em cycle + mutations — `data/activity-logging.md` + todos specialists atualizados — **v1.1.0**
- [ ] **Sprint 21 (primeteam-side):** aba "Squad Ops" em `src/pages/ActivityLog.tsx` (trabalho no repo primeteam, não neste)

📋 **Ver [`FINAL-STATE.md`](./FINAL-STATE.md)** para status consolidado, próximos passos e guia de onboarding.

### ⏳ Fase 3 — Builder capability
- `content-builder`, `design-guardian`
- Templates LP + automation flows
- `wf-build-sales-page.yaml` multi-agent

### ⏳ Fase 4 — Strategic
- `wf-platform-audit.yaml`
- AI chat agent

---

## Contribuindo

Este repo é **standalone e self-contained** — o colaborador clonou uma vez, trabalha direto nele. Qualquer mudança nos agents/tasks/etc. é commit + PR neste repo.

```bash
# Dentro da cópia local (ex: ~/archprime/primeteam-ops)
git checkout -b feat/minha-melhoria

# Desenvolver + commitar normalmente
git add agents/ops-chief.md
git commit -m "feat: melhorar routing map do ops-chief"

# Push + PR
git push -u origin feat/minha-melhoria
gh pr create --fill
```

Após merge no main, cada colaborador faz `git pull` na sua cópia local.

### Estrutura `.claude/commands/PrimeteamOps/`

Os slash commands são **symlinks** para os diretórios raiz do repo:

```
.claude/commands/PrimeteamOps/
├── agents       -> ../../../agents
├── tasks        -> ../../../tasks
└── checklists   -> ../../../checklists
```

Isso elimina duplicação — ao editar `agents/ops-chief.md`, o slash command `/PrimeteamOps:agents:ops-chief` automaticamente reflete a mudança. Windows: habilitar symlinks git com `git config --global core.symlinks true` e `git config --global core.longpaths true`.

---

## Licença & contato

Uso interno ArchPrime. Dúvidas: **pablo@archprime.io**

**Documentação completa (repo PrimeTeam):**
- [Decision tree — qual squad usar](https://github.com/ByPabloRuanL/primeteam/blob/main/docs/platform-analysis/SQUAD-DECISION-TREE-2026-04-22.md)
- [Plan validation — arquitetura detalhada](https://github.com/ByPabloRuanL/primeteam/blob/main/docs/platform-analysis/PRIMETEAM-OPS-PLAN-VALIDATION-2026-04-22.md)
- [CLI feasibility audit](https://github.com/ByPabloRuanL/primeteam/blob/main/docs/platform-analysis/PRIMETEAM-CLI-FEASIBILITY-AUDIT-2026-04-22.md)
