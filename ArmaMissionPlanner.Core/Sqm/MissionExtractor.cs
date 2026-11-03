using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using ArmaMissionPlanner.Core.Models;
using ArmaMissionPlanner.Core.Pbo;

namespace ArmaMissionPlanner.Core.Sqm;

public static class MissionExtractor
{
    private static readonly string[] SceneryPrefixes =
    {
        "Land_", "Misc_", "Fort_", "Wall_", "Sign_", "Fence", "BagFence",
        "CamoNet", "RoadCone", "RoadBarrier", "Hedgehog", "Trench", "Crater",
        "Helper", "Clutter", "Lamp", "PowerLines", "Tree", "Bush", "Rock"
    };

    public static MissionInfo Extract(SqmClass root, PboArchive? archive = null, string? pboFileName = null)
    {
        var mission = new MissionInfo();

        if (!string.IsNullOrEmpty(pboFileName))
        {
            var nameWithoutPbo = Path.GetFileNameWithoutExtension(pboFileName);
            var lastDot = nameWithoutPbo.LastIndexOf('.');
            if (lastDot >= 0 && lastDot < nameWithoutPbo.Length - 1)
            {
                mission.WorldName = nameWithoutPbo[(lastDot + 1)..];
            }
        }

        var scenarioData = root.GetClass("ScenarioData");
        if (scenarioData != null)
        {
            mission.Author = scenarioData.GetProperty("author")?.AsString() ?? string.Empty;
            if (string.IsNullOrEmpty(mission.Overview))
                mission.Overview = scenarioData.GetProperty("overviewText")?.AsString() ?? string.Empty;
        }

        var missionClass = root.GetClass("Mission");
        if (missionClass == null) return mission;

        var intel = missionClass.GetClass("Intel");
        if (intel != null)
        {
            mission.Name = intel.GetProperty("briefingName")?.AsString() ?? string.Empty;
            var intelOverview = intel.GetProperty("overviewText")?.AsString();
            if (!string.IsNullOrEmpty(intelOverview))
                mission.Overview = intelOverview;

            ExtractIntelWeatherAndTime(intel, mission.Intel);
        }

        var entities = missionClass.GetClass("Entities");
        if (entities != null)
        {
            CollectEntitiesRecursive(entities, mission, archive);
        }

        if (archive != null)
        {
            SqfParser.ExtractBriefing(mission, archive);
            ExtractAllScriptFiles(mission, archive);
        }

        AssignDefaultCallSigns(mission.Groups);

        // Запускаем валидацию по правилам WOG
        mission.ValidationReport = MissionValidator.Validate(root, mission, archive, pboFileName, isBinarized: true);

        return mission;
    }

    private static void ExtractIntelWeatherAndTime(SqmClass intel, MissionIntel target)
    {
        target.Year = ReadIntSafe(intel, "year", 2026);
        target.Month = ReadIntSafe(intel, "month", 6);
        target.Day = ReadIntSafe(intel, "day", 15);
        target.Hour = ReadIntSafe(intel, "hour", 12);
        target.Minute = ReadIntSafe(intel, "minute", 0);

        target.StartOvercastPercent = (int)Math.Round(ReadFloatSafe(intel, "startWeather", 0f) * 100f);
        target.ForecastOvercastPercent = (int)Math.Round(ReadFloatSafe(intel, "forecastWeather", 0f) * 100f);
        target.StartRainPercent = (int)Math.Round(ReadFloatSafe(intel, "startRain", 0f) * 100f);
        target.ForecastRainPercent = (int)Math.Round(ReadFloatSafe(intel, "forecastRain", 0f) * 100f);
        target.StartFogPercent = (int)Math.Round(ReadFloatSafe(intel, "startFog", 0f) * 100f);
        target.ForecastFogPercent = (int)Math.Round(ReadFloatSafe(intel, "forecastFog", 0f) * 100f);
        target.StartWindPercent = (int)Math.Round(ReadFloatSafe(intel, "startWind", 0f) * 100f);
        target.ForecastWindPercent = (int)Math.Round(ReadFloatSafe(intel, "forecastWind", 0f) * 100f);
    }

