import {sideColor,shortRole,routeVisible,farthestPoints} from './planning-units.mjs';
import {viewPalettes,viewPalette} from './viewshed-surface.mjs';
import {gameplayObject} from './terrain-overlays.mjs';
import * as T from 'three';
import {PlanningScene} from './scene.mjs';
import {makeGrid} from './navigation.mjs';
import {profiles,groupProfiles,embark,distance,travelTime,cell,point} from './core.mjs';
import {loadPreparedHistory,recordedPosition,heatmap} from './history.mjs';
import {RulerGesture,labelSelection,selectIds} from './interactions.mjs';
const $=id=>document.getElementById(id),status=text=>$('status').textContent=text;
let scene,mission,mode='select',selected=new Set(),draft=null,busy=false,serial=0,worker,request=0;
const routes=[],observations=[],histories=[],pending=new Map();
const sceneTools=document.createElement('div');sceneTools.id='sceneTools';sceneTools.append($('modes'));
const panelToggle=document.createElement('button');panelToggle.textContent='Настройки и история';panelToggle.setAttribute('aria-expanded','false');
panelToggle.onclick=()=>{const open=$('app').classList.toggle('panel-open');panelToggle.setAttribute('aria-expanded',String(open));};
sceneTools.append(panelToggle,$('help'));$('view').append(sceneTools);
for(const section of document.querySelectorAll('aside section')){const heading=section.querySelector(':scope > b');if(!heading||heading.id==='selected')continue;const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=heading.textContent;heading.remove();details.append(summary,...section.childNodes);section.append(details);}
const menu=document.createElement('div');menu.id='sceneMenu';menu.hidden=true;$('view').append(menu);const contextActions=document.createElement('div');menu.append(contextActions,$('routeOptions'),$('routeNext'));
function placeMenu(p){const v=scene.vec(p).project(scene.camera),w=$('view').clientWidth,h=$('view').clientHeight;menu.style.left=Math.max(8,Math.min(w-260,(v.x*.5+.5)*w))+'px';menu.style.top=Math.max(8,Math.min(h-245,(-v.y*.5+.5)*h))+'px';menu.hidden=false;}
function contextMenu(p,ids=[]){
  if(ids.length&&!ids.every(id=>selected.has(id))){selected=new Set(ids);selectionChanged();}
  contextActions.replaceChildren();$('routeOptions').hidden=true;$('routeNext').hidden=true;
  const actions=[];
  if(selected.size)actions.push(['Маршрут сюда',()=>startRoute(p)]);
  if(ids.length)actions.push(['Приблизить к выбранным',()=>scene.focus(p,35)]);
  if(ids.some(id=>scene.units.find(u=>u.id===id)?.carrier!=null))actions.push(['Высадить выбранных',disembarkSelected]);
  actions.push(['Видимость с этой точки',async()=>{setMode('visibility');await clickPoint(p);setMode('select');}],['Из глаз · 1,7 м',()=>scene.eye(p,1.7)],['Из техники · 2,3 м',()=>scene.eye(p,2.3)],['Измерить отсюда',()=>{setMode('ruler');ruler.reset();ruler.click(p);scene.ruler(p);}]);
  for(const [title,action]of actions){const b=document.createElement('button');b.textContent=title;b.onclick=()=>task(async()=>{menu.hidden=true;await action();});contextActions.append(b);}placeMenu(p);
}
addEventListener('keydown',e=>{if(e.key==='Escape'){menu.hidden=true;clearDraft();}});
function setMode(value){if(value==='ruler'&&mode!=='ruler')ruler.reset();if(value!=='ruler')scene?.ruler(null);mode=value;for(const b of document.querySelectorAll('[data-mode]'))b.classList.toggle('active',b.dataset.mode===value);$('hint').textContent=({select:'Выбор — модель или метка; рамка — несколько бойцов. ПКМ на точке открывает действия, перетаскивание ПКМ вращает камеру.',route:'Укажите положение выбранных бойцов на следующей точке.',visibility:'Нажмите на позицию для оценки обзора после загрузки сцены.',eye:'Нажмите на поверхность: камера на высоте глаз / прицела.',ruler:'Первый щелчок — начало. Двигайте мышь: расстояние меняется на линии. Второй щелчок — закрепить.',manual:'Щёлкайте по точкам своего маршрута, затем «Завершить рисование».'})[value];}
async function task(fn){if(busy)return;busy=true;try{await fn();}catch(e){status(e.message);console.error(e);}finally{busy=false;}}
function calculate(type,data){const id=++request;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});worker.postMessage({id,type,...data});});}
function selectionChanged(){scene.selectedIds=[...selected];scene.labelsDirty=true;refreshRoutes();routeRows();$('selected').textContent=selected.size?`Выбрано: ${selected.size}`:'Никто не выбран';const first=scene.units.find(u=>selected.has(u.id));if(first){const p=first.speedProfile||profiles[first.mobility];$('unitParameters').textContent=`${p.name} · ${first.parameterSource}. ${first.mobility==='static'?'':`По дороге до ${(p.road*3.6).toFixed(0)} км/ч; вне дорог ≈ ${(p.offroad*3.6).toFixed(0)} км/ч.`} ${first.capacity!=null?`Всего мест: ${first.capacity}.`:'Вместимость пока не подтверждена.'}`;}}
function movers(){const ids=new Set();for(const u of scene.units.filter(u=>selected.has(u.id)))ids.add(u.carrier??u.id);return scene.units.filter(u=>ids.has(u.id));}
function updateSide(){scene.visibleSide=$('side').value;for(const u of scene.units)u.mesh.visible=u.carrier==null&&(scene.visibleSide==='all'||u.side===scene.visibleSide);scene.labelsDirty=true;}
function refreshRoutes(){if(!scene)return;for(const r of routes)for(const seg of r.segments){const on=routeVisible(seg,selected),key='route:'+r.id+':'+seg.id;const line=scene.overlays.get(key);if(line)line.visible=on;const w=scene.waypoints.get(key);if(w)w.hidden=!on;}}
function mountRoute(r){for(const seg of r.segments){const unit=scene.units.find(u=>u.id===seg.id),key='route:'+r.id+':'+seg.id,color=sideColor(unit?.side);scene.line(key,seg.points,color);scene.waypoint(key,seg.points.at(-1),shortRole(unit?.roleDescription||unit?.label,scene.lang)+' · '+r.name,()=>{selected=new Set([seg.id]);selectionChanged();setMode('route');});const w=scene.waypoints.get(key);w.el.style.borderColor=color;w.el.style.color=color;}refreshRoutes();}
function routeRows(){const root=$('routes');root.replaceChildren();for(const r of routes)for(const seg of r.segments){if(!routeVisible(seg,selected))continue;const row=document.createElement('div');row.className='smallrow';const unit=scene.units.find(u=>u.id===seg.id);row.style.color=sideColor(unit?.side);row.textContent=shortRole(unit?.roleDescription||unit?.label,scene.lang)+' · '+r.name+': '+(seg.seconds==null?'без расчёта времени':format(seg.seconds));root.append(row);}}
function format(t){return Number.isFinite(t)?`${Math.floor(t/60)} мин ${Math.round(t%60)} с`:'непроходимо';}
function clearDraft(){menu.hidden=true;if(draft?.manualId)scene.overlay(draft.manualId,null);draft=null;$('routeOptions').hidden=true;$('acceptManual').hidden=true;$('routeNext').hidden=true;setMode('select');}
async function startRoute(target){const us=movers();if(!us.length)throw Error('Сначала выберите бойцов или технику');const center=us.reduce((a,u)=>a.map((v,i)=>v+u.point[i]/us.length),[0,0,0]);draft={units:us.map(u=>u.id),from:us.map(u=>[...u.point]),target,center,manual:[],manualId:'manual'};contextActions.replaceChildren();placeMenu(target);$('routeOptions').hidden=false;$('routeState').textContent='Выберите способ построения участка.';}
async function acceptRoute(kind){if(!draft)throw Error('Сначала укажите следующую точку');const us=draft.units.map(id=>scene.units.find(u=>u.id===id));const points=[...draft.from,draft.target,...draft.manual];const padding=600;
  let grid;if(kind!=='none'){grid=await makeGrid(scene,[Math.min(...points.map(p=>p[0]))-padding,Math.min(...points.map(p=>p[1]))-padding,Math.max(...points.map(p=>p[0]))+padding,Math.max(...points.map(p=>p[1]))+padding]);if(grid.missing)throw Error(`Недостаточно данных о препятствиях (${grid.missing}). Маршрут не подтверждён.`);await calculate('grid',{grid});}
  const segments=[];let seconds=0;
  for(let i=0;i<us.length;i++){const u=us[i],dx=u.point[0]-draft.center[0],dy=u.point[1]-draft.center[1],end=[draft.target[0]+dx,draft.target[1]+dy,scene.height(draft.target[0]+dx,draft.target[1]+dy)];let result;
    if(kind==='none')result={points:[end],seconds:null};
    else if(kind==='manual'){
      const coarse=[draft.from[i],...draft.manual.map(p=>[p[0]+dx,p[1]+dy,p[2]]),end],path=[];
      for(let j=1;j<coarse.length;j++){const a=coarse[j-1],b=coarse[j],n=Math.max(1,Math.ceil(distance(a,b)/(grid.step/2)));for(let k=0;k<n;k++){const t=k/n,x=a[0]+(b[0]-a[0])*t,y=a[1]+(b[1]-a[1])*t,idx=cell(grid,[x,y]);if(idx<0||grid.blocked[idx])throw Error('Нарисованный маршрут пересекает препятствие. Измените точки.');path.push([x,y,scene.height(x,y)]);}}path.push(end);result={points:path,seconds:travelTime(path,groupProfiles([u],scene.units),(a,b)=>grid.roads[cell(grid,a)]&&grid.roads[cell(grid,b)])};
    }else result=await calculate('route',{from:draft.from[i],to:end,profiles:groupProfiles([u],scene.units),mode:kind});
    if(result.seconds!=null&&!Number.isFinite(result.seconds))throw Error('Маршрут слишком крутой для выбранного типа движения');
    segments.push({id:u.id,members:scene.units.filter(r=>r.carrier===u.id).map(r=>r.id),...result});seconds=Math.max(seconds,result.seconds||0);
  }
  // Commit only after every participant has a usable path.
  const id=++serial;for(const segment of segments){const u=scene.units.find(u=>u.id===segment.id);u.point=[...segment.points.at(-1)];scene.updateActor(u);for(const rider of scene.units.filter(r=>r.carrier===u.id)){rider.point=[...u.point];scene.updateActor(rider);}}
  const route={id,name:'Точка '+(routes.length+1),units:us.map(u=>u.id),segments,seconds:kind==='none'?null:seconds};routes.push(route);mountRoute(route);scene.overlay('manual',null);routeRows();$('routeOptions').hidden=true;$('acceptManual').hidden=true;contextActions.replaceChildren();placeMenu(segments[0].points.at(-1));$('routeNext').hidden=false;$('routeState').textContent='Участок принят. Будет следующая точка?';draft=null;setMode('select');status('Каждый выбранный юнит получил свою точку. Выберите часть группы, чтобы продолжить отдельной ветвью.');
}
const ruler=new RulerGesture();
async function clickPoint(p){if(!p)return;if(mode==='route')return startRoute(p);if(mode==='manual'){draft.manual.push(p);scene.line('manual',[draft.center,...draft.manual,draft.target],0xffd977);return;}
  if(mode==='eye'){scene.eye(p,1.7);return;}
  if(mode==='ruler'){const [a,b]=ruler.click(p);scene.ruler(a,b);if(b)status(`По горизонтали: ${distance(a,b).toFixed(1)} м · по прямой в 3D: ${Math.hypot(distance(a,b),b[2]-a[2]).toFixed(1)} м. Следующий щелчок начинает новое измерение.`);return;}
  if(mode==='visibility'){
    const o={id:++serial,point:p,eye:1.7,radius:mission.wmtSettings?.viewDistance||3000,enabled:true,token:{cancelled:false},palette:viewPalette(serial)};
    status('Проверяю видимость по загруженной сцене…');const r=await scene.visibility(p,o.eye,o.radius,o.token);if(!r)return;
    for(const old of observations.filter(v=>v.enabled).slice(0,Math.max(0,observations.filter(v=>v.enabled).length-3))){old.enabled=false;scene.viewshed.toggle(old.id,false);}
    observations.push(o);scene.viewshed.set(o.id,r,o.palette);scene.waypoint('view:'+o.id,p,'Обзор '+o.id,()=>toggleObservation(o));scene.waypoints.get('view:'+o.id).el.style.borderColor=o.palette[0];observationRows();status('Обзор нанесён на рельеф. Нажмите на точку обзора, чтобы скрыть или показать его. Серый — не хватает загруженных данных.');
  }
}
function toggleObservation(o){if(!o.enabled){const active=observations.filter(v=>v.enabled&&v!==o);for(const old of active.slice(0,Math.max(0,active.length-3))){old.enabled=false;scene.viewshed.toggle(old.id,false);}}o.enabled=!o.enabled;scene.viewshed.toggle(o.id,o.enabled);observationRows();}
function observationRows(){const root=$('observations');root.replaceChildren();for(const o of observations){const row=document.createElement('div');row.className='smallrow';row.style.borderLeft='4px solid '+o.palette[0];row.textContent='Обзор '+o.id+' · '+o.radius+' м ';
 const toggle=document.createElement('button');toggle.textContent=o.enabled?'Скрыть':'Показать';toggle.onclick=()=>toggleObservation(o);
 const eye=document.createElement('button');eye.textContent='Из глаз';eye.onclick=()=>scene.eye(o.point,o.eye);const del=document.createElement('button');del.textContent='Удалить';del.onclick=()=>{o.token.cancelled=true;scene.viewshed.remove(o.id);scene.removeWaypoint('view:'+o.id);observations.splice(observations.indexOf(o),1);observationRows();};row.append(toggle,eye,del);root.append(row);}}

