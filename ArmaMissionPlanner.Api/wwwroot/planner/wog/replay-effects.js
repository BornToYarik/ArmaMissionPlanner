import {anchorRadius} from './view-presentation.js';
import {vehicleIcon} from './vehicle-icons.js';
import {ShotFlashes} from './shot-flashes.js';
import {labelAttribute,labelStyle,labelField,labelPosition} from './label-updates.js';
import {TracerLines,TracerHeads} from './tracer-lines.js';
import {TRACER_WIDTH} from './tracer-width.js';
import {labelInSquad} from './replay-view.js';
import {t} from './i18n.js';
import {formatHeight} from './units.js';
import {stationaryCaption} from './stationary.js';
import {isolationCaption} from './isolation.js';
import {TextMeasurements,memberName,statusNote} from './label-content.js';
import {CanvasOverlay} from './canvas-overlay.js';
import {trajectoryRise,trajectoryPoint,terrainTrajectoryLimit} from './shot-trajectory.js';
import {shotWindow} from './shot-clock.js';
import * as THREE from 'three';
import {vehicleName,clusterLabels,squadDetail,MEMBER_NAME_DISTANCE,placeMemberLabels,withinFollowRange,easeLabel} from './label-clusters.js';

const svgNS='http://www.w3.org/2000/svg';
function markerIcon(kind,category='',entity=null){
 const picture=kind==='vehicle'?vehicleIcon(entity):null;if(picture){const icon=document.createElement('span');icon.className='garage-icon';icon.style.setProperty('--garage-icon','url('+picture+')');icon.setAttribute('aria-hidden','true');return icon;}
 const svg=document.createElementNS(svgNS,'svg');svg.setAttribute('viewBox','0 0 28 28');svg.classList.add('tactical-icon');
 const shapes=kind==='squad'?'<path d="M14 2 26 14 14 26 2 14Z"/><path d="m7 7 14 14M21 7 7 21"/>':(kind==='infantry'||category==='airborne-object')?'<circle cx="14" cy="14" r="4" class="dot"/>':/heli|plane|air/i.test(category)?'<path d="M14 3v22M3 12l11-4 11 4M9 23l5-3 5 3"/>':/tank|tracked|apc/i.test(category)?'<rect x="3" y="10" width="22" height="13" rx="5"/><path d="M9 10V6h10v4M14 6V1M7 19h14"/>':'<path d="M3 18V9h15l6 5v4Z"/><circle cx="8" cy="20" r="3"/><circle cx="21" cy="20" r="3"/>';
 svg.innerHTML=shapes;return svg;
}
export class ActorLabels {
 constructor(host,onSelect,onCluster){this.host=host;this.nodes=new Map();this.markerLayout=new Map();this.markerMotion=new Map();this.nicknameMotion=new Map();this.lastTime=0;this.textCanvas=document.createElement('canvas').getContext('2d');this.textCanvas.font='600 12px '+getComputedStyle(host).fontFamily;this.textMetrics=new TextMeasurements(text=>this.textCanvas.measureText(text).width);this.nicknameLayout=new Map();this.clusters=new Map();this.onSelect=onSelect;this.onCluster=onCluster;this.lines=document.createElement('canvas');this.lines.classList.add('label-leaders');host.append(this.lines);this.overlay=new CanvasOverlay(this.lines);}
 measureText(text){return this.textMetrics.get(text);}
 add(e){const el=document.createElement('button');labelField(el,'className','actor-label');el.hidden=true;el.onclick=()=>this.onSelect(e.id);this.host.append(el);this.nodes.set(e.id,{el});}
 update({frame=null,viewport=null,labelIds=null,drawn,entities,positions,camera,selected,enabled,sideColor,palette=null,entitySide,distance,grouping,inspectedIds=[],followOrigin=null}){
  const shown=new Set();if(!enabled){this.lastViewKey=null;this.overlay.begin();this.visibleCount=0;this.representedCount=0;for(const n of this.nodes.values())n.el.hidden=true;for(const el of this.clusters.values())el.hidden=true;this.overlay.end();return;}
  const now=performance.now(),dt=this.lastTime?(now-this.lastTime)/1000:1;this.lastTime=now;
  const viewKey=[frame==null?null:Math.floor(frame),...camera.matrixWorld.elements,...camera.projectionMatrix.elements,(viewport?.width??this.host.clientWidth),(viewport?.height??this.host.clientHeight),selected,enabled,grouping,distance,this.hoveredMember,...inspectedIds,followOrigin?.x,followOrigin?.y,followOrigin?.z,labelIds&&[...labelIds].join(',')].join('|');
  const first=drawn.values().next().value,firstPosition=positions.values().next().value;
  if(this.lastViewKey===viewKey&&this.lastDrawn===first&&this.lastPosition===firstPosition&&this.lastDrawnSize===drawn.size){
   if(now-this.viewChangedAt>1000){return;}
  }else{this.lastViewKey=viewKey;this.lastDrawn=first;this.lastPosition=firstPosition;this.lastDrawnSize=drawn.size;this.viewChangedAt=now;}

  this.overlay.begin();this.visibleCount=0;this.representedCount=0;
  const w=viewport?.width??this.host.clientWidth,h=viewport?.height??this.host.clientHeight,candidates=[],crewOwner=new Map();this.overlay.resize(w,h);
  for(const [vehicleId]of drawn){const p=positions.get(vehicleId);if(!Array.isArray(p?.[5]))continue;for(const id of p[5]){const unit=positions.get(id);if(!unit||!unit[5])continue;const gap=Math.hypot(unit[1]-p[1],unit[2]-p[2]);if(!crewOwner.has(id)||gap<crewOwner.get(id).gap)crewOwner.set(id,{vehicleId,gap});}}
  // Parachutists share the canopy label; sling cargo remains a separately selectable vehicle.
  for(const [id,d]of drawn){if(d.carrier!=null&&!d.sling)continue;const e=entities.get(id),p=positions.get(id);if(!labelInSquad(id,p,labelIds))continue;const base=(d.labelAnchor||d.position).clone().project(camera),v=(d.labelAnchor||d.position).clone();v.y+=(d.labelAnchor?d.height*.5:d.height)+.12;v.project(camera);
   const inRange=withinFollowRange(d.position,followOrigin);
   const visible=inRange&&base.z>-1&&base.z<1&&Math.abs(base.x)<=1.04&&Math.abs(base.y)<=1.04;
   const anchor=(d.labelAnchor||d.position).clone();
   const local=anchor.applyMatrix4(camera.matrixWorldInverse),depth=Math.max(camera.near,-local.z);
   let rayX=local.x*camera.projectionMatrix.elements[0]/depth,rayY=local.y*camera.projectionMatrix.elements[5]/depth;
   const limit=Math.max(1,Math.abs(rayX)/8,Math.abs(rayY)/8);rayX/=limit;rayY/=limit;
   const crew=Array.isArray(p[5])?p[5].filter(member=>entities.has(member)&&crewOwner.get(member)?.vehicleId===id):[];
   candidates.push({id,d,e,p,crewCount:crew.filter(id=>positions.get(id)?.[4]!==0).length,stationaryText:d.afk?t('AFK'):d.stationary==null?'':stationaryCaption(d.stationary),isolationText:d.isolation==null?'':isolationCaption(d.isolation),displayName:vehicleName(e,p,entities,frame??p?.[0])+(d.altitude!==null&&d.altitude!==undefined?' · '+formatHeight(d.altitude):''),visible,inRange,members:[e,...crew.map(id=>entities.get(id))],crew,x:(v.x*.5+.5)*w,y:(-.5*v.y+.5)*h-10,anchorX:(rayX*.5+.5)*w,anchorY:(-.5*rayY+.5)*h,wx:d.position.x,wz:d.position.z,distance:camera.position.distanceTo(d.position),side:entitySide(e,p)||'UNKNOWN',squad:e.group,inspected:inspectedIds.includes(id),selected:id===selected||crew.includes(selected)});
  }
  const left=8,right=8,available=Math.max(170,w-left-right);
  for(const c of candidates){c.x-=left;c.labelAnchorX=c.anchorX-left;c.labelAnchorY=c.anchorY;}
  const groups=clusterLabels(candidates,{distance,enabled:grouping,width:available,height:h,memory:this.markerLayout,measureText:text=>this.measureText(text)}),used=new Set(),nicknames=[];
  // Tactical titles stay fixed directly above their world point.
  const occupied=groups.map(g=>({x:g.x+left,y:g.y,w:g.w,h:g.h}));
  for(const g of groups){g.x+=left;const c=g.items[0],multiple=g.kind==='squad',ids=[...new Set(g.items.flatMap(x=>x.members.map(e=>e.id)))];let el;
   const title=multiple||g.kind==='vehicle'?g.title+' · '+g.count:g.title,inspected=multiple&&g.items.some(p=>inspectedIds.includes(p.id));
   if(multiple){used.add(g.key);if(!this.clusters.has(g.key)){el=document.createElement('button');this.host.append(el);this.clusters.set(g.key,el);}el=this.clusters.get(g.key);el.onclick=()=>this.onCluster(ids,title);}
   else el=this.nodes.get(c.id).el;
   const dead=g.items.every(x=>x.p[4]===0),unconscious=g.items.every(x=>x.e.type==='unit'&&x.p[4]===2),tint=palette?.objects?.['entity:'+(g.leaderId??c.id)]?.labels||palette?.labels?.[dead?'dead':unconscious?'wounded':c.side]||(dead?'#000000':unconscious?'#b363ef':'#'+sideColor(c.side).toString(16).padStart(6,'0')),iconTint=palette?.objects?.['entity:'+(g.leaderId??c.id)]?.icons||palette?.icons?.[dead?'dead':unconscious?'wounded':c.side]||tint;
   const caption=g.kind==='infantry'&&!g.close?'':g.displayTitle,signature=[g.kind,c.e.category,c.e.className,caption,g.count].join('|');
   if(el.dataset.signature!==signature){el.replaceChildren(markerIcon(g.kind,c.e.category,c.e));if(caption){const name=document.createElement('strong');name.textContent=caption;el.append(name);}if(multiple||g.kind==='vehicle'){const count=document.createElement('b');count.className='marker-count';count.textContent=g.count;el.append(count);}labelField(el.dataset,'signature',signature);}
   labelField(el,'className','actor-label tactical-marker '+g.kind+(g.close?' near':' far')+(g.selected||inspected?' selected':'')+(inspected?' inspected-squad':'')+(dead?' dead':'')+(unconscious?' unconscious':''));
   labelField(el,'title',title+t(' — click for details'));labelAttribute(el,'aria-label',title+' — '+(multiple?t('squad roster'):g.kind==='vehicle'?t('vehicle and crew'):t('player details')));labelField(el.dataset,'memberIds',ids.join(','));labelField(el.dataset,'leaderId',g.leaderId);labelField(el.dataset,'kind',g.kind);labelField(el.dataset,'state',dead?'dead':unconscious?'unconscious':'active');labelStyle(el,'--side-color',iconTint);labelStyle(el,'--caption-color',tint); labelField(el.style,'width',g.w+'px');labelField(el.style,'height',g.h+'px');labelPosition(el,g.x,g.y);el.hidden=false;shown.add(el);
   const zoomDetail=multiple?squadDetail(Math.min(...g.items.map(p=>p.distance))):'individual',detail=inspected?'rays':zoomDetail,detailed=multiple&&detail==='rays';labelField(el.dataset,'detail',detail);
   if(inspected&&Math.min(...g.items.map(p=>p.distance))<=MEMBER_NAME_DISTANCE)for(const member of g.items){
    if(!member.visible)continue;
    const nick=this.nodes.get(member.id).el;const memberDead=member.p[4]===0,memberTint=palette?.objects?.['entity:'+member.id]?.labels||palette?.labels?.[memberDead?'dead':member.p[4]===2?'wounded':member.side]||(memberDead?'#000000':member.p[4]===2?'#b363ef':'#'+sideColor(member.side).toString(16).padStart(6,'0'));labelField(nick,'className','member-nickname'+(memberDead?' dead':member.p[4]===2?' unconscious':''));memberName(nick,member.displayName);labelField(nick.dataset,'kind','member');delete nick.dataset.memberIds;labelField(nick.dataset,'memberId',member.id);
    labelField(nick,'title',member.displayName);labelAttribute(nick,'aria-label',t('Player: ')+member.displayName);labelStyle(nick,'--side-color',memberTint);labelStyle(nick,'--caption-color',memberTint); labelField(nick.style,'width','auto');labelField(nick.style,'height','auto');nick.onpointerenter=()=>this.hoveredMember=member.id;nick.onpointerleave=()=>this.hoveredMember=null;nick.onfocus=()=>this.hoveredMember=member.id;nick.onblur=()=>this.hoveredMember=null;nicknames.push({id:member.id,el:nick,w:Math.max(60,this.measureText(member.displayName)+18),h:20,anchorX:member.anchorX,anchorY:member.anchorY,tint:memberTint,dead:memberDead});nick.hidden=false;shown.add(nick);
   }
   if(g.kind==='infantry'){const dot=this.overlay.get('unit:'+c.id,'circle');for(const [k,v]of Object.entries({cx:c.anchorX,cy:c.anchorY,r:anchorRadius(c.distance,dead),fill:iconTint,stroke:'#e4e6e1','stroke-width':1.1}))labelAttribute(dot,k,v);labelAttribute(dot,'class','individual-unit-point');labelField(dot.dataset,'memberIds',String(c.id));if(!g.close){g.x=c.anchorX;g.y=c.anchorY;labelPosition(el,g.x,g.y);}}
   if(multiple&&palette?.layers?.points!==false){const leader=g.items.find(p=>p.id===g.leaderId)||c,dot=this.overlay.get('squad-centre:'+g.key,'circle');for(const[k,v]of Object.entries({cx:leader.anchorX,cy:leader.anchorY,r:anchorRadius(leader.distance,dead),fill:iconTint,stroke:'#e4e6e1','stroke-width':1.1}))labelAttribute(dot,k,v);labelAttribute(dot,'class','squad-centre-point');}
   const endpoints=detailed?g.items.filter(p=>p.inRange).map(p=>({x:p.anchorX,y:p.anchorY,ids:[p.id],dead:p.p[4]===0,distance:p.distance})):multiple||g.kind==='infantry'?[]:[{x:g.items.reduce((n,p)=>n+p.anchorX,0)/g.items.length,y:g.items.reduce((n,p)=>n+p.anchorY,0)/g.items.length,ids,distance:c.distance,dead}];
   endpoints.sort((a,b)=>a.ids[0]-b.ids[0]);
   for(const point of endpoints){const pointTint=point.dead?(palette?.icons?.dead||'#141618'):iconTint;const highlighted=detailed&&point.ids.includes(this.hoveredMember),muted=detailed&&this.hoveredMember!=null&&!highlighted,originX=g.x,originY=g.y+(detailed?10:point.y<g.y?-10:10);
    if(detailed&&palette?.layers?.rays!==false)for(const outline of [true,false]){const line=this.overlay.get('ray:'+g.key+':'+point.ids.join(',')+':'+outline,'line');for(const [k,v]of Object.entries({x1:originX,y1:originY,x2:point.x,y2:point.y}))labelAttribute(line,k,v);labelField(line.dataset,'memberIds',point.ids.join(','));labelField(line.dataset,'state',point.dead?'dead':'alive');labelAttribute(line,'class',detailed?'squad-ray':'actor-leader');labelField(line.dataset,'selected',String(inspected));labelAttribute(line,'stroke',outline?(inspected?'#fff2be':'#101820'):pointTint);labelAttribute(line,'stroke-width',outline&&inspected?(point.dead?'1.8':highlighted?'3.8':'3.2'):point.dead?(outline?'1.2':highlighted?'.9':'.6'):outline?(detailed?(highlighted?'2.5':'2'):'5'):(detailed?(highlighted?'1.5':'1'):'2.8'));labelAttribute(line,'stroke-opacity',muted?'.15':outline&&inspected?(point.dead?'.4':'.95'):point.dead?(outline?'.18':highlighted?'.6':'.35'):outline?'.45':highlighted?'1':detailed?'.75':'.95');}
    if(palette?.layers?.points!==false){const dot=this.overlay.get('member:'+g.key+':'+point.ids.join(','),'circle');for(const [k,v]of Object.entries({cx:point.x,cy:point.y,r:anchorRadius(point.distance,point.dead),fill:pointTint,'fill-opacity':point.dead?.45:1,stroke:'#f4f2e9','stroke-width':1.2}))labelAttribute(dot,k,v);labelAttribute(dot,'class',detailed?'squad-member-point':'vehicle-model-point');labelField(dot.dataset,'memberIds',point.ids.join(','));}
   }
   this.visibleCount++;this.representedCount+=ids.length;
  }
  for(const n of this.nodes.values())if(!shown.has(n.el)&&!n.el.hidden)n.el.hidden=true;
  for(const c of candidates){
   if(!c.visible||(!c.stationaryText&&!c.isolationText)||c.e.type!=='unit')continue;
   const el=this.nodes.get(c.id).el,notes=[['stationary-note',c.stationaryText],['isolation-note',c.isolationText]].filter(([,text])=>text),textWidth=Math.max(...notes.map(([,text])=>this.measureText(text)+10)),noteHeight=20+notes.length*18;
   // Notes must never reveal a name hidden by the normal squad/zoom rules.
   if(el.hidden)continue;
   for(const [className,text]of notes)statusNote(el,text,className);
   const nickname=nicknames.find(n=>n.id===c.id);if(nickname){nickname.h=noteHeight;nickname.w=Math.max(nickname.w,textWidth);}
  }
  for(const c of candidates){const el=this.nodes.get(c.id).el;if(!c.stationaryText)el.querySelector('.stationary-note')?.remove();if(!c.isolationText)el.querySelector('.isolation-note')?.remove();}
  for(const label of placeMemberLabels(nicknames,{left,right:w-right,top:72,bottom:h-38,memory:this.nicknameLayout,occupied:[...occupied,...candidates.filter(c=>c.visible).map(c=>({x:c.anchorX,y:c.anchorY,w:10,h:10}))]})){
   easeLabel(label,label.id,this.nicknameMotion,dt);
   labelPosition(label.el,label.x,label.y);labelField(label.el.style,'width',label.w+'px');

  }
  this.overlay.end();
  if(!nicknames.some(p=>p.id===this.hoveredMember))this.hoveredMember=null;
  this.host.dataset.represented=this.representedCount;this.host.dataset.projected=new Set(candidates.filter(c=>c.visible).flatMap(c=>c.members.map(e=>e.id))).size;
  for(const [key,el]of this.clusters)if(!used.has(key)){el.remove();this.clusters.delete(key);}
 }
}

