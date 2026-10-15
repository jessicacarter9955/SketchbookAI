import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCityAssetQuery} from '../src/editor/city-asset-query.mjs';

test('provider selectors retain independent asset-search textbox routing',()=>{
  assert.equal(parseCityAssetQuery('@fab sports car'),'@fab sports car');
  assert.equal(parseCityAssetQuery('@sketchfab tree'),'@sketchfab tree');
  assert.equal(parseCityAssetQuery('Fab: medieval building'),'@fab medieval building');
  assert.equal(parseCityAssetQuery("aggiungi un'auto da Fab"),'@fab auto');
  assert.equal(parseCityAssetQuery('cerca un albero su Sketchfab'),'@sketchfab albero');
  assert.equal(parseCityAssetQuery('tree'),'tree');
  assert.equal(parseCityAssetQuery('   '),'');
});
