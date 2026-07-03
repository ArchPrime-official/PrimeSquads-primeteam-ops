# Task: generate-landing-page-ai

> Disparar geração de LP via AI (LLM-driven `html_content`). Sandra usa para acelerar criação. Implementa F-09.2.
>
> 🎨 **DS por domínio é OBRIGATÓRIO no brief (HO-TP-003) — este era o pior gap:** o gerador AI NÃO pode sair genérico. Resolva a marca pelo `target_domain` via [`data/domain-brand-ds-registry.yaml`](../data/domain-brand-ds-registry.yaml) e **injete os tokens do Design System da marca no payload** enviado ao LLM (cores, fontes, componentes) — **ArchPrime DS** (Arch Black `#0F0F10`/Arch Gold `#C9995C`, Playfair+Inter) para `*.archprime.io`; **Lovarch DS V8** (`@archprime/lovarch-ds`, gold `#A16207`, "NO BLUE", Playfair/Outfit/DM Sans/Inter) para `lovarch.com`. Pixel: `1588…` ArchPrime | `901…` Lovarch. Sem isso a LP nasce fora da identidade da empresa.

**Cumpre:** HO-TP-001 · HO-TP-003

---

## Task anatomy

### task_name
`Generate Landing Page AI`

### responsible_executor
`content-builder`

### execution_type
`Agent` — confirmation com cost awareness (custo resolvido via `ai-gateway`/`ai_pricing`, nunca hardcoded).

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload:**
  - `brief` (object obrigatório):
    - `title` (string, **obrigatório** — vira `landing_pages.title`, coluna NOT NULL)
    - `goal` (`'lead_capture' | 'product_launch' | 'webinar_signup' | 'sales'`)
    - `target_audience` (string — descrição do público)
    - `tone` (`'professional' | 'casual' | 'urgent' | 'storytelling'`)
    - `key_points` (array — bullet points obrigatórios na LP)
    - `cta_text` (string — call-to-action)
    - `language` (`'pt-BR' | 'it-IT' | 'en' | 'es'` — mapear para `locale` real da tabela: `pt-BR→pt`, `it-IT→it`, `en→en`, `es→es`)
  - `campaign_id` (uuid, **obrigatório** — mesma regra de `create-cms-page`: LP sem campanha é IMPOSSÍVEL, quebra attribution)
  - `template_base` (uuid opcional — usar LP existente como inspiração de estrutura/copy)
  - `target_domain`, `slug` (obrigatórios para LP nova)
  - `model` (modelo LLM a usar via `ai-gateway`, ex: `claude-sonnet-4-5` — o preço é resolvido pela tabela `ai_pricing`, nunca hardcoded na task)

### output

- **`landing_page_id`** (uuid — LP draft criada, `active=false`)
- **`generated_html`** (string — `html_content` gerado)
- **`tokens_used`**, **`cost_usd`** (valor real resolvido via `ai_pricing`/`ai-gateway`, não estimativa fixa)
- **`verdict`** — `DONE | BLOCKED | ESCALATE`

### action_items

