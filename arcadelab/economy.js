export const HOLE_UPGRADES=[
 {id:'size',name:'Black Hole Size',desc:'Grow your event horizon.',icon:'◎',base:35,growth:1.70,group:'Core',accent:'#a88aff'},
 {id:'gravity',name:'Pull Strength',desc:'Pull objects from farther away.',icon:'◉',base:40,growth:1.75,group:'Core',accent:'#a77aff'},
 {id:'damage',name:'Devour Power',desc:'Absorb objects more quickly.',icon:'⚡',base:65,growth:1.73,group:'Core',accent:'#ffbb50'},
 {id:'speed',name:'Orbit Speed',desc:'Move and collect faster.',icon:'➤',base:75,growth:1.81,group:'Core',accent:'#57cffa'},
 {id:'value',name:'Mass Multiplier',desc:'More matter from each object.',icon:'◆',base:135,growth:1.95,group:'Income',accent:'#4ee2bc'},
 {id:'spawn',name:'Asteroid Shower',desc:'More targets in your sector.',icon:'✹',base:200,growth:1.93,group:'Income',accent:'#ff9769'},
 {id:'auto',name:'Gravity Pulse',desc:'Automatic collection pulses.',icon:'✺',base:510,growth:2.35,group:'Special',accent:'#9ed9ff'},
 {id:'rare',name:'Cosmic Relics',desc:'More valuable rare objects.',icon:'✦',base:740,growth:2.25,group:'Special',accent:'#f7d377'}
];
export const FISH_UPGRADES=[
 {id:'rods',name:'More Fishing Rods',desc:'One more independent fishing line.',icon:'🎣',base:80,growth:2.0,group:'Fishing',accent:'#76c9fc'},
 {id:'bait',name:'Better Bait',desc:'Get bites faster.',icon:'🪱',base:35,growth:1.74,group:'Fishing',accent:'#fdba68'},
 {id:'bag',name:'Bigger Backpack',desc:'Hold more fish before selling.',icon:'🎒',base:28,growth:1.76,group:'Fishing',accent:'#eebf83'},
 {id:'reel',name:'Stronger Line',desc:'Bring home more fish per bite.',icon:'🪝',base:125,growth:1.94,group:'Fishing',accent:'#a2eef2'},
 {id:'value',name:'Fish Market',desc:'Sell your catch for more.',icon:'🪙',base:120,growth:1.82,group:'Income',accent:'#fbd36f'},
 {id:'rare',name:'Golden Lure',desc:'Higher chance of rare fish.',icon:'✦',base:220,growth:2.06,group:'Income',accent:'#f9e276'},
 {id:'auto',name:'Auto Fisher',desc:'Your fishing lines work for you.',icon:'🤖',base:750,growth:2.4,group:'Special',accent:'#9de4ff'},
 {id:'drone',name:'Fishing Drone',desc:'Passive income from the sea.',icon:'✈',base:1900,growth:2.65,group:'Special',accent:'#b6a4ff'}
];
export const HOLE_STAGES=[{at:0,name:'Asteroid Belt',sub:'Start small',tier:'ASTEROIDS'},{at:320,name:'Crystal Fields',sub:'Rare minerals',tier:'CRYSTALS'},{at:2400,name:'Planetary Orbit',sub:'Small planets',tier:'PLANETS'},{at:16000,name:'Stellar System',sub:'Solar energy',tier:'STARS'},{at:100000,name:'Galaxy Eater',sub:'Beyond the stars',tier:'GALAXY'}];
export const FISH_STAGES=[{at:0,name:'Sunlit Shore',sub:'First catch',tier:'SHORE'},{at:450,name:'Palm Cove',sub:'Exotic fish',tier:'COVE'},{at:2800,name:'Coral Haven',sub:'Colorful reef',tier:'REEF'},{at:21000,name:'Frozen Inlet',sub:'Blue water',tier:'FROST'},{at:140000,name:'Golden Lagoon',sub:'Rare treasures',tier:'LAGOON'}];
export function initial(mode){return {currency:mode==='hole'?110:95,total:0,level:{},caught:0,sold:0,bag:[],stats:{casts:0},achievements:[]}}
export function upgradePrice(entry,levels){const n=Math.max(0,Math.floor(levels?.[entry.id]||0));return Math.floor(entry.base*Math.pow(entry.growth,n))}
export function level(s,id){return Math.max(0,s.level?.[id]||0)}
export function purchase(s,entry){const cost=upgradePrice(entry,s.level);if(s.currency<cost)return false;s.currency-=cost;s.level[entry.id]=level(s,entry.id)+1;return true}
export function stageOf(s,stages){let index=0;for(let i=0;i<stages.length;i++)if(s.total>=stages[i].at)index=i;return index}
export function pretty(n){if(!Number.isFinite(n))return '0';if(n<1000)return Math.floor(n).toLocaleString('en-US');const powers=[['K',1e3],['M',1e6],['B',1e9],['T',1e12]];for(let i=powers.length-1;i>=0;i--){let [c,v]=powers[i];if(n>=v)return (n/v>=100?Math.floor(n/v):+(n/v).toFixed(1)).toLocaleString('en-US')+c;}return ''+Math.floor(n)}
export function fishCapacity(s){return 4+4*level(s,'bag')}
export function maxRods(s){return 1+level(s,'rods')}
export function fishValue(s,rarity=0){return Math.round((16+rarity*26)*(1+.38*level(s,'value')))}
export function catchFish(s,rarity=0){if(s.bag.length>=fishCapacity(s))return false;const n=Math.min(fishCapacity(s)-s.bag.length,1+Math.floor(level(s,'reel')/2));for(let i=0;i<n;i++)s.bag.push({value:fishValue(s,rarity),rarity});s.caught+=n;return n}
export function sellFish(s){if(!s.bag.length)return 0;const value=s.bag.reduce((n,f)=>n+f.value,0);s.currency+=value;s.total+=value;s.sold+=s.bag.length;s.bag=[];return value}
export function earn(s,n){const v=Math.max(0,Math.floor(n));s.currency+=v;s.total+=v;return v}
export function progressFraction(s,stages){const i=stageOf(s,stages);if(i===stages.length-1)return 1;return Math.max(0,Math.min(1,(s.total-stages[i].at)/(stages[i+1].at-stages[i].at)))}