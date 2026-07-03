# Task: manage-email-sequence

> Task atômica para gerir uma sequência de e-mails do hub `/sequenze`: criar/editar a sequência (`email_sequences`), adicionar/reordenar passos (`email_sequence_steps`), inscrever leads (via Edge Functions `enroll-email-sequences` / `manual-enroll-sequence`), e ler analytics de open/click/conversão (RPC `get_email_analytics_by_sequence`, que lê de `email_events`). Echo-confirm SEMPRE antes de qualquer inscrição em massa (que enfileira envios reais para centenas/milhares de leads).
>
> ⛔ **LIÇÃO — a fila de envio é a SSoT do disparo, não `email_sends`.** Quem realmente envia é o cron `process-email-sequence-queue` (a cada 5 min), lendo `email_sequence_queue WHERE status='pending' AND scheduled_for <= now()`. Esta task NUNCA envia e-mail diretamente — ela só cria a definição (sequência + steps) e inscreve leads (que popula `email_sequence_queue`). O disparo tem KILL SWITCH no cron; se estiver desligado, a fila enche mas nada sai — informe isso ao user, não tente contornar.
>
> ⛔ **LIÇÃO — métricas de conversão vêm de `email_events` via RPC, NUNCA de `email_sends`.** A atribuição é last-touch: quando uma venda entra em `automatic_sales`, o trigger `trg_email_conversion_on_sale` chama `attribute_email_conversion(customer_email)` e grava um `email_events` com `event_type='converted'` apontando para o último `step_id` que aquele e-mail recebeu. As UTMs (`utm_content=step_id`) são injetadas em todos os links pelo `process-email-sequence-queue` (`addUtms`). Para reportar conversão, chame o RPC de analytics — não conte linhas de `email_sends`.
>
> ⚠️ **HAZARD — inscrição em massa é irreversível na prática.** `manual-enroll-sequence` pode enfileirar 2600+ leads de uma vez. Sempre rodar com `dry_run: true` primeiro, mostrar a contagem ao user, e só então `dry_run: false` após confirmação explícita. Deletar itens de fila já enviados NÃO desfaz o e-mail já entregue.

**Cumpre:** HO-TP-001 (Task Anatomy — 8 campos) · HO-TP-003 (DS/remetente por marca)

---

## Task anatomy (HO-TP-001 — 8 campos obrigatórios)

### task_name
`Manage Email Sequence`

### status
`pending` *(default até execução pelo automation-specialist dentro de um cycle)*

### responsible_executor
`automation-specialist` (domínio: flows de automação + hub `/sequenze` de e-mail)

### execution_type
`Agent` — execução via LLM + Supabase client (mutations em `email_sequences` / `email_sequence_steps`) e chamadas às Edge Functions de enroll. Human intervention obrigatória na etapa de CONFIRMAÇÃO antes de qualquer **inscrição** (que enfileira envios reais) e em ambiguidades (múltiplas sequências matching um nome, trigger_stage não resolvido, etc.).

### input

Entregue pelo `ops-chief` via `*handoff` ceremony:

- **Cycle ID** (obrigatório): `cyc-YYYY-MM-DD-NNN`
- **User JWT**: presente em `~/.primeteam/session.json` (auth já verificada pelo chief no step_1_receive)
- **User role**: extraída da session — a validação real é RLS do Supabase sobre as tabelas de sequência
- **Operation** (obrigatório) — uma de:
  - `create_sequence` — criar nova `email_sequences`
  - `edit_sequence` — renomear, mudar trigger, toggle `live`/`paused`
  - `add_step` / `edit_step` — upsert em `email_sequence_steps`
  - `reorder_steps` — reescrever `step_order` de vários steps
  - `enroll` — inscrever lead(s) numa sequência (auto ou manual)
  - `analytics` — ler open/click/conversão de uma sequência
