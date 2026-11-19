// Aba "Medir": conta os poros e mede o diâmetro de cada um em mm a partir de uma foto com régua.
// É separada da IA: não usa o modelo, não grava fotos nem altera nada no app.
//
// Passos: 1 Foto → 2 Escala (2 marcas da régua) → 3 Cordão (início, fim e largura) → 4 Resultado.
import { carregarImagem } from './imaging.js';
import { medirFoto, avaliarPorosidade, faixa, dist, LIMITES_PADRAO } from './poros.js';
import { compartilharOuBaixar } from './transfer.js';
import { $, el, toast } from './ui.js';

const MAX_LADO = 2000;        // maior lado da foto processada (px)
const MIN_PX_POR_MM = 8;      // abaixo disso, poros de 1 mm ficam pequenos demais na foto
const TOQUE_CSS = 28;         // raio (px de tela) para "pegar" um ponto já marcado
const COR = {
  escala: '#3b82f6',
  trecho: '#f59e0b',
  contado: '#ef4444',
  pequeno: '#facc15',
  ignorado: '#9ca3af',
  manual: '#22d3ee',
};
const PASSOS = ['Foto', 'Escala', 'Cordão', 'Resultado'];

let app;
let canvas, ctx;
const est = {
  passo: 1,
  foto: null,          // canvas com a foto (no máximo MAX_LADO)
  nomeFoto: '',
  escala: [],          // 2 pontos na régua (px da foto)
  mmRef: 10,           // distância real entre eles
  trecho: [],          // início e fim do cordão (px da foto)
  larguraMm: 14,
  sensibilidade: 0.5,
  medicao: null,       // resultado de medirFoto (poros detectados)
  manuais: [],         // poros adicionados à mão: { x, y, raioPx }
  avaliacao: null,
  arrasto: null,
  ev: 1,               // px do canvas por px da foto
};

export function iniciar(a) {
  app = a;
  canvas = $('#medir-canvas');
  ctx = canvas.getContext('2d');
  for (const id of ['#medir-input-camera', '#medir-input-galeria']) {
    $(id).addEventListener('change', async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (f) await abrirFoto(f);
    });
  }
  canvas.addEventListener('pointerdown', aoTocar);
  canvas.addEventListener('pointermove', aoMover);
  canvas.addEventListener('pointerup', aoSoltar);
  canvas.addEventListener('pointercancel', () => { est.arrasto = null; desenhar(); });
  window.addEventListener('resize', () => { if (app.abaAtual === 'medir') desenhar(); });
  $('#btn-params-medir').addEventListener('click', () => app.irPara('modelo'));
  app.on('config', () => { atualizarParams(); if (est.passo === 4) { avaliar(); renderControles(); desenhar(); } });
  app.on('pronto', atualizarParams);
  atualizarParams();
  irPasso(1);
}

export function mostrar() { atualizarParams(); desenhar(); }
export function ocultar() { est.arrasto = null; }

// ---------------------------------------------------------------- estado

const pxPorMm = () => (est.escala.length === 2 && est.mmRef > 0 ? dist(est.escala[0], est.escala[1]) / est.mmRef : 0);
const fmt = (x, casas = 1) => x.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });

function limitesNorma() {
  return app.norma?.criterio('porosidade')?.medicao || LIMITES_PADRAO;
}

function atualizarParams() {
  const b = $('#btn-params-medir');
  if (!app.norma || !app.config.norma) { b.hidden = true; return; }
  b.hidden = false;
  b.textContent = `Norma: ${app.norma.resumoParametros(app.config.norma)} ✎`;
}

async function abrirFoto(arquivo) {
  try {
    const im = await carregarImagem(arquivo);
    try {
      const f = Math.min(1, MAX_LADO / Math.max(im.largura, im.altura));
      const c = document.createElement('canvas');
      c.width = Math.round(im.largura * f);
      c.height = Math.round(im.altura * f);
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(im.fonte, 0, 0, c.width, c.height);
      est.foto = c;
    } finally {
      im.liberar();
    }
  } catch (e) {
    toast(`Não foi possível abrir a foto: ${e.message}`, 5000);
    return;
  }
  est.nomeFoto = arquivo.name || '';
  est.escala = [];
  est.trecho = [];
  est.medicao = null;
  est.manuais = [];
  est.avaliacao = null;
  irPasso(2);
}

