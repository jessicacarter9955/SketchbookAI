(function(root){
  const SEARCH='https://www.fab.com/search';
  const CATEGORY={
    all:'',
    vehicles:'3d-model/vehicles-transportation',
    buildings:'3d-model/buildings-architecture',
    environments:'3d-model/environments',
    props:'3d-model/objects-decor'
  };
  class FabClient {
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