    private static void ExtractAllScriptFiles(MissionInfo mission, PboArchive archive)
    {
        foreach (var entry in archive.Entries.OrderBy(e => e.FileName, StringComparer.OrdinalIgnoreCase))
        {
            var ext = Path.GetExtension(entry.FileName).ToLowerInvariant();
            if (ext is ".sqf" or ".ext" or ".hpp" or ".h" or ".xml" or ".csv")
            {
                try
                {
                    var content = archive.GetFileContentAsString(entry.FileName);
                    mission.ScriptFiles.Add(new MissionScriptFile
                    {
                        Path = entry.FileName.Replace('\\', '/'),
                        SizeBytes = (int)entry.DataSize,
                        Content = content
                    });
                }
                catch
                {
                    // Пропускаем бинарные или поврежденные файлы
                }
            }
        }
    }

    private static void CollectEntitiesRecursive(SqmClass container, MissionInfo mission, PboArchive? archive)
    {
        foreach (var item in container.Children.OfType<SqmClass>())
        {
            var dataType = item.GetProperty("dataType")?.AsString();

            switch (dataType)
            {
                case "Group":
                    var group = ExtractGroup(item, archive);
                    if (group.Units.Count > 0)
                        mission.Groups.Add(group);
                    break;

                case "Object":
                    var veh = ExtractVehicleOrCrate(item, archive);
                    if (veh != null)
                        mission.Vehicles.Add(veh);
                    break;

                case "Marker":
                    var marker = ExtractMarker(item);
                    if (marker != null)
                        mission.Markers.Add(marker);
                    break;

                case "Logic":
                    ExtractLogicModule(item, mission);
                    break;

                case "Layer":
                    var layerEntities = item.GetClass("Entities");
                    if (layerEntities != null)
                        CollectEntitiesRecursive(layerEntities, mission, archive);
                    break;
            }
        }
    }

    // Проверка, является ли юнит техническим ботом БПЛА / турели (B_UAV_AI, O_UAV_AI_F, I_UAV_AI и т.д.)
    public static bool IsUavAiUnitClass(string vehicleClass)
    {
        if (string.IsNullOrWhiteSpace(vehicleClass)) return false;
        return vehicleClass.Contains("UAV_AI", StringComparison.OrdinalIgnoreCase) ||
               vehicleClass.Equals("B_UAV_AI", StringComparison.OrdinalIgnoreCase) ||
               vehicleClass.Equals("O_UAV_AI", StringComparison.OrdinalIgnoreCase) ||
               vehicleClass.Equals("I_UAV_AI", StringComparison.OrdinalIgnoreCase);
    }

    private static SquadGroup ExtractGroup(SqmClass groupClass, PboArchive? archive)
    {
        var group = new SquadGroup
        {
            Id = groupClass.GetProperty("id")?.AsInt() ?? 0,
            Side = groupClass.GetProperty("side")?.AsString() ?? "Unknown",
            CallSign = FindCustomAttributeValue(groupClass, "groupID") ?? string.Empty
        };

        var subEntities = groupClass.GetClass("Entities");
        if (subEntities == null) return group;

        foreach (var unitClass in subEntities.Children.OfType<SqmClass>())
        {
            if (unitClass.GetProperty("dataType")?.AsString() != "Object")
                continue;

            var typeName = unitClass.GetProperty("type")?.AsString() ?? string.Empty;

            // Исключаем технических ботов дронов (O_UAV_AI_F, B_UAV_AI и т.д.)!
            if (IsUavAiUnitClass(typeName))
                continue;

            var attributes = unitClass.GetClass("Attributes");
            bool isPlayable = ReadPlayableFlag(unitClass, attributes);

            // Если это обычный неигровой бот (например, VIP-заложник или декоративный бот без слота игрока) — не добавляем его в игровые слоты!
            if (!isPlayable)
                continue;

            var unit = new SquadUnit
            {
                Id = unitClass.GetProperty("id")?.AsInt() ?? 0,
                VehicleClass = typeName,
                RoleDescription = ReadEntityStringField(unitClass, attributes, "description"),
                InitScript = ReadEntityStringField(unitClass, attributes, "init"),
                IsPlayable = isPlayable
            };

            var (pos, dir) = ReadPositionAndDirection(unitClass);
            unit.Position = pos;
            unit.DirectionDegrees = dir;

            if (archive != null && !string.IsNullOrEmpty(unit.InitScript))
            {
                SqfParser.PopulateUnitLoadout(unit, archive);
            }

            group.Units.Add(unit);
        }

        return group;
    }

