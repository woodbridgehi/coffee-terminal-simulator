"""Offline, versioned brand packages. No dependency on device/orders/runtime storage."""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import mimetypes
import os
import re
import secrets
import stat
import tempfile
import threading
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urlsplit
from xml.etree import ElementTree
from platform_paths import package_root

WEB = package_root() / "coffee-terminal" / "web"
SCHEMA = json.loads((WEB / "showcase/manifest.schema.json").read_text(encoding="utf-8"))
MAX_PACKAGE = 50 * 1024 * 1024
MAX_FILE = 4 * 1024 * 1024
EXTENSIONS = {".json", ".html", ".css", ".js", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".woff2", ".txt", ".md"}


class PackageError(ValueError):
    pass


def check_schema(value, spec=SCHEMA, path="manifest"):
    """Validate the JSON Schema vocabulary actually used by the bundled contract."""
    if "$ref" in spec:
        spec = SCHEMA["$defs"][spec["$ref"].split("/")[-1]]
    types = {"object": dict, "array": list, "string": str, "integer": int, "boolean": bool}
    kind = spec.get("type")
    if kind and type(value) is not types[kind]:
        raise PackageError(f"{path}: expected {kind}")
    if "const" in spec and (type(value) is not type(spec["const"]) or value != spec["const"]):
        raise PackageError(f"{path}: expected {spec['const']}")
    if "enum" in spec and value not in spec["enum"]:
        raise PackageError(f"{path}: unsupported value")
    if kind == "object":
        if set(spec.get("required", [])) - value.keys():
            raise PackageError(f"{path}: missing {sorted(set(spec['required']) - value.keys())}")
        if spec.get("additionalProperties") is False and value.keys() - spec.get("properties", {}).keys():
            raise PackageError(f"{path}: unknown fields {sorted(value.keys() - spec.get('properties', {}).keys())}")
        for key, child in value.items():
            check_schema(child, spec["properties"][key], f"{path}.{key}")
    if kind == "array":
        if not spec.get("minItems", 0) <= len(value) <= spec.get("maxItems", 999999):
            raise PackageError(f"{path}: invalid item count")
        for i, child in enumerate(value):
            check_schema(child, spec["items"], f"{path}[{i}]")
    if kind == "string":
        if not spec.get("minLength", 0) <= len(value) <= spec.get("maxLength", 999999):
            raise PackageError(f"{path}: invalid length")
        if "pattern" in spec and not re.search(spec["pattern"], value):
            raise PackageError(f"{path}: invalid format")
    if kind == "integer" and not spec.get("minimum", value) <= value <= spec.get("maximum", value):
        raise PackageError(f"{path}: out of range")


def safe_path(name):
    if not re.fullmatch(r"[A-Za-z0-9_./-]{1,180}", name) or any(p in ("", ".", "..") for p in name.split("/")):
        raise PackageError(f"unsafe package path: {name[:180]}")
    if PurePosixPath(name).is_absolute():
        raise PackageError("absolute paths are forbidden")
    if any(p.endswith('.') or re.fullmatch(r"(?i)(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\..*)?", p) for p in name.split('/')):
        raise PackageError("Windows reserved filenames are forbidden")
    return name


