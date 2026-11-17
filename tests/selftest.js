// Autoteste do pipeline de IA (sem câmera): imagens sintéticas -> vetores -> treino -> previsão
// -> norma -> exportar/importar. Abra tests/selftest.html pelo servidor local.
import * as store from '../js/store.js';
import { Motor, treinarComValidacao, VARIANTES } from '../js/model.js';
import { Norma, decidir } from '../js/norma.js';
import { canvasParaBlob, blobParaCanvas } from '../js/imaging.js';
import { exportar, lerArquivo, importar } from '../js/transfer.js';
import { soldaSintetica } from './sintetico.js';

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

main();
