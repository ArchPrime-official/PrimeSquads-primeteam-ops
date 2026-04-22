# Task: list-tasks

> Task atômica para listar tarefas de `tasks` com filtros (status, date range, priority/urgency, project, assigned_to). Read-only — sem mutation. Sempre retorna paginado (LIMIT 50) com warning se exceder.

**Cumpre:** HO-TP-001 (Task Anatomy — 8 campos)

---

## Task anatomy (HO-TP-001 — 8 campos obrigatórios)

### task_name
`List Tasks`

### status
`pending`

### responsible_executor
`platform-specialist` (Sprint 2+, Tasks module)

### execution_type
`Agent` — execução 100% LLM + Supabase client. Sem human intervention (read-only, não destrutivo).

### input

Entregue pelo `ops-chief`:

- **Cycle ID**: `cyc-YYYY-MM-DD-NNN`
- **User JWT** (de `~/.primeteam/session.json`)
- **Request payload**:
  - `filters` (optional, dict):
    - `status` ("pending" | "in_progress" | "done" | "archived" | null=all)
    - `date_range` ("today" | "overdue" | "this_week" | "this_month" | custom `{from, to}`)
    - `priority` (int 1..4 ou array)
    - `urgency` (int 1..4 ou array)
    - `project_id` (uuid)
    - `assigned_to` (user_id — checa `array_contains(assigned_to, uuid)`)
    - `owner_id` (user_id — default: auth.uid())
    - `is_recurring` (bool)
  - `sort` (optional, default: `due_date ASC NULLS LAST, priority DESC, urgency DESC`)
  - `limit` (optional int, default 50, max 200)

### output

- **`total_rows`** — número de linhas retornadas
- **`rows`** — array de objetos com campos: `id, title, status, priority, urgency, due_date, owner_id, project_id, is_recurring, completed_at`
- **`table_compact`** — representação markdown pronta para exibir ao user
- **`filters_applied`** — echo dos filtros (para audit e follow-up commands)
- **`truncated`** — bool, true se `total_rows == limit` (hint que pode haver mais)
- **`verdict`** — DONE | BLOCKED | ESCALATE
- **`convention_check`**:
  - Read-only: ✓ (nenhuma mutation)
  - RLS respected: ✓
  - Session read-only: ✓
  - UTC timestamps: ✓ (com Europe/Rome echo)

### action_items

1. **Parse filters** — aplicar defaults:
   - Se nenhum filtro de owner/assigned: default `owner_id = auth.uid()`
   - Se `date_range=overdue`: `due_date < now() AND status != 'done'`
   - Se `date_range=today`: resolver bounds Europe/Rome day → UTC range
   - Validar ranges numéricos (priority/urgency in 1..4)
2. **Validar limit** — cap em 200 para evitar query custosa.
3. **Construir query** — SELECT restrito (id, title, status, priority, urgency, due_date, owner_id, project_id, is_recurring, completed_at) — NUNCA `SELECT *` (evita leak de bank_raw_data-like columns de outras tabelas).
4. **Executar SELECT** via Supabase (user JWT).
5. **Formatar rows** — converter timestamps UTC para Europe/Rome em `table_compact`, mas manter UTC em `rows` raw.
6. **Detectar truncation** — se `rows.length == limit`, set `truncated=true`.
7. **Tratar erros** — read-only é mais tolerante:
   - 0 rows → return DONE com `rows=[]` e `table_compact` vazio (NÃO é blocking, é resultado válido)
   - 5xx/timeout → retry 1x → se persistir, ESCALATE
   - Timeout de query muito ampla → ESCALATE pedindo filtros mais específicos
8. **Retornar ao chief** — announcement V10 + output V11.

### acceptance_criteria

- **[A1] Filter defaults applied:** se user não especificou owner, query usa `owner_id = auth.uid()`. Se nenhum filtro, default é `status='pending'`.
- **[A2] No SELECT *:** query explicita as 10 colunas. Schema inteiro nunca é exposto.
- **[A3] Limit enforced:** limit <= 200 sempre. Se user pede mais, ESCALATE suggesting pagination strategy.
- **[A4] Timestamps converted:** `table_compact` mostra timestamps em Europe/Rome formatted (YYYY-MM-DD HH:mm). `rows` raw mantém ISO UTC.
- **[A5] Truncation flagged:** se exact 50 rows retornam, `truncated=true` + warning "pode haver mais resultados, refine filtros".
- **[A6] Empty result OK:** 0 rows retorna DONE com mensagem "nenhuma tarefa encontrada com esses filtros" — NÃO é BLOCKED.
- **[A7] RLS read-scope:** se user role não permite ver owner_id de outro user, Supabase filtra silenciosamente. Task não infla resultado artificialmente.
- **[A8] No mutation:** verdict DONE com `convention_check.read_only = true`. Zero calls de INSERT/UPDATE/DELETE.

---

## Exemplos de execução

### Exemplo 1 — Happy path (overdue)

**Input:** `"listar minhas tarefas atrasadas"`

**Specialist:**
1. filters.owner_id = auth.uid() (default)
2. filters.date_range = "overdue"
3. Query:
   ```sql
   SELECT id, title, status, priority, urgency, due_date, owner_id,
          project_id, is_recurring, completed_at
   FROM tasks
   WHERE owner_id = auth.uid()
     AND due_date < now()
     AND status != 'done'
   ORDER BY due_date ASC, priority DESC, urgency DESC
   LIMIT 50;
   ```
4. 3 rows retornadas.

**Return:**
```
[platform-specialist → ops-chief] Cycle cyc-... — DONE.

total_rows: 3
table_compact: |
  | # | Título | Prazo (Rome) | P/U | Status |
  |---|--------|--------------|-----|--------|
  | 1 | Revisar PR #945 | 2026-04-20 18:00 | 4/4 | pending |
  | 2 | Agendar review tri | 2026-04-21 10:00 | 3/2 | pending |
  | 3 | Email Revolut | 2026-04-22 09:00 | 2/4 | in_progress |
truncated: false
filters_applied: { owner_id: <uuid>, date_range: overdue }
convention_check: read-only ✓, RLS ✓, UTC↔Rome ✓
```

### Exemplo 2 — Empty result (DONE, not blocked)

**Input:** `"tarefas do projeto Fiscal Engine pendentes"` (projeto não tem tarefas pendentes)

**Specialist:** query retorna 0 rows.

**Return:**
```
[platform-specialist → ops-chief] Cycle cyc-... — DONE.

total_rows: 0
table_compact: "(nenhuma tarefa encontrada com esses filtros)"
truncated: false
filters_applied: { project_id: <uuid>, status: pending }
convention_check: read-only ✓, RLS ✓
```

### Exemplo 3 — Truncation warning

**Input:** `"todas as tarefas do time"` (role owner, sem filtro de owner)

**Specialist:** query retorna 50 rows (cap).

**Return:**
```
[platform-specialist → ops-chief] Cycle cyc-... — DONE.

total_rows: 50
table_compact: (50 rows)
truncated: true
warnings: |
  Retornei 50 rows (limit atingido). Pode haver mais. Sugestão: filtre por
  status, project_id ou date_range para reduzir o conjunto.
convention_check: read-only ✓
```

---

## Notas de implementação

- **Read-only, sem confirmação:** SELECT não precisa de confirmation echo.
- **owner_id default:** sem filtro explícito, filtra pelo user logado. Isso é mais seguro (menos dados) e alinhado com expectativa típica "minhas tarefas".
- **Large result warning:** se time quiser ver todas, precisa pedir explicitamente — aceitar o truncation e iterar.

---

**Mantido por:** platform-specialist.
