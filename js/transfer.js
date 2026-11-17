// Exportar / importar: um único arquivo .json com classes, fotos, modelo e configurações.
import * as store from './store.js';
import { blobParaDataURL, dataURLParaBlob, float32ParaBase64, base64ParaFloat32 } from './imaging.js';

const FORMATO = 'inspetor-solda';
const VERSAO_FORMATO = 1;

export async function exportar(app, aoProgresso = () => {}) {
  const classes = await store.listarClasses();
  const fotos = await store.listarFotos();
  const fotosOut = [];
  for (const [i, f] of fotos.entries()) {
    fotosOut.push({ id: f.id, classeId: f.classeId, criadoEm: f.criadoEm, origem: f.origem, jpeg: await blobParaDataURL(f.blob) });
    if (i % 10 === 0) aoProgresso(i / fotos.length);
  }
  const m = app.modelo;
  const modelo = m ? {
    ...m,
    W: float32ParaBase64(m.W instanceof Float32Array ? m.W : Float32Array.from(m.W)),
    b: float32ParaBase64(m.b instanceof Float32Array ? m.b : Float32Array.from(m.b)),
  } : null;
  const dados = {
    formato: FORMATO,
    versao: VERSAO_FORMATO,
    exportadoEm: new Date().toISOString(),
    config: app.config,
    classes,
    fotos: fotosOut,
    modelo,
  };
  const nome = `inspetor-solda-${new Date().toISOString().slice(0, 10)}.json`;
  return new File([JSON.stringify(dados)], nome, { type: 'application/json' });
}

export async function compartilharOuBaixar(arquivo) {
  try {
    if (navigator.canShare?.({ files: [arquivo] })) {
      await navigator.share({ files: [arquivo], title: 'Inspetor de Solda — treino' });
      return 'compartilhado';
    }
  } catch (e) {
    if (e.name === 'AbortError') return 'cancelado';
  }
  const url = URL.createObjectURL(arquivo);
  const a = document.createElement('a');
  a.href = url;
  a.download = arquivo.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return 'baixado';
}

export async function lerArquivo(arquivo) {
  const texto = await arquivo.text();
  let dados;
  try { dados = JSON.parse(texto); } catch { throw new Error('O arquivo não é um JSON válido.'); }
  if (dados?.formato !== FORMATO) throw new Error('Este arquivo não foi exportado pelo Inspetor de Solda.');
  if (dados.versao > VERSAO_FORMATO) throw new Error('Arquivo de uma versão mais nova do app. Atualize o app.');
  return dados;
}

/**
 * modo 'substituir': apaga tudo e usa o conteúdo do arquivo (inclusive o modelo).
 * modo 'somar': adiciona classes e fotos que ainda não existem; mantém o modelo atual
 * (se não houver modelo, usa o do arquivo).
 */
export async function importar(app, dados, modo, aoProgresso = () => {}) {
  if (modo === 'substituir') await store.apagarTudo();
  const existentes = new Map((await store.listarClasses()).map((c) => [c.id, c]));
  const porNome = new Map([...existentes.values()].map((c) => [c.nome.toLowerCase(), c]));
  const mapaClasse = {};
  for (const c of dados.classes || []) {
    const igual = existentes.get(c.id) || porNome.get(c.nome.toLowerCase());
    if (igual) { mapaClasse[c.id] = igual.id; continue; }
    await store.salvarClasse(c);
    mapaClasse[c.id] = c.id;
  }
  const fotosAtuais = new Set((await store.listarFotos()).map((f) => f.id));
  let novas = 0;
  const lista = dados.fotos || [];
  for (const [i, f] of lista.entries()) {
    if (fotosAtuais.has(f.id)) continue;
    const blob = await dataURLParaBlob(f.jpeg);
    await store.salvarFoto({ id: f.id, classeId: mapaClasse[f.classeId] || f.classeId, blob, criadoEm: f.criadoEm, origem: f.origem || 'importacao' });
    novas++;
    if (i % 10 === 0) aoProgresso(i / lista.length);
  }

  let modeloImportado = false;
  if (dados.modelo && (modo === 'substituir' || !app.modelo)) {
    const m = { ...dados.modelo, W: base64ParaFloat32(dados.modelo.W), b: base64ParaFloat32(dados.modelo.b) };
    m.classeIds = m.classeIds.map((id) => mapaClasse[id] || id);
    if (modo === 'somar') m.versaoDados = -1; // dados mudaram: marcar para treinar de novo
    else m.versaoDados = await store.versaoDados();
    await app.definirModelo(m);
    modeloImportado = true;
  }
  if (modo === 'substituir' && dados.config) {
    const { limite, som, vibrar, calor, norma } = dados.config;
    await app.salvarConfig({ limite, som, vibrar, calor, norma: norma || app.config.norma });
  }
  await app.recarregarDados();
  return { novas, modeloImportado };
}
