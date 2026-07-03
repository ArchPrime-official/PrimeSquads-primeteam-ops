# Task: reactivate-user

> Reativar um usuário desativado — `UPDATE profiles SET is_active=true` + atribuir uma role BASELINE. Par de `deactivate-user`. Corrige o playbook `reactivate_user` que era só YAML (task-fantasma referenciada por `deactivate-user` como se existisse).

**Cumpre:** HO-TP-001 (anatomy) · **HO-TP-002 (required fields)** — ver `data/primeteam-platform-rules.md` §12.

---

## Task anatomy

### task_name
`Reactivate User`

### status
`pending`

### responsible_executor
`admin-specialist` — **owner-only**.

### execution_type
`Agent` — confirmação obrigatória (reativa login + concede role).

### input
- **Cycle ID**, **User JWT**, **User role**
- `user_id` (uuid) **ou** `email` — **ELICITAR** se ausente
- `baseline_role` (enum `app_role`) — **ELICITAR sempre** (a role inicial ao reativar; nunca defaultar — quem reativa decide o acesso)

### output
- `user_id`, `is_active: true`, `baseline_role`, `verdict: DONE | BLOCKED | ESCALATE`

### action_items
1. **Owner preflight** — não-owner → BLOCKED (mesma regra do admin-specialist).
2. **Resolver alvo** — `user_id` (ou resolver `email`→`user_id`). Confirmar que existe em `profiles` e que está **`is_active=false`** (se já ativo, informar e retornar — no-op). Não encontrado → ESCALATE.
3. **Validar `baseline_role`** ∈ enum `app_role`. **ELICITAR** explicitamente ("Qual role inicial ao reativar?") — não assumir a role antiga (foi removida no deactivate).
4. **Confirmação:** "Reativar {full_name}: is_active→true, role inicial '{baseline_role}'. Confirma?" → usuário digita `confirma`.
5. **Activity log STRICT** (falha = ABORT): `action='admin-specialist.reactivate_user'`, `resource_id={user_id}`, `details={cycle_id, target_user_id, baseline_role, before:{is_active:false}, after:{is_active:true, roles:[baseline_role]}}`.
6. **Write** (JWT owner):
   ```sql
   UPDATE profiles SET is_active = true, updated_at = now() WHERE id = {user_id};
   INSERT INTO user_roles (user_id, role, created_by, created_at)
   VALUES ({user_id}, {baseline_role}, auth.uid(), now())
   ON CONFLICT (user_id, role) DO NOTHING;
   ```
   Erros: `42501` → BLOCKED; se o UPDATE afeta 0 linhas → ESCALATE (usuário não existe).
7. **Verificação PÓS-AÇÃO** (obrigatória): `SELECT is_active FROM profiles WHERE id={user_id}` = true **e** `SELECT 1 FROM user_roles WHERE user_id={user_id} AND role={baseline_role}` existe.
8. **Flag quality-guardian audit**.

### acceptance_criteria
- **[A1]** Owner-only enforced.
- **[A2]** `baseline_role` elicitado explicitamente (nunca defaultar/reaproveitar role antiga).
- **[A3]** Confirmação antes do write.
- **[A4]** Activity log STRICT.
- **[A5]** Verificação pós-ação confirma `is_active=true` E a role atribuída.
- **[A6]** Colunas reais (`profiles.is_active`, `user_roles.user_id/role/created_by`).

---

## Exemplos
### Exemplo 1 — Reativar ex-colaborador (DONE)
Owner ✓ → confirma role baseline 'comercial' → UPDATE is_active + INSERT role → verificação ok → DONE.
### Exemplo 2 — baseline_role ausente (ELICITAR)
Pedido "reativa o João" sem role → pergunta "Qual role inicial?" antes de qualquer write.
### Exemplo 3 — Não-owner (BLOCKED)
role≠owner → BLOCKED no preflight.

## Notas
- Par inverso de `deactivate-user` (que faz `is_active=false` + remove roles). Para trocar role depois: `grant-role`/`revoke-role`.
- Referências: `data/required-fields-registry.yaml`, `agents/admin-specialist.md` (playbook reactivate_user).

---

**Mantido por:** admin-specialist
