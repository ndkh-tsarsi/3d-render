"""Source landmarks for the complete gray arm already drawn in Body.

The gray Gun attachment is a weapon stock/trigger grip, not a missing paw.
Its bent near arm and terminal gray paw are a single authored Body path.
"""
from __future__ import annotations

from copy import deepcopy


def gray_arm_profile(number: int) -> dict:
    """Use an opaque proximal shoulder instead of the cut's transparent tip.

    The artboard, source image and zero-rotation placement stay unchanged.
    Only the pivot is moved into the original shoulder; wrist and palm remain
    the original, fully opaque fur pixels near the end of the bent arm.
    """
    if number not in range(6, 11):
        raise ValueError('Gray native arm profiles apply to Cat6 through Cat10')
    if number == 10:
        profile = {
            'landmarks': {'shoulder': (70., 76.), 'elbow': (43., 92.),
                          'wrist': (75., 117.), 'grip': (81., 128.)},
            'overlayBounds': {'x': 70, 'y': 116, 'w': 20, 'h': 20},
            'nativeSize': {'w': 230, 'h': 214},
            'gripRGBA': [90, 66, 71, 255],
        }
    else:
        profile = {
            'landmarks': {'shoulder': (73., 60.), 'elbow': (31., 92.),
                          'wrist': (57., 115.), 'grip': (67., 127.)},
            'overlayBounds': {'x': 55, 'y': 115, 'w': 25, 'h': 22},
            'nativeSize': {'w': 217, 'h': 214},
            'gripRGBA': [117, 104, 110, 255],
        }
    profile['sourcePart'] = 'Body: complete bent gray near arm and terminal paw'
    profile['motionSign'] = 1.
    return deepcopy(profile)
