# Task: list-students

> Task read-only para listar alunos (tabela `customers` no DB) com filtros típicos do dia a dia CS: health_score, CS manager, onboarding status, próximo check-in. Zero mutations.

**Cumpre:** HO-TP-001 (Task Anatomy — 8 campos)

---

## Task anatomy (HO-TP-001 — 8 campos obrigatórios)

### task_name
`List Students` (alias: `List Customers`)

### status
`pending`

### responsible_executor
`platform-specialist` (Sprint 6, CS module)

### execution_type
`Agent` — LLM + Supabase. Read-only, sem human intervention.

### input

Entregue pelo `ops-chief`:

- **Cycle ID**: `cyc-YYYY-MM-DD-NNN`
- **User JWT**: `~/.primeteam/session.json`
- **Request payload**:
  - `filters` (dict opcional):
    - `health_score` (enum: at_risk | needs_attention | healthy | excellent)
    - `cs_manager_id` (uuid) OR `cs_manager_name` (resolvido via profiles)
    - `onboarding_completed` (bool)
    - `churn_risk_range` ({min, max} — 0-100)
    - `mrr_range` / `arr_range` / `ltv_range` ({min, max, currency})
    - `industry` / `company_size` (text ILIKE)
    - `date_range` (created_at | customer_since | last_contact_date | next_check_in_date; bounds absolutos OR keywords today/this_week/this_month/overdue)
    - `search_term` (ILIKE em company_name + contact_name + contact_email)
  - `sort` (optional, default: `next_check_in_date ASC NULLS LAST, created_at DESC`)
  - `limit` (optional int, default 50, max 200)

### output

- **`total_rows`** — número de rows retornadas
- **`rows`** — array de objetos restritos:
  - id, company_name, contact_name, contact_email, health_score,
    cs_manager_id, onboarding_completed, onboarding_completed_at,
    churn_risk, mrr, arr, ltv, preferred_currency,
    next_check_in_date, last_contact_date, customer_since, created_at
- **`table_compact`** — markdown pronto para exibir
- **`filters_applied`** — echo (audit + follow-up)
- **`truncated`** — bool (true se total_rows == limit)
- **`verdict`** — DONE | BLOCKED | ESCALATE
- **`convention_check`**:
  - Read-only: ✓
  - RLS respected: ✓
  - UTC + Europe/Rome echo ✓
  - No SELECT * (colunas explícitas) ✓

### action_items

1. **Parse filters** — resolver defaults:
   - Se nenhum filtro: no WHERE clause além de `ORDER BY + LIMIT` (cuidado: retorna toda base de customers visível pelo user). Aceitar — time sabe quando quer isso.
   - Se `health_score="at_risk"` + nenhum outro: query comum de CS (triagem diária).
   - Se `cs_manager_name` veio: resolver via `profiles` (ou tabela equivalente) com ILIKE. 0 matches → warning + fallback a sem filtro. >1 → ESCALATE com candidates.
2. **Resolver date_range keywords**:
   - "overdue" (em contexto next_check_in_date): `< now()` AND `IS NOT NULL`
   - "today" / "this_week" / "this_month": bounds Europe/Rome → convert to UTC
3. **Validar limit** — cap 200.
4. **Montar query** com SELECT restrito (18 colunas acima, NUNCA `SELECT *`).
5. **Executar SELECT** via Supabase user JWT.
6. **Formatar rows**:
   - Timestamps em `table_compact` mostram Europe/Rome + UTC
   - Valores monetários (mrr/arr/ltv): formatar com preferred_currency do row
7. **Detectar truncation** (total_rows == limit → truncated=true + warning).
8. **Tratar erros**:
   - 0 rows → DONE com `rows=[]` e `table_compact="(nenhum aluno encontrado com esses filtros)"` (NÃO é BLOCKED)
   - 5xx → retry 1x → ESCALATE
   - Timeout → ESCALATE pedindo filtros mais específicos
9. **Retornar ao chief** — V10 + V11 + V18.

### acceptance_criteria

- **[A1] No SELECT *:** query explicita as 18 colunas permitidas. Schema inteiro nunca é exposto (campos como custom_fields, tax_id podem ser sensíveis em outros contextos).
- **[A2] Limit enforced:** cap em 200. Se user pede mais, ESCALATE.
- **[A3] cs_manager_name resolved:** se veio nome, task faz lookup. 0/>1 match → warning/ESCALATE (nunca inventar manager_id).
- **[A4] Date range keywords:** overdue/today/this_week/this_month reconhecidos e resolvidos para UTC bounds.
- **[A5] Empty result OK:** 0 rows → DONE (não BLOCKED).
- **[A6] Truncation flagged:** total == limit → `truncated=true` + warning.
- **[A7] Timestamps formatted:** `table_compact` em Europe/Rome; `rows` raw em UTC.
- **[A8] No mutation:** verdict DONE com `convention_check.read_only = true`. Zero INSERT/UPDATE/DELETE.

