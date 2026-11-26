"""Recover the Guardian's original closed fist without its plunger."""
from __future__ import annotations

import re
import zlib
from pathlib import Path

from tools.native_cat_arm import _override_stream


def separate_guardian_fist_pdf(source: Path, output: Path) -> Path:
    """Keep the exact native thumb, palm, outline and shadow vector draws."""
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
        start = re.search(rb'0\.945 0\.749 0\.549\s+scn\s+q 1 0 0 1 72\.7086 23\.6229 cm', program)
        end = re.search(rb'0\.757 0\.153 0\.176\s+scn\s+q 1 0 0 1 25\.5495 41\.1629 cm', program)
        if start and end and start.start() < end.start():
            candidates.append((obj, program[start.start():end.start()]))
    if len(candidates) != 1:
        raise RuntimeError(f'{source.name}: expected one original Guardian fist group')
    obj, fist = candidates[0]
    program = b'q\n/CS0 cs\n/GS0 gs\n' + fist + b'\nQ\n'
    output.mkdir(parents=True, exist_ok=True)
    path = output / 'native-fist-without-plunger.pdf'
    path.write_bytes(_override_stream(original, int(obj[1]), int(obj[2]), program))
    return path
