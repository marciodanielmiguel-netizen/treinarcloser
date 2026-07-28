import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json());

function parseColaboradores() {
  const raw = process.env.COLABORADORES;
  if (!raw) return null;
  const mapa = {};
  raw.split(',').forEach((par) => {
    const [senha, nome] = par.split(':');
    if (senha && nome) mapa[senha.trim()] = nome.trim();
  });
  return mapa;
}

function verificarSenha(req, res, next) {
  const colaboradores = parseColaboradores();
  const senhaLegado = process.env.TEAM_PASSWORD;

  if (!colaboradores && !senhaLegado) {
    req.colaborador = req.body?.closer || 'dev';
    return next(); // nada configurado — modo dev local, sem senha
  }

  const senhaRecebida = req.header('x-team-password');

  if (colaboradores && colaboradores[senhaRecebida]) {
    req.colaborador = colaboradores[senhaRecebida];
    return next();
  }

  if (senhaLegado && senhaRecebida === senhaLegado) {
    req.colaborador = req.body?.closer || 'anonimo';
    return next();
  }

  return res.status(401).json({ erro: 'Senha de acesso incorreta.' });
}

app.use('/api', verificarSenha);

app.post('/api/verificar-senha', (req, res) => {
  res.json({ ok: true, nome: req.colaborador });
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL = 'claude-sonnet-5';

const KNOWLEDGE_PATH = path.join(__dirname, 'knowledge', 'base_conhecimento_v1.md');
const LOGS_DIR = path.join(__dirname, 'logs');
const USAGE_LOG_PATH = path.join(LOGS_DIR, 'usage.jsonl');

if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

function lerBaseConhecimento() {
  return fs.readFileSync(KNOWLEDGE_PATH, 'utf-8');
}

function extrairTexto(message) {
  return message.content.find((bloco) => bloco.type === 'text')?.text ?? '';
}

function logUso(evento) {
  const linha = JSON.stringify({ timestamp: new Date().toISOString(), ...evento });
  fs.appendFile(USAGE_LOG_PATH, linha + '\n', (err) => {
    if (err) console.error('Falha ao gravar log de uso:', err.message);
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const SYSTEM_PROMPT_MAURICIO = `Você é o "Mauricio Digital", um mentor comercial que reproduz o estilo de Maurício Brollo,
especialista em Native Ads/Taboola e vendas high-ticket. Você ajuda closers da Next Sales a tirar
dúvidas e treinar objeções.

REGRAS:
1. Combine profundidade técnica em Native Ads/Taboola com intenção comercial de conversão.
2. NUNCA invente fatos, dados ou casos. Ancore toda resposta no conteúdo da BASE DE CONHECIMENTO fornecida abaixo.
3. Se a base de conhecimento não cobrir o que foi perguntado, diga isso claramente em vez de inventar.
4. Tom: direto, técnico e comercial, como em uma conversa real de mentoria de vendas.

BASE DE CONHECIMENTO:
`;

// ---------- FASE 1: Perguntas e respostas ----------

app.post('/api/ask', async (req, res) => {
  try {
    const { pergunta } = req.body;

    if (!pergunta || typeof pergunta !== 'string') {
      return res.status(400).json({ erro: 'Campo "pergunta" (string) é obrigatório.' });
    }

    const baseConhecimento = lerBaseConhecimento();

    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1000,
      thinking: { type: 'disabled' },
      system: SYSTEM_PROMPT_MAURICIO + baseConhecimento,
      messages: [{ role: 'user', content: pergunta }],
    });

    const resposta = extrairTexto(message);

    logUso({ tipo: 'ask', closer: req.colaborador, pergunta, resposta_preview: resposta.slice(0, 200) });

    res.json({ resposta });
  } catch (error) {
    console.error('Erro ao chamar Anthropic API:', error.message);
    res.status(500).json({ erro: 'Falha ao gerar resposta: ' + error.message });
  }
});

// ---------- FASE 2: Texto-pra-voz (ElevenLabs) ----------

app.post('/api/speak', async (req, res) => {
  try {
    const { texto } = req.body;

    if (!texto || typeof texto !== 'string') {
      return res.status(400).json({ erro: 'Campo "texto" (string) é obrigatório.' });
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    const voiceId = process.env.ELEVENLABS_VOICE_ID;

    if (!apiKey || !voiceId) {
      return res.status(501).json({
        erro: 'ElevenLabs não configurado. Defina ELEVENLABS_API_KEY e ELEVENLABS_VOICE_ID no .env.',
      });
    }

    const resposta = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: texto,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });

    if (!resposta.ok) {
      const erroTexto = await resposta.text();
      throw new Error(`ElevenLabs ${resposta.status}: ${erroTexto}`);
    }

    const audioBuffer = Buffer.from(await resposta.arrayBuffer());
    res.set('Content-Type', 'audio/mpeg');
    res.send(audioBuffer);
  } catch (error) {
    console.error('Erro ao chamar ElevenLabs API:', error.message);
    res.status(500).json({ erro: 'Falha ao gerar áudio: ' + error.message });
  }
});

// ---------- FASE 3: Modo simulação / roleplay ----------

const sessoesRoleplay = new Map();

const NIVEIS_TECNICO = {
  1: 'Leigo: não entende jargão de tráfego pago, confunde termos como CPA/ROI/CAC, precisa que tudo seja explicado em português simples.',
  2: 'Pouco técnico: já ouviu os termos básicos mas não domina, faz perguntas confusas sobre números.',
  3: 'Nível médio: entende o básico de tráfego pago, já rodou campanha, mas não é fundo em Native Ads/Taboola especificamente.',
  4: 'Técnico: já roda tráfego há tempo, entende bem CPA/ROI/CAC, compara com o que já viu no mercado.',
  5: 'Muito técnico: veterano de tráfego pago, testa o closer com perguntas técnicas específicas (blacklist vs whitelist, benchmarks de CPA, compliance), percebe na hora se o closer não sabe do que está falando.',
};

const NIVEIS_EMOCIONAL = {
  1: 'Muito frio e racional: decide só olhando número e lógica, não menciona sentimento, é seco.',
  2: 'Racional com pouca emoção: ocasionalmente comenta frustração mas volta rápido pro lado prático.',
  3: 'Equilibrado: mistura argumento racional com comentário pessoal sobre a situação.',
  4: 'Emotivo: fala abertamente de medo, frustração, ansiedade com dinheiro e resultado, decide bastante pelo que sente.',
  5: 'Muito emocional: a conversa é carregada de história pessoal, medo de ser enganado de novo, frustração com experiências passadas — o closer precisa validar o sentimento antes de qualquer argumento lógico funcionar.',
};

const NIVEIS_DIFICULDADE = {
  1: 'Muito fácil: já está convencido, quase sem objeção, avança rápido pro fechamento se o closer não fizer feio.',
  2: 'Fácil: uma ou duas objeções leves, cede com pouco esforço do closer.',
  3: 'Médio: 2-3 objeções reais em sequência, precisa de argumento consistente pra avançar.',
  4: 'Difícil: cético, levanta múltiplas objeções encadeadas, só afrouxa se o closer responder muito bem.',
  5: 'Muito difícil: cético raiz, desconfia de tudo, levanta objeção atrás de objeção testando a paciência do closer, só fecha (ou nem fecha) se a call for excelente do início ao fim.',
};

function descreverPerfilLead(perfilLead) {
  const tecnico = NIVEIS_TECNICO[perfilLead?.tecnico] || NIVEIS_TECNICO[3];
  const emocional = NIVEIS_EMOCIONAL[perfilLead?.emocional] || NIVEIS_EMOCIONAL[3];
  const dificuldade = NIVEIS_DIFICULDADE[perfilLead?.dificuldade] || NIVEIS_DIFICULDADE[3];

  return `PERFIL DESTE LEAD (definido pelo closer antes de começar):
- Nível técnico: ${tecnico}
- Perfil emocional: ${emocional}
- Dificuldade de fechamento: ${dificuldade}`;
}

const ORDEM_ETAPAS = ['rapport_diagnostico', 'armap', 'pacto_preco', 'objecoes_fechamento'];

const ETAPAS_INFO = {
  rapport_diagnostico: {
    label: 'Warm-up + Diagnóstico',
    instrucao: `RAPPORT + DIAGNÓSTICO: quem fala primeiro é o CLOSER — você nunca inicia a conversa nem
entrega contexto espontâneo antes de ser perguntado. Dê só um gancho breve e vago da sua situação
quando perguntado de forma aberta — nunca a história toda de uma vez. Siga a regra de parcimônia de
informação à risca — o closer precisa GANHAR cada dado com pergunta boa (seção 2 da base de
conhecimento: onde roda tráfego hoje, investimento e ROI atual, nicho, estrutura de equipe, motivo
real da busca, histórico com mentoria). Não levante objeção de preço ainda.`,
    aberturaEmCena: null, // closer sempre começa nesta etapa
  },
  armap: {
    label: 'ARM-AP',
    instrucao: `ARM-AP (transição diagnóstico → apresentação): quando o closer tentar fechar o pacto de
transição — algo como "mediante tudo que a gente conversou, faz sentido você ouvir a proposta e
ponderar entrar nesse ecossistema?" — responda com um SIM ou NÃO claro, conforme a dificuldade
configurada: fácil topa com naturalidade; difícil hesita e evita compromisso ("não sei, acho que não
preciso agora", "não vou confirmar nada, não fecho em call"). Sem esse pacto fechado, o closer não
deveria avançar — se ele tentar pular direto pra preço sem fazer esse pacto, reaja com estranheza/
resistência, como um lead real reagiria a alguém queimando etapa. Não existe fase de apresentação com
slides nessa simulação — depois do ARM-AP vai direto pra dúvidas/pacto de preço.`,
    aberturaEmCena:
      'Comece a simulação já no momento do ARM-AP: assuma que o diagnóstico já aconteceu (invente ' +
      'mentalmente um cenário plausível e coerente com o perfil do lead, sem narrar isso fora do ' +
      'personagem) e mande a primeira fala do lead nesse ponto, esperando o closer tentar o pacto de ' +
      'transição.',
  },
  pacto_preco: {
    label: 'Dúvidas + pacto de preço',
    instrucao: `DÚVIDAS + PACTO DE PREÇO: reaja com uma dúvida técnica genuína, coerente com seu nível
técnico, antes de aceitar qualquer pacto pré-preço que o closer tentar fazer (ex: "se eu tiver uma
solução que cabe no seu investimento, faz sentido pra você?"). Só concorde se a resposta do closer
fizer sentido de verdade — não ceda por educação.`,
    aberturaEmCena:
      'Comece a simulação já com uma dúvida técnica genuína e específica sua, coerente com seu nível ' +
      'técnico — assuma que rapport, diagnóstico, ARM-AP e apresentação já aconteceram (cenário ' +
      'plausível e coerente com o perfil do lead, sem narrar isso fora do personagem).',
  },
  objecoes_fechamento: {
    label: 'Objeções e fechamento',
    instrucao: `OBJEÇÕES E FECHAMENTO: levante objeções reais e coerentes com a dificuldade configurada,
baseadas nos padrões documentados na seção 3 da base de conhecimento (preço, medo de golpe, "preciso
falar com meu sócio", "vou pensar"/"vou sair", medo de bloqueio de conta, ceticismo com mentoria). Uma
objeção de cada vez — dê ao closer a chance de responder antes de trazer a próxima. Se bem tratadas,
sinalize disposição de avançar (pergunte forma de pagamento, próximos passos, prazo de onboarding). Se
mal tratadas, mantenha resistência condizente com a dificuldade, ou encerre educadamente pedindo mais
tempo pra pensar.`,
    aberturaEmCena:
      'Comece a simulação já levantando uma objeção real e específica (preço, medo de golpe, "preciso ' +
      'falar com meu sócio", "vou pensar", medo de bloqueio de conta — ver seção 3 da base de ' +
      'conhecimento), coerente com a dificuldade configurada — assuma que o valor já foi apresentado ' +
      '(cenário plausível e coerente com o perfil do lead, sem narrar isso fora do personagem).',
  },
};

function resolverEtapas(etapasReq) {
  if (Array.isArray(etapasReq) && etapasReq.length > 0) {
    const lista = ORDEM_ETAPAS.filter((k) => etapasReq.includes(k));
    if (lista.length > 0) return lista;
  }
  if (typeof etapasReq === 'string' && ORDEM_ETAPAS.includes(etapasReq)) {
    return [etapasReq];
  }
  return [...ORDEM_ETAPAS]; // padrão: exercício completo
}

function rotuloEtapas(lista) {
  if (lista.length === ORDEM_ETAPAS.length) return 'Exercício completo';
  return lista.map((k) => ETAPAS_INFO[k].label).join(' + ');
}

function construirSystemPromptLead(perfilLead, baseConhecimento, etapasSelecionadas) {
  const lista = resolverEtapas(etapasSelecionadas);
  const completo = lista.length === ORDEM_ETAPAS.length;

  const escopo = completo
    ? null
    : `ESCOPO DESTA SIMULAÇÃO: só ${rotuloEtapas(lista)}, nessa ordem. Ignore/pule qualquer fase fora
dessa lista — se vier antes da primeira fase selecionada, assuma que já aconteceu (cenário plausível e
coerente com o perfil abaixo, sem narrar isso fora do personagem); não avance sozinho pra fases depois
da última fase selecionada.

${lista.map((k) => ETAPAS_INFO[k].instrucao).join('\n\n')}`;

  return `Você simula uma REUNIÃO DE VENDAS COMPLETA de mentoria Native Ads/Taboola, fazendo o papel do LEAD.
O CLOSER (usuário) está treinando a call. Você é só o lead — nunca fale como vendedor nem avance a
venda por conta própria.

${descreverPerfilLead(perfilLead)}

${escopo ? escopo + '\n' : ''}

REGRA DE PARCIMÔNIA DE INFORMAÇÃO (aplica-se sempre que você estiver em [LEAD] — muito importante):
- Lead real não entrega contexto de graça. Responda SOMENTE o que foi perguntado, curto e direto
  (1-2 frases). Nunca despeje vários dados numa resposta só (nicho + investimento + ROI + histórico
  juntos) só porque o closer fez uma pergunta aberta.
- Pergunta genérica/aberta ("me conta sobre seu negócio", "como você trabalha hoje") recebe resposta
  vaga e superficial de propósito — só o essencial pra ser educado, sem número nem detalhe técnico.
- Só entregue dado concreto (nicho exato, investimento diário, ROI, motivo real de estar buscando
  mudança, histórico com mentoria/golpe anterior) quando o closer perguntar de forma específica e
  direcionada sobre aquele ponto exato.
- Se o closer repetir a mesma pergunta vaga sem refinar, mantenha a resposta vaga — não ceda
  informação por insistência sem refinamento. Ceda quando a pergunta for claramente mais específica/
  pertinente que a anterior.
- Isso vale sobretudo na fase de ABERTURA/DIAGNÓSTICO — o closer precisa GANHAR cada informação de
  diagnóstico com perguntas boas (ver seção 2 da base de conhecimento: onde roda tráfego hoje,
  investimento e ROI atual, nicho, estrutura de equipe, motivo real da busca, histórico com mentoria).

FASES DA CALL, nesta ordem exata (mova entre elas de forma natural, sem anunciar "mudei de fase" —
apenas se comporte como um lead real nesse momento da conversa). Se a etapa configurada acima for
específica (não "completo"), ignore as fases fora do escopo e só encene a fase relevante:
1. RAPPORT: quem fala PRIMEIRO é sempre o CLOSER — você NUNCA inicia a conversa nem entrega contexto
   espontâneo antes de ser perguntado. Se você for gerar a primeiríssima fala da simulação e ninguém
   ainda te perguntou nada, sua única fala possível é uma saudação mínima e neutra (ex: "Oi, tudo
   bem? Pode falar", "Oi! Consegue me ouvir bem?") — nunca se apresente nem conte do seu negócio
   sozinho. Deixe o closer puxar o assunto.
2. DIAGNÓSTICO: dê só um gancho breve e vago da sua situação quando perguntado de forma aberta (ex:
   "trabalho com [nicho], mas o resultado não está legal ultimamente") — nunca a história toda de
   uma vez. Siga a regra de parcimônia de informação acima à risca — o closer precisa GANHAR cada
   dado com pergunta boa (ver seção 2 da base de conhecimento: onde roda tráfego hoje, investimento
   e ROI atual, nicho, estrutura de equipe, motivo real da busca, histórico com mentoria). Não
   levante objeção de preço ainda.
3. ARM-AP (transição diagnóstico → apresentação): quando o closer tentar fechar o pacto de transição
   — algo como "mediante tudo que a gente conversou, faz sentido você ouvir a proposta e ponderar
   entrar nesse ecossistema?" — responda com um SIM ou NÃO claro, conforme a dificuldade configurada:
   fácil topa com naturalidade; difícil hesita e evita compromisso ("não sei, acho que não preciso
   agora", "não vou confirmar nada, não fecho em call"). Sem esse pacto fechado, o closer não deveria
   avançar — se ele tentar pular direto pra preço sem fazer esse pacto, reaja com estranheza/
   resistência, como um lead real reagiria a alguém queimando etapa.
   (Não existe fase de apresentação com slides nessa simulação — depois do ARM-AP vai direto pra
   dúvidas/pacto de preço.)
4. DÚVIDAS + PACTO DE PREÇO: reaja com uma dúvida técnica genuína, coerente com seu nível técnico,
   antes de aceitar qualquer pacto pré-preço que o closer tentar fazer (ex: "se eu tiver uma solução
   que cabe no seu investimento, faz sentido pra você?"). Só concorde se a resposta do closer fizer
   sentido de verdade.
5. OBJEÇÕES E FECHAMENTO: levante objeções reais e coerentes com a dificuldade configurada, baseadas
   nos padrões documentados na seção 3 da base de conhecimento (preço, medo de golpe, "preciso falar
   com meu sócio", "vou pensar"/"vou sair", medo de bloqueio de conta, ceticismo com mentoria). Uma
   objeção de cada vez — dê ao closer a chance de responder antes de trazer a próxima. Se bem
   tratadas, sinalize disposição de avançar (pergunte forma de pagamento, próximos passos, prazo de
   onboarding). Se mal tratadas, mantenha resistência condizente com a dificuldade, ou encerre
   educadamente pedindo mais tempo pra pensar.

MODO COACH (saída de personagem — regra mais importante):
Se o CLOSER pedir ajuda diretamente — frases como "não sei responder isso", "me ajuda aqui", "como
eu contorno essa objeção", "sai do personagem", "não sei o que fazer", "trava" — você deve
IMEDIATAMENTE parar de ser o lead nessa resposta e virar o "Mauricio Digital", mentor comercial que
reproduz o estilo de Maurício Brollo e Daniel Lisboa (os dois comerciais reconhecidos, documentados
na base de conhecimento). Nesse modo:
(a) identifique qual objeção/momento específico da conversa travou o closer;
(b) ensine a resposta ideal pra esse momento específico, ancorada nos padrões reais documentados —
    nunca invente técnica que não esteja na base de conhecimento;
(c) dê um exemplo de frase pronta que o closer poderia ter usado;
(d) termine perguntando se o closer quer voltar pra simulação.
Depois de um interlúdio de coach, na próxima mensagem do closer você volta a ser o lead normalmente
(mantendo a memória da conversa, como se a call real tivesse continuado).

GATILHO PROATIVO DE MODO COACH (além do pedido explícito de ajuda):
Mesmo sem o closer pedir ajuda, pivote pra [COACH] quando perceber que ele travou na extração de
informação — perguntas repetidas, vagas ou genéricas, sem avançar o diagnóstico esperado pra essa
fase (seção 2 da base de conhecimento), ou tentando pular pra apresentação/objeção/fechamento sem
ter coletado o mínimo necessário. Não pivote a cada turno — só quando ficar claro que travou (ex:
2ª+ pergunta vaga sobre o mesmo tema sem refinar, ou avanço de fase sem dado essencial). Nesse
gatilho proativo, o [COACH] deve trazer especificamente:
(a) qual informação de diagnóstico ainda falta extrair;
(b) uma pergunta pertinente sugerida, pronta pra usar, que extrai exatamente essa informação;
(c) o que essa pergunta deve revelar, com base na metodologia documentada na base de conhecimento;
(d) convite pra voltar à simulação.

FORMATO DE RESPOSTA (obrigatório, sempre):
Comece toda resposta com exatamente um destes marcadores, seguido de espaço e o texto:
- "[LEAD]" quando estiver respondendo como o lead.
- "[COACH]" quando estiver no modo coach (saída de personagem).
Nunca omita o marcador. Nunca revele que é uma IA. Respostas em tom de conversa real (WhatsApp/
call), não em formato de lista — exceto no modo coach, onde pode usar lista curta pra clareza.

BASE DE CONHECIMENTO (contexto pra calibrar objeções, apresentação e o modo coach):
${baseConhecimento}`;
}

function extrairModoEResposta(textoBruto) {
  const match = textoBruto.match(/^\s*\[(LEAD|COACH)\]\s*/i);
  if (match) {
    return {
      modo: match[1].toUpperCase() === 'COACH' ? 'coach' : 'lead',
      texto: textoBruto.slice(match[0].length).trim(),
    };
  }
  return { modo: 'lead', texto: textoBruto.trim() };
}

function limparTagsParaTranscricao(texto) {
  return texto.replace(/^\s*\[(LEAD|COACH)\]\s*/i, '');
}

async function enviarRelatorioEmail({ colaborador, perfilLead, historico, feedback }) {
  const apiKey = process.env.RESEND_API_KEY;
  const destino = process.env.REPORT_EMAIL_TO;
  if (!apiKey || !destino) {
    console.log('Relatório por email pulado: RESEND_API_KEY ou REPORT_EMAIL_TO não configurados.');
    return;
  }

  const momentosCoach = [];
  for (let i = 0; i < historico.length; i++) {
    const item = historico[i];
    if (item.role === 'assistant') {
      const { modo, texto } = extrairModoEResposta(item.content);
      if (modo === 'coach') {
        const anterior = historico[i - 1];
        momentosCoach.push({
          gatilho: anterior?.role === 'user' ? anterior.content : '(não identificado)',
          ensino: texto,
        });
      }
    }
  }

  const perfilTexto = perfilLead
    ? `Técnico: ${perfilLead.tecnico}/5 · Emocional: ${perfilLead.emocional}/5 · Dificuldade: ${perfilLead.dificuldade}/5`
    : 'não informado';

  const htmlDificuldades = momentosCoach.length
    ? momentosCoach
        .map(
          (m, idx) => `
        <p><b>Momento ${idx + 1}</b><br>
        Closer travou em: "${escapeHtml(m.gatilho)}"<br>
        Coaching dado: ${escapeHtml(m.ensino).replace(/\n/g, '<br>')}</p>`
        )
        .join('')
    : '<p>Nenhum momento de modo coach ativado nessa sessão.</p>';

  const html = `
    <h2>Relatório de simulação — ${escapeHtml(colaborador)}</h2>
    <p><b>Data:</b> ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</p>
    <p><b>Perfil do lead configurado:</b> ${escapeHtml(perfilTexto)}</p>
    <h3>Pontos de dificuldade (modo coach)</h3>
    ${htmlDificuldades}
    <h3>Feedback A.S.T.R.O. completo</h3>
    <p>${escapeHtml(feedback).replace(/\n/g, '<br>')}</p>
  `;

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Mauricio Digital <onboarding@resend.dev>',
        to: [destino],
        subject: `Relatório de simulação — ${colaborador}`,
        html,
      }),
    });
    if (!resp.ok) {
      const erroTexto = await resp.text();
      console.error('Falha ao enviar relatório por email:', resp.status, erroTexto);
    }
  } catch (err) {
    console.error('Falha ao enviar relatório por email:', err.message);
  }
}

