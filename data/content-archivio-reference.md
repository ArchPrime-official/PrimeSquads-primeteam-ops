# Content Archivio — referência canônica de publicação de conteúdo

> Fonte viva mapeada em 2026-07-11 (migrations + EFs reais do PrimeTeam). Consulte antes de
> QUALQUER publicação/agendamento de conteúdo. Regra do Pablo: **toda publicação passa por
> renomeador → arquivo → programação, independente do formato.**

## O fluxo canônico (nascimento → publicação → arquivo)

```
1. NASCIMENTO   asset gerado → content_assets (bucket creative-generated, signed URL 7d)
2. PUBLICAÇÃO   INSERT em ig_posts (draft/scheduled + scheduled_for)
3. NOMENCLATURA trigger ig_post_autoregister dá o content_code + cria content_registry  ← AUTOMÁTICO
4. ARQUIVO      materiais de origem → bucket content-archive + content_registry_assets
5. PUBLISH      cron instagram-publish-cron (5 min) → EF instagram-publish → permalink
6. CLASSIFICA   cron content-classify-new (2h) → EF content-ai-classify (angle/tipo/funnel/cta)
7. MÉTRICAS     EF instagram-collect-insights (6h) → ig_posts.insights + ig_post_insights_daily
8. DISTRIBUI    content_code DENTRO do ad_name → match_content_distribution liga orgânico↔pago
```

## Regras que NÃO se negociam

1. **Post IG: o código vem do TRIGGER.** INSERT em `ig_posts` → `ig_post_autoregister`
   atribui `content_code` (ARC/LOV-NNNN) e cria o registro no `content_registry` sozinho.
   **NUNCA chamar `next_content_code` antes de um INSERT em `ig_posts`** — geraria 2 códigos
   (1 queimado para sempre; o contador nunca reusa).
2. **`next_content_code(p_company_id)` SÓ para conteúdo que NÃO vira ig_post** (LP, YouTube,
   e-mail criativo) → depois INSERT manual em `content_registry`.
3. **Nomenclatura NUNCA à mão.** O trigger `content_registry_set_nomenclature` recompõe os
   **10 blocos** dos campos padronizados:
   `{NNNN} [BRAND] [FUNNEL] [ANGOLO] [TEMA] [FORMATO] [ASPECT] [CANALI] [CAMPAGNA] [CTA]`
   ex.: `0574 [ARCHPRIME] [TOFU] [DOLORE] [VALORE-PROCESSO-METODO] [CAROSELLO] [4:5] [IG] [NESSUNA] [COMMENTA]`
4. **URL pública estável em `media_urls`.** A Meta baixa o arquivo NA PUBLICAÇÃO — signed URL
   que expira antes do `scheduled_for` = publish falha. Re-gerar ou usar URL pública.
5. **Verificação por SELECT antes de reportar** — `ig_posts.content_code` atribuído? status
   certo? `content_registry` row existe? (smoke obrigatório).
6. **Distribuição paga: `content_code` DENTRO do `ad_name`** — ativa a estratégia C do
   `match_content_distribution` e o Archivio passa a mostrar spend/leads por conteúdo.
7. **Classificação é automática** (cron 2h) — não classificar angle/funnel manualmente.

## Como agendar um post (o INSERT)

```
tabela: ig_posts
account_id   = instagram_accounts.id  (archprime.io → códigos ARC · bylovarch → LOV)
media_type   = 'image' | 'reel' | 'carousel' | 'story'
media_urls   = ['<url pública>', ...]   -- >= 1; publish usa media_urls[0]
caption      = texto final (IT, verificado)
status       = 'scheduled'   (+ scheduled_for timestamptz CET)  | 'draft'
```
Publicar agora = INSERT + chamar EF `instagram-publish` com `{post_id}`.

## Onde cada coisa vive

| Coisa | Nome | Nota |
|---|---|---|
| Arquivo permanente (SSoT) | tabela `content_registry` | código UNIQUE, tsvector, `ig_post_id`, `distributed`, `meta_ad_ids` |
| Contador de códigos | `content_code_counters` | atômico por empresa, começa 0, nunca reusa |
| Materiais de origem | bucket `content-archive` | path `<registry_id>/<arquivo>` + `content_registry_assets` |
| Assets gerados (fábrica) | `content_assets` + bucket `creative-generated` | signed URL 7d, idempotency_key |
| Publicação IG | tabela `ig_posts` | ver INSERT acima |
| Gerar código manual | RPC `next_content_code(p_company_id)` | → `(number, code)`; só caminho não-IG |
| Re-gerar nomenclatura | RPC `regenerate_content_nomenclature(p_company_id)` | idempotente, empresa inteira |
| Publicar 1 post | EF `instagram-publish` | body `{post_id}` |
| Publicar agendados | EF `instagram-publish-cron` | pg_cron 5 min |
| Classificar por IA | EF `content-ai-classify` | body `{registry_id}`; cron `content-classify-new` 2h |
| Insights orgânicos | EF `instagram-collect-insights` | cron 6h → `insights` + `ig_post_insights_daily` |
| Matcher orgânico↔pago | RPC `match_content_distribution()` | 3 estratégias; C = código no ad_name |
| Métricas pagas por conteúdo | RPC `get_content_paid_metrics(p_registry_id)` | spend/impressions/clicks/leads |

## Quem executa o quê

- **Ciclo nascido no creative-studio** → o `@creative-chief` roteia ao **`@content-publisher`**
  (fase 13 do pipeline; workflow `wf-publish-to-platform`) e retoma o ciclo com o report
  (content_code + status + horário).
- **Publish de responsabilidade do primeteam-ops** (wf-creative-to-publish fase 7) →
  `@content-builder` executa o MESMO processo canônico deste doc.
- **Distribuição paga** → squad `meta-ads`, recebendo o `content_code` com a regra do ad_name.
