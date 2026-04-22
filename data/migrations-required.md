# Migrations Required — primeteam-side Schema Changes

> Documento de **handoff** para team primeteam. Lista migrations Supabase que precisam existir no repo `ByPabloRuanL/primeteam` em `supabase/migrations/` para alguns workflows deste squad funcionarem.

---

## Status atual (2026-04-22)

| # | Migration | Usado por | Priority | Complexity |
|---|-----------|-----------|:--------:|:----------:|
| 1 | `fx_rate_cache` table | wf-currency-convert | P2 | Low |
| 2 | `ab_test_results` table | wf-meta-ab-test | P3 | Medium |
| 3 | `finance_transactions_audit` trigger | platform-specialist future_notes | P3 | Medium |
| 4 | `edge_function_audit_log` table | all edge functions (security) | P3 | Low |

**Priority:** P2 (when workflow is used) / P3 (optimization — workflow funciona em memória por enquanto).

---

## 1. `fx_rate_cache` table

**Usado por:** `workflows/wf-currency-convert.yaml` (phase 2 + phase 3 cache check).

**Propósito:** Cache local de rates FX para evitar repeated external API calls (ECB / Revolut).

**Schema:**

```sql
CREATE TABLE public.fx_rate_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_date date NOT NULL,
  from_currency text NOT NULL,
  to_currency text NOT NULL,
  rate numeric(20, 10) NOT NULL,
  source text NOT NULL CHECK (source IN ('ECB', 'revolut', 'manual')),
  fetched_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (rate_date, from_currency, to_currency, source)
);

CREATE INDEX idx_fx_rate_cache_lookup
  ON public.fx_rate_cache (rate_date, from_currency, to_currency);

ALTER TABLE public.fx_rate_cache ENABLE ROW LEVEL SECURITY;

-- RLS: any authenticated user can read (rates são públicos)
CREATE POLICY "fx_rate_cache_select_authenticated"
  ON public.fx_rate_cache FOR SELECT TO authenticated
  USING (true);

-- INSERT only via edge function (service_role)
-- (authenticated role shouldn't insert directly — rates come from trusted source)
```

**Considerações:**
- ECB rates são **imutáveis retroativamente** (cache forever)
- Revolut rates são snapshot-based (também estáveis para past dates)
- `manual` source é para one-off user-provided rates (rare)

---

## 2. `ab_test_results` table

**Usado por:** `workflows/wf-meta-ab-test.yaml` (phase 3 + 4 tracking + significance).

**Propósito:** Track A/B test metadata + per-variant performance aggregated. Permite resumption de tests long-running (dias) + histórico.

**Schema:**

```sql
CREATE TABLE public.ab_test_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ab_test_id uuid NOT NULL,  -- groups variants A + B
  variant_name text NOT NULL CHECK (variant_name IN ('A', 'B', 'control', 'treatment')),
  campaign_id text NOT NULL,  -- Meta campaign_id (from meta_ads_campaigns_cache)
  hypothesis text,
  variable_tested text CHECK (variable_tested IN ('creative', 'audience', 'headline', 'budget', 'placement', 'bid_strategy')),
  success_metric text CHECK (success_metric IN ('CTR', 'CPL', 'CPA', 'ROI', 'conversions')),
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  ends_at timestamp with time zone,
  status text NOT NULL CHECK (status IN ('running', 'completed', 'inconclusive', 'aborted')),

  -- aggregated metrics (snapshot'd periodically)
  total_spend numeric(20, 4),
  total_impressions integer,
  total_clicks integer,
  total_leads integer,
  total_conversions integer,
  ctr numeric(10, 6),
  cpl numeric(20, 4),
  roi numeric(10, 4),
  confidence_interval numeric(5, 4),  -- last computed

  created_by uuid REFERENCES auth.users(id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_ab_test_results_ab_test_id
  ON public.ab_test_results (ab_test_id);
CREATE INDEX idx_ab_test_results_status
  ON public.ab_test_results (status) WHERE status = 'running';

ALTER TABLE public.ab_test_results ENABLE ROW LEVEL SECURITY;

-- RLS: owner/admin/marketing can read + insert
CREATE POLICY "ab_test_results_select"
  ON public.ab_test_results FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'owner') OR
    has_role(auth.uid(), 'admin') OR
    has_role(auth.uid(), 'marketing')
  );

CREATE POLICY "ab_test_results_insert"
  ON public.ab_test_results FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'owner') OR
    has_role(auth.uid(), 'admin') OR
    has_role(auth.uid(), 'marketing')
  );

CREATE POLICY "ab_test_results_update"
  ON public.ab_test_results FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(), 'owner') OR
    has_role(auth.uid(), 'admin') OR
    (has_role(auth.uid(), 'marketing') AND created_by = auth.uid())
  );
```

