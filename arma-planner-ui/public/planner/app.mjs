import {appendManualPoint,undoManualPoint,manualGoalRadius,sampleManualPath} from './manual-route.mjs';
import {editPlanMarker} from './marker-editor.mjs';
import {rosterVisible,normalizedSide} from './roster-data.mjs';
import {airRoute} from './air-route.mjs';
import {routeHeading} from './route-heading.mjs';
import {ensureRouteSequences,waypointNumber} from './route-sequences.mjs';
import {editWaypoint} from './route-editing.mjs';
import {observationIcon} from './observation-icons.mjs';
import {markerGestures} from './marker-gestures.mjs';
import {loadUnits,loadable,carriedBy,unloadPositions} from './transport.mjs';
import {vehicleName} from './vehicle-names.mjs';
import {sideColor,shortRole,routeVisible,farthestPoints} from './planning-units.mjs';
import {viewPalettes,viewPalette} from './viewshed-surface.mjs';
import {gameplayObject} from './terrain-overlays.mjs';
import * as T from 'three';
import {PlanningScene} from './scene.mjs';
import {makeGrid} from './navigation.mjs';
import {segmentClear} from './navigation-obstacles.mjs';
import {viewHeight,observerPoint} from './visibility-volume.mjs';
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
let menuAnchor=null,menuWidth=245,menuHeight=245;
new ResizeObserver(()=>{menuWidth=menu.offsetWidth||245;menuHeight=menu.offsetHeight||245;}).observe(menu);
function updateMenuAnchor(){if(menu.hidden||!menuAnchor)return;const p=menuAnchor();if(!p)return;const v=scene.vec(p).project(scene.camera),w=$('view').clientWidth,h=$('view').clientHeight;
 menu.style.visibility=v.z< -1||v.z>1||Math.abs(v.x)>1||Math.abs(v.y)>1?'hidden':'visible';
 const x=(v.x*.5+.5)*w,y=(-v.y*.5+.5)*h;menu.style.left=Math.max(8,Math.min(w-menuWidth-8,x+12))+'px';menu.style.top=Math.max(8,Math.min(h-menuHeight-8,y+12))+'px';}
function placeMenu(p,anchor=null){menuAnchor=anchor||(()=>p);menu.hidden=false;updateMenuAnchor();}

function contextMenu(p,ids=[]){
  if(ids.length&&!ids.every(id=>selected.has(id))){selected=new Set(ids);selectionChanged();}
  contextActions.replaceChildren();$('routeOptions').hidden=true;$('routeNext').hidden=true;
  const actions=[];
  if(selected.size)actions.push(['Маршрут сюда',()=>startRoute(p)]);
  if(ids.length)actions.push(['Приблизить к выбранным',()=>scene.focus(p,35)]);
  if(ids.some(id=>scene.units.find(u=>u.id===id)?.carrier!=null))actions.push(['Высадить выбранных',disembarkSelected]);
  actions.push(['Поставить метку',()=>changePlanMarker({x:p[0],y:p[1]})]);
  actions.push(['Обзор пехоты · 1,7 м',()=>addObservation(p,1.7)],['Обзор техники · 2,3 м',()=>addObservation(p,2.3)],['Измерить отсюда',()=>{setMode('ruler');ruler.reset();ruler.click(p);scene.ruler(p);}]);
  for(const [title,action]of actions){const b=document.createElement('button');b.textContent=title;b.onclick=()=>task(async()=>{menu.hidden=true;await action();});contextActions.append(b);}placeMenu(p,ids.length?()=>scene.units.find(u=>u.id===ids[0])?.point||p:null);
}
addEventListener('keydown',e=>{if(e.key==='Escape'){scene?.cancelMarkerDrag?.();menu.hidden=true;clearDraft();}});
function setMode(value){if(value==='ruler'&&mode!=='ruler')ruler.reset();if(value!=='ruler')scene?.ruler(null);mode=value;for(const b of document.querySelectorAll('[data-mode]'))b.classList.toggle('active',b.dataset.mode===value);$('hint').textContent=({select:'Выбор — модель или метка; рамка — несколько бойцов. ПКМ на точке открывает действия, перетаскивание ПКМ вращает камеру.',route:'Укажите положение выбранных бойцов на следующей точке.',visibility:'Нажмите на позицию для оценки обзора после загрузки сцены.',eye:'Нажмите на поверхность: камера на высоте глаз / прицела.',ruler:'Первый щелчок — начало. Двигайте мышь: расстояние меняется на линии. Второй щелчок — закрепить.',manual:'ЛКМ — точка пути · ПКМ — отменить последнюю · Esc — отменить. Завершение: клик в круг 5 м вокруг цели.'})[value];}
async function task(fn){if(busy)return;busy=true;try{await fn();}catch(e){status(e.message);console.error(e);}finally{busy=false;queueSnapshot();setTimeout(drainCommands,0);}}
function calculate(type,data){const id=++request;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});worker.postMessage({id,type,...data});});}
function selectionChanged(){queueSnapshot();scene.selectedIds=[...selected];scene.labelsDirty=true;refreshRoutes();routeRows();$('selected').textContent=selected.size?`Выбрано: ${selected.size}`:'Никто не выбран';const first=scene.units.find(u=>selected.has(u.id));if(first){const p=first.speedProfile||profiles[first.mobility];$('unitParameters').textContent=`${p.name} · ${first.parameterSource}. ${first.mobility==='static'?'':`По дороге до ${(p.road*3.6).toFixed(0)} км/ч; вне дорог ≈ ${(p.offroad*3.6).toFixed(0)} км/ч.`} ${first.capacity!=null?`Всего мест: ${first.capacity}.`:'Вместимость пока не подтверждена.'}`;}}
function movers(){const ids=new Set();for(const u of scene.units.filter(u=>selected.has(u.id)))ids.add(u.carrier??u.id);return scene.units.filter(u=>ids.has(u.id));}
function updateSide(){scene.visibleSide=$('side').value;for(const u of scene.units)u.mesh.visible=u.carrier==null&&rosterVisible(u,scene.visibleSide);scene.labelsDirty=true;}
function refreshRoutes(){if(!scene)return;ensureRouteSequences(routes);const groups=new Set();for(const r of routes){const foot=[];for(const seg of r.segments){const on=routeVisible(seg,selected),key='route:'+r.id+':'+seg.id;const line=scene.overlays.get(key);if(line)line.visible=on;const w=scene.waypoints.get(key);if(w)w.hidden=!on;if(on&&scene.units.find(u=>u.id===seg.id)?.mobility==='foot')foot.push(seg);}
 if(foot.length>1&&new Set(foot.map(s=>scene.units.find(u=>u.id===s.id)?.side)).size===1){const key='routegroup:'+r.id,center=foot.reduce((p,s)=>p.map((v,i)=>v+s.points.at(-1)[i]/foot.length),[0,0,0]),color=sideColor(scene.units.find(u=>u.id===foot[0].id)?.side);groups.add(key);for(const seg of foot){const w=scene.waypoints.get('route:'+r.id+':'+seg.id);if(w)w.hidden=true;}scene.waypoint(key,center,'Пехота · '+foot.length+' · Точка '+[...new Set(foot.map(seg=>waypointNumber(routes,r,seg.id)))].join(' / '),()=>{selected=new Set(foot.map(s=>s.id));selectionChanged();setMode('route');});const w=scene.waypoints.get(key);w.members=foot.map(s=>s.id);w.el.style.color=color;w.el.style.borderColor=color;const label=document.createElement('small');label.className='waypoint-time';const seconds=foot.some(s=>s.seconds==null)?null:Math.max(...foot.map(s=>s.seconds)),chains=foot.map(seg=>routes.slice(0,routes.indexOf(r)+1).flatMap(r=>r.segments.filter(s=>s.id===seg.id))),total=chains.some(c=>c.some(s=>s.seconds==null))?null:Math.max(...chains.map(c=>c.reduce((t,s)=>t+s.seconds,0)));label.textContent=(seconds==null?'время не рассчитано':format(seconds))+(chains.some(c=>c.length>1)?' · всего '+(total==null?'не рассчитано':format(total)):'');w.el.append(label);w.el.title='Перетащить — перенести точку всей выбранной группы; ПКМ — удалить';}
 }for(const key of [...scene.waypoints.keys()])if(key.startsWith('routegroup:')&&!groups.has(key))scene.removeWaypoint(key);}
