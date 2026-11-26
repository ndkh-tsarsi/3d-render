"""Separate the original orange-cat arm, cuff and near paw from its weapon."""
from __future__ import annotations

import re
import zlib
from pathlib import Path

from tools.native_cat_arm import _override_stream


def separate_orange_pdf(source: Path, output: Path) -> Path:
    """Keep authored near-arm draw groups; omit weapon and far supporting paw.

    The source image is not redrawn, reflected, cropped, or resized. Its cream
    upper arm, yellow cuff and white closed paw retain their native shadows.
    """
    original = source.read_bytes()
    candidates = []
    for obj in re.finditer(rb'(?:^|[\r\n])(\d+)\s+(\d+)\s+obj\b(.*?)endobj', original, re.S):
        stream = re.search(rb'\bstream\r?\n(.*?)\r?\nendstream', obj[3], re.S)
        if not stream or b'/FlateDecode' not in obj[3][:stream.start()]:
            continue
        try:
            program = zlib.decompress(stream[1])
        except zlib.error:
            continue
        start = re.search(rb'0\.945 0\.749 0\.549\s+scn\s+q 1 0 0 1 17\.2639 6\.5737 cm', program)
        end = re.search(rb'0\.949 0\.949 0\.949\s+scn\s+q 1 0 0 1 38\.5266 10\.6968 cm', program)
        if start and end and start.start() < end.start():
            candidates.append((obj, program[start.start():end.start()]))
    if len(candidates) != 1:
        raise RuntimeError(f'{source.name}: expected one native orange arm/cuff/paw group, got {len(candidates)}')
    obj, arm = candidates[0]
    # Source Forms contain the arm and glove's original authored shadows.
    program = b'q\n/CS0 cs\n/GS0 gs\n' + arm + b'\nQ\n'
    output.mkdir(parents=True, exist_ok=True)
    result = output / 'native-arm-with-paw.pdf'
    result.write_bytes(_override_stream(original, int(obj[1]), int(obj[2]), program))
    return result