**Considerações:**
- `ab_test_id` groups 2 rows (A + B). Specialist gera uuid + insert 2 rows em setup phase.
- Metrics são snapshotted (não live queried cada vez) — cron job ou manual refresh.
- Winner decision é humana (consultar FINAL-STATE.md workflow notes) — status='completed' só marca quando user decide, não auto.

---

## 3. `finance_transactions_audit` trigger (P3 — opcional)

**Usado por:** future_notes do platform-specialist (finance_history_missing).

**Propósito:** Auditar UPDATE em `finance_transactions` (hoje UPDATEs silenciosamente perdem valores antigos).

**Schema:**

```sql
CREATE TABLE public.finance_transactions_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('UPDATE', 'DELETE')),
  changed_by uuid REFERENCES auth.users(id),
  changed_at timestamp with time zone NOT NULL DEFAULT now(),
  old_row jsonb NOT NULL,  -- snapshot completo antes
  new_row jsonb  -- snapshot completo depois (null se DELETE)
);

CREATE INDEX idx_finance_audit_tx
  ON public.finance_transactions_audit (transaction_id);
CREATE INDEX idx_finance_audit_date
  ON public.finance_transactions_audit (changed_at DESC);

-- Trigger
CREATE OR REPLACE FUNCTION public.finance_transactions_audit_fn()
RETURNS trigger AS $$
BEGIN
  IF (TG_OP = 'UPDATE') THEN
    INSERT INTO public.finance_transactions_audit
      (transaction_id, operation, changed_by, old_row, new_row)
    VALUES
      (OLD.id, 'UPDATE', auth.uid(), to_jsonb(OLD), to_jsonb(NEW));
  ELSIF (TG_OP = 'DELETE') THEN
    INSERT INTO public.finance_transactions_audit
      (transaction_id, operation, changed_by, old_row, new_row)
    VALUES
      (OLD.id, 'DELETE', auth.uid(), to_jsonb(OLD), NULL);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER finance_transactions_audit_trigger
  AFTER UPDATE OR DELETE ON public.finance_transactions
  FOR EACH ROW EXECUTE FUNCTION public.finance_transactions_audit_fn();

-- RLS: só owner/financeiro podem ler audit
ALTER TABLE public.finance_transactions_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "finance_audit_select"
  ON public.finance_transactions_audit FOR SELECT TO authenticated
  USING (has_finance_access());
```

**Impacto:** adiciona storage overhead (cada UPDATE duplica row em audit). Para tabela com muitas UPDATEs (1000+/dia), considerar partition by month ou retention policy (delete after 6 months).

---

## 4. `edge_function_audit_log` table (P3 — opcional)

**Usado por:** todas edge functions deste doc (security best practice).

**Propósito:** Rastrear quem chamou qual edge function, quando, com quais params.

**Schema:**

```sql
CREATE TABLE public.edge_function_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  function_name text NOT NULL,
  user_id uuid REFERENCES auth.users(id),
  called_at timestamp with time zone NOT NULL DEFAULT now(),
  request_body jsonb,  -- sanitized (no tokens!)
  response_status integer,
  error_message text,
  duration_ms integer
);

CREATE INDEX idx_edge_audit_function
  ON public.edge_function_audit_log (function_name, called_at DESC);
CREATE INDEX idx_edge_audit_user
  ON public.edge_function_audit_log (user_id, called_at DESC);

ALTER TABLE public.edge_function_audit_log ENABLE ROW LEVEL SECURITY;

-- Only owner reads
CREATE POLICY "edge_audit_select_owner"
  ON public.edge_function_audit_log FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'owner'));
```

Cada edge function deve fazer INSERT opcional em sua próprie entry point (após auth + antes de body processing).

---

## Ordering recomendado

Se team primeteam quiser implementar, sugerida ordem:

**Imediate (quando usar workflow):**
1. `fx_rate_cache` — implement quando financeiro primeiro pedir currency conversion retroativo (wf-currency-convert).
2. `ab_test_results` — implement quando marketing primeiro rodar A/B test via squad.

**Long-term (security/audit):**
3. `edge_function_audit_log` — considerar implementar proativamente se há sensitivity.
4. `finance_transactions_audit` — alta complexity, avaliar custo/benefício.

---

## Referências

- Workflows que dependem: `workflows/wf-currency-convert.yaml`, `workflows/wf-meta-ab-test.yaml`
- Specialists que mencionam em future_notes: `agents/platform-specialist.md` (finance_history), `agents/integration-specialist.md`
- Edge functions relacionadas: `data/edge-functions-required.md`

---

**Mantido por:** squad primeteam-ops (consumer) + team primeteam (implementer).
