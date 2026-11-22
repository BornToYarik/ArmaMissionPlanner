import {normalizedSide,rosterRows} from './roster-data.mjs';
import {sideColor} from './planning-units.mjs';
export class UnitRoster{
 constructor(container,{select,focus,side}){
  this.el=document.createElement('details');this.el.id='plannerRoster';this.el.open=true;this.el.setAttribute('aria-label','Отделения и техника');
  const heading=document.createElement('summary');heading.textContent='Отделения и техника';this.el.append(heading);
  this.side=document.createElement('select');this.side.setAttribute('aria-label','Сторона списка');this.side.onchange=()=>side(this.side.value);this.el.append(this.side);
  const hint=document.createElement('small');hint.textContent='ЛКМ — выбрать · ПКМ — перейти';this.el.append(hint);
  this.body=document.createElement('div');this.el.append(this.body);container.append(this.el);this.onSelect=select;this.onFocus=focus;this.sections=new Map();
 }
 update(units,side,selected,lang,assignments){
  const sides=[...new Set(units.map(u=>normalizedSide(u.side)).filter(s=>['WEST','EAST','GUER','CIV'].includes(s)))];
  const signature=sides.join(',');if(this.sides!==signature){this.sides=signature;this.side.replaceChildren();for(const value of ['all',...sides]){const o=document.createElement('option');o.value=value;o.textContent=({all:'Все стороны',WEST:'Синие · WEST',EAST:'Красные · EAST',GUER:'Зелёные · GUER',CIV:'Гражданские · CIV'})[value];this.side.append(o);}}
  this.side.value=normalizedSide(side)==='ALL'?'all':normalizedSide(side)||'all';
  const {squads,vehicles}=rosterRows(units,side,assignments,lang);
  for(const [key,title,rows] of [['squads','Отделения',squads],['vehicles','Техника',vehicles]]){
   let section=this.sections.get(key);if(!section){const el=document.createElement('details');el.open=true;const summary=document.createElement('summary'),body=document.createElement('div');el.append(summary,body);this.body.append(el);section={el,summary,body};this.sections.set(key,section);}
   section.summary.textContent=title+' · '+rows.length;section.body.replaceChildren();
   for(const row of rows){const b=document.createElement('button'),on=row.members.every(id=>selected.includes(id));b.textContent=row.name;b.style.color=sideColor(row.side);b.classList.toggle('selected',on);b.setAttribute('aria-pressed',String(on));b.title='ЛКМ — выбрать; ПКМ — перейти камерой';b.onclick=()=>this.onSelect(row.members);b.oncontextmenu=e=>{e.preventDefault();e.stopPropagation();this.onFocus(row.members);};section.body.append(b);}
  }
 }
}
