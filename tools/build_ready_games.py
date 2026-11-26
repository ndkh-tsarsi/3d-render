#!/usr/bin/env python3
"""Package both complete local games, existing runtime assets and local launchers."""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from pipeline import validate_output

WEB_FILES = ("index.html", "player.js", "aquarium.js", "fishing.js", "fishing-audio.js", "scene-sizing.js", "style.css")
DEFENSE_FILES = ("index.html", "styles.css", "embedded.css", "bootstrap.js", "bridge.js", "engine.js", "render.js", "rules.js", "game.js", "character-layout.js", "actor-bounds.js")
FORMAT = "ready-games-bundle-v1"

SERVER = '''#!/usr/bin/env python3
"""Serve this complete static game package with Python 3."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--port', type=int, default=DEFAULT_PORT)
args = parser.parse_args()
SimpleHTTPRequestHandler.extensions_map.update({'.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.webp':'image/webp', '.json':'application/json; charset=utf-8'})
handler = partial(SimpleHTTPRequestHandler, directory=str(Path(__file__).resolve().parent))
try:
    with ThreadingHTTPServer(('127.0.0.1', args.port), handler) as server:
        print(f'Open http://127.0.0.1:{server.server_port}/', flush=True)
        print('Press Ctrl+C to stop.', flush=True)
        try: server.serve_forever()
        except KeyboardInterrupt: pass
except OSError as error:
    parser.exit(1, f'Could not start preview: {error}. Try --port 8791.\\n')
'''

VERIFY = '''#!/usr/bin/env python3
"""Verify that all packaged files match SHA256SUMS.txt."""
import hashlib
from pathlib import Path
root = Path(__file__).resolve().parent
entries = (root/'SHA256SUMS.txt').read_text(encoding='utf-8').splitlines()
errors = []
for entry in entries:
    expected, relative = entry.split('  ', 1)
    path = root/relative
    if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
        errors.append(relative)
if errors:
    raise SystemExit('Missing or changed files:\\n'+'\\n'.join(errors))
print(f'OK: {len(entries)} files verified.')
'''

HOME = '''<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#163d4a"><title>Hai cuộc phiêu lưu của mèo</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#edf6f6;color:#173f4c;font:16px/1.6 ui-rounded,"Avenir Next",system-ui,sans-serif}main{max-width:1060px;margin:auto;padding:48px 24px}header{margin-bottom:32px}header p{margin:0;color:#467e82;font-weight:700}h1{margin:8px 0;font-size:clamp(2rem,5vw,3.2rem);line-height:1.15;letter-spacing:-.045em}header>span{color:#5d7984}.games{display:grid;grid-template-columns:1fr 1fr;gap:24px}article{overflow:hidden;border:1px solid #d2e5e5;border-radius:26px;background:#fff;box-shadow:0 14px 40px #173f4c0b}.art{height:230px;position:relative;overflow:hidden;background:linear-gradient(#d7f9ff 45%,#5dd4da 45%,#269ab9)}.art img{position:absolute;object-fit:contain}.fishing-cat{right:12px;top:0;width:150px;height:160px}.fish-one{left:35px;bottom:5px;width:170px;height:125px}.fish-two{left:170px;bottom:25px;width:120px;height:95px}.defense-art{background:radial-gradient(ellipse at 50% 100%,#648283,#27414e)}.defender{inset:20px 20px 0;width:calc(100% - 40px);height:210px}.copy{padding:25px}h2{margin:0 0 8px;font-size:1.55rem;letter-spacing:-.03em}.copy p{margin:0 0 22px;color:#607b84;min-height:52px}.play{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:10px 24px;border-radius:12px;background:#17898f;color:#fff;text-decoration:none;font-weight:800}.defense .play{background:#cf684c}.play:hover{filter:brightness(1.08)}a:focus-visible{outline:3px solid #a96e19;outline-offset:5px}footer{margin-top:28px;color:#6c858d;font-size:14px}@media(max-width:650px){main{padding:28px 16px}.games{grid-template-columns:1fr;gap:20px}.art{height:210px}.copy{padding:22px}.copy p{min-height:0}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}
</style></head><body><main><header><p>Mèo và những người bạn</p><h1>Hôm nay mình chơi gì?</h1><span>Ra bến câu cá, hoặc cùng mèo bảo vệ khu phố.</span></header>
<section class="games" aria-label="Chọn game"><article><div class="art"><img class="fishing-cat" src="fishing/fishing-cat/thumbnail.png" alt=""><img class="fish-one" src="fishing/fish1/thumbnail.png" alt=""><img class="fish-two" src="fishing/fish3/thumbnail.png" alt=""></div><div class="copy"><h2>Mèo câu cá</h2><p>Chọn trang phục, thả mồi và chờ đàn cá đầy màu sắc ghé thăm.</p><a class="play" href="fishing/index.html#aquarium">Chơi câu cá</a></div></article>
<article class="defense"><div class="art defense-art"><img class="defender" src="cat-defense/assets/portraits/cat-01.png" alt=""></div><div class="copy"><h2>Mèo thủ thành</h2><p>Đồng hành cùng đội mèo, ngăn quái vật và bảo vệ hàng rào.</p><a class="play" href="cat-defense/index.html">Chơi thủ thành</a></div></article></section><footer>Hai cuộc phiêu lưu, mở riêng và chơi ngay trong trình duyệt.</footer></main></body></html>
'''

