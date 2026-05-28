# Task: schedule-whatsapp-message

> Agendar envio de mensagem WhatsApp via UAZAPI para contato(s) ou grupo(s).
> **Comportamento proativo:** ao ser ativado, o specialist lista automaticamente
> os grupos disponíveis da instância antes de pedir qualquer outra informação.

**Tabelas:**
- `scheduled_whatsapp_messages` — fila de envio (trigger pg_cron cria alarme one-shot)
- `whatsapp_group_names` — referência editável JID ↔ nome de grupo
- `whatsapp_group_entries` / `whatsapp_group_joins` — fallback webhook

**RPCs canônicas:**
- `resolve_whatsapp_group_jid(p_name, p_instance_id)` — resolve nome → JID (3 fontes)
- `register_whatsapp_group(p_instance_id, p_group_id, p_name)` — registra grupo novo
- `list_whatsapp_groups(p_instance_id)` — lista todos os grupos conhecidos

---

## Task anatomy

### task_name
`Schedule WhatsApp Message`

### responsible_executor
`integration-specialist`

### execution_type
`Agent` — confirmation OBRIGATÓRIO antes de inserir (mensagem é externa, irreversível).

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload** (pode ser parcial — specialist complementa via perguntas):
  - `recipients` (opcional) — contatos ou nomes de grupos
  - `message` (opcional) — texto da mensagem
  - `scheduled_for` (opcional) — data/hora em Europa/Roma
  - `instance_name` (opcional) — nome da instância UAZAPI

---

## Fluxo principal (comportamento proativo)

### PASSO 1 — Identificar instância

```sql
SELECT id, name, phone_number
FROM uazapi_instances
WHERE (user_id = auth.uid() OR is_principal = true)
  AND is_active = true
ORDER BY (user_id = auth.uid()) DESC, is_principal DESC
LIMIT 1;
```

Se `instance_name` foi especificado: filtrar por `name ILIKE '%{instance_name}%'`.

### PASSO 2 — LISTAR GRUPOS AUTOMATICAMENTE *(sem precisar pedir ao usuário)*

**Sempre executar antes de qualquer outra pergunta** quando o request não especificou destinatários:

```sql
SELECT group_id, name, source
FROM list_whatsapp_groups(p_instance_id := '{instance_id}')
ORDER BY name;
```

Apresentar ao usuário em formato amigável:
```
Grupos disponíveis na instância {instance_name} (+{phone}):

1. AVVISI ACADEMY
2. COMUNICAZIONI E AVVISI
3. COMMUNITY
4. ACADEMY
... (listar todos)

Para qual(is) grupo(s) ou contato(s) deseja enviar?
(Pode digitar o número da lista, o nome, ou um número de telefone)
```

Se a lista estiver **vazia**: avisar e oferecer cadastro:
```
Ainda não há grupos registrados para esta instância.
Você pode:
a) Me dizer o nome e o JID do grupo (ex: 120363...@g.us) para eu cadastrar
b) Verificar na aba Grupos em /whatsapp o JID correto
```

### PASSO 3 — Resolver destinatários

Para cada destinatário do tipo nome de grupo:
```sql
SELECT * FROM resolve_whatsapp_group_jid(
  p_name := '{nome_dado_pelo_usuario}',
  p_instance_id := '{instance_id}'
);
```

- **1 resultado** → usar o `group_id`
- **Múltiplos** → apresentar opções e pedir escolha
- **0 resultados** → oferecer cadastro (ver PASSO 2 vazio)

Para telefone: `conversation_id = '{digits_only}@s.whatsapp.net'`
Para JID direto: usar como está

### PASSO 4 — Coletar mensagem e horário

Se ainda não fornecidos:
```
Qual a mensagem que deseja enviar?
(max 4096 caracteres)
```
```
Para quando deseja agendar?
(fuso Europa/Roma — ex: "03/06 às 10:00" ou "amanhã às 14:30")
```

