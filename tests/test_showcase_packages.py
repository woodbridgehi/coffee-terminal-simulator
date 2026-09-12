import io
import json
import stat
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "coffee-terminal"))
from showcase_packages import PackageError, PackageStore, ShowcaseServer, read_archive


def payload(version="1.0.0"):
    return {"schemaVersion": 1, "id": "partner-test", "version": version, "name": "Test",
            "designSize": {"width": 1600, "height": 1100}, "slides": [
                {"id": "intro", "type": "text", "content": {"zh-CN": {"title": "咖啡"}, "en-US": {"title": "Coffee"}}}
            ]}


def archive(manifest=None, extra=None):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("manifest.json", json.dumps(manifest or payload()))
        for name, value in (extra or {}).items():
            z.writestr(name, value)
    return stream.getvalue()


class ShowcasePackagesTest(unittest.TestCase):
    def test_strict_schema_locales_unknown_fields_and_limits(self):
        for mutate in [lambda m: m.update(schemaVersion=2), lambda m: m.update(unexpected=True),
                       lambda m: m["slides"][0]["content"].pop("en-US"),
                       lambda m: m["slides"][0].update(durationMs=24001),
                       lambda m: m["slides"].append(m["slides"][0])]:
            m = payload(); mutate(m)
            with self.assertRaises(PackageError):
                read_archive(archive(m))

    def test_paths_symlinks_duplicates_and_bombs(self):
        for path in ["../escape.txt", "/absolute.txt", "assets/../escape.txt", "assets\\escape.txt", "assets/CON.txt", "assets/trailing."]:
            with self.assertRaises(PackageError):
                read_archive(archive(extra={path: "bad"}))
        with self.assertRaises(PackageError):
            read_archive(archive(extra={"assets/A.txt": "a", "assets/a.txt": "b"}))
        with self.assertRaises(PackageError):
            read_archive(archive(extra={"assets/bomb.txt": "x" * (4 * 1024 * 1024 + 1)}))
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, "w") as z:
            info = zipfile.ZipInfo("assets/link.txt"); info.external_attr = (stat.S_IFLNK | 0o777) << 16
            z.writestr(info, "/etc/passwd")
        with self.assertRaises(PackageError):
            read_archive(stream.getvalue())

    def test_svg_active_content_rejected(self):
        for svg in ['<svg><script>alert(1)</script></svg>', '<svg onload="x()"/>', '<svg><image href="https://example.com/a.png"/></svg>', '<!DOCTYPE svg><svg/>']:
            with self.assertRaises(PackageError):
                read_archive(archive(extra={"assets/unsafe.svg": svg}))

    def test_media_rules_empty_menu_fallback_and_review_approval(self):
        for slide in [{"id":"one","type":"image","src":"assets/missing.png"},
                      {"id":"one","type":"html","src":"slides/a.html"},
                      {"id":"one","type":"product","src":"assets/a.svg"},
                      {"id":"one","type":"review","content":payload()["slides"][0]["content"]}]:
            m=payload();m["slides"]=[slide]
            with self.assertRaises(PackageError):
                read_archive(archive(m,{"slides/a.html":"<html></html>","assets/a.svg":"<svg/>"}))

    def test_import_is_inactive_versions_are_immutable_and_rollback_persists(self):
        with tempfile.TemporaryDirectory() as temp:
            store=PackageStore(temp)
            key=store.install(archive())["key"]
            self.assertEqual(store.state()["active"], store.default_key)
            with self.assertRaises(PackageError):store.install(archive())
            store.activate(key)
            self.assertEqual(PackageStore(temp).state()["active"], key)
            self.assertEqual(store.rollback()["active"], store.default_key)
            self.assertEqual(store.rollback()["active"], key)

    def test_rejected_import_never_changes_active_or_leaves_package(self):
        with tempfile.TemporaryDirectory() as temp:
            store=PackageStore(temp);before=store.state()
            with self.assertRaises(PackageError):store.install(archive(extra={"../../x": "bad"}))
            self.assertEqual(store.state(),before)
            self.assertEqual(len(store.catalog()["packages"]),1)

    def test_damaged_active_package_recovers_previous_and_records_reason(self):
        with tempfile.TemporaryDirectory() as temp:
            store=PackageStore(temp);one=store.install(archive())["key"];two=store.install(archive(payload("1.0.1")))["key"]
            store.activate(one);store.activate(two)
            (store.directory(two)/'manifest.json').write_text('{broken')
            self.assertEqual(store.state()['active'],one)
            self.assertIn('Invalid active package',store.state()['lastError'])

    def test_failure_report_does_not_roll_back_newer_activation(self):
        with tempfile.TemporaryDirectory() as temp:
            store=PackageStore(temp);one=store.install(archive())["key"];two=store.install(archive(payload("1.0.1")))["key"]
            store.activate(one);store.activate(two)
            self.assertEqual(store.rollback(failed=one,reason="late error")["active"],two)
            self.assertEqual(store.rollback(failed=two,reason="failed HTML")["active"],one)
            self.assertEqual(store.state()["lastError"],"failed HTML")
            self.assertIsNone(store.state()["previous"])

    def test_http_management_requires_token_and_asset_sandbox_has_no_device_surface(self):
        with tempfile.TemporaryDirectory() as temp:
            server=ShowcaseServer(temp)
            try:
                req=Request(server.url+"/api/import",data=archive(),method="POST")
                with self.assertRaises(HTTPError) as error:urlopen(req)
                self.assertEqual(error.exception.code,403)
                req.add_header('X-Showcase-Token',server.token)
                with urlopen(req) as r:self.assertTrue(json.load(r)["ok"])
                with urlopen(server.url+"/active.json") as r:
                    state=json.load(r);self.assertNotIn('manageUrl',state);self.assertEqual(r.headers['Access-Control-Allow-Origin'],'*')
                m=payload("1.0.2");m["slides"]=[{"id":"one","type":"html","src":"slides/a.html","durationMs":9000}]
                server.store.install(archive(m,{"slides/a.html":"<html>test</html>"}))
                with urlopen(server.url+"/packs/partner-test/1.0.2/slides/a.html") as r:
                    csp=r.headers['Content-Security-Policy'];self.assertIn('sandbox allow-scripts;',csp);self.assertIn("connect-src 'none'",csp);self.assertNotIn('allow-same-origin',csp)
                for path in ['/api/catalog','/api/state','/backend.py','/packs/default/1.0.0/../../backend.py']:
                    with self.assertRaises(HTTPError):urlopen(server.url+path)
            finally:server.close()

    def test_shipped_default_and_partner_example_validate(self):
        store=PackageStore(tempfile.mkdtemp())
        try:self.assertEqual(store.manifest(store.default_key)['schemaVersion'],1)
        finally:Path(store.root).rmdir()
        root=Path(__file__).resolve().parents[1]/'examples/showcase/starter'
        stream=io.BytesIO()
        with zipfile.ZipFile(stream,'w') as z:
            for p in root.rglob('*'):
                if p.is_file() and p.name != '.DS_Store':z.write(p,p.relative_to(root))
        self.assertEqual(read_archive(stream.getvalue())[0]['id'],'partner-starter')


if __name__ == '__main__':
    unittest.main()