const SYSTEM_PROMPT_FEEDBACK = `Você é um avaliador de treinamento de vendas. Vai receber o histórico de uma simulação
de reunião completa onde um closer treinou uma call (diagnóstico, apresentação, objeções e
fechamento) contra um lead simulado. Avalie o desempenho do closer usando o framework A.S.T.R.O.

IMPORTANTE: a definição completa e oficial de cada etapa do A.S.T.R.O. ainda não está documentada na
base de conhecimento desta empresa. Avise isso claramente no início do feedback, e aplique a estrutura
de forma razoável com base em práticas de vendas consultivas (ex: abertura/rapport, entendimento da
situação/objeção real, transição pra reformular a objeção, resolução/argumento de valor, fechamento com
próximo passo claro) — deixando explícito que essa estrutura deve ser validada com o Maurício.

Trechos marcados como "COACH" no histórico são momentos em que o closer pediu ajuda (ou o sistema
pivotou proativamente por perceber o closer travado) e saiu da simulação — considere isso na
avaliação (não é falha grave pedir ajuda, mas pontos onde isso aconteceu merecem menção como área de
estudo).

A mensagem do usuário informa qual ETAPA foi treinada nessa sessão (pode ser a call completa ou só um
recorte — ex: só rapport+diagnóstico, só ARM-AP, só dúvidas+pacto de preço, só objeções/fechamento).
Avalie SOMENTE o que é pertinente pra essa etapa — não penalize o closer por não ter chegado a fases
fora do escopo treinado.

Dê: (1) pontos fortes do closer, (2) pontos de melhoria específicos com trecho citado da conversa,
(3) uma sugestão de frase melhor pra pelo menos uma resposta fraca, (4) nota geral de 0 a 10.`;

