// Medição de poros pela foto (aba "Medir"). Processamento de imagem clássico, sem IA:
//
// 1. A faixa do cordão (entre dois pontos marcados pelo usuário) é "endireitada" num retângulo.
// 2. Poros são manchas ESCURAS e arredondadas, menores que o fundo à volta. O "fechamento"
//    morfológico (máximo seguido de mínimo), na horizontal e na vertical, apaga essas manchas e estima
//    o fundo; fundo − imagem realça só os pontos escuros pequenos nas duas direções (black-hat).
// 3. Limiar robusto (mediana + k·desvio) com histerese, componentes conectados e filtros de forma
//    (alongamento, preenchimento) para descartar ondulações do cordão e bordas.
// 4. O diâmetro de cada poro é a MAIOR dimensão (conservador), convertida para mm pela escala da régua.
//
// Nada aqui grava dados: são funções puras usadas pela aba e pelo autoteste.

// Limites usados se o arquivo da norma não trouxer o bloco "medicao".
export const LIMITES_PADRAO = {
  cjp_transversal: { contarAPartirDeMm: 0, porosMax: 0 },
  estatico: { contarAPartirDeMm: 1, trechoMm: 25, somaMaxMm: 10, trechoLongoMm: 300, somaMaxLongoMm: 19 },
  ciclico: { contarAPartirDeMm: 0, diametroMaxMm: 2.5, trechoMm: 100, porosMaxPorTrecho: 1 },
};

export const OPCOES_PADRAO = {
  sensibilidade: 0.5,   // 0 = só manchas bem escuras; 1 = pega manchas fracas (mais falsos poros)
  minDiamMm: 0.5,       // menor poro listado
  maxDiamMm: 6,         // maior poro procurado (define a janela do fundo)
  razaoMax: 2.6,        // maior/menor dimensão: acima disso é risco/ondulação, não poro
  preenchimentoMin: 0.45, // área / área da elipse envolvente
  pxPorMmTrabalho: 20,  // resolução máxima de processamento (acima disso a faixa é reduzida)
};

export const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

// ---------------------------------------------------------------- geometria da faixa

/**
 * Descreve a faixa do cordão: eixo de p1 a p2 (pixels da foto) e largura em pixels.
 * Converte entre coordenadas da foto (x, y) e da faixa (u ao longo do eixo, v transversal a partir do centro).
 */
export function faixa(p1, p2, larguraPx) {
  const comp = dist(p1, p2);
  const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x);
  const c = Math.cos(ang), s = Math.sin(ang);
  return {
    p1, p2, comp, ang, larguraPx,
    paraFoto(u, v) { return { x: p1.x + c * u - s * v, y: p1.y + s * u + c * v }; },
    paraFaixa(x, y) { const dx = x - p1.x, dy = y - p1.y; return { u: c * dx + s * dy, v: -s * dx + c * dy }; },
    cantos() {
      const h = larguraPx / 2;
      return [this.paraFoto(0, -h), this.paraFoto(comp, -h), this.paraFoto(comp, h), this.paraFoto(0, h)];
    },
  };
}

/** Copia a faixa da foto para um retângulo alinhado ao eixo (redimensionado por `escala`). Retorna ImageData. */
export function endireitarFaixa(fonte, fx, escala = 1) {
  const w = Math.max(2, Math.round(fx.comp * escala));
  const h = Math.max(2, Math.round(fx.larguraPx * escala));
  const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.scale(escala, escala);
  g.translate(0, fx.larguraPx / 2);
  g.rotate(-fx.ang);
  g.translate(-fx.p1.x, -fx.p1.y);
  g.drawImage(fonte, 0, 0);
  return g.getImageData(0, 0, w, h);
}

// ---------------------------------------------------------------- filtros

// Máximo (ou mínimo) numa janela 1D de raio r, em O(n), com fila monotônica.
function linhaMaxMin(ent, sai, n, r, ehMax, dq) {
  let h = 0, t = 0, j = 0;
  for (let i = 0; i < n; i++) {
    const fim = Math.min(n - 1, i + r);
    while (j <= fim) {
      const v = ent[j];
      while (t > h && (ehMax ? ent[dq[t - 1]] <= v : ent[dq[t - 1]] >= v)) t--;
      dq[t++] = j++;
    }
    while (dq[h] < i - r) h++;
    sai[i] = ent[dq[h]];
  }
}

