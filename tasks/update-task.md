# Task: update-task

> Task atômica para atualizar uma `tasks` existente (title, description, priority, urgency, status, etc.). Inclui **pre-check de autorização baseado no PRD F-08.3** (mudança de due_date exige aprovação se user não é creator nem owner) **e no modelo real de permissões** (`task_project_members.permissions`, quando a task pertence a um `project_id`).

**Cumpre:** HO-TP-001 (Task Anatomy — 8 campos)

> ⚠️ **SCHEMA (verificado em `types.ts`, 2026-07-03):** a coluna `tags` **NÃO EXISTE** em
> `tasks` — nunca incluir no INSERT/UPDATE. A autorização de "quem pode mudar o quê" tem uma
> segunda camada além de creator/owner: `task_project_members.permissions` (enum
> `task_project_permission[]`: `view_tasks, create_tasks, edit_tasks, delete_tasks,
> change_dates, change_status, change_priority, assign_members, manage_project,
> view_history`), checável via a RPC real `has_project_permission(p_user_id, p_project_id,
> p_permission)`. Ver `data/required-fields-registry.yaml` (entry `update-task`).

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
    - `due_date` (ISO 8601 UTC) — **TRIGGER F-08.3 workflow se user não autorizado E sem permission `change_dates` no projeto**
    - `scheduled_start_time` (ISO 8601 UTC) — horário de EXECUÇÃO (distinto de `due_date`, o PRAZO). Input formal desta task, não só um efeito colateral da regra §5.5. Sujeito à mesma regra de sincronização tarefa↔blocos (§5.5).
    - `status` (`'todo' | 'doing' | 'done' | 'cancelled'` apenas — outros valores violam CHECK; `cancelled` é uma transição legítima, ex: pedido de "anular"/"annullare")
    - `block_type` (`'task'|'meeting'|'focus_time'|'personal'|'unavailable'`)
    - `estimated_duration_minutes`, `project_id`, `assigned_to`
    - `reason` (string, opcional — recomendado para due_date changes)

  > ⛔ **NÃO existe `tags` em `updates`.** A coluna não existe em `tasks` — se o request pedir para "adicionar tag X", ESCALATE explicando que o schema atual não suporta tags em tarefas (não inventar uma gravação em outro campo).

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
     - User é `created_by` da task (criador tem direito total)
     - User tem role `owner` (top da hierarquia, bypassa)
     - Se a task tem `project_id`: user tem a `task_project_members.permissions` relevante
       no projeto, verificável via RPC real `has_project_permission(p_user_id, p_project_id,
       p_permission)` (que JÁ bypassa sozinha para owner/creator do projeto — chamar mesmo
       assim, é a fonte de verdade):
       - `change_dates` → autoriza mudar `due_date`/`scheduled_start_time` direto (pula F-08.3)
       - `change_status` → autoriza mudar `status`
       - `change_priority` → autoriza mudar `priority`/`urgency`
       - `edit_tasks` → autoriza os demais campos (title, description, estimated_duration_minutes, assigned_to, block_type, project_id)
     - Update simples SEM `due_date` na mutação e sem task de projeto restrito — RLS permissivo aceita (comportamento legado mantido para tasks sem `project_id`).
   - **Workflow F-08.3 obrigatório** SE TODAS forem verdade:
     - `updates` contém `due_date` E/OU `scheduled_start_time` (mudança de agenda)
     - User NÃO é `created_by`
     - User NÃO tem role `owner`
     - A task NÃO tem `project_id`, OU tem mas o user NÃO possui `change_dates` nesse projeto (checar via `has_project_permission`)
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

