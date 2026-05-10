# Task: deactivate-automation-flow

> Pausar flow ativo (`'active' → 'paused'`). Não deleta — preserva queue de execuções pending. Implementa F-10.1.

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name
`Deactivate Automation Flow`

### responsible_executor
`automation-specialist`

### execution_type
`Agent` — confirmation simples (operação reversível).

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload:**
  - `flow_id` (uuid)
  - `version` (int — optimistic lock)
  - `cancel_pending` (bool, default false — se true, cancela executions pending na queue)
  - `reason` (string opcional)

### output

- **`flow_id`**, **`new_status`** (`'paused'`)
- **`pending_executions_cancelled`** (int)
- **`verdict`** — `DONE | BLOCKED | ESCALATE`

### action_items

1. **Role check:** creator OR owner (mesma authority de activate).
2. **Validar status atual** = `'active'`. Outros → ESCALATE.
3. **Count pending executions:**
   ```sql
   SELECT COUNT(*) FROM automation_executions
   WHERE flow_id={flow_id} AND status='pending';
   ```
4. **Confirmation:**
   ```
   Vou pausar flow «{name}»:
     Status: active → paused
     Pending executions na queue: {N}
     {cancel_pending ?
       '⚠️ As ' + N + ' execuções pending serão CANCELADAS.' :
       'Pending continuam na queue (executam após reativar).'}
     {reason ? 'Razão: ' + reason : ''}
   Confirma?
   ```
5. **UPDATE atomic + cancel optional:**
   ```sql
   BEGIN;
   UPDATE automation_flows
   SET status='paused', paused_at=NOW(), paused_by=auth.uid(),
       pause_reason=COALESCE({reason}, pause_reason)
   WHERE id={flow_id} AND version={expected_version};

   IF {cancel_pending}:
     UPDATE automation_executions
     SET status='cancelled', cancelled_at=NOW(), cancellation_reason='flow_paused'
     WHERE flow_id={flow_id} AND status='pending';
   END IF;
   COMMIT;
   ```
6. **Side-effect:** edge `automation-trigger` para de disparar para este flow_id (cache invalidation automatic via trigger).
7. **Activity log:** action='automation-specialist.deactivate_automation_flow', details com cancel_count + reason.
8. **Echo:**
   ```
   ✓ Flow pausado
   Status: active → paused
   {cancelled > 0 ? cancelled + ' execuções pending canceladas.' : 'Pending executions preservadas.'}

   Para reativar: activate-automation-flow.
   Para deletar permanente: delete-automation-flow (Tier 3, owner-only).
   ```

### acceptance_criteria

- **[A1] Authority creator/owner.**
- **[A2] Status check active → paused.**
- **[A3] Cancel pending opt-in:** flag explícita.
- **[A4] Atomic UPDATE flow + executions.**
- **[A5] Audit:** paused_at, paused_by, reason.
- **[A6] Reversibilidade:** pause não deleta — reativável.

---

## Exemplos

### Exemplo 1 — Sandra pausa flow para edição

**Input:** flow_id, cancel_pending=false, reason='Edit nodes'

**Specialist:** confirmation → UPDATE → echo "Pausado, 12 pending preservadas".

### Exemplo 2 — Pausa com cancel

**Input:** cancel_pending=true (descobriu bug crítico)

**Specialist:** UPDATE + cancel 12 pending → echo "Pausado + 12 pending canceladas. Investigar bug antes de reativar."

---

## Notas

- **`automation-trigger` edge:** lê status do flow em cada disparo. status != 'active' = skip.
- **Pending executions:** preservadas em DB (status='pending'). Reativar flow = continuam de onde estavam.
- **Cancel rationale:** se flow está com bug, melhor cancelar pending para evitar side-effects danosos.

---

**Mantido por:** automation-specialist
