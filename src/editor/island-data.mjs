export const WORLD_IDS = ['sketchbook', 'liberty-city', 'procedural-island', 'procedural-city'];
export const DEFAULT_ISLAND = {seed:42,radius:70,gap:65,sky:'day'};
export function validateIsland(value=DEFAULT_ISLAND) {
    if(!value || !Number.isInteger(value.seed) || value.seed<0 || value.seed>2147483647 ||
        !Number.isFinite(value.radius) || value.radius<45 || value.radius>110 ||
        !Number.isFinite(value.gap) || value.gap<30 || value.gap>140 || !['day','sunset','haze'].includes(value.sky)) throw new Error('Isola non valida: raggio 45–110 m, distanza 30–140 m, seed intero positivo.');
    return {seed:value.seed,radius:value.radius,gap:value.gap,sky:value.sky};
}
const smooth=(a,b,v)=>{const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t);};
export function islandNoise(x,y,seed=42,period=0) {
    const hash=(a,b)=>{
        if(period) {a=((a%period)+period)%period;b=((b%period)+period)%period;}
        let h=Math.imul(a,374761393)+Math.imul(b,668265263)+Math.imul(seed,144269);
        h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967295;
    };
    const ix=Math.floor(x),iy=Math.floor(y),u=smooth(0,1,x-ix),v=smooth(0,1,y-iy);
    return (1-v)*((1-u)*hash(ix,iy)+u*hash(ix+1,iy))+v*((1-u)*hash(ix,iy+1)+u*hash(ix+1,iy+1));
}
export const islandCenters = config => [0,config.radius*2+config.gap];
export function islandHeight(x,z,config,center=0) {
    x-=center; const r=config.radius, angle=Math.atan2(z,x), phase=(config.seed%997)*.017;
    const coast=r*(1+.09*Math.sin(angle*3+phase)+.045*Math.sin(angle*7-phase));
    const distance=Math.hypot(x,z)/coast;
    const land=1-smooth(.56,1.13,distance);
    const hills=Math.exp(-((x+r*.25)**2+(z-r*.35)**2)/(r*r*.085))*(13+3*Math.sin(phase));
    const detail=(islandNoise(x*.1,z*.1,config.seed)-.5)*2.4+(islandNoise(x*.25,z*.25,config.seed)-.5)*.6;
    const roadReserve=smooth(7,18,Math.abs(z));
    return -8+12*land+(hills+detail)*roadReserve*(1-smooth(.55,.95,distance));
}
