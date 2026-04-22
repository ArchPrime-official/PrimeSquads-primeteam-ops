# Task: create-lead

> Task atômica para criar uma nova linha em `leads`. Requer `full_name`. Campos opcionais (email, phone, source, campaign_id) resolvidos com inferência + echo de confirmação.

**Cumpre:** HO-TP-001 (Task Anatomy — 8 campos)

---

## Task anatomy (HO-TP-001 — 8 campos obrigatórios)

### task_name
`Create Lead`

### status
`pending`

### responsible_executor
`sales-specialist` (Sprint 4, CRM module)

### execution_type
`Agent` — LLM + Supabase. Human intervention apenas no confirmation step.

### input

Entregue pelo `ops-chief`:

- **Cycle ID**: `cyc-YYYY-MM-DD-NNN`
- **User JWT**: `~/.primeteam/session.json`
- **Request payload**:
  - `full_name` (string, obrigatório)
  - `primary_email` (string opcional; valido via regex simples se presente)
  - `primary_phone` (string opcional, free-form)
  - `source` (enum opcional: "booking" | "landing_page" | "manual" | "import"; default "manual")
  - `campaign_id` (uuid) OR `campaign_name` (string, resolvido via SELECT)
  - `location_city`, `location_country`, `location_state` (opcional)
  - `tags` (array de strings)
  - `custom` (JSON free-form)
  - `profession`, `income_currency`, `income_value` (opcional, para scoring)
  - `main_desire`, `main_pain` (free-form para qualification data)

### output

- **`lead_id`** — uuid da row criada
- **`resolved_fields`**:
  - `campaign_id` (+ campaign_name para human readability)
- **`row_snapshot`** — campos inseridos
- **`verdict`** — DONE | BLOCKED | ESCALATE
- **`next_step_suggestion`** — sugestão ao chief (qualify_lead / create_opportunity)
- **`convention_check`**:
  - `full_name` não-vazio ✓
  - RLS respected ✓
  - UTC `created_at` ✓
  - Duplicate detection performed ✓ (warn if exists)

### action_items

1. **Parse input** — extrair `full_name` + todos os campos opcionais do payload.
2. **Validar `full_name`** — min 2 chars, não apenas whitespace. Se falhar: ESCALATE com `ask_user_for_name`.
3. **Validar email (se presente)** — regex simples `^[^@]+@[^@]+\.[^@]+$`. Se falhar: ESCALATE com `ask_user_for_valid_email` (NÃO auto-corrigir).
4. **Resolver campaign_id** — se veio `campaign_name`:
   - SELECT id, name FROM campaigns WHERE name ILIKE '%{term}%' ORDER BY created_at DESC LIMIT 5
   - 0 matches → aceitar NULL, warning "campanha não encontrada, lead criado sem campaign_id"
   - 1 match → usar
   - >1 matches → ESCALATE com lista pedindo pick (user pode ter várias campanhas similares)
5. **Detectar duplicatas** — SELECT id, full_name, primary_email FROM leads
   WHERE primary_email = {email} OR (full_name ILIKE {name} AND created_at > now() - interval '30 days')
   LIMIT 3. Se encontrar matches:
   - **NÃO** abortar automaticamente (user pode estar cadastrando mesma pessoa intencionalmente — ex: lead de outro produto)
   - Apresentar os matches no confirmation step como warning
6. **Inferir source se ausente** — default "manual" (user criando via CLI/Claude = manual).
7. **Auto-set campos**:
   - `created_by = auth.uid()`
   - `status = "NEW"`
   - `created_at = now()` (timestamp with tz)
8. **Confirmation message** — mostrar TODOS os campos resolvidos + duplicate warnings:
   ```
   Vou criar lead:
   nome: {full_name}
   email: {primary_email or "—"}
   telefone: {primary_phone or "—"}
   fonte: {source}
   campanha: {campaign_name or "—"} ({campaign_id})
   location: {city}, {country}
   {if duplicates found: warning com lista}
   Confirma?
   ```
9. **Aguardar confirmação** — "sim" prossegue, "não" ESCALATE com ask_user_for_correction.
10. **Executar INSERT** via Supabase (user JWT):
    ```sql
    INSERT INTO leads
      (full_name, primary_email, primary_phone, source, campaign_id,
       location_city, location_country, location_state, tags,
       profession, income_currency, income_value, main_desire, main_pain,
       custom, created_by, status)
    VALUES
      ({name}, {email}, {phone}, {source}, {campaign_id},
       {city}, {country}, {state}, {tags},
       {profession}, {income_currency}, {income_value}, {desire}, {pain},
       {custom}, auth.uid(), 'NEW');
    ```
11. **Tratar erros**:
    - 42501 (RLS) → BLOCKED com role explanation
    - 23502 (NOT NULL) → BLOCKED indicando campo
    - 23505 (unique violation, ex: email duplicate se houver constraint) → BLOCKED
    - 5xx → retry 1x, persistir → ESCALATE
12. **Suggest next step** — baseado em input context:
    - Se user mencionou "qualificar" ou "presales user X": sugerir qualify_lead
    - Se mencionou "criar oportunidade": sugerir create_opportunity
    - Caso contrário: `next_step_suggestion = null`, chief decide close
