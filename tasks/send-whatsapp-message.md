# Task: send-whatsapp-message

> Enviar mensagem WhatsApp de texto pela instância UAZAPI da plataforma. Comercial/CS usam diariamente. Open op para roles autorizadas + confirmation. Implementa F-11.1 do PRD.

**⚠️ A PLATAFORMA USA UAZAPI/BAILEYS — NÃO Meta Graph API / WhatsApp Business API.** Isso significa:
- É uma sessão de WhatsApp conectada (via QR), não a Cloud API oficial. **Não existe conceito de "template aprovado", `messaging_product`, `to`, namespace de template, nem "janela de 24h" imposta pela Meta.** Texto livre pode ser enviado a qualquer momento (respeitando bom senso / opt-out — ver salvaguardas).
- O payload REAL de envio é **`{ number, text }`** — confirmado em `supabase/functions/_shared/uazapi.ts` → `sendText()` faz `POST /send/text` na UAZAPI com esse corpo, e em `supabase/functions/whatsapp-send/index.ts` que exige exatamente `{ number, text }`.
- A instância/token de envio é a instância principal configurada em **`uazapi_instances`** (colunas: `base_url`, `token`, `is_active`, `is_principal`, `phone_number`, `sector`, `name`). Em runtime a EF `whatsapp-send` usa o token/base_url do ambiente (`UAZAPI_TOKEN` / `UAZAPI_BASE_URL`), que espelham a instância principal dessa tabela — SSoT das instâncias.

**Tabela REAL de persistência:** `whatsapp_messages` (a EF grava aqui após enviar). Colunas usadas: `message_id`, `direction='outbound'`, `from_number='me'`, `to_number`, `content`, `message_type='text'`, `status` (`sent` | `failed`). Tabelas correlatas existentes: `whatsapp_conversations` (threads — read-only para lookup), `whatsapp_sessions`, `wa_send_queue`. **NÃO existe tabela `whatsapp_templates`** — e não é necessária, porque UAZAPI não usa templates.

**Edge canonical:** `whatsapp-send` (`supabase/functions/whatsapp-send/`). Envio agendado → task `schedule-whatsapp-message` (EF `schedule-whatsapp-message-send` + tabela `scheduled_whatsapp_messages`).

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name
`Send WhatsApp Message`

### responsible_executor
`integration-specialist` (boundary externa — UAZAPI/WhatsApp)

### execution_type
`Agent` — confirmation OBRIGATÓRIO (mensagem é externa, irreversível).

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload:**
  - `phone` (E.164 sem `+` na chamada UAZAPI, ex: `5511999999999`) OU `lead_id` (resolver phone)
  - `text` (string, 1..4096 chars, UTF-8)
  - `lead_id` (uuid opcional, para linkagem/lookup de conversa)

> **Nota:** não há `message_type` template nem `template_id`/`template_params` — UAZAPI só envia texto livre nesta task. Mídia (imagem/áudio/documento) é escopo de tasks dedicadas por operação (regra de isolamento UAZAPI), não desta.

### output

- **`message_id`** (id da UAZAPI `result.key.id`, com fallback interno `send_{ts}_{rand}`)
- **`phone`**, **`status`** (`sent | failed`)
- **`verdict`** — `DONE | BLOCKED | ESCALATE`
- **`convention_check`** — role ✓ / e164 ✓ / quota ✓ / audit ✓

### action_items

1. **Role check:** comercial/cs/marketing/admin/owner. financeiro → BLOCKED.
2. **Validar phone** E.164 regex `^\+?\d{8,15}$`. Inválido → ESCALATE. Normalizar para dígitos puros (sem `+`, sem espaços) antes de enviar — a UAZAPI espera `number` só com dígitos.
3. **Validar texto:** 1..4096 chars, UTF-8. Vazio → ESCALATE.
4. **Resolver phone se passou lead_id:**
   ```sql
   SELECT phone FROM leads WHERE id={lead_id};
   ```
   Sem phone → ESCALATE.
5. **(Opcional) Lookup de conversa** para contexto (não bloqueia, UAZAPI não tem janela Meta):
   ```sql
   SELECT id, last_message_at FROM whatsapp_conversations
   WHERE phone={phone} ORDER BY last_message_at DESC LIMIT 1;
   ```
   Serve só para exibir contexto ("último contato há X") na confirmação.
6. **Salvaguarda opt-out / bom senso:** se o lead pediu descadastro ou não há relação/consentimento aparente, ESCALATE pedindo confirmação humana explícita. (UAZAPI não impõe política Meta, mas spam derruba a instância — proteja o número.)
7. **Quota guard:** se os últimos 60s tiveram >10 sends pela instância, ESCALATE com cooldown (proteção anti-ban da sessão UAZAPI).
8. **Confirmation:**
   ```
   Vou enviar WhatsApp (instância UAZAPI principal):
     Para: {phone} ({lead_name or 'sem lead vinculado'})
     Texto:
     «{text}»

   Mensagem é IRREVERSÍVEL após envio.
   Confirma?
   ```