def strict_json(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise PackageError(f"duplicate JSON key: {key}")
            result[key] = value
        return result
    try:
        def invalid_constant(value):
            raise PackageError(f"non-JSON number: {value}")
        return json.loads(raw.decode('utf-8') if isinstance(raw, bytes) else raw, object_pairs_hook=pairs, parse_constant=invalid_constant)
    except (ValueError, UnicodeError, RecursionError) as exc:
        raise PackageError(f"invalid JSON: {exc}") from exc


def validate_manifest(manifest, files):
    check_schema(manifest)
    ids = set()
    playable = 0
    for slide in manifest["slides"]:
        sid, kind = slide["id"], slide["type"]
        if sid in ids:
            raise PackageError(f"duplicate slide id: {sid}")
        ids.add(sid)
        if 'layout' in slide and kind not in ('html', 'animation'):
            raise PackageError(f'{sid}: layout applies only to HTML/animation')
        if 'template' in slide and kind not in ('text', 'review'):
            raise PackageError(f'{sid}: template applies only to text/review')
        if 'approved' in slide and kind != 'review':
            raise PackageError(f'{sid}: approved applies only to reviews')
        if 'fit' in slide and kind in ('text', 'review'):
            raise PackageError(f'{sid}: text/review does not accept fit')
        if "duration" in slide and (kind not in ("text", "review") or "durationMs" in slide):
            raise PackageError(f"{sid}: auto duration only for text/review, mutually exclusive with durationMs")
        if kind in ("image", "svg", "product") and not 3000 <= slide.get("durationMs", 3500) <= 4000:
            raise PackageError(f"{sid}: image/svg/product duration must be 3000–4000ms")
        if "src" in slide and "srcByLocale" in slide:
            raise PackageError(f"{sid}: use src OR srcByLocale")
        sources = [slide["src"]] if "src" in slide else list(slide.get("srcByLocale", {}).values())
        if kind in ("image", "svg", "product", "html", "animation") and not sources:
            raise PackageError(f"{sid}: source required")
        if kind in ("text", "review") and (not slide.get("content") or sources):
            raise PackageError(f"{sid}: text/review needs content and no source")
        if kind in ("html", "animation") and "durationMs" not in slide:
            raise PackageError(f"{sid}: explicit durationMs required")
        if kind == "review" and slide.get("enabled", True) and slide.get("approved") is not True:
            raise PackageError(f"{sid}: enabled reviews must be approved")
        for source in sources:
            safe_path(source)
            if source not in files:
                raise PackageError(f"{sid}: missing file {source}")
            allowed = {".html"} if kind in ("html", "animation") else ({".svg"} if kind == "svg" else {".svg", ".png", ".jpg", ".jpeg", ".webp"})
            if Path(source).suffix.lower() not in allowed:
                raise PackageError(f"{sid}: incompatible source format")
        if slide.get("enabled", True) and kind != "product":
            playable += 1
    if not playable:
        raise PackageError("at least one enabled non-product slide is required for empty menus")
    if sum(s["type"] == "product" for s in manifest["slides"]) > 1:
        raise PackageError("only one product collection is allowed")
    return manifest


def validate_files(files):
    if len(files) > 256 or sum(len(b) for b in files.values()) > MAX_PACKAGE:
        raise PackageError("package exceeds 256 files or 50 MiB")
    for name, raw in files.items():
        safe_path(name)
        if len(raw) > MAX_FILE or Path(name).suffix.lower() not in EXTENSIONS:
            raise PackageError(f"{name}: unsupported format or larger than 4 MiB")
        if Path(name).suffix.lower() in {'.json', '.html', '.css', '.js', '.svg', '.txt', '.md'}:
            try:
                raw.decode('utf-8')
            except UnicodeError as exc:
                raise PackageError(f'{name}: UTF-8 required') from exc
        if Path(name).suffix.lower() == ".svg":
            if re.search(br"<!DOCTYPE|<!ENTITY", raw, re.I):
                raise PackageError(f"{name}: SVG entities are forbidden")
            try:
                tree = ElementTree.fromstring(raw)
                for node in tree.iter():
                    if node.tag.split('}')[-1].lower() in ("script", "foreignobject"):
                        raise PackageError(f"{name}: active SVG is forbidden; use animation HTML")
                    for key, value in node.attrib.items():
                        if key.split('}')[-1].lower().startswith("on"):
                            raise PackageError(f"{name}: SVG event handlers are forbidden")
                        if key.split('}')[-1] == "href" and not value.startswith(("#", "data:image/")):
                            raise PackageError(f"{name}: SVG references must be embedded")
            except ElementTree.ParseError as exc:
                raise PackageError(f"{name}: invalid SVG") from exc
    if "manifest.json" not in files:
        raise PackageError("manifest.json must be at ZIP root")
    return validate_manifest(strict_json(files["manifest.json"]), files)


def read_archive(raw):
    if len(raw) > MAX_PACKAGE:
        raise PackageError("ZIP exceeds 50 MiB")
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            entries = archive.infolist()
            if len(entries) > 512:
                raise PackageError("too many ZIP entries")
            files, seen, total = {}, set(), 0
            for info in entries:
                name = safe_path(info.filename.rstrip("/"))
                folded = name.casefold()
                if folded in seen:
                    raise PackageError("duplicate/case-colliding ZIP path")
                seen.add(folded)
                mode = info.external_attr >> 16
                if stat.S_ISLNK(mode) or (stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR)) or info.flag_bits & 1:
                    raise PackageError("links, special files and encrypted ZIPs are forbidden")
                if info.is_dir():
                    continue
                total += info.file_size
                if total > MAX_PACKAGE or info.file_size > MAX_FILE:
                    raise PackageError("expanded ZIP exceeds size limit")
                files[name] = archive.read(info)
    except (zipfile.BadZipFile, RuntimeError, NotImplementedError, OSError) as exc:
        raise PackageError(f"cannot read ZIP: {exc}") from exc
    return validate_files(files), files


