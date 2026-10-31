using ArmaMissionPlanner.Core.Models;
using ArmaMissionPlanner.Core.Pbo;

namespace ArmaMissionPlanner.Core.Sqm;

public static class MissionExtractor
{
    // Префиксы статических декораций, которые не являются техникой или ящиками со снаряжением
    private static readonly string[] SceneryPrefixes =
    {
        "Land_", "Misc_", "Fort_", "Wall_", "Sign_", "Fence", "BagFence",
        "CamoNet_", "RoadCone", "RoadBarrier", "Hedgehog", "Trench", "Crater",
        "Helper_", "Clutter", "Lamp", "PowerLines", "Tree", "Bush", "Rock"
    };

    public static MissionInfo Extract(SqmClass root, PboArchive? archive = null, string? pboFileName = null)
    {
        var mission = new MissionInfo();

        if (!string.IsNullOrEmpty(pboFileName))
        {
            // wog_160_balkan_gambit_11.cup_chernarus_A3.pbo -> cup_chernarus_A3
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
            mission.Author = scenarioData.GetProperty("author")?.AsString() ?? "Unknown";
            if (string.IsNullOrEmpty(mission.Overview))
                mission.Overview = scenarioData.GetProperty("overviewText")?.AsString() ?? string.Empty;
        }

        var missionClass = root.GetClass("Mission");
        if (missionClass == null) return mission;

        var intel = missionClass.GetClass("Intel");
        if (intel != null)
        {
            mission.Name = intel.GetProperty("briefingName")?.AsString() ?? "No name";
            var intelOverview = intel.GetProperty("overviewText")?.AsString();
            if (!string.IsNullOrEmpty(intelOverview))
                mission.Overview = intelOverview;
        }

        var entities = missionClass.GetClass("Entities");
        if (entities != null)
        {
            CollectEntitiesRecursive(entities, mission, archive);
        }

        if (archive != null)
        {
            SqfParser.ExtractBriefing(mission, archive);
        }
        AssignDefaultCallSigns(mission.Groups);
        return mission;
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

            var attributes = unitClass.GetClass("Attributes");

            var unit = new SquadUnit
            {
                Id = unitClass.GetProperty("id")?.AsInt() ?? 0,
                VehicleClass = unitClass.GetProperty("type")?.AsString() ?? string.Empty,
                RoleDescription = ReadEntityStringField(unitClass, attributes, "description"),
                InitScript = ReadEntityStringField(unitClass, attributes, "init"),
                IsPlayable = ReadPlayableFlag(unitClass, attributes)
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
            DirectionDegrees = dir
        };

        if (archive != null && !string.IsNullOrEmpty(initScript))
        {
            SqfParser.PopulateVehicleCargo(veh, archive);
        }

        // Если это статическая декорация (Land_*, окоп, масксеть) и в ней нет инвентаря — пропускаем
        bool isScenery = SceneryPrefixes.Any(prefix => typeName.StartsWith(prefix, StringComparison.OrdinalIgnoreCase));
        if (isScenery && !veh.Cargo.HasAnyCargo)
        {
            return null;
        }

        return veh;
    }
    private static float ReadFloatSafe(SqmClass item, string propName, float defaultValue = 0f)
    {
        var prop = item.GetProperty(propName);
        if (prop?.Value == null) return defaultValue;
        try { return Convert.ToSingle(prop.Value, System.Globalization.CultureInfo.InvariantCulture); }
        catch { return defaultValue; }
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
            Alpha = item.GetProperty("alpha")?.AsFloat() ?? 1f,
            Position = pos
        };
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

                // Вытаскиваем описание отделения и технику из скобок у 1-го слота (КО)
                var leaderRole = g.Units.FirstOrDefault()?.RoleDescription;
                if (!string.IsNullOrEmpty(leaderRole))
                {
                    var match = System.Text.RegularExpressions.Regex.Match(leaderRole, @"\(([^)]+)\)");
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
            float.TryParse(loss.Replace(',', '.'), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out float lossFloat))
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
            Name = attrs.GetValueOrDefault("WMT_Task_Point_MarkerText")
                   ?? attrs.GetValueOrDefault("WMT_Task_Point_Message") ?? "Зона",
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
        float dirDegrees = 0f;

