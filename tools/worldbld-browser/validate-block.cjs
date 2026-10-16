'use strict';
/**
 * Validate the future NATIVE WorldBLD project plan.
 * Checks the road network and intended deliverables; does NOT render a UE scene.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const spec = JSON.parse(fs.readFileSync(path.join(__dirname, 'city-block-plan.json'), 'utf8'));
assert.equal(spec.units, 'centimeters');
assert.equal(spec.validation.requires_native_worldbld, true);
assert.ok(spec.roads.length >= spec.validation.minimum_created_roads);
const pointKey = pt => {
  assert.ok(Array.isArray(pt) && pt.length === 2 && pt.every(Number.isFinite));
  return pt.join(',');
};
const degrees = new Map();
const edges = new Set();
for (const road of spec.roads) {
  assert.ok(road.vehicle_lanes >= 2 && road.road_width_cm >= 600 && road.sidewalk_cm >= 150);
  const from = pointKey(road.from);
  const to = pointKey(road.to);
  assert.notEqual(from, to, 'Zero-length road');
  const key = [from, to].sort().join('~');
  assert.ok(!edges.has(key), 'Duplicate road segment: ' + key);
  edges.add(key);
  degrees.set(from, (degrees.get(from) || 0) + 1);
  degrees.set(to, (degrees.get(to) || 0) + 1);
}
assert.equal(degrees.size, 4, 'Exactly four corners needed');
assert.ok([...degrees.values()].every(d => d === 2), 'Roads must close a cycle');
assert.equal(new Set(spec.intersections).size, 4);
for (const key of degrees.keys()) assert.ok(spec.intersections.includes('[' + key + ']'));
assert.ok(spec.cityblD.target_parcels >= spec.validation.min_parcels);
assert.ok(spec.cityblD.target_buildings >= spec.validation.min_buildings);
assert.ok(spec.milestones.some(s => /Cloud compute stopped/.test(s)));
const summary = { plan_valid: true, native_worldbld_run: false, gpu_consumed: false,
  roads_planned: spec.roads.length, intersections_planned: degrees.size,
  parcels_planned: spec.cityblD.target_parcels, buildings_planned: spec.cityblD.target_buildings };
console.log(JSON.stringify(summary, null, 2));
