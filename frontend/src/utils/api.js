const CHAVE_SENHA = 'mauricio-digital-senha';

export function obterSenha() {
  return localStorage.getItem(CHAVE_SENHA) || '';
}

export function salvarSenha(senha) {
  localStorage.setItem(CHAVE_SENHA, senha);
}

export function limparSenha() {
  localStorage.removeItem(CHAVE_SENHA);
}

export function apiFetch(caminho, opcoes = {}) {
  const headers = { ...(opcoes.headers || {}), 'x-team-password': obterSenha() };
  return fetch(caminho, { ...opcoes, headers });
}
