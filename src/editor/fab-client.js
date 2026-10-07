(function(root){
  const SEARCH='https://www.fab.com/search';
  const CATEGORY={
    all:'',
    vehicles:'3d-model/vehicles-transportation',
    buildings:'3d-model/buildings-architecture',
    environments:'3d-model/environments',
    props:'3d-model/objects-decor'
  };
  const HINTS={vehicles:/\b(car|vehicle|truck|bus|motorcycle|bike|van|suv|auto|veicolo|macchina|moto)\b/i,buildings:/\b(building|house|apartment|office|tower|facade|architecture|edificio|casa|palazzo)\b/i,environments:/\b(city|urban|road|street|landscape|environment|terrain|strada|paesaggio|terreno)\b/i,props:/\b(prop|furniture|bench|lamp|sign|object|oggetto|panchina|lampione)\b/i};
  class FabClient {
    suggestSearch(prompt,{free=true}={}){
      const query=String(prompt||'').trim().replace(/\\s+/g,' ');
      let category='all'; for(const key of ['vehicles','buildings','environments','props']) if(HINTS[key].test(query)){category=key;break;}
      return {query,category,free};
    }
    searchURL(query,{free=true,category='all'}={}){
      const term=String(query||'').trim();
      const path=CATEGORY[category] ? `https://www.fab.com/category/${CATEGORY[category]}` : SEARCH;
      const url=new URL(path);
      if(term) url.searchParams.set('q',term);
      if(free) url.searchParams.set('is_free','1');
      return url.href;
    }
    listingURL(value){
      const url=new URL(value);
      if(url.origin!=='https://www.fab.com'||!/^\/listings\/[a-zA-Z0-9-]+/.test(url.pathname)) throw new Error('URL Fab non valida.');
      return url.href;
    }
    supportedFile(file){
      const name=String(file?.name||'').toLowerCase();
      if(!/\.(glb|zip)$/.test(name)) throw new Error('Per Sketchbook scarica da Fab un file GLB o ZIP compatibile.');
      return true;
    }
  }
  root.FabClient=FabClient;
  if(typeof module!=='undefined') module.exports={FabClient};
})(globalThis);
