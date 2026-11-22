// A marker owns pointer capture. Orbit controls never receive these gestures.
// Sight uses the latest dragged position; route reconstruction commits on release.
export function markerGestures(view,scene,{blocked,context,move,preview,endPreview}){
 let drag=null,suppress=null;
 const editable=e=>{const el=e.target.closest('.waypoint-label'),key=el?.dataset.waypoint;return key&&/^(view|route|routegroup|plan-marker(?!:mission)):/.test(key)?{el,key}:null;};
 const cancel=(restore=true)=>{if(drag){const w=scene.waypoints.get(drag.key);if(w&&restore)w.p=drag.original;drag.el.classList.remove('dragging');try{drag.el.releasePointerCapture(drag.pointer);}catch{}}drag=null;scene.cursor(null);endPreview?.(restore);};
 view.addEventListener('pointerdown',e=>{const m=editable(e);if(!m||blocked())return;e.stopImmediatePropagation();if(e.button!==0)return;
  const w=scene.waypoints.get(m.key),v=scene.vec(w.surfacePoint||w.p).project(scene.camera),r=view.getBoundingClientRect();
  drag={...m,original:[...w.p],x:e.clientX,y:e.clientY,offsetX:r.left+(v.x*.5+.5)*r.width-e.clientX,offsetY:r.top+(-v.y*.5+.5)*r.height-e.clientY,pointer:e.pointerId};m.el.setPointerCapture(e.pointerId);
 },true);
 view.addEventListener('pointermove',e=>{if(!drag)return;e.stopImmediatePropagation();if(!drag.moved&&Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<6)return;
  const p=scene.pick({clientX:e.clientX+drag.offsetX,clientY:e.clientY+drag.offsetY},{surfaces:drag.key.startsWith('view:')}).point;if(!p)return;
  drag.moved=true;drag.point=p;drag.el.classList.add('dragging');const w=scene.waypoints.get(drag.key);if(w)w.p=w.observerHeight?[p[0],p[1],p[2]+w.observerHeight]:p;scene.cursor(p);preview?.(drag.key,p);
 },true);
 view.addEventListener('pointerup',e=>{if(!drag||e.button!==0)return;e.stopImmediatePropagation();const d=drag;cancel(false);if(d.moved&&d.point){suppress={key:d.key,until:performance.now()+600};move(d.key,d.point,d.original);}},true);
 view.addEventListener('click',e=>{const m=editable(e);if(m&&suppress?.key===m.key&&performance.now()<suppress.until){e.preventDefault();e.stopImmediatePropagation();suppress=null;}},true);
 view.addEventListener('contextmenu',e=>{const m=editable(e);if(!m)return;e.preventDefault();e.stopImmediatePropagation();if(!blocked())context(m.key);},true);
 view.addEventListener('pointercancel',cancel,true);addEventListener('blur',cancel);return cancel;
}
