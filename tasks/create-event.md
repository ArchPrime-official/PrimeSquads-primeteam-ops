# Task: create-event

> Task atômica para registrar um novo **evento/lançamento** orquestrando: registro da campanha, LP de captura, products fiscais, email sequence pré-lançamento. **Marketing-only** (Sandra) ou owner. Implementa F-17.2 + F-17.6 do PRD.

**✅ SCHEMA GROUNDED (2026-07-02):** NÃO existe tabela `events` no schema real. Um "evento/lançamento" na plataforma **É uma `campaign`** (linha em `campaigns`). Toda a orquestração abaixo gira em torno de `campaigns.id` (o UUID PK). O identificador humano/slug fica em `campaigns.campaign_id` (coluna `text` NOT NULL). Participantes/vendas ligam via `opportunities.campaign_id = campaigns.id`; agendamentos via `bookings` (ligados por `opportunity_id`/`lead_id`, sem coluna própria de campaign).

**Cumpre:** HO-TP-001 (Task Anatomy — 8 campos)

---

## Modelo de dados real (confirmado em `apps/v2/src/integrations/supabase/types.ts`)

| Conceito antigo (inexistente) | Modelo real |
|---|---|
| tabela `events` | `campaigns` (PK `id` uuid) |
| `event_slug` | `campaigns.campaign_id` (text, identificador humano) OU `landing_pages.slug` para a URL pública |
| `event_id` (output) | `campaigns.id` (uuid) — é o valor referenciado por `opportunities.campaign_id`, `landing_pages.campaign_id` |
| inscritos / vendas do evento | `opportunities WHERE campaign_id = <campaigns.id>` |
| agendamentos do evento | `bookings` via `opportunity_id`/`lead_id` (join através de opportunities) |

**Colunas reais de `campaigns` usadas aqui** (todas confirmadas no types.ts):
`id` (uuid), `campaign_id` (text, **NOT NULL**), `name` (text, **NOT NULL**), `status` (text, default), `sector` (text, default), `description` (text), `product_id` (uuid), `start_date` (date), `end_date` (date), `funnel_type` (text), `funnel_strategy` (text), `brand` (text), `platform` (text), `expected_value` (numeric), `default_opportunity_value` (numeric), `target_leads` (int), `metadata` (jsonb), `created_by` (uuid).

**Sem coluna dedicada** em `campaigns` para: `event_type`, `capacity`, `target_domain`, `slug`. Persistir esses em `campaigns.metadata` (jsonb) — NÃO inventar colunas. O `slug` público vive em `landing_pages.slug`.

---

## Task anatomy

### task_name
`Create Event` (cria a campanha de lançamento + artefatos)

### status
`pending`

### responsible_executor
`content-builder` (orquestra campaign + LP + products) com handoffs para `admin-specialist` (products fiscais)

### execution_type
`Agent` — confirmation OBRIGATÓRIO antes do batch INSERT (campaign + LP + product linkage).

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload:**
  - `name` (string, obrigatório — nome do evento/campanha → `campaigns.name`)
  - `slug` (string, obrigatório — identificador único; vira `campaigns.campaign_id` e `landing_pages.slug`)
  - `event_type` (`'workshop' | 'immersione' | 'lancio_online' | 'live'`, obrigatório — guardado em `campaigns.metadata.event_type`; opcionalmente mapeado para `campaigns.funnel_type`)
  - `start_date`, `end_date` (ISO 8601 → `campaigns.start_date` / `campaigns.end_date`, tipo `date`)
  - `capacity` (int opcional → `campaigns.metadata.capacity`; default ilimitado)
  - `target_domain` (`'lp.archprime.io' | 'lovarch.com' | 'archprime.io'`, default `'lp.archprime.io'` → `landing_pages.target_domain`)
  - `product_ids` (array uuid, opcional — products já existentes) OU `create_products` (array `{name, price_eur, type}`)
  - `lp_template` (string opcional — slug de template LP existente para clonar)

### output

