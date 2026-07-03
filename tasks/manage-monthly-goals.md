# Task: manage-monthly-goals

> CRUD de metas mensais por área/empresa em `company_goals`. Owner-only. Mensal. F-12.

**Cumpre:** HO-TP-001

> **Schema-verified 2026-07-03** contra `apps/v2/src/integrations/supabase/types.ts`. Meta mensal por área/empresa vive em **`company_goals`** (`month`, `year`, `category`, `brand`, `metric_key`, `target_value`, `actual_value`, `is_auto_calculated`, `notes`). NÃO é a tabela `goals` (essa é OKR: `title`/`metric_type`/`start_date`/`end_date`/`goal_status`, com histórico em `goal_history`). `goal_history.goal_id` referencia `goals`, **não** `company_goals` — logo, a auditoria de `company_goals` é via `activity_logs`, não `goal_history`.

---

## Task anatomy

### task_name `Manage Monthly Goals`

### responsible_executor `admin-specialist` (owner gate)

### execution_type `Agent` — confirmation simples.

### input
- `action` (`'create' | 'update' | 'list'`)
- **`create`:** `{month (1-12), year, category (a "área"), metric_key, brand (empresa — OBRIGATÓRIO), target_value}` (opcionais: `notes`, `is_auto_calculated`)
- **`update`:** `id (company_goals.id), updates` (subset das colunas reais)
- **`list`:** `{month, year, category, brand}` filters (read-only)

### output
- `id` ou `goals` (array de `company_goals`)
- `verdict`: `DONE | BLOCKED | ESCALATE`

### action_items

1. **Owner-only** para create/update. Read pode ser owner+admin.
2. Validar: `month` ∈ 1..12, `year` plausível, `category` e `metric_key` presentes (NOT NULL no schema), `target_value >= 0` se passado. **`brand` (empresa) OBRIGATÓRIO** — meta é por empresa; NUNCA defaultar silenciosamente (registry `forbidden_defaults: [brand]`) — perguntar "Qual empresa? (ArchPrime / Lovarch / ...)".
3. Pre-check duplicate: mesma `month`+`year`+`category`+`metric_key`+`brand` (uma meta por métrica/área/empresa/mês).
4. Confirmation com summary (mês/ano, categoria, empresa, métrica, target).
5. **INSERT/UPDATE atomic** em `company_goals` (NUNCA `goals` — tabela diferente). `updated_at`=NOW() no update.
6. **Tratar erros:** 42501 (RLS/owner) → BLOCKED; 23502 (NOT NULL category/metric_key/month/year) → BLOCKED com o campo faltante.
7. **Verificação pós-ação:** re-SELECT confirmando a linha persistida (month/year/category/brand/metric_key/target_value).
8. **Activity log** (auditoria de `company_goals` é aqui — `goal_history` NÃO se aplica, pois FKa a tabela OKR `goals`).

### acceptance_criteria
- A1 Owner gate (create/update)
- A2 Tabela correta: `company_goals` (NUNCA `goals`); colunas reais month/year/category/brand/metric_key/target_value
- A3 `brand` (empresa) OBRIGATÓRIO — sem default silencioso
- A4 Unicidade por month+year+category+metric_key+brand
- A5 Tratamento de erro (42501/23502) + verificação pós-ação
- A6 Audit log em activity_logs (não goal_history)

---

**Mantido por:** admin-specialist