// Filtro de máximo/mínimo 1D aplicado em todas as linhas (horizontal) ou colunas (vertical).
function maxMinDirecional(img, w, h, r, ehMax, vertical) {
  const out = new Float32Array(w * h);
  const n = vertical ? h : w, m = vertical ? w : h;
  const passo = vertical ? w : 1, salto = vertical ? 1 : w;
  const a = new Float32Array(n), b = new Float32Array(n), dq = new Int32Array(n);
  for (let k = 0; k < m; k++) {
    const off = k * salto;
    for (let i = 0; i < n; i++) a[i] = img[off + i * passo];
    linhaMaxMin(a, b, n, r, ehMax, dq);
    for (let i = 0; i < n; i++) out[off + i * passo] = b[i];
  }
  return out;
}

// Fechamento (máximo e depois mínimo) numa direção: preenche manchas escuras mais curtas que a janela.
const fechamento = (img, w, h, r, vertical) =>
  maxMinDirecional(maxMinDirecional(img, w, h, r, true, vertical), w, h, r, false, vertical);

// Média numa janela quadrada de raio r (separável, somas acumuladas).
function caixa(img, w, h, r) {
  if (r < 1) return img;
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const off = y * w;
    let s = 0;
    for (let x = -r; x <= r; x++) s += img[off + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[off + x] = s / (2 * r + 1);
      s += img[off + Math.min(w - 1, x + r + 1)] - img[off + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s / (2 * r + 1);
      s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

// Mediana e desvio robusto (MAD) por histograma, só dos pixels válidos.
function estatisticaRobusta(v, valido) {
  const hist = new Uint32Array(256);
  let n = 0;
  for (let i = 0; i < v.length; i++) if (valido[i]) { hist[Math.min(255, v[i] | 0)]++; n++; }
  if (!n) return { mediana: 0, sigma: 0 };
  const quantil = (hh, q) => { let acc = 0; for (let k = 0; k < 256; k++) { acc += hh[k]; if (acc >= q) return k; } return 255; };
  const mediana = quantil(hist, n / 2);
  const desv = new Uint32Array(256);
  for (let k = 0; k < 256; k++) desv[Math.abs(k - mediana)] += hist[k];
  const mad = quantil(desv, n / 2);
  return { mediana, sigma: Math.max(1, 1.4826 * mad) };
}

// Erosão seguida de dilatação de uma máscara binária com um disco de raio r ("abertura").
function abrir(mascara, w, h, r) {
  const offs = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r + r) offs.push([dx, dy]);
  const passa = (src, x, y, todos) => {
    for (const [dx, dy] of offs) {
      const xx = x + dx, yy = y + dy;
      const v = xx >= 0 && yy >= 0 && xx < w && yy < h ? src[yy * w + xx] : (todos ? 1 : 0);
      if (todos && !v) return 0;
      if (!todos && v) return 1;
    }
    return todos ? 1 : 0;
  };
  const er = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mascara[y * w + x]) er[y * w + x] = passa(mascara, x, y, true);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mascara[y * w + x]) out[y * w + x] = passa(er, x, y, false);
  return out;
}

const DIRECOES = Array.from({ length: 8 }, (_, k) => [Math.cos((k * Math.PI) / 8), Math.sin((k * Math.PI) / 8)]);

// ---------------------------------------------------------------- detecção

/**
 * Detecta poros num ImageData já endireitado.
 * Retorna { poros: [{ u, v, diamMm, menorMm, contraste }] (u, v em pixels da imagem recebida, v a partir do topo),
 *           limiar, diferenca (Float32Array, para depuração) }.
 */
