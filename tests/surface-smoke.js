(async()=>{
    const results=document.getElementById('test-results');
    const ok=(condition,label)=>{if(!condition)throw new Error(label);results.textContent+=`PASS ${label}\n`;};
    const key='sketchbook.test.surface-smoke';
    try {
        const world=new World(), city=new CityRuntime(world); world.levelRuntime=city;
        await city.initialize(()=>{});
        const editor=new SceneEditor(world,{storageKey:key,worldId:'liberty-city'});
        const edit={id:'test-grass',name:'Prato',texture:'Grass_128HV.PNG',style:'grass',bounds:[-15,-6,-60,15,-2,-30],seed:42,density:30,height:.5};
        const snapshot=[...city.loaded].map(([id,data])=>[id,new Uint8Array(data.vertices.buffer).slice()]);
        const bodies=world.physicsWorld.bodies.length, floor=city.groundAt(0,-44,5);
        const preview=city.surfaces.showPreview(edit);
        ok(preview.area>10,'Real Portland grass exists in selected bounds');
        ok(city.surfaces.blades===0,'Preview does not apply grass');
        city.surfaces.clearPreview(); editor.mapEdits=[edit]; city.surfaces.setEdits(editor.mapEdits); editor.commit();
        ok(city.surfaces.blades>100 && city.surfaces.blades<=80000,'Instanced grass generated within budget');
        ok(world.physicsWorld.bodies.length===bodies && city.groundAt(0,-44,5)===floor,'Source collisions and ground height unchanged');
        ok(snapshot.every(([id,bytes])=>{const current=new Uint8Array(city.loaded.get(id).vertices.buffer);return bytes.every((v,i)=>v===current[i]);}),'Original city vertex buffers byte-for-byte unchanged');
        const ray=new THREE.Raycaster(new THREE.Vector3(0,5,-44),new THREE.Vector3(0,-1,0));
        const hit=editor.surfaceHit(ray); ok(hit && !hit.object.userData.surfaceEditId && !hit.object.isInstancedMesh,'Placement ignores decorative grass and overlays');
        const packet=editor.packageScene(); ok(packet.mapEdits[0].id===edit.id,'Export includes surface edits');
        editor.restore(editor.history.undo()); ok(city.surfaces.blades===0,'Undo removes surface layer');
        editor.restore(editor.history.redo()); ok(city.surfaces.blades>100,'Redo restores surface layer');
        await editor.restoreSaved(); ok(editor.mapEdits.length===1 && city.surfaces.blades>100,'Saved scene restores surface layer');
        const sector=[...city.surfaces.sectors].find(([,group])=>group.userData.blades>0)[0];
        const before=city.surfaces.sectors.get(sector).children.find(n=>n.isInstancedMesh).instanceMatrix.array.slice();
        city.unload(sector); await city.loadSector(city.manifest.sectors.find(s=>s.id===sector));
        const after=city.surfaces.sectors.get(sector).children.find(n=>n.isInstancedMesh).instanceMatrix.array;
        ok(before.length===after.length && before.every((v,i)=>v===after[i]),'Streaming reload reproduces the same grass positions');
        world.camera.position.set(10,8,-30); world.camera.lookAt(0,-4,-44); world.camera.updateMatrixWorld();
        city.surfaces.update(); world.renderer.compile(world.graphicsWorld,world.camera); world.renderer.render(world.graphicsWorld,world.camera);
        ok(world.renderer.info.programs.every(p=>p.diagnostics?.runnable!==false),'Surface and grass shaders compile');
        const second={...edit,id:'asphalt',name:'Asfalto',style:'asphalt'};
        city.surfaces.setEdits([edit,second]); ok(city.surfaces.blades===0,'Later asphalt layer removes underlying blades inside its bounds');
        city.surfaces.setEdits([]); editor.mapEdits=[];
        const tool=editor.surfaceTool; tool.begin('sample');
        const sampleRay=new THREE.Raycaster(new THREE.Vector3(-10.8,-3,-44.8),new THREE.Vector3(0,-1,0));
        ok(tool.handlePick(sampleRay) && tool.texture===edit.texture,'Material picker samples the real city source mesh');
        tool.$('[data-style]').value='sand'; tool.preview();
        ok(!tool.$('[data-apply]').disabled,'Valid sample enables the apply action'); tool.apply();
        ok(editor.mapEdits.length===1 && editor.mapEdits[0].style==='sand','Surface tool applies the selected style to saved scene');
        tool.$('[data-remove]').click(); await new Promise(requestAnimationFrame);
        ok(editor.mapEdits.length===0,'Surface tool removes the selected intervention');
        results.textContent+='\nALL SURFACE CHECKS PASSED'; document.title='PASS · Surface checks';
    } catch(error) {results.textContent+=`\nFAIL ${error.stack}`;document.title='FAIL · Surface checks';}
    finally {localStorage.removeItem(key);}
})();
