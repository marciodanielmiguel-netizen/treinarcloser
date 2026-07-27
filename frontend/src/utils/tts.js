import { apiFetch } from './api';

export async function tocarAudio(texto) {
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
  audio.play();
  audio.onended = () => URL.revokeObjectURL(url);
}

// Como tocarAudio, mas retorna uma Promise que resolve quando o áudio termina
// (ou rejeita se falhar) — usado no fluxo de voz contínuo (loop ouvir/falar).
export function tocarAudioEAguardar(texto) {
  return new Promise((resolve, reject) => {
    apiFetch('/api/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texto }),
    })
      .then(async (resp) => {
        if (!resp.ok) {
          const data = await resp.json().catch(() => ({}));
          throw new Error(data.erro || 'Falha ao gerar áudio.');
        }
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.onended = () => {
          URL.revokeObjectURL(url);
          resolve();
        };
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error('Falha ao reproduzir áudio.'));
        };
        await audio.play();
      })
      .catch(reject);
  });
}
