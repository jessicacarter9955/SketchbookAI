import * as THREE from 'three';
import {mat,pbr,cube,extrude,rod,cylinderX,screw,disc} from './modeling';

export function makeCompactPistol():THREE.Group{
 const g=new THREE.Group();g.name='Compact purple pistol | full 3D sculpt';
 const purple=pbr(0x6543a5,.66,.02),purpleLight=pbr(0x8453bd,.59,.01);
 const dark=pbr(0x17191e,.56,.38),black=mat(0x17191e,.82,.01);
 const steel=pbr(0xaab1b6,.23,.83),grey=mat(0x55575c,.49,.28);
 // Black metal slide, beveled at the front and rear and fitted to purple frame.
 cube(g,'black slide',[-.12,.98,0],[4.5,.77,.78],dark,.08);
 cube(g,'top machined flat',[-.12,1.37,0],[4.18,.07,.66],grey,.022);
 cube(g,'brushed silver barrel housing',[.32,1.31,.415],[.88,.32,.022],steel,.035);
 cube(g,'silver ejection port depression',[.25,1.265,.435],[.57,.08,.014],grey,.01);
 cube(g,'upper polymer dust cover',[.22,.42,.025],[3.43,.36,.69],purple,.055);
 extrude(g,'one-piece molded lower receiver',[[-2.25,.48],[-1.94,.22],[-.55,.24],[.05,.18],[1.92,.20],[1.97,.78],[-2.20,.81]],.74,purple,[],[0,0,0],.042);
 // Pistol grip follows angled contours and has true volume.
 const grip=[[-1.84,.27],[-.72,.27],[-.38,-.20],[-.69,-1.96],[-1.92,-1.99],[-2.03,-1.64],[-1.91,-.45]];
 extrude(g,'anatomical angled purple grip',grip,.75,purple,[],[0,0,-.02],.064);
 extrude(g,'grip side texturing zone',[[-1.78,-.47],[-.92,-.43],[-.86,-1.66],[-1.75,-1.72]],.025,purpleLight,[],[0,0,.411],.01);
 extrude(g,'triangular lower stipple patch',[[-1.77,-1.72],[-.97,-1.72],[-1.39,-1.17]],.018,purpleLight,[],[0,0,.444],.009);
 cube(g,'magazine base floorplate',[-1.34,-2.054,0],[1.42,.19,.82],black,.09);
 // Integrated frame trigger loop with ACTUAL open void through depth.
 const outside=[[-.63,.31],[1.12,.31],[1.24,.04],[1.08,-.55],[.57,-.81],[-.27,-.74],[-.69,-.37]];
 const inside=[[-.34,.09],[.87,.09],[.99,-.02],[.82,-.43],[.54,-.54],[-.21,-.51],[-.47,-.27]];
 extrude(g,'real hollow trigger guard',outside,.44,purple,[inside],[0,0,0],.055);
 extrude(g,'black trigger curved plate',[[.05,.05],[.30,.02],[.25,-.16],[.08,-.36],[-.03,-.39],[.09,-.11]],.16,black,[],[0,0,.015],.008);
 cube(g,'central trigger safety blade',[.11,-.19,.115],[.045,.27,.018],grey,.008);
 // Two outer rails, machining fasteners and serrated slide-cut grooves.
 for(let side of [-1,1]){
   const zz=side*.405;
   for(let i=0;i<9;i++){
     const x=-2.04+i*.119;
     const line=cube(g,'rear diagonal slide serration',[x,1.012,zz],[.038,.52,.027],mat(0x0b0f15,.53,.42));
     line.rotation.z=-.20;
   }
   for(let i=0;i<7;i++){
     const x=1.28+i*.135;
     const line=cube(g,'forward diagonal slide serration',[x,1.017,zz],[.039,.48,.027],mat(0x11151b,.49,.5));
     line.rotation.z=-.22;
   }
   screw(g,-.41,.48,zz+.029*side,.057);screw(g,1.39,.39,zz+.02*side,.04);
   // Raised, densely clustered tactile grip bumps.
   const dots:number=280;const geo=new THREE.IcosahedronGeometry(.013,0);
   const mesh=new THREE.InstancedMesh(geo,purpleLight,dots);
   const obj=new THREE.Object3D();
   for(let i=0;i<dots;i++){
     const row=Math.floor(i/14),col=i%14;
     obj.position.set(-1.77+col*.063,-.50-row*.054,zz+side*.015);
     obj.scale.set(1,.75,.35);obj.updateMatrix();mesh.setMatrixAt(i,obj.matrix);
   }
   mesh.name='individually textured polymer stipple';g.add(mesh);
 }
 // Rails, sights, controls, open barrel bore and guide rod facing muzzle +X.
 for(let i=0;i<4;i++)cube(g,'accessory rail tooth',[1.11+i*.23,.13,.34],[.11,.12,.20],purpleLight,.016);
 cube(g,'front steel sight',[1.79,1.52,0],[.22,.22,.19],black,.02);
 cube(g,'rear U-shaped iron sight',[-1.78,1.52,0],[.35,.22,.38],black,.02);
 cube(g,'front sight lime sighting dot',[1.8,1.64,.19],[.07,.038,.025],mat(0xd9e791,.4));
 cylinderX(g,'muzzle inner steel barrel',2.19,.97,.0,.21,.235,steel,32);
 cylinderX(g,'muzzle dark bore',2.319,.97,0,.023,.177,mat(0x080a0f,.43),30);
 cylinderX(g,'recoil spring guide end',2.27,.66,0,.08,.083,dark,22);
 cube(g,'polymer slide stop lever',[-.81,.55,.435],[.38,.075,.08],black,.019);
 cube(g,'magazine release button',[-1.12,.09,.43],[.23,.15,.08],black,.028);
 for(let i=0;i<6;i++)cube(g,'front rail relief',[1.25+i*.14,.245,.39],[.065,.065,.02],purpleLight);
 g.rotation.set(0,0,0);return g;
}
