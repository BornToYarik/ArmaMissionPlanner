import * as T from './wog/vendor/three.module.js';
import {TracerLines} from './wog/tracer-lines.js';
// Constant CSS-pixel width also works on drivers that ignore GL linewidth.
export class RouteLine extends T.Group{
 constructor(color){super();this.color=new T.Color(color);this.count=-1;}
 setPoints(points){
  const count=Math.max(0,points.length-1);
  if(count!==this.count){for(const mesh of [...this.children]){mesh.geometry.dispose();mesh.material.dispose();this.remove(mesh);}this.count=count;
   this.vertices=new Float32Array(count*6);
   for(const [color,width,order]of [[new T.Color('#17252b'),6,4],[this.color,3.5,5]]){const colors=new Float32Array(count*6);for(let i=0;i<count*2;i++)color.toArray(colors,i*3);const mesh=new TracerLines(this.vertices,colors,new Float32Array(count).fill(width));mesh.renderOrder=order;this.add(mesh);}
  }
  for(let i=0;i<count;i++){points[i].toArray(this.vertices,i*6);points[i+1].toArray(this.vertices,i*6+3);}
  for(const mesh of this.children)mesh.setCount(count);
 }
}
