"""Serve only public simulator UI assets, never instance configuration or secrets."""
from __future__ import annotations

import argparse
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import webbrowser

WEB_ROOT = Path(__file__).resolve().parents[1] / "coffee-terminal" / "web"


class SceneHandler(SimpleHTTPRequestHandler):
    def list_directory(self, path):
        self.send_error(404)
        return None

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()


def main():
    parser = argparse.ArgumentParser(description="本地三维咖啡工作站（不连接云端）")
    parser.add_argument("--port", type=int, default=9120)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--twin", action="store_true", help="打开数字孪生仿真实验室")
    args = parser.parse_args()
    entry = "digital-twin" if args.twin else "robot-scene"
    if not (WEB_ROOT / f"{entry}.bundle.js").is_file():
        raise SystemExit(f"缺少三维资源，请执行 npm ci && npm run build:{'twin' if args.twin else 'scene'}")
    try:
        server = ThreadingHTTPServer(("127.0.0.1", args.port), functools.partial(SceneHandler, directory=str(WEB_ROOT)))
    except OSError as exc:
        raise SystemExit(f"启动失败：{exc}。可使用 --port 指定其他端口。") from exc
    url = f"http://127.0.0.1:{server.server_port}/{entry}.html"
    print(f"三维工作站：{url}\n按 Ctrl+C 停止。此服务仅提供本地演示，不连接云端。", flush=True)
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
