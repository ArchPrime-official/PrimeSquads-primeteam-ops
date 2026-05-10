# Task: request-task-date-change

> Task atômica para criar uma row em `task_date_change_requests` quando user **não autorizado** quer mudar `due_date` de uma task. Implementa o **workflow F-08.3** do PRD (`docs/prd-v2/modules/08-tasks.md`). Output: REQUEST_CREATED com approver_id apontando para o creator.

**Cumpre:** HO-TP-001 (Task Anatomy — 8 campos)

---

## Task anatomy

### task_name
`Request Task Date Change`

### status
`pending` *(da task anatomy)*

### responsible_executor
`platform-specialist`

### execution_type
`Agent` — execução LLM + Supabase. **Confirmation step OBRIGATÓRIO** (user confirma antes de criar request).

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload:**
  - `task_id` (uuid, obrigatório — OU resolver por title se único match)
  - `suggested_due_date` (ISO 8601 UTC, obrigatório)
  - `reason` (string, opcional mas RECOMENDADO — quem aprova vai ler isto)

### output

- **`request_id`** — uuid da row criada em `task_date_change_requests`
- **`task_id`** — task afetada (não modificada ainda)
- **`approver_id`** — uuid do creator da task (quem precisa aprovar)
- **`approver_name`** — nome do approver (resolved via profiles)
- **`current_due_date`** + **`suggested_due_date`** (ambos UTC + Europe/Rome)
- **`verdict`** — `REQUEST_CREATED` | `BLOCKED` | `ESCALATE`
- **`convention_check`** — RLS ✓ / approver_resolved ✓ / audit_logged ✓

### action_items

1. **Resolver task_id** — SELECT por id ou title (ILIKE). 0 ou >1 match → ESCALATE.
2. **Buscar contexto da task:**
   ```sql
   SELECT t.id, t.title, t.created_by, t.assigned_to, t.due_date,
          p_creator.full_name AS creator_name
   FROM tasks t
   LEFT JOIN profiles p_creator ON p_creator.id = t.created_by
   WHERE t.id = {task_id};
   ```
3. **PRE-CHECK — esta task SÓ deve rodar quando user NÃO é autorizado:**
   - SE user.id = task.created_by → ESCALATE com `redirect_to: update-task` (creator pode mudar direto)
   - SE user role = 'owner' → ESCALATE com `redirect_to: update-task` (owner bypassa)
   - **CASO CONTRÁRIO** (não-creator, não-owner) → continuar
4. **Validar suggested_due_date:**
   - Não pode ser igual ao current due_date (sem-op)
   - Deve ser data futura (> NOW())
   - Inválido → ESCALATE com correção
5. **Confirmation message** apresentada via chief:
   ```
   Você quer adiar/antecipar a tarefa «{title}»:
     De:    {current.due_date} (Europe/Rome)
     Para:  {suggested.due_date} (Europe/Rome)
     Razão: {reason or "(não informada)"}

   Esta tarefa foi criada por {creator_name}. Como você não é o criador
   nem owner, sua mudança vai como **request** — {creator_name} precisa
   aprovar.

   Confirma envio do pedido?
   ```
6. **Aguardar "sim"** — se "não", ESCALATE com `cancelled_by_user`.
7. **Verificar duplicata** — evitar spam de requests:
   ```sql
   SELECT id FROM task_date_change_requests
   WHERE task_id = {task_id}
     AND requested_by = auth.uid()
     AND status = 'pending'
   LIMIT 1;
   ```
   Se já existe pending request do mesmo user pra mesma task → ESCALATE com `duplicate_pending_request` + request_id existente. User pode cancelar antiga primeiro.
8. **INSERT request:**
   ```sql
   INSERT INTO task_date_change_requests
     (task_id, requested_by, approver_id,
      current_due_date, suggested_due_date, reason, status)
   VALUES
     ({task_id}, auth.uid(), {task.created_by},
      {task.due_date}, {suggested_due_date}, {reason}, 'pending')
   RETURNING id, created_at;
   ```
9. **Tratar erros:**
   - 42501 (RLS) → BLOCKED
   - 23502 (NOT NULL: approver_id, current_due_date, suggested_due_date) → BLOCKED indicando campo
   - 23503 (FK: task_id) → BLOCKED, task não existe
   - 5xx → retry 1x → ESCALATE
