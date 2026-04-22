# Task: list-automation-flows

> Task read-only para listar `automation_flows` com summary de status + execution count últimos 7 dias. Útil para Sandra ter visibility de quais flows estão ativos, quantos triggers aconteceram, flows com erro recente.

**Cumpre:** HO-TP-001 (Task Anatomy — 8 campos)

---

## Task anatomy (HO-TP-001 — 8 campos obrigatórios)

### task_name
`List Automation Flows`

### status
`pending`

### responsible_executor
`automation-specialist` (Sprint 12)

### execution_type
`Agent` — LLM + Supabase. Read-only.

### input

Entregue pelo `ops-chief`:

- **Cycle ID**: `cyc-YYYY-MM-DD-NNN`
- **User JWT**: `~/.primeteam/session.json`
- **Request payload**:
  - `status` (opcional — default "active + draft"; aceitos: "draft" | "active" | "inactive" | "archived" | "all")
  - `trigger_type` (opcional — "lead_created" | "tag_added" | "manual" | etc.)
  - `search_term` (opcional — ILIKE em name + description)
  - `has_uazapi` (bool opcional — filter flows com WhatsApp)
  - `created_by` (user_id opcional)
  - `include_execution_stats` (bool, default true — computed last 7d)
  - `limit` (int, default 50, max 200)

### output

- **`total_rows`** — número de flows retornados
- **`rows`** — array com campos: id, name, description, status, trigger_type, uazapi_instance_id, created_by, updated_at, executions_last_7d, failures_last_7d
- **`table_compact`** — markdown
- **`aggregate_stats`** — { total_active, total_draft, total_executions_7d, total_failures_7d, failure_rate }
- **`health_signals`** — array de flows com sinais (ex: high failure rate, no executions em flow ativo)
- **`filters_applied`** — echo
- **`verdict`** — DONE | BLOCKED
- **`convention_check`**:
  - Read-only ✓
  - RLS respected ✓
  - No full nodes/edges JSON dump (summary only) ✓

### action_items

1. **Parse filters** — defaults se não específico: status IN ('active', 'draft'), ORDER BY updated_at DESC, LIMIT 50.

2. **Build query**:
   ```sql
   SELECT f.id, f.name, f.description, f.status, f.trigger_type,
          f.uazapi_instance_id, f.created_by, f.updated_at,
          (SELECT COUNT(*) FROM automation_executions
           WHERE flow_id = f.id
             AND started_at > now() - interval '7 days'
          ) as executions_last_7d,
          (SELECT COUNT(*) FROM automation_executions
           WHERE flow_id = f.id
             AND started_at > now() - interval '7 days'
             AND status = 'failed'
          ) as failures_last_7d
   FROM automation_flows f
   WHERE {filters}
   ORDER BY f.updated_at DESC
   LIMIT {limit};
   ```

3. **Join uazapi instance name** (se has_uazapi filter ou user wants detail):
   - Opcional: `LEFT JOIN uazapi_instances u ON u.id = f.uazapi_instance_id`

4. **Compute aggregate_stats**:
   - `total_active = COUNT WHERE status='active'`
   - `total_draft = COUNT WHERE status='draft'`
   - `total_executions_7d = SUM(executions_last_7d)`
   - `total_failures_7d = SUM(failures_last_7d)`
   - `failure_rate = total_failures / total_executions` (if total > 0)

5. **Detect health_signals**:
   - Flow status='active' com `executions_last_7d = 0` → "flow ativo sem triggers em 7 dias — check trigger config ou lead volume"
   - Flow com `failures_last_7d / executions_last_7d > 0.1` (>10% failure) → "flow com alto failure rate — investigar error_message"
   - Flow ativo sem uazapi_instance_id mas node requires WhatsApp → requires deep nodes parse (skip em Sprint 12, flag future_notes)

6. **Format table**:
   - Status com emoji: 🟢 active / 🟡 draft / ⚪ inactive / 📦 archived
   - Trigger type human-readable
   - Execution stats com trend indicator se possível
   - Updated_at em Europe/Rome

