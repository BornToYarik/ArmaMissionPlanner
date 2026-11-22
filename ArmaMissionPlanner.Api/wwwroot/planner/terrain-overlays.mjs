// Split at the actual terrain's triangle boundaries, including both LOD grids.
// A straight edge between the resulting samples lies on the sampled surface.
export function drapePath(points,grids,height,lift=.25){
  const out=[];
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i];if(!a||!b||![...a.slice(0,2),...b.slice(0,2)].every(Number.isFinite))continue;
    const dx=b[0]-a[0],dy=b[1]-a[1],cuts=new Set([0,1]);
    for(const grid of grids){
      const [x0,y0,x1,y1]=grid.bounds,step=grid.step;if(!(step>0))continue;
      const add=t=>{if(t<=0||t>=1)return;const x=a[0]+dx*t,y=a[1]+dy*t;if(x>=x0-1e-6&&x<=x1+1e-6&&y>=y0-1e-6&&y<=y1+1e-6)cuts.add(t);};
      for(const [origin,delta,offset]of [[a[0],dx,x0],[a[1],dy,y0],[a[0]+a[1],dx+dy,x0+y0]]){
        if(Math.abs(delta)<1e-10)continue;
        const lo=Math.ceil((Math.min(origin,origin+delta)-offset)/step),hi=Math.floor((Math.max(origin,origin+delta)-offset)/step);
        for(let k=lo;k<=hi;k++)add((offset+k*step-origin)/delta);
      }
      if(dx)for(const x of [x0,x1])add((x-a[0])/dx);
      if(dy)for(const y of [y0,y1])add((y-a[1])/dy);
    }
    let previous=-1;
    for(const t of [...cuts].sort((a,b)=>a-b)){
      if(t-previous<1e-8)continue;previous=t;
      const x=a[0]+dx*t,y=a[1]+dy*t,z=height(x,y);
      if(Number.isFinite(z)){const last=out.at(-1);if(!last||Math.abs(last[0]-x)+Math.abs(last[1]-y)>1e-7)out.push([x,y,z+lift]);}
    }
  }
  if(points.length===1){const [x,y]=points[0],z=height(x,y);if(Number.isFinite(z))out.push([x,y,z+lift]);}
  return out;
}

export function zoneOutline(zone){
  const {x,y,a,b,angle=0,ellipse=false}=zone,r=angle*Math.PI/180,c=Math.cos(r),s=Math.sin(r);
  const local=ellipse?Array.from({length:129},(_,i)=>[Math.cos(i/128*Math.PI*2)*a,Math.sin(i/128*Math.PI*2)*b]):[[-a,-b],[a,-b],[a,b],[-a,b],[-a,-b]];
  return local.map(([px,py])=>[x+px*c+py*s,y-px*s+py*c,0]);
}

export function gameplayObject(unit){
  if(unit.scenery||/wreck|ammobox|crate|mash|tent|supply|ruins|^box_|_box_/i.test(unit.vehicleClass||''))return false;
  if(typeof unit.gameplay==='boolean')return unit.gameplay;
  if(/^land_|house|building|fence/i.test(unit.vehicleClass||''))return false;
  if(['foot','wheeled','tracked','air','water'].includes(unit.mobility))return true;
  return /dshk|zu[_-]?23|2b14|mortar|kornet|fagot|ags[_-]?30|tow[_-]?tripod|m2static|static[_-]?(mg|dshk)|staticweapon/i.test(unit.vehicleClass||'');
}
