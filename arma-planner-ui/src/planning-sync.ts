export type PlannerCommand={id:number;action:string;ids?:number[];point?:number[];key?:string;mode?:string};
export type PlannerUnit={id:number;point:number[];side:string;name:string;groupId?:number;groupLabel?:string;mobility:string;carrier?:number|null};
export type PlannerSnapshot={units:PlannerUnit[];selected:number[];routes:{key:string;points:number[][];color:string}[];waypoints:{key:string;point:number[];text:string;color:string}[];status?:string};
