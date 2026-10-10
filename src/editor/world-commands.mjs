// Explicit local commands. No LLM, credentials, network calls or generated code.
export function interpretWorldCommand(input) {
  const text=String(input||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[!?.,]/g,' ').replace(/\s+/g,' ').trim();
  if(!text)return {type:'help',message:'Scrivi «fai piovere» o «smetti di piovere».'};
  const dry=/(?:^|\b)(?:smetti(?: di)? piovere|ferma (?:la )?pioggia|basta pioggia|niente pioggia|togli (?:la )?pioggia|stop (?:the )?rain|stop raining|clear (?:the )?rain|no rain|senza pioggia)(?:\b|$)/;
  if(dry.test(text))return {type:'rain',enabled:false,intensity:0,message:'Pioggia disattivata.'};
  if(/\b(?:pioggia|piovere|rain|raining)\b/.test(text)){
    const strong=/\b(?:forte|intensa|temporale|storm|heavy|strong|tanta)\b/.test(text);
    const light=/\b(?:leggera|poca|light|drizzle|debole)\b/.test(text);
    return {type:'rain',enabled:true,intensity:strong ? 1.7 : light ? 0.55 : 1,message:strong?'Pioggia intensa attivata.':light?'Pioggia leggera attivata.':'Pioggia attivata.'};
  }
  return {type:'unsupported',message:'Comando non riconosciuto. Prova «fai piovere», «pioggia intensa», «pioggia leggera» o «stop rain».'};
}