export function detectarPoros(imagem, pxPorMm, opcoes = {}) {
  const o = { ...OPCOES_PADRAO, ...opcoes };
  const { width: w, height: h, data } = imagem;
  const N = w * h;
  const cinza = new Float32Array(N);
  const valido = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const a = data[i * 4 + 3];
    valido[i] = a >= 128 ? 1 : 0;
    cinza[i] = valido[i] ? 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2] : 0;
  }

  const suave = caixa(cinza, w, h, Math.max(1, Math.round(pxPorMm * 0.08)));
  const r = Math.max(2, Math.round((o.maxDiamMm / 2) * pxPorMm) + 2);
  // Fundo = menor entre o fechamento horizontal e o vertical. Uma mancha só se destaca se for
  // pequena nas DUAS direções (poro). Linhas longas (bordas do cordão, escamas, riscos) e a variação
  // de brilho de um lado ao outro do cordão não se destacam.
  const fh = fechamento(suave, w, h, r, false);
  const fv = fechamento(suave, w, h, r, true);
  const dif = new Float32Array(N);
  for (let i = 0; i < N; i++) dif[i] = valido[i] ? Math.max(0, Math.min(fh[i], fv[i]) - suave[i]) : 0;

  const s = Math.min(1, Math.max(0, o.sensibilidade));
  const { mediana, sigma } = estatisticaRobusta(dif, valido);
  const k = 9 - 6 * s;
  const minContraste = 34 - 22 * s;
  const forte = Math.max(minContraste, mediana + k * sigma);
  const fraco = Math.max(forte * 0.5, mediana + 2 * sigma);

  // Máscara das manchas e "abertura" com um disco (~0,4 mm): apaga linhas finas (escamas, riscos)
  // e separa o poro de uma escama que encosta nele.
  const mascara = new Uint8Array(N);
  for (let i = 0; i < N; i++) mascara[i] = dif[i] >= fraco ? 1 : 0;
  const aberta = abrir(mascara, w, h, Math.max(1, Math.round(pxPorMm * 0.2)));

  const visto = new Uint8Array(N);
  const pilha = new Int32Array(N);
  const pix = new Int32Array(N);
  const med = new Int32Array(N);
  const areaMin = Math.max(3, Math.PI * (o.minDiamMm * pxPorMm / 2) ** 2 * 0.35);
  const areaMax = Math.PI * (o.maxDiamMm * pxPorMm / 2) ** 2 * 1.6;
  const poros = [];

  for (let i0 = 0; i0 < N; i0++) {
    if (visto[i0] || !aberta[i0]) continue;
    let topo = 0, n = 0, borda = false, invalido = false, pico = 0;
    pilha[topo++] = i0; visto[i0] = 1;
    while (topo) {
      const p = pilha[--topo];
      pix[n++] = p;
      if (dif[p] > pico) pico = dif[p];
      const x = p % w, y = (p - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) borda = true;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const q = yy * w + xx;
          if (!valido[q]) invalido = true;
          if (visto[q] || !aberta[q]) continue;
          visto[q] = 1;
          pilha[topo++] = q;
        }
      }
    }
    // precisa ter contraste forte em algum ponto (histerese) e não pode tocar a borda da faixa
    if (pico < forte || borda || invalido || n > areaMax * 3) continue;

    // O tamanho é medido onde o contraste passa de 50% do pico do próprio poro:
    // a borda fica onde o poro realmente termina, e escamas mais fracas ao redor não entram.
    const corte = pico * 0.5;
    let m = 0;
    for (let j = 0; j < n; j++) if (dif[pix[j]] >= corte) med[m++] = pix[j];
    if (m < areaMin || m > areaMax) continue;

    let menor = Infinity, maior = 0;
    let minX = w, maxX = 0, minY = h, maxY = 0;
    for (let j = 0; j < m; j++) {
      const x = med[j] % w, y = (med[j] / w) | 0;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    for (const [cx, cy] of DIRECOES) {
      let lo = Infinity, hi = -Infinity;
      for (let j = 0; j < m; j++) {
        const x = med[j] % w, y = (med[j] / w) | 0;
        const t = x * cx + y * cy;
        if (t < lo) lo = t; if (t > hi) hi = t;
      }
      const ext = hi - lo + 1;
      if (ext > maior) maior = ext;
      if (ext < menor) menor = ext;
    }
    const razao = maior / Math.max(1, menor);
    const preenchimento = m / ((Math.PI / 4) * maior * menor);
    const diamMm = maior / pxPorMm;
    if (razao > o.razaoMax || preenchimento < o.preenchimentoMin) continue;
    if (diamMm < o.minDiamMm || diamMm > o.maxDiamMm) continue;
    poros.push({
      u: (minX + maxX + 1) / 2,
      v: (minY + maxY + 1) / 2,
      diamMm,
      menorMm: menor / pxPorMm,
      contraste: pico,
    });
  }
  poros.sort((a, b) => a.u - b.u);
  return { poros, limiar: forte, diferenca: dif };
}

/**
 * Mede os poros de uma foto: endireita a faixa, detecta e devolve cada poro com posição na foto
 * (x, y em pixels), posição ao longo do cordão (posMm) e diâmetro em mm.
 */
export function medirFoto(fonte, p1, p2, larguraPx, pxPorMm, opcoes = {}) {
  const o = { ...OPCOES_PADRAO, ...opcoes };
  const fx = faixa(p1, p2, larguraPx);
  const escala = Math.min(1, o.pxPorMmTrabalho / pxPorMm);
  const img = endireitarFaixa(fonte, fx, escala);
  const pxTrab = pxPorMm * escala;
  const { poros, limiar } = detectarPoros(img, pxTrab, o);
  const meia = larguraPx / 2;
  return {
    faixa: fx,
    comprimentoMm: fx.comp / pxPorMm,
    limiar,
    poros: poros.map((p) => {
      const u = p.u / escala, v = p.v / escala - meia;
      const { x, y } = fx.paraFoto(u, v);
      return { x, y, posMm: u / pxPorMm, diamMm: p.diamMm, menorMm: p.menorMm, manual: false };
    }),
  };
}

