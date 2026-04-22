# Task: complete-task

> Task atômica para marcar uma tarefa como concluída (`UPDATE tasks SET completed_at, completed_by, status='done'`). Idempotente: se já estava done, não re-executa — apenas reporta o estado existente.

**Cumpre:** HO-TP-001 (Task Anatomy — 8 campos)

---

## Task anatomy (HO-TP-001 — 8 campos obrigatórios)

### task_name
`Complete Task`

### status
`pending`

### responsible_executor
`platform-specialist` (Sprint 2+, Tasks module)

### execution_type
`Agent` — execução 100% LLM + Supabase client. Sem human intervention (não destrutivo, reversível via reopen-task).

### input

Entregue pelo `ops-chief`:

- **Cycle ID**: `cyc-YYYY-MM-DD-NNN`
- **User JWT**: `~/.primeteam/session.json`
- **Request payload**:
  - `task_id` (uuid) — direto OR
  - `task_title` (string) — usa listing para resolver → se 0 ou >1 match, ESCALATE com clarification

### output

- **`task_id`** — uuid da tarefa completada
- **`title`** — título da tarefa (para confirmação humana)
- **`completed_at`** — ISO UTC timestamp da conclusão
- **`completed_at_local`** — mesma em Europe/Rome
- **`was_already_done`** — bool (true se idempotent hit)
- **`recurrence_info`** — se `is_recurring=true`, indica que a trigger criou `task_completed_occurrences` row (não é ação minha)
- **`verdict`** — DONE | BLOCKED | ESCALATE
- **`convention_check`**:
  - Idempotent: ✓
  - RLS respected: ✓
  - UTC used: ✓
  - Session read-only: ✓

### action_items

1. **Resolver task_id** — se só veio `task_title`, fazer SELECT prévio:
   ```sql
   SELECT id, title, status FROM tasks
   WHERE owner_id = auth.uid() AND title ILIKE '%{term}%' AND status != 'done'
   LIMIT 10;
   ```
   - 0 matches → ESCALATE `"não encontrei tarefa ativa com esse título"`
   - 1 match → usar
   - >1 match → ESCALATE com lista pedindo pick
2. **Check current state** — SELECT rápido do id para validar existência e status:
   ```sql
   SELECT id, title, status, completed_at FROM tasks WHERE id = {uuid};
   ```
   - Row não existe (0 rows) → BLOCKED com msg "tarefa não encontrada ou sem permissão de leitura (RLS)".
   - status == 'done' → IDEMPOTENT HIT. Retornar DONE com `was_already_done=true`, NÃO executar UPDATE.
   - status != 'done' → prosseguir para step 3.
3. **Executar UPDATE** — mutation:
   ```sql
   UPDATE tasks
   SET completed_at = now(),
       completed_by = auth.uid(),
       status = 'done'
   WHERE id = {uuid} AND status != 'done'
   RETURNING id, completed_at;
   ```
   - Note: `AND status != 'done'` garante idempotency race-safe.
4. **Tratar resposta** — se Supabase retornou row com completed_at, success. Se 0 rows afetadas (concurrent update?), re-check e reportar estado atual.
5. **Check recurrence** — se `is_recurring=true`, mencionar em output_package que o DB trigger cuida de `task_completed_occurrences`. Não faço INSERT manual lá.
6. **Tratar erros**:
   - 42501 (RLS) → BLOCKED honestamente
   - 5xx → retry 1x → ESCALATE se persistir
7. **Retornar ao chief** — announcement V10 + output V11 + handoff card V18.

### acceptance_criteria

- **[A1] Idempotency:** se tarefa já estava `status='done'`, task NÃO executa UPDATE. Retorna DONE com `was_already_done=true` e `completed_at` ORIGINAL (não o now()).
- **[A2] Title resolution:** se request veio com `title` em vez de `task_id`, task faz lookup. 0 ou >1 match → ESCALATE (NÃO chuta o primeiro).
- **[A3] Race-safe update:** cláusula `AND status != 'done'` na UPDATE garante que dois completes concorrentes não duplicam writes.
- **[A4] Recurrence transparency:** se `is_recurring`, output menciona que trigger do DB criou occurrence row. Specialist NÃO INSERT manualmente em `task_completed_occurrences`.
- **[A5] UTC + local:** output tem AMBAS representações (ISO UTC e formatted Europe/Rome) para audit.
- **[A6] RLS clarity:** denial 42501 → BLOCKED com msg clara (improvável para tasks pois policies são permissivas, mas código deve lidar se policies forem tightened).
- **[A7] Not destructive:** task é REVERSÍVEL via `reopen-task.md` — não requer confirmation "sim".
- **[A8] Returns task_title:** output inclui título para human reading em logs (auditoria).

