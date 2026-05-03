# Task: publish-cms-page

> Task atômica para publicar/despublicar uma página `cms_pages`. Toggle status entre `'draft'`/`'archived'` e `'published'`. Valida que blocks não está vazio antes de publicar (página vazia = erro). Bypass cache via webhook automático (cms-revalidate EF posta pra Vercel revalidate).

**Cumpre:** HO-TP-001 (Task Anatomy — 8 campos)

---

## Task anatomy (HO-TP-001 — 8 campos obrigatórios)

### task_name
`Publish CMS Page`

### status
`pending`

### responsible_executor
`content-builder` (CMS Pages module)

### execution_type
`Agent` — LLM + Supabase + EF webhook side-effect. Confirmation step obrigatório (publica conteúdo PÚBLICO).

### input

Entregue pelo `ops-chief`:

- **Cycle ID**: `cyc-YYYY-MM-DD-NNN`
- **User JWT**: `~/.primeteam/session.json`
- **Request payload**:
  - `cms_page_id` (uuid) OR `slug` + `target_domain` (resolver via list-cms-pages)
  - `action` (`'publish'` | `'unpublish'`, default `'publish'`)
  - `version` (int, optional — optimistic lock; se ausente, busca current e usa)

### output

- **`cms_page_id`** — uuid da row mutada
- **`slug`** — slug
- **`target_domain`** — domínio
- **`status_before`** — status antes (`'draft'` | `'archived'` se publish, `'published'` se unpublish)
- **`status_after`** — status depois (`'published'` ou `'draft'`)
- **`version`** — nova version (incrementada)
- **`published_at`** — timestamp (NULL se unpublish)
- **`public_url`** — `https://{target_domain}/page/{slug}` (acessível imediatamente após publish; cache pode levar até 60s)
- **`webhook_status`** — status da chamada cms-revalidate (`'sent'` | `'failed'` | `'skipped'`)
- **`verdict`** — DONE | BLOCKED | ESCALATE
- **`next_step_suggestion`** — "Abra a URL pública para validar render" ou "Espere ~60s pra cache atualizar"
- **`convention_check`**:
  - Page exists: ✓
  - blocks non-empty (para publish): ✓
  - version match (optimistic lock): ✓
  - RLS respected: ✓

### action_items

1. **Resolver target page**:
   - Se `cms_page_id` fornecido: SELECT direct.
   - Se `slug` + `target_domain`: SELECT WHERE slug=? AND target_domain=?. 0 = ESCALATE com create-cms-page suggestion. >1 impossível (UNIQUE constraint).
2. **Validar action** ∈ `{'publish', 'unpublish'}`. Default `'publish'`.
3. **Validar status atual vs action**:
   - `action='publish'` + status atual `'published'` → ESCALATE: "Já está publicada (v{N}, desde {published_at}). Quer republicar (force update timestamp)?"
   - `action='publish'` + status atual `'draft'` ou `'archived'` → OK
   - `action='unpublish'` + status atual `'published'` → OK
   - `action='unpublish'` + status atual `'draft'` → ESCALATE: "Já é draft. Use archive-cms-page (futuro) para arquivar."
4. **Para `action='publish'`: validar conteúdo**:
   - `jsonb_array_length(blocks) >= 1` — se 0, ESCALATE: "Página vazia. Adicione blocos via admin /cms editor visual antes de publicar."
   - Cada bloco passa Zod validation (delegado ao backend cms-pages-api EF — server-side re-valida; CLI não duplica).
5. **Resolver version**:
   - Se `version` no input: usar como expected.
   - Se ausente: usar `version` da row buscada no passo 1.