function historyDraw(){for(let i=0;i<histories.length;i++){const h=histories[i],seconds=+$('historyTime').value*60,positions=h.units.map(u=>recordedPosition(u,seconds/h.delay,(x,y)=>scene.height(x,y))).filter(Boolean);scene.dots('history:'+i,$('historyPositions').checked?positions.map(p=>[p.point[0],p.point[1],p.point[2]+2]):[],positions.map(p=>p.state===0?0x888888:0xb6c8ff),9);for(const [kind,input,color]of [['hit','historyCombat',0xffa755],['killed','historyLosses',0xff5555]]){const cells=$(''+input).checked?heatmap(h,kind,seconds,(x,y)=>scene.height(x,y)):[];const max=Math.max(1,...cells.map(c=>c.count));scene.dots(kind+':'+i,cells.map(c=>c.point),cells.map(c=>new T.Color(color).multiplyScalar(.4+.6*c.count/max)),24);}}}
let assignments={},planMarkers=[],markerCatalog=[];
function refreshPlanMarkers(){if(scene?.ready)scene.planMarkers(planMarkers,markerCatalog,p=>contextMenu(p));}
async function boot(data){if(scene)return;mission=data;scene=new PlanningScene($('view'),status);worker=new Worker('/planner/worker.mjs',{type:'module'});worker.onmessage=({data:m})=>{const p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.error?p.reject(Error(m.error)):p.resolve(m.result??m.ok);};worker.onerror=e=>{for(const p of pending.values())p.reject(Error(e.message));pending.clear();};
  await scene.load(data);scene.setAssignments(assignments);refreshPlanMarkers();scene.onSelect=ids=>{selected=selectIds(selected,ids);selectionChanged();};$('viewDistance').textContent=(data.wmtSettings?.viewDistance||3000)+' м (из миссии)';
  const sides=[...new Set(scene.units.map(u=>u.side).filter(Boolean))];for(const side of sides)for(const id of ['side','enemySide']){const option=document.createElement('option');option.value=side;option.textContent=side;$(id).append(option);}
  const canvas=scene.renderer.domElement,view=$('view');let down=null,rightDown=null;
  const at=e=>{const target=e.type==='pointerdown'?e.target:(document.elementFromPoint(e.clientX,e.clientY)||e.target),ids=labelSelection(target,scene.units),hit=scene.pick(e);if(ids.length){hit.unit=scene.units.find(u=>u.id===ids[0]);hit.point=hit.unit.point;}return {...hit,ids:ids.length?ids:hit.unit?[hit.unit.id]:[]};};
  const ghost=document.createElement('div');ghost.id='boardingGhost';ghost.hidden=true;view.append(ghost);
  const clearPointer=()=>{scene.boardingPreview([],null);ghost.hidden=true;down=null;rightDown=null;$('selection').style.display='none';view.classList.remove('boarding-drag');for(const el of view.querySelectorAll('.drop-target'))el.classList.remove('drop-target');};
  view.addEventListener('contextmenu',e=>e.preventDefault());
  view.addEventListener('pointerdown',e=>{
    if(busy||e.target.closest('#sceneMenu,.waypoint-label,#sceneTools'))return;
    if(e.button===2){rightDown={x:e.clientX,y:e.clientY,hit:at(e)};return;}
    if(e.button!==0)return;menu.hidden=true;const hit=at(e);down={x:e.clientX,y:e.clientY,hit,shift:e.shiftKey,pointer:e.pointerId};
    canvas.setPointerCapture(e.pointerId);
  });
  view.addEventListener('pointermove',e=>{
    if(!e.target.closest('#sceneMenu,#sceneTools,.waypoint-label'))scene.cursor(scene.pick(e).point);else scene.cursor(null);
    if(mode==='ruler'&&!busy&&!e.target.closest('#sceneMenu,#sceneTools')){const p=scene.pick(e).point;if(p)scene.ruler(...ruler.move(p));}
    if(!down||mode!=='select')return;
    if(down.hit.ids.length&&!down.shift){
      if(Math.hypot(down.x-e.clientX,down.y-e.clientY)<=7)return;
      view.classList.add('boarding-drag');const hit=at(e),ids=down.hit.ids.every(id=>selected.has(id))?[...selected]:down.hit.ids,riders=scene.units.filter(u=>ids.includes(u.id)&&u.mobility==='foot');const rect=view.getBoundingClientRect();ghost.hidden=!riders.length;ghost.textContent='♟ '+riders.length+' · '+riders.slice(0,6).map(u=>shortRole(u.roleDescription,scene.lang)).join(', ')+(riders.length>6?'…':'');ghost.style.left=e.clientX-rect.left+16+'px';ghost.style.top=e.clientY-rect.top+16+'px';scene.boardingPreview(riders,hit.point);
      for(const el of view.querySelectorAll('.drop-target'))el.classList.remove('drop-target');
      if(hit.unit?.mobility!=='foot'&&hit.unit?.capacity>0)hit.unit?.labelNode?.classList.add('drop-target');
      return;
    }
    const r=canvas.getBoundingClientRect(),box=$('selection');box.style.display='block';box.style.left=Math.min(down.x,e.clientX)-r.left+'px';box.style.top=Math.min(down.y,e.clientY)-r.top+'px';box.style.width=Math.abs(down.x-e.clientX)+'px';box.style.height=Math.abs(down.y-e.clientY)+'px';
  });
  view.addEventListener('pointerup',e=>{
    if(e.button===2&&rightDown){const d=rightDown;rightDown=null;if(Math.hypot(e.clientX-d.x,e.clientY-d.y)<5&&!busy&&d.hit.point)contextMenu(d.hit.point,d.hit.ids);return;}
    if(!down||e.button!==0)return;const d=down,hit=at(e),drag=Math.hypot(d.x-e.clientX,d.y-e.clientY)>7;clearPointer();
    task(async()=>{
      if(mode!=='select'){await clickPoint(hit.point);return;}
      if(drag&&d.hit.ids.length&&!d.shift&&hit.unit?.mobility!=='foot'&&hit.unit?.capacity>0){
        if(!hit.unit||d.hit.ids.includes(hit.unit.id))return;
        if(!d.hit.ids.every(id=>selected.has(id)))selected=new Set(d.hit.ids);
        const riders=scene.units.filter(u=>selected.has(u.id)&&u.mobility==='foot');
        if(!riders.length)throw Error('На машину можно перетаскивать пехоту. Для перемещения выберите маршрут.');
        embark(riders,hit.unit,scene.units,hit.unit.capacity);for(const u of scene.units)scene.updateActor(u);updateSide();
        status('Пехота назначена в машину. Её экипаж можно выбрать через метку машины.');
      }else if(drag){
        if(!d.shift)selected.clear();const r=canvas.getBoundingClientRect();
        for(const u of scene.units){if(!u.mesh.visible||!gameplayObject(u))continue;const v=u.mesh.position.clone().project(scene.camera),x=(v.x*.5+.5)*r.width+r.left,y=(-v.y*.5+.5)*r.height+r.top;if(v.z>=-1&&v.z<=1&&x>=Math.min(d.x,e.clientX)&&x<=Math.max(d.x,e.clientX)&&y>=Math.min(d.y,e.clientY)&&y<=Math.max(d.y,e.clientY))selected.add(u.id);}
      }else selected=selectIds(selected,d.hit.ids,d.shift);
      selectionChanged();routeRows();
    });
  });
  view.addEventListener('pointercancel',clearPointer);
  // Pointer selection owns clicks; avoid the replay label's detail callback
  // resetting multi-selection after a drag or Shift-click. Keyboard stays usable.
  view.addEventListener('click',e=>{if(e.detail&&e.target.closest('#labels button')){e.preventDefault();e.stopPropagation();}},true);
  view.addEventListener('dblclick',e=>{if(mode!=='select'||e.target.closest('#sceneMenu,#sceneTools'))return;const u=at(e).unit;if(u?.groupId!=null){selected=new Set(scene.units.filter(v=>v.groupId===u.groupId&&v.side===u.side).map(v=>v.id));selectionChanged();}});
  setMode('select');
}
window.addEventListener('message',e=>{if(e.origin!==location.origin||e.source!==parent)return;if(e.data?.type==='planning-mission'){assignments=e.data.assignments||{};planMarkers=e.data.markers||[];markerCatalog=e.data.markerCatalog||[];task(()=>boot(e.data.mission));}else if(e.data?.type==='planning-assignments'){assignments=e.data.assignments||{};scene?.setAssignments(assignments);}else if(e.data?.type==='planning-markers'){planMarkers=e.data.markers||[];markerCatalog=e.data.markerCatalog||[];refreshPlanMarkers();}});
for(const b of document.querySelectorAll('[data-mode]'))b.onclick=()=>{if(!scene?.ready||busy)return;setMode(b.dataset.mode);};
$('side').onchange=()=>updateSide();$('roadRoute').onclick=()=>task(()=>acceptRoute('road'));$('freeRoute').onclick=()=>task(()=>acceptRoute('free'));$('noRoute').onclick=()=>task(()=>acceptRoute('none'));
$('manualRoute').onclick=()=>{if(!draft)return;menu.hidden=true;setMode('manual');$('routeOptions').hidden=true;$('acceptManual').hidden=false;};$('acceptManual').onclick=()=>task(()=>acceptRoute('manual'));
$('nextPoint').onclick=()=>{menu.hidden=true;setMode('route');$('routeNext').hidden=true;};$('finishRoute').onclick=()=>{clearDraft();$('routeState').textContent='Маршрут закончен. Можно выбрать другое отделение.';};$('cancelRoute').onclick=clearDraft;
$('leaveEye').onclick=()=>scene?.leaveEye();
function disembarkSelected(){const carriers=new Set(scene.units.filter(u=>selected.has(u.id)&&u.mobility!=='foot').map(u=>u.id));for(const u of scene.units.filter(u=>selected.has(u.id)||carriers.has(u.carrier))){u.carrier=null;scene.updateActor(u);}updateSide();selectionChanged();}
$('disembark').onclick=disembarkSelected;
$('enemyReach').onclick=()=>task(async()=>{
 const seconds=+$('enemyMinutes').value*60;if(!(seconds>0&&seconds<=7200))throw Error('Укажите от 1 до 120 минут');
 const us=scene.units.filter(u=>u.side===$('enemySide').value&&gameplayObject(u)&&u.carrier==null&&Math.max(u.speedProfile.road,u.speedProfile.offroad)>0).sort((a,b)=>Math.max(b.speedProfile.road,b.speedProfile.offroad)-Math.max(a.speedProfile.road,a.speedProfile.offroad)||a.id-b.id).slice(0,3);
 if(!us.length)throw Error('У этой стороны нет подвижных юнитов');clearReach();status('Подготавливаю рельеф и дороги для расчёта достижимости…');const size=scene.terrain.worldSize,g=await makeGrid(scene,[0,0,size,size],Math.max(40,Math.ceil(size/300)),{coarse:true});await calculate('grid',{grid:g});
 for(const [index,u]of us.entries()){status('Достижимость: '+(index+1)+' / '+us.length);const times=await calculate('reach',{starts:[{point:u.start,profile:u.speedProfile}],seconds}),points=farthestPoints(g,times,u.start),color=viewPalettes[index][0];
  for(const [i,r]of points.entries()){const key='reach:'+u.id+':'+i;scene.waypoint(key,r.point,(u.label||shortRole(u.roleDescription,scene.lang))+' · '+(r.distance/1000).toFixed(1)+' км',()=>scene.focus(r.point,90));scene.waypoints.get(key).el.style.borderColor=color;scene.waypoints.get(key).el.style.color=color;}}
 status('Показаны до 5 дальних позиций для каждого из '+us.length+' самых быстрых юнитов. Это оценка по сетке '+g.step+' м, по рельефу и дорогам, без пробок и проверки отдельных зданий.');
});
function clearReach(){for(const id of [...scene.waypoints.keys()])if(id.startsWith('reach:'))scene.removeWaypoint(id);}
$('clearReach').onclick=clearReach;
$('reloadReplays').onclick=()=>task(async()=>{status('Получаю список записей WOG Replay…');const r=await fetch('/api/planning/replays?world='+encodeURIComponent(scene.world));if(!r.ok)throw Error('Не удалось обновить каталог: '+(await r.text()).slice(0,180));const d=await r.json();$('replayChoice').replaceChildren();for(const m of d.missions){const o=document.createElement('option');o.value=m.id;o.textContent=`${m.date||''} · ${m.title||m.mission||m.id}`;$('replayChoice').append(o);}status(`На этой карте найдено записей: ${d.missions.length}`);});
$('addReplay').onclick=()=>task(async()=>{const id=$('replayChoice').value;if(!id)throw Error('Выберите запись');status('Загружаю исторические позиции и события…');const r=await fetch('/api/planning/replays/'+encodeURIComponent(id));if(!r.ok)throw Error('Запись пока недоступна: '+await r.text());const d=await r.json(),h=loadPreparedHistory(d,scene.world);histories.push(h);const row=document.createElement('div');row.textContent=h.name;$('histories').append(row);historyDraw();status('Историческая запись загружена');});
for(const id of ['historyTime','historyPositions','historyCombat','historyLosses'])$(id).onchange=historyDraw;
function identity(){return JSON.stringify([mission.worldName,mission.name,scene.units.map(u=>[u.id,u.start])]);}
$('save').onclick=()=>{if(!scene?.ready)return;const content={format:'wog-planning-1',mission:identity(),units:scene.units.map(({id,point,carrier,mobility,speedProfile})=>({id,point,carrier,mobility,speedProfile})),routes,observations:observations.map(({id,point,eye,radius,enabled,palette})=>({id,point,eye,radius,enabled,palette}))};const url=URL.createObjectURL(new Blob([JSON.stringify(content)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='3d-plan.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('restore').onchange=e=>task(async()=>{const f=e.target.files[0];if(!f)return;if(f.size>10*1024*1024)throw Error('План слишком большой');const d=JSON.parse(await f.text());if(d.format!=='wog-planning-1'||d.mission!==identity())throw Error('План относится к другой миссии или версии');const valid=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite)&&p[0]>=0&&p[1]>=0&&p[0]<=scene.terrain.worldSize&&p[1]<=scene.terrain.worldSize;if(!Array.isArray(d.units)||!Array.isArray(d.routes)||d.units.some(u=>!valid(u.point)||!profiles[u.mobility])||d.routes.some(r=>!Array.isArray(r.segments)||r.segments.some(s=>!Array.isArray(s.points)||s.points.some(p=>!valid(p)))))throw Error('Некорректные данные плана');for(const id of [...scene.overlays.keys()])if(id.startsWith('route:')||id.startsWith('view:'))scene.overlay(id,null);for(const id of [...scene.waypoints.keys()])if(id.startsWith('route:')||id.startsWith('view:'))scene.removeWaypoint(id);for(const o of observations){o.token.cancelled=true;scene.viewshed.remove(o.id);}for(const saved of d.units){const u=scene.units.find(u=>u.id===saved.id);if(u){Object.assign(u,saved);scene.updateActor(u);}}routes.splice(0,routes.length,...d.routes);for(const r of routes)mountRoute(r);serial=Math.max(serial,...routes.map(r=>r.id));observations.length=0;routeRows();observationRows();status('План восстановлен. Видимость сохранённых позиций пересчитывается по текущей загруженной сцене.');for(const o of d.observations||[]){if(!valid(o.point))continue;const r=await scene.visibility(o.point,o.eye,o.radius,{cancelled:false});if(r){o.token={cancelled:false};o.palette=Array.isArray(o.palette)?o.palette:viewPalette(o.id);o.enabled=o.enabled!==false;observations.push(o);serial=Math.max(serial,o.id);scene.viewshed.set(o.id,r,o.palette);scene.viewshed.toggle(o.id,o.enabled);scene.waypoint('view:'+o.id,o.point,'Обзор '+o.id,()=>toggleObservation(o));scene.waypoints.get('view:'+o.id).el.style.borderColor=o.palette[0];}}observationRows();});
const tour=[['Карта миссии','Загрузите PBO в обычном планировщике, затем откройте 3D. Карта и модели берутся через локальную утилиту из вашей сборки. Пунктир обозначает отсутствующую модель.'],['Выбор и посадка','Обведите бойцов мышью. Двойной щелчок выбирает отделение; Shift дополняет выбор. Перетащите пехоту на машину, вместимость будет взята из сборки.'],['План движения','Скорости и типы берутся из сборки. Нажмите ПКМ на нужной точке карты и выберите дорожный, свободный, ручной вариант или только положение. После каждого этапа добавьте следующую точку либо завершите маршрут.'],['Обзор и позиция','ПКМ на карте → «Видимость с этой точки». Цветное покрытие следует рельефу; у каждой точки своя пара цветов, серый означает неполные данные. Нажмите метку обзора, чтобы включить или скрыть слой. «Из глаз» — 1,7 м, «Из техники» — 2,3 м.'],['Противник и история','Укажите сторону и время движения для расчёта по начальным позициям трёх самых быстрых юнитов. Для каждого показываются пять дальних мест. Выберите на сайте WOG Replay запись этой карты для исторических позиций, HIT и потерь до выбранной минуты.'],['Измерение и сохранение','Включите линейку: первая точка следует за мышью, щелчок закрепляет начало, второй — конец. Расстояние показано прямо на линии. Сохраните план в файл перед выходом. Расчёт не моделирует пробки, разрушения и решения игроков: ETA и обзор следует проверять на месте.']];let tourIndex=0;function showTour(){const [title,text]=tour[tourIndex];$('tourTitle').textContent=title;$('tourText').textContent=text;$('tourNext').textContent=tourIndex===tour.length-1?'Готово':'Далее';}$('help').onclick=()=>{tourIndex=0;showTour();$('tour').showModal();};$('tourNext').onclick=()=>{if(++tourIndex===tour.length)$('tour').close();else showTour();};$('tourClose').onclick=()=>$('tour').close();

$('language').onchange=()=>{scene.lang=$('language').value;document.documentElement.lang=scene.lang;scene.labelsDirty=true;for(const r of routes)mountRoute(r);routeRows();};
