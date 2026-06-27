# Capture Infra — como obter as telas reais da Lovarch (ground-truth)

> Dois caminhos. O **B (screenshot→recria)** é o principal porque **nem todos os
> funcionários têm acesso ao repo da Lovarch** — e não terão.

## Caminho A — Recaptura automática em PRODUÇÃO (quem tem as 7 contas)

Para quem tem `SUPABASE_ACCESS_TOKEN` (Management API). **Não** precisa do repo
Lovarch, nem de dev server, nem do patch de realtime — roda contra `app.lovarch.com`.

```bash
cd /Users/pablo/PrimeTeam
# todas as telas (1 login por conta, agrupado):
node motion-engine/scripts/capture-ground-truth.mjs
# uma só:
node motion-engine/scripts/capture-ground-truth.mjs planning
```

Login autônomo (sem senha) via `lovarch-login.mjs`: Management API → revela
service_role → `admin/generate_link` (magic-link) → `verify` (anon) → sessão →
injetada em `localStorage['sb-cuxbydmyahjaplzkthkr-auth-token']` + flags de onboarding.

### As 7 contas PrimeVoices (DB `cuxbydmyahjaplzkthkr`, business + 100k créditos)

| alias | email | dados ricos |
|---|---|---|
| marco | `marco@archprime.io` | renders, caosometro, DISC/SWOT, archchat |
| caterina | `caterina@archprime.io` | finanças, computo, pricing, planning |
| tommaso | `tommaso@archprime.io` | projetos, contratos, timeline, portal |
| vittoria | `vittoria@archprime.io` | conteúdos, moodboard, lead magnet |
| lorenzo | `lorenzo@archprime.io` | automações, CRM, operações |
| olimpia | `olimpia@archprime.io` | renders, branding, moodboard, video |
| salvo | `salvo@archprime.io` | social, leads locais, calendário |

`profiles`: `setup_completed=true`, `brand_setup_complete=true`,
`onboarding_progress.wizard_completed=true`. `user_settings`: IT/EUR/architect/partita_iva.
**Manter o seeding intacto** (intencional).

### Override de ambiente
- `LOVARCH_URL` (default `https://app.lovarch.com`)
- `LOVARCH_PROJECT_REF` (default `cuxbydmyahjaplzkthkr`)

### Dev local (alternativa — evitar; só p/ telas não publicadas)
`cd /Users/pablo/Lovarch && npm run dev` (porta 8080). Há um bug de realtime
(`cannot add postgres_changes after subscribe` no `ai-credits` → ErrorBoundary
crasha): patch local em `src/hooks/useAiCredits.tsx` usando nome de canal único
`` `ai-credits-${targetUserId}-${Math.random().toString(36).slice(2,8)}` `` e
**SEMPRE reverter** (`git checkout`) — nunca vai pra produção. Produção dispensa isto.

## Login via Edge Function (sem token Supabase local) ⭐

Para quem **só tem o GitHub** (a maioria): o `flow-runner.mjs` NÃO usa service_role
nem Management API token. Ele chama a Edge Function **`primevoices-session`** (repo
Lovarch, `supabase/functions/primevoices-session`), que server-side gera a sessão da
conta escolhida e devolve. O service_role fica 100% no servidor.

- Config: `motion-engine/config/gateway.json` = `{ url, secret }` (shared secret de
  **baixo privilégio**: só libera sessão das 7 contas DEMO; repo privado = autorizado).
- Gating: header `x-internal-secret`. Allowlist fixa `@archprime.io`.
- Rotacionar o secret: `POST https://api.supabase.com/v1/projects/cuxbydmyahjaplzkthkr/secrets`
  `[{"name":"PRIMEVOICES_GATEWAY_SECRET","value":"novo"}]` + atualizar `gateway.json`.
- O `flow-runner` **pergunta com qual PrimeVoice gravar** (1–7) se `--account`/`account` não vier.

`capture-ground-truth.mjs` (caminho A) ainda usa Management API direto (p/ quem tem o
token); o `flow-runner` usa a EF (p/ todos).

## Caminho B — Screenshot → recria (sem acesso ao repo Lovarch) ⭐

O funcionário **não precisa de credencial nem do código**. Fluxo:

1. Tira um print da tela que mudou (ou exporta a screenshot da própria Lovarch) e
   salva em `motion-engine/ground-truth/<key>.png`.
2. O **@screen-motion-engineer** recria/ajusta o preset HTML correspondente usando
   os presets existentes como padrão (mesmo Design System V8, mesmo chrome de nav).
3. Roda o **smoke-verify** em loop até o SSIM passar do threshold:
   ```bash
   node motion-engine/scripts/smoke-verify.mjs \
     --preset scene-planning.html --truth ground-truth/mod-planning.png --threshold 0.95
   ```
4. Só então anima e renderiza com `render-motion.mjs`.

Ver `wf-lovarch-screen-motion.yaml` (workflow completo) e `motion-fidelity-rules.md`.

## Segurança
- Limpar `/tmp` de qualquer token/sessão após capturar.
- Nunca commitar service_role/anon keys nem sessões. Tudo via env.
