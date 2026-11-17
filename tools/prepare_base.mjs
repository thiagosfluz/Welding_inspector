// Gera models/base-geral a partir do MobileNet v1 1.0 224 (ImageNet) publicado pelo Google.
// Corta o modelo na última camada convolucional (conv_pw_13_relu -> mapa 7x7x1024),
// que é o "extrator de características" usado no transfer learning do app.
//
// Uso (precisa de Node 18+):
//   npm install @tensorflow/tfjs@4.22.0
//   (baixe model.json e group*-shard1of1 de
//    https://storage.googleapis.com/tfjs-models/tfjs/mobilenet_v1_1.0_224/ para <pasta_entrada>)
//   node prepare_base.mjs <pasta_entrada> <pasta_saida> [nome_da_camada]
import * as tf from '@tensorflow/tfjs';
import fs from 'node:fs';
import path from 'node:path';

const [inDir, outDir, layerName = 'conv_pw_13_relu'] = process.argv.slice(2);
if (!inDir || !outDir) {
  console.error('uso: node prepare_base.mjs <pasta_entrada> <pasta_saida> [camada]');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(path.join(inDir, 'model.json'), 'utf8'));
const specs = [];
const buffers = [];
for (const group of manifest.weightsManifest) {
  specs.push(...group.weights);
  for (const p of group.paths) buffers.push(fs.readFileSync(path.join(inDir, p)));
}
const all = Buffer.concat(buffers);
const weightData = all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength);

const full = await tf.loadLayersModel(tf.io.fromMemory({
  modelTopology: manifest.modelTopology,
  weightSpecs: specs,
  weightData,
}));
const feat = tf.model({ inputs: full.inputs, outputs: full.getLayer(layerName).output, name: 'extrator' });
console.log('saída:', feat.outputs[0].shape);

const SHARD = 4 * 1024 * 1024;
fs.mkdirSync(outDir, { recursive: true });
await feat.save(tf.io.withSaveHandler(async (art) => {
  const data = Array.isArray(art.weightData)
    ? Buffer.concat(art.weightData.map((b) => Buffer.from(b)))
    : Buffer.from(art.weightData);
  const paths = [];
  for (let i = 0, n = 1; i < data.length; i += SHARD, n++) {
    const name = `pesos${n}.bin`;
    fs.writeFileSync(path.join(outDir, name), data.subarray(i, i + SHARD));
    paths.push(name);
  }
  fs.writeFileSync(path.join(outDir, 'model.json'), JSON.stringify({
    format: 'layers-model',
    generatedBy: art.generatedBy,
    convertedBy: 'tools/prepare_base.mjs',
    modelTopology: art.modelTopology,
    weightsManifest: [{ paths, weights: art.weightSpecs }],
  }));
  console.log(`gravado em ${outDir}: ${paths.length} arquivo(s), ${(data.length / 1e6).toFixed(1)} MB`);
  return { modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: 'JSON' } };
}));