13. **Retornar ao chief** — announcement V10 + V11 + V18 com `lead_id`, `resolved_fields`, `next_step_suggestion`.

### acceptance_criteria

- **[A1] full_name validation:** se vazio/só whitespace, task termina ESCALATE. Zero Supabase calls.
- **[A2] Email format validation:** se veio email malformado, ESCALATE (não silenciosamente aceitar).
- **[A3] Duplicate detection:** task SEMPRE faz SELECT prévio para detectar possíveis duplicatas (email match OR name-match recente). Warnings apresentados no confirmation — NÃO bloqueiam.
- **[A4] Campaign resolution:** se veio `campaign_name`, task resolve para ID via SELECT. 0 matches = warning (não block). >1 = ESCALATE.
- **[A5] JWT scoping:** INSERT usa user JWT. `created_by` = auth.uid().
- **[A6] Source default:** se não especificado, default "manual" (echo no confirmation).
- **[A7] Next step suggestion:** handoff card inclui campo `next_step_suggestion` (pode ser null). Chief decide se aceita ou faz um novo cycle.
- **[A8] No implicit scope creep:** task NÃO cria opportunity automaticamente mesmo se user disser "crie lead e já abre opp". Suggested_next aponta, chief roteia um novo cycle.

---

## Exemplos de execução

### Exemplo 1 — Happy path (DONE)

**Input:** `"criar lead Marco Rossi, email marco@example.com, telefone +39 348 1234567, vindo da landing page immersione, campanha abril 2026"`

**Specialist:**
1. full_name = "Marco Rossi" ✓
2. email = "marco@example.com" ✓ (regex ok)
3. phone = "+39 348 1234567"
4. source = "landing_page" (parse de "vindo da landing page")
5. campaign: SELECT ILIKE '%abril 2026%' → 1 match: "Immersione Roma — Abril 2026" id=c1b2...
6. Duplicate check: 0 matches para marco@example.com
7. Confirmation (user confirma)
8. INSERT → id=l8f3...

**Return:**
```
[sales-specialist → ops-chief] Cycle cyc-... — DONE.

lead_id: l8f3...
resolved_fields:
  campaign_id: c1b2... (name: "Immersione Roma — Abril 2026")
row_snapshot: {
  full_name: "Marco Rossi", primary_email: "marco@example.com",
  primary_phone: "+39 348 1234567", source: "landing_page",
  campaign_id: "c1b2...", status: "NEW", created_by: "<user_uuid>"
}
next_step_suggestion: "qualify_lead se chief aprovar (convenção: após LP intake)"
convention_check: full_name ✓ | email format ✓ | RLS ✓ | duplicate check ✓
```

### Exemplo 2 — Duplicate warning (DONE com aviso)

**Input:** `"criar lead Anna Bianchi email anna@test.com"`

**Specialist:** SELECT detecta lead existente com mesmo email criado há 5 dias.

**Confirmation:**
```
Vou criar lead:
nome: Anna Bianchi
email: anna@test.com
fonte: manual
⚠ WARNING: já existe lead com esse email:
  - id=l1a2... "Anna Bianchi" criado 2026-04-19 (status=CONTACTED)
Confirma mesmo assim?
```

User: "sim" (está intencional — novo produto).

**Return:** DONE com `warnings.duplicate_detected: [{id: l1a2..., reason: "same email"}]`

### Exemplo 3 — Campanha ambígua (ESCALATE)

**Input:** `"criar lead Giulia Verdi da campanha Roma"`

**Specialist:** SELECT campaigns ILIKE '%roma%' retorna 3:
- "Immersione Roma — Abril 2026"
- "Evento Roma Settembre 2025"
- "Roma Test Campaign"

**Return:**
```
[sales-specialist → ops-chief] Cycle cyc-... — ESCALATE.

verdict: ESCALATE
suggested_user_message: |
  "Encontrei 3 campanhas com 'Roma':
   1. Immersione Roma — Abril 2026 (ativa)
   2. Evento Roma Settembre 2025 (encerrada)
   3. Roma Test Campaign (draft)
   Qual é?"
context_for_retry:
  candidate_campaign_ids: [c1b2..., c3d4..., c5e6...]
```

### Exemplo 4 — Email inválido (ESCALATE)

**Input:** `"criar lead Paolo paolo@"`

**Specialist:** regex email falha.

**Return:**
```
[sales-specialist → ops-chief] Cycle cyc-... — ESCALATE.

verdict: ESCALATE
suggested_user_message: |
  "Email «paolo@» não é válido. Informe um email completo (ex:
   paolo@example.com) ou omita o campo se não houver."
```

---

## Notas de implementação

- **Dedup NÃO é unique constraint:** DB não força email único (campo é opcional). Detecção é só WARNING. User decide.
- **Campaign vs no-campaign:** aceitar NULL é OK (leads manuais sem campanha ocorrem). Nunca inventar campaign_id.
- **RLS:** pós-Fase 0, leads também têm políticas role-based (owner/admin/marketing all access; comercial via assignment). Task NÃO replica a lógica — deixa Supabase decidir.

---

**Mantido por:** sales-specialist.
