"""Safe ZIP archive utilities for Edu7 workspaces.

The API layer uses this module only for archive mechanics. Business identity,
reconciliation and canonical import remain in Node services.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, BadZipFile

DEFAULT_MAX_ENTRIES = 100_000
DEFAULT_MAX_UNCOMPRESSED = 2 * 1024 * 1024 * 1024
DEFAULT_MAX_FILE = 512 * 1024 * 1024
DEFAULT_MAX_RATIO = 1000


def _safe_member_name(name: str) -> str:
    normalized = name.replace("\\", "/")
    if not normalized or normalized.startswith("/") or ":" in normalized.split("/")[0]:
        raise ValueError(f"unsafe ZIP member path: {name!r}")
    parts = [p for p in normalized.split("/") if p not in ("", ".")]
    if any(p == ".." for p in parts):
        raise ValueError(f"unsafe ZIP member path: {name!r}")
    return "/".join(parts)


def _validate(zf: ZipFile, max_entries: int, max_uncompressed: int, max_file: int, max_ratio: int) -> list[str]:
    infos = zf.infolist()
    if len(infos) > max_entries:
        raise ValueError(f"ZIP contains too many entries: {len(infos)}")
    total = 0
    names: list[str] = []
    seen: set[str] = set()
    for info in infos:
        name = _safe_member_name(info.filename)
        if name in seen:
            raise ValueError(f"duplicate ZIP member: {name}")
        seen.add(name)
        names.append(name)
        if info.file_size > max_file:
            raise ValueError(f"ZIP member is too large: {name}")
        total += info.file_size
        if total > max_uncompressed:
            raise ValueError("ZIP uncompressed size exceeds configured limit")
        compressed = max(info.compress_size, 1)
        if info.file_size / compressed > max_ratio:
            raise ValueError(f"ZIP compression ratio is unsafe: {name}")
        # Reject symbolic-link entries. Their external attributes can otherwise
        # turn an apparently harmless archive into a filesystem redirection.
        mode = (info.external_attr >> 16) & 0o170000
        if mode == 0o120000:
            raise ValueError(f"ZIP symbolic links are not allowed: {name}")
    return names


def extract(zip_path: Path, output_dir: Path) -> dict:
    max_entries = int(os.environ.get("CONTENT_ZIP_MAX_ENTRIES", DEFAULT_MAX_ENTRIES))
    max_uncompressed = int(os.environ.get("CONTENT_ZIP_MAX_UNCOMPRESSED_BYTES", DEFAULT_MAX_UNCOMPRESSED))
    max_file = int(os.environ.get("CONTENT_ZIP_MAX_FILE_BYTES", DEFAULT_MAX_FILE))
    max_ratio = int(os.environ.get("CONTENT_ZIP_MAX_COMPRESSION_RATIO", DEFAULT_MAX_RATIO))
    output_dir.mkdir(parents=True, exist_ok=True)
    with ZipFile(zip_path, "r") as zf:
        names = _validate(zf, max_entries, max_uncompressed, max_file, max_ratio)
        for info, name in zip((i for i in zf.infolist()), names):
            target = (output_dir / name).resolve()
            root = output_dir.resolve()
            if os.path.commonpath([str(root), str(target)]) != str(root):
                raise ValueError(f"ZIP member escapes extraction root: {name}")
            if info.is_dir() or name.endswith("/"):
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(info, "r") as src, target.open("wb") as dst:
                while True:
                    chunk = src.read(1024 * 1024)
                    if not chunk:
                        break
                    dst.write(chunk)
    return {"entries": len(names), "outputDir": str(output_dir)}


def create(workspace_dir: Path, output_zip: Path, root_name: str) -> dict:
    if not workspace_dir.is_dir():
        raise ValueError(f"workspace does not exist: {workspace_dir}")
    output_zip.parent.mkdir(parents=True, exist_ok=True)
    files = sorted(p for p in workspace_dir.rglob("*") if p.is_file())
    with ZipFile(output_zip, "w", compression=ZIP_DEFLATED, compresslevel=6) as zf:
        for file in files:
            rel = file.relative_to(workspace_dir).as_posix()
            zf.write(file, f"{root_name}/{rel}")
    return {"entries": len(files), "outputZip": str(output_zip)}


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    p_extract = sub.add_parser("extract")
    p_extract.add_argument("zip_path")
    p_extract.add_argument("output_dir")

    p_create = sub.add_parser("create")
    p_create.add_argument("workspace_dir")
    p_create.add_argument("output_zip")
    p_create.add_argument("root_name")

    args = parser.parse_args()
    try:
        if args.command == "extract":
            result = extract(Path(args.zip_path), Path(args.output_dir))
        else:
            result = create(Path(args.workspace_dir), Path(args.output_zip), args.root_name)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (BadZipFile, OSError, ValueError, RuntimeError) as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