// ---------------------------------------------------------------- norma

// Maior soma de `valor` entre itens cujas posições cabem numa janela de `janela` mm.
export function piorJanela(itens, janela, valor = (p) => p.diamMm) {
  const ord = [...itens].sort((a, b) => a.posMm - b.posMm);
  let melhor = { soma: 0, n: 0, inicioMm: 0, fimMm: 0 };
  let i = 0, soma = 0;
  for (let j = 0; j < ord.length; j++) {
    soma += valor(ord[j]);
    while (ord[j].posMm - ord[i].posMm > janela) { soma -= valor(ord[i]); i++; }
    if (soma > melhor.soma + 1e-9) melhor = { soma, n: j - i + 1, inicioMm: ord[i].posMm, fimMm: ord[i].posMm + janela };
  }
  return melhor;
}

const mm = (x) => `${x.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mm`;

/**
 * Compara os poros medidos com os limites da norma para os parâmetros escolhidos
 * (carregamento, junta). Retorna { regime, dentro, contados, itens: [{ texto, valor, limite, ok }], janela, aviso }.
 */
export function avaliarPorosidade(poros, comprimentoMm, params = {}, limites = LIMITES_PADRAO) {
  const L = { ...LIMITES_PADRAO, ...(limites || {}) };
  const ativos = poros.filter((p) => !p.ignorado);
  const itens = [];
  let janela = null, aviso = null, regime;

  if (params.junta === 'cjp_transversal') {
    regime = 'cjp_transversal';
    const lim = L.cjp_transversal;
    const contados = ativos.filter((p) => p.diamMm >= lim.contarAPartirDeMm);
    itens.push({ texto: 'Poros visíveis (CJP transversal à tração)', valor: String(contados.length), limite: `≤ ${lim.porosMax}`, ok: contados.length <= lim.porosMax });
    return fechar(regime, contados);
  }

  if (params.carregamento === 'ciclico') {
    regime = 'ciclico';
    const lim = L.ciclico;
    const contados = ativos.filter((p) => p.diamMm >= lim.contarAPartirDeMm);
    const maior = contados.reduce((m, p) => Math.max(m, p.diamMm), 0);
    itens.push({ texto: 'Maior poro', valor: contados.length ? mm(maior) : '—', limite: `≤ ${mm(lim.diametroMaxMm)}`, ok: maior <= lim.diametroMaxMm });
    const pj = piorJanela(contados, lim.trechoMm, () => 1);
    if (pj.n) janela = { inicioMm: pj.inicioMm, fimMm: Math.min(comprimentoMm, pj.fimMm) };
    itens.push({ texto: `Poros em qualquer trecho de ${lim.trechoMm} mm`, valor: String(pj.n), limite: `≤ ${lim.porosMaxPorTrecho}`, ok: pj.n <= lim.porosMaxPorTrecho });
    if (comprimentoMm < lim.trechoMm) aviso = `O trecho medido (${mm(comprimentoMm)}) é menor que ${lim.trechoMm} mm: confira também o restante do cordão.`;
    return fechar(regime, contados);
  }

  regime = 'estatico';
  const lim = L.estatico;
  const contados = ativos.filter((p) => p.diamMm >= lim.contarAPartirDeMm);
  const pj = piorJanela(contados, lim.trechoMm);
  if (pj.n) janela = { inicioMm: pj.inicioMm, fimMm: Math.min(comprimentoMm, pj.fimMm) };
  itens.push({ texto: `Soma dos diâmetros (poros ≥ ${lim.contarAPartirDeMm} mm) no pior trecho de ${lim.trechoMm} mm`, valor: mm(pj.soma), limite: `≤ ${mm(lim.somaMaxMm)}`, ok: pj.soma <= lim.somaMaxMm });
  const pl = piorJanela(contados, lim.trechoLongoMm);
  const curto = comprimentoMm < lim.trechoLongoMm;
  itens.push({ texto: `Soma dos diâmetros em ${curto ? 'todo o trecho medido' : `qualquer trecho de ${lim.trechoLongoMm} mm`}`, valor: mm(pl.soma), limite: `≤ ${mm(lim.somaMaxLongoMm)}`, ok: pl.soma <= lim.somaMaxLongoMm });
  if (curto) aviso = `O trecho medido (${mm(comprimentoMm)}) é menor que ${lim.trechoLongoMm} mm: some com os poros do restante do cordão para o limite de ${mm(lim.somaMaxLongoMm)}.`;
  return fechar(regime, contados);

  function fechar(reg, contados) {
    return { regime: reg, dentro: itens.every((i) => i.ok), contados, itens, janela, aviso };
  }
}
