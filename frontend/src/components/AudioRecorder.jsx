import { useEffect, useRef, useState } from 'react';

function getSpeechRecognition() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export default function AudioRecorder({ onResult, disabled }) {
  const [gravando, setGravando] = useState(false);
  const [suportado, setSuportado] = useState(true);
  const recognitionRef = useRef(null);

  useEffect(() => {
    const SpeechRecognition = getSpeechRecognition();
    if (!SpeechRecognition) {
      setSuportado(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'pt-BR';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      const texto = event.results[0][0].transcript;
      onResult(texto);
    };

    recognition.onend = () => setGravando(false);
    recognition.onerror = () => setGravando(false);

    recognitionRef.current = recognition;

    return () => recognition.abort();
  }, [onResult]);

  function alternarGravacao() {
    if (!recognitionRef.current) return;

    if (gravando) {
      recognitionRef.current.stop();
      setGravando(false);
    } else {
      recognitionRef.current.start();
      setGravando(true);
    }
  }

  if (!suportado) return null;

  return (
    <button
      type="button"
      onClick={alternarGravacao}
      disabled={disabled}
      title={gravando ? 'Parar gravação' : 'Ditar por voz'}
      className={`rounded-full w-10 h-10 flex items-center justify-center border text-sm shrink-0 ${
        gravando
          ? 'bg-red-500 text-white border-red-500 animate-pulse'
          : 'bg-white text-gray-600 border-gray-300'
      } disabled:opacity-40`}
    >
      {gravando ? '⏹' : '🎤'}
    </button>
  );
}
