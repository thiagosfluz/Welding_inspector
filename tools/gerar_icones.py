"""Gera os ícones PNG do app (mesmo desenho do icons/icon.svg). Requer: pip install pillow"""
from pathlib import Path
from PIL import Image, ImageDraw

RAIZ = Path(__file__).resolve().parent.parent / "icons"
FUNDO = (15, 20, 25, 255)


def desenhar(lado: int, margem: float = 0.0, arredondado: bool = True) -> Image.Image:
    escala = 4  # desenha maior e reduz (antialias)
    L = lado * escala
    img = Image.new("RGBA", (L, L), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if arredondado:
        d.rounded_rectangle([0, 0, L - 1, L - 1], radius=int(L * 0.22), fill=FUNDO)
    else:
        d.rectangle([0, 0, L, L], fill=FUNDO)

    # coordenadas no espaço 512, com margem (para ícone "maskable")
    k = (1 - 2 * margem) * L / 512
    o = margem * L

    def p(x, y):
        return (o + x * k, o + y * k)

    def ret(x0, y0, x1, y1, cor, r=10):
        d.rounded_rectangle([*p(x0, y0), *p(x1, y1)], radius=r * k, fill=cor)

    ret(56, 300, 246, 370, (100, 116, 139))
    ret(266, 300, 456, 370, (100, 116, 139))
    for cx in (146, 206, 266, 326, 376):
        d.ellipse([*p(cx - 42, 270), *p(cx + 42, 330)], fill=(245, 158, 11))
    w = int(26 * k)
    d.ellipse([*p(208, 98), *p(392, 282)], outline=(232, 237, 242), width=w)
    d.line([p(236, 254), p(176, 314)], fill=(232, 237, 242), width=int(30 * k))
    d.line([p(258, 190), p(288, 220), p(344, 160)], fill=(34, 197, 94), width=w, joint="curve")
    return img.resize((lado, lado), Image.LANCZOS)


if __name__ == "__main__":
    RAIZ.mkdir(exist_ok=True)
    desenhar(192).save(RAIZ / "icon-192.png")
    desenhar(512).save(RAIZ / "icon-512.png")
    desenhar(512, margem=0.12, arredondado=False).save(RAIZ / "icon-maskable-512.png")
    desenhar(180, arredondado=False).convert("RGB").save(RAIZ / "apple-touch-icon.png")
    print("ícones gerados em", RAIZ)
