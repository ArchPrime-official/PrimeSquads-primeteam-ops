# Smoke Tests — High-Stakes Tasks

> Casos de teste manuais a serem executados no primeiro uso de cada task crítica antes de operação livre. Foco em authorization, compliance, e mutations destrutivas.

**Mantido por:** quality-guardian
**Última atualização:** 2026-07-02 (alinhado à regra de smoke test do dono, 2026-06-13)

> ⛔ **Regra do dono (2026-06-13, vale para SEMPRE):** smoke test = **ver o resultado final REAL como o usuário vê/usa** — Playwright autenticado abrindo a tela/dado exato, OU query REST/RPC/SQL real confirmando o número/comportamento. Build/lint/tsc passar é pré-requisito, **não** é smoke test. **Após deploy, re-testar em PRODUÇÃO** (o usuário olha produção). Se não estiver 100% como pedido, **corrigir e re-testar em loop** até estar certo. Nenhuma task/mudança está isenta.

---

## Critérios para inclusão neste checklist

Tasks que devem ter smoke test executado antes do primeiro uso real:
- ✅ Mutations destrutivas (delete/bulk-delete/hard-delete)
- ✅ Compliance-sensitive (LGPD/GDPR opt-out, HMRC fiscal)
- ✅ Authorization gates rigorosos (admin/owner-only, has_finance_access, has_invoice_access)
- ✅ Operações com side-effect externo (Stripe, Meta, Vapi, Google Calendar)
- ✅ Operações com dupla/tripla confirmation literal

---

## Test execution pattern

```
1. Setup: criar conditions necessárias (test data isolated)
2. Execute task com input específico
3. Assert behavior esperado (success path OR blocked path)
4. Cleanup: revert changes (se necessário)
```

Cada test case roda contra o **resultado real**: Playwright autenticado (login autônomo via magic-link, ver `smoke-test-obrigatorio-antes-de-dizer-pronto`) abrindo a tela/dado exato, ou query REST/RPC/SQL confirmando o efeito. Mutations destrutivas podem ser ensaiadas com dados marcados `__TEST__` para não sujar dados reais, mas o **caminho de leitura/validação é sempre o real** — e, após deploy, o smoke se repete em **produção**.

---

## Tier 1: Fiscal & Compliance (MUST test antes de uso)

### create-sales-invoice
**Setup:** opportunity won + customer com tax_id válido (IT)

**Test cases:**
1. ✅ **Happy path:** Joyce (admin) emite NF — deve gerar `invoice_number` sequencial 2026-NNNN, status='issued', PDF gerado
2. ✅ **Auth block:** Daniel (comercial) tenta — `BLOCKED has_invoice_access`
3. ✅ **Sequencial atomic:** rodar 5 invocations concorrentes via script — 0 gaps em `invoice_number`
4. ✅ **Tripla confirmation:** user digita "sim" em vez de "EMITE NOTA" — `ESCALATE cancelled_by_user`
5. ✅ **Duplicate detection:** opp já com NF emitida — `BLOCKED invoice_already_exists`
6. ✅ **Tax math:** `total_net + total_tax = total_gross` exatamente (sem rounding errors)
7. ✅ **Imutability:** após emissão, tentar UPDATE direto na row — trigger BEFORE UPDATE rejeita

### bulk-reissue-invoices
**Setup:** 5 invoices issued de período Q2/2026

**Test cases:**
1. ✅ **Happy path:** dry-run preview mostra exato 5 invoices + impactos
2. ✅ **Tripla confirm:** "REISSUE BATCH" literal exigido
3. ✅ **VOID + new sequencial:** após reissue, antigas têm `status='cancelled'`, novas têm `invoice_number` sequencial sem gap
4. ✅ **Linkage:** `invoice_reissue_links` linka cada old_id ↔ new_id
5. ✅ **Partial success:** simular 1 NF com erro tax — outras 4 OK, audit registra
6. ✅ **Reason obrigatório:** sem reason → `ESCALATE`

### sync-seller-commission
**Setup:** 3 sellers com vendas em 2026-04

**Test cases:**
1. ✅ **Dry-run default:** primeira call sempre preview — zero writes
2. ✅ **Persist requires explicit:** 2nd call com `dry_run=false` + "PERSISTE COMISSÃO"
3. ✅ **UPSERT idempotent:** re-run mesmo period — UPDATE existing, audit warn
4. ✅ **Period validation:** `period='2026-99'` → `BLOCKED invalid_format`
5. ✅ **Auth has_invoice_access:** financeiro role tenta → `BLOCKED` (admin é o gate, não financeiro)

