#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
like-zdav.py — dsh-like-zcode 的单文件极简 WebDAV 服务端(纯 Python 标准库)。

为「只有一台 ECS/云服务器、不想上 OSS」的用户准备:
    scp  server/like-zdav.py  user@你的ECS:~/like-zdav.py
    ssh  user@你的ECS "nohup python3 ~/like-zdav.py --dir ~/backup --port 8060 --token 换个长口令 >/dev/null 2>&1 &"

然后在插件设置里选 WebDAV:
    地址 = http://ECS公网IP:8060   用户名 = 任意   密码 = 你设的 token

只实现 dsh-like-zcode 实际用到的六个方法(MKCOL/PUT/GET/HEAD/DELETE/PROPFIND),
约两百行,可整个读完——数据只落在 --dir 指定的目录里。别学 ZCode。
"""

import argparse
import base64
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

try:
    import shutil
except ImportError:  # pragma: no cover
    shutil = None

BANNER = "dsh-like-zcode server · 用户本人主动开启并知情 · 别学 ZCode。"
# HTTP 响应头只允许 latin-1,标记头用 ASCII(中文放不进去,这也是个知识点)
TAG_HEADER = "dsh-like-zcode; user-initiated and informed; do-not-learn-from-ZCode"


def http_date(ts: float) -> str:
    return time.strftime("%a, %d %b %Y %H:%M:%S GMT", time.gmtime(ts))


class DavState:
    def __init__(self, root: str, token: str):
        self.root = os.path.realpath(root)
        self.token = token

    def safe_path(self, raw: str) -> str | None:
        """把请求路径解析到 root 之内;越界一律拒绝(防目录穿越)。"""
        path = unquote(urlparse(raw).path)
        path = path.rstrip("/") or "/"
        candidate = os.path.realpath(os.path.join(self.root, path.lstrip("/")))
        if candidate != self.root and not candidate.startswith(self.root + os.sep):
            return None
        return candidate

    def authorized(self, header: str | None) -> bool:
        if not self.token:
            return True
        if not header or not header.startswith("Basic "):
            return False
        try:
            decoded = base64.b64decode(header[6:].strip()).decode("utf-8")
        except Exception:
            return False
        _, _, password = decoded.partition(":")
        return password == self.token


def make_handler(state: DavState):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        server_version = "like-zdav/1.0"

        # ── 基础设施 ──────────────────────────────────────────────────────────
        def log_message(self, fmt, *args):  # 安静模式:出错的细节交给响应码
            if os.environ.get("LZDAV_VERBOSE"):
                sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

        def _send(self, code: int, body: bytes = b"", ctype: str = "text/plain; charset=utf-8", extra=None):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("X-Like-ZCode", TAG_HEADER)
            extras = dict(extra or {})
            # extra 里的头优先生效(HEAD 用它声明真实文件大小,避免重复 Content-Length)
            for key, value in extras.items():
                self.send_header(key, value)
            if not any(key.lower() == "content-length" for key in extras):
                self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if body and self.command != "HEAD":
                self.wfile.write(body)

        def _deny(self):
            self._send(401, b"unauthorized", extra={"WWW-Authenticate": 'Basic realm="like-zdav"'})

        def _guard(self) -> str | None:
            """鉴权 + 路径解析;失败时已发送响应并返回 None。"""
            if not state.authorized(self.headers.get("Authorization")):
                self._deny()
                return None
            target = state.safe_path(self.path)
            if target is None:
                self._send(403, b"forbidden")
                return None
            return target

        # ── 六个方法 ─────────────────────────────────────────────────────────
        def do_MKCOL(self):
            target = self._guard()
            if target is None:
                return
            os.makedirs(target, exist_ok=True)  # 宽容:父目录一并创建
            self._send(201)

        def do_PUT(self):
            target = self._guard()
            if target is None:
                return
            length = int(self.headers.get("Content-Length") or 0)
            os.makedirs(os.path.dirname(target), exist_ok=True)
            written = 0
            with open(target, "wb") as fh:
                while written < length:
                    chunk = self.rfile.read(min(1024 * 1024, length - written))
                    if not chunk:
                        break
                    fh.write(chunk)
                    written += len(chunk)
            self._send(201, extra={"Content-Length": "0"} if False else None)

        def do_GET(self):
            target = self._guard()
            if target is None:
                return
            if os.path.isdir(target):
                self._send(200, b"", ctype="text/plain; charset=utf-8")
                return
            if not os.path.isfile(target):
                self._send(404, b"not found")
                return
            size = os.path.getsize(target)
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(size))
            self.send_header("Last-Modified", http_date(os.path.getmtime(target)))
            self.end_headers()
            with open(target, "rb") as fh:
                while True:
                    chunk = fh.read(1024 * 1024)
                    if not chunk:
                        break
                    self.wfile.write(chunk)

        def do_HEAD(self):
            target = self._guard()
            if target is None:
                return
            if os.path.isfile(target):
                self._send(200, ctype="application/octet-stream",
                           extra={"Content-Length": str(os.path.getsize(target))})
            else:
                self._send(404, b"not found")

        def do_DELETE(self):
            target = self._guard()
            if target is None:
                return
            if not os.path.exists(target):
                self._send(404, b"not found")
            elif os.path.isdir(target):
                if shutil is not None:
                    shutil.rmtree(target, ignore_errors=True)
                self._send(204)
            else:
                os.unlink(target)
                self._send(204)

        def do_PROPFIND(self):
            target = self._guard()
            if target is None:
                return
            depth = (self.headers.get("Depth") or "0").strip()
            if not os.path.exists(target):
                self._send(404, b"not found")
                return
            length = int(self.headers.get("Content-Length") or 0)
            if length:
                self.rfile.read(length)

            href_base = urlparse(self.path).path.rstrip("/")
            names = []
            if depth == "1" and os.path.isdir(target):
                names = sorted(os.listdir(target))

            rows = [self._prop_row(href_base or "/", os.path.isdir(target), os.path.getsize(target) if os.path.isfile(target) else 0,
                                   os.path.getmtime(target) if os.path.exists(target) else time.time())]
            for name in names:
                child = os.path.join(target, name)
                rows.append(self._prop_row(f"{href_base}/{name}", os.path.isdir(child),
                                           os.path.getsize(child) if os.path.isfile(child) else 0,
                                           os.path.getmtime(child)))
            xml = ('<?xml version="1.0" encoding="utf-8"?>'
                   '<D:multistatus xmlns:D="DAV:">' + "".join(rows) + "</D:multistatus>").encode("utf-8")
            self._send(207, xml, ctype="application/xml; charset=utf-8")

        @staticmethod
        def _prop_row(href: str, is_dir: bool, size: int, mtime: float) -> str:
            display = '<D:resourcetype><D:collection/></D:resourcetype>' if is_dir else \
                      f'<D:getcontentlength>{size}</D:getcontentlength>'
            return (f"<D:response><D:href>{href}</D:href><D:propstat><D:prop>{display}"
                    f"<D:getlastmodified>{http_date(mtime)}</D:getlastmodified></D:prop>"
                    "<D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>")

    return Handler


def main() -> int:
    parser = argparse.ArgumentParser(description="like-zdav:单文件极简 WebDAV 服务端(dsh-like-zcode 配套)")
    parser.add_argument("--dir", default="./backup", help="备份落盘目录(默认 ./backup,自动创建)")
    parser.add_argument("--host", default="0.0.0.0", help="监听地址(默认 0.0.0.0;只想本机用改 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8060, help="监听端口(默认 8060)")
    parser.add_argument("--token", default="", help="访问口令(强烈建议设置;WebDAV 密码栏填它)")
    args = parser.parse_args()

    os.makedirs(args.dir, exist_ok=True)
    state = DavState(args.dir, args.token)

    print(f"[like-zdav] {BANNER}", flush=True)
    print(f"[like-zdav] dir={state.root} listen={args.host}:{args.port} auth={'token' if args.token else '关闭(不建议)'}", flush=True)

    server = ThreadingHTTPServer((args.host, args.port), make_handler(state))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("[like-zdav] bye", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