function unitTitle(u){return u?.mobility==='foot'?shortRole(u.roleDescription||u.label,scene.lang):vehicleName(u||{},scene.lang);}
function waypointTiming(route,seg){const chain=routes.slice(0,routes.indexOf(route)+1).flatMap(r=>r.segments.filter(s=>s.id===seg.id));const current=seg.seconds==null?'время не рассчитано':format(seg.seconds);return chain.length<2?current:current+' · всего '+(chain.some(s=>s.seconds==null)?'не рассчитано':format(chain.reduce((t,s)=>t+s.seconds,0)));}
function mountRoute(r){ensureRouteSequences(routes);for(const seg of r.segments){const unit=scene.units.find(u=>u.id===seg.id),key='route:'+r.id+':'+seg.id,color=sideColor(unit?.side);scene.line(key,seg.points,color,{air:unit?.mobility==='air'});scene.waypoint(key,seg.points.at(-1),unitTitle(unit)+' · Точка '+waypointNumber(routes,r,seg.id),()=>{selected=new Set([seg.id]);selectionChanged();setMode('route');});const w=scene.waypoints.get(key);w.el.style.borderColor=color;w.el.style.color=color;const time=document.createElement('small');time.className='waypoint-time';time.textContent=waypointTiming(r,seg);w.el.append(time);w.el.title='Перетащить — изменить положение; ПКМ — удалить';}refreshRoutes();}
function remountRoutes(){for(const key of [...scene.waypoints.keys()])if(/^route(group)?:/.test(key)){scene.removeWaypoint(key);scene.overlay(key,null);}for(const r of routes)mountRoute(r);routeRows();}
function routeRows(){const root=$('routes');root.replaceChildren();for(const r of routes)for(const seg of r.segments){if(!routeVisible(seg,selected))continue;const row=document.createElement('div');row.className='smallrow';const unit=scene.units.find(u=>u.id===seg.id);row.style.color=sideColor(unit?.side);row.textContent=unitTitle(unit)+' · Точка '+waypointNumber(routes,r,seg.id)+': '+waypointTiming(r,seg);root.append(row);}}
function format(t){const s=Math.round(t);return Number.isFinite(s)?`${Math.floor(s/60)} мин ${s%60} с`:'непроходимо';}
function clearManualGoal(){scene?.overlay('manual-goal',null);scene?.removeWaypoint('manual-goal');}
function drawManual(){if(draft)scene.line('manual',[draft.center,...draft.manual],0xffd977);}
async function manualPoint(p){if(!draft||!p)return;const next=appendManualPoint(draft.manual,p,draft.target);draft.manual=next.points;drawManual();if(next.complete)await acceptRoute('manual');}
function clearDraft(){clearManualGoal();menu.hidden=true;if(draft?.manualId)scene.overlay(draft.manualId,null);draft=null;$('routeOptions').hidden=true;$('acceptManual').hidden=true;$('routeNext').hidden=true;setMode('select');}
async function startRoute(target){const us=movers();if(!us.length)throw Error('Сначала выберите бойцов или технику');const center=us.reduce((a,u)=>a.map((v,i)=>v+u.point[i]/us.length),[0,0,0]);draft={units:us.map(u=>u.id),from:us.map(u=>[...u.point]),target,center,manual:[],manualId:'manual'};contextActions.replaceChildren();placeMenu(target);$('routeOptions').hidden=false;const air=us.every(u=>u.mobility==='air');$('roadRoute').hidden=air;$('manualRoute').hidden=air;$('freeRoute').textContent=air?'Прямой воздушный маршрут':'Самый быстрый без предпочтения дорог';$('routeState').textContent='Выберите способ построения участка.';}
async function acceptRoute(kind){if(!draft)throw Error('Сначала укажите следующую точку');const us=draft.units.map(id=>scene.units.find(u=>u.id===id));const points=[...draft.from,draft.target,...draft.manual];const padding=600;
  let grid;if(kind!=='none'&&us.some(u=>u.mobility!=='air')){grid=await makeGrid(scene,[Math.min(...points.map(p=>p[0]))-padding,Math.min(...points.map(p=>p[1]))-padding,Math.max(...points.map(p=>p[0]))+padding,Math.max(...points.map(p=>p[1]))+padding]);if(grid.missing)throw Error(`Недостаточно данных о препятствиях (${grid.missing}). Маршрут не подтверждён.`);await calculate('grid',{grid});}
  const segments=[];let seconds=0;
  for(let i=0;i<us.length;i++){const u=us[i],dx=u.point[0]-draft.center[0],dy=u.point[1]-draft.center[1],end=[draft.target[0]+dx,draft.target[1]+dy,scene.height(draft.target[0]+dx,draft.target[1]+dy)];let result;
    if(u.mobility==='air'){result=airRoute(draft.from[i],end,(x,y)=>scene.height(x,y),groupProfiles([u],scene.units));if(kind==='none')result={...result,points:[result.points.at(-1)],seconds:null};}
    else if(kind==='none')result={points:[end],seconds:null};
    else if(kind==='manual'){
      const coarse=[draft.from[i],...draft.manual.map(p=>[p[0]+dx,p[1]+dy,p[2]]),end];
      // A nearby blocked grid node must not reject a free, explicitly drawn path.
      const path=sampleManualPath(coarse,{step:grid.step,height:(x,y)=>scene.height(x,y),clear:(a,b)=>segmentClear(grid,a,b),inside:p=>cell(grid,p)>=0});result={points:path,seconds:travelTime(path,groupProfiles([u],scene.units),(a,b)=>grid.roads[cell(grid,a)]&&grid.roads[cell(grid,b)])};
    }else result=await calculate('route',{from:draft.from[i],to:end,profiles:groupProfiles([u],scene.units),mode:kind});
    if(result.seconds!=null&&!Number.isFinite(result.seconds))throw Error('Маршрут слишком крутой для выбранного типа движения');
    segments.push({id:u.id,from:[...draft.from[i]],mode:kind,members:scene.units.filter(r=>r.carrier===u.id).map(r=>r.id),...result});seconds=Math.max(seconds,result.seconds||0);
  }
  // Commit only after every participant has a usable path.
  const id=++serial;for(const segment of segments){const u=scene.units.find(u=>u.id===segment.id);u.point=[...segment.points.at(-1)];u.angles=[0,routeHeading(segment,u.angles?.[1]||0),0];scene.updateActor(u);for(const rider of scene.units.filter(r=>r.carrier===u.id)){rider.point=[...u.point];scene.updateActor(rider);}}
  const route={id,name:'Точка '+id,units:us.map(u=>u.id),segments,seconds:kind==='none'?null:seconds};routes.push(route);mountRoute(route);scene.overlay('manual',null);clearManualGoal();routeRows();$('routeOptions').hidden=true;$('acceptManual').hidden=true;contextActions.replaceChildren();placeMenu(segments[0].points.at(-1));$('routeNext').hidden=false;$('routeState').textContent='Участок принят. Будет следующая точка?';draft=null;setMode('select');status('Каждый выбранный юнит получил свою точку. Выберите часть группы, чтобы продолжить отдельной ветвью.');
}
const ruler=new RulerGesture();
async function clickPoint(p){if(!p)return;if(mode==='route')return startRoute(p);if(mode==='manual')return manualPoint(p);
  if(mode==='eye'){scene.eye(p,1.7);return;}
  if(mode==='ruler'){const [a,b]=ruler.click(p);scene.ruler(a,b);if(b)status(`По горизонтали: ${distance(a,b).toFixed(1)} м · по прямой в 3D: ${Math.hypot(distance(a,b),b[2]-a[2]).toFixed(1)} м. Следующий щелчок начинает новое измерение.`);return;}
}
const observationTitle=o=>'Обзор '+o.id+' · '+(o.eye===2.3?'техника · 2,3 м':'пехота · 1,7 м');
function markObservation(o){const title=observationTitle(o);scene.waypoint('view:'+o.id,observerPoint(o.point,o.eye,(x,y)=>scene.surfaceHeight(x,y)),title,()=>scene.eye(o.point,o.eye));const waypoint=scene.waypoints.get('view:'+o.id);waypoint.observerHeight=o.eye;waypoint.surfacePoint=[...o.point];const el=waypoint.el;el.classList.add('observation-marker');el.style.borderColor=o.palette[0];el.style.color=o.palette[0];el.innerHTML=observationIcon(o.eye);const caption=document.createElement('span');caption.textContent='№ '+o.id+' · '+(o.eye===2.3?'2,3':'1,7')+' м';el.append(caption);el.setAttribute('aria-label',title);el.title=title+' · перетащить — переместить; ПКМ — удалить';el.classList.toggle('inactive',!o.enabled);}
async function addObservation(p,eye){
 const o={id:++serial,point:p,eye:viewHeight(eye),radius:mission.wmtSettings?.viewDistance||3000,enabled:true,token:{cancelled:false},palette:viewPalette(serial)};
 status('Проверяю объёмную видимость по загруженной сцене…');const r=await scene.visibility(p,o.eye,o.radius,o.token);if(!r)return;
 for(const old of observations.filter(v=>v.enabled).slice(0,Math.max(0,observations.filter(v=>v.enabled).length-3))){old.enabled=false;scene.viewshed.toggle(old.id,false);markObservation(old);}
 observations.push(o);scene.viewshed.set(o.id,r,o.palette);markObservation(o);observationRows();status('Проекция обзора нанесена на рельеф: '+(o.eye===2.3?'2,3':'1,7')+' м над поверхностью. Закрашена только видимая земля; закрытые и незагруженные области без заливки.');
}
async function toggleObservation(o){if(!o.enabled){const result=await scene.visibility(o.point,o.eye,o.radius,o.token);if(!result)return;const active=observations.filter(v=>v.enabled&&v!==o);for(const old of active.slice(0,Math.max(0,active.length-3))){old.enabled=false;scene.viewshed.remove(old.id);markObservation(old);}scene.viewshed.set(o.id,result,o.palette);o.enabled=true;}else{o.enabled=false;scene.viewshed.remove(o.id);}markObservation(o);observationRows();}
function observationRows(){scene.sightAreas=observations.filter(o=>o.enabled).map(o=>({point:o.point,radius:o.radius}));const root=$('observations');root.replaceChildren();for(const o of observations){const row=document.createElement('div');row.className='smallrow';row.style.borderLeft='4px solid '+o.palette[0];row.textContent=observationTitle(o)+' · '+o.radius+' м ';
 const toggle=document.createElement('button');toggle.textContent=o.enabled?'Скрыть':'Показать';toggle.onclick=()=>task(()=>toggleObservation(o));
 const eye=document.createElement('button');eye.textContent='С позиции';eye.onclick=()=>scene.eye(o.point,o.eye);const del=document.createElement('button');del.textContent='Удалить';del.onclick=()=>removeObservation(o);row.append(toggle,eye,del);root.append(row);}}