### update-commission-level
**Test cases:**
1. ✅ **Targets ascendentes:** `acceptable < ok < meta` enforced
2. ✅ **Tripla "UPDATE LEVEL":** literal uppercase
3. ✅ **Recalc warning:** se há `commission_history` futuro, surface warn
4. ✅ **Reason obrigatório**

---

## Tier 2: Authorization Gates (MUST test)

### update-finance-transaction
**Setup:** transaction completed em finance_transactions

**Test cases:**
1. ✅ **Auth has_finance_access:** Joyce (admin) tenta — `BLOCKED admin EXCLUDED from finance` (intencional segregation)
2. ✅ **Owner+financeiro pass:** Wesley (financeiro) tenta — sucesso
3. ✅ **Multi-currency:** mudança currency != native EXIGE `converted_amount` + outros 3 fields
4. ✅ **Parent recurrence guard:** tx parent com children — amount/currency/category mudança → `BLOCKED`
5. ✅ **Status enum:** `status='in_progress'` → `BLOCKED` com sugestão 'completed'

### delete-finance-transaction
**Test cases:**
1. ✅ **Tripla "DELETE TX":** uppercase literal
2. ✅ **Reason obrigatório**
3. ✅ **Cascade opt-in:** parent recurrence sem `cascade=true` deleta apenas parent (children orphan)
4. ✅ **FK protection:** tx vinculada a opp won → `ESCALATE com lista`
5. ✅ **Max 50 batch enforcement**

### revoke-role
**Test cases:**
1. ✅ **Last-owner protection:** tentar revoke owner do único owner → `BLOCKED hard`
2. ✅ **Self-revoke owner:** owner remove próprio owner → tripla "REMOVE OWN OWNER"
3. ✅ **Role not present:** revoke role que user não tem → `ESCALATE`
4. ✅ **Audit STRICT:** simular log failure → mutation rollback (não persist)

### deactivate-user
**Test cases:**
1. ✅ **Last-owner protection**
2. ✅ **No self-deactivate:** user.id = auth.uid() → `BLOCKED`
3. ✅ **Cascade opt-in:** sem flag, assignments preservados (read-only state)
4. ✅ **Cascade reassign:** com flag + reassign_to_user_id, leads/opps/tasks reatribuídos
5. ✅ **Tripla "DEACTIVATE USER":** uppercase
6. ✅ **Reversible:** subsequent reactivate-user restaura state

---

## Tier 3: Side-effects Externos (MUST test em sandbox)

### send-whatsapp-message
**Setup:** WhatsApp Business test number

**Test cases:**
1. ✅ **24h window:** lead com last_message > 24h, tentativa text → `ESCALATE template-only`
2. ✅ **Quota guard:** 11 sends em 60s — 11º `ESCALATE cooldown`
3. ✅ **Phone E.164:** `+55119999...` válido; `551199...` (sem +) `ESCALATE`
4. ✅ **Opt-out enforcement:** lead com opted_out=true → `BLOCKED hard`
5. ✅ **PII redaction:** activity_logs mostra `+55119****9999` não phone completo

### launch-vapi-call
**Setup:** Vapi sandbox account com créditos

**Test cases:**
1. ✅ **Opt-out hard block**
2. ✅ **Cool-down 24h:** 2 calls ao mesmo lead em 12h → 2nd `ESCALATE`
3. ✅ **Cost estimate** preciso ±20% do real
4. ✅ **402 insufficient credits:** sandbox sem créditos → `BLOCKED com instrução`
5. ✅ **Persist record:** `telephony_calls` row criada antes de echo final

### update-meta-sync-config
**Setup:** Meta Ads sandbox account

**Test cases:**
1. ✅ **Token redaction:** activity_logs nunca contém token completo (apenas SHA-256 8c + length)
2. ✅ **Smoke test rollback:** new token inválido → 401 → automatic ROLLBACK + `ESCALATE`
3. ✅ **Dupla confirmation diferenciada:** "ROTACIONA" vs "TROCA CONTA" literais
4. ✅ **Range validation:** `sync_interval_minutes=5` → `ESCALATE 15..1440`

---

## Tier 4: Bulk Operations (MUST test antes prod)

### bulk-update-opportunities
**Test cases:**
1. ✅ **Tripla "BULK UPDATE":** literal uppercase
2. ✅ **Max 200 cap:** 201 ids → `ESCALATE`
3. ✅ **Reason obrigatório**
4. ✅ **SAVEPOINT atomic:** simular 1 falha em 50 — outras 49 commit, falha registra warning
5. ✅ **opportunity_history:** todos 50 têm row com `batch_id` linkagem

### bulk-update-transactions
**Setup similar.** Same patterns, has_finance_access gate.