1. **Role check:** marketing/admin/owner.
2. **Validar brief:** `title` + demais campos obrigatórios + `key_points` min 1.
3. **`campaign_id` obrigatório:** se ausente → **ESCALATE** (nunca criar LP sem campanha — attribution quebra). Nunca defaultar.
4. **Validar slug uniqueness** + `target_domain` + `locale` (derivado de `language`).
4b. **Resolver DS da marca (HO-TP-003)** — `brand = domains[target_domain].brand` do registry [`data/domain-brand-ds-registry.yaml`](../data/domain-brand-ds-registry.yaml). Montar o objeto `design_system` com os tokens da marca (paleta, fontes, componentes; regra "NO BLUE" no Lovarch) para **injetar no payload do LLM** (passo 8). ArchPrime: Arch Black `#0F0F10`/Arch Gold `#C9995C`, Playfair+Inter. Lovarch: gold `#A16207`/bg `#09090B`, Playfair/Outfit/DM Sans/Inter + componentes `@archprime/lovarch-ds`. **Este passo é o que impede a LP de sair genérica.**
5. **Resolver custo via `ai-gateway`:** a chamada ao LLM passa pela Edge Function `ai-gateway` (`POST /functions/v1/ai-gateway`, JWT de sessão), que resolve o preço pela tabela canônica `ai_pricing` (`provider`+`model`+`variant`) e grava o uso em `creative_api_usage`. **NUNCA hardcodar um custo estimado no código da task** — se for necessário mostrar uma estimativa antes de confirmar, ela deve vir de uma consulta prévia a `ai_pricing` pelo `model` escolhido, não de um número fixo tipo "~$0.03-0.20".
6. **Confirmation:**
   ```
   Vou gerar LP via AI:
     Title: {title}
     Campaign: {campaign_name}
     Goal: {goal}
     Audience: {target_audience}
     Tone: {tone}
     Language: {language} → locale: {locale}
     Marca/DS: {brand} → {DS da marca}  (injetado no prompt do LLM)
     Key points: {N}
     CTA: «{cta_text}»
     Template base: {template_base or 'Genérico'}
     Model: {model}
     Custo estimado (via ai_pricing): ~${cost}

   Após generation, LP fica com active=false (draft) — você revê + edita + publica via publish-cms-page.
   Confirma?
   ```
7. **Aguardar "sim"**.
8. **Invoke ai-gateway** (nunca chamar o provider LLM direto):
   ```typescript
   const { data, error } = await supabase.functions.invoke('ai-gateway', {
     body: {
       provider: 'anthropic', // ou o provider do `model` escolhido
       model,
       payload: { brief, template_base, locale, design_system }, // design_system resolvido no passo 4b (tokens da marca) — SEM ele a LP sai genérica
       mode: 'landing-page-generation',
     },
     headers: { Authorization: `Bearer ${jwt}` }
   });
   ```
   Se a chamada não puder ser proxeada (ex: multipart), fazer a chamada direta ao provider + registrar via `ai-gateway` com `operation: 'log'` + aviso `CUSTO NAO TRACKEADO` no stderr como fallback.
9. **Tratar erros:**
   - 429 (rate limit LLM) → ESCALATE com cooldown
   - 5xx → retry 1x → ESCALATE
   - Output validation: `html_content` vazio/malformado → ESCALATE
10. **Persist como nova LP draft:**
    ```sql
    INSERT INTO landing_pages
      (slug, title, target_domain, locale, campaign_id, html_content, active, created_by)
    VALUES ({slug}, {title}, {domain}, {locale}, {campaign_id}, {html_content}, false, auth.uid())
    RETURNING id;
    ```
    (**Não existe coluna `ai_generated`** em `landing_pages` — não incluir no INSERT.)
11. **Activity log:** action='content-builder.generate_landing_page_ai', details com brief summary + tokens + cost + lp_id + campaign_id.
12. **Echo:**
    ```
    ✓ LP gerada
    LP ID: {lp_id} (active=false, draft)
    Tokens: {tokens}
    Cost: ${cost} (via ai_pricing)
    Preview URL (após publish): https://{domain}/{slug}

    Próximos passos:
    1. Edit via update-landing-page ou UI editor
    2. Validar copy + ajustar visual
    3. Publish via publish-cms-page quando aprovado
    ```

### acceptance_criteria