9. **Aguardar "sim"** — se "não", ESCALATE.
10. **Invoke edge function** (payload REAL — só `number` e `text`):
    ```typescript
    const { data, error } = await supabase.functions.invoke('whatsapp-send', {
      body: { number: phoneDigits, text },
      headers: { Authorization: `Bearer ${jwt}` }
    });
    ```
11. **Tratar erros** (comportamento REAL da EF `whatsapp-send`):
    - **401** → BLOCKED (JWT do usuário ausente/expirado; refazer login).
    - **400** → ESCALATE (faltou `number` ou `text` no corpo — bug de payload).
    - **500** → a EF lançou exceção (falha de rede/UAZAPI). Retry 1x → ESCALATE.
    - **200 com `data.error`** (ou `status='failed'`): a UAZAPI recusou o envio (instância desconectada / número inválido / sessão caiu). ESCALATE sugerindo checar status da instância (`whatsapp-session` / QR via `whatsapp-qr`).
    > Não existem erros 429/470/"token Meta expirou" aqui — isso era resquício do modelo Meta Graph. Falha de auth de sessão = instância UAZAPI desconectada, resolvida por reconexão (QR), não por renovar token Meta.
12. **Activity log:** `action='integration-specialist.send_whatsapp_message'`, details com phone (mascarado últimos 4 dígitos), lead_id, message_id.
13. **Echo:**
    ```
    ✓ Mensagem enviada (UAZAPI)
    Para: ***{last4_phone}
    Status: {sent | failed}
    Tracking ID: {message_id}
    ```

### acceptance_criteria

- **[A1] Role gating:** comercial/cs/marketing/admin/owner; financeiro BLOCKED.
- **[A2] E.164 validation + normalização:** phone validado e reduzido a dígitos puros para a UAZAPI.
- **[A3] Payload correto:** invoke com `{ number, text }` (NUNCA `messaging_product`/`to`/`template`).
- **[A4] Quota guard:** rate limit 10 sends/60s (anti-ban da sessão).
- **[A5] Confirmation OBRIGATÓRIO:** mensagem externa irreversível.
- **[A6] Phone redaction em logs:** activity_logs mascarando dígitos do meio.
- **[A7] Error surfacing real:** 401/400/500 e `200+error` (instância desconectada) explicados claramente, não genérico "falhou".
- **[A8] Idempotency:** retry interno 1x em 500; após isso ESCALATE para evitar dupla mensagem.

---

## Exemplos

### Exemplo 1 — Miriam (comercial) responde lead

**Input:** `lead_id={x}`, `text='Oi Marco, tudo bem? ...'`

**Specialist:** resolve phone do lead → normaliza → confirma → invoke `whatsapp-send` `{ number, text }` → `status='sent'` → DONE.

### Exemplo 2 — Instância UAZAPI desconectada → ESCALATE

**Input:** send válido, mas a EF retorna `200 { success:true, data:{ error: ... } }` / `status='failed'`.

**Specialist:** ESCALATE — "A sessão WhatsApp (UAZAPI) parece desconectada. Reconecte a instância principal (QR via `whatsapp-qr` / status via `whatsapp-session`) e tente de novo."

### Exemplo 3 — financeiro tenta send → BLOCKED

**Input:** Larissa (financeiro) → BLOCKED:
```
Send WhatsApp requer role comercial/cs/marketing/admin/owner.
Sua role: financeiro. WhatsApp é canal de Sales/Customer Success.
```

---

## Notas

- **Edge function `whatsapp-send`:** existe no primeteam. Fluxo real: valida JWT → chama `sendText(number, text)` (`_shared/uazapi.ts` → `POST /send/text` na UAZAPI) → persiste em `whatsapp_messages` com service role. Retorna `{ success:true, data: <resposta UAZAPI> }`.
- **Sem templates, sem janela de 24h Meta:** UAZAPI/Baileys é sessão conectada — texto livre a qualquer hora. A única disciplina é anti-spam para não derrubar o número (opt-out + quota guard).
- **Instâncias:** `uazapi_instances` é a SSoT (base_url, token, is_active, is_principal, sector). A EF hoje usa a principal via env `UAZAPI_TOKEN`/`UAZAPI_BASE_URL`.
- **Envio em massa / agendado:** esta task é single message imediato. Bulk é task separada (Tier 2 backlog). Agendado = task `schedule-whatsapp-message` (EF `schedule-whatsapp-message-send`, tabela `scheduled_whatsapp_messages`).
- **Phone redaction:** activity_logs mostra `+55119****9999` (últimos 4 dígitos). Histórico completo em `whatsapp_messages` (RLS-protected).

---

**Mantido por:** integration-specialist
