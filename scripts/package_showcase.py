"""Create a reproducible ZIP from a partner content directory and validate it."""
import argparse
import io
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "coffee-terminal"))
from showcase_packages import read_archive

parser = argparse.ArgumentParser()
parser.add_argument("source", type=Path)
parser.add_argument("output", type=Path)
args = parser.parse_args()
if args.output.resolve().is_relative_to(args.source.resolve()):
    parser.error("output ZIP must be outside source directory")
buffer = io.BytesIO()
with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(args.source.rglob("*")):
        relative = path.relative_to(args.source)
        if path.name == '.DS_Store' or '__MACOSX' in relative.parts:
            continue
        if path.is_symlink():
            parser.error("symlinks are forbidden")
        if path.is_file():
            info = zipfile.ZipInfo(path.relative_to(args.source).as_posix(), (2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, path.read_bytes())
manifest, _ = read_archive(buffer.getvalue())
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_bytes(buffer.getvalue())
print(f"Validated {manifest['id']}/{manifest['version']}: {args.output}")
