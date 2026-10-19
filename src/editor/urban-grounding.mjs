// Preserve the imported GLB without changing its geometry or original scale.
// The source asset is normalized to a zero-height visual origin at import time.
// Its floor clearance must follow the *physical* chassis, not a fixed -0.78 m.
export function groundedVehicleSkinOffset(chassisY, groundY, contactWheels, originalOffset = -0.78) {
  if (!Number.isFinite(chassisY) || !Number.isFinite(groundY) || !Number.isFinite(originalOffset) || !(contactWheels > 0)) return null;
  // Never push a car farther into the asphalt. In flight, keep the last offset.
  return Math.max(originalOffset, groundY + 0.06 - chassisY);
}
