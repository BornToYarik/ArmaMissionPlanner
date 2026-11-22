import {squadMembers} from './squad-members.mjs';
import {gameplayObject} from './terrain-overlays.mjs';
import {vehicleName} from './vehicle-names.mjs';
export const normalizedSide=s=>({INDEPENDENT:'GUER',RESISTANCE:'GUER',CIVILIAN:'CIV'}[String(s||'').toUpperCase()]||String(s||'').toUpperCase());
export const neutralVehicle=u=>u.mobility!=='foot'&&!['WEST','EAST','GUER','CIV'].includes(normalizedSide(u.side));
export const rosterVisible=(u,side)=>!side||side==='all'||normalizedSide(u.side)===normalizedSide(side)||neutralVehicle(u);
export function rosterRows(units,side,assignments={},lang='ru'){
 const squads=[...squadMembers(units).values()].filter(m=>rosterVisible(m[0],side)).map(m=>{
  const tags=[...new Set(m.map(u=>String(assignments[u.id]||'').trim().replace(/[\[\]]/g,'')).filter(Boolean))];
  return {name:(tags.length?'['+tags.join(' / ')+'] · ':'')+(m[0].groupLabel||'Отделение '+m[0].groupId)+' · '+m.length,members:m.map(u=>u.id),side:m[0].side};
 });
 const vehicles=units.filter(u=>u.mobility!=='foot'&&gameplayObject(u)&&rosterVisible(u,side)).map(u=>({name:vehicleName(u,lang),members:[u.id],side:u.side}));
 return {squads,vehicles};
}