---

## Exemplos de execução

### Exemplo 1 — Triagem diária (CS routine)

**Input:** `"listar alunos em risco (at_risk) ordenados por próximo check-in"`

**Specialist:**
1. filters.health_score = "at_risk"
2. sort = "next_check_in_date ASC NULLS LAST"
3. SELECT restrito → 4 rows

**Return:**
```
[platform-specialist → ops-chief] Cycle cyc-... — DONE.

total_rows: 4
table_compact: |
  | # | Empresa | Contato | Health | CS Mgr | MRR | Próx. Check-in |
  |---|---------|---------|--------|--------|-----|----------------|
  | 1 | Rossi Consulting | Marco Rossi | at_risk | Jessica | €497 | 2026-04-24 09:00 (Rome) |
  | 2 | Verde SA | Anna Verdi | at_risk | Andrea | €297 | 2026-04-25 14:00 |
  | 3 | Blu Srl | Giorgio Blu | at_risk | — | €497 | 2026-04-26 (sem hora) |
  | 4 | TechSpa | Luigi T. | at_risk | Jessica | €197 | overdue (era 2026-04-21) |
truncated: false
filters_applied: { health_score: at_risk }
warnings: "1 aluno com check-in overdue — priorize"
convention_check: read-only ✓, RLS ✓
```

### Exemplo 2 — Por CS manager (Jessica's portfolio)

**Input:** `"meus alunos, todos"` (Jessica logada, role=cs)

**Specialist:**
1. "meus" → cs_manager_id = auth.uid()
2. SELECT com 27 rows (LIMIT 50 não atingido).

**Return:** DONE com 27 rows + table_compact + `filters_applied: { cs_manager_id: <jessica_uuid> }`

### Exemplo 3 — Next check-in overdue (triagem urgente)

**Input:** `"quais alunos tenho com check-in atrasado?"`

**Specialist:**
1. filters.cs_manager_id = auth.uid()
2. filters.date_range = { field: next_check_in_date, keyword: "overdue" }
3. WHERE `cs_manager_id = auth.uid() AND next_check_in_date < now() AND next_check_in_date IS NOT NULL`
4. 3 rows.

**Return:** DONE com 3 rows + warning "check-ins overdue precisam reagendar urgente".

### Exemplo 4 — Empty result (DONE, not BLOCKED)

**Input:** `"alunos no setor Healthcare com MRR acima €1000"`

**Specialist:** WHERE com filtros retorna 0 rows.

**Return:**
```
[platform-specialist → ops-chief] Cycle cyc-... — DONE.

total_rows: 0
table_compact: "(nenhum aluno encontrado com esses filtros)"
truncated: false
filters_applied: { industry: "Healthcare", mrr_range: { min: 1000 } }
convention_check: read-only ✓, RLS ✓
```

### Exemplo 5 — CS manager ambíguo

**Input:** `"alunos da Jessica"` (sem disambiguation)

**Specialist:** lookup profiles ILIKE '%jessica%' retorna 2 (Jessica CS e Jessica Marketing).

**Return:**
```
[platform-specialist → ops-chief] Cycle cyc-... — ESCALATE.

verdict: ESCALATE
suggested_user_message: |
  "Encontrei 2 pessoas com 'Jessica' nos profiles:
   1. Jessica CS (role: cs, user_id: ...)
   2. Jessica Marketing (role: marketing, user_id: ...)
   Qual é a cs_manager?"
context_for_retry:
  candidate_user_ids: [<uuid1>, <uuid2>]
```

---

## Notas de implementação

- **Read-only sem confirmation:** SELECT não precisa echo de confirmation.
- **Terminologia:** output em PT-BR usa "aluno/alunos" (convenção ArchPrime). `rows` raw mantém nomes de colunas do schema (`company_name`, `contact_name`, etc.).
- **Preferred currency:** cada row pode ter moeda diferente. `table_compact` respeita o preferred_currency do row, não força conversão.
- **Campos sensíveis não expostos:** `tax_id`, `vat_number`, `custom_fields`, billing_address_* ficam FORA do SELECT por default. Se user pedir explicitamente (ex: "ver vat_number do aluno X"), pode expandir mas é operação targeted.
- **cs_manager resolution:** preferível via `profiles` (tabela lookup); se profiles não for acessível por RLS do user, falhar silenciosamente com warning "não consegui resolver CS manager por nome, use UUID" não é adequado — ESCALATE ao user.

---

**Mantido por:** platform-specialist (CS scope).
