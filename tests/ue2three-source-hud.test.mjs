import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceMetricRows, renderSourceMetricHud} from '../src/editor/ue2three-source-hud.mjs';

const source = [{package:'/Game/Fixers/CBP_Player',function:'GetHealthRatio',current:'CurrentHealth',
    current_value:35,maximum_value:80,value:0.4375}];

test('HUD shows translated getter and original numerator/denominator without inventing values', () => {
    const rows=sourceMetricRows(source);
    assert.deepEqual(rows,[{id:'/Game/Fixers/CBP_Player:GetHealthRatio:CurrentHealth',label:'Health',
        percentage:43.75,meterValue:43.75,current:35,maximum:80,display:'Health: 43.8% · 35/80'}]);
    const above=sourceMetricRows([{...source[0],value:1.5,current_value:null,maximum_value:null}])[0];
    assert.equal(above.percentage,150);assert.equal(above.meterValue,100);
    assert.equal(above.display,'Health: 150%');
    assert.throws(()=>sourceMetricRows([{...source[0],value:NaN}]),/Invalid source metric/);
    assert.throws(()=>sourceMetricRows(null),/Missing source metrics/);
});

test('HUD creates accessible meters from source metrics and avoids DOM churn for unchanged state', () => {
    const makeElement=tag=>({tag,children:[],attributes:{},dataset:{},
        setAttribute(name,value){this.attributes[name]=value;},append(...items){this.children.push(...items);},
        replaceChildren(...items){this.children=items;this.replacements=(this.replacements||0)+1;}});
    const root=makeElement('section'),documentRoot={createElement:makeElement};
    assert.equal(renderSourceMetricHud(root,source,documentRoot),1);
    assert.equal(root.children[0].children[0].textContent,'Health: 43.8% · 35/80');
    assert.equal(root.children[0].children[1].tag,'progress');
    assert.equal(root.children[0].children[1].attributes['aria-label'],'Health');
    assert.equal(root.children[0].children[1].value,43.75);
    assert.equal(root.replacements,1);
    renderSourceMetricHud(root,source,documentRoot);assert.equal(root.replacements,1);
    renderSourceMetricHud(root,[{...source[0],value:0.25,current_value:20}],documentRoot);
    assert.equal(root.children[0].children[1].value,25);assert.equal(root.replacements,2);
    renderSourceMetricHud(root,[],documentRoot);assert.equal(root.hidden,true);
});