function removeObservation(o){o.token.cancelled=true;scene.viewshed.remove(o.id);scene.removeWaypoint('view:'+o.id);observations.splice(observations.indexOf(o),1);observationRows();menu.hidden=true;}
function actionMenu(p,actions,title='',anchor=null){contextActions.replaceChildren();$('routeOptions').hidden=true;$('routeNext').hidden=true;if(title){const h=document.createElement('b');h.textContent=title;contextActions.append(h);}for(const [label,fn]of actions){const b=document.createElement('button');b.textContent=label;b.onclick=()=>task(async()=>{menu.hidden=true;await fn();});contextActions.append(b);}placeMenu(p,anchor);}
let previewTimer=null,previewRequest=null,previewGeneration=0,previewBusy=false;
function previewObservation(key,p){if(!key.startsWith('view:'))return;scene.draggingSight=true;previewRequest={key,p:[...p]};if(previewTimer||previewBusy)return;previewTimer=requestAnimationFrame(async()=>{previewTimer=null;const request=previewRequest,generation=previewGeneration,o=observations.find(o=>'view:'+o.id===request.key);if(!o?.enabled)return;previewBusy=true;try{const result=await scene.visibility(request.p,o.eye,o.radius,{get cancelled(){return generation!==previewGeneration||request!==previewRequest;}},true);if(generation!==previewGeneration||request!==previewRequest){result?.target.dispose();result?.nearTarget?.dispose();return;}if(result)scene.viewshed.set(o.id,result,o.palette);}catch(e){console.warn(e);}finally{previewBusy=false;if(generation===previewGeneration&&previewRequest&&request!==previewRequest)previewObservation(previewRequest.key,previewRequest.p);}});}
function endPreview(restore){scene.draggingSight=false;previewGeneration++;cancelAnimationFrame(previewTimer);previewTimer=null;const request=previewRequest;previewRequest=null;if(restore&&request){const o=observations.find(o=>'view:'+o.id===request.key);if(o)task(()=>moveMarker(request.key,o.point));}}
function markerContext(key){const w=scene.waypoints.get(key);if(!w)return;if(key.startsWith('plan-marker:')){const m=planMarkers.find(m=>'plan-marker:'+m.id===key);if(m)actionMenu(w.p,[['Изменить метку',()=>changePlanMarker(m)],['Удалить метку',()=>moveMarker(key,null)]]);return;}if(key.startsWith('view:')){const o=observations.find(o=>'view:'+o.id===key);if(o)actionMenu(w.p,[['Смотреть из этой точки',()=>scene.eye(o.point,o.eye)],[o.enabled?'Скрыть обзор':'Показать обзор',()=>toggleObservation(o)],['Пересчитать обзор',()=>moveMarker(key,o.point)],['Удалить обзор',()=>removeObservation(o)]],observationTitle(o));}else actionMenu(w.p,[['Удалить вейпоинт',()=>moveMarker(key,null)]],'Вейпоинт');}
async function moveMarker(key,p){
 if(key.startsWith('plan-marker:')){const m=planMarkers.find(m=>'plan-marker:'+m.id===key);if(!m)return;if(!p)planMarkers=planMarkers.filter(x=>x!==m);else{const dx=p[0]-m.x,dy=p[1]-m.y;m.polyCoords=(m.polyCoords||[]).map((v,i)=>v+(i%2?dy:dx));m.x=p[0];m.y=p[1];}sendPlanMarkers();return;}
 if(key.startsWith('view:')){const o=observations.find(o=>'view:'+o.id===key);if(!o)return;status('Пересчитываю обзор с новой позиции…');const result=await scene.visibility(p,o.eye,o.radius,o.token);if(!result)return;o.point=[...p];scene.viewshed.set(o.id,result,o.palette);scene.viewshed.toggle(o.id,o.enabled);markObservation(o);observationRows();status('Обзор обновлён. Цветом отмечена только видимая поверхность.');return;}
 const [kind,rid,uid]=key.split(':'),r=routes.find(r=>String(r.id)===rid);if(!r)return;
 const ids=kind==='routegroup'?[...(scene.waypoints.get(key)?.members||[])]:[scene.units.find(u=>String(u.id)===uid)?.id],segments=r.segments.filter(s=>ids.includes(s.id));if(!segments.length)return;
 const center=segments.reduce((a,s)=>a.map((v,i)=>v+s.points.at(-1)[i]/segments.length),[0,0,0]),ends=routes.flatMap(r=>r.segments.filter(s=>ids.includes(s.id)).flatMap(s=>[s.from||s.points[0],s.points.at(-1)]));if(p)ends.push(p);const pad=600;
 status('Перестраиваю соседние участки маршрута…');let grid=null,nextRoutes=routes,positions=[];
 const rebuild=async(a,b,mode,original)=>{const u=scene.units.find(u=>u.id===original.id);if(u.mobility==='air')return airRoute(a,b,(x,y)=>scene.height(x,y),groupProfiles([u],scene.units));if(!grid){grid=await makeGrid(scene,[Math.min(...ends.map(p=>p[0]))-pad,Math.min(...ends.map(p=>p[1]))-pad,Math.max(...ends.map(p=>p[0]))+pad,Math.max(...ends.map(p=>p[1]))+pad]);if(grid.missing)throw Error('Не все препятствия загружены. Исходный маршрут сохранён.');await calculate('grid',{grid});}return calculate('route',{from:a,to:b,mode,profiles:[scene.units.find(u=>u.id===original.id).speedProfile]});};
 for(const seg of segments){const u=scene.units.find(u=>u.id===seg.id),old=seg.points.at(-1),target=p?[p[0]+old[0]-center[0],p[1]+old[1]-center[1],p[2]]:null;if(target)target[2]=scene.height(target[0],target[1]);const result=await editWaypoint(nextRoutes,r.id,u.id,{point:target,initial:u.start,rebuild});nextRoutes=result.routes;positions.push([u,result.position]);}
 routes.splice(0,routes.length,...nextRoutes);for(const [u,position]of positions)if(u.carrier==null){u.point=position;const last=routes.flatMap(r=>r.segments.filter(s=>s.id===u.id)).at(-1);if(last)u.angles=[0,routeHeading(last,u.angles?.[1]||0),0];scene.updateActor(u);for(const rider of carriedBy(u,scene.units)){rider.point=[...u.point];scene.updateActor(rider);}}
 clearDraft();remountRoutes();status(p?'Вейпоинт перемещён, маршрут и время пересчитаны.':'Вейпоинт удалён, оставшиеся точки соединены заново.');
}

