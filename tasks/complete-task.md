# Task: complete-task

> Task atômica para marcar uma tarefa como concluída (`UPDATE tasks SET completed_at, completed_by, status='done'`). Idempotente: se já estava done, não re-executa — apenas reporta o estado existente.

**Cumpre:** HO-TP-001 (Task Anatomy — 8 campos)

> ⚠️ **SCHEMA (verificado em `types.ts` + `apps/v2/src/hooks/`, 2026-07-03):** a tabela
> real é **`task_completion_history`** — `task_completed_occurrences` **NÃO EXISTE** e
> nunca existiu. Além disso, ao contrário do que se assumia, **não há trigger de banco**
> que popule essa tabela: quem grava a linha é o CLIENTE (`useCompleteRecurringTask.ts`),
> e só para tarefas recorrentes — ver action_items §5 para o fluxo correto (que este
> agente precisa replicar manualmente, não delegar a um trigger inexistente).

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
- **`recurrence_info`** — se `is_recurring=true`, indica que ESTE AGENTE gravou a ocorrência em `task_completion_history` e reagendou a próxima (não há trigger de banco que faça isso — ver action_items §5)
- **`verdict`** — DONE | BLOCKED | ESCALATE
- **`convention_check`**:
  - Idempotent: ✓
  - RLS respected: ✓
  - UTC used: ✓
  - Session read-only: ✓

### action_items

1. **Resolver task_id** — se só veio `task_title`, fazer SELECT prévio buscando tanto tarefas
   que o user É DONO quanto tarefas onde o user está entre os RESPONSÁVEIS (`assigned_to`
   é `uuid[]` — nem toda task "do usuário" tem ele como `owner_id`):
   ```sql
   SELECT id, title, status FROM tasks
   WHERE (owner_id = auth.uid() OR auth.uid() = ANY(assigned_to))
     AND title ILIKE '%{term}%' AND status != 'done'
   LIMIT 10;
   ```
   - 0 matches → ESCALATE `"não encontrei tarefa ativa com esse título"`
   - 1 match → usar
   - >1 match → ESCALATE com lista pedindo pick
2. **Check current state** — SELECT rápido do id para validar existência e status (inclui
   campos de recorrência, necessários para o branch do passo 5):
   ```sql
   SELECT id, title, status, completed_at, started_at, due_date, scheduled_start_time,
          is_recurring, recurrence_type, recurrence_interval, completion_count, owner_id
   FROM tasks WHERE id = {uuid};
   ```
   - Row não existe (0 rows) → BLOCKED com msg "tarefa não encontrada ou sem permissão de leitura (RLS)".
   - status == 'done' → IDEMPOTENT HIT. Retornar DONE com `was_already_done=true`, NÃO executar UPDATE.
   - status != 'done' E `is_recurring=true` → ir para o branch de recorrência (step 5) EM VEZ do UPDATE simples do step 3 — completar uma recorrente não é "marcar done", é reagendar (ver step 5).
   - status != 'done' E `is_recurring` falsy → prosseguir para step 3 (caminho simples).
3. **Executar UPDATE** (só para tarefa NÃO recorrente) — mutation:
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
5. **Recorrência — NÃO existe trigger de banco para isso (correção de 2026-07-03).**
   Completar uma task com `is_recurring=true` **não** é um `UPDATE status='done'` — é um
   **reagendamento para a próxima ocorrência**, espelhando exatamente
   `apps/v2/src/hooks/useCompleteRecurringTask.ts` (a UI faz isso no client; este agente
   replica o mesmo efeito via Supabase, já que não há trigger nem edge function que faça):
   1. **INSERT manual em `task_completion_history`** (o agente grava, ninguém mais grava):
      ```sql
      INSERT INTO task_completion_history
        (task_id, completed_at, started_at, due_date, was_late, completion_time_minutes,
         completed_by, task_snapshot)
      VALUES
        ({uuid}, now(), {started_at}, {due_date},
         {(data de now() no fuso do executor) > (data de due_date no fuso do executor)},
         {started_at is not null ? diferença em minutos entre now() e started_at : null},
         auth.uid(),
         {jsonb com title/description/priority/urgency/scheduled_start_time/estimated_duration_minutes/owner_id da task});
      ```
   2. **Calcular a próxima ocorrência** — `next_due_date` a partir de `recurrence_type` +
      `recurrence_interval` (mesma lógica de `apps/v2/src/lib/recurrence-next-date.ts`),
      preservando o delta entre `scheduled_start_time` e `due_date` antigos para o
      `next_scheduled_start`. **Se o agente não tiver confiança de reproduzir esse cálculo
      corretamente (ex: regra de recorrência incomum), NÃO adivinhe — ESCALATE** sugerindo
      que o usuário conclua pela UI (Quadrante/Lista), onde o hook cuida disso.
   3. **UPDATE da tarefa-mãe** (reagenda, NÃO marca 'done'):
      ```sql
      UPDATE tasks
      SET status = 'todo',
          started_at = NULL,
          completed_at = NULL,
          due_date = {next_due_date},
          scheduled_start_time = {next_scheduled_start},
          completion_count = COALESCE(completion_count, 0) + 1,
          last_completion_at = now()
      WHERE id = {uuid};
      ```
   4. Retornar DONE com `recurrence_info` explicando que a ocorrência foi registrada em
      `task_completion_history` e a tarefa foi REAGENDADA (status volta a `'todo'`, não fica
      `'done'`) — `was_already_done=false` neste path (recorrência sempre re-executa).
