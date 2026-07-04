# Task: manage-lovarch-user

> Gerir um usuário do app Lovarch (plataforma SaaS) — suspender/reativar (`status`) ou mudar plano (`user_type`) via as write-ops da **Fase 2 do `ops-gateway`** do projeto Lovarch. O pto NUNCA toca o banco Lovarch (`cuxbydmyahjaplzkthkr`) direto — só via gateway, com o token do operador, auditado em `ops_audit_log`.

**Cumpre:** HO-TP-001 (anatomy) · **HO-TP-002 (required fields)** — ver `data/primeteam-platform-rules.md` §12.

> ✅ **Fase 2 do gateway no ar (2026-07-04):** ops `update_user_status`/`set_user_plan` (write, owner/admin) + `list_users`/`user_progress` (read). Créditos e resposta de ticket ficam nas EFs admin dedicadas (Fase 2b — lógica sensível de paid_credits/thread).

---

## Task anatomy

### task_name
`Manage Lovarch User`

### status
`pending`

### responsible_executor
`lovarch-ops-specialist` — auth **owner/admin** (matriz papel→op do gateway: write só owner/admin).

### execution_type
`Agent` — confirmação obrigatória (afeta a conta de um cliente pagante real).

### input
- **Cycle ID**, **User JWT** (`~/.primeteam/session.json`)
- `operation` — `suspend | reactivate | set_plan`
- `email` (do usuário Lovarch) **ou** `user_id` — **ELICITAR** (o alvo)
- `user_type` (string) — **ELICITAR** para `set_plan` (qual plano; nunca defaultar)
- `reason` (string) — motivo (audit)

### action_items
1. **Auth** — owner/admin (o gateway devolve `operation_not_allowed` para os demais). BLOCKED se não.
2. **`lookup_user`** (read) primeiro — validar que o usuário existe e ver o estado atual (`status`, `user_type`, créditos). `found:false` → ESCALATE.
3. **Elicitar** `email`/`user_id` + (`set_plan`) o `user_type`. Nunca defaultar o plano.
4. **Confirmação** (echo): "operação {operation} · usuário {email} · {status/plano atual → novo} · motivo {reason} (conta REAL de cliente Lovarch, auditado). Confirma?". Suspend/mudança de plano → dupla confirmação.
5. **Write via gateway:**
   ```
   POST https://cuxbydmyahjaplzkthkr.supabase.co/functions/v1/ops-gateway
   Authorization: Bearer <access_token>
   suspend/reactivate: { "operation":"update_user_status", "params":{ email|user_id, status:"suspended"|"active" } }
   set_plan:           { "operation":"set_user_plan", "params":{ email|user_id, user_type } }
   ```
   `401` → `pto refresh`. `403 operation_not_allowed` → BLOCKED (papel). `invalid_status` → corrigir.
6. **Verificação PÓS-AÇÃO** (obrigatória): re-`lookup_user` confirmando `status`/`user_type` mudou. Sem confirmação → não reportar DONE.
7. **Auditoria:** o gateway registra em `ops_audit_log` (Lovarch); logar o cycle_id + operation no PT.

### acceptance_criteria
- **[A1]** Auth owner/admin.
- **[A2]** `email`/`user_id` e (set_plan) `user_type` elicitados; plano nunca defaultado.
- **[A3]** `lookup_user` antes (estado atual) + dupla confirmação (conta real).
- **[A4]** Via gateway — NUNCA toca o banco Lovarch direto.
- **[A5]** Verificação pós-ação (re-lookup) confirma o efeito.

---

## Exemplos
### Exemplo 1 — Suspender um usuário (suspend) → update_user_status status=suspended → re-lookup confirma.
### Exemplo 2 — Mudar plano (set_plan) → ELICITA user_type → set_user_plan → re-lookup.
### Exemplo 3 — user_type ausente no set_plan (ELICITAR).

## Notas
- **Acesso/entitlement** (dar/tirar produto) = `manage-lovarch-access` (via archprime-access-proxy). Esta task é STATUS/PLANO do usuário.
- **Créditos** e **resposta de ticket** = Fase 2b do gateway (ainda não exposta — lógica sensível de paid_credits). Ver `data/lovarch-ops-reference.md`.
- Lovarch = plataforma SaaS (empresa separada da Academy).
- Referências: `data/lovarch-ops-reference.md` (§Fase 2), `agents/lovarch-ops-specialist.md`.

---

**Mantido por:** lovarch-ops-specialist
