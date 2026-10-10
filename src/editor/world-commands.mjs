// Offline, deterministic world instructions; no LLM, accounts, remote calls or arbitrary code.
export const WORLD_COMMAND_HELP='Prova: fai piovere, tramonto, alba, notte, nebbia, inverno, sole a ovest, luna piena.';
const normalize=input=>String(input??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[!?.,;:]/g,' ').replace(/\s+/g,' ').trim();

/** Parse independent environment intents, so "tramonto con nebbia e pioggia" applies all three. */
export function interpretWorldCommands(input){
  const text=normalize(input),actions=[];
  if(!text)return {type:'help',actions,message:WORLD_COMMAND_HELP};
  const has=pattern=>pattern.test(text);
  const stopRain=has(/\b(?:smetti(?: di)? piovere|ferma (?:la )?pioggia|basta pioggia|niente pioggia|togli (?:la )?pioggia|senza pioggia|stop (?:the )?rain|stop raining|clear (?:the )?rain|no rain)\b/);
  const mentionsRain=has(/\b(?:pioggia|piovere|rain|raining|temporale|drizzle)\b/);
  if(stopRain)actions.push({type:'rain',enabled:false,intensity:0,message:'Pioggia disattivata.'});
  else if(mentionsRain){
    const strong=has(/\b(?:forte|intensa|temporale|storm|heavy|strong|tanta)\b/);
    const light=has(/\b(?:leggera|poca|light|drizzle|debole)\b/);
    actions.push({type:'rain',enabled:true,intensity:strong?1.7:light?.55:1,message:strong?'Pioggia intensa attivata.':light?'Pioggia leggera attivata.':'Pioggia attivata.'});
  }
  const fogOff=has(/\b(?:togli|ferma|disattiva|elimina|rimuovi|senza|no|stop|clear)\s+(?:(?:la|the)\s+)?(?:nebbia|fog)\b/);
  if(fogOff)actions.push({type:'fog',enabled:false,message:'Nebbia rimossa.'});
  else if(has(/\b(?:nebbia|fog|foggy)\b/))actions.push({type:'fog',enabled:true,message:'Nebbia attivata.'});
  const times=[['sunrise',/\b(?:alba|dawn|sunrise|sorgere (?:del )?sole)\b/],['sunset',/\b(?:tramonto|sunset|dusk|crepuscolo)\b/],['night',/\b(?:notte|night|notturn[oa]|mezzanotte|midnight|cielo stellato|luna piena|full moon)\b/],['noon',/\b(?:mezzogiorno|noon|midi|midday|giorno pieno|sole alto)\b/]];
  const time=times.find(([,pattern])=>has(pattern));
  if(time)actions.push({type:'time',value:time[0],message:({sunrise:'Alba attivata.',sunset:'Tramonto attivato.',night:'Notte e luce lunare attivate.',noon:'Mezzogiorno attivato.'})[time[0]]});
  const seasons=[['winter',/\b(?:inverno|winter|invernale)\b/],['autumn',/\b(?:autunno|autumn|fall|autunnale)\b/],['spring',/\b(?:primavera|spring|primaverile)\b/],['summer',/\b(?:estate|summer|estivo|estiva)\b/]];
  const season=seasons.find(([,pattern])=>has(pattern));
  if(season)actions.push({type:'season',value:season[0],message:({winter:'Inverno: vegetazione e ambiente invernali.',autumn:'Autunno: vegetazione autunnale.',spring:'Primavera: vegetazione primaverile.',summer:'Estate: vegetazione estiva.'})[season[0]]});
  const sunDirection=/\b(?:sole|sun)\b/.test(text)?[ ['east',/\b(?:est|east|oriente)\b/],['west',/\b(?:ovest|west|occidente)\b/],['north',/\b(?:nord|north)\b/],['south',/\b(?:sud|south)\b/] ].find(([,pattern])=>has(pattern)):null;
  if(sunDirection)actions.push({type:'sun',value:sunDirection[0],message:'Direzione sole: '+sunDirection[0]+'.'});
  if(!time&&has(/\b(?:luce calda|warm light|illuminazione calda)\b/))actions.push({type:'light',value:'warm',message:'Luce calda attivata.'});
  if(!time&&has(/\b(?:luce fredda|cold light|cool light|illuminazione fredda)\b/))actions.push({type:'light',value:'cool',message:'Luce fredda attivata.'});
  if(!actions.length)return {type:'unsupported',actions,message:'Comando non riconosciuto. '+WORLD_COMMAND_HELP};
  return {...actions[0],actions,message:actions.map(a=>a.message).join(' ')};
}
export function interpretWorldCommand(input){return interpretWorldCommands(input);}
