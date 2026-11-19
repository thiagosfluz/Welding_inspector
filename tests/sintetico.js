// Gera imagens sintéticas de solda para testes (boa, porosidade, trinca).
import { novoCanvas, TAM_FOTO } from '../js/imaging.js';

function rnd(semente) {
  let s = semente;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

export function soldaSintetica(tipo, semente) {
  const r = rnd(semente * 7919 + 13);
  const c = novoCanvas(TAM_FOTO);
  const g = c.getContext('2d');
  const L = TAM_FOTO;
  // chapa de aço com ruído
  const tom = 95 + r() * 50;
  g.fillStyle = `rgb(${tom},${tom + 4},${tom + 10})`;
  g.fillRect(0, 0, L, L);
  for (let i = 0; i < 900; i++) {
    const v = tom + (r() - 0.5) * 60;
    g.fillStyle = `rgba(${v},${v},${v},0.35)`;
    g.fillRect(r() * L, r() * L, 2 + r() * 3, 1 + r() * 2);
  }
  g.save();
  g.translate(L / 2, L / 2);
  g.rotate((r() - 0.5) * 0.9);
  g.translate(-L / 2, -L / 2);
  const y0 = L / 2 + (r() - 0.5) * 40;
  const largura = 70 + r() * 30;
  // cordão com escamas
  const grad = g.createLinearGradient(0, y0 - largura / 2, 0, y0 + largura / 2);
  grad.addColorStop(0, '#5b4a3a'); grad.addColorStop(0.5, '#c9a27a'); grad.addColorStop(1, '#4a3c30');
  g.fillStyle = grad;
  g.fillRect(-20, y0 - largura / 2, L + 40, largura);
  g.strokeStyle = 'rgba(60,40,25,0.55)';
  g.lineWidth = 2;
  for (let x = -20; x < L + 20; x += 9 + r() * 3) {
    g.beginPath();
    g.ellipse(x, y0, 10, largura / 2 - 3, 0, -Math.PI / 2, Math.PI / 2);
    g.stroke();
  }
  if (tipo === 'porosidade') {
    const n = 4 + Math.floor(r() * 6);
    for (let i = 0; i < n; i++) {
      const x = 30 + r() * (L - 60), y = y0 + (r() - 0.5) * largura * 0.6, raio = 4 + r() * 7;
      g.fillStyle = '#120c08';
      g.beginPath(); g.arc(x, y, raio, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,240,220,0.5)';
      g.beginPath(); g.arc(x - raio * 0.35, y - raio * 0.35, raio * 0.3, 0, Math.PI * 2); g.fill();
    }
  } else if (tipo === 'trinca') {
    g.strokeStyle = '#0b0805';
    g.lineWidth = 2.5 + r() * 2;
    g.beginPath();
    let x = 10 + r() * 40, y = y0 + (r() - 0.5) * 20;
    g.moveTo(x, y);
    while (x < L - 10 - r() * 60) {
      x += 6 + r() * 12;
      y += (r() - 0.5) * 14;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  g.restore();
  return c;
}

/**
 * Cordão de solda horizontal com poros de diâmetro CONHECIDO, para testar a medição em mm.
 * poros: [{ posMm, diamMm, desvioMm }] (posição ao longo do cordão a partir de p1).
 * Retorna { canvas, p1, p2, larguraMm, pxPorMm, regua: [a, b] (pontos 0 e 10 mm da régua) }.
 */
export function soldaComPoros({ pxPorMm = 12, comprimentoMm = 80, poros = [], semente = 1, regua = true } = {}) {
  const r = rnd(semente * 104729 + 7);
  const margem = 10;
  const W = Math.round((comprimentoMm + 2 * margem) * pxPorMm);
  const H = Math.round(44 * pxPorMm);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const tom = 105 + r() * 30;
  g.fillStyle = `rgb(${tom},${tom + 4},${tom + 10})`;
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < (W * H) / 60; i++) {
    const v = tom + (r() - 0.5) * 50;
    g.fillStyle = `rgba(${v},${v},${v},0.3)`;
    g.fillRect(r() * W, r() * H, 1 + r() * 3, 1 + r() * 2);
  }
  const yc = Math.round(28 * pxPorMm);
  const larguraCordao = 12 * pxPorMm;
  const grad = g.createLinearGradient(0, yc - larguraCordao / 2, 0, yc + larguraCordao / 2);
  grad.addColorStop(0, '#6b5a48'); grad.addColorStop(0.5, '#c9a27a'); grad.addColorStop(1, '#5a4a3c');
  g.fillStyle = grad;
  g.fillRect(0, yc - larguraCordao / 2, W, larguraCordao);
  // escamas do cordão (arcos finos, como as ondulações reais)
  g.strokeStyle = 'rgba(70,48,30,0.5)';
  g.lineWidth = Math.max(1, pxPorMm * 0.12);
  for (let x = 0; x < W; x += pxPorMm * (1.1 + r() * 0.3)) {
    g.beginPath();
    g.ellipse(x, yc, pxPorMm * 1.2, larguraCordao / 2 - 2, 0, -Math.PI / 2, Math.PI / 2);
    g.stroke();
  }
  const x0 = margem * pxPorMm;
  for (const p of poros) {
    const x = x0 + p.posMm * pxPorMm;
    const y = yc + (p.desvioMm || 0) * pxPorMm;
    const raio = (p.diamMm * pxPorMm) / 2;
    g.fillStyle = p.cor || '#140d08';
    g.beginPath(); g.arc(x, y, raio, 0, Math.PI * 2); g.fill();
    if (p.cor) continue;
    g.fillStyle = 'rgba(255,240,220,0.45)';
    g.beginPath(); g.arc(x - raio * 0.35, y - raio * 0.35, raio * 0.25, 0, Math.PI * 2); g.fill();
  }
  let pontosRegua = null;
  if (regua) {
    const yr = 4 * pxPorMm, hr = 9 * pxPorMm;
    g.fillStyle = '#e8e4d8';
    g.fillRect(x0 - 3 * pxPorMm, yr, (comprimentoMm + 6) * pxPorMm, hr);
    g.fillStyle = '#111';
    for (let m = 0; m <= comprimentoMm; m++) {
      const x = x0 + m * pxPorMm;
      const alt = m % 10 === 0 ? 0.6 : m % 5 === 0 ? 0.45 : 0.3;
      g.fillRect(x - Math.max(0.5, pxPorMm * 0.05), yr, Math.max(1, pxPorMm * 0.1), hr * alt);
    }
    pontosRegua = [{ x: x0, y: yr + 1 }, { x: x0 + 10 * pxPorMm, y: yr + 1 }];
  }
  return {
    canvas: c,
    p1: { x: x0, y: yc },
    p2: { x: x0 + comprimentoMm * pxPorMm, y: yc },
    larguraMm: 10,
    pxPorMm,
    regua: pontosRegua,
  };
}