function irPasso(n) {
  est.passo = n;
  est.arrasto = null;
  $('#medir-inicio').hidden = n !== 1;
  $('#medir-area').hidden = n === 1;
  $('#medir-passos').replaceChildren(...PASSOS.map((nome, i) =>
    el('div', { class: i + 1 === n ? 'atual' : i + 1 < n ? 'feito' : '' }, `${i + 1 < n ? '✔' : i + 1} ${nome}`)));
  if (n === 4) medir();
  renderControles();
  desenhar();
  if (n > 1) window.scrollTo({ top: 0 });
}

function medir() {
  const ppm = pxPorMm();
  const [p1, p2] = est.trecho;
  est.medicao = medirFoto(est.foto, p1, p2, est.larguraMm * ppm, ppm, { sensibilidade: est.sensibilidade });
  avaliar();
}

// Poros detectados + manuais, numerados ao longo do cordão.
function todosPoros() {
  if (!est.medicao) return [];
  const ppm = pxPorMm();
  const fx = est.medicao.faixa;
  const manuais = est.manuais.map((m) => ({
    x: m.x, y: m.y, diamMm: (2 * m.raioPx) / ppm, posMm: fx.paraFaixa(m.x, m.y).u / ppm, manual: true, ref: m,
  }));
  const lista = [...est.medicao.poros, ...manuais].sort((a, b) => a.posMm - b.posMm);
  lista.forEach((p, i) => { p.numero = i + 1; });
  return lista;
}

function avaliar() {
  if (!est.medicao) { est.avaliacao = null; return; }
  est.poros = todosPoros();
  est.avaliacao = avaliarPorosidade(est.poros, est.medicao.comprimentoMm, app.config.norma || {}, limitesNorma());
  est.contados = new Set(est.avaliacao.contados);
}

// ---------------------------------------------------------------- controles

function renderControles() {
  const box = $('#medir-controles');
  const instr = $('#medir-instrucao');
  if (est.passo === 2) {
    instr.textContent = 'Toque em duas marcas da régua (ex.: 0 e 10 mm). Arraste os pontos para acertar: a lupa ajuda.';
    const entrada = el('input', { type: 'number', min: '1', max: '1000', step: '0.5', value: est.mmRef, inputmode: 'decimal' });
    entrada.addEventListener('input', () => {
      est.mmRef = Number(String(entrada.value).replace(',', '.')) || 0;
      atualizarLeitura();
      desenhar();
    });
    const leitura = el('div', { class: 'medir-leitura' });
    const aviso = el('div', { class: 'medir-aviso' });
    const prox = el('button', { class: 'btn btn-primario', onclick: () => irPasso(3) }, 'Próximo: marcar o cordão ➜');
    const atualizarLeitura = () => {
      const v = pxPorMm();
      leitura.textContent = v ? `Escala: ${fmt(v)} px por mm` : 'Escala: marque os 2 pontos';
      aviso.textContent = v && v < MIN_PX_POR_MM ? `⚠ Escala baixa: poros de 1 mm terão só ${fmt(v, 0)} px. Fotografe mais de perto para medir melhor.` : '';
      prox.disabled = !v;
    };
    est.atualizarLeitura = atualizarLeitura;
    box.replaceChildren(el('div', { class: 'cartao form' },
      el('label', {}, 'Distância real entre as duas marcas (mm)', entrada),
      leitura, aviso,
      el('div', { class: 'acoes' },
        el('button', { class: 'btn', onclick: () => irPasso(1) }, '📷 Trocar foto'),
        prox)));
    atualizarLeitura();
  } else if (est.passo === 3) {
    instr.textContent = 'Toque no início e no fim do trecho do cordão. Ajuste a largura para a faixa cobrir só o cordão.';
    const rot = el('b', {}, `${est.larguraMm} mm`);
    const largura = el('input', { type: 'range', min: '3', max: '40', step: '1', value: est.larguraMm });
    largura.addEventListener('input', () => { est.larguraMm = Number(largura.value); rot.textContent = `${est.larguraMm} mm`; desenhar(); });
    const leitura = el('div', { class: 'medir-leitura' });
    const prox = el('button', { class: 'btn btn-primario', onclick: () => irPasso(4) }, '🔍 Medir poros ➜');
    const atualizarLeitura = () => {
      const ok = est.trecho.length === 2;
      leitura.textContent = ok ? `Comprimento do trecho: ${fmt(dist(est.trecho[0], est.trecho[1]) / pxPorMm())} mm` : 'Marque o início e o fim do cordão';
      prox.disabled = !ok || dist(est.trecho[0], est.trecho[1]) < 4;
    };
    est.atualizarLeitura = atualizarLeitura;
    box.replaceChildren(el('div', { class: 'cartao form' },
      el('label', {}, el('span', {}, 'Largura da faixa: ', rot), largura),
      leitura,
      el('div', { class: 'acoes' },
        el('button', { class: 'btn', onclick: () => irPasso(2) }, '⬅ Escala'),
        prox)));
    atualizarLeitura();
  } else if (est.passo === 4) {
    instr.textContent = 'Toque num poro para ignorar (ou reativar). Toque num poro que faltou para adicioná-lo; ou toque no centro e arraste até a borda para marcar à mão.';
    est.atualizarLeitura = null;
    box.replaceChildren(...renderResultado());
  } else {
    box.replaceChildren();
    est.atualizarLeitura = null;
  }
}