- **`campaign_id`** (uuid — **`campaigns.id`**; é o valor usado em `opportunities.campaign_id`, `landing_pages.campaign_id`)
- **`campaign_slug`** — `campaigns.campaign_id` (text) criado
- **`lp_id`** — uuid da LP criada/clonada (`landing_pages.id`)
- **`product_ids`** (array)
- **`email_sequence_id`** (opcional)
- **`verdict`** — `DONE | BLOCKED | ESCALATE`
- **`convention_check`** — RLS ✓ / role marketing/owner ✓ / fiscal products ✓

### action_items

1. **Role check:** user.role ∈ `marketing|owner` (admin opcional). Outros → BLOCKED com:
   ```
   Criar eventos/lançamentos requer role marketing ou owner.
   Sua role: {role}. Peça ao admin do seu setor.
   ```
2. **Validar uniqueness do slug:**
   ```sql
   -- slug não pode colidir nem com campanha nem com LP existente
   SELECT 1 FROM campaigns WHERE campaign_id = {slug} LIMIT 1;
   SELECT 1 FROM landing_pages WHERE slug = {slug} LIMIT 1;
   ```
   Qualquer match → ESCALATE com sugestão alternativa.
3. **Validar dates:** `start_date < end_date`, `start_date > NOW()`.
4. **Resolver/criar products** (se `create_products` presente):
   - Handoff para `admin-specialist` (task `create-evento-products` / edge `create-evento-products`).
   - Ou usa `product_ids` existentes se passados.
5. **Confirmation message:**
   ```
   Vou criar evento/lançamento «{name}» (nova campanha):
     - Tipo: {event_type}
     - Período: {start_date} → {end_date} (Europe/Rome)
     - Slug (campaign_id + LP): {slug}
     - URL pública: https://{target_domain}/{slug}
     - Capacidade: {capacity or 'ilimitada'} (metadata)
     - Products: {N} ({names})
     - LP: {clonar template / criar do zero}
   Confirma criação? (Após confirma: campanha fica status='draft'/'planning', LP status='draft' active=false, invisível até publish)
   ```
6. **Aguardar "sim"** — se "não", ESCALATE com `cancelled_by_user`.
7. **INSERT atomic em batch:**
   - **INSERT em `campaigns`** — a fonte do evento:
     ```sql
     -- campaign_id (text) e name são NOT NULL; sector/status têm default.
     INSERT INTO campaigns (campaign_id, name, status,
                            description, product_id, start_date, end_date,
                            funnel_type, expected_value, default_opportunity_value,
                            metadata, created_by)
     VALUES ({slug}, {name}, 'draft',
             {description}, {product_id_optional}, {start_date}, {end_date},
             {event_type_as_funnel_or_null}, {expected_value_optional}, {ticket_value_optional},
             jsonb_build_object('event_type', {event_type},
                                'capacity', {capacity},
                                'target_domain', {target_domain},
                                'public_slug', {slug}),
             {user_id})
     RETURNING id;   -- este id É o campaign_id (uuid) de output
     ```
   - **INSERT em `landing_pages`** (status='draft', active=false, `campaign_id` = `campaigns.id` retornado acima, `slug` = {slug}, blocks copiados de template ou base inicial)
   - **INSERT em `products`** se `create_products` (handoff admin-specialist), depois setar `campaigns.product_id` se houver product principal
   - **INSERT em `email_sequences`** (opcional, draft)
8. **Tratar erros:**
   - 23505 (UNIQUE em `campaigns.campaign_id` ou `landing_pages.slug`) → ESCALATE com sugestão alternativa
   - 42501 (RLS) → BLOCKED
   - 23502 (NOT NULL — faltou `campaign_id` ou `name`) → ESCALATE, campos obrigatórios
   - Partial failure (campaign OK mas LP/products falham): log warning + ESCALATE com cleanup info (o `campaigns.id` já existe)
