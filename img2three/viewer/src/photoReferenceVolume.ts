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
 // Physical cross-section sizes, derived conservatively from the source image.
 // Positive Z stays source-locked; only the reverse face and shell walls loft.
 const smooth=(a:number,b:number,x:number)=>{const t=THREE.MathUtils.clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
 const band=(x:number,a:number,b:number,margin:number)=>smooth(a,a+margin,x)*(1-smooth(b-margin,b,x));
 function rifleRearThickness(x:number,y:number){
   const u=x/width+.5,v=.5-y/height+.5-.5; // normalized source U/V
   // Regions in the original source photo; smoothly joined instead of slabs.
   const brace=band(u,.00,.32,.055)*band(v,.04,.75,.10);
   const receiver=band(u,.28,.59,.065)*band(v,.04,.53,.10);
   const guard=band(u,.55,.92,.06)*band(v,.015,.30,.055);
   const grip=band(u,.245,.41,.045)*band(v,.32,.88,.09);
   const magazine=band(u,.46,.61,.055)*band(v,.38,.99,.10);
   const muzzle=band(u,.90,1,.035)*band(v,.07,.25,.035);
   return .26 +.22*brace+.40*receiver+.31*guard+.09*grip+.14*magazine+.04*muzzle;
 }

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
   // Reference-coordinate handguard vents are genuine open 3D cutouts.
   // Keep original traced holes, and supplement the dark openings whose
   // automatic alpha tracing did not recognize their dark interior.
   if(key==='rifle'){
     const cutouts:Array<[number,number,number,number]>=[
       [.818,.098,.058,.027], // farthest top elongated handguard slot
       [.662,.245,.065,.030], // 3 lower ventilation slots
       [.739,.245,.063,.030],
       [.818,.245,.060,.030]
     ];
     for(const [u,v,w,h] of cutouts){
       const p=new THREE.Path();const r=Math.min(w*.24,h*.42);
       const x0=(u-.5)*width,y0=(.5-v)*height,ww=w*width,hh=h*height;
       p.moveTo(x0-ww/2+r,y0-hh/2);
       p.lineTo(x0+ww/2-r,y0-hh/2);p.quadraticCurveTo(x0+ww/2,y0-hh/2,x0+ww/2,y0-hh/2+r);
       p.lineTo(x0+ww/2,y0+hh/2-r);p.quadraticCurveTo(x0+ww/2,y0+hh/2,x0+ww/2-r,y0+hh/2);
       p.lineTo(x0-ww/2+r,y0+hh/2);p.quadraticCurveTo(x0-ww/2,y0+hh/2,x0-ww/2,y0+hh/2-r);
       p.lineTo(x0-ww/2,y0-hh/2+r);p.quadraticCurveTo(x0-ww/2,y0-hh/2,x0-ww/2+r,y0-hh/2);p.closePath();
       s.holes.push(p);
     }
   }
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
   // True variable-section 3D loft: back and side are molded independent
   // volume regions; front cap is untouched to preserve photographic match.
   if(key==='rifle'){
     const positions=geom.getAttribute('position');
     for(let i=0;i<positions.count;i++){
       const x=positions.getX(i),y=positions.getY(i),z=positions.getZ(i);
       if(z<0){const rear=rifleRearThickness(x,y);positions.setZ(i,z*rear/(thickness*.5));}
     }
     positions.needsUpdate=true;
   }
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

 if(key==='rifle'){
   const blackMetal=new THREE.MeshPhysicalMaterial({color:0x1b1e21,metalness:.48,roughness:.56,clearcoat:.08,side:THREE.DoubleSide});
   const boreMetal=new THREE.MeshStandardMaterial({color:0x090b0d,metalness:.22,roughness:.92,side:THREE.DoubleSide});
   // Tubular muzzle follows the exact location measured from the original
   // green-black source silhouette. Open cylinder and real annular face.
   const cy=(.5-.147)*height,cx=(.952-.5)*width;
   const outer=.282,inner=.166,length=.91;
   const shell=new THREE.Mesh(new THREE.CylinderGeometry(outer,outer,length,96,1,true),blackMetal);
   shell.rotation.z=Math.PI/2;shell.position.set(cx,cy,0);
   shell.name='96-sided open cylinder for original muzzle';shell.castShadow=true;shell.receiveShadow=true;group.add(shell);
   const inside=new THREE.Mesh(new THREE.CylinderGeometry(inner,inner,length,96,1,true),boreMetal);
   inside.rotation.z=Math.PI/2;inside.position.copy(shell.position);
   inside.name='muzzle actual hollow inner wall';group.add(inside);
   const ring=new THREE.Mesh(new THREE.RingGeometry(inner,outer,96),blackMetal);
   ring.rotation.y=Math.PI/2;ring.position.set(cx+length*.5+.012,cy,0);
   ring.name='open front muzzle annulus';ring.castShadow=true;group.add(ring);
   // Recessed black cavities, separate from the outer source-facing photo.
   const cavity=new THREE.Mesh(new THREE.CircleGeometry(inner*.92,64),boreMetal);
   cavity.rotation.y=Math.PI/2;cavity.position.set(cx+length*.17,cy,0);
   cavity.name='recessed darkness visible through muzzle';group.add(cavity);
   const recess=new THREE.MeshStandardMaterial({color:0x101713,roughness:.96,metalness:.06,side:THREE.DoubleSide});
   for(const [u,v,w,h] of [[.818,.098,.058,.027],[.662,.245,.065,.03],[.739,.245,.063,.03],[.818,.245,.060,.03]]){
      const panel=new THREE.Mesh(new THREE.PlaneGeometry(w*width*.98,h*height*.97),recess);
      panel.position.set((u-.5)*width,(.5-v)*height,0.13);
      panel.name='shadowed interior, real handguard slot';group.add(panel);
   }
   group.userData.referenceLocked=true;
   group.userData.referenceContract='img2three/rifle-superprompt.md';
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