---

## Exemplos de execução

### Exemplo 1 — Happy path (DONE)

**Input:** `"completar tarefa id 8a3f...-b12c"`

**Specialist:**
1. task_id = 8a3f...-b12c (direto).
2. SELECT current: status=pending, title="revisar PRD fiscal engine".
3. UPDATE: completed_at=2026-04-23T14:20:00Z, status=done.
4. Recurrence: is_recurring=false.

**Return:**
```
[platform-specialist → ops-chief] Cycle cyc-... — DONE.

task_id: 8a3f...-b12c
title: "revisar PRD fiscal engine"
completed_at: 2026-04-23T14:20:00Z
completed_at_local: 2026-04-23 16:20 Europe/Rome
was_already_done: false
recurrence_info: null
convention_check: idempotent ✓, RLS ✓, UTC↔Rome ✓
```

### Exemplo 2 — Idempotent hit (DONE, was_already_done=true)

**Input:** `"completar tarefa id 8a3f...-b12c"` (segunda vez)

**Specialist:**
1. SELECT current: status=done, completed_at=2026-04-23T14:20:00Z.
2. NÃO executa UPDATE.

**Return:**
```
[platform-specialist → ops-chief] Cycle cyc-... — DONE.

task_id: 8a3f...-b12c
title: "revisar PRD fiscal engine"
completed_at: 2026-04-23T14:20:00Z (valor original, não re-escrito)
was_already_done: true
warnings: "tarefa já estava concluída em 2026-04-23 16:20 Europe/Rome"
convention_check: idempotent ✓
```

### Exemplo 3 — Title ambíguo (ESCALATE)

**Input:** `"completar a tarefa de revisar"`

**Specialist:** SELECT ILIKE '%revisar%' AND status != 'done' retorna 3 matches.

**Return:**
```
[platform-specialist → ops-chief] Cycle cyc-... — ESCALATE.

verdict: ESCALATE
suggested_user_message: |
  "Encontrei 3 tarefas pendentes com 'revisar':
   1. Revisar PRD fiscal engine (id: 8a3f...)
   2. Revisar PR #945 (id: c1d2...)
   3. Revisar migration auth (id: e7f8...)
   Qual devo marcar como concluída?"
context_for_retry:
  candidate_ids: [8a3f..., c1d2..., e7f8...]
convention_check: N/A
```

### Exemplo 4 — Tarefa recorrente

**Input:** `"marcar daily standup de hoje como feito"`

**Specialist:** encontra tarefa id=r3c...-9 com `is_recurring=true`. UPDATE bem-sucedido. Trigger DB cria `task_completed_occurrences` row automaticamente.

**Return:**
```
[platform-specialist → ops-chief] Cycle cyc-... — DONE.

task_id: r3c...-9
title: "daily standup"
completed_at: 2026-04-23T09:00:00Z
completed_at_local: 2026-04-23 11:00 Europe/Rome
was_already_done: false
recurrence_info: |
  Tarefa recorrente. DB trigger criou row em task_completed_occurrences
  para registrar esta ocorrência. A próxima instância será gerada pelo
  scheduled job (não ação minha).
convention_check: idempotent ✓, RLS ✓
```

---

## Notas de implementação

- **Reversível:** task `reopen-task.md` (Sprint 3.5 ou 4) desfaz via `UPDATE tasks SET completed_at=NULL, completed_by=NULL, status='pending'`.
- **Idempotency by design:** o `AND status != 'done'` é a defesa de race. Completes concorrentes não duplicam.
- **Recurrence:** lógica vive em DB triggers, não no agent. Agent só marca a row-mãe como done.

---

**Mantido por:** platform-specialist.
