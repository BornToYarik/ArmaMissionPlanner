import {mapLimited} from './wog/resource-cache.js';
import {assetJson,cachedRequest,retryAsset} from './asset-loading.mjs';
import {observerObjectRange,clipObserverObjects} from './object-range.mjs';
import {waypointTop} from './waypoint-layout.mjs';
import {EyeOptics,zoomFov} from './eye-optics.mjs';
import {projectVisibility} from './visibility-projection.mjs';
import {eyeDirection} from './eye-camera.mjs';
import {rosterVisible} from './roster-data.mjs';
import {UnitRoster} from './unit-roster.mjs';
import {RouteLine} from './route-line.mjs';
import {shortRole,sideColor,initialVehicleSide} from './planning-units.mjs';
import {boardingGhostMesh} from './planning-ghost.mjs';
import {SelectionRings} from './selection-rings.mjs';
import {visibilityDepth,prepareVisibilityShapes} from './visibility-depth.mjs';
import {vehicleName} from './vehicle-names.mjs';
import {ViewshedSurface} from './viewshed-surface.mjs';
import {pickObservationSurface} from './observation-surface.mjs';
import {observerPoint} from './visibility-volume.mjs';
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
export const json=assetJson;
const pause=()=>new Promise(r=>setTimeout(r,0));
export class PlanningScene {
  constructor(container,status){this.container=container;this.status=status;this.scene=new T.Scene();this.selectionRings=new SelectionRings(this.scene);this.renderer=new T.WebGLRenderer({antialias:true});this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));this.renderer.outputColorSpace=T.SRGBColorSpace;container.prepend(this.renderer.domElement);this.camera=new T.PerspectiveCamera(45,1,.3,90000);this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=true;this.controls.dampingFactor=.12;this.controls.maxPolarAngle=Math.PI*.48;this.controls.minDistance=3;this.controls.screenSpacePanning=false;this.controls.enableZoom=false;this.keys=new Set();this.lang="ru";this.lastFrame=0;this.controls.mouseButtons={LEFT:null,MIDDLE:T.MOUSE.PAN,RIGHT:T.MOUSE.ROTATE};this.ray=new T.Raycaster();this.actors=[];this.overlays=new Map();this.drapes=new Map();this.zoneShapes=new Map();this.nativeTiles=new Map();this.modelCache=new Map();this.collisionTiles=new Map();this.waypoints=new Map();this.lastStream=0;this.resize=new ResizeObserver(()=>{const w=Math.max(1,container.clientWidth),h=Math.max(1,container.clientHeight);this.renderer.setSize(w,h);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();});this.resize.observe(container);this.installNavigation();this.renderer.setAnimationLoop(t=>this.render(t));}
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
    this.environment=new Environment(this.scene,catalog,this.world,this.half,(x,y)=>this.height(x,y));
    // Warm topology in the existing worker as camera resources arrive. This does
    // not fetch extra tiles, change the accepted geometry, or delay drawing.
    this.environment.prepareModel=model=>{prepareVisibilityShapes([{geometry:model.geometry,material:model.materials,userData:{category:model.meta.category}}]).catch(console.warn);};
    await this.environment.loadBuildings();
    this.environment.setMissionObjects(true);this.missionMeshes=[];
    const byId=new Map((mission.planningScene||[]).map(o=>[o.id,o]));
    const units=[];
    for(const group of mission.groups)for(const u of group.units)units.push({...u,groupId:group.id,side:group.side,groupLabel:group.callSign,label:group.callSign+' · '+shortRole(u.roleDescription||u.vehicleClass,this.lang),mobility:'foot'});
    for(const v of mission.vehicles)units.push({...v,label:v.customName||v.description||v.vehicleClass,mobility:/tank|bmp|bmd|m113|mtlb|t72|t80|t90|abrams|bradley/i.test(v.vehicleClass)?'tracked':'wheeled'});
    for(const u of units){const ref=this.nativeCatalog.parameters[u.vehicleClass.toLowerCase()];u.mobility=u.groupId!=null?'foot':ref?.mobility||(/ammobox|crate|wreck|mash|static|dshkm|zu23|2b14|mortar/i.test(u.vehicleClass)?'static':/uh60|mi8|heli|plane|su25|a10/i.test(u.vehicleClass)?'air':u.mobility);u.capacity=ref?.capacity;for(const k of ['cargoSpace','cargoSize','cargoEnabled','cargoLoadable'])u[k]=ref?.[k];u.displayNames=ref?.displayNames;u.displayName=ref?.displayName;u.gameplay=ref?.gameplay;u.parameterSource=ref?'Конфиги вашей сборки':'Оценка: конфиги сборки ещё не подготовлены';u.speedProfile=configuredProfile(ref,u.mobility);}
    this.labels=new ActorLabels(document.getElementById('labels'),id=>this.onSelect?.([id]),ids=>this.onSelect?.(ids));this.selectedIds=[];this.units=units.filter(u=>u.position?.length===3).map(u=>({...u,point:sqmPoint(u.position),start:sqmPoint(u.position),angles:byId.get(u.id)?.angles||[0,u.directionDegrees*Math.PI/180,0]}));
    for(const u of this.units)if(u.mobility!=='foot'){const side=initialVehicleSide(u,this.units);if(side!==u.side){u.side=side;u.sideSource='nearest-starting-group';}}
    const unitIds=new Set(this.units.map(u=>u.id));
    const scenery=(mission.planningScene||[]).filter(o=>!unitIds.has(o.id));
    let done=0,missing=0;
    const starting=this.units[0]?.point||[this.half,this.half,0],items=[...this.units,...scenery.map(o=>({...o,point:sqmPoint(o.position),label:o.description||o.vehicleClass,scenery:true}))];
    items.sort((a,b)=>Math.hypot(a.point[0]-starting[0],a.point[1]-starting[1])-Math.hypot(b.point[0]-starting[0],b.point[1]-starting[1]));
    this.environment.update(this.vec(starting),700,'high').catch(console.warn);
    await mapLimited(items,4,async u=>{
      try{await this.addActor(u);}catch(e){this.addPlaceholder(u);missing++;console.warn('Mission model',u.vehicleClass,e.message);}
      if(++done%8===0){this.status(`Объекты миссии: ${done} / ${this.units.length+scenery.length}`);await pause();}
    });
    this.missing=missing;this.labelsDirty=true;this.drawZones(mission.markers);const first=this.units[0]?.point||[this.half,this.half,terrain.maxHeight];this.focus(first,700);
    this.ready=true;this.status(`Сцена готова. Не найдено моделей: ${missing}. Пунктирные метки обозначают заменители.`);
  }
  async actorModel(key,native=false){return cachedRequest(this.modelCache,(native?'native:':'base:')+key,async()=>{const meta=(native?this.nativeCatalog:this.actorCatalog).models[key],raw=await json(meta.file),d=!native&&key===this.actorCatalog.infantry?armedInfantry(raw):raw,g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(d.aimPositions||d.positions,3));g.setIndex(d.indices);if(d.uvs)g.setAttribute('uv',new T.Float32BufferAttribute(d.uvs,2));g.computeVertexNormals();for(const r of d.groups||[])g.addGroup(r.start,r.count,r.materialIndex);
    const created=[];try{const mats=await mapLimited(d.materials||[{}],3,async m=>{let map;if(m.texture){map=await cachedRequest(this.actorTextures??=new Map(),m.texture,()=>retryAsset(async()=>{const texture=await new T.TextureLoader().loadAsync(m.texture);texture.colorSpace=T.SRGBColorSpace;return texture;}));}const color=Array.isArray(m.color)?new T.Color(...m.color):m.color||0xffffff,material=sceneryMaterial({...map?{map}:{},color,side:T.DoubleSide,alphaTest:m.alphaTest||0});created.push(material);return material;});return {g,mats:d.groups?.length?mats:mats[0]};}catch(error){g.dispose();for(const m of created)m.dispose();throw error;}});}
  async addActor(u){const nativeKey=this.nativeCatalog.classes[u.vehicleClass.toLowerCase()],native=u.mobility!=='foot'&&!!this.nativeCatalog.models[nativeKey];const key=u.mobility==='foot'?this.actorCatalog.infantry:(native?nativeKey:null)||this.actorCatalog.classes[u.vehicleClass];let mesh;
    if(key){const {g,mats}=await this.actorModel(key,native);let materials=mats;if(u.mobility==='foot'){materials=[mats].flat().map(mat=>{const m=mat.clone();m.color.set(sideColor(u.side));tintMaterial(m,false);clipObserverObjects(m);return m;});if(!Array.isArray(mats))materials=materials[0];}mesh=new T.Mesh(g,materials);}
    else {const id=Object.entries(this.catalog.models).find(([,m])=>m?.classes?.includes(u.vehicleClass)||m?.className===u.vehicleClass)?.[0];if(id==null)throw Error('Нет сопоставления класса');const m=await this.environment.model(id);mesh=new T.Mesh(m.geometry,m.materials);}
    mesh.userData.category=u.scenery?'building':u.mobility==='static'&&!gameplayObject(u)?'building':null;this.placeActor(u,mesh,false);
  }
  addPlaceholder(u){const g=u.mobility==='foot'?new T.CapsuleGeometry(.3,1,4,6):new T.BoxGeometry(2,1.4,3);const mesh=new T.Mesh(g,clipObserverObjects(new T.MeshLambertMaterial({color:0xdd9b48,wireframe:true})));this.placeActor(u,mesh,true);}
  placeActor(u,mesh,missing){mesh.position.copy(this.vec(u.point));if(missing)mesh.position.y+=.8;const a=u.angles||[0,0,0];mesh.rotation.set(-a[0]||0,-a[1]||0,a[2]||0,'XZY');mesh.userData.unit=u;u.mesh=mesh;u.missing=missing;this.scene.add(mesh);if(u.scenery)this.missionMeshes.push(mesh);else{
    this.labels.add({id:u.id});u.labelNode=this.labels.nodes.get(u.id).el;u.labelNode.dataset.unitid=u.id;this.actors.push(mesh);this.updateActor(u);}}
  updateActor(u){const p=[...u.point],floor=this.surfaceHeight(p[0],p[1]),a=u.angles||[0,0,0];u.mesh.rotation.set(-a[0]||0,-a[1]||0,a[2]||0,'XZY');u.mesh.updateMatrix();if(!u.mesh.geometry.boundingBox)u.mesh.geometry.computeBoundingBox();const bottom=u.mesh.geometry.boundingBox.clone().applyMatrix4(new T.Matrix4().makeRotationFromEuler(u.mesh.rotation)).min.y;
    p[2]=Math.max(p[2],floor-bottom+.04);u.mesh.position.copy(this.vec(p));if(u.missing)u.mesh.position.y+=.8;u.mesh.visible=u.carrier==null&&rosterVisible(u,this.visibleSide);u.mesh.updateMatrixWorld(true);this.labelsDirty=true;}

  focusUnits(ids){const units=this.units.filter(u=>ids.includes(u.id));if(!units.length)return;this.leaveEye();const p=units.reduce((a,u)=>a.map((v,i)=>v+u.point[i]/units.length),[0,0,0]),spread=Math.max(...units.map(u=>Math.hypot(u.point[0]-p[0],u.point[1]-p[1])));this.focus(p,Math.max(35,spread*2.5));}
  focus(p,d=150){this.controls.target.copy(this.vec(p));this.camera.position.copy(this.vec(p)).add(new T.Vector3(0,d*.7,d));this.controls.update();}
  eye(p,h=1.7){if(!this.savedCamera)this.savedCamera={p:this.camera.position.clone(),t:this.controls.target.clone(),fov:this.camera.fov};const direction=this.controls.target.clone().sub(this.camera.position).normalize();this.eyePoint={point:[...p],height:h,yaw:Math.atan2(direction.x,-direction.z),pitch:0};this.controls.enabled=false;this.container.classList.add('eye-mode');this.viewshed.presentation(false);this.cursor(null);observerObjectRange.value=this.environment.observerRange=Number(this.mission.wmtSettings?.viewDistance)||3000;if(!this.optics)this.optics=new EyeOptics(this.container,{leave:()=>this.leaveEye(),zoom:value=>{this.eyeZoom=value;this.camera.fov=zoomFov(this.savedCamera.fov,value);this.camera.updateProjectionMatrix();}});this.eyeZoom=1;this.camera.fov=this.savedCamera.fov;this.camera.updateProjectionMatrix();this.optics.show(h===2.3,this.nativeCatalog.optics,this.savedCamera.fov);this.maintainCamera();}
  leaveEye(){if(!this.savedCamera)return;this.eyePoint=null;this.eyeDrag=null;this.optics?.hide();this.container.classList.remove('eye-mode');this.viewshed.presentation(true);observerObjectRange.value=0;this.environment.observerRange=undefined;this.camera.fov=this.savedCamera.fov;this.camera.updateProjectionMatrix();this.controls.enabled=true;this.camera.position.copy(this.savedCamera.p);this.controls.target.copy(this.savedCamera.t);this.savedCamera=null;const damp=this.controls.enableDamping;this.controls.enableDamping=false;this.controls.update();this.controls.enableDamping=damp;}
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
  pick(e,{surfaces=e.button===2}={}){const r=this.renderer.domElement.getBoundingClientRect();this.ray.setFromCamera(new T.Vector2((e.clientX-r.left)/r.width*2-1,1-(e.clientY-r.top)/r.height*2),this.camera);const objects=this.ray.intersectObjects(this.actors.filter(a=>a.visible),false),terrain=this.terrainHit(),surface=surfaces?pickObservationSurface(this.ray,terrain,[...this.missionMeshes,...[...this.environment.buildingBatches.values()].flat()]):[terrain,...this.ray.intersectObjects(this.missionMeshes,false)].filter(Boolean).sort((a,b)=>a.distance-b.distance)[0];let unit=objects[0]?.object.userData.unit;if(surfaces&&surface&&objects[0]?.distance>surface.distance+.1)unit=null;
    if(!unit&&!surfaces){let best=12;for(const u of this.units){if(!u.mesh.visible||!gameplayObject(u))continue;const v=u.mesh.position.clone().project(this.camera),d=Math.hypot((v.x*.5+.5)*r.width-(e.clientX-r.left),(-v.y*.5+.5)*r.height-(e.clientY-r.top));if(v.z>=-1&&v.z<=1&&d<best){best=d;unit=u;}}}
    return {unit,point:surface?this.map(surface.point):null};}
  cursor(p){if(this.eyePoint)p=null;if(!this.cursorMesh){this.cursorMesh=new T.Mesh(new T.RingGeometry(.7,1,32),new T.MeshBasicMaterial({color:0xffefab,side:T.DoubleSide,depthTest:false,transparent:true,opacity:.85}));this.cursorMesh.rotation.x=-Math.PI/2;this.cursorMesh.renderOrder=30;this.scene.add(this.cursorMesh);}this.cursorMesh.visible=!!p;if(p){this.cursorMesh.position.copy(this.vec(p));this.cursorMesh.position.y+=.12;const scale=Math.max(.35,this.camera.position.distanceTo(this.cursorMesh.position)*.008);this.cursorMesh.scale.setScalar(scale);}}
  installNavigation(){const blocked=e=>e?.target?.closest?.('input,select,textarea,dialog')||document.querySelector('dialog[open]');addEventListener('keydown',e=>{if(this.eyePoint&&!e.target?.closest?.('input,textarea')&&this.optics?.key(e))return;if(blocked(e)||e.ctrlKey||e.altKey)return;if(e.code==='Escape'&&this.eyePoint){this.leaveEye();return;}if(['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyZ','ShiftLeft','ShiftRight'].includes(e.code)){e.preventDefault();this.keys.add(e.code);}});addEventListener('keyup',e=>this.keys.delete(e.code));addEventListener('blur',()=>{this.keys.clear();this.eyeDrag=null;});
    const canvas=this.renderer.domElement;canvas.addEventListener('pointerdown',e=>{if(!this.eyePoint||e.button!==2)return;e.preventDefault();e.stopImmediatePropagation();this.eyeDrag={x:e.clientX,y:e.clientY,id:e.pointerId};canvas.setPointerCapture(e.pointerId);},true);canvas.addEventListener('pointermove',e=>{if(!this.eyePoint||!this.eyeDrag)return;e.preventDefault();e.stopImmediatePropagation();this.eyePoint.yaw+=(e.clientX-this.eyeDrag.x)*(.004/Math.sqrt(this.eyeZoom||1));this.eyePoint.pitch=T.MathUtils.clamp(this.eyePoint.pitch-(e.clientY-this.eyeDrag.y)*(.004/Math.sqrt(this.eyeZoom||1)),-Math.PI/2+.02,Math.PI/2-.02);this.eyeDrag.x=e.clientX;this.eyeDrag.y=e.clientY;this.maintainCamera();},true);canvas.addEventListener('pointerup',e=>{if(!this.eyeDrag)return;e.preventDefault();e.stopImmediatePropagation();this.eyeDrag=null;canvas.releasePointerCapture(e.pointerId);},true);canvas.addEventListener('pointercancel',()=>this.eyeDrag=null);canvas.addEventListener('contextmenu',e=>{if(this.eyePoint){e.preventDefault();e.stopImmediatePropagation();}},true);
    this.container.addEventListener('wheel',e=>{if(!this.ready||e.target.closest('#sceneTools,#sceneMenu,.waypoint-label,#plannerRoster,#eyeControls'))return;e.preventDefault();e.stopImmediatePropagation();if(this.eyePoint){if(Math.abs(e.deltaY)>0&&(performance.now()-(this.lastEyeWheel||0)>80)){this.lastEyeWheel=performance.now();this.optics.step(e.deltaY<0?1:-1);}return;}this.pick(e);const hit=this.terrainHit(),anchor=hit?hit.point:this.controls.target.clone(),distance=this.camera.position.distanceTo(anchor),delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?500:1),factor=T.MathUtils.clamp(Math.exp(T.MathUtils.clamp(delta,-250,250)*.0018),3/Math.max(3,distance),this.terrain.worldSize*2/Math.max(3,distance));this.camera.position.sub(anchor).multiplyScalar(factor).add(anchor);this.controls.target.sub(anchor).multiplyScalar(factor).add(anchor);this.maintainCamera();this.controls.update();},{passive:false,capture:true});}
  maintainCamera(){if(this.eyePoint){const e=this.eyePoint,p=e.point;this.camera.position.copy(this.vec([p[0],p[1],Math.max(p[2],this.surfaceHeight(p[0],p[1]))+e.height]));this.controls.target.copy(this.camera.position).addScaledVector(eyeDirection(e.yaw,e.pitch),30);this.camera.lookAt(this.controls.target);return;}for(const [v,offset]of [[this.camera.position,1.5],[this.controls.target,.7]]){const h=this.surfaceHeight(v.x+this.half,this.half-v.z);if(Number.isFinite(h))v.y=Math.max(v.y,h+offset);}this.camera.lookAt(this.controls.target);}
  moveCamera(dt){if(this.eyePoint)return;if(document.activeElement?.matches('input,select,textarea'))return;const k=this.keys,forward=this.controls.target.clone().sub(this.camera.position).setY(0).normalize(),right=new T.Vector3(-forward.z,0,forward.x),move=new T.Vector3();if(k.has('KeyW'))move.add(forward);if(k.has('KeyS'))move.sub(forward);if(k.has('KeyD'))move.add(right);if(k.has('KeyA'))move.sub(right);const ground=this.surfaceHeight(this.camera.position.x+this.half,this.half-this.camera.position.z),v=T.MathUtils.clamp(navigationDistance(this.camera.position,this.controls.target,ground)*.65,8,1800);move.normalize().multiplyScalar(dt*v*(k.has('ShiftLeft')||k.has('ShiftRight')?3:1));move.y=(Number(k.has('KeyQ'))-Number(k.has('KeyZ')))*dt*v;this.camera.position.add(move);this.controls.target.add(move);}

  waypoint(id,p,text,onClick){let w=this.waypoints.get(id);if(!w){const el=document.createElement('button');el.className='waypoint-label';this.container.append(el);w={el};this.waypoints.set(id,w);}w.el.dataset.waypoint=id;Object.assign(w,{p,text});w.el.textContent=text;w.el.onclick=onClick;}
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
      const p=[m.x,m.y,h];this.waypoint(id,p,m.text||def?.name||'Метка',()=>onClick(p,m));
      const el=this.waypoints.get(id).el;el.classList.add('plan-marker');el.style.setProperty('--marker-color',color);
      const asset=markerAssets[String(m.icon||def?.id||'').toLowerCase()];if(asset){const icon=document.createElement('span');icon.className='plan-marker-icon';icon.style.maskImage='url('+asset+')';icon.style.webkitMaskImage='url('+asset+')';el.prepend(icon);}
    }
    this.zoneTint.set([...this.zoneShapes.values()]);
  }
  surfaceHeight(x,y){return this.detail?.height(x,y)??terrainHeight(this.terrain,x,y);}
  terrainGrids(){const size=this.terrain.worldSize;return [{bounds:[0,0,size,size],step:size/(this.terrain.resolution-1)},...(this.detail?.patch?[{bounds:this.detail.patch.box,step:this.detail.patch.step}]:[])];}
  line(id,points,color=0x6ee7b7,{air=false}={}){
    const group=new T.Group(),geometry=new T.BufferGeometry(),wide=/^(route:|manual)/.test(id)?new RouteLine(color):null,line=wide||new T.Line(geometry,new T.LineBasicMaterial({color,depthTest:true,depthWrite:false}));line.renderOrder=4;group.add(line);
    this.overlay(id,group);this.drapes.set(id,{points:points.map(p=>air?[...p]:p.slice(0,2)),air,geometry,wide,patch:null});this.refreshDrape(id,true);
  }
  refreshDrape(id,rebuild=false){
    const d=this.drapes.get(id);if(!d)return;const patch=this.detail?.patch;
    if(rebuild||d.patch!==patch||!d.xy){d.xy=d.air?d.points:drapePath(d.points,this.terrainGrids(),(x,y)=>this.surfaceHeight(x,y));d.geometry.setAttribute('position',new T.Float32BufferAttribute(new Float32Array(d.xy.length*3),3));d.patch=patch;}
    const attr=d.geometry.attributes.position;
    d.xy.forEach(([x,y,z],i)=>attr.setXYZ(i,x-this.half,d.air?z:this.surfaceHeight(x,y)+.25,this.half-y));attr.needsUpdate=true;d.geometry.computeBoundingSphere();if(d.wide)d.wide.setPoints(d.xy.map(([x,y,z])=>new T.Vector3(x-this.half,d.air?z:this.surfaceHeight(x,y)+.25,this.half-y)));
  }
  refreshDrapes(){if(!this.drapesDirty)return;for(const id of this.drapes.keys())this.refreshDrape(id);this.drapesDirty=false;}

  overlay(id,object){if(this.drapes.get(id)?.wide)this.drapes.get(id).geometry.dispose();this.drapes.delete(id);const prev=this.overlays.get(id);if(prev){this.scene.remove(prev);prev.traverse(o=>{o.geometry?.dispose();if(o.material)o.material.dispose();});}if(object){this.overlays.set(id,object);this.scene.add(object);}else this.overlays.delete(id);}
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
    return this.loadedSceneSnapshot();
  }
  loadedSceneSnapshot(){const env=this.environment;
    // A camera may unload its visual tiles. Keep already observed occluders for
    // active sight points: unloading must not make their position unknown again.
    this.sightTiles??=new Map();
    for(const [key,meshes]of [...env.buildingBatches,...env.natureBatches])this.sightTiles.set(key,meshes);
    const areas=[...(this.sightAreas||[]),this.sightRequestArea].filter(Boolean);
    for(const [key,meshes]of this.sightTiles)if(meshes.length&&areas.length&&!meshes.some(mesh=>{const b=mesh.userData.groundBounds;if(!b)return true;return areas.some(a=>{const x=Math.max(b[0],Math.min(b[2],a.point[0])),y=Math.max(b[1],Math.min(b[3],a.point[1]));return Math.hypot(x-a.point[0],y-a.point[1])<=a.radius+64;});}))this.sightTiles.delete(key);
    const meshes=[...new Set([...this.sightTiles.values()].flat()),...this.missionMeshes];
    for(const mesh of meshes)mesh.updateMatrixWorld(true);
    const missing=[...(env.buildingTiles||[]),...env.world.chunks].filter(t=>!this.sightTiles.has(t.file));
    return {meshes,missing,step:env.world.tileSize};
  }
  sightTerrain(p){
    // A stable detailed patch belongs to the observation, not to the camera.
    // Reuse it after zooming away. It is sampled into the normal terrain material.
    this.sightTerrainPatches??=new Map();const detail=this.detail;
    if(detail.mesh&&detail.blend.value===1&&detail.contains(p[0],p[1])){const key=detail.mesh.geometry.id;if(!this.sightTerrainPatches.has(key)){
      const mesh=new T.Mesh(detail.mesh.geometry.clone());mesh.matrix.copy(detail.mesh.matrixWorld);mesh.matrixAutoUpdate=false;
      const patch={...detail.patch,previous:null};this.sightTerrainPatches.set(key,{mesh,bounds:detail.bounds.clone(),box:[...patch.box],height:(x,y)=>detail.height.call({patch,blend:{value:1},contains:detail.contains,coarse:detail.coarse},x,y)});
      while(this.sightTerrainPatches.size>8){const key=this.sightTerrainPatches.keys().next().value;this.sightTerrainPatches.get(key).mesh.geometry.dispose();this.sightTerrainPatches.delete(key);}
    }}
    const match=[...this.sightTerrainPatches.values()].reverse().find(t=>p[0]>t.box[0]&&p[0]<t.box[2]&&p[1]>t.box[1]&&p[1]<t.box[3]);
    return match?{detail:match.mesh,bounds:match.bounds,blend:1,height:match.height}:{detail:null,bounds:new T.Vector4(1,1,-1,-1),blend:1};
  }
  async visibility(p,eye,radius,token,preview=false){
    const started=performance.now();radius=Number(radius);this.sightRequestArea={point:p,radius};if(!(radius>0&&radius<=50000))throw Error('Некорректная дальность обзора');
    const terrain=this.sightTerrain(p),snapshot=preview||token.snapshotOnly?this.loadedSceneSnapshot():await this.visibleSceneSnapshot(),from=observerPoint(p,eye,(x,y)=>this.surfaceHeight(x,y)),origin=this.vec(from);if(terrain.height)origin.y=Math.max(p[2],terrain.height(p[0],p[1]))+eye;
    const unknownBoxes=snapshot.missing.map(t=>new T.Box3(new T.Vector3(t.x*snapshot.step-this.half,-1e7,this.half-(t.y+1)*snapshot.step),new T.Vector3((t.x+1)*snapshot.step-this.half,1e7,this.half-t.y*snapshot.step)));
    const known=snapshot.meshes.filter(m=>!m.userData.unit?.missing);const crowns=[...new Set(known.filter(m=>['tree','bush'].includes(m.userData.category)).map(m=>m.geometry))];this.container.dataset.sightNativeCrowns=String(crowns.filter(g=>g.userData.visibilityModel).length);this.container.dataset.sightFallbackCrowns=String(crowns.filter(g=>!g.userData.visibilityModel).length);
    for(const mesh of snapshot.meshes.filter(m=>m.userData.unit?.missing)){mesh.geometry.computeBoundingBox();unknownBoxes.push(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld).expandByScalar(5));}
    await prepareVisibilityShapes(known);if(token.cancelled)return null;
    this.calculatingVisibility=true;
    try{if(!preview)await pause();const result=visibilityDepth(this.renderer,{origin,radius,meshes:known,ground:this.ground,...terrain,unknown:unknownBoxes,size:1024,objectsOnly:true});
      if(token.cancelled){if(!result.pooled)result.target.dispose();return null;}const projected=projectVisibility(this.renderer,result,{ground:this.ground,...terrain,size:3072});this.container.dataset.sightMs=(performance.now()-started).toFixed(0);this.container.dataset.sightResolution='1024 / 3072';this.container.dataset.sightMode=preview?'drag':'full';this.container.dataset.sightIncomplete=String(result.incomplete);this.container.dataset.sightUnknown=String(result.fullyUnknown);this.container.dataset.sightRetainedTiles=String(this.sightTiles.size);this.container.dataset.sightPrepareMs=result.prepareMs.toFixed(1);this.container.dataset.sightSubmitMs=result.submitMs.toFixed(1);if(preview)this.container.dataset.sightDragMs=(performance.now()-started).toFixed(0);return projected;
    }finally{this.calculatingVisibility=false;}
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
    for(const u of this.units)if(u.carrier!=null&&u.mobility==='foot'){if(!crews.has(u.carrier))crews.set(u.carrier,[]);crews.get(u.carrier).push(u.id);}
    for(const u of this.units){
      const infantry=u.mobility==='foot',ref=this.nativeCatalog.parameters[u.vehicleClass.toLowerCase()];
      const tag=String(this.assignments?.[u.id]||'').trim().replace(/[\[\]]/g,'');
      const base=infantry?shortRole(u.roleDescription||u.vehicleClass,this.lang):vehicleName(u,this.lang);
      entities.set(u.id,{id:u.id,name:(tag?'['+tag+'] · ':'')+base,group:u.groupLabel||String(u.groupId??''),type:infantry?'unit':'vehicle',category:u.mobility,className:u.vehicleClass,side:u.side,planning:true,planningTag:tag});
      positions.set(u.id,[0,u.point[0],u.point[1],0,1,u.carrier!=null?1:infantry?0:(crews.get(u.id)||[])]);
      // Supplies and scenery remain selectable on the model, without a vehicle
      // roster marker on every ammunition box. Selected objects are still named.
      const decoration=!gameplayObject(u);
      if((u.mesh.visible||u.carrier!=null&&u.mobility==='foot')&&(!decoration||this.selectedIds.includes(u.id)))drawn.set(u.id,{position:u.mesh.position,height:infantry?1.8:2.5,carrier:u.carrier});
    }
    this.labelState={entities,positions,drawn};this.labelsDirty=false;if(!this.roster)this.roster=new UnitRoster(this.container,{select:ids=>this.onRosterSelect?.(ids),focus:ids=>this.focusUnits(ids),side:value=>this.onRosterSide?.(value)});this.roster.update(this.units,this.visibleSide,this.selectedIds,this.lang,this.assignments);
  }
  render(t){if(!this.ready||!this.container.clientWidth||!this.container.clientHeight)return;this.moveCamera(Math.min(.05,(t-(this.lastFrame||t))/1000));this.lastFrame=t;if(!this.eyePoint)this.controls.update();this.maintainCamera();if(!this.calculatingVisibility&&!this.draggingSight&&t-this.lastStream>250){this.lastStream=t;this.environment.update(this.controls.target,this.camera.position.distanceTo(this.controls.target),'high').catch(console.warn);this.detail.update(this.camera.position,false,true)?.catch?.(console.warn);this.roads.update(this.camera.position,this.controls.target,this.camera.position.distanceTo(this.controls.target));}this.environment.tick?.(t);this.detail.tick(t);if(this.actorsDirty){for(const u of this.units)this.updateActor(u);this.actorsDirty=false;}this.refreshDrapes();this.roads.tick(t);
    if(t-(this.lastSightCheck||0)>500){this.lastSightCheck=t;this.container.dataset.sightLayers=String(this.viewshed.layers.size);this.container.dataset.sightPresentation=String(!this.viewshed.presentationHidden);this.container.dataset.objectRange=String(this.environment.observerRange||0);const signature=[this.detail.mesh?.geometry.id,this.detail.blend.value===1,...this.environment.buildingBatches.keys(),...this.environment.natureBatches.keys()].join(':');if(signature!==this.sightSignature){this.sightSignature=signature;this.sightChanged=t;if(this.viewshed.layers.size){this.visibilityRefreshPending=true;}}if(!this.draggingSight&&this.visibilityRefreshPending&&t-this.sightChanged>900&&this.detail.blend.value===1&&!this.detail.pendingKey)this.refreshVisibility?.();}
    this.scene.updateMatrixWorld();this.camera.updateMatrixWorld();this.environment.shared.visibility.update(this.environment.shared.groups,this.camera);
    const w=this.container.clientWidth,h=this.container.clientHeight;if(this.labelsDirty||t-(this.lastRings||0)>100){this.lastRings=t;this.selectionRings.update(this.units,this.previewSelectedIds||this.selectedIds,{height:(x,y)=>this.surfaceHeight(x,y),half:this.half,camera:this.camera,viewportHeight:h,revision:String(this.detail.generation)+':'+this.detail.blend.value});}if(this.labelsDirty||!this.labelState)this.rebuildLabelState();const {entities,positions,drawn}=this.labelState;
    this.labels.update({frame:0,viewport:{width:w,height:h},drawn,entities,positions,camera:this.camera,selected:this.selectedIds[0]??null,inspectedIds:this.selectedIds,enabled:true,sideColor:side=>({WEST:0x2389c5,EAST:0xe04c4c,GUER:0x35b46f,INDEPENDENT:0x35b46f}[side]||0xa9a365),entitySide:e=>e.side?.toUpperCase(),distance:this.controls.getDistance(),grouping:false});
    const hasRoutes=[...this.waypoints].some(([key,w])=>key.startsWith('route')&&!w.hidden);
    if(hasRoutes&&(!this.occupiedLabels||t-(this.lastLabelMeasure||0)>100)){this.lastLabelMeasure=t;const rect=this.container.getBoundingClientRect();this.occupiedLabels=[...this.container.querySelectorAll('.actor-label:not([hidden])')].map(el=>{const r=el.getBoundingClientRect();return {left:r.left-rect.left,right:r.right-rect.left,top:r.top-rect.top,bottom:r.bottom-rect.top};});}
    const occupied=hasRoutes?[...(this.occupiedLabels||[])]:[];
    for(const [key,wpt]of this.waypoints){const v=this.vec(wpt.p).project(this.camera);wpt.el.hidden=wpt.hidden||!wpt.alwaysVisible&&(v.z< -1||v.z>1);if(wpt.el.hidden)continue;let x=(v.x*.5+.5)*w,top=(-v.y*.5+.5)*h-50;if(wpt.alwaysVisible){if(v.z>1){x=w-x;top=h-top;}x=Math.max(110,Math.min(w-110,x));top=Math.max(155,Math.min(h-65,top));}if(key.startsWith('route')){const width=wpt.el.offsetWidth,height=wpt.el.offsetHeight,y=waypointTop(x,top-height*1.3,width,height,occupied);top=y+height*1.3;occupied.push({left:x-width/2,right:x+width/2,top:y,bottom:y+height});}wpt.el.style.left=x+'px';wpt.el.style.top=top+'px';}if(this.rulerGroup?.mid&&!this.rulerGroup.label.hidden){const v=this.rulerGroup.mid.clone().project(this.camera),el=this.rulerGroup.label;el.style.left=(v.x*.5+.5)*w+'px';el.style.top=(-v.y*.5+.5)*h+'px';el.style.visibility=v.z>=-1&&v.z<=1?'visible':'hidden';}this.onFrame?.();this.renderer.render(this.scene,this.camera);}
}
