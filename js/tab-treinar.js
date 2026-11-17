// Aba "Treinar": classes, fotos (câmera ou arquivo), treino e qualidade do modelo.
import * as store from './store.js';
import { treinarComValidacao, VARIANTES } from './model.js';
import { desenharQuadrado, novoCanvas, canvasParaBlob, arquivoParaQuadrado, TAM_FOTO, RECORTE_CAMERA } from './imaging.js';
import { $, el, toast, abrirModal, fecharModal, confirmar, pct, dataHora } from './ui.js';
import { proximaCor } from './app.js';

export const MIN_FOTOS = 5;      // mínimo para a classe entrar no treino
export const REC_FOTOS = 20;     // recomendado
export const IDEAL_FOTOS = 50;   // ideal

let app;
let treinando = false;
const urls = new Map(); // fotoId -> objectURL das miniaturas

export function iniciar(a) {
  app = a;
  $('#btn-nova-classe').addEventListener('click', () => editarClasse(null));
  $('#btn-treinar').addEventListener('click', treinar);
  app.on('dados', () => { renderClasses(); renderAvisoTreino(); });
  app.on('modelo', () => { renderAvisoTreino(); renderQualidade(); });
  app.on('fila', renderFila);
  app.on('pronto', renderAvisoTreino);
  renderQualidade();
}

export function mostrar() { renderClasses(); }
export function ocultar() {}

function urlDe(foto) {
  if (!urls.has(foto.id)) urls.set(foto.id, URL.createObjectURL(foto.blob));
  return urls.get(foto.id);
}
function liberarUrl(id) {
  const u = urls.get(id);
  if (u) { URL.revokeObjectURL(u); urls.delete(id); }
}

function renderFila(f) {
  const box = $('#fila-status');
  if (f.rodando && f.total > 0) {
    box.hidden = false;
    box.textContent = `⏳ Preparando fotos para a IA: ${f.feitos}/${f.total}`;
  } else {
    box.hidden = true;
  }
}

