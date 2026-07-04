# Task: adjust-lovarch-credits

> Ajustar créditos de IA de um usuário do app Lovarch (add/remove/refund) via a op `adjust_credits` da **Fase 2b do `ops-gateway`**. Registra em `credit_transactions` + atualiza `ai_credits` (replica a lógica de `admin-adjust-credits`). O pto NUNCA toca o banco Lovarch direto — só via gateway, auditado.

**Cumpre:** HO-TP-001 (anatomy) · **HO-TP-002 (required fields)** — ver `data/primeteam-platform-rules.md` §12.

> ✅ Smoke live 2026-07-04: add 1 + remove 1 (net-zero) num user interno → saldo volta ao original (o UPDATE real funciona).

---

## Task anatomy

### task_name
`Adjust Lovarch Credits`

### status
`pending`

### responsible_executor
`lovarch-ops-specialist` — auth **owner/admin** (write do gateway).

### execution_type
`Agent` — confirmação obrigatória (altera saldo pago de um cliente real).

### input
- **Cycle ID**, **User JWT**
- `email` (do usuário Lovarch) **ou** `user_id` — **ELICITAR** (o alvo)
- `type` — `add | remove | refund` — **ELICITAR**
- `amount` (int > 0) — **ELICITAR** (quantidade de créditos)
- `reason` (string, min 3) — **ELICITAR sempre** (motivo — vai para o audit trail; nunca defaultar)

### action_items
1. **Auth** — owner/admin. Demais → BLOCKED.
2. **`lookup_user`** primeiro — ver o saldo atual. `found:false` → ESCALATE.
3. **Elicitar** `type`, `amount` (>0), `reason` (≥3 chars). Nunca defaultar o motivo.
4. **Confirmação** (echo): "operação {type} {amount} créditos · usuário {email} · saldo atual {balance} → {novo} · motivo «{reason}». Confirma?".
5. **Write via gateway:**
   ```
   { "operation":"adjust_credits", "params":{ email|user_id, type, amount, reason } }
   ```
   Guards: `invalid_type`, `amount_must_be_positive`, `reason_required_min3`, `user_credits_not_found` → corrigir/ESCALATE.
6. **Verificação PÓS-AÇÃO** (obrigatória): a resposta traz `previous_balance`/`current_balance`; re-`lookup_user` confirmando o novo saldo.
7. **Auditoria:** `ops_audit_log` (gateway) + `credit_transactions` (Lovarch) + log PT.

### acceptance_criteria
- **[A1]** Auth owner/admin.
- **[A2]** `email`/`user_id`, `type`, `amount`, `reason` elicitados; motivo nunca defaultado.
- **[A3]** `lookup_user` antes (saldo atual) + confirmação.
- **[A4]** Via gateway — NUNCA toca o banco Lovarch direto.
- **[A5]** Verificação pós-ação (re-lookup) confirma o novo saldo.

---

## Exemplos
### Exemplo 1 — Cortesia de créditos (add 5000, reason) → saldo sobe → re-lookup confirma.
### Exemplo 2 — Estorno (refund) → restaura saldo.
### Exemplo 3 — reason ausente (ELICITAR — é obrigatório para o audit).

## Notas
- Lovarch = plataforma SaaS. Status/plano do usuário = `manage-lovarch-user`; acesso a produto = `manage-lovarch-access`; ticket = `respond-lovarch-ticket`.
- Referências: `data/lovarch-ops-reference.md` (§Fase 2b), op `adjust_credits`.

---

**Mantido por:** lovarch-ops-specialist