- **[A1] Role gating:** marketing/admin/owner.
- **[A2] Brief validation:** todos required fields, incluindo `title`.
- **[A3] `campaign_id` obrigatório:** ESCALATE se ausente — nunca defaultar (`forbidden_defaults`).
- **[A4] Custo via ai-gateway/ai_pricing:** nunca hardcodar preço; usuário vê custo real resolvido antes de confirmar.
- **[A5] Confirmation OBRIGATÓRIO:** consome quota paga.
- **[A6] LP starts inactive:** `active=false`, zero risco de publish acidental.
- **[A7] Sem coluna `ai_generated`:** tracking de origem AI vive em `creative_api_usage` (via `ai-gateway`), não em `landing_pages`.
- **[A8] Audit:** activity_log com tokens/cost/lp_id.
- **[A9] Idempotency:** retry interno 1x; ESCALATE depois.
- **[A10] DS da marca injetado (HO-TP-003):** o payload ao LLM inclui `design_system` resolvido do `target_domain` — LP nunca sai genérica/fora de marca. `lovarch.com` → Lovarch DS; `*.archprime.io` → ArchPrime DS.

---

## Exemplos

### Exemplo 1 — Sandra gera LP webinar

**Input:** `brief={title: 'Iscriviti al Webinar AI', goal: 'webinar_signup', target_audience: 'arquitetos italianos 35-50', tone: 'professional', cta_text: 'Iscriviti gratuita', language: 'it-IT', key_points: ['Casos reais', 'Aula gravada', '2h conteúdo']}`, `campaign_id={webinar_campaign_id}`

**Specialist:** confirmation (custo resolvido via ai_pricing) → invoke `ai-gateway` → 5800 tokens, $0.10 → INSERT LP draft (`active=false`) → DONE.

### Exemplo 2 — `campaign_id` ausente → ESCALATE

**Input:** brief completo, sem `campaign_id`

**Specialist:** ESCALATE — "LP sem campaign_id é impossível: attribution quebra. Informe a campanha antes de gerar."

### Exemplo 3 — Quota excedida → ESCALATE

**Input:** LLM retorna 429 via ai-gateway

**Specialist:** ESCALATE com cooldown 30s + suggestion para retry.

### Exemplo 4 — CS tenta gerar → BLOCKED

**Input:** Jessica → BLOCKED (marketing-only).

---

## Notas

- **`html_content`, não `blocks`:** a plataforma não oferece construtor de blocos (ver CLAUDE.md — landing pages são sempre HTML self-contained gerado por Claude Code/AI, com pixel/CAPI embutido). O gerador deve produzir `html_content` pronto para publicar, não `blocks` JSONB.
- **AI cost tracking:** toda chamada ao LLM passa por `ai-gateway`/`logAiCall()`, preço vem de `ai_pricing` (nunca hardcoded). **Não existe** a tabela `landing_page_ai_generations` — uso e custo ficam em `creative_api_usage`, visível em `/gestao` → Creative Studio.
- **Locale mapping:** `landing_pages.locale` usa códigos curtos (`it`, `en`, `pt`, `es`), não `pt-BR`/`it-IT` — sempre mapear o `language` de negócio para o `locale` real antes do INSERT.
- **Pixel/eventID:** se o `html_content` gerado dispara `fbq('track', ...)`, seguir a regra de `eventID` determinístico (nunca `uuid()`/`Date.now()`/`Math.random()`) e nunca usar `document.write()`.
- **Design System por marca (HO-TP-003):** o prompt do LLM DEVE conter os tokens da marca resolvida do `target_domain` (`domain-brand-ds-registry.yaml`). Nunca gerar HTML "genérico bonito" — tem de ser ArchPrime ou Lovarch conforme o domínio.
- **Débito dual-renderer Lovarch (G2):** se `target_domain='lovarch.com'`, a LP é renderizada também pelo repo separado `ByPabloRuanL/lovarch` (mirror de `LovarchPageRenderer`) — mudanças de schema/renderer exigem PR companion no mesmo dia. O renderer é React nativo (hidratação de `<script>`), nunca `document.write()`.
- **Refinement:** task gera draft inicial. Refinamentos sucessivos = `update-landing-page` manual ou nova geração.

---

**Mantido por:** content-builder
