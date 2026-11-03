export interface MissionInfo {
    name: string;
    author: string;
    overview: string;
    worldName: string;
    intel?: MissionIntel;
    wmtSettings: WmtConfig;
    briefing: BriefingSection[];
    briefingImages: string[];
    groups: SquadGroup[];
    vehicles: MissionVehicle[];
    markers: MissionMarker[];
    scriptFiles?: MissionScriptFile[];
    validationReport?: ValidationIssue[];
}

export interface MissionIntel {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    formattedDateTime: string;
    startOvercastPercent: number;
    forecastOvercastPercent: number;
    startRainPercent: number;
    forecastRainPercent: number;
    startFogPercent: number;
    forecastFogPercent: number;
    startWindPercent: number;
    forecastWindPercent: number;
}

export interface MissionScriptFile {
    path: string;
    sizeBytes: number;
    content: string;
}

export interface ValidationIssue {
    ruleNumber: string;
    category: string;
    severity: 'Ok' | 'Warning' | 'Error';
    title: string;
    details: string;
}

export interface WmtConfig {
    viewDistance: number;
    terrainViewDistance: number;
    thermalMode: string;
    heavyLossesCoeff: number;
    missionTimeMinutes: number;
    freezeTimeMinutes: number;
    startZoneSize: number;
    winnerByTimeText: string;
    capturePointWinnerText: string;
    capturePointRequiredCount: number;
    capturePoints: WmtPointInfo[];
    rawModuleAttributes: Record<string, string>;
}

export interface WmtPointInfo {
    name: string;
    marker: string;
    captureTimeSeconds: number;
    defendingSide: string;
}

export interface BriefingSection {
    title: string;
    htmlText: string;
}

export interface SquadGroup {
    id: number;
    side: string;
    callSign: string;
    squadDescription: string;
    units: SquadUnit[];
}

export interface SquadUnit {
    id: number;
    roleDescription: string;
    vehicleClass: string;
    initScript: string;
    primaryWeapon: string;
    secondaryWeapon: string;
    handgun: string;
    loadout: UnitLoadout;
    position: number[];
    directionDegrees: number;
    isPlayable: boolean;
}

export interface UnitLoadout {
    uniform: string;
    vest: string;
    backpack: string;
    headgear: string;
    goggles: string;
    weaponAttachments: string[];
    linkedItems: string[];
    itemsAndMagazines: Record<string, number>;
    uniformItems?: Record<string, number>;
    vestItems?: Record<string, number>;
    backpackItems?: Record<string, number>;
}

export interface MissionVehicle {
    id: number;
    side: string;
    vehicleClass: string;
    customName: string;
    description: string;
    initScript: string;
    position: number[];
    directionDegrees: number;
    lockStatus?: string;
    fuel?: number;
    health?: number;
    ammo?: number;
    aceCargoSpace?: number;
    aceCargoItems?: Record<string, number>;
    customAttributes?: Record<string, string>;
    cargo: VehicleCargo;
}

export interface VehicleCargo {
    weapons: Record<string, number>;
    magazines: Record<string, number>;
    items: Record<string, number>;
    backpacks: Record<string, number>;
    hasAnyCargo: boolean;
}

export interface MissionMarker {
    name: string;
    text: string;
    markerType: string;
    iconType: string;
    colorName: string;
    brushName: string;
    widthA: number;
    heightB: number;
    angle: number;
    alpha: number;
    position: number[];
}

export interface TacticalPlanMarker {
    id: string;
    text: string;
    x: number;
    y: number;
    color: string;
    swtColorIndex: number;
    swtTypeIndex: number;
}