"""Servidor local do Inspetor de Solda.

Uso:  python servidor.py            -> abre http://localhost:8000 no navegador
      python servidor.py 8080       -> outra porta

Não precisa instalar nada além do Python. A câmera funciona em "localhost" no próprio PC.
Para usar no celular, publique o app em HTTPS (GitHub Pages) — veja o README.
"""
import http.server
import socketserver
import sys
import webbrowser
from functools import partial
from pathlib import Path

PASTA = Path(__file__).resolve().parent
PORTA = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


class Handler(http.server.SimpleHTTPRequestHandler):
    # Tipos corretos (no Windows o registro às vezes devolve text/plain para .js)
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
        ".webmanifest": "application/manifest+json",
        ".svg": "image/svg+xml",
        ".bin": "application/octet-stream",
        ".png": "image/png",
        ".css": "text/css",
        ".html": "text/html; charset=utf-8",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # silencioso


class Servidor(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    with Servidor(("127.0.0.1", PORTA), partial(Handler, directory=str(PASTA))) as srv:
        url = f"http://localhost:{PORTA}"
        print(f"Inspetor de Solda rodando em {url}  (feche esta janela para parar)")
        if "--sem-navegador" not in sys.argv:
            webbrowser.open(url)
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            pass
