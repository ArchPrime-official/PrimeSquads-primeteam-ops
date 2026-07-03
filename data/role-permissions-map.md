# Role × Permissions Map — primeteam-ops

> Reescrito 2026-07-03 (F3). Duas dimensões: **role × agent** (quem invoca cada specialist)
> e **role × task** (gerada por script a partir dos gates reais — nunca manual).
>
> **Hierarquia da plataforma** (roleHierarchy): `owner(1)` > `admin(2)` = `financeiro(2)` >
> `comercial(3)` = `cs(3)` = `marketing(3)`. owner vê tudo; admin vê tudo EXCETO finanças
> (`has_finance_access` = owner + financeiro, **admin EXCLUÍDO** desde 2026-03-04);
> `has_invoice_access` = owner + admin.

## 1. Role × Agent (12 agents reais)

| Agent | Tier | Roles que invocam | Domínio |
|-------|:----:|-------------------|---------|
| `ops-chief` | 0 | **todas** (owner/admin/financeiro/comercial/cs/marketing) | orquestrador — roteia p/ sub-chiefs e specialists |
| `auth-specialist` | 1 | todas | login/logout/whoami/refresh |
| `platform-specialist` | 1 | owner, admin, financeiro (finance) + comercial/cs/marketing conforme task | CRUD geral, conciliação, reconcile |
| `sales-specialist` | 2 | owner, admin, comercial | CRM/vendas/campanhas/eventos |
| `content-builder` | 2 | owner, admin, marketing | landing pages, forms, conteúdo (consolidado — substitui `marketing-specialist`) |
| `automation-specialist` | 2 | owner, admin, marketing | automation flows, email sequences |
| `integration-specialist` | 3 | varia por API (calendar/meta/whatsapp/vapi) — ver matriz task | boundaries externas |
| `admin-specialist` | 3 | **owner-only** (role/user mgmt); tasks fiscais mal-alocadas → migrar (mismatch F3) | user/role management |
| `imports-specialist` | 2 | owner, admin (+ financeiro p/ import finance) | import CSV |
| `lovarch-ops-specialist` | 1 | todas (read-only) | suporte/lookup Lovarch |
| `screen-motion-engineer` | 2 | owner, admin | motion graphics + runbook academy/youtube |
| `quality-guardian` | 3 | sistema (cross-cutting) | audit de handoff/gate |

> Agents REMOVIDOS deste mapa em 2026-07-03 por não existirem em `agents/`: ~~cs-specialist~~,
> ~~design-guardian~~ (eram fantasmas). `content-builder` estava duplicado — consolidado.

## 2. Role × Task (GERADA — `python3 scripts/gen-role-task-matrix.py --repo .`)

> ⚠️ Gerada dos gates declarados em cada task. Regenere após mudar gates. Fonte por linha na
> coluna `gate`. Curadoria explícita (tasks sem gate detectável na prosa) em `CURATED_GATES`
> do gerador. `·` = bloqueado; ✅ = permitido.