function renderResultado() {
  const av = est.avaliacao;
  if (!av) return [];
  const poros = est.poros;
  const ativos = poros.filter((p) => !p.ignorado);
  const maior = ativos.reduce((m, p) => Math.max(m, p.diamMm), 0);
  const limMin = limitesNorma()[av.regime]?.contarAPartirDeMm ?? 0;
  const somaContados = av.contados.reduce((s, p) => s + p.diamMm, 0);
  const norma = app.norma?.resolver('porosidade', app.config.norma || {});

  const resultado = el('div', { class: `resultado ${av.dentro ? 'boa' : 'ruim'}` },
    el('div', { class: 'resultado-titulo' }, av.dentro ? '✔ DENTRO DO LIMITE' : '✖ FORA DO LIMITE'),
    el('div', { class: 'resultado-sub' }, ativos.length
      ? `${ativos.length} poro${ativos.length > 1 ? 's' : ''} · indicativo, confirme com calibre`
      : 'Nenhum poro encontrado no trecho · indicativo, confirme visualmente'));

  const kpi = (valor, rotulo) => el('div', { class: 'kpi' }, el('b', {}, valor), el('span', {}, rotulo));
  const kpis = el('div', { class: 'kpis' },
    kpi(String(ativos.length), 'poros encontrados'),
    kpi(ativos.length ? `${fmt(maior)} mm` : '—', 'maior poro'),
    kpi(`${fmt(somaContados)} mm`, limMin > 0 ? `soma dos poros ≥ ${fmt(limMin, 0)} mm` : 'soma dos diâmetros'),
    kpi(`${fmt(est.medicao.comprimentoMm)} mm`, 'trecho medido'));

  const regras = el('div', { class: `norma-box ${av.dentro ? 'aprovar' : 'reprovar'}` },
    el('div', { class: 'norma-topo' },
      el('span', { class: `chip ${av.dentro ? 'aprovar' : 'reprovar'}` }, av.dentro ? 'DENTRO' : 'FORA'),
      el('span', { class: 'norma-ref' }, 'AWS D1.1 · porosidade')),
    el('ul', { class: 'medir-regras' }, av.itens.map((i) =>
      el('li', {}, el('span', { class: i.ok ? 'ok' : 'nok' }, i.ok ? '✔' : '✖'),
        el('span', {}, `${i.texto}: `, el('b', {}, i.valor), ` (limite ${i.limite})`)))),
    norma && el('div', { class: 'norma-como' }, norma.texto),
    av.aviso && el('div', { class: 'medir-aviso', style: { marginTop: '6px' } }, `⚠ ${av.aviso}`));

  const rotSens = el('b', {}, `${Math.round(est.sensibilidade * 100)}%`);
  const sens = el('input', { type: 'range', min: '0', max: '100', step: '5', value: Math.round(est.sensibilidade * 100) });
  sens.addEventListener('input', () => { rotSens.textContent = `${sens.value}%`; });
  sens.addEventListener('change', () => {
    est.sensibilidade = Number(sens.value) / 100;
    medir();
    renderControles();
    desenhar();
  });
  const ajuste = el('div', { class: 'cartao form' },
    el('label', {}, el('span', {}, 'Sensibilidade da detecção: ', rotSens), sens),
    el('p', { class: 'dica' }, 'Aumente se faltarem poros; diminua se aparecerem falsos poros (riscos, escamas, sujeira). Ajustar a sensibilidade desfaz os poros ignorados à mão.'));

  const linhas = poros.map((p) => {
    const status = p.ignorado ? 'ignorado' : `${p.manual ? 'manual · ' : ''}${est.contados.has(p) ? 'conta na norma' : `abaixo de ${fmt(limMin, 0)} mm`}`;
    return el('tr', { class: p.ignorado ? 'ignorado' : '' },
      el('td', {}, String(p.numero)), el('td', {}, `${fmt(p.diamMm)} mm`), el('td', {}, `${fmt(p.posMm, 0)} mm`), el('td', {}, status));
  });
  const tabela = el('div', { class: 'cartao' },
    el('h3', {}, 'Poros'),
    poros.length
      ? el('table', { class: 'poros' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Nº'), el('th', {}, 'Diâmetro'), el('th', {}, 'Posição'), el('th', {}, 'Situação'))),
        el('tbody', {}, linhas))
      : el('p', { class: 'dica' }, 'Nenhum poro. Se houver poros visíveis, aumente a sensibilidade ou toque sobre o poro para adicioná-lo.'),
    el('p', { class: 'dica' }, `Escala ${fmt(pxPorMm())} px/mm. Diâmetro = maior dimensão do poro. Posição = distância a partir do início do trecho.`));

  const acoes = el('div', { class: 'acoes' },
    el('button', { class: 'btn btn-primario', onclick: salvarImagem }, '💾 Salvar imagem'),
    el('button', { class: 'btn', onclick: () => irPasso(3) }, '⬅ Ajustar cordão'),
    el('button', { class: 'btn', onclick: () => irPasso(1) }, '📷 Nova medição'));

  const aviso = el('p', { class: 'dica' },
    '⚠ Medição indicativa pela foto: a régua deve estar no mesmo plano da solda e a câmera de frente para a peça. ',
    'Só vê poros na superfície. A decisão final é do inspetor, com calibre.');

  return [resultado, kpis, regras, acoes, ajuste, tabela, aviso];
}

// ---------------------------------------------------------------- desenho

function desenhar() {
  if (!est.foto || est.passo === 1) return;
  const box = canvas.parentElement;
  const larg = box.clientWidth;
  if (!larg) return;
  const dpr = window.devicePixelRatio || 1;
  const maxH = Math.max(260, window.innerHeight * 0.6);
  const r = est.foto.height / est.foto.width;
  const w = Math.min(larg, maxH / r);
  const cw = Math.round(w * dpr), ch = Math.round(w * r * dpr);
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw; canvas.height = ch;
    canvas.style.width = `${w}px`; canvas.style.height = `${w * r}px`;
  }
  est.ev = cw / est.foto.width;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(est.foto, 0, 0, cw, ch);
  sobrepor(ctx, est.ev, dpr, est.passo);
  if (est.arrasto?.lupa) desenharLupa(est.arrasto.lupa, dpr);
}

