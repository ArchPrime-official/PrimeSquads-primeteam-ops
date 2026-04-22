# primeteam-ops — Final State (Sprint 17, 2026-04-22)

> Documento consolidando o estado final do squad após Fase 2 completa (17 sprints). Use como referência única para entender o que está pronto, o que falta validar, e como operar.

---

## TL;DR

- **Status:** v1.0.0-rc1 — Fase 2 scope completo, **aguardando validação end-to-end com colaborador real**
- **Arquivos:** 10 agents (~7000L spec) + 7 workflows + 12 tasks + CLI auth
- **Bloqueante imediato:** admin config Supabase (`SETUP-ADMIN.md`) + primeiro login real
- **NÃO testado ainda:** nenhum colaborador rodou `npm run login` de verdade; edge functions referenciadas (update-meta-campaign, trigger-vapi-call, rotate-google-watch, sync-meta-billing, get-revolut-balances, create-google-event, fetch-ecb-rates, etc.) podem ainda não existir — precisam ser criadas em paralelo

---

## Estrutura final do squad

```
PrimeSquads-primeteam-ops/
├── README.md                            (setup + onboarding time)
├── SETUP-ADMIN.md                       (⚠ config bloqueante admin)
├── CHANGELOG.md                         (histórico dos 17 sprints)
├── FINAL-STATE.md                       (este documento)
├── config.yaml                          (handoff_protocol + tier_validation)
│
├── .claude/commands/PrimeteamOps/       (symlinks — slash commands)
│   ├── agents        → ../../../agents
│   ├── tasks         → ../../../tasks
│   └── checklists    → ../../../checklists
│
├── cli/                                 (TypeScript OAuth PKCE)
│   ├── index.ts                         (entry point)
│   ├── config.ts                        (Supabase URL + anon key públicas)
│   ├── session.ts                       (load/save ~/.primeteam/session.json)
│   ├── supabase.ts                      (factories PKCE + auth)
│   ├── login.ts                         (Google OAuth + servidor local 54321)
│   ├── whoami.ts                        (valida + lista roles)
│   └── logout.ts                        (invalida session local)
│
├── agents/                              (10 agents, ~7000L total)
│   ├── ops-chief.md                     (T0 — orchestrator, 725L)
│   ├── auth-specialist.md               (T1 — OAuth + session, 521L)
│   ├── platform-specialist.md           (T1 — Tasks+Finance+CS, 1177L)
│   ├── sales-specialist.md              (T2 — CRM leads+opps, 696L)
│   ├── content-builder.md               (T2 — Landing Pages, 659L)
│   ├── automation-specialist.md         (T2 — flows+emails+edit nodes, ~900L)
│   ├── integration-specialist.md        (T3 — 4 external boundaries, ~1850L)
│   ├── quality-guardian.md              (T3 — handoff audit, 571L)
│   ├── admin-specialist.md              (T3 OWNER-ONLY users/roles)
│   └── imports-specialist.md            (T3 — CSV bulk)
│
├── workflows/                           (7 YAMLs)
│   ├── wf-platform-operation.yaml       (canonical cycle 7 phases 8 invariants)
│   ├── wf-finance-recurrence.yaml       (recurring tx + installments)
│   ├── wf-onboarding-approval.yaml      (submission → customer active)
│   ├── wf-customer-churn.yaml           (detect + context + route)
│   ├── wf-currency-convert.yaml         (FX auto-convert batch)
│   ├── wf-watch-channel-rotation.yaml   (Google Calendar watch channels)
│   └── wf-meta-ab-test.yaml             (A/B test setup + monitoring)
│
├── tasks/                               (12 HO-TP-001)
│   ├── test-handoff-flow.md             (V20 smoke test)
│   ├── create-task.md, list-tasks.md, complete-task.md
│   ├── create-finance-transaction.md
│   ├── create-lead.md, move-opportunity-stage.md
│   ├── list-students.md
│   ├── create-landing-page.md
│   ├── list-automation-flows.md
│   ├── list-calendar-events.md
│   ├── list-revolut-balances.md
│   └── list-meta-campaigns.md
│
├── checklists/
│   └── handoff-quality-gate.md          (V19 — 5 sections + extensions)
│
└── data/                                (7 reference files)
    ├── primeteam-platform-rules.md      (central 870L)
    ├── handoff-card-template.md         (V18)
    ├── team-roles-reference.md          (10 colaboradores)
    ├── role-permissions-map.md          (matriz role × agent)
    ├── platform-modules.md              (18 módulos)
    ├── schema-reference.md              (226 tabelas agrupadas)
    └── integration-inventory.md         (8 integrações externas)
```

