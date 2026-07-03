# Task: manage-task-projects

> CRUD `task_projects` + `task_project_members`. Setup ocasional de novos projetos team. F-08.2.

**Cumpre:** HO-TP-001

> ⚠️ **SCHEMA REAL (verificado em `types.ts` + migrations, 2026-07-03):**
> - A tabela de membros é **`task_project_members`** (não `project_members`).
> - Não existe conceito de "PM" (project manager) nem "last admin" no schema — a
>   autoridade real é `task_project_members.permissions` (enum `task_project_permission[]`:
>   `view_tasks, create_tasks, edit_tasks, delete_tasks, change_dates, change_status,
>   change_priority, assign_members, manage_project, view_history`), checável via a RPC
>   real `has_project_permission(p_user_id, p_project_id, p_permission)` (que já bypassa
>   sozinha para `task_projects.owner_id`/`created_by` e para role `owner`).
> - **`permissions` tem DEFAULT `ARRAY['view_tasks']`** — um membro adicionado sem
>   permissão explícita vira **read-only** (não consegue criar/editar tarefas no projeto).
>   Esse é exatamente o bug de "membro sem acesso" que esta reescrita corrige: `add_member`
>   agora EXIGE que o chamador declare as permissões, nunca aceita o default silenciosamente.
> - `task_projects` tem `department_code`, `icon`, `is_archived` (bool — é o mecanismo real
>   de archive) além de `name`/`description`/`color`/`owner_id`.

---

## Task anatomy

### task_name `Manage Task Projects`

### responsible_executor `platform-specialist`

### execution_type `Agent` — confirmation per action.

### input
- `action` (`'create' | 'update' | 'archive' | 'add_member' | 'remove_member'`)
- **`create`:** `{name (obrigatório), owner_id (obrigatório — default auth.uid()), description?, color?, department_code?, icon?, member_ids? + permissions_per_member?}`
- **`update`:** `{project_id, updates: {name?, description?, color?, department_code?, icon?, owner_id?}}`
- **`archive`:** `{project_id}` — seta `is_archived=true` (NÃO deleta a linha)
- **`add_member`:** `{project_id, members: [{user_id, permissions: task_project_permission[]}]}` — **`permissions` é obrigatório por membro**, nunca herdado do default da coluna silenciosamente
- **`remove_member`:** `{project_id, member_ids}`

### output
- `project_id`, `action_result`
- `verdict`: `DONE | BLOCKED | ESCALATE`

### action_items

1. **Authority (real, por permission — nunca "PM"/"last admin"):**
   - `create`: qualquer user autenticado pode criar (vira `owner_id` do próprio projeto, `created_by=auth.uid()`). Se o request pedir `owner_id` diferente de quem está pedindo (criar projeto "para" outra pessoa), exige role admin/owner.
   - `update`: `task_projects.owner_id = auth.uid()` OR role `owner` OR `has_project_permission(auth.uid(), project_id, 'manage_project')`.
   - `archive`: mesma authority de `update` (é um UPDATE de `is_archived`, não um DELETE).
   - `add_member` / `remove_member`: `task_projects.owner_id = auth.uid()` OR role `owner` OR `has_project_permission(auth.uid(), project_id, 'manage_project')` OR `has_project_permission(auth.uid(), project_id, 'assign_members')`.
2. **`create`:**
   ```sql
   INSERT INTO task_projects (name, description, color, department_code, icon, owner_id, created_by)
   VALUES ({name}, {description}, {color}, {department_code}, {icon}, {owner_id or auth.uid()}, auth.uid())
   RETURNING id;
   ```
   Se `member_ids` vierem junto, cada um precisa de `permissions` explícito (ver step 4) — não inserir membro sem perguntar o nível de acesso.
3. **`update`:**
   ```sql
   UPDATE task_projects
      SET name = COALESCE({name}, name), description = COALESCE({description}, description),
          color = COALESCE({color}, color), department_code = COALESCE({department_code}, department_code),
          icon = COALESCE({icon}, icon), owner_id = COALESCE({owner_id}, owner_id),
          updated_at = now()
    WHERE id = {project_id};
   ```
4. **`archive`** (nunca DELETE — preserva histórico/tasks vinculadas):
   ```sql
   UPDATE task_projects SET is_archived = true, updated_at = now() WHERE id = {project_id};
   ```
   Para reverter: `UPDATE task_projects SET is_archived = false WHERE id = {project_id}`.
