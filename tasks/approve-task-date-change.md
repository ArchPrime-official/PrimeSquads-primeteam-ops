# Task: approve-task-date-change

> Task atômica para **aprovar ou rejeitar** uma `task_date_change_requests` pendente. Executável apenas pelo `approver_id` (creator da task) ou pelo `owner`. Aprovação dispara: UPDATE da task + INSERT audit em `task_date_changes` + UPDATE da request (status='approved').

**Cumpre:** HO-TP-001 (Task Anatomy — 8 campos). Implementa workflow F-08.3 (PRD).

---

## Task anatomy

### task_name
`Approve Task Date Change`

### status
`pending`

### responsible_executor
`platform-specialist`

### execution_type
`Agent` — confirmation step OBRIGATÓRIO antes do UPDATE.

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload:**
  - `request_id` (uuid, obrigatório — OU resolver via task_id se único pending)
  - `decision` (`'approve' | 'reject'`, obrigatório)
  - `response_message` (string, opcional — explicação se reject)

### output

- **`request_id`**, **`task_id`**
- **`decision`** (echoed)
- **`old_due_date`** + **`new_due_date`** (se approve)
- **`task_date_change_id`** — uuid do audit row em `task_date_changes` (se approve)
- **`verdict`** — `APPROVED` | `REJECTED` | `BLOCKED` | `ESCALATE`
- **`convention_check`** — RLS ✓ / authorized ✓ / audit_logged ✓ / status_transition ✓

### action_items

1. **Resolver request_id** — SELECT por id ou (task_id + status='pending'). 0 ou >1 match → ESCALATE.
2. **Buscar contexto:**
   ```sql
   SELECT r.id, r.task_id, r.requested_by, r.approver_id,
          r.current_due_date, r.suggested_due_date, r.reason, r.status,
          t.title AS task_title, t.created_by AS task_created_by,
          p_req.full_name AS requester_name
   FROM task_date_change_requests r
   JOIN tasks t ON t.id = r.task_id
   LEFT JOIN profiles p_req ON p_req.id = r.requested_by
   WHERE r.id = {request_id};
   ```
3. **AUTHORIZATION CHECK** — user pode aprovar SE:
   - user.id = `request.approver_id` (creator original), OU
   - user.role = `'owner'` (override hierarchy top)

   Caso contrário → BLOCKED com explicação:
   ```
   Você não tem permissão para aprovar este pedido. Apenas {approver_name}
   (criador da tarefa) ou um owner pode aprovar/rejeitar. Você é {role}.
   ```
4. **Validar status atual:**
   - SE `request.status != 'pending'` → BLOCKED com:
     ```
     Este pedido já foi {status} (em {responded_at}). Não pode ser
     re-processado. Para nova mudança, abra novo request.
     ```
5. **Validar decision** — `decision` ∈ `('approve', 'reject')`. Outros valores → ESCALATE.
6. **Confirmation message:**
   ```
   Pedido de {requester_name}: «{task_title}»
     De:    {current_due_date}
     Para:  {suggested_due_date}
     Razão: {reason or "(não informada)"}

   Decisão: {APPROVE | REJECT}
   {response_message echoed se reject}

   Confirma?
   ```
7. **Aguardar "sim"** — se "não", ESCALATE com `cancelled_by_user`.

8. **Se APPROVE — executar 3 mutations sequenciais:**

   8a. **UPDATE task** (race-safe, com guarda):
   ```sql
   UPDATE tasks
   SET due_date = {request.suggested_due_date},
       updated_at = NOW()
   WHERE id = {request.task_id}
     AND due_date = {request.current_due_date}  -- guarda contra race
   RETURNING id, due_date AS new_due_date;
   ```
   - Se 0 rows updated → BLOCKED com `race_condition: task due_date already changed since request was created`. NÃO continuar para 8b/8c.

   8b. **INSERT audit em task_date_changes:**
   ```sql
   INSERT INTO task_date_changes
     (task_id, old_due_date, new_due_date, changed_by, reason)
   VALUES
     ({request.task_id}, {request.current_due_date},
      {request.suggested_due_date}, auth.uid(),
      {reason || 'approved request ' || request_id});
   RETURNING id;
   ```

   8c. **UPDATE request:**
   ```sql
   UPDATE task_date_change_requests
   SET status = 'approved',
       responded_by = auth.uid(),
       responded_at = NOW()
   WHERE id = {request_id};
   ```

9. **Se REJECT — só UPDATE request:**
   ```sql
   UPDATE task_date_change_requests
   SET status = 'rejected',
       responded_by = auth.uid(),
       responded_at = NOW()
   WHERE id = {request_id};
   ```
   Task NÃO é modificada. Audit `task_date_changes` NÃO recebe row.

10. **Tratar erros:**
    - 42501 (RLS denial em qualquer step) → BLOCKED
    - 23514 (CHECK status) → ESCALATE indicando valores válidos
    - Falha em 8b ou 8c após 8a OK → log warning de partial state e tentar reverter 8a (UPDATE de volta para old_due_date). Se reverter falhar → ESCALATE com `manual_cleanup_needed` + IDs.
    - 5xx → retry 1x → ESCALATE
