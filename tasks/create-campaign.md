# Task: create-campaign

> Task atômica para criar uma nova linha em `campaigns`. Uma "campanha" é o container-raiz de um evento/lançamento e é **pré-requisito** de outras tasks (leads, opportunities, landing pages — a atribuição quebra se a LP/opp não apontar para uma campaign existente). Requer apenas `name` (que vira o `campaign_id` humano normalizado). Resto default/nullable no DB.
>
> ⚠️ **LIÇÃO nomenclatura (`campaigns-api`, 2026):** o `name` NÃO é texto livre — é normalizado para `A-Z 0-9 _` (uppercase, espaços viram `_`, acentos removidos), mínimo 3 chars. O `campaign_id` (identificador humano único) é **espelhado do `name` normalizado** (ex: `MM_LANCIO_MAG26`), NÃO é um slug com vogais removidas nem um UUID. NÃO confundir `campaign_id` (text, humano) com `id` (uuid, PK). Um trigger no banco reaplica a regra como última defesa.
>
> ⚠️ **LIÇÃO atribuição (attribution):** `landing_pages.campaign_id` e `opportunities.campaign_id` são FKs para `campaigns.id` (o uuid). Criar a campaign ANTES de criar LP/opp evita `campaign_id NULL` que quebra a atribuição de origem no dashboard `/dati`.

**Cumpre:** HO-TP-001 (Task Anatomy — 8 campos)

---

## Task anatomy (HO-TP-001 — 8 campos obrigatórios)

### task_name
`Create Campaign`

### status
`pending`

### responsible_executor
`sales-specialist` (Sprint 4, CRM/Marketing module) — coordena com `platform-specialist` quando a campanha for pré-requisito de um evento/lançamento.

### execution_type
`Agent` — LLM + Supabase (via Edge Function `campaigns-api`). Human intervention apenas no confirmation step.

### input

Entregue pelo `ops-chief`:

- **Cycle ID**: `cyc-YYYY-MM-DD-NNN`
- **User JWT**: `~/.primeteam/session.json`
- **Request payload**:
  - `name` (string, obrigatório) — será normalizado para nomenclatura `A-Z0-9_` (uppercase). Mín 3 chars pós-normalização. Vira também o `campaign_id`.
  - `sector` (string opcional; DB tem default — ex: "commercial"/"marketing")
  - `status` (string opcional; DB tem default — ex: "active"/"draft")
  - `description` (string opcional, texto livre humano)
  - `product_id` (uuid opcional) OR `product_name` (string, resolvido via SELECT em `products`)
  - `start_date`, `end_date` (date opcional, ISO)
  - `funnel_type` (string opcional — ex: "perpetual"/"launch")
  - `funnel_strategy` (string opcional)
  - `brand` (string opcional — ex: "archprime"/"lovarch")
  - `platform` (string opcional — ex: "meta"/"organic")
  - `expected_value` (number opcional)
  - `default_opportunity_value` (number opcional — valor default das opps geradas)
  - `target_leads` (number opcional)
  - `metadata` (JSON free-form opcional)

> NÃO enviar `campaign_id`, `created_by`, `team_id`: são derivados/auto-set pela `campaigns-api` (campaign_id = name normalizado; created_by = auth.uid(); team_id = do perfil ou fallback default).

### output

- **`campaign_uuid`** — `id` (uuid PK) da row criada
- **`campaign_id`** — identificador humano normalizado (text, ex: `MM_LANCIO_MAG26`)
- **`resolved_fields`**:
  - `product_id` (+ product_name para human readability, se resolvido)
- **`row_snapshot`** — campos inseridos
- **`verdict`** — DONE | BLOCKED | ESCALATE
- **`next_step_suggestion`** — sugestão ao chief (create_landing_page / create_evento_products / list_meta_campaigns)
- **`convention_check`**:
  - `name` normalizado para nomenclatura válida ✓
  - `campaign_id` espelha `name` ✓
  - RLS respected ✓
  - UTC `created_at` ✓
  - Duplicate detection performed ✓ (warn if `campaign_id` já existe)

