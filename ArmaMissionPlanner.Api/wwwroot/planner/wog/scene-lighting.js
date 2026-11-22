import {clipObserverObjects} from '../object-range.mjs';
import * as THREE from './vendor/three.module.js';
// Daytime presentation presets, not reconstructed mission weather. The engine's
// HDR intensities cannot be copied verbatim into Three's diffuse lighting model.
export const worldLighting={
 altis:{sun:0xfff6e8,power:3.2,sky:0xc4d8f4,bounce:0xb4aa95,fill:.85,position:[-5000,9500,3500],horizon:0x9db7d4},
 // Author's workshop daylight reference: pale blue sky, readable cool forests.
 brf_sumava:{sun:0xfffaf4,power:3.0,sky:0xcbdff4,bounce:0xb6b5a4,fill:1.2,position:[-6000,8000,4000],horizon:0xc9dfee},
 // Rosche author's panorama: soft northern daylight and neutral crop colours.
 wl_rosche:{sun:0xfff9ef,power:3.1,sky:0xd4e1ef,bounce:0xbab5a3,fill:1.05,position:[-6000,7500,4000],horizon:0xcbdce9},
 // Installed Reshmaan CfgWorlds/DayLightingBrightAlmost/noon: 45-degree
 // sun, slightly warm near-white direct light, blue-grey ambient light.
 reshmaan:{sun:0xfffcf5,power:3.3,sky:0xd9e1ed,bounce:0xb9b9ae,fill:.95,position:[-8000,8800,3500],horizon:0xc7d1dc}
};
const fallback={sun:0xffefd8,power:3.1,sky:0xdce8ff,bounce:0x8c7d65,fill:.48,position:[-8000,5000,3500],horizon:0xc9c7b7};
export function lightScene(scene,world=''){
 const profile=worldLighting[world.toLowerCase()]||fallback;
 const fill=new THREE.HemisphereLight(profile.sky,profile.bounce,profile.fill);fill.name='Replay sky and ground fill';
 const sun=new THREE.DirectionalLight(profile.sun,profile.power);sun.name='Replay key light';sun.position.set(...profile.position);sun.castShadow=false;
 if(scene.fog)scene.fog.color.setHex(profile.horizon);
 scene.add(fill,sun);return {fill,sun,horizon:profile.horizon};
}
// Soil, roads and native terrain share a diffuse-only surface. Unlike object
// materials this cannot produce a camera-dependent sun glint at any zoom/LOD.
export function terrainMaterial(options={}){
 return new THREE.MeshLambertMaterial(options);
}
export function sceneryMaterial(options={}){
 return clipObserverObjects(new THREE.MeshPhongMaterial({shininess:12,specular:0x181816,...options}));
}
