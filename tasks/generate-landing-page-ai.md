# Task: generate-landing-page-ai

> Disparar geração de LP via AI (LLM-driven content + structure). Sandra usa para acelerar criação. Implementa F-09.2.

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name
`Generate Landing Page AI`

### responsible_executor
`content-builder`

### execution_type
`Agent` — confirmation com cost awareness (LLM API quota).

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload:**
  - `brief` (object obrigatório):
    - `goal` (`'lead_capture' | 'product_launch' | 'webinar_signup' | 'sales'`)
    - `target_audience` (string — descrição do público)
    - `tone` (`'professional' | 'casual' | 'urgent' | 'storytelling'`)
    - `key_points` (array — bullet points obrigatórios na LP)
    - `cta_text` (string — call-to-action)
    - `language` (`'pt-BR' | 'it-IT' | 'en'`)
  - `template_base` (uuid opcional — usar LP existente como inspiração)
  - `target_domain`, `slug` (para LP nova)
  - `model` (`'claude-3-5-sonnet' | 'gpt-4'` — default Claude)

### output

- **`landing_page_id`** (uuid — LP draft criada)
- **`generated_blocks`** (array JSONB)
- **`generated_html`** (string opcional — alternativa)
- **`tokens_used`**, **`cost_usd_estimated`**
- **`verdict`** — `DONE | BLOCKED | ESCALATE`

### action_items

1. **Role check:** marketing/admin/owner.
2. **Validar brief:** todos campos obrigatórios + key_points min 1.
3. **Validar slug uniqueness** + domain enum.
4. **Estimate cost:** ~3-8k tokens generation = ~$0.03-0.20 dependendo do model.
5. **Confirmation:**
   ```
   Vou gerar LP via AI:
     Goal: {goal}
     Audience: {target_audience}
     Tone: {tone}
     Language: {language}
     Key points: {N}
     CTA: «{cta_text}»
     Template base: {template_base or 'Genérico'}
     Model: {model}
     Custo estimado: ~${cost}

   Após generation, LP fica DRAFT — você revê + edita + publica via publish-cms-page.
   Confirma?
   ```
6. **Aguardar "sim"**.
7. **Invoke edge `landing-page-ai-generator`:**
   ```typescript
   const { data, error } = await supabase.functions.invoke('landing-page-ai-generator', {
     body: { brief, template_base, model, language },
     headers: { Authorization: `Bearer ${jwt}` }
   });
   ```
8. **Tratar erros:**
   - 429 (rate limit LLM) → ESCALATE com cooldown
   - 5xx → retry 1x → ESCALATE
   - Output validation: blocks JSON malformado → ESCALATE
9. **Persist como nova LP draft:**
   ```sql
   INSERT INTO landing_pages
     (slug, target_domain, locale, blocks, status, active, created_by, ai_generated)
   VALUES ({slug}, {domain}, {locale}, {blocks}, 'draft', false, auth.uid(), true)
   RETURNING id;
   ```
10. **Activity log:** action='content-builder.generate_landing_page_ai', details com brief summary + tokens + cost + lp_id.
11. **Echo:**
    ```
    ✓ LP gerada
    LP ID: {lp_id} (draft)
    Blocks: {N} sections geradas
    Tokens: {tokens}
    Cost: ~${cost}
    Preview URL (após publish): https://{domain}/{slug}

    Próximos passos:
    1. Edit via update-landing-page ou UI editor
    2. Validar copy + ajustar visual
    3. Publish via publish-cms-page quando aprovado
    ```

### acceptance_criteria

- **[A1] Role gating:** marketing/admin/owner.
- **[A2] Brief validation:** todos required fields.
- **[A3] Cost estimate antes:** user vê custo antes de confirmar.
- **[A4] Confirmation OBRIGATÓRIO:** consome quota.
- **[A5] LP starts draft:** zero risco de publish acidental.
- **[A6] AI flag:** `ai_generated=true` permite tracking.
- **[A7] Audit:** activity_log com tokens/cost.
- **[A8] Idempotency:** retry interno 1x; ESCALATE depois.

---

## Exemplos

### Exemplo 1 — Sandra gera LP webinar

**Input:** `brief={goal: 'webinar_signup', target_audience: 'arquitetos italianos 35-50', tone: 'professional', cta: 'Iscriviti gratuita', language: 'it-IT', key_points: ['Casos reais', 'Aula gravada', '2h conteúdo']}`

**Specialist:** confirmation → invoke generator → 5800 tokens, $0.10 → INSERT LP draft → DONE.

### Exemplo 2 — Quota excedida → ESCALATE

**Input:** LLM retorna 429

**Specialist:** ESCALATE com cooldown 30s + suggestion para retry.

### Exemplo 3 — CS tenta gerar → BLOCKED

**Input:** Jessica → BLOCKED (marketing-only).

---

## Notas

- **Edge `landing-page-ai-generator`:** orchestra prompt → LLM → parse → return blocks JSON.
- **Templates:** se `template_base` passado, edge analisa estrutura + replicates pattern com brief novo.
- **Refinement:** task gera initial draft. Refinements sucessivos = `update-landing-page` manual ou nova generation.
- **Cost tracking:** `landing_page_ai_generations` table guarda tokens/cost para audit mensal.

---

**Mantido por:** content-builder