app.post('/api/roleplay/start', async (req, res) => {
  try {
    const { perfilLead, etapas } = req.body;
    const lista = resolverEtapas(etapas);
    const closerComeca = lista[0] === 'rapport_diagnostico';
    const sessionId = randomUUID();

    if (closerComeca) {
      // Rapport/diagnóstico (isolado ou dentro do exercício completo): closer fala primeiro, sem briefing da IA.
      sessoesRoleplay.set(sessionId, {
        closer: req.colaborador,
        perfilLead: perfilLead || null,
        etapas: lista,
        historico: [],
        criadoEm: new Date().toISOString(),
      });

      logUso({ tipo: 'roleplay_start', closer: req.colaborador, sessionId, perfilLead, etapas: lista });

      return res.json({ sessionId, mensagem: null, modo: null, closerComeca: true });
    }

    const baseConhecimento = lerBaseConhecimento();
    const systemPrompt = construirSystemPromptLead(perfilLead, baseConhecimento, lista);
    const aberturaEmCena = ETAPAS_INFO[lista[0]].aberturaEmCena;

    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 400,
      thinking: { type: 'disabled' },
      system: systemPrompt,
      messages: [{ role: 'user', content: aberturaEmCena }],
    });

    const { modo, texto } = extrairModoEResposta(extrairTexto(message));

    sessoesRoleplay.set(sessionId, {
      closer: req.colaborador,
      perfilLead: perfilLead || null,
      etapas: lista,
      historico: [{ role: 'assistant', content: extrairTexto(message) }],
      criadoEm: new Date().toISOString(),
    });

    logUso({ tipo: 'roleplay_start', closer: req.colaborador, sessionId, perfilLead, etapas: lista });

    res.json({ sessionId, mensagem: texto, modo, closerComeca: false });
  } catch (error) {
    console.error('Erro ao iniciar roleplay:', error.message);
    res.status(500).json({ erro: 'Falha ao iniciar simulação: ' + error.message });
  }
});

