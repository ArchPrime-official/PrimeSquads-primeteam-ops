# Task: create-landing-page

> Task atômica para criar uma nova linha em `landing_pages`. **SEMPRE active=false** na criação — publicação é operação separada (`activate_lp` playbook). Valida slug kebab-case + uniqueness + html_content mínimo. Resolve campaign/booking_event por nome.

**Cumpre:** HO-TP-001 (Task Anatomy — 8 campos)

---

## Task anatomy (HO-TP-001 — 8 campos obrigatórios)

### task_name
`Create Landing Page`

### status
`pending`

### responsible_executor
`content-builder` (Sprint 7, Landing Pages module)

### execution_type
`Agent` — LLM + Supabase. Human intervention apenas no confirmation step antes do INSERT.

### input

Entregue pelo `ops-chief`:

- **Cycle ID**: `cyc-YYYY-MM-DD-NNN`
- **User JWT**: `~/.primeteam/session.json`
- **Request payload**:
  - `title` (string, obrigatório)
  - `slug` (string opcional — se ausente, content-builder sugere a partir de title; se presente, valida kebab-case + unicity)
  - `html_content` (string, obrigatório — não-vazio, não-"TBD")
  - `css_content` (string opcional)
  - `page_type` (string opcional: "landing" | "sales" | "event" | "thank_you" | "custom"; default "landing")
  - `campaign_id` (uuid) OR `campaign_name` (resolvido via list_campaigns)
  - `campaign_code` (string opcional — label externo)
  - `campaign_sequence` (int opcional — ordem em multi-page campaign)
  - `booking_event_id` (uuid opcional; resolver via name se vier)
  - `meta_pixel_id`, `google_ads_id`, `google_ads_label`, `tiktok_pixel_id` (opcionais)
  - `form_fields` (JSON opcional — estrutura de form; validar JSON se fornecido)
  - `use_thank_you_page` (bool default false)
  - `thank_you_html_content`, `thank_you_css_content` (se use_thank_you_page=true)
  - `page_number` (int opcional — ordem em sequência)

### output

- **`lp_id`** — uuid da row criada
- **`slug`** — slug final validado (pode ter sido convertido de input)
- **`public_url_preview`** — `https://lp.archprime.io/{slug}` (será resolvível apenas após activate)
- **`active`** — SEMPRE false nesta task (publicação = separate cycle)
- **`resolved_fields`**:
  - `campaign_id` (+ name human)
  - `booking_event_id` (+ name se resolvido)
- **`row_snapshot`** — campos inseridos
- **`verdict`** — DONE | BLOCKED | ESCALATE
- **`next_step_suggestion`** — "Use activate_lp para publicar em lp.archprime.io/{slug}"
- **`convention_check`**:
  - Slug kebab-case: ✓
  - Slug unique: ✓
  - html_content non-empty: ✓
  - active=false (safe default): ✓
  - RLS respected: ✓
  - JWT scoped: ✓

### action_items

1. **Parse input** — extrair title + html_content + optional fields.
2. **Validar title** — min 2 chars, não whitespace-only. Se falhar: ESCALATE com `ask_user_for_title`.
3. **Validar html_content** — min 100 chars, não palavras literais "TBD" / "todo" / "placeholder". Se falhar: ESCALATE com options:
   - Pedir html ao user
   - Copiar de LP existente (faz list_lps WHERE page_type=? ORDER BY views DESC LIMIT 3)
   - Route para /ptImprove:design-architect (generation)
4. **Resolver slug** — prioridade:
   - Se `slug` veio no input: validar regex `^[a-z0-9]+(-[a-z0-9]+)*$`. Se inválido, tentar conversion (toLowerCase + replace spaces/underscores with `-` + strip accents) e ECHOAR: "Vou usar slug 'X' (convertido de 'Y'). Confirma?"
   - Se `slug` ausente: derivar de title (lowercase + kebab + accent-stripped) e ECHOAR.
5. **Check slug uniqueness** — `SELECT id FROM landing_pages WHERE slug = {slug}`.
   - 0 matches: OK, prosseguir.
   - 1+ match: ESCALATE com 3 options:
     a) Usar slug alternativo (suggestion: `{slug}-v2`, `{slug}-novo`, etc.)
     b) Se user é owner/admin da LP existente: oferecer overwrite (DELETE + INSERT)
     c) Criar LP nova e apontar `redirect_to_slug` da nova → slug existente
6. **Resolver campaign_id** — se veio `campaign_name`:
   - `SELECT id, name FROM campaigns WHERE name ILIKE '%{term}%' ORDER BY created_at DESC LIMIT 5`
   - 0 matches: warning + prosseguir sem campaign_id
   - 1 match: usar
   - >1 matches: ESCALATE com lista
