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
 const material=new THREE.MeshPhysicalMaterial({
   map:texture,
   color:0xffffff,
   metalness:key==='purple'?.12:.05,
   roughness:key==='purple'?.49:.72,
   clearcoat:key==='purple'?.36:.17,
   clearcoatRoughness:.33,
   emissive:new THREE.Color(0x3c3c3c),
   emissiveMap:texture,
   emissiveIntensity:.45,
   side:THREE.DoubleSide,
   transparent:true,
   alphaTest:.11,
   depthWrite:true
 });
 const edgeMat=new THREE.MeshStandardMaterial({
   color:key==='compact'?0x59416f:key==='purple'?0x343139:0x53633e,
   roughness:key==='purple'?.52:.68,
   metalness:key==='purple'?.28:.14,
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
   for(let i=0;i<uv.count;i++){
     const x=pos.getX(i),y=pos.getY(i);
     uv.setXY(i,x/width+.5,y/height+.5);
   }
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
