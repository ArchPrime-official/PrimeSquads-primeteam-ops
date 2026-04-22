# Task: create-finance-transaction

> Task atômica para criar uma nova linha em `finance_transactions`, respeitando RLS `has_finance_access()` (owner + financeiro). Parser de amount/currency/sign, resolução de category/cost_center/account por nome, echo-confirm antes de INSERT.

**Cumpre:** HO-TP-001 (Task Anatomy — 8 campos)

---

## Task anatomy (HO-TP-001 — 8 campos obrigatórios)

### task_name
`Create Finance Transaction`

### status
`pending` *(default até execução pelo platform-specialist dentro de um cycle)*

### responsible_executor
`platform-specialist` (Sprint 3 scope: Tasks + Finance modules)

### execution_type
`Agent` — execução 100% via LLM + Supabase client. Human intervention apenas na etapa de CONFIRMAÇÃO antes do INSERT (e em casos de ambiguidade: múltiplas categorias matching, parser de amount ambíguo).

### input

Entregue pelo `ops-chief` via `*handoff` ceremony:

- **Cycle ID** (obrigatório): `cyc-YYYY-MM-DD-NNN`
- **User JWT**: presente em `~/.primeteam/session.json` (auth já verificada pelo chief no step_1_receive)
- **User role**: extraída da session — informativa, mas a validação real é RLS do Supabase via `has_finance_access()`
- **Request payload** (variável, mas normalmente inclui):
  - `amount` (string ou number) — se string, parser aplica (veja `amount_parsing_rules` no platform-specialist)
  - `type` ("income" | "expense" | "transfer") — se não explícito, infere do sign do amount
  - `transaction_date` (date opcional — default today Europe/Rome)
  - `description` (string, free-form)
  - `category_name` ou `category_id` (um dos dois — se name, faço list_categories filter)
  - `cost_center_name` ou `cost_center_id` (opcional)
  - `bank_account_name` ou `bank_account_id` (opcional; se vier credit_card, não vem bank_account)
  - `credit_card_name` ou `credit_card_id` (opcional)
  - `currency` (ISO 4217, default "EUR")
  - `payment_method` (string opcional: "SEPA", "card", "cash")
  - `notes`, `tags`, `reference` (opcionais)

### output

Retornado ao `ops-chief` via announcement V10 + handoff card V18:

- **`transaction_id`** — uuid da linha criada
- **`type`** — expense | income | transfer (confirmado)
- **`amount`** — valor numeric final (com sign correto)
- **`currency`** — ISO 4217 code usado
- **`resolved_fields`** — objeto com IDs resolvidos a partir de nomes:
  - `category_id` (+ name em hint)
  - `cost_center_id` (opcional)
  - `bank_account_id` ou `credit_card_id` (opcional)
- **`row_snapshot`** — todos os campos INSERTed (para audit)
- **`verdict`** — DONE | BLOCKED | ESCALATE
- **`convention_check`**:
  - amount numeric: ✓
  - sign correct: ✓ (expense=negative, income=positive)
  - RLS respected: ✓ (mutation usou JWT do user)
  - session read-only: ✓
  - currency ISO 4217: ✓
  - i18n: N/A (DB operation)

### action_items

1. **Parse amount** — aplicar `amount_parsing_rules` (€500 → 500, "1.250,00" → 1250, etc.). Se ambíguo (múltiplas interpretações), ESCALATE com `ask_user_for_amount_format`.
2. **Inferir type** — se `type` não explícito:
   - Se amount começa com "-" ou tem palavras como "despesa"/"expense"/"saída" → type=expense, amount negative
   - Se "receita"/"entrada"/"income" → type=income, amount positive
   - Se ambíguo: ECHOAR inferência e pedir confirmação antes de prosseguir
3. **Aplicar sign** — expense = amount negativo; income = positivo; transfer = depende (precisa bank_account + destination_bank_account, fora do scope Sprint 3 — ESCALATE).
4. **Resolver category** — se veio `category_name`:
   - Query `list_categories` com filter `is_active AND (type='{tx_type}' OR type='both') AND name ILIKE '%{term}%'`
   - 0 matches → ESCALATE com `ask_user_which_category` + list options
   - 1 match → usar
   - >1 match → ESCALATE com listagem dos candidatos
