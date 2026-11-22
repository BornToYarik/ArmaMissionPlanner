import * as T from './wog/vendor/three.module.js';
export function eyeDirection(yaw,pitch){const p=T.MathUtils.clamp(pitch,-Math.PI/2+.02,Math.PI/2-.02);return new T.Vector3(Math.sin(yaw)*Math.cos(p),Math.sin(p),-Math.cos(yaw)*Math.cos(p));}
