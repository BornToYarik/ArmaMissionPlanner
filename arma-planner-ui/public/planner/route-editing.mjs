const end=segment=>segment.points.at(-1);
const modeOf=segment=>segment.mode==='road'?'road':segment.seconds==null?'none':'free';

// Route entries are creation batches, not shared waypoints: edit only this
// unit's chain, leaving the other units and split branches intact.
// Return a new plan only after ALL affected segments have been recalculated.
export async function editWaypoint(routes,routeId,unitId,{point=null,initial,rebuild}){
 const chain=routes.flatMap((r,index)=>r.segments.filter(s=>s.id===unitId).map(s=>({r,s,index})));
 const at=chain.findIndex(c=>c.r.id===routeId);if(at<0)throw Error('Вейпоинт уже удалён');
 const current=chain[at],previous=chain[at-1],next=chain[at+1];
 const from=[...(previous?end(previous.s):current.s.from|| (current.s.points.length>1?current.s.points[0]:initial))];
 const replacements=new Map();
 const build=async(entry,a,b)=>{
  const mode=modeOf(entry.s),result=mode==='none'?{points:[[...b]],seconds:null,mode}:await rebuild([...a],[...b],mode,entry.s);
  if(!result.points?.length||result.seconds!=null&&!Number.isFinite(result.seconds))throw Error('Проходимый маршрут не найден');
  replacements.set(entry.index,{...entry.s,...result,from:[...a],mode});
 };
 if(point)await build(current,from,point);
 if(next)await build(next,point||from,end(next.s));
 const updated=routes.map((r,index)=>{
  const segments=r.segments.flatMap(s=>s.id!==unitId?[s]:index===current.index&&!point?[]:[replacements.get(index)||s]);
  return {...r,segments,units:segments.map(s=>s.id),seconds:segments.every(s=>s.seconds==null)?null:Math.max(0,...segments.map(s=>s.seconds||0))};
 }).filter(r=>r.segments.length);
 const remaining=updated.flatMap(r=>r.segments.filter(s=>s.id===unitId));
 return {routes:updated,position:[...(remaining.length?end(remaining.at(-1)):from)],recalculated:replacements.size};
}
