"""
Etapa 2 — gera a "base de solda" do Inspetor de Solda.

Pega a MobileNet (ImageNet) e ajusta (fine-tuning) com fotos públicas de defeitos de solda,
para a IA já "conhecer" solda antes de aprender com as fotos do quadro do kaizen.
O resultado é gravado em models/base-solda/ no mesmo formato que o app usa no navegador
(não precisa do pacote tensorflowjs: os pesos são escritos direto no formato TF.js).

Formatos de dados aceitos em --dados:
  1) Exportação do Roboflow em formato YOLO (pasta com data.yaml e train/valid/test com images/ e labels/).
     Cada caixa marcada vira um recorte quadrado da sua classe (trinca, porosidade, respingo...).
  2) Pastas por classe: dados/<classe>/*.jpg  (opcionalmente dentro de train/ valid/ test/).

Uso:
  pip install -r tools/pretrain/requirements.txt
  python tools/pretrain/train_weld_base.py --dados caminho/para/dataset
  node tools/pretrain/verificar_base.mjs      (opcional: confere a exportação com o TF.js)

Teste rápido (poucos minutos, só para ver se o ambiente funciona):
  python tools/pretrain/train_weld_base.py --dados caminho/para/dataset --teste-rapido
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")

import numpy as np
from PIL import Image, ImageOps

RAIZ = Path(__file__).resolve().parents[2]
MODELO_MODELO = RAIZ / "models" / "base-geral" / "model.json"  # topologia de referência
LADO = 224
EXT_IMG = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


# ----------------------------------------------------------------------------- dados
def ler_yaml(caminho: Path) -> dict:
    try:
        import yaml
        return yaml.safe_load(caminho.read_text(encoding="utf-8"))
    except ImportError:
        sys.exit("Instale pyyaml: pip install pyyaml")


def nomes_classes_yolo(dados_yaml: dict) -> list[str]:
    nomes = dados_yaml.get("names")
    if isinstance(nomes, dict):
        return [nomes[k] for k in sorted(nomes, key=lambda x: int(x))]
    return list(nomes)


def caixa_do_rotulo(valores: list[float]):
    """YOLO: 'cls cx cy w h' (caixa) ou 'cls x1 y1 x2 y2 ...' (polígono). Retorna x0,y0,x1,y1 normalizados."""
    if len(valores) == 4:
        cx, cy, w, h = valores
        return cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2
    xs, ys = valores[0::2], valores[1::2]
    return min(xs), min(ys), max(xs), max(ys)


def recortar(img: Image.Image, x0, y0, x1, y1, margem: float) -> Image.Image:
    W, H = img.size
    cx, cy = (x0 + x1) / 2 * W, (y0 + y1) / 2 * H
    lado = max((x1 - x0) * W, (y1 - y0) * H) * (1 + 2 * margem)
    lado = max(lado, 32)
    caixa = (int(cx - lado / 2), int(cy - lado / 2), int(cx + lado / 2), int(cy + lado / 2))
    return img.crop(caixa).resize((LADO, LADO), Image.BICUBIC)  # fora da imagem fica preto (borda)


def preparar_yolo(pasta: Path, cache: Path, margem: float, min_lado: int, max_por_classe: int):
    cfg = ler_yaml(pasta / "data.yaml")
    nomes = nomes_classes_yolo(cfg)
    print(f"Dataset YOLO com {len(nomes)} classes: {nomes}")
    amostras = []  # (caminho_recorte, classe, divisao)
    contagem = Counter()
    for divisao in ("train", "valid", "test"):
        pasta_img = pasta / divisao / "images"
        pasta_lbl = pasta / divisao / "labels"
        if not pasta_img.exists():
            continue
        imagens = sorted(p for p in pasta_img.iterdir() if p.suffix.lower() in EXT_IMG)
        print(f"  {divisao}: {len(imagens)} imagens")
        for p in imagens:
            rotulo = pasta_lbl / (p.stem + ".txt")
            if not rotulo.exists():
                continue
            linhas = [l.split() for l in rotulo.read_text().splitlines() if l.strip()]
            if not linhas:
                continue
            try:
                img = ImageOps.exif_transpose(Image.open(p)).convert("RGB")
            except Exception as e:  # imagem corrompida
                print(f"    ignorada {p.name}: {e}")
                continue
            W, H = img.size
            for i, partes in enumerate(linhas):
                cls = int(float(partes[0]))
                nome = nomes[cls] if cls < len(nomes) else f"classe_{cls}"
                if contagem[nome] >= max_por_classe:
                    continue
                x0, y0, x1, y1 = caixa_do_rotulo([float(v) for v in partes[1:]])
                if max((x1 - x0) * W, (y1 - y0) * H) < min_lado:
                    continue
                destino = cache / divisao / nome / f"{p.stem}_{i}.jpg"
                if not destino.exists():
                    destino.parent.mkdir(parents=True, exist_ok=True)
                    recortar(img, x0, y0, x1, y1, margem).save(destino, quality=92)
                amostras.append((destino, nome, divisao))
                contagem[nome] += 1
    return amostras


def preparar_pastas(pasta: Path, max_por_classe: int):
    amostras = []
    divisoes = [d for d in ("train", "valid", "test") if (pasta / d).is_dir()]
    raizes = [(pasta / d, d) for d in divisoes] or [(pasta, "train")]
    contagem = Counter()
    for raiz, divisao in raizes:
        for pasta_classe in sorted(p for p in raiz.iterdir() if p.is_dir()):
            for img in sorted(pasta_classe.rglob("*")):
                if img.suffix.lower() in EXT_IMG and contagem[pasta_classe.name] < max_por_classe:
                    amostras.append((img, pasta_classe.name, divisao))
                    contagem[pasta_classe.name] += 1
    return amostras


def dividir(amostras, frac_val=0.15, semente=42):
    """Usa 'valid'/'test' do dataset como validação; se não houver, separa 15% por classe."""
    if any(d != "train" for _, _, d in amostras):
        treino = [(p, c) for p, c, d in amostras if d == "train"]
        val = [(p, c) for p, c, d in amostras if d != "train"]
        if treino and val:
            return treino, val
    rnd = random.Random(semente)
    por = defaultdict(list)
    for p, c, _ in amostras:
        por[c].append(p)
    treino, val = [], []
    for c, lista in por.items():
        rnd.shuffle(lista)
        n_val = max(1, int(len(lista) * frac_val)) if len(lista) >= 5 else 0
        val += [(p, c) for p in lista[:n_val]]
        treino += [(p, c) for p in lista[n_val:]]
    return treino, val


# ----------------------------------------------------------------------------- modelo
def construir(tf, keras, n_classes: int):
    base = keras.applications.MobileNet(input_shape=(LADO, LADO, 3), alpha=1.0, include_top=False, weights="imagenet")
    entrada = keras.Input((LADO, LADO, 3))
    x = base(entrada, training=False)  # BatchNorm sempre em modo inferência (melhor p/ poucos dados)
    x = keras.layers.GlobalAveragePooling2D()(x)
    x = keras.layers.Dropout(0.3)(x)
    saida = keras.layers.Dense(n_classes, activation="softmax")(x)
    return base, keras.Model(entrada, saida)


def pipeline(tf, itens, classes, lote, treino: bool):
    idx = {c: i for i, c in enumerate(classes)}
    caminhos = [str(p) for p, _ in itens]
    rotulos = [idx[c] for _, c in itens]
    ds = tf.data.Dataset.from_tensor_slices((caminhos, rotulos))
    if treino:
        ds = ds.shuffle(len(caminhos), reshuffle_each_iteration=True)

    def carregar(caminho, rotulo):
        img = tf.io.decode_image(tf.io.read_file(caminho), channels=3, expand_animations=False)
        img = tf.image.resize(tf.cast(img, tf.float32), (LADO, LADO))
        return img, rotulo

    def aumentar(img, rotulo):
        img = tf.image.random_flip_left_right(img)
        img = tf.image.random_flip_up_down(img)
        img = tf.image.rot90(img, tf.random.uniform([], 0, 4, dtype=tf.int32))
        img = tf.image.random_brightness(img, 40.0)
        img = tf.image.random_contrast(img, 0.75, 1.3)
        return tf.clip_by_value(img, 0.0, 255.0), rotulo

    ds = ds.map(carregar, num_parallel_calls=tf.data.AUTOTUNE)
    if treino:
        ds = ds.map(aumentar, num_parallel_calls=tf.data.AUTOTUNE)
    ds = ds.map(lambda x, y: (x / 127.5 - 1.0, y))  # mesma normalização do app
    return ds.batch(lote).prefetch(tf.data.AUTOTUNE)


# ----------------------------------------------------------------------------- exportação TF.js
def nome_peso(camada, peso) -> str:
    # Keras 2: 'conv1/kernel:0'  ·  Keras 3: 'kernel'
    return f"{camada.name}/{peso.name.split('/')[-1].split(':')[0]}"


def exportar_tfjs(base, destino: Path, metadados: dict):
    """Escreve os pesos da base ajustada no formato layers-model do TF.js, reaproveitando a
    topologia de models/base-geral/model.json (mesma arquitetura MobileNet v1 1.0 224)."""
    modelo = json.loads(MODELO_MODELO.read_text(encoding="utf-8"))
    especificacoes = modelo["weightsManifest"][0]["weights"]
    pesos = {}
    for camada in base.layers:
        for p in camada.weights:
            pesos[nome_peso(camada, p)] = np.asarray(p.numpy(), dtype=np.float32)
    blocos = []
    for esp in especificacoes:
        # Keras 3 chama o peso da DepthwiseConv2D de 'kernel'; o TF.js/Keras 2 de 'depthwise_kernel'.
        candidatos = [esp["name"], esp["name"].replace("/depthwise_kernel", "/kernel")]
        nome = next((c for c in candidatos if c in pesos), None)
        if nome is None:
            raise RuntimeError(f"Peso {esp['name']} não encontrado no modelo Keras")
        arr = pesos[nome]
        if list(arr.shape) != list(esp["shape"]):
            raise RuntimeError(f"Formato diferente em {esp['name']}: {arr.shape} vs {esp['shape']}")
        blocos.append(arr.astype("<f4").tobytes())
    dados = b"".join(blocos)
    destino.mkdir(parents=True, exist_ok=True)
    for antigo in destino.glob("pesos*.bin"):
        antigo.unlink()
    caminhos, TAM = [], 4 * 1024 * 1024
    for i in range(0, len(dados), TAM):
        nome = f"pesos{i // TAM + 1}.bin"
        (destino / nome).write_bytes(dados[i:i + TAM])
        caminhos.append(nome)
    modelo["weightsManifest"] = [{"paths": caminhos, "weights": especificacoes}]
    modelo["convertedBy"] = "tools/pretrain/train_weld_base.py"
    modelo["userDefinedMetadata"] = metadados
    (destino / "model.json").write_text(json.dumps(modelo), encoding="utf-8")
    print(f"Base exportada em {destino} ({len(dados) / 1e6:.1f} MB, {len(caminhos)} arquivos)")


def gravar_verificacao(tf, base, pasta: Path):
    """Salva uma entrada fixa e o vetor esperado, para conferir no TF.js (verificar_base.mjs)."""
    rnd = np.random.RandomState(0)
    x = rnd.uniform(-1, 1, (1, LADO, LADO, 3)).astype(np.float32)
    vetor = tf.reduce_mean(base(x, training=False), axis=[1, 2]).numpy()[0]
    pasta.mkdir(parents=True, exist_ok=True)
    (pasta / "verificacao_entrada.bin").write_bytes(x.astype("<f4").tobytes())
    (pasta / "verificacao.json").write_text(json.dumps({"vetor": [float(v) for v in vetor]}), encoding="utf-8")


# ----------------------------------------------------------------------------- principal
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dados", required=True, type=Path, help="pasta do dataset (YOLO do Roboflow ou pastas por classe)")
    ap.add_argument("--saida", type=Path, default=RAIZ / "models" / "base-solda")
    ap.add_argument("--trabalho", type=Path, default=Path(__file__).resolve().parent / "saida", help="recortes e relatórios")
    ap.add_argument("--epocas-cabeca", type=int, default=5)
    ap.add_argument("--epocas-ajuste", type=int, default=12)
    ap.add_argument("--lote", type=int, default=32)
    ap.add_argument("--margem", type=float, default=0.15, help="margem em volta de cada caixa (fração)")
    ap.add_argument("--min-lado", type=int, default=20, help="ignora caixas menores que isso (px)")
    ap.add_argument("--max-por-classe", type=int, default=4000)
    ap.add_argument("--camada-inicial", default="conv_dw_9", help="ajusta desta camada em diante")
    ap.add_argument("--teste-rapido", action="store_true", help="1 época de cada fase e no máximo 60 imagens por classe")
    args = ap.parse_args()

    if not args.dados.exists():
        sys.exit(f"Pasta não encontrada: {args.dados}")
    if args.teste_rapido:
        args.epocas_cabeca, args.epocas_ajuste, args.max_por_classe = 1, 1, 60

    import tensorflow as tf
    try:
        import keras
    except ImportError:
        from tensorflow import keras
    print(f"TensorFlow {tf.__version__} · Keras {keras.__version__} · GPU: {bool(tf.config.list_physical_devices('GPU'))}")
    keras.utils.set_random_seed(42)

    inicio = time.time()
    if (args.dados / "data.yaml").exists():
        amostras = preparar_yolo(args.dados, args.trabalho / "recortes", args.margem, args.min_lado, args.max_por_classe)
    else:
        amostras = preparar_pastas(args.dados, args.max_por_classe)
    if not amostras:
        sys.exit("Nenhuma imagem encontrada. Confira o formato da pasta (veja o topo deste arquivo).")
    treino, val = dividir(amostras)
    classes = sorted({c for _, c in treino})
    val = [(p, c) for p, c in val if c in classes]
    cont = Counter(c for _, c in treino)
    print(f"Treino: {len(treino)} recortes · Validação: {len(val)} · Classes: {dict(cont)}")
    if len(classes) < 2:
        sys.exit("São necessárias pelo menos 2 classes.")

    total = sum(cont.values())
    pesos_classe = {i: total / (len(classes) * cont[c]) for i, c in enumerate(classes)}
    ds_treino = pipeline(tf, treino, classes, args.lote, True)
    ds_val = pipeline(tf, val, classes, args.lote, False) if val else None

    base, modelo = construir(tf, keras, len(classes))

    print("\nFase 1/2: treinando só a cabeça (base congelada)")
    base.trainable = False
    modelo.compile(optimizer=keras.optimizers.Adam(1e-3), loss="sparse_categorical_crossentropy", metrics=["accuracy"])
    modelo.fit(ds_treino, validation_data=ds_val, epochs=args.epocas_cabeca, class_weight=pesos_classe, verbose=2)

    print(f"\nFase 2/2: ajuste fino da base a partir de '{args.camada_inicial}'")
    base.trainable = True
    nomes = [l.name for l in base.layers]
    corte = nomes.index(args.camada_inicial) if args.camada_inicial in nomes else int(len(nomes) * 0.6)
    for camada in base.layers[:corte]:
        camada.trainable = False
    for camada in base.layers:
        if isinstance(camada, keras.layers.BatchNormalization):
            camada.trainable = False  # mantém estatísticas do ImageNet (estável com poucos dados)
    modelo.compile(optimizer=keras.optimizers.Adam(1e-4), loss="sparse_categorical_crossentropy", metrics=["accuracy"])
    callbacks = [keras.callbacks.EarlyStopping(monitor="val_accuracy" if ds_val else "accuracy", patience=3, restore_best_weights=True)]
    modelo.fit(ds_treino, validation_data=ds_val, epochs=args.epocas_ajuste, class_weight=pesos_classe, callbacks=callbacks, verbose=2)

    relatorio = {"classes": classes, "treino_por_classe": dict(cont), "validacao": len(val)}
    if ds_val:
        verdadeiro = np.array([classes.index(c) for _, c in val])
        previsto = np.argmax(modelo.predict(ds_val, verbose=0), axis=1)
        relatorio["acerto_validacao"] = float((verdadeiro == previsto).mean())
        matriz = np.zeros((len(classes), len(classes)), dtype=int)
        for v, p in zip(verdadeiro, previsto):
            matriz[v, p] += 1
        relatorio["matriz_confusao"] = matriz.tolist()
        print(f"\nAcerto na validação: {relatorio['acerto_validacao']:.1%}")
        for i, c in enumerate(classes):
            tot = matriz[i].sum()
            print(f"  {c:>25}: {matriz[i, i]}/{tot} ({matriz[i, i] / max(tot, 1):.0%})")

    relatorio["minutos"] = round((time.time() - inicio) / 60, 1)
    exportar_tfjs(base, args.saida, {
        "descricao": "MobileNet v1 1.0 ajustada com fotos de defeitos de solda",
        "classes_pretreino": classes,
        "acerto_validacao": relatorio.get("acerto_validacao"),
        "gerado_em": time.strftime("%Y-%m-%d %H:%M"),
    })
    gravar_verificacao(tf, base, args.trabalho)
    args.trabalho.mkdir(parents=True, exist_ok=True)
    (args.trabalho / "relatorio.json").write_text(json.dumps(relatorio, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nPronto em {relatorio['minutos']} min. Relatório: {args.trabalho / 'relatorio.json'}")
    print("Próximo passo: publique a pasta models/base-solda junto com o app e, no app, aba Modelo → Base de conhecimento → Solda.")


if __name__ == "__main__":
    main()
