# Task: move-opportunity-stage

> Task atômica para transicionar `opportunities.stage` entre estados (LEAD_OPPORTUNITY → STRATEGIC_SESSION → NEGOTIATION → SALE_DONE / LOST / etc.). Valida enum, auto-set closed_at em terminais, exige campos extras para WON (value) e LOST (reason).

**Cumpre:** HO-TP-001 (Task Anatomy — 8 campos)

---

## Task anatomy (HO-TP-001 — 8 campos obrigatórios)

### task_name
`Move Opportunity Stage`

### status
`pending`

### responsible_executor
`sales-specialist` (Sprint 4, CRM module)

### execution_type
`Agent` — LLM + Supabase. Human intervention apenas em confirmation (mais rígida em terminal stages).

### input

Entregue pelo `ops-chief`:

- **Cycle ID**: `cyc-YYYY-MM-DD-NNN`
- **User JWT**: `~/.primeteam/session.json`
- **Request payload**:
  - `opportunity_id` (uuid) OR `lead_name` (string, resolvido via join com leads)
  - `new_stage` (string — validado contra valid_stages enum)
  - `sales_proposal_value` (numeric, obrigatório se new_stage=SALE_DONE)
  - `sales_proposal_currency` (ISO 4217, default EUR quando value presente)
  - `lost_reason` (string, obrigatório se new_stage=LOST)
  - `negotiation_installments_count` (int, opcional para SALE_DONE)
  - `next_contact_date` (date, opcional — fora de terminais)

### output

- **`opportunity_id`** — uuid afetado
- **`lead_name`** — para human reading
- **`old_stage`** + **`new_stage`**
- **`closed_at`** — set se transition terminal (SALE_DONE | LOST); null caso contrário
- **`required_fields_set`** — object com sales_proposal_value/currency/lost_reason conforme caso
- **`row_snapshot_before`** + **`row_snapshot_after`** — audit
- **`verdict`** — DONE | BLOCKED | ESCALATE
- **`next_step_suggestion`** — sugestão ao chief:
  - SALE_DONE → `route_to @platform-specialist (Finance income tx)`
  - LOST → `close` ou análise (Sprint 5+)
  - NEGOTIATION (sem sales_user_id) → sugerir `assign_user`
- **`convention_check`**:
  - Stage valid ✓
  - Terminal fields present ✓ (se aplicável)
  - RLS respected ✓
  - closed_at UTC ✓
  - Idempotency honored ✓ (se same stage, no UPDATE)

### action_items

1. **Resolver opportunity_id** — se veio `lead_name`:
   - SELECT o.id, o.stage, l.full_name, o.closed_at
     FROM opportunities o JOIN leads l ON l.id = o.lead_id
     WHERE l.full_name ILIKE '%{term}%' AND o.closed_at IS NULL
     LIMIT 10
   - 0 matches → ESCALATE "nenhuma opp ativa para '{name}'"
   - 1 match → usar
   - >1 → ESCALATE com lista (pedir pick)
2. **Validar new_stage** — deve estar em `valid_stages` enum. Se inválido: ESCALATE com lista.
3. **Read current state** — SELECT row atual (id, stage, closed_at, pipeline, lead_id, sales_proposal_value, sales_proposal_currency, lost_reason).
4. **Idempotency check** — se `current_stage == new_stage`:
   - DONE com `was_idempotent=true`, NÃO executa UPDATE
   - Report "opp já está em {stage} desde {updated_at}"
5. **Terminal-stage requirements check** — baseado em `new_stage`:
   - **SALE_DONE:** require `sales_proposal_value` (numeric > 0). Se ausente:
     - ESCALATE com `ask_user_for_value`. NÃO avançar.
     - Currency default EUR se value presente sem currency explicit.
   - **LOST:** require `lost_reason` (min 3 chars). Se ausente: ESCALATE `ask_user_for_reason`.
   - Outras stages: nenhum extra required.
6. **Confirmation message** — formato varia por destino:
   - **Terminal (SALE_DONE / LOST):** mais rígido, com valor/motivo na mensagem
   - **Intermediary:** mais simples, só echo old → new
   - Exemplo SALE_DONE:
     ```
     Marcar opp {id} ({lead_name}) como VENDIDA:
       stage: {old} → SALE_DONE
       valor: {currency} {value}
       installments: {count or "—"}
       closed_at: now
     Confirma?
     ```
   - Exemplo LOST:
     ```
     Marcar opp {id} ({lead_name}) como PERDIDA:
       stage: {old} → LOST
       motivo: {lost_reason}
       closed_at: now
     Confirma?
     ```
   - Exemplo intermediary:
     ```
     Mover opp {id} ({lead_name}) de {old} → {new}?
     ```
