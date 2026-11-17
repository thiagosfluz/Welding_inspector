// Aba "Modelo": estado do modelo, parâmetros da norma, configurações, base da IA,
// exportar/importar, instalação e apagar tudo.
import * as store from './store.js';
import { exportar, compartilharOuBaixar, lerArquivo, importar } from './transfer.js';
import { $, el, toast, abrirModal, confirmar, pct, dataHora } from './ui.js';
import { treinar, MIN_FOTOS } from './tab-treinar.js';
import { criarClassesIniciais } from './app.js';

let app;

export function iniciar(a) {
  app = a;
  app.on('modelo', renderInfo);
  app.on('dados', renderInfo);
  app.on('pronto', () => { renderBases(); renderNorma(); renderConfig(); });
  app.on('config', renderConfig);
  app.on('instalar', renderInstalar);

  $('#cfg-limite').addEventListener('input', (e) => { $('#lbl-limite').textContent = `${e.target.value}%`; });
  $('#cfg-limite').addEventListener('change', (e) => app.salvarConfig({ limite: Number(e.target.value) / 100 }));
  $('#cfg-som').addEventListener('change', (e) => app.salvarConfig({ som: e.target.checked }));
  $('#cfg-vibrar').addEventListener('change', (e) => app.salvarConfig({ vibrar: e.target.checked }));
  $('#cfg-calor').addEventListener('change', (e) => app.salvarConfig({ calor: e.target.checked }));
  $('#btn-guia-norma').addEventListener('click', abrirGuiaNorma);
  $('#btn-exportar').addEventListener('click', fazerExportacao);
  $('#input-importar').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) await fazerImportacao(f);
  });
  $('#btn-apagar-tudo').addEventListener('click', apagarTudo);

  renderConfig();
  renderNorma();
  renderInfo();
  renderInstalar();
}

export function mostrar() { renderInfo(); renderBases(); }
export function ocultar() {}

function renderInfo() {
  const box = $('#modelo-info');
  const totalFotos = Object.values(app.contagens).reduce((s, x) => s + x, 0);
  const m = app.modelo;
  const base = app.bases.find((b) => b.id === app.config.baseId);
  const linhas = [
    ['Base da IA', base?.nome || '—'],
    ['Fotos guardadas', `${totalFotos} em ${app.classes.length} classes`],
  ];
  if (m) {
    linhas.push(
      ['Treinado em', dataHora(m.treinadoEm)],
      ['Classes no modelo', app.classesDoModelo().map((c) => c.nome).join(', ')],
      ['Acerto na validação', m.metricas ? pct(m.metricas.acerto) : '—'],
    );
  }
  const estado = !m ? ['Sem modelo — treine na aba Treinar', 'avaliar']
    : m.baseId !== app.config.baseId ? ['Treinado com outra base — treine de novo', 'avaliar']
      : app.modeloDesatualizado() ? ['Desatualizado — há fotos novas', 'medir']
        : ['Pronto para inspeção', 'aprovar'];
  box.replaceChildren(
    el('span', { class: `chip ${estado[1]}` }, estado[0]),
    el('div', { class: 'form', style: { marginTop: '10px' } }, linhas.map(([k, v]) =>
      el('div', {}, el('span', { class: 'dica' }, `${k}: `), el('b', {}, v)))),
    el('button', { class: 'btn', onclick: () => app.irPara('treinar') }, '🧠 Ir para Treinar'));
}

function renderConfig() {
  const c = app.config;
  $('#cfg-limite').value = Math.round(c.limite * 100);
  $('#lbl-limite').textContent = pct(c.limite);
  $('#cfg-som').checked = c.som;
  $('#cfg-vibrar').checked = c.vibrar;
  $('#cfg-calor').checked = c.calor;
}

function renderNorma() {
  if (!app.norma) return;
  const box = $('#norma-params');
  box.replaceChildren(...Object.entries(app.norma.parametros).map(([chave, def]) => {
    const sel = el('select', {}, Object.entries(def.opcoes).map(([v, rotulo]) =>
      el('option', { value: v, selected: app.config.norma?.[chave] === v }, rotulo)));
    sel.addEventListener('change', () => app.salvarConfig({ norma: { ...app.config.norma, [chave]: sel.value } }));
    return el('label', {}, def.rotulo, sel);
  }));
}

function abrirGuiaNorma() {
  const n = app.norma;
  const p = app.config.norma;
  const corpo = el('div', { class: 'guia-norma' },
    el('p', { class: 'dica' }, n.referencia),
    el('p', { class: 'dica' }, `Parâmetros atuais: ${n.resumoParametros(p)}`),
    n.listaCriterios().map(({ id }) => {
      const r = n.resolver(id, p);
      return el('div', {},
        el('h4', {}, el('span', { class: `chip ${r.acao}` }, r.rotulo), ' ', r.nome),
        el('p', {}, r.texto),
        r.como && el('p', { class: 'dica' }, `Como verificar: ${r.como}`));
    }),
    el('h4', {}, 'Observações gerais'),
    el('ul', {}, n.geral.map((g) => el('li', {}, g))),
    el('p', { class: 'dica', style: { marginTop: '12px' } }, `⚠ ${n.aviso}`));
  abrirModal(corpo, { titulo: n.nome });
}

