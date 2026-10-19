/** The legacy DDS game expects scene, weapon attachments and a full animation set. */
import { LoadingManager } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { readPrivateExport, privateExportObjectURLs } from './dds-private-import.mjs';
import { loadDdsPlayer } from './DdsAssets';

export async function loadPrivateLegacyDdsPlayer() {
  const pack=await readPrivateExport('dds');
  if(!pack)return null;
  const urls=privateExportObjectURLs(pack);
  const loader=new GLTFLoader(new LoadingManager());
  loader.manager.setURLModifier(url=>urls.resolve(url));
  try {
    const model=await loadDdsPlayer({
      fetchImpl:async url=>url.endsWith('/manifest.json')
        ? {ok:true,json:async()=>pack.manifest}
        : fetch(url),
      loader,
    });
    model.scene.userData.importSource='private-browser-export';
    model.scene.userData.sourceVerified=false;
    return model;
  }finally{urls.release();}
}
