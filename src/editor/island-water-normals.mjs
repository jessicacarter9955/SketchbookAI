import * as THREE from 'three';
import {islandNoise} from './island-data.mjs';

// Exact normal-map generator shared with the TWO-ISLAND water shader.
// Both IslandRuntime and the Urban Miami coastline use identical wave normals.
export function waterNormals() {
    const size=128, data=new Uint8Array(size*size*4);
    const height=(x,y)=>[8,16,32,64].reduce((sum,p,i)=>sum+islandNoise(x/size*p,y/size*p,42,p)/(2**i),0);
    for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
        const nx=(height(x+1,y)-height(x-1,y))*2, ny=(height(x,y+1)-height(x,y-1))*2;
        const normal=new THREE.Vector3(nx,ny,1).normalize(), i=(y*size+x)*4;
        data[i]=(normal.x*.5+.5)*255;data[i+1]=(normal.y*.5+.5)*255;data[i+2]=(normal.z*.5+.5)*255;data[i+3]=255;
    }
    const texture=new THREE.DataTexture(data,size,size); texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
    texture.magFilter=texture.minFilter=THREE.LinearFilter; texture.needsUpdate=true; return texture;
}