5. **Resolver cost_center** — mesma lógica se veio `cost_center_name`.
6. **Resolver conta** — exatamente UM entre `bank_account_id` e `credit_card_id`. Se ambos vierem, ESCALATE. Se nenhum vier e user mencionou algo, fazer lookup; se nada, aceitar NULL (Supabase permite).
7. **Validar transaction_date** — parse natural language se necessário ("hoje", "ontem", "2026-04-20"), resolver a formato DATE (sem timezone — é date, não timestamp). Default today em Europe/Rome.
8. **Confirmar com user** — mostrar TODO o resolvido:
   ```
   Vou lançar: {type} de {currency} {amount}
   descrição: {description or "—"}
   categoria: {category_name} (id: {uuid})
   cost center: {cc_name or "—"}
   conta: {account_name or "—"}
   data: {transaction_date}
   payment_method: {pm or "—"}
   Confirma?
   ```
9. **Aguardar confirmação** — "sim/confirma/ok" → prosseguir. "não" → ESCALATE com `ask_user_for_correction`.
10. **Executar INSERT** via Supabase (user JWT):
    ```sql
    INSERT INTO finance_transactions
      (amount, type, transaction_date, currency,
       description, category_id, cost_center_id,
       bank_account_id, credit_card_id, payment_method,
       notes, tags, reference,
       user_id, status)
    VALUES
      ({amount}, {type}, {date}, {currency},
       {desc}, {cat_id}, {cc_id},
       {bank_id}, {card_id}, {pm},
       {notes}, {tags}, {ref},
       auth.uid(), 'confirmed');
    ```
11. **Tratar erros** — consulte handling em platform-specialist:
    - 42501 (RLS denial, user sem has_finance_access) → BLOCKED clear message
    - 23502 (NOT NULL violation) → BLOCKED indicando campo
    - 23503 (FK violation, ex: category_id inexistente) → BLOCKED indicando FK
    - 5xx / timeout → retry 1x; persistir → ESCALATE
12. **Retornar ao chief** — announcement V10 + output V11 + handoff card V18 com `transaction_id`, `resolved_fields`, `row_snapshot`.

### acceptance_criteria

- **[A1] Amount parsed correctly:** handoff card mostra o valor numeric final + o raw input do user. Se parsing for ambíguo, task TERMINA em ESCALATE (zero Supabase calls).
- **[A2] Sign correct:** expense sempre gravado negativo, income sempre positivo. handoff card tem `sign_inferred_from: "keyword despesa"` ou similar quando o sign não foi explícito no amount.
- **[A3] Category resolved by ID:** se user deu `category_name`, a task resolve para category_id via list_categories e grava no INSERT. Se 0 ou >1 match, ESCALATE (não inventar match).
- **[A4] Account exclusivity:** bank_account_id XOR credit_card_id (ambos não-nulos = ESCALATE). Ambos podem ser null.
- **[A5] Confirmation before mutation:** user vê mensagem com todos os campos resolvidos (incluindo IDs e nomes humanos) antes de qualquer INSERT.
- **[A6] RLS clarity:** se `has_finance_access()` nega, verdict=BLOCKED, error code=42501, mensagem clara mencionando role requirement.
- **[A7] JWT scoping:** INSERT usa o JWT do user (header Authorization). `user_id` gravado é `auth.uid()` do user.
- **[A8] No scope creep:** mesmo que request mencione recorrência (is_recurring/recurrence_*) ou installments, Sprint 3 marca esses campos como read-only. Se user pedir, ESCALATE indicando "recorrência é Sprint 4".

---

## Exemplos de execução

### Exemplo 1 — Happy path (DONE)

**Input do chief:**
```
*handoff @platform-specialist --cycle cyc-2026-04-23-101
Request: "lançar despesa €500 categoria Equipe conta Revolut EUR
          descrição: pagamento Sandra abril"
User role: owner
```

**Specialist executa:**

1. amount="€500" → 500.00 EUR. type="despesa" → expense → sign negative → -500.00.
2. list_categories (type='expense' OR 'both', ILIKE '%equipe%') → 1 match: `7f8... (Equipe)`.
3. list_bank_accounts (ILIKE '%revolut eur%') → 1 match: `b2c... (Revolut EUR)`.
4. transaction_date não explícito → today (2026-04-23).
5. Confirmation:
   ```
   Vou lançar: expense de EUR -500
   descrição: pagamento Sandra abril
   categoria: Equipe (id: 7f8...)
   conta: Revolut EUR (id: b2c...)
   data: 2026-04-23
   Confirma?
   ```