### action_items

1. **Parse input** — extrair `name` + todos os campos opcionais do payload.
2. **Normalizar e validar `name`** — aplicar a MESMA regra da `campaigns-api`:
   `trim().toUpperCase().replace(/\s+/g,'_').replace(/[^A-Z0-9_]/g,'')`.
   - Se resultado < 3 chars ou vazio: ESCALATE com `ask_user_for_valid_name`
     (mensagem: "Use apenas A-Z, 0-9 e underscore, ex: MM_LANCIO_MAG26. Mín 3 chars.").
   - Ecoar ao user a versão normalizada ANTES de criar (transparência: "Guilherme Maio 26" → `GUILHERME_MAIO_26`).
3. **Resolver product_id** — se veio `product_name`:
   - SELECT id, name FROM products WHERE name ILIKE '%{term}%' ORDER BY created_at DESC LIMIT 5
   - 0 matches → aceitar NULL, warning "produto não encontrado, campanha criada sem product_id"
   - 1 match → usar
   - >1 matches → ESCALATE com lista pedindo pick
4. **Detectar duplicatas** — SELECT id, campaign_id, name FROM campaigns
   WHERE campaign_id = {name_normalizado} LIMIT 3. Se encontrar match:
   - `campaign_id` é o identificador humano — colisão é forte sinal de duplicata.
   - Apresentar no confirmation step como **warning** (não abortar automaticamente; user pode querer sufixar, ex: `..._V2`).
5. **Auto-set campos** (feitos pela `campaigns-api`, NÃO enviar no payload):
   - `campaign_id = {name normalizado}`
   - `created_by = auth.uid()`
   - `team_id = perfil do user OU default `00000000-0000-0000-0000-000000000001``
   - `created_at = now()` (timestamp with tz)
6. **Confirmation message** — mostrar TODOS os campos resolvidos + duplicate warnings:
   ```
   Vou criar campanha:
   name / campaign_id: {name_normalizado}
   setor: {sector or "(default DB)"}
   status: {status or "(default DB)"}
   produto: {product_name or "—"} ({product_id})
   funil: {funnel_type or "—"} / {funnel_strategy or "—"}
   brand/platform: {brand or "—"} / {platform or "—"}
   período: {start_date or "—"} → {end_date or "—"}
   expected_value: {expected_value or "—"} | default_opp_value: {default_opportunity_value or "—"}
   target_leads: {target_leads or "—"}
   {if duplicate campaign_id found: warning}
   Confirma?
   ```
7. **Aguardar confirmação** — "sim" prossegue, "não" ESCALATE com ask_user_for_correction.
8. **Executar CREATE via `campaigns-api`** (caminho canônico de write, user JWT):
   ```
   POST https://<supabase>/functions/v1/campaigns-api
   Authorization: Bearer <user JWT>
   Content-Type: application/json
   body: {
     name, sector?, status?, description?, product_id?,
     start_date?, end_date?, funnel_type?, funnel_strategy?,
     brand?, platform?, expected_value?, default_opportunity_value?,
     target_leads?, metadata?
   }
   ```
   A EF valida a nomenclatura, espelha `campaign_id`, seta `created_by`/`team_id` e retorna 201 com a row.
   **Alternativa (INSERT direto)** se a EF estiver indisponível — respeitar RLS (`campaigns` aceita authenticated) e replicar o auto-set manualmente:
   ```sql
   INSERT INTO campaigns (name, campaign_id, sector, status, description,
     product_id, start_date, end_date, funnel_type, funnel_strategy,
     brand, platform, expected_value, default_opportunity_value,
     target_leads, metadata, created_by, team_id)
   VALUES ({name_norm}, {name_norm}, ...defaults..., auth.uid(), {team_id})
   RETURNING id, campaign_id;
   ```
