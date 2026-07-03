# CMS Pages vs Landing Pages — esclarecimento

> **TL;DR:** Desde 2026-05-04 (PrimeTeam PR #1226) `cms_pages` foi consolidada em `landing_pages`. **Tabela única** serve LPs em todos os 3 domínios. As tasks `create-cms-page`/`list-cms-pages`/`publish-cms-page` são alias semântico para a mesma tabela.

---

## Histórico

Antes de 2026-05-04 existiam duas tabelas:
- `landing_pages` — usada para `lp.archprime.io` (SPA via React)
- `cms_pages` — usada para `lovarch.com` e `archprime.io` (ISR via Next/Vercel)

Isso gerava duplicação de schema, EFs separadas (`landing-pages-api` vs `cms-pages-api`), policies divergentes e risk de divergir em features (ex: tracking, form mapping).

**PR #1226 (PrimeTeam, 2026-05-04)** convergiu tudo em `landing_pages` com nova coluna `target_domain`:

| target_domain | Renderer | Cache |
|---|---|---|
| `lp.archprime.io` | React SPA nativo no PrimeTeam (`LovarchPageRenderer`, hidratação de `<script>`) | client-side TanStack Query (60s staleTime) |
| `lovarch.com` | React nativo servido pelo PrimeTeam via rewrite (entry `lovarch.html`). Débito: `lovarch.com/page/{slug}` ainda espelhado no repo `ByPabloRuanL/lovarch` (PR companion) | Vercel ISR (`cms-revalidate`) |
| `archprime.io` | React nativo no PrimeTeam (entry `lp.html`) | Vercel ISR (`cms-revalidate`) |

> ⚠️ Renderer é **React nativo desde PR #1233** (NÃO iframe, NÃO Next.js/SSR próprio): `dangerouslySetInnerHTML` + re-hidratação manual de `<script>`, nunca `document.write()`. `lovarch.com` teve a raiz movida para o PrimeTeam (rewrite por host, memória 2026-06-22). DS/pixel/remetente por domínio: ver [`domain-brand-ds-registry.yaml`](./domain-brand-ds-registry.yaml) (HO-TP-003).

Após o PR, `cms_pages` foi dropada. EF `cms-pages-api` continua existindo (renomeada de fato, mesmo nome) e serve as 3 origens via `target_domain` filter.

## Por que existem tasks "create-cms-page" no squad

São **alias semântico**. Quando o user diz "criar CMS page" ou "criar página em archprime.io", ele está pensando no fluxo Next.js/ISR. Quando diz "criar LP", pensa em SPA. Mas em ambos os casos, o INSERT vai para `landing_pages`.

Tasks duplicadas por intenção do user, não por tabela diferente:

| Task | Quando user usa este vocabulário | Tabela alvo |
|------|----------------------------------|-------------|
| `create-landing-page` | "criar LP", "página de venda", evento | `landing_pages` |
| `create-cms-page` | "criar CMS page", "página em archprime.io" | `landing_pages` (mesma) |
| `list-cms-pages` | "listar páginas em lovarch.com" | `landing_pages` |
| `publish-cms-page` | "publicar página", toggle status draft→published | `landing_pages` |

**Implementação:** todas as 4 tasks operam sobre `landing_pages`. O que muda é:
- O contexto de confirmação (URL pública, cache TTL, webhook revalidate)
- Os filtros default em `list-*`
- A confirmação destrutiva em `publish-*` (publica conteúdo público)

## Convenções a respeitar

1. **Não criar nova tabela** — usar sempre `landing_pages`.
2. **Sempre passar `target_domain`** no INSERT/UPDATE — campo obrigatório que define onde a página vai aparecer.
3. **Cache:** mutations em pages publicadas em `lovarch.com` ou `archprime.io` exigem chamada à EF `cms-revalidate` (Vercel ISR). Para `lp.archprime.io` o cache é client-side, não precisa webhook.
4. **html_content é raw HTML self-contained** (padrão desde o PR #1226) — no **DS da marca do domínio** (HO-TP-003, `domain-brand-ds-registry.yaml`). O caminho `blocks` JSONB (Lovarch DS `BlockRenderer`) ainda existe no renderer, mas o fluxo default do squad é `html_content`.
5. **Lovarch dual-renderer obligation:** se o squad mexer em renderer/schema/tracking, deve abrir PR companion no repo `ByPabloRuanL/lovarch` (frontend Lovarch tem cópia espelhada de `LovarchPageRenderer.tsx` e `useCmsTracking.ts`). Ver CLAUDE.md do primeteam seção "CMS Dual-Renderer Sync".

## Domain matrix (RLS + active behavior)

| status | active | Renderer faz |
|--------|--------|--------------|
| `published` | `true` | renderiza HTML |
| `published` | `false` | redireciona para `redirect_to` ou `redirect_to_slug` |
| `draft` | qualquer | 404 (não acessível para anonymous) |
| `archived` | qualquer | 404 |

**RLS roles autorizados a manage** (desde 2026-05-09 PR #1411 + squad PR #33):
`owner`, `admin`, `marketing`, `comercial`, `cs`, `financeiro`. Qualquer authenticated lê `published+active`.

## Implicações para o squad

- `content-builder` é o único agent que toca `landing_pages` (e indiretamente `campaigns` via FK).
- Se um specialist diferente (sales, automation, etc.) precisar criar/atualizar LP → ESCALATE para content-builder, não tentar direto.
- Se o user pedir "publicar a LP X em lovarch.com", task é `publish-cms-page` (emite webhook ISR). Se pedir só "publicar a LP X" sem mencionar domínio, content-builder consulta `target_domain` da row antes de decidir.

---

**Mantido por:** content-builder (self-reference)
**Última atualização:** 2026-07-03 (G2/G5 — renderer React nativo + HO-TP-003 domínio→marca→DS)
