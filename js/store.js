// Armazenamento local (IndexedDB): classes, fotos, vetores da IA, modelo e configurações.
// Tudo fica no próprio aparelho; nada é enviado para a internet.

let nomeBanco = 'inspetor-solda';
let bancoPromessa = null;

export function usarBanco(nome) {
  if (bancoPromessa) bancoPromessa.then((db) => db.close()).catch(() => {});
  nomeBanco = nome;
  bancoPromessa = null;
}

function abrir() {
  if (!bancoPromessa) {
    bancoPromessa = new Promise((resolve, reject) => {
      const req = indexedDB.open(nomeBanco, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('classes', { keyPath: 'id' });
        const fotos = db.createObjectStore('fotos', { keyPath: 'id' });
        fotos.createIndex('classe', 'classeId');
        const vet = db.createObjectStore('vetores', { keyPath: 'chave' });
        vet.createIndex('foto', 'fotoId');
        db.createObjectStore('meta');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Banco de dados bloqueado por outra aba aberta.'));
    });
  }
  return bancoPromessa;
}

function req2p(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function transacao(lojas, modo, fn) {
  const db = await abrir();
  return new Promise((resolve, reject) => {
    const t = db.transaction(lojas, modo);
    let resultado;
    Promise.resolve(fn(t)).then((r) => { resultado = r; }, reject);
    t.oncomplete = () => resolve(resultado);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transação abortada'));
  });
}

export function novoId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// ---------- meta (configurações, modelo) ----------
export async function lerMeta(chave) {
  return transacao('meta', 'readonly', (t) => req2p(t.objectStore('meta').get(chave)));
}
export async function gravarMeta(chave, valor) {
  return transacao('meta', 'readwrite', (t) => { t.objectStore('meta').put(valor, chave); });
}

// Contador que muda a cada alteração de fotos/classes: serve para saber se o modelo está desatualizado.
async function marcarAlteracao(t) {
  const loja = t.objectStore('meta');
  const atual = (await req2p(loja.get('versaoDados'))) || 0;
  loja.put(atual + 1, 'versaoDados');
}
export async function versaoDados() {
  return (await lerMeta('versaoDados')) || 0;
}

// ---------- classes ----------
export async function listarClasses() {
  const lista = await transacao('classes', 'readonly', (t) => req2p(t.objectStore('classes').getAll()));
  return lista.sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
}
export async function salvarClasse(classe) {
  return transacao(['classes', 'meta'], 'readwrite', async (t) => {
    t.objectStore('classes').put(classe);
    await marcarAlteracao(t);
  });
}
export async function excluirClasse(classeId) {
  const fotos = await listarFotos(classeId);
  for (const f of fotos) await excluirFoto(f.id);
  return transacao(['classes', 'meta'], 'readwrite', async (t) => {
    t.objectStore('classes').delete(classeId);
    await marcarAlteracao(t);
  });
}

// ---------- fotos ----------
// foto = { id, classeId, blob (JPEG 320x320), criadoEm, origem: 'camera'|'arquivo'|'correcao'|'importacao' }
export async function listarFotos(classeId) {
  return transacao('fotos', 'readonly', (t) => {
    const loja = t.objectStore('fotos');
    return req2p(classeId ? loja.index('classe').getAll(classeId) : loja.getAll());
  });
}
export async function obterFoto(id) {
  return transacao('fotos', 'readonly', (t) => req2p(t.objectStore('fotos').get(id)));
}
export async function salvarFoto(foto) {
  return transacao(['fotos', 'meta'], 'readwrite', async (t) => {
    t.objectStore('fotos').put(foto);
    await marcarAlteracao(t);
  });
}
export async function excluirFoto(id) {
  return transacao(['fotos', 'vetores', 'meta'], 'readwrite', async (t) => {
    t.objectStore('fotos').delete(id);
    const chaves = await req2p(t.objectStore('vetores').index('foto').getAllKeys(id));
    for (const k of chaves) t.objectStore('vetores').delete(k);
    await marcarAlteracao(t);
  });
}
export async function moverFoto(id, novaClasseId) {
  return transacao(['fotos', 'meta'], 'readwrite', async (t) => {
    const loja = t.objectStore('fotos');
    const foto = await req2p(loja.get(id));
    if (!foto) return;
    foto.classeId = novaClasseId;
    loja.put(foto);
    await marcarAlteracao(t);
  });
}
export async function contarFotosPorClasse() {
  const fotos = await transacao('fotos', 'readonly', (t) => req2p(t.objectStore('fotos').getAll()));
  const cont = {};
  for (const f of fotos) cont[f.classeId] = (cont[f.classeId] || 0) + 1;
  return cont;
}

// ---------- vetores (características extraídas pela base da IA) ----------
export async function obterVetor(baseId, fotoId) {
  const r = await transacao('vetores', 'readonly', (t) => req2p(t.objectStore('vetores').get(`${baseId}|${fotoId}`)));
  return r ? r.dados : null;
}
export async function salvarVetor(baseId, fotoId, dados) {
  return transacao('vetores', 'readwrite', (t) => {
    t.objectStore('vetores').put({ chave: `${baseId}|${fotoId}`, baseId, fotoId, dados });
  });
}
export async function chavesVetores() {
  const chaves = await transacao('vetores', 'readonly', (t) => req2p(t.objectStore('vetores').getAllKeys()));
  return new Set(chaves);
}

export async function apagarTudo() {
  return transacao(['classes', 'fotos', 'vetores', 'meta'], 'readwrite', (t) => {
    for (const n of ['classes', 'fotos', 'vetores']) t.objectStore(n).clear();
    const meta = t.objectStore('meta');
    meta.delete('modelo');
    meta.put(0, 'versaoDados');
  });
}

export async function pedirArmazenamentoPersistente() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      return await navigator.storage.persist();
    }
    return true;
  } catch { return false; }
}
