# Task: delete-task

> Delete task (single ou bulk). Hard delete row em `tasks`. Implementa F-08.1.

**Cumpre:** HO-TP-001

> ⚠️ **Autoridade real (verificado em `types.ts` + migrations, 2026-07-03):** não existe
> conceito de "PM" no schema. A segunda camada de autoridade (além de creator/owner) é
> `task_project_members.permissions` — especificamente `delete_tasks` ou `manage_project`,
> checável via a RPC real `has_project_permission(p_user_id, p_project_id, p_permission)`.
> Ver `data/required-fields-registry.yaml` (entry `delete-task`).
>
> ⛔ **Este é um HARD DELETE.** Antes de confirmar, sempre ofereça a alternativa reversível:
> `UPDATE tasks SET status='cancelled'` (via `update-task`) preserva a linha, o histórico
> (`task_completion_history`, `task_date_changes`) e pode ser revertido depois. Hard delete
> só quando o usuário confirmar explicitamente que quer apagar de vez.

---

## Task anatomy

### task_name
`Delete Task`

### responsible_executor
`platform-specialist`

### execution_type
`Agent` — DUPLA confirmation (destrutivo).

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload:**
  - `task_ids` (array uuid, max 50)
  - `reason` (string opcional para batch >5)
  - `soft` (bool default false) — se `true`, delega para `update-task` com `status='cancelled'` em vez de DELETE físico (alternativa reversível, ver aviso acima)

### output

- **`deleted_count`**, **`deleted_ids`**, **`skipped`** (com causa)
- **`verified_count`** — quantos dos `deleted_ids` foram RE-CONFIRMADOS como ausentes numa query pós-ação (ver action_items §7)
- **`verdict`** — `DONE | PARTIAL | BLOCKED`

### action_items

1. **Authority check** (per-task):
   - User pode deletar task SE: `user.id = task.created_by` OR `user.role='owner'` OR
     (a task tem `project_id` E o user tem a permission `delete_tasks` OU `manage_project`
     nesse projeto — checar via `has_project_permission(user_id, project_id, 'delete_tasks')`
     OU `has_project_permission(user_id, project_id, 'manage_project')`).
   - Outros → BLOCKED com mensagem explicando a authority real (creator, owner, ou a
     permission específica faltando — nunca mencionar "PM", esse conceito não existe no schema).
2. **Resolver tasks:**
   ```sql
   SELECT id, title, created_by, project_id, status, due_date
   FROM tasks WHERE id = ANY({task_ids});
   ```
3. **Filtrar authorized vs unauthorized:**
   - SELECT só as que user pode tocar (RLS/authority, incluindo o permission-check acima)
   - Surface skipped count com o motivo (não-creator + não-owner + sem `delete_tasks`/`manage_project` no projeto)
4. **Reason** obrigatório se batch >5.
5. **Oferecer alternativa soft** — se `soft` não veio explícito no request, perguntar/lembrar
   na confirmação que `status='cancelled'` (via `update-task`) é reversível e preserva
   histórico; hard delete não é.
6. **Confirmation:**
   ```
   Delete tasks: {authorized_count} (de {total} solicitados)
     Skip: {unauthorized_count} (não criadas por você + não-owner + sem permissão delete_tasks/manage_project no projeto)

     Sample (10): [title, status, due_date]

     ⚠️ HARD DELETE — remove a linha de `tasks` e, em CASCADE:
       - todos os `task_schedule_blocks` da tarefa (a agenda de execução some)
       - `task_date_change_requests` pendentes vinculados (F-08.3)
     O trigger `enqueue_calendar_sync` dispara AFTER DELETE e enfileira a remoção do(s)
     evento(s) correspondentes no Google Calendar (via `gcal-outbound-worker`) — não fica
     órfão lá, mas é assíncrono (pode levar alguns segundos).
     Alternativa reversível: `status='cancelled'` (preserva histórico). Quer isso em vez de hard delete? (sim/não)

     Reason: {reason or '(sem reason)'}

   Confirma o HARD DELETE? {batch_count > 5 ? '(digite "CONFIRMO DELETE TASKS" uppercase)' : '(sim)'}
   ```