function rotulo(g, texto, x, y, u, cor = '#fff') {
  g.font = `700 ${13 * u}px system-ui, sans-serif`;
  g.lineWidth = 3 * u;
  g.strokeStyle = 'rgba(0,0,0,.85)';
  g.strokeText(texto, x, y);
  g.fillStyle = cor;
  g.fillText(texto, x, y);
}

function marcador(g, x, y, u, cor) {
  g.strokeStyle = cor;
  g.lineWidth = 2 * u;
  g.beginPath(); g.arc(x, y, 9 * u, 0, Math.PI * 2); g.stroke();
  g.beginPath();
  g.moveTo(x - 14 * u, y); g.lineTo(x - 4 * u, y);
  g.moveTo(x + 4 * u, y); g.lineTo(x + 14 * u, y);
  g.moveTo(x, y - 14 * u); g.lineTo(x, y - 4 * u);
  g.moveTo(x, y + 4 * u); g.lineTo(x, y + 14 * u);
  g.stroke();
}

function poligono(g, pts, ev) {
  g.beginPath();
  pts.forEach((p, i) => (i ? g.lineTo(p.x * ev, p.y * ev) : g.moveTo(p.x * ev, p.y * ev)));
  g.closePath();
}

// Desenha marcações sobre a foto. ev = px de destino por px da foto; u = unidade de traço.
function sobrepor(g, ev, u, passo) {
  g.save();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const ppm = pxPorMm();

  // régua / escala
  if (est.escala.length) {
    g.globalAlpha = passo === 2 ? 1 : 0.6;
    const [a, b] = est.escala;
    if (b) {
      g.strokeStyle = COR.escala; g.lineWidth = 2 * u;
      g.beginPath(); g.moveTo(a.x * ev, a.y * ev); g.lineTo(b.x * ev, b.y * ev); g.stroke();
      rotulo(g, `${fmt(est.mmRef, est.mmRef % 1 ? 1 : 0)} mm`, ((a.x + b.x) / 2) * ev, ((a.y + b.y) / 2) * ev - 16 * u, u, '#bfdbfe');
    }
    if (passo === 2) est.escala.forEach((p) => marcador(g, p.x * ev, p.y * ev, u, COR.escala));
    g.globalAlpha = 1;
  }

  // faixa do cordão
  if (passo >= 3 && est.trecho.length) {
    const [a, b] = est.trecho;
    if (b && ppm) {
      const fx = faixa(a, b, est.larguraMm * ppm);
      poligono(g, fx.cantos(), ev);
      if (passo === 3) { g.fillStyle = 'rgba(245,158,11,.14)'; g.fill(); }
      g.setLineDash([6 * u, 5 * u]);
      g.strokeStyle = COR.trecho; g.lineWidth = 1.5 * u; g.stroke();
      g.setLineDash([]);
      if (passo === 4 && est.avaliacao?.janela) {
        const { inicioMm, fimMm } = est.avaliacao.janela;
        const h = fx.larguraPx / 2;
        poligono(g, [fx.paraFoto(inicioMm * ppm, -h), fx.paraFoto(fimMm * ppm, -h), fx.paraFoto(fimMm * ppm, h), fx.paraFoto(inicioMm * ppm, h)], ev);
        g.fillStyle = est.avaliacao.dentro ? 'rgba(250,204,21,.16)' : 'rgba(239,68,68,.22)';
        g.fill();
      }
    }
    if (passo === 3) {
      est.trecho.forEach((p, i) => {
        marcador(g, p.x * ev, p.y * ev, u, COR.trecho);
        rotulo(g, i ? 'Fim' : 'Início', p.x * ev, p.y * ev - 22 * u, u, '#fde68a');
      });
    }
  }

  // poros
  if (passo === 4 && est.avaliacao) {
    for (const p of est.poros) {
      const cor = p.ignorado ? COR.ignorado : p.manual ? COR.manual : est.contados.has(p) ? COR.contado : COR.pequeno;
      const r = Math.max(4 * u, (p.diamMm * ppm * ev) / 2) + 3 * u;
      g.strokeStyle = cor;
      g.lineWidth = 2 * u;
      if (p.ignorado) g.setLineDash([3 * u, 3 * u]);
      g.beginPath(); g.arc(p.x * ev, p.y * ev, r, 0, Math.PI * 2); g.stroke();
      g.setLineDash([]);
      rotulo(g, String(p.numero), p.x * ev + r * 0.75 + 6 * u, p.y * ev - r * 0.75 - 4 * u, u, cor);
    }
  }

  // poro sendo adicionado à mão
  const ar = est.arrasto;
  if (ar?.tipo === 'novo' && ppm) {
    const r = dist(ar.inicio, ar.atual);
    g.strokeStyle = COR.manual; g.lineWidth = 2 * u;
    g.beginPath(); g.arc(ar.inicio.x * ev, ar.inicio.y * ev, r * ev, 0, Math.PI * 2); g.stroke();
    rotulo(g, `${fmt((2 * r) / ppm)} mm`, ar.inicio.x * ev, (ar.inicio.y - r) * ev - 14 * u, u, COR.manual);
  }
  g.restore();
}

