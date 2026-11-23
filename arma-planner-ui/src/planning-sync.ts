export type PlannerCommand={id:number;action:string;ids?:number[];point?:number[];key?:string;mode?:string};
export type PlannerUnit={id:number;point:number[];side:string;name:string;groupId?:number;groupLabel?:string;mobility:string;carrier?:number|null;vehicleClass?:string;heading?:number};
export type PlannerSnapshot={units:PlannerUnit[];selected:number[];routes:{key:string;points:number[][];color:string}[];waypoints:{key:string;point:number[];text:string;title?:string;time?:string;color:string}[];status?:string};
