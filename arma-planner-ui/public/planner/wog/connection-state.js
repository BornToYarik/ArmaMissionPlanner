export function connectionState(events,frame){
 if(!events?.length||frame<events[0][0])return null;let lo=0,hi=events.length-1;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(events[mid][0]<=frame)lo=mid;else hi=mid-1;}return events[lo][1];
}
export function identityAt(entity,frame){
 const rows=entity?.identity;if(!rows?.length)return null;
 let lo=0,hi=rows.length;while(lo<hi){const mid=(lo+hi)>>>1;if(rows[mid][0]<=frame)lo=mid+1;else hi=mid;}
 return lo?rows[lo-1]:null;
}
export function playerDisplayName(entity,position,frame=position?.[0]??Infinity){
 if(!entity)return '';
 const identity=identityAt(entity,frame),ai=identity?identity[2]===false:connectionState(entity.connectionEvents,frame)===false;
 return (identity?.[1]||entity.name||'')+(ai&&position?.[4]!==0?' (AI)':'');
}
export function mapConnections(rawEvents,entities){
 const names=new Map(),result={},unresolved=[];
 for(const e of entities)if(e.type==='unit'&&e.player){const list=names.get(e.name)||[];list.push(e.id);names.set(e.name,list);}
 for(const event of rawEvents){if(!['connected','disconnected'].includes(event[1])||!Number.isFinite(event[0]))continue;
  const ids=names.get(event[2]);if(ids?.length!==1){unresolved.push({frame:event[0],kind:event[1],name:event[2]});continue;}
  (result[ids[0]]??=[]).push([event[0],event[1]==='connected']);
 }
 for(const [id,list]of Object.entries(result)){
  const frames=new Map();for(const [f,value]of list){if(!frames.has(f))frames.set(f,new Set());frames.get(f).add(value);}
  result[id]=[...frames].sort((a,b)=>a[0]-b[0]).map(([f,values])=>[f,values.size===1?[...values][0]:null]);
 }
 // Per-object player state is stronger than name-only lobby events, which can
 // refer to several successive bodies or even occur before control transfers.
 for(const e of entities)if(e.identity?.length)result[e.id]=e.identity.map(([frame,,human])=>[frame,human]);
 return {entities:result,unresolved};
}
export function connectedIntervals(intervals,connections){
 const result=[];for(const span of intervals||[]){const cuts=[span[0],...(connections||[]).filter(e=>e[0]>span[0]&&e[0]<span[1]).map(e=>e[0]),span[1]];
  for(let i=1;i<cuts.length;i++)if(connectionState(connections,cuts[i-1])!==false)result.push([cuts[i-1],cuts[i],...span.slice(2)]);
 }return result;
}