### PASSO 5 — Converter horário para UTC

```sql
SELECT ('{scheduled_for_rome}'::timestamp AT TIME ZONE 'Europe/Rome') AS scheduled_utc;
```

Validar: `scheduled_utc > NOW() + interval '2 minutes'` — se não, pedir novo horário.

### PASSO 6 — CONFIRMAÇÃO OBRIGATÓRIA

```
Confirmar agendamento:

📱 Instância: {instance_name} (+{phone})
👥 Destinatários:
   • {nome_grupo_1}
   • {nome_grupo_2}
💬 Mensagem: "{primeiros 80 chars}..."
🕐 Envio: {data_hora_em_roma} (fuso Europa/Roma)

Confirmar? (sim / não / editar)
```

### PASSO 7 — Inserir na fila

Para cada destinatário (mesmo `batch_id` para o grupo):
```sql
INSERT INTO scheduled_whatsapp_messages
  (batch_id, created_by, uazapi_instance_id, conversation_id, display_name, body, scheduled_for)
VALUES
  ('{batch_uuid}', auth.uid(), '{instance_id}', '{conversation_id}', '{display_name}', '{message}', '{scheduled_for_utc}');
```

O trigger `trg_schedule_whatsapp_message_job` cria automaticamente o pg_cron one-shot.

### PASSO 8 — Confirmação final

```
✅ Agendado com sucesso!

{N} mensagem(ns) programada(s) para {data_hora_roma}
Batch ID: {batch_id}

Para cancelar antes do envio:
"cancelar agendamento {batch_id}"
```

---

## Sub-tasks disponíveis

### `listar-grupos`
Lista todos os grupos conhecidos da instância.
```sql
SELECT group_id, name, source
FROM list_whatsapp_groups(p_instance_id := '{instance_id}')
ORDER BY name;
```

### `registrar-grupo`
Usuário fornece nome + JID → cadastra para uso futuro.
```sql
SELECT * FROM register_whatsapp_group(
  p_instance_id := '{instance_id}',
  p_group_id    := '{jid}',        -- ex: 120363...@g.us
  p_name        := '{nome}'        -- ex: AVVISI ACADEMY
);
```
Após cadastrar: confirmar e perguntar se deseja agendar imediatamente.

### `cancelar-agendamento`
Cancela por batch_id ou id individual.
```sql
UPDATE scheduled_whatsapp_messages
SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = auth.uid()
WHERE (id = '{id}' OR batch_id = '{batch_id}')
  AND status = 'scheduled'
RETURNING id, conversation_id, display_name, scheduled_for;
```

### `listar-agendamentos`
Lista mensagens agendadas ainda não enviadas.
```sql
SELECT id, batch_id, display_name, conversation_id, body, scheduled_for, status
FROM scheduled_whatsapp_messages
WHERE uazapi_instance_id = '{instance_id}'
  AND status IN ('scheduled', 'processing', 'failed')
ORDER BY scheduled_for ASC;
```

---

## Triggers de ativação (para ops-chief reconhecer)

O ops-chief deve rotear para esta task quando o usuário mencionar:
- "agendar mensagem", "agenda mensagem", "programar mensagem"
- "schedule WhatsApp", "mandar mensagem amanhã / depois / às X horas"
- "quero enviar uma mensagem pra um grupo em"
- "pianificare messaggio", "programmare invio", "inviare domani"
- qualquer combinação de "WhatsApp" + data/hora futura

---

## Convention checks

- ✅ `scheduled_whatsapp_messages` com RLS aberta (qualquer authenticated)
- ✅ Trigger pg_cron one-shot criado automaticamente no INSERT
- ✅ Cron fallback 5min como rede de segurança
- ✅ KILL_SWITCH na edge `schedule-whatsapp-message-send` deve estar `false`
- ✅ `created_by` gravado para auditoria (quem agendou + quando)
- ✅ `batch_id` agrupa múltiplos destinatários do mesmo agendamento