---

## Cobertura por role do time ArchPrime

| Role | Colaboradores | Specialist primário | Access |
|------|---------------|---------------------|--------|
| owner | Pablo | Todos + admin-specialist exclusivo | Total |
| admin | (reservado) | Platform (sem finance) | Gestão não-finance |
| financeiro | Joyce, Larissa, Adriana | Platform Finance + integration Revolut reads | Finance + FX |
| comercial | Miriam, Daniel, Yuri | Sales-specialist + integration Calendar/Phone | CRM + agenda |
| cs | Jessica, Andrea | Platform CS + integration Phone | Students + tickets |
| marketing | Sandra | Content-builder + Automation + integration Meta | LPs + flows + ads |

---

## 4 boundaries externas

| Boundary | Read Cache | Trigger Sync | Mutations Allowed | NEVER |
|----------|:----------:|:------------:|:-----------------:|:-----:|
| Google Calendar | ✓ | ✓ | event CRUD + watch rotation | OAuth token refresh |
| Revolut | ✓ (balances + discrepancies) | ✓ | — | **transfers/payouts/invoices** (2FA UI only) |
| Meta Ads | ✓ (campaigns + insights) | ✓ | pause/resume/budget + A/B tests | create ads from scratch |
| Phone/Calls | ✓ | ✓ | trigger AI call (VAPI) | — |

---

## Princípios arquiteturais (de todos os agents)

### Specialist = executor, não estrategista
- Specialists fornecem DATA e facilitam ROUTING
- Decisões estratégicas (retention, scaling, copy) vão para expertise squads (`/metaAds`, `/stratMgmt`, `/ptImprove`, `/videoCreative`)

### Hub-and-spoke topology
- TODO specialist retorna ao ops-chief; nenhum hand-off direto entre specialists (INV-01)
- Cycle_id correlaciona todas as fases (INV-02)
- Announcement V10 + output V11 + handoff card V18 obrigatórios

### Safety by default
- Destructive ops exigem dupla confirmation
- Mutations em flows/campaigns ativos são **forbidden** — deactivate OR clone primeiro
- External mutations (Meta pause, Calendar create, VAPI call) → audit mandatory por quality-guardian
- **Revolut transfers permanentemente out of scope** — decisão arquitetural, não "Sprint futuro"

### Privacy + RLS respect
- User_id scoped em todas as queries
- `access_token`/`refresh_token` nunca em SELECT
- `meet_link` só expose ao próprio user
- RLS denial (42501) surfaced honest, sem bypass

### Evidence + audit
- Quality-guardian audita cycles complexos (multi-specialist, destructive, first-run, anomaly)
- Batch ID tagging em imports (rollback-friendly)
- Changelog append-only por cycle

---

## O que NÃO foi testado ainda

1. **Primeiro login real** — `npm run login` nunca executado por colaborador. Pressupostos:
   - Supabase Redirect URL config (`http://localhost:54321/callback`)
   - Google OAuth app permite provider (já está configurado em primeteam.archprime.io)
   - PKCE flow completa sem edge cases

2. **Edge functions referenciadas** — muitas provavelmente não existem ainda:
   - `update-meta-campaign` (Sprint 15 — pause/resume/budget)
   - `trigger-vapi-call` (Sprint 16 — AI calls)
   - `rotate-google-watch` (Sprint 16 — watch rotation)
   - `fetch-ecb-rates` (Sprint 14 — currency)
   - `create-google-event`, `update-google-event`, `delete-google-event` (Sprint 15)
   - `sync-meta-billing`, `get-revolut-balances`, `sync-revolut-transactions` — **estas existem** (Fase 0-3 do primeteam)