9. **Activity log:** `action='content-builder.create_event'`, details com campaign_id (uuid) + campaign_slug + linkagens.
10. **Echo:**
    ```
    ✓ Evento/lançamento criado (campanha status=draft)
    Campaign ID: {campaigns.id}
    Slug: {slug}
    LP draft: https://{domain}/{slug} (404 público até publish)
    Products: {N} criados
    Próximos passos:
    1. Edit LP via update-landing-page (em squad ou UI editor)
    2. Configure email sequence
    3. Publish LP via publish-cms-page quando estiver pronto
    4. Leads/vendas deste evento nascem como opportunities com campaign_id={campaigns.id}
    ```

### acceptance_criteria

- **[A1] Role gating:** marketing/owner only.
- **[A2] Slug uniqueness:** UNIQUE em `campaigns.campaign_id` E `landing_pages.slug` checado antes do INSERT.
- **[A3] Date sanity:** start < end, start > now.
- **[A4] LP starts draft:** status='draft', active=false — público não vê até publish explícito.
- **[A5] Campaign linkage:** LP e (se criados) products vinculam via `campaigns.id`; opportunities futuras usarão `campaign_id={campaigns.id}`.
- **[A6] Confirmation OBRIGATÓRIO:** user vê dates + URL + products + N items antes do INSERT.
- **[A7] Audit trail:** activity_logs + LP audit (auto-version trigger).
- **[A8] No silent publish:** task NUNCA faz publish — só cria draft.
- **[A9] Sem colunas inventadas:** `event_type`/`capacity`/`target_domain` só existem em `campaigns.metadata` (jsonb) ou em `landing_pages` — nunca como colunas soltas de `campaigns`.

---

## Exemplos

### Exemplo 1 — Sandra cria Immersione Roma (DONE)

**Input:** `name=Immersione Roma 2026`, `slug=immersione-roma-2026`, `event_type=immersione`, `start_date=2026-09-15`, `create_products=[{name: 'Early Bird', price: 297}, {name: 'Regular', price: 397}]`

**Specialist:**
1. Role marketing ✓
2. Slug livre em campaigns + landing_pages ✓
3. Dates ok ✓
4. Handoff admin-specialist → 2 products criados (UUID + Stripe sync)
5. Confirmation shown
6. User: "sim"
7. INSERT campaign (campaign_id='immersione-roma-2026', status=draft) → id retornado; INSERT LP (campaign_id=<id>, slug, template_blocks, status=draft)
8. Activity log
9. Echo:
    ```
    ✓ Evento/lançamento criado
    Campaign ID: e3a4-... (uuid)
    Slug: immersione-roma-2026
    LP draft: https://lp.archprime.io/immersione-roma-2026
    2 products: Early Bird (€297), Regular (€397)
    Próximos passos: edit LP + configure email sequence + publish
    ```

### Exemplo 2 — CS user (não autorizado) → BLOCKED

**Input:** Jessica (cs) tenta criar evento → BLOCKED com mensagem clara.

### Exemplo 3 — Slug duplicado → ESCALATE

**Input:** slug `immersione-roma-2026` já existe em `campaigns.campaign_id` → ESCALATE com sugestão `immersione-roma-2026-edition2`.

---

## Notas

- **Um evento É uma campanha:** não há tabela `events`. O output `campaign_id` é `campaigns.id` (uuid), a chave que liga opportunities/LP/bookings.
- **Não cria evento publicado:** publish é task separada (`publish-cms-page`).
- **Lancio Online estruturado:** usar `launch-lancio-online.md` (wizard com pré + carrinho + encerramento) — recebe o `campaign_id` gerado aqui.
- **Products fiscais:** handoff para admin-specialist garante classificação fiscal HMRC compliant.
- **LP template:** se passado, clonar via `clone-landing-page` (Tier 2 task), setando `campaign_id`/`slug` na cópia.
- **TODO/limitação:** `event_type`, `capacity` e `target_domain` não têm colunas dedicadas em `campaigns` — vivem em `campaigns.metadata` (jsonb) até que uma migration dedicada (se necessária) exista. Não emitir SQL contra colunas inexistentes.

---

**Mantido por:** content-builder
