import { useEffect, useState } from 'react';
import ChatBox from './components/ChatBox';
import RoleplayBox from './components/RoleplayBox';
import { apiFetch, obterSenha, salvarSenha } from './utils/api';

function App() {
  const [closer, setCloser] = useState(null);
  const [verificandoSenha, setVerificandoSenha] = useState(true);
  const [senhaDigitada, setSenhaDigitada] = useState('');
  const [erroSenha, setErroSenha] = useState(null);
  const [enviandoSenha, setEnviandoSenha] = useState(false);
  const [modo, setModo] = useState('duvida'); // 'duvida' | 'treino'

  useEffect(() => {
    async function verificar() {
      if (!obterSenha()) {
        setVerificandoSenha(false);
        return;
      }
      try {
        const resp = await apiFetch('/api/verificar-senha', { method: 'POST' });
        if (resp.ok) {
          const data = await resp.json();
          setCloser(data.nome);
        }
      } finally {
        setVerificandoSenha(false);
      }
    }
    verificar();
  }, []);

  async function confirmarSenha(e) {
    e.preventDefault();
    setErroSenha(null);
    setEnviandoSenha(true);
    salvarSenha(senhaDigitada);

    try {
      const resp = await apiFetch('/api/verificar-senha', { method: 'POST' });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.erro || 'Senha incorreta.');
      setCloser(data.nome);
    } catch (err) {
      setErroSenha(err.message);
    } finally {
      setEnviandoSenha(false);
    }
  }

  if (verificandoSenha) {
    return null;
  }

  if (!closer) {
    return (
      <div className="flex h-screen w-full max-w-md mx-auto flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-lg font-semibold text-gray-900">Mauricio Digital</h1>
        <p className="text-sm text-gray-500">Senha de acesso</p>
        <form onSubmit={confirmarSenha} className="w-full flex gap-2">
          <input
            type="password"
            value={senhaDigitada}
            onChange={(e) => setSenhaDigitada(e.target.value)}
            placeholder="Senha"
            className="flex-1 rounded-full border border-gray-300 px-4 py-2 text-sm outline-none focus:border-purple-500"
            autoFocus
          />
          <button
            type="submit"
            disabled={!senhaDigitada.trim() || enviandoSenha}
            className="rounded-full bg-purple-600 px-5 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {enviandoSenha ? '...' : 'Entrar'}
          </button>
        </form>
        {erroSenha && <p className="text-sm text-red-600">{erroSenha}</p>}
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full max-w-2xl mx-auto flex-col">
      <div className="flex border-b border-gray-200 text-sm font-medium">
        <button
          type="button"
          onClick={() => setModo('duvida')}
          className={`flex-1 py-2.5 ${modo === 'duvida' ? 'text-purple-600 border-b-2 border-purple-600' : 'text-gray-500'}`}
        >
          Tirar dúvida
        </button>
        <button
          type="button"
          onClick={() => setModo('treino')}
          className={`flex-1 py-2.5 ${modo === 'treino' ? 'text-purple-600 border-b-2 border-purple-600' : 'text-gray-500'}`}
        >
          Simular reunião
        </button>
      </div>

      <div className="flex-1 min-h-0">
        {modo === 'duvida' ? <ChatBox closer={closer} /> : <RoleplayBox closer={closer} />}
      </div>
    </div>
  );
}

export default App;
