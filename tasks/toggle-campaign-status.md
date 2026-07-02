# Task: toggle-campaign-status

> Alterna o status INTERNO de uma campanha na plataforma (`campaigns.status`). Sandra usa diariamente para ajustes táticos de organização/pipeline. Implementa F-04.
>
> ⚠️ **NÃO confundir com pausar/reativar o anúncio no Meta Ads.** Mudar `campaigns.status` é um UPDATE local no banco — NÃO toca a Graph API, NÃO pausa gasto, NÃO altera o `effective_status` do Meta. Pausar/reativar de verdade no Meta é um FLUXO SEPARADO (ver "Fluxo B" abaixo). São coisas diferentes.

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name
`Toggle Campaign Status (interno)`

### responsible_executor
`content-builder` (or sales-specialist se campanha=opp pipeline)

### execution_type
`Agent` — confirmation simples.

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload:**
  - `campaign_id` (uuid — PK interna de `campaigns.id`)
  - `new_status` (`'active' | 'paused' | 'archived'` — vocabulário INTERNO da plataforma, string livre em `campaigns.status`)
  - `reason` (string opcional)
  - `also_pause_on_meta` (boolean, default `false`) — quando `true` e a campanha tem `meta_campaign_id`, dispara TAMBÉM o Fluxo B (efeito externo real no Meta). Sem isso, o toggle é só interno.

### output

- **`campaign_id`**, **`old_status`**, **`new_status`** (interno)
- **`meta_effect`** — `none | paused_on_meta | reactivated_on_meta | skipped_no_meta_id`
- **`verdict`** — `DONE | BLOCKED | ESCALATE`

---

## ⚠️ Distinção fundamental — dois fluxos DIFERENTES

Há duas operações que soam iguais mas são independentes. Esta task trata do **Fluxo A** por padrão; só toca o **Fluxo B** se o usuário pedir explicitamente (`also_pause_on_meta=true`).

| | **Fluxo A — Status INTERNO** | **Fluxo B — Pause/Resume no META** |
|---|---|---|
| O que muda | `campaigns.status` (estado da campanha DENTRO da plataforma) | `effective_status` do anúncio no Meta Ads (liga/desliga entrega e gasto) |
| Onde | Banco Supabase, tabela `campaigns` | Graph API do Meta (`graph.facebook.com`) |
| Como | UPDATE local (via EF `campaigns-api` ou UPDATE autenticado) | `POST graph.facebook.com/v21.0/{meta_campaign_id}` com `status=PAUSED`/`ACTIVE` |
| EF real | `campaigns-api` (write da row) | `meta-ads-pause-all-active` (bulk, user-facing) — ou o padrão per-campaign de `squad-agent-budget-marcus` (`metaPauseCampaign`) |
| Chave usada | `campaigns.id` (uuid interno) | `campaigns.meta_campaign_id` (ID do Meta, ex. `120212…`) — NÃO o uuid interno |
| Custo/entrega | NÃO afeta gasto nem entrega | Pausa/retoma gasto real na conta de anúncios |

**❌ NÃO existe** uma EF que faça "mudar status interno" e "pausar no Meta" na mesma chamada. Um UPDATE em `campaigns.status` **jamais** pausa o anúncio no Meta. Se o usuário quer parar o gasto, é obrigatório o Fluxo B.

**⚠️ Cuidado com o nome enganoso `meta-ads-optimization-toggle`:** apesar do nome, essa EF **NÃO pausa campanha nenhuma**. Ela apenas liga/desliga a flag `app_settings.meta_ads_optimization_enabled` (o pipeline de otimização por IA — agents Marcus/Foxwell/Loomer/BPM). Não é o Fluxo B; não confundir.

---

## Fluxo A — Toggle do status INTERNO (padrão)

### action_items