function renderBases() {
  const box = $('#bases-lista');
  box.replaceChildren(
    ...app.bases.map((b) => {
      const radio = el('input', { type: 'radio', name: 'base', value: b.id, checked: b.id === app.config.baseId, disabled: !b.disponivel });
      radio.addEventListener('change', () => trocarBase(b));
      return el('label', { class: `base-opcao ${b.disponivel ? '' : 'indisponivel'}` }, radio,
        el('div', {}, el('b', {}, b.nome), el('div', { class: 'dica' }, b.descricao),
          !b.disponivel && el('div', { class: 'dica' }, 'Ainda não instalada — veja “Etapa 2” no README.')));
    }),
    el('p', { class: 'dica' }, 'Ao trocar a base, o app recalcula as fotos guardadas e treina de novo automaticamente.'));
}

async function trocarBase(b) {
  if (b.id === app.config.baseId) return;
  const ok = await confirmar(`Trocar a base da IA para “${b.nome}”? O app vai reprocessar todas as fotos e treinar de novo (pode levar alguns minutos).`, { sim: 'Trocar' });
  if (!ok) { renderBases(); return; }
  try {
    await app.trocarBase(b.id);
    app.irPara('treinar');
    const prontas = app.classes.filter((c) => (app.contagens[c.id] || 0) >= MIN_FOTOS);
    if (prontas.length >= 2) await treinar();
  } catch (e) {
    toast(`Erro ao trocar a base: ${e.message}`, 6000);
  }
  renderBases();
  renderInfo();
}

async function fazerExportacao() {
  const btn = $('#btn-exportar');
  btn.disabled = true;
  try {
    toast('Gerando arquivo…', 60000);
    const arq = await exportar(app, (p) => toast(`Gerando arquivo… ${Math.round(p * 100)}%`, 60000));
    const r = await compartilharOuBaixar(arq);
    toast(r === 'cancelado' ? 'Exportação cancelada' : `Arquivo pronto: ${arq.name} (${(arq.size / 1e6).toFixed(1)} MB)`, 4000);
  } catch (e) {
    toast(`Erro ao exportar: ${e.message}`, 6000);
  } finally {
    btn.disabled = false;
  }
}

async function fazerImportacao(arquivo) {
  let dados;
  try { dados = await lerArquivo(arquivo); } catch (e) { toast(e.message, 6000); return; }
  const corpo = el('div', {},
    el('p', {}, `Arquivo com ${dados.classes?.length || 0} classes, ${dados.fotos?.length || 0} fotos${dados.modelo ? ' e um modelo treinado' : ''}, exportado em ${dataHora(dados.exportadoEm)}.`),
    el('p', {}, el('b', {}, 'Substituir: '), 'apaga as fotos e o modelo deste aparelho e usa os do arquivo (recomendado para copiar o treino para outro celular).'),
    el('p', {}, el('b', {}, 'Somar: '), 'mantém o que já existe e adiciona as fotos novas. Depois treine de novo.'));
  const modo = await abrirModal(corpo, {
    titulo: 'Importar treino',
    botoes: [
      { rotulo: 'Cancelar', valor: null },
      { rotulo: 'Somar', valor: 'somar' },
      { rotulo: 'Substituir', valor: 'substituir', classe: 'btn-primario' },
    ],
  });
  if (!modo) return;
  try {
    toast('Importando…', 60000);
    const r = await importar(app, dados, modo, (p) => toast(`Importando… ${Math.round(p * 100)}%`, 60000));
    if (app.modelo && app.modelo.baseId !== app.config.baseId) {
      const base = app.bases.find((b) => b.id === app.modelo.baseId && b.disponivel);
      if (base) await app.trocarBase(base.id);
    }
    toast(`Importado: ${r.novas} foto(s) nova(s)${r.modeloImportado ? ' e o modelo' : ''}.`, 5000);
    renderNorma();
    renderBases();
  } catch (e) {
    console.error(e);
    toast(`Erro ao importar: ${e.message}`, 8000);
  }
}

async function apagarTudo() {
  const ok = await confirmar('Apagar TODAS as fotos, classes e o modelo deste aparelho? Isso não pode ser desfeito. Faça “Exportar” antes se quiser um backup.', { sim: 'Apagar tudo', perigo: true });
  if (!ok) return;
  await store.apagarTudo();
  await app.definirModelo(null);
  await criarClassesIniciais();
  await app.recarregarDados();
  toast('Tudo apagado');
}

function renderInstalar() {
  const box = $('#instalar-info');
  const instalado = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (instalado) {
    box.replaceChildren(el('p', {}, '✅ O app já está instalado neste aparelho.'));
    return;
  }
  const filhos = [];
  if (app.instalarPrompt) {
    filhos.push(el('button', {
      class: 'btn btn-primario', onclick: async () => {
        app.instalarPrompt.prompt();
        await app.instalarPrompt.userChoice.catch(() => {});
        app.instalarPrompt = null;
        renderInstalar();
      },
    }, '⬇ Instalar aplicativo'));
  }
  filhos.push(el('ul', { class: 'dica' },
    el('li', {}, 'Android (Chrome): menu ⋮ → “Instalar app” ou “Adicionar à tela inicial”.'),
    el('li', {}, 'iPhone (Safari): botão Compartilhar → “Adicionar à Tela de Início”.'),
    el('li', {}, 'PC (Chrome/Edge): ícone de instalar na barra de endereço, ou menu → “Instalar Inspetor de Solda”.')));
  box.replaceChildren(...filhos);
}
