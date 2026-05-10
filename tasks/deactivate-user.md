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
- `user_id`, `deactivated_at`
- `revoked_roles` (array)
- `cascaded_count` (se cascade)
- `verdict`: `DONE | BLOCKED | ESCALATE`

### action_items

1. **Owner-only gate** (admin-specialist primary).
2. Resolver user + roles + assignments count:
   ```sql
   SELECT
     (SELECT COUNT(*) FROM leads WHERE owner_id={user_id} AND status NOT IN ('converted','rejected')) AS active_leads,
     (SELECT COUNT(*) FROM opportunities WHERE owner_id={user_id} AND status NOT IN ('won','lost')) AS active_opps,
     (SELECT COUNT(*) FROM tasks WHERE assigned_to={user_id} AND status='todo') AS active_tasks;
   ```
3. **Last-owner protection:** se user é único owner → BLOCKED.
4. **Self-deactivate:** se user.id=auth.uid() → BLOCKED com mensagem (peça outro owner).
5. **Cascade required check:** se cascade=true MUST passa reassign_to_user_id (active member).
6. **Confirmation com impact:**
   ```
   Deactivate user {name} ({email}):

   Roles a remover: {list}
   Assignments ativos:
     - Leads: {N} (status open)
     - Opportunities: {M}
     - Tasks: {P}

   {cascade ?
     'Reassign para: ' + reassign_name :
     '⚠️ Assignments ativos NÃO serão reatribuídos. Permanecem com user inativo (visíveis em UI mas user não pode mais agir).'}

   Reason: {reason}

   ⚠️ User NÃO conseguirá mais login.
   Reversível via reactivate-user (separate task).

   Confirma? (digite "DEACTIVATE USER" uppercase)
   ```
7. **Atomic operations:**
   ```sql
   BEGIN;
   UPDATE profiles SET is_active=false, deactivated_at=NOW(), deactivated_by=auth.uid(),
     deactivation_reason={reason}
   WHERE id={user_id};

   DELETE FROM user_roles WHERE user_id={user_id};

   IF {cascade}:
     UPDATE leads SET owner_id={reassign_to} WHERE owner_id={user_id} AND status NOT IN ('converted','rejected');
     UPDATE opportunities SET owner_id={reassign_to} WHERE owner_id={user_id} AND status NOT IN ('won','lost');
     UPDATE tasks SET assigned_to={reassign_to} WHERE assigned_to={user_id} AND status='todo';
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
- A5 Tripla "DEACTIVATE USER"
- A6 Cascade reassign opt-in
- A7 Audit STRICT
- A8 Reversible (reactivate-user task)
- A9 Data preservation (DELETE de auth.users NUNCA — só profile flag + role removal)

---

**Mantido por:** admin-specialist
