import * as THREE from 'three';
import { collectSurface, insideBounds, intersectsBounds, randomGenerator, triangleArea } from './surface-data.mjs';

const noiseGLSL = `
float surfaceHash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float surfaceNoise(vec2 p) {
    vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(mix(surfaceHash(i),surfaceHash(i+vec2(1,0)),f.x),mix(surfaceHash(i+vec2(0,1)),surfaceHash(i+vec2(1,1)),f.x),f.y);
}\n`;

function groundMaterial(style) {
    const colors={grass:0x3b502c,asphalt:0x303238,sand:0x9d8b64};
    const mat=new THREE.MeshStandardMaterial({color:colors[style],roughness:0.98,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-2});
    mat.onBeforeCompile=shader=>{
        shader.vertexShader='varying vec3 surfaceWorld;\n'+shader.vertexShader;
        shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nsurfaceWorld=(modelMatrix*vec4(position,1.0)).xyz;');
        shader.fragmentShader='varying vec3 surfaceWorld;\n'+noiseGLSL+shader.fragmentShader;
        shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
            float broad=surfaceNoise(surfaceWorld.xz*0.7), fine=surfaceNoise(surfaceWorld.xz*37.0);
            diffuseColor.rgb*=0.72+0.32*broad+0.18*fine;`);
    };
    mat.customProgramCacheKey=()=> 'city-surface-v1'; return mat;
}

function grassMaterial(time) {
    const mat=new THREE.MeshStandardMaterial({color:0xffffff,roughness:0.95,side:THREE.DoubleSide,alphaTest:0.1});
    mat.onBeforeCompile=shader=>{
        shader.uniforms.surfaceTime=time;
        shader.vertexShader='uniform float surfaceTime; varying vec2 bladeUV; varying float bladeFade;\n'+shader.vertexShader;
        shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
            bladeUV=uv;
            vec3 root=(modelMatrix*instanceMatrix*vec4(0.0,0.0,0.0,1.0)).xyz;
            float wave=sin(surfaceTime*1.8+root.x*0.35+root.z*0.28)+0.45*sin(surfaceTime*3.1+root.z*0.8);
            transformed.x+=wave*0.16*uv.y*uv.y;
            transformed.z+=sin(surfaceTime+root.x*0.22)*0.1*uv.y*uv.y;
            bladeFade=1.0-smoothstep(65.0,110.0,distance(root,cameraPosition));`);
        shader.fragmentShader='varying vec2 bladeUV; varying float bladeFade;\n'+shader.fragmentShader;
        shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
            diffuseColor.rgb*=mix(vec3(0.6,0.66,0.5),vec3(1.08,1.04,0.79),bladeUV.y);
            diffuseColor.a*=bladeFade;`);
    };
    mat.customProgramCacheKey=()=> 'city-grass-v1'; return mat;
}

function surfaceGeometry(triangles) {
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(triangles.flat(2),3));
    geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere(); return geometry;
}

export class SurfaceLayers {
    constructor(runtime) {
        this.runtime=runtime; this.edits=[]; this.sectors=new Map(); this.blades=0; this.time={value:0}; this.preview=null;
        this.root=new THREE.Group(); this.root.name='Modifiche superfici'; this.root.userData.editorSurface=true;
        runtime.world.graphicsWorld.add(this.root);
    }
    update() { this.time.value=performance.now()/1000; }
    setEdits(edits) {
        this.edits=JSON.parse(JSON.stringify(edits));
        for (const id of [...this.sectors.keys()]) this.removeSector(id);
        for (const [id,data] of [...this.runtime.loaded].sort(([a],[b])=>a.localeCompare(b))) this.loadSector(id,data);
    }
    disposeGroup(group) {
        group.traverse(node=>{ node.geometry?.dispose(); node.material?.dispose(); });
        group.removeFromParent();
    }
    removeSector(id) {
        const group=this.sectors.get(id); if (!group) return;
        this.blades-=group.userData.blades || 0; this.disposeGroup(group); this.sectors.delete(id);
    }
    loadSector(id,data) {
        this.removeSector(id);
        const group=new THREE.Group(); group.userData.blades=0; this.root.add(group); this.sectors.set(id,group);
        this.edits.forEach((edit,index)=>{
            if (!intersectsBounds([...data.meta.bounds[0],...data.meta.bounds[1]],edit.bounds)) return;
            const {triangles,area}=collectSurface(data.vertices,data.meta.groups,edit); if (!triangles.length) return;
            const material=groundMaterial(edit.style); material.polygonOffsetUnits=-2*(index+1);
            const ground=new THREE.Mesh(surfaceGeometry(triangles),material); ground.renderOrder=20+index; ground.userData.surfaceEditId=edit.id;
            group.add(ground);
            if (edit.style !== 'grass') return;
            const count=Math.min(24000,Math.ceil(area*edit.density),Math.max(0,80000-this.blades)); if (!count) return;
            // A tapered, segmented blade bends smoothly; instancing keeps one draw call per patch.
            const blade=new THREE.PlaneGeometry(0.11,1,1,3); blade.translate(0,0.5,0);
            const positions=blade.attributes.position;
            for (let i=0;i<positions.count;i++) positions.setX(i,positions.getX(i)*(1-positions.getY(i)*0.94));
            blade.computeVertexNormals();
            const grass=new THREE.InstancedMesh(blade,grassMaterial(this.time),count);
            let hash=edit.seed; for (const char of id) hash=(Math.imul(hash,31)+char.charCodeAt(0))>>>0;
            const random=randomGenerator(hash), matrix=new THREE.Object3D(), color=new THREE.Color();
            const later=this.edits.slice(index+1).filter(e=>e.texture===edit.texture);
            let total=0; const cumulative=triangles.map(t=>total+=triangleArea(t)); let written=0;
            for (let i=0;i<count;i++) {
                const wanted=random()*total; let low=0,high=cumulative.length-1;
                while(low<high) { const mid=(low+high)>>1; if(cumulative[mid]<wanted) low=mid+1; else high=mid; }
                const t=triangles[low], u=Math.sqrt(random()),v=random();
                const point=[0,1,2].map(a=>(1-u)*t[0][a]+u*(1-v)*t[1][a]+u*v*t[2][a]);
                if(later.some(e=>insideBounds(point,e.bounds))) continue;
                matrix.position.set(point[0],point[1]+0.007,point[2]); matrix.rotation.set(0,random()*Math.PI*2,0);
                matrix.scale.set(0.65+random()*0.9,edit.height*(0.6+random()*0.7),1); matrix.updateMatrix(); grass.setMatrixAt(written,matrix.matrix);
                color.setHSL(0.21+random()*0.035,0.32+random()*0.15,0.32+random()*0.15); grass.setColorAt(written,color); written++;
            }
            grass.count=written; grass.instanceMatrix.needsUpdate=true; if(grass.instanceColor) grass.instanceColor.needsUpdate=true;
            // Expand for wind, since the static instance bounds do not include shader displacement.
            grass.computeBoundingSphere(); grass.boundingSphere.radius+=1;
            group.add(grass); group.userData.blades+=written; this.blades+=written;
        });
    }
    clearPreview() { if(this.preview) { this.disposeGroup(this.preview); this.preview=null; } }
    showPreview(edit) {
        this.clearPreview(); const preview=new THREE.Group(); preview.name='Anteprima area'; this.root.add(preview); this.preview=preview;
        let area=0, count=0;
        for(const data of this.runtime.loaded.values()) {
            if(!intersectsBounds([...data.meta.bounds[0],...data.meta.bounds[1]],edit.bounds)) continue;
            const found=collectSurface(data.vertices,data.meta.groups,edit); area+=found.area; count+=found.triangles.length;
            if(found.triangles.length) { const mesh=new THREE.Mesh(surfaceGeometry(found.triangles),new THREE.MeshBasicMaterial({color:0x50ecc2,transparent:true,opacity:0.55,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-100})); mesh.renderOrder=100; preview.add(mesh); }
        }
        const box=new THREE.Box3(new THREE.Vector3(...edit.bounds.slice(0,3)),new THREE.Vector3(...edit.bounds.slice(3)));
        const outline=new THREE.Box3Helper(box,0xafffe1); preview.add(outline);
        return {area,triangles:count};
    }
}
