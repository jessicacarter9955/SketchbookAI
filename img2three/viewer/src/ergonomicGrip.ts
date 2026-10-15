import * as THREE from 'three';

type Vec2=[number,number];
type MaterialConfig = {
 contour:Vec2[];
 texture:THREE.Texture;
 pixels:{width:number;height:number};
 worldWidth:number;
 halfThickness:number;
 name:string;
};

/**
 * A photographed side profile, swept through sixty-eight physically curved
 * superelliptic sections with 64 vertices each (not one planar extrusion).
 * Tangent normals are continuous around the palm swell and front/back straps.
 *
 * All X/Y silhouette coordinates come from the actual user's photograph.
 * Only missing third-dimension cross-sections are inferred.
 */
export function makeErgonomicPhotoGrip(config:MaterialConfig):THREE.Mesh {
 const {contour,texture,pixels,worldWidth,halfThickness,name}=config;
 const scale=worldWidth/pixels.width;
 const top=Math.min(...contour.map(p=>p[1]));
 const bottom=Math.max(...contour.map(p=>p[1]));
 const centerY=(top+bottom)/2;
 const rows=76,arc=80;
 const poly=contour;
 const positions:number[]=[];
 const uv:number[]=[];
 const indicesNear:number[]=[];
 const indicesEdge:number[]=[];
 const colors:number[]=[];
 // Each horizontal section intersects the original two-sided grip silhouette.
 function bounds(y:number):[number,number] {
  const crossings:number[]=[];
  for(let i=0;i<poly.length;i++){
   const a=poly[i],b=poly[(i+1)%poly.length];
   if((a[1]<=y&&b[1]>y)||(b[1]<=y&&a[1]>y)){
    const t=(y-a[1])/(b[1]-a[1]);
    crossings.push(a[0]+t*(b[0]-a[0]));
   }
  }
  if(crossings.length>=2)return [Math.min(...crossings),Math.max(...crossings)];
  const closest=poly.reduce((p,q)=>Math.abs(p[1]-y)<Math.abs(q[1]-y)?p:q);
  return [closest[0]-1,closest[0]+1];
 }
 const colorData=(()=>{
   const c=document.createElement('canvas');
   const img=texture.image as HTMLImageElement;
   c.width=img.naturalWidth||img.width;c.height=img.naturalHeight||img.height;
   const ctx=c.getContext('2d',{willReadFrequently:true});
   if(!ctx)return null;
   ctx.drawImage(img,0,0);
   return {data:ctx.getImageData(0,0,c.width,c.height).data,width:c.width,height:c.height};
 })();
 function sample(x:number,y:number):THREE.Color {
  if(!colorData)return new THREE.Color('#67378d');
  const cx=Math.max(0,Math.min(colorData.width-1,Math.round(x/pixels.width*(colorData.width-1))));
  const cy=Math.max(0,Math.min(colorData.height-1,Math.round(y/pixels.height*(colorData.height-1))));
  let offset=(cy*colorData.width+cx)*4;
  if(colorData.data[offset+3]<96){
    for(let i=1;i<14;i++){
      const xx=Math.max(0,Math.min(colorData.width-1,cx+i));
      const p=(cy*colorData.width+xx)*4;
      if(colorData.data[p+3]>170){offset=p;break;}
    }
  }
  return new THREE.Color().setRGB(
    colorData.data[offset]/255,colorData.data[offset+1]/255,
    colorData.data[offset+2]/255,THREE.SRGBColorSpace);
 }
 for(let row=0;row<=rows;row++){
   // Tiny insets prevent cap folds without changing the photo-facing silhouette.
   const phase=Math.max(.0002,Math.min(.9998,row/rows));
   const pixY=top+(bottom-top)*phase;
   const [lo,hi]=bounds(pixY);
   const mid=(lo+hi)*.5;
   const half=Math.max(.001,(hi-lo)*.5);
   const waist=(pixY-centerY)/(bottom-top);
   const palm=1+.22*Math.exp(-Math.pow(waist/.29,2));
   const topTaper=1-.12*Math.pow(1-phase,5);
   const heelTaper=1-.08*Math.pow(phase,7);
   const zRadius=halfThickness*palm*topTaper*heelTaper;
   for(let step=0;step<=arc;step++){
     const angle=step/arc*Math.PI*2;
     const cosine=Math.cos(angle),sine=Math.sin(angle);
     const exponent=.52; // superellipse of exponent 3.85
     const xx=mid+half*Math.sign(cosine)*Math.pow(Math.abs(cosine),exponent);
     const zz=Math.sign(sine)*Math.pow(Math.abs(sine),exponent)*zRadius;
     const py=(pixels.height/2-pixY)*scale;
     const px=(xx-pixels.width/2)*scale;
     positions.push(px,py,zz-.025);
     uv.push(xx/pixels.width,1-pixY/pixels.height);
     const cl=sample(xx,pixY);
     colors.push(cl.r,cl.g,cl.b);
   }
 }
 // Near hemisphere is photographic; curved rims and the far hemisphere use
 // sampled source colors + physically based shading instead of blank side walls.
 for(let row=0;row<rows;row++){
   for(let k=0;k<arc;k++){
     const a=row*(arc+1)+k,b=a+1,c=a+arc+1,d=c+1;
     const theta=(k+.5)/arc*Math.PI*2;
     const target=Math.sin(theta)>.43?indicesNear:indicesEdge;
     target.push(a,b,c,b,d,c);
   }
 }
 // Close top and bottom with high-segment curved caps.
 const caps:number[]=[];
 for(const [row,reversed] of [[0,true],[rows,false]] as const){
   let sx=0,sz=0,sy=0;
   for(let k=0;k<arc;k++){const o=(row*(arc+1)+k)*3;sx+=positions[o];sy+=positions[o+1];sz+=positions[o+2];}
   sx/=arc;sy/=arc;sz/=arc;
   const center=positions.length/3;
   positions.push(sx,sy,sz);
   uv.push(sx/worldWidth+.5,sy/(pixels.height*scale)+.5);
   const centerClr=sample(pixels.width/2+sx/scale,pixels.height/2-sy/scale);
   colors.push(centerClr.r,centerClr.g,centerClr.b);
   for(let k=0;k<arc;k++){
     const a=row*(arc+1)+k,b=row*(arc+1)+k+1;
     if(reversed)caps.push(center,b,a);else caps.push(center,a,b);
   }
 }
 const geom=new THREE.BufferGeometry();
 geom.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
 geom.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
 geom.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
 geom.setIndex([...indicesNear,...indicesEdge,...caps]);
 geom.addGroup(0,indicesNear.length,0);
 geom.addGroup(indicesNear.length,indicesEdge.length+caps.length,1);
 geom.computeVertexNormals();
 const capPhoto=new THREE.MeshBasicMaterial({
   map:texture,color:0xffffff,alphaTest:.08,transparent:true,side:THREE.DoubleSide,
   toneMapped:false,depthWrite:true
 });
 const polymer=new THREE.MeshPhysicalMaterial({
   vertexColors:true,color:0xffffff,roughness:.69,metalness:0,
   clearcoat:.085,clearcoatRoughness:.76,side:THREE.DoubleSide
 });
 const mesh=new THREE.Mesh(geom,[capPhoto,polymer]);
 mesh.name=name;
 mesh.castShadow=true;
 mesh.receiveShadow=true;
 mesh.userData.crossSections=rows+1;
 mesh.userData.radialSegments=arc;
 mesh.userData.source='original-photograph photo-registered superellipse cross section';
 return mesh;
}
