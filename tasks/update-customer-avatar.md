# Task: update-customer-avatar

> Atualizar o PERFIL do customer (company_name/contact_name, health_score, cs_manager_id, onboarding_completed). CS mantém para alimentar Chat AI + dashboards. F-05.4.

**⚠️ Nota de nomenclatura:** apesar do nome da task, "avatar" aqui é o **perfil/registro do customer** (tabela `customers`), não a tabela `avatars` (que é um recurso de MARKETING — perfil de persona/ICP com `demographics`, `aspirations`, `frequent_objections` etc., usado por campanhas/creative, sem relação com um customer específico). Esta task NUNCA escreve em `avatars`. O nome do arquivo é mantido por compatibilidade (não renomear o arquivo), mas o conceito correto é "update-customer".

**✅ SCHEMA GROUNDED (2026-07-03):** colunas reais de `customers` (`types.ts`) — `company_name` (NOT NULL, não `name`), `contact_name` (NOT NULL), `contact_email` (NOT NULL), `contact_phone`, `cs_manager_id` (não `manager_id`), `onboarding_completed` (boolean, não `onboarding_status`), `last_contact_date` (não `last_contact_at`), `health_score` (**enum de banco** `Database["public"]["Enums"]["health_score"]` = `at_risk | needs_attention | healthy | excellent`, não um inteiro 1..10), `custom_fields` (jsonb — mais próximo do conceito de "tags"/campos livres). Colunas fantasma removidas: `name`, `segment`, `tags`, `status`, `manager_id`, `onboarding_status`, `last_contact_at` — nenhuma dessas existe em `customers`.

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name `Update Customer Avatar`

### responsible_executor `platform-specialist`

### execution_type `Agent` — confirmation simples.

### input
- `customer_id` (uuid OR `contact_email`)
- `updates`: `{company_name, contact_name, contact_phone, health_score ('at_risk'|'needs_attention'|'healthy'|'excellent'), cs_manager_id, onboarding_completed (bool), last_contact_date, custom_fields (jsonb)}`

### output
- `customer_id`, `updated_fields`
- `verdict`: `DONE | BLOCKED | ESCALATE`

### action_items

1. **Role:** cs/admin/owner.
2. Resolver customer (`SELECT ... FROM customers WHERE id={customer_id} OR contact_email={contact_email}`).
3. Validar:
   - `health_score` ∈ enum `at_risk|needs_attention|healthy|excellent` (rejeitar qualquer outro valor — não é escala numérica)
   - `cs_manager_id` existe AND has cs role
   - `custom_fields` é jsonb livre — não há enum de "segment" no schema para validar contra
4. Confirmation:
   ```
   Update customer {company_name} ({contact_name}):
     Diff: ...
     {health_change ? 'Health score: ' + old + ' → ' + new : ''}
     {manager_change ? 'Novo cs_manager: ' + manager_name : ''}
   ```
5. UPDATE atomic.
6. **Side-effect (GAP CONHECIDO — 2026-07-03):** não há trigger nem função que recalcule `health_score` automaticamente ao mudar `last_contact_date`. O schema define `health_score DEFAULT 'healthy'` na criação (migration `20251026132212`), mas depois disso é um campo manual — se `last_contact_date` mudar, `health_score` NÃO é recalculado sozinho; se a mudança de score for consequência do contato, setar `health_score` explicitamente no mesmo UPDATE.
7. Activity log diff.
8. Echo: "✓ Customer atualizado. Chat AI ingestion no próximo cron."

### acceptance_criteria
- A1 cs/admin/owner
- A2 `health_score` restrito ao enum de 4 valores (não escala 1..10)
- A3 `cs_manager_id` has cs role
- A4 Audit diff
- A5 `custom_fields` (jsonb) preservado em merge, não sobrescrito por inteiro, se a UI só editou parte dele

---

**Mantido por:** platform-specialist