7. **Aguardar confirmação** — "sim" prossegue, "não" ESCALATE.
8. **Detectar transitions atípicas** — se transition é não-linear (ex: LOST → LEAD_OPPORTUNITY), add warning (não block).
9. **Executar UPDATE** com cláusula race-safe:
   ```sql
   UPDATE opportunities
   SET stage = {new_stage},
       updated_at = now(),
       closed_at = CASE
         WHEN {new_stage} IN ('SALE_DONE', 'LOST') THEN now()
         WHEN {new_stage} IN ('RECONTACT_FUTURE', 'NO_SHOW_RECONTACT',
                              'LEAD_OPPORTUNITY', 'STRATEGIC_SESSION',
                              'NEGOTIATION') THEN NULL  -- reopen, clear closed_at
         ELSE closed_at
       END,
       sales_proposal_value = CASE
         WHEN {new_stage} = 'SALE_DONE' THEN {value}
         ELSE sales_proposal_value  -- preserve
       END,
       sales_proposal_currency = CASE
         WHEN {new_stage} = 'SALE_DONE' THEN {currency}
         ELSE sales_proposal_currency
       END,
       lost_reason = CASE
         WHEN {new_stage} = 'LOST' THEN {lost_reason}
         ELSE lost_reason  -- preserve
       END,
       negotiation_installments_count = CASE
         WHEN {new_stage} = 'SALE_DONE' AND {count} IS NOT NULL THEN {count}
         ELSE negotiation_installments_count
       END
   WHERE id = {opp_id} AND stage != {new_stage}
   RETURNING id, stage, closed_at, sales_proposal_value,
             sales_proposal_currency, lost_reason;
   ```
10. **Tratar erros**:
    - 42501 (RLS) → BLOCKED (user pode não ser dono da opp)
    - 5xx → retry 1x → ESCALATE
11. **Popular suggested_next** — baseado em new_stage:
    - SALE_DONE → `route_to @platform-specialist (criar finance tx income)`
    - LOST → `close` (opcional: sugerir agregado stats Sprint 5+)
    - NEGOTIATION + sales_user_id NULL → sugerir `assign_sales_user`
    - STRATEGIC_SESSION → `null` (normal flow)
12. **Retornar ao chief** — V10 + V11 + V18.

### acceptance_criteria

- **[A1] Stage enum validation:** se new_stage não está em valid_stages, task termina ESCALATE (zero UPDATE).
- **[A2] Terminal required fields:** SALE_DONE sem sales_proposal_value = ESCALATE. LOST sem lost_reason = ESCALATE.
- **[A3] Idempotency:** se current_stage == new_stage, task retorna DONE com `was_idempotent=true`, zero UPDATE. closed_at e outros campos preservados.
- **[A4] closed_at auto-set:** terminal stages (SALE_DONE, LOST) gravam closed_at=now() UTC. Non-terminal stages preservam closed_at=NULL (ou clear se veio de terminal → reopen).
- **[A5] Atypical transitions flagged:** LOST → LEAD_OPPORTUNITY, SALE_DONE → NEGOTIATION etc. são permitidos mas WARNING no handoff card.
- **[A6] Non-specified fields preserved:** UPDATE NÃO nulla campos não mencionados (sales_user_id, presales_info, etc.).
- **[A7] RLS clarity:** 42501 → BLOCKED com role explanation.
- **[A8] next_step_suggestion:** sempre preenchido (pode ser null para casos "close cycle"). SALE_DONE sempre sugere Finance route.

---

## Exemplos de execução

### Exemplo 1 — Happy path SALE_DONE (DONE)

**Input:** `"marcar opp do Marco Rossi como vendida por €7.500 em 3 parcelas"`

**Specialist:**
1. Resolve opp: JOIN leads → Marco Rossi → 1 match opp_id=o1a2... stage=NEGOTIATION.
2. new_stage=SALE_DONE ✓ (enum).
3. Required fields: value=7500 ✓, currency=EUR (default) ✓.
4. Idempotent? NEGOTIATION ≠ SALE_DONE → prosseguir.
5. Atypical? NEGOTIATION → SALE_DONE é normal. No warning.
6. Confirmation:
   ```
   Marcar opp o1a2... (Marco Rossi) como VENDIDA:
     stage: NEGOTIATION → SALE_DONE
     valor: EUR 7500
     installments: 3
     closed_at: now
   Confirma?
   ```
