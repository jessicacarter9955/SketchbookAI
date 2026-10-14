import * as THREE from 'three';
import {mat,pbr,cube,extrude,rod,cylinderX,screw,disc} from './modeling';

export function makeLimeGreenCarbine():THREE.Group{
 const g=new THREE.Group();g.name='Lime green carbine | exterior 3D visualization';
 const green=pbr(0xa5f719,.37,.34),light=pbr(0xc2ff45,.31,.34),shadow=pbr(0x6cc00e,.48,.20);
 const black=mat(0x21252a,.76,.06),blackGloss=pbr(0x0f1518,.30,.73),grey=pbr(0x50585f,.39,.62);
 const rubber=mat(0x303236,.94,.01),hole=mat(0x090d10,.86,.09),steel=pbr(0x1d2229,.29,.70);
 // Direction: brace and stock left, ventilated handguard right.
 cylinderX(g,'full metal barrel',3.85,.85,0,5.25,.205,steel,36);
 cylinderX(g,'steel muzzle brake',6.6,.85,0,.71,.275,blackGloss,32);
 cylinderX(g,'front muzzle circular opening',6.979,.85,0,.03,.17,hole,30);
 for(const s of [-1,1])for(let k=0;k<3;k++){
   cube(g,'muzzle compensator ports',[6.41+k*.175,.85,s*.267],[.105,.115,.016],hole,.04);
 }
 // Distinct M-LOK 3D handguard: green housing with side slots, not a flat image.
 cube(g,'full-length green machined handguard',[3.41,.88,0],[5.23,.79,.69],green,.073);
 cube(g,'handguard upper thin ridged frame',[3.41,1.29,0],[5.23,.08,.75],light,.03);
 for(const side of [-1,1]){
   const zz=side*.366;
   for(let row=0;row<2;row++)for(let i=0;i<3;i++){
     const x=1.65+i*1.36,y=.98+(row?-.29:.21);
     cube(g,'deep M-LOK cutout',[x,y,zz],[.88,.13,.05],hole,.067);
     cube(g,'machined inner slot shadow',[x,y,zz+side*.026],[.70,.056,.024],grey,.021);
   }
   for(let i=0;i<17;i++){
     const x=1.09+i*.275;
     cube(g,'handguard grippy rail teeth',[x,.89,zz+.009*side],[.078,.30,.053],i%4===0?shadow:green,.012);
   }
   for(let x of [1.2,3.9,5.7]){screw(g,x,.74,zz+side*.04,.045);}
 }
 // Full continuous machined Picatinny railing.
 cube(g,'top handguard rifle rail',[2.6,1.385,0],[7.0,.125,.74],green,.02);
 for(let i=0;i<64;i++)cube(g,'individual raised Picatinny rail tooth',[-.78+i*.117,1.48,0],[.064,.096,.68],i%7===0?light:green,.008);
 // Receiver is not a billboard; shape has real depth and chamfered silhouette.
 extrude(g,'upper receiver solid',[[ -1.95,.82],[-1.88,1.36],[.89,1.36],[1.13,1.05],[.78,.69],[-1.70,.72]],.78,green,[],[0,0,0],.055);
 extrude(g,'lower receiver with angled magazine well',[[-1.72,.90],[.76,.91],[1.18,.20],[.98,-.31],[-.17,-.31],[-.65,.06],[-1.6,.07]],.72,green,[],[0,0,0],.065);
 cube(g,'black hinged metal ejection port',[-.29,1.06,.423],[1.24,.38,.042],black,.052);
 cube(g,'ejection port latch',[-.69,1.03,.459],[.17,.12,.055],grey,.01);
 cube(g,'machined magazine release',[.49,.43,.413],[.21,.18,.06],black,.032);
 for(let x of [-1.59,-1.1,-.11,.45])screw(g,x,.62,.42,.047,0x27292a);
 // Black magazine body with angled top and side grip tabs.
 const mag=extrude(g,'physically thick black 30-round magazine outer silhouette',[[.31,.03],[1.22,.03],[1.78,-2.07],[.92,-2.35]],.62,black,[],[0,0,-.005],.045);
 extrude(g,'embossed magazine side panel',[[.51,-.40],[1.16,-.33],[1.61,-1.97],[1.02,-2.12]],.016,rubber,[],[0,0,.332],.017);
 for(let i=0;i<10;i++){
   const y=-.54-i*.15,x=.83+(-y)*.18;
   cube(g,'molded magazine rib',[x,y,.348],[.53,.027,.02],grey);
 }
 cube(g,'magazine baseplate',[1.37,-2.25,.0],[1.05,.15,.71],black,.045).rotation.z=.16;
 // Pistol grip, slightly raked rearward.
 extrude(g,'ribbed black ergonomic pistol grip',[[-1.36,.31],[-.45,.28],[-.76,-.20],[-1.08,-1.71],[-1.87,-1.53],[-1.57,-.55]],.67,black,[],[0,0,-.04],.065);
 extrude(g,'black inset grip stipple panel',[[-1.4,-.54],[-.83,-.43],[-1.15,-1.42],[-1.63,-1.38]],.027,rubber,[],[0,0,.314],.025);
 for(let i=0;i<18;i++)cube(g,'rubber raised finger grip ridge',[-1.04-i*.008,-.23-i*.063,.365],[.33,.018,.026],rubber);
 extrude(g,'open 3D trigger guard',[[-.48,.07],[.64,.07],[.75,-.24],[.57,-.59],[-.44,-.60],[-.71,-.37]],.39,black,
 [[[-.25,-.11],[.48,-.11],[.51,-.27],[.38,-.40],[-.32,-.41],[-.44,-.32]]],[0,0,.012],.038);
 extrude(g,'steel trigger',[[.03,.03],[.22,-.10],[.12,-.23],[.09,-.36],[-.03,-.35],[-.02,-.11]],.12,steel,[],[0,0,.09],.01);
 // Stabilizing brace / skeleton adjustable rear stock with holes.
 cylinderX(g,'black buttstock buffer tube',-2.55,.87,0,2.4,.195,steel);
 cube(g,'rear collapsible brace cheek section',[-3.32,.84,0],[2.04,.53,.68],black,.09);
 extrude(g,'rear stock structural brace',[[-4.73,1.03],[-4.31,1.30],[-3.47,1.15],[-3.33,.66],[-3.84,.11],[-4.70,-.49],[-5.00,-.30],[-4.91,.78]],.76,black,[],[0,0,0],.052);
 extrude(g,'open negative space in receiver brace',[[-4.75,.57],[-4.04,.90],[-3.8,.71],[-3.9,.25],[-4.69,-.02]],.07,gunmetalMat(),[],[0,0,.40],.021);
 cube(g,'textured stabilizing backpad',[-4.91,.42,0],[.35,1.60,.90],rubber,.095);
 cube(g,'brace black padded strap',[-4.86,.63,.471],[.32,.72,.041],black);
 for(let i=0;i<15;i++)cube(g,'butt brace layered hatch',[-4.96,-.23+i*.077,.52],[.1,.034,.026],i%3===0?grey:black);
 for(let i=0;i<3;i++)screw(g,-4.17+i*.36,.42,.416,.045);
 // Extended rail/magwell geometric recesses, knobs and clamp.
 cube(g,'black handguard securing collar',[1.01,.88,0],[.18,.88,.80],black,.03);
 cylinderX(g,'barrel locking collar',[1.17,.86,0,.20,.23,steel);
 screw(g,1.02,1.08,.426,.07);screw(g,1.02,.72,.426,.07);
 const microCount=520,inst=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(.012,0),rubber,microCount),dummy=new THREE.Object3D();
 for(let n=0;n<microCount;n++){const row=Math.floor(n/26),col=n%26;dummy.position.set(-1.52+col*.021,-.60-row*.043,.37);dummy.scale.set(1,1,.5);dummy.updateMatrix();inst.setMatrixAt(n,dummy.matrix);}
 inst.name='high-resolution polymer grip texture';g.add(inst);
 return g;
}
function gunmetalMat(){return mat(0x101317,.77,.08);}
