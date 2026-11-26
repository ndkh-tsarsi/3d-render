/** Shared visible proportions for the fisherman and the aquarium sprites. */
export function sceneSizing(width, height) {
  const catHeight = Math.min(148, Math.max(108, width * 0.14), height * 0.34);
  // Reserve a dry, stable deck for every authored cat pose; water begins below
  // the wooden planks rather than behind the cat's body.
  const dockY = Math.round(catHeight * 1.06 + 10);
  const surfaceY = dockY + 18;
  return {
    catHeight,
    dockY,
    surfaceY,
    waterHeight: Math.max(1, height - surfaceY),
    fishScale: 0.62 * catHeight / 145,
    fishMaxHeight: catHeight * 0.72,
    fishMaxWidth: width * 0.54,
  };
}
