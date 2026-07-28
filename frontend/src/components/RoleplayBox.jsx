import { useState, useRef, useEffect } from 'react';
import { apiFetch } from '../utils/api';

const CAMPOS_PERFIL = [
  { chave: 'tecnico', titulo: 'Nível técnico', esquerda: 'Leigo', direita: 'Muito técnico' },
  { chave: 'emocional', titulo: 'Perfil emocional', esquerda: 'Frio/racional', direita: 'Muito emocionado' },
  { chave: 'dificuldade', titulo: 'Dificuldade de fechamento', esquerda: 'Muito fácil', direita: 'Muito difícil' },
];

const ETAPAS_ATOMICAS = [
  { chave: 'rapport_diagnostico', titulo: 'Rapport + Diagnóstico', descricao: 'Abertura e extração de informação. Você fala primeiro.' },
  { chave: 'armap', titulo: 'ARM-AP', descricao: 'Transição diagnóstico → apresentação. O lead já entra em cena, você fecha o pacto de ouvir a proposta.' },
  { chave: 'pacto_preco', titulo: 'Dúvidas + pacto de preço', descricao: 'O lead já entra em cena com uma dúvida técnica antes do pacto pré-preço.' },
  { chave: 'objecoes_fechamento', titulo: 'Objeções e fechamento', descricao: 'O lead já entra em cena levantando uma objeção real.' },
];
const CHAVES_ETAPAS_ATOMICAS = ETAPAS_ATOMICAS.map((e) => e.chave);

function corOrb(estado, modoFala) {
  if (estado === 'ouvindo') return 'bg-blue-500';
  if (estado === 'processando') return 'bg-violet-500';
  if (estado === 'falando') return modoFala === 'coach' ? 'bg-amber-500' : 'bg-purple-600';
  return 'bg-gray-300';
}

function textoEstado(estado, modoFala) {
  if (estado === 'ouvindo') return 'Ouvindo você...';
  if (estado === 'processando') return 'Processando...';
  if (estado === 'falando') return modoFala === 'coach' ? '🎓 Mauricio Digital (modo coach) falando...' : 'Lead falando...';
  return 'Desligado';
}