7. **Tratar erros**:
   - 42501 (RLS) → BLOCKED
   - 0 rows → DONE com mensagem "nenhum flow encontrado com filtros" (NÃO BLOCKED)
   - 5xx → retry 1x → ESCALATE

8. **Return** — V10 + V11 + V18.

### acceptance_criteria

- **[A1] No full JSON dump:** output NÃO inclui `nodes` ou `edges` full JSON (podem ser grandes + schema-sensitive). Summary apenas.
- **[A2] Execution stats computed:** por default, últimos 7d execution count + failure count. User pode desabilitar via include_execution_stats=false.
- **[A3] Health signals surfaced:** flows ativos sem triggers, failure rate alto.
- **[A4] Default filter sensato:** active + draft (esconde archived/inactive por default).
- **[A5] Empty result OK:** 0 rows = DONE, não BLOCKED.
- **[A6] RLS respected:** query usa user JWT. Se role não tem acesso, BLOCKED honest.
- **[A7] Limit capped:** max 200.
- **[A8] Aggregate stats:** 4 métricas agregadas (total_active, total_draft, total_executions_7d, failure_rate).

---

## Exemplos de execução

### Exemplo 1 — Happy path (DONE)

**Input:** `"listar flows ativos"`

**Specialist:**
1. filters: status='active'
2. Query retorna 4 flows
3. Aggregate: 4 active, 0 draft, 127 executions 7d, 3 failures (2.4%)
4. 1 health signal: flow "No Show Recovery" com executions_last_7d=0

**Return:**
```
[automation-specialist → ops-chief] Cycle cyc-... — DONE.

total_rows: 4
table_compact: |
  | # | Nome | Status | Trigger | UAZAPI? | Exec 7d | Falhas | Atualizado |
  |---|------|--------|---------|---------|---------|--------|------------|
  | 1 | Welcome Evento Roma | 🟢 active | lead_created | — | 52 | 0 | 2026-04-24 09:30 |
  | 2 | Welcome Studio Anuale | 🟢 active | lead_created | — | 44 | 1 (2.3%) | 2026-04-22 14:00 |
  | 3 | No-Show Recovery | 🟢 active | tag_added (no_show) | instance_1 | 31 | 2 (6.5%) | 2026-04-20 10:15 |
  | 4 | Retenção CS at-risk | 🟢 active | tag_added (at_risk) | — | 0 | 0 | 2026-04-18 16:00 |
aggregate_stats: { total_active: 4, total_draft: 0, total_executions_7d: 127, total_failures_7d: 3, failure_rate: 2.4% }
health_signals:
  - { flow_id: 4, flow_name: "Retenção CS at-risk", signal: "ativo sem triggers em 7d — check trigger config ou tag volume" }
filters_applied: { status: active }
convention_check: read-only ✓ | RLS ✓ | no full JSON dump ✓
```

### Exemplo 2 — High failure rate warning

**Input:** `"todos os flows"`

**Specialist:** detecta flow com failure_rate > 10% → health signal HIGH severity.

**Return:** DONE com health_signal destacado com ⚠ + recommendation "investigar via list_executions filter=failed flow_id=X".

### Exemplo 3 — Empty result (DONE)

**Input:** `"flows arquivados"` (time nunca arquivou nada)

**Return:** DONE com total_rows=0 + table "(nenhum flow arquivado)".

### Exemplo 4 — Filter por search term

**Input:** `"flows com 'welcome'"`

**Specialist:** ILIKE em name → 2 matches.

---

## Notas de implementação

- **nodes/edges fora do output default:** campos JSON grandes + schema-sensitive. Se user quer detalhes, usa get_flow_details (outro playbook).
- **Execution stats caros?** subquery por flow pode ser lento se 1000+ flows. Sprint 13+ pode materializar view ou usar automation_flows_stats_mv.
- **Health signals são hints, não verdict:** informativos, não blocking. User decide agir.

---

**Mantido por:** automation-specialist.