    private static MissionVehicle? ExtractVehicleOrCrate(SqmClass item, PboArchive? archive)
    {
        var typeName = item.GetProperty("type")?.AsString() ?? string.Empty;
        if (string.IsNullOrEmpty(typeName)) return null;

        var attributes = item.GetClass("Attributes");
        var initScript = ReadEntityStringField(item, attributes, "init");
        var customName = ReadEntityStringField(item, attributes, "name");
        var description = ReadEntityStringField(item, attributes, "description");
        var lockStatus = ReadEntityStringField(item, attributes, "lock");
        if (string.IsNullOrWhiteSpace(lockStatus)) lockStatus = "UNLOCKED";

        var (pos, dir) = ReadPositionAndDirection(item);

        var veh = new MissionVehicle
        {
            Id = item.GetProperty("id")?.AsInt() ?? 0,
            Side = item.GetProperty("side")?.AsString() ?? "Empty",
            VehicleClass = typeName,
            CustomName = customName,
            Description = description,
            InitScript = initScript,
            Position = pos,
            DirectionDegrees = dir,
            LockStatus = lockStatus.ToUpperInvariant(),
            Fuel = attributes != null ? ReadFloatSafe(attributes, "fuel", 1f) : 1f,
            Health = attributes != null ? ReadFloatSafe(attributes, "health", 1f) : 1f,
            Ammo = attributes != null ? ReadFloatSafe(attributes, "ammo", 1f) : 1f
        };

        // Собираем все кастомные атрибуты из 3DEN редактора (включая ACE Cargo, колеса, гусеницы и т.д.)
        var rawCustomAttrs = ReadAllCustomAttributes(item);
        if (attributes != null)
        {
            foreach (var kv in ReadAllCustomAttributes(attributes))
                rawCustomAttrs[kv.Key] = kv.Value;
        }

        foreach (var kv in rawCustomAttrs)
        {
            veh.CustomAttributes[kv.Key] = kv.Value;
        }

        ParseAceAttributesAndWheels(veh, rawCustomAttrs);

        if (archive != null && !string.IsNullOrEmpty(initScript))
        {
            SqfParser.PopulateVehicleCargo(veh, archive);
        }

        bool isScenery = SceneryPrefixes.Any(prefix =>
            typeName.StartsWith(prefix, StringComparison.OrdinalIgnoreCase));
        if (isScenery && !veh.Cargo.HasAnyCargo && veh.AceCargoItems.Count == 0)
        {
            return null;
        }

        return veh;
    }

    private static void ParseAceAttributesAndWheels(MissionVehicle veh, Dictionary<string, string> attrs)
    {
        foreach (var (key, val) in attrs)
        {
            var lowerKey = key.ToLowerInvariant();
            if (lowerKey.Contains("ace_cargo_space") && int.TryParse(val, out int space))
            {
                veh.AceCargoSpace = space;
            }
            else if (lowerKey.Contains("sparewheels") || lowerKey.Contains("ace_repair_sparewheels"))
            {
                if (int.TryParse(val, out int wheels) && wheels > 0)
                    AddAceCargoCount(veh.AceCargoItems, "ACE_Wheel", wheels);
            }
            else if (lowerKey.Contains("sparetracks") || lowerKey.Contains("ace_repair_sparetracks"))
            {
                if (int.TryParse(val, out int tracks) && tracks > 0)
                    AddAceCargoCount(veh.AceCargoItems, "ACE_Track", tracks);
            }
            else if (lowerKey.Contains("ace_cargo"))
            {
                // Разбираем массивы классов в строке атрибута (например ["ACE_Wheel", "ACE_Track", "Land_CanisterFuel_F"])
                foreach (Match m in Regex.Matches(val, @"[""']([a-zA-Z0-9_]+)[""']"))
                {
                    var cls = m.Groups[1].Value;
                    if (!cls.Equals("true", StringComparison.OrdinalIgnoreCase) &&
                        !cls.Equals("false", StringComparison.OrdinalIgnoreCase))
                    {
                        AddAceCargoCount(veh.AceCargoItems, cls, 1);
                    }
                }
            }
        }
    }

    private static void AddAceCargoCount(Dictionary<string, int> dict, string key, int count)
    {
        if (dict.TryGetValue(key, out int cur)) dict[key] = cur + count;
        else dict[key] = count;
    }

    private static MissionMarker? ExtractMarker(SqmClass item)
    {
        var (pos, dir) = ReadPositionAndDirection(item);

        return new MissionMarker
        {
            Name = item.GetProperty("name")?.AsString() ?? string.Empty,
            Text = item.GetProperty("text")?.AsString() ?? string.Empty,
            MarkerType = item.GetProperty("markerType")?.AsString() ?? "ICON",
            IconType = item.GetProperty("type")?.AsString() ?? string.Empty,
            ColorName = item.GetProperty("colorName")?.AsString() ?? "Default",
            BrushName = item.GetProperty("fillName")?.AsString() ?? "Solid",
            WidthA = ReadFloatSafe(item, "a", 1f),
            HeightB = ReadFloatSafe(item, "b", 1f),
            Angle = ReadFloatSafe(item, "angle", dir),
            Alpha = ReadFloatSafe(item, "alpha", 1f),
            Position = pos
        };
    }

