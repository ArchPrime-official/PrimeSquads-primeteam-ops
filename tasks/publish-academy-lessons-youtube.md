# Task: publish-academy-lessons-youtube

> Task de **runbook semi-automatizado** para publicar aulas já renderizadas no YouTube como **Non in elenco** (unlisted), aplicar thumbnail customizada, apontar `acad_lessons.video_url` para o YouTube e validar por **smoke visual** que o vídeo TOCA no `academy.archprime.io`. Não substitui vídeos que já funcionam sem confirmar a nova origem primeiro. Validado em 2026-07-03 publicando os 18 restantes do curso Strateg·IA CAC (133/133).
>
> ⚠️ **Runbook local, não Edge Function.** Roda na máquina do Pablo via Playwright no perfil dedicado `.yt-auto-prof` (Studio não renderiza headless). Scripts em `~/academy-engine/scripts/academy-voce/` (runbook técnico: `README-youtube-academy.md`). Migração do MP4 para YouTube alivia o storage do Supabase e unifica a origem.

**Cumpre:** HO-TP-001 (Task Anatomy — 8 campos)

---

## Task anatomy

### task_name
`Publish Academy Lessons to YouTube`

### status
`pending`

### responsible_executor
`screen-motion-engineer` (dono do domínio de vídeo das aulas — valida por smoke test em loop)

### execution_type
`runbook` semi-automatizado (Playwright headed no perfil `.yt-auto-prof`, já logado). Idempotente por lote isolado.

### input
- **`codes`** (obrigatório): lista de códigos de aula do lote (ex `C4.1`, `C4.16`). Derivam slug `cac-<code lower, . → ->`.
- **Pré-condições materiais** (ESCALATE se faltarem):
  - MP4 comprimidos em `~/Desktop/aulas-render/web/AULA-<CODE>.mp4`
  - Thumbs 3:2 em `apps/v2/public/academy/cac-16x9/<CODE>.webp`
  - Perfil `.yt-auto-prof` logado no canal `UCtHAvdzlUNfmUYXTsbtMH7A`
  - `_aule-map.json` cobre os códigos (título/fase/módulo)

### output
- Cada `acad_lessons` do lote com `video_url = https://youtu.be/<id>` (upsert idempotente, slug `cac-<code>`).
- Vídeos no YouTube: **Non in elenco** + thumbnail customizada (maxresdefault).
- `is_active=true`. Poster no player continua vindo do webp local (`/academy/cac-16x9/<CODE>.webp`).

### action_items
1. **Isolar o lote** — criar dir próprio `/tmp/<lote>/` (manifest, results, wire-map). NUNCA usar `/tmp/yt-*.json` compartilhado (outra sessão pode sobrescrever — ver Notas).
2. **Thumbs JPG 1280** — `sips -s format jpeg -Z 1280 <CODE>.webp --out /tmp/yt-thumbs/<CODE>.jpg` (YouTube não aceita webp).
3. **Upload (yt-upload-prof.cjs v2)** — sobe cada MP4 via `#upload-icon`. **VETO se regredir a espera do upload completar** (rastreio de rede) — senão upload parcial → nunca processa. Captura `youtu.be/<id>`. Testar 1 antes do batch.
4. **Publicar rascunhos (yt-pub.cjs)** — vídeos finalizados durante processamento ficam em **Bozza**; publicar como Non in elenco. `incerto` = falso-negativo → re-rodar single.
5. **Thumbnail (yt-thumb.cjs)** — subir o JPG em cada vídeo.
6. **Wire (upload-academy-yt.py wire-map.json)** — `{CODE: https://youtu.be/id}` → upsert `acad_lessons.video_url`. Fase/módulo derivados do `_aule-map.json`.
7. **Smoke visual (academy-smoke-cac.cjs por amostra)** — login magic-link → `/lezione/cac-<code>` → confere poster local + **reprodução real** do embed (não só o iframe existir). Loop corrige→re-testa até tocar.
8. **Deletar parciais órfãos** — se o re-upload gerou ID novo (browser caiu no meio), deletar o vídeo parcial antigo pelo ID.
9. **Activity log** — INSERT em `activity_logs` com `action='screen-motion-engineer.publish_lessons_youtube'`, `cycle_id={cycle_id}`, `details={codes, before:{origem:storage}, after:{origem:youtube, ids}}`.

### acceptance_criteria
- **[A1]** `acad_lessons?slug=like.cac-*` → 100% dos códigos do lote com `video_url` youtube; 0 em storage; 0 inativas.
- **[A2]** Cada embed reproduz com `origin=academy` (`readyState>=1 && duration>1 && !privato`) — retry 2-3× (embed flaky na 1ª).
- **[A3]** Nenhum vídeo do lote é PÚBLICO: RSS `feeds/videos.xml?channel_id=` e aba `/videos` pública NÃO os listam.
- **[A4]** Smoke visual mostra a barra do player avançando (`m:ss / m:ss`) na aula real — screenshot como prova.
- **[A5]** Thumbnail custom aplicada (maxresdefault = capa ArchPrime, não frame do vídeo).

---

## Exemplos

### Exemplo 1 — Happy path (DONE)
Lote `[C4.10..C4.16]`. Thumbs→JPG. yt-upload-prof.cjs (espera upload completar, IDs capturados). Os que ficaram Bozza → yt-pub.cjs. Thumbs no YT. Wire. Smoke de C4.16 mostra `0:07 / 6:39` avançando. Banco 100% youtube. → **DONE**.

### Exemplo 2 — Upload parcial (recovery)
Vídeo com `lengthSeconds=0` por horas, watch "Stiamo elaborando… riprova". Diagnóstico: arquivo incompleto (uploader finalizou cedo). Re-subir com yt-upload-prof.cjs v2 (espera completar) → MESMO ID, processa em minutos. → **RECOVERED**. (Se o browser cair no meio → ID novo → re-thumb + re-wire + deletar parcial.)

### Exemplo 3 — Sessão paralela (BLOCKED→isolar)
Outra sessão subindo vídeos no mesmo canal sobrescreveu `/tmp/yt-upload-manifest.json` e disputou o perfil (ProcessSingleton). → Isolar dados em `/tmp/<lote>/`, filtrar medidor pelos códigos-alvo, prosseguir. Se o perfil ficar locked, aguardar a outra sessão liberar.

---

## Notas
- **NUNCA quebrar o que funciona:** se as aulas já tocam via storage, reverter para storage durante o conserto e só religar no YouTube com o vídeo REALMENTE tocando (evita tela preta para os alunos).
- **Não confie no badge de `/video/ID/edit`** para visibilidade (o "Pubblico" ali é header da seção Audience — falso-positivo). Prova de unlisted = A2+A3.
- **Limite diário** do YouTube (~100-150 uploads/dia + limite de thumbnail). Se estourar, retomar no dia seguinte (scripts têm resume).
- Referências: `youtube-publish-automacao-studio-playwright` (memória), `README-youtube-academy.md` (runbook), `handoff-youtube-academy-18-restantes-e-workflow-2026-07-03.md`.
