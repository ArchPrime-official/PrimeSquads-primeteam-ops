# Motion Fidelity Rules — Lei do @screen-motion-engineer

> Destiladas do handoff `handoff-motion-graphics-aulas-lovarch-2026-06-21.md`.
> Inegociáveis. Quebrar qualquer uma = VETO (volta a refazer).

## Princípios

1. **Fonte da verdade = screenshot real**, NUNCA o código do protótipo. Reproduzir
   do protótipo diverge do app atual → erro. Capturar (Caminho A) ou receber o print
   (Caminho B). Ver `capture-infra.md`.

2. **Determinismo total.** `window.__render(T)` é função PURA do tempo (ms). Sem
   `requestAnimationFrame`, sem `Date.now()`, sem `Math.random()` não-semeado (use
   PRNG semeado tipo `mulberry32`). Mesmo T → mesmo pixel, sempre.

3. **Smoke test SEMPRE, em loop até precisão.** Nunca declarar "pronto" sem o número
   do `smoke-verify.mjs`. Recriação vs tela real: refinar o HTML e re-medir até
   SSIM ≥ threshold (default 0.95; telas densas podem exigir 0.90 documentado).
   Re-render vs vídeo de referência deve dar ≥ 0.99.

4. **Conferir no VÍDEO final**, não só no HTML isolado — extrair frame do MP4
   entregue (`smoke-verify --video ... --ref ...`).

## Regras de animação (anti-erro conhecidas)

- **Render Studio NÃO encolhe:** a imagem gerada aparece DIRETO no tamanho final à
  esquerda; o painel RIFERIMENTO só faz fade-in no espaço da direita. Não animar a
  imagem encolhendo.
- **Cores:** para reprodução fiel da Lovarch, MANTER as cores que a tela mostra
  (DISC chart multicolor, palette do moodboard). A regra "só ouro/neutros" é dos
  slides ArchPrime, não da reprodução de telas.
- **Chrome reutilizado:** topnav (logo, tabs Home/Studio/Business/Formazione, pill
  de créditos, avatar) + nav inferior são compartilhados entre presets. Ao criar um
  preset novo, copiar o chrome de um existente (mesmo DS V8).
- **Esperar assets:** imagens remotas (avatars/renders do Supabase storage público)
  precisam carregar antes de capturar frames. O `render-motion.mjs` já aguarda
  `document.fonts.ready` + todas as `<img>` complete.

## Galeria — SEMPRE salvar, nunca re-gerar à toa (regra Pablo 2026-06-27)

Toda geração feita pelo `flow-runner` é a geração REAL da plataforma e FICA SALVA na
galeria (`render_assets`) do PrimeVoice usado. Portanto:

- **Vídeo** persiste sozinho ao completar (a plataforma insere em `render_assets`).
- **Imagem (Crea)** só salva ao clicar "Salva" → o `flow-runner` garante isso via REST
  (insert em `render_assets` com a sessão do PrimeVoice) **automaticamente após gerar**.
- O resultado também é **baixado** para `out/asset-*` na hora (cópia local imediata).
- **Em erro/timeout: NUNCA re-gerar às cegas.** Buscar o asset já gerado na galeria:
  `node scripts/gallery.mjs latest <alias> --type image|video --download`. Re-gerar
  desperdiça créditos (imagem ~39cr, vídeo ~600cr) e tempo.

Provado 2026-06-27: fluxo Crea (olimpia) → baixado + `render_assets` id gravado +
visível no topo da galeria (`render_mode: crea`).

## Design System V8 (tokens dos presets)

```
--background:#FAF9F7  --foreground:#18181B  --card:#F2F0ED  --muted:#EEEBE7
--border:#E3E3E3      --accent:#A16207 (ouro)  --green:#16A34A  --red:#DC2626
fonts: Playfair Display (hero) · Outfit (títulos card) · DM Sans (números) · Inter (corpo)
stage: 1920×1080  ·  NO BLUE (#2563EB e variantes banidos)
```

## Contrato de um preset novo (checklist)

- [ ] `<div class="stage">` 1920×1080
- [ ] `window.__CONTENT = Object.assign({defaults}, window.__CONTENT||{})`
- [ ] `window.__DURATION` em ms
- [ ] `window.__render(T)` puro + `window.__render = __render` + `boot()` → `__render(0)`
- [ ] chrome (topnav + nav inferior) copiado de preset irmão
- [ ] tokens DS V8, zero azul
- [ ] `smoke-verify --preset ... --truth ...` ≥ threshold