6. User: "sim"
7. INSERT → Supabase retorna id=d4e1a7b8-... . RLS ok (role=owner).
8. Return:
   ```
   [platform-specialist → ops-chief] Cycle cyc-2026-04-23-101 — DONE.

   transaction_id: d4e1a7b8-...
   type: expense
   amount: -500.00
   currency: EUR
   resolved_fields:
     category_id: 7f8... (name: Equipe)
     bank_account_id: b2c... (name: Revolut EUR)
   row_snapshot: { ... }
   convention_check: amount numeric ✓, sign ✓, RLS ✓, session RO ✓
   ```

### Exemplo 2 — Amount ambíguo (ESCALATE)

**Input:** `"lançar 1,250 na categoria Marketing"`

**Specialist:** parse "1,250" — pode ser 1.250 (IT format) ou 1250 (EN format sem decimais visíveis).

**Return:**
```
[platform-specialist → ops-chief] Cycle cyc-... — ESCALATE.

verdict: ESCALATE
suggested_user_message: |
  "Não consigo interpretar «1,250» com certeza:
   - se IT format: €1,25 (um euro e vinte e cinco centavos)
   - se EN format sem decimais: €1.250,00 (mil duzentos e cinquenta euros)
   Qual é?"
convention_check: N/A (nenhuma mutation tentada)
```

### Exemplo 3 — Role sem finance_access (BLOCKED)

**Input:** user role=cs pedindo `"lançar transação -€200"`

**Specialist:** tenta INSERT via Supabase. `has_finance_access()` retorna false para role=cs. Policy nega com PGRST error code 42501.

**Return:**
```
[platform-specialist → ops-chief] Cycle cyc-... — BLOCKED.

verdict: BLOCKED
error: { code: 42501, detail: "row-level security policy denied" }
warnings: |
  Sua role (cs) não tem has_finance_access(). Apenas roles owner e financeiro
  podem criar/editar transações financeiras. Essa é uma restrição de
  segurança da plataforma, não do squad.
suggested_next: escalate_to_user
suggested_user_message: |
  "Operações em Finance são restritas a roles owner e financeiro por
   policy do Supabase. Se você precisa fazer esse lançamento, fale com
   Pablo/Joyce/Larissa/Adriana, ou solicite que sua role seja ajustada
   (via @admin-specialist em Sprint 5)."
```

### Exemplo 4 — Multiple categories matching (ESCALATE with options)

**Input:** `"despesa €100 categoria software"`

**Specialist:** list_categories ILIKE '%software%' retorna 3:
- `a1b...` — "Software - Assinaturas"
- `a2c...` — "Software - Licenças"
- `a3d...` — "Hardware & Software"

**Return:**
```
[platform-specialist → ops-chief] Cycle cyc-... — ESCALATE.

verdict: ESCALATE
suggested_user_message: |
  "Encontrei 3 categorias com 'software':
   1. Software - Assinaturas
   2. Software - Licenças
   3. Hardware & Software
   Qual devo usar?"
context_for_retry:
  candidate_categories: [a1b..., a2c..., a3d...]
  tx_type: expense
  amount: -100
  currency: EUR
convention_check: N/A (nenhuma mutation tentada)
```

---

## Notas de implementação

- **Dependência da CLI auth:** task presume `~/.primeteam/session.json` válido (pre-check no ops-chief step_1_receive).
- **RLS governance:** `has_finance_access()` é source-of-truth. Specialist NÃO replica a lógica client-side — deixa Supabase decidir.
- **Trigger de histórico:** não observado em `finance_transactions`. UPDATEs subsequentes NÃO são auditados no DB (documentado em future_notes do agent). Para criar correção de transação, considerar CREATE de uma nova linha (sign oposto) ao invés de UPDATE destrutivo.
- **Recorrência / installments:** campos `is_recurring`, `recurrence_*`, `installment_*` ficam NULL nesta task (Sprint 3). Sprint 4 adicionará task dedicada `create-recurring-transaction`.
- **Currency conversion:** `exchange_rate`, `converted_amount` etc. ficam NULL a menos que user forneça explicitamente. Auto-conversion é Sprint 5+.

---

**Mantido por:** platform-specialist (self-reference) + ops-chief (orchestration updates em CHANGELOG).
