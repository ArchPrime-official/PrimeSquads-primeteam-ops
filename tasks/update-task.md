# Task: update-task

> Task atômica para atualizar uma `tasks` existente (title, description, priority, urgency, status, etc.). Inclui **pre-check de autorização baseado no PRD F-08.3** (mudança de due_date exige aprovação se user não é creator nem owner).

**Cumpre:** HO-TP-001 (Task Anatomy — 8 campos)

---

## Task anatomy

### task_name
`Update Task`

### status
`pending` *(da task anatomy — não confundir com `status` da tabela `tasks`, que aceita `'todo' | 'doing' | 'done'`)*

### responsible_executor
`platform-specialist`

### execution_type
`Agent` — execução LLM + Supabase. Confirmation step OBRIGATÓRIO se mutação afeta data ou status.

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload:**
  - `task_id` (uuid, obrigatório — OU resolver por title se único match)
  - `updates` (object, qualquer subset):
    - `title`, `description`, `priority` (1..10), `urgency` (1..10)
    - `due_date` (ISO 8601 UTC) — **TRIGGER F-08.3 workflow se user não autorizado**
    - `status` (`'todo' | 'doing' | 'done'` apenas — outros valores violam CHECK)
    - `block_type` (`'task'|'meeting'|'focus_time'|'personal'|'unavailable'`)
    - `estimated_duration_minutes`, `project_id`, `assigned_to`, `tags`
    - `reason` (string, opcional — recomendado para due_date changes)

### output

- **`task_id`**, **`updated_fields`** (echo dos campos modificados)
- **`row_snapshot_before`** + **`row_snapshot_after`**
- **`verdict`** — `DONE` (UPDATE direto) | `REQUEST_CREATED` (workflow F-08.3) | `BLOCKED` | `ESCALATE`
- **`request_id`** (uuid) — preenchido se verdict=REQUEST_CREATED (apontando pra `task_date_change_requests` row)
- **`convention_check`**: enums respected ✓ / RLS ✓ / audit_logged ✓

### action_items

1. **Resolver task_id** — SELECT por id ou title (ILIKE). 0 ou >1 match → ESCALATE.
2. **Buscar contexto:**
   ```sql
   SELECT id, created_by, owner_id, assigned_to, due_date, project_id, status
   FROM tasks WHERE id = {task_id};
   ```
3. **AUTHORIZATION PRE-CHECK** — antes de qualquer UPDATE, classificar a mutação:
   - **Sempre permitido (no request needed):**
     - Update simples (title, description, priority, urgency, status, tags, etc.) — RLS permissivo aceita
     - User é `created_by` da task (criador tem direito total)
     - User tem role `owner` (top da hierarquia, bypassa)
   - **Workflow F-08.3 obrigatório** SE TODAS forem verdade:
     - `updates` contém `due_date` (mudança de prazo)
     - User NÃO é `created_by`
     - User NÃO tem role `owner`
     - User não é `assigned_to` (assignee tb pode mudar — verificar interpretação)
4. **Se Workflow F-08.3 obrigatório:**
   - **NÃO executar UPDATE direto.**
   - INSERT em `task_date_change_requests`:
     ```sql
     INSERT INTO task_date_change_requests
       (task_id, requested_by, approver_id,
        current_due_date, suggested_due_date, reason, status)
     VALUES
       ({task_id}, auth.uid(), {task.created_by},
        {current.due_date}, {updates.due_date}, {reason or null}, 'pending');
     ```
   - Echo: "Você não criou esta tarefa nem é owner. Sua mudança de prazo (de {current} para {suggested}) foi enviada como **request** — aguardando aprovação de **{creator_name}**. Para forçar aprovação imediata, peça ao owner do projeto."
   - Return verdict=REQUEST_CREATED com request_id
5. **Se update direto permitido:**
   - Executar UPDATE com cláusula race-safe `WHERE id = {task_id}`
   - Se due_date mudou: INSERT em `task_date_changes` (audit trail):
     ```sql
     INSERT INTO task_date_changes
       (task_id, old_due_date, new_due_date, changed_by, reason)
     VALUES
       ({task_id}, {before.due_date}, {after.due_date}, auth.uid(), {reason});
     ```
