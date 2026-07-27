# Mauricio Digital

Assistente que responde dúvidas de closers de vendas no estilo de Maurício Brollo, ancorado
numa base de conhecimento real de reuniões comerciais (Native Ads/Taboola). Inclui as 3 fases:
texto, voz e modo de simulação/treino de objeções.

## Rodar localmente

### 1. Backend

```bash
cd backend
cp ../.env.example .env
npm install
npm run dev
```

Preencha o `.env`:
- `ANTHROPIC_API_KEY` — obrigatório, destrava Fase 1 e Fase 3.
- `ELEVENLABS_API_KEY` e `ELEVENLABS_VOICE_ID` — opcionais, só pra Fase 2 (áudio na voz do
  Maurício). Sem eles, o botão de ouvir resposta mostra erro claro; o resto do app funciona normal.
  **Importante:** no plano free da ElevenLabs, o voice ID precisa ser de uma voz **clonada** por
  você (Instant Voice Cloning — upload de amostra de áudio), não uma voz **adicionada da
  biblioteca**. A API bloqueia voz de biblioteca no free tier mesmo que ela apareça em "My Voices"
  no painel — a distinção é como a voz entrou na conta, não onde ela aparece.
- `VOYAGE_API_KEY` — reservada pro pipeline de RAG (busca vetorial nas reuniões do Drive), ainda
  não usada no código.

Sobe em `http://localhost:3001`.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Sobe em `http://localhost:5173` (proxy `/api` já aponta pro backend na porta 3001).

## O que tem em cada fase

- **Fase 1 — Tirar dúvida**: chat de texto, resposta ancorada em `base_conhecimento_v1.md`.
- **Fase 2 — Voz**: botão de microfone dita a pergunta (Web Speech API do navegador, grátis, só
  Chrome/Edge); botão 🔊 em cada resposta chama `/api/speak` e toca áudio via ElevenLabs.
- **Fase 3 — Simular reunião**: aba "Simular reunião" abre um formulário de perfil do lead (nível
  técnico, perfil emocional, dificuldade de fechamento — sliders 1 a 5). A IA conduz a call
  completa em fases (abertura/diagnóstico → apresentação → objeções → fechamento), sempre ancorada
  na base de conhecimento. Ao encerrar, gera feedback usando o framework A.S.T.R.O.

  **Interface "ao vivo" (estilo Gemini Live):** sem chat/balões — uma bolinha central mostra o
  estado da conversa (cinza "Desligado" / azul pulsando "Ouvindo você..." / roxo com anel girando
  "Processando..." / roxo pulsando "Lead falando..." ou âmbar "modo coach falando..."). O closer
  fala (Web Speech API captura e transcreve), a IA responde falando (ElevenLabs TTS) e ao terminar
  volta a ouvir sozinha — loop contínuo. Tem um fallback de texto ("Preferir digitar em vez de
  falar") pra quando o microfone não está disponível/permitido.

  **Modo coach:** se o closer travar ("não sei responder isso", "me ajuda aqui", "sai do
  personagem"), a IA sai do papel de lead na hora, identifica a objeção específica, ensina a
  resposta ideal com base nos padrões documentados de Maurício Brollo e Daniel Lisboa, dá um
  exemplo de frase pronta, e pergunta se quer voltar pra simulação — a bolinha fica âmbar nesse
  momento.

  > **Atenção:** a definição oficial completa do A.S.T.R.O. não estava nas reuniões usadas como
  > fonte. O feedback avisa isso e aplica uma estrutura razoável de vendas consultivas. Vale
  > validar/ajustar o prompt em `backend/server.js` (`SYSTEM_PROMPT_FEEDBACK`) com o Maurício.

## Identificação do closer (sem login)

Ao abrir o app, pede só o nome (guardado no navegador via `localStorage`, sem senha/autenticação).
Serve pra registrar o log de uso.

## Log de uso

Cada pergunta e cada simulação encerrada gera uma linha em `backend/logs/usage.jsonl`
(closer, timestamp, tipo, resumo). Arquivo local, não sobe pro git (`.gitignore`).

## Base de conhecimento

Edite `backend/knowledge/base_conhecimento_v1.md` — é injetado inteiro no prompt a cada pergunta,
tanto no chat quanto no roleplay. Basta salvar, não precisa reiniciar o backend.

## Próximos ajustes sugeridos

- Validar com o Maurício a definição real do framework A.S.T.R.O. e refinar o prompt de feedback.
- Criar/confirmar a voz clonada na ElevenLabs e preencher `ELEVENLABS_VOICE_ID`.
- Se o time crescer muito, trocar o log em arquivo por algo consultável (planilha/dashboard).
