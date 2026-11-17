// Aba "Inspecionar": câmera ao vivo -> IA -> BOA / RUIM / INCERTO + critério da norma.
import { desenharQuadrado, novoCanvas, arquivoParaQuadrado, canvasParaBlob, TAM_FOTO, RECORTE_CAMERA } from './imaging.js';
import { decidir } from './norma.js';
import { $, el, toast, abrirModal, fecharModal, pct } from './ui.js';
import * as store from './store.js';

let app;
let visor, calor, msg;
const quadro = novoCanvas(TAM_FOTO);     // último quadro analisado (para correção)
let entrada = null;                        // canvas no tamanho de entrada da IA
const est = {
  cameraLigada: false,
  queroCamera: false,
  congelado: false,
  suave: null,
  ultimoTipo: null,
  estavel: 0,
  alertado: false,
  tempos: [],
};
let audio = null;

export function iniciar(a) {
  app = a;
  visor = $('#visor-canvas');
  calor = $('#visor-calor');
  msg = $('#visor-msg');

  $('#btn-camera').addEventListener('click', () => (est.cameraLigada ? desligarCamera(true) : ligarCamera()));
  $('#btn-congelar').addEventListener('click', alternarCongelar);
  $('#btn-errado').addEventListener('click', corrigir);
  $('#btn-trocar-cam').addEventListener('click', async () => {
    try {
      if (!(await app.camera.trocar())) toast('Só há uma câmera neste aparelho');
      atualizarLanterna();
    } catch (e) { toast(e.message, 5000); }
  });
  $('#btn-lanterna').addEventListener('click', async () => {
    const on = await app.camera.alternarLanterna();
    $('#btn-lanterna').classList.toggle('ligado', on);
  });
  $('#input-analisar').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) await analisarArquivo(f);
  });
  $('#btn-params-norma').addEventListener('click', () => app.irPara('modelo'));

  app.on('modelo', () => { limparResultado(); desenharBarras(null); });
  app.on('config', atualizarParams);
  app.on('pronto', atualizarParams);
  app.on('dados', () => { if (!est.congelado) desenharBarras(null); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && est.cameraLigada && app.abaAtual === 'inspecionar') desligarCamera(false);
    else if (!document.hidden && est.queroCamera && app.abaAtual === 'inspecionar') ligarCamera();
  });
  atualizarParams();
  limparResultado();
  limparVisor('Toque em “Ligar câmera” e aponte para a solda');
}

export function mostrar() {
  if (est.queroCamera && !est.cameraLigada) ligarCamera();
}
export function ocultar() {
  if (est.cameraLigada) desligarCamera(false);
}

function atualizarParams() {
  if (!app.norma) return;
  $('#btn-params-norma').textContent =
    `Norma: ${app.norma.resumoParametros(app.config.norma)} · limite ${pct(app.config.limite)} ✎`;
}

function limparVisor(texto) {
  const ctx = visor.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, visor.width, visor.height);
  calor.getContext('2d').clearRect(0, 0, calor.width, calor.height);
  msg.textContent = texto || '';
}

// ---------------- câmera ----------------
async function ligarCamera() {
  prepararAudio();
  est.queroCamera = true;
  msg.textContent = 'Abrindo câmera…';
  try {
    await app.camera.ligar();
  } catch (e) {
    est.queroCamera = false;
    limparVisor(e.message);
    toast(e.message, 6000);
    return;
  }
  est.cameraLigada = true;
  est.congelado = false;
  est.suave = null;
  msg.textContent = '';
  $('#btn-camera').textContent = '⏹ Desligar câmera';
  $('#btn-congelar').disabled = false;
  $('#btn-congelar').textContent = '⏸ Congelar';
  $('#btn-errado').disabled = false;
  atualizarLanterna();
  requestAnimationFrame(laçoVisor);
  laçoIA();
}