6. **Tratar erros**:
   - 42501 (RLS) → BLOCKED honestamente
   - 5xx → retry 1x → ESCALATE se persistir
7. **Retornar ao chief** — announcement V10 + output V11 + handoff card V18.

### acceptance_criteria

- **[A1] Idempotency:** se tarefa já estava `status='done'`, task NÃO executa UPDATE. Retorna DONE com `was_already_done=true` e `completed_at` ORIGINAL (não o now()).
- **[A2] Title resolution:** se request veio com `title` em vez de `task_id`, task faz lookup considerando `owner_id = auth.uid() OR auth.uid() = ANY(assigned_to)` (não só dono — tarefas atribuídas a alguém que não é o `owner_id` também devem ser encontráveis). 0 ou >1 match → ESCALATE (NÃO chuta o primeiro).
- **[A3] Race-safe update:** cláusula `AND status != 'done'` na UPDATE (caminho não-recorrente) garante que dois completes concorrentes não duplicam writes.
- **[A4] Recurrence honesty:** se `is_recurring=true`, o specialist MESMO insere a ocorrência em `task_completion_history` (não existe trigger de banco que faça isso) e reagenda a tarefa (`status` volta a `'todo'`, `due_date`/`scheduled_start_time` avançam) — NUNCA deixa a tarefa recorrente em `status='done'` como se fosse terminal, e NUNCA referencia `task_completed_occurrences` (tabela inexistente).
- **[A5] UTC + local:** output tem AMBAS representações (ISO UTC e formatted Europe/Rome) para audit.
- **[A6] RLS clarity:** denial 42501 → BLOCKED com msg clara (improvável para tasks pois policies são permissivas, mas código deve lidar se policies forem tightened).
- **[A7] Not destructive:** task é REVERSÍVEL via `reopen-task.md` — não requer confirmation "sim".
- **[A8] Returns task_title:** output inclui título para human reading em logs (auditoria).
- **[A9] completed_by populated:** UPDATE (caminho não-recorrente) seta `completed_by = auth.uid()` (audit trail) explicitamente — não há trigger de plataforma garantindo isso automaticamente.
- **[A10] Status enum strict:** UPDATE (caminho não-recorrente) seta `status = 'done'` (literal). Idempotency check usa `WHERE status != 'done'` — coerente com enum real `('todo','doing','done','cancelled')`. Nunca usar `'completed'`, `'finished'`, `'closed'`, `'pending'` (esses não existem na tabela — o valor inicial real é `'todo'`).

---

## Exemplos de execução

### Exemplo 1 — Happy path (DONE)

**Input:** `"completar tarefa id 8a3f...-b12c"`

**Specialist:**
1. task_id = 8a3f...-b12c (direto).
2. SELECT current: status=todo, title="revisar PRD fiscal engine", is_recurring=false.
3. UPDATE (caminho não-recorrente): completed_at=2026-04-23T14:20:00Z, status=done.

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

### Exemplo 4 — Tarefa recorrente (reagendamento, não "done")

**Input:** `"marcar daily standup de hoje como feito"`

**Specialist:** encontra tarefa id=r3c...-9 com `is_recurring=true`, `recurrence_type='daily'`. NÃO faz o UPDATE simples — insere manualmente a ocorrência em `task_completion_history` e reagenda a tarefa (não há trigger de banco fazendo isso).

**Return:**
```
[platform-specialist → ops-chief] Cycle cyc-... — DONE.

task_id: r3c...-9
title: "daily standup"
completed_at: 2026-04-23T09:00:00Z (gravado em task_completion_history, não em tasks.completed_at)
completed_at_local: 2026-04-23 11:00 Europe/Rome
was_already_done: false
recurrence_info: |
  Tarefa recorrente. Este agente INSERIU manualmente a ocorrência em
  task_completion_history (não existe trigger de banco para isso) e
  reagendou a tarefa-mãe: due_date/scheduled_start_time avançaram para a
  próxima ocorrência (recurrence_type=daily), status voltou a 'todo'
  (nunca virou 'done' — recorrente não tem estado terminal), completion_count
  incrementado.
convention_check: idempotent ✓, RLS ✓
```

---

## Notas de implementação

- **Reversível:** task `reopen-task.md` (Sprint 3.5 ou 4) desfaz via `UPDATE tasks SET completed_at=NULL, completed_by=NULL, status='todo'` (caminho não-recorrente — o valor inicial/reaberto real é `'todo'`, não `'pending'`).
- **Idempotency by design:** o `AND status != 'done'` é a defesa de race no caminho não-recorrente. Completes concorrentes não duplicam.
- **Recurrence:** NÃO há trigger de banco (`task_completion_history` não tem nenhum trigger de INSERT automático). A lógica vive no CLIENTE (`apps/v2/src/hooks/useCompleteRecurringTask.ts`) e este agente replica o mesmo efeito manualmente: grava a ocorrência + recalcula a próxima data + reagenda a tarefa-mãe para `'todo'`. Nunca finalizar uma tarefa recorrente como `'done'`.

---

**Mantido por:** platform-specialist.
