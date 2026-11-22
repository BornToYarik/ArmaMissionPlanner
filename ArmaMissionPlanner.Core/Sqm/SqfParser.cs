using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using ArmaMissionPlanner.Core.Models;
using ArmaMissionPlanner.Core.Pbo;

namespace ArmaMissionPlanner.Core.Sqm;

public static class SqfParser
{
    public static void PopulateUnitLoadout(SquadUnit unit, PboArchive archive)
    {
        var calls = ParseInitCalls(unit.InitScript);
        var fullScriptBuilder = new List<string>();

        if (!string.IsNullOrWhiteSpace(unit.InitScript))
        {
            fullScriptBuilder.Add(StripComments(unit.InitScript));
        }

        foreach (var (scriptPath, roleArg) in calls)
        {
            var scriptText = ReadScriptSafe(archive, scriptPath);
            if (string.IsNullOrEmpty(scriptText)) continue;

            scriptText = StripComments(scriptText);
            if (!string.IsNullOrEmpty(roleArg))
            {
                scriptText = ExtractSwitchCaseBlock(scriptText, roleArg);
            }
            fullScriptBuilder.Add(scriptText);
        }

        if (fullScriptBuilder.Count == 0) return;
        var combinedScript = string.Join("\n", fullScriptBuilder);

        // Собираем пулы переменных с учетом позиции в скрипте (чтобы повторное использование _rnd / _item не перезаписывало оружие масками)
        var varAssignments = ParseVariableAssignments(combinedScript);

        var uniformPool = MatchLastEquipmentPool(combinedScript, @"(?:forceAddUniform|addUniform)", varAssignments);
        if (uniformPool.Count > 0)
        {
            unit.Loadout.Uniform = uniformPool[0];
            unit.Loadout.UniformVariants = uniformPool;
        }

        var vestPool = MatchLastEquipmentPool(combinedScript, @"addVest", varAssignments);
        if (vestPool.Count > 0)
        {
            unit.Loadout.Vest = vestPool[0];
            unit.Loadout.VestVariants = vestPool;
        }

        var backpackPool = MatchLastEquipmentPool(combinedScript, @"addBackpack(?:Global)?", varAssignments);
        if (backpackPool.Count > 0)
        {
            unit.Loadout.Backpack = backpackPool[0];
            unit.Loadout.BackpackVariants = backpackPool;
        }

        var headgearPool = MatchLastEquipmentPool(combinedScript, @"addHeadgear", varAssignments);
        if (headgearPool.Count > 0)
        {
            unit.Loadout.Headgear = headgearPool[0];
            unit.Loadout.HeadgearVariants = headgearPool;
        }

        var gogglesPool = MatchLastEquipmentPool(combinedScript, @"addGoggles", varAssignments);
        if (gogglesPool.Count > 0)
        {
            unit.Loadout.Goggles = gogglesPool[0];
            unit.Loadout.GogglesVariants = gogglesPool;
        }

        foreach (var weaponPool in MatchAllEquipmentPools(combinedScript, @"addWeapon(?:Global)?", varAssignments))
        {
            ClassifyWeaponPool(unit, weaponPool);
        }

        foreach (var itemPool in MatchAllEquipmentPools(combinedScript, @"add(?:Primary|Secondary|Handgun)WeaponItem", varAssignments))
        {
            if (itemPool.Count == 0) continue;
            var firstItem = itemPool[0];
            if (IsLoadedMagazineOrRound(firstItem))
            {
                AddCount(unit.Loadout.ItemsAndMagazines, firstItem, 1);
            }
            else
            {
                foreach (var item in itemPool)
                {
                    if (!unit.Loadout.WeaponAttachments.Contains(item, StringComparer.OrdinalIgnoreCase))
                        unit.Loadout.WeaponAttachments.Add(item);
                }
            }
        }

        foreach (Match m in Regex.Matches(combinedScript, @"linkItem\s+[""']([^""']+)[""']", RegexOptions.IgnoreCase))
        {
            var item = m.Groups[1].Value;
            if (!unit.Loadout.LinkedItems.Contains(item, StringComparer.OrdinalIgnoreCase))
                unit.Loadout.LinkedItems.Add(item);
        }

        var loopRegex = new Regex(@"for\s+[""'][^""']+[""']\s+from\s+(\d+)\s+to\s+(\d+)\s+do\s*\{([^}]+)\}", RegexOptions.IgnoreCase);
        var textWithoutLoops = loopRegex.Replace(combinedScript, match =>
        {
            int from = int.Parse(match.Groups[1].Value);
            int to = int.Parse(match.Groups[2].Value);
            int count = Math.Max(1, to - from + 1);
            string body = match.Groups[3].Value;
            ParseUnitItemsInBlock(body, unit.Loadout, count);
            return string.Empty;
        });

        ParseUnitItemsInBlock(textWithoutLoops, unit.Loadout, 1);

        foreach (Match m in Regex.Matches(textWithoutLoops, @"addMagazines\s*\[\s*[""']([^""']+)[""']\s*,\s*(\d+)\s*\]", RegexOptions.IgnoreCase))
        {
            AddCount(unit.Loadout.ItemsAndMagazines, m.Groups[1].Value, int.Parse(m.Groups[2].Value));
        }
    }

