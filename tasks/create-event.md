# Task: create-event

> Task atômica para registrar um novo evento orquestrando: LP de captura, products fiscais, email sequence pré-lançamento. **Marketing-only** (Sandra) ou owner. Implementa F-17.2 + F-17.6 do PRD.

**Cumpre:** HO-TP-001 (Task Anatomy — 8 campos)

---

## Task anatomy

### task_name
`Create Event`

### status
`pending`

### responsible_executor
`content-builder` (orquestra LP + products) com handoffs para `admin-specialist` (products fiscais)

### execution_type
`Agent` — confirmation OBRIGATÓRIO antes do batch INSERT (LP + product linkage).

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload:**
  - `name` (string, obrigatório — nome do evento)
  - `slug` (string, obrigatório — URL slug único)
  - `event_type` (`'workshop' | 'immersione' | 'lancio_online' | 'live'`, obrigatório)
  - `start_date`, `end_date` (ISO 8601 UTC)
  - `capacity` (int opcional, default ilimitado)
  - `target_domain` (`'lp.archprime.io' | 'lovarch.com' | 'archprime.io'`, default `'lp.archprime.io'`)
  - `product_ids` (array uuid, opcional — products já existentes para vincular) OU `create_products` (array `{name, price_eur, type}`)
  - `lp_template` (string opcional — slug de template LP existente)

### output

- **`event_id`** (uuid — `landing_pages.campaign_id` ou nova row em tabela específica se houver)
- **`lp_id`** — uuid da LP criada/clonada
- **`product_ids`** (array)
- **`email_sequence_id`** (opcional)
- **`verdict`** — `DONE | BLOCKED | ESCALATE`
- **`convention_check`** — RLS ✓ / role marketing/owner ✓ / fiscal products ✓

### action_items

1. **Role check:** user.role ∈ `marketing|owner` (admin opcional). Outros → BLOCKED com:
   ```
   Criar eventos requer role marketing ou owner.
   Sua role: {role}. Peça ao admin do seu setor.
   ```
2. **Validar slug uniqueness** em `landing_pages` + outros campos do evento.
3. **Validar dates:** `start_date < end_date`, `start_date > NOW()`.
4. **Resolver/criar products** (se `create_products` presente):
   - Handoff para `admin-specialist.create_event_products` via `wf-finance-recurrence` ou edge `create-evento-products`.
   - Ou usa `product_ids` existentes se passados.
5. **Confirmation message:**
   ```
   Vou criar evento «{name}»:
     - Tipo: {event_type}
     - Período: {start_date} → {end_date} (Europe/Rome)
     - Slug público: https://{target_domain}/{slug}
     - Capacidade: {capacity or 'ilimitada'}
     - Products: {N} ({names})
     - LP: {clonar template / criar do zero}
   Confirma criação? (Após confirma: LP fica em status='draft', invisível até publish)
   ```
6. **Aguardar "sim"** — se "não", ESCALATE com `cancelled_by_user`.
7. **INSERT atomic em batch:**
   - INSERT em `landing_pages` (com status='draft', active=false, blocks copiados de template ou base inicial)
   - INSERT em `products` se `create_products` (handoff admin-specialist)
   - INSERT em `email_sequences` (opcional, draft)
   - Linkagem via `landing_pages.campaign_id` ou tabela de eventos
8. **Tratar erros:**
   - 23505 (UNIQUE slug) → ESCALATE com sugestão alternativa
   - 42501 (RLS) → BLOCKED
   - Partial failure (LP OK mas products falham): log warning + ESCALATE com cleanup info
9. **Activity log:** `action='content-builder.create_event'`, details com event_id + linkagens.
10. **Echo:**
    ```
    ✓ Evento criado (status=draft)
    Event ID: {event_id}
    LP draft: https://{domain}/{slug} (404 público até publish)
    Products: {N} criados
    Próximos passos:
    1. Edit LP via update-cms-page (em squad ou UI editor)
    2. Configure email sequence
    3. Publish LP via publish-cms-page quando estiver pronto
    ```

### acceptance_criteria

- **[A1] Role gating:** marketing/owner only.
- **[A2] Slug uniqueness:** UNIQUE constraint surface antes de INSERT (pre-check).
- **[A3] Date sanity:** start < end, start > now.
- **[A4] LP starts draft:** status='draft', active=false — público não vê até publish explícito.
- **[A5] Product linkage:** se products criados, vincular ao evento (campaign_id ou tabela ponte).
- **[A6] Confirmation OBRIGATÓRIO:** user vê dates + URL + products + N items antes do INSERT.
- **[A7] Audit trail:** activity_logs + LP audit (auto-version trigger).
- **[A8] No silent publish:** task NUNCA faz publish — só cria draft.

---

## Exemplos

### Exemplo 1 — Sandra cria Immersione Roma (DONE)

**Input:** `name=Immersione Roma 2026`, `slug=immersione-roma-2026`, `event_type=immersione`, `start_date=2026-09-15`, `create_products=[{name: 'Early Bird', price: 297}, {name: 'Regular', price: 397}]`

**Specialist:**
1. Role marketing ✓
2. Slug livre ✓
3. Dates ok ✓
4. Handoff admin-specialist → 2 products criados (UUID + Stripe sync)
5. Confirmation shown
6. User: "sim"
7. INSERT LP (template_blocks copiados, status=draft) + linkage
8. Activity log
9. Echo:
    ```
    ✓ Evento criado
    Event ID: e3a4-...
    LP draft: https://lp.archprime.io/immersione-roma-2026
    2 products: Early Bird (€297), Regular (€397)
    Próximos passos: edit LP + configure email sequence + publish
    ```

### Exemplo 2 — CS user (não autorizado) → BLOCKED

**Input:** Jessica (cs) tenta criar evento → BLOCKED com mensagem clara.

### Exemplo 3 — Slug duplicado → ESCALATE

**Input:** slug `immersione-roma-2026` já existe → ESCALATE com sugestão `immersione-roma-2026-edition2`.

---

## Notas

- **Não cria evento publicado:** publish é task separada (`publish-cms-page`).
- **Lancio Online estruturado:** usar `launch-lancio-online.md` (wizard com pré + carrinho + encerramento).
- **Products fiscais:** handoff para admin-specialist garante classificação fiscal HMRC compliant.
- **LP template:** se passado, clonar via `clone-cms-page` (Tier 2 task).

---

**Mantido por:** content-builder
