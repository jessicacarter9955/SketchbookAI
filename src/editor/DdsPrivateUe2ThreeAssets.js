/** Load original privately imported Unreal-exported GLBs, without any upload. */
import { LoadingManager } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { loadUe2ThreeCharacter } from './Ue2ThreeAssets';
import { readPrivateExport, privateExportObjectURLs } from './dds-private-import.mjs';

export async function loadPrivateUe2ThreeCharacter() {
  const pack=await readPrivateExport('ue2three');
  if(!pack) return null;
  const urls=privateExportObjectURLs(pack);
  try {
    const manager=new LoadingManager();
    manager.setURLModifier(url=>urls.resolve(url));
    const loader=new GLTFLoader(manager);
    const model=await loadUe2ThreeCharacter('build/local-scenes/ue2three/current/', {
      loader,
      fetchImpl:async url=>{
        if(url.endsWith('/manifest.json'))
          return {ok:true,json:async()=>pack.manifest};
        return fetch(url);
      }
    });
    model.scene.userData.importSource='private-browser-export';
    model.scene.userData.sourceVerified=false;
    return model;
  } finally {
    urls.release();
  }
}
