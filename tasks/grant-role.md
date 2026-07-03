# Task: grant-role

> Atribuir uma role de EQUIPE a um usuário — INSERT em `user_roles` respeitando o gate **owner-only** do `admin-specialist`, com dupla confirmação e last-owner awareness. Corrige o playbook `grant_role` que era só YAML (task-fantasma) e usava colunas inexistentes (`assigned_by`/`assigned_at` → o schema real é `created_by`/`created_at`).

**Cumpre:** HO-TP-001 (anatomy) · **HO-TP-002 (required fields)** — ver `data/primeteam-platform-rules.md` §12.

> ⚠️ Antes: confirme em `apps/v2/src/integrations/supabase/types.ts` que `user_roles` tem `user_id`, `role`, `created_by` (NÃO `assigned_by`). Registrada em `data/required-fields-registry.yaml`.

---

## Task anatomy

### task_name
`Grant Role`

### status
`pending`

### responsible_executor
`admin-specialist` — **owner-only** (OWNER_ONLY_ACTIVATION). Qualquer role ≠ owner → BLOCKED antes de qualquer query.

### execution_type
`Agent` — dupla confirmação obrigatória (role muda capabilities de segurança).

### input
- **Cycle ID**, **User JWT** (`~/.primeteam/session.json`), **User role**
- `user_id` (uuid) **ou** `email` (string — resolver para `user_id` via lookup) — **ELICITAR** se ausente
- `role` (enum `app_role`: `owner|admin|financeiro|comercial|cs|marketing`) — **ELICITAR sempre**; nunca defaultar
- `justification` (string) — razão do upgrade (paper trail); ELICITAR

### output
- `user_id`, `role` atribuída, `before_roles`, `after_roles`, `verdict: DONE | BLOCKED | ESCALATE`

### action_items
1. **Owner preflight** — `SELECT EXISTS(SELECT 1 FROM user_roles WHERE user_id=auth.uid() AND role='owner')`. Se false → **BLOCKED** ("admin-specialist é owner-only. Sua role: {role}").
2. **Resolver alvo** — se veio `email`, resolver para `user_id` (o e-mail vive em `auth.users`, não em `profiles` — usar lookup admin/RPC). Confirmar que o `profiles.id` existe e `is_active=true`. Não encontrado → ESCALATE.
3. **Validar `role`** ∈ enum `app_role`. Fora → BLOCKED. Já possui a role → informar (no-op) e retornar DONE sem duplicar.
4. **Confirmação dupla (DOUBLE_CONFIRMATION_ON_MUTATIONS):**
   - Step 1 (preview): "Vou ATRIBUIR role '{role}' a {full_name}. Capabilities ganhas: {lista}. Impacto: {sev}. Justificativa: {justification}".
   - Step 2 (literal): usuário digita **`confirma`** — ou **`CONFIRMO OWNER`** (uppercase) se `role='owner'` (caso especial de promoção a owner).
5. **Activity log STRICT (ANTES/junto do write; falha de log = ABORT):** `action='admin-specialist.grant_role'`, `resource_type='squad_mutation'`, `resource_id={user_id}`, `details={cycle_id, target_user_id, role, before_roles, after_roles, justification, double_confirmation_logged:true, guardian_audit_pending:true}`.
6. **Write** (JWT do user, RLS owner):
   ```sql
   INSERT INTO user_roles (user_id, role, created_by, created_at)
   VALUES ({user_id}, {role}, auth.uid(), now())
   ON CONFLICT (user_id, role) DO NOTHING
   RETURNING id, user_id, role;
   ```
   Erros: `42501` (RLS) → BLOCKED; `23503` (FK user_id) → BLOCKED (usuário não existe); `22P02` (enum inválido) → BLOCKED.
7. **Verificação PÓS-AÇÃO** (obrigatória): `SELECT array_agg(role) FROM user_roles WHERE user_id={user_id}` — confirmar que `{role}` está presente (`after_roles`).
8. **Flag quality-guardian audit** no handoff (admin op sensível).

### acceptance_criteria
- **[A1]** Owner-only enforced (preflight); não-owner = BLOCKED sem queries.
- **[A2]** `role` e alvo elicitados; nunca defaultar role.
- **[A3]** Dupla confirmação (`confirma`; `CONFIRMO OWNER` se role=owner).
- **[A4]** Activity log STRICT (falha = ABORT, sem mutação).
- **[A5]** Verificação pós-ação confirma `role` em `after_roles`.
- **[A6]** Colunas reais (`user_id`, `role`, `created_by`) — nada de `assigned_by`/`assigned_at`.

---

## Exemplos
### Exemplo 1 — Owner promove Sandra a admin (DONE)
Owner ✓ → preview capabilities + "confirma" → INSERT → after_roles inclui admin → DONE + flag audit.
### Exemplo 2 — Não-owner tenta (BLOCKED)
User role=comercial → BLOCKED no preflight, zero queries.
### Exemplo 3 — Promoção a owner (CONFIRMO OWNER)
role=owner exige `CONFIRMO OWNER` uppercase; senão cancela.

## Notas
- Par de `revoke-role` (downgrade, com last-owner protection). Reativação de usuário desativado = `reactivate-user`.
- Referências: `data/required-fields-registry.yaml`, `data/primeteam-platform-rules.md` §8/§12, `agents/admin-specialist.md` (playbook grant_role).

---

**Mantido por:** admin-specialist
