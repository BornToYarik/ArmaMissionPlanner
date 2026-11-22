import {distance,travelTime} from './core.mjs';
export function airRoute(from,to,height,profiles){
 const n=Math.max(1,Math.ceil(distance(from,to)/20));let altitude=Math.max(from[2],to[2]);
 for(let i=0;i<=n;i++){const t=i/n,h=height(from[0]+(to[0]-from[0])*t,from[1]+(to[1]-from[1])*t);if(!Number.isFinite(h))throw Error('Неизвестна высота рельефа на линии полёта');altitude=Math.max(altitude,h+100);}
 const points=[[from[0],from[1],altitude],[to[0],to[1],altitude]];
 return {points,seconds:travelTime(points,profiles),mode:'air',airClearance:100};
}
