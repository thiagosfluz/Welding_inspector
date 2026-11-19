// Autoteste do pipeline de IA (sem câmera): imagens sintéticas -> vetores -> treino -> previsão
// -> norma -> exportar/importar. Abra tests/selftest.html pelo servidor local.
import * as store from '../js/store.js';
import { Motor, treinarComValidacao, VARIANTES, agruparRajadas, dividirEmPartes } from '../js/model.js';
import { Norma, decidir } from '../js/norma.js';
import { canvasParaBlob, blobParaCanvas } from '../js/imaging.js';
import { exportar, lerArquivo, importar } from '../js/transfer.js';
import { soldaSintetica, soldaComPoros } from './sintetico.js';
import { medirFoto, avaliarPorosidade, piorJanela } from '../js/poros.js';

const log = document.getElementById('log');
const itens = [];
function registrar(tipo, texto) {
  itens.push({ tipo, texto });
  const li = document.createElement('li');
  li.className = tipo;
  li.textContent = texto;
  log.append(li);
  console.log(`[${tipo}] ${texto}`);
}
const ok = (cond, texto) => registrar(cond ? 'ok' : 'falha', texto);
const info = (texto) => registrar('info', texto);

async function main() {
  const t0 = performance.now();
  const nomesBanco = [`inspetor-solda-teste-a-${Date.now()}`, `inspetor-solda-teste-b-${Date.now()}`];
  try {
    store.usarBanco(nomesBanco[0]);
    const motor = new Motor();
    const backend = await motor.iniciarBackend();
    info(`Backend do TensorFlow.js: ${backend}`);
    const { bases } = await (await fetch('../models/bases.json')).json();
    const base = { ...bases[0], url: `../${bases[0].url}` };
    let t = performance.now();
    await motor.carregarBase(base);
    info(`Base “${base.nome}” carregada em ${((performance.now() - t) / 1000).toFixed(1)} s; mapa de saída com ${motor.canais} canais`);
    ok(motor.canais === 1024, 'Base geral entrega 1024 características por posição');

    const norma = await Norma.carregar('../norma/aws-d1.1.json');
    const tipos = [
      { nome: 'Boa', criterio: 'aceitavel', tipo: 'boa' },
      { nome: 'Porosidade', criterio: 'porosidade', tipo: 'porosidade' },
      { nome: 'Trinca', criterio: 'trinca', tipo: 'trinca' },
    ];
    const classes = [];
    for (const [i, tp] of tipos.entries()) {
      const c = { id: store.novoId(), nome: tp.nome, criterio: tp.criterio, cor: '#888', ordem: i };
      await store.salvarClasse(c);
      classes.push({ ...c, tipo: tp.tipo });
    }

    const POR_CLASSE = 14;
    const amostras = [];
    const vitrine = document.getElementById('amostras');
    t = performance.now();
    for (const [k, c] of classes.entries()) {
      for (let j = 0; j < POR_CLASSE; j++) {
        const canvas = soldaSintetica(c.tipo, k * 1000 + j + 1);
        if (j < 3) vitrine.append(canvas);
        const blob = await canvasParaBlob(canvas, 0.9);
        const foto = { id: store.novoId(), classeId: c.id, blob, criadoEm: Date.now(), origem: 'arquivo' };
        await store.salvarFoto(foto);
        const vet = await motor.vetores(await blobParaCanvas(blob, 224));
        await store.salvarVetor(base.id, foto.id, vet);
        amostras.push({ fotoId: foto.id, k, vet });
      }
    }
    const nFotos = classes.length * POR_CLASSE;
    info(`${nFotos} fotos processadas em ${((performance.now() - t) / 1000).toFixed(1)} s (${((performance.now() - t) / nFotos).toFixed(0)} ms por foto com ${VARIANTES.length} variações)`);
    ok(amostras.every((a) => a.vet.length === VARIANTES.length * motor.canais), 'Vetores com o tamanho esperado');

    t = performance.now();
    const res = await treinarComValidacao(amostras, classes.length, motor.canais, () => {});
    info(`Treino com validação cruzada (${res.metricas.kf} partes) em ${((performance.now() - t) / 1000).toFixed(1)} s`);
    ok(res.metricas.acerto >= 0.85, `Acerto na validação cruzada: ${(res.metricas.acerto * 100).toFixed(0)}% (esperado ≥ 85%)`);
    info(`Matriz de confusão: ${JSON.stringify(res.metricas.matriz)}`);

    const modelo = {
      baseId: base.id, C: motor.canais, classeIds: classes.map((c) => c.id),
      classes: classes.map(({ id, nome, criterio, cor }) => ({ id, nome, criterio, cor })),
      W: res.W, b: res.b, treinadoEm: Date.now(), versaoDados: await store.versaoDados(), metricas: res.metricas,
    };
    motor.definirCabeca(modelo);

    // Imagens novas (sementes diferentes) — o modelo nunca viu.
    let acertos = 0, total = 0, camOk = true, tempos = [];
    for (const [k, c] of classes.entries()) {
      for (let j = 0; j < 6; j++) {
        const canvas = soldaSintetica(c.tipo, 50000 + k * 100 + j);
        const tp = performance.now();
        const r = await motor.prever(canvas);
        tempos.push(performance.now() - tp);
        let melhor = 0;
        for (let i = 1; i < r.K; i++) if (r.probs[i] > r.probs[melhor]) melhor = i;
        if (melhor === k) acertos++;
        total++;
        if (r.cam.length !== r.h * r.w * r.K) camOk = false;
        const soma = r.probs.reduce((s, x) => s + x, 0);
        if (Math.abs(soma - 1) > 1e-3) camOk = false;
      }
    }
    ok(acertos / total >= 0.8, `Acerto em imagens novas: ${acertos}/${total}`);
    ok(camOk, 'Probabilidades somam 100% e o mapa de calor tem 7×7 posições por classe');
    info(`Tempo médio de uma análise: ${(tempos.reduce((s, x) => s + x, 0) / tempos.length).toFixed(0)} ms`);

    // ---- norma ----
    const p = norma.parametrosPadrao();
    ok(norma.resolver('trinca', p).acao === 'reprovar', 'Norma: trinca → REPROVAR');
    ok(norma.resolver('porosidade', p).acao === 'medir', 'Norma: porosidade em filete estático → MEDIR');
    ok(norma.resolver('porosidade', { ...p, junta: 'cjp_transversal' }).acao === 'reprovar', 'Norma: porosidade em CJP transversal à tração → REPROVAR');
    ok(/0,25 mm/.test(norma.resolver('mordedura', { ...p, carregamento: 'ciclico' }).texto), 'Norma: mordedura em estrutura cíclica mostra limite de 0,25 mm');
    ok(/2 mm/.test(norma.resolver('mordedura', { ...p, espessura: 'maior25' }).texto), 'Norma: mordedura em material ≥ 25 mm mostra limite de 2 mm');
    const cl = modelo.classes;
    ok(decidir([0.1, 0.45, 0.45], cl, norma, 0.7).tipo === 'ruim', 'Decisão: 45% poro + 45% trinca → RUIM (soma dos defeitos)');
    ok(decidir([0.9, 0.05, 0.05], cl, norma, 0.7).tipo === 'boa', 'Decisão: 90% boa → BOA');
    ok(decidir([0.5, 0.3, 0.2], cl, norma, 0.7).tipo === 'incerto', 'Decisão: 50% boa / 50% defeito → INCERTO');

    // ---- validação por rajada ----
    testarRajadas();

    // ---- medição de poros (aba Medir) ----
    testarMedicaoPoros(norma, p);

    // ---- exportar / importar ----
    const fakeApp = {
      modelo, config: { limite: 0.7, som: true, vibrar: true, calor: true, norma: p },
      async definirModelo(m) { this.modelo = m; if (m) await store.gravarMeta('modelo', m); },
      async salvarConfig(c) { Object.assign(this.config, c); },
      async recarregarDados() {},
    };
    const arquivo = await exportar(fakeApp);
    info(`Arquivo exportado: ${(arquivo.size / 1e6).toFixed(2)} MB`);
    store.usarBanco(nomesBanco[1]);
    const destino = { ...fakeApp, modelo: null, config: { ...fakeApp.config } };
    const dados = await lerArquivo(arquivo);
    const r = await importar(destino, dados, 'substituir');
    ok(r.novas === nFotos && r.modeloImportado, `Importação: ${r.novas} fotos e modelo`);
    const iguais = destino.modelo.W.length === modelo.W.length && destino.modelo.W.every((v, i) => v === modelo.W[i]);
    ok(iguais, 'Pesos do modelo idênticos após exportar → importar');
    ok((await store.listarClasses()).length === 3, 'Classes importadas');

    const finalOk = itens.every((i) => i.tipo !== 'falha');
    document.getElementById('final').textContent = finalOk ? '✅ TODOS OS TESTES PASSARAM' : '❌ HÁ FALHAS';
    info(`Tempo total: ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  } catch (e) {
    console.error(e);
    registrar('falha', `Erro: ${e.message}`);
    document.getElementById('final').textContent = '❌ ERRO';
  } finally {
    store.usarBanco('inspetor-solda');
    for (const n of nomesBanco) indexedDB.deleteDatabase(n);
    window.resultadoTeste = { ok: itens.every((i) => i.tipo !== 'falha'), itens };
  }
}

function testarRajadas() {
  // classe 0: 3 rajadas (0–0,9 s; 60 s; 200 s); classe 1: 4 rajadas; classe 2: uma rajada só
  const t = (s) => 1e12 + s * 1000;
  const amostras = [
    ...[0, 0.3, 0.6, 0.9, 60, 60.4, 200, 200.3].map((s) => ({ k: 0, t: t(s) })),
    ...[0, 10, 10.2, 30, 30.1, 30.2, 90].map((s) => ({ k: 1, t: t(s) })),
    ...[0, 0.4, 0.8, 1.2, 1.6, 2.0].map((s) => ({ k: 2, t: t(s) })),
  ];
  const g = agruparRajadas(amostras);
  const nGrupos = (k) => new Set(amostras.map((a, i) => (a.k === k ? g[i] : null)).filter((x) => x !== null)).size;
  ok(nGrupos(0) === 3 && nGrupos(1) === 4 && nGrupos(2) === 1, `Rajadas detectadas pelo intervalo de 5 s: ${nGrupos(0)}, ${nGrupos(1)}, ${nGrupos(2)} (esperado 3, 4, 1)`);
  const { dobra, kf, umaRajada } = dividirEmPartes(amostras, 3, g);
  const inteiras = [...new Set(g)].every((gid) => {
    const idx = amostras.map((a, i) => i).filter((i) => g[i] === gid && amostras[i].k !== 2);
    return new Set(idx.map((i) => dobra[i])).size <= 1;
  });
  ok(kf === 3, `Número de partes limitado pela classe com menos rajadas: ${kf} (esperado 3)`);
  ok(inteiras, 'Cada rajada fica inteira numa única parte (sem foto “gêmea” no treino e no teste)');
  ok(umaRajada.length === 1 && umaRajada[0] === 2, 'Classe com uma única rajada é sinalizada');
  const semHora = dividirEmPartes(amostras.map((a) => ({ k: a.k })), 3, agruparRajadas(amostras.map((a) => ({ k: a.k }))));
  ok(semHora.umaRajada.length === 0 && semHora.kf === 5, 'Sem horário nas fotos: divisão foto a foto, como antes');
}

function testarMedicaoPoros(norma, p) {
  const vitrine = document.getElementById('amostras');
  const esperados = [
    { posMm: 8, diamMm: 1.5, desvioMm: 1 },
    { posMm: 24, diamMm: 2.0, desvioMm: -1.5 },
    { posMm: 41, diamMm: 1.2, desvioMm: 0 },
    { posMm: 60, diamMm: 2.5, desvioMm: 2 },
    { posMm: 72, diamMm: 0.8, desvioMm: -1 },
  ];
  const medir = (s) => medirFoto(s.canvas, s.p1, s.p2, s.larguraMm * s.pxPorMm, s.pxPorMm);
  let primeira = null;
  for (const [i, ppm] of [12, 8, 30].entries()) {
    const s = soldaComPoros({ pxPorMm: ppm, poros: esperados, semente: 3 + i });
    if (i === 0) { s.canvas.style.width = '100%'; s.canvas.style.height = 'auto'; vitrine.append(s.canvas); }
    const t = performance.now();
    const m = medir(s);
    if (i === 0) primeira = m;
    const tempo = performance.now() - t;
    ok(m.poros.length === esperados.length, `Poros a ${ppm} px/mm: encontrou ${m.poros.length} de ${esperados.length} (${tempo.toFixed(0)} ms)`);
    let pior = 0, txt = [];
    for (const e of esperados) {
      const d = m.poros.reduce((melhor, q) => (Math.abs(q.posMm - e.posMm) < Math.abs(melhor.posMm - e.posMm) ? q : melhor), { posMm: Infinity, diamMm: 0 });
      const tol = Math.max(0.15 * e.diamMm, 1.5 / ppm);
      pior = Math.max(pior, Math.abs(d.diamMm - e.diamMm) / tol);
      txt.push(`${e.diamMm}→${d.diamMm.toFixed(2)}`);
    }
    ok(pior <= 1, `Diâmetros a ${ppm} px/mm dentro da tolerância (±15%): ${txt.join(', ')} mm`);
  }
  const limpo = medir(soldaComPoros({ pxPorMm: 12, poros: [], semente: 9 }));
  ok(limpo.poros.length === 0, `Cordão sem poros: ${limpo.poros.length} falso(s) poro(s)`);

  const lim = norma.criterio('porosidade').medicao;
  ok(lim?.estatico?.somaMaxMm === 10 && lim?.ciclico?.diametroMaxMm === 2.5, 'Norma traz os limites numéricos da medição de poros');
  const av = avaliarPorosidade(primeira.poros, primeira.comprimentoMm, p, lim);
  ok(av.dentro && av.contados.length === 4, `Estático: poros espaçados → DENTRO (${av.contados.length} poros ≥ 1 mm contam; o de 0,8 mm não)`);
  const grupo = medir(soldaComPoros({ pxPorMm: 12, semente: 21,
    poros: [30, 34, 38, 42, 46].map((x, j) => ({ posMm: x, diamMm: 2.5, desvioMm: j % 2 ? 1.5 : -1.5 })) }));
  const avg = avaliarPorosidade(grupo.poros, grupo.comprimentoMm, p, lim);
  ok(!avg.dentro, `Estático: 5 poros de 2,5 mm em 16 mm → FORA (${avg.itens[0].valor} em 25 mm)`);
  grupo.poros.slice(0, 2).forEach((q) => { q.ignorado = true; });
  ok(avaliarPorosidade(grupo.poros, grupo.comprimentoMm, p, lim).dentro, 'Poros ignorados à mão saem da soma (3 × 2,5 mm → DENTRO)');
  ok(!avaliarPorosidade(primeira.poros, primeira.comprimentoMm, { ...p, carregamento: 'ciclico' }, lim).dentro, 'Cíclico: mais de 1 poro em 100 mm → FORA');
  ok(avaliarPorosidade([{ posMm: 10, diamMm: 2 }], 80, { ...p, carregamento: 'ciclico' }, lim).dentro, 'Cíclico: 1 poro de 2 mm → DENTRO');
  ok(!avaliarPorosidade([{ posMm: 10, diamMm: 3 }], 80, { ...p, carregamento: 'ciclico' }, lim).dentro, 'Cíclico: poro de 3 mm (> 2,5 mm) → FORA');
  ok(!avaliarPorosidade([{ posMm: 10, diamMm: 1 }], 80, { ...p, junta: 'cjp_transversal' }, lim).dentro, 'CJP transversal: qualquer poro → FORA');
  ok(avaliarPorosidade([], 80, p, lim).dentro, 'Sem poros → DENTRO');
  const pj = piorJanela([{ posMm: 0, diamMm: 4 }, { posMm: 20, diamMm: 4 }, { posMm: 30, diamMm: 4 }, { posMm: 60, diamMm: 1 }], 25);
  ok(Math.abs(pj.soma - 8) < 1e-9, `Janela deslizante de 25 mm: pior soma ${pj.soma} mm (esperado 8)`);
}

main();