9. **Tratar erros**:
   - 400 "Nomenclatura inválida" (da EF) → BLOCKED, ecoar a regra ao user
   - 401 Unauthorized → BLOCKED, JWT expirado (sugerir `pto refresh`)
   - 42501 (RLS) → BLOCKED com role explanation
   - 23502 (NOT NULL — ex: `name`/`campaign_id` faltando) → BLOCKED indicando campo
   - 23503 (FK violation — ex: `product_id` inexistente) → BLOCKED indicando qual FK falhou + sugestão de validar antes
   - 23505 (unique violation — ex: `campaign_id` duplicado se houver constraint) → BLOCKED
   - 5xx → retry 1x, persistir → ESCALATE
10. **Suggest next step** — baseado em input context:
    - Se user mencionou "evento"/"lançamento": sugerir create_evento_products + create_landing_page (LP precisa do `campaign_id` uuid para atribuição)
    - Se mencionou "anúncios"/"meta": sugerir list_meta_campaigns / vincular
    - Caso contrário: `next_step_suggestion = null`, chief decide close
11. **Retornar ao chief** — announcement V10 + V11 + V18 com `campaign_uuid`, `campaign_id`, `resolved_fields`, `next_step_suggestion`.

### acceptance_criteria

- **[A1] Name normalization:** task SEMPRE normaliza `name` para `A-Z0-9_` e ecoa a versão normalizada ao user antes de criar. Se pós-normalização < 3 chars, ESCALATE. Zero calls de write.
- **[A2] campaign_id espelha name:** o `campaign_id` (text, humano) resultante é IGUAL ao `name` normalizado — nunca um UUID, nunca um slug divergente. Task NÃO envia `campaign_id` no payload (a EF o deriva).
- **[A3] id vs campaign_id:** o output distingue `campaign_uuid` (id, PK, usado por FKs de LP/opp) de `campaign_id` (text humano). Nunca trocar um pelo outro.
- **[A4] Duplicate detection:** task SEMPRE faz SELECT prévio por `campaign_id` normalizado. Colisão vira warning no confirmation — NÃO bloqueia (user pode sufixar).
- **[A5] Product resolution:** se veio `product_name`, task resolve para ID via SELECT. 0 matches = warning (não block). >1 = ESCALATE.
- **[A6] JWT scoping:** write usa user JWT via `campaigns-api`. `created_by` = auth.uid(); `team_id` = perfil ou fallback default (a EF resolve).
- **[A7] Next step suggestion:** handoff card inclui `next_step_suggestion` (pode ser null). Chief decide se aceita ou faz novo cycle.
- **[A8] No implicit scope creep:** task NÃO cria produtos, LP nem opportunities automaticamente mesmo se user disser "crie a campanha e já monta o evento". Suggested_next aponta, chief roteia novos cycles.

---

## Exemplos de execução

### Exemplo 1 — Happy path (DONE)

**Input:** `"criar campanha Lancio Maggio 26, setor marketing, produto Immersione Milano, funil launch, brand archprime, plataforma meta"`

**Specialist:**
1. name = "Lancio Maggio 26" → normalizado `LANCIO_MAGGIO_26` ✓ (ecoa ao user)
2. product: SELECT ILIKE '%immersione milano%' → 1 match: "Immersione Milano" id=p9a1...
3. Duplicate check: 0 matches para campaign_id `LANCIO_MAGGIO_26`
4. Confirmation (user confirma)
5. POST campaigns-api → 201 id=cmp7f3... campaign_id=`LANCIO_MAGGIO_26`

**Return:**
```
[sales-specialist → ops-chief] Cycle cyc-... — DONE.

campaign_uuid: cmp7f3...
campaign_id: LANCIO_MAGGIO_26
resolved_fields:
  product_id: p9a1... (name: "Immersione Milano")
row_snapshot: {
  name: "LANCIO_MAGGIO_26", campaign_id: "LANCIO_MAGGIO_26",
  sector: "marketing", funnel_type: "launch", brand: "archprime",
  platform: "meta", product_id: "p9a1...", created_by: "<user_uuid>",
  team_id: "<team_uuid>"
}
next_step_suggestion: "create_landing_page (usar campaign_uuid p/ atribuição) + create_evento_products"
convention_check: name normalizado ✓ | campaign_id espelha name ✓ | RLS ✓ | duplicate check ✓
```