- **Request payload** (variável conforme a operation):
  - `sequence_id` (uuid) ou `sequence_name` (string — resolvo para id) — para operações sobre sequência existente
  - `name` (string) — para `create_sequence`
  - `trigger_type` (`'lead_created'` | `'opportunity_stage_changed'` | `'manual'`) — default `'manual'` no create; só `opportunity_stage_changed` usa `trigger_stage`
  - `trigger_stage` (string) — obrigatório SE `trigger_type='opportunity_stage_changed'`, senão fica NULL
  - `status` (`'draft'` | `'live'` | `'paused'`) — status inicial no create é sempre `'draft'`
  - `brand` (`'archprime'` | `'lovarch'`) — define o remetente do envio (ver action_items #9); default `'archprime'`
  - `campaign_filters` (text[]) — códigos de campanha (ex: `['MM_LANCIO_APR26']`); NULL/vazio = universal
  - Para step: `step_order` (int), `send_type` (`'immediate'` | `'delay'` | `'absolute'`), `delay_minutes` (int, para `delay`), `send_at` (timestamptz, para `absolute`), `subject` (string), `body_html` (string)
  - Para enroll:
    - auto (`enroll-email-sequences`): `event` (`'lead_created'` | `'opportunity_stage_changed'`), `lead_id` (uuid), opcional `lead_email`/`lead_name`/`stage`/`force_campaign_code`
    - manual (`manual-enroll-sequence`): `sequence_id` (uuid), `campaign_ids` (uuid[]), opcional `stages` (string[]), `dry_run` (bool — default true na primeira passada)

### output

Retornado ao `ops-chief` via announcement V10 + handoff card V18:

- **`operation`** — a operação executada (confirmada)
- **`sequence_id`** — uuid da sequência criada/afetada
- **`resolved_fields`** — objeto com IDs/valores resolvidos a partir de nomes (ex: `sequence_id` de `sequence_name`, `campaign_ids` de códigos)
- **`row_snapshot`** — campos gravados (para create/edit de sequence/step)
- **`enroll_result`** (só para `enroll`) — `{ enrolled, skipped, dry_run, queued_into: 'email_sequence_queue' }`
- **`analytics`** (só para `analytics`) — por step/sequência: `sent`, `opened`, `clicked`, `converted` (derivados de `email_events`)
- **`verdict`** — DONE | BLOCKED | ESCALATE
- **`convention_check`**:
  - mutation via JWT do user (RLS respeitada): ✓
  - session read-only: ✓ (`~/.primeteam/session.json` nunca escrito)
  - envio NÃO disparado por esta task (só fila): ✓
  - mass enroll confirmado com dry_run antes: ✓ (quando aplicável)
  - métricas lidas de `email_events` via RPC (não de `email_sends`): ✓
  - i18n: N/A (DB/EF operation) — mas `subject`/`body_html` de step devem respeitar o idioma do público

### action_items

1. **Identificar a operation** — se não explícita no payload, ECHOAR a inferência e pedir confirmação. Nunca assumir `enroll` (é a única com efeito de massa).
2. **Resolver a sequência** — se veio `sequence_name` em vez de `sequence_id`:
   - Query `email_sequences` `name ILIKE '%{term}%'`.
   - 0 matches → ESCALATE (`ask_user_which_sequence`).
   - >1 match → ESCALATE listando candidatos (id + name + status).
3. **`create_sequence`** — INSERT em `email_sequences`:
   ```sql
   INSERT INTO email_sequences (name, trigger_type, trigger_stage, status, brand, campaign_filters)
   VALUES ({name}, {trigger_type}, {trigger_stage_or_null}, 'draft', {brand}, {campaign_filters_or_null})
   RETURNING id;
   ```
   - `status` inicial é **sempre `'draft'`** (padrão do hub — o user ativa depois via `edit_sequence` → `'live'`).
   - `trigger_stage` só é preenchido se `trigger_type='opportunity_stage_changed'`; caso contrário NULL.
4. **`edit_sequence`** — UPDATE parcial em `email_sequences` (`name`, `trigger_type`/`trigger_stage`, `status`, `brand`, `campaign_filters`, `updated_at=now()`). Toggle `live`/`paused` é a mudança mais comum. **Antes de setar `'live'`**, avisar que isso habilita a sequência a inscrever leads automaticamente (se `trigger_type` não for `manual`).
5. **`add_step` / `edit_step`** — upsert em `email_sequence_steps`:
   ```sql
   INSERT INTO email_sequence_steps
     (sequence_id, step_order, send_type, delay_minutes, send_at, subject, body_html)
   VALUES ({seq_id}, {order}, {send_type}, {delay}, {send_at}, {subject}, {body_html});
   -- edit: UPDATE ... SET ..., updated_at=now() WHERE id={step_id}
   ```
   - `send_type='immediate'` → sem delay; `'delay'` → usar `delay_minutes`; `'absolute'` → usar `send_at` (timestamptz). Validar coerência: `delay` sem `delay_minutes`, ou `absolute` sem `send_at`, é ESCALATE.
   - `subject` e `body_html` devem respeitar o idioma do público-alvo (i18n do CONTEÚDO) **e o DS de e-mail da marca** (HO-TP-003 — ver #9). Links em `body_html` recebem UTMs automaticamente no envio (`utm_content=step_id`) — não hardcodar utm_content.
6. **`reorder_steps`** — reescrever `step_order` dos steps citados. Confirmar a nova ordem completa com o user (mostrar `step_order → subject`) antes do UPDATE, pois a fila (`rebuild-email-queue`) usa `step_order` para achar "o próximo step".
7. **`enroll` — auto** (trigger-based) via EF `enroll-email-sequences`:
   - `POST /functions/v1/enroll-email-sequences` body `{ event, lead_id, lead_email?, lead_name?, stage?, force_campaign_code? }`.
   - A EF acha as sequências `live` cujo `campaign_filters` casa (NULL/vazio = universal; senão o código da campanha do lead precisa estar no array), e popula `email_sequence_queue`.
   - É por-lead (baixo volume) — não precisa dry_run, mas ECHOAR quais sequências vão pegar o lead.
8. **`enroll` — manual/massa** via EF `manual-enroll-sequence` (sequência de tipo/uso `manual`):
   - **SEMPRE `dry_run: true` primeiro**: `POST /functions/v1/manual-enroll-sequence` body `{ sequence_id, campaign_ids: [...], stages?: [...], dry_run: true }`.
   - Mostrar ao user quantos leads seriam inscritos (a EF retorna a contagem) + em quais steps a fila seria populada.
   - **Só após confirmação explícita**, repetir com `dry_run: false`. Isso enfileira envios reais em `email_sequence_queue` (o cron dispara em até 5 min, se o KILL SWITCH estiver off).
9. **Remetente (`brand`) — regra de contexto** (o envio deriva do `brand` da sequência, aplicado por `process-email-sequence-queue`):
   - `brand='lovarch'` → remetente **`Lovarch <info@lovarch.com>`** (conta Resend própria do Lovarch, domínio `lovarch.com` verificado). Use para públicos que **compraram Lovarch**.
   - `brand='archprime'` (default) → remetente **`ArchPrime <noreply@archprime.io>`** para e-mails de sequência/**transacionais**.
   - E-mails de **booking/agendamento** (fora do escopo de sequência) saem de `info@archprime.io` — não confundir com o `noreply` das sequências.
   - Se o user pedir uma sequência para compradores Lovarch mas o `brand` vier `archprime`, ECHOAR a inconsistência e confirmar antes de gravar (remetente errado = quebra de deliverability e de marca).
   - **DS de e-mail por marca (HO-TP-003):** o `body_html` do step deve seguir o Design System de e-mail da marca — `supabase/functions/_shared/email/tokens.ts` (`renderEmail({brand})`): ArchPrime dark/gold (`#0A0A0B`/`#C9995C`, Playfair+Inter) vs Lovarch creme/editorial (`#ECEAE3`/`#9A6A2C`). Marca ⇒ remetente ⇒ DS resolvem do mesmo eixo `brand` — fonte única em [`data/domain-brand-ds-registry.yaml`](../data/domain-brand-ds-registry.yaml). Não colar HTML "genérico"; usar o wrapper/template da marca.
10. **`analytics`** — ler métricas via RPC (NUNCA contando `email_sends`/`email_sequence_queue`):
    ```
    supabase.rpc('get_email_analytics_by_sequence', { ... })   // por sequência
    // (variantes: get_email_analytics_by_step, get_email_analytics_by_day, get_email_analytics_stats)
    ```
    - `open`/`click` vêm de `email_events` (`event_type` open/click). `converted` vem do `event_type='converted'` gravado por `attribute_email_conversion` (last-touch sobre `automatic_sales`).
    - Reportar: enviados, aberturas, cliques, conversões — deixando explícito que conversão é atribuição last-touch por e-mail→step.
11. **Confirmar com user** — para create/edit/step: mostrar o que será gravado. Para **enroll**: mostrar contagem do dry_run + sequência + remetente derivado do `brand`, e aguardar "sim/confirma".
12. **Executar** a mutation/EF. **Tratar erros:**
    - 42501 (RLS denial) → BLOCKED com mensagem clara de role/permissão.
    - 23502/23503 (NOT NULL / FK, ex: `sequence_id` inexistente no step) → BLOCKED indicando o campo/FK.
    - EF retorna `{ error }` (400/404 — ex: "Sequence not found", "No steps found") → BLOCKED repassando a mensagem.
    - 5xx / timeout → retry 1x; persistir → ESCALATE.
13. **Retornar ao chief** — announcement V10 + output V11 + handoff card V18 com `operation`, `sequence_id`, `resolved_fields` e (conforme o caso) `row_snapshot` / `enroll_result` / `analytics`.

### acceptance_criteria

- **[A1] Operation confirmada:** a operação executada bate com a intenção do user. Se a inferência foi necessária, o handoff card registra `operation_inferred_from`.
- **[A2] Sequência resolvida por ID:** se o user deu `sequence_name`, a task resolve para `sequence_id` via `email_sequences`. 0 ou >1 match → ESCALATE (não inventar match).
- **[A3] Step coerente com send_type:** `delay` exige `delay_minutes`; `absolute` exige `send_at`; `immediate` ignora ambos. Incoerência → ESCALATE.
- **[A4] Status inicial correto:** `create_sequence` sempre grava `status='draft'`. Ativação (`'live'`) só via `edit_sequence` explícito, com aviso de que passa a inscrever automaticamente (se trigger ≠ manual).
- **[A5] Mass enroll com dry_run antes:** toda inscrição via `manual-enroll-sequence` roda `dry_run: true` primeiro, a contagem é mostrada ao user, e o `dry_run: false` só ocorre após confirmação explícita. Sem confirmação = BLOCKED (nenhuma fila real populada).
- **[A6] Remetente + DS correto por brand:** o `brand` da sequência determina o remetente (`lovarch`→info@lovarch.com; `archprime`→noreply@archprime.io) **e o DS de e-mail** do `body_html` (HO-TP-003, `_shared/email/tokens.ts`). Inconsistência público↔brand é ECHOada antes de gravar.
- **[A7] Métricas de `email_events`:** relatórios de open/click/conversão vêm do RPC `get_email_analytics_by_*` (fonte `email_events`), NUNCA de contagem em `email_sends` ou `email_sequence_queue`.
- **[A8] Task nunca envia e-mail:** esta task só cria definição e popula fila. O disparo é do cron `process-email-sequence-queue`. O handoff card afirma `email_dispatched_by_task: false`.
- **[A9] RLS + JWT scoping:** mutations em `email_sequences`/`email_sequence_steps` usam o JWT do user; se a RLS negar, verdict=BLOCKED com error 42501.

---

## Exemplos de execução

### Exemplo 1 — Criar sequência + primeiro step (DONE)

**Input do chief:**
```
*handoff @automation-specialist --cycle cyc-2026-07-02-050
Request: "criar sequência 'Nurture Lovarch' manual, brand lovarch,
          e adicionar step 1 imediato, oggetto 'Benvenuto in Lovarch'"
User role: admin
```

**Specialist executa:**

1. operation=`create_sequence` (+ `add_step` em seguida). brand=`lovarch`, trigger_type=`manual`.
2. Confirmation:
   ```
   Vou criar a sequência:
     name: Nurture Lovarch
     trigger_type: manual
     status: draft (você ativa depois)
     brand: lovarch → remetente será "Lovarch <info@lovarch.com>"
   E o step 1:
     step_order: 1 · send_type: immediate
     subject: Benvenuto in Lovarch
   Confirma?
   ```
3. User: "sim"
4. INSERT `email_sequences` → id=`a1b2...`. INSERT `email_sequence_steps` (sequence_id=`a1b2...`, step_order=1, send_type='immediate', subject='Benvenuto in Lovarch').
5. Return:
   ```
   [automation-specialist → ops-chief] Cycle cyc-2026-07-02-050 — DONE.
   operation: create_sequence + add_step
   sequence_id: a1b2...
   row_snapshot: { name: 'Nurture Lovarch', status: 'draft', brand: 'lovarch', trigger_type: 'manual', step1: {...} }
   convention_check: RLS ✓, session RO ✓, email NOT dispatched ✓
   ```

### Exemplo 2 — Inscrição em massa (dry_run → confirmação → execução)

**Input:** `"inscrever todos os leads das campanhas X e Y na sequência 'Nurture Lovarch'"`

**Specialist:**

1. Resolve `sequence_id` de "Nurture Lovarch" → `a1b2...`. Resolve `campaign_ids` de X, Y.
2. `manual-enroll-sequence` com `dry_run: true` → retorna `would_enroll: 2340`.
3. Confirmation:
   ```
   Dry-run: 2340 leads seriam inscritos em 'Nurture Lovarch' (brand lovarch,
   remetente info@lovarch.com). Isso popula a fila de envio; o cron dispara
   em até 5 min. Confirma a inscrição REAL dos 2340?
   ```
4. User: "sim" → repete com `dry_run: false`.
5. Return `enroll_result: { enrolled: 2338, skipped: 2, dry_run: false, queued_into: 'email_sequence_queue' }`, verdict=DONE.

### Exemplo 3 — Enroll em massa sem confirmação (BLOCKED)

**Input:** `"inscreve geral na sequência de lançamento, pode mandar"`

**Specialist:** roda `dry_run: true` (would_enroll: 5100), mostra a contagem, mas o user não deu o "sim" ao número real.

**Return:**
```
verdict: BLOCKED
reason: mass_enroll_requires_explicit_confirmation
detail: dry_run indicou 5100 leads. Inscrição REAL não executada sem confirmação
        explícita do número (populava email_sequence_queue → envio em até 5 min).
suggested_user_message: "Dry-run: 5100 leads. Confirma inscrever os 5100 de verdade?"
convention_check: nenhuma fila real populada ✓
```

### Exemplo 4 — Analytics de conversão (DONE, fonte email_events)

**Input:** `"quantas conversões a sequência Nurture Lovarch gerou?"`

**Specialist:** chama `rpc('get_email_analytics_by_sequence', {...})` (fonte `email_events`).

**Return:**
```
operation: analytics
sequence_id: a1b2...
analytics: { sent: 2338, opened: 1102, clicked: 410, converted: 47 }
nota: "converted" = atribuição last-touch (email_events.event_type='converted'),
      disparada quando uma venda entra em automatic_sales e casa o customer_email
      com o último step recebido. NÃO é contagem de email_sends.
convention_check: métricas de email_events via RPC ✓
```

---

## Notas de implementação

- **Dependência da CLI auth:** presume `~/.primeteam/session.json` válido (pre-check no ops-chief step_1_receive).
- **Fila é a SSoT do envio:** `email_sequence_queue` (colunas: `sequence_id`, `step_id`, `lead_id`, `recipient_email`, `scheduled_for`, `status`, `retry_count`, `sent_at`, `resend_message_id`, `error`). Populada por enroll/rebuild; consumida por `process-email-sequence-queue` (cron 5 min, KILL SWITCH interno). Esta task NÃO insere direto na fila fora das EFs de enroll.
- **`email_sends`** é log de envios transacionais/one-off (booking, template_key, from_address/from_domain/brand) — **não** é a fonte de métrica de sequência nem a fila. Não confundir com `email_sequence_queue`.
- **EFs auxiliares (fora do escopo mutation desta task, mas relevantes):** `rebuild-email-queue` (reconstrói a posição do lead na fila; `dry_run` default true, exige `?secret=`), `retry-failed-emails` (reenfileira falhas permanentes; KILL SWITCH), `restore-cancelled-emails`. Só invocar se o user pedir explicitamente e com dry_run/confirmação.
- **Anti-duplicado:** o cron pula envio se a mesma pessoa já recebeu e-mail com o mesmo `subject` na mesma sequência (proteção contra re-inscrição com IDs recriados). Reordenar/renomear steps não burla isso.
- **RLS governance:** a policy das tabelas de sequência é source-of-truth; o specialist não replica a lógica client-side.

---

**Mantido por:** automation-specialist (self-reference) + ops-chief (orchestration updates em CHANGELOG).