6. **Confirmation message** — para PUBLISH (action high-impact):
   ```
   ATENÇÃO: vou publicar página em https://{target_domain}/page/{slug}
   Conteúdo público (qualquer pessoa na internet pode acessar):
     - {blocks.length} blocos
     - SEO title: «{seo.title or "—"}»
     - SEO description: «{seo.description or "—"}»
     - Locale: {locale}
   Status: {current_status} → published
   Version: v{N} → v{N+1}
   Cache: pode levar até 60s para a versão antiga sair (Supabase EF cache)
          + webhook automático notifica Vercel revalidate
   Confirma publicação?
   ```
   Para UNPUBLISH:
   ```
   Vou despublicar https://{target_domain}/page/{slug}
   A URL voltará a 404 para usuários (admin ainda vê).
   Confirma?
   ```
7. **Aguardar confirmação** — "sim" prossegue, "não" ESCALATE.
8. **Executar UPDATE atomic** (com optimistic lock):
   ```sql
   UPDATE cms_pages
   SET
     status = CASE
       WHEN {action} = 'publish' THEN 'published'
       ELSE 'draft'
     END,
     published_at = CASE
       WHEN {action} = 'publish' THEN now()
       ELSE NULL
     END,
     version = version + 1,
     updated_at = now()
   WHERE id = {cms_page_id}
     AND version = {expected_version}
   RETURNING id, slug, target_domain, status, version, published_at;
   ```
9. **Tratar erros**:
   - 0 rows updated → CONFLICT (version mismatch — outro user mutou). ESCALATE: "Outro usuário mudou a página (version drift). Re-listar para ver versão atual."
   - 42501 (RLS) → BLOCKED: "Sua role não tem permissão. Publish exige cms_can_edit (owner+admin+marketing)."
   - 23514 (CHECK published_at consistency) → BLOCKED indicando campo (CHECK constraint força `(status='published' AND published_at IS NOT NULL) OR (status≠'published' AND published_at IS NULL)`).
   - 5xx → retry 1x → ESCALATE
10. **Webhook side-effect** (não-blocking):
    - Backend trigger `trg_sync_onboarding_status` ou job background chama EF `cms-revalidate` (PrimeTeam Supabase).
    - cms-revalidate posta pra `https://www.{target_domain}/api/cms/revalidate` com HMAC.
    - Se sucesso: `webhook_status='sent'`. Se 4xx/5xx: `webhook_status='failed'` com warning (UPDATE foi aceito, só o cache não foi invalidado — vai esperar TTL natural 60s).
    - Se webhook não está configurado (env var ausente): `webhook_status='skipped'` (Fase 1 graceful fallback).
11. **Activity log** — INSERT em `activity_logs` com `action='content-builder.publish_cms_page'` ou `unpublish_cms_page`. `details={cms_page_id, slug, target_domain, before:{status,version}, after:{status,version,published_at}, side_effect:'public_url_changes'}`.
12. **Populate next_step_suggestion**:
    - Publish OK + webhook sent: "Página publicada. Abra https://{target_domain}/page/{slug} pra validar (cache pode levar até 60s)."
    - Publish OK + webhook failed: "Página publicada no DB, mas webhook revalidate falhou. Cache pode levar até 60s pra atualizar naturalmente. Verifique em ~1 min."
    - Unpublish: "Página despublicada. URL volta a 404 imediatamente após cache TTL."
13. **Retornar ao chief** — V10 + V11 + V18.

### acceptance_criteria

- **[A1] Action restricted:** apenas `'publish'` ou `'unpublish'`. Outros = BLOCKED.
- **[A2] Status transitions enforced:**
  - publish: draft|archived → published ✓
  - publish: published → ESCALATE (oferece force republish)
  - unpublish: published → draft ✓
  - unpublish: draft → ESCALATE
- **[A3] Empty blocks blocked:** publish exige `jsonb_array_length(blocks) >= 1`.
- **[A4] Confirmation obrigatória:** publish é high-impact (público); unpublish é medium-impact. Sempre echo + confirm.
- **[A5] Optimistic lock:** UPDATE com `WHERE version = {expected}`. 0 rows = CONFLICT, ESCALATE.
- **[A6] CHECK constraint respected:** `(status='published' AND published_at IS NOT NULL)`. UPDATE seta ambos atomic.
- **[A7] Webhook non-blocking:** falha do webhook NÃO falha a task. UPDATE foi aceito; warning ao user sobre cache.
- **[A8] RLS via cms_can_edit:** owner+admin+marketing. JWT scoped.
- **[A9] Activity log:** sempre, fail-tolerant.