### bulk-delete-leads
**Test cases:**
1. ✅ **Tripla "BULK DELETE LEADS"**
2. ✅ **Admin/owner only**
3. ✅ **FK protection:** lead com opp won → skip, audit warn
4. ✅ **Opted_out warning:** se >0 leads opted_out, surface antes de confirmar (compliance)
5. ✅ **Max 200**

---

## Tier 5: Workflow Integration (MUST test F-08.3)

### update-task / reschedule-task (F-08.3 path)
**Setup:** task created_by Sandra, due_date 2026-05-15

**Test cases:**
1. ✅ **Owner bypass:** Pablo (owner) muda due_date — UPDATE direto + `task_date_changes` audit
2. ✅ **Creator bypass:** Sandra muda própria due_date — UPDATE direto
3. ✅ **Non-creator/non-owner:** Daniel (comercial) muda — `REQUEST_CREATED` em `task_date_change_requests` com `approver_id=Sandra`
4. ✅ **Echo educacional:** Daniel vê mensagem clara explicando approver + how to expedite

### approve-task-date-change
**Test cases:**
1. ✅ **Authority approver_id:** Sandra (creator) approves — UPDATE task + INSERT audit + UPDATE request
2. ✅ **Owner override:** Pablo aprova request de outro creator
3. ✅ **Non-authorized:** Andrea tenta aprovar — `BLOCKED`
4. ✅ **Race-safe:** task.due_date mudou desde request — `BLOCKED race_condition`
5. ✅ **Idempotency:** request já approved/rejected — `BLOCKED já_processado`

### approve-role-request (FR5)
**Test cases:**
1. ✅ **Owner-only gate:** admin tenta — `BLOCKED imediato`
2. ✅ **Promoção owner:** `requested_role='owner'` exige tripla "CONFIRMA OWNER"
3. ✅ **Audit STRICT:** log failure → rollback INSERT user_roles
4. ✅ **ON CONFLICT race:** user já tem role (race) → audit warn, request marca approved

---

## Smoke test reporting

Após executar smoke test, registrar em:
- `docs/qa-reports/smoke-test-{task-id}-{date}.md` (no primeteam main repo)
- Link em activity_logs com `action='quality-guardian.smoke_test'`

**Verdicts possíveis:**
- ✅ PASS — todos casos OK, task safe para uso livre
- ⚠️ CONCERNS — cases específicos failam mas operação primária OK (documentar workarounds)
- ❌ FAIL — operação primária falha (BLOCK uso, escalate to dev)

---

## Notes operacionais

- **Frequência:** smoke test a CADA mudança que toca a task (ou o schema/edge function que ela usa), **em loop** (auditar → smoke → corrigir → re-smoke) até o resultado estar 100% como pedido. Não é "uma vez e liberado" — regride quando o que está embaixo muda.
- **Produção obrigatória pós-deploy:** depois que a mudança sobe, re-rodar o smoke em **produção** (não só local/staging) — deploy verde ≠ código no ar; o usuário olha produção.
- **Owner sign-off:** Pablo (owner) deve sign-off em smoke test de tasks Tier 1 antes de uso.
- **Dados de teste:** para ensaiar mutations destrutivas sem sujar dados reais, usar accounts/leads marcados `__TEST__`; a **validação do resultado** é sempre pelo caminho real (a tela/dado que o usuário vê).
- **Rollback plan:** cada test case deve ter cleanup procedure (revert mutations, delete test rows).

---

## Profundidade por risco (NÃO há isenção de smoke test)

Toda task passa por smoke test do resultado real — não existe "uso livre sem smoke". O que muda é a **profundidade**, conforme o risco:

- **Alto risco (Tier 1-5 acima):** bateria completa de casos (auth, confirmations, side-effects externos, atomicidade, compliance) + owner sign-off nos Tier 1.
- **Read-only (`list-*`, `view-activity-log`):** smoke = abrir a tela/rodar a query e **conferir que o dado retornado é o real e correto** (um termo-controle que você SABE que existe + um termo-impossível), não só "não deu erro".
- **Baixo risco / mutations não-destrutivas** (`create-task`, `create-lead`, `move-opportunity-stage`, `send-message`, `create-channel`, `create-schedule-block`, `create-finance-transaction`, `create-cms-page`/`publish-cms-page`, `update-bank-account`/`update-credit-card`): smoke = executar e **ver o efeito real** (o card/linha/render aparece como esperado na tela do usuário, o número bate na query). "Já está em produção" **não** dispensa o smoke quando a task ou o schema/EF embaixo dela muda.

**"Detectar em uso normal" não é smoke test.** Um PR não está pronto até alguém ter visto o resultado real funcionar — e, pós-deploy, funcionar em produção.