5.5. **⛔ REGRA DE OURO — mudou data/horário? ajuste a EXECUÇÃO também** (ver
   `data/tasks-schedule-blocks-field-reference.md` §4). Se `updates` mexeu em
   `due_date` E/OU `scheduled_start_time`:
   - **Antes do UPDATE**, ler os blocos da tarefa:
     ```sql
     SELECT id, scheduled_start, is_completed FROM task_schedule_blocks
      WHERE task_id = {task_id} ORDER BY block_order;
     ```
   - **Se a tarefa NÃO tem blocos** → nada a fazer, a tarefa é o item da agenda.
   - **Se tem blocos pendentes** → NÃO confie no trigger (ele só cobre "só due_date,
     delta de dias"). Calcule o delta exato e mova os blocos no MESMO fluxo:
     ```sql
     UPDATE task_schedule_blocks
        SET scheduled_start = scheduled_start + ({novo_inicio}::timestamptz - {antigo_inicio}::timestamptz),
            updated_at = now()
      WHERE task_id = {task_id} AND COALESCE(is_completed,false) = false;
     ```
     (delta = do `scheduled_start_time` se mexido; senão do `due_date`.)
   - **VERIFICAR**: re-ler tarefa + blocos e confirmar que batem antes de reportar DONE.
   - **Ambíguo? PERGUNTE ao responsável** (NÃO adivinhe): 2+ blocos sem deslocamento
     uniforme (ex: só mudou o horário do dia), blocos `is_completed`, ou colisão com
     reunião (`can_be_split=false`) → **ESCALATE** ao chief com
     `redirect_to: request-task-date-change` / sugestão de auto-scheduling, explicando
     que a redistribuição precisa de decisão do creator/owner.
6. **Validar enums no UPDATE:**
   - `status` ∈ `('todo','doing','done','cancelled')` — `cancelled` é valor legítimo (ex: pedido "anular"/"annullare a tarefa"), não tratar como erro.
   - `block_type` ∈ `('task','meeting','focus_time','personal','unavailable')`
   - `priority`/`urgency` ∈ 1..10
   - Inválido → ESCALATE com lista de valores válidos
   - **Nunca incluir `tags`** — coluna inexistente; se vier no request, ESCALATE (ver aviso no topo do arquivo).
7. **Tratar erros:**
   - 42501 (RLS) → BLOCKED
   - 23514 (CHECK) → BLOCKED indicando campo violado
   - 23503 (FK violation, ex: project_id inexistente) → BLOCKED
   - 5xx → retry 1x → ESCALATE
8. **Activity log** — INSERT em `activity_logs` com `action='platform-specialist.update_task'`, details com diff before/after.
9. **Retornar ao chief.**

### acceptance_criteria

- **[A1] Authorization pre-check executed:** decisão entre UPDATE direto vs REQUEST_CREATED é loggada explícita no handoff card, incluindo qual caminho decidiu (creator/owner/permission/project-less).
- **[A2] Owner bypass:** user com role `owner` pula workflow F-08.3 (UPDATE direto sempre).
- **[A3] Creator bypass:** user que é `created_by` da task pula workflow F-08.3.
- **[A3b] Permission bypass:** se a task tem `project_id` e o user possui a `task_project_members.permission` relevante (`change_dates` para due_date/scheduled_start_time, `change_status` para status, `change_priority` para priority/urgency, `edit_tasks` para os demais campos) via `has_project_permission`, o UPDATE é direto — sem passar por F-08.3 mesmo não sendo creator/owner.
- **[A4] Request shape correto:** se REQUEST_CREATED, INSERT contém os 7 campos obrigatórios (task_id, requested_by, approver_id, current_due_date, suggested_due_date, reason opcional, status='pending').
- **[A5] Audit trail em UPDATE direto:** se due_date mudou, `task_date_changes` ganha row.
- **[A6] Enum validation:** status (incluindo `cancelled`)/block_type/priority/urgency rejeitam valores fora do schema; `tags` nunca é aceito (coluna inexistente).
- **[A7] Echo claro ao user:** quando REQUEST_CREATED, mensagem explica POR QUE foi request (não acesso direto) + QUEM aprova + COMO acelerar (peça ao owner, ou peça a permissão `change_dates` no projeto).
- **[A8] No silent UPDATE:** specialist NUNCA atualiza due_date sem checar autorização primeiro.
- **[A9] Tarefa e execução andam juntas:** se `due_date`/`scheduled_start_time` mudou e a tarefa tem blocos, os `task_schedule_blocks` pendentes foram deslocados pelo mesmo delta NO MESMO fluxo (não delegado ao trigger) e o resultado foi RE-LIDO e confere. Mudar a tarefa sem a execução = FALHA.
- **[A10] Ambíguo → pergunta, não adivinha:** redistribuição não-uniforme (2+ blocos, blocos concluídos, colisão com reunião) NUNCA é inventada — vira REQUEST/ESCALATE ao responsável (creator/owner).

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
2. Validate status: 'in_progress' NÃO está em ('todo','doing','done','cancelled')
3. Return BLOCKED: "Status 'in_progress' não existe. Valores válidos: todo, doing, done, cancelled. Você quis dizer 'doing'?"

### Exemplo 4 — Membro do projeto com permissão muda due_date direto (DONE)

**Input:** user role=comercial, NÃO é creator nem owner, pede "muda o prazo da task 'Fechar contrato X' para amanhã" — a task tem `project_id` de um projeto onde esse user tem `change_dates` em `task_project_members.permissions`

**Specialist:**
1. Resolve task → tem `project_id`, `created_by` != user, role != owner
2. `has_project_permission(user_id, project_id, 'change_dates')` → true
3. Authorization: bypassa F-08.3 (permission bypass, não creator/owner)
4. UPDATE direto + INSERT `task_date_changes` audit
5. Return DONE, `convention_check` loga explicitamente "autorizado via task_project_members.change_dates"

---

## Notas

- **F-08.3 source:** PRD `docs/prd-v2/modules/08-tasks.md` seção F-08.3.
- **owner bypass justificativa:** PRD FR2 hierarquia `owner > admin = financeiro > comercial = cs = marketing`. Owner é top.
- **Autorização real é por PERMISSION, não por papel informal:** o schema não tem conceito de "PM" — a segunda camada de autorização (além de creator/owner) é `task_project_members.permissions` (enum `task_project_permission[]`), checável via a RPC real `has_project_permission(p_user_id, p_project_id, p_permission)` (que já embute o bypass de owner/creator do projeto). Só se aplica quando a task tem `project_id`.
- **assigned_to interpretation:** PRD não é claro se assignee pode mudar prazo direto ou também precisa de request. Conservador: APENAS creator + owner + permission bypass (quando aplicável). Assignee sem nenhuma dessas três passa pelo workflow F-08.3 (defensivo). Se Pablo decidir flexibilizar, ajustar action_items[3].
- **`tags` não existe** em `tasks` — nunca incluir em `updates` nem no UPDATE.
- **Notifications side-effect:** quando REQUEST_CREATED, campos `message_id` e `dm_channel_id` da row podem ser populados por integration-specialist via WhatsApp/email pra notificar o approver. Sprint futuro.

---

**Mantido por:** platform-specialist
