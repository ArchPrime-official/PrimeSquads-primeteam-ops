# Task: send-whatsapp-message

> Enviar mensagem WhatsApp via Business API. Comercial/CS usam diariamente. Open op para roles autorizadas + confirmation. Implementa F-11.1 do PRD.

**✅ SCHEMA ADAPTED (2026-05-10):** `whatsapp_templates` table NÃO existe — templates approved são gerenciados pela Meta Business API direto. Specialist invoca edge `whatsapp-send` que valida template_id contra Meta API runtime (template não aprovado = 470 error surfaced em handler). Tabelas REAIS de persistence:
- `whatsapp_conversations` — threads de conversa
- `whatsapp_messages` — histórico messages enviados
- `whatsapp_sessions` — sessões ativas (memory:rls-public-tables-checklist 2026-05-06)
- `wa_send_queue` — queue de outbound (RLS habilitado em PR #1282)

**Edge canonical:** `whatsapp-send` (existe em `supabase/functions/whatsapp-send/`).

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name
`Send WhatsApp Message`

### responsible_executor
`integration-specialist` (boundary externa — WhatsApp Business API)

### execution_type
`Agent` — confirmation OBRIGATÓRIO (mensagem é externa, irreversível).

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload:**
  - `phone` (E.164 format, ex: `+5511999999999`) OU `lead_id` (resolver phone)
  - `message_type` (`'text' | 'template'`)
  - `text` (string, se type='text', max 4096 chars)
  - `template_id` (string, se type='template' — ex: `welcome_pt_br_v2`)
  - `template_params` (array, se template — variables `{{1}}`, `{{2}}` etc.)
  - `lead_id` (uuid opcional, para linkagem de conversa)

### output

- **`message_id`** (UUID interno + WhatsApp message_id externo)
- **`phone`**, **`status`** (`sent | queued | failed`)
- **`conversation_id`** (uuid — `whatsapp_conversations`)
- **`verdict`** — `DONE | BLOCKED | ESCALATE`
- **`convention_check`** — role ✓ / e164 ✓ / quota ✓ / audit ✓

### action_items

1. **Role check:** comercial/cs/marketing/admin/owner. financeiro → BLOCKED.
2. **Validar phone** E.164 regex `^\+\d{8,15}$`. Inválido → ESCALATE.
3. **Validar message:**
   - `text`: 1..4096 chars; UTF-8
   - `template_id`: deve existir em `whatsapp_templates` (cache local) AND status='approved' Meta
4. **Resolver phone se passou lead_id:**
   ```sql
   SELECT phone FROM leads WHERE id={lead_id};
   ```
   Sem phone → ESCALATE.
5. **Verificar conversation existente:**
   ```sql
   SELECT id, last_message_at FROM whatsapp_conversations
   WHERE phone={phone} ORDER BY last_message_at DESC LIMIT 1;
   ```
   - Se existe E `last_message_at < 24h atrás`: pode enviar text livre (24h window)
   - Se > 24h OU sem conversation: APENAS templates approved (Meta business policy)
6. **Validar 24h window vs message_type:**
   - text fora de janela → ESCALATE com sugestão template:
     ```
     Janela de 24h expirou (último msg foi {when}). Apenas templates
     aprovados pela Meta podem ser enviados agora. Lista templates:
     {list_templates_aprovados}
     ```
7. **Quota guard:** WhatsApp tem rate limits. Se últimos 60s tiveram >10 sends, ESCALATE com cooldown.
8. **Confirmation:**
   ```
   Vou enviar WhatsApp:
     Para: {phone} ({lead_name or 'sem lead vinculado'})
     Tipo: {message_type}
     {text ? 'Texto:\n«' + text + '»' : 'Template: ' + template_id + ' params: ' + template_params}

   Mensagem é IRREVERSÍVEL após envio.
   Confirma?
   ```
9. **Aguardar "sim"** — se "não", ESCALATE.
10. **Invoke edge function:**
    ```typescript
    const { data, error } = await supabase.functions.invoke('whatsapp-send', {
      body: { phone, message_type, text, template_id, template_params, lead_id },
      headers: { Authorization: `Bearer ${jwt}` }
    });
    ```
11. **Tratar erros:**
    - 401 → BLOCKED (token Meta WhatsApp expirou; admin renova)
    - 429 → ESCALATE com cooldown
    - 470 (Meta business policy violation) → BLOCKED com explicação
    - 500 → retry 1x → ESCALATE
12. **Activity log:** `action='integration-specialist.send_whatsapp_message'`, details com phone (mascarado últimos 4 dígitos), template_id, lead_id.
13. **Echo:**
    ```
    ✓ Mensagem enviada
    Para: ***{last4_phone}
    Type: {type}
    Status: {sent | queued}
    Conversation: {conversation_id}
    Tracking ID: {message_id}
    ```

### acceptance_criteria

- **[A1] Role gating:** comercial/cs/marketing/admin/owner.
- **[A2] E.164 validation:** phone regex strict.
- **[A3] 24h window enforcement:** text fora de janela = template only (Meta policy).
- **[A4] Quota guard:** rate limit 10 sends/60s.
- **[A5] Confirmation OBRIGATÓRIO:** mensagem externa irreversível.
- **[A6] Phone redaction em logs:** activity_logs mascarando dígitos do meio.
- **[A7] Error surfacing:** 401/470 explicações claras (não genérico "falhou").
- **[A8] Idempotency:** retry interno 1x; após isso ESCALATE para evitar dupla mensagem.

---

## Exemplos

### Exemplo 1 — Miriam (comercial) responde lead em 24h window

**Input:** `lead_id={x}`, `message_type='text'`, `text='Oi Marco, tudo bem? ...'`

**Specialist:** Conversation found, 4h ago → window OK → text permitido. Send → DONE.

### Exemplo 2 — Send fora de 24h window com text → ESCALATE

**Input:** lead que não responde há 3 dias, comercial tenta `text`

**Specialist:** ESCALATE com lista de templates aprovados (`reactivation_pt_br`, `followup_30d`).

### Exemplo 3 — financeiro tenta send → BLOCKED

**Input:** Larissa (financeiro) → BLOCKED:
```
Send WhatsApp requer role comercial/cs/marketing/admin/owner.
Sua role: financeiro. Comercial é canal de Sales/Customer Success.
```

---

## Notas

- **Edge function `whatsapp-send`:** já existe no primeteam, faz call Meta Graph API + persiste em `whatsapp_messages`.
- **Templates approved:** sync via cron `sync-whatsapp-templates`. Lista cacheada em `whatsapp_templates` table.
- **Bulk:** task é single message. Bulk send (campanha) = task separada (Tier 2 backlog) com extra confirmation.
- **Rate limits Meta:** 1000/24h para newer business accounts, escalável conforme reputation.
- **Phone redaction:** activity_logs mostra `+55119****9999` (últimos 4 dígitos). Audit completo na tabela `whatsapp_messages` (RLS-protected).

---

**Mantido por:** integration-specialist