---

## Exemplos de execução

### Exemplo 1 — Publish happy path (DONE)

**Input:** `"publica a página promo-italia-jun26 do archprime.io"`

**Specialist:**
1. SELECT WHERE slug='promo-italia-jun26' AND target_domain='archprime.io' → cms-a1b2... status=draft v=2 blocks=[hero, cta, feature-grid]
2. blocks.length=3 ✓
3. Confirmation echoed (user confirma)
4. UPDATE → status=published, version=3, published_at=now()
5. Webhook → 202 sent

**Return:**
```
[content-builder → ops-chief] Cycle cyc-... — DONE.

cms_page_id: cms-a1b2...
slug: promo-italia-jun26
target_domain: archprime.io
status_before: draft
status_after: published
version: 3
published_at: 2026-05-03T22:00:00Z
public_url: https://archprime.io/page/promo-italia-jun26
webhook_status: sent
next_step_suggestion: |
  "Página publicada. Abra https://archprime.io/page/promo-italia-jun26 pra validar
   (cache pode levar até 60s)."
convention_check: page exists ✓ | blocks ≥ 1 ✓ | version match ✓ | RLS ✓
```

### Exemplo 2 — Página vazia (ESCALATE)

**Input:** `"publica home do lovarch.com"` (mas blocks=[])

**Specialist:** SELECT → cms-x... status=draft blocks=[] → A3 violado.

**Return:**
```
verdict: ESCALATE
suggested_user_message: |
  "Página 'home' do lovarch.com está VAZIA (0 blocos). Não posso publicar
   página vazia (renderiza branca em produção).
   Opções:
   1. Abra https://primeteam.archprime.io/admin/cms, selecione 'home',
      adicione Hero/CTA/etc via editor visual, depois rode publish.
   2. Forneça blocks no payload (mas recomendo UI — drag-drop é mais rápido)."
```

### Exemplo 3 — Version conflict (CONFLICT escalate)

**Input:** `"publica home do lovarch.com version 5"` (mas current = v=7)

**Specialist:** UPDATE WHERE version=5 → 0 rows.

**Return:**
```
verdict: ESCALATE
error: { code: 'version_mismatch', expected: 5, actual: 7 }
suggested_user_message: |
  "Outro usuário modificou a página depois de você (você esperava v5, atual é v7).
   Re-liste para ver o estado atual:
   /PrimeteamOps:tasks:list-cms-pages slug=home target_domain=lovarch.com"
```

---

## Notas de implementação

- **Backend trigger pode publicar webhook sozinho:** depending on schema, `cms_pages` pode ter trigger `trg_cms_publish_webhook` que chama `cms-revalidate` EF automatic on UPDATE WHERE status changes. Verificar no schema atual antes de chamar EF manualmente — se trigger existir, CLI **não chama** webhook, só monitora resultado via subsequent SELECT em `webhook_log` (futuro).
- **Cache TTL natural 60s:** `Cache-Control: public, s-maxage=60, stale-while-revalidate=300` na EF GET. Mesmo sem webhook, cache renova em ~60s. Webhook é optimization, não correctness.
- **Preview antes de publicar:** se user quiser validar primeiro, sugerir: `Use the admin UI preview button — gera JWT temporário (1h) que bypass cache: ?preview=<jwt>`.
- **Archive vs unpublish:** `unpublish` volta para `'draft'` (editável). Archive (`'archived'`) é status separado para soft-delete (sem editar mas preserva histórico). Task `archive-cms-page` é separada (futuro).

---

**Mantido por:** content-builder.
