# Task: update-lead

> Atualizar lead (full_name, primary_email, primary_phone, status, score, tags). Comercial usa diariamente. Implementa F-02.

**✅ SCHEMA GROUNDED (2026-07-03):** colunas reais de `leads` (`types.ts`): `full_name` (NOT NULL), `primary_email`, `primary_phone`, `score` (numérico, calculado — `score_last_calculated` marca quando), `score_manual` (override manual, é este que a task escreve), `opted_out`/`opted_out_at`/`opted_out_reason`, `tags` (array), `status` (**text livre, SEM enum/CHECK constraint no banco**). Colunas fantasma removidas: `name`, `email`, `phone`, `owner_id` (leads não tem "owner" — atribuição de responsável é em `opportunities.sales_user_id`/`presales_user_id`, não em leads), `lead_score` (não existe; é `score`/`score_manual`), `notes_append`/`notes` (leads não tem coluna `notes`), `updated_by` (leads não tem essa coluna — só `created_by`).

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name
`Update Lead`

### responsible_executor
`sales-specialist`

### execution_type
`Agent` — confirmation simples.

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload:**
  - `lead_id` (uuid) OR `primary_email` (resolver)
  - `updates` (object subset):
    - `full_name`, `primary_email`, `primary_phone` (E.164)
    - `status` (**texto livre — sem enum no banco**; convenção observada na UI/`LeadsTable.tsx`, uppercase EN: `NEW | CONTACTED | QUALIFIED | PROPOSAL | NEGOTIATION | CLOSED | LOST`, mas a coluna aceita qualquer string — não é constraint de banco, é só convenção de exibição)
    - `tags` (array — `leads.tags`; especificar `tags_add`/`tags_remove` no payload e o specialist resolve o array final)
    - `score_manual` (numeric — override manual; `score` é calculado por `score_last_calculated` e não deve ser sobrescrito diretamente por esta task)
    - `opted_out` (bool — compliance LGPD/GDPR; ao setar `true`, também gravar `opted_out_reason`)

### output

- **`lead_id`**, **`updated_fields`**, **`row_snapshot_after`**
- **`verdict`** — `DONE | BLOCKED | ESCALATE`

### action_items

1. **Role check:** comercial/cs/admin/owner.
2. **Resolver lead:**
   ```sql
   SELECT id, full_name, primary_email, primary_phone, status, opted_out, tags, score, score_manual
   FROM leads WHERE id={lead_id} OR primary_email={primary_email};
   ```
3. **Validar updates:**
   - `primary_email` regex válido (se mudou) — leads NÃO tem constraint de uniqueness em `primary_email`, então não há uniqueness check a fazer
   - `primary_phone` E.164 (se mudou)
   - `status`: **sem enum para validar contra** (coluna text livre, sem CHECK constraint). Não rejeitar valores fora da lista de convenção — apenas normalizar case (uppercase) e avisar se o valor não é um dos observados na UI
   - `score_manual` — validar numérico, sem faixa fixa conhecida no schema (a UI não impõe 0..100; se o negócio quer essa faixa, é regra de produto a confirmar, não constraint de banco)
4. **Status transition validation:** como `status` não tem enum nem terminal formalmente marcado no banco, a única transição realmente protegida é a **imutabilidade pós-venda**: se o lead já tem uma `opportunities.stage = 'SALE_DONE'` fechada (`closed_at IS NOT NULL`), tratar mudanças de `status` como aviso (não bloqueio automático — ver memory `stripe-opp-matching-fix-2026-05-04`, que é sobre `opportunities`, não sobre `leads.status`).
5. **Confirmation:**
   ```
   Update lead {full_name} ({primary_email}):
     Diff:
       {field}: {old} → {new}
       ...
     {opted_out_change ? '⚠️ Mudança em opt-out: ' + old + ' → ' + new : ''}
     {status_change ? 'Status: ' + old + ' → ' + new : ''}
   Confirma?
   ```