function desligarCamera(peloUsuario) {
  if (peloUsuario) est.queroCamera = false;
  est.cameraLigada = false;
  app.camera.desligar();
  $('#btn-camera').textContent = '📷 Ligar câmera';
  $('#btn-lanterna').hidden = true;
  $('#visor-fps').textContent = '';
  if (!est.congelado) {
    $('#btn-congelar').disabled = true;
    $('#btn-errado').disabled = true;
    limparVisor('Câmera desligada');
    limparResultado();
  }
}

function atualizarLanterna() {
  const tem = app.camera.temLanterna();
  $('#btn-lanterna').hidden = !tem;
  $('#btn-lanterna').classList.remove('ligado');
}

function laçoVisor() {
  if (!est.cameraLigada) return;
  if (!est.congelado && app.camera.ativa) {
    desenharQuadrado(app.camera.video, app.camera.largura, app.camera.altura, visor, RECORTE_CAMERA);
  }
  requestAnimationFrame(laçoVisor);
}

async function laçoIA() {
  while (est.cameraLigada) {
    const podeAnalisar = !est.congelado && app.camera.ativa && app.motor.temCabeca && !document.hidden;
    if (!podeAnalisar) {
      if (!app.motor.temCabeca && !est.congelado) mostrarSemModelo();
      await new Promise((r) => setTimeout(r, 250));
      continue;
    }
    const t0 = performance.now();
    try {
      const L = app.motor.baseInfo.entrada;
      if (!entrada || entrada.width !== L) entrada = novoCanvas(L);
      desenharQuadrado(app.camera.video, app.camera.largura, app.camera.altura, entrada, RECORTE_CAMERA);
      const r = await app.motor.prever(entrada);
      if (!est.congelado && est.cameraLigada) {
        desenharQuadrado(app.camera.video, app.camera.largura, app.camera.altura, quadro, RECORTE_CAMERA);
        mostrarResultado(r, true);
      }
    } catch (e) {
      console.error(e);
      await new Promise((r) => setTimeout(r, 500));
    }
    est.tempos.push(performance.now() - t0);
    if (est.tempos.length > 10) est.tempos.shift();
    const media = est.tempos.reduce((s, x) => s + x, 0) / est.tempos.length;
    $('#visor-fps').textContent = `${(1000 / media).toFixed(1)} análises/s`;
    await new Promise((r) => setTimeout(r, 0)); // cede a vez ao navegador entre análises
  }
}

// ---------------- congelar / analisar foto ----------------
async function alternarCongelar() {
  if (est.congelado) {
    est.congelado = false;
    est.suave = null;
    $('#btn-congelar').textContent = '⏸ Congelar';
    if (!est.cameraLigada) {
      if (est.queroCamera) await ligarCamera();
      else { $('#btn-congelar').disabled = true; $('#btn-errado').disabled = true; limparVisor('Câmera desligada'); limparResultado(); }
    }
    return;
  }
  est.congelado = true;
  $('#btn-congelar').textContent = '▶ Continuar';
  if (app.camera.ativa) {
    desenharQuadrado(app.camera.video, app.camera.largura, app.camera.altura, quadro, RECORTE_CAMERA);
    visor.getContext('2d').drawImage(quadro, 0, 0, visor.width, visor.height);
    if (app.motor.temCabeca) mostrarResultado(await app.motor.prever(quadro), false);
  }
}

async function analisarArquivo(arquivo) {
  if (!app.motor.pronto) { toast('A IA ainda está carregando'); return; }
  try {
    const c = await arquivoParaQuadrado(arquivo, TAM_FOTO);
    quadro.getContext('2d').drawImage(c, 0, 0);
    est.congelado = true;
    msg.textContent = '';
    visor.getContext('2d').drawImage(quadro, 0, 0, visor.width, visor.height);
    $('#btn-congelar').disabled = false;
    $('#btn-congelar').textContent = '▶ Continuar';
    $('#btn-errado').disabled = false;
    if (!app.motor.temCabeca) { mostrarSemModelo(); return; }
    prepararAudio();
    mostrarResultado(await app.motor.prever(quadro), false);
  } catch (e) {
    console.error(e);
    toast(`Não foi possível abrir a imagem: ${e.message}`, 5000);
  }
}

