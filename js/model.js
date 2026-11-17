// Motor de IA: transfer learning em cima de uma rede pré-treinada (MobileNet).
//
// - A "base" (rede pré-treinada, congelada) transforma a imagem num mapa de características 7x7xC.
// - A média desse mapa vira um vetor de C números que descreve a imagem.
// - A "cabeça" (camada linear + softmax) é treinada no próprio aparelho com as fotos do quadro.
// - Como a cabeça é linear, aplicar seus pesos em cada uma das 7x7 posições mostra ONDE
//   está o defeito (mapa de calor / CAM - Class Activation Map).

const tf = () => window.tf;

// Variações de cada foto usadas no treino (aumento de dados).
export const VARIANTES = ['original', 'espelho-h', 'espelho-v', 'girada-90', 'escura'];

// Cede a vez ao navegador sem depender de timers (que são atrasados em abas em segundo plano).
const canal = typeof MessageChannel !== 'undefined' ? new MessageChannel() : null;
const filaCeder = [];
if (canal) {
  canal.port1.onmessage = () => { const r = filaCeder.shift(); if (r) r(); };
}
export function ceder() {
  if (!canal) return new Promise((r) => setTimeout(r, 0));
  return new Promise((r) => { filaCeder.push(r); canal.port2.postMessage(0); });
}

export class Motor {
  constructor() {
    this.base = null;
    this.baseInfo = null;
    this.canais = 0;
    this.cabeca = null; // { W: tf.Tensor2D [C,K], b: tf.Tensor1D [K], classeIds }
  }

  get pronto() { return !!this.base; }
  get temCabeca() { return !!this.cabeca; }

  async iniciarBackend() {
    const t = tf();
    try {
      await t.setBackend('webgl');
    } catch {
      await t.setBackend('cpu');
    }
    await t.ready();
    return t.getBackend();
  }

  async carregarBase(info, aoProgresso) {
    const t = tf();
    if (this.baseInfo?.id === info.id && this.base) return;
    const nova = await t.loadLayersModel(info.url, { onProgress: aoProgresso });
    const lado = info.entrada || 224;
    t.tidy(() => { nova.predict(t.zeros([1, lado, lado, 3])); }); // aquece a GPU
    if (this.base) this.base.dispose();
    this.base = nova;
    this.baseInfo = { ...info, entrada: lado };
    this.canais = nova.outputs[0].shape[3];
  }

  // fonte (canvas/imagem/vídeo já quadrado) -> tensor [L,L,3] em 0..255
  _pixels(fonte) {
    const t = tf();
    const L = this.baseInfo.entrada;
    let x = t.browser.fromPixels(fonte).toFloat();
    if (x.shape[0] !== L || x.shape[1] !== L) x = t.image.resizeBilinear(x, [L, L], true);
    return x;
  }

  _normalizar(x) { return x.div(127.5).sub(1); } // MobileNet espera valores entre -1 e 1

  // Vetores de características da foto e de suas variações (VARIANTES.length * C números).
  async vetores(fonte) {
    const t = tf();
    const saida = t.tidy(() => {
      const img = this._pixels(fonte);
      const lote = t.stack([
        img,
        t.reverse(img, 1),
        t.reverse(img, 0),
        t.reverse(t.transpose(img, [1, 0, 2]), 1),
        img.mul(0.7),
      ]);
      const mapa = this.base.predict(this._normalizar(lote));
      return mapa.mean([1, 2]);
    });
    const dados = await saida.data();
    saida.dispose();
    return new Float32Array(dados);
  }

  definirCabeca(modelo) {
    const t = tf();
    this.limparCabeca();
    if (!modelo) return;
    const C = modelo.C, K = modelo.classeIds.length;
    this.cabeca = {
      W: t.tensor2d(modelo.W, [C, K]),
      b: t.tensor1d(modelo.b),
      classeIds: modelo.classeIds,
    };
  }

  limparCabeca() {
    if (this.cabeca) { this.cabeca.W.dispose(); this.cabeca.b.dispose(); }
    this.cabeca = null;
  }

  // Retorna probabilidades por classe e o mapa de calor (h*w*K) para a imagem.
  async prever(fonte) {
    const t = tf();
    const { W, b } = this.cabeca;
    const [probsT, camT, h, w] = t.tidy(() => {
      const x = this._normalizar(this._pixels(fonte)).expandDims(0);
      const mapa = this.base.predict(x); // [1,h,w,C]
      const [, hh, ww, C] = mapa.shape;
      const vetor = mapa.mean([1, 2]);
      const probs = t.softmax(vetor.matMul(W).add(b)).squeeze();
      const cam = mapa.reshape([hh * ww, C]).matMul(W); // [h*w, K]
      return [probs, cam, hh, ww];
    });
    const [probs, cam] = await Promise.all([probsT.data(), camT.data()]);
    probsT.dispose(); camT.dispose();
    return { probs: Float32Array.from(probs), cam: Float32Array.from(cam), h, w, K: this.cabeca.classeIds.length };
  }
}

