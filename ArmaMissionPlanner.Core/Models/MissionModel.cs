using System;
using System.Collections.Generic;

namespace ArmaMissionPlanner.Core.Models;

public class MissionInfo
{
    public string Name { get; set; } = string.Empty;
    public string Author { get; set; } = string.Empty;
    public string Overview { get; set; } = string.Empty;
    public string WorldName { get; set; } = string.Empty;
    public MissionIntel Intel { get; set; } = new();
    public WmtConfig WmtSettings { get; set; } = new();
    public List<BriefingSection> Briefing { get; set; } = new();
    public List<string> BriefingImages { get; set; } = new();
    public List<SquadGroup> Groups { get; set; } = new();
    public List<MissionVehicle> Vehicles { get; set; } = new();
    public List<MissionMarker> Markers { get; set; } = new();
    public List<MissionScriptFile> ScriptFiles { get; set; } = new();
    public List<ValidationIssue> ValidationReport { get; set; } = new();
}

public class MissionIntel
{
    public int Year { get; set; } = 2026;
    public int Month { get; set; } = 6;
    public int Day { get; set; } = 15;
    public int Hour { get; set; } = 12;
    public int Minute { get; set; } = 0;
    public string FormattedDateTime => $"{Day:D2}.{Month:D2}.{Year} {Hour:D2}:{Minute:D2}";

    public int StartOvercastPercent { get; set; }
    public int ForecastOvercastPercent { get; set; }
    public int StartRainPercent { get; set; }
    public int ForecastRainPercent { get; set; }
    public int StartFogPercent { get; set; }
    public int ForecastFogPercent { get; set; }
    public int StartWindPercent { get; set; }
    public int ForecastWindPercent { get; set; }
}

public class MissionScriptFile
{
    public string Path { get; set; } = string.Empty;
    public int SizeBytes { get; set; }
    public string Content { get; set; } = string.Empty;
}

public class WmtConfig
{
    public int ViewDistance { get; set; } = 3000;
    public int TerrainViewDistance { get; set; } = 10000;
    public string ThermalMode { get; set; } = "По умолчанию";
    public float HeavyLossesCoeff { get; set; } = 0.1f;
    public int MissionTimeMinutes { get; set; } = 120;
    public int FreezeTimeMinutes { get; set; } = 3;
    public int StartZoneSize { get; set; } = 50;
    public string WinnerByTimeText { get; set; } = string.Empty;
    public string CapturePointWinnerText { get; set; } = string.Empty;
    public int CapturePointRequiredCount { get; set; }
    public List<WmtPointInfo> CapturePoints { get; set; } = new();
    public Dictionary<string, string> RawModuleAttributes { get; set; } = new();
}

public class WmtPointInfo
{
    public string Name { get; set; } = string.Empty;
    public string Marker { get; set; } = string.Empty;
    public int CaptureTimeSeconds { get; set; }
    public string DefendingSide { get; set; } = string.Empty;
}

public class BriefingSection
{
    public string Title { get; set; } = string.Empty;
    public string HtmlText { get; set; } = string.Empty;
}

public class SquadGroup
{
    public int Id { get; set; }
    public string Side { get; set; } = string.Empty;
    public string CallSign { get; set; } = string.Empty;
    public string SquadDescription { get; set; } = string.Empty;
    public List<SquadUnit> Units { get; set; } = new();
}

public class SquadUnit
{
    public int Id { get; set; }
    public string RoleDescription { get; set; } = string.Empty;
    public string VehicleClass { get; set; } = string.Empty;
    public string InitScript { get; set; } = string.Empty;
    public string PrimaryWeapon { get; set; } = string.Empty;
    public string SecondaryWeapon { get; set; } = string.Empty;
    public string Handgun { get; set; } = string.Empty;
    public UnitLoadout Loadout { get; set; } = new();
    public float[] Position { get; set; } = Array.Empty<float>(); // [X, Z, Y]
    public float DirectionDegrees { get; set; }
    public bool IsPlayable { get; set; }
}

public class UnitLoadout
{
    public string Uniform { get; set; } = string.Empty;
    public string Vest { get; set; } = string.Empty;
    public string Backpack { get; set; } = string.Empty;
    public string Headgear { get; set; } = string.Empty;
    public string Goggles { get; set; } = string.Empty;
    public List<string> WeaponAttachments { get; set; } = new();
    public List<string> LinkedItems { get; set; } = new();
    public Dictionary<string, int> ItemsAndMagazines { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    // Детализация по контейнерам для проверки переполнения (П. 5.5)
    public Dictionary<string, int> UniformItems { get; set; } = new(StringComparer.OrdinalIgnoreCase);
    public Dictionary<string, int> VestItems { get; set; } = new(StringComparer.OrdinalIgnoreCase);
    public Dictionary<string, int> BackpackItems { get; set; } = new(StringComparer.OrdinalIgnoreCase);
}

public class MissionVehicle
{
    public int Id { get; set; }
    public string Side { get; set; } = string.Empty;
    public string VehicleClass { get; set; } = string.Empty;
    public string CustomName { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string InitScript { get; set; } = string.Empty;
    public float[] Position { get; set; } = Array.Empty<float>(); // [X, Z, Y]
    public float DirectionDegrees { get; set; }

    // Новые поля: статус блокировки, ACE Cargo и все атрибуты из 3DEN редактора
    public string LockStatus { get; set; } = "UNLOCKED";
    public float Fuel { get; set; } = 1f;
    public float Health { get; set; } = 1f;
    public float Ammo { get; set; } = 1f;
    public int AceCargoSpace { get; set; } = -1;
    public Dictionary<string, int> AceCargoItems { get; set; } = new(StringComparer.OrdinalIgnoreCase);
    public Dictionary<string, string> CustomAttributes { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    public VehicleCargo Cargo { get; set; } = new();
}

public class VehicleCargo
{
    public Dictionary<string, int> Weapons { get; set; } = new(StringComparer.OrdinalIgnoreCase);
    public Dictionary<string, int> Magazines { get; set; } = new(StringComparer.OrdinalIgnoreCase);
    public Dictionary<string, int> Items { get; set; } = new(StringComparer.OrdinalIgnoreCase);
    public Dictionary<string, int> Backpacks { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    public bool HasAnyCargo =>
        Weapons.Count > 0 || Magazines.Count > 0 || Items.Count > 0 || Backpacks.Count > 0;
}

public class MissionMarker
{
    public string Name { get; set; } = string.Empty;
    public string Text { get; set; } = string.Empty;
    public string MarkerType { get; set; } = "ICON";
    public string IconType { get; set; } = string.Empty;
    public string ColorName { get; set; } = "Default";
    public string BrushName { get; set; } = "Solid";
    public float WidthA { get; set; } = 1f;
    public float HeightB { get; set; } = 1f;
    public float Angle { get; set; }
    public float Alpha { get; set; } = 1f;
    public float[] Position { get; set; } = Array.Empty<float>();
}

public class ValidationIssue
{
    public string RuleNumber { get; set; } = string.Empty;
    public string Category { get; set; } = string.Empty;
    public string Severity { get; set; } = "Error";
    public string Title { get; set; } = string.Empty;
    public string Details { get; set; } = string.Empty;
}