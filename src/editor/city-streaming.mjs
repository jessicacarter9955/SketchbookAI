/** Geometry-only streaming policy shared by both city playtests.
 * Keep a collision-safe bubble at the player even when it is behind camera,
 * and load the remaining sectors only when they intersect the view frustum.
 * Hysteresis prevents repeatedly fetching sectors on camera turns.
 */
export const CITY_STREAM = Object.freeze({
  collisionBubble: 185,
  prefetchView: 660,
  retainBubble: 280,
  retainView: 780,
  physicsEnable: 165,
  physicsDisable: 225
});
export function distanceToSector(point, bounds) {
  if (!point || !bounds) return Infinity;
  const x = point.x, z = point.z;
  return Math.hypot(Math.max(bounds[0][0]-x,0,x-bounds[1][0]),
                    Math.max(bounds[0][2]-z,0,z-bounds[1][2]));
}
export function selectCitySectors(sectors, player, view, visible, { retain = false } = {}) {
  const bubble = retain ? CITY_STREAM.retainBubble : CITY_STREAM.collisionBubble;
  const far = retain ? CITY_STREAM.retainView : CITY_STREAM.prefetchView;
  return sectors.filter(sector => {
    const near = distanceToSector(player,sector.bounds);
    if (near < bubble) return true;
    return distanceToSector(view,sector.bounds) < far && visible(sector);
  }).sort((a,b) => {
    // Player collision has priority, even if the camera is looking elsewhere.
    const aNear=distanceToSector(player,a.bounds), bNear=distanceToSector(player,b.bounds);
    const aPriority=aNear < bubble ? aNear : bubble + distanceToSector(view,a.bounds);
    const bPriority=bNear < bubble ? bNear : bubble + distanceToSector(view,b.bounds);
    return aPriority-bPriority;
  });
}