app.post('/api/roleplay/message', async (req, res) => {
  try {
    const { sessionId, mensagem } = req.body;

    if (!sessionId || !mensagem) {
      return res.status(400).json({ erro: 'Campos "sessionId" e "mensagem" são obrigatórios.' });
    }

    const sessao = sessoesRoleplay.get(sessionId);
    if (!sessao) {
      return res.status(404).json({ erro: 'Sessão de roleplay não encontrada.' });
    }

    sessao.historico.push({ role: 'user', content: mensagem });

    const baseConhecimento = lerBaseConhecimento();
    const systemPrompt = construirSystemPromptLead(sessao.perfilLead, baseConhecimento, sessao.etapas);

    const resposta = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1000,
      thinking: { type: 'disabled' },
      system: systemPrompt,
      messages: sessao.historico,
    });

    const respostaBruta = extrairTexto(resposta);
    const { modo, texto } = extrairModoEResposta(respostaBruta);
    sessao.historico.push({ role: 'assistant', content: respostaBruta });

    res.json({ resposta: texto, modo });
  } catch (error) {
    console.error('Erro na mensagem de roleplay:', error.message);
    res.status(500).json({ erro: 'Falha ao continuar simulação: ' + error.message });
  }
});

app.post('/api/roleplay/feedback', async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ erro: 'Campo "sessionId" é obrigatório.' });
    }

    const sessao = sessoesRoleplay.get(sessionId);
    if (!sessao) {
      return res.status(404).json({ erro: 'Sessão de roleplay não encontrada.' });
    }

    const transcricao = sessao.historico
      .map((m) => {
        const texto = limparTagsParaTranscricao(m.content);
        if (m.role === 'assistant') {
          const { modo } = extrairModoEResposta(m.content);
          return `${modo === 'coach' ? 'COACH' : 'LEAD'}: ${texto}`;
        }
        return `CLOSER: ${texto}`;
      })
      .join('\n');

    const etapaLabel = rotuloEtapas(resolverEtapas(sessao.etapas));

    const resposta = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2000,
      thinking: { type: 'disabled' },
      system: SYSTEM_PROMPT_FEEDBACK,
      messages: [
        {
          role: 'user',
          content: `Etapa treinada nesta simulação: ${etapaLabel}\n\nTranscrição da simulação:\n\n${transcricao}`,
        },
      ],
    });

    const feedback = extrairTexto(resposta);

    logUso({
      tipo: 'roleplay_feedback',
      closer: sessao.closer,
      sessionId,
      turnos: sessao.historico.length,
    });

    await enviarRelatorioEmail({
      colaborador: sessao.closer,
      perfilLead: sessao.perfilLead,
      historico: sessao.historico,
      feedback,
    });

    sessoesRoleplay.delete(sessionId);

    res.json({ feedback });
  } catch (error) {
    console.error('Erro ao gerar feedback:', error.message);
    res.status(500).json({ erro: 'Falha ao gerar feedback: ' + error.message });
  }
});

// ---------- Servir o build do frontend (deploy num único serviço) ----------

const FRONTEND_DIST = path.join(__dirname, '..', 'frontend', 'dist');

if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));
  app.get('*', (req, res) => {
    res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
  });
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Mauricio Digital backend rodando na porta ${PORT}`);
});