6. **Validar enums no UPDATE:**
   - `status` ∈ `('todo','doing','done')`
   - `block_type` ∈ `('task','meeting','focus_time','personal','unavailable')`
   - `priority`/`urgency` ∈ 1..10
   - Inválido → ESCALATE com lista de valores válidos
7. **Tratar erros:**
   - 42501 (RLS) → BLOCKED
   - 23514 (CHECK) → BLOCKED indicando campo violado
   - 23503 (FK violation, ex: project_id inexistente) → BLOCKED
   - 5xx → retry 1x → ESCALATE
8. **Activity log** — INSERT em `activity_logs` com `action='platform-specialist.update_task'`, details com diff before/after.
9. **Retornar ao chief.**

### acceptance_criteria

- **[A1] Authorization pre-check executed:** decisão entre UPDATE direto vs REQUEST_CREATED é loggada explícita no handoff card.
- **[A2] Owner bypass:** user com role `owner` pula workflow F-08.3 (UPDATE direto sempre).
- **[A3] Creator bypass:** user que é `created_by` da task pula workflow F-08.3.
- **[A4] Request shape correto:** se REQUEST_CREATED, INSERT contém os 7 campos obrigatórios (task_id, requested_by, approver_id, current_due_date, suggested_due_date, reason opcional, status='pending').
- **[A5] Audit trail em UPDATE direto:** se due_date mudou, `task_date_changes` ganha row.
- **[A6] Enum validation:** status/block_type/priority/urgency rejeitam valores fora do schema.
- **[A7] Echo claro ao user:** quando REQUEST_CREATED, mensagem explica POR QUE foi request (não acesso direto) + QUEM aprova + COMO acelerar (peça ao owner).
- **[A8] No silent UPDATE:** specialist NUNCA atualiza due_date sem checar autorização primeiro.

---

## Exemplos

### Exemplo 1 — Owner muda due_date direto (DONE)

**Input:** user role=owner pede "muda prazo da task 'Revisar PR' para sexta"

**Specialist:**
1. Resolve task → encontra (created_by != current user, mas user é owner)
2. Authorization: owner bypassa F-08.3
3. UPDATE direto + INSERT task_date_changes audit
4. Return DONE

### Exemplo 2 — Não-creator muda due_date (REQUEST_CREATED)

**Input:** user role=marketing pede "adia tarefa 'Email blast' para amanhã" (criada por Sandra)

**Specialist:**
1. Resolve task → created_by=Sandra, current user != Sandra, role != owner
2. Authorization: workflow F-08.3 obrigatório
3. INSERT task_date_change_requests com approver_id=Sandra
4. Echo: "Sua mudança de prazo foi enviada como request — aguardando aprovação de Sandra. Para acelerar, peça ao Pablo (owner) override direto."
5. Return REQUEST_CREATED com request_id

### Exemplo 3 — Status enum inválido (BLOCKED)

**Input:** "marcar task X como 'in_progress'"

**Specialist:**
1. Resolve task
2. Validate status: 'in_progress' NÃO está em ('todo','doing','done')
3. Return BLOCKED: "Status 'in_progress' não existe. Valores válidos: todo, doing, done. Você quis dizer 'doing'?"

---

## Notas

- **F-08.3 source:** PRD `docs/prd-v2/modules/08-tasks.md` seção F-08.3.
- **owner bypass justificativa:** PRD FR2 hierarquia `owner > admin = financeiro > comercial = cs = marketing`. Owner é top.
- **assigned_to interpretation:** PRD não é claro se assignee pode mudar prazo direto ou também precisa de request. Conservador: APENAS creator + owner bypass. Assignee passa pelo workflow F-08.3 (defensivo). Se Pablo decidir flexibilizar, ajustar action_items[3].
- **Notifications side-effect:** quando REQUEST_CREATED, campos `message_id` e `dm_channel_id` da row podem ser populados por integration-specialist via WhatsApp/email pra notificar o approver. Sprint futuro.

---

**Mantido por:** platform-specialist