// Lupa: mostra ampliada a região sob o dedo, num canto da imagem.
function desenharLupa(p, u) {
  const R = 62 * u, zoom = 4;
  const cx = p.x * est.ev;
  const lx = cx < canvas.width / 2 ? canvas.width - R - 8 * u : R + 8 * u;
  const ly = R + 8 * u;
  const lado = (2 * R) / (est.ev * zoom); // px da foto mostrados
  let sx = p.x - lado / 2, sy = p.y - lado / 2, sw = lado, sh = lado;
  let dx = lx - R, dy = ly - R;
  const k = (2 * R) / lado;
  // recorta a origem dentro da foto (o Safari não desenha origem fora dos limites)
  if (sx < 0) { dx -= sx * k; sw += sx; sx = 0; }
  if (sy < 0) { dy -= sy * k; sh += sy; sy = 0; }
  sw = Math.min(sw, est.foto.width - sx);
  sh = Math.min(sh, est.foto.height - sy);
  ctx.save();
  ctx.beginPath(); ctx.arc(lx, ly, R, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = '#000'; ctx.fillRect(lx - R, ly - R, 2 * R, 2 * R);
  if (sw > 0 && sh > 0) ctx.drawImage(est.foto, sx, sy, sw, sh, dx, dy, sw * k, sh * k);
  ctx.strokeStyle = est.passo === 2 ? COR.escala : COR.trecho;
  ctx.lineWidth = 1.5 * u;
  ctx.beginPath();
  ctx.moveTo(lx - R, ly); ctx.lineTo(lx - 5 * u, ly); ctx.moveTo(lx + 5 * u, ly); ctx.lineTo(lx + R, ly);
  ctx.moveTo(lx, ly - R); ctx.lineTo(lx, ly - 5 * u); ctx.moveTo(lx, ly + 5 * u); ctx.lineTo(lx, ly + R);
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * u;
  ctx.beginPath(); ctx.arc(lx, ly, R, 0, Math.PI * 2); ctx.stroke();
}

// ---------------------------------------------------------------- toque

function pontoDoEvento(e) {
  const r = canvas.getBoundingClientRect();
  const k = canvas.width / r.width;
  return { x: ((e.clientX - r.left) * k) / est.ev, y: ((e.clientY - r.top) * k) / est.ev };
}

const tolerancia = () => (TOQUE_CSS * (canvas.width / canvas.getBoundingClientRect().width)) / est.ev;

function aoTocar(e) {
  if (!est.foto || est.passo < 2) return;
  e.preventDefault();
  canvas.setPointerCapture?.(e.pointerId);
  const p = pontoDoEvento(e);
  if (est.passo === 2 || est.passo === 3) {
    const pts = est.passo === 2 ? est.escala : est.trecho;
    let i = -1, melhor = Infinity;
    pts.forEach((q, j) => { const d = dist(p, q); if (d < melhor) { melhor = d; i = j; } });
    if (i < 0 || (melhor > tolerancia() && pts.length < 2)) { pts.push(p); i = pts.length - 1; }
    else if (melhor > tolerancia()) pts[i] = p;
    est.arrasto = { tipo: 'ponto', pts, i, lupa: pts[i] };
    desenhar();
  } else if (est.passo === 4) {
    est.arrasto = { tipo: 'toque', inicio: p, atual: p };
  }
}

function aoMover(e) {
  const ar = est.arrasto;
  if (!ar) return;
  e.preventDefault();
  const p = pontoDoEvento(e);
  if (ar.tipo === 'ponto') {
    ar.pts[ar.i] = p;
    ar.lupa = p;
    est.atualizarLeitura?.();
    desenhar();
  } else {
    ar.atual = p;
    if (ar.tipo === 'toque' && dist(ar.inicio, p) > tolerancia() * 0.35) ar.tipo = 'novo';
    if (ar.tipo === 'novo') desenhar();
  }
}

function aoSoltar(e) {
  const ar = est.arrasto;
  if (!ar) return;
  est.arrasto = null;
  if (ar.tipo === 'ponto') {
    est.atualizarLeitura?.();
    desenhar();
    return;
  }
  const ppm = pxPorMm();
  if (ar.tipo === 'novo') {
    const raioPx = dist(ar.inicio, pontoDoEvento(e));
    if ((2 * raioPx) / ppm >= 0.3) {
      est.manuais.push({ x: ar.inicio.x, y: ar.inicio.y, raioPx });
      toast(`Poro adicionado: ${fmt((2 * raioPx) / ppm)} mm`);
    }
  } else {
    // toque simples: 1) em cima de um poro → ignora/reativa (o manual é removido);
    // 2) num ponto sem poro listado → procura um poro novo ali; 3) senão, o poro listado mais próximo.
    const p = ar.inicio;
    const maisProximo = (limite) => {
      let alvo = null, melhor = Infinity;
      for (const q of est.poros) {
        const d = dist(p, q) - (q.diamMm * ppm) / 2;
        if (d < limite && d < melhor) { melhor = d; alvo = q; }
      }
      return alvo;
    };
    const alternar = (alvo) => {
      if (alvo.manual) est.manuais = est.manuais.filter((m) => m !== alvo.ref);
      else alvo.ignorado = !alvo.ignorado;
    };
    const emCima = maisProximo(tolerancia() * 0.3);
    if (emCima) alternar(emCima);
    else {
      const novo = procurarPoroNoPonto(p, ppm);
      const perto = !novo && maisProximo(tolerancia() * 0.6);
      if (novo) {
        est.manuais.push(novo);
        toast(`Poro adicionado: ${fmt((2 * novo.raioPx) / ppm)} mm`);
      } else if (perto) alternar(perto);
      else { toast('Nenhum poro encontrado neste ponto. Para marcar à mão, toque no centro do poro e arraste até a borda.', 4500); return; }
    }
  }
  avaliar();
  renderControles();
  desenhar();
}

// Toque num ponto vazio: procura um poro ali com sensibilidade máxima, numa janela de 8 mm
// alinhada ao cordão, e devolve o mais próximo do toque (até ~1,5 mm de distância da borda).
function procurarPoroNoPonto(p, ppm) {
  const fx = est.medicao.faixa;
  const { u, v } = fx.paraFaixa(p.x, p.y);
  const meia = 4 * ppm;
  const local = medirFoto(est.foto, fx.paraFoto(u - meia, v), fx.paraFoto(u + meia, v), 2 * meia, ppm, { sensibilidade: 1 });
  let melhor = null, dMin = Infinity;
  for (const q of local.poros) {
    // descarta o que já está na lista (mesmo poro achado de novo)
    if (est.poros.some((e) => dist(e, q) < Math.max((e.diamMm * ppm) / 2, 0.5 * ppm))) continue;
    const d = dist(p, q) - (q.diamMm * ppm) / 2;
    if (d < dMin) { dMin = d; melhor = q; }
  }
  if (!melhor || dMin > Math.max(1.5 * ppm, tolerancia() * 0.5)) return null;
  return { x: melhor.x, y: melhor.y, raioPx: (melhor.diamMm * ppm) / 2 };
}

// ---------------------------------------------------------------- salvar imagem

async function salvarImagem() {
  const av = est.avaliacao;
  if (!av) return;
  const f = Math.min(1, 1600 / Math.max(est.foto.width, est.foto.height));
  const w = Math.round(est.foto.width * f), hFoto = Math.round(est.foto.height * f);
  const u = Math.max(1, w / 520);
  const linhas = [
    `${av.dentro ? 'DENTRO DO LIMITE' : 'FORA DO LIMITE'} — porosidade, AWS D1.1 (${app.norma ? app.norma.resumoParametros(app.config.norma) : ''})`,
    ...av.itens.map((i) => `${i.ok ? '✔' : '✖'} ${i.texto}: ${i.valor} (limite ${i.limite})`),
    `Poros: ${est.poros.filter((p) => !p.ignorado).map((p) => `#${p.numero} ${fmt(p.diamMm)} mm`).join(' · ') || 'nenhum'}`,
    `Trecho ${fmt(est.medicao.comprimentoMm)} mm · escala ${fmt(pxPorMm())} px/mm · ${new Date().toLocaleString('pt-BR')}`,
    'Medição indicativa pela foto (Inspetor de Solda). Confirmar com calibre.',
  ];
  const alturaLinha = 18 * u;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = hFoto + Math.round(alturaLinha * (linhas.length + 1));
  const g = c.getContext('2d');
  g.fillStyle = '#0f1419';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(est.foto, 0, 0, w, hFoto);
  sobrepor(g, f, u, 4);
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  linhas.forEach((t, i) => {
    g.font = `${i === 0 ? 800 : 500} ${(i === 0 ? 14 : 12) * u}px system-ui, sans-serif`;
    g.fillStyle = i === 0 ? (av.dentro ? '#4ade80' : '#f87171') : '#e8edf2';
    g.fillText(t, 10 * u, hFoto + alturaLinha * (i + 1), w - 20 * u);
  });
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
  if (!blob) { toast('Falha ao gerar a imagem'); return; }
  const agora = new Date();
  const carimbo = `${agora.toISOString().slice(0, 10)}-${String(agora.getHours()).padStart(2, '0')}${String(agora.getMinutes()).padStart(2, '0')}`;
  const arquivo = new File([blob], `medicao-poros-${carimbo}.jpg`, { type: 'image/jpeg' });
  const r = await compartilharOuBaixar(arquivo, 'Inspetor de Solda — medição de poros');
  if (r === 'baixado') toast('Imagem salva nos downloads');
}
