// Inicialização do app e estado compartilhado entre as abas.
import * as store from './store.js';
import { Motor } from './model.js';
import { Norma } from './norma.js';
import { Camera } from './camera.js';
import { blobParaCanvas } from './imaging.js';
import { $, toast, iniciarModal, CORES } from './ui.js';
import * as abaInspecionar from './tab-inspecionar.js';
import * as abaTreinar from './tab-treinar.js';
import * as abaModelo from './tab-modelo.js';
import * as abaMedir from './tab-medir.js';

export const VERSAO_APP = '1.1.0';

const CONFIG_PADRAO = {
  limite: 0.7,
  som: true,
  vibrar: true,
  calor: true,
  baseId: 'geral-mobilenet-v1',
  norma: null, // preenchido com os parâmetros padrão da norma
};

const CLASSES_INICIAIS = [
  { nome: 'Boa', criterio: 'aceitavel', cor: '#16a34a' },
  { nome: 'Porosidade', criterio: 'porosidade', cor: '#f97316' },
  { nome: 'Trinca', criterio: 'trinca', cor: '#dc2626' },
];

export const app = {
  motor: new Motor(),
  camera: null,
  norma: null,
  bases: [],
  config: { ...CONFIG_PADRAO },
  classes: [],
  contagens: {},
  versaoDados: 0,
  modelo: null,
  abaAtual: 'inspecionar',
  eventos: new EventTarget(),
  instalarPrompt: null,

  emitir(nome, detalhe) { this.eventos.dispatchEvent(new CustomEvent(nome, { detail: detalhe })); },
  on(nome, fn) { this.eventos.addEventListener(nome, (e) => fn(e.detail)); },

  baseAtual() { return this.bases.find((b) => b.id === this.config.baseId) || this.bases[0]; },

  async salvarConfig(parcial) {
    Object.assign(this.config, parcial);
    await store.gravarMeta('config', this.config);
    this.emitir('config');
  },

  async recarregarDados() {
    this.classes = await store.listarClasses();
    this.contagens = await store.contarFotosPorClasse();
    this.versaoDados = await store.versaoDados();
    this.emitir('dados');
    this.processarVetores();
  },

  async definirModelo(modelo) {
    this.modelo = modelo;
    if (modelo) await store.gravarMeta('modelo', modelo);
    else await store.gravarMeta('modelo', null);
    this.motor.definirCabeca(modelo && modelo.baseId === this.config.baseId ? modelo : null);
    this.emitir('modelo');
  },

  modeloDesatualizado() {
    return !!this.modelo && this.modelo.versaoDados !== this.versaoDados;
  },

  // Classes na ordem usada pelo modelo (com os nomes atuais, se ainda existirem).
  classesDoModelo() {
    if (!this.modelo) return [];
    return this.modelo.classeIds.map((id, i) => {
      const atual = this.classes.find((c) => c.id === id);
      return atual || { ...this.modelo.classes[i], removida: true };
    });
  },

  // ---- fila que calcula os vetores da IA para as fotos novas ----
  _filaRodando: false,
  _filaDeNovo: false,
  fila: { feitos: 0, total: 0, rodando: false },

  async processarVetores() {
    if (!this.motor.pronto) return;
    if (this._filaRodando) { this._filaDeNovo = true; return; }
    this._filaRodando = true;
    try {
      do {
        this._filaDeNovo = false;
        const base = this.motor.baseInfo;
        const fotos = await store.listarFotos();
        const existentes = await store.chavesVetores();
        const faltam = fotos.filter((f) => !existentes.has(`${base.id}|${f.id}`));
        this.fila = { feitos: 0, total: faltam.length, rodando: faltam.length > 0 };
        this.emitir('fila', this.fila);
        for (const f of faltam) {
          if (this.motor.baseInfo.id !== base.id) break;
          try {
            const canvas = await blobParaCanvas(f.blob, base.entrada);
            const vet = await this.motor.vetores(canvas);
            await store.salvarVetor(base.id, f.id, vet);
          } catch (e) {
            console.warn('Falha ao processar foto', f.id, e);
          }
          this.fila.feitos++;
          this.emitir('fila', this.fila);
        }
      } while (this._filaDeNovo);
    } finally {
      this._filaRodando = false;
      this.fila.rodando = false;
      this.emitir('fila', this.fila);
    }
  },

  async aguardarFila() {
    await this.processarVetores();
    while (this._filaRodando) await new Promise((r) => setTimeout(r, 150));
  },

  async trocarBase(baseId) {
    const info = this.bases.find((b) => b.id === baseId);
    if (!info) throw new Error('Base não encontrada');
    definirStatus('Carregando base da IA…');
    await this.motor.carregarBase(info, (p) => definirStatus(`Carregando base da IA… ${Math.round(p * 100)}%`));
    await this.salvarConfig({ baseId });
    this.motor.definirCabeca(this.modelo && this.modelo.baseId === baseId ? this.modelo : null);
    definirStatus(`IA pronta · ${info.nome}`, 'ok');
    this.emitir('modelo');
    this.processarVetores();
  },

  irPara(aba) {
    if (aba === this.abaAtual) return;
    const anterior = this.abaAtual;
    this.abaAtual = aba;
    document.querySelectorAll('.aba').forEach((s) => { s.hidden = s.dataset.aba !== aba; });
    document.querySelectorAll('.abas button').forEach((b) => b.classList.toggle('ativa', b.dataset.ir === aba));
    modulos[anterior]?.ocultar?.();
    modulos[aba]?.mostrar?.();
    window.scrollTo({ top: 0 });
  },
};