7. User: "sim"
8. UPDATE. RLS ok (role=owner). Retorna new state.

**Return:**
```
[sales-specialist → ops-chief] Cycle cyc-... — DONE.

opportunity_id: o1a2...
lead_name: Marco Rossi
old_stage: NEGOTIATION
new_stage: SALE_DONE
closed_at: 2026-04-24T15:20:00Z
required_fields_set: { sales_proposal_value: 7500, currency: EUR, installments_count: 3 }
row_snapshot_before: { stage: NEGOTIATION, closed_at: null, sales_proposal_value: null }
row_snapshot_after: { stage: SALE_DONE, closed_at: <ts>, sales_proposal_value: 7500, currency: EUR }
suggested_next: route_to @platform-specialist
suggested_user_message: |
  "WON! Próximo passo típico: lançar transação finance (+€7.500 income
   OU 3 installments de €2.500) linkada à opp o1a2... Deseja fazer?"
convention_check: stage valid ✓ | terminal fields ✓ | RLS ✓ | closed_at UTC ✓
```

### Exemplo 2 — LOST sem motivo (ESCALATE)

**Input:** `"marcar opp o1a2 como perdida"`

**Specialist:** new_stage=LOST, mas `lost_reason` ausente.

**Return:**
```
[sales-specialist → ops-chief] Cycle cyc-... — ESCALATE.

verdict: ESCALATE
suggested_user_message: |
  "Marcar como LOST requer motivo. Sugestões comuns:
   - Preço fora do budget
   - Escolheu concorrente
   - Timing não é agora
   - No-show crônico
   Qual é?"
```

### Exemplo 3 — Idempotent (DONE, was_idempotent=true)

**Input:** `"mover opp o1a2 para NEGOTIATION"` quando já está em NEGOTIATION.

**Return:**
```
[sales-specialist → ops-chief] Cycle cyc-... — DONE.

opportunity_id: o1a2...
lead_name: Marco Rossi
old_stage: NEGOTIATION
new_stage: NEGOTIATION (same)
was_idempotent: true
warnings: "opp já estava em NEGOTIATION desde 2026-04-22 (nenhum UPDATE executado)"
convention_check: idempotent ✓
```

### Exemplo 4 — Stage inválido (ESCALATE)

**Input:** `"mover opp X para FINALIZADA"`

**Specialist:** FINALIZADA não está em valid_stages.

**Return:**
```
[sales-specialist → ops-chief] Cycle cyc-... — ESCALATE.

verdict: ESCALATE
suggested_user_message: |
  "Stage «FINALIZADA» não é válido. Opções:
   LEAD_OPPORTUNITY, STRATEGIC_SESSION, NEGOTIATION, SALE_DONE,
   RECONTACT_FUTURE, NO_SHOW_RECONTACT, LOST.
   Provavelmente você quis dizer SALE_DONE (venda concluída)?"
```

### Exemplo 5 — Atypical reopen (DONE com warning)

**Input:** `"reabrir opp o1a2, voltou a querer comprar"` (opp atualmente LOST)

**Specialist:**
1. Resolve: o1a2 stage=LOST, closed_at=2026-04-01.
2. new_stage inferido = LEAD_OPPORTUNITY (retomar do início) ou RECONTACT_FUTURE.
3. ASK via ESCALATE: qual stage exato para retomar?

(Alternativa: se user deu stage explícito `"mover opp o1a2 para RECONTACT_FUTURE"`:)

**Specialist:**
1. Atipical: LOST → RECONTACT_FUTURE detectado.
2. Confirmation com warning "transition atípica — abrindo opp fechada".
3. User: "sim".
4. UPDATE: closed_at cleared (set NULL), stage=RECONTACT_FUTURE.

**Return:** DONE com `warnings: ["transition atípica: LOST → RECONTACT_FUTURE, closed_at limpo"]`

---

## Notas de implementação

- **closed_at não é timestamp do banco se não terminal:** preserva NULL quando stage não-terminal, evitando reminiscência do valor antigo.
- **Atypical transitions:** DB não bloqueia, specialist permite mas avisa no handoff card.
- **Stripe sync:** NÃO é responsabilidade desta task. Se opp tem `stripe_payment_intent_id`, webhook trata pagamento. Manual UPDATE em campos stripe_* é NÃO recomendado.

---

**Mantido por:** sales-specialist.
