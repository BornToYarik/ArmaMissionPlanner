export type MapUnitIcon='man'|'car'|'truck'|'apc'|'tank'|'heli'|'plane'|'sea'|'parachute'|'static-weapon'|'static-mortar';
// Classify the symbol only; movement/capacity still come from Arma configuration.
export function unitMapIcon(unit:{mobility:string;vehicleClass?:string;name?:string},sourceModel=''):MapUnitIcon{
 if(unit.mobility==='foot')return 'man';
 const s=`${unit.vehicleClass||''} ${unit.name||''} ${sourceModel}`.toLowerCase();
 if(/parachute|парашют/.test(s))return 'parachute';
 if(/boat|ship|rubber|rhib|zodiac|катер|лодка/.test(s)||unit.mobility==='water')return 'sea';
 if(unit.mobility==='air')return /heli|mi[_ -]?(?:2|6|8|17|18|24|26|28|35)(?=\D|$)|ka.?[25][02]|uh.?[16]|ah.?[16]|ch.?[345]|huey|chinook|blackhawk|pawnee|hummingbird|littlebird|orca|ghosthawk|huron|hellcat|taru|м[иі]-|вертол[её]т/.test(s)?'heli':'plane';
 if(unit.mobility==='static')return /mortar|2b14|2b25|2b9|2s12|m252|m224|l16|мином[её]т|поднос|васил[её]к/.test(s)?'static-mortar':'static-weapon';
 if(/bmp|bmd|btr|brdm|mt.?lb|m113|m1126|m1127|m2a[23]|m3a[23]|m6a2|stryker|lav.?25|aav|fv432|fv510|warrior|бмп|бмд|бтр/.test(s))return 'apc';
 if(unit.mobility==='tracked'||/tank|abrams|leopard|challenger|t.?72|t.?80|t.?90|т-[5789]|танк/.test(s))return 'tank';
 if(/truck|ural|gaz.?66|kamaz|kraz|z[ií]l.?13|v3s|mtvr|hemtt|m9[23][359]|m108[34]|ural|газ.?66|урал|камаз|прага|грузов/.test(s))return 'truck';
 return 'car';
}
export function normalizedHeading(value?:number){return Number.isFinite(value)?((value!%360)+360)%360:0;}
