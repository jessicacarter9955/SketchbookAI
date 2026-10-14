import * as THREE from 'three';
import {mat,pbr,cube,extrude,rod,cylinderX,screw,disc} from './modeling';

export function makePurplePortedPistol():THREE.Group{
 const g=new THREE.Group();g.name='Purple anodized long-barrel pistol | volumetric reconstruction';
 const violet=pbr(0xa238b2,.25,.79),highlight=pbr(0xca66df,.23,.62);
 const black=pbr(0x181b1e,.65,.09),matte=mat(0x272a2c,.82,.06);
 const steel=pbr(0x62676c,.29,.76),red=pbr(0xd62124,.49,.18);
 const gunmetal=pbr(0x0d1013,.41,.68);
 // True round tube, with rings and physically shaded aluminum outer shell.
 cylinderX(g,'anodized purple aluminum barrel',-.51,1.04,0,6.3,.465,violet,80);
 cylinderX(g,'inner black barrel bore behind shroud',-3.55,1.04,0,.12,.281,gunmetal,44);
 cylinderX(g,'black knurled muzzle thread collar',-3.68,1.04,0,.33,.447,black,64);
 cylinderX(g,'muzzle dark hole',-3.88,1.04,0,.025,.28,mat(0x060709,.62),32);
 cylinderX(g,'far rear threaded endcap',2.7,1.04,0,.29,.23,gunmetal,35);
 // Hundreds of visible machined grooves on the end cap.
 for(let i=0;i<24;i++){
  const ang=2*Math.PI*i/24,y=1.04+Math.cos(ang)*.456,z=Math.sin(ang)*.456;
  const rib=cube(g,'knurled black steel barrel collar',[-3.70,y,z],[.245,.02,.034],gunmetal);rib.rotation.x=ang;
 }
 // Port-hole illusion is deliberately recessed 3D slot cavity rather than a picture.
 for(let side of [-1,1]){
  for(let row=0;row<2;row++)for(let i=0;i<3;i++){
   const len=i===1?.73:.27,px=-2.69+i*.73;
   const py=1.04+(row===0?.185:-.18),pz=side*.432;
   cube(g,'black recessed ventilation port',[px,py,pz],[len,.14,.06],gunmetal,.067);
   cube(g,'metal port inner reflected chamfer',[px,py,pz+side*.036],[len*.82,.085,.009],black,.033);
   for(let tip of [-1,1])disc(g,px+tip*len*.41,py,pz+side*.043,.015,highlight);
  }
 }
 // Fore section rail and black molded receiver.
 cube(g,'black receiver upper chassis',[.55,.48,0],[4.72,.43,.77],black,.08);
 extrude(g,'one-piece molded black lower body',[[-1.25,.55],[-1.15,.04],[-.72,-.05],[1.76,-.06],[2.45,.35],[2.50,.70],[-.94,.70]],.78,matte,[],[0,0,0],.055);
 const grip=[ [.88,.26],[2.17,.24],[2.32,-.44],[2.65,-2.16],[1.35,-2.16],[.98,-1.18] ];
 extrude(g,'angled ergonomic black pistol grip',grip,.74,black,[],[0,0,-.01],.085);
 extrude(g,'deep polymer grippy side texture panel',[[1.36,-.51],[2.23,-.51],[2.55,-1.85],[1.57,-1.86]],.025,matte,[],[0,0,.405],.015);
 cube(g,'black textured grip baseplate',[2.03,-2.29,0],[1.34,.23,.78],matte,.07);
 // Trigger loop uses actual geometry opening.
 extrude(g,'continuous hollow trigger guard',[[-.77,.19],[.95,.19],[1.23,-.20],[1.14,-.63],[.75,-.91],[-.59,-.83],[-.94,-.47]],.38,black,
 [[[-.51,-.06],[.72,-.06],[.90,-.25],[.85,-.55],[.65,-.68],[-.37,-.62],[-.67,-.42]]],[0,0,0],.05);
 extrude(g,'black curved trigger",[[-.0,.02],[.15,-.07],[.08,-.29],[-.04,-.51],[-.19,-.48],[-.03,-.19]],.14,matte,[],[0,0,.12],.01);
 extrude(g,'red trigger safety button',[[.07,-.27],[.20,-.25],[.17,-.53],[.04,-.59]],.14,red,[],[0,0,.19],.008);
 for(const s of [-1,1]){
   cube(g,'black upper bridge rail',[.3,.66,s*.34],[3.6,.055,.095],gunmetal,.02);
   screw(g,-.52,.38,s*.401,.092,0x252728);
   screw(g,.28,.36,s*.402,.04,0x252728);
   cube(g,'upper frame ribbed safety lever',[1.19,.52,s*.41],[.29,.088,.05],steel,.02);
 }
 // Adjustable sights, fluorescent reference dot and rear screws.
 cube(g,'forward fiber optic sight block',[-2.64,1.59,0],[.43,.23,.3],black,.02);
 cube(g,'front neon fibre element',[-2.67,1.72,.12],[.18,.038,.026],mat(0xc9f05d,.39));
 cube(g,'rear elevated adjustable sight',[2.15,1.59,0],[.43,.18,.35],gunmetal,.03);
 cube(g,'rear notch upright',[2.15,1.72,0],[.18,.125,.42],black,.013);
 screw(g,2.33,1.66,.205,.044,0x4d5054);
 // Cast ribs and raised molded grip pattern.
 for(let side of [-1,1]){
  for(let k=0;k<20;k++){
   const y=-.51-k*.073,x=2.25+Math.max(0,-y-.48)*.17;
   cube(g,'molded ergonomic rear grip ridge',[x,y,side*.408],[.065,.027,.036],matte);
  }
  const count=620,inst=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(.010,0),mat(0x393c40,.94),count),dummy=new THREE.Object3D();
  for(let k=0;k<count;k++){let col=k%31,row=Math.floor(k/31);dummy.position.set(1.45+col*.025,-.60-row*.057,side*.428);dummy.scale.set(1,1,.65);dummy.updateMatrix();inst.setMatrixAt(k,dummy.matrix);} inst.instanceMatrix.needsUpdate=true;inst.name='physical stipple microgeometry';g.add(inst);
 }
 return g;
}