    private static int ReadIntSafe(SqmClass item, string propName, int defaultValue = 0)
    {
        var prop = item.GetProperty(propName);
        if (prop?.Value == null) return defaultValue;
        try { return Convert.ToInt32(prop.Value, CultureInfo.InvariantCulture); }
        catch { return defaultValue; }
    }

    private static float ReadFloatSafe(SqmClass item, string propName, float defaultValue = 0f)
    {
        var prop = item.GetProperty(propName);
        if (prop?.Value == null) return defaultValue;
        try { return Convert.ToSingle(prop.Value, CultureInfo.InvariantCulture); }
        catch { return defaultValue; }
    }

    private static void AssignDefaultCallSigns(List<SquadGroup> groups)
    {
        var phonetic = new[] { "Альфа", "Браво", "Чарли", "Дельта", "Эхо", "Фокстрот" };
        foreach (var sideGroup in groups.GroupBy(g => g.Side))
        {
            int index = 0;
            foreach (var g in sideGroup)
            {
                if (string.IsNullOrWhiteSpace(g.CallSign))
                {
                    int block = (index / 6) + 1;
                    int num = (index % 6) + 1;
                    g.CallSign = $"{phonetic[0]} {block}-{num}";
                }
                index++;

                var leaderRole = g.Units.FirstOrDefault()?.RoleDescription;
                if (!string.IsNullOrEmpty(leaderRole))
                {
                    var match = Regex.Match(leaderRole, @"\(([^)]+)\)");
                    if (match.Success)
                    {
                        g.SquadDescription = match.Groups[1].Value.Trim();
                    }
                }
            }
        }
    }

    private static void ExtractLogicModule(SqmClass logicItem, MissionInfo mission)
    {
        var moduleType = logicItem.GetProperty("type")?.AsString() ?? string.Empty;
        if (!moduleType.StartsWith("WMT_", StringComparison.OrdinalIgnoreCase))
            return;

        var attrs = ReadAllCustomAttributes(logicItem);
        foreach (var kv in attrs)
            mission.WmtSettings.RawModuleAttributes[$"{moduleType}.{kv.Key}"] = kv.Value;

        var wmt = mission.WmtSettings;

        if (moduleType.Equals("WMT_Main", StringComparison.OrdinalIgnoreCase))
        {
            if (attrs.TryGetValue("WMT_Main_MaxViewDistance", out var vd) && int.TryParse(vd, out int vdInt))
                wmt.ViewDistance = vdInt;
            if (attrs.TryGetValue("WMT_Main_MaxViewDistanceTerrain", out var tvd) && int.TryParse(tvd, out int tvdInt))
                wmt.TerrainViewDistance = tvdInt;
            if (attrs.TryGetValue("WMT_Main_HeavyLossesCoeff", out var loss) &&
                float.TryParse(loss.Replace(',', '.'), NumberStyles.Float, CultureInfo.InvariantCulture, out float lossFloat))
                wmt.HeavyLossesCoeff = lossFloat;

            if (attrs.TryGetValue("WMT_Main_TI", out var ti) && int.TryParse(ti, out int tiInt))
            {
                wmt.ThermalMode = tiInt switch
                {
                    0 => "Включен везде",
                    1 => "Отключен в стрелковом (только в технике)",
                    2 => "Полностью отключен",
                    _ => $"Код {tiInt}"
                };
            }
        }
        else if (moduleType.Equals("WMT_Time", StringComparison.OrdinalIgnoreCase))
        {
            if (attrs.TryGetValue("WMT_Time_MissionTime", out var mt) && int.TryParse(mt, out int mtInt))
                wmt.MissionTimeMinutes = mtInt;
            if (attrs.TryGetValue("WMT_Time_PrepareTime", out var pt) && int.TryParse(pt, out int ptInt))
                wmt.FreezeTimeMinutes = ptInt;
            if (attrs.TryGetValue("WMT_Time_StartZone", out var sz) && int.TryParse(sz, out int szInt))
                wmt.StartZoneSize = szInt;
            if (attrs.TryGetValue("WMT_Time_WinnerByTimeText", out var winText))
                wmt.WinnerByTimeText = winText;
        }
        else if (moduleType.Equals("WMT_Task_CapturePoint", StringComparison.OrdinalIgnoreCase))
        {
            if (attrs.TryGetValue("WMT_Task_CapturePoint_Message", out var msg))
                wmt.CapturePointWinnerText = msg;
            if (attrs.TryGetValue("WMT_Task_CapturePoint_Count", out var cnt) && int.TryParse(cnt, out int cntInt))
                wmt.CapturePointRequiredCount = cntInt;
        }
        else if (moduleType.Equals("WMT_Task_Point", StringComparison.OrdinalIgnoreCase) ||
                 moduleType.Equals("WMT_Point", StringComparison.OrdinalIgnoreCase))
        {
            var point = new WmtPointInfo
            {
                Name = attrs.GetValueOrDefault("WMT_Task_Point_MarkerText") ??
                       attrs.GetValueOrDefault("WMT_Task_Point_Message") ?? "Зона",
                Marker = attrs.GetValueOrDefault("WMT_Task_Point_Marker") ?? string.Empty,
                DefendingSide = attrs.GetValueOrDefault("WMT_Task_Point_Owner") ?? string.Empty
            };
            if (attrs.TryGetValue("WMT_Task_Point_Timer", out var t) && int.TryParse(t, out int tInt))
                point.CaptureTimeSeconds = tInt;
            wmt.CapturePoints.Add(point);
        }
    }

