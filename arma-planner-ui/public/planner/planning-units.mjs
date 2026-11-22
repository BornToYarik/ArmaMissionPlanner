export const sideColor = side => ({WEST:'#2389c5',EAST:'#e04c4c',GUER:'#35b46f',INDEPENDENT:'#35b46f',CIV:'#ba65cb'})[String(side).toUpperCase()]||'#b5af72';
export function initialVehicleSide(vehicle,units){
 if(vehicle.side&&!/^(empty|unknown)$/i.test(vehicle.side))return vehicle.side;
 const distances=new Map();for(const u of units){if(u.groupId==null||!u.side)continue;const a=u.position,b=vehicle.position;if(!a||!b)continue;const d=Math.hypot(a[0]-b[0],a[2]-b[2]);distances.set(u.side,Math.min(distances.get(u.side)??Infinity,d));}
 const near=[...distances].sort((a,b)=>a[1]-b[1]);return near[0]?.[1]<=150&&(!near[1]||near[1][1]>Math.max(150,near[0][1]*2))?near[0][0]:vehicle.side;
}
const roles=[
 [/командир взвода|platoon leader/i,'КВ','PL'],[/заместитель|team leader|\bFTL\b/i,'ЗКО','FTL'],
 [/командир.*отдел|squad leader/i,'КО','SL'],[/командир.*мином|mortar.*commander/i,'КМ','MC'],
 [/помощник.*гранатом|AT assistant/i,'ПГ','AAT'],[/помощник.*пулем|assistant machine/i,'ПП','AMG'],
 [/помощник.*навод|assistant gunner/i,'ПН','AG'],[/подносчик|ammo bearer/i,'ПБ','AB'],
 [/медик|medic/i,'Мед','MED'],[/снайпер|marksman|sniper/i,'Сн','DM'],[/пулем|machinegunner|machine gunner/i,'Пул','MG'],
 [/гранатом|AT rifleman|grenadier/i,'Гр','AT'],[/мехвод|водитель|driver/i,'Вод','DRV'],
 [/наводчик|стрелок зу|gunner/i,'Нав','GNR'],[/инженер|engineer/i,'Инж','ENG'],[/сапер|сапёр|sapper/i,'Сап','SAP'],
 [/стрелок|rifleman/i,'Стр','RFL'],[/пилот|pilot/i,'Пил','PIL']
];
export function shortRole(description,lang='ru'){
 const text=String(description||'');const found=roles.find(([pattern])=>pattern.test(text));
 if(found)return found[lang==='en'?2:1];
 const parts=text.split('|').map(x=>x.trim()).filter(Boolean),part=(lang==='en'?parts.find(x=>/[a-z]/i.test(x)):parts.find(x=>/[а-яё]/i.test(x)))||parts[0];
 return part?part.length<=12?part:part.split(/\s+/).map(w=>w[0]).join('').slice(0,6).toUpperCase():(lang==='en'?'Unit':'Боец');
}
// A batch is only a UI action. Each segment belongs to one moving unit;
// its passengers also inherit that segment while embarked.
export function routeVisible(segment,selected){return [segment.id,...(segment.members||[])].some(id=>selected.has(id));}
export function farthestPoints(grid,times,origin,count=5){
 const candidates=[];
 for(let i=0;i<times.length;i++)if(Number.isFinite(times[i])){
  const p=[grid.x+(i%grid.nx)*grid.step,grid.y+Math.floor(i/grid.nx)*grid.step,grid.heights[i]];
  candidates.push({point:p,seconds:times[i],distance:Math.hypot(p[0]-origin[0],p[1]-origin[1])});
 }
 candidates.sort((a,b)=>b.distance-a.distance);const result=[],separation=Math.max(grid.step*2,(candidates[0]?.distance||0)*.35);
 for(const c of candidates)if(result.every(p=>Math.hypot(p.point[0]-c.point[0],p.point[1]-c.point[1])>=separation)){result.push(c);if(result.length===count)break;}
 return result;
}
