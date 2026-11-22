// World east is +X and world north is -Z after the OCAP -> Three transform.
export function viewAzimuth(camera,target){
 const dx=target.x-camera.x,north=camera.z-target.z;
 return (Math.atan2(dx,north)*180/Math.PI+360)%360;
}
// Screen-space anchors stay legible as their models shrink. No world displacement.
export function anchorRadius(distance,dead=false){
 const scale=Math.max(0,Math.min(1,Math.log2(1+Math.max(0,distance)/250)/5));
 return (3.2+2.4*scale)*(dead?.85:1);
}
// A close near plane is needed only near the surface or the followed subject.
// Preserve near-camera aircraft while recovering depth precision in overview.
export function cameraNear(clearance,focusDistance){
 return Math.max(.3,Math.min(1000,Math.max(0,clearance)*.05,Math.max(0,focusDistance)*.05));
}