async function unload(vehicle,items){
 if(!items.length)return;vehicle.mesh.geometry.computeBoundingBox();const b=vehicle.mesh.geometry.boundingBox,radius=Math.hypot(b.max.x-b.min.x,b.max.z-b.min.z)/2+1.5;
 const [x,y]=vehicle.point,g=await makeGrid(scene,[x-60,y-60,x+60,y+60],2);if(g.missing)throw Error('Не все препятствия загружены для безопасной высадки');
 const placements=unloadPositions(vehicle,items,scene.units,{radius,height:(x,y)=>scene.height(x,y),clear:(p,gap)=>{const k=cell(g,p);return k>=0&&!g.blocked[k]&&segmentClear(g,p,p)&&[[gap,0],[-gap,0],[0,gap],[0,-gap]].every(([dx,dy])=>segmentClear(g,p,[p[0]+dx,p[1]+dy]));}});
 for(const placement of placements){const u=scene.units.find(u=>u.id===placement.id);u.carrier=null;u.point=placement.point;scene.updateActor(u);}updateSide();selectionChanged();status('Высажено / выгружено: '+placements.length+'.');
}
function passengerMenu(vehicle){const onboard=carriedBy(vehicle,scene.units);if(!onboard.length)return;const people=onboard.filter(u=>u.mobility==='foot'),cargo=onboard.filter(u=>u.mobility!=='foot'),actions=[];
 if(people.length)actions.push(['Высадить всех ('+people.length+')',()=>unload(vehicle,people)]);
 for(const u of people)actions.push(['Высадить: '+unitTitle(u)+' · '+(u.groupLabel||'#'+u.id),()=>unload(vehicle,[u])]);
 if(cargo.length)actions.push(['Выгрузить все станки ('+cargo.length+')',()=>unload(vehicle,cargo)]);
 for(const u of cargo)actions.push(['Выгрузить: '+unitTitle(u),()=>unload(vehicle,[u])]);
 actionMenu(vehicle.point,actions,vehicleName(vehicle,scene.lang),()=>vehicle.point);
}

