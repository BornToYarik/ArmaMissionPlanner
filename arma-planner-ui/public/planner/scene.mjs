import {shortRole,sideColor,initialVehicleSide} from './planning-units.mjs';
import {boardingGhostMesh} from './planning-ghost.mjs';
import {ViewshedSurface} from './viewshed-surface.mjs';
import {VisibilityQuery,observerPoint,inViewSphere} from './visibility-volume.mjs';
import {terrainGridHit} from './wog/terrain-ray.js';
import {coarseNormalAt} from './wog/terrain-join.js';
import {waterSurface} from './wog/water-surface.js';
import {terrainExposure} from './wog/terrain-appearance.js';
import {navigationDistance} from './wog/camera-navigation.js';
import {armedInfantry} from './wog/infantry-weapon.js';
import {tintMaterial} from './wog/actor-visuals.js';
import {drapePath,zoneOutline,gameplayObject} from './terrain-overlays.mjs';
import {ZoneTint} from './zone-tint.mjs';
import {ActorLabels} from './wog/replay-effects.js';
import {markerAssets} from './wog/marker-catalog.js';
import * as T from 'three';
import {OrbitControls} from './wog/vendor/OrbitControls.js';
import {Environment} from './wog/environment.js';
import {TerrainDetail} from './wog/terrain-detail.js';
import {terrainHeight} from './wog/replay-math.js';
import {lightScene,terrainMaterial,sceneryMaterial} from './wog/scene-lighting.js';
import {TerrainRoads} from './wog/terrain-roads.js';
import {sqmPoint,distance,configuredProfile} from './core.mjs';
export async function json(url){const r=await fetch(url,{signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error(`${url}: ${r.status}`);return r.json();}
const pause=()=>new Promise(r=>setTimeout(r,0));
export class PlanningScene {
  constructor(container,status){this.container=container;this.status=status;this.scene=new T.Scene();this.renderer=new T.WebGLRenderer({antialias:true});this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));this.renderer.outputColorSpace=T.SRGBColorSpace;container.prepend(this.renderer.domElement);this.camera=new T.PerspectiveCamera(45,1,.3,90000);this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=true;this.controls.dampingFactor=.12;this.controls.maxPolarAngle=Math.PI*.48;this.controls.minDistance=3;this.controls.screenSpacePanning=false;this.controls.enableZoom=false;this.keys=new Set();this.lang="ru";this.lastFrame=0;this.controls.mouseButtons={LEFT:null,MIDDLE:T.MOUSE.PAN,RIGHT:T.MOUSE.ROTATE};this.ray=new T.Raycaster();this.actors=[];this.overlays=new Map();this.drapes=new Map();this.zoneShapes=new Map();this.nativeTiles=new Map();this.modelCache=new Map();this.collisionTiles=new Map();this.waypoints=new Map();this.lastStream=0;this.resize=new ResizeObserver(()=>{const w=Math.max(1,container.clientWidth),h=Math.max(1,container.clientHeight);this.renderer.setSize(w,h);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();});this.resize.observe(container);this.installNavigation();this.renderer.setAnimationLoop(t=>this.render(t));}
  vec(p){return new T.Vector3(p[0]-this.half,p[2],this.half-p[1]);}
  map(v){return [v.x+this.half,this.half-v.z,v.y];}
  height(x,y){if(x<0||y<0||x>this.terrain.worldSize||y>this.terrain.worldSize)return NaN;const meta=this.detail?.meta;if(meta){const tx=Math.min(meta.count-1,Math.floor(x/(meta.cells*meta.cellSize))),ty=Math.min(meta.count-1,Math.floor(y/(meta.cells*meta.cellSize))),h=this.nativeTiles.get(tx+':'+ty);if(h){const gx=x/meta.cellSize-tx*meta.cells,gy=y/meta.cellSize-ty*meta.cells,ix=Math.min(meta.cells-1,Math.floor(gx)),iy=Math.min(meta.cells-1,Math.floor(gy)),u=gx-ix,v=gy-iy,n=meta.tileResolution,k=iy*n+ix;return u+v<=1?h[k]+(h[k+1]-h[k])*u+(h[k+n]-h[k])*v:h[k+n+1]+(h[k+n]-h[k+n+1])*(1-u)+(h[k+1]-h[k+n+1])*(1-v);}}
    return terrainHeight(this.terrain,x,y);}
  async load(mission){
    this.mission=mission;this.world=mission.worldName.toLowerCase();this.status('Загрузка карты и справочников…');
    const [terrain,catalog,actors]=await Promise.all([json(`terrain/${this.world}-detail.json`),json(`environment/worlds/${this.world}.json`),json('models/catalog.json')]);
    this.terrain=terrain;this.catalog=catalog;this.actorCatalog=actors;try{this.nativeCatalog=await json('models/planning-native-catalog.json');}catch{this.nativeCatalog={classes:{},models:{},parameters:{}};}this.half=terrain.worldSize/2;
    this.scene.background=new T.Color(lightScene(this.scene,this.world).horizon);
    const tex=await new T.TextureLoader().loadAsync('environment/'+catalog.worlds[this.world].texture);tex.colorSpace=T.SRGBColorSpace;tex.anisotropy=4;
    const n=terrain.resolution,g=new T.BufferGeometry(),verts=new Float32Array(n*n*3),uv=new Float32Array(n*n*2),indices=[];
    for(let y=0;y<n;y++)for(let x=0;x<n;x++){const k=y*n+x,wx=x/(n-1)*terrain.worldSize,wy=y/(n-1)*terrain.worldSize;verts.set([wx-this.half,terrain.heights[k],this.half-wy],k*3);uv.set([x/(n-1),y/(n-1)],k*2);if(x<n-1&&y<n-1)indices.push(k,k+1,k+n,k+1,k+n+1,k+n);}
    g.setAttribute('position',new T.BufferAttribute(verts,3));g.setAttribute('uv',new T.BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();this.zoneTint=new ZoneTint(this.half);this.viewshed=new ViewshedSurface(this.half);

    this.roads=new TerrainRoads(this.world,terrain.worldSize);this.roads.load().catch(()=>this.status('Текстуры дорог недоступны. Остальная сцена работает.'));
    const mat=terrainMaterial({map:tex});this.ground=new T.Mesh(g,mat);this.scene.add(this.ground);
    const roadShader=s=>{s.vertexShader='varying vec2 terrainWorld;\n'+s.vertexShader;s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nterrainWorld=position.xz;');s.fragmentShader='varying vec2 terrainWorld;\n'+s.fragmentShader;this.roads.attach(s);this.zoneTint.attach(s);this.viewshed.attach(s);s.uniforms.plannerExposure={value:terrainExposure(this.world)};s.fragmentShader="uniform float plannerExposure;\n"+s.fragmentShader;s.fragmentShader=s.fragmentShader.replace("#include <map_fragment>","#include <map_fragment>\n#ifdef USE_MAP\ndiffuseColor.rgb=vec3(1.0)-pow(max(vec3(0.0),vec3(1.0)-diffuseColor.rgb),vec3(plannerExposure));\n#endif");};mat.onBeforeCompile=s=>{roadShader(s);s.uniforms.plannerDetailBounds={value:this.detail.bounds};s.fragmentShader='uniform vec4 plannerDetailBounds;\n'+s.fragmentShader;s.fragmentShader=s.fragmentShader.replace('#include <clipping_planes_fragment>','#include <clipping_planes_fragment>\nif(terrainWorld.x>plannerDetailBounds.x&&terrainWorld.y>plannerDetailBounds.y&&terrainWorld.x<plannerDetailBounds.z&&terrainWorld.y<plannerDetailBounds.w)discard;');};
    const detailMat=terrainMaterial({map:tex});detailMat.onBeforeCompile=roadShader;
    this.detail=new TerrainDetail(this.scene,this.world,this.half,(x,y)=>terrainHeight(terrain,x,y),detailMat,(regions,settled)=>{this.drapesDirty=true;this.environment?.alignGround(regions,settled,this.detail);this.actorsDirty=true;},(x,y)=>coarseNormalAt(terrain,g.getAttribute("normal").array,x,y));await this.detail.metadata();
    if(terrain.minHeight<-1){const wg=new T.BufferGeometry();wg.setAttribute('position',new T.BufferAttribute(waterSurface(terrain),3));wg.computeVertexNormals();this.scene.add(new T.Mesh(wg,sceneryMaterial({color:0x547d8c,side:T.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-2})));}
    this.environment=new Environment(this.scene,catalog,this.world,this.half,(x,y)=>this.height(x,y));await this.environment.loadBuildings();
    this.environment.setMissionObjects(true);this.missionMeshes=[];
    const byId=new Map((mission.planningScene||[]).map(o=>[o.id,o]));
    const units=[];
    for(const group of mission.groups)for(const u of group.units)units.push({...u,groupId:group.id,side:group.side,groupLabel:group.callSign,label:group.callSign+' · '+shortRole(u.roleDescription||u.vehicleClass,this.lang),mobility:'foot'});
    for(const v of mission.vehicles)units.push({...v,label:v.customName||v.description||v.vehicleClass,mobility:/tank|bmp|bmd|m113|mtlb|t72|t80|t90|abrams|bradley/i.test(v.vehicleClass)?'tracked':'wheeled'});
    for(const u of units){const ref=this.nativeCatalog.parameters[u.vehicleClass.toLowerCase()];u.mobility=u.groupId!=null?'foot':ref?.mobility||(/ammobox|crate|wreck|mash|static|dshkm|zu23|2b14|mortar/i.test(u.vehicleClass)?'static':/uh60|mi8|heli|plane|su25|a10/i.test(u.vehicleClass)?'air':u.mobility);u.capacity=ref?.capacity;u.gameplay=ref?.gameplay;u.parameterSource=ref?'Конфиги вашей сборки':'Оценка: конфиги сборки ещё не подготовлены';u.speedProfile=configuredProfile(ref,u.mobility);}
    this.labels=new ActorLabels(document.getElementById('labels'),id=>this.onSelect?.([id]),ids=>this.onSelect?.(ids));this.selectedIds=[];this.units=units.filter(u=>u.position?.length===3).map(u=>({...u,point:sqmPoint(u.position),start:sqmPoint(u.position),angles:byId.get(u.id)?.angles||[0,u.directionDegrees*Math.PI/180,0]}));
    for(const u of this.units)if(u.mobility!=='foot'){const side=initialVehicleSide(u,this.units);if(side!==u.side){u.side=side;u.sideSource='nearest-starting-group';}}
    const unitIds=new Set(this.units.map(u=>u.id));
    const scenery=(mission.planningScene||[]).filter(o=>!unitIds.has(o.id));
    let done=0,missing=0;
    for(const u of [...this.units,...scenery.map(o=>({...o,point:sqmPoint(o.position),label:o.description||o.vehicleClass,scenery:true}))]){
      try{await this.addActor(u);}catch(e){this.addPlaceholder(u);missing++;console.warn('Mission model',u.vehicleClass,e.message);}
      if(++done%8===0){this.status(`Объекты миссии: ${done} / ${this.units.length+scenery.length}`);await pause();}
    }
    this.missing=missing;this.labelsDirty=true;this.drawZones(mission.markers);const first=this.units[0]?.point||[this.half,this.half,terrain.maxHeight];this.focus(first,700);
    this.ready=true;this.status(`Сцена готова. Не найдено моделей: ${missing}. Пунктирные метки обозначают заменители.`);
  }
  async actorModel(key,native=false){if(this.modelCache.has(key))return this.modelCache.get(key);const promise=(async()=>{const meta=(native?this.nativeCatalog:this.actorCatalog).models[key],raw=await json(meta.file),d=!native&&key===this.actorCatalog.infantry?armedInfantry(raw):raw,g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(d.aimPositions||d.positions,3));g.setIndex(d.indices);if(d.uvs)g.setAttribute('uv',new T.Float32BufferAttribute(d.uvs,2));g.computeVertexNormals();for(const r of d.groups||[])g.addGroup(r.start,r.count,r.materialIndex);
    const mats=await Promise.all((d.materials||[{}]).map(async m=>{let map;if(m.texture){map=await new T.TextureLoader().loadAsync(m.texture);map.colorSpace=T.SRGBColorSpace;}const color=Array.isArray(m.color)?new T.Color(...m.color):m.color||0xffffff;return sceneryMaterial({...map?{map}:{},color,side:T.DoubleSide,alphaTest:m.alphaTest||0});}));return {g,mats:d.groups?.length?mats:mats[0]};})();this.modelCache.set(key,promise);return promise;}
  async addActor(u){const nativeKey=this.nativeCatalog.classes[u.vehicleClass.toLowerCase()],native=u.mobility!=='foot'&&!!this.nativeCatalog.models[nativeKey];const key=u.mobility==='foot'?this.actorCatalog.infantry:(native?nativeKey:null)||this.actorCatalog.classes[u.vehicleClass];let mesh;
    if(key){const {g,mats}=await this.actorModel(key,native);let materials=mats;if(u.mobility==='foot'){materials=[mats].flat().map(mat=>{const m=mat.clone();m.color.set(sideColor(u.side));tintMaterial(m,false);return m;});if(!Array.isArray(mats))materials=materials[0];}mesh=new T.Mesh(g,materials);}
    else {const id=Object.entries(this.catalog.models).find(([,m])=>m?.classes?.includes(u.vehicleClass)||m?.className===u.vehicleClass)?.[0];if(id==null)throw Error('Нет сопоставления класса');const m=await this.environment.model(id);mesh=new T.Mesh(m.geometry,m.materials);}
    this.placeActor(u,mesh,false);
  }
  addPlaceholder(u){const g=u.mobility==='foot'?new T.CapsuleGeometry(.3,1,4,6):new T.BoxGeometry(2,1.4,3);const mesh=new T.Mesh(g,new T.MeshLambertMaterial({color:0xdd9b48,wireframe:true}));this.placeActor(u,mesh,true);}
  placeActor(u,mesh,missing){mesh.position.copy(this.vec(u.point));if(missing)mesh.position.y+=.8;const a=u.angles||[0,0,0];mesh.rotation.set(-a[0]||0,-a[1]||0,a[2]||0,'XZY');mesh.userData.unit=u;u.mesh=mesh;u.missing=missing;this.scene.add(mesh);if(u.scenery)this.missionMeshes.push(mesh);else{
    this.labels.add({id:u.id});u.labelNode=this.labels.nodes.get(u.id).el;u.labelNode.dataset.unitid=u.id;this.actors.push(mesh);this.updateActor(u);}}
  updateActor(u){const p=[...u.point],floor=this.surfaceHeight(p[0],p[1]);p[2]=Math.max(p[2],floor);u.mesh.position.copy(this.vec(p));if(u.missing)u.mesh.position.y+=.8;u.mesh.visible=u.carrier==null&&(!this.visibleSide||this.visibleSide==='all'||u.side===this.visibleSide);u.mesh.updateMatrixWorld(true);this.labelsDirty=true;}
  focus(p,d=150){this.controls.target.copy(this.vec(p));this.camera.position.copy(this.vec(p)).add(new T.Vector3(0,d*.7,d));this.controls.update();}
  eye(p,h=1.7){if(!this.savedCamera)this.savedCamera={p:this.camera.position.clone(),t:this.controls.target.clone()};const direction=this.controls.target.clone().sub(this.camera.position).setY(0).normalize();this.camera.position.copy(this.vec([p[0],p[1],Math.max(p[2],this.surfaceHeight(p[0],p[1]))+h]));this.controls.target.copy(this.camera.position).addScaledVector(direction,30);this.controls.update();this.maintainCamera();}
  leaveEye(){if(!this.savedCamera)return;this.camera.position.copy(this.savedCamera.p);this.controls.target.copy(this.savedCamera.t);this.savedCamera=null;this.controls.update();}
  ruler(a,b=null){
    if(!this.rulerGroup){
      const group=new T.Group(),positions=new T.BufferAttribute(new Float32Array(6),3),g=new T.BufferGeometry();g.setAttribute('position',positions);
      const line=new T.Line(g,new T.LineBasicMaterial({color:0xffffff,depthTest:false}));line.renderOrder=100;group.add(line);
      const dots=new T.Points(g,new T.PointsMaterial({color:0xffdd83,size:9,sizeAttenuation:false,depthTest:false}));dots.renderOrder=101;group.add(dots);
      const label=document.createElement('div');label.className='ruler-label';this.container.append(label);
      this.rulerGroup={group,g,line,label};this.scene.add(group);
    }
    const r=this.rulerGroup;r.group.visible=!!a;r.label.hidden=!b;if(!a)return;
    const av=this.vec(a),bv=this.vec(b||a);av.y+=.2;bv.y+=.2;r.g.attributes.position.setXYZ(0,av.x,av.y,av.z);r.g.attributes.position.setXYZ(1,bv.x,bv.y,bv.z);r.g.attributes.position.needsUpdate=true;r.g.computeBoundingSphere();r.line.visible=!!b;
    if(b){r.mid=av.clone().lerp(bv,.5);r.label.textContent=av.distanceTo(bv).toFixed(1)+' м';r.label.title='Расстояние по прямой в 3D';}
  }
  terrainHit(){return [terrainGridHit(this.ray.ray,this.ground,{accept:p=>!this.detail?.contains(p.x+this.half,this.half-p.z)}),terrainGridHit(this.ray.ray,this.detail?.mesh,{blend:this.detail?.blend.value??1})].filter(Boolean).sort((a,b)=>a.distance-b.distance)[0];}
  pick(e){const r=this.renderer.domElement.getBoundingClientRect();this.ray.setFromCamera(new T.Vector2((e.clientX-r.left)/r.width*2-1,1-(e.clientY-r.top)/r.height*2),this.camera);const objects=this.ray.intersectObjects(this.actors.filter(a=>a.visible),false),terrain=this.terrainHit(),surface=[terrain,...this.ray.intersectObjects(this.missionMeshes,false)].filter(Boolean).sort((a,b)=>a.distance-b.distance)[0];let unit=objects[0]?.object.userData.unit;
    if(!unit){let best=12;for(const u of this.units){if(!u.mesh.visible||!gameplayObject(u))continue;const v=u.mesh.position.clone().project(this.camera),d=Math.hypot((v.x*.5+.5)*r.width-(e.clientX-r.left),(-v.y*.5+.5)*r.height-(e.clientY-r.top));if(v.z>=-1&&v.z<=1&&d<best){best=d;unit=u;}}}
    return {unit,point:surface?this.map(surface.point):null};}
  cursor(p){if(!this.cursorMesh){this.cursorMesh=new T.Mesh(new T.RingGeometry(.7,1,32),new T.MeshBasicMaterial({color:0xffefab,side:T.DoubleSide,depthTest:false,transparent:true,opacity:.85}));this.cursorMesh.rotation.x=-Math.PI/2;this.cursorMesh.renderOrder=30;this.scene.add(this.cursorMesh);}this.cursorMesh.visible=!!p;if(p){this.cursorMesh.position.copy(this.vec(p));this.cursorMesh.position.y+=.12;const scale=Math.max(.35,this.camera.position.distanceTo(this.cursorMesh.position)*.008);this.cursorMesh.scale.setScalar(scale);}}
  installNavigation(){const blocked=e=>e?.target?.closest?.('input,select,textarea,dialog')||document.querySelector('dialog[open]');addEventListener('keydown',e=>{if(blocked(e)||e.ctrlKey||e.altKey)return;if(['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyZ','ShiftLeft','ShiftRight'].includes(e.code)){e.preventDefault();this.keys.add(e.code);}});addEventListener('keyup',e=>this.keys.delete(e.code));addEventListener('blur',()=>this.keys.clear());
    this.container.addEventListener('wheel',e=>{if(!this.ready||e.target.closest('#sceneTools,#sceneMenu,.waypoint-label'))return;e.preventDefault();e.stopImmediatePropagation();this.pick(e);const hit=this.terrainHit(),anchor=hit?hit.point:this.controls.target.clone(),distance=this.camera.position.distanceTo(anchor),delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?500:1),factor=T.MathUtils.clamp(Math.exp(T.MathUtils.clamp(delta,-250,250)*.0018),3/Math.max(3,distance),this.terrain.worldSize*2/Math.max(3,distance));this.camera.position.sub(anchor).multiplyScalar(factor).add(anchor);this.controls.target.sub(anchor).multiplyScalar(factor).add(anchor);this.maintainCamera();this.controls.update();},{passive:false,capture:true});}
  maintainCamera(){for(const [v,offset]of [[this.camera.position,1.5],[this.controls.target,.7]]){const h=this.surfaceHeight(v.x+this.half,this.half-v.z);if(Number.isFinite(h))v.y=Math.max(v.y,h+offset);}this.camera.lookAt(this.controls.target);}
  moveCamera(dt){if(document.activeElement?.matches('input,select,textarea'))return;const k=this.keys,forward=this.controls.target.clone().sub(this.camera.position).setY(0).normalize(),right=new T.Vector3(-forward.z,0,forward.x),move=new T.Vector3();if(k.has('KeyW'))move.add(forward);if(k.has('KeyS'))move.sub(forward);if(k.has('KeyD'))move.add(right);if(k.has('KeyA'))move.sub(right);const ground=this.surfaceHeight(this.camera.position.x+this.half,this.half-this.camera.position.z),v=T.MathUtils.clamp(navigationDistance(this.camera.position,this.controls.target,ground)*.65,8,1800);move.normalize().multiplyScalar(dt*v*(k.has('ShiftLeft')||k.has('ShiftRight')?3:1));move.y=(Number(k.has('KeyQ'))-Number(k.has('KeyZ')))*dt*v;this.camera.position.add(move);this.controls.target.add(move);}

  waypoint(id,p,text,onClick){let w=this.waypoints.get(id);if(!w){const el=document.createElement('button');el.className='waypoint-label';this.container.append(el);w={el};this.waypoints.set(id,w);}Object.assign(w,{p,text});w.el.textContent=text;w.el.onclick=onClick;}
  removeWaypoint(id){this.waypoints.get(id)?.el.remove();this.waypoints.delete(id);}
  planMarkers(markers,catalog,onClick){
    for(const id of [...this.zoneShapes.keys()])if(id.startsWith('plan-marker:'))this.zoneShapes.delete(id);
    for(const id of [...this.waypoints.keys()])if(id.startsWith('plan-marker:'))this.removeWaypoint(id);
    for(const id of [...this.overlays.keys()])if(id.startsWith('plan-marker:')||id.startsWith('zone:plan-marker:'))this.overlay(id,null);
    const missionMarkers=(this.mission.markers||[]).filter(m=>m.markerType==='ICON'&&m.alpha>0).map(m=>({id:'mission:'+m.name,x:m.position[0],y:m.position[2],text:m.text||m.name,icon:m.iconType,color:({ColorRed:'#e85757',ColorBlue:'#429bce',ColorGreen:'#53ba81'})[m.colorName]||'#e9d99b'}));
    for(const m of [...missionMarkers,...markers]){
      if(!Number.isFinite(m.x)||!Number.isFinite(m.y))continue;
      const h=this.height(m.x,m.y);if(!Number.isFinite(h))continue;
      const id='plan-marker:'+m.id,def=catalog.find(d=>d.swtIdx===m.swtTypeIndex),color=/^#[0-9a-f]{6}$/i.test(m.color)?m.color:(def?.defaultColorHex||'#d2dda2');
      if(m.swtTypeIndex===-4&&m.polyCoords?.length>=4){const points=[];for(let i=0;i+1<m.polyCoords.length;i+=2){const x=m.polyCoords[i],y=m.polyCoords[i+1],z=this.height(x,y);if(Number.isFinite(z))points.push([x,y,z]);}this.line(id,points,color);}
      else if(m.swtTypeIndex===-2||m.swtTypeIndex===-3){this.drawZones([{name:id,markerType:m.swtTypeIndex===-2?'RECTANGLE':'ELLIPSE',widthA:m.scaleX,heightB:m.scaleY,angle:m.angle,color,position:[m.x,h,m.y]}]);}
      const p=[m.x,m.y,h];this.waypoint(id,p,m.text||def?.name||'Метка',()=>onClick(p));
      const el=this.waypoints.get(id).el;el.classList.add('plan-marker');el.style.setProperty('--marker-color',color);
      const asset=markerAssets[String(m.icon||def?.id||'').toLowerCase()];if(asset){const icon=document.createElement('span');icon.className='plan-marker-icon';icon.style.maskImage='url('+asset+')';icon.style.webkitMaskImage='url('+asset+')';el.prepend(icon);}
    }
    this.zoneTint.set([...this.zoneShapes.values()]);
  }
  surfaceHeight(x,y){return this.detail?.height(x,y)??terrainHeight(this.terrain,x,y);}
  terrainGrids(){const size=this.terrain.worldSize;return [{bounds:[0,0,size,size],step:size/(this.terrain.resolution-1)},...(this.detail?.patch?[{bounds:this.detail.patch.box,step:this.detail.patch.step}]:[])];}
  line(id,points,color=0x6ee7b7){
    const group=new T.Group(),geometry=new T.BufferGeometry(),line=new T.Line(geometry,new T.LineBasicMaterial({color,depthTest:true,depthWrite:false}));line.renderOrder=4;group.add(line);
    this.overlay(id,group);this.drapes.set(id,{points:points.map(p=>p.slice(0,2)),geometry,patch:null});this.refreshDrape(id,true);
  }
  refreshDrape(id,rebuild=false){
    const d=this.drapes.get(id);if(!d)return;const patch=this.detail?.patch;
    if(rebuild||d.patch!==patch||!d.xy){d.xy=drapePath(d.points,this.terrainGrids(),(x,y)=>this.surfaceHeight(x,y));d.geometry.setAttribute('position',new T.Float32BufferAttribute(new Float32Array(d.xy.length*3),3));d.patch=patch;}
    const attr=d.geometry.attributes.position;
    d.xy.forEach(([x,y],i)=>attr.setXYZ(i,x-this.half,this.surfaceHeight(x,y)+.25,this.half-y));attr.needsUpdate=true;d.geometry.computeBoundingSphere();
  }
  refreshDrapes(){if(!this.drapesDirty)return;for(const id of this.drapes.keys())this.refreshDrape(id);this.drapesDirty=false;}

  overlay(id,object){this.drapes.delete(id);const prev=this.overlays.get(id);if(prev){this.scene.remove(prev);prev.traverse(o=>{o.geometry?.dispose();if(o.material)o.material.dispose();});}if(object){this.overlays.set(id,object);this.scene.add(object);}else this.overlays.delete(id);}
  dots(id,points,colors,size=8){const g=new T.BufferGeometry().setFromPoints(points.map(p=>this.vec(p)));g.setAttribute('color',new T.Float32BufferAttribute(colors.flatMap(c=>new T.Color(c).toArray()),3));this.overlay(id,new T.Points(g,new T.PointsMaterial({size,vertexColors:true,sizeAttenuation:false,depthTest:true,transparent:true,opacity:.7})));}
  drawZones(markers){
    for(const m of markers||[]){
      if(!m.position||m.position.length!==3||!['RECTANGLE','ELLIPSE'].includes(m.markerType?.toUpperCase())||m.alpha===0)continue;
      const c=sqmPoint(m.position),z={x:c[0],y:c[1],a:m.widthA,b:m.heightB,angle:m.angle||0,ellipse:m.markerType.toUpperCase()==='ELLIPSE',color:m.color||({ColorRed:'#e85757',ColorBlue:'#429bce',ColorGreen:'#53ba81'})[m.colorName]||'#efd37e',fill:m.brushName!=='Border'};
      if(![z.x,z.y,z.a,z.b].every(Number.isFinite)||z.a<=0||z.b<=0)continue;
      this.zoneShapes.set(m.name,z);this.line('zone:'+m.name,zoneOutline(z),z.color);
    }
    this.zoneTint.set([...this.zoneShapes.values()]);
  }

  async nativeRegion(x0,y0,x1,y1){const m=this.detail.meta,span=m.cells*m.cellSize;let failed=0;const jobs=[];for(let y=Math.max(0,Math.floor(y0/span));y<=Math.min(m.count-1,Math.floor(y1/span));y++)for(let x=Math.max(0,Math.floor(x0/span));x<=Math.min(m.count-1,Math.floor(x1/span));x++)jobs.push([x,y]);let done=0;
    for(let i=0;i<jobs.length;i+=4){await Promise.all(jobs.slice(i,i+4).map(async([x,y])=>{try{this.nativeTiles.set(x+':'+y,await this.detail.tile(x,y));}catch{failed++;}}));done+=Math.min(4,jobs.length-i);this.status(`Подробный рельеф: ${done}/${jobs.length}`);}return failed;}
  async visibleSceneSnapshot(){
    const env=this.environment,deadline=performance.now()+60000;
    while(env.stats.loading||env.activeJobs?.size||env.jobs?.length){
      if(performance.now()>deadline)throw Error('Сцена ещё загружается. Повторите расчёт после завершения подгрузки.');
      this.status('Ожидаю завершения загрузки объектов для камеры…');await new Promise(r=>setTimeout(r,150));
    }
    // Source instances are retained even when their GPU draws are combined.
    // Reuse their geometry and matrices, including off-screen loaded instances.
    const meshes=[...env.buildings,...env.nature,...this.missionMeshes];
    for(const mesh of meshes)mesh.updateMatrixWorld(true);
    const loaded=new Set([...env.buildingBatches.keys(),...env.natureBatches.keys()]);
    const missing=[...(env.buildingTiles||[]),...env.world.chunks].filter(t=>!loaded.has(t.file));
    return {meshes,missing,step:env.world.tileSize};
  }
  async visibility(p,eye,radius,token){
    radius=Number(radius);if(!(radius>0&&radius<=50000))throw Error('Некорректная дальность обзора');
    const snapshot=await this.visibleSceneSnapshot(),from=observerPoint(p,eye,(x,y)=>this.surfaceHeight(x,y)),origin=this.vec(from);
    const unknownBoxes=snapshot.missing.map(t=>new T.Box3(new T.Vector3(t.x*snapshot.step-this.half,-1e7,this.half-(t.y+1)*snapshot.step),new T.Vector3((t.x+1)*snapshot.step-this.half,1e7,this.half-t.y*snapshot.step)));
    const known=snapshot.meshes.filter(m=>!m.userData.unit?.missing);
    for(const mesh of snapshot.meshes.filter(m=>m.userData.unit?.missing)){mesh.geometry.computeBoundingBox();unknownBoxes.push(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld).expandByScalar(5));}
    const detailMesh=this.detail.mesh,blend=this.detail.blend.value,contains=(x,y)=>detailMesh&&this.detail.contains(x,y);
    const terrain=ray=>[terrainGridHit(ray,this.ground,{accept:q=>!contains(q.x+this.half,this.half-q.z)}),terrainGridHit(ray,detailMesh,{blend})].filter(Boolean).sort((a,b)=>a.distance-b.distance)[0];
    const query=new VisibilityQuery(known,terrain,unknownBoxes),n=81,values=new Int8Array(n*n).fill(-1);let count=0,unknown=0;
    // All directions, including uphill/downhill, use the same 3D ray query.
    // Only the terrain projection is drawn. Range is a sphere, not an XY disc.
    this.calculatingVisibility=true;
    try{for(let iy=0;iy<n;iy++)for(let ix=0;ix<n;ix++){
      if(token.cancelled)return null;
      const ux=(ix-40)/40,uy=(iy-40)/40,x=p[0]+Math.sign(ux)*ux*ux*radius,y=p[1]+Math.sign(uy)*uy*uy*radius;
      if(x<0||y<0||x>this.terrain.worldSize||y>this.terrain.worldSize)continue;
      const h=this.surfaceHeight(x,y),target=[x,y,h+.05];if(!Number.isFinite(h)||!inViewSphere(from,target,radius))continue;
      const delta=this.vec(target).sub(origin),length=delta.length(),hit=query.cast(origin,delta.normalize(),Math.max(0,length-.05));
      const value=hit.solid<length-.05?0:hit.unknown<length?2:1;values[iy*n+ix]=value;if(value===2)unknown++;
      if(++count%32===0){this.status(`Обзор с высоты ${eye} м: ${Math.round((iy*n+ix)/(n*n)*100)}%`);await pause();}
    }}finally{query.dispose();this.calculatingVisibility=false;}
    return {incomplete:unknown,values,n,x:p[0],y:p[1],radius,origin:from,spherical:true};
  }
  setAssignments(assignments){this.assignments=assignments||{};this.labelsDirty=true;}
  boardingPreview(units,p){
    const key=units.map(u=>u.id).join(',');
    if(!p||!units.length){if(this.boardingGhost){this.scene.remove(this.boardingGhost);for(const m of this.boardingGhost.children)for(const mat of [m.material].flat())mat.dispose();this.boardingGhost=null;}return;}
    if(this.boardingGhost?.userData.key!==key){this.boardingPreview([],null);this.boardingGhost=new T.Group();this.boardingGhost.userData.key=key;for(const u of units)this.boardingGhost.add(boardingGhostMesh(u.mesh));this.scene.add(this.boardingGhost);}
    const cols=Math.ceil(Math.sqrt(units.length));this.boardingGhost.children.forEach((m,i)=>{const x=p[0]+(i%cols-(cols-1)/2)*1.4,y=p[1]+Math.floor(i/cols)*1.4;m.position.copy(this.vec([x,y,this.surfaceHeight(x,y)]));m.visible=true;});
  }
  rebuildLabelState(){
    const entities=new Map(),positions=new Map(),drawn=new Map(),crews=new Map();
    for(const u of this.units)if(u.carrier!=null){if(!crews.has(u.carrier))crews.set(u.carrier,[]);crews.get(u.carrier).push(u.id);}
    for(const u of this.units){
      const infantry=u.mobility==='foot',ref=this.nativeCatalog.parameters[u.vehicleClass.toLowerCase()];
      const tag=String(this.assignments?.[u.id]||'').trim().replace(/[\[\]]/g,'');
      const base=infantry?shortRole(u.roleDescription||u.vehicleClass,this.lang):(u.customName||u.description||(ref?.displayName&&!ref.displayName.startsWith('$')?ref.displayName:null)||u.label);
      entities.set(u.id,{id:u.id,name:(tag?'['+tag+'] · ':'')+base,group:u.groupLabel||String(u.groupId??''),type:infantry?'unit':'vehicle',category:u.mobility,className:u.vehicleClass,side:u.side,planning:true,planningTag:tag});
      positions.set(u.id,[0,u.point[0],u.point[1],0,1,infantry?(u.carrier!=null?1:0):(crews.get(u.id)||[])]);
      // Supplies and scenery remain selectable on the model, without a vehicle
      // roster marker on every ammunition box. Selected objects are still named.
      const decoration=!gameplayObject(u);
      if((u.mesh.visible||u.carrier!=null)&&(!decoration||this.selectedIds.includes(u.id)))drawn.set(u.id,{position:u.mesh.position,height:infantry?1.8:2.5,carrier:u.carrier});
    }
    this.labelState={entities,positions,drawn};this.labelsDirty=false;
  }
  render(t){if(!this.ready||!this.container.clientWidth||!this.container.clientHeight)return;this.moveCamera(Math.min(.05,(t-(this.lastFrame||t))/1000));this.lastFrame=t;this.controls.update();this.maintainCamera();if(!this.calculatingVisibility&&t-this.lastStream>250){this.lastStream=t;this.environment.update(this.controls.target,this.camera.position.distanceTo(this.controls.target),'high').catch(console.warn);this.detail.update(this.camera.position,false,true)?.catch?.(console.warn);this.roads.update(this.camera.position,this.controls.target,this.camera.position.distanceTo(this.controls.target));}this.environment.tick?.(t);this.detail.tick(t);if(this.actorsDirty){for(const u of this.units)this.updateActor(u);this.actorsDirty=false;}this.refreshDrapes();this.roads.tick(t);this.scene.updateMatrixWorld();this.camera.updateMatrixWorld();this.environment.shared.visibility.update(this.environment.shared.groups,this.camera);
    const w=this.container.clientWidth,h=this.container.clientHeight;if(this.labelsDirty||!this.labelState)this.rebuildLabelState();const {entities,positions,drawn}=this.labelState;
    this.labels.update({frame:0,viewport:{width:w,height:h},drawn,entities,positions,camera:this.camera,selected:this.selectedIds[0]??null,inspectedIds:this.selectedIds,enabled:true,sideColor:side=>({WEST:0x2389c5,EAST:0xe04c4c,GUER:0x35b46f,INDEPENDENT:0x35b46f}[side]||0xa9a365),entitySide:e=>e.side?.toUpperCase(),distance:this.controls.getDistance(),grouping:true});
    for(const wpt of this.waypoints.values()){const v=this.vec(wpt.p).project(this.camera);wpt.el.hidden=wpt.hidden||v.z< -1||v.z>1;wpt.el.style.left=(v.x*.5+.5)*w+'px';wpt.el.style.top=((-v.y*.5+.5)*h-50)+'px';}if(this.rulerGroup?.mid&&!this.rulerGroup.label.hidden){const v=this.rulerGroup.mid.clone().project(this.camera),el=this.rulerGroup.label;el.style.left=(v.x*.5+.5)*w+'px';el.style.top=(-v.y*.5+.5)*h+'px';el.style.visibility=v.z>=-1&&v.z<=1?'visible':'hidden';}this.renderer.render(this.scene,this.camera);}
}
