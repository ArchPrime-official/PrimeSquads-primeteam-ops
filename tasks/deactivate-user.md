# Task: deactivate-user

> Mark profile.is_active=false + revoke ALL roles. Owner-only. Reversível via reactivate. Preserva data (FK em leads/opps/tasks/finance).

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name `Deactivate User`

### responsible_executor `admin-specialist` (owner-only)

### execution_type `Agent` — DUPLA confirmation com impact summary.

### input
- `user_id` (uuid OR `email`)
- `reason` (string OBRIGATÓRIO)
- `cascade_assignments` (bool default false — se true, reassigna leads/opps/tasks dele)
- `reassign_to_user_id` (uuid — required se cascade=true)

### output
- `user_id`, `updated_at` (timestamp real de `profiles.updated_at`; NÃO existe coluna `deactivated_at` — o "quando/quem/por quê" da desativação fica no activity log)
- `revoked_roles` (array)
- `cascaded_count` (se cascade)
- `verdict`: `DONE | BLOCKED | ESCALATE`

### action_items

1. **Owner-only gate** (admin-specialist primary).
2. Resolver user + roles + assignments count:
   > Colunas REAIS (types.ts): leads → `presales_user_id` (não existe `owner_id`); opportunities → `sales_user_id` / `presales_user_id` + `stage` (não existe `owner_id`/`status`; stages terminais = `SALE_DONE`, `LOST`); tasks → `owner_id` (scalar) + `assigned_to` (uuid[] ARRAY) + `status` (terminais = `done`, `cancelled`).
   ```sql
   SELECT
     (SELECT COUNT(*) FROM leads
        WHERE presales_user_id={user_id} AND opted_out=false) AS active_leads,
     (SELECT COUNT(*) FROM opportunities
        WHERE (sales_user_id={user_id} OR presales_user_id={user_id})
          AND stage NOT IN ('SALE_DONE','LOST')) AS active_opps,
     (SELECT COUNT(*) FROM tasks
        WHERE (owner_id={user_id} OR {user_id} = ANY(assigned_to))
          AND status NOT IN ('done','cancelled')) AS active_tasks;
   ```
3. **Last-owner protection:** se user é único owner → BLOCKED.
4. **Self-deactivate:** se user.id=auth.uid() → BLOCKED com mensagem (peça outro owner).
5. **Cascade required check:** se cascade=true MUST passa reassign_to_user_id (active member).
6. **Confirmation com impact:**
   ```
   Deactivate user {name} ({email}):

   Roles a remover: {list}
   Assignments ativos:
     - Leads: {N} (presales_user_id, não opted_out)
     - Opportunities: {M} (sales/presales, stage aberto)
     - Tasks: {P} (owner_id ou assigned_to, não done/cancelled)

   {cascade ?
     'Reassign para: ' + reassign_name :
     '⚠️ Assignments ativos NÃO serão reatribuídos. Permanecem com user inativo (visíveis em UI mas user não pode mais agir).'}

   Reason: {reason}

   ⚠️ User NÃO conseguirá mais login.
   Reversível via reactivate-user (separate task).

   Confirma? (digite "CONFIRMO DEACTIVATE USER" uppercase)
   ```
7. **Atomic operations:**
   > `profiles` só tem a coluna `is_active` (NÃO existe `deactivated_at`/`deactivated_by`/`deactivation_reason`) — o motivo/autor/quando ficam SÓ no activity log (passo 8). Reassignment usa as colunas reais confirmadas no passo 2.
   ```sql
   BEGIN;
   UPDATE profiles SET is_active=false, updated_at=NOW()
   WHERE id={user_id};

   DELETE FROM user_roles WHERE user_id={user_id};

   IF {cascade}:
     -- leads: dono de pré-venda é presales_user_id (não há owner_id)
     UPDATE leads SET presales_user_id={reassign_to}
       WHERE presales_user_id={user_id} AND opted_out=false;

     -- opportunities: reassigna papel de venda E de pré-venda; abertas = stage fora dos terminais
     UPDATE opportunities SET sales_user_id={reassign_to}
       WHERE sales_user_id={user_id} AND stage NOT IN ('SALE_DONE','LOST');
     UPDATE opportunities SET presales_user_id={reassign_to}
       WHERE presales_user_id={user_id} AND stage NOT IN ('SALE_DONE','LOST');

     -- tasks: owner_id é scalar; assigned_to é uuid[] (troca o elemento no array)
     UPDATE tasks SET owner_id={reassign_to}
       WHERE owner_id={user_id} AND status NOT IN ('done','cancelled');
     UPDATE tasks SET assigned_to=array_replace(assigned_to, {user_id}, {reassign_to})
       WHERE {user_id} = ANY(assigned_to) AND status NOT IN ('done','cancelled');
   END IF;
   COMMIT;
   ```
8. Activity log STRICT.
9. Quality-guardian flag.
10. Echo:
    ```
    ✓ User desativado
    {N} roles revogadas
    {cascade ? cascaded.length + ' assignments reassigned para ' + reassign_name : 'Assignments preservados (read-only state)'}
    Reversível via reactivate-user.
    ```

### acceptance_criteria
- A1 Owner-only
- A2 Last owner protection
- A3 No self-deactivate
- A4 Reason obrigatório
- A5 Tripla "CONFIRMO DEACTIVATE USER"
- A6 Cascade reassign opt-in
- A7 Audit STRICT
- A8 Reversible (reactivate-user task)
- A9 Data preservation (DELETE de auth.users NUNCA — só profile flag + role removal)

---

**Mantido por:** admin-specialist