GUIDE = '''BỘ GAME READY — MÈO CÂU CÁ + MÈO THỦ THÀNH

CHẠY NGAY
1. Giải nén toàn bộ ready-games.zip, giữ nguyên các thư mục.
2. macOS: mở START_PREVIEW.command; hoặc chạy: python3 serve.py
3. Mở http://127.0.0.1:8790/ để chọn game.
4. Nếu cổng đã dùng: python3 serve.py --port 8791

Mỗi game cũng chạy riêng:
- fishing/: python3 serve.py — http://127.0.0.1:8770/
- cat-defense/: python3 serve.py — http://127.0.0.1:8771/

NỘI DUNG
- fishing/: bản câu cá mới, có bầu trời, cầu gỗ và mặt nước riêng;
  42 loài cá, 17 mèo/trang phục, 5 cần câu, 6 mồi, âm thanh,
  animation và bộ sưu tập đầy đủ (77 assets, 175 animation, 3851 frames).
- cat-defense/: 17 mèo, 15 quái, animation/effects, gameplay và âm thanh;
  tỉ lệ thân nhân vật, vùng trúng đạn và nòng súng đã căn lại.
- cat-defense/sdk/: SDK JavaScript thuần + TypeScript definitions.
- cat-defense/examples/host.html: ví dụ điều khiển game từ ngoài iframe.
- cat-defense/examples/CatDefenseFrame.tsx: component mẫu React/Next.js.
- cat-defense/INTEGRATION.md: hướng dẫn action/event API.
- Các giấy phép đi kèm trong fishing/licenses/ và cat-defense/assets/licenses/.
- SHA256SUMS.txt + verify.py: kiểm tra toàn bộ file trong gói.

Game là HTML/CSS/JavaScript tĩnh, dùng assets đã chuẩn bị local.
Đưa toàn bộ thư mục lên HTTP(S) static hosting để chơi hoặc nhúng iframe.
ES modules và fetch cần HTTP; hãy dùng serve.py thay vì mở file://index.html.
Python 3 chỉ dùng để chạy server local. Game không cần npm, Next.js,
Blender, tài khoản đăng nhập hay kết nối GitHub để chạy.

API MÈO THỦ THÀNH
Chạy ví dụ: http://127.0.0.1:8790/cat-defense/examples/host.html
Các lệnh: configure, fire, spawnEnemy, setFenceHp, repairFence,
explode, setCat, start, pause, resume, restart, getState, setScore.
Portal/auth/backend của bạn giữ trách nhiệm quản lý tài khoản và điểm số;
iframe chỉ nhận dữ liệu công khai và gửi sự kiện game ra ngoài.

KIỂM TRA FILE
Chạy python3 verify.py từ thư mục gói. Kết quả OK nghĩa là mọi file
khớp checksum lúc đóng gói. Gói không chứa node_modules hay dữ liệu đăng nhập.
'''


