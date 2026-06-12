# Task: launch-lancio-online

> Task orquestradora para iniciar **Lancio Online estruturado** (formato launch ArchPrime: pré-lançamento → carrinho aberto → encerramento). Cria 4 LPs + 3 email sequences + flow de upsell. Wizard guiado. **Marketing-only**. Implementa F-17.3 do PRD.

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name
`Launch Lancio Online`

### responsible_executor
`content-builder` (orquestra LPs + email sequences + flow)

### execution_type
`Agent` — multi-phase wizard com confirmation antes de cada batch.

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload:**
  - `event_id` (uuid — evento criado via `create-event`)
  - `lancio_name` (string — ex: "Basta Aspettare Maggio 2026")
  - `phases` (object):
    - `pre_launch_start` (ISO date) — quando começa aquecimento
    - `cart_open` (ISO date) — abertura carrinho
    - `cart_close` (ISO date) — encerramento
  - `products` (array uuid — early bird, regular, vip já criados)
  - `templates` (object opcional):
    - `pre_lp_template`, `cart_lp_template`, `thank_you_template`, `upsell_lp_template`

### output

- **`lancio_id`** (uuid)
- **`lp_ids`**: `{pre_capture, cart, thank_you, upsell}` — 4 UUIDs
- **`email_sequence_ids`**: `{pre_launch, cart_open, cart_close}` — 3 UUIDs
- **`flow_id`** — automation flow para upsell pós-compra
- **`verdict`** — `DONE | BLOCKED | ESCALATE`

### action_items

1. **Role check:** marketing/owner only. Outros → BLOCKED.
2. **Validar event_id existe** + tem products vinculados.
3. **Validar fases:**
   - `pre_launch_start < cart_open < cart_close`
   - Janela carrinho >= 24h (sanity)
   - Todas dates futuras
4. **Wizard preview** — apresenta plano completo:
   ```
   Vou criar Lancio Online «{lancio_name}»:

   FASE 1 — Pré-Lançamento ({pre_launch_start} → {cart_open})
     • LP captura (lead magnet) → {pre_lp_url}
     • Email sequence 5 dias (warm up + autoridade + dor + visão + transformação)

   FASE 2 — Carrinho Aberto ({cart_open} → {cart_close})
     • LP de venda → {cart_lp_url}
     • Products: {early_bird, regular, vip}
     • Email sequence 3 dias (lançamento + urgência + última chance)

   FASE 3 — Pós-Compra
     • LP thank you → {thank_you_url}
     • LP upsell (se aplicável) → {upsell_url}
     • Automation flow: comprou → email confirmação + upsell delay 24h

   FASE 4 — Encerramento ({cart_close})
     • LP redireciona para waiting list (próximo lancio)

   Total: 4 LPs (draft) + 3 email sequences (draft) + 1 flow (draft)

   Confirma orquestração? (Tudo fica draft — você ativa fase a fase quando estiver pronto)
   ```
5. **Aguardar "CONFIRMO LANCIO"** (uppercase literal — operação envolve múltiplas mutations).
6. **Batch INSERT em fases:**

   **Fase 1:** INSERT pre_capture LP + cart LP + thank_you LP + upsell LP (todos status='draft', active=false)

   **Fase 2:** INSERT 3 email_sequences com placeholder steps

   **Fase 3:** INSERT 1 automation_flow draft com nodes básicos

   **Fase 4:** Linkagem cross-table (event_id, campaign_id)

7. **Tratar partial failure:**
   - Se LPs OK mas sequences falham → log warning + cleanup option
   - Se flow falha → log warning, sequence sem flow é editável manual

8. **Activity log STRICT:** `action='content-builder.launch_lancio_online'`, details com TUDO criado (4 LP IDs + 3 seq IDs + 1 flow ID + event_id).

9. **Echo final:**
   ```
   ✓ Lancio Online criado (todos drafts)

   📄 LPs (4): pre / cart / thank-you / upsell
   📧 Email sequences (3): pre-launch / cart-open / cart-close
   🤖 Automation flow (1): post-purchase upsell

   Próximos passos:
   1. Edite cada LP (update-cms-page ou UI)
   2. Edite email sequences (UI editor)
   3. Configure automation flow nodes (UI)
   4. Quando pronto: publish-cms-page para cada LP em ordem temporal
   5. Active automation flow via activate-automation-flow

   Calendário sugerido:
   - {pre_launch_start - 7d}: edição completa LPs + sequences
   - {pre_launch_start}: publish pre_capture LP + ativa pre-launch sequence
   - {cart_open}: publish cart LP + ativa cart-open sequence
   - {cart_close}: redirect cart LP para waiting list
   ```

### acceptance_criteria

- **[A1] Marketing/owner only.**
- **[A2] Phase validation:** pré < carrinho_abre < carrinho_fecha; janela >= 24h; futuras.
- **[A3] Tudo draft:** zero items publicados — user ativa explicitamente cada um.
- **[A4] Tripla confirmation:** "CONFIRMO LANCIO" literal uppercase (não "confirma" comum) por escala da operação.
- **[A5] Atomic-ish batch:** se LPs OK mas sequences/flow falham, audit log captura partial state + cleanup info.
- **[A6] Linkagem:** todos artifacts apontam para event_id (rastreabilidade).
- **[A7] Echo educacional:** próximos passos explícitos com timing sugerido.

---

## Exemplos

### Exemplo 1 — Sandra inicia Basta Aspettare Maggio (DONE)

**Input:** `event_id` (evento criado), 3 fases definidas, 3 products vinculados.

**Specialist:** Wizard preview → "CONFIRMO LANCIO" → batch INSERT 4+3+1 → activity log → echo com calendário.

### Exemplo 2 — Janela carrinho < 24h → BLOCKED

**Input:** `cart_open=2026-06-01 14:00`, `cart_close=2026-06-01 20:00` (6h)

**Specialist:** Phase validation → BLOCKED:
```
Janela carrinho de 6h é curta demais. Mínimo recomendado: 24h.
Se intencional (flash sale), ajustar manualmente após criação.
```

### Exemplo 3 — Sem products vinculados → ESCALATE

**Input:** event_id sem products

**Specialist:** ESCALATE com `redirect_to: create-event` + lista de products faltantes.

---

## Notas

- **Por que tripla confirmation:** operação cria 8 artifacts simultâneos. Misclick = cleanup tedioso.
- **Templates:** se passados, clonar via `clone-cms-page` (Tier 2 task) ou usar templates default da ArchPrime.
- **Email sequences:** placeholder steps (subject + body genérico). Sandra refina via UI depois.
- **Flow upsell:** trigger=`stripe.checkout.completed`, action=`send_email` 24h delay com upsell LP.
- **Por que tudo draft:** lançamentos são sensíveis (revenue + reputação). User edita/revisa antes de ativar.

---

**Mantido por:** content-builder