11. **Activity log:**
    - `action='platform-specialist.approve_task_date_change'` ou `'reject_task_date_change'`
    - `resource_type='task_date_change_request'`
    - `resource_id={request_id}`
    - `details={task_id, decision, old_due, new_due, requester_id}`
12. **Echo ao user:**
    - APPROVE: `Pedido aprovado ✓ — task «{title}» agora vence em {new_due_date}. {requester_name} foi notificado.`
    - REJECT: `Pedido rejeitado. Task continua com due_date {current}. {requester_name} foi notificado{ + ': ' + response_message se houver}.`

### acceptance_criteria

- **[A1] Authorization enforced:** apenas `approver_id` (creator) ou `owner` podem rodar. Outros → BLOCKED com mensagem clara.
- **[A2] Idempotency via status check:** se request != 'pending', task abort sem mutations (não re-aprova nem re-rejeita).
- **[A3] Race-safe UPDATE:** WHERE clause em 8a inclui `due_date = current_due_date` para detectar mudança concorrente.
- **[A4] Atomic-ish 3-step approve:** se 8a OK mas 8b ou 8c falham, tentativa de reverter 8a + ESCALATE com cleanup info. Sem rollback automático silencioso.
- **[A5] Reject não toca task:** schema default — UPDATE só na request, audit `task_date_changes` SEM row.
- **[A6] Audit completo:** approve grava em `task_date_changes` com changed_by={approver}, reason explica o request_id de origem.
- **[A7] Notification stub:** echo menciona "{requester_name} foi notificado" mesmo se WhatsApp/email integration não estiver ativo (defensive — assume integration-specialist trata depois).
- **[A8] No silent override:** se task.due_date já mudou desde o request (race), task aborta com BLOCKED em vez de aplicar mudança stale.

---

## Exemplos

### Exemplo 1 — Approve happy path

**Input:** user é Sandra (creator), `request_id=9c4a-...`, `decision=approve`

**Specialist:**
1. Resolve request → status=pending, approver_id=Sandra ✓
2. Auth: user.id = approver_id ✓
3. Confirmation shown → "sim"
4. UPDATE tasks: 1 row affected ✓
5. INSERT task_date_changes → audit_id `aa11-...`
6. UPDATE request: status='approved', responded_by=Sandra
7. Activity log INSERT
8. Return:
   ```
   Pedido aprovado ✓
   Task «Email blast» agora vence em 2026-05-15.
   Marketing (requester) foi notificado.

   request_id: 9c4a-...
   task_date_change_id: aa11-...
   ```

### Exemplo 2 — Owner aprova request de outro creator

**Input:** user é Pablo (role=owner), request foi pra Sandra approver

**Specialist:** Auth OK via owner bypass. Resto idêntico ao exemplo 1.

### Exemplo 3 — User não autorizado (BLOCKED)

**Input:** user role=cs tenta aprovar request cujo approver_id é Sandra

**Specialist:** Auth check falha (cs.id != Sandra.id, role != owner) → BLOCKED:
```
Você não tem permissão para aprovar este pedido. Apenas Sandra Carvalho
(criadora da tarefa) ou um owner pode aprovar/rejeitar. Você é cs.
```

### Exemplo 4 — Reject com mensagem

**Input:** Sandra rejeita com response_message="ainda preciso disso na sexta original"

**Specialist:** UPDATE só na request. Echo:
```
Pedido rejeitado.
Task continua com due_date 2026-05-12.
Marketing (requester) foi notificado: "ainda preciso disso na sexta original".
```

### Exemplo 5 — Race condition (BLOCKED)

**Input:** Sandra aprovou request enquanto outro owner já mudou due_date direto via update-task

**Specialist:**
- 8a UPDATE com guarda WHERE due_date = {request.current} → 0 rows
- BLOCKED: `task due_date changed since request was created (was {req.current}, now {actual.current}). Cancele este request e abra novo se ainda quer modificar.`

---

## Notas

- **F-08.3 source:** PRD `docs/prd-v2/modules/08-tasks.md`.
- **Status enum:** `task_date_change_requests.status` ∈ `('pending', 'approved', 'rejected')`. Outros valores não suportados.
- **`response_message_id`/`responded_at`:** preenchidos automaticamente. `response_message` (string livre) NÃO é coluna direta — vai como campo derivado para integration-specialist (notificação) ou como reason em `task_date_changes`. PRD pode adicionar coluna no futuro; por ora, eco no echo final.
- **Cleanup de partial state:** se UPDATE task OK mas INSERT audit falha, task fica com new_due_date sem audit row. Isto é detectado por quality-guardian na próxima review e pode requerer manual fix (INSERT manual em task_date_changes ou rollback da task). Surface no handoff card.

---

**Mantido por:** platform-specialist