function historyDraw(){for(let i=0;i<histories.length;i++){const h=histories[i],seconds=+$('historyTime').value*60,positions=h.units.map(u=>recordedPosition(u,seconds/h.delay,(x,y)=>scene.height(x,y))).filter(Boolean);scene.dots('history:'+i,$('historyPositions').checked?positions.map(p=>[p.point[0],p.point[1],p.point[2]+2]):[],positions.map(p=>p.state===0?0x888888:0xb6c8ff),9);for(const [kind,input,color]of [['hit','historyCombat',0xffa755],['killed','historyLosses',0xff5555]]){const cells=$(''+input).checked?heatmap(h,kind,seconds,(x,y)=>scene.height(x,y)):[];const max=Math.max(1,...cells.map(c=>c.count));scene.dots(kind+':'+i,cells.map(c=>c.point),cells.map(c=>new T.Color(color).multiplyScalar(.4+.6*c.count/max)),24);}}}
let assignments={},planMarkers=[],markerCatalog=[],colorCatalog=[];
function sendPlanMarkers(){refreshPlanMarkers();parent.postMessage({type:'planning-markers-edited',markers:planMarkers},location.origin);}
async function changePlanMarker(m){const next=await editPlanMarker(m,markerCatalog,colorCatalog);if(!next)return;const i=planMarkers.findIndex(m=>m.id===next.id);if(i<0)planMarkers.push(next);else planMarkers[i]=next;sendPlanMarkers();}
function refreshPlanMarkers(){if(scene?.ready)scene.planMarkers(planMarkers,markerCatalog,(p,m)=>m.id.startsWith('mission:')?contextMenu(p):changePlanMarker(m));}
async function boot(data){if(scene)return;mission=data;scene=new PlanningScene($('view'),status);worker=new Worker('/planner/worker.mjs',{type:'module'});worker.onmessage=({data:m})=>{const p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.error?p.reject(Error(m.error)):p.resolve(m.result??m.ok);};worker.onerror=e=>{for(const p of pending.values())p.reject(Error(e.message));pending.clear();};
  await scene.load(data);if(new URLSearchParams(location.search).has('visibilityAudit'))import('/visibility-eye-audit.mjs').then(m=>m.installAudit(scene,observations,addObservation)).catch(console.warn);scene.onFrame=updateMenuAnchor;scene.refreshVisibility=()=>{if(busy)return;task(async()=>{const signature=scene.sightSignature;try{for(const o of observations.filter(o=>o.enabled)){const r=await scene.visibility(o.point,o.eye,o.radius,{...o.token,snapshotOnly:true});if(r)scene.viewshed.set(o.id,r,o.palette);}scene.viewshed.suspend(false);scene.visibilityRefreshPending=signature!==scene.sightSignature;}catch(e){scene.visibilityRefreshPending=false;throw e;}});};scene.setAssignments(assignments);refreshPlanMarkers();scene.onSelect=ids=>{selected=selectIds(selected,ids);selectionChanged();};scene.onRosterSide=value=>{$('side').value=value;updateSide();};scene.onRosterSelect=ids=>{if(busy)return;selected=new Set(ids);selectionChanged();};$('viewDistance').textContent=(data.wmtSettings?.viewDistance||3000)+' м (из миссии)';
  const sides=[...new Set(scene.units.map(u=>normalizedSide(u.side)).filter(Boolean))];for(const side of sides)for(const id of ['side','enemySide']){const option=document.createElement('option');option.value=side;option.textContent=side;$(id).append(option);}
  const canvas=scene.renderer.domElement,view=$('view');let down=null,rightDown=null;scene.cancelMarkerDrag=markerGestures(view,scene,{blocked:()=>busy,context:markerContext,preview:previewObservation,endPreview,move:(key,p,original)=>task(async()=>{try{await moveMarker(key,p);}catch(e){const w=scene.waypoints.get(key);if(w)w.p=original;throw e;}})});
  const at=e=>{const target=e.type==='pointerdown'?e.target:(document.elementFromPoint(e.clientX,e.clientY)||e.target),ids=labelSelection(target,scene.units),hit=scene.pick(e);if(ids.length){const label=target.closest('[data-unitid],[data-leader-id]'),primary=label?.dataset.unitid||label?.dataset.leaderId;hit.unit=scene.units.find(u=>String(u.id)===primary)||scene.units.find(u=>u.id===ids[0]);hit.point=hit.unit.point;}return {...hit,ids:ids.length?ids:hit.unit?[hit.unit.id]:[]};};
  const ghost=document.createElement('div');ghost.id='boardingGhost';ghost.hidden=true;view.append(ghost);
  const clearPointer=()=>{scene.boardingPreview([],null);ghost.hidden=true;down=null;rightDown=null;scene.previewSelectedIds=null;scene.labelsDirty=true;$('selection').style.display='none';view.classList.remove('boarding-drag');for(const el of view.querySelectorAll('.drop-target'))el.classList.remove('drop-target');};
  view.addEventListener('contextmenu',e=>e.preventDefault());
  view.addEventListener('pointerdown',e=>{
    if(busy||e.target.closest('#sceneMenu,.waypoint-label,#plannerRoster,#eyeControls,#sceneTools'))return;
    if(e.button===2){rightDown={x:e.clientX,y:e.clientY,hit:at(e)};return;}
    if(e.button!==0)return;menu.hidden=true;const hit=at(e);down={x:e.clientX,y:e.clientY,hit,shift:e.shiftKey,pointer:e.pointerId};
    canvas.setPointerCapture(e.pointerId);
  });
  view.addEventListener('pointermove',e=>{
    if(!e.target.closest('#sceneMenu,#sceneTools,.waypoint-label,#plannerRoster,#eyeControls'))scene.cursor(scene.pick(e).point);else scene.cursor(null);
    if(mode==='ruler'&&!busy&&!e.target.closest('#sceneMenu,#sceneTools')){const p=scene.pick(e).point;if(p)scene.ruler(...ruler.move(p));}
    if(!down||mode!=='select')return;
    if(down.hit.ids.length&&!down.shift){
      if(Math.hypot(down.x-e.clientX,down.y-e.clientY)<=7)return;
      view.classList.add('boarding-drag');const hit=at(e),ids=down.hit.ids.every(id=>selected.has(id))?[...selected]:down.hit.ids,riders=scene.units.filter(u=>ids.includes(u.id)&&loadable(u));const rect=view.getBoundingClientRect();ghost.hidden=!riders.length;ghost.textContent='♟ '+riders.length+' · '+riders.slice(0,6).map(u=>shortRole(u.roleDescription,scene.lang)).join(', ')+(riders.length>6?'…':'');ghost.style.left=e.clientX-rect.left+16+'px';ghost.style.top=e.clientY-rect.top+16+'px';scene.boardingPreview(riders,hit.point);
      for(const el of view.querySelectorAll('.drop-target'))el.classList.remove('drop-target');
      if(hit.unit?.mobility!=='foot'&&(hit.unit?.capacity>0||hit.unit?.cargoSpace>0))hit.unit?.labelNode?.classList.add('drop-target');
      return;
    }
    const r=canvas.getBoundingClientRect(),box=$('selection');box.style.display='block';box.style.left=Math.min(down.x,e.clientX)-r.left+'px';box.style.top=Math.min(down.y,e.clientY)-r.top+'px';box.style.width=Math.abs(down.x-e.clientX)+'px';box.style.height=Math.abs(down.y-e.clientY)+'px';scene.previewSelectedIds=scene.units.filter(u=>{if(!u.mesh.visible||!gameplayObject(u))return false;const v=u.mesh.position.clone().project(scene.camera),x=(v.x*.5+.5)*r.width+r.left,y=(-v.y*.5+.5)*r.height+r.top;return v.z>=-1&&v.z<=1&&x>=Math.min(down.x,e.clientX)&&x<=Math.max(down.x,e.clientX)&&y>=Math.min(down.y,e.clientY)&&y<=Math.max(down.y,e.clientY);}).map(u=>u.id);if(down.shift)scene.previewSelectedIds.push(...selected);scene.labelsDirty=true;
  });
  view.addEventListener('pointerup',e=>{
    if(e.button===2&&rightDown){const d=rightDown;rightDown=null;if(Math.hypot(e.clientX-d.x,e.clientY-d.y)<5&&!busy){if(mode==='manual'&&draft){draft.manual=undoManualPoint(draft.manual);drawManual();}else if(d.hit.point)contextMenu(d.hit.point,d.hit.ids);}return;}
    if(!down||e.button!==0)return;const d=down,hit=at(e),drag=Math.hypot(d.x-e.clientX,d.y-e.clientY)>7;clearPointer();
    task(async()=>{
      if(mode!=='select'){await clickPoint(hit.point);return;}
      if(drag&&d.hit.ids.length&&!d.shift&&hit.unit?.mobility!=='foot'&&(hit.unit?.capacity>0||hit.unit?.cargoSpace>0)){
        if(!hit.unit||d.hit.ids.includes(hit.unit.id))return;
        if(!d.hit.ids.every(id=>selected.has(id)))selected=new Set(d.hit.ids);
        const riders=scene.units.filter(u=>selected.has(u.id)&&loadable(u));
        if(!riders.length)throw Error('На машину можно перетаскивать пехоту и статическое вооружение.');
        loadUnits(riders,hit.unit,scene.units);for(const u of scene.units)scene.updateActor(u);updateSide();
        status('Погружено: '+riders.length+'. Нажмите на машину, чтобы высадить людей или выгрузить станки.');
      }else if(drag){
        if(!d.shift)selected.clear();const r=canvas.getBoundingClientRect();
        for(const u of scene.units){if(!u.mesh.visible||!gameplayObject(u))continue;const v=u.mesh.position.clone().project(scene.camera),x=(v.x*.5+.5)*r.width+r.left,y=(-v.y*.5+.5)*r.height+r.top;if(v.z>=-1&&v.z<=1&&x>=Math.min(d.x,e.clientX)&&x<=Math.max(d.x,e.clientX)&&y>=Math.min(d.y,e.clientY)&&y<=Math.max(d.y,e.clientY))selected.add(u.id);}
      }else {selected=selectIds(selected,d.hit.ids,d.shift);if(!d.shift&&d.hit.unit&&carriedBy(d.hit.unit,scene.units).length)passengerMenu(d.hit.unit);}
      selectionChanged();routeRows();
    });
  });
  view.addEventListener('pointercancel',clearPointer);
  // Pointer selection owns clicks; avoid the replay label's detail callback
  // resetting multi-selection after a drag or Shift-click. Keyboard stays usable.
  view.addEventListener('click',e=>{if(e.detail&&e.target.closest('#labels button')){e.preventDefault();e.stopPropagation();}},true);
  view.addEventListener('dblclick',e=>{if(mode!=='select'||e.target.closest('#sceneMenu,#sceneTools,.waypoint-label,#plannerRoster,#eyeControls'))return;const u=at(e).unit;if(u?.groupId!=null){selected=new Set(scene.units.filter(v=>v.groupId===u.groupId&&v.side===u.side).map(v=>v.id));selectionChanged();}});
  setMode('select');parent.postMessage({type:'planning-ready'},location.origin);queueSnapshot();setTimeout(drainCommands,0);
}
window.addEventListener('message',e=>{if(e.origin!==location.origin||e.source!==parent)return;if(e.data?.type==='planning-mission'){assignments=e.data.assignments||{};planMarkers=e.data.markers||[];markerCatalog=e.data.markerCatalog||[];colorCatalog=e.data.colorCatalog||[];task(()=>boot(e.data.mission));}else if(e.data?.type==='planning-assignments'){assignments=e.data.assignments||{};scene?.setAssignments(assignments);queueSnapshot();}else if(e.data?.type==='planning-markers'){planMarkers=e.data.markers||[];markerCatalog=e.data.markerCatalog||[];colorCatalog=e.data.colorCatalog||[];refreshPlanMarkers();}else if(e.data?.type==='planning-command'){commands.push(e.data.command);drainCommands();}});
for(const b of document.querySelectorAll('[data-mode]'))b.onclick=()=>{if(!scene?.ready||busy)return;setMode(b.dataset.mode);};
$('side').onchange=()=>updateSide();$('roadRoute').onclick=()=>task(()=>acceptRoute('road'));$('freeRoute').onclick=()=>task(()=>acceptRoute('free'));$('noRoute').onclick=()=>task(()=>acceptRoute('none'));
$('manualRoute').onclick=()=>{if(!draft)return;menu.hidden=true;setMode('manual');$('routeOptions').hidden=true;$('acceptManual').hidden=true;
 const p=draft.target,circle=Array.from({length:73},(_,i)=>{const a=i*Math.PI/36,x=p[0]+Math.cos(a)*manualGoalRadius,y=p[1]+Math.sin(a)*manualGoalRadius;return [x,y,scene.height(x,y)];});scene.line('manual-goal',circle,0xffdd6b);
 scene.waypoint('manual-goal',p,'Цель маршрута · 5 м',()=>scene.focus(p,45));const w=scene.waypoints.get('manual-goal');w.alwaysVisible=true;w.el.title='Перейти камерой к конечной точке';drawManual();};$('acceptManual').onclick=()=>task(()=>acceptRoute('manual'));
