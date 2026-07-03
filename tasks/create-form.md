# Task: create-form

> Criar uma linha em `forms` (moduli públicos, multi-domínio) respeitando RLS de conteúdo, elicitando todos os campos obrigatórios e resolvendo marca/DS/pixel/remetente pelo `target_domain`. É a paridade da `create-cms-page`, mas para FORMS (tabela `forms`, não `landing_pages` nem `evaluation_forms`).

**Cumpre:** HO-TP-001 (anatomy) · **HO-TP-002 (required fields)** · **HO-TP-003 (DS por domínio)** — ver `data/primeteam-platform-rules.md` §12 e §13.

> ⚠️ **Três tabelas de "form" NÃO se confundem:** `forms` = moduli PÚBLICOS por domínio (esta task);
> `evaluation_forms` = NPS/feedback interno (task `create-onboarding-form`); `form_templates`+`form_fields`
> = onboarding por token de cliente (task `manage-form-fields`). Se o pedido é um form público de captação
> em `forms.archprime.io`/`lp.archprime.io`/`lovarch.com`/`archprime.io` → é ESTA task.

> 🎨 **DS/pixel/remetente por domínio (HO-TP-003):** resolva a MARCA pelo `target_domain` via
> [`data/domain-brand-ds-registry.yaml`](../data/domain-brand-ds-registry.yaml). ArchPrime DS (Arch Black
> `#0F0F10`/Arch Gold `#C9995C`, Playfair+Inter) para `*.archprime.io`; Lovarch DS V8 (`@archprime/lovarch-ds`,
> gold `#A16207`, "NO BLUE") para `lovarch.com`. Pixel: `1588…` ArchPrime | `901…` Lovarch. Confirmação de
> Lead (CAPI) e remetente do e-mail de resposta também derivam da marca.

---

## Task anatomy

### task_name
`Create Form (moduli)`

### status
`pending`

### responsible_executor
`content-builder` — registrado no `config.yaml` (tasks registry) + no `task_registry` do agent.

### execution_type
`Agent` — LLM + Supabase. Human confirma antes do INSERT.

### input

Entregue pelo `ops-chief`:

- **Cycle ID**: `cyc-YYYY-MM-DD-NNN`
- **User JWT**: `~/.primeteam/session.json`
- **Request payload:**
  - `slug` (string, kebab-case) — **source: schema NOT NULL**; único por `(target_domain, slug, locale)`
  - `title` (string) — **source: schema NOT NULL**
  - `campaign_id` (uuid) — **source: schema NOT NULL** + **ELICITAR sempre** (sem campanha, attribution do lead quebra)
  - `target_domain` (`'forms.archprime.io'` | `'lp.archprime.io'` | `'lovarch.com'` | `'archprime.io'`) — **ELICITAR sempre** (define a MARCA/DS/pixel via HO-TP-003; nunca assumir ArchPrime)
  - `questions` (jsonb array) — **ELICITAR sempre** (form sem perguntas é inútil; cada item: `{ id, label, type, required, options? }`)
  - `locale` (`'it'` | `'en'` | `'pt'` | `'es'`, default `'it'`) — idioma explícito
  - `identifier_field` (string opcional, recomendado) — qual pergunta identifica o lead (email/telefone) para dedup
  - `meta_pixel_id` (opcional — se ausente, usar o pixel **da marca** do `target_domain`), `capi_enabled` (bool), `google_ads_id`, `tiktok_pixel_id`
  - `redirect_to` / `redirect_to_slug` (opcional — destino pós-submit), `thank_you_config` (jsonb opcional)
  - `html_content` / `css_content` / `styles` (opcional — override visual; senão o `form-render` aplica o layout padrão da marca)

### output
- **`form_id`** (uuid da row criada), `slug`, `target_domain`, `locale`
- **`public_url`** — `https://{target_domain}/{slug}`
- **`verdict`** — DONE | BLOCKED | ESCALATE
- **`next_step_suggestion`**, **`convention_check`**

### action_items
1. **Auth**: RLS de `forms` (conteúdo) — owner/admin/marketing. cs/comercial/financeiro sem gate de conteúdo → BLOCKED (42501).
2. **Elicitar obrigatórios** (nenhum default silencioso): `slug`, `title`, `campaign_id`, `target_domain`, `questions`. Ausente → PERGUNTAR/ESCALATE. `campaign_id` ausente → ESCALATE com `SELECT id, name FROM campaigns WHERE status='active' ORDER BY created_at DESC`.
3. **Resolver marca/DS/pixel/remetente (HO-TP-003)** — `brand = domains[target_domain].brand` do registry `data/domain-brand-ds-registry.yaml`. O layout do form (via `form-render` ou `html_content`) usa o **DS da marca**; se `meta_pixel_id` ausente, usar o pixel da marca; o e-mail de resposta/notificação sai do remetente da marca. Se `target_domain='lovarch.com'`, avisar o débito dual-renderer (PR companion `ByPabloRuanL/lovarch` se mexer em schema/renderer).
4. **Validar** contra o schema real: `slug` regex `^[a-z0-9]+(-[a-z0-9]+)*$`; `target_domain` ∈ enum; `locale` ∈ enum; `questions` é array não-vazio com `type` válido por item; uniqueness `SELECT id FROM forms WHERE target_domain=? AND slug=? AND locale=?` (collision → ESCALATE).
5. **Confirmação** (echo dos valores, incl. marca/DS):
   ```
   Vou criar form (moduli):
     slug: {slug}   ·   domínio: {target_domain}   ·   idioma: {locale}
     título: {title}
     campanha: {campaign_name} ({campaign_id})
     marca/DS: {brand} → {DS da marca}   (resolvido do target_domain)
     perguntas: {N}   ·   identificador: {identifier_field or "—"}
     pixel Meta: {meta_pixel_id or pixel_da_marca}   ·   CAPI: {capi_enabled}
     URL pública: https://{target_domain}/{slug}
   Confirma?
   ```
