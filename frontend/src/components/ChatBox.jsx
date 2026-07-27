import { useState, useRef, useEffect, useCallback } from 'react';
import AudioRecorder from './AudioRecorder';
import { tocarAudio } from '../utils/tts';
import { apiFetch } from '../utils/api';

export default function ChatBox({ closer }) {
  const [mensagens, setMensagens] = useState([]);
  const [pergunta, setPergunta] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [tocandoIndex, setTocandoIndex] = useState(null);
  const fimRef = useRef(null);

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [mensagens, carregando]);

  async function enviarPergunta(e) {
    e.preventDefault();
    const texto = pergunta.trim();
    if (!texto || carregando) return;

    setMensagens((prev) => [...prev, { autor: 'closer', texto }]);
    setPergunta('');
    setCarregando(true);

    try {
      const resp = await apiFetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pergunta: texto, closer }),
      });
      const data = await resp.json();

      if (!resp.ok) {
        throw new Error(data.erro || 'Erro ao consultar o Mauricio Digital.');
      }

      setMensagens((prev) => [...prev, { autor: 'mauricio', texto: data.resposta }]);
    } catch (err) {
      setMensagens((prev) => [
        ...prev,
        { autor: 'mauricio', texto: `Erro: ${err.message}`, erro: true },
      ]);
    } finally {
      setCarregando(false);
    }
  }

  const handleDitado = useCallback((texto) => {
    setPergunta((prev) => (prev ? `${prev} ${texto}` : texto));
  }, []);

  async function ouvirResposta(texto, index) {
    setTocandoIndex(index);
    try {
      await tocarAudio(texto);
    } catch (err) {
      setMensagens((prev) => [...prev, { autor: 'mauricio', texto: `Erro no áudio: ${err.message}`, erro: true }]);
    } finally {
      setTocandoIndex(null);
    }
  }

  return (
    <div className="flex h-full w-full max-w-2xl mx-auto flex-col bg-white">
      <header className="border-b border-gray-200 px-4 py-3">
        <h1 className="text-lg font-semibold text-gray-900">Mauricio Digital</h1>
        <p className="text-sm text-gray-500">Treinador de closers</p>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {mensagens.length === 0 && (
          <p className="text-sm text-gray-400 text-center mt-8">
            Digite, dite por voz, ou pergunte sua dúvida ou objeção pra começar.
          </p>
        )}

        {mensagens.map((m, i) => (
          <div
            key={i}
            className={`flex ${m.autor === 'closer' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap flex items-start gap-2 ${
                m.autor === 'closer'
                  ? 'bg-purple-600 text-white rounded-br-sm'
                  : 'bg-gray-100 text-gray-900 rounded-bl-sm'
              }`}
            >
              <span>{m.texto}</span>
              {m.autor === 'mauricio' && !m.erro && (
                <button
                  type="button"
                  onClick={() => ouvirResposta(m.texto, i)}
                  disabled={tocandoIndex === i}
                  title="Ouvir resposta em áudio"
                  className="shrink-0 text-gray-500 hover:text-purple-600 disabled:opacity-40"
                >
                  {tocandoIndex === i ? '…' : '🔊'}
                </button>
              )}
            </div>
          </div>
        ))}

        {carregando && (
          <div className="flex justify-start">
            <div className="max-w-[80%] rounded-2xl rounded-bl-sm bg-gray-100 px-4 py-2 text-sm text-gray-500">
              Mauricio Digital está digitando...
            </div>
          </div>
        )}

        <div ref={fimRef} />
      </div>

      <form onSubmit={enviarPergunta} className="border-t border-gray-200 p-3 flex gap-2">
        <AudioRecorder onResult={handleDitado} disabled={carregando} />
        <input
          type="text"
          value={pergunta}
          onChange={(e) => setPergunta(e.target.value)}
          placeholder="Digite sua dúvida ou objeção..."
          className="flex-1 rounded-full border border-gray-300 px-4 py-2 text-sm outline-none focus:border-purple-500"
          disabled={carregando}
        />
        <button
          type="submit"
          disabled={carregando || !pergunta.trim()}
          className="rounded-full bg-purple-600 px-5 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          Perguntar
        </button>
      </form>
    </div>
  );
}