export class WreckSmoke {
 constructor(scene){this.max=2048;this.positions=new Float32Array(this.max*3);const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(this.positions,3));geometry.setDrawRange(0,0);this.mesh=new THREE.Points(geometry,new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{},vertexShader:'varying float fade;void main(){vec4 p=modelViewMatrix*vec4(position,1.0);gl_Position=projectionMatrix*p;gl_PointSize=clamp(2400.0/max(1.0,-p.z),3.0,52.0);fade=1.0;}',fragmentShader:'varying float fade;void main(){float r=length(gl_PointCoord-vec2(0.5))*2.0;if(r>1.0)discard;gl_FragColor=vec4(vec3(0.08),0.42*(1.0-r*r));}'}));this.mesh.frustumCulled=false;scene.add(this.mesh);}
 update(drawn,entities,positions,time){let n=0;for(const [id,d]of drawn){if(entities.get(id).type!=='vehicle'||positions.get(id)[4]!==0)continue;for(let i=0;i<18&&n<this.max;i++){const t=((time*.00012+i/18+id*.137)%1),angle=i*2.4+id;this.positions.set([d.position.x+Math.sin(angle+t)*t*1.1,d.position.y+d.height*.65+t*8,d.position.z+Math.cos(angle+t)*t*1.1],n++*3);}}this.mesh.geometry.setDrawRange(0,n);this.mesh.geometry.attributes.position.needsUpdate=true;}
}

