// Confere se a base exportada pelo train_weld_base.py dá o mesmo resultado no TF.js (o motor do app).
// Uso (na pasta tools):  npm install   e depois   node pretrain/verificar_base.mjs
import * as tf from '@tensorflow/tfjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(aqui, '..', '..');
const pastaModelo = process.argv[2] || path.join(raiz, 'models', 'base-solda');
const pastaVerif = process.argv[3] || path.join(aqui, 'saida');

const manifesto = JSON.parse(fs.readFileSync(path.join(pastaModelo, 'model.json'), 'utf8'));
const specs = manifesto.weightsManifest.flatMap((g) => g.weights);
const buf = Buffer.concat(manifesto.weightsManifest.flatMap((g) => g.paths).map((p) => fs.readFileSync(path.join(pastaModelo, p))));
const modelo = await tf.loadLayersModel(tf.io.fromMemory({
  modelTopology: manifesto.modelTopology,
  weightSpecs: specs,
  weightData: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
}));

const ent = fs.readFileSync(path.join(pastaVerif, 'verificacao_entrada.bin'));
const x = tf.tensor4d(new Float32Array(ent.buffer, ent.byteOffset, ent.byteLength / 4), [1, 224, 224, 3]);
const vetor = await modelo.predict(x).mean([1, 2]).data();
const esperado = JSON.parse(fs.readFileSync(path.join(pastaVerif, 'verificacao.json'), 'utf8')).vetor;

let maxDif = 0, maxVal = 0;
for (let i = 0; i < esperado.length; i++) {
  maxDif = Math.max(maxDif, Math.abs(vetor[i] - esperado[i]));
  maxVal = Math.max(maxVal, Math.abs(esperado[i]));
}
const ok = vetor.length === esperado.length && maxDif <= 1e-3 * Math.max(1, maxVal);
console.log(`Vetor com ${vetor.length} valores · diferença máxima ${maxDif.toExponential(2)} (maior valor ${maxVal.toFixed(3)})`);
console.log(ok ? '✅ Base de solda compatível com o app.' : '❌ Diferença acima do esperado — não use esta base.');
process.exit(ok ? 0 : 1);