    private static (float[] Position, float DirectionDegrees) ReadPositionAndDirection(SqmClass entity)
    {
        float[] pos = Array.Empty<float>();
        float dir = 0f;

        var posInfo = entity.GetClass("PositionInfo");
        if (posInfo != null)
        {
            var posProp = posInfo.GetProperty("position");
            if (posProp != null)
                pos = posProp.AsArray().Select(Convert.ToSingle).ToArray();

            var anglesProp = posInfo.GetProperty("angles");
            if (anglesProp != null)
            {
                var angles = anglesProp.AsArray().Select(Convert.ToSingle).ToArray();
                if (angles.Length >= 2)
                    dir = (float)(angles[1] * 180.0 / Math.PI);
            }
        }
        else
        {
            var directPos = entity.GetProperty("position");
            if (directPos != null)
                pos = directPos.AsArray().Select(Convert.ToSingle).ToArray();
        }

        return (pos, dir);
    }

    private static string ReadEntityStringField(SqmClass entity, SqmClass? attributes, string fieldName)
    {
        return attributes?.GetProperty(fieldName)?.AsString()
               ?? entity.GetProperty(fieldName)?.AsString()
               ?? string.Empty;
    }

    private static bool ReadPlayableFlag(SqmClass entity, SqmClass? attributes)
    {
        var p1 = attributes?.GetProperty("isPlayable")?.AsInt() ?? entity.GetProperty("isPlayable")?.AsInt() ?? 0;
        var p2 = attributes?.GetProperty("isPlayer")?.AsInt() ?? entity.GetProperty("isPlayer")?.AsInt() ?? 0;
        return p1 == 1 || p2 == 1;
    }

    private static string? FindCustomAttributeValue(SqmClass container, string propertyName)
    {
        var attrs = ReadAllCustomAttributes(container);
        return attrs.TryGetValue(propertyName, out var val) ? val : null;
    }

    private static Dictionary<string, string> ReadAllCustomAttributes(SqmClass container)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var customAttrs = container.GetClass("CustomAttributes");
        if (customAttrs == null) return result;

        foreach (var attrClass in customAttrs.Children.OfType<SqmClass>())
        {
            var propName = attrClass.GetProperty("property")?.AsString();
            var expName = attrClass.GetProperty("expression")?.AsString();
            var valData = attrClass.GetClass("Value")?.GetClass("data");
            var valProp = valData?.GetProperty("value");

            if (!string.IsNullOrEmpty(propName) && valProp?.Value != null)
            {
                string strVal;
                if (valProp.Value is object[] arr)
                    strVal = "[" + string.Join(", ", arr) + "]";
                else
                    strVal = Convert.ToString(valProp.Value, CultureInfo.InvariantCulture) ?? string.Empty;

                result[propName] = strVal;
                if (!string.IsNullOrEmpty(expName) && expName.Contains("wmt_", StringComparison.OrdinalIgnoreCase))
                {
                    var match = Regex.Match(expName, @"wmt_[a-zA-Z0-9_]+", RegexOptions.IgnoreCase);
                    if (match.Success)
                        result[match.Value] = strVal;
                }
            }
        }

        return result;
    }
}