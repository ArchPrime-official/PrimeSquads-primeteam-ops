# CHANGELOG — primeteam-ops

Todas as mudanças notáveis deste squad ficam documentadas aqui. Cada ciclo executado pelo `ops-chief` gera uma entrada.

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e versionamento semântico [SemVer](https://semver.org/lang/pt-BR/).

---

## [0.5.0] — 2026-04-22

### Added — sales-specialist (CRM) + 2 tasks (Fase 2 Sprint 4)

- `agents/sales-specialist.md` (696L) — **Tier 2** CRM executor cobrindo leads + opportunities + campaigns (read-only). Foco em stage transitions rigorosas, validação de enum, e terminal stages com required fields (SALE_DONE precisa value+currency, LOST precisa reason).
  - 10 playbooks: `create_lead`, `list_leads`, `qualify_lead`, `create_opportunity`, `move_stage`, `mark_won`, `mark_lost`, `list_opportunities`, `assign_user`, `delete_opportunity`
  - 8 core_principles específicos de CRM: stage validation, lead_id imutável, WIN/LOST require fields, time-sensitive fields, idempotent transitions, presales vs sales handoff disambiguation
  - 3 output examples (mark_won happy path + list com RLS filtering + scope rejection para Tasks)
  - 10 anti-patterns específicos (nunca aceitar stage fora do enum, nunca ASK presales/sales ambiguous, preservar campos não-especificados, etc.)
  - 3 smoke tests (mark_won happy, invalid stage, scope rejection)
  - Enum source-of-truth referenciado: `src/hooks/useAutomationOptions.ts` do primeteam (LEAD_STATUSES, OPPORTUNITY_STAGES, LEAD_SOURCES, PIPELINES)
  - future_notes: lead.status vs opp.stage sync (não auto), product_id migration, stripe linking via webhook (não manual), atypical stage transitions com warning

- `tasks/create-lead.md` (HO-TP-001):
  - Validação full_name + email regex
  - Campaign resolution por nome (0/1/>1 match handling)
  - Duplicate detection (warning não blocking)
  - 4 exemplos: happy / duplicate warning / campanha ambígua / email inválido

- `tasks/move-opportunity-stage.md` (HO-TP-001):
  - Validação enum rígida + terminal requirements (SALE_DONE value, LOST reason)
  - closed_at auto-set em terminais, clear em reopens
  - Idempotency race-safe (`AND stage != {new_stage}`)
  - Atypical transitions permitted com warning (LOST → LEAD_OPPORTUNITY etc.)
  - 5 exemplos: SALE_DONE happy / LOST sem motivo ESCALATE / idempotent / stage inválido / atypical reopen

### Observações CRM

- Policies RLS de `opportunities` pós-Fase 0 (PR #951 do primeteam) são role-based (owner/admin/marketing = all) ou assignment-based (presales_user_id, sales_user_id). Role `cs` não vê mais opportunities.
- Sem tabela dedicada de pipelines/stages — valores são strings free-form validados contra enum em source code do primeteam (`useAutomationOptions.ts`). Specialist trata como source-of-truth canônica.
- `lead.status` e `opp.stage` são conceitos independentes no DB. Convenção de negócio mantém sync manual (WON lead = SALE_DONE opp), mas não há trigger enforçando.

---

## [0.4.0] — 2026-04-22

### Added — platform-specialist Finance module + 3 tasks (Fase 2 Sprint 3)

- `agents/platform-specialist.md` expandido de 526L → **870L**:
  - Novo scope section `in_sprint_3` com **Finance module** adicionado (5 tabelas: `finance_transactions`, `finance_categories`, `finance_cost_centers`, `finance_bank_accounts`, `finance_credit_cards`)
  - 6 novos **playbooks Finance**: `create_finance_transaction`, `list_transactions`, `reconcile_transaction`, `update_transaction_fields`, `delete_transaction`, `list_categories`, `list_cost_centers`, `list_bank_accounts`
  - Novos **core_principles**: `FINANCE REQUIRES FINANCE ACCESS` (has_finance_access() gate), `MONEY VALUES ARE NUMERIC` (parsing rules para €500, 1.250,00 etc.)
  - **2 output examples** adicionais: happy path Finance (lançar despesa Revolut EUR), listagem filtrada por data/conta
  - **1 output example** renovado: scope rejection agora aponta para CS (Sprint 4), não mais Finance
  - **2 smoke tests** novos: `test_4_finance_happy_path`, `test_5_finance_rls_denial` (quando role=cs sem finance_access)
  - **Anti-patterns Finance-specific**: amount sempre numeric, echo sign, não auto-convert currency, não criar recorrência (Sprint 4)
  - **future_notes** expandidas: finance RLS já properly restricted (modelo para outros módulos), finance history missing (trigger-level audit não existe)

- `tasks/create-finance-transaction.md` (nova, HO-TP-001 completa):
  - Parser de amount multi-format (€500, "1.250,00", "500 EUR", "-€500")
  - Resolução de category/cost_center/account por nome via list_* playbooks
  - 4 exemplos de execução: happy path DONE / amount ambíguo ESCALATE / role sem finance_access BLOCKED / multiple category matches ESCALATE

- `tasks/list-tasks.md` (nova, HO-TP-001 completa):
  - Read-only SELECT com filtros (status, date_range, priority/urgency, project, assigned_to)
  - LIMIT 50 default, max 200, truncation flag
  - SELECT explícito sem `SELECT *`
  - 3 exemplos: overdue happy / empty result DONE / truncation warning

- `tasks/complete-task.md` (nova, HO-TP-001 completa):
  - UPDATE idempotente (`AND status != 'done'` race-safe)
  - Resolução por task_id ou task_title (ESCALATE se 0/>1 matches)
  - Support a tarefas recorrentes (trigger DB cuida de task_completed_occurrences)
  - 4 exemplos: happy / idempotent hit / title ambíguo / recurrent task

### Observações Finance

- Policies RLS atuais de `finance_transactions` usam `has_finance_access()` (owner + financeiro) — modelo correto que serve de referência para outros módulos.
- Não existe trigger de audit em `finance_transactions` — UPDATEs não são auditados pelo DB. Documentado em `future_notes`.
- Recorrência/installments/conversion automática ficam fora do Sprint 3 (vão para Sprint 4-5).

---

## [0.3.0] — 2026-04-22

### Added — platform-specialist com escopo Tasks (Fase 2 Sprint 2)

- `agents/platform-specialist.md` (526L) — Tier 1 operational executor. Scope Sprint 2: **apenas módulo Tarefas** (8 tabelas: `tasks`, `task_projects`, `task_recurrences`, `task_completed_occurrences`, `task_history`, `task_date_change_requests`, `task_schedule_blocks`, `task_project_members`).
  - Playbooks: create / list / update / complete / reopen / delete / classify Eisenhower / list overdue / list today
  - Voice DNA em PT-BR com signature starters + vocabulário
  - 3 output examples (happy path, listing com filtro, scope rejection)
  - 8 anti-patterns específicos (never invent title, JWT-scoped writes, UTC-first, never hand off direct)
  - 3 smoke tests obrigatórios (SC_AGT_001 — happy / RLS denial / scope rejection)
  - Handoff ceremony compliant com V10 + V11 + V18
  - `auto_rejects` para módulos fora de scope → ESCALATE de volta ao chief
- `tasks/create-task.md` — task estruturada HO-TP-001 (8 campos): anatomia completa + 3 exemplos (happy path / title ausente / RLS denial). Serve como template para as próximas tasks.

### Observações

- Policies RLS atuais de `tasks` são permissivas (todos authenticated podem CRUD) — documentado nas `future_notes` do platform-specialist para auditoria pelo `quality-guardian` (Sprint 4).
- Convenção Eisenhower adotada: priority/urgency 1..4 com 4 = mais alto. Validar no primeiro uso real contra a UI web.

---

## [0.2.0] — 2026-04-22

### Added — CLI de autenticação (Fase 2 Sprint 1)

- `cli/index.ts` — entry point com roteamento de subcomandos
- `cli/config.ts` — Supabase URL + anon key + callback port
- `cli/session.ts` — load/save/clear de `~/.primeteam/session.json` (chmod 600)
- `cli/supabase.ts` — factories de client PKCE e authenticated
- `cli/login.ts` — OAuth Google via PKCE + servidor HTTP local + página de sucesso/erro
- `cli/whoami.ts` — valida session + busca roles da tabela `user_roles` via Supabase
- `cli/logout.ts` — invalida no Supabase + remove session local
- `package.json` — scripts `npm run login/whoami/logout`, deps `@supabase/supabase-js` + `open`
- `tsconfig.json` — strict mode, ES2022, módulo bundler
- `ops-chief.md` — adicionado **Auth Verification Protocol** (decision tree) e step_1_receive com pre-check de session

### Setup necessário (admin)

Ver [`SETUP-ADMIN.md`](./SETUP-ADMIN.md) — configuração de Redirect URLs no dashboard do Supabase (bloqueante para o login funcionar).

---

## [0.1.0] — 2026-04-22

### Added — Scaffold estrutural (Fase 1.1)

- Estrutura de diretórios (`agents/`, `tasks/`, `workflows/`, `checklists/`, `data/`, `templates/`)
- `config.yaml` com `handoff_protocol` block (hub-and-spoke, V26 compliance)
- `README.md` em português — onboarding do time, fluxo de auth, setup
- `CHANGELOG.md` template
- `data/primeteam-platform-rules.md` (870L) — Central reference
- `data/handoff-card-template.md` — V18
- `checklists/handoff-quality-gate.md` — V19
- `tasks/test-handoff-flow.md` — V20
- `agents/ops-chief.md` (725L) — Tier 0 orchestrator
- `agents/auth-specialist.md` (521L) — Tier 1

### [0.1.1] — 2026-04-22 (standalone workspace)

- `.claude/commands/PrimeteamOps/` — symlinks (120000) para `agents/`, `tasks/`, `checklists/` — repo auto-suficiente como workspace Claude Code

---

## Template de entry (para cycles futuros)

```markdown
## [X.Y.Z] — YYYY-MM-DD

### Cycle ID: cyc-YYYY-MM-DD-NNN

**Request:** {descrição da demanda do usuário}
**Triaged by:** ops-chief
**Routed to:** {specialist} → {specialist} → ... (ordem)
**Status:** Done | InReview | Blocked

### Files changed
- `path/to/file.ts` (created | modified | deleted)

### Convention Verification Report
- [x] i18n IT+PT-BR
- [x] @/ alias
- [x] RLS compliance
- [x] ArchPrime DS tokens
- [x] Mobile-first

### Deploy flag
safe-to-deploy: yes | no | with-caveats

### Suggested next
{próximo specialist ou close}
```

---

**Mantido por:** ops-chief (updates automáticas em cada cycle) + manual (em releases).