// ---------------- resultado ----------------
function mostrarSemModelo() {
  const r = $('#resultado');
  r.className = 'resultado neutro';
  $('#res-titulo').textContent = 'SEM MODELO';
  $('#res-sub').textContent = app.modelo
    ? 'O modelo foi treinado com outra base de IA. Treine de novo na aba Treinar.'
    : 'Vá na aba Treinar, fotografe as classes e toque em “Treinar modelo”.';
  $('#res-conf-barra').style.width = '0';
  $('#norma-box').hidden = true;
}

function limparResultado() {
  est.suave = null; est.ultimoTipo = null; est.estavel = 0; est.alertado = false;
  if (!app?.motor?.temCabeca) { mostrarSemModelo(); return; }
  $('#resultado').className = 'resultado neutro';
  $('#res-titulo').textContent = '—';
  $('#res-sub').textContent = 'Aponte a câmera para a solda dentro do quadro';
  $('#res-conf-barra').style.width = '0';
  $('#norma-box').hidden = true;
  calor.getContext('2d').clearRect(0, 0, calor.width, calor.height);
}

export function mostrarResultado({ probs, cam, h, w, K }, aoVivo) {
  // Média móvel nas análises ao vivo para o resultado não ficar "piscando".
  if (aoVivo && est.suave && est.suave.length === probs.length) {
    for (let i = 0; i < probs.length; i++) est.suave[i] = 0.55 * est.suave[i] + 0.45 * probs[i];
  } else {
    est.suave = Float32Array.from(probs);
  }
  const p = est.suave;
  const classes = app.classesDoModelo();
  const d = decidir(p, classes, app.norma, app.config.limite);
  const classe = classes[d.indice];

  const r = $('#resultado');
  r.className = `resultado ${d.tipo}`;
  if (d.tipo === 'boa') {
    $('#res-titulo').textContent = '✔ SOLDA BOA';
    $('#res-sub').textContent = `Confiança ${pct(d.confianca)}`;
  } else if (d.tipo === 'ruim') {
    $('#res-titulo').textContent = '✖ SOLDA RUIM';
    $('#res-sub').textContent = `${classe.nome} · confiança ${pct(d.confianca)}`;
  } else {
    $('#res-titulo').textContent = '? INCERTO';
    $('#res-sub').textContent = `Reposicione a câmera ou chame o inspetor (confiança ${pct(d.confianca)})`;
  }
  $('#res-conf-barra').style.width = pct(d.confianca);

  // Critério da norma para a classe detectada.
  const box = $('#norma-box');
  if (d.tipo === 'incerto' || !classe) {
    box.hidden = true;
  } else {
    const n = app.norma.resolver(classe.criterio, app.config.norma);
    box.hidden = false;
    box.className = `norma-box ${n.acao}`;
    const chip = $('#norma-chip');
    chip.className = `chip ${n.acao}`;
    chip.textContent = `${n.rotulo} — ${n.nome}`;
    $('#norma-ref').textContent = 'AWS D1.1';
    $('#norma-texto').textContent = n.texto;
    $('#norma-como').textContent = n.como ? `Como verificar: ${n.como}` : '';
  }

  desenharBarras(p, classes);
  if (app.config.calor && d.tipo === 'ruim') desenharCalor(cam, h, w, K, d.indice);
  else calor.getContext('2d').clearRect(0, 0, calor.width, calor.height);

  // Alerta (bipe/vibração) quando o resultado RUIM fica estável.
  if (d.tipo === est.ultimoTipo) est.estavel++;
  else { est.ultimoTipo = d.tipo; est.estavel = 1; est.alertado = false; }
  if (d.tipo === 'ruim' && !est.alertado && (!aoVivo || est.estavel >= 3)) {
    est.alertado = true;
    alertar();
  }
}