def digest(path: Path) -> str:
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def add_launcher(folder: Path, port: int) -> None:
    (folder/'serve.py').write_text(SERVER.replace('DEFAULT_PORT', str(port)), encoding='utf-8')
    launcher = folder/'START_PREVIEW.command'
    launcher.write_text('#!/bin/sh\ncd "$(dirname "$0")" || exit 1\nexec python3 serve.py\n', encoding='utf-8')
    launcher.chmod(0o755)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', default='build/ready-games')
    parser.add_argument('--replace', action='store_true')
    args = parser.parse_args()
    output = (ROOT/args.output).resolve()
    if ROOT/'build' not in output.parents:
        parser.error('The output must be a separate folder inside build/.')
    if output.exists():
        marker = output/'BUILD_INFO.json'
        if not args.replace or not marker.is_file() or json.loads(marker.read_text()).get('format') != FORMAT:
            parser.error('Existing output is not an approved generated bundle; choose a new folder or use --replace.')

    fishing = ROOT/'build/html5-assets'
    defense = ROOT/'build/cat-defense-standalone'
    for source in (fishing, defense):
        if source == output or source in output.parents or output in source.parents:
            parser.error('Input and output folders must be separate.')
        if any(p.is_symlink() or p.name == '.git' for p in source.rglob('*')):
            parser.error('Inputs must be regular portable files without symlinks or Git metadata.')
    validate_output(fishing)
    for name in WEB_FILES:
        if (fishing/name).read_bytes() != (ROOT/'web'/name).read_bytes():
            raise RuntimeError(f'Fishing runtime is stale: {name}. Sync the local UI first.')
    for name in DEFENSE_FILES:
        if (defense/name).read_bytes() != (ROOT/'game/cat-defense'/name).read_bytes():
            raise RuntimeError(f'Defense runtime is stale: {name}. Run npm run build:defense first.')
    for name in ('index.js', 'protocol.js', 'index.d.ts'):
        if (defense/'sdk'/name).read_bytes() != (ROOT/'packages/cat-defense-sdk'/name).read_bytes():
            raise RuntimeError(f'Defense SDK is stale: {name}. Run npm run build:defense first.')

    output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix='.ready-games-', dir=output.parent))
    try:
        source_hashes = {}
        for name, source in (('fishing', fishing), ('cat-defense', defense)):
            print(f'Copying {name} and every runtime asset…', flush=True)
            shutil.copytree(source, staging/name)
            for path in source.rglob('*'):
                if path.is_file():
                    relative = Path(name)/path.relative_to(source)
                    expected = digest(path)
                    if digest(staging/relative) != expected:
                        raise RuntimeError(f'Copied file differs: {relative}')
                    source_hashes[relative.as_posix()] = expected
        # The original prop manifests use a local license alias. Preserve the
        # manifests and supply that alias from the already bundled source license.
        license_aliases = []
        prop_ids = {*(f'fishingrod-lvl{i}' for i in range(1, 6)), *(f'lure-{i}' for i in range(1, 7))}
        for asset_id in sorted(prop_ids):
            folder = staging/'fishing'/asset_id
            manifest = json.loads((folder/'manifest.json').read_text(encoding='utf-8'))
            if manifest.get('source', {}).get('licenseFile') == 'License.txt' and not (folder/'License.txt').exists():
                shutil.copy2(staging/'fishing/licenses/cute-fish-pack-feb-2020.txt', folder/'License.txt')
                license_aliases.append(f'fishing/{asset_id}/License.txt')
        add_launcher(staging, 8790)
        add_launcher(staging/'fishing', 8770)
        add_launcher(staging/'cat-defense', 8771)
        (staging/'index.html').write_text(HOME, encoding='utf-8')
        (staging/'README.txt').write_text(GUIDE, encoding='utf-8')
        (staging/'verify.py').write_text(VERIFY, encoding='utf-8')
        info = {'format':FORMAT, 'renderedAgain':False,
                'entry':'index.html', 'games':[
                    {'id':'fishing','entry':'fishing/index.html#aquarium','fishSpecies':42,'catVariants':17,'assets':77,'animations':175,'frames':3851},
                    {'id':'cat-defense','entry':'cat-defense/index.html','cats':17,'enemies':15,'protocolVersion':1}],
                'copiedRuntimeFiles':len(source_hashes), 'addedLicenseAliases':license_aliases}
        (staging/'BUILD_INFO.json').write_text(json.dumps(info, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
        members = sorted(p for p in staging.rglob('*') if p.is_file())
        sums = ''.join(f'{digest(path)}  {path.relative_to(staging).as_posix()}\n' for path in members)
        (staging/'SHA256SUMS.txt').write_text(sums, encoding='utf-8')
        for folder in [staging, *(p for p in staging.rglob('*') if p.is_dir())]:
            folder.chmod(0o755)
        archive = output.with_suffix('.zip')
        with tempfile.NamedTemporaryFile(prefix='.ready-games-', suffix='.zip', dir=output.parent, delete=False) as file:
            temporary_zip = Path(file.name)
        try:
            print('Compressing the complete two-game ZIP…', flush=True)
            with zipfile.ZipFile(temporary_zip, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
                for path in sorted(staging.rglob('*')):
                    if path.is_file(): bundle.write(path, (Path(output.name)/path.relative_to(staging)).as_posix())
            with zipfile.ZipFile(temporary_zip) as bundle:
                if bundle.testzip() is not None: raise RuntimeError('ZIP CRC validation failed.')
                member_count = len(bundle.namelist())
            if output.exists(): shutil.rmtree(output)
            staging.rename(output)
            temporary_zip.replace(archive)
            archive.chmod(0o644)
        finally:
            temporary_zip.unlink(missing_ok=True)
    finally:
        if staging.exists(): shutil.rmtree(staging)
    print(json.dumps({'folder':str(output), 'zip':str(archive), 'files':member_count,
                      'zipMiB':round(archive.stat().st_size/1048576,2), 'verified':True}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
