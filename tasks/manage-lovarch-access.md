# Task: manage-lovarch-access

> Gerir o ACESSO de um aluno do app Lovarch (`app.lovarch.com`) — conceder/estender/revogar entitlement via a `operation` de escrita do `ops-gateway` do projeto Lovarch (`cuxbydmyahjaplzkthkr`). Preenche a lacuna [ALTO] de gestão de acesso Lovarch.
>
> ⛔ **DEPENDÊNCIA EXTERNA (Fase 2 do gateway):** as `operation`s de escrita (`grant_access`/`revoke_access`) **ainda NÃO estão implementadas** no `ops-gateway` do projeto Lovarch — isso é trabalho no lado Lovarch (@devops/Pablo), fora do squad. Enquanto não existirem, esta task retorna **BLOCKED** com o contrato (ver `data/lovarch-ops-reference.md` §Fase 2). A camada pto já está pronta; funcionará sem mudança quando o gateway ganhar a operation.

**Cumpre:** HO-TP-001 (anatomy) · **HO-TP-002 (required fields)** — ver `data/primeteam-platform-rules.md` §12.

---

## Task anatomy

### task_name
`Manage Lovarch Access`

### status
`pending`

### responsible_executor
`lovarch-ops-specialist` — auth **owner/admin** (matriz papel→operação do `ops-gateway`). O app Lovarch é projeto Supabase SEPARADO; o pto NUNCA toca `cuxbydmyahjaplzkthkr` direto — só via gateway com o token do operador.

### execution_type
`Agent` — confirmação obrigatória (concede/revoga acesso pago em produto externo).

### input
- **Cycle ID**, **User JWT** (`~/.primeteam/session.json` — token do operador)
- `operation` — `grant | extend | revoke`
- `email` (do aluno Lovarch) **ou** `user_id` — **ELICITAR** (o aluno-alvo no projeto Lovarch)
- `product` (string) — **ELICITAR sempre** (qual produto/plano; nunca defaultar)
- `access_until` (date) — obrigatório para `grant`/`extend`

### output
- `email`/`user_id`, `product`, `access_until`, `verdict: DONE | BLOCKED | ESCALATE`

### action_items
1. **Auth** — owner/admin (gate do gateway). Demais → BLOCKED.
2. **`whoami` self-test** — `POST ops-gateway {operation:'whoami'}` para descobrir `allowed_operations`. **Se `grant_access`/`revoke_access` NÃO estiver em `allowed_operations`** → **BLOCKED** repassando o contrato Fase 2 (`data/lovarch-ops-reference.md`): "escrita no Lovarch depende da Fase 2 do ops-gateway, ainda não implementada no projeto Lovarch (@devops/Pablo)". Não tentar caminho alternativo (banco direto é PROIBIDO).
3. **Confirmar o aluno** — `lookup_user` (Fase 1, read) por `email`/`user_id` para validar que existe. `found:false` → ESCALATE.
4. **Elicitar** `product` (+ `access_until` em grant/extend).
5. **Confirmação:** "operação {operation} · aluno {email} · produto {product} · até {access_until} (projeto Lovarch, auditado). Confirma?".
6. **Write via gateway:**
   ```
   POST https://cuxbydmyahjaplzkthkr.supabase.co/functions/v1/ops-gateway
   Authorization: Bearer <access_token>
   { "operation": "grant_access" | "revoke_access", "params": { email|user_id, product, access_until } }
   ```
   `401` → `pto refresh` e repetir. `403` → BLOCKED (papel). `400 unknown_operation`/`operation not allowed` → BLOCKED (Fase 2 pendente — repassar contrato).
7. **Verificação PÓS-AÇÃO** (obrigatória): re-`lookup_user` confirmando o status/entitlement do aluno mudou. Sem confirmação → não reportar DONE.
8. **Auditoria:** o gateway registra em `ops_audit_log` (Lovarch); logar também no PrimeTeam o cycle_id + operation (sem dados sensíveis).

### acceptance_criteria
- **[A1]** Auth owner/admin.
- **[A2]** `email`/`user_id` e `product` elicitados; produto nunca defaultado.
- **[A3]** `whoami` verifica a capability ANTES; Fase 2 ausente → BLOCKED com contrato (não fingir sucesso).
- **[A4]** Nunca toca o banco Lovarch direto — só via gateway.
- **[A5]** Verificação pós-ação (re-lookup) confirma o efeito.

---

## Exemplos
### Exemplo 1 — Fase 2 ainda não implementada (BLOCKED honesto)
`whoami` não lista `grant_access` → BLOCKED com o contrato Fase 2 e o encaminhamento a @devops/Pablo.
### Exemplo 2 — Gateway com Fase 2 (DONE)
`grant_access` disponível → confirma → gateway concede → re-lookup mostra acesso ativo → DONE.
### Exemplo 3 — product ausente (ELICITAR)
Sem produto → pergunta antes de qualquer chamada de escrita.

## Notas
- Fase 1 (read) = `lovarch-lookup-user`/`lovarch-user-tickets`/`lovarch-recent-errors`/`lovarch-whoami`. Esta é a primeira task de ESCRITA Lovarch — gated pela Fase 2 do gateway.
- Ticket/crédito/aula Lovarch = outras `operation`s do contrato Fase 2 (ver reference) — tasks futuras.
- Referências: `data/lovarch-ops-reference.md` (§Fase 2 contrato), `agents/lovarch-ops-specialist.md`.

---

**Mantido por:** lovarch-ops-specialist