const modulos = { inspecionar: abaInspecionar, treinar: abaTreinar, medir: abaMedir, modelo: abaModelo };

export function definirStatus(texto, tipo = '') {
  const s = $('#status-ia');
  s.textContent = texto;
  s.className = `status-ia ${tipo}`;
}

async function carregarBases() {
  const res = await fetch('models/bases.json');
  const { bases } = await res.json();
  // Verifica quais bases opcionais existem de fato (ex.: base de solda ainda não gerada).
  await Promise.all(bases.map(async (b) => {
    try {
      const r = await fetch(b.url, { method: 'HEAD' });
      b.disponivel = r.ok;
    } catch { b.disponivel = false; }
  }));
  return bases;
}

export async function criarClassesIniciais() {
  const existentes = await store.listarClasses();
  if (existentes.length) return;
  let ordem = 0;
  for (const c of CLASSES_INICIAIS) {
    await store.salvarClasse({ id: store.novoId(), ...c, ordem: ordem++, criadoEm: Date.now() });
  }
}

export function proximaCor() {
  const usadas = new Set(app.classes.map((c) => c.cor));
  return CORES.find((c) => !usadas.has(c)) || CORES[app.classes.length % CORES.length];
}

function registrarServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (local && !new URLSearchParams(location.search).has('pwa')) return; // em desenvolvimento, sem cache
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const avisar = (w) => {
      $('#faixa-atualizacao').hidden = false;
      $('#btn-atualizar').onclick = () => w.postMessage('pular-espera');
    };
    if (reg.waiting && navigator.serviceWorker.controller) avisar(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) avisar(w);
      });
    });
  }).catch((e) => console.warn('Service worker não registrado', e));
  let recarregando = false;
  const haviaControle = !!navigator.serviceWorker.controller; // na 1ª instalação não recarrega
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (recarregando || !haviaControle) return;
    recarregando = true;
    location.reload();
  });
}

async function iniciar() {
  iniciarModal();
  registrarServiceWorker();
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    app.instalarPrompt = e;
    app.emitir('instalar');
  });
  document.querySelectorAll('.abas button').forEach((b) => b.addEventListener('click', () => app.irPara(b.dataset.ir)));
  $('#versao').textContent = `Inspetor de Solda v${VERSAO_APP}`;

  app.camera = new Camera($('#video'));
  try {
    if (!window.tf) throw new Error('TensorFlow.js não carregou (vendor/tf.min.js).');
    app.norma = await Norma.carregar();
    app.bases = await carregarBases();

    const cfg = await store.lerMeta('config');
    app.config = { ...CONFIG_PADRAO, ...(cfg || {}) };
    app.config.norma = { ...app.norma.parametrosPadrao(), ...(app.config.norma || {}) };
    if (!app.bases.some((b) => b.id === app.config.baseId && b.disponivel)) app.config.baseId = app.bases[0].id;

    await criarClassesIniciais();
    app.modelo = (await store.lerMeta('modelo')) || null;
    app.classes = await store.listarClasses();
    app.contagens = await store.contarFotosPorClasse();
    app.versaoDados = await store.versaoDados();

    abaInspecionar.iniciar(app);
    abaTreinar.iniciar(app);
    abaModelo.iniciar(app);
    abaMedir.iniciar(app);
    app.emitir('dados');

    store.pedirArmazenamentoPersistente();

    definirStatus('Preparando IA…');
    const backend = await app.motor.iniciarBackend();
    const base = app.baseAtual();
    await app.motor.carregarBase(base, (p) => definirStatus(`Baixando IA… ${Math.round(p * 100)}%`));
    app.motor.definirCabeca(app.modelo && app.modelo.baseId === base.id ? app.modelo : null);
    definirStatus(`IA pronta${backend === 'cpu' ? ' (modo lento)' : ''}`, 'ok');
    app.emitir('modelo');
    app.emitir('pronto');
    app.processarVetores();
  } catch (e) {
    console.error(e);
    definirStatus('Erro ao iniciar a IA', 'erro');
    toast(`Erro: ${e.message}`, 8000);
  }
}

window.app = app; // facilita testes no console
iniciar();
