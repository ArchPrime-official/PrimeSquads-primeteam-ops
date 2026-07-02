# Task: reconcile-bank-transactions

> Rotina DIÁRIA de conciliação bancária (pós-PR #4481). Roda os syncs Stripe/Revolut na ordem certa, revisa as pendências em `finance_pending_transactions`, deixa o matcher automático parear o que dá, e trata os não-matches — tudo **read-mostly**, com confirmação humana antes de qualquer write. Não é uma task de INSERT manual: a maior parte do trabalho é DISPARAR as Edge Functions certas e LER o resultado.
>
> ⛔ **LIÇÃO Stripe = SSoT (2026, PRs #4384/#4481):** o `sync-stripe-transactions` é a **fonte única** das transações que vêm do Stripe — ele auto-lança a venda com valor líquido + IVA real (buscado da invoice/checkout session, não estimado) + taxa, faz match direto na conta e concilia. **NUNCA** lançar manualmente uma venda Stripe em `finance_transactions` (via `create-finance-transaction` ou UI) — gera **double-count**. Se o número não bate, o problema é do sync ou da conciliação, não de "faltou lançar à mão".
>
> ⚠️ **HAZARD triggers (ver `checklists/finance-triggers-hazard.md`):** se em algum momento esta rotina levar a um UPDATE/bulk em `finance_transactions` (ex: corrigir um match errado, reverter uma linha), os TRÊS triggers `trg_recompute_converted_on_update`, `auto_link_transaction_to_invoice` e `handle_commercial_sale_pending_transactions` precisam ser desabilitados **pelo NOME** antes (nunca `DISABLE TRIGGER USER`). Rodar a checklist inteira antes.
>
> ⚠️ **Vocabulário de status NÃO se confunde:** `finance_transactions` usa `completed`/`predicted`/`delayed`/`cancelled`; `finance_pending_transactions` usa `pending`/`paid`/`predicted`. Filtrar `status='paid'` em `finance_transactions` retorna vazio (esse valor só existe na tabela de pending). Confira em qual tabela está antes de escrever o `WHERE`.

**Cumpre:** HO-TP-001 (Task Anatomy — 8 campos)

---

## Task anatomy (HO-TP-001 — 8 campos obrigatórios)

### task_name
`Reconcile Bank Transactions`

### status
`pending` *(default até execução pelo platform-specialist dentro de um cycle)*

### responsible_executor
`platform-specialist` (escopo Finance module: sync + conciliação bancária)

### execution_type
`Agent` — orquestração 100% via LLM + Supabase client + invocação de Edge Functions. Human intervention obrigatória em DOIS pontos: (a) CONFIRMAÇÃO antes de aplicar qualquer sync/reconcile com `apply=true` (default é dry-run), (b) decisão sobre não-matches (aprovar/rejeitar/deixar para conciliação manual na UI).

### input

Entregue pelo `ops-chief` via `*handoff` ceremony:

- **Cycle ID** (obrigatório): `cyc-YYYY-MM-DD-NNN`
- **User JWT**: presente em `~/.primeteam/session.json` (auth já verificada pelo chief no step_1_receive). As EFs de reconcile exigem role **admin/owner** (guard interno via `is_admin`/`is_owner`) — RLS de finanças é `has_finance_access()` (owner + financeiro).
- **Request payload** (variável, mas normalmente inclui):
  - `window_days` (opcional, default 7) — janela de datas a conciliar. As EFs têm defaults próprios (reconcile-stripe-payments: 30d; reconcile-internal-transfers: 7d; stripe-funnel-reconcile: 3h).
  - `apply` (boolean, default `false`) — se `false`, roda TUDO em dry-run e só reporta. Só vira `true` após confirmação humana explícita.
  - `scope` (opcional): quais fontes conciliar nesta rodada (`stripe`, `revolut`, `transfers`, `funnel`, `all` — default `all`).
  - `landing_page_slug` (opcional) — passado a `reconcile-stripe-payments` quando o foco é um funil/LP específico.

### output

Retornado ao `ops-chief` via announcement V10 + handoff card V18:

- **`sync_summary`** — por fonte (stripe, revolut): quantas transações novas o sync trouxe / auto-lançou / marcou como pending.
- **`pending_review`** — snapshot de `finance_pending_transactions` com `status='pending'` (não conciliadas): contagem + lista com `id`, `source`, `type`, `amount`, `currency`, `description`, `match_score`, `suggested_match_id`.
- **`reconcile_summary`** — por EF de reconcile executada: `candidates`, `matched/recovered`, `skipped_existing`, `errors`.
- **`transfers_matched`** — pares inter-contas Stripe→banco pareados pelo `reconcile-internal-transfers` (cada par = 1 `finance_transactions` type=transfer + 2 pendings marcadas `reconciled_transaction_id` comum).
- **`non_matches`** — pendências que nenhum matcher pareou (ambíguas: 0 ou >1 candidato), com a recomendação (aprovar/rejeitar/deixar para UI).
- **`verdict`** — DONE | BLOCKED | ESCALATE.
- **`convention_check`**:
  - Stripe SSoT respeitado (zero venda Stripe lançada à mão): ✓
  - dry-run antes de apply: ✓
  - session read-only (nenhum UPDATE direto fora das EFs): ✓
  - status vocab correto por tabela: ✓
  - triggers hazard: N/A (nenhum bulk UPDATE) ou checklist rodada

### action_items

1. **Pre-check auth/role** — confirmar `~/.primeteam/session.json` válido e role admin/owner (as EFs de reconcile negam 401/403 fora disso). Se role insuficiente → BLOCKED com mensagem clara (has_finance_access / admin-owner requirement).

2. **Rodar os SYNCS primeiro (puxam o extrato bruto) — na ordem:**
   1. **`sync-stripe-transactions`** — puxa balance transactions do Stripe, mapeia tipo (charge/payment→income, refund/stripe_fee/dispute→expense, payout→transfer ou income se debit payout), **busca o IVA/VAT REAL** da invoice/checkout session (não estima), auto-lança a venda com líquido + IVA + taxa e faz match direto na conta; sem match → cria linha em `finance_pending_transactions` (badge de pendência).
   2. **`sync-revolut-transactions`** — puxa transações Revolut (JWT PKCS8), ignora a conta Reserve intermediária, e para cada perna tenta match contra previsões/leads (thresholds: sugestão 60, automático 90). Match automático concilia; abaixo do automático vira pending com `suggested_match_id`/`match_score`.
   - **Nota:** existem variantes cron (`sync-stripe-transactions-cron`, `sync-revolut-transactions-cron`) que já rodam sozinhas — esta task normalmente só CONFERE o resultado do cron; só re-dispara o sync se houver gap (ver regra SSoT-3: 1 cron por dado, não criar sync concorrente).

3. **Revisar as PENDÊNCIAS** — query read-only em `finance_pending_transactions` com `status='pending'` (VOCABULÁRIO desta tabela: `pending`/`paid`/`predicted` — nunca `completed`). Reportar contagem + campos-chave (`source`, `type`, `amount`, `currency`, `description`, `match_score`, `suggested_match_id`, `reconciled_transaction_id`). Validar com um termo-controle antes de reportar "0 pendências" (evitar falso vazio por filtro PostgREST inválido).

4. **CONFIRMAR antes de conciliar** — mostrar ao user o resumo dos syncs + a lista de pendências e perguntar se pode rodar os reconciles com `apply=true`. Sem "sim" explícito → parar em dry-run e reportar (verdict DONE, apply=false).

5. **Rodar os RECONCILES (pareiam/recuperam) — só após confirmação:**
   - **`reconcile-internal-transfers`** — matcher automático de transferências inter-contas: pareia a saída Stripe (pending type=transfer "STRIPE PAYOUT") com a entrada no banco (pending source=revolut type=income) por VALOR idêntico + MESMA empresa (`company_id` das contas) + janela de 7 dias. Exatamente 1 par → cria 1 `finance_transactions` type=transfer e marca as DUAS pendings `approved` com `reconciled_transaction_id` comum (rastreabilidade 2:1). Ambíguo (0 ou >1) → não toca, deixa para a UI. Idempotente por `external_id` do payout.
   - **`reconcile-stripe-payments`** — cruza opportunities em stage CHECKOUT com o Stripe: se `session.payment_status='paid'`, promove a opp para SALE_DONE preenchendo `stripe_paid_at`/`stripe_payment_intent_id`/`stripe_session_id`/`landing_page_slug`/`campaign_id`. Aceita `?landing_page_slug=`, `?days=`, `?apply=true` (default dry-run).
   - **`stripe-funnel-reconcile`** — recupera PaymentIntents de UPSELL/DOWNSELL que o `stripe-webhook` não processou (só trata `checkout.session.completed`); lê `metadata.funnel_position IN ('upsell','downsell')`, resolve a parent opportunity e insere em `automatic_sales` com `product_tier=funnel_position`. Idempotente por `stripe_payment_intent_id`. (Já roda por pg_cron a cada 30min — normalmente só conferir.)

6. **Tratar NÃO-MATCHES** — para cada pending que ficou sem par (ambígua): NÃO forçar match. Opções a apresentar ao user:
   - aprovar manualmente na UI de conciliação (fora do escopo de write desta task),
   - rejeitar (`rejected_by`/`rejected_reason`),
   - deixar para o próximo ciclo (o cron re-tenta).
   Nunca inventar um match nem lançar a venda Stripe à mão (double-count).

7. **Se — e só se — for necessário CORRIGIR uma linha já lançada** (match errado, reverter transfer): NÃO fazer UPDATE cru. Rodar a `checklists/finance-triggers-hazard.md` inteira antes: identificar quais dos 3 triggers o UPDATE dispara, `DISABLE TRIGGER <nome_específico>` (nunca `USER`), dry-run `SELECT`, UPDATE em transação com snapshot, `ENABLE` de volta, e se reverter corrigir `amount` E `converted_amount`. Preferir CREATE de linha compensatória (sign oposto) a UPDATE destrutivo.

8. **Retornar ao chief** — announcement V10 + output V11 + handoff card V18 com `sync_summary`, `pending_review`, `reconcile_summary`, `transfers_matched`, `non_matches`, `verdict`, `convention_check`.

### acceptance_criteria

- **[A1] Stripe SSoT respeitado:** zero venda originada no Stripe foi lançada manualmente em `finance_transactions`. Todo dado Stripe entrou via `sync-stripe-transactions` (líquido + IVA real + taxa). Handoff card confirma `stripe_manual_inserts: 0`.
- **[A2] Ordem correta:** syncs (`sync-stripe-transactions`, `sync-revolut-transactions`) rodaram/foram conferidos ANTES dos reconciles. Reconcile sem sync fresco = dado stale reportado como verdade → proibido.
- **[A3] Dry-run antes de apply:** nenhuma EF rodou com `apply=true` sem confirmação humana explícita registrada no handoff card. Default é dry-run.
- **[A4] Pending review com vocab certo:** a leitura de pendências usou `finance_pending_transactions.status='pending'` (nunca `completed`/`delayed`, que são de `finance_transactions`). Contagem validada contra um termo-controle antes de reportar.
- **[A5] Transfers 2:1 íntegras:** cada par pareado pelo `reconcile-internal-transfers` gerou exatamente 1 `finance_transactions` type=transfer + 2 pendings `approved` com o mesmo `reconciled_transaction_id`. Ambíguos foram deixados para a UI, não forçados.
- **[A6] Non-matches nunca forçados:** pendências sem par não viraram match inventado nem venda manual. Cada uma tem recomendação explícita (aprovar UI / rejeitar / próximo ciclo).
- **[A7] Triggers hazard:** se houve qualquer UPDATE/bulk em `finance_transactions`, a `finance-triggers-hazard.md` foi rodada e o handoff card lista quais triggers foram desabilitados pelo nome. Se não houve UPDATE, campo = N/A.
- **[A8] Role clarity:** se a role do user não tem admin/owner (ou `has_finance_access()`), verdict=BLOCKED com error code (401/403/42501) e mensagem apontando o requirement — não é falha do squad, é policy da plataforma.

---

## Exemplos de execução

### Exemplo 1 — Rotina diária limpa (DONE, dry-run + apply confirmado)

**Input do chief:**
```
*handoff @platform-specialist --cycle cyc-2026-07-02-140
Request: "conciliação bancária de hoje — rodar syncs, revisar pendências e conciliar"
User role: owner
```

**Specialist executa:**

1. Pre-check: session válida, role=owner ✓.
2. Confere os crons de sync (stripe + revolut já rodaram nas últimas horas) — sem gap, não re-dispara.
3. Query `finance_pending_transactions` status='pending' → 3 pendências:
   - `p1` source=revolut type=income €1.250 "Bonifico Nisi Antonia" match_score 88 (suggested_match_id setado)
   - `p2` source=stripe type=transfer €980 "STRIPE PAYOUT" (perna de saída)
   - `p3` source=revolut type=income €980 "Payment from Stripe Technology" (perna de entrada)
4. Confirmação:
   ```
   Syncs OK (crons frescos). 3 pendências:
   - 1 provável venda Revolut €1.250 (score 88 < 90, precisa revisão)
   - 1 par de transferência Stripe→banco €980 (candidato a auto-match)
   Posso rodar reconcile-internal-transfers com apply=true? (dry-run mostra 1 par limpo)
   ```
5. User: "sim"
6. `reconcile-internal-transfers?apply=true` → pareia p2+p3: cria 1 finance_transactions type=transfer €980 + marca p2/p3 approved com reconciled_transaction_id comum.
7. p1 (score 88) fica como non-match → recomenda aprovar na UI (nome invertido, revisão humana).
8. Return:
   ```
   [platform-specialist → ops-chief] Cycle cyc-2026-07-02-140 — DONE.

   sync_summary: stripe cron fresco / revolut cron fresco (sem gap)
   reconcile_summary: internal-transfers → candidates 1, matched 1, errors 0
   transfers_matched: [ €980 Stripe→Revolut (tx_transfer id: a1b..., pendings p2+p3) ]
   non_matches: [ p1 €1.250 score 88 → aprovar na UI (nome invertido) ]
   verdict: DONE
   convention_check: Stripe SSoT ✓, dry-run→apply ✓, session RO ✓, status vocab ✓
   ```

### Exemplo 2 — Usuário pede pra "lançar a venda que faltou" (ESCALATE / redirect)

**Input:** `"tem uma venda de €497 no Stripe que não aparece nas finanças, lança ela pra mim"`

**Specialist:** venda originada no Stripe → NÃO lançar à mão (double-count). O caminho é o sync/conciliação.

**Return:**
```
[platform-specialist → ops-chief] Cycle cyc-... — ESCALATE.

verdict: ESCALATE
suggested_user_message: |
  "Vendas do Stripe NUNCA são lançadas à mão — o sync-stripe-transactions é a
   fonte única (traz líquido + IVA real + taxa e concilia sozinho). Se a venda
   não aparece, ou o sync ainda não rodou pra essa data, ou ela caiu em pending
   aguardando match. Vou: (1) rodar/conferir o sync-stripe-transactions na
   janela, (2) checar finance_pending_transactions. Lançar manual geraria
   double-count. Confirma que rodo o sync?"
convention_check: Stripe SSoT ✓ (nenhum INSERT manual tentado)
```

### Exemplo 3 — Role sem finance access (BLOCKED)

**Input:** user role=cs pedindo `"rodar conciliação bancária"`

**Specialist:** invoca `reconcile-stripe-payments` → guard interno checa `is_admin`/`is_owner` → nenhum → 403.

**Return:**
```
[platform-specialist → ops-chief] Cycle cyc-... — BLOCKED.

verdict: BLOCKED
error: { code: 403, detail: "forbidden — admin/owner required" }
warnings: |
  As Edge Functions de conciliação (reconcile-stripe-payments, etc.) exigem
  role admin/owner, e o módulo Finance é has_finance_access() (owner+financeiro).
  Sua role (cs) não tem acesso. É restrição de segurança da plataforma.
suggested_next: escalate_to_user
```

---

## Notas de implementação

- **1 Sync, N Reads (SSoT-2/SSoT-3):** cada tabela canônica tem 1 EF de write e 1 cron. `sync-stripe-transactions`/`sync-revolut-transactions` (+ variantes `-cron`) são os únicos writers do extrato bruto; os reconciles pareiam/promovem, não duplicam a fonte. Não criar sync concorrente pela mesma tabela.
- **Idempotência:** `reconcile-internal-transfers` é idempotente por `external_id` do payout; `stripe-funnel-reconcile` por `stripe_payment_intent_id`; `sync-stripe-transactions` por identificador da balance transaction. Re-rodar não duplica.
- **Read-mostly:** o caminho default desta task é LER (syncs via cron já rodaram) e só disparar reconciles com `apply=true` após confirmação. Nenhum UPDATE cru em `finance_transactions` faz parte do fluxo normal.
- **IVA/faturamento:** o IVA vem REAL do Stripe (invoice.tax ou checkout session total_details.amount_tax), nunca 22% fixo. Fica FORA do faturamento líquido nos dashboards.
- **Colunas de match em `finance_pending_transactions`:** `match_score`, `match_details`, `suggested_match_id`, `reconciled_transaction_id`, `approved_at`/`approved_by`, `rejected_by`/`rejected_reason` — são o vocabulário de conciliação desta tabela (não confundir com os campos de `finance_transactions`).

---

**Mantido por:** platform-specialist (self-reference) + quality-guardian (hazard checklist) + ops-chief (orchestration updates em CHANGELOG).