export default function RoleplayBox({ closer }) {
  const [perfilLead, setPerfilLead] = useState({ tecnico: 3, emocional: 3, dificuldade: 3 });
  const [etapasSelecionadas, setEtapasSelecionadas] = useState(CHAVES_ETAPAS_ATOMICAS);

  const exercicioCompleto = etapasSelecionadas.length === CHAVES_ETAPAS_ATOMICAS.length;

  function alternarEtapa(chave) {
    setEtapasSelecionadas((prev) =>
      prev.includes(chave) ? prev.filter((c) => c !== chave) : [...prev, chave]
    );
  }
  const [sessionId, setSessionId] = useState(null);
  const [carregandoForm, setCarregandoForm] = useState(false);
  const [carregandoFeedback, setCarregandoFeedback] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [erro, setErro] = useState(null);

  const [estado, setEstado] = useState('desligado'); // desligado | ouvindo | processando | falando
  const [modoFala, setModoFala] = useState('lead');
  const [legendaIA, setLegendaIA] = useState('');
  const [legendaCloser, setLegendaCloser] = useState('');
  const [turnos, setTurnos] = useState(0);
  const [textoManual, setTextoManual] = useState('');
  const [mostrarTexto, setMostrarTexto] = useState(false);

  const sessionIdRef = useRef(null);
  const vivoRef = useRef(false);
  const recognitionRef = useRef(null);
  const audioAtualRef = useRef(null);

  useEffect(() => {
    return () => {
      vivoRef.current = false;
      recognitionRef.current?.abort();
      audioAtualRef.current?.pause();
    };
  }, []);

  async function falarTexto(texto) {
    const resp = await apiFetch('/api/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texto }),
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      throw new Error(data.erro || 'Falha ao gerar áudio.');
    }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audioAtualRef.current = audio;
    try {
      await new Promise((resolve, reject) => {
        audio.onended = () => resolve();
        audio.onerror = () => reject(new Error('Falha ao reproduzir áudio.'));
        audio.play().catch(reject);
      });
    } finally {
      URL.revokeObjectURL(url);
      audioAtualRef.current = null;
    }
  }

  const DELAY_SILENCIO_MS = 5000;

  function iniciarEscuta() {
    if (!vivoRef.current) return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setErro('Reconhecimento de voz não suportado nesse navegador (use Chrome ou Edge).');
      return;
    }

    setEstado('ouvindo');
    setLegendaCloser('');

    const recognition = new SpeechRecognition();
    recognition.lang = 'pt-BR';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    let transcricaoFinal = '';
    let silencioTimer = null;

    function agendarFinalizacaoPorSilencio() {
      if (silencioTimer) clearTimeout(silencioTimer);
      silencioTimer = setTimeout(() => {
        try {
          recognition.stop();
        } catch {
          // já parado
        }
      }, DELAY_SILENCIO_MS);
    }

    recognition.onresult = (e) => {
      let novoFinal = '';
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const trecho = e.results[i][0].transcript;
        if (e.results[i].isFinal) novoFinal += trecho;
        else interim += trecho;
      }
      if (novoFinal) transcricaoFinal += novoFinal;
      setLegendaCloser((transcricaoFinal + ' ' + interim).trim());
      // Qualquer fala nova (final ou parcial) reinicia a janela de 5s de silêncio.
      agendarFinalizacaoPorSilencio();
    };

    recognition.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setErro('Permissão de microfone negada. Libere o microfone pro navegador e clique em "Falar agora".');
        vivoRef.current = false;
        setEstado('desligado');
      }
      // 'no-speech' e outros erros momentâneos: deixa o onend decidir o que fazer.
    };

    recognition.onend = () => {
      if (silencioTimer) clearTimeout(silencioTimer);
      const textoCompleto = transcricaoFinal.trim();
      if (textoCompleto) {
        processarFalaCloser(textoCompleto);
      } else if (vivoRef.current) {
        iniciarEscuta();
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      // já rodando ou erro momentâneo — o retry do onend cobre isso
    }
  }

  async function falarResposta(texto, modo) {
    setModoFala(modo);
    setLegendaIA(texto);
    setEstado('falando');

    try {
      await falarTexto(texto);
    } catch {
      // TTS não configurado ou falhou — mantém a legenda visível um pouco e segue o fluxo
      await new Promise((r) => setTimeout(r, Math.min(4000, 1200 + texto.length * 25)));
    }

    if (!vivoRef.current) return;
    iniciarEscuta();
  }

  async function processarFalaCloser(texto) {
    const textoLimpo = texto.trim();
    if (!textoLimpo) {
      iniciarEscuta();
      return;
    }

    setLegendaCloser(textoLimpo);
    setEstado('processando');
    setTurnos((t) => t + 1);

    try {
      const resp = await apiFetch('/api/roleplay/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionIdRef.current, mensagem: textoLimpo }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.erro || 'Falha ao continuar simulação.');

      if (!vivoRef.current) return;
      await falarResposta(data.resposta, data.modo);
    } catch (err) {
      setErro(err.message);
      if (vivoRef.current) iniciarEscuta();
    }
  }

  async function iniciarSimulacao() {
    setErro(null);
    setFeedback(null);
    setLegendaIA('');
    setLegendaCloser('');
    setTurnos(0);
    setCarregandoForm(true);

    try {
      const resp = await apiFetch('/api/roleplay/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ closer, perfilLead, etapas: etapasSelecionadas }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.erro || 'Falha ao iniciar simulação.');

      sessionIdRef.current = data.sessionId;
      setSessionId(data.sessionId);
      vivoRef.current = true;

      if (data.closerComeca) {
        // Você fala primeiro — nada de briefing da IA, vai direto pra escuta.
        iniciarEscuta();
      } else {
        falarResposta(data.mensagem, data.modo);
      }
    } catch (err) {
      setErro(err.message);
    } finally {
      setCarregandoForm(false);
    }
  }

  function pararTudo() {
    vivoRef.current = false;
    recognitionRef.current?.abort();
    audioAtualRef.current?.pause();
  }

  function tentarFalarDeNovo() {
    setErro(null);
    vivoRef.current = true;
    iniciarEscuta();
  }

  function enviarTextoManual(e) {
    e.preventDefault();
    const texto = textoManual.trim();
    if (!texto) return;
    setTextoManual('');
    setMostrarTexto(false);
    setErro(null);
    recognitionRef.current?.abort();
    vivoRef.current = true;
    processarFalaCloser(texto);
  }

  async function encerrarEAvaliar() {
    if (!sessionIdRef.current) return;
    pararTudo();
    setCarregandoFeedback(true);
    setErro(null);

    try {
      const resp = await apiFetch('/api/roleplay/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionIdRef.current }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.erro || 'Falha ao gerar feedback.');

      setFeedback(data.feedback);
      sessionIdRef.current = null;
      setSessionId(null);
      setEstado('desligado');
    } catch (err) {
      setErro(err.message);
    } finally {
      setCarregandoFeedback(false);
    }
  }

  function voltarParaFormulario() {
    setFeedback(null);
    setSessionId(null);
    setErro(null);
    setEstado('desligado');
  }

  if (feedback) {
    return (
      <div className="flex h-full w-full max-w-2xl mx-auto flex-col bg-white">
        <header className="border-b border-gray-200 px-4 py-3">
          <h1 className="text-lg font-semibold text-gray-900">Feedback da simulação</h1>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-4">
          <p className="text-sm whitespace-pre-wrap text-gray-900">{feedback}</p>
        </div>
        <div className="border-t border-gray-200 p-3">
          <button
            type="button"
            onClick={voltarParaFormulario}
            className="w-full rounded-full bg-purple-600 px-5 py-2 text-sm font-medium text-white"
          >
            Nova simulação
          </button>
        </div>
      </div>
    );
  }

  if (!sessionId) {
    return (
      <div className="flex h-full w-full max-w-2xl mx-auto flex-col items-center justify-center bg-white gap-5 px-6 text-center overflow-y-auto py-8">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Simular reunião completa</h1>
          <p className="text-sm text-gray-500 mt-1">
            Escolha o que treinar e configure o perfil do lead. Conversa falada, ao vivo — a IA só
            responde depois de 5s de silêncio seu (pra não te cortar no meio da frase). Se travar, é
            só pedir ajuda que ela sai do personagem e ensina — ou ela mesma pivota se perceber que
            você não está extraindo a informação certa.
          </p>
        </div>

        <div className="w-full text-left">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            O que treinar (marque quantas etapas quiser)
          </label>
          <div className="space-y-2">
            <label
              className={`flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer ${
                exercicioCompleto ? 'border-purple-600 bg-purple-50' : 'border-gray-200'
              }`}
            >
              <input
                type="checkbox"
                checked={exercicioCompleto}
                onChange={() => setEtapasSelecionadas(CHAVES_ETAPAS_ATOMICAS)}
                className="mt-1 accent-purple-600"
              />
              <span>
                <span className="block text-sm font-medium text-gray-900">Exercício completo</span>
                <span className="block text-xs text-gray-500">
                  Rapport → diagnóstico → ARM-AP → dúvidas/pacto de preço → objeções e fechamento.
                  Marca todas as etapas abaixo.
                </span>
              </span>
            </label>

            {ETAPAS_ATOMICAS.map((op) => (
              <label
                key={op.chave}
                className={`flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer ${
                  etapasSelecionadas.includes(op.chave) ? 'border-purple-600 bg-purple-50' : 'border-gray-200'
                }`}
              >
                <input
                  type="checkbox"
                  checked={etapasSelecionadas.includes(op.chave)}
                  onChange={() => alternarEtapa(op.chave)}
                  className="mt-1 accent-purple-600"
                />
                <span>
                  <span className="block text-sm font-medium text-gray-900">{op.titulo}</span>
                  <span className="block text-xs text-gray-500">{op.descricao}</span>
                </span>
              </label>
            ))}
          </div>
          {etapasSelecionadas.length === 0 && (
            <p className="text-xs text-red-600 mt-2">Marque pelo menos uma etapa.</p>
          )}
        </div>

        <div className="w-full space-y-5 text-left">
          {CAMPOS_PERFIL.map((campo) => (
            <div key={campo.chave}>
              <label className="block text-sm font-medium text-gray-700 mb-1">{campo.titulo}</label>
              <input
                type="range"
                min={1}
                max={5}
                value={perfilLead[campo.chave]}
                onChange={(e) =>
                  setPerfilLead((prev) => ({ ...prev, [campo.chave]: Number(e.target.value) }))
                }
                className="w-full accent-purple-600"
              />
              <div className="flex justify-between text-xs text-gray-400">
                <span>{campo.esquerda}</span>
                <span>{campo.direita}</span>
              </div>
            </div>
          ))}
        </div>

        {erro && <p className="text-sm text-red-600">{erro}</p>}

        <button
          type="button"
          onClick={iniciarSimulacao}
          disabled={carregandoForm || etapasSelecionadas.length === 0}
          className="rounded-full bg-purple-600 px-6 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {carregandoForm ? 'Preparando...' : 'Começar simulação'}
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full max-w-2xl mx-auto flex-col bg-white">
      <header className="border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Simulação de reunião</h1>
          <p className="text-sm text-gray-500">Ao vivo — fale normalmente</p>
        </div>
        <button
          type="button"
          onClick={encerrarEAvaliar}
          disabled={carregandoFeedback || turnos < 1}
          className="rounded-full border border-purple-600 text-purple-600 px-4 py-1.5 text-sm font-medium disabled:opacity-40"
        >
          {carregandoFeedback ? 'Avaliando...' : 'Encerrar e avaliar'}
        </button>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6">
        <div className="relative w-40 h-40 flex items-center justify-center">
          {estado === 'ouvindo' && (
            <span className="absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-40 animate-ping" />
          )}
          {estado === 'processando' && (
            <span className="absolute inline-flex h-full w-full rounded-full border-4 border-violet-300 border-t-violet-600 animate-spin" />
          )}
          <div
            className={`relative w-28 h-28 rounded-full transition-colors duration-300 ${corOrb(estado, modoFala)} ${
              estado === 'falando' ? 'animate-pulse' : ''
            }`}
          />
        </div>

        <p
          className={`text-sm font-medium ${
            estado === 'falando' && modoFala === 'coach' ? 'text-amber-600' : 'text-gray-600'
          }`}
        >
          {textoEstado(estado, modoFala)}
        </p>

        {legendaCloser && (
          <p className="max-w-md text-center text-sm text-gray-400 italic">Você: "{legendaCloser}"</p>
        )}
        {legendaIA && (
          <p className="max-w-md text-center text-sm text-gray-800 whitespace-pre-wrap">{legendaIA}</p>
        )}

        {erro && (
          <div className="flex flex-col items-center gap-2">
            <p className="text-sm text-red-600 text-center max-w-md">{erro}</p>
            <button
              type="button"
              onClick={tentarFalarDeNovo}
              className="rounded-full bg-purple-600 px-4 py-1.5 text-sm font-medium text-white"
            >
              🎤 Falar agora
            </button>
          </div>
        )}
      </div>

      <div className="border-t border-gray-200 p-3">
        {mostrarTexto ? (
          <form onSubmit={enviarTextoManual} className="flex gap-2">
            <input
              type="text"
              value={textoManual}
              onChange={(e) => setTextoManual(e.target.value)}
              placeholder="Digite em vez de falar..."
              autoFocus
              className="flex-1 rounded-full border border-gray-300 px-4 py-2 text-sm outline-none focus:border-purple-500"
            />
            <button
              type="submit"
              disabled={!textoManual.trim()}
              className="rounded-full bg-purple-600 px-5 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              Enviar
            </button>
            <button
              type="button"
              onClick={() => setMostrarTexto(false)}
              className="rounded-full border border-gray-300 text-gray-500 px-4 py-2 text-sm"
            >
              Voltar a falar
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setMostrarTexto(true)}
            className="w-full text-center text-xs text-gray-400 hover:text-gray-600"
          >
            Preferir digitar em vez de falar
          </button>
        )}
      </div>
    </div>
  );
}