7. **Resolver booking_event_id** — mesma lógica se veio nome.
8. **Validar form_fields JSON** — se fornecido, parse e check estrutura básica (array de objetos com `name`, `type`, `required`).
9. **Validar thank_you flow** — se `use_thank_you_page=true`, exigir `thank_you_html_content` non-empty. Caso contrário: ESCALATE.
10. **Pixel validation** — se fornecidos IDs, regex básico:
    - `meta_pixel_id`: numeric string
    - `google_ads_id`: "AW-XXXXXXX" format
    - `tiktok_pixel_id`: alphanumeric
    - Se inválido: warning (não block).
11. **Auto-set campos obrigatórios**:
    - `created_by = auth.uid()`
    - `active = false` (NUNCA publish na criação)
    - `views = 0`, `submissions = 0`
12. **Confirmation message** — mostrar TODOS os campos resolvidos + URL preview:
    ```
    Vou criar LP:
    título: «{title}»
    slug: {slug} (URL quando publicada: lp.archprime.io/{slug})
    tipo: {page_type}
    campanha: {campaign_name or "—"} ({campaign_id or "—"})
    booking_event: {event_name or "—"}
    pixels: meta={meta_pixel_id or "—"}, google_ads={google_ads_id or "—"},
            tiktok={tiktok_pixel_id or "—"}
    html: {html_content.length} chars
    css: {css_content.length if present else "—"} chars
    thank_you: {"sim — " + len + " chars" if use_thank_you_page else "não"}
    active: FALSE (draft mode — use activate_lp para publicar)
    Confirma?
    ```
13. **Aguardar confirmação** — "sim" prossegue, "não" ESCALATE.
14. **Executar INSERT** via Supabase (user JWT):
    ```sql
    INSERT INTO landing_pages
      (title, slug, html_content, css_content, page_type,
       campaign_id, campaign_code, campaign_sequence, booking_event_id,
       meta_pixel_id, google_ads_id, google_ads_label, tiktok_pixel_id,
       form_fields, use_thank_you_page,
       thank_you_html_content, thank_you_css_content,
       page_number, created_by, active)
    VALUES
      ({title}, {slug}, {html}, {css}, {page_type},
       {campaign_id}, {campaign_code}, {seq}, {booking_event_id},
       {meta_px}, {google_px}, {google_label}, {tiktok_px},
       {form_fields}, {use_ty},
       {ty_html}, {ty_css},
       {page_num}, auth.uid(), false);
    ```
15. **Tratar erros**:
    - 42501 (RLS) → BLOCKED com role explanation (marketing/admin/owner esperados)
    - 23505 (unique constraint violation em slug — race condition): ESCALATE
      com retry sugestion
    - 23502 (NOT NULL violation) → BLOCKED indicando campo
    - 5xx → retry 1x → ESCALATE
16. **Populate next_step_suggestion** = "Use activate_lp para publicar em lp.archprime.io/{slug} depois de validar o conteúdo."
17. **Retornar ao chief** — V10 + V11 + V18 com lp_id + slug + resolved_fields.

### acceptance_criteria

- **[A1] Title + html_content required:** se qualquer vazio/TBD, ESCALATE (zero Supabase calls).
- **[A2] Slug validation:** regex kebab-case. Se inválido, echo conversion attempt ANTES de prosseguir (user confirma conversão).
- **[A3] Slug uniqueness:** SELECT prévio obrigatório. Collision = ESCALATE com 3 options, nunca overwrite silencioso.
- **[A4] Active=false forced:** NUNCA active=true na criação. Publicação é separate cycle via activate_lp.
- **[A5] Campaign/event resolution:** se names given, resolve via SELECT. 0 = warning, 1 = use, >1 = ESCALATE.
- **[A6] Thank_you coerência:** use_thank_you_page=true sem thank_you_html_content = ESCALATE.
- **[A7] JWT scoping:** INSERT usa user JWT. `created_by` = auth.uid(). Role marketing/admin/owner esperados (RLS valida).
- **[A8] Next step suggestion:** handoff card sempre indica activate_lp como próximo passo.

---

## Exemplos de execução

### Exemplo 1 — Happy path (DONE)

**Input:** `"criar LP título 'Immersione Roma 2026', slug 'immersione-roma-2026', html 3.4k chars fornecido, campanha 'Immersione Roma Abr 2026', page_type event, pixel meta 12345"`

**Specialist:**
1. Title = "Immersione Roma 2026" ✓
2. Slug = "immersione-roma-2026" — regex ok, unique (0 matches) ✓
3. html_content 3.4k chars ✓ (não TBD)
4. page_type = "event"
5. campaign resolve ILIKE → 1 match id=c1b2...
6. meta_pixel_id = "12345" (numeric) ✓
7. Confirmation shown (user confirma)
8. INSERT → lp1a7b8c-... active=false

