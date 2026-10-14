import * as THREE from 'three';
import shapeData from './referenceContourData';

export type PhotoAsset='compact'|'purple'|'rifle';
type Traced={aspect:number;contours:readonly (readonly (readonly number[])[])[];holes:readonly (readonly (readonly number[])[])[];pixelSize:readonly number[]};
const records=shapeData as unknown as Record<PhotoAsset,Traced>;

/**
 * Real geometry + user-original photographic appearance.
 * Uses high-fidelity RGBA from their actual images and an alpha-derived
 * extruded silhouette, with real trigger holes and mechanical cutouts.
 * Thickness on unseen surfaces is inferred. It is a reference-constrained
 * reconstruction, not a measured scan / full multiview photogrammetry.
 */
export async function makePhotoReferenceModel(key:PhotoAsset):Promise<THREE.Group>{
 const src=records[key];
 const width=key==='compact'?5.5:key==='purple'?8.3:12.2;
 const height=width/src.aspect;
 const thickness=key==='compact'?.64:key==='purple'?.72:1.05;
 const group=new THREE.Group();group.name=key+' · Photo-matched 3D reconstructed volume';
 const toVec=(p:readonly number[])=>new THREE.Vector2((p[0]-.5)*width,(.5-p[1])*height);
 const toPath=(points:readonly (readonly number[])[],target:THREE.Path|THREE.Shape)=>{
   for(let i=0;i<points.length;i++){
     const v=toVec(points[i]);if(i===0)target.moveTo(v.x,v.y);
     else target.lineTo(v.x,v.y);
   }
   target.closePath();
 };
 const loader=new THREE.TextureLoader();
 const texture=await loader.loadAsync('./ref/'+key+'.webp');
 texture.colorSpace=THREE.SRGBColorSpace;
 texture.anisotropy=8;
 texture.wrapS=texture.wrapT=THREE.ClampToEdgeWrapping;
 // Product photo is already physically lit and color-graded.
 // Preserve exact pixels on the source-facing cap; use a separately lit PBR side.
 const material=new THREE.MeshBasicMaterial({
   map:texture,
   color:0xffffff,
   toneMapped:false,
   side:THREE.DoubleSide,
   transparent:true,
   alphaTest:.16,
   depthWrite:true
 });
 // The original image guides the side colour; it must NOT tile horizontally
 // around the extruded edge (which creates metallic zebra stripes).
 const canvas=document.createElement('canvas');
 const image=texture.image as HTMLImageElement;
 canvas.width=image.naturalWidth||image.width;canvas.height=image.naturalHeight||image.height;
 const ctx=canvas.getContext('2d',{willReadFrequently:true})!;
 ctx.drawImage(image,0,0);
 const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
 const samplePhoto=(x:number,y:number):THREE.Color=>{
   const ix=Math.max(0,Math.min(canvas.width-1,Math.round((x/width+.5)*(canvas.width-1))));
   const iy=Math.max(0,Math.min(canvas.height-1,Math.round((.5-y/height)*(canvas.height-1))));
   let chosen=-1;
   for(let rad=0;rad<=9&&chosen<0;rad++){
     for(let n=0;n<8;n++){
       const dx=rad*Math.cos(n*Math.PI/4),dy=rad*Math.sin(n*Math.PI/4);
       const xx=Math.max(0,Math.min(canvas.width-1,Math.round(ix+dx)));
       const yy=Math.max(0,Math.min(canvas.height-1,Math.round(iy+dy)));
       const j=(yy*canvas.width+xx)*4;
       if(pixels[j+3]>170){chosen=j;break;}
     }
   }
   if(chosen<0)return new THREE.Color(key==='compact'?0x3e3544:key==='purple'?0x493a4c:0x475044);
   return new THREE.Color().setRGB(pixels[chosen]/255,pixels[chosen+1]/255,pixels[chosen+2]/255,THREE.SRGBColorSpace);
 };
 const edgeMat=new THREE.MeshPhysicalMaterial({
   vertexColors:true,
   color:0x9a9a9a,
   roughness:key==='purple'?.74:.84,
   metalness:key==='purple'?.08:.025,
   clearcoat:.045,
   clearcoatRoughness:.82,
   envMapIntensity:.38,
   side:THREE.DoubleSide
 });
 // Outer contour and all usable transparency-derived holes.
 let count=0;
 for(const c of src.contours){
   if(c.length<4)continue;
   const s=new THREE.Shape();
   toPath(c,s);
   for(const hole of src.holes){
     if(hole.length<4)continue;
     // Test hole against outer silhouette with ray casting in normalized coordinates.
     let inside=false;
     for(let i=0,j=c.length-1;i<c.length;j=i++){
       const x=hole[0][0],y=hole[0][1], xi=c[i][0],yi=c[i][1],xj=c[j][0],yj=c[j][1];
       if(((yi>y)!==(yj>y)) && (x<(xj-xi)*(y-yi)/(yj-yi)+xi))inside=!inside;
     }
     if(inside){const h=new THREE.Path();toPath(hole,h);s.holes.push(h);}
   }
   const geom=new THREE.ExtrudeGeometry(s,{
     depth:thickness,
     bevelEnabled:true,
     bevelSegments:3,
     steps:1,
     bevelThickness:thickness*.025,
     bevelSize:width*.0035,
     curveSegments:3
   });
   // Center extrusion through Z=0, prepare accurate planar photo UVs for caps.
   geom.translate(0,0,-thickness*.5);
   const pos=geom.getAttribute('position'),uv=geom.getAttribute('uv');
   const colors=new Float32Array(pos.count*3);
   for(let i=0;i<pos.count;i++){
     const x=pos.getX(i),y=pos.getY(i);
     uv.setXY(i,x/width+.5,y/height+.5);
     const col=samplePhoto(x,y);
     colors[i*3]=col.r;colors[i*3+1]=col.g;colors[i*3+2]=col.b;
   }
   geom.setAttribute('color',new THREE.BufferAttribute(colors,3));
   uv.needsUpdate=true;
   geom.computeVertexNormals();
   const mesh=new THREE.Mesh(geom,[material,edgeMat]);
   mesh.name=key+' · textured extruded reference shell';
   mesh.castShadow=true;
   mesh.receiveShadow=true;
   group.add(mesh);count++;
 }
 // Geometric relief: textured components are still 3D volumes.
 // The image is never the background or a single rectangular 2D billboard.
 group.userData={
   subject:key,photoreference:true,geometries:count,
   dimensions:{width,height,depth:thickness},
   caveat:'Original frontal photo matches image pixels; unseen views geometrically inferred',
   material:'Image-anchored albedo + physical specular model'
 };
 const bounds=new THREE.Box3().setFromObject(group);
 const middle=bounds.getCenter(new THREE.Vector3());
 group.position.sub(middle);
 return group;
}