// ---------------- Treino da cabeça ----------------

function embaralhar(arr, rnd) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function rng(semente = 42) {
  let s = semente >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let x = Math.imul(s ^ (s >>> 15), 1 | s);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function normalAleatoria(rnd) {
  let u = 0, v = 0;
  while (u === 0) u = rnd();
  while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Treina uma regressão softmax (camada linear) sobre os vetores, em JavaScript puro
 * (rápido em qualquer aparelho e não depende da GPU).
 * Técnicas para poucas fotos: dropout, suavização de rótulos, regularização L2,
 * peso por classe (compensa classes com menos fotos) e otimizador Adam.
 * X: Float32Array n*C, y: Int32Array n. Retorna { W: Float32Array C*K, b: Float32Array K }.
 */
export async function treinarCabeca(X, y, n, C, K, opcoes = {}) {
  const {
    lote = 64, lr = 0.004, l2 = 5e-4, suavizacao = 0.1, dropout = 0.2,
    passosAlvo = 220, aoProgresso = null, semente = 7,
  } = opcoes;
  const passosPorEpoca = Math.max(1, Math.ceil(n / lote));
  const epocas = Math.min(80, Math.max(10, Math.ceil(passosAlvo / passosPorEpoca)));
  const rnd = rng(semente);

  const cont = new Array(K).fill(0);
  for (let i = 0; i < n; i++) cont[y[i]]++;
  const presentes = cont.filter((c) => c > 0).length || 1;
  const pesoClasse = cont.map((c) => (c ? n / (presentes * c) : 0));

  const P = C * K;
  const W = new Float32Array(P);
  for (let i = 0; i < P; i++) W[i] = 0.01 * normalAleatoria(rnd);
  const b = new Float32Array(K);
  const gW = new Float32Array(P), gb = new Float32Array(K);
  const mW = new Float32Array(P), vW = new Float32Array(P), mb = new Float32Array(K), vb = new Float32Array(K);
  const xd = new Float32Array(C), z = new Float32Array(K), d = new Float32Array(K);
  const manter = 1 - dropout, escala = 1 / manter;
  // Banco de máscaras de dropout pré-sorteadas (bem mais rápido que sortear cada número).
  const NM = 128;
  const mascaras = Array.from({ length: NM }, () => Uint8Array.from({ length: C }, () => (rnd() < manter ? 1 : 0)));
  const b1 = 0.9, b2 = 0.999, eps = 1e-8;
  let passo = 0;
  const idx = Int32Array.from({ length: n }, (_, i) => i);

  for (let e = 0; e < epocas; e++) {
    embaralhar(idx, rnd);
    for (let s = 0; s < n; s += lote) {
      const fim = Math.min(n, s + lote);
      const B = fim - s;
      gW.fill(0); gb.fill(0);
      for (let q = s; q < fim; q++) {
        const i = idx[q];
        const off = i * C;
        const m = mascaras[(rnd() * NM) | 0];
        for (let c = 0; c < C; c++) xd[c] = m[c] ? X[off + c] * escala : 0;
        for (let k = 0; k < K; k++) z[k] = b[k];
        for (let c = 0; c < C; c++) {
          const v = xd[c];
          if (v === 0) continue;
          const base = c * K;
          for (let k = 0; k < K; k++) z[k] += v * W[base + k];
        }
        let max = -Infinity;
        for (let k = 0; k < K; k++) if (z[k] > max) max = z[k];
        let soma = 0;
        for (let k = 0; k < K; k++) { z[k] = Math.exp(z[k] - max); soma += z[k]; }
        const w = pesoClasse[y[i]] / B;
        for (let k = 0; k < K; k++) {
          const alvo = (k === y[i] ? 1 - suavizacao : 0) + suavizacao / K;
          d[k] = w * (z[k] / soma - alvo);
          gb[k] += d[k];
        }
        for (let c = 0; c < C; c++) {
          const v = xd[c];
          if (v === 0) continue;
          const base = c * K;
          for (let k = 0; k < K; k++) gW[base + k] += v * d[k];
        }
      }
      passo++;
      const c1 = 1 - b1 ** passo, c2 = 1 - b2 ** passo;
      for (let j = 0; j < P; j++) {
        const g = gW[j] + 2 * l2 * W[j];
        mW[j] = b1 * mW[j] + (1 - b1) * g;
        vW[j] = b2 * vW[j] + (1 - b2) * g * g;
        W[j] -= lr * (mW[j] / c1) / (Math.sqrt(vW[j] / c2) + eps);
      }
      for (let k = 0; k < K; k++) {
        mb[k] = b1 * mb[k] + (1 - b1) * gb[k];
        vb[k] = b2 * vb[k] + (1 - b2) * gb[k] * gb[k];
        b[k] -= lr * (mb[k] / c1) / (Math.sqrt(vb[k] / c2) + eps);
      }
    }
    if (aoProgresso) aoProgresso((e + 1) / epocas);
    await ceder();
  }
  return { W, b };
}

// Probabilidades para um lote de vetores com pesos W,b (usado na validação).
export function preverLote(X, n, C, W, b, K) {
  const out = new Float32Array(n * K);
  for (let i = 0; i < n; i++) {
    const off = i * C;
    let max = -Infinity;
    for (let k = 0; k < K; k++) {
      let z = b[k];
      for (let c = 0; c < C; c++) z += X[off + c] * W[c * K + k];
      out[i * K + k] = z;
      if (z > max) max = z;
    }
    let soma = 0;
    for (let k = 0; k < K; k++) { out[i * K + k] = Math.exp(out[i * K + k] - max); soma += out[i * K + k]; }
    for (let k = 0; k < K; k++) out[i * K + k] /= soma;
  }
  return out;
}

/**
 * Treina com validação cruzada estratificada (k partes) e depois treina o modelo final com tudo.
 * amostras: [{ fotoId, k (índice da classe), vet: Float32Array(V*C) }]
 * Retorna { W, b, metricas }.
 */
export async function treinarComValidacao(amostras, K, C, aoProgresso = () => {}) {
  const V = VARIANTES.length;
  const porClasse = Array.from({ length: K }, () => []);
  amostras.forEach((a, i) => porClasse[a.k].push(i));
  const menor = Math.min(...porClasse.map((l) => l.length));
  const kf = Math.max(2, Math.min(5, menor));
  const rnd = rng(123);
  const dobra = new Int32Array(amostras.length);
  for (const lista of porClasse) {
    embaralhar(lista, rnd).forEach((i, j) => { dobra[i] = j % kf; });
  }

  const montar = (indices, todasVariantes) => {
    const nv = todasVariantes ? V : 1;
    const X = new Float32Array(indices.length * nv * C);
    const y = new Int32Array(indices.length * nv);
    let r = 0;
    for (const i of indices) {
      const { vet, k } = amostras[i];
      for (let v = 0; v < nv; v++) {
        X.set(vet.subarray(v * C, (v + 1) * C), r * C);
        y[r++] = k;
      }
    }
    return { X, y, n: r };
  };

  const totalEtapas = kf + 1;
  const previsto = new Int32Array(amostras.length);
  const confianca = new Float32Array(amostras.length);
  for (let f = 0; f < kf; f++) {
    const treino = [], teste = [];
    amostras.forEach((_, i) => (dobra[i] === f ? teste : treino).push(i));
    const tr = montar(treino, true);
    const { W, b } = await treinarCabeca(tr.X, tr.y, tr.n, C, K, {
      semente: 11 + f, aoProgresso: (p) => aoProgresso((f + p) / totalEtapas, `Validando (${f + 1}/${kf})`),
    });
    const te = montar(teste, false);
    const P = preverLote(te.X, te.n, C, W, b, K);
    teste.forEach((i, j) => {
      let melhor = 0;
      for (let c = 1; c < K; c++) if (P[j * K + c] > P[j * K + melhor]) melhor = c;
      previsto[i] = melhor;
      confianca[i] = P[j * K + melhor];
    });
  }

  const tudo = montar(amostras.map((_, i) => i), true);
  const final = await treinarCabeca(tudo.X, tudo.y, tudo.n, C, K, {
    semente: 99, aoProgresso: (p) => aoProgresso((kf + p) / totalEtapas, 'Treinando modelo final'),
  });

  const matriz = Array.from({ length: K }, () => new Array(K).fill(0));
  amostras.forEach((a, i) => { matriz[a.k][previsto[i]]++; });
  const acertos = matriz.reduce((s, linha, i) => s + linha[i], 0);
  const erros = [];
  amostras.forEach((a, i) => {
    if (previsto[i] !== a.k) erros.push({ fotoId: a.fotoId, real: a.k, previsto: previsto[i], confianca: confianca[i] });
  });

  return {
    W: final.W,
    b: final.b,
    metricas: {
      kf,
      total: amostras.length,
      acerto: acertos / amostras.length,
      matriz,
      erros,
    },
  };
}