    public static void PopulateVehicleCargo(MissionVehicle vehicle, PboArchive archive)
    {
        var calls = ParseInitCalls(vehicle.InitScript);
        var fullContextText = StripComments(vehicle.InitScript ?? string.Empty);

        foreach (var (scriptPath, typeArg) in calls)
        {
            var scriptText = ReadScriptSafe(archive, scriptPath);
            if (!string.IsNullOrEmpty(scriptText))
            {
                scriptText = StripComments(scriptText);
                if (!string.IsNullOrEmpty(typeArg))
                {
                    scriptText = ExtractSwitchCaseBlock(scriptText, typeArg);
                }
                fullContextText += "\n" + scriptText;
            }
        }

        ParseCargoCommand(fullContextText, @"addWeaponCargo(?:Global)?", vehicle.Cargo.Weapons);
        ParseCargoCommand(fullContextText, @"addMagazineCargo(?:Global)?", vehicle.Cargo.Magazines);
        ParseCargoCommand(fullContextText, @"addItemCargo(?:Global)?", vehicle.Cargo.Items);
        ParseCargoCommand(fullContextText, @"addBackpackCargo(?:Global)?", vehicle.Cargo.Backpacks);

        // Достаем ACE Cargo из SQF (например: ["ACE_Wheel", _veh] call ace_cargo_fnc_loadItem или addSpareParts)
        foreach (Match m in Regex.Matches(fullContextText, @"\[\s*[""']([^""']+)[""']\s*,[^\]]+\]\s*call\s+ace_cargo_fnc_loadItem", RegexOptions.IgnoreCase))
        {
            AddCount(vehicle.AceCargoItems, m.Groups[1].Value, 1);
        }
        foreach (Match m in Regex.Matches(fullContextText, @"\[\s*[^,]+\s*,\s*(\d+)\s*,\s*[""']([^""']+)[""']\s*\]\s*call\s+ace_repair_fnc_addSpareParts", RegexOptions.IgnoreCase))
        {
            if (int.TryParse(m.Groups[1].Value, out int cnt) && cnt > 0)
                AddCount(vehicle.AceCargoItems, m.Groups[2].Value, cnt);
        }
        foreach (Match m in Regex.Matches(fullContextText, @"\[\s*[^,]+\s*,\s*(\d+)\s*\]\s*call\s+ace_cargo_fnc_setSpace", RegexOptions.IgnoreCase))
        {
            if (int.TryParse(m.Groups[1].Value, out int space))
                vehicle.AceCargoSpace = space;
        }
    }

