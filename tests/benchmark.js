// Comparação de variantes do motor de IA com as fotos de um arquivo exportado pelo app.
// Abra tests/benchmark.html?arquivo=<nome do .json na pasta do projeto> pelo servidor local.
// Nada é gravado: o arquivo é só lido.
//
// Validação honesta: fotos da mesma rajada (tiradas com menos de 5 s de intervalo) são quase iguais.
// Se uma fica no treino e outra no teste, o acerto sai inflado. Por isso o teste é agrupado
// por rajada e por sessão (intervalo > 30 s), além do modo "por foto" que o app usa hoje.
import { Motor, treinarCabeca, preverLote, rng } from '../js/model.js';
import { Norma } from '../js/norma.js';

const log = document.getElementById('log');
const estado = document.getElementById('estado');
const info = (t) => { const li = document.createElement('li'); li.textContent = t; log.append(li); console.log(t); };
const pct = (x) => `${(x * 100).toFixed(1)}%`;

// Aumentos de dados: os 5 primeiros são os que o app usa hoje.
const AUMENTOS = ['original', 'espelho-h', 'espelho-v', 'girada-90', 'escura',
  'girada-180', 'girada-270', 'clara', 'zoom-centro-80', 'zoom-canto-85'];
const VARIANTES = [
  { id: 'A', nome: 'Atual (média, 5 aumentos)', max: false, aumentos: 5 },
  { id: 'B', nome: 'Melhoria 1 (média + máximo)', max: true, aumentos: 5 },
  { id: 'C', nome: 'Melhoria 2 (10 aumentos)', max: false, aumentos: 10 },
  { id: 'D', nome: 'Melhorias 1 + 2', max: true, aumentos: 10 },
];
const SEMENTES = [1, 2, 3];
const MIN_FOTOS = 5;

function embaralhar(arr, rnd) {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}

async function decodificar(dataURL) {
  const img = new Image();
  img.src = dataURL;
  await img.decode();
  return img;
}

// Para cada foto: características (média e máximo do mapa 7x7) de cada aumento.
async function extrair(motor, fonte) {
  const tf = window.tf;
  const L = motor.baseInfo.entrada;
  const [media, maximo] = tf.tidy(() => {
    const cheia = tf.browser.fromPixels(fonte).toFloat();
    const img = tf.image.resizeBilinear(cheia, [L, L], true);
    const t = tf.transpose(img, [1, 0, 2]);
    const zoom = tf.image.cropAndResize(cheia.expandDims(0),
      [[0.1, 0.1, 0.9, 0.9], [0.15, 0.15, 1, 1]], [0, 0], [L, L]);
    const lote = tf.concat([
      tf.stack([
        img, tf.reverse(img, 1), tf.reverse(img, 0), tf.reverse(t, 1), img.mul(0.7),
        tf.reverse(img, [0, 1]), tf.reverse(t, 0), tf.minimum(img.mul(1.3), 255),
      ]),
      zoom,
    ]);
    const mapa = motor.base.predict(lote.div(127.5).sub(1));
    return [mapa.mean([1, 2]), mapa.max([1, 2])];
  });
  const [a, b] = await Promise.all([media.data(), maximo.data()]);
  media.dispose(); maximo.dispose();
  return { media: Float32Array.from(a), maximo: Float32Array.from(b) };
}

// Agrupa fotos por intervalo de tempo dentro de cada classe (rajada / sessão).
function grupos(amostras, intervaloS) {
  const g = new Int32Array(amostras.length);
  let prox = 0;
  const porClasse = new Map();
  amostras.forEach((a, i) => { if (!porClasse.has(a.k)) porClasse.set(a.k, []); porClasse.get(a.k).push(i); });
  for (const idx of porClasse.values()) {
    idx.sort((i, j) => amostras[i].t - amostras[j].t);
    let atual = prox++;
    idx.forEach((i, n) => {
      if (n && amostras[i].t - amostras[idx[n - 1]].t > intervaloS * 1000) atual = prox++;
      g[i] = atual;
    });
  }
  return g;
}

// Partes da validação cruzada: grupos inteiros vão para a mesma parte, estratificado por classe.
function dobras(amostras, g, K, semente) {
  const rnd = rng(semente);
  const gruposPorClasse = Array.from({ length: K }, () => new Set());
  amostras.forEach((a, i) => gruposPorClasse[a.k].add(g[i]));
  const kf = Math.max(2, Math.min(5, ...gruposPorClasse.map((s) => s.size)));
  const dobraDoGrupo = new Map();
  for (const s of gruposPorClasse) embaralhar([...s], rnd).forEach((gid, j) => dobraDoGrupo.set(gid, j % kf));
  return { kf, dobra: Int32Array.from(amostras, (_, i) => dobraDoGrupo.get(g[i])) };
}

