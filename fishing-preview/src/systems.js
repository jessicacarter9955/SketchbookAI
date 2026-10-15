// A standalone economic simulation: deterministic and testable without the renderer.
export const SPECIES = [
  {id:'minnow',name:'Minnow',color:0x71c9ea,value:7,weight:50,rarity:1,biomes:[0,1,2,3]},
  {id:'clown',name:'Clownfish',color:0xff9d3e,value:16,weight:27,rarity:.43,biomes:[0,2,3]},
  {id:'blue',name:'Blue tang',color:0x277bd9,value:24,weight:20,rarity:.32,biomes:[0,3]},
  {id:'puffer',name:'Pufferfish',color:0xffdd5d,value:43,weight:14,rarity:.25,biomes:[0,1,3]},
  {id:'squid',name:'Squid',color:0xc28bec,value:78,weight:9,rarity:.13,biomes:[1,2,3]},
  {id:'ember',name:'Ember koi',color:0xff6132,value:128,weight:11,rarity:.20,biomes:[2]},
  {id:'prism',name:'Prismfish',color:0xa9b9ff,value:220,weight:7,rarity:.13,biomes:[3]},
  {id:'gold',name:'Golden fish',color:0xffe176,value:320,weight:2,rarity:.045,biomes:[0,1,2,3]},
  {id:'star',name:'Starfin',color:0x9bc3ff,value:680,weight:4,rarity:.11,biomes:[4,5,6,7,8,9,10,11]},
  {id:'nebula',name:'Nebula ray',color:0xd59def,value:1100,weight:2,rarity:.07,biomes:[8,9,10,11]},
  {id:'ruby',name:'Ruby koi',color:0xf0506c,value:440,weight:5,rarity:.12,biomes:[6,7,8,9,10,11]},
  {id:'opal',name:'Opal jelly',color:0x64ffee,value:2400,weight:2,rarity:.06,biomes:[8,10,11]}
];
export const BIOMES=[
 {name:'Sunbeam Cove',description:'A little island, a lot of fish.',water:0x2fbeb3,land:0x80b650,grass:0x93c762,shore:0xffdb8c,sky:0xc5eaf1,goal:8,multiplier:1,theme:'tropical'},
 {name:'Frostbite Bay',description:'Cold water. Bigger surprises.',water:0x5196d7,land:0xadc9c7,grass:0xe7f7f4,shore:0xd8eef6,sky:0xd5ebfd,goal:16,multiplier:4,theme:'frost'},
 {name:'Ember Atoll',description:'Fish where the water glows.',water:0xbf6d40,land:0x6c5f56,grass:0x8b7869,shore:0xf7b777,sky:0xe8c6a9,goal:28,multiplier:12,theme:'lava'},
 {name:'Double-Catch Reef',description:'The glowing water doubles every haul.',water:0x38bba6,land:0x60a99e,grass:0x8ad1a1,shore:0xffe0a0,sky:0xbbe5f5,goal:46,multiplier:35,theme:'reef',doubleZone:true},
 {name:'Windward Isles',description:'Golden schools ride the currents.',water:0x278ac7,land:0x84c875,grass:0xa4d47e,shore:0xf4dfab,sky:0xd4f4fa,goal:65,multiplier:120,theme:'tropical'},
 {name:'Coral Kingdom',description:'A neon sea full of rare creatures.',water:0x765ab7,land:0xae9299,grass:0xc2b9c7,shore:0xf1afd0,sky:0xe1cee9,goal:85,multiplier:500,theme:'reef',doubleZone:true},
 {name:'Moonlit Lagoon',description:'Silver fish under violet skies.',water:0x445c9d,land:0x647c99,grass:0x9eb6b1,shore:0xb9cfd6,sky:0x9daacb,goal:115,multiplier:2800,theme:'night'},
 {name:'Obsidian Shoals',description:'Fortune hides among the hot rocks.',water:0x963e54,land:0x777080,grass:0xa58b8f,shore:0xeaaa91,sky:0xb698ab,goal:145,multiplier:15000,theme:'lava'},
 {name:'Crystal Tide',description:'The reefs sparkle with unknown energy.',water:0x4986af,land:0x8392bd,grass:0xb4b3d8,shore:0xbdd8ef,sky:0xc0b7e7,goal:175,multiplier:90000,theme:'crystal',doubleZone:true},
 {name:'Orbit Oasis',description:'Fish among the stars.',water:0x354f9d,land:0x626594,grass:0x909bd2,shore:0x9eb8db,sky:0x69739f,goal:210,multiplier:580000,theme:'cosmic'},
 {name:'Nebula Narrows',description:'Every catch is a little constellation.',water:0x733b91,land:0x906b99,grass:0xb493d1,shore:0xc99fe2,sky:0xa17ec3,goal:250,multiplier:4100000,theme:'cosmic',doubleZone:true},
 {name:'Infinity Archipelago',description:'The final voyage. Ridiculous fortunes.',water:0x266c85,land:0x67988d,grass:0x96beb1,shore:0xd2cfaa,sky:0x96d5d9,goal:0,multiplier:30000000,theme:'crystal',doubleZone:true}
];
export const UPGRADES = [
 {id:'bag',label:'Backpack',icon:'🎒',desc:'Carry more fish before you sell.',base:18,growth:1.88,max:12,category:'Essentials'},
 {id:'lure',label:'Lure radius',icon:'🫧',desc:'Attract fish from farther away.',base:19,growth:1.70,max:12,category:'Fishing'},
 {id:'range',label:'Cast distance',icon:'🎯',desc:'Reach fish in the deeper water.',base:26,growth:1.79,max:9,category:'Fishing'},
 {id:'rods',label:'Extra rods',icon:'🎣',desc:'Each rod can catch simultaneously.',base:55,growth:2.8,max:7,category:'Fishing'},
 {id:'stack',label:'Fish per bobber',icon:'🐟',desc:'Catch several fish on each bite.',base:76,growth:2.23,max:9,category:'Fishing'},
 {id:'speed',label:'Quick feet',icon:'👟',desc:'Move faster around the island.',base:52,growth:2.05,max:7,category:'Comfort'},
 {id:'value',label:'Better market',icon:'💰',desc:'Each fish sells for more.',base:80,growth:2.1,max:15,category:'Economy'},
 {id:'rare',label:'Shiny bait',icon:'✨',desc:'Increase your odds of rare fish.',base:95,growth:2.2,max:12,category:'Economy'},
 {id:'magnet',label:'Coin magnet',icon:'🧲',desc:'Collect jewels from further away.',base:180,growth:2.3,max:8,category:'Comfort'},
 {id:'density',label:'Fish frenzy',icon:'🌊',desc:'More fish appear in the water.',base:155,growth:2.1,max:9,category:'Fishing'},
 {id:'angler',label:'Helper angler',icon:'🧑‍🌾',desc:'Passive catches trickle into your backpack.',base:450,growth:3.1,max:6,category:'Automation'},
 {id:'drone',label:'Fishing drone',icon:'🛸',desc:'Aerial helpers bring automated catches.',base:920,growth:3.5,max:6,category:'Automation'},
 {id:'crate',label:'Lucky deliveries',icon:'📦',desc:'Occasional bonus cargo arrives at the dock.',base:1300,growth:2.85,max:5,category:'Automation'},
 {id:'auto',label:'Auto cast',icon:'⚙️',desc:'Recasts fishing lines automatically.',base:1200,growth:2,max:1,category:'Automation'},
];
export const DEFAULT_MAP={
 name:'Sunbeam Cove',islandWidth:12.4,islandDepth:13.2,shoreJaggedness:.27,seed:19,
 props:[
  {id:'hut',type:'hut',x:-4.2,z:-4.5,rotation:.12,scale:1},
  {id:'barrel',type:'barrel',x:-1.85,z:-3.2,rotation:0,scale:1},
  {id:'dock',type:'dock',x:5.0,z:.75,rotation:0,scale:1},
  {id:'boat',type:'boat',x:7.5,z:2.4,rotation:0,scale:1},
  ...[[ -5,0],[ -3,4.7],[-6,-4],[-.4,5],[-5.6,4],[1,-5.2],[2.5,4.8]].map((p,i)=>({id:`tree${i}`,type:'tree',x:p[0],z:p[1],scale:.82+(i%3)*.16,rotation:i*.4})),
  ...[[-2,1.7],[-.1,-5.4],[1,5.3],[-6.0,1],[-3.3,-5.4]].map((p,i)=>({id:`rock${i}`,type:'rock',x:p[0],z:p[1],scale:.75+(i%2)*.4,rotation:i*.7})),
  {id:'logsA',type:'logs',x:-.6,z:3.3,rotation:.65,scale:1},
  {id:'logsB',type:'logs',x:-5.3,z:3.3,rotation:.3,scale:1},
  {id:'flowers',type:'flowers',x:-3.2,z:1,rotation:0,scale:1},
  {id:'flowers2',type:'flowers',x:1.3,z:-1.6,rotation:1,scale:.85}
 ]
};
export const freshState=()=>({coins:0,totalEarned:0,fishCaught:0,sold:0,bag:[],biome:0,logs:0,levels:{},stats:{casts:0,gold:0,best:0,playingSince:Date.now()},quests:{},achievements:[],manualCount:0});
export const level=(s,id)=>Math.max(0,Math.min((s.levels||{})[id]||0,UPGRADES.find(x=>x.id===id)?.max??99));
export function price(s,id){const up=UPGRADES.find(u=>u.id===id);if(!up)return Infinity;const n=level(s,id);return n>=up.max?Infinity:Math.ceil(up.base*Math.pow(up.growth,n));}
export function buy(s,id){const cost=price(s,id);if(!Number.isFinite(cost)||s.coins<cost)return false;s.coins-=cost;s.levels[id]=level(s,id)+1;return true;}
export const capacity=s=>2+level(s,'bag')*3+Math.max(0,level(s,'bag')-3)**2*11;
export const rodCount=s=>1+level(s,'rods');
export const fishPerCatch=s=>1+level(s,'stack');
export const valueMultiplier=s=>(BIOMES[s.biome]||BIOMES[0]).multiplier*(1+level(s,'value')*.27);
export const attraction=s=>2.1+level(s,'lure')*.5;
export const range=s=>6.1+level(s,'range')*1.22;
export function addCatch(s,species=SPECIES[0],size=1,source='manual',waterBonus=1){
 const room=capacity(s)-s.bag.length;
 if(room<=0)return 0;
 let count=Math.min(room,fishPerCatch(s));
 for(let i=0;i<count;i++){let item={id:species.id,kind:species.name,value:Math.round(species.value*valueMultiplier(s)*waterBonus*(0.78+size*.45)*(1+Math.random()*.2)),size};s.bag.push(item);s.stats.best=Math.max(s.stats.best,item.value);}
 s.fishCaught+=count;if(source==='manual')s.manualCount+=count;
 return count;
}
export function sell(s){if(!s.bag.length)return 0;const total=s.bag.reduce((acc,x)=>acc+x.value,0);s.coins+=total;s.totalEarned+=total;s.sold+=s.bag.length;s.bag=[];return total;}
export function awardCoins(s,value){const n=Math.round(value);s.coins+=n;s.totalEarned+=n;return n;}
export function choiceSpecies(s,random=Math.random){
 const available=SPECIES.filter(f=>f.biomes.includes(s.biome)|| (s.biome>=4 && f.biomes.includes(s.biome%4)));
 const weights=available.map(x=>x.rarity*(x.id==='gold'?1+level(s,'rare')*.3:1)*(x.id==='minnow'?1:1));
 let n=random()*weights.reduce((a,b)=>a+b,0);
 for(let i=0;i<available.length;i++){n-=weights[i];if(n<=0)return available[i];}
 return available.at(-1);
}
export function canSail(s){return s.biome<BIOMES.length-1&&s.logs>=BIOMES[s.biome].goal;}
export function sail(s){if(!canSail(s))return false;s.biome++;s.logs=0;return true;}
export function exportProgress(s){return JSON.stringify(s,null,2)};
export function formatMoney(v){if(v<1000)return '$'+Math.floor(v).toLocaleString('en-US');const units=['K','M','B','T','Qa','Qi'];let n=v,i=-1;while(n>=1000&&i<units.length-1){n/=1000;i++}return '$'+n.toFixed(n>=100?0:n>=10?1:2)+units[i];}
export function loadSave(raw){try{const s=JSON.parse(raw);if(!s||typeof s!=='object')return freshState();const out={...freshState(),...s};out.bag=Array.isArray(s.bag)?s.bag.filter(x=>typeof x.value==='number').slice(0,5000):[];out.levels={...s.levels};out.biome=Math.max(0,Math.min(BIOMES.length-1,Number(s.biome)||0));out.stats={...freshState().stats,...s.stats};out.coins=Math.max(0,Number(s.coins)||0);return out;}catch{return freshState();}}