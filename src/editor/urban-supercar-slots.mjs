import {urbanNetworks} from './urban-navigation.mjs';
import {marketplaceParkingSlots} from './urban-marketplace-slots.mjs';

/** Three separated parking spaces on real road lanes, within walking distance of the player.
 * Never place imported cars at the exact spawn point or on an intersection.
 */
export function supercarParkingSlots(config, spawn, occupied = []) {
    const blocked=[
        ...marketplaceParkingSlots(config,spawn).map(x=>[x.x,x.z]),
        [config.roadWidth*.28,-config.blockSize*.22], [12,6],
        ...occupied.map(x=>Array.isArray(x)?[x[0],x[2]]:[x.x,x.z])
    ];
    const candidates=[];
    const roads=urbanNetworks(config).roads;
    for(const road of roads) {
        const dx=road.b.x-road.a.x, dz=road.b.z-road.a.z;
        const length=road.length||Math.hypot(dx,dz);
        if(length < config.roadWidth+9)continue;
        const trim=(config.roadWidth/2+4)/length;
        const heading=Math.atan2(dx,dz);
        for(const t of [trim,0.35,0.5,0.65,1-trim]) {
            if(t<trim||t>1-trim)continue;
            const side=config.roadWidth*0.28;
            for(const sign of [-1,1]) {
                const x=road.a.x+dx*t+sign*(-dz/length)*side;
                const z=road.a.z+dz*t+sign*(dx/length)*side;
                const distance=Math.hypot(x-spawn[0],z-spawn[2]);
                if(distance<6||distance>38)continue;
                if(blocked.some(([bx,bz])=>Math.hypot(x-bx,z-bz)<5.4))continue;
                candidates.push({x,z,heading,dist:distance});
            }
        }
    }
    candidates.sort((a,b)=>a.dist-b.dist||a.x-b.x||a.z-b.z);
    const chosen=[];
    for(const point of candidates) {
        if(chosen.every(p=>Math.hypot(p.x-point.x,p.z-point.z)>6))chosen.push(point);
        if(chosen.length>=3)break;
    }
    return chosen;
}