function vetor(a, v, usarMax, C) {
  if (!usarMax) return a.media.subarray(v * C, (v + 1) * C);
  const out = new Float32Array(2 * C);
  out.set(a.media.subarray(v * C, (v + 1) * C), 0);
  out.set(a.maximo.subarray(v * C, (v + 1) * C), C);
  return out;
}

async function validar(amostras, K, C, variante, dobra, kf, semente) {
  const D = variante.max ? 2 * C : C;
  const probs = new Float32Array(amostras.length * K);
  for (let f = 0; f < kf; f++) {
    const treino = [], teste = [];
    amostras.forEach((_, i) => (dobra[i] === f ? teste : treino).push(i));
    const nv = variante.aumentos;
    const X = new Float32Array(treino.length * nv * D), y = new Int32Array(treino.length * nv);
    let r = 0;
    for (const i of treino) for (let v = 0; v < nv; v++) { X.set(vetor(amostras[i], v, variante.max, C), r * D); y[r++] = amostras[i].k; }
    const { W, b } = await treinarCabeca(X, y, r, D, K, { semente: semente * 100 + f });
    const Xt = new Float32Array(teste.length * D);
    teste.forEach((i, j) => Xt.set(vetor(amostras[i], 0, variante.max, C), j * D));
    const P = preverLote(Xt, teste.length, D, W, b, K);
    teste.forEach((i, j) => probs.set(P.subarray(j * K, (j + 1) * K), i * K));
  }
  return probs;
}

function metricas(amostras, probs, K, aceitavel) {
  const matriz = Array.from({ length: K }, () => new Array(K).fill(0));
  let defTot = 0, defRuim = 0, boaTot = 0, boaAprov = 0;
  const dec = { sim: { ruim: 0, boa: 0, inc: 0, defBoa: 0, boaRuim: 0 }, assim: { ruim: 0, boa: 0, inc: 0, defBoa: 0, boaRuim: 0 } };
  amostras.forEach((a, i) => {
    const p = probs.subarray(i * K, (i + 1) * K);
    let m = 0; for (let k = 1; k < K; k++) if (p[k] > p[m]) m = k;
    matriz[a.k][m]++;
    let pOk = 0; for (let k = 0; k < K; k++) if (aceitavel[k]) pOk += p[k];
    const pNok = 1 - pOk;
    const real = aceitavel[a.k] ? 'boa' : 'def';
    if (real === 'def') { defTot++; if (!aceitavel[m]) defRuim++; } else { boaTot++; if (aceitavel[m]) boaAprov++; }
    // decisão do app (limite 70% para os dois lados) e decisão assimétrica (RUIM ≥ 50%, BOA ≥ 80%)
    for (const [nome, limRuim, limBoa] of [['sim', 0.7, 0.7], ['assim', 0.5, 0.8]]) {
      const d = pNok >= limRuim ? 'ruim' : pOk >= limBoa ? 'boa' : 'inc';
      dec[nome][d]++;
      if (real === 'def' && d === 'boa') dec[nome].defBoa++;
      if (real === 'boa' && d === 'ruim') dec[nome].boaRuim++;
    }
  });
  const acerto = matriz.reduce((s, l, i) => s + l[i], 0) / amostras.length;
  const porClasse = matriz.map((l, i) => l[i] / Math.max(1, l.reduce((s, x) => s + x, 0)));
  return {
    acerto, porClasse, matriz,
    defeitosRuim: defRuim / defTot, boasAprov: boaAprov / boaTot,
    defBoaSim: dec.sim.defBoa / defTot, incSim: dec.sim.inc / amostras.length,
    defBoaAssim: dec.assim.defBoa / defTot, incAssim: dec.assim.inc / amostras.length, boaRuimAssim: dec.assim.boaRuim / boaTot,
  };
}

function mediaDe(lista, chave) {
  const v = lista.map((m) => (typeof chave === 'function' ? chave(m) : m[chave]));
  const mu = v.reduce((s, x) => s + x, 0) / v.length;
  const dp = Math.sqrt(v.reduce((s, x) => s + (x - mu) ** 2, 0) / v.length);
  return { mu, dp };
}

