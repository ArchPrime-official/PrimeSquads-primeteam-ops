# CHANGELOG — primeteam-ops

Todas as mudanças notáveis deste squad ficam documentadas aqui. Cada ciclo executado pelo `ops-chief` gera uma entrada.

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e versionamento semântico [SemVer](https://semver.org/lang/pt-BR/).

---

## [0.11.0] — 2026-04-22

### Added — integration-specialist expandido com Meta Ads (Fase 2 Sprint 10)

- `agents/integration-specialist.md` expandido: Calendar + Revolut + **Meta Ads** (trindade de boundaries externas fecha).
  - Novo scope_in_sprint_10: 10 tabelas `meta_*` cache
  - 10 novos playbooks Meta: list_campaigns, list_adsets, list_ads, list_insights_daily, list_breakdowns, check_meta_sync_status, check_meta_connection, trigger_meta_sync, campaign_performance_summary, spend_snapshot_trend
  - Novo core principle implicit: **specialist fornece DATA, expertise squads (/metaAds) decidem estratégia**. Linha bem clara entre operacional e estratégico.
  - 1 novo output example (happy path + underperformer flags + route to /metaAds)
  - 2 novos smoke tests: meta_campaigns_happy + meta_strategic_question_rejected
  - Anti-patterns Meta-specific: nunca pausar/ativar campaigns (Sprint 11+), nunca recommend strategy (route to /metaAds), preserve currency
  - Staleness thresholds Meta: fast_sync 30min / incremental 2h / full 24h

- `tasks/list-meta-campaigns.md` (HO-TP-001):
  - Read-only em `meta_ads_campaigns_cache`
  - Aggregates (total_spend, avg_CTR, avg_ROI) computed
  - **Underperformer flags automáticos:** CTR<1%, CPL>threshold, ROI<1.0, frequency>3
  - Currency preservation (sem conversão)
  - Strategic recommendations: rejeitadas (route to /metaAds)
  - 5 exemplos: happy FRESH / underperformer flags / VERY_STALE+failed / DISCONNECTED BLOCKED / strategic question ESCALATE

### Arquitetura atingida com Sprint 10

7 agents cobrindo 3 boundaries externas + 5 roles:

| Boundary | Status | Tabelas cache |
|----------|--------|---------------|
| Google Calendar | ✓ (Sprint 8) | 5 tabelas |
| Revolut | ✓ (Sprint 9) | 4 tabelas |
| **Meta Ads** | **✓ (Sprint 10)** | **10 tabelas** |

**Territory separation clarificada:**
- Meta Ads data + sync → integration-specialist
- Meta Ads strategy + recommendations → /metaAds expertise squad
- Revolut transactions → platform-specialist Finance
- Revolut balances/sync → integration-specialist

### Total edge functions referenciadas

- sync-google-calendar
- get-google-events
- sync-revolut-transactions
- get-revolut-balances
- sync-meta-billing

---

## [0.10.0] — 2026-04-22

### Added — integration-specialist expandido com Revolut (Fase 2 Sprint 9)

- `agents/integration-specialist.md` expandido de 632L → **963L**:
  - Novo scope_in_sprint_9: Google Calendar (preserved) + **Revolut** (NEW)
  - 8 novos playbooks Revolut: list_revolut_balances, list_revolut_discrepancies, check_revolut_sync_status, check_revolut_connection, trigger_revolut_sync, trigger_revolut_balance_check, list_revolut_webhooks, reconciliation_report
  - Novo core_principle implicit: `revolut_rls_requirement` — RLS has_finance_access() (owner/financeiro only), honest BLOCKED se role inadequada
  - **Staleness threshold mais estrito** para Revolut: 15min (FRESH) vs 2h (VERY_STALE) — mais crítico financeiramente que Calendar
  - **Privacy strict**: access_token/refresh_token NUNCA selecionados em queries, mesmo que schema permita. Enforcement por código, não confiança no RLS.
  - 1 novo output example: happy path + STALE warning + discrepancy flagged
  - 3 novos smoke tests: revolut_balances_happy / revolut_discrepancy_flag / revolut_wrong_role_rejected
  - Anti-patterns Revolut-specific: nunca chamar API direto, nunca SELECT access_token, nunca transferir (UI+2FA), diferenciação Revolut API value vs calculated de finance_transactions
  - future_notes: sprint 9 feature set summary + reconhece transactions Revolut vivem em finance_transactions (territory = platform-specialist Finance, não integration-specialist)

- `tasks/list-revolut-balances.md` (HO-TP-001):
  - DISTINCT ON por conta (latest balance_check)
  - Pre-check: connection + sync_status
  - Discrepancy flagging (is_matching=false ⚠)
  - Privacy: user_id scoped, access_token never selected
  - 5 exemplos: happy FRESH / STALE+discrepancy / DISCONNECTED BLOCKED / RLS denial (cs role) / filter só discrepâncias

### Tabelas Revolut documentadas

- `revolut_balance_checks` — primary (histórico comparison Revolut API vs calculated)
- `revolut_sync_logs` — histórico syncs (status, errors, timing)
- `revolut_credentials` — LIMITED read (apenas expires_at/id, NUNCA tokens)
- `revolut_webhooks` — config webhooks
- `finance_bank_accounts` — cross-reference (Revolut accounts têm revolut_account_id)

### Edge functions referenciadas

- `sync-revolut-transactions` — invocado via trigger_revolut_sync (escreve em finance_transactions)
- `get-revolut-balances` — invocado via trigger_revolut_balance_check (escreve em revolut_balance_checks)

### Separação de territórios clarificada

- **Transactions Revolut** → platform-specialist Finance (tabela `finance_transactions` com `bank_transaction_id`)
- **Balances / Sync / Discrepancies** → integration-specialist (tabelas `revolut_*`)

---

## [0.9.0] — 2026-04-22

### Added — integration-specialist (Google Calendar boundary) + list-calendar-events (Fase 2 Sprint 8)

- `agents/integration-specialist.md` (632L) — **Tier 3** external integrations boundary specialist. Sprint 8 cobre **apenas Google Calendar**. Meta Ads + Revolut + currency auto-convert ficam para Sprints 9-10+.
  - Scope: read-only em 5 tabelas de cache (`google_calendar_events_cache`, `google_calendar_sync_status`, `google_calendar_watch_channels`, `google_event_overrides`, `booking_events`)
  - 7 playbooks: list_calendar_events, check_sync_status, check_connection_status, trigger_resync (único com mutation), list_watch_channels, find_event, list_overrides
  - 9 core_principles cuidadosamente formulados:
    - Cache is source of truth (for reads — never direct API call)
    - Staleness must be flagged (30min threshold para Google Calendar)
    - No direct external API calls (boundary layer respeitada)
    - Trigger re-sync is explicit (consome quota, pede confirmation)
    - Token state is read-only (lifecycle = edge function territory)
    - Watch channels are critical infra (expirado = cache stale silenciosamente)
    - User isolation (even owner não vê eventos de outros — privacy)
    - Meet_link is sensitive (só expor ao próprio user)
    - Auto-reject external mutations (criar evento direto = Sprint 9+)
  - 3 output examples: happy path (FRESH cache) + STALE cache warning + external mutation rejected
  - 8 anti-patterns (never call external API direct, never expose meet_link of others, never skip staleness check)
  - 3 smoke tests (list events FRESH, STALE cache warning, external mutation rejected)
  - future_notes: Meta Ads integration (Sprint 9+), Revolut integration (Sprint 9+), currency conversion auto, OAuth CLI flow, watch channel rotation, Stripe pertence platform-specialist

- `tasks/list-calendar-events.md` (HO-TP-001):
  - Read-only no cache com user_id scoped (privacy)
  - Pre-check de connection (user conectado?) + sync_status (staleness)
  - Staleness thresholds: <30min FRESH, 30min-24h STALE, >24h VERY_STALE
  - Date range keywords: today/tomorrow/this_week/next_week/this_month (convertidos Europe/Rome → UTC)
  - Overrides optional merge (include_overrides=false default)
  - 5 exemplos: happy FRESH / STALE warning / DISCONNECTED BLOCKED / search por título / empty result DONE

### Arquitetura atingida

7 agents no squad (5 executors + 1 chief + 1 auditor):

| Tier | Agent | Cobertura |
|------|-------|-----------|
| T0 | ops-chief | Orchestrator |
| T1 | auth-specialist | OAuth + session |
| T1 | platform-specialist | Tasks + Finance + CS (1177L) |
| T2 | sales-specialist | CRM (leads, opportunities) |
| T2 | content-builder | Landing Pages |
| T3 | integration-specialist | Google Calendar (Sprint 9+ expand Meta/Revolut) |
| T3 | quality-guardian | Handoff audit |

9 tasks HO-TP-001 + 1 workflow + CLI auth.

---

## [0.8.0] — 2026-04-22

### Added — content-builder (marketing specialist) + create-landing-page (Fase 2 Sprint 7)

- `agents/content-builder.md` (659L) — **Tier 2** marketing specialist focado em Landing Pages. Complementa role `marketing` (Sandra) no squad — última role sem cobertura.
  - Scope Sprint 7: CRUD em `landing_pages` + read-only em campaigns/booking_events
  - 10 playbooks: create_lp, list_lps, update_lp_content, update_lp_slug (safe rename), activate_lp (pre-flight check), deactivate_lp, delete_lp, link_to_campaign, link_to_booking_event, list_analytics
  - 9 core_principles CRM-specific: slug is sacred (immutable after publish), kebab-case validation, slug uniqueness, activate carefully, never invent HTML, redirect_to_slug for renames, tracking pixels per-campaign, thank_you_page is toggle, auto-reject scope creep
  - 3 output examples: create LP happy ESCALATE (pede html), publish LP, reject content generation request
  - 10 anti-patterns específicos (nunca inventar html, nunca rename slug ativa sem warning, etc.)
  - 3 smoke tests (create happy, slug collision, content generation rejection)
  - Voice DNA PT-BR com URL pattern `lp.archprime.io/{slug}`
  - future_notes: blocks JSON editor (Sprint 8+), template library (pre-existente), lesson_pages multi-step, automation linkage (Sprint 8+), analytics DB-computed, redirect workflow

- `tasks/create-landing-page.md` (HO-TP-001):
  - **SEMPRE active=false** na criação — publicação é separate cycle
  - Slug regex validation + auto-conversion echo (se user deu formato inválido)
  - Slug uniqueness check obrigatório antes de INSERT
  - Campaign/booking_event resolution por nome
  - Pixel format validation (meta=numeric, google_ads=AW-XXX, tiktok=alphanumeric)
  - Thank_you flow coerência (use_thank_you_page=true requer thank_you_html_content)
  - 5 exemplos: happy / slug inválido ESCALATE com conversion / slug colisão ESCALATE com 3 opções / html placeholder ESCALATE / RLS denial (cs role) BLOCKED

### Cobertura de roles após Sprint 7

Todas as 5 roles do time ArchPrime têm cobertura no squad:
- `owner` (Pablo) — acesso total a todos os agents
- `financeiro` (Joyce, Larissa, Adriana) — platform-specialist (Finance)
- `comercial` (Miriam, Daniel, Yuri) — sales-specialist
- `cs` (Jessica, Andrea) — platform-specialist (CS module)
- `marketing` (Sandra) — content-builder **NOVO**

### Estado do squad após Sprint 7

- **6 agents**: ops-chief (T0), auth (T1), platform (T1 — Tasks+Finance+CS, 1177L), sales (T2 — CRM), content-builder (T2 — LPs), quality-guardian (T3)
- **1 workflow**: wf-platform-operation.yaml
- **8 tasks HO-TP-001**
- CLI auth funcional

---

## [0.7.0] — 2026-04-22

### Added — platform-specialist CS module + list-students task (Fase 2 Sprint 6)

- `agents/platform-specialist.md` expandido de 870L → **1177L**:
  - Novo scope section `in_sprint_6`: Tasks + Finance + **Customer Success** (4 tabelas: `customers`, `tickets`, `ticket_comments`, `onboarding_submissions` read-only)
  - 9 novos playbooks CS: `list_customers`, `update_customer_status`, `complete_onboarding`, `list_tickets`, `create_ticket`, `update_ticket_status`, `assign_ticket`, `add_ticket_comment`, `list_onboarding_submissions`
  - Novos routing_triggers: "aluno", "customer", "health score", "churn risk", "onboarding", "ticket", "CS manager", "next check-in"
  - 2 novos output examples: happy path criar ticket billing (Jessica/role=cs) + scope rejection approval onboarding (Sprint 7+)
  - 2 novos smoke tests: `test_6_cs_create_ticket_happy`, `test_7_onboarding_approval_rejected`
  - CS-specific anti-patterns (nunca mutar onboarding_submission.status, resolver customer via ILIKE antes de INSERT, falar "aluno" não "customer" ao user, não inventar ticket_number)
  - Nomenclatura: tabela `customers` no DB = "aluno/students" no linguajar ArchPrime (convenção de produto). Specialist resolve via company_name/contact_name ILIKE.
  - future_notes: onboarding approval é workflow (Sprint 7+), ticket SLA sem enforcement automático, customer churn analysis multi-step, ticket assignment precisa user_lookup via profiles

- `tasks/list-students.md` (novo, HO-TP-001):
  - Read-only SELECT com 18 colunas explícitas (nunca SELECT *)
  - Filtros típicos CS: health_score, cs_manager, onboarding status, churn_risk range, mrr/arr/ltv ranges, date ranges (overdue / today / this_week)
  - 5 exemplos de execução: triagem at_risk / meus alunos (Jessica) / check-in overdue / empty result DONE / cs_manager ambíguo ESCALATE
  - Campos sensíveis (tax_id, vat_number, custom_fields, billing_*) NÃO incluídos por default

### Observações CS

- `ticket_status` enum: new | open | in_progress | waiting_customer | waiting_internal | resolved | closed | cancelled
- `ticket_priority` enum: low | medium | high | urgent | critical
- `ticket_type` enum: 9 tipos (technical_support / billing / feature_request / bug_report / onboarding / training / general_inquiry / cancellation_request / upgrade_request)
- `health_score` enum: at_risk | needs_attention | healthy | excellent

### Estado do squad após Sprint 6

- 5 agents: ops-chief (T0), auth (T1), platform (T1 — Tasks+Finance+CS, 1177L), sales (T2), quality-guardian (T3)
- 1 workflow: wf-platform-operation.yaml
- 7 tasks HO-TP-001: test-handoff-flow, create-task, list-tasks, complete-task, create-finance-transaction, create-lead, move-opportunity-stage, list-students
- CLI auth funcional

---

## [0.6.0] — 2026-04-22

### Added — wf-platform-operation + quality-guardian (Fase 2 Sprint 5)

- `workflows/wf-platform-operation.yaml` (408L) — workflow YAML formalizando o Orchestration Protocol 5-step do ops-chief. 7 phases (Receive → Auth Check → Triage → Route → Specialist Work → Gate → Next/Close), 8 INVARIANTS (INV-01 a INV-08), 4 exemplos end-to-end (simple create_task / multi-specialist won→finance / scope rejection / gate REJECT+retry), 5 failure modes documentados. Primeiro workflow YAML do squad.

- `agents/quality-guardian.md` (571L) — **Tier 3** audit specialist. NÃO invocado em todo cycle — apenas quando chief detecta cycle complexo (multi-specialist, destructive op, first-run, anomaly signal). Executa 5 seções canônicas do gate (V10 regex, V11 package, V18 card, convention_check, coherence) + 5 extensões (destructive confirmation, RLS clarity, security leak scan, INV compliance, drift detection). NEVER mutates — pure read/audit. Returns PASS | REJECT (with how_to_fix) | ESCALATE | WAIVE.

- `agents/ops-chief.md` — step_4 expandido para mencionar delegação ao quality-guardian em cycles complexos. routing_map.quality_validation agora aponta para agent real (não placeholder).

### Arquitetura atingida

Com Sprint 5, o squad tem:
- 1 orquestrador (ops-chief, Tier 0)
- 3 executores (auth T1, platform T1, sales T2)
- 1 auditor (quality-guardian T3)
- 1 workflow canônico (wf-platform-operation)
- 6 tasks HO-TP-001 (test-handoff-flow, create-task, list-tasks, complete-task, create-finance-transaction, create-lead, move-opportunity-stage)
- CLI de auth funcional (login/whoami/logout)

Topologia hub-and-spoke completa. Pronto para testes end-to-end após config Supabase admin.

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
