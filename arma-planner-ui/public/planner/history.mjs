// OCAP 1 WOG position layout: [ [east,north,AGL,ASL], heading,
// state, vehicle/crew, absoluteFrame, ... ]. No interpolation across missing data.
export function loadHistory(raw,world){
  if(String(raw.worldName).toLowerCase()!==world.toLowerCase())throw Error('Запись относится к другой карте');
  if(!Array.isArray(raw.entities)||!Array.isArray(raw.events)||!(raw.captureDelay>0))throw Error('Нужен исходный JSON OCAP с позициями и событиями');
  const units=raw.entities.map(e=>({...e,positions:(e.positions||[]).filter(p=>Array.isArray(p[0])&&p[0].length>=2&&Number.isFinite(p[4])).sort((a,b)=>a[4]-b[4])}));
  if(!units.some(e=>e.positions.length))throw Error('В файле нет поддерживаемых координат OCAP');
  return {name:raw.missionName||'OCAP',delay:raw.captureDelay,units,events:raw.events.filter(e=>['hit','killed'].includes(e[1])),end:raw.endFrame*raw.captureDelay};
}
export function loadPreparedHistory(data,world){
  const m=data.manifest;if(!m||!Array.isArray(data.chunks))throw Error('Неполная запись WOG Replay');
  const tracks=new Map();for(const chunk of data.chunks)for(const [id,rows]of Object.entries(chunk.tracks||{})){if(!tracks.has(+id))tracks.set(+id,new Map());for(const p of rows)tracks.get(+id).set(p[0],p);}
  const entities=m.entities.map(e=>({...e,positions:[...(tracks.get(e.id)?.values()||[])].sort((a,b)=>a[0]-b[0]).map(p=>[[p[1],p[2],p[7],p[6]],p[3],p[4],p[5],p[0]])}));
  const events=[...(m.events||[]).map(e=>[e.frame,'killed',e.victim]),...(m.hitEvents||[]).map(e=>[e.frame,'hit',e.victim])];
  return loadHistory({worldName:m.world,missionName:m.title||m.mission,captureDelay:m.delay,endFrame:m.frames,entities,events},world);
}
export function recordedPosition(unit,frame,height){
  const ps=unit.positions;if(!ps.length||frame<ps[0][4]||frame>ps.at(-1)[4])return null;
  let lo=0,hi=ps.length;while(lo<hi){const mid=(lo+hi)>>1;if(ps[mid][4]<=frame)lo=mid+1;else hi=mid;}
  const p=ps[lo-1],xy=p[0];return {point:[xy[0],xy[1],Number.isFinite(xy[3])?xy[3]:height(xy[0],xy[1])+Math.max(0,xy[2]||0)],state:p[2],side:unit.side,name:unit.name};
}
export function heatmap(history,kind,until,height,cellSize=100){
  const byId=new Map(history.units.map(u=>[u.id,u])),cells=new Map();
  for(const e of history.events){if(e[1]!==kind||e[0]*history.delay>until)continue;const u=byId.get(e[2]);if(!u)continue;const p=recordedPosition(u,e[0],height);if(!p)continue;const x=Math.floor(p.point[0]/cellSize),y=Math.floor(p.point[1]/cellSize),key=x+':'+y;const row=cells.get(key)||{point:[(x+.5)*cellSize,(y+.5)*cellSize,0],count:0};row.count++;row.point[2]=height(...row.point)+2;cells.set(key,row);}return [...cells.values()];
}