5. **`add_member`** — **`permissions` é campo obrigatório desta ação, não opcional.** Se o
   request não especificar o nível de acesso desejado, **ASK** (não assumir o default
   `ARRAY['view_tasks']` da coluna, que deixaria o membro só-leitura sem avisar ninguém):
   ```
   Pergunta: "Que acesso {user_name} deve ter no projeto {project_name}?
     1. Só visualizar (view_tasks)
     2. Trabalhar nas tarefas (view_tasks, create_tasks, edit_tasks, change_status)
     3. Gerenciar o projeto (todas as permissions, incluindo manage_project/assign_members/delete_tasks)"
   ```
   ```sql
   INSERT INTO task_project_members (project_id, user_id, permissions, added_by)
   VALUES ({project_id}, {user_id}, {permissions_array}, auth.uid())
   ON CONFLICT (project_id, user_id) DO UPDATE SET permissions = EXCLUDED.permissions;
   ```
6. **`remove_member`:**
   - **Aviso (não bloqueio automático) de "sem gestor":** antes de remover, checar se o
     member a remover é o ÚLTIMO com `manage_project` em `task_project_members` desse
     projeto. Se for, avisar: "Esse é o único membro com permissão de gerenciar o projeto
     além do owner ({owner_name}, que sempre mantém acesso via `task_projects.owner_id`).
     Remover mesmo assim?" — não bloquear automaticamente (o `owner_id` do projeto NUNCA
     perde acesso, já que `has_project_permission` bypassa para ele independente de estar
     ou não em `task_project_members`), mas confirmar explicitamente com o operador.
   ```sql
   DELETE FROM task_project_members WHERE project_id = {project_id} AND user_id = ANY({member_ids});
   ```
7. **Confirmation com summary** antes de qualquer INSERT/UPDATE/DELETE.
8. **Activity log per action** — `action='platform-specialist.manage_task_projects.{action}'`.

### acceptance_criteria
- **[A1] Authority por permission real:** `task_project_members.permissions` (`manage_project`/`assign_members`) via `has_project_permission`, nunca um papel "PM" inventado.
- **[A2] Aviso de "sem gestor" em remove_member:** remover o último membro com `manage_project` do projeto pede confirmação explícita extra (o `owner_id` do projeto nunca perde acesso — isso é bypass estrutural do schema, não depende de estar na tabela de membros).
- **[A3] Atomic batch.**
- **[A4] Audit.**
- **[A5] Archive ≠ Delete:** `archive` sempre faz `UPDATE is_archived=true`, nunca `DELETE FROM task_projects` — preserva as tasks e o histórico vinculados ao `project_id`.
- **[A6] `add_member` nunca aceita o default silencioso:** `permissions` é sempre perguntado/confirmado explicitamente — nunca deixar a coluna cair no `DEFAULT ARRAY['view_tasks']` sem o operador saber que o membro ficará read-only.
- **[A7] Tabela correta:** todas as queries usam `task_project_members` — nunca `project_members` (nome que não existe no schema).

---

## Exemplos

### Exemplo 1 — Criar projeto (DONE)

**Input:** `action=create`, `name="Lançamento Q3"`, `owner_id=auth.uid()`, `member_ids=[sandra_uuid]`

**Specialist:** INSERT em `task_projects` → pergunta o nível de acesso da Sandra antes de adicioná-la (não assume view_tasks silenciosamente) → user responde "trabalhar nas tarefas" → INSERT em `task_project_members` com `permissions=['view_tasks','create_tasks','edit_tasks','change_status']` → DONE.

### Exemplo 2 — Adicionar membro sem especificar acesso (ESCALATE parcial)

**Input:** `action=add_member`, `project_id=p1...`, `members=[{user_id: pablo_uuid}]` (sem `permissions`)

**Specialist:** ASK: "Que acesso Pablo deve ter no projeto? (só visualizar / trabalhar nas tarefas / gerenciar o projeto)" — não insere até a resposta.

### Exemplo 3 — Remover último gestor do projeto (confirmação extra)

**Input:** `action=remove_member`, `project_id=p1...`, `member_ids=[sandra_uuid]` (Sandra é a única com `manage_project` além do owner)

**Specialist:** avisa "Sandra é a única com permissão de gerenciar o projeto além do owner. Remover mesmo assim?" — prossegue só após confirmação explícita.

### Exemplo 4 — Archive (não delete)

**Input:** `action=archive`, `project_id=p1...`

**Specialist:** `UPDATE task_projects SET is_archived=true` → as tarefas com esse `project_id` continuam existindo e consultáveis, só o projeto sai das listagens ativas → DONE.

---

**Mantido por:** platform-specialist