// Surface-anchored schematic curves preserve the requested endpoint. Occlusion
// is handled by depth testing, not by erasing the remaining recorded XY path
// at an intersection with a terrain LOD or an estimated projectile shape.
export class ShotTracers {
 constructor(scene,height=null){this.height=height;this.flashes=new ShotFlashes(scene);this.active=[];this.max=96;this.totalShown=0;this.segments=32;this.vertices=new Float32Array(this.max*this.segments*6);this.colors=new Float32Array(this.max*this.segments*6);this.heads=new Float32Array(this.max*3);this.widths=new Float32Array(this.max*this.segments);this.lines=new TracerLines(this.vertices,this.colors,this.widths);this.lines.frustumCulled=false;scene.add(this.lines);this.headSizes=new Float32Array(this.max);this.points=new TracerHeads(this.heads,this.headSizes);scene.add(this.points);}
 clear(){this.active=[];this.lines.geometry.setDrawRange(0,0);this.points.geometry.setDrawRange(0,0);}
 add(shot,from,to,now,paused=false,kind=null,options={}){
  const points=options.points,valid=points?.length>=2&&options.duration>0&&points.every(p=>p.length>=4&&p.slice(0,4).every(Number.isFinite))&&Math.hypot(points[0][1]-from.x,points[0][2]-from.y,points[0][3]-from.z)<.05&&Math.hypot(points.at(-1)[1]-to.x,points.at(-1)[2]-to.y,points.at(-1)[3]-to.z)<.05;
  const rise=trajectoryRise(from,to,kind,options),limit=this.height&&!options.surfaceAnchored&&!options.confirmed&&!valid?terrainTrajectoryLimit(from,to,rise,this.height):1;if(limit<=0)return;
  // Event timing is an illustration of the recorded HIT/Killed, not a measured
  // projectile speed. It must survive until that event, including on seek/pause.
  const timed=!valid&&!!options.confirmed&&Number.isFinite(options.arrivalSeconds)&&options.arrivalSeconds>=0;
  const duration=valid?options.duration*1000:timed?Math.max(.001,options.arrivalSeconds*1000):kind?1700:330;
  this.active.push({shot,from:from.clone(),to:to.clone(),born:now,paused,kind,rise,limit,confirmed:!!options.confirmed,timed,follow:valid?null:options.follow,points:valid?points:null,duration,life:valid?duration+350:timed?duration+500:kind?2550:850});this.totalShown++;
 }
 reserve(count){
  if(count<=this.max)return;
  while(this.max<count)this.max*=2;
  this.vertices=new Float32Array(this.max*this.segments*6);this.colors=new Float32Array(this.vertices.length);this.widths=new Float32Array(this.max*this.segments);this.heads=new Float32Array(this.max*3);this.headSizes=new Float32Array(this.max);
  // Keep the same scene objects (and visibility hooks); replace only buffers.
  const lines=new TracerLines(this.vertices,this.colors,this.widths),points=new TracerHeads(this.heads,this.headSizes);
  this.lines.geometry.dispose();this.points.geometry.dispose();
  this.lines.geometry=lines.geometry;this.lines.ends=lines.ends;this.lines.tints=lines.tints;this.points.geometry=points.geometry;
  lines.material.dispose();points.material.dispose();
 }
 update(now,enabled,playing){
  this.active=this.active.filter(s=>now>=s.born&&now-s.born<s.life);
  this.lines.visible=this.points.visible=enabled;this.flashes.update([],now,false);if(!enabled)return;
  this.reserve(this.active.length);let vertex=0,point=0;
  for(const s of this.active){
   if(s.points){
    const window=shotWindow(now,s.born,s.duration/1000,!playing);if(!window)continue;
    const at=time=>{const ps=s.points;let lo=0,hi=ps.length-1;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(ps[mid][0]<=time)lo=mid;else hi=mid-1;}const a=ps[lo],b=ps[Math.min(lo+1,ps.length-1)],u=b[0]>a[0]?Math.max(0,Math.min(1,(time-a[0])/(b[0]-a[0]))):0;return [1,2,3].map(k=>a[k]+(b[k]-a[k])*u);};
    for(let j=0;j<this.segments;j++){const a=window.start+(window.end-window.start)*j/this.segments,b=window.start+(window.end-window.start)*(j+1)/this.segments;this.vertices.set(at(a),vertex*3);this.vertices.set(at(b),(vertex+1)*3);this.widths[vertex/2]=TRACER_WIDTH;this.colors.set([.65*window.fade,.3*window.fade,.03,window.fade,.85*window.fade,.36*window.fade],vertex*3);vertex+=2;}
    this.headSizes[point]=4;this.heads.set(at(window.end),point++*3);continue;
   }
   if(s.follow){const to=s.follow();if(to)s.to.copy(to);}
   const frozen=!playing,elapsed=Math.max(0,now-s.born),age=Math.min(s.limit,s.timed?elapsed/s.duration:frozen||s.confirmed?1:elapsed/s.duration),fade=frozen?1:Math.min(1,(s.life-elapsed)/500),steps=s.rise>0?this.segments:1;
   for(let j=0;j<steps;j++){
    this.vertices.set(trajectoryPoint(s.from,s.to,s.rise,age*j/steps),vertex*3);this.vertices.set(trajectoryPoint(s.from,s.to,s.rise,age*(j+1)/steps),(vertex+1)*3);
    this.widths[vertex/2]=TRACER_WIDTH;this.colors.set([.65*fade,.3*fade,.03,fade,.85*fade,.36*fade],vertex*3);vertex+=2;
   }
   this.headSizes[point]=4;this.heads.set(trajectoryPoint(s.from,s.to,s.rise,age),point++*3);
  }
  this.lines.setCount(vertex/2);this.points.setCount(point);
 }
}
