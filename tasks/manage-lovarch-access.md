# Task: manage-lovarch-access

> Gerir o ACESSO de um usuário do app Lovarch (`app.lovarch.com`, plataforma SaaS) — conceder/estender/atualizar/revogar entitlement (planos/produtos) via a EF **`archprime-access-proxy`** do PrimeTeam (que já está em produção e é o mesmo caminho que a UI CS + o stripe-webhook usam). O pto NUNCA toca o banco Lovarch (`cuxbydmyahjaplzkthkr`) direto — o proxy encapsula o shared secret server-side.

**Cumpre:** HO-TP-001 (anatomy) · **HO-TP-002 (required fields)** — ver `data/primeteam-platform-rules.md` §12.

> ✅ **Religada 2026-07-04** para o `archprime-access-proxy` (antes apontava para uma "Fase 2 do ops-gateway" que não existia e a task ficava BLOCKED). Agora funciona de fato. O ops-gateway segue read-only para lookup/tickets/erros; ESCRITA de acesso é pelo proxy.

---

## Task anatomy

### task_name
`Manage Lovarch Access`

### status
`pending`

### responsible_executor
`lovarch-ops-specialist` — auth **owner/admin/cs** (gate real do `archprime-access-proxy`).

### execution_type
`Agent` — confirmação obrigatória (concede/revoga acesso pago em produto SaaS).

### input
- **Cycle ID**, **User JWT** (`~/.primeteam/session.json`)
- `operation` — `grant | extend | update | revoke | list`
- `email` (do usuário Lovarch) — **ELICITAR** (o alvo)
- `products` (array, para `grant`/`extend`) — cada item `{ key, access_until? | extend_months?, cumulative? }`. **`key` ELICITAR sempre** (ex.: `lovarch_studio_monthly`, `le-3-fasi`; nunca defaultar o produto)
- `entitlement_id` (para `update`/`revoke` — obtido antes via `list`)
- `access_until` / `notes` (para `update`); `reason` (para `revoke`)

### output
- `email`, `products`/`entitlement_id`, resultado, `verdict: DONE | BLOCKED | ESCALATE`

### action_items
1. **Auth** — owner/admin/cs (o proxy devolve 403 fora disso). Demais → BLOCKED.
2. **Elicitar** `email` + (para grant/extend) o `products[].key` + validade (`access_until` OU `extend_months`). Produto nunca defaultado.
3. **`list` primeiro** (grant/update/revoke) — `POST archprime-access-proxy {action:'list', payload:{email}}` para ver o estado atual (entitlements + `is_active`). `found:false` em revoke/update → ESCALATE.
4. **Confirmação** (echo): "operação {operation} · usuário {email} · produto(s) {keys} · validade {access_until/extend_months} · motivo {reason}". `revoke` → dupla confirmação.
5. **Write via proxy** (JWT do user):
   ```
   POST {SUPABASE_URL}/functions/v1/archprime-access-proxy
   Authorization: Bearer <access_token>
   { "action": "grant" | "update" | "revoke", "payload": { ... } }
   ```
   - **grant/extend:** `{action:'grant', payload:{ email, products:[{key, access_until?|extend_months?, cumulative?}], send_email? }}` (cria user se não existe, upsert `user_entitlements`, propaga plano/créditos).
   - **update:** `{action:'update', payload:{ entitlement_id, access_until?, notes? }}`.
   - **revoke/restore:** `{action:'revoke', payload:{ entitlement_id, action:'revoke'|'restore', reason? }}` (soft, `revoked_at`).
   `401` → `pto refresh`. `403` → BLOCKED (papel). Erro do Lovarch → repassar.
6. **Verificação PÓS-AÇÃO** (obrigatória): re-`list` (`action:'list'`) confirmando o efeito (grant/extend: entitlement ativo com a nova validade; revoke: `revoked_at` preenchido / `is_active=false`). Sem confirmação → não reportar DONE.
7. **Activity log**: `action='lovarch-ops-specialist.manage_lovarch_access'`, `details={cycle_id, operation, email, products/entitlement_id}` (sem dados sensíveis).

### acceptance_criteria
- **[A1]** Auth owner/admin/cs.
- **[A2]** `email` e `products[].key` elicitados; produto nunca defaultado.
- **[A3]** `list` antes de update/revoke (precisa do `entitlement_id` real).
- **[A4]** Via `archprime-access-proxy` — NUNCA toca o banco Lovarch direto.
- **[A5]** revoke com dupla confirmação.
- **[A6]** Verificação pós-ação (re-`list`) confirma o efeito.

---

## Exemplos
### Exemplo 1 — Conceder acesso Studio (grant, DONE)
`{action:'grant', payload:{email, products:[{key:'lovarch_studio_monthly', extend_months:1}], send_email:true}}` → re-list mostra ativo → DONE.
### Exemplo 2 — product ausente (ELICITAR)
"dá acesso pro fulano" sem key → pergunta o produto antes de qualquer chamada.
### Exemplo 3 — Revogar (revoke)
`list` → pega `entitlement_id` → dupla confirmação → `{action:'revoke', payload:{entitlement_id, action:'revoke', reason}}` → re-list confirma revoked.

## Notas
- **Lovarch = plataforma SaaS** (empresa separada). Acesso de aluno da **Academy** (curso ArchPrime) é outra task: `manage-academy-access` (`acad_entitlements`). Não confundir os produtos.
- Gestão de usuário Lovarch além de acesso (suspender/plano/créditos/assinatura/ticket) = ops-gateway Fase 2 (`manage-lovarch-user`, `adjust-lovarch-credits`, `respond-lovarch-ticket` — trilha B3).
- Referências: `supabase/functions/archprime-access-proxy`, `data/lovarch-ops-reference.md`.

---

**Mantido por:** lovarch-ops-specialist