    public static void ExtractBriefing(MissionInfo mission, PboArchive archive)
    {
        var briefingEntries = archive.Entries
            .Where(e => e.FileName.Contains("briefing", StringComparison.OrdinalIgnoreCase) &&
                        e.FileName.EndsWith(".sqf", StringComparison.OrdinalIgnoreCase))
            .ToList();

        foreach (var entry in briefingEntries)
        {
            var text = ReadScriptSafe(archive, entry.FileName);
            if (string.IsNullOrEmpty(text)) continue;

            // Определяем позиции case WEST / EAST / RESISTANCE / GUER / CIVILIAN для привязки вкладок к стороне
            var caseMarkers = new List<(int Index, string Side)>();
            foreach (Match cm in Regex.Matches(text, @"case\s+(WEST|BLUFOR|EAST|OPFOR|RESISTANCE|INDEPENDENT|GUER|CIVILIAN)\s*:", RegexOptions.IgnoreCase))
            {
                var rawSide = cm.Groups[1].Value.ToUpperInvariant();
                string normalizedSide = rawSide switch
                {
                    "WEST" or "BLUFOR" => "West",
                    "EAST" or "OPFOR" => "East",
                    "RESISTANCE" or "INDEPENDENT" or "GUER" => "Independent",
                    "CIVILIAN" => "Civilian",
                    _ => rawSide
                };
                caseMarkers.Add((cm.Index, normalizedSide));
            }

            var recordRegex = new Regex(
                @"\[\s*[""']diary[""']\s*,\s*\[\s*[""']([^""']+)[""']\s*,\s*""((?:[^""]|"""")*)""\s*\]\s*\]",
                RegexOptions.IgnoreCase);

            foreach (Match m in recordRegex.Matches(text))
            {
                var title = m.Groups[1].Value.Trim();
                var content = m.Groups[2].Value.Replace("\"\"", "'").Trim();

                string sectionSide = string.Empty;
                foreach (var (cIdx, cSide) in caseMarkers)
                {
                    if (cIdx < m.Index)
                        sectionSide = cSide;
                }

                // Проверяем, не закрылся ли блок switch до этой записи (напр. общая вкладка "Формы" или "Брифинг" в конце файла)
                if (!string.IsNullOrEmpty(sectionSide))
                {
                    var lastCaseIdx = caseMarkers.Last(c => c.Index < m.Index).Index;
                    if (IsAfterBraceBlockEnd(text, lastCaseIdx, m.Index))
                    {
                        sectionSide = string.Empty;
                    }
                }

                mission.Briefing.Add(new BriefingSection
                {
                    Title = title,
                    Side = sectionSide,
                    HtmlText = content
                });

                foreach (Match imgMatch in Regex.Matches(content, @"image\s*=\s*['""]([^'""]+)['""]", RegexOptions.IgnoreCase))
                {
                    var imgPath = imgMatch.Groups[1].Value.Replace("/", "\\").TrimStart('\\');
                    if (!mission.BriefingImages.Contains(imgPath, StringComparer.OrdinalIgnoreCase))
                        mission.BriefingImages.Add(imgPath);
                }
            }
        }
    }

    private static bool IsAfterBraceBlockEnd(string text, int caseIndex, int targetIndex)
    {
        int openBrace = text.IndexOf('{', caseIndex);
        if (openBrace < 0 || openBrace > targetIndex) return false;

        int depth = 1;
        for (int i = openBrace + 1; i < targetIndex && i < text.Length; i++)
        {
            if (text[i] == '{') depth++;
            else if (text[i] == '}')
            {
                depth--;
                if (depth == 0)
                    return true;
            }
        }
        return false;
    }

    private sealed class VariableAssignment
    {
        public int Index { get; init; }
        public string VarName { get; init; } = string.Empty;
        public List<string> Classes { get; init; } = new();
        public List<List<string>>? SubArrays { get; init; }
    }

    private static List<VariableAssignment> ParseVariableAssignments(string scriptText)
    {
        var assignments = new List<VariableAssignment>();

        // Ищем присваивания вида: _uniform = ['a', 'b'] call BIS_fnc_selectRandom; или _weaponList = [['w1','o1'],['w2','o2']];
        var assignRegex = new Regex(@"(?:private\s+)?(_[a-zA-Z0-9_]+)\s*=\s*([^;]+);", RegexOptions.IgnoreCase);
        foreach (Match m in assignRegex.Matches(scriptText))
        {
            var varName = m.Groups[1].Value.Trim();
            var expr = m.Groups[2].Value.Trim();

            // Проверяем, не является ли правая часть двумерным массивом [['w1','o1'], ['w2','o2']]
            List<List<string>>? subArrays = null;
            var innerBracketMatches = Regex.Matches(expr, @"\[([^\[\]]+)\]");
            if (innerBracketMatches.Count > 1)
            {
                var parsedSubs = new List<List<string>>();
                foreach (Match subMatch in innerBracketMatches)
                {
                    var subClasses = ExtractClassNamesFromExpression(subMatch.Groups[1].Value);
                    if (subClasses.Count > 0)
                        parsedSubs.Add(subClasses);
                }
                if (parsedSubs.Count > 1)
                    subArrays = parsedSubs;
            }

            var classes = ExtractClassNamesFromExpression(expr);
            if (classes.Count > 0)
            {
                assignments.Add(new VariableAssignment
                {
                    Index = m.Index,
                    VarName = varName,
                    Classes = classes,
                    SubArrays = subArrays
                });
                continue;
            }

            // Если строковых литералов нет, проверяем ссылку на другую переменную (напр. _weapon = _weaponList select floor(random ...))
            foreach (Match refMatch in Regex.Matches(expr, @"(_[a-zA-Z0-9_]+)"))
            {
                var refName = refMatch.Groups[1].Value;
                if (refName.Equals(varName, StringComparison.OrdinalIgnoreCase)) continue;

                var prev = assignments.LastOrDefault(a =>
                    a.Index < m.Index && a.VarName.Equals(refName, StringComparison.OrdinalIgnoreCase));
                if (prev != null)
                {
                    assignments.Add(new VariableAssignment
                    {
                        Index = m.Index,
                        VarName = varName,
                        Classes = new List<string>(prev.Classes),
                        SubArrays = prev.SubArrays
                    });
                    break;
                }
            }
        }

        return assignments;
    }

    private static List<string> ExtractClassNamesFromExpression(string expr)
    {
        var result = new List<string>();
        foreach (Match sm in Regex.Matches(expr, @"[""']([a-zA-Z0-9_\-\.]+)[""']"))
        {
            var val = sm.Groups[1].Value.Trim();
            if (string.IsNullOrEmpty(val)) continue;
            if (val.Equals("true", StringComparison.OrdinalIgnoreCase) ||
                val.Equals("false", StringComparison.OrdinalIgnoreCase))
                continue;

            if (!result.Contains(val, StringComparer.OrdinalIgnoreCase))
                result.Add(val);
        }
        return result;
    }

    private static List<string> MatchLastEquipmentPool(
        string scriptText,
        string commandPattern,
        List<VariableAssignment> varAssignments)
    {
        var all = MatchAllEquipmentPools(scriptText, commandPattern, varAssignments);
        return all.Count > 0 ? all[^1] : new List<string>();
    }

    private static List<List<string>> MatchAllEquipmentPools(
        string scriptText,
        string commandPattern,
        List<VariableAssignment> varAssignments)
    {
        var results = new List<List<string>>();
        var regex = new Regex($@"\b{commandPattern}\b\s+([^;\r\n}}]+)", RegexOptions.IgnoreCase);

        foreach (Match m in regex.Matches(scriptText))
        {
            var argExpr = m.Groups[1].Value.Trim();
            if (string.IsNullOrEmpty(argExpr)) continue;

            // 1. Одиночный строковый литерал сразу после команды: addWeapon 'rhs_weap_ak74m'
            var singleQuoteMatch = Regex.Match(argExpr, @"^[""']([^""']*)[""']");
            if (singleQuoteMatch.Success)
            {
                var singleClass = singleQuoteMatch.Groups[1].Value.Trim();
                if (!string.IsNullOrEmpty(singleClass) &&
                    !singleClass.Equals("true", StringComparison.OrdinalIgnoreCase) &&
                    !singleClass.Equals("false", StringComparison.OrdinalIgnoreCase))
                {
                    results.Add(new List<string> { singleClass });
                }
                continue;
            }

            // 2. Inline-массив прямо в вызове команды: addUniform (selectRandom ['a', 'b']) или addUniform (['a','b'] call BIS_fnc_selectRandom)
            var bracketMatch = Regex.Match(argExpr, @"\[([^\[\]]+)\]");
            if (bracketMatch.Success)
            {
                var directClasses = ExtractClassNamesFromExpression(bracketMatch.Groups[1].Value);
                if (directClasses.Count > 0)
                {
                    results.Add(directClasses);
                    continue;
                }
            }

            // 3. Ссылка на локальную переменную (напр. _uniform, (_uniform) или (_weapon select 0))
            var varSelectMatch = Regex.Match(argExpr, @"^\(?\s*(_[a-zA-Z0-9_]+)(?:\s+select\s+(\d+))?\s*\)?", RegexOptions.IgnoreCase);
            if (varSelectMatch.Success)
            {
                var varName = varSelectMatch.Groups[1].Value;
                var assign = varAssignments.LastOrDefault(a =>
                    a.Index < m.Index && a.VarName.Equals(varName, StringComparison.OrdinalIgnoreCase))
                    ?? varAssignments.LastOrDefault(a => a.VarName.Equals(varName, StringComparison.OrdinalIgnoreCase));

                if (assign != null)
                {
                    if (varSelectMatch.Groups[2].Success &&
                        int.TryParse(varSelectMatch.Groups[2].Value, out int colIdx) &&
                        assign.SubArrays != null && assign.SubArrays.Count > 0)
                    {
                        var colClasses = new List<string>();
                        foreach (var sub in assign.SubArrays)
                        {
                            if (colIdx >= 0 && colIdx < sub.Count &&
                                !colClasses.Contains(sub[colIdx], StringComparer.OrdinalIgnoreCase))
                            {
                                colClasses.Add(sub[colIdx]);
                            }
                        }
                        if (colClasses.Count > 0)
                        {
                            results.Add(colClasses);
                            continue;
                        }
                    }

                    if (assign.Classes.Count > 0)
                    {
                        results.Add(new List<string>(assign.Classes));
                    }
                }
            }
        }

        return results;
    }

    private static void ParseUnitItemsInBlock(string block, UnitLoadout loadout, int multiplier)
    {
        var itemRegex = new Regex(@"add(ItemToUniform|ItemToVest|ItemToBackpack|Magazine|Item)\s+[""']([^""']+)[""']", RegexOptions.IgnoreCase);
        foreach (Match m in itemRegex.Matches(block))
        {
            var cmd = m.Groups[1].Value.ToLowerInvariant();
            var cls = m.Groups[2].Value;
            AddCount(loadout.ItemsAndMagazines, cls, multiplier);

            if (cmd == "itemtouniform") AddCount(loadout.UniformItems, cls, multiplier);
            else if (cmd == "itemtovest") AddCount(loadout.VestItems, cls, multiplier);
            else if (cmd == "itemtobackpack") AddCount(loadout.BackpackItems, cls, multiplier);
        }
    }

    private static void ParseCargoCommand(string scriptText, string commandPattern, Dictionary<string, int> target)
    {
        // Поддержка и циклов for "_i" from 1 to N do { _veh addMagazineCargoGlobal ["...", M]; }
        var loopRegex = new Regex(@"for\s+[""'][^""']+[""']\s+from\s+(\d+)\s+to\s+(\d+)\s+do\s*\{([^}]+)\}", RegexOptions.IgnoreCase);
        var textWithoutLoops = loopRegex.Replace(scriptText, match =>
        {
            int from = int.Parse(match.Groups[1].Value);
            int to = int.Parse(match.Groups[2].Value);
            int mult = Math.Max(1, to - from + 1);
            ParseCargoCommandSingle(match.Groups[3].Value, commandPattern, target, mult);
            return string.Empty;
        });

        ParseCargoCommandSingle(textWithoutLoops, commandPattern, target, 1);
    }

    private static void ParseCargoCommandSingle(string text, string commandPattern, Dictionary<string, int> target, int multiplier)
    {
        var regex = new Regex($@"{commandPattern}\s*\[\s*[""']([^""']+)[""']\s*,\s*(\d+)\s*\]", RegexOptions.IgnoreCase);
        foreach (Match m in regex.Matches(text))
        {
            var itemClass = m.Groups[1].Value;
            int count = int.Parse(m.Groups[2].Value) * multiplier;
            AddCount(target, itemClass, count);
        }
    }

    private static List<(string ScriptPath, string? RoleArg)> ParseInitCalls(string initScript)
    {
        var list = new List<(string ScriptPath, string? RoleArg)>();
        if (string.IsNullOrWhiteSpace(initScript)) return list;

        int prevEnd = 0;
        foreach (Match pathMatch in Regex.Matches(initScript, @"[""']([^""']+\.sqf)[""']", RegexOptions.IgnoreCase))
        {
            string scriptPath = pathMatch.Groups[1].Value.Replace("/", "\\").TrimStart('\\');
            string? roleArg = null;

            string segmentBefore = initScript[prevEnd..pathMatch.Index];
            prevEnd = pathMatch.Index + pathMatch.Length;

            var argsMatch = Regex.Match(segmentBefore, @"\[\s*this\s*(?:,\s*[""']([^""']+)[""'])+\s*\]", RegexOptions.IgnoreCase);
            if (argsMatch.Success)
            {
                var captures = argsMatch.Groups[1].Captures;
                if (captures.Count > 0)
                    roleArg = captures[^1].Value;
            }

            list.Add((scriptPath, roleArg));
        }

        return list;
    }

    private static string ExtractSwitchCaseBlock(string scriptText, string caseName)
    {
        var caseRegex = new Regex($@"case\s+[""']{Regex.Escape(caseName)}[""']\s*:\s*\{{", RegexOptions.IgnoreCase);
        var match = caseRegex.Match(scriptText);
        if (!match.Success) return scriptText;

        int startIdx = match.Index + match.Length;
        int depth = 1;
        for (int i = startIdx; i < scriptText.Length; i++)
        {
            if (scriptText[i] == '{') depth++;
            else if (scriptText[i] == '}')
            {
                depth--;
                if (depth == 0)
                {
                    return scriptText[startIdx..i];
                }
            }
        }

        return scriptText[startIdx..];
    }

    private static bool IsLoadedMagazineOrRound(string itemClass)
    {
        var lower = itemClass.ToLowerInvariant();
        if (lower.Contains("_acc_") || lower.Contains("optic_") || lower.Contains("muzzle_") ||
            lower.Contains("bipod") || lower.Contains("silencer") || lower.Contains("snds_") ||
            lower.Contains("flashlight") || lower.Contains("laser") || lower.Contains("pointer") ||
            lower.Contains("grip"))
        {
            return false;
        }

        return lower.Contains("rnd") || lower.Contains("mag") || lower.Contains("vog") ||
               lower.Contains("grd40") || lower.Contains("vg40") || lower.Contains("pg7") ||
               lower.Contains("og7") || lower.Contains("tbg7") || lower.Contains("m433") ||
               lower.Contains("m441") || lower.Contains("pouch") || lower.Contains("shell");
    }

    private static void ClassifyWeaponPool(SquadUnit unit, List<string> weaponPool)
    {
        if (weaponPool.Count == 0) return;
        string w = weaponPool[0];
        var lower = w.ToLowerInvariant();

        // 1. Маски, очки, балаклавы, шемаги, шарфы, бороды, наколенники (в т.ч. прописанные в слот NVG и выдаваемые через addWeapon)
        if (IsGogglesOrFacewearClass(lower))
        {
            if (string.IsNullOrEmpty(unit.Loadout.Goggles))
            {
                unit.Loadout.Goggles = w;
                unit.Loadout.GogglesVariants = weaponPool;
            }
            else
            {
                foreach (var item in weaponPool)
                {
                    if (!unit.Loadout.LinkedItems.Contains(item, StringComparer.OrdinalIgnoreCase))
                        unit.Loadout.LinkedItems.Add(item);
                }
            }
            return;
        }

        // 2. ПНВ, гарнитуры в слоте ПНВ (6М2 и т.д.), бинокли, дальномеры, перископы, тепловизоры, прицелы ПТРК, спецпредметы
        if (IsNvgBinocularOrSpecialItemClass(lower))
        {
            foreach (var b in weaponPool)
            {
                if (!unit.Loadout.LinkedItems.Contains(b, StringComparer.OrdinalIgnoreCase))
                    unit.Loadout.LinkedItems.Add(b);
            }
            return;
        }

        // 3. Защита от случайного попадания формы / бронежилетов / шлемов / рюкзаков в слот оружия
        if (IsWearableContainerOrHeadgearClass(lower))
        {
            return;
        }

        // 4. Гранатометы, ПТ-трубы, ПЗРК, станки/сумки CSW (SecondaryWeapon)
        if (IsSecondaryLauncherClass(lower))
        {
            unit.SecondaryWeapon = w;
            unit.Loadout.SecondaryWeaponVariants = weaponPool;
            return;
        }

        // 5. Пистолеты, ракетницы, подствольники отдельно, сложенные PDW во втором слоте (Handgun)
        if (IsHandgunClass(lower))
        {
            unit.Handgun = w;
            unit.Loadout.HandgunVariants = weaponPool;
            return;
        }

        // 6. Основное стрелковое оружие (PrimaryWeapon)
        if (string.IsNullOrEmpty(unit.PrimaryWeapon))
        {
            unit.PrimaryWeapon = w;
            unit.Loadout.PrimaryWeaponVariants = weaponPool;
        }
        else if (string.IsNullOrEmpty(unit.Handgun) &&
                 (lower.Contains("_folded") || lower.Contains("weap_") || lower.Contains("hgun_")))
        {
            // Если основное оружие уже выдано (например, снайперская винтовка XM2010), то второй вызов addWeapon со сложенным MP7/PDW идет в пистолетный слот
            unit.Handgun = w;
            unit.Loadout.HandgunVariants = weaponPool;
        }
    }

    private static bool IsGogglesOrFacewearClass(string lower)
    {
        if (lower.StartsWith("g_") || lower.StartsWith("cup_g_") || lower.StartsWith("tryk_g_") ||
            lower.StartsWith("jca_g_") || lower.StartsWith("pbw_balaclava") || lower.StartsWith("yuebalaklava"))
            return true;

        return lower.Contains("balaclava") || lower.Contains("balaklava") || lower.Contains("goggles") ||
               lower.Contains("shemag") || lower.Contains("scarf") || lower.Contains("bandana") ||
               lower.Contains("bandanna") || lower.Contains("glasses") || lower.Contains("shades") ||
               lower.Contains("kneepad") || lower.Contains("beard") || lower.Contains("facewear") ||
               lower.Contains("lowprofile") || lower.Contains("aviator") || lower.Contains("shm62") ||
               lower.Contains("shmg_") || lower.Contains("pmk2");
    }

    private static bool IsNvgBinocularOrSpecialItemClass(string lower)
    {
        return lower.Contains("nvg") || lower.EndsWith("_nv") || lower.Contains("1pn138") ||
               lower.Contains("anpvs") || lower.Contains("pvs14") || lower.Contains("pvs15") ||
               lower.Contains("pvs7") || lower.Contains("pvs31") || lower.Contains("gpnvg") ||
               lower.Contains("psq42") || lower.Contains("envg") || lower.Contains("6m2") ||
               lower.Contains("earmuff") || lower.Contains("headphone") || lower.Contains("headset_nv") ||
               lower.Contains("binocular") || lower.Contains("bino") || lower.Contains("vector") ||
               lower.Contains("pdu4") || lower.Contains("zrak") || lower.Contains("rd7j") ||
               lower.Contains("lerca") || lower.Contains("tr8") || lower.Contains("rangefinder") ||
               lower.Contains("laserdesignator") || lower.Contains("soflam") || lower.Contains("periscope") ||
               lower.Contains("leopold") || lower.Contains("mx2a") || lower.Contains("daysight") ||
               lower.Contains("javelin_clu") || lower.Contains("camrecorder") || lower.Contains("xnooz_micro") ||
               lower.Contains("itemmap") || lower.Contains("itemcompass") || lower.Contains("itemwatch") ||
               lower.Contains("itemradio") || lower.Contains("itemgps") || lower.Contains("uavterminal") ||
               lower.Contains("microdagr") || lower.Contains("minedetector");
    }

    private static bool IsWearableContainerOrHeadgearClass(string lower)
    {
        if (lower.StartsWith("u_") || lower.StartsWith("v_") || lower.StartsWith("b_") || lower.StartsWith("h_") ||
            lower.StartsWith("cup_u_") || lower.StartsWith("cup_v_") || lower.StartsWith("cup_b_") || lower.StartsWith("cup_h_") ||
            lower.StartsWith("tryk_u_") || lower.StartsWith("tryk_v_") || lower.StartsWith("tryk_b_") || lower.StartsWith("tryk_h_"))
            return true;

        return lower.Contains("uniform") || lower.Contains("fatigue") || lower.Contains("helmet") ||
               lower.Contains("boonie") || lower.Contains("beret") || lower.Contains("beanie") ||
               lower.Contains("fieldcap") || lower.Contains("headwrap") || lower.Contains("opscore") ||
               lower.Contains("kitbag") || lower.Contains("carryall") || lower.Contains("assaultpack") ||
               lower.Contains("fieldpack") || lower.Contains("platecarrier") || lower.Contains("tacvest") ||
               lower.Contains("6b47") || lower.Contains("6b45") || lower.Contains("6b23") ||
               lower.Contains("6b26") || lower.Contains("6b27") || lower.Contains("6b28") ||
               lower.Contains("6b7_1m") || lower.Contains("tsh4") || lower.Contains("zsh7") ||
               lower.Contains("ssh68") || lower.Contains("sh68");
    }

    private static bool IsSecondaryLauncherClass(string lower)
    {
        return lower.Contains("rpg") || lower.Contains("launch") || lower.Contains("at4") ||
               lower.Contains("nlaw") || lower.Contains("m72") || lower.Contains("panzerfaust") ||
               lower.Contains("faust") || lower.Contains("pzf") || lower.Contains("rgw90") ||
               lower.Contains("igla") || lower.Contains("stinger") || lower.Contains("smaw") ||
               lower.Contains("rshg") || lower.Contains("rmg") || lower.Contains("rpo") ||
               lower.Contains("strela") || lower.Contains("jav") || lower.Contains("fgm148") ||
               lower.Contains("fim92") || lower.Contains("maaws") || lower.Contains("m136") ||
               lower.Contains("titan") || lower.Contains("vorona") || lower.Contains("metis") ||
               lower.Contains("spg9") || lower.Contains("apilas") || lower.Contains("eryx") ||
               lower.Contains("m47") || lower.Contains("gustav") || lower.Contains("verba") ||
               lower.Contains("ace_csw_");
    }

    private static bool IsHandgunClass(string lower)
    {
        return lower.Contains("pistol") || lower.Contains("makarov") || lower.Contains("pya") ||
               lower.EndsWith("_m9") || lower.Contains("weap_m9_") || lower.Contains("glock") ||
               lower.Contains("tt33") || lower.Contains("aps") || lower.Contains("cz99") ||
               lower.Contains("1911") || lower.Contains("rsp30") || lower.Contains("flare") ||
               lower.Contains("hgun") || lower.Contains("usp") || lower.Contains("p226") ||
               lower.Contains("revolver") || lower.Contains("6p53") || lower.Contains("pb_6p9") ||
               lower.Contains("6p9") || lower.Contains("bwa3_p8") || lower.Contains("bwa3_p2a1") ||
               lower.Contains("uk3cb_baf_l9a1") || lower.Contains("savz61_folded") ||
               lower.Contains("mp7a2_folded") || lower.Equals("rhs_weap_m320");
    }

    private static string StripComments(string sqf)
    {
        var noBlock = Regex.Replace(sqf, @"/\*[\s\S]*?\*/", string.Empty);
        return Regex.Replace(noBlock, @"//.*$", string.Empty, RegexOptions.Multiline);
    }

    private static string? ReadScriptSafe(PboArchive archive, string relativePath)
    {
        var entry = archive.Entries.FirstOrDefault(e =>
            e.FileName.Equals(relativePath, StringComparison.OrdinalIgnoreCase));
        if (entry == null) return null;

        try
        {
            return archive.GetFileContentAsString(entry.FileName);
        }
        catch
        {
            return null;
        }
    }

    private static void AddCount(Dictionary<string, int> dict, string key, int count)
    {
        if (dict.TryGetValue(key, out int existing))
            dict[key] = existing + count;
        else
            dict[key] = count;
    }
}