6. **Write** — INSERT via JWT do user (RLS):
   ```sql
   INSERT INTO forms
     (slug, title, campaign_id, target_domain, locale, questions,
      identifier_field, meta_pixel_id, capi_enabled, google_ads_id,
      tiktok_pixel_id, redirect_to, redirect_to_slug, thank_you_config,
      html_content, css_content, styles, active, created_by)
   VALUES
     ({slug}, {title}, {campaign_id}, {target_domain}, {locale}, {questions}::jsonb,
      {identifier_field}, {meta_pixel_id}, {capi_enabled or false}, {google_ads_id},
      {tiktok_pixel_id}, {redirect_to}, {redirect_to_slug}, {thank_you_config}::jsonb,
      {html_content}, {css_content}, {styles}::jsonb, false, auth.uid())
   RETURNING id, slug, target_domain, locale;
   ```
   (`active=false` na criação — publicação/ativação é passo separado.)
   Erros: `42501` (RLS)→BLOCKED; `23505` (unique `(target_domain,slug,locale)`)→ESCALATE; `23503` (FK `campaign_id`)→BLOCKED; `23502` (NOT NULL)→BLOCKED indicando o campo.
7. **Verificação PÓS-AÇÃO** (obrigatória): `SELECT id, slug, active FROM forms WHERE id={form_id}` confirmando a row criada.
8. **Activity log**: `action='content-builder.create_form'`, `cycle_id`, `details={slug, target_domain, campaign_id, brand, questions_count, before:null, after:{id, active:false}}`.
9. **next_step_suggestion**: "Ative o form (active=true) quando estiver pronto; ele aparece em `https://{target_domain}/{slug}` renderizado por `form-render`. Submissões gravam em `leads` + `campaign_attribution`."

### acceptance_criteria
- **[A1]** Auth correta (owner/admin/marketing; demais BLOCKED).
- **[A2]** TODOS os obrigatórios elicitados: `slug`, `title`, `campaign_id`, `target_domain`, `questions` — nenhum default silencioso.
- **[A3]** `target_domain` explícito → marca/DS/pixel/remetente resolvidos (HO-TP-003); nunca assumir ArchPrime.
- **[A4]** `campaign_id` referencia campanha existente (FK) — ausente = ESCALATE.
- **[A5]** Uniqueness `(target_domain, slug, locale)`; `questions` array não-vazio validado.
- **[A6]** Verificação pós-ação (re-query) confirma a row.
- **[A7]** Nenhuma coluna/tabela fantasma (bate com `types.ts`: `forms`, `campaigns`, `leads`, `campaign_attribution`).

---

## Exemplos

### Exemplo 1 — Form de captação Lovarch (DONE)
**Input:** `"criar form 'iscrizione-workshop' em lovarch.com, campanha WORKSHOP_LOVARCH, perguntas: nome, email, telefone"`
**Specialist:** resolve campaign → uuid; `brand=lovarch` (DS Lovarch, pixel `901…`, e-mail info@lovarch.com); uniqueness ok; confirm; INSERT `active=false`. **Return:** `form_id + URL https://lovarch.com/iscrizione-workshop`.

### Exemplo 2 — Sem campaign_id / sem target_domain (ELICITAR/ESCALATE)
**Input:** `"criar form de contato"`
**Specialist:** ESCALATE — pede `target_domain` (define a marca), `campaign_id` (lista campanhas ativas) e as `questions`. Nunca cria vago nem assume ArchPrime.

### Exemplo 3 — CS tenta criar (BLOCKED)
**Input:** user role=cs → INSERT `42501`. BLOCKED — peça a marketing/owner.

---

## Notas
- **Renderer:** `forms` públicos são renderizados por `form-render` (HTML server-side); submissões vão para `form-submit`/`cms-form-submit`, que grava em `leads` + `campaign_attribution` (form_responses). Segue as regras de Pixel (eventID determinístico do lead, `document.write()` proibido) da §7/HO-TP-003.
- **DS por marca (HO-TP-003):** o visual do form (override `html_content`/`styles` OU layout padrão do `form-render`) usa o DS da marca do `target_domain` — `domain-brand-ds-registry.yaml`. Nunca genérico.
- **Não confundir com** `create-onboarding-form` (`evaluation_forms`, NPS interno) nem `manage-form-fields` (`form_templates`/`form_fields`, onboarding por token).
- Referências: `data/required-fields-registry.yaml`, `data/primeteam-platform-rules.md` §12 e §13, `data/cms-vs-landing-pages.md`.

---

**Mantido por:** content-builder
