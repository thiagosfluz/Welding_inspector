// Camada de regras da norma: a IA diz QUAL descontinuidade vê; a norma diz O QUE FAZER.

export class Norma {
  constructor(dados) {
    this.dados = dados;
  }

  static async carregar(url = 'norma/aws-d1.1.json') {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Não foi possível carregar a norma (${res.status})`);
    return new Norma(await res.json());
  }

  get nome() { return this.dados.nome; }
  get referencia() { return this.dados.referencia; }
  get aviso() { return this.dados.aviso; }
  get geral() { return this.dados.geral || []; }
  get parametros() { return this.dados.parametros; }

  parametrosPadrao() {
    const p = {};
    for (const [k, v] of Object.entries(this.dados.parametros)) p[k] = v.padrao;
    return p;
  }

  listaCriterios() {
    return Object.entries(this.dados.criterios).map(([id, c]) => ({ id, nome: c.nome, acao: c.acao }));
  }

  criterio(id) {
    return this.dados.criterios[id] || this.dados.criterios.outro;
  }

  ehAceitavel(criterioId) {
    return this.criterio(criterioId).acao === 'aprovar';
  }

  rotuloAcao(acao) {
    return this.dados.acoes?.[acao] || acao.toUpperCase();
  }

  // Aplica as regras condicionais (carregamento, espessura, junta) e devolve o que mostrar.
  resolver(criterioId, params) {
    const c = this.criterio(criterioId);
    let acao = c.acao;
    let texto = c.texto;
    for (const regra of c.regras || []) {
      const casa = Object.entries(regra.quando || {}).every(([k, v]) =>
        Array.isArray(v) ? v.includes(params[k]) : params[k] === v);
      if (casa) {
        texto = regra.texto;
        if (regra.acao) acao = regra.acao;
        break;
      }
    }
    return { nome: c.nome, acao, rotulo: this.rotuloAcao(acao), texto, como: c.como || '' };
  }

  resumoParametros(params) {
    return Object.entries(this.dados.parametros)
      .map(([k, def]) => (def.opcoes[params[k]] || '').split(' (')[0])
      .join(' · ');
  }
}

/**
 * Decide BOA / RUIM / INCERTO a partir das probabilidades.
 * Soma as probabilidades das classes "aceitáveis" e das classes "defeito": assim, se o modelo
 * estiver dividido entre dois defeitos (ex.: 45% poro, 40% trinca), o resultado ainda é RUIM.
 */
export function decidir(probs, classes, norma, limite) {
  let pOk = 0, pNok = 0, iOk = -1, iNok = -1;
  classes.forEach((c, i) => {
    if (norma.ehAceitavel(c.criterio)) {
      pOk += probs[i];
      if (iOk < 0 || probs[i] > probs[iOk]) iOk = i;
    } else {
      pNok += probs[i];
      if (iNok < 0 || probs[i] > probs[iNok]) iNok = i;
    }
  });
  if (iNok >= 0 && pNok >= limite) return { tipo: 'ruim', indice: iNok, confianca: pNok };
  if (iOk >= 0 && pOk >= limite) return { tipo: 'boa', indice: iOk, confianca: pOk };
  const indice = pNok >= pOk ? iNok : iOk;
  return { tipo: 'incerto', indice, confianca: Math.max(pOk, pNok) };
}
