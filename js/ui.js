// Pequenos utilitários de interface: criar elementos, aviso rápido (toast) e janelas (modal).

export function el(tag, attrs = {}, ...filhos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, v);
  }
  for (const f of filhos.flat()) {
    if (f == null || f === false) continue;
    e.append(f instanceof Node ? f : document.createTextNode(String(f)));
  }
  return e;
}

export const $ = (sel, raiz = document) => raiz.querySelector(sel);

let toastTimer = null;
export function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

const modal = () => $('#modal');
let resolverAtual = null;

// Abre uma janela. `conteudo` é um Node; `botoes` = [{ rotulo, valor, classe }].
// Retorna uma Promise com o valor do botão clicado (ou null se fechar).
export function abrirModal(conteudo, { titulo, botoes = [{ rotulo: 'Fechar', valor: null }], telaCheia = false, aoFechar } = {}) {
  const d = modal();
  if (d.open) fecharModal(null);
  const corpo = $('#modal-corpo');
  corpo.replaceChildren();
  if (titulo) corpo.append(el('div', { class: 'modal-titulo' }, titulo));
  corpo.append(conteudo);
  if (botoes.length) {
    corpo.append(el('div', { class: 'modal-acoes' }, botoes.map((b) =>
      el('button', { class: `btn ${b.classe || ''}`, onclick: () => fecharModal(b.valor) }, b.rotulo))));
  }
  d.classList.toggle('tela-cheia', telaCheia);
  return new Promise((resolve) => {
    resolverAtual = (v) => { if (aoFechar) aoFechar(v); resolve(v); };
    d.showModal();
  });
}

export function fecharModal(valor = null) {
  const d = modal();
  const r = resolverAtual;
  resolverAtual = null;
  if (d.open) d.close();
  if (r) r(valor);
}

export function iniciarModal() {
  const d = modal();
  d.addEventListener('cancel', (e) => { e.preventDefault(); fecharModal(null); });
  d.addEventListener('click', (e) => { if (e.target === d) fecharModal(null); });
}

export async function confirmar(mensagem, { titulo = 'Confirmar', sim = 'Sim', perigo = false } = {}) {
  const r = await abrirModal(el('p', {}, mensagem), {
    titulo,
    botoes: [
      { rotulo: 'Cancelar', valor: false },
      { rotulo: sim, valor: true, classe: perigo ? 'btn-perigo' : 'btn-primario' },
    ],
  });
  return r === true;
}

export function pct(x) {
  return `${Math.round(x * 100)}%`;
}

export function dataHora(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export const CORES = ['#16a34a', '#dc2626', '#f59e0b', '#9333ea', '#0ea5e9', '#db2777', '#84cc16', '#f97316', '#14b8a6', '#a3a3a3'];
