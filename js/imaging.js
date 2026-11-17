// Utilitários de imagem: recorte quadrado central, conversões Blob/base64.

export const TAM_FOTO = 320;      // lado das fotos guardadas para treino
export const RECORTE_CAMERA = 1;  // fração do menor lado do vídeo usada no quadrado analisado

export function novoCanvas(lado) {
  const c = document.createElement('canvas');
  c.width = lado; c.height = lado;
  return c;
}

// Desenha o quadrado central de `fonte` (vídeo, imagem ou canvas) em `destino`.
export function desenharQuadrado(fonte, larguraFonte, alturaFonte, destino, fracao = 1) {
  const lado = Math.min(larguraFonte, alturaFonte) * fracao;
  const sx = (larguraFonte - lado) / 2;
  const sy = (alturaFonte - lado) / 2;
  const ctx = destino.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(fonte, sx, sy, lado, lado, 0, 0, destino.width, destino.height);
  return destino;
}

export function canvasParaBlob(canvas, qualidade = 0.9) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao gerar JPEG'))), 'image/jpeg', qualidade);
  });
}

// Decodifica uma imagem (respeitando a rotação EXIF das fotos de celular).
// Retorna { fonte, largura, altura, liberar }.
export async function carregarImagem(blobOuArquivo) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bm = await createImageBitmap(blobOuArquivo, { imageOrientation: 'from-image' });
      return { fonte: bm, largura: bm.width, altura: bm.height, liberar: () => bm.close?.() };
    } catch { /* cai no método com <img> */ }
  }
  const url = URL.createObjectURL(blobOuArquivo);
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error('Formato de imagem não suportado'));
    img.src = url;
  });
  return { fonte: img, largura: img.naturalWidth, altura: img.naturalHeight, liberar: () => URL.revokeObjectURL(url) };
}

// Arquivo/Blob -> canvas quadrado (recorte central).
export async function arquivoParaQuadrado(arquivo, lado = TAM_FOTO) {
  const im = await carregarImagem(arquivo);
  try {
    return desenharQuadrado(im.fonte, im.largura, im.altura, novoCanvas(lado), 1);
  } finally {
    im.liberar();
  }
}

export const blobParaCanvas = arquivoParaQuadrado;

export function blobParaDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function dataURLParaBlob(dataURL) {
  const res = await fetch(dataURL);
  return res.blob();
}

export function bytesParaBase64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes.buffer || bytes, bytes.byteOffset || 0, bytes.byteLength);
  let s = '';
  const passo = 0x8000;
  for (let i = 0; i < u8.length; i += passo) s += String.fromCharCode.apply(null, u8.subarray(i, i + passo));
  return btoa(s);
}

export function base64ParaBytes(b64) {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}

export function float32ParaBase64(f32) {
  return bytesParaBase64(new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength));
}

export function base64ParaFloat32(b64) {
  const u8 = base64ParaBytes(b64);
  return new Float32Array(u8.buffer, 0, u8.byteLength / 4);
}