async function main() {
  const params = new URLSearchParams(location.search);
  const arquivo = params.get('arquivo');
  const basesPedidas = (params.get('bases') || 'solda-mobilenet-v1,geral-mobilenet-v1').split(',');
  if (!arquivo) { estado.textContent = 'Passe ?arquivo=nome.json'; return; }
  const resultado = { pronto: false, linhas: [] };
  window.resultadoBench = resultado;
  try {
    estado.textContent = 'Lendo arquivo…';
    const dados = await (await fetch(`../${encodeURIComponent(arquivo)}`)).json();
    const norma = await Norma.carregar('../norma/aws-d1.1.json');
    const cont = {};
    for (const f of dados.fotos) cont[f.classeId] = (cont[f.classeId] || 0) + 1;
    const classes = dados.classes.filter((c) => (cont[c.id] || 0) >= MIN_FOTOS);
    const K = classes.length;
    const kDe = new Map(classes.map((c, k) => [c.id, k]));
    const aceitavel = classes.map((c) => norma.ehAceitavel(c.criterio));
    const fotos = dados.fotos.filter((f) => kDe.has(f.classeId));
    info(`${fotos.length} fotos em ${K} classes: ${classes.map((c) => `${c.nome} (${cont[c.id]})`).join(', ')}`);
    resultado.classes = classes.map((c) => c.nome);

    const motor = new Motor();
    info(`Backend: ${await motor.iniciarBackend()}`);
    const { bases } = await (await fetch('../models/bases.json')).json();
    const imagens = [];
    for (const [i, f] of fotos.entries()) {
      imagens.push(await decodificar(f.jpeg));
      if (i % 50 === 0) estado.textContent = `Decodificando fotos ${i}/${fotos.length}`;
    }

    for (const baseId of basesPedidas) {
      const b = bases.find((x) => x.id === baseId);
      if (!b) continue;
      await motor.carregarBase({ ...b, url: `../${b.url}` });
      const C = motor.canais;
      const amostras = [];
      let t = performance.now();
      for (const [i, f] of fotos.entries()) {
        const ft = await extrair(motor, imagens[i]);
        amostras.push({ k: kDe.get(f.classeId), t: f.criadoEm, ...ft });
        if (i % 20 === 0) estado.textContent = `${b.nome}: características ${i}/${fotos.length}`;
      }
      info(`${b.nome}: características de ${fotos.length} fotos × ${AUMENTOS.length} aumentos em ${((performance.now() - t) / 1000).toFixed(0)} s`);

      const modos = [
        { id: 'foto', nome: 'Por foto (como o app hoje)', g: Int32Array.from(amostras, (_, i) => i), variantes: ['A'], sementes: [1] },
        { id: 'rajada', nome: 'Por rajada (intervalo > 5 s)', g: grupos(amostras, 5), variantes: VARIANTES.map((v) => v.id), sementes: SEMENTES },
        { id: 'sessao', nome: 'Por sessão (intervalo > 30 s)', g: grupos(amostras, 30), variantes: VARIANTES.map((v) => v.id), sementes: SEMENTES },
      ];
      for (const modo of modos) {
        const nGrupos = new Set(modo.g).size;
        for (const vid of modo.variantes) {
          const variante = VARIANTES.find((v) => v.id === vid);
          const ms = [];
          let kfUsado = 0;
          for (const s of modo.sementes) {
            const { kf, dobra } = dobras(amostras, modo.g, K, s);
            kfUsado = kf;
            estado.textContent = `${b.nome} · ${modo.nome} · ${variante.nome} · repetição ${s}`;
            const probs = await validar(amostras, K, C, variante, dobra, kf, s);
            ms.push(metricas(amostras, probs, K, aceitavel));
          }
          const linha = {
            base: b.nome, modo: modo.nome, variante: variante.nome, grupos: nGrupos, kf: kfUsado, repeticoes: ms.length,
            acerto: mediaDe(ms, 'acerto'), defeitosRuim: mediaDe(ms, 'defeitosRuim'), boasAprov: mediaDe(ms, 'boasAprov'),
            porClasse: classes.map((_, k) => mediaDe(ms, (m) => m.porClasse[k]).mu),
            defBoaSim: mediaDe(ms, 'defBoaSim'), incSim: mediaDe(ms, 'incSim'),
            defBoaAssim: mediaDe(ms, 'defBoaAssim'), incAssim: mediaDe(ms, 'incAssim'), boaRuimAssim: mediaDe(ms, 'boaRuimAssim'),
            matriz: ms[0].matriz,
          };
          resultado.linhas.push(linha);
          info(`${b.nome} | ${modo.nome} | ${variante.nome}: acerto ${pct(linha.acerto.mu)} ±${pct(linha.acerto.dp)} · defeitos→RUIM ${pct(linha.defeitosRuim.mu)} · boas aprovadas ${pct(linha.boasAprov.mu)} · por classe ${linha.porClasse.map(pct).join(' / ')}`);
        }
      }
    }
    estado.textContent = '✅ Concluído';
  } catch (e) {
    console.error(e);
    estado.textContent = `❌ Erro: ${e.message}`;
    resultado.erro = e.message;
  } finally {
    resultado.pronto = true;
  }
}

main();
