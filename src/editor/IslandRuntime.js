import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Water } from 'three/examples/jsm/objects/Water';
import { DEFAULT_ISLAND, validateIsland, islandHeight, islandCenters, islandNoise } from './island-data.mjs';

function waterNormals() {
    const size=128, data=new Uint8Array(size*size*4);
    const height=(x,y)=>[8,16,32,64].reduce((sum,p,i)=>sum+islandNoise(x/size*p,y/size*p,42,p)/(2**i),0);
    for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
        const nx=(height(x+1,y)-height(x-1,y))*2, ny=(height(x,y+1)-height(x,y-1))*2;
        const normal=new THREE.Vector3(nx,ny,1).normalize(), i=(y*size+x)*4;
        data[i]=(normal.x*.5+.5)*255;data[i+1]=(normal.y*.5+.5)*255;data[i+2]=(normal.z*.5+.5)*255;data[i+3]=255;
    }
    const texture=new THREE.DataTexture(data,size,size); texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
    texture.magFilter=texture.minFilter=THREE.LinearFilter; texture.needsUpdate=true; return texture;
}

export class IslandRuntime {
    constructor(world) {
        this.world=world; this.ready=false; this.config=null; this.bodies=[];
        this.root=new THREE.Group(); this.root.name='Isola procedurale'; world.graphicsWorld.add(this.root);
        this.water=new Water(new THREE.PlaneGeometry(3000,3000),{textureWidth:512,textureHeight:512,waterNormals:waterNormals(),sunDirection:world.sky.sunPosition.clone().normalize(),sunColor:0xffffff,waterColor:0x116c78,distortionScale:2.2,fog:true});
        this.water.rotation.x=-Math.PI/2; this.water.userData.editorSurface=true; world.graphicsWorld.add(this.water);
        world.camera.far=1800;world.camera.updateProjectionMatrix();world.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
        world.params.Shadows=false;world.renderer.shadowMap.enabled=false;world.sky.csm.lights.forEach(l=>l.castShadow=false);
        world.respawnPosition=new CANNON.Vec3(0,5.55,2);
        world.isOutOfBounds=p=>p.y < -5 || Math.abs(p.x)>1500 || Math.abs(p.z)>1500;
    }
    initialize() { this.generate(DEFAULT_ISLAND); }
    generate(raw) {
        const config=validateIsland(raw);
        if(JSON.stringify(config)===JSON.stringify(this.config)) return;
        const group=new THREE.Group(), bodies=[], centers=islandCenters(config), r=config.radius;
        const box=(size,position,color,collision=false)=>{
            const mesh=new THREE.Mesh(new THREE.BoxGeometry(...size),new THREE.MeshStandardMaterial({color,roughness:.9}));
            mesh.position.set(...position);group.add(mesh);
            if(collision) { const body=new CANNON.Body({mass:0,shape:new CANNON.Box(new CANNON.Vec3(...size.map(v=>v/2))),position:new CANNON.Vec3(...position)});bodies.push(body); }
        };
        for(const center of centers) {
            const n=96, extent=r*1.35, step=extent*2/n, values=[], positions=[], colors=[], indices=[], color=new THREE.Color();
            for(let x=0;x<=n;x++) {values[x]=[];for(let z=0;z<=n;z++) {
                const wx=center-extent+x*step,wz=extent-z*step,y=islandHeight(wx,wz,config,center); values[x][z]=y;positions.push(wx,y,wz);
                const slope=Math.hypot(islandHeight(wx+.4,wz,config,center)-islandHeight(wx-.4,wz,config,center),islandHeight(wx,wz+.4,config,center)-islandHeight(wx,wz-.4,config,center))/.8;
                color.set(y<1.5?0x98846a:slope>.9?0x626866:0x425938);
                color.multiplyScalar(.75+.35*islandNoise(wx*.35,wz*.35,config.seed));colors.push(color.r,color.g,color.b);
                if(x<n && z<n) {const a=x*(n+1)+z,b=a+n+1;indices.push(a,b,a+1,b,b+1,a+1);}
            }}
            const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setIndex(indices);geometry.computeVertexNormals();
            group.add(new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1})));
            const shape=new CANNON.Heightfield(values,{elementSize:step}), body=new CANNON.Body({mass:0,shape,position:new CANNON.Vec3(center-extent,0,extent)});
            body.quaternion.setFromEuler(-Math.PI/2,0,0);bodies.push(body);
        }
        // One continuous deck guarantees seamless wheel contacts across both coastlines.
        const start=-r*.6,end=centers[1]+r*.6,bridgeStart=r*.5,bridgeEnd=centers[1]-r*.5;
        box([end-start,.45,10],[(start+end)/2,4.125,0],0x343a3e,true);
        for(let x=start+2;x<end-2;x+=7) box([3,.015,.14],[x,4.357,0],0xd4ce9b);
        for(const z of [-4.4,4.4]) box([end-start,.015,.12],[(start+end)/2,4.357,z],0xc6c6b9);
        for(const z of [-5.2,5.2]) {
            box([bridgeEnd-bridgeStart,1.05,.24],[(bridgeStart+bridgeEnd)/2,4.88,z],0x9da6a6,true);
            for(let x=bridgeStart;x<=bridgeEnd;x+=8) box([.25,1.4,.4],[x,4.95,z],0x596b70);
        }
        for(let x=bridgeStart+10;x<bridgeEnd;x+=22) box([2.5,13,7],[x,-2.35,0],0x747e7b);
        // Swap only after the replacement has been generated successfully.
        this.root.traverse(node=>{node.geometry?.dispose();node.material?.dispose();});this.root.clear();
        this.bodies.forEach(body=>this.world.physicsWorld.removeBody(body));this.root.add(group);bodies.forEach(body=>this.world.physicsWorld.addBody(body));this.bodies=bodies;this.config=config;
        this.manifest={spawns:[{id:'island-west',name:'Isola ovest',position:[0,4.35,2]},{id:'island-east',name:'Isola est',position:[centers[1],4.35,2]},{id:'bridge',name:'Ponte',position:[centers[1]/2,4.35,2]}]};
        this.applySky(config.sky);this.ready=true;
    }
    applySky(preset) {
        const settings={day:{elevation:48,azimuth:145,haze:2,fog:0xadc6cf,sun:0xfff0d6,intensity:.65,water:0x126978},sunset:{elevation:7,azimuth:245,haze:4,fog:0xba9390,sun:0xffad67,intensity:.45,water:0x183f4d},haze:{elevation:35,azimuth:145,haze:12,fog:0x9faeb3,sun:0xc9d3d4,intensity:.25,water:0x345962}}[preset];
        this.world.sky.setAtmosphere(settings.elevation,settings.azimuth,settings.haze,settings.sun,settings.intensity);
        this.world.graphicsWorld.fog=new THREE.Fog(settings.fog,280,1250);
        this.water.material.uniforms.sunColor.value.set(settings.sun);this.water.material.uniforms.waterColor.value.set(settings.water);
    }
    async ensure() { this.ready=true; } // Entire generated scene is resident; no streaming requests are needed.
    refreshPhysics() {}
    groundAt(x,z,top=300) {this.root.updateMatrixWorld(true);return new THREE.Raycaster(new THREE.Vector3(x,top,z),new THREE.Vector3(0,-1,0)).intersectObject(this.root,true)[0]?.point.y;}
    update() {
        this.water.material.uniforms.time.value=performance.now()/1000*.6;
        this.water.material.uniforms.sunDirection.value.copy(this.world.sky.sunPosition).normalize();
        const player=this.world.editorPlayer,position=player?.controlledObject?.position || player?.position;
        if(position) this.world.actorLayer?.update(position);
        const status=document.querySelector('[data-city-status]');if(status) status.textContent=`Isola · seed ${this.config?.seed} · ${Math.round(player?.controlledObject?.collision.velocity.length()*3.6 || 0)} km/h`;
    }
}
