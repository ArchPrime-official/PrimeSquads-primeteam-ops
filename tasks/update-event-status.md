# Task: update-event-status

> Atualizar status de inscrito em evento (presença, no-show, conversão). CS usa durante e pós-evento. Implementa F-17.5 do PRD.

**✅ SCHEMA ADAPTED (2026-06-12):** Tabela `event_registrations` NÃO existe no schema. A abordagem correta é via `opportunities` linkadas por `campaign_id` do evento.

Enum real de `opportunity_stage` (25 valores em produção — ver move-opportunity-stage.md):
`LEAD_OPPORTUNITY, PRE_CONTACT, PRE_CONTACT_PLUS, PRICED_CONTACT, SESSION_SCHEDULED, PRICE_SENT, PHONE_OR_WHATSAPP_CONTACT, PRE_SALES_CONTACT, PRE_SALE_CONTACT, PRE_SALES_SESSION, PRE_SALES_NO_SHOW, PRE_SALES_RECONTACT, SALES_SESSION, SALES_NO_SHOW, SALES_RECONTACT, RECONTACT_FUTURE, STRATEGIC_SESSION, NO_SHOW, NO_SHOW_RECONTACT, NEGOTIATION, NEGOTIATION_PLUS, CONTRACT_SENT, SALE_DONE, COMPLETED, LOST`

**Mapping de status de evento → stage de opp (usar move-opportunity-stage):**
- `confirmed` → `STRATEGIC_SESSION` (pre-sales confirmado)
- `attended` → `SALES_SESSION` (compareceu) — TODO: não há coluna `attended_at` em `opportunities`; registrar em `qualification_data` JSONB enquanto migration D4 não existe
- `no_show` → `SALES_NO_SHOW` ou `NO_SHOW`
- `converted` → `SALE_DONE` (via move-opportunity-stage com sales_proposal_value)

**Nota:** colunas `metadata`, `attended_at`, `no_show` NÃO existem em `opportunities`. Use `qualification_data` JSONB para dados adicionais de presença.

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name
`Update Event Registrant Status`

### responsible_executor
`sales-specialist` (escopo CRM/leads) — modifica status do inscrito

### execution_type
`Agent` — confirmation simples, mutation single-row.

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload:**
  - `event_id` (uuid)
  - `lead_id` (uuid OU `email` para resolver)
  - `new_status` (`'confirmed' | 'attended' | 'no_show' | 'converted'`)
  - `notes` (string opcional)
  - `attended_at` (ISO timestamp opcional, default NOW se status='attended')
  - `converted_opportunity_id` (uuid opcional, requerido se status='converted')

### output

- **`registration_id`** (uuid)
- **`old_status`** + **`new_status`**
- **`verdict`** — `DONE | BLOCKED | ESCALATE`
- **`convention_check`** — RLS ✓ / status_transition ✓ / audit ✓

### action_items

1. **Role check:** cs/marketing/admin/owner. Outros → BLOCKED.
2. **Resolver lead_id** (se passou email).
3. **Validar `new_status`** ∈ enum válido. Outros → ESCALATE.
4. **Buscar opportunity ativa do lead no evento:**
   ```sql
   SELECT o.id, o.stage AS old_stage, o.qualification_data,
          l.name, l.email
   FROM opportunities o
   JOIN leads l ON l.id = o.lead_id
   WHERE o.lead_id = {lead_id}
     AND o.campaign_id = (SELECT id FROM campaigns WHERE event_slug = {event_slug} LIMIT 1)
     AND o.closed_at IS NULL
   LIMIT 1;
   ```
   0 match → ESCALATE com `not_registered` — lead sem opportunity neste evento.
5. **Mapear new_status → new_stage** (ver mapeamento no cabeçalho).
6. **Validar transição** via enum real (25 stages). Estados terminais: SALE_DONE, COMPLETED, LOST → BLOCKED para volta.
7. **Confirmation:**
   ```
   Atualizar status de evento:
   Lead: {name} ({email})
   Opp ID: {opp_id}
   Status atual: {old_stage}
   Novo status: {new_status} → stage: {new_stage}
   {notes ? 'Notas: ' + notes : ''}
   Confirma?
   ```
8. **UPDATE via move-opportunity-stage** (ou UPDATE direto):
   ```sql
   UPDATE opportunities
   SET stage = {new_stage},
       qualification_data = COALESCE(qualification_data, '{}'::jsonb) ||
                            jsonb_build_object(
                              'event_status', {new_status},
                              'event_status_at', NOW(),
                              'event_notes', {notes}
                            ),
       updated_at = NOW()
   WHERE id = {opp_id};
   ```
9. **Activity log:** `action='sales-specialist.update_event_status'`, details com diff (opp_id, old_stage, new_stage, event_status).
10. **Echo:**
   ```
   ✓ Status atualizado
   {name}: {old_stage} → {new_stage} (event_status={new_status})
   {converted ? 'Opportunity em SALE_DONE — pipeline atualizado.' : ''}
   ```

### acceptance_criteria

- **[A1] Role gating:** cs/marketing/admin/owner.
- **[A2] Status enum:** rejeita valores fora do enum.
- **[A3] Transition validation:** estados terminais (converted) bloqueiam volta.
- **[A4] Conditional fields:** attended_at obrigatório se status=attended; opportunity_id obrigatório se status=converted.
- **[A5] Audit log:** diff before/after.
- **[A6] Idempotency:** se status atual = novo status, ESCALATE com `no_op` (não re-marca).

---

## Exemplos

### Exemplo 1 — Andrea marca presença

**Input:** `event_id={x}`, `lead_id={y}`, `new_status='attended'`, `attended_at=2026-05-15T19:30:00Z`

**Specialist:** valida transição confirmed→attended ✓, UPDATE, echo "Presença marcada".

### Exemplo 2 — Marca conversão sem opp_id (ESCALATE)

**Input:** `new_status='converted'` sem `converted_opportunity_id`

**Specialist:** ESCALATE:
```
Status 'converted' requer converted_opportunity_id. Crie a opportunity
primeiro via create-lead/move-opportunity-stage e passe o UUID.
```

### Exemplo 3 — Tentativa de regredir converted (BLOCKED)

**Input:** registrant já converted, tentativa de voltar para attended

**Specialist:** BLOCKED com:
```
Inscrito já está em estado 'converted' (terminal). Para reverter, contate
admin para correção manual via SQL (raro — significa erro de classificação).
```

---

## Notas

- **Schema real:** `opportunities` linkadas por `campaign_id`. Não há tabela `event_registrations`.
- **Coluna `attended_at`:** TODO (migration D4 pendente). Usar `qualification_data` JSONB como workaround.
- **Bulk update:** task é single-row. Para batch (ex: marcar 50 attended de uma vez), usar `bulk-update-opportunities` com filter.
- **Stage enum:** sempre validar contra os 25 valores reais (ver move-opportunity-stage.md).

---

**Mantido por:** sales-specialist
