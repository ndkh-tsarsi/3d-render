"""Fish color families drawn from the supplied Craftpix cat sprites.

Colors are display sRGB hex strings. The renderer converts them to linear RGB.
The fur, clothing and accessory colors inform the palette; no cat artwork is
copied into fish textures or rendered output.
"""

STYLE_ID = "cat-toon-v1"
INK_HEX = "3B171B"
SOURCE_REFERENCE = "craftpix-net-397030-free-cartoon-cat-defense-game-asset-kit"

# Tuple order: body, belly, fins, accent. Stronger midtones and warm cream
# preserve the cats' readable silhouettes without making every fish orange.
PALETTES = {
    "anglerfish": ("93278F", "F1BF8C", "5CC8C0", "FFE356"),
    "armoredcatfish": ("56A5FF", "D1D3D4", "285179", "F1BF8C"),
    "betta": ("1C75BC", "FBE7C4", "FF7BAC", "29ABE2"),
    "blacklionfish": ("56506F", "F2F2F2", "93278F", "FBB03B"),
    "blobfish": ("FF7BAC", "FBE7C4", "C9286A", "F18854"),
    "bluegoldfish": ("56A5FF", "FBE7C4", "1C75BC", "FBB03B"),
    "bluetang": ("56A5FF", "F2F2F2", "FBB03B", "29ABE2"),
    "butterflyfish": ("FFE356", "FBE7C4", "F7931E", "F18854"),
    "cardinalfish": ("F18854", "FBE7C4", "F1BF8C", "00A99D"),
    "clownfish": ("F18854", "FBE7C4", "F7931E", "F1BF8C"),
    "coralgrouper": ("F18854", "FBE7C4", "F15A24", "FBB03B"),
    "cowfish": ("FBB03B", "FBE7C4", "F18854", "BA8C6A"),
    "flatfish": ("93278F", "FBE7C4", "FF7BAC", "F1BF8C"),
    "flowerhorn": ("FF7BAC", "FBE7C4", "93278F", "FFE356"),
    "goblinshark": ("56A5FF", "D1D3D4", "1C75BC", "5CC8C0"),
    "goldfish": ("F7931E", "FBE7C4", "F18854", "FFE356"),
    "humphead": ("00A99D", "FBE7C4", "196A65", "FBB03B"),
    "koi": ("F18854", "FBE7C4", "F1BF8C", "F15A24"),
    "lionfish": ("F18854", "FBE7C4", "93278F", "FBB03B"),
    "mandarinfish": ("F7931E", "FBE7C4", "00A99D", "93278F"),
    "moorishidol": ("FBB03B", "FBE7C4", "56506F", "F18854"),
    "parrotfish": ("00A99D", "FBE7C4", "1C75BC", "FF7BAC"),
    "piranha": ("56506F", "F1BF8C", "FBB03B", "C9286A"),
    "puffer": ("FFE356", "FBE7C4", "F1BF8C", "F7931E"),
    "redsnapper": ("FF7BAC", "FBE7C4", "F18854", "00A99D"),
    "royalgramma": ("93278F", "FBE7C4", "FBB03B", "FF7BAC"),
    "shark": ("56A5FF", "F2F2F2", "1C75BC", "29ABE2"),
    "sunfish": ("F1BF8C", "FBE7C4", "F18854", "FBB03B"),
    "swordfish": ("56A5FF", "F2F2F2", "1C75BC", "5CC8C0"),
    "tang": ("1C75BC", "FBE7C4", "FBB03B", "F18854"),
    "tetra": ("29ABE2", "F2F2F2", "1C75BC", "FF7BAC"),
    "tuna": ("56A5FF", "D1D3D4", "FBB03B", "1C75BC"),
    "turbot": ("5CC8C0", "FBE7C4", "196A65", "FBB03B"),
    "yellowtang": ("FFE356", "FBE7C4", "F7931E", "FBB03B"),
    "zebraclownfish": ("56506F", "F2F2F2", "93278F", "F1BF8C"),
    "fish1": ("F18854", "FBE7C4", "FBB03B", "00A99D"),
    "fish2": ("29ABE2", "F2F2F2", "FBB03B", "FF7BAC"),
    "fish3": ("F18854", "FBE7C4", "F7931E", "F1BF8C"),
    "dolphin": ("29ABE2", "F2F2F2", "1C75BC", "F1BF8C"),
    "mantaray": ("1C75BC", "F2F2F2", "56506F", "5CC8C0"),
    "whale": ("93278F", "FBE7C4", "56506F", "F1BF8C"),
}

# Authored multicolor regions such as Parrot Fish's pink bands and Royal
# Gramma's yellow tail stay distinct from ordinary cream belly materials.
LIGHT_ACCENTS = {
    "parrotfish": "FF7BAC",
    "mandarinfish": "5CC8C0",
    "royalgramma": "FBB03B",
    "tetra": "F18854",
    "tang": "FBB03B",
}
