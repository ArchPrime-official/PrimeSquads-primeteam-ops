# Database Schema Reference

> Referência das 226 tabelas da plataforma PrimeTeam, agrupadas por setor, com status de RLS.

**Source of truth:** `src/integrations/supabase/types.ts` (auto-gerado) + auditoria RLS em `docs/platform-analysis/PRIMETEAM-CLI-FEASIBILITY-AUDIT-2026-04-22.md` (Seção 1).

**Last updated:** 2026-04-22 (pós-Fase 0, PR #951 aplicado).

---

## Status de RLS agregado

| Métrica | Valor |
|---------|-------|
| Total de tabelas | 226 |
| Com RLS habilitado | 226 (100%) |
| Com policies adequadas | 226 (100%) |
| Gaps críticos pendentes | 0 |

Pós-Fase 0 (PR #951 merged em 2026-04-22), todos os gaps estão remediados.

---

## Helpers RLS (SECURITY DEFINER)

Funções disponíveis para usar em policies:

| Função | Retorna | Propósito |
|--------|---------|-----------|
| `has_finance_access()` | boolean | owner OR financeiro (admin removido) |
| `has_role(_user_id UUID, _role app_role)` | boolean | Checa role específica |
| `is_admin(_user_id UUID)` | boolean | Apenas role 'admin' |
| `is_owner(_user_id UUID)` | boolean | Apenas role 'owner' |
| `is_admin_or_owner(_user_id UUID)` | boolean | admin OR owner |

---

## Agrupamento por setor

### Finance (18 tabelas — proteção máxima)

Todas com `has_finance_access()` em SELECT/INSERT/UPDATE/DELETE.

`finance_transactions`, `finance_budgets`, `finance_bank_accounts`, `finance_bank_statements`, `finance_pending_transactions`, `finance_reconciliations`, `finance_credit_cards`, `finance_credit_card_invoices`, `finance_categories`, `finance_subcategories`, `finance_cost_centers`, `finance_exchange_rates`, `finance_goals`, `finance_platform_settings`, `finance_statement_lines`, `finance_transaction_attachments`, `finance_audit_log`, (total 18)

### CRM (12 tabelas — role-based pós Fase 0)

`leads`, `opportunities`, `opportunity_events`, `opportunity_verification_results`, `closers`, `closer_availability`, `campaign_attribution`, `evaluation_forms`, `evaluation_submissions`, `evaluation_questions`, `opportunity_notes`, `lead_history`

### Marketing / Ads (20 tabelas)

`meta_ad_accounts`, `meta_campaigns`, `meta_ad_sets`, `meta_ads`, `meta_ads_daily`, `meta_billing_data`, `meta_sync_logs`, `meta_saved_views`, `editorial_brands`, `editorial_posts`, `editorial_calendar_items`, `campaigns`, `content_documents`, `content_voiceovers`, `ai_presentations`, (e outros)

### Tasks (8 tabelas)

`tasks`, `task_projects`, `task_recurrences`, `task_completed_occurrences`, `task_history`, `task_date_change_requests`, `task_schedule_blocks`, `task_project_members`

### Calendar / Booking (14 tabelas)

`calendly_events`, `calendly_closers`, `calendly_slots`, `calendly_closer_events`, `event_bookings`, `booking_events`, `booking_tokens`, `calendar_blocks`, `calendar_preferences`, `google_calendar_tokens`, `user_oauth_tokens`, `google_events`, `booking_email_templates`, `email_sequences`

### Communication (9 tabelas)

`internal_channels`, `channel_members`, `channel_messages`, `channel_read_state`, `channel_bookmarks`, `message_reactions`, `message_read_status`, `message_threads`, `message_attachments`

### Telephony (8 tabelas)

`call_strategies`, `call_executions`, `call_event_queue`, `whatsapp_sessions`, `whatsapp_messages`, `telephony_calls`, `telephony_recordings`, `vapi_billing`

### CS (9 tabelas)

`customers`, `contracts`, `cs_students`, `tickets`, `cs_tickets`, `cs_activities`, `avatars`, `avatar_responses`, `onboarding_forms`, `onboarding_form_fields`, `onboarding_form_submissions`, `onboarding_form_tokens`

### Automation (7 tabelas)

`automation_flows`, `automation_executions`, `automation_queue`, `automation_contacts`, `automation_webhooks`, `canvas_flows`, `canvas_flow_versions`

### Landing Pages (9 tabelas)

`landing_pages`, `landing_page_blocks`, `landing_page_analytics`, `forms`, `form_fields`, `form_submissions`, `interactive_quizzes`, `quiz_questions`, `quiz_submissions`

### Radar (9 tabelas)

`radar_meetings`, `radar_meeting_sectors`, `radar_action_plans`, `radar_kpi_entries`, `radar_presentations`, `radar_meeting_metrics`, `radar_meeting_slides`, `radar_next_week_goals`

### Goals / Metas (8 tabelas)

`company_goals`, `goals_calculator_simulations`, `goals_product_breakdown`, `products`, `product_variable_costs`, `ai_chats`, `ai_chat_messages`, (outras)

### Commissions (4 tabelas)

`commission_levels`, `commission_thresholds`, `seller_monthly_entries`, `commission_rules`

### Shared / Auth (20 tabelas)

`users`, `profiles`, `user_roles`, `user_role_requests`, `role_permissions`, `user_push_preferences`, `user_schedule_preferences`, `user_preferences`, `user_channel_preferences`, `bookmarks`, `user_conversations`, `user_presence`, `user_snoozed_messages`, (outras)

### Integration / External (15 tabelas)

Principalmente tokens + logs das 8 integrações externas.

### Import / Job (6 tabelas)

`import_jobs`, `import_job_errors`, (outras)

---

## Workflow ao tocar DB

1. **Ler `types.ts`** primeiro para entender schema atual da tabela
2. **Ler migrations** relevantes em `supabase/migrations/` para entender policies
3. **Nunca editar `types.ts`** manualmente (é auto-gerado)
4. Se criar nova tabela: escrever migration idempotente com RLS + policies + trigger `updated_at` no mesmo arquivo

---

## Forbidden

- ❌ Criar tabela sem policies de RLS no mesmo migration
- ❌ Usar SELECT `*` no app (sempre colunas explícitas)
- ❌ Executar DDL ad-hoc (sempre via migration em PR)
- ❌ Usar service_role_key para bypassar RLS "por conveniência"

---

## Reference

- Auditoria RLS completa: `docs/platform-analysis/PRIMETEAM-CLI-FEASIBILITY-AUDIT-2026-04-22.md` (Seção 1)
- Types auto-gerados: `src/integrations/supabase/types.ts`
- Migrations: `supabase/migrations/*.sql`