10. **Activity log** — INSERT em `activity_logs`:
    - `action='platform-specialist.request_task_date_change'`
    - `resource_type='task_date_change_request'`
    - `resource_id={request_id}`
    - `details={task_id, current, suggested, reason, approver_id}`
11. **Retornar ao chief com echo claro pro user:**
    ```
    Pedido enviado ✓
    Request ID: {request_id}
    Aguardando aprovação de: {approver_name}

    Para acelerar:
    - Peça ao {approver_name} para aprovar manualmente
    - Ou peça ao owner do projeto para forçar override (use update-task com role owner)
    ```

### acceptance_criteria

- **[A1] Pre-check enforce:** task NUNCA roda se user é creator ou owner — redireciona para `update-task` (UPDATE direto autorizado).
- **[A2] Confirmation OBRIGATÓRIO:** user vê dates antes/depois + nome do approver + reason antes de qualquer INSERT.
- **[A3] Approver = creator:** sempre `task.created_by`. PRD F-08.3 não suporta delegação de aprovação.
- **[A4] Status default 'pending':** schema default. Não setar manualmente para evitar valores inválidos.
- **[A5] Audit trail:** activity_logs tem entry com action `request_task_date_change` + cycle_id + details.
- **[A6] Duplicate detection:** se já existe pending request do mesmo user pra mesma task, ESCALATE em vez de criar duplicata.
- **[A7] Idempotency note:** task NÃO é idempotente (cada execução cria nova request se passar duplicate check), mas detecta + previne duplicação acidental.
- **[A8] Echo educacional:** echo final explica POR QUE foi request + QUEM aprova + COMO acelerar (peça ao owner). User não fica perdido.

---

## Exemplos

### Exemplo 1 — Happy path (REQUEST_CREATED)

**Input:** user role=marketing pede "adia tarefa 'Email blast' (criada por Sandra) para 2026-05-15, motivo: aguardando criativo final"

**Specialist:**
1. Resolve task → created_by=Sandra (uuid X), current.due_date=2026-05-12
2. Pre-check: user.id != Sandra, role marketing != owner → continuar
3. Validate: 2026-05-15 > NOW() ✓ + != 2026-05-12 ✓
4. Confirmation:
   ```
   Você quer adiar a tarefa «Email blast»:
     De:    2026-05-12 (Europe/Rome)
     Para:  2026-05-15 (Europe/Rome)
     Razão: aguardando criativo final

   Criada por Sandra. Você não é o criador nem owner — vai como request.
   Confirma envio?
   ```
5. User: "sim"
6. Duplicate check: zero pendings → OK
7. INSERT → request_id `9c4a-...`
8. Activity log INSERT
9. Return:
   ```
   Pedido enviado ✓
   Request ID: 9c4a-...
   Aguardando aprovação de: Sandra Carvalho

   Para acelerar:
   - Peça à Sandra para aprovar manualmente
   - Ou peça ao Pablo (owner) para forçar override
   ```

### Exemplo 2 — User É creator (ESCALATE redirect)

**Input:** user.id == task.created_by

**Specialist:** Pre-check detecta → ESCALATE com `redirect_to: update-task`. Chief reroteia para `update-task` que faz UPDATE direto + audit em `task_date_changes`.

### Exemplo 3 — Duplicate pending (ESCALATE)

**Input:** mesmo user pediu mudança da mesma task ontem, ainda pending

**Specialist:** SELECT acha pending request_id `7b1f-...` → ESCALATE:
```
Você já tem um pedido pendente para esta tarefa (request_id 7b1f-...
criado em 2026-05-09). Cancele o antigo antes de criar um novo, ou
contate o approver para acelerar.
```

---

## Notas

- **F-08.3 source:** PRD `docs/prd-v2/modules/08-tasks.md` seção F-08.3.
- **Notification side-effect (Sprint futuro):** integration-specialist pode popular `message_id` + `dm_channel_id` da row para notificar o approver via WhatsApp/email. Não bloqueia esta task — defaults NULL.
- **Cancelamento de request:** task separada (`cancel-task-date-change`, Sprint futuro). Por ora, user pode falar direto com approver.
- **Approver bypass NÃO existe:** se approver não responde, owner pode usar `update-task` direto (o que cria audit em `task_date_changes` mas NÃO atualiza a request — request fica pending eternamente. Isto é débito conhecido; PRD futuro pode adicionar `status='superseded_by_owner'`).

---

**Mantido por:** platform-specialist
