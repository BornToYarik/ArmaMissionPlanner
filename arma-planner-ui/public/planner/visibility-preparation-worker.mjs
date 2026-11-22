import * as T from './wog/vendor/three.module.js';
import {windowClosures} from './building-occluder.mjs';
import {foliageEnvelope} from './foliage-occluder.mjs';
self.onmessage=({data:d})=>{try{const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(d.positions,3));if(d.indices)g.setIndex(new T.BufferAttribute(d.indices,1));g.groups=d.groups;
 const value=d.category==='building'?windowClosures(g):foliageEnvelope(g,d.materials,d.category),shape=value?.geometry||value;
 const positions=shape?.attributes.position.array,indices=shape?.index?.array;self.postMessage({id:d.id,positions,indices,foliage:value?.foliage},[positions?.buffer,indices?.buffer].filter(Boolean));}
 catch(e){self.postMessage({id:d.id,error:e.message});}};
