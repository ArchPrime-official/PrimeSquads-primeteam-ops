# Task: revoke-role

> DELETE row em user_roles (rebaixa user). Owner-only via admin-specialist. Last-owner protection.

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name `Revoke Role`

### responsible_executor `admin-specialist` (owner-only gate)

### execution_type `Agent` — DUPLA confirmation com impact preview.

### input
- `user_id` (uuid OR `email`)
- `role` (`'owner' | 'admin' | 'financeiro' | 'comercial' | 'cs' | 'marketing'`)
- `reason` (string OBRIGATÓRIO)

### output
- `user_id`, `role_revoked`
- `remaining_roles` (array — roles que user ainda tem)
- `verdict`: `DONE | BLOCKED | ESCALATE`

### action_items

1. **Owner-only gate** (admin-specialist primary).
2. Resolver user + current roles.
3. **Last-owner protection:** se role='owner' AND user é único owner do sistema → BLOCKED:
   ```
   Não posso remover último owner (lock-out total). Min 1 owner mandatory.
   Promova outro user para owner antes via admin-specialist.grant_role.
   ```
4. **User não tem este role:** ESCALATE com `role_not_present`.
5. **Self-revoke owner:** owner removendo próprio role owner → confirmation tripla "REMOVE OWN OWNER" uppercase.
6. **Capabilities lost preview:**
   ```
   Revoke role «{role}» do user {name}:

   Capabilities que serão PERDIDAS:
     {list_per_role}

   Roles restantes: {remaining}
   {if no_roles_left ? 'User ficará SEM roles (read-only basic).' : ''}

   Reason: {reason}

   Confirma? (digite "confirma")
   ```
7. **DELETE atomic:**
   ```sql
   DELETE FROM user_roles
   WHERE user_id={user_id} AND role={role};
   ```
8. Activity log STRICT: action='admin-specialist.revoke_role', details com user_id + role + reason + remaining_roles. Falha audit = ABORT.
9. **Quality-guardian flag** mandatory (admin op sensível).
10. Echo:
    ```
    ✓ Role «{role}» removida de {name}
    Roles restantes: {list}
    {warning_if_no_roles}
    Recomende user fazer logout/login (token cached).
    Activity logged.
    ```

### acceptance_criteria
- A1 Owner-only gate
- A2 Last owner protection (min 1)
- A3 Reason obrigatório
- A4 Capabilities preview antes de confirmar
- A5 Self-revoke owner: tripla "REMOVE OWN OWNER"
- A6 Audit STRICT
- A7 Quality-guardian flag
- A8 Logout reminder

---

**Mantido por:** admin-specialist