1. **Role check:** marketing/admin/owner.
2. **Resolver campaign:** `SELECT id, name, status, lifecycle_status, meta_campaign_id FROM campaigns WHERE id={campaign_id}`. Guardar `lp_count`, `leads_count` para o echo.
3. **Validar transition** (vocabulário interno, string livre):
   - active → paused: OK
   - paused → active: OK
   - * → archived: warning (esconde da listagem default; reversível por novo UPDATE, mas some da view padrão)
4. **Confirmation:**
   ```
   Toggle INTERNO da campanha «{name}»:
     Status interno: {old} → {new}
     Active LPs: {N} | Leads in queue: {M}
     Meta vinculado: {meta_campaign_id ? meta_campaign_id : '(sem meta_campaign_id — campanha não-Meta)'}
     ⚠️ Isto NÃO pausa o anúncio no Meta nem para o gasto.
        {also_pause_on_meta ? 'Você pediu TAMBÉM pausar no Meta (Fluxo B) — ver confirmação seguinte.' : 'Para parar o gasto no Meta, rode o Fluxo B (also_pause_on_meta=true).'}
     Reason: {reason or '(sem reason)'}
   Confirma?
   ```
5. **UPDATE (apenas colunas REAIS de `campaigns`):**
   ```sql
   -- Colunas confirmadas em campaigns: status, lifecycle_status, updated_at, metadata.
   -- NÃO existem as colunas updated_by / status_change_reason / status_changed_at.
   -- reason vai para o activity_log (passo 7), não para uma coluna inventada.
   UPDATE campaigns
   SET status = {new_status},
       updated_at = NOW()
   WHERE id = {campaign_id};
   ```
   > Caminho preferido é via EF `campaigns-api` (PATCH/POST da row) para passar pelo mesmo gate de auth; UPDATE direto autenticado é aceitável.
6. **Activity log:** action='content-builder.toggle_campaign_status', details `{ old_status, new_status, reason, meta_effect }`.
7. **Echo:** "✓ Status INTERNO de {name}: {old} → {new}. {N LPs ativas, M leads na queue}. {meta_effect == 'none' ? 'Anúncio no Meta NÃO foi tocado.' : ...}"

### acceptance_criteria (Fluxo A)

- **[A1] Role marketing/admin/owner.**
- **[A2] Transition interna válida.**
- **[A3] Confirmation deixa explícito que NÃO pausa no Meta.**
- **[A4] UPDATE usa só colunas reais (`status`, `updated_at`) — nunca colunas inventadas.**
- **[A5] Audit diff no activity_log (reason vai aqui, não em coluna).**

---

## Fluxo B — Pause/Resume no META (efeito externo real)

> Só executa se `also_pause_on_meta=true` **e** a campanha tem `meta_campaign_id`. Se `meta_campaign_id` for null → `meta_effect='skipped_no_meta_id'` e avisar que não há vínculo Meta para pausar.

### action_items

1. **Pré-condição:** `campaigns.meta_campaign_id IS NOT NULL`. Este é o ID do Meta (ex. `120212…`), NÃO o uuid interno.
2. **Confirmation dedicada** — este passo PARA o gasto real:
   ```
   ⚠️ Fluxo B — EFEITO REAL no Meta Ads:
     Campanha Meta: {meta_campaign_id} («{name}»)
     Ação: {new_status == 'paused' ? 'PAUSED (para entrega e gasto)' : 'ACTIVE (retoma entrega e gasto)'}
   Isto altera a conta de anúncios de verdade. Confirma?
   ```
