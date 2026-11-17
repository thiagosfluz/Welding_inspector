# Inspetor de Solda

Aplicativo de **apoio à inspeção visual de solda** com IA treinável, feito para o kaizen.
O inspetor abre a câmera, aponta para a solda e o app mostra na hora:

- **✔ SOLDA BOA**, **✖ SOLDA RUIM** (com o tipo de defeito: porosidade, trinca…) ou **? INCERTO**;
- a **confiança** da IA (%) e a confiança de cada classe;
- o que a **norma AWS D1.1** pede para aquele defeito (REPROVAR, MEDIR com o limite, CORRIGIR…);
- um **mapa de calor** indicando a região suspeita, com bipe e vibração ao detectar defeito.

O treino é feito **no próprio app**, com as fotos do quadro "certo × errado", sem programar nada.
Funciona no **PC e no celular**, pode ser **instalado como aplicativo** e funciona **sem internet**.
As fotos e o modelo ficam **somente no aparelho**: nada é enviado para servidores.

> ⚠️ É uma ferramenta de **apoio**. Não substitui o inspetor de soldagem qualificado, a norma, nem os ensaios exigidos pelo projeto. Veja [Limitações](#limitações-e-segurança).

---

## Sumário

1. [Amanhã: passo a passo para colocar em uso](#amanhã-passo-a-passo-para-colocar-em-uso)
2. [Como o app funciona](#como-o-app-funciona)
3. [Norma AWS D1.1 dentro do app](#norma-aws-d11-dentro-do-app)
4. [Processo de treinamento (detalhado)](#processo-de-treinamento-detalhado)
5. [Usando na inspeção](#usando-na-inspeção)
6. [Manutenção do modelo](#manutenção-do-modelo)
7. [Etapa 2 — base de solda (opcional)](#etapa-2--base-de-solda-opcional)
8. [Instalar no celular e no PC](#instalar-no-celular-e-no-pc)
9. [Limitações e segurança](#limitações-e-segurança)
10. [Problemas comuns](#problemas-comuns)
11. [Para desenvolvedores](#para-desenvolvedores)

---

## Amanhã: passo a passo para colocar em uso

### Passo 1 — Rodar no PC (2 minutos)

Requisito: **Python 3** instalado. Ele já existe neste PC; em outro computador, instale em
https://www.python.org/downloads/ marcando *Add python to PATH*.

1. Abra a pasta do projeto e dê **duplo clique em `Iniciar app.bat`**.
   (ou, no terminal, dentro da pasta: `python servidor.py`)
2. O navegador abre em **http://localhost:8000**. Use Chrome ou Edge.
3. Deixe a janela preta do servidor aberta enquanto usa o app. Para parar, feche essa janela.

No PC a câmera funciona normalmente em `localhost`, seja webcam ou câmera USB.

### Passo 2 — Publicar para usar no celular (5 minutos, uma única vez)

O celular só libera a câmera para sites **HTTPS**. O jeito mais simples e gratuito é o **GitHub Pages**:

1. Envie o código para o GitHub. Este repositório já está em `github.com/thiagosfluz/Welding_inspector`.
2. No GitHub, abra o repositório e vá em **Settings → General → Danger Zone → Change repository visibility → Public**.
   O GitHub Pages gratuito exige repositório público. Só o **código** fica público; as **fotos e o modelo nunca vão para o GitHub**, porque ficam no aparelho.
3. Ainda em **Settings → Pages**, em *Build and deployment*, escolha *Source: Deploy from a branch*, *Branch: `main`*, pasta **`/ (root)`** e clique **Save**.
4. Espere 1 a 2 minutos. O app ficará em: **https://thiagosfluz.github.io/Welding_inspector/**
5. Abra esse link no celular, permita a câmera e **instale o app** (veja [Instalar](#instalar-no-celular-e-no-pc)).

> Se o repositório precisar continuar privado: use o [Netlify Drop](https://app.netlify.com/drop) e arraste a pasta do projeto. Você recebe um link HTTPS na hora; a conta é gratuita.

### Passo 3 — Treinar com o quadro do kaizen (1 a 2 horas)

1. Monte o quadro **certo × errado** com peças reais (veja [Montar o quadro](#1-montar-o-quadro-certo--errado)).
2. No app, aba **🧠 Treinar**. Ele já vem com 3 classes: **Boa**, **Porosidade** e **Trinca**.
   Crie outras em **＋ Nova classe** (Mordedura, Falta de fusão, Respingo…) e escolha o item da norma correspondente.
3. Em cada classe, toque **📷 Fotografar** (ou **📁 Enviar fotos** se as fotos já estiverem no celular/PC).
   - Mínimo **20 fotos por classe**; o ideal é **50 ou mais**.
   - Varie ângulo, distância, luz e peça. Use a **Rajada ×10** movendo o celular devagar.
4. Toque **Treinar modelo**. Leva de segundos a 1 minuto.
5. Leia o painel **Qualidade do modelo** (veja [Ler a qualidade](#4-ler-a-tela-qualidade-do-modelo)).
6. Vá em **🔍 Inspecionar**, toque **Ligar câmera** e teste em **peças que não foram fotografadas**.
7. Errou? Toque **✋ Resultado errado?** e escolha a classe certa. A foto entra no treino. Depois treine de novo.

### Passo 4 — Levar o treino para outros celulares/PCs

1. No aparelho que treinou: aba **⚙️ Modelo → ⬆ Exportar**. No celular abre o "Compartilhar" (WhatsApp, e-mail, Drive…); no PC baixa um arquivo `.json`.
2. No outro aparelho: abra o app → **⚙️ Modelo → ⬇ Importar** → escolha o arquivo → **Substituir**.
3. Pronto: o outro aparelho já inspeciona com o mesmo modelo. **Exporte um backup toda semana.**

---

## Como o app funciona

```
 Câmera ──► recorte quadrado ──► MobileNet (base pré-treinada, congelada)
                                      │  mapa 7×7 × 1024 características
                                      ▼
                         média ► vetor de 1024 números
                                      │
                                      ▼
                  "cabeça" treinada com as SUAS fotos (camada linear + softmax)
                                      │  probabilidade de cada classe
                                      ▼
            soma Boa × soma Defeitos ► BOA / RUIM / INCERTO ► regra da AWS D1.1
```

**Transfer learning (aprendizado por transferência).** A *base* é uma rede neural (MobileNet)
que já foi treinada pelo Google com 1,2 milhão de fotos e sabe reconhecer bordas, texturas, furos, riscos e brilho.
O app **não** treina essa rede inteira, o que exigiria milhares de fotos e uma GPU. Ele treina só uma
"cabeça" pequena em cima dela, que aprende a separar as **suas** classes. Por isso funciona com dezenas
de fotos por classe e treina em segundos, no próprio celular.

**Aumento de dados.** Cada foto vira 5 exemplos: original, espelhada na horizontal, espelhada na vertical, girada 90° e mais escura.
Isso ajuda o modelo a não depender da posição do cordão nem da iluminação.

**Validação honesta.** No treino, o app separa as fotos em 5 partes (*validação cruzada*). Cada parte é
testada por um modelo que **não a viu** no treino. O acerto mostrado é, portanto, o acerto esperado em
peças novas parecidas com as do quadro. Depois o modelo final é treinado com todas as fotos.

**Confiança e decisão.**
- O app soma a probabilidade de todas as classes de defeito e a de todas as classes boas.
  Assim, se a IA estiver dividida entre dois defeitos (ex.: 45% porosidade + 40% trinca), o resultado é **RUIM** mesmo assim.
- Se nem "boa" nem "defeito" passar do **limite de confiança** (padrão 70%, ajustável), o resultado é **INCERTO**:
  reposicione a câmera ou chame o inspetor.
- Ao vivo, o resultado é uma média das últimas análises, para não "piscar".

**Mapa de calor.** Mostra em vermelho as regiões que mais pesaram para o defeito detectado
(*Class Activation Map*). É uma indicação aproximada, com resolução de 7×7 regiões, e não uma medição.

**Por que HTML/JavaScript (PWA) em vez de Streamlit?** Com Streamlit, a câmera ao vivo no celular exige
servidor Python ligado, componente WebRTC e servidor TURN; o app não instala nem funciona sem internet,
e as fotos iriam para o servidor. Como PWA, a IA roda **dentro do navegador** (TensorFlow.js): instala no celular e no PC,
funciona offline, publica de graça em HTTPS e as fotos não saem do aparelho.

---

## Norma AWS D1.1 dentro do app

A IA **não lê a norma**: ela aprende a reconhecer o **tipo de descontinuidade** pelas fotos que você classificou.
Quem decide o que fazer é uma **camada de regras** baseada nos critérios de aceitação da inspeção visual da
AWS D1.1 (Tabela 8.1 na edição 2020; Tabela 6.1 em edições anteriores).

Cada classe do app aponta para um item da norma, e isso define a **ação** mostrada na inspeção:

| Item da norma | Ação no app | Resumo do critério |
|---|---|---|
| Solda boa (aceitável) | **APROVAR** | Sem descontinuidades visíveis; confirmar tamanho da solda |
| Trinca | **REPROVAR** | Tolerância zero, qualquer tamanho |
| Falta de fusão | **REPROVAR** | Fusão completa obrigatória |
| Cratera não preenchida | **REPROVAR** | Crateras devem ser preenchidas até o tamanho da solda |
| Sobreposição (overlap) | **REPROVAR** | Perfil com sobreposição é inaceitável |
| Porosidade | **MEDIR** (ou REPROVAR em CJP transversal à tração) | Limite pela soma dos diâmetros dos poros, por carregamento/junta |
| Mordedura (undercut) | **MEDIR** | Profundidade máxima conforme espessura e carregamento |
| Filete subdimensionado | **MEDIR** | Tolerância por tamanho nominal e no máximo 10% do comprimento |
| Perfil irregular (convexidade/reforço) | **MEDIR** | Convexidade máxima pela largura da face; reforço ≤ 3 mm |
| Escória / abertura de arco | **CORRIGIR** | Remover escória; esmerilhar abertura de arco |
| Respingo / outro | **AVALIAR** | Conforme cliente/pintura ou inspetor |

**Parâmetros:** na aba **⚙️ Modelo → Norma**, escolha o *tipo de carregamento* (estático ou cíclico),
a *espessura* (< 25 mm ou ≥ 25 mm) e o *tipo de solda* (filete, chanfro, CJP transversal à tração). O limite mostrado
na inspeção muda conforme esses parâmetros. Toque **📘 Ver guia da norma** para ver todos os critérios aplicáveis.

**A foto não mede.** Critérios dimensionais (porosidade, mordedura, tamanho e perfil) aparecem como **MEDIR**,
com o limite da norma e como verificar. Quem mede é o inspetor, com calibre ou régua.

**Editar os textos:** os critérios ficam em [`norma/aws-d1.1.json`](norma/aws-d1.1.json), que é um resumo
parafraseado para treinamento e **não substitui a norma**. O time de qualidade deve **conferir esse arquivo com a edição
vigente da AWS D1.1** e com a especificação do cliente/projeto, e corrigir o que for necessário. Depois de editar,
publique de novo (veja [Para desenvolvedores](#para-desenvolvedores)).

---

## Processo de treinamento (detalhado)

### 1. Montar o quadro "certo × errado"

- Use **peças reais** do processo (mesmo material, processo de soldagem e acabamento) e não desenhos.
- Separe por classe, com uma etiqueta clara: **Boa**, **Porosidade**, **Trinca**, e as que forem relevantes
  (Mordedura, Falta de fusão, Respingo, Cratera…). Comece com poucas classes bem definidas.
- Cada amostra deve ser **classificada pelo inspetor qualificado** conforme a AWS D1.1. A IA aprende exatamente o que
  vocês ensinarem: foto na classe errada ensina errado.
- Tenha **várias peças diferentes por classe** (ideal: 5 ou mais), não só várias fotos da mesma peça.
- Separe algumas peças de cada classe **para teste** e não as fotografe no treino.

### 2. Fotografar

| Faça | Evite |
|---|---|
| Solda **dentro do quadro tracejado**, ocupando boa parte dele | Solda pequena no canto da imagem |
| Variar **ângulo** (0°, 30°, 45°), **distância** (10–30 cm) e **iluminação** | Todas as fotos iguais |
| Fotografar como será usado na inspeção (mesma distância, mesmo tipo de luz) | Treinar com luz de estúdio e inspecionar no chão de fábrica escuro |
| Usar a **🔦 lanterna** quando o ambiente estiver escuro | Reflexo forte que "estoura" a imagem |
| Fundo variado (bancada, chão, mão segurando) | Sempre o mesmo fundo em uma classe só, porque a IA pode aprender o fundo |
| Quantidades parecidas entre as classes | 200 fotos de Boa e 15 de Trinca |

- **Quantidade:** mínimo 20 fotos por classe para começar, **ideal 50 ou mais**. O app treina com 5 fotos
  por classe, mas o resultado será fraco.
- A barra abaixo de cada classe mostra o progresso até 50 fotos.
- **Rajada ×10:** tira 10 fotos em ~3 s. Mova o celular devagar durante a rajada para gerar variação.
- Fotos antigas (galeria, WhatsApp) podem entrar por **📁 Enviar fotos**. O app recorta o quadrado central.
- Para ver, mover para outra classe ou excluir uma foto, toque nela.

### 3. Treinar

Toque **🧠 Treinar modelo**. O app:
1. prepara as fotos que ainda não foram processadas;
2. faz a validação cruzada (5 rodadas);
3. treina o modelo final com todas as fotos e já o usa na inspeção.

Classes com menos de 5 fotos ficam de fora, e o app avisa quais foram. Depois de qualquer mudança nas fotos, aparece
um **!** vermelho na aba Treinar, lembrando de treinar de novo.

### 4. Ler a tela "Qualidade do modelo"

| Indicador | O que significa | Meta sugerida para liberar o uso |
|---|---|---|
| **Acerto geral** | % das fotos classificadas na classe certa, por um modelo que não as viu | ≥ 90% |
| **Defeitos detectados como RUIM** | das fotos de defeito, quantas deram RUIM (qualquer defeito); é o mais importante | ≥ 95% |
| **Soldas boas aprovadas** | das fotos boas, quantas deram BOA | ≥ 85% |
| **Acerto por classe** | onde o modelo está mais fraco | nenhuma classe < 80% |
| **Matriz de confusão** | linha = classe real, coluna = o que a IA disse; fora da diagonal = erro | — |
| **Fotos que confundiram o modelo** | as fotos que erraram na validação | revise uma por uma |

**Se o resultado estiver fraco:**
1. Abra as **fotos que confundiram o modelo**. Muitas vezes a foto está na **classe errada**: mova-a.
2. Adicione mais fotos **variadas** das classes com acerto baixo.
3. Verifique se as classes são realmente diferentes visualmente. Se não forem, junte-as.
4. Treine de novo.

### 5. Validar antes de liberar (recomendado para o kaizen)

1. Pegue as **peças de teste** separadas no passo 1, de 10 a 20 por classe.
2. Inspecione cada uma com o app e anote: resultado do app × classificação do inspetor.
3. Libere o uso como apoio somente se **nenhum defeito sair como BOA** e o acerto estiver dentro da meta.
4. Guarde essa planilha como registro do kaizen e repita após grandes mudanças no treino.

### 6. Ajustar o limite de confiança

Na aba **⚙️ Modelo → Inspeção**:
- **Limite maior (80–90%)**: mais resultados *INCERTO*, menos erros "com certeza". Use no começo.
- **Limite menor (60–70%)**: menos *INCERTO*, mas mais risco de erro.

---

## Usando na inspeção

1. Aba **🔍 Inspecionar → 📷 Ligar câmera**. No celular, a câmera traseira abre por padrão; **🔄** troca de câmera e **🔦** liga a lanterna.
2. Enquadre a solda dentro do **quadro tracejado** a 10–30 cm, como no treino.
3. Leia o resultado:
   - **✔ SOLDA BOA (verde):** a IA não viu defeito. Confirme dimensões conforme o desenho.
   - **✖ SOLDA RUIM (vermelho):** mostra o defeito, a confiança e o **critério da AWS D1.1** (REPROVAR / MEDIR / CORRIGIR…), com como verificar.
   - **? INCERTO (amarelo):** a IA não tem segurança. Mude o ângulo, a distância ou a luz, ou decida pela inspeção normal.
4. **⏸ Congelar** fixa a imagem para analisar com calma. **🖼 Analisar foto** analisa uma foto da galeria.
5. **✋ Resultado errado?** salva a imagem na classe correta. É a melhoria contínua do modelo; treine de novo no fim do dia.
6. A faixa no rodapé (ex.: *Norma: Estático · Menor que 25 mm · Solda de filete*) mostra os parâmetros da norma em uso. Toque nela para mudar.

---

## Manutenção do modelo

| Situação | O que fazer |
|---|---|
| O app errou numa peça | **✋ Resultado errado?** → classe correta → treinar de novo |
| Novo tipo de defeito | **Treinar → ＋ Nova classe**, escolher o item da norma, fotografar 20+ fotos, treinar |
| Classe com fotos erradas | Tocar na foto → *Mover para a classe* ou *Excluir* |
| Mudou a peça, o processo ou a iluminação | Fotografar exemplos novos nas classes e treinar de novo |
| Backup | **Modelo → ⬆ Exportar** toda semana; guarde o arquivo no Drive/rede |
| Novo celular/PC | Abrir o app → **Modelo → ⬇ Importar → Substituir** |
| Começar do zero | **Modelo → Zona de perigo → Apagar tudo** (exporte antes) |
| Mudar critérios da norma | Editar `norma/aws-d1.1.json` e publicar de novo |

**Boas práticas:**
- Defina **um responsável** pelo treino "oficial". Os outros aparelhos apenas importam o arquivo dele.
- Antes de trocar o arquivo oficial, rode a validação do passo 5.
- No **iPhone**, o Safari pode apagar dados de sites pouco usados: instale o app na tela inicial e **exporte backups**.

---

## Etapa 2 — base de solda (opcional)

A base padrão (MobileNet ImageNet) já funciona bem com as fotos do quadro. A **base de solda** é a mesma rede
**ajustada antes com milhares de fotos públicas de defeitos de solda** (trinca, porosidade, respingo…).
Assim, a IA chega ao treino do kaizen já "entendendo" solda, e costuma precisar de menos fotos e errar menos.

### Opção A — Google Colab (recomendado: grátis, com GPU, nada para instalar)

1. Abra https://colab.research.google.com → *Arquivo → Fazer upload de notebook* → escolha
   [`tools/pretrain/pretrain_colab.ipynb`](tools/pretrain/pretrain_colab.ipynb).
2. *Ambiente de execução → Alterar o tipo de ambiente → GPU T4*.
3. Crie uma conta gratuita no [Roboflow](https://roboflow.com) e copie sua chave de API.
4. Em [Roboflow Universe](https://universe.roboflow.com), busque **"weld defect"** e escolha um dataset com
   classes como *crack, porosity, spatter, good weld*. **Confira a licença** (ex.: CC BY 4.0) e cite a fonte se exigido.
5. Rode as células do notebook. O treino leva de 10 a 30 min, e no fim baixa `base-solda.zip`.

### Opção B — No PC

```bash
pip install -r tools/pretrain/requirements.txt
```

```bash
python tools/pretrain/train_weld_base.py --dados "C:\caminho\do\dataset"
```

- `--dados` aceita a exportação **YOLO** do Roboflow (pasta com `data.yaml`) ou **pastas por classe** (`dados/<classe>/*.jpg`).
- Use `--teste-rapido` para testar o ambiente em poucos minutos antes do treino completo.
- Sem GPU, o treino completo pode levar horas; nesse caso prefira o Colab.

### Conferir e ativar

1. Opcional, mas recomendado: confira se a exportação bate com o motor do app.

   ```bash
   cd tools && npm install && node pretrain/verificar_base.mjs
   ```

   Deve aparecer **✅ Base de solda compatível com o app**.
2. Coloque a pasta `base-solda` dentro de `models/`, ficando `models/base-solda/model.json`, e publique o app (commit + push).
3. No app: **⚙️ Modelo → Base de conhecimento da IA → Solda**. O app reprocessa as fotos e treina de novo sozinho.
4. Compare a **Qualidade do modelo** das duas bases e fique com a melhor.

> O pré-treino ajusta só a base. As classes do kaizen continuam sendo as suas e são treinadas no app.

---

## Instalar no celular e no PC

| Aparelho | Como instalar |
|---|---|
| **Android (Chrome)** | Abra o link → menu **⋮** → **Instalar app** (ou *Adicionar à tela inicial*) |
| **iPhone (Safari)** | Abra o link no **Safari** → botão **Compartilhar** → **Adicionar à Tela de Início** |
| **PC (Chrome/Edge)** | Abra o link → ícone de instalar na barra de endereço, ou menu → **Instalar Inspetor de Solda** |

A aba **⚙️ Modelo → Instalar o aplicativo** também mostra um botão de instalação quando o navegador permite.
Depois de instalado, o app abre como aplicativo, em tela cheia, e **funciona sem internet**.
Quando houver versão nova publicada, aparece a faixa azul **"Nova versão disponível → Atualizar"**.

---

## Limitações e segurança

- **Apoio, não decisão final.** A liberação da solda é responsabilidade do inspetor qualificado, conforme a AWS D1.1 e o projeto.
- **Só superfície.** A câmera não vê defeitos internos (falta de penetração, inclusões, porosidade interna). Use os ensaios (UT, RT, MT, PT) quando o projeto pedir.
- **Não mede.** Limites dimensionais (poros, mordedura, perna do filete, convexidade) precisam de calibre.
- **Depende do treino.** O modelo só conhece o que viu. Peças, materiais, processos ou iluminação muito diferentes do quadro reduzem o acerto; treine com exemplos novos.
- **Resumo da norma.** O arquivo `norma/aws-d1.1.json` é um resumo parafraseado e precisa ser conferido com a edição vigente da norma.
- **Privacidade.** Fotos e modelo ficam no aparelho (IndexedDB do navegador). Só saem dele quando você **exporta** o arquivo.

---

## Problemas comuns

| Problema | Solução |
|---|---|
| **A câmera não abre no celular** | O link precisa ser **https://** (GitHub Pages). Verifique se a permissão da câmera está liberada para o site nas configurações do navegador. |
| "Permissão da câmera negada" | Chrome: cadeado na barra de endereço → Permissões → Câmera → Permitir. iPhone: Ajustes → Safari → Câmera. |
| A câmera não abre no PC | Feche outros programas que usam a webcam (Teams, Zoom…). Use `http://localhost:8000`, não o IP. |
| `Iniciar app.bat` fecha sozinho / "Python não encontrado" | Instale o Python marcando *Add python to PATH*. |
| "SEM MODELO" na inspeção | Treine na aba Treinar ou importe um arquivo exportado. |
| Resultado muda o tempo todo | Aproxime-se, melhore a luz (🔦), segure firme; adicione fotos parecidas com essa situação e treine de novo. |
| Muito INCERTO | Mais fotos e mais variadas; ou baixe o limite de confiança para 60–65%. |
| Treino lento | Normal na primeira vez com muitas fotos (o app processa cada foto uma vez). Mantenha a tela ligada. |
| Atualizei o site mas o celular mostra a versão antiga | Toque na faixa **Atualizar**, ou feche e abra o app. |
| "Treinado com outra base — treine de novo" | A base foi trocada. Toque em Treinar modelo. |

---

## Para desenvolvedores

**Tecnologia:** HTML + CSS + JavaScript puro (módulos ES), sem etapa de build.
IA com [TensorFlow.js 4.22](https://www.tensorflow.org/js), copiado em `vendor/` para funcionar offline.
Dados em IndexedDB. Service worker para cache e uso offline.

```
index.html               página única (abas Inspecionar / Treinar / Modelo)
css/style.css            visual (tema escuro, botões grandes)
js/app.js                inicialização, estado, fila que calcula os vetores das fotos
js/model.js              motor de IA: base, vetores, previsão + mapa de calor, treino (JS puro) e validação cruzada
js/norma.js              regras da norma e decisão BOA / RUIM / INCERTO
js/camera.js             câmera (traseira, troca, lanterna)
js/store.js              IndexedDB (classes, fotos, vetores, modelo, configurações)
js/transfer.js           exportar / importar
js/imaging.js            recorte, conversões de imagem
js/tab-*.js              cada aba
js/ui.js                 utilitários de interface
norma/aws-d1.1.json      critérios da norma (editável)
models/bases.json        lista de bases da IA
models/base-geral/       MobileNet v1 1.0 224 (ImageNet) cortada em conv_pw_13_relu (7×7×1024)
models/base-solda/       (Etapa 2) gerada por tools/pretrain
sw.js                    service worker (cache offline)
servidor.py              servidor local (tipos MIME corretos, sem cache)
tests/selftest.html      autoteste do pipeline de IA
tools/prepare_base.mjs   recria models/base-geral a partir do MobileNet oficial
tools/gerar_icones.py    gera os ícones PNG
tools/pretrain/          Etapa 2 (script Python, notebook Colab, verificação no TF.js)
```

**Rodar localmente:** `python servidor.py` → http://localhost:8000.
Em `localhost` o service worker fica desligado para facilitar o desenvolvimento. Para testar o modo offline/instalação
localmente, abra `http://localhost:8000/?pwa`.

**Autoteste:** abra http://localhost:8000/tests/selftest.html. Ele gera imagens sintéticas de solda (boa,
porosidade, trinca) e verifica vetores, treino com validação cruzada, previsão, mapa de calor, regras da norma
e exportar → importar. Deve terminar com **✅ TODOS OS TESTES PASSARAM**.

**Publicar uma nova versão:**
1. Edite os arquivos.
2. Em `sw.js`, aumente `VERSAO` (ex.: `1.0.0` → `1.0.1`). Se criar arquivos novos, adicione-os em `ARQUIVOS`.
3. Opcional: atualize `VERSAO_APP` em `js/app.js`.
4. Faça commit e push para `main`. O GitHub Pages publica em ~1 minuto e os aparelhos mostram "Nova versão disponível".

**Recriar a base geral** (só se necessário): baixe `model.json` e os `group*-shard1of1` de
`https://storage.googleapis.com/tfjs-models/tfjs/mobilenet_v1_1.0_224/` para uma pasta e rode:

```bash
cd tools && npm install && node prepare_base.mjs <pasta_baixada> ../models/base-geral
```

**Detalhes do modelo:**
- Entrada 224×224 RGB normalizada para [-1, 1]; saída da base: mapa 7×7×1024 (camada `conv_pw_13_relu`).
- Vetor = média do mapa. Cada foto gera 5 vetores (original, espelhos H/V, rotação 90°, escurecida).
- Cabeça: regressão softmax com Adam, dropout 0,2, suavização de rótulos 0,1, L2 5e-4 e peso por classe. É treinada em JavaScript puro (~5–10 s).
- Validação cruzada estratificada (k = até 5) por foto: as variações de uma foto ficam sempre na mesma parte.
- Mapa de calor: pesos da cabeça aplicados em cada uma das 7×7 posições (CAM), contrastando a classe do defeito com as demais.
- A base de solda reaproveita a topologia de `models/base-geral/model.json`. O script grava os pesos ajustados do Keras
  diretamente no formato TF.js, sem o pacote `tensorflowjs`, e `verificar_base.mjs` confere o resultado numericamente.
