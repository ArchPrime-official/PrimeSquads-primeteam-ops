# Task: update-event-status

> Atualizar status de inscrito em evento (presença, no-show, conversão). CS usa durante e pós-evento. Implementa F-17.5 do PRD.

**✅ SCHEMA GROUNDED (2026-07-02):** NÃO existe tabela `events` nem `event_registrations` no schema. Um "evento/lançamento" **É uma `campaign`** e o inscrito/vendedor é uma `opportunity` ligada por `opportunities.campaign_id = campaigns.id` (o UUID PK — confirmado: `opportunities_campaign_id_fkey` → `campaigns.id`). O `event_id` de input é, portanto, o `campaigns.id` (uuid); alternativamente aceita-se o slug humano `campaigns.campaign_id` (text) para resolver o uuid.

**⚠️ `launch_stage` é read-mostly:** a coluna `opportunities.launch_stage` (esteira do funil perpétuo) é gerida pela função viva `lancio_perp_advance_cohorts` (ver `.github/sql/funil-estado-real.sql`). Esta task **NÃO** faz UPDATE manual em `launch_stage` — mexe apenas em `opportunities.stage` (pipeline comercial). Mover pessoas de fase da esteira = função viva, não SQL manual.

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
  - `campaign_id` (uuid — **`campaigns.id`** do evento/lançamento) OU `campaign_slug` (text `campaigns.campaign_id`, resolvido para o uuid)
  - `lead_id` (uuid OU `email` para resolver)
  - `new_status` (`'confirmed' | 'attended' | 'no_show' | 'converted'`)
  - `notes` (string opcional)
  - `attended_at` (ISO timestamp opcional, default NOW se status='attended')
  - `converted_opportunity_id` (uuid opcional, requerido se status='converted')

### output

- **`opportunity_id`** (uuid — a `opportunities.id` atualizada; não há "registration")
- **`old_status`** + **`new_status`**
- **`verdict`** — `DONE | BLOCKED | ESCALATE`
- **`convention_check`** — RLS ✓ / status_transition ✓ / audit ✓

### action_items

1. **Role check:** cs/marketing/admin/owner. Outros → BLOCKED.
2. **Resolver lead_id** (se passou email) e **resolver o campaign uuid**:
   ```sql
   -- se veio campaign_slug em vez do uuid, resolver para campaigns.id
   SELECT id FROM campaigns WHERE campaign_id = {campaign_slug} LIMIT 1;
   ```
3. **Validar `new_status`** ∈ enum válido. Outros → ESCALATE.
4. **Buscar opportunity ativa do lead no evento** (join por `campaigns.id`):
   ```sql
   SELECT o.id, o.stage AS old_stage, o.qualification_data,
          l.name, l.email
   FROM opportunities o
   JOIN leads l ON l.id = o.lead_id
   WHERE o.lead_id = {lead_id}
     AND o.campaign_id = {campaign_id_uuid}   -- = campaigns.id
     AND o.closed_at IS NULL
   LIMIT 1;
   ```
   0 match → ESCALATE com `not_registered` — lead sem opportunity neste evento/campanha.
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

**Input:** `campaign_id={x}` (campaigns.id), `lead_id={y}`, `new_status='attended'`, `attended_at=2026-05-15T19:30:00Z`

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

- **Schema real:** um evento = `campaigns` (PK `id`); inscritos = `opportunities` linkadas por `opportunities.campaign_id = campaigns.id`. Não há tabela `events` nem `event_registrations`.
- **Coluna `attended_at`:** TODO — não existe coluna `attended_at`/`no_show`/`metadata` em `opportunities`. Usar `qualification_data` JSONB como workaround (não emitir SQL contra colunas inexistentes).
- **`launch_stage` (esteira perpétua) é read-mostly:** nunca UPDATE manual aqui — a função viva `lancio_perp_advance_cohorts` avança as coortes. Esta task só toca `opportunities.stage`.
- **Bookings do evento:** agendamentos ficam em `bookings`, sem coluna `campaign_id` — para achar bookings de um evento, join `bookings.opportunity_id` → `opportunities.campaign_id`. (Cuidado: `bookings.event_id` FKs para `booking_events` = tipo de agendamento, NÃO é a campanha do lançamento.)
- **Bulk update:** task é single-row. Para batch (ex: marcar 50 attended de uma vez), usar `bulk-update-opportunities` com filter por `campaign_id`.
- **Stage enum:** sempre validar contra os 25 valores reais (ver move-opportunity-stage.md).

---

**Mantido por:** sales-specialist
