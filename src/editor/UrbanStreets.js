// Construct intersections without overlapping asphalt faces, curbs or planted medians.
export function buildUrbanStreets(plan,config,box,m){
  for(const road of plan.roads){
    const alongX=road.axis==='x',crossings=plan.roads.filter(r=>r.axis!==road.axis).map(r=>alongX?r.x:r.z).sort((a,b)=>a-b);
    const intervals=[];let start=-road.length/2;
    for(const c of crossings){const end=c-config.roadWidth/2;if(end>start)intervals.push([start,end]);start=c+config.roadWidth/2;}
    if(start<road.length/2)intervals.push([start,road.length/2]);
    const strip=(length,width,height,along,offset,y,mat)=>box(alongX?[length,height,width]:[width,height,length],alongX?[along,y,road.z+offset]:[road.x+offset,y,along],mat,false);
    if(alongX)strip(road.length,road.width,.1,0,0,.05,m.road);
    else for(const [a,b]of intervals)strip(b-a,road.width,.1,(a+b)/2,0,.05,m.road);
    for(const [a,b]of intervals){
      const length=b-a,center=(a+b)/2;
      for(const side of [-1,1]){
        // Individual stone lengths are visible close up, with narrow physical joints.
        const stones=Math.ceil(length/1.2),step=length/stones;
        for(let i=0;i<stones;i++)strip(step-.014,.22,.16,a+(i+.5)*step,side*(road.width/2+.11),.16,m.curb);
        strip(length,.11,.008,center,side*(road.width/2-.3),.106,m.paint);
        for(let p=a+6;p<b-3;p+=15){strip(.65,.38,.022,p,side*(road.width/2-.6),.112,m.iron);for(let slot=0;slot<8;slot++)strip(.035,.3,.01,p-.26+slot*.075,side*(road.width/2-.6),.128,m.curb);}
      }
      if(road.boulevard&&length>13){
        strip(length-10,1.45,.09,center,0,.145,m.grass);
        for(const side of [-1,1]){strip(length-10,.14,.13,center,side*.79,.165,m.curb);strip(length-8,.1,.008,center,side*1.1,.107,m.paint);}
      }else for(let p=a+6;p<b-5;p+=7)strip(2.7,.12,.008,p,0,.107,m.paint);
      if(length>12)for(const edge of [a+2.1,b-2.1])for(let i=0;i<6;i++)strip(.4,road.width-1.1,.009,edge+(i-2.5)*.65,0,.108,m.paint);
    }
  }
}