// ---------------- lista de classes ----------------
async function renderClasses() {
  const lista = $('#lista-classes');
  const todas = await store.listarFotos();
  const porClasse = {};
  for (const f of todas) (porClasse[f.classeId] ||= []).push(f);
  const vivos = new Set(todas.map((f) => f.id));
  for (const id of [...urls.keys()]) if (!vivos.has(id)) liberarUrl(id);

  lista.replaceChildren(...app.classes.map((c) => {
    const fotos = (porClasse[c.id] || []).sort((a, b) => b.criadoEm - a.criadoEm);
    const n = fotos.length;
    const crit = app.norma ? app.norma.resolver(c.criterio, app.config.norma) : null;
    const meta = n >= IDEAL_FOTOS ? 'ideal atingido 👍' : n >= REC_FOTOS ? `bom · ideal ${IDEAL_FOTOS}` : `mínimo recomendado ${REC_FOTOS}`;
    return el('div', { class: 'classe', style: { '--cor': c.cor } },
      el('div', { class: 'classe-topo' },
        el('span', { class: 'classe-nome' }, c.nome),
        crit && el('span', { class: `chip ${crit.acao}`, title: crit.nome }, crit.rotulo),
        el('button', { class: 'btn btn-pequeno', onclick: () => editarClasse(c), 'aria-label': `Editar ${c.nome}` }, '✎ Editar')),
      el('div', { class: 'classe-meta' }, `${n} foto${n === 1 ? '' : 's'} · ${meta}${crit ? ` · norma: ${crit.nome}` : ''}`),
      el('div', { class: `meta-barra ${n >= REC_FOTOS ? 'ok' : ''}` }, el('div', { style: { width: `${Math.min(100, (n / IDEAL_FOTOS) * 100)}%` } })),
      el('div', { class: 'miniaturas' }, fotos.slice(0, 14).map((f) =>
        el('img', { src: urlDe(f), alt: '', loading: 'lazy', onclick: () => verFoto(f) }))),
      el('div', { class: 'acoes' },
        el('button', { class: 'btn btn-primario', onclick: () => fotografar(c) }, '📷 Fotografar'),
        el('label', { class: 'btn' }, '📁 Enviar fotos',
          el('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: (e) => enviarFotos(c, e.target) })),
        n > 14 && el('button', { class: 'btn', onclick: () => verTodas(c) }, `Ver todas (${n})`)));
  }));
}

function renderAvisoTreino() {
  const aviso = $('#treino-aviso');
  const prontas = app.classes.filter((c) => (app.contagens[c.id] || 0) >= MIN_FOTOS);
  const desatualizado = app.modeloDesatualizado();
  $('#badge-treinar').hidden = !desatualizado;
  $('#btn-treinar').disabled = treinando || prontas.length < 2 || !app.motor.pronto;
  if (!app.motor.pronto) aviso.textContent = 'Aguardando a IA carregar…';
  else if (prontas.length < 2) aviso.textContent = `Para treinar, pelo menos 2 classes precisam ter ${MIN_FOTOS} fotos ou mais.`;
  else if (!app.modelo) aviso.textContent = 'Tudo pronto para o primeiro treino.';
  else if (app.modelo.baseId !== app.config.baseId) aviso.textContent = 'A base da IA mudou: treine de novo.';
  else if (desatualizado) aviso.textContent = '⚠ Há fotos ou classes novas desde o último treino. Treine de novo para o modelo aprender.';
  else aviso.textContent = `Último treino: ${dataHora(app.modelo.treinadoEm)}.`;
}

// ---------------- editar / criar classe ----------------
async function editarClasse(classe) {
  const nova = !classe;
  const nome = el('input', { type: 'text', value: classe?.nome || '', placeholder: 'Ex.: Mordedura', maxlength: 40 });
  const sel = el('select', {}, app.norma.listaCriterios().map((c) =>
    el('option', { value: c.id, selected: (classe?.criterio || 'outro') === c.id }, `${c.nome} — ${app.norma.rotuloAcao(c.acao)}`)));
  sel.addEventListener('change', () => {
    if (!nome.value.trim()) nome.value = app.norma.criterio(sel.value).nome.split(' (')[0];
  });
  const n = classe ? app.contagens[classe.id] || 0 : 0;
  const corpo = el('div', { class: 'form' },
    el('label', {}, 'Nome da classe', nome),
    el('label', {}, 'Corresponde a qual item da norma?', sel),
    el('p', { class: 'dica' }, 'Isso define a ação mostrada na inspeção (APROVAR, REPROVAR, MEDIR…). Use “Solda boa (aceitável)” para as soldas certas do quadro.'),
    !nova && el('button', {
      class: 'btn btn-perigo', onclick: async () => {
        fecharModal('cancelar');
        if (await confirmar(`Excluir a classe “${classe.nome}” e suas ${n} fotos? Isso não pode ser desfeito.`, { sim: 'Excluir', perigo: true })) {
          await store.excluirClasse(classe.id);
          await app.recarregarDados();
          toast('Classe excluída');
        }
      },
    }, '🗑 Excluir classe'));
  const r = await abrirModal(corpo, {
    titulo: nova ? 'Nova classe' : 'Editar classe',
    botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Salvar', valor: 'salvar', classe: 'btn-primario' }],
  });
  if (r !== 'salvar') return;
  const nomeFinal = nome.value.trim() || app.norma.criterio(sel.value).nome;
  if (app.classes.some((c) => c.nome.toLowerCase() === nomeFinal.toLowerCase() && c.id !== classe?.id)) {
    toast('Já existe uma classe com esse nome');
    return;
  }
  const dados = classe
    ? { ...classe, nome: nomeFinal, criterio: sel.value }
    : { id: store.novoId(), nome: nomeFinal, criterio: sel.value, cor: proximaCor(), ordem: Date.now(), criadoEm: Date.now() };
  await store.salvarClasse(dados);
  await app.recarregarDados();
}

// ---------------- fotos ----------------
async function enviarFotos(classe, input) {
  const arquivos = [...input.files];
  input.value = '';
  if (!arquivos.length) return;
  let ok = 0;
  for (const [i, arq] of arquivos.entries()) {
    toast(`Importando fotos ${i + 1}/${arquivos.length}…`, 60000);
    try {
      const c = await arquivoParaQuadrado(arq, TAM_FOTO);
      const blob = await canvasParaBlob(c, 0.9);
      await store.salvarFoto({ id: store.novoId(), classeId: classe.id, blob, criadoEm: Date.now(), origem: 'arquivo' });
      ok++;
    } catch (e) {
      console.warn('Imagem ignorada', arq.name, e);
    }
  }
  toast(`${ok} foto(s) adicionada(s) em “${classe.nome}”${ok < arquivos.length ? ` · ${arquivos.length - ok} ignorada(s)` : ''}`);
  await app.recarregarDados();
}

async function fotografar(classe) {
  const visor = el('canvas', { width: 480, height: 480 });
  const caixa = el('div', { class: 'visor' }, visor, el('div', { class: 'guia' }));
  const contador = el('div', { class: 'dica' });
  let tiradas = 0;
  const base = app.contagens[classe.id] || 0;
  const atualizar = () => { contador.textContent = `${classe.nome}: ${base + tiradas} fotos (${tiradas} nesta sessão)`; };
  atualizar();
  let ativo = true;
  let rajada = false;

  const pendentes = [];
  const tirar = () => {
    if (!app.camera.ativa) return Promise.resolve();
    const c = novoCanvas(TAM_FOTO);
    desenharQuadrado(app.camera.video, app.camera.largura, app.camera.altura, c, RECORTE_CAMERA);
    caixa.classList.remove('flash'); void caixa.offsetWidth; caixa.classList.add('flash');
    const p = (async () => {
      const blob = await canvasParaBlob(c, 0.9);
      await store.salvarFoto({ id: store.novoId(), classeId: classe.id, blob, criadoEm: Date.now(), origem: 'camera' });
      tiradas++;
      atualizar();
    })();
    pendentes.push(p);
    return p;
  };
  const btnRajada = el('button', {
    class: 'btn', onclick: async () => {
      if (rajada) return;
      rajada = true;
      btnRajada.disabled = true;
      for (let i = 0; i < 10 && ativo; i++) { await tirar(); await new Promise((r) => setTimeout(r, 350)); }
      rajada = false;
      btnRajada.disabled = false;
    },
  }, 'Rajada ×10');

  const corpo = el('div', { style: { display: 'contents' } },
    el('div', { class: 'modal-titulo' }, `📷 Fotografar: ${classe.nome}`),
    el('p', { class: 'dica' }, 'Mantenha a solda dentro do quadro. Varie ângulo, distância, luz e peça. Na rajada, mova o celular devagar.'),
    el('div', { class: 'captura-visor' }, caixa),
    contador,
    el('div', { class: 'captura-barra' },
      el('button', { class: 'btn', onclick: () => fecharModal(null) }, 'Concluir'),
      el('button', { class: 'disparo', 'aria-label': 'Tirar foto', onclick: tirar }),
      btnRajada));

  const fechado = abrirModal(corpo, { botoes: [], telaCheia: true });
  try {
    await app.camera.ligar();
    const desenhar = () => {
      if (!ativo) return;
      if (app.camera.ativa) desenharQuadrado(app.camera.video, app.camera.largura, app.camera.altura, visor, RECORTE_CAMERA);
      requestAnimationFrame(desenhar);
    };
    desenhar();
  } catch (e) {
    toast(e.message, 6000);
    fecharModal(null);
  }
  await fechado;
  ativo = false;
  app.camera.desligar();
  await Promise.allSettled(pendentes);
  if (tiradas) {
    toast(`${tiradas} foto(s) salvas em “${classe.nome}”`);
    await app.recarregarDados();
  }
}

async function verFoto(foto, voltar) {
  const sel = el('select', {}, app.classes.map((c) => el('option', { value: c.id, selected: c.id === foto.classeId }, c.nome)));
  const classe = app.classes.find((c) => c.id === foto.classeId);
  const origens = { camera: 'câmera', arquivo: 'arquivo enviado', correcao: 'correção na inspeção', importacao: 'importação' };
  const corpo = el('div', {},
    el('img', { class: 'modal-foto', src: urlDe(foto), alt: '' }),
    el('p', { class: 'dica' }, `Classe: ${classe?.nome || '—'} · ${dataHora(foto.criadoEm)} · origem: ${origens[foto.origem] || foto.origem}`),
    el('div', { class: 'form' }, el('label', {}, 'Mover para a classe', sel)));
  const r = await abrirModal(corpo, {
    titulo: 'Foto de treino',
    botoes: [
      { rotulo: '🗑 Excluir', valor: 'excluir', classe: 'btn-perigo' },
      { rotulo: 'Fechar', valor: null },
      { rotulo: 'Salvar', valor: 'salvar', classe: 'btn-primario' },
    ],
  });
  if (r === 'excluir') {
    await store.excluirFoto(foto.id);
    liberarUrl(foto.id);
    toast('Foto excluída');
    await app.recarregarDados();
  } else if (r === 'salvar' && sel.value !== foto.classeId) {
    await store.moverFoto(foto.id, sel.value);
    toast('Foto movida');
    await app.recarregarDados();
  }
  if (voltar) voltar();
}

async function verTodas(classe) {
  const fotos = (await store.listarFotos(classe.id)).sort((a, b) => b.criadoEm - a.criadoEm);
  let escolhida = null;
  const grade = el('div', { class: 'grade' }, fotos.map((f) =>
    el('img', { src: urlDe(f), alt: '', loading: 'lazy', onclick: () => { escolhida = f; fecharModal('foto'); } })));
  const r = await abrirModal(grade, { titulo: `${classe.nome} — ${fotos.length} fotos` });
  if (r === 'foto' && escolhida) await verFoto(escolhida, () => verTodas(classe));
}

// ---------------- treino ----------------
function progresso(p, texto) {
  const box = $('#treino-progresso');
  box.hidden = false;
  box.firstElementChild.style.width = `${Math.round(p * 100)}%`;
  box.lastElementChild.textContent = `${texto} · ${Math.round(p * 100)}%`;
}

export async function treinar() {
  if (treinando) return;
  const elegiveis = app.classes.filter((c) => (app.contagens[c.id] || 0) >= MIN_FOTOS);
  if (elegiveis.length < 2) { toast(`Precisa de pelo menos 2 classes com ${MIN_FOTOS}+ fotos`); return; }
  const ignoradas = app.classes.filter((c) => !elegiveis.includes(c));
  treinando = true;
  renderAvisoTreino();
  const inicio = performance.now();
  try {
    const versao = await store.versaoDados();
    progresso(0, 'Preparando fotos');
    await app.aguardarFila();
    const base = app.motor.baseInfo;
    const C = app.motor.canais;
    const amostras = [];
    const porClasse = {};
    for (const [k, c] of elegiveis.entries()) {
      const fotos = await store.listarFotos(c.id);
      for (const f of fotos) {
        const vet = await store.obterVetor(base.id, f.id);
        if (vet && vet.length === C * VARIANTES.length) {
          amostras.push({ fotoId: f.id, k, vet });
          porClasse[c.id] = (porClasse[c.id] || 0) + 1;
        }
      }
    }
    const res = await treinarComValidacao(amostras, elegiveis.length, C, (p, etapa) => progresso(p, etapa));
    const modelo = {
      baseId: base.id,
      C,
      classeIds: elegiveis.map((c) => c.id),
      classes: elegiveis.map(({ id, nome, criterio, cor }) => ({ id, nome, criterio, cor })),
      W: res.W,
      b: res.b,
      treinadoEm: Date.now(),
      versaoDados: versao,
      duracaoSeg: (performance.now() - inicio) / 1000,
      metricas: { ...res.metricas, porClasse, ignoradas: ignoradas.map((c) => c.nome) },
    };
    await app.definirModelo(modelo);
    progresso(1, 'Concluído');
    toast(`Modelo treinado! Acerto na validação: ${pct(res.metricas.acerto)}`, 4000);
    $('#qualidade').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    console.error(e);
    toast(`Erro no treino: ${e.message}`, 8000);
  } finally {
    treinando = false;
    setTimeout(() => { $('#treino-progresso').hidden = true; }, 1500);
    renderAvisoTreino();
  }
}

// ---------------- qualidade do modelo ----------------
export function avaliar(modelo, norma) {
  const m = modelo.metricas;
  const K = modelo.classeIds.length;
  const ok = modelo.classes.map((c) => norma.ehAceitavel(c.criterio));
  let nokTotal = 0, nokPego = 0, okTotal = 0, okAprov = 0;
  for (let i = 0; i < K; i++) {
    for (let j = 0; j < K; j++) {
      const v = m.matriz[i][j];
      if (ok[i]) { okTotal += v; if (ok[j]) okAprov += v; } else { nokTotal += v; if (!ok[j]) nokPego += v; }
    }
  }
  return {
    defeitosPegos: nokTotal ? nokPego / nokTotal : null, nokPego, nokTotal,
    boasAprovadas: okTotal ? okAprov / okTotal : null, okAprov, okTotal,
  };
}

async function renderQualidade() {
  const box = $('#qualidade');
  const modelo = app.modelo;
  if (!modelo?.metricas) { box.replaceChildren(); return; }
  const m = modelo.metricas;
  const nomes = app.classesDoModelo().map((c) => c.nome);
  const K = nomes.length;
  const nivel = m.acerto >= 0.9 ? ['boa', 'Ótimo'] : m.acerto >= 0.75 ? ['media', 'Bom — dá para melhorar'] : ['fraca', 'Precisa de mais fotos'];
  const av = avaliar(modelo, app.norma);

  const avisos = [];
  for (const c of modelo.classes) {
    const n = m.porClasse?.[c.id] || 0;
    if (n < REC_FOTOS) avisos.push(`Poucas fotos em “${c.nome}”: ${n}. Recomendado ${REC_FOTOS}+, ideal ${IDEAL_FOTOS}+.`);
  }
  if (!modelo.classes.some((c) => app.norma.ehAceitavel(c.criterio))) avisos.push('Nenhuma classe marcada como “Solda boa (aceitável)”: o app nunca vai dizer SOLDA BOA.');
  const qts = Object.values(m.porClasse || {});
  if (qts.length && Math.max(...qts) > 3 * Math.min(...qts)) avisos.push('Classes muito desbalanceadas: tente ter quantidades de fotos parecidas.');
  let pior = null;
  for (let i = 0; i < K; i++) for (let j = 0; j < K; j++) if (i !== j && m.matriz[i][j] > 0 && (!pior || m.matriz[i][j] > pior.v)) pior = { i, j, v: m.matriz[i][j] };
  if (pior) avisos.push(`Maior confusão: “${nomes[pior.i]}” classificada como “${nomes[pior.j]}” (${pior.v}×). Veja as fotos abaixo — podem estar na classe errada ou precisar de mais exemplos.`);
  if (m.ignoradas?.length) avisos.push(`Classes fora do treino por terem menos de ${MIN_FOTOS} fotos: ${m.ignoradas.join(', ')}.`);
  if (av.defeitosPegos != null && av.defeitosPegos < 0.95) avisos.push('Alguns defeitos passaram como BOA na validação. Antes de confiar, adicione mais fotos de defeito e treine de novo.');

  const recall = m.matriz.map((linha, i) => { const t = linha.reduce((s, x) => s + x, 0); return t ? linha[i] / t : 0; });

  const tabela = el('table', { class: 'matriz' },
    el('tr', {}, el('th', {}, 'Real ↓ / Previsto →'), nomes.map((n) => el('th', {}, n))),
    m.matriz.map((linha, i) => el('tr', {}, el('th', {}, nomes[i]),
      linha.map((v, j) => el('td', { class: i === j ? 'diag' : v ? 'erro' : '' }, v)))));

  const errosBox = el('div', { class: 'grade' });
  for (const e of (m.erros || []).slice(0, 30)) {
    const foto = await store.obterFoto(e.fotoId);
    if (!foto) continue;
    errosBox.append(el('figure', {},
      el('img', { src: urlDe(foto), alt: '', onclick: () => verFoto(foto) }),
      el('figcaption', {}, `${nomes[e.real]} → ${nomes[e.previsto]} (${pct(e.confianca)})`)));
  }

  box.replaceChildren(el('div', { class: 'cartao' },
    el('h3', {}, 'Qualidade do modelo'),
    el('div', { class: `nota ${nivel[0]}` },
      el('span', { class: 'nota-valor' }, pct(m.acerto)),
      el('span', { class: 'nota-rotulo' }, `de acerto · ${nivel[1]}`)),
    el('p', { class: 'dica' }, `Validação cruzada em ${m.kf} partes com ${m.total} fotos: cada foto foi testada por um modelo que NÃO a viu no treino. Treinado em ${dataHora(modelo.treinadoEm)} (${Math.round(modelo.duracaoSeg || 0)} s).`),
    el('div', { class: 'kpis' },
      el('div', { class: 'kpi' }, el('b', {}, av.defeitosPegos == null ? '—' : pct(av.defeitosPegos)), el('span', {}, `Defeitos detectados como RUIM (${av.nokPego}/${av.nokTotal})`)),
      el('div', { class: 'kpi' }, el('b', {}, av.boasAprovadas == null ? '—' : pct(av.boasAprovadas)), el('span', {}, `Soldas boas aprovadas (${av.okAprov}/${av.okTotal})`))),
    el('h3', {}, 'Acerto por classe'),
    el('div', { class: 'barras' }, nomes.map((n, i) => el('div', { class: 'barra-linha' },
      el('span', { class: 'barra-nome' }, n),
      el('div', { class: 'barra-fundo' }, el('div', { style: { width: pct(recall[i]), background: modelo.classes[i]?.cor || '#888' } })),
      el('span', { class: 'barra-valor' }, pct(recall[i]))))),
    avisos.length ? el('div', {}, el('h3', { style: { marginTop: '14px' } }, 'Atenção'), el('ul', { class: 'avisos' }, avisos.map((a) => el('li', {}, a)))) : null,
    el('details', {}, el('summary', {}, 'Matriz de confusão'), tabela),
    errosBox.childElementCount ? el('div', {}, el('h3', { style: { marginTop: '14px' } }, 'Fotos que confundiram o modelo'),
      el('p', { class: 'dica' }, 'Toque para ver, mover para a classe certa ou excluir.'), errosBox) : null));
}
