# Task: create-user

> Criar um usuário da EQUIPE interna via Edge Function `create-user` (auth.users + `profiles` + `user_roles` numa tacada), gated owner/admin. Preenche a lacuna "não há como adicionar usuário pelo pto". **Só equipe `@archprime.io`** — ALUNOS (academy/Lovarch) NÃO são criados aqui (entram por compra Stripe / signup público / entitlement — ver `manage-academy-access`).

**Cumpre:** HO-TP-001 (anatomy) · **HO-TP-002 (required fields)** — ver `data/primeteam-platform-rules.md` §12.

> ⚠️ Baseada na EF `supabase/functions/create-user`: exige `email` (`@archprime.io`), `full_name`, `role`; gate `is_admin || is_owner`.

---

## Task anatomy

### task_name
`Create User (equipe)`

### status
`pending`

### responsible_executor
`admin-specialist` — auth **owner/admin** (gate real da EF `create-user`).

### execution_type
`Agent` — confirmação obrigatória (cria identidade + concede role).

### input
- **Cycle ID**, **User JWT**, **User role**
- `email` (string, **DEVE terminar em `@archprime.io`**) — **source: EF create-user (obrigatório)**; ELICITAR
- `full_name` (string) — **source: schema** (`profiles.full_name`); ELICITAR
- `role` (enum `app_role`) — **source: EF (obrigatório)**; **ELICITAR sempre** (nunca defaultar a role de um usuário novo)
- `birth_date` (date, opcional), `is_active` (bool, opcional default true), `password` (opcional — se ausente, a EF gera temp e envia reset e-mail)

### output
- `user_id` (uuid do usuário criado), `email`, `role`, `verdict: DONE | BLOCKED | ESCALATE`

### action_items
1. **Auth** — `is_admin(auth.uid()) OR is_owner(auth.uid())`. Nenhum → BLOCKED (a EF devolve 403).
2. **Elicitar obrigatórios** — `email`, `full_name`, `role`. Ausente → PERGUNTAR. **`email` DEVE ser `@archprime.io`** (a EF rejeita 400 outros domínios) — se pedirem criar aluno/e-mail externo, ESCALATE explicando que aluno não é criado aqui.
3. **Validar** `role` ∈ enum `app_role`; e-mail bem-formado `@archprime.io`.
4. **Confirmação:** "Vou criar o usuário {full_name} <{email}> com role '{role}' (envia e-mail de definição de senha). Confirma?" → `confirma`.
5. **Invoke EF** (JWT do user):
   ```
   supabase.functions.invoke('create-user', { body: { email, full_name, role, birth_date, is_active } })
   ```
   Respostas: `403` → BLOCKED (sem owner/admin); `400 Only @archprime.io` → BLOCKED; `400 Missing required fields` → ELICITAR; `email já existe` → ESCALATE.
6. **Activity log STRICT**: `action='admin-specialist.create_user'`, `resource_id={new_user_id}`, `details={cycle_id, email, role, full_name, welcome_email_sent}`.
7. **Verificação PÓS-AÇÃO** (obrigatória): `SELECT id, is_active FROM profiles WHERE id={new_user_id}` existe **e** `SELECT 1 FROM user_roles WHERE user_id={new_user_id} AND role={role}`.
8. **Flag quality-guardian audit**.

### acceptance_criteria
- **[A1]** Auth owner/admin (403 tratado).
- **[A2]** `email`, `full_name`, `role` elicitados; nunca defaultar role.
- **[A3]** `email` `@archprime.io` enforçado; aluno/e-mail externo → ESCALATE (não criar aqui).
- **[A4]** Activity log STRICT.
- **[A5]** Verificação pós-ação confirma `profiles` + `user_roles`.
- **[A6]** Via EF `create-user` (nunca `auth.admin.createUser` direto do squad).

---

## Exemplos
### Exemplo 1 — Owner cria nova colaboradora (DONE)
email `giulia@archprime.io`, full_name, role='cs' → confirma → EF cria → verificação ok → DONE (reset e-mail enviado).
### Exemplo 2 — E-mail externo / aluno (ESCALATE)
Pedido "cria acesso pro aluno mario@gmail.com" → ESCALATE: create-user é só equipe `@archprime.io`; para dar acesso de aluno use `manage-academy-access`.
### Exemplo 3 — role ausente (ELICITAR)
Sem `role` → pergunta antes de criar.

## Notas
- Só EQUIPE. Acesso de aluno academy = `manage-academy-access` (entitlement); aluno Lovarch = `manage-lovarch-access` (Fase 2). Trocar role depois = `grant-role`/`revoke-role`.
- Referências: `supabase/functions/create-user`, `data/required-fields-registry.yaml`, `agents/admin-specialist.md`.

---

**Mantido por:** admin-specialist
