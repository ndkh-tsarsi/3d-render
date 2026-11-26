"""Recover the supplied white-cat near forearm, cuff and closed paw."""
from __future__ import annotations

import re
import zlib
from pathlib import Path

from tools.native_cat_arm import _override_stream


def separate_white_pdf(source: Path, output: Path) -> Path:
    """Separate original near-limb vectors from the gun and far support paw.

    The source depicts a short exposed forearm beside the gunstock. Its upper
    shoulder is hidden by the weapon; no replacement upper arm is invented.
    The complete native Gun artboard, original colors and shadows are retained.
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
        start = re.search(rb'0\.953 0\.796 0\.659\s+scn\s+q 1 0 0 1 24\.0293 11\.9108 cm', program)
        end = re.search(rb'0\.949 0\.949 0\.949\s+scn\s+q 1 0 0 1 54\.6094 8\.5348 cm', program)
        if start and end and start.start() < end.start():
            candidates.append((obj, program[start.start():end.start()]))
    if len(candidates) != 1:
        raise RuntimeError(f'{source.name}: expected one native near forearm/cuff/paw group, got {len(candidates)}')
    obj, limb = candidates[0]
    # Fm6..8 supply the original near-forearm and glove shadows.
    program = b'q\n/CS0 cs\n/GS0 gs\n' + limb + b'\nQ\n'
    output.mkdir(parents=True, exist_ok=True)
    result = output / 'native-forearm-with-paw.pdf'
    result.write_bytes(_override_stream(original, int(obj[1]), int(obj[2]), program))
    return result