| Task | owner | admin | financeiro | comercial | cs | marketing | gate |
|------|:-:|:-:|:-:|:-:|:-:|:-:|------|
| `activate-automation-flow` | ✅ | ✅ | · | ✅ | · | · | roles nominais |
| `adjust-schedule-block` | ✅ | ✅ | · | · | · | · | roles nominais |
| `approve-role-request` | ✅ | · | · | · | · | · | owner-only (role/user mgmt) |
| `approve-task-date-change` | ✅ | · | · | · | · | · | roles nominais |
| `backfill-vapi-calls` _(read)_ | ✅ | ✅ | · | · | · | · | roles nominais |
| `bulk-delete-leads` | ✅ | ✅ | · | ✅ | ✅ | · | roles nominais |
| `bulk-reissue-invoices` | ✅ | ✅ | · | · | · | · | has_invoice_access |
| `bulk-update-opportunities` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | roles nominais |
| `bulk-update-transactions` | ✅ | · | ✅ | · | · | · | has_finance_access (admin EXCLUÍDO) |
| `check-meta-sync-health` _(read)_ | ✅ | ✅ | · | ✅ | · | ✅ | roles nominais |
| `clone-automation-flow` | ✅ | ✅ | · | ✅ | · | ✅ | roles nominais |
| `clone-landing-page` | ✅ | ✅ | · | · | · | ✅ | roles nominais |
| `complete-task` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | curado: pessoal — dono/atribuído |
| `create-automation-flow` | ✅ | ✅ | · | ✅ | · | ✅ | roles nominais |
| `create-campaign` | ✅ | ✅ | · | · | · | ✅ | roles nominais |
| `create-channel` | ✅ | ✅ | · | · | · | ✅ | roles nominais |
| `create-cms-page` | ✅ | ✅ | · | · | · | ✅ | curado: conteúdo/LP |
| `create-editorial-post` | ✅ | ✅ | · | · | · | ✅ | roles nominais |
| `create-event` | ✅ | ✅ | · | · | · | ✅ | roles nominais |
| `create-evento-products` | ✅ | ✅ | · | · | · | · | has_invoice_access |
| `create-finance-transaction` | ✅ | · | ✅ | · | · | · | has_finance_access (admin EXCLUÍDO) |
| `create-landing-page` | ✅ | ✅ | · | · | · | ✅ | curado: conteúdo/LP (deprecated) |
| `create-lead` | ✅ | ✅ | · | ✅ | · | ✅ | curado: CRM/captação |
| `create-onboarding-form` | ✅ | ✅ | · | ✅ | ✅ | ✅ | roles nominais |
| `create-sales-invoice` | ✅ | ✅ | · | · | · | · | has_invoice_access |
| `create-schedule-block` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | todos autenticados |
| `create-session-note` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | roles nominais |
| `create-task` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | curado: pessoal — qualquer autenticado cria/agenda própria task |
| `deactivate-automation-flow` | ✅ | · | · | · | · | · | owner-only |
| `deactivate-user` | ✅ | · | · | · | · | · | owner-only (role/user mgmt) |
| `delete-finance-transaction` | ✅ | · | ✅ | · | · | · | has_finance_access (admin EXCLUÍDO) |
| `delete-message` | ✅ | ✅ | · | · | · | · | roles nominais |
| `delete-opportunity` | ✅ | ✅ | · | ✅ | · | · | roles nominais |
| `delete-task` | ✅ | · | · | · | · | · | roles nominais |
| `diagnose-database` _(read)_ | ✅ | ✅ | · | · | · | · | roles nominais |
| `edit-message` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | curado: chat — autor da mensagem |
| `export-opportunities-csv` _(read)_ | ✅ | ✅ | · | ✅ | · | · | roles nominais |
| `generate-landing-page-ai` | ✅ | ✅ | · | · | · | ✅ | roles nominais |
| `import-csv` | ✅ | ✅ | · | · | · | · | roles nominais |
| `launch-lancio-online` | ✅ | · | · | · | · | · | owner-only |
| `launch-vapi-call` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | roles nominais |
| `list-automation-flows` _(read)_ | · | · | · | · | · | · | roles nominais |
| `list-calendar-events` _(read)_ | · | · | · | · | · | · | roles nominais |
| `list-cms-pages` _(read)_ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | roles nominais |
| `list-customers` _(read)_ | ✅ | ✅ | · | · | ✅ | · | roles nominais |
| `list-event-registrants` _(read)_ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | roles nominais |
| `list-landing-page-analytics` _(read)_ | ✅ | ✅ | · | · | · | ✅ | roles nominais |
| `list-meta-campaigns` _(read)_ | ✅ | ✅ | · | · | · | ✅ | roles nominais |
| `list-revolut-balances` _(read)_ | ✅ | · | ✅ | · | · | · | has_finance_access (admin EXCLUÍDO) |
| `list-tasks` _(read)_ | ✅ | · | · | · | · | · | roles nominais |
| `list-vapi-calls` _(read)_ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | roles nominais |
| `lovarch-lookup-user` _(read)_ | · | · | · | · | · | · | roles nominais |
| `lovarch-recent-errors` _(read)_ | ✅ | ✅ | · | · | ✅ | · | roles nominais |
| `lovarch-user-tickets` _(read)_ | · | · | ✅ | · | · | · | roles nominais |
| `lovarch-whoami` _(read)_ | · | · | · | · | · | · | roles nominais |
| `manage-channel-members` | ✅ | ✅ | · | · | · | · | roles nominais |
| `manage-email-sequence` | ✅ | ✅ | · | · | · | ✅ | curado: automation/marketing |
| `manage-form-fields` | ✅ | ✅ | · | · | ✅ | ✅ | roles nominais |
| `manage-monthly-goals` | ✅ | ✅ | · | · | · | · | roles nominais |
| `manage-radar-meetings` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | roles nominais |
| `manage-task-projects` | ✅ | ✅ | · | · | · | · | roles nominais |
| `move-opportunity-stage` | ✅ | ✅ | · | ✅ | · | · | roles nominais |
| `publish-academy-lessons-youtube` | ✅ | ✅ | · | · | · | · | curado: runbook (screen-motion) |
| `publish-cms-page` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | roles nominais |
| `publish-onboarding-form` | ✅ | ✅ | · | · | ✅ | ✅ | roles nominais |
| `reconcile-bank-transactions` | ✅ | · | ✅ | · | · | · | has_finance_access (admin EXCLUÍDO) |
| `request-role-change` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | roles nominais |
| `request-task-date-change` | ✅ | · | · | · | · | · | roles nominais |
| `reschedule-task` | ✅ | · | · | · | · | · | roles nominais |
| `revoke-role` | ✅ | · | · | · | · | · | owner-only (role/user mgmt) |
| `run-meta-sync` _(read)_ | ✅ | ✅ | · | ✅ | · | ✅ | roles nominais |
| `schedule-whatsapp-message` | ✅ | ✅ | · | ✅ | ✅ | ✅ | curado: integration — bloqueia financeiro |
| `search-creative-studio` _(read)_ | ✅ | ✅ | · | · | · | ✅ | roles nominais |
| `send-message` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | todos autenticados |
| `send-whatsapp-message` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | roles nominais |
| `sync-seller-commission` | ✅ | ✅ | · | · | · | · | has_invoice_access |
| `test-handoff-flow` _(read)_ | ✅ | · | · | · | · | · | roles nominais |
| `toggle-campaign-status` | ✅ | ✅ | · | · | · | ✅ | roles nominais |
| `update-bank-account` | ✅ | · | ✅ | · | · | · | has_finance_access (admin EXCLUÍDO) |
| `update-commission-level` | ✅ | ✅ | · | · | · | · | has_invoice_access |
| `update-credit-card` | ✅ | · | ✅ | · | · | · | has_finance_access (admin EXCLUÍDO) |
| `update-customer-avatar` | ✅ | ✅ | · | · | ✅ | ✅ | roles nominais |
| `update-event-status` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | roles nominais |
| `update-finance-transaction` | ✅ | · | ✅ | · | · | · | has_finance_access (admin EXCLUÍDO) |
| `update-landing-page` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | roles nominais |
| `update-lead` | ✅ | ✅ | · | ✅ | ✅ | · | roles nominais |
| `update-meta-sync-config` | ✅ | ✅ | · | · | · | · | roles nominais |
| `update-onboarding-form` | ✅ | ✅ | · | · | ✅ | ✅ | roles nominais |
| `update-task` | ✅ | · | · | · | · | · | roles nominais |
| `verify-opportunity` _(read)_ | · | ✅ | · | · | · | · | roles nominais |
| `view-activity-log` _(read)_ | ✅ | · | · | · | · | · | owner-only |

