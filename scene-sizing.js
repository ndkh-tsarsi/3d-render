/** Shared visible proportions for the fisherman and the aquarium sprites. */
export function sceneSizing(width, height) {
  const catHeight = Math.min(148, Math.max(108, width * 0.14), height * 0.34);
  return {
    catHeight,
    fishScale: 0.62 * catHeight / 145,
    fishMaxHeight: catHeight * 0.72,
    fishMaxWidth: width * 0.54,
  };
}