**Return:**
```
[content-builder → ops-chief] Cycle cyc-... — DONE.

lp_id: lp1a7b8c-...
slug: immersione-roma-2026
public_url_preview: https://lp.archprime.io/immersione-roma-2026
active: false
resolved_fields:
  campaign_id: c1b2... (name: "Immersione Roma Abr 2026")
row_snapshot: { title, slug, page_type: event, meta_pixel_id: "12345", ... }
next_step_suggestion: |
  "LP criada em draft. Use activate_lp para publicar em
   lp.archprime.io/immersione-roma-2026. Recomendo preview em browser
   anônimo após publicar para validar renderização + tracking."
convention_check: slug kebab-case ✓ | slug unique ✓ | html non-empty ✓ | active=false ✓ | RLS ✓
```

### Exemplo 2 — Slug inválido (ESCALATE com conversion)

**Input:** `"criar LP slug 'Evento Roma 2026!'"`

**Specialist:** regex falha (espaço + maiúscula + acento em "!").

**Return:**
```
[content-builder → ops-chief] Cycle cyc-... — ESCALATE.

verdict: ESCALATE
suggested_user_message: |
  "Slug «Evento Roma 2026!» não é válido (precisa ser kebab-case:
   a-z0-9 separados por -).
   Sugestão: slug «evento-roma-2026». Usa essa?"
context_for_retry:
  suggested_slug: "evento-roma-2026"
  original_input: "Evento Roma 2026!"
```

### Exemplo 3 — Slug colisão (ESCALATE)

**Input:** `"criar LP slug 'thank-you'"` (já existe globalmente)

**Specialist:** SELECT WHERE slug='thank-you' → 1 match id=lp00... "Global Thank You Page".

**Return:**
```
[content-builder → ops-chief] Cycle cyc-... — ESCALATE.

verdict: ESCALATE
suggested_user_message: |
  "Slug 'thank-you' já existe: LP id=lp00... «Global Thank You Page»
   (active). Opções:
   1. Usar slug alternativo: 'thank-you-v2', 'thank-you-evento-roma',
      'thank-you-{campanha}'
   2. Se você é dono da LP atual: substituir (DELETE + INSERT) — PERDE
      analytics históricas
   3. Criar outra LP com slug diferente E setar redirect_to_slug='thank-you'
      na nova (tráfego antigo continua em /thank-you)
   Qual?"
context_for_retry:
  existing_lp_id: lp00...
  existing_title: "Global Thank You Page"
  existing_active: true
```

### Exemplo 4 — HTML placeholder (ESCALATE)

**Input:** `"criar LP título 'Novo Produto', slug 'novo-produto', html 'TBD'"`

**Specialist:** html_content = "TBD" — trigger check #3 fails.

**Return:**
```
[content-builder → ops-chief] Cycle cyc-... — ESCALATE.

verdict: ESCALATE
suggested_user_message: |
  "html_content recebido: 'TBD' (placeholder). Preciso HTML real para
   criar LP. Opções:
   1. Passa o html completo (copie/cole)
   2. Uso template de LP existente como base — posso listar as 3 LPs
      de page_type='landing' mais recentes
   3. Route para /ptImprove:design-architect gerar template baseado no
      design system ArchPrime
   4. Route para /metaAds:ryan-deiss para direct-response copy completa
   Qual?"
```

### Exemplo 5 — RLS denial (BLOCKED)

**Input:** user role=cs tentando criar LP.

**Specialist:** tenta INSERT. Supabase rejeita com 42501 (landing_pages RLS exige marketing/admin/owner).

**Return:**
```
[content-builder → ops-chief] Cycle cyc-... — BLOCKED.

verdict: BLOCKED
error: { code: 42501, detail: "row-level security policy denied" }
warnings: |
  Sua role (cs) não tem permissão para criar landing_pages. Policy
  permite apenas marketing, admin e owner.
suggested_next: escalate_to_user
suggested_user_message: |
  "Criação de LP é restrita a roles marketing/admin/owner. Sua role
   atual é cs. Peça a Sandra (marketing) ou Pablo (owner) para
   criar a LP, ou solicite ajuste de role (via admin-specialist em
   Sprint 8+)."
```

---

## Notas de implementação

- **Safe by default:** LP sempre nasce em `active=false`. Exige separate cycle para publicar — dá chance de review.
- **Slug is immutable post-publish:** enforçado no playbook update_lp_slug do agent.
- **Analytics campos NOT touched:** views/submissions/conversion_rate são DB-computed. Task NÃO toca.
- **Block-based editor:** conteúdo é raw HTML em `html_content` (pós-convergência PR #1226). Coluna `blocks` foi removida do schema.
- **Lesson pages:** `lesson_config`, `lesson_html_content`, `lesson_css_content` ficam NULL. Sprint 8+ terá task dedicada.

---

**Mantido por:** content-builder.
