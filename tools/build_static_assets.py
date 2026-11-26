#!/usr/bin/env python3
"""Consolidate the existing local renders into one portable HTML5 folder."""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from pipeline import validate_output

WEB_FILES = ("catalog.json", "index.html", "player.js", "aquarium.js", "fishing.js",
             "fishing-audio.js", "scene-sizing.js", "style.css")

SERVE = '''#!/usr/bin/env python3
"""Serve this portable folder; no Blender or project checkout is needed."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--port", type=int, default=8770)
args = parser.parse_args()
handler = partial(SimpleHTTPRequestHandler, directory=str(Path(__file__).resolve().parent))
with ThreadingHTTPServer(("127.0.0.1", args.port), handler) as server:
    print(f"Open http://127.0.0.1:{server.server_port}/#aquarium", flush=True)
    print("Press Ctrl+C to stop.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
'''

GUIDE = '''MÈO CÂU CÁ — BỘ HTML5 ASSETS TĨNH

Đây là bản hoàn chỉnh mới nhất, dùng assets đã render local.
Không cần Blender, npm hoặc kết nối GitHub để chạy.

CHẠY PREVIEW
- macOS: mở START_PREVIEW.command, rồi mở địa chỉ được in trong Terminal.
- Hoặc chạy: python3 serve.py
- Mặc định: http://127.0.0.1:8770/#aquarium
- Đổi cổng nếu đang dùng: python3 serve.py --port 8771
- Ctrl+C để dừng server.

NỘI DUNG
- index.html, *.js, style.css: demo HTML5, câu cá, âm thanh và tỉ lệ hiển thị.
- catalog.json: danh sách {asset_count} assets.
- Mỗi thư mục nhân vật/đạo cụ: manifest.json, atlas PNG/JSON,
  frames PNG và thumbnail.
- licenses/: giấy phép từ các bộ source.
- BUILD_INFO.json: thông tin đóng gói và số lượng assets.

Bao gồm 42 loài cá, {cat_count} mẫu mèo/trang phục với {cat_frames} frames
(5 animation mỗi mẫu), 5 cần câu, 6 mồi câu, cậu bé gốc và 6 khủng long.
Trong bể cá, chọn Mèo rồi chọn Trang phục để đổi nhân vật đang câu.
Mặc định bể chọn Cần câu Cấp 5; có thể đổi sang Cấp 1–4 hoặc Tắt.
Mỗi trang phục có hand.png, handLayer và handTransform theo từng frame.
Tay cầm ngắn nằm sau thân mèo, thân cần nằm phía trước, bàn tay gốc
phủ lên chỗ nắm để giữ đúng kiểu trang phục khi mèo chuyển động.
Tay dùng đúng hình gốc, giữ kích thước và phong cách có sẵn.
Động tác giật cần có 40 frames ở 18 fps, xoay tay độc lập với thân;
tay ở vị trí cũ được tách ra để không bị nhân đôi.

KIỂM TRA CẦN CÂU TRONG BỂ
- Mở địa chỉ preview có #aquarium; xác nhận Cần câu đang ở Cấp 5.
- Chuyển qua Mèo và Trang phục để xem đủ 17 biến thể.
- Nhấn Thả mồi; khi cá cắn, nhấn Giật cần để xem động tác kéo và bắt cá.
- Kiểm tra bàn tay bám cán cần ở các pose chờ, cắn, kéo, ăn mừng và hụt.

ĐƯA LÊN HOSTING
Upload toàn bộ nội dung thư mục này lên static hosting, giữ nguyên đường dẫn.
Các file serve.py và START_PREVIEW.command chỉ hỗ trợ chạy local.
'''


def hashes(folder: Path) -> dict[str, str]:
    return {p.relative_to(folder).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(folder.rglob("*")) if p.is_file()}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", default="dist")
    parser.add_argument("--output", default="build/html5-assets")
    parser.add_argument("--replace", action="store_true", help="Refresh an existing generated HTML5 package")
    args = parser.parse_args()
    source = (ROOT / args.source).resolve()
    output = (ROOT / args.output).resolve()
    build_root = ROOT / "build"
    if build_root not in output.parents or source == output or source in output.parents or output in source.parents:
        parser.error("Choose a separate output folder beneath the project's build/ directory")
    if output.exists():
        marker = output / "BUILD_INFO.json"
        if not args.replace or not marker.is_file() or json.loads(marker.read_text()).get("format") != "html5-static-package-v1":
            parser.error(f"Output already exists: {output}; use --replace only for a generated HTML5 package")
    if source.is_symlink() or any(p.is_symlink() or p.name == ".git" for p in source.rglob("*")):
        parser.error("The source must contain regular static files without symlinks or Git metadata")
    if not all((source / name).is_file() for name in WEB_FILES) or not (source / "licenses").is_dir():
        parser.error("The source is missing preview files or licenses")
    validate_output(source)
    expected = hashes(source)
    catalog = json.loads((source / "catalog.json").read_text())
    manifests = [json.loads((source / asset["manifest"]).read_text()) for asset in catalog["assets"]]
    cats = [m for m in manifests if m.get("actor", {}).get("kind") == "cat"]
    cat_frames = sum(len(a["frames"]) for m in cats for a in m["animations"].values())
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=".html5-assets-", dir=output.parent))
    try:
        shutil.copytree(source, temporary, dirs_exist_ok=True)
        validate_output(temporary)
        if hashes(temporary) != expected:
            raise RuntimeError("The copied package differs from the local renders")
        info = {"format": "html5-static-package-v1", "assets": len(manifests),
                "animations": sum(len(m["animations"]) for m in manifests),
                "frames": sum(len(a["frames"]) for m in manifests for a in m["animations"].values()),
                "catVariants": len(cats), "catFrames": cat_frames,
                "copiedFiles": len(expected), "renderedAgain": False}
        (temporary / "BUILD_INFO.json").write_text(json.dumps(info, indent=2) + "\n")
        (temporary / "README.txt").write_text(GUIDE.format(
            asset_count=len(manifests), cat_count=len(cats), cat_frames=cat_frames))
        (temporary / "serve.py").write_text(SERVE)
        launcher = temporary / "START_PREVIEW.command"
        launcher.write_text('#!/bin/sh\ncd "$(dirname "$0")" || exit 1\nexec python3 serve.py\n')
        launcher.chmod(0o755)
        if output.exists():
            backup = Path(tempfile.mkdtemp(prefix=".html5-assets-previous-", dir=output.parent))
            backup.rmdir()
            output.rename(backup)
            try:
                temporary.rename(output)
            except BaseException:
                backup.rename(output)
                raise
            shutil.rmtree(backup)
        else:
            temporary.rename(output)
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)
    size = sum(p.stat().st_size for p in output.rglob("*") if p.is_file())
    print(f"Built {output}: {len(manifests)} assets, {size / 1048576:.1f} MiB. No rendering performed.")


if __name__ == "__main__":
    main()
