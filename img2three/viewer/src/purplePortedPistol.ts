import * as THREE from 'three';
import {mat,pbr,cube,extrude,rod,cylinderX,screw,disc} from './modeling';
import {buildPortedShroud} from './portedShroud';

export function makePurplePortedPistol():THREE.Group{
 const g=new THREE.Group();g.name='Purple anodized long-barrel pistol | volumetric reconstruction';
 const violet=pbr(0xa238b2,.25,.79),highlight=pbr(0xca66df,.23,.62);
 const black=pbr(0x181b1e,.65,.09),matte=mat(0x272a2c,.82,.06);
 const steel=pbr(0x62676c,.29,.76),red=pbr(0xd62124,.49,.18);
 const gunmetal=pbr(0x0d1013,.41,.68);
 // A *physically hollow* barrel and radial vent holes; no closed planar cap.
 const shroudMat=new THREE.MeshPhysicalMaterial({color:0x9a3fb1,metalness:.74,roughness:.29,clearcoat:.19,side:THREE.DoubleSide});
 const interiorMat=new THREE.MeshStandardMaterial({color:0x16161e,metalness:.46,roughness:.61,side:THREE.DoubleSide});
 buildPortedShroud(g,shroudMat,interiorMat);
 // True barrel is recessed behind the shroud rim, not a filled muzzle cap.
 cylinderX(g,'recessed barrel core',-.12,1.04,0,5.45,.244,gunmetal,96);
 // Rear collar remains independently machined.
 cylinderX(g,'rear thread housing',2.64,1.04,0,.18,.438,black,96);
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
 extrude(g,'black curved trigger',[[-.0,.02],[.15,-.07],[.08,-.29],[-.04,-.51],[-.19,-.48],[-.03,-.19]],.14,matte,[],[0,0,.12],.01);
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
