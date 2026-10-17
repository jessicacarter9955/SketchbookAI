import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const get=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');

test('Dedicated Urban Photoreal mobile entry starts actual game with touch player and three cars',()=>{
  const html=get('mobile.html');
  assert.match(html,/scene','urban-photoreal'/);
  assert.match(html,/cityBlocks','2'/);
  assert.match(html,/mobile','1'/);
  assert.match(html,/play','1'/);
  const build=get('tools/package-urban-preview.py');
  assert.match(build,/'mobile.html'/);
});
test('Mobile E action is large, persistent and enters the nearest real drivable car',()=>{
  const mobile=get('src/editor/MobileCityPlayer.js');
  const css=get('src/editor/editor.css');
  assert.match(mobile,/data-mobile-car aria-label="Tasto E/);
  assert.match(mobile,/carButton\.hidden=false/);
  assert.match(mobile,/carButton\.disabled=!driving&&!nearest/);
  assert.match(mobile,/player\.teleportToVehicle\(target,seat\)/);
  assert.match(mobile,/player\.controlledObject\.forceCharacterOut/);
  assert.match(css,/body\.mobile-city-player \.editor-toolbar/);
  assert.match(css,/\.mobile-city-asset-search\[hidden\]\{display:none!important\}/);
});
test('Touch joystick controls both on-foot movement and actual vehicle throttle/steering',()=>{
  const mobile=get('src/editor/MobileCityPlayer.js');
  assert.match(mobile,/vehicle\?\{up:'throttle',down:'reverse',left:'left',right:'right'\}/);
  assert.match(mobile,/receiver\.triggerAction\(action,value\)/);
  assert.match(mobile,/pointerdown/);
  assert.match(mobile,/pointercancel/);
  assert.match(mobile,/cameraOperator\.move/);
});