7. **Atomic batch:**
   ```sql
   DELETE FROM tasks WHERE id = ANY({authorized_ids}) RETURNING id;
   ```
8. **⛔ Verificação PÓS-AÇÃO (obrigatória, smoke test da própria mutation):** re-consultar
   para confirmar que as linhas realmente sumiram antes de reportar DONE — não confiar só no
   `RETURNING` do passo 7 (RLS pode ter silenciosamente devolvido menos linhas que o esperado):
   ```sql
   SELECT id FROM tasks WHERE id = ANY({authorized_ids});
   ```
   - 0 linhas retornadas → confirma que todas as `authorized_ids` foram de fato deletadas. `verified_count = authorized_count`.
   - Alguma linha ainda aparece → **não reportar DONE** para essas — mover para `skipped` com causa `"delete_silently_failed"` e reportar `PARTIAL`, nunca inflar `deleted_count` além do que foi verificado.
9. **Activity log:** action='platform-specialist.delete_task', details com count + reason + `verified_count`.
10. **Echo:** "✓ {N} tasks deletadas (verificado). {skipped > 0 ? skipped + ' não-autorizadas ou falharam a verificação.' : ''}"

### acceptance_criteria

- **[A1] Authority real:** creator (`created_by`) OU role `owner` OU `task_project_members.permissions` contendo `delete_tasks`/`manage_project` no projeto da task — nunca um conceito de "PM" inventado.
- **[A2] Filter authorized antes de confirmar.**
- **[A3] Tripla confirmation se batch >5.**
- **[A4] Audit count + reason + verified_count.**
- **[A5] No silent failure** — surface skipped, incluindo falhas de verificação pós-ação.
- **[A6] Verificação pós-ação obrigatória:** o verdict DONE/PARTIAL só é reportado depois de re-consultar `tasks` e confirmar que os ids realmente sumiram — nunca confiar cegamente no `RETURNING` do DELETE.
- **[A7] Alternativa soft sempre oferecida:** a confirmação sempre lembra que `status='cancelled'` é reversível antes de pedir a confirmação do hard delete.
- **[A8] Efeitos em cascata explicados:** a mensagem de confirmação lista o que é apagado junto (`task_schedule_blocks`, `task_date_change_requests`) e o que acontece com o Google Calendar (remoção assíncrona via trigger, não fica órfão).

---

## Exemplos

### Exemplo 1 — Comercial deleta 3 próprias tasks

**Input:** 3 ids (todas dele)

**Specialist:** all authorized (creator) → confirmation com aviso de cascade + alternativa soft → user confirma hard delete → DELETE → verificação pós-ação (0 linhas remanescentes) → DONE, `verified_count=3`.

### Exemplo 2 — Tenta deletar tasks de outros, sem permission no projeto

**Input:** 5 ids, 2 são de Sandra (task sem project_id, user não é owner)

**Specialist:** filter → 3 authorized (creator) + 2 skipped (não-creator, não-owner, task sem projeto então sem permission a checar) → confirmation com warning → DELETE 3 → verificação → DONE parcial, `deleted_count=3`, `skipped=2`.

### Exemplo 3 — Membro do projeto com `manage_project` deleta task de outro colega

**Input:** 1 id, task pertence a um projeto onde o requisitante tem `manage_project` em `task_project_members.permissions`, mas não é `created_by` nem `owner`

**Specialist:** `has_project_permission(user_id, project_id, 'manage_project')` → true → authorized → confirmation → DELETE → verificação → DONE.

### Exemplo 4 — Usuário pede para "apagar" mas quer preservar histórico

**Input:** `"apaga a tarefa X"`, sem `soft` explícito

**Specialist:** na confirmação, pergunta explicitamente se prefere `status='cancelled'` (reversível) em vez de hard delete. Se o usuário confirmar a alternativa, delega para `update-task` (`status='cancelled'`) em vez de prosseguir com o DELETE.

---

**Mantido por:** platform-specialist