3. **Auxiliary tables pressupostas:**
   - `fx_rate_cache` (wf-currency-convert) — precisa migration
   - `ab_test_results` (wf-meta-ab-test) — precisa migration OU in-memory only

4. **Slash commands** — symlinks `.claude/commands/PrimeteamOps/` apontam corretamente? Validar primeiro clone.

5. **Smoke tests** — 40+ smoke tests documentados em agents. Nenhum foi executado em runtime real.

---

## Próximos passos recomendados (ordem)

### Imediato (bloqueante)

1. **Pablo adiciona `http://localhost:54321/callback` em Redirect URLs no Supabase Dashboard** (5 min).
   URL: https://supabase.com/dashboard/project/xmqmuxwlecjbpubjdkoj/auth/url-configuration

2. **Pablo faz primeiro login real:**
   ```bash
   mkdir -p ~/archprime && cd ~/archprime
   git clone https://github.com/ArchPrime-official/PrimeSquads-primeteam-ops.git primeteam-ops
   cd primeteam-ops && npm install && npm run login
   ```
   Validar: session gravada em `~/.primeteam/session.json`, `npm run whoami` mostra email + roles.

3. **Smoke test mínimo** — Pablo abre Claude Code no repo do squad + digita `/PrimeteamOps:agents:ops-chief` + pede "liste minhas tarefas atrasadas" (read-only, zero risk). Valida:
   - Slash command carrega
   - Ops-chief ativa persona
   - Routing para platform-specialist
   - Query via user JWT funciona
   - V10 announcement retorna corretamente

### Curto prazo (validação)

4. **Segundo colaborador faz login** (ex: Joyce — role=financeiro) — valida role isolation.

5. **Testar uma mutation simples:** criar 1 tarefa via squad (platform-specialist create_task playbook). Valida INSERT funciona + confirmation flow + convention_check.

