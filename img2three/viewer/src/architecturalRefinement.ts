import * as THREE from 'three';

/* High-detail procedural architecture refinement on top of img2threejs factory.
 * Front view is anchored to the supplied skyscraper reference. Other sides are
 * inferred, not measured, using the generated multi-angle concept references.
 * Every window, mullion and parapet occupies an actual 3D surface.
 */
export function buildArchitecturalRefinement() {
  const root=new THREE.Group();root.name='Reference-matched 3D architecture';
  const cube=new THREE.BoxGeometry(1,1,1);
  const stone=new THREE.MeshStandardMaterial({color:0xc5cacf,roughness:.76,metalness:.05});
  const limestone=new THREE.MeshStandardMaterial({color:0xe3e8e9,roughness:.71,metalness:.04});
  const shadowstone=new THREE.MeshStandardMaterial({color:0xa2aeb9,roughness:.72});
  const steel=new THREE.MeshStandardMaterial({color:0x526978,roughness:.31,metalness:.64});
  const dark=new THREE.MeshStandardMaterial({color:0x1b3447,roughness:.4,metalness:.34});
  const topGlass=new THREE.MeshPhysicalMaterial({color:0x90b5c8,roughness:.17,metalness:.34,clearcoat:.9,clearcoatRoughness:.11,envMapIntensity:1.8});
  function glass(color:number){
    return new THREE.MeshPhysicalMaterial({color,roughness:.135,metalness:.13,clearcoat:.89,clearcoatRoughness:.14,envMapIntensity:2});
  }
  const windowMats=[glass(0xabc4d5),glass(0x83a8c3),glass(0x6487a2),glass(0xc7d6e0),glass(0x456980),glass(0x93bfd7)];
  const unit=new THREE.Object3D();let meshCount=0,paneCount=0;
  function box(g:THREE.Group,label:string,x:number,y:number,z:number,w:number,h:number,d:number,mat:THREE.Material,cast=false) {
    const m=new THREE.Mesh(cube,mat);m.name=label;m.position.set(x,y,z);m.scale.set(w,h,d);
    m.castShadow=cast;m.receiveShadow=true;g.add(m);meshCount++;return m;
  }
  function group(name:string,rotateY:number,x:number,z:number) {
    const g=new THREE.Group();g.name=name;g.rotation.y=rotateY;g.position.set(x,0,z);root.add(g);return g;
  }
  function trim(g:THREE.Group,name:string,y:number,w:number,d:number) {
    box(g,name,y*0,y,.04,w,.058,d,limestone,true);
    box(g,name+' shadow seam',0,y-.036,.04,w*.994,.014,d*.99,steel);
  }
  function windowGrid(g:THREE.Group,name:string,width:number,y0:number,h:number,cols:number,rows:number,z:number,side=false) {
    const records:Array<Array<[number,number,number,number,number,number,number]>>=[[],[],[],[],[],[]];
    const stepX=width/cols,stepY=h/rows;
    for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
      const wx=-width/2+(col+.5)*stepX;
      const wy=y0+(row+.5)*stepY;
      const hash=((row*1297+col*613+name.length*47)*1759>>>0)%101;
      let mi=(hash%6);
      if(!side&&Math.abs(wx)<.14)mi=4;
      if(side&&mi===3)mi=2;
      records[mi].push([wx,wy,z,stepX*.82,stepY*.82,.026,hash]);
    }
    for(let bucket=0;bucket<records.length;bucket++){
      const values=records[bucket];if(!values.length)continue;
      const mesh=new THREE.InstancedMesh(cube,windowMats[bucket],values.length);
      mesh.name=name+' glass tiles variant '+bucket;
      values.forEach((v,i)=>{
        unit.position.set(v[0],v[1],v[2]);unit.scale.set(v[3],v[4],v[5]);unit.updateMatrix();
        mesh.setMatrixAt(i,unit.matrix);
        const variation=1-(v[6]%7)*.016;
        mesh.setColorAt(i,new THREE.Color(variation,variation,variation));
      });
      mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
      mesh.castShadow=false;mesh.receiveShadow=true;g.add(mesh);meshCount++;paneCount+=values.length;
    }
    for(let c=0;c<=cols;c++)box(g,name+' fine vertical steel grid',-width/2+stepX*c,y0+h/2,z+.025,.014,h+.015,.037,steel);
    for(let r=0;r<=rows;r++)box(g,name+' horizontal shadowed sash',0,y0+stepY*r,z+.027,width,.013,.037,steel);
  }
  // Primary silhouette: slim vertical shaft and a broader colonnaded podium.
  const W=2.06,D=1.56;
  box(root,'reinforced and recessed main concrete shell',0,5.98,0,W,8.94,D,shadowstone,true);
  box(root,'wide podium structural mass',0,.74,0,2.55,1.48,2.00,shadowstone,true);
  function podiumFace(name:string,rot:number,x:number,z:number,w:number){
    const g=group(name,rot,x,z);
    box(g,'black glazed ground floor recessed lobby',0,.255,.05,w,.485,.027,dark);
    for(let c=0;c<=10;c++){
      const px=(c/10-.5)*w;
      box(g,'structural stone portico column',px,.28,.14,.046,.56,.102,limestone,true);
      if(c<10)box(g,'recessed glass entrance bay',px+w/20,.27,.112,w/10*.8,.39,.018,windowMats[1]);
    }
    trim(g,'podium base entablature',.55,w+.10,.32);
    windowGrid(g,name+' lower facade',w,.66,.73,12,3,.135);
    for(let c=0;c<=12;c++)box(g,'podium white vertical limestone mullion',(c/12-.5)*w,1.02,.182,.024,.73,.072,limestone);
    trim(g,'podium first projecting cornice',1.42,w+.20,.39);
  }
  podiumFace('front podium',0,0,1.0,2.55);
  podiumFace('right podium',Math.PI/2,1.275,0,2.00);
  podiumFace('back podium',Math.PI,0,-1.0,2.55);
  podiumFace('left podium',-Math.PI/2,-1.275,0,2.00);
  function towerFace(name:string,rot:number,x:number,z:number,w:number,side:boolean){
    const g=group(name,rot,x,z),start=1.49,height=8.94,columns=side?8:12;
    box(g,'dark inset curtain wall backing',0,start+height/2,.025,w,height,.03,dark);
    windowGrid(g,name+' blue glazing',w*.965,start,height,columns,45,.073,side);
    for(let c=0;c<=columns;c++){
      let cx=-w/2+c*w/columns;
      const major=c===0||c===columns||c%3===0;
      box(g,'continuous limestone pilaster',cx,start+height/2,.139,major?.060:.012,height+.08,.096,major?limestone:stone);
    }
    if(!side){
      box(g,'central continuous azure window strip',0,start+height/2,.197,.143,height,.04,windowMats[4]);
      box(g,'white main feature rib left',-.196,start+height/2,.185,.046,height+.10,.116,limestone,true);
      box(g,'white main feature rib right', .196,start+height/2,.185,.046,height+.10,.116,limestone,true);
      for(let floor=0;floor<=45;floor++)box(g,'glass strip floor-level seam',0,start+floor*height/45,.225,.147,.010,.05,steel);
    }
    trim(g,'podium-to-tower stone edge',start,w+.12,.43);
    trim(g,'midrise-to-crown large white sill',10.43,w+.13,.42);
    for(let r=0;r<45;r+=5)box(g,'sunlit projecting floor sill',0,start+r*height/45,.145,w*.995,.014,.12,limestone);
  }
  towerFace('front west-facing tower',0,0,D/2,W,false);
  towerFace('right side tower',Math.PI/2,W/2,0,D,true);
  towerFace('rear inferred tower',Math.PI,0,-D/2,W,true);
  towerFace('left side tower',-Math.PI/2,-W/2,0,D,true);
  // The upper floor setback above the main shaft, with 5 rows of tall windows.
  const CW=1.45,CD=1.23;
  box(root,'setback sky lobby and penthouse core',0,10.89,0,CW,.96,CD,stone,true);
  function crownFace(name:string,rot:number,x:number,z:number,span:number){
    const g=group(name,rot,x,z);
    box(g,'shadowed top-story frame',0,10.89,.02,span,.92,.026,dark);
    windowGrid(g,name+' tall blue windows',span*.93,10.45,.90,8,5,.09);
    for(let c=0;c<=8;c++)box(g,'upper white roof tower pilaster',(c/8-.5)*span,10.90,.138,.030,.98,.09,limestone,true);
    trim(g,'penthouse projecting upper cornice',11.36,span+.25,.37);
  }
  crownFace('front crown',0,0,CD/2,CW);
  crownFace('right crown',Math.PI/2,CW/2,0,CD);
  crownFace('back crown',Math.PI,0,-CD/2,CW);
  crownFace('left crown',-Math.PI/2,-CW/2,0,CD);
  // Sloping multi-level glass crown, with real trapezoidal side surfaces.
  const rings=[[11.41,1.48,1.27],[11.53,1.43,1.21],[11.92,1.17,.99],[12.075,1.12,.94]];
  const vertices:number[]=[];
  function corners(r:number[]){return [[-r[1]/2,r[0],r[2]/2],[r[1]/2,r[0],r[2]/2],[r[1]/2,r[0],-r[2]/2],[-r[1]/2,r[0],-r[2]/2]];}
  for(let k=0;k<rings.length-1;k++){
    const a=corners(rings[k]),b=corners(rings[k+1]);
    for(let j=0;j<4;j++){
      const i=(j+1)%4;
      vertices.push(...a[j],...a[i],...b[i],...a[j],...b[i],...b[j]);
    }
  }
  const roofGeom=new THREE.BufferGeometry();roofGeom.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));roofGeom.computeVertexNormals();
  const cap=new THREE.Mesh(roofGeom,topGlass);cap.name='sloping glass crown (real 3D solid facades)';cap.castShadow=true;
  cap.material.side=THREE.DoubleSide;root.add(cap);meshCount++;
  for(let n=0;n<=7;n++){
    const t=n/7,y=11.43+t*.63,w=1.48-t*.36,d=1.27-t*.33;
    box(root,'glass crown metal floor band',0,y,0,w,.012,d,steel);
  }
  for(let side=0;side<4;side++){
    for(let k=-4;k<=4;k++){
      const x=k*.12;
      const rib=box(root,'vertical roof glazing mullion',side<2?x:side===2?.68:-.68,11.74,side<2?(side===0?.61:-.61):x,.015,.64,.018,steel);
      if(side<2)rib.rotation.x=side===0?-.22:.22;
      else rib.rotation.z=side===2?-.22:.22;
    }
  }
  box(root,'real 3D grey stone foundation',0,.028,0,2.67,.055,2.10,stone);
  const stats={paneInstances:paneCount,meshCount,floors:45,facadeFaces:4};
  root.userData.architectureStats=stats;
  root.userData.evidence="Primary source: user's frontal tower image. Synthetic side views are inferred, not measured.";
  return {group:root,stats};
}
