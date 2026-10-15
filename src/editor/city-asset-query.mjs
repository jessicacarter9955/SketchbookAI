// Provider-specific model lookup for the standalone City Player. No LLM or credentials.
export function parseCityAssetQuery(value) {
  let text=String(value??'').trim().slice(0,200);
  if (!text) return '';
  let provider='';
  const leading=text.match(/^@?(fab|sketchfab)(?::|\\s+)/i);
  if (leading) {provider=leading[1].toLowerCase();text=text.slice(leading[0].length).trim();}
  const trailing=text.match(/\\s+(?:su|da|on|from)\\s+(fab|sketchfab)\\s*$/i);
  if (trailing) {provider=trailing[1].toLowerCase();text=text.slice(0,-trailing[0].length).trim();}
  text=text.replace(/^(?:cerca|trova|aggiungi|inserisci|importa|metti|posiziona|add|find|search|import|place)\\s+/i,'')
    .replace(/^(?:un['’]?|uno|una|il|la|dei|delle|a|an|the)\\s*/i,'').trim();
  if (!text) return '';
  return provider?'@'+provider+' '+text:text;
}