class PackageStore:
    def __init__(self, root, builtin=None):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.builtin = Path(builtin or WEB / "showcase-packages/default")
        self.lock = threading.RLock()
        self.default = json.loads((self.builtin / "manifest.json").read_text(encoding="utf-8"))
        self.default_key = self.default["id"] + "/" + self.default["version"]

    def directory(self, key):
        if not re.fullmatch(r"[a-z][a-z0-9-]{0,47}/[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}", key):
            raise PackageError("invalid package/version")
        return self.builtin if key == self.default_key else self.root / "packages" / key

    def manifest(self, key):
        directory = self.directory(key)
        if not directory.is_dir():
            raise PackageError("package not installed")
        files = {str(p.relative_to(directory).as_posix()): p.read_bytes() for p in directory.rglob("*") if p.is_file()}
        return validate_files(files)

    def state(self):
        with self.lock:
            state = {}
            try:
                state = strict_json((self.root / "active.json").read_bytes())
                self.manifest(state["active"])
                if type(state.get('revision')) is not int:
                    raise PackageError('invalid active revision')
                return state
            except FileNotFoundError:
                if not state:
                    return {"active": self.default_key, "previous": None, "revision": 0, "lastError": None}
                reason = 'active package files are missing'
            except (OSError, KeyError, TypeError, PackageError) as exc:
                reason = str(exc)
            target = state.get('previous') if isinstance(state, dict) else None
            try:
                self.manifest(target)
            except (PackageError, OSError, TypeError):
                target = self.default_key
            revision = state.get('revision', 0) if isinstance(state, dict) else 0
            recovered = {"active": target, "previous": None, "revision": (revision if type(revision) is int else 0) + 1, "lastError": ('Invalid active package: ' + reason)[:500]}
            self._save(recovered)
            return recovered

    def _save(self, value):
        fd, name = tempfile.mkstemp(dir=self.root, prefix=".active-")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                json.dump(value, stream, ensure_ascii=False)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(name, self.root / "active.json")
        finally:
            Path(name).unlink(missing_ok=True)

    def install(self, raw):
        manifest, files = read_archive(raw)
        key = manifest["id"] + "/" + manifest["version"]
        with self.lock:
            dest = self.directory(key)
            if dest.exists():
                raise PackageError("version already exists; increase version instead of overwriting")
            with tempfile.TemporaryDirectory(dir=self.root, prefix=".import-") as temp:
                folder = Path(temp) / "payload"
                folder.mkdir()
                for name, data in files.items():
                    path = folder / name
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(data)
                dest.parent.mkdir(parents=True, exist_ok=True)
                os.replace(folder, dest)
        return {"key": key, "sha256": hashlib.sha256(raw).hexdigest(), "name": manifest["name"]}

    def activate(self, key):
        with self.lock:
            self.manifest(key)
            current = self.state()
            if current["active"] != key:
                self._save({"active": key, "previous": current["active"], "revision": current["revision"] + 1, "lastError": None})
            return self.state()

    def rollback(self, failed=None, reason=None):
        with self.lock:
            current = self.state()
            if failed and current["active"] != failed:
                return current  # Ignore failures from an obsolete player.
            target = current.get("previous") or self.default_key
            try:
                self.manifest(target)
            except (PackageError, OSError):
                target = self.default_key
            # Automatic fallback must not toggle two broken packages forever.
            self._save({"active": target, "previous": None if failed else current["active"], "revision": current["revision"] + 1, "lastError": str(reason)[:500] if reason else None})
            return self.state()

    def catalog(self):
        entries = [{"key": self.default_key, "name": self.default["name"]}]
        for path in sorted((self.root / "packages").glob("*/*/manifest.json")):
            try:
                manifest = strict_json(path.read_bytes())
                entries.append({"key": manifest["id"] + "/" + manifest["version"], "name": manifest["name"]})
            except (OSError, KeyError, PackageError):
                continue
        return {"packages": entries, **self.state()}