3. **Chamada real (uma de duas opções):**
   - **Bulk (pausar TODAS ativas da conta):** invocar EF `meta-ads-pause-all-active`
     ```
     POST /functions/v1/meta-ads-pause-all-active
     Body: { "ad_account_meta_id": "2147699252408628", "dry_run": true }  // dry_run primeiro
     ```
     A EF lê o token via RPC SECURITY DEFINER `get_meta_access_token` (Vault) e faz `POST graph.facebook.com/v21.0/{campaign_id}` com `status=PAUSED` para cada ativa.
   - **Per-campaign (uma campanha):** seguir o padrão de `squad-agent-budget-marcus` → `metaPauseCampaign()`:
     ```
     POST https://graph.facebook.com/v21.0/{meta_campaign_id}
     Content-Type: application/x-www-form-urlencoded
     Body: status=PAUSED&access_token={token}        // ou status=ACTIVE para reativar
     ```
     Token obtido via RPC `get_meta_access_token` — NUNCA hardcodar nem expor ao caller.
4. **Registrar `meta_effect`** (`paused_on_meta` | `reactivated_on_meta` | `skipped_no_meta_id`) no output e no activity_log.
5. **NÃO** assumir que o Fluxo B alterou `campaigns.status` — se quiser refletir o novo estado internamente, isso é o Fluxo A (passo separado). Idealmente rodar A e B juntos quando `also_pause_on_meta=true`, mas cada um escreve na sua fonte.

### acceptance_criteria (Fluxo B)

- **[B1] `meta_campaign_id` presente; senão `skipped_no_meta_id` + aviso.**
- **[B2] Confirmation dedicada avisando que PARA o gasto real.**
- **[B3] Chamada via EF `meta-ads-pause-all-active` (bulk) ou POST Graph API `status=PAUSED/ACTIVE` no `meta_campaign_id`.**
- **[B4] Token só via RPC `get_meta_access_token` (Vault) — nunca exposto.**
- **[B5] `meta_effect` registrado no output + activity_log.**

---

## Referências reais confirmadas (2026-07-02)

- **Coluna de status interno:** `campaigns.status` (string, NOT NULL). Também existem `campaigns.lifecycle_status` (nullable) e `campaigns.meta_campaign_id` (nullable — vínculo com o Meta). — `apps/v2/src/integrations/supabase/types.ts` (tabela `campaigns`, ~L4108).
- **EF de write interno:** `supabase/functions/campaigns-api/index.ts` (POST/PATCH/DELETE da row `campaigns`).
- **EF real de pause no Meta (bulk):** `supabase/functions/meta-ads-pause-all-active/index.ts` — `POST graph.facebook.com/v21.0/{campaign_id}` `status=PAUSED`; token via `get_meta_access_token`.
- **Pause per-campaign (padrão de referência):** `supabase/functions/squad-agent-budget-marcus/index.ts` → `metaPauseCampaign(metaCampaignId, token)`.
- **NÃO é pause de campanha:** `supabase/functions/meta-ads-optimization-toggle/index.ts` — só alterna a flag `app_settings.meta_ads_optimization_enabled` (pipeline de IA). Nome enganoso; não usar como Fluxo B.

---

## Exemplos

### Exemplo 1 — Sandra organiza pipeline (só interno)

**Input:** `new_status='paused'`, `also_pause_on_meta=false`, reason='CTR baixo, refazer creative'

**Specialist:** confirmation (avisando que NÃO toca o Meta) → UPDATE `campaigns.status` → echo "Status interno pausado. Anúncio no Meta NÃO foi tocado." → `meta_effect='none'`.

### Exemplo 2 — Sandra quer PARAR o gasto de verdade

**Input:** `new_status='paused'`, `also_pause_on_meta=true` (campanha tem `meta_campaign_id`)

**Specialist:** Fluxo A (UPDATE interno) **+** Fluxo B (confirmation dedicada → POST Graph API `status=PAUSED` no `meta_campaign_id` via token do Vault) → `meta_effect='paused_on_meta'`.

### Exemplo 3 — Campanha sem Meta vinculado, pediu also_pause_on_meta

**Input:** `also_pause_on_meta=true`, mas `meta_campaign_id IS NULL`

**Specialist:** faz Fluxo A; Fluxo B → `meta_effect='skipped_no_meta_id'` + aviso "campanha não tem vínculo Meta para pausar".

---

**Mantido por:** content-builder
