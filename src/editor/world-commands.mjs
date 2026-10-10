// Offline, deterministic world instructions; no LLM, accounts, remote calls or arbitrary code.
export const WORLD_COMMAND_HELP='Prova: temporale, pioggia intensa, nevicata, bufera di neve, nebbia, cielo nuvoloso, tempesta di sabbia, aurora boreale, sereno, tramonto, inverno.';
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
  // Weather presets inspired by the MIT procedural-weather-threejs skill.
  // Preserve independent instructions for time, seasons, rain and fog.
  const snowOff=has(/\b(?:ferma|stop|togli|basta|niente|senza|no|disattiva)\s+(?:(?:la|the)\s+)?(?:neve|nevicata|snow|snowfall)\b/);
  const snowAny=has(/\b(?:neve|nevicata|nevicare|snow|snowfall|snowing|blizzard|bufera)\b/);
  if(snowOff)actions.push({type:'snow',enabled:false,intensity:0,message:'Nevicata fermata.'});
  else if(snowAny){
    const strong=has(/\b(?:forte|intensa|bufera|blizzard|heavy|tempesta)\b/);
    const weak=has(/\b(?:leggera|lieve|light|poca|fiocchi)\b/);
    actions.push({type:'snow',enabled:true,intensity:strong?1.7:weak?.45:1,message:strong?'Bufera di neve attivata.':weak?'Nevicata leggera attivata.':'Nevicata attivata.'});
  }
  const statePresets=[
    ['blizzard',/\b(?:blizzard|bufera(?: di neve)?|whiteout)\b/],
    ['storm',/\b(?:temporale|thunderstorm|tempesta elettrica|storm)\b/],
    ['sandstorm',/\b(?:tempesta di sabbia|sandstorm|sabbia nel vento)\b/],
    ['aurora',/\b(?:aurora boreale|northern lights|aurora)\b/],
    ['cloudy',/\b(?:nuvoloso|nuvolosa|cloudy|coperto|cielo grigio|overcast)\b/],
    ['clear',/\b(?:sereno|serena|cielo limpido|bel tempo|clear sky|clear weather)\b/],
    ['hail',/\b(?:grandine|grandinata|hail)\b/]
  ];
  const preset=statePresets.find(([,pattern])=>has(pattern));
  if(preset)actions.push({type:'state',value:preset[0],message:({
    blizzard:'Bufera di neve e vento intenso attivati.',storm:'Temporale con fulmini attivato.',
    sandstorm:'Tempesta di sabbia attivata.',aurora:'Aurora boreale attivata.',
    cloudy:'Cielo nuvoloso attivato.',clear:'Tornato il sereno.',hail:'Grandine attivata.'
  })[preset[0]]});
  if(has(/\b(?:arcobaleno|rainbow)\b/))actions.push({type:'rainbow',enabled:!has(/\b(?:togli|no|senza|stop)\b/),message:'Arcobaleno aggiornato.'});
  if(has(/\b(?:vento forte|strong wind|windy|vento leggero|light wind)\b/))actions.push({type:'wind',speed:has(/\b(?:forte|strong|windy)\b/)?1.7:.4,message:'Intensità del vento aggiornata.'});
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