6. **UPDATE atomic:**
   ```sql
   UPDATE leads SET {fields}, updated_at=NOW()
   WHERE id={lead_id} RETURNING ...;
   -- NOTA: leads NÃO tem coluna `updated_by` (só `created_by`, setado na criação). Não incluir updated_by no UPDATE.
   ```
7. **Side-effect (GAP CONHECIDO — 2026-07-03):** hoje **não existe** nenhuma edge function nem trigger que cancele automaticamente linhas pendentes em `email_sequence_queue` quando `opted_out` vira `true` por esta task. O que existe: os enrollers de sequence (`*_enroller` cron functions) checam `opted_out IS TRUE` **antes de enfileirar um novo step** (então o lead para de RECEBER passos futuros), mas **não cancelam retroativamente** steps já enfileirados/pendentes. `email-unsubscribe` (EF pública, via link de descadastro no e-mail) é um fluxo DIFERENTE — cancela pendências, mas é acionado pelo próprio destinatário clicando o link, não por este UPDATE administrativo. Se precisar cancelar sequences já enfileiradas ao marcar opt-out manual, é preciso um `UPDATE email_sequence_queue SET status='cancelled' WHERE ...` manual (ou abrir story para criar a EF dedicada) — não afirmar que isso acontece automaticamente.
8. **Activity log:** action='sales-specialist.update_lead', details com diff (PII redacted: email mascarado em log).
9. **Echo:** "✓ Lead atualizado: {N} fields. {opted_out_warning}"

### acceptance_criteria

- **[A1] Role gating:** comercial/cs/admin/owner.
- **[A2] Email/phone validation** se mudou (sem uniqueness check — não há constraint).
- **[A3] Status é texto livre:** normalizar case, não rejeitar por enum inexistente.
- **[A4] PII redaction em logs:** email mascarado, phone last 4.
- **[A5] Opt-out gap documentado:** echo deve avisar que sequences já enfileiradas NÃO são canceladas automaticamente (gap conhecido, sem EF/trigger hoje).
- **[A6] Audit:** activity_log com diff.

---

## Exemplos

### Exemplo 1 — Daniel atualiza phone do lead

**Input:** `lead_id`, `updates={phone='+5511999998888'}`

**Specialist:** validate E.164 ✓ → confirmation → UPDATE → DONE.

### Exemplo 2 — Mudança de status='CLOSED' para 'NEGOTIATION'

**Input:** lead status=CLOSED, tentativa status=NEGOTIATION

**Specialist:** `status` é texto livre (sem terminal real no banco) — UPDATE permitido, mas avisa: "Este lead está marcado CLOSED; confirme se a mudança é intencional" (aviso, não bloqueio automático).

### Exemplo 3 — Set opted_out=true

**Input:** updates={opted_out=true, opted_out_reason='GDPR request'}

**Specialist:** UPDATE → echo "Lead opt-out registrado. ⚠️ Sequences já enfileiradas em email_sequence_queue NÃO são canceladas automaticamente (gap conhecido) — enrollers futuros vão pular este lead, mas pendências existentes exigem cancelamento manual."

---

## Notas

- **`leads.status` não tem enum/CHECK constraint no banco** — é texto livre. A convenção uppercase (`NEW/CONTACTED/QUALIFIED/PROPOSAL/NEGOTIATION/CLOSED/LOST`) vem só da UI (`LeadsTable.tsx`), não é imposta no schema.
- **Terminal real de venda vive em `opportunities.stage` (SALE_DONE/COMPLETED/LOST), não em `leads.status`.** Ver `move-opportunity-stage.md`.
- **Opt-out compliance:** flag `leads.opted_out` é checada pelos enrollers de sequence (bloqueia NOVOS enfileiramentos) mas **não cancela pendências já enfileiradas** — gap conhecido, sem EF/trigger dedicado hoje (2026-07-03).

---

**Mantido por:** sales-specialist