function desenharBarras(p, classes = app?.classesDoModelo?.() || []) {
  const box = $('#barras-classes');
  if (!classes.length) {
    box.replaceChildren(el('p', { class: 'dica' }, 'Treine o modelo para ver as classes.'));
    return;
  }
  box.replaceChildren(...classes.map((c, i) => el('div', { class: 'barra-linha' },
    el('span', { class: 'barra-nome', title: c.nome }, c.nome),
    el('div', { class: 'barra-fundo' }, el('div', { style: { width: p ? pct(p[i]) : '0', background: c.cor || '#888' } })),
    el('span', { class: 'barra-valor' }, p ? pct(p[i]) : '—'))));
}

const pequeno = document.createElement('canvas');
function desenharCalor(cam, h, w, K, k) {
  const ctx = calor.getContext('2d');
  ctx.clearRect(0, 0, calor.width, calor.height);
  let min = Infinity, max = -Infinity;
  const v = new Float32Array(h * w);
  // Contraste: quanto cada região "puxa" para o defeito em relação às outras classes.
  for (let i = 0; i < h * w; i++) {
    let outras = 0;
    for (let j = 0; j < K; j++) if (j !== k) outras += cam[i * K + j];
    v[i] = cam[i * K + k] - (K > 1 ? outras / (K - 1) : 0);
    if (v[i] < min) min = v[i];
    if (v[i] > max) max = v[i];
  }
  if (!(max > min)) return;
  pequeno.width = w; pequeno.height = h;
  const pc = pequeno.getContext('2d');
  const img = pc.createImageData(w, h);
  for (let i = 0; i < h * w; i++) {
    const n = (v[i] - min) / (max - min);
    const a = Math.max(0, Math.min(1, (n - 0.45) / 0.55));
    img.data[i * 4] = 255;
    img.data[i * 4 + 1] = Math.round(220 * (1 - n));
    img.data[i * 4 + 2] = 0;
    img.data[i * 4 + 3] = Math.round(a * 175);
  }
  pc.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(pequeno, 0, 0, calor.width, calor.height);
}

function prepararAudio() {
  if (audio || !app.config.som) return;
  try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch { audio = null; }
}

function alertar() {
  if (app.config.vibrar && navigator.vibrate) navigator.vibrate([180, 80, 180]);
  if (app.config.som) {
    prepararAudio();
    if (!audio) return;
    if (audio.state === 'suspended') audio.resume();
    const t = audio.currentTime;
    [0, 0.22].forEach((dt) => {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, t + dt);
      g.gain.exponentialRampToValueAtTime(0.25, t + dt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.16);
      o.connect(g).connect(audio.destination);
      o.start(t + dt);
      o.stop(t + dt + 0.18);
    });
  }
}

// ---------------- correção pelo inspetor ----------------
async function corrigir() {
  if (!app.classes.length) return;
  const eraCongelado = est.congelado;
  if (!est.congelado) await alternarCongelar(); // congela para guardar exatamente esta imagem
  const img = el('img', { class: 'modal-foto', src: quadro.toDataURL('image/jpeg', 0.85), alt: 'Imagem analisada' });
  const lista = el('div', { class: 'acoes' }, app.classes.map((c) =>
    el('button', { class: 'btn', style: { borderLeft: `6px solid ${c.cor}` }, onclick: () => escolher(c) }, c.nome)));
  let escolhida = null;
  const escolher = (c) => { escolhida = c; fecharModal(c.id); };
  await abrirModal(el('div', {}, img, el('p', {}, 'Qual é a classe correta desta solda? A foto será adicionada ao treino.'), lista), {
    titulo: 'Corrigir resultado',
    botoes: [{ rotulo: 'Cancelar', valor: null }],
  });
  if (escolhida) {
    const blob = await canvasParaBlob(quadro, 0.9);
    await store.salvarFoto({ id: store.novoId(), classeId: escolhida.id, blob, criadoEm: Date.now(), origem: 'correcao' });
    await app.recarregarDados();
    toast(`Foto salva em “${escolhida.nome}”. Treine de novo para o modelo aprender.`, 4000);
  }
  if (!eraCongelado && est.congelado) await alternarCongelar();
}