$('nextPoint').onclick=()=>{menu.hidden=true;setMode('route');$('routeNext').hidden=true;};$('finishRoute').onclick=()=>{clearDraft();$('routeState').textContent='Маршрут закончен. Можно выбрать другое отделение.';};$('cancelRoute').onclick=clearDraft;
$('leaveEye').onclick=()=>scene?.leaveEye();
async function disembarkSelected(){const carrierIds=new Set(scene.units.filter(u=>selected.has(u.id)).map(u=>u.carrier??u.id));for(const id of carrierIds){const vehicle=scene.units.find(u=>u.id===id);if(!vehicle)continue;const all=carriedBy(vehicle,scene.units),items=selected.has(id)?all:all.filter(u=>selected.has(u.id));await unload(vehicle,items);}}
$('disembark').onclick=()=>task(disembarkSelected);
$('enemyReach').onclick=()=>task(async()=>{
 const seconds=+$('enemyMinutes').value*60;if(!(seconds>0&&seconds<=7200))throw Error('Укажите от 1 до 120 минут');
 const us=scene.units.filter(u=>u.side===$('enemySide').value&&gameplayObject(u)&&u.carrier==null&&Math.max(u.speedProfile.road,u.speedProfile.offroad)>0).sort((a,b)=>Math.max(b.speedProfile.road,b.speedProfile.offroad)-Math.max(a.speedProfile.road,a.speedProfile.offroad)||a.id-b.id).slice(0,3);
 if(!us.length)throw Error('У этой стороны нет подвижных юнитов');clearReach();status('Подготавливаю рельеф, дороги и препятствия для расчёта достижимости…');const size=scene.terrain.worldSize,g=await makeGrid(scene,[0,0,size,size]);if(g.missing)throw Error('Недостаточно данных о препятствиях ('+g.missing+'). Повторите расчёт после загрузки ресурсов.');await calculate('grid',{grid:g});
 for(const [index,u]of us.entries()){status('Достижимость: '+(index+1)+' / '+us.length);const times=await calculate('reach',{starts:[{point:u.start,profile:u.speedProfile}],seconds}),points=farthestPoints(g,times,u.start),color=viewPalettes[index][0];
  for(const [i,r]of points.entries()){const key='reach:'+u.id+':'+i;scene.waypoint(key,r.point,unitTitle(u)+' · '+(r.distance/1000).toFixed(1)+' км',()=>scene.focus(r.point,90));scene.waypoints.get(key).el.style.borderColor=color;scene.waypoints.get(key).el.style.color=color;}}
 status('Показаны до 5 дальних позиций для каждого из '+us.length+' самых быстрых юнитов. Это оценка по сетке '+g.step+' м, с учётом рельефа, дорог, зданий, стен и камней. Без пробок; узкие проходы меньше шага сетки могут быть недоступны.');
});
function clearReach(){for(const id of [...scene.waypoints.keys()])if(id.startsWith('reach:'))scene.removeWaypoint(id);}
$('clearReach').onclick=clearReach;
$('reloadReplays').onclick=()=>task(async()=>{status('Получаю список записей WOG Replay…');const r=await fetch('/api/planning/replays?world='+encodeURIComponent(scene.world));if(!r.ok)throw Error('Не удалось обновить каталог: '+(await r.text()).slice(0,180));const d=await r.json();$('replayChoice').replaceChildren();for(const m of d.missions){const o=document.createElement('option');o.value=m.id;o.textContent=`${m.date||''} · ${m.title||m.mission||m.id}`;$('replayChoice').append(o);}status(`На этой карте найдено записей: ${d.missions.length}`);});
$('addReplay').onclick=()=>task(async()=>{const id=$('replayChoice').value;if(!id)throw Error('Выберите запись');status('Загружаю исторические позиции и события…');const r=await fetch('/api/planning/replays/'+encodeURIComponent(id));if(!r.ok)throw Error('Запись пока недоступна: '+await r.text());const d=await r.json(),h=loadPreparedHistory(d,scene.world);histories.push(h);const row=document.createElement('div');row.textContent=h.name;$('histories').append(row);historyDraw();status('Историческая запись загружена');});
for(const id of ['historyTime','historyPositions','historyCombat','historyLosses'])$(id).onchange=historyDraw;
function identity(){return JSON.stringify([mission.worldName,mission.name,scene.units.map(u=>[u.id,u.start])]);}
$('save').onclick=()=>{if(!scene?.ready)return;const content={format:'wog-planning-1',mission:identity(),planMarkers,units:scene.units.map(({id,point,carrier,mobility,speedProfile,angles})=>({id,point,carrier,mobility,speedProfile,angles})),routes,observations:observations.map(({id,point,eye,radius,enabled,palette})=>({id,point,eye,radius,enabled,palette}))};const url=URL.createObjectURL(new Blob([JSON.stringify(content)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='3d-plan.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('restore').onchange=e=>task(async()=>{const f=e.target.files[0];if(!f)return;if(f.size>10*1024*1024)throw Error('План слишком большой');const d=JSON.parse(await f.text());if(d.format!=='wog-planning-1'||d.mission!==identity())throw Error('План относится к другой миссии или версии');const valid=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite)&&p[0]>=0&&p[1]>=0&&p[0]<=scene.terrain.worldSize&&p[1]<=scene.terrain.worldSize;if(!Array.isArray(d.units)||!Array.isArray(d.routes)||d.units.some(u=>!valid(u.point)||!profiles[u.mobility])||d.routes.some(r=>!Array.isArray(r.segments)||r.segments.some(s=>!Array.isArray(s.points)||s.points.some(p=>!valid(p)))))throw Error('Некорректные данные плана');for(const id of [...scene.overlays.keys()])if(/^route(group)?:/.test(id)||id.startsWith('view:'))scene.overlay(id,null);for(const id of [...scene.waypoints.keys()])if(/^route(group)?:/.test(id)||id.startsWith('view:'))scene.removeWaypoint(id);for(const o of observations){o.token.cancelled=true;scene.viewshed.remove(o.id);}for(const saved of d.units){const u=scene.units.find(u=>u.id===saved.id);if(u){Object.assign(u,saved);scene.updateActor(u);}}if(Array.isArray(d.planMarkers)){planMarkers=d.planMarkers;sendPlanMarkers();}routes.splice(0,routes.length,...d.routes);for(const r of routes)mountRoute(r);serial=Math.max(serial,...routes.map(r=>r.id));observations.length=0;routeRows();observationRows();status('План восстановлен. Видимость сохранённых позиций пересчитывается по текущей загруженной сцене.');for(const o of d.observations||[]){if(!valid(o.point))continue;o.eye=viewHeight(o.eye);const r=await scene.visibility(o.point,o.eye,o.radius,{cancelled:false});if(r){o.token={cancelled:false};o.palette=Array.isArray(o.palette)?o.palette:viewPalette(o.id);o.enabled=o.enabled!==false;observations.push(o);serial=Math.max(serial,o.id);scene.viewshed.set(o.id,r,o.palette);scene.viewshed.toggle(o.id,o.enabled);markObservation(o);}}observationRows();});
const tour=[['Карта миссии','Загрузите PBO в обычном планировщике, затем откройте 3D. Карта и модели берутся через локальную утилиту из вашей сборки. Пунктир обозначает отсутствующую модель.'],['Выбор и посадка','Обведите бойцов мышью. Выберите отделение или технику в списке справа; Shift дополняет выбор. Перетащите пехоту или станок на машину. Места пассажиров и грузовая вместимость проверяются отдельно по конфигам. Щелчок по машине открывает высадку всех или по одному.'],['План движения','Скорости и типы берутся из сборки. Нажмите ПКМ на нужной точке карты и выберите дорожный, свободный, ручной вариант или только положение. У выбранной пехоты общая точка. После каждого этапа добавьте следующую либо завершите маршрут. Ручной путь задаётся кликами ЛКМ: ПКМ отменяет последнюю точку, Esc отменяет путь. Попадание в круг 5 м завершает путь. Нумерация начинается заново при разделении или объединении группы. На точке показаны время участка и общее время движения.'],['Обзор и позиция','ПКМ на карте → «Обзор пехоты · 1,7 м» или «Обзор техники · 2,3 м». Цветное покрытие следует рельефу; цветом отмечается только видимая земля, закрытая и неизвестная остаётся без заливки. Нажмите метку обзора, чтобы смотреть из неё с биноклем или прицелом. Через ПКМ скрывайте или включайте закраску. При перетаскивании обзора ЛКМ кольцо показывает новую позицию, заливка пересчитывается с полной детализацией. Объекты ниже 1,4 м не перекрывают обзор. Перетаскивайте также вейпоинты; ПКМ по ним — удаление с перестроением маршрута. «Из глаз» — 1,7 м, «Из техники» — 2,3 м. В этих режимах ПКМ поворачивает взгляд из фиксированной точки; Escape возвращает свободную камеру.'],['Противник и история','Укажите сторону и время движения для расчёта по начальным позициям трёх самых быстрых юнитов. Для каждого показываются пять дальних мест. Выберите на сайте WOG Replay запись этой карты для исторических позиций, HIT и потерь до выбранной минуты.'],['Измерение и сохранение','Включите линейку: первая точка следует за мышью, щелчок закрепляет начало, второй — конец. Расстояние показано прямо на линии. Сохраните план в файл перед выходом. Расчёт не моделирует пробки, разрушения и решения игроков: ETA и обзор следует проверять на месте.']];let tourIndex=0;function showTour(){const [title,text]=tour[tourIndex];$('tourTitle').textContent=title;$('tourText').textContent=text;$('tourNext').textContent=tourIndex===tour.length-1?'Готово':'Далее';}$('help').onclick=()=>{tourIndex=0;showTour();$('tour').showModal();};$('tourNext').onclick=()=>{if(++tourIndex===tour.length)$('tour').close();else showTour();};$('tourClose').onclick=()=>$('tour').close();

$('language').onchange=()=>{scene.lang=$('language').value;document.documentElement.lang=scene.lang;scene.labelsDirty=true;for(const r of routes)mountRoute(r);routeRows();};

// One route calculator owns both maps; 2D sends edits, never a second path model.
let snapshotTimer=null;const commands=[];
function queueSnapshot(){if(snapshotTimer)return;snapshotTimer=setTimeout(()=>{snapshotTimer=null;if(!scene?.ready)return;const lines=routes.flatMap(r=>r.segments.filter(seg=>routeVisible(seg,selected)).map(seg=>({key:'route:'+r.id+':'+seg.id,points:seg.points,color:sideColor(scene.units.find(u=>u.id===seg.id)?.side)}))),waypoints=[...scene.waypoints.entries()].filter(([key,w])=>key.startsWith('route')&&!w.hidden).map(([key,w])=>({key,point:w.p,text:[...w.el.childNodes].map(n=>n.textContent).join(' · '),title:w.el.firstChild?.textContent||'',time:w.el.querySelector('.waypoint-time')?.textContent||'',color:w.el.style.color}));parent.postMessage({type:'planning-snapshot',snapshot:{units:scene.units.filter(gameplayObject).map(u=>({id:u.id,point:u.point,side:u.side,name:unitTitle(u),groupId:u.groupId,groupLabel:u.groupLabel,mobility:u.mobility,carrier:u.carrier})),selected:[...selected],routes:lines,waypoints,status:$('status').textContent}},location.origin);},0);}
function drainCommands(){if(busy||!scene?.ready||!commands.length)return;const c=commands.shift();task(async()=>{
 if(!c||!['select','route','move','delete','focus'].includes(c.action))throw Error('Неизвестное действие плана');
 if(c.ids){selected=new Set(c.ids.filter(id=>scene.units.some(u=>u.id===id&&gameplayObject(u))));selectionChanged();}
 if(c.action==='select')return;if(c.action==='focus'){scene.focusUnits(c.ids||[]);return;}
 if(c.action==='delete'){if(!/^route(group)?:/.test(c.key))throw Error('Неизвестная точка');await moveMarker(c.key,null);return;}
 const p=c.point;if(!Array.isArray(p)||p.length<2||!p.slice(0,2).every(Number.isFinite)||p[0]<0||p[1]<0||p[0]>scene.terrain.worldSize||p[1]>scene.terrain.worldSize)throw Error('Точка вне карты');const point=[p[0],p[1],scene.height(p[0],p[1])];
 if(c.action==='move')await moveMarker(c.key,point);else{if(!['road','free','none'].includes(c.mode))throw Error('Некорректный режим маршрута');await startRoute(point);await acceptRoute(c.mode);clearDraft();}
});}
