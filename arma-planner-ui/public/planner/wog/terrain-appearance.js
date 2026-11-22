// Satellite albedo lacks the game's ground-detail blend. Gentle per-world
// compensation matches the daytime references without adding specular glare.
// The shader's bounded curve preserves white salt flats and crop highlights.
const exposure={altis:2.1,brf_sumava:1.4,wl_rosche:1.35,reshmaan:1};
export const terrainExposure=world=>exposure[String(world).toLowerCase()]||1;
