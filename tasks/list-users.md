# Task: list-users

> Listar usuários da EQUIPE (`profiles` + roles de `user_roles`), com filtros por status/role/busca. **Read-only.** Corrige o playbook `list_users` que era só YAML e usava colunas inexistentes (`p.email`, `p.last_sign_in_at` — o e-mail vive em `auth.users`; `profiles` tem `last_login_at`, não `last_sign_in_at`).

**Cumpre:** HO-TP-001 (anatomy). Read-only — sem HO-TP-002 (não escreve).

---

## Task anatomy

### task_name
`List Users`

### responsible_executor
`admin-specialist` — **owner-only** (READ_IS_SAFE, mas o agent inteiro é owner-gated).

### execution_type
`Agent` — read-only, confirmação simples (nenhuma mutação).

### input
- **Cycle ID**, **User JWT**, **User role**
- Filtros (todos opcionais): `is_active` (bool, default `true`), `role` (enum — usuários que TÊM essa role), `search_term` (ILIKE em `full_name`)

### output
- Tabela `| # | Nome | Departamento | Roles | Ativo? | Último login |` + contagem. `verdict: DONE | BLOCKED`

### action_items
1. **Owner preflight** — não-owner → BLOCKED.
2. **Query** (colunas REAIS de `profiles` — `id`, `full_name`, `is_active`, `department`, `last_login_at`; **não** `email`/`last_sign_in_at`):
   ```sql
   SELECT p.id, p.full_name, p.department, p.is_active, p.last_login_at,
          ARRAY(SELECT role FROM user_roles WHERE user_id = p.id) AS roles
   FROM profiles p
   WHERE ({is_active} IS NULL OR p.is_active = {is_active})
     AND ({search_term} IS NULL OR p.full_name ILIKE '%'||{search_term}||'%')
   ORDER BY p.full_name;
   -- filtro por role: adicionar EXISTS(SELECT 1 FROM user_roles WHERE user_id=p.id AND role={role})
   ```
3. **E-mail**: `profiles` NÃO tem `email` (vive em `auth.users`, não exposto via PostgREST anon). Se o operador precisar do e-mail de um usuário específico, usar `get-user-detail`/admin API — NÃO inventar `p.email`.
4. Renderizar a tabela + total.

### acceptance_criteria
- **[A1]** Owner-only.
- **[A2]** SQL usa colunas reais (`full_name`, `is_active`, `department`, `last_login_at`) — nunca `p.email`/`p.last_sign_in_at`.
- **[A3]** Roles agregadas por `ARRAY(... user_roles ...)`.
- **[A4]** Read-only (zero mutação).

---

## Exemplos
### Exemplo 1 — "quem está ativo?" → lista is_active=true.
### Exemplo 2 — "quem é financeiro?" → filtro role='financeiro' (equivale a `list-users-with-role`).
### Exemplo 3 — Não-owner → BLOCKED.

## Notas
- Par de `list-users-with-role` (filtro por role). Detalhe de 1 usuário (com e-mail via admin API): `get-user-detail` (débito — a admin API/RPC de e-mail não está exposta hoje).
- Referências: `agents/admin-specialist.md` (playbook list_users, corrigido aqui).

---

**Mantido por:** admin-specialist
