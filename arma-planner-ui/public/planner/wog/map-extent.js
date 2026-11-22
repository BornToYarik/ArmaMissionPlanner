export const MAP_MARGIN=1000;
export function inMapExtent(x,north,size){return Number.isFinite(x)&&Number.isFinite(north)&&x>=-MAP_MARGIN&&north>=-MAP_MARGIN&&x<=size+MAP_MARGIN&&north<=size+MAP_MARGIN;}
export function mapFraction(value,size){return (value+MAP_MARGIN)/(size+2*MAP_MARGIN);}
export function mapCoordinate(fraction,size){return Math.max(0,Math.min(1,fraction))*(size+2*MAP_MARGIN)-MAP_MARGIN;}

// Eight regular grids cover only the outside ring. Heights are supplied by the
// engine export; the inner edge is sealed against the viewer's coarse terrain.
export function marginGrids(terrain,sample){
 const s=terrain.worldSize,m=MAP_MARGIN,n=Math.max(terrain.resolution,Math.ceil(s/50)+1),k=Math.ceil(m/50)+1;
 const bands=[[-m,0,k],[0,s,n],[s,s+m,k]],grids=[];
 for(let y=0;y<3;y++)for(let x=0;x<3;x++){
  if(x===1&&y===1)continue;
  const [x0,x1,columns]=bands[x],[y0,y1,rows]=bands[y],heights=new Float32Array(columns*rows);
  for(let r=0;r<rows;r++)for(let c=0;c<columns;c++)heights[r*columns+c]=sample(x0+(x1-x0)*c/(columns-1),y0+(y1-y0)*r/(rows-1));
  grids.push({worldSize:s,columns,rows,bounds:[x0,y0,x1,y1],heights});
 }
 return grids;
}