6. **Revisar lista de edge functions faltantes** (ver "O que NÃO foi testado" #2) — escopar quais criar em primeira leva.

### Médio prazo (rollout)

7. **Comunicar time** sobre o squad (demo 30min ou vídeo):
   - O que existe / o que ainda não
   - Como clonar + login
   - Quando usar vs UI web
   - Expertise squads vs primeteam-ops territory

8. **Reforço RLS cs→opportunities** (comunicação pós-Fase 0 PR #951):
   - Jessica e Andrea (role=cs) não veem mais opportunities
   - Se precisam visibilidade, usar `sales-specialist` (que retorna filtered per role)

9. **Comunicar regras permanent-OUT:**
   - Revolut transfers SEMPRE via UI web com 2FA
   - Meta create campaign = UI web workflow

### Longo prazo (evolução)

10. **Migrations pendentes:**
    - `fx_rate_cache` table (wf-currency-convert)
    - `ab_test_results` table (wf-meta-ab-test)
    - Possível trigger de audit em `finance_transactions` (flag em platform-specialist future_notes)

11. **Edge functions faltantes** — criar gradualmente conforme necessidade real:
    - `update-meta-campaign` quando primeiro pause real for pedido
    - `trigger-vapi-call` quando CS quiser automação AI
    - `rotate-google-watch` se stale silent for detectado

12. **Sprint 18+ (futuro, sob demanda):**
    - Multi-variate testing Meta (além de A/B)
    - VAPI strategy creation (não só trigger)
    - Finance audit log table + trigger
    - Webhook rotation automated (Stripe, Meta, Revolut)
    - Advanced analytics dashboards (generation, não só queries)

---

## Para colaboradores (onboarding rápido)

### Setup (uma vez)

```bash
# 1. Clonar (escolha onde — sugestão: ~/archprime/)
mkdir -p ~/archprime && cd ~/archprime
git clone https://github.com/ArchPrime-official/PrimeSquads-primeteam-ops.git primeteam-ops
cd primeteam-ops

# 2. Instalar deps (CLI auth)
# Após isto, um banner vai aparecer direcionando para o próximo passo.
npm install

# 3. Login Google OAuth (abre navegador)
# O postinstall já te disse que esse era o próximo passo.
npm run login

# 4. Confirmar (mostra email + roles)
npm run whoami
```

### Uso diário

```bash
# Entrar no diretório do squad
cd ~/archprime/primeteam-ops

# Abrir Claude Code
claude

# No Claude Code, usar slash commands:
/PrimeteamOps:agents:ops-chief
```

### Esqueceu de fazer login? (Sprint 18 UX)

Se você abrir o Claude Code sem ter feito `npm run login` ainda, o ops-chief **vai te OFFER executar o login em background automaticamente** quando você pedir alguma operação que toca o Supabase. Você responde "sim" e o login acontece sem sair do Claude Code.

Exemplo:
```
Você:         "liste minhas tarefas atrasadas"
ops-chief:    "Você não tem session ativa ainda. Posso executar
               `npm run login` em background agora? (sim / não)"
Você:         "sim"
ops-chief:    [dispara em background, abre navegador para OAuth]
[you complete OAuth]
ops-chief:    "✓ Login ok. Retomando sua demanda..."
              [roteia pra platform-specialist listar tarefas]
```

O `ops-chief` é o **único ponto de entrada**. Ele tria sua demanda e roteia para o specialist correto. Você nunca precisa chamar specialists diretamente.

### Quando NÃO usar o squad

- **Movimentações bancárias** (transferências Revolut) → sempre UI web com 2FA
- **Decisões estratégicas** (qual campanha pausar, como retenter aluno em risco) → expertise squads (`/metaAds`, `/stratMgmt`, `/ptImprove`, `/videoCreative`)
- **Criar campaigns Meta do zero** → UI web (setup complexo)
- **Criar ads/creatives** → expertise squad + UI web
- **Geração de copy** → `/metaAds:ryan-deiss` ou `/ptImprove:design-architect`

### Se bloqueado

- Role incompatível → `ops-chief` explica e sugere alternativa
- Session expirada → `npm run login` novamente
- Edge function 5xx → reportar para Pablo (provavelmente não foi criada ainda)
- Bug comportamental → abrir issue em https://github.com/ArchPrime-official/PrimeSquads-primeteam-ops/issues

---

## Changelog resumo (17 sprints)

| Sprint | Entrega | Linhas aprox |
|--------|---------|--------------|
| 0 | Fase 0 security remediation (PrimeTeam PRs #951, #952) | — |
| 1 | Foundation: scaffold + handoff protocol (14 arquivos) | 3825 |
| 1.7 | Standalone workspace (symlinks) | — |
| 1-2 | CLI auth (login/whoami/logout PKCE) | ~650 |
| 2 | platform-specialist Tasks | 526 |
| 3 | platform-specialist + Finance | +344 |
| 4 | sales-specialist CRM | 696 |
| 5 | wf-platform-operation + quality-guardian T3 | 979 |
| 6 | platform-specialist + CS module | +307 |
| 7 | content-builder T2 (LPs) | 659 |
| 8 | integration-specialist T3 (Google Calendar) | 632 |
| 9 | +Revolut | +331 |
| 10 | +Meta Ads | +295 |
| 11 | 3 workflows dedicados (recurrence, approval, churn) | 779 |
| 12 | automation-specialist T2 | ~900 |
| 13 | admin-specialist (OWNER-ONLY) + imports-specialist | ~900 |
| 14 | wf-currency-convert | 292 |
| 15 | external mutations (Meta+Calendar) + edit nodes/edges | 362 |
| 16 | +Phone (VAPI+Ringover) + watch channel rotation | 400+ |
| 17 | wf-meta-ab-test + **FINAL-STATE.md** (este doc) | 350+ |

**Total:** ~14000 linhas de squad spec + CLI code.

---

## Créditos

- **Arquiteto + implementador:** Claude Opus 4.7 (1M context) via Claude Code
- **Owner + decisões:** Pablo (ArchPrime)
- **Framework base:** AIOS Squad Creator v4.0.0 (ArchPrime-official/PrimeSquads-squad-creator)
- **Período:** 2026-04-22 (uma sessão longa)

---

**Squad `/PrimeteamOps` está pronto para primeiro uso real.** Veja próximos passos acima para validação.
