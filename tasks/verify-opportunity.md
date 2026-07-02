# Task: verify-opportunity

> status: deprecated
> deprecated_em: 2026-07-02
> motivo: descreve um fluxo de "verdict" (verified/duplicate/suspicious/unverify + merge de
> duplicadas) que **nunca existiu no schema**. Nenhuma das tabelas/colunas citadas existe.
> substituto: UI `/opportunity-verification` (v2 → página `apps/v2/src/pages/Verifica.tsx`),
> um wizard de **reconciliação em massa de CSV/print** contra `opportunities` — não um marcador
> de veredito por oportunidade.

---

## ⛔ POR QUE ESTA TASK FOI APOSENTADA

A versão anterior desta task descrevia um sistema de **verdict de data quality** onde um
admin marcava uma opportunity como `verified | duplicate | suspicious | unverify`, com merge
de duplicadas. Auditoria contra o schema vivo (`apps/v2/src/integrations/supabase/types.ts`,
2026-07-02) comprovou que **nada disso existe**:

**Tabelas que NÃO existem:**
- `opportunity_verification_results` — não existe no `types.ts`.

**Colunas que NÃO existem na tabela `opportunities`:**
- `verification_status`
- `merged_into_opportunity_id`
- `verified_by`
- `verified_at`
- `verification_notes`
- `customer_name` (a tabela usa `lead_id`, não guarda nome do cliente)
- `total_amount` (a tabela usa `ltv` / `mrr` / `sales_proposal_value`)

Portanto o `UPDATE opportunities SET verification_status=…, merged_into_opportunity_id=…`
descrito na task antiga **falharia** — todas essas colunas são inexistentes. O fluxo de
"marcar duplicada e mergear contatos/histórico" não tem lastro em nenhuma tabela.

O nome da Edge Function (`opportunities-verification-update`) e da rota
(`/opportunity-verification`) criou a confusão: "verification" aqui **não** significa
"veredito/verificação de qualidade", e sim **verifica** (italiano: conferir/reconciliar) —
o wizard de reconciliação de vendas.

---

## ✅ O QUE EXISTE DE VERDADE (para onde ir)

### UI
- **Rota:** `/opportunity-verification`
- **Página v2:** `apps/v2/src/pages/Verifica.tsx`
- **Wizard:** `apps/v2/src/components/verifica/` (UploadStep → MappingStep → MatchingStep →
  PreviewStep → ConfirmationStep) + client `apps/v2/src/lib/verifica/client.ts`.

### O que o fluxo real faz
Reconcilia **em massa** um CSV (ou print/imagem via OCR) de vendas contra as `opportunities`
existentes: faz matching lead ↔ campanha (similaridade de string / Levenshtein, normalização
de telefone, parse de data europeia, mapeamento de `stage`), mostra match exatos vs prováveis,
e aplica os updates confirmados. **Não** há veredito por oportunidade, **não** há merge de
duplicadas.

### Edge Function real (confirmada em `supabase/functions/opportunities-verification-update/`)
- **Nome:** `opportunities-verification-update`
- **Actions:** `analyze` | `confirm` | `execute` (com `dryRun` opcional no execute)
- **Escreve apenas em:** `opportunities` (+ histórico em `opportunity_history`).

### Tabelas reais tocadas (confirmadas no `types.ts`)
- `opportunities` (colunas reais relevantes: `id`, `lead_id`, `campaign_id`, `stage`,
  `launch_stage`, `product`, `product_id`, `sales_proposal_value`, `ltv`, `mrr`,
  `sale_source`, `created_by`, `updated_at`).
- `opportunity_history`.

---

## Se um dia o "verdict/dedup" for de fato construído

Antes de reabrir esta task: criar primeiro a estrutura no schema (tabela dedicada de
verificação **ou** colunas em `opportunities`), aplicar RLS, gerar `types.ts`, e só então
escrever a task fiel às colunas/EF reais. Enquanto isso não existir, esta task permanece
`deprecated` — não invente tabelas.

---

**Mantido por:** sales-specialist · **Estado:** deprecated (aponta para `/opportunity-verification`)