class ShowcaseServer:
    """Loopback-only static content and authenticated local package management."""
    def __init__(self, root, port=0):
        self.store = PackageStore(root)
        self.token = secrets.token_urlsafe(32)
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def send(self, status, body, content_type="application/json", public=False, html=False):
                if not isinstance(body, bytes):
                    body = json.dumps(body, ensure_ascii=False).encode()
                self.send_response(status)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("Referrer-Policy", "no-referrer")
                if public:
                    self.send_header("Access-Control-Allow-Origin", "*")
                if html:
                    self.send_header("Content-Security-Policy", owner.content_csp())
                elif content_type == "text/html":
                    self.send_header("Content-Security-Policy", "frame-src 'self'; object-src 'none'")
                self.end_headers()
                self.wfile.write(body)

            def authorized(self):
                return secrets.compare_digest(self.headers.get("X-Showcase-Token", ""), owner.token)

            def host_valid(self):
                return self.headers.get("Host") == urlsplit(owner.url).netloc

            def do_GET(self):
                if not self.host_valid():
                    return self.send(403, {"error": "invalid host"})
                path = unquote(urlsplit(self.path).path)
                try:
                    if path == "/active.json":
                        state = owner.store.state()
                        return self.send(200, {k: state[k] for k in ("active", "previous", "revision")}, public=True)
                    if path == "/api/catalog":
                        if not self.authorized():
                            return self.send(403, {"error": "management token required"})
                        return self.send(200, owner.store.catalog())
                    if path.startswith("/packs/"):
                        parts = path[len("/packs/"):].split("/", 2)
                        if len(parts) != 3:
                            raise PackageError("invalid asset path")
                        folder = owner.store.directory("/".join(parts[:2])).resolve()
                        filename = (folder / safe_path(parts[2])).resolve()
                        if not filename.is_relative_to(folder) or filename.suffix.lower() not in EXTENSIONS:
                            raise PackageError("invalid asset")
                        return self.send(200, filename.read_bytes(), mimetypes.guess_type(filename)[0] or "application/octet-stream", public=True, html=filename.suffix.lower() == ".html")
                    # Only trusted player/manager resources, never device files or APIs.
                    trusted = path.lstrip("/")
                    if trusted.startswith("showcase/") or trusted in {"styles.css", "brand-system.css"} or trusted.startswith("assets/brand/"):
                        target = (WEB / safe_path(trusted)).resolve()
                        if not target.is_relative_to(WEB.resolve()):
                            raise PackageError("invalid UI asset")
                        return self.send(200, target.read_bytes(), mimetypes.guess_type(target)[0] or "application/octet-stream")
                    return self.send(404, {"error": "not found"})
                except (PackageError, OSError) as exc:
                    return self.send(404, {"error": str(exc)[:300]})

            def do_POST(self):
                if not self.host_valid() or not self.authorized():
                    return self.send(403, {"error": "management token required"})
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                    if not 0 < length <= MAX_PACKAGE:
                        raise PackageError("invalid request size")
                    self.connection.settimeout(20)
                    raw = self.rfile.read(length)
                    path = urlsplit(self.path).path
                    if path == "/api/import":
                        result = owner.store.install(raw)
                    elif path == "/api/activate":
                        result = owner.store.activate(strict_json(raw)["key"])
                    elif path == "/api/rollback":
                        result = owner.store.rollback()
                    else:
                        return self.send(404, {"error": "not found"})
                    return self.send(200, {"ok": True, **result})
                except (PackageError, OSError, ValueError, KeyError, TypeError) as exc:
                    return self.send(400, {"ok": False, "error": str(exc)[:500]})

        self.server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
        self.server.daemon_threads = True
        self.url = f"http://127.0.0.1:{self.server.server_port}"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def content_csp(self):
        return ("sandbox allow-scripts; default-src 'none'; "
                f"script-src 'unsafe-inline' {self.url}/packs/; style-src 'unsafe-inline' {self.url}/packs/; "
                f"img-src data: {self.url}/packs/; font-src data: {self.url}/packs/; "
                "connect-src 'none'; media-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'")

    def connection(self):
        return {"publicUrl": self.url, "manageUrl": self.url + "/showcase/manager.html#" + self.token}

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)


def main():
    parser = argparse.ArgumentParser(description="Coffee Terminal offline showcase tools")
    parser.add_argument("command", choices=["validate", "serve", "import", "activate", "rollback"])
    parser.add_argument("value", nargs="?")
    parser.add_argument("--root", type=Path, default=Path(".showcase-local"))
    parser.add_argument("--port", type=int, default=0)
    args = parser.parse_args()
    if args.command == "validate":
        manifest, _ = read_archive(Path(args.value).read_bytes())
        print(json.dumps({"ok": True, "id": manifest["id"], "version": manifest["version"]}))
    elif args.command == "serve":
        server = ShowcaseServer(args.root, args.port)
        print(json.dumps(server.connection()), flush=True)
        try:
            threading.Event().wait()
        except KeyboardInterrupt:
            server.close()
    else:
        store = PackageStore(args.root)
        result = store.install(Path(args.value).read_bytes()) if args.command == "import" else (store.activate(args.value) if args.command == "activate" else store.rollback())
        print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except (PackageError, OSError) as exc:
        print(json.dumps({'ok': False, 'error': str(exc)}, ensure_ascii=False))
        raise SystemExit(2)