        var posInfo = entity.GetClass("PositionInfo");
        if (posInfo != null)
        {
            var posProp = posInfo.GetProperty("position");
            if (posProp?.Value is object[] arr)
                pos = arr.Select(Convert.ToSingle).ToArray();

            var anglesProp = posInfo.GetProperty("angles");
            if (anglesProp?.Value is object[] angArr && angArr.Length >= 2)
            {
                float yawRadians = Convert.ToSingle(angArr[1]);
                dirDegrees = yawRadians * (180f / MathF.PI);
                if (dirDegrees < 0) dirDegrees += 360f;
            }
        }
        else
        {
            var directPos = entity.GetProperty("position");
            if (directPos?.Value is object[] arr)
                pos = arr.Select(Convert.ToSingle).ToArray();
        }

        return (pos, dirDegrees);
    }

    private static string ReadEntityStringField(SqmClass entity, SqmClass? attributes, string fieldName)
    {
        var val = attributes?.GetProperty(fieldName)?.AsString();
        if (!string.IsNullOrEmpty(val)) return val;

        val = entity.GetProperty(fieldName)?.AsString();
        if (!string.IsNullOrEmpty(val)) return val;

        return FindCustomAttributeValue(entity, fieldName) ?? string.Empty;
    }

    private static bool ReadPlayableFlag(SqmClass entity, SqmClass? attributes)
    {
        int isPlayable = attributes?.GetProperty("isPlayable")?.AsInt()
                         ?? entity.GetProperty("isPlayable")?.AsInt() ?? 0;
        int isPlayer = attributes?.GetProperty("isPlayer")?.AsInt()
                       ?? entity.GetProperty("isPlayer")?.AsInt() ?? 0;

        return isPlayable == 1 || isPlayer == 1;
    }

    private static string? FindCustomAttributeValue(SqmClass parentClass, string attributeName)
    {
        var customAttributes = parentClass.GetClass("CustomAttributes");
        if (customAttributes == null) return null;

        foreach (var attr in customAttributes.Children.OfType<SqmClass>())
        {
            var propName = attr.GetProperty("property")?.AsString();
            if (propName != null && propName.Contains(attributeName, StringComparison.OrdinalIgnoreCase))
            {
                var valClass = attr.GetClass("Value");
                var dataClass = valClass?.GetClass("data");
                if (dataClass != null)
                {
                    var valProp = dataClass.GetProperty("value");
                    if (valProp != null) return valProp.AsString();
                }

                var directData = valClass?.GetProperty("data")?.AsString();
                if (!string.IsNullOrEmpty(directData)) return directData;
            }
        }

        return null;
    }

    private static Dictionary<string, string> ReadAllCustomAttributes(SqmClass parentClass)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        var attributes = parentClass.GetClass("Attributes");
        if (attributes != null)
        {
            foreach (var p in attributes.Children.OfType<SqmProperty>())
                result[p.Name] = p.AsString();
        }

        var customAttributes = parentClass.GetClass("CustomAttributes");
        if (customAttributes != null)
        {
            foreach (var attr in customAttributes.Children.OfType<SqmClass>())
            {
                var propName = attr.GetProperty("property")?.AsString();
                if (string.IsNullOrEmpty(propName)) continue;

                var valProp = attr.GetClass("Value")?.GetClass("data")?.GetProperty("value");
                if (valProp != null)
                {
                    result[propName] = valProp.AsString();
                }
            }
        }

        return result;
    }

    private static bool TryFindAttrInt(Dictionary<string, string> attrs, string keyPart, out int value)
    {
        foreach (var kv in attrs)
        {
            if (kv.Key.Contains(keyPart, StringComparison.OrdinalIgnoreCase))
            {
                if (int.TryParse(kv.Value, out value)) return true;
                if (float.TryParse(kv.Value, out float fVal)) { value = (int)fVal; return true; }
            }
        }
        value = 0;
        return false;
    }

    private static bool TryFindAttrFloat(Dictionary<string, string> attrs, string keyPart, out float value)
    {
        foreach (var kv in attrs)
        {
            if (kv.Key.Contains(keyPart, StringComparison.OrdinalIgnoreCase) &&
                float.TryParse(kv.Value, out value))
                return true;
        }
        value = 0f;
        return false;
    }

    private static string? FindFirstMatchingAttr(Dictionary<string, string> attrs, params string[] keyParts)
    {
        foreach (var part in keyParts)
        {
            var match = attrs.FirstOrDefault(kv => kv.Key.Contains(part, StringComparison.OrdinalIgnoreCase));
            if (!string.IsNullOrEmpty(match.Value)) return match.Value;
        }
        return null;
    }
}