### Exemplo 2 — Nomenclatura ecoada + duplicate warning (DONE com aviso)

**Input:** `"cria a campanha Perpetuo Giugno"`

**Specialist:** normaliza `PERPETUO_GIUGNO`. SELECT detecta campaign existente com esse `campaign_id`.

**Confirmation:**
```
Vou criar campanha:
name / campaign_id: PERPETUO_GIUGNO   (normalizado de "Perpetuo Giugno")
setor: (default DB)
⚠ WARNING: já existe campanha com campaign_id PERPETUO_GIUGNO:
  - id=cmp1a2... "PERPETUO_GIUGNO" criada 2026-06-01 (status=active)
Confirma mesmo assim? (dica: sufixar, ex: PERPETUO_GIUGNO_V2)
```

User: "não, usa PERPETUO_GIUGNO_V2".

**Return:** DONE com `campaign_id: PERPETUO_GIUGNO_V2`, `warnings.duplicate_detected: [{campaign_id: "PERPETUO_GIUGNO"}]`

### Exemplo 3 — Produto ambíguo (ESCALATE)

**Input:** `"criar campanha Test Roma com produto Roma"`

**Specialist:** SELECT products ILIKE '%roma%' retorna 3.

**Return:**
```
[sales-specialist → ops-chief] Cycle cyc-... — ESCALATE.

verdict: ESCALATE
suggested_user_message: |
  "Encontrei 3 produtos com 'Roma'. Qual é?
   1. Immersione Roma
   2. Masterclass Roma
   3. Roma Test"
context_for_retry:
  normalized_name: "TEST_ROMA"
  candidate_product_ids: [p1..., p2..., p3...]
```

### Exemplo 4 — Nome curto demais pós-normalização (ESCALATE)

**Input:** `"criar campanha «!!»"`

**Specialist:** normalização remove tudo → string vazia / < 3 chars.

**Return:**
```
[sales-specialist → ops-chief] Cycle cyc-... — ESCALATE.

verdict: ESCALATE
suggested_user_message: |
  "«!!» não gera um nome válido (só A-Z, 0-9 e underscore, mín 3 chars).
   Informe algo como MM_LANCIO_MAG26."
```

---

## Notas de implementação

- **`campaigns-api` é o write canônico (SSoT):** POST cria, PATCH atualiza. A EF centraliza a normalização de nomenclatura + auto-set de `created_by`/`team_id`. Preferir SEMPRE a EF ao INSERT cru — replicar a lógica na mão é frágil.
- **`campaign_id` (text) ≠ `id` (uuid):** o `campaign_id` é o identificador humano legível (nomenclatura corporativa); o `id` é a PK uuid usada pelas FKs `opportunities.campaign_id → campaigns.id` e `landing_pages.campaign_id → campaigns.id`. LP/opp SEM `campaign_id` (uuid) quebram atribuição no `/dati`.
- **Colisão de campaign_id NÃO é abortada:** é warning. User pode sufixar (`_V2`, `_2026`). Nunca inventar um campaign_id divergente do name.
- **RLS:** `campaigns` aceita qualquer authenticated; a EF aplica fallback de `team_id` porque nem todo user (admin/owner) tem `team_id` populado. Task NÃO replica a lógica de RLS — deixa Supabase/EF decidir.
- **Um evento/lançamento É uma campaign:** as tasks de evento (create-evento-products, create-landing-page, launch-lancio-online) assumem uma campaign já existente. Rodar esta task PRIMEIRO.

---

**Mantido por:** sales-specialist.
