"""Copy the pinned release's JS dependencies and project configuration unchanged."""
import json
from pathlib import Path
import struct
import sys

source = Path(sys.argv[1])
destination = Path(sys.argv[2])
with source.open("rb") as stream:
    _, header_size, _, json_size = struct.unpack("<IIII", stream.read(16))
    entries = json.loads(stream.read(json_size))["files"]

    def read_entry(entry):
        stream.seek(8 + header_size + int(entry["offset"]))
        return stream.read(entry["size"])

    def extract(tree, folder):
        folder.mkdir(parents=True, exist_ok=True)
        for name, entry in tree.items():
            target = folder / name
            if "files" in entry:
                extract(entry["files"], target)
            else:
                target.write_bytes(read_entry(entry))
                if entry.get("executable"):
                    target.chmod(0o755)

    for name in ("node_modules", "internal"):
        if name == 'node_modules' or name in entries:
            extract(entries[name]["files"], destination / name)
    metadata = json.loads(read_entry(entries["package.json"]))
    local = json.loads(Path("package.json").read_text(encoding="utf-8"))
    for field in ("displayVersion", "releaseName"):
        metadata[field] = local[field]
    (destination / "package.json").write_text(json.dumps(metadata, ensure_ascii=False), encoding="utf-8")
