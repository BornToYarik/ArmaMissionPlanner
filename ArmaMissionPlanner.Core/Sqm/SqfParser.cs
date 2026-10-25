using System.Text.RegularExpressions;
using ArmaMissionPlanner.Core.Models;
using ArmaMissionPlanner.Core.Pbo;

namespace ArmaMissionPlanner.Core.Sqm;

public static class SqfParser
{
    public static void PopulateUnitLoadout(SquadUnit unit, PboArchive archive)
    {
        var (scriptPath, roleArg) = ParseInitCall(unit.InitScript);
        if (string.IsNullOrEmpty(scriptPath)) return;

        var scriptText = ReadScriptSafe(archive, scriptPath);
        if (string.IsNullOrEmpty(scriptText)) return;

        scriptText = StripComments(scriptText);
        if (!string.IsNullOrEmpty(roleArg))
        {
            scriptText = ExtractSwitchCaseBlock(scriptText, roleArg);
        }

        // 1. Форма, броня, рюкзак, каска
        unit.Loadout.Uniform = MatchLastSingleArg(scriptText, @"(?:forceAddUniform|addUniform)\s+[""']([^""']+)[""']");
        unit.Loadout.Vest = MatchLastSingleArg(scriptText, @"addVest\s+[""']([^""']+)[""']");
        unit.Loadout.Backpack = MatchLastSingleArg(scriptText, @"addBackpack(?:Global)?\s+[""']([^""']+)[""']");
        unit.Loadout.Headgear = MatchLastSingleArg(scriptText, @"addHeadgear\s+[""']([^""']+)[""']");
        unit.Loadout.Goggles = MatchLastSingleArg(scriptText, @"addGoggles\s+[""']([^""']+)[""']");

        // 2. Оружие
        var weaponMatches = Regex.Matches(scriptText, @"addWeapon(?:Global)?\s+[""']([^""']+)[""']", RegexOptions.IgnoreCase);
        foreach (Match m in weaponMatches)
        {
            var w = m.Groups[1].Value;
            ClassifyWeapon(unit, w);
        }

        // 3. Обвесы и спецсредства
        foreach (Match m in Regex.Matches(scriptText, @"add(?:Primary|Secondary|Handgun)WeaponItem\s+[""']([^""']+)[""']", RegexOptions.IgnoreCase))
        {
            var item = m.Groups[1].Value;
            if (!unit.Loadout.WeaponAttachments.Contains(item))
                unit.Loadout.WeaponAttachments.Add(item);
        }

        foreach (Match m in Regex.Matches(scriptText, @"linkItem\s+[""']([^""']+)[""']", RegexOptions.IgnoreCase))
        {
            var item = m.Groups[1].Value;
            if (!unit.Loadout.LinkedItems.Contains(item))
                unit.Loadout.LinkedItems.Add(item);
        }

        // 4. Сначала обрабатываем циклы: for "_i" from 1 to N do { ... addItemToVest "class" ... }
        var loopRegex = new Regex(@"for\s+[""'][^""']+[""']\s+from\s+(\d+)\s+to\s+(\d+)\s+do\s*\{([^}]+)\}", RegexOptions.IgnoreCase);
        var textWithoutLoops = loopRegex.Replace(scriptText, match =>
        {
            int from = int.Parse(match.Groups[1].Value);
            int to = int.Parse(match.Groups[2].Value);
            int count = Math.Max(1, to - from + 1);
            string body = match.Groups[3].Value;

            ParseUnitItemsInBlock(body, unit.Loadout.ItemsAndMagazines, count);
            return string.Empty; // Удаляем обработанный цикл, чтобы не посчитать его второй раз
        });

        // 5. Одиночные добавления и addMagazines ["class", count]
        ParseUnitItemsInBlock(textWithoutLoops, unit.Loadout.ItemsAndMagazines, 1);

        foreach (Match m in Regex.Matches(textWithoutLoops, @"addMagazines\s*\[\s*[""']([^""']+)[""']\s*,\s*(\d+)\s*\]", RegexOptions.IgnoreCase))
        {
            AddCount(unit.Loadout.ItemsAndMagazines, m.Groups[1].Value, int.Parse(m.Groups[2].Value));
        }
    }

    public static void PopulateVehicleCargo(MissionVehicle vehicle, PboArchive archive)
    {
        var (scriptPath, typeArg) = ParseInitCall(vehicle.InitScript);
        if (string.IsNullOrEmpty(scriptPath)) return;

        var scriptText = ReadScriptSafe(archive, scriptPath);
        if (string.IsNullOrEmpty(scriptText)) return;

        scriptText = StripComments(scriptText);
        if (!string.IsNullOrEmpty(typeArg))
        {
            scriptText = ExtractSwitchCaseBlock(scriptText, typeArg);
        }

        ParseCargoCommand(scriptText, @"addWeaponCargo(?:Global)?", vehicle.Cargo.Weapons);
        ParseCargoCommand(scriptText, @"addMagazineCargo(?:Global)?", vehicle.Cargo.Magazines);
        ParseCargoCommand(scriptText, @"addItemCargo(?:Global)?", vehicle.Cargo.Items);
        ParseCargoCommand(scriptText, @"addBackpackCargo(?:Global)?", vehicle.Cargo.Backpacks);
    }

    public static void ExtractBriefing(MissionInfo mission, PboArchive archive)
    {
        // Ищем все sqf файлы, связанные с брифингом (или проверяем init.sqf)
        var briefingEntries = archive.Entries
            .Where(e => e.FileName.Contains("briefing", StringComparison.OrdinalIgnoreCase) &&
                        e.FileName.EndsWith(".sqf", StringComparison.OrdinalIgnoreCase))
            .ToList();

        foreach (var entry in briefingEntries)
        {
            var text = ReadScriptSafe(archive, entry.FileName);
            if (string.IsNullOrEmpty(text)) continue;

            // Ищем записи вида ["diary", ["Заголовок", "Текст"]] или macros B_RF / createDiaryRecord
            var recordRegex = new Regex(@"\[\s*[""']diary[""']\s*,\s*\[\s*[""']([^""']+)[""']\s*,\s*[""']([\s\S]*?)[""']\s*\]\s*\]", RegexOptions.IgnoreCase);
            foreach (Match m in recordRegex.Matches(text))
            {
                var title = m.Groups[1].Value.Trim();
                var content = m.Groups[2].Value.Trim();

                mission.Briefing.Add(new BriefingSection
                {
                    Title = $"{title} ({Path.GetFileNameWithoutExtension(entry.FileName)})",
                    HtmlText = content
                });

                // Ищем картинки форм внутри текста брифинга: <img image='...' />
                foreach (Match imgMatch in Regex.Matches(content, @"image\s*=\s*['""]([^'""]+)['""]", RegexOptions.IgnoreCase))
                {
                    var imgPath = imgMatch.Groups[1].Value.Replace("/", "\\");
                    if (!mission.BriefingImages.Contains(imgPath, StringComparer.OrdinalIgnoreCase))
                        mission.BriefingImages.Add(imgPath);
                }
            }
        }
    }

    private static void ParseUnitItemsInBlock(string block, Dictionary<string, int> target, int multiplier)
    {
        var itemRegex = new Regex(@"add(?:ItemToUniform|ItemToVest|ItemToBackpack|Magazine|Item)\s+[""']([^""']+)[""']", RegexOptions.IgnoreCase);
        foreach (Match m in itemRegex.Matches(block))
        {
            AddCount(target, m.Groups[1].Value, multiplier);
        }
    }

    private static void ParseCargoCommand(string scriptText, string commandPattern, Dictionary<string, int> target)
    {
        var regex = new Regex($@"{commandPattern}\s*\[\s*[""']([^""']+)[""']\s*,\s*(\d+)\s*\]", RegexOptions.IgnoreCase);
        foreach (Match m in regex.Matches(scriptText))
        {
            var itemClass = m.Groups[1].Value;
            int count = int.Parse(m.Groups[2].Value);
            AddCount(target, itemClass, count);
        }
    }

    private static (string? ScriptPath, string? RoleArg) ParseInitCall(string initScript)
    {
        if (string.IsNullOrWhiteSpace(initScript)) return (null, null);

        // Находим путь к .sqf
        var pathMatch = Regex.Match(initScript, @"[""']([^""']+\.sqf)[""']", RegexOptions.IgnoreCase);
        if (!pathMatch.Success) return (null, null);

        string scriptPath = pathMatch.Groups[1].Value.Replace("/", "\\").TrimStart('\\');

        // Ищем массив аргументов перед execVM / call, например: [this, "MSV", "KO"]
        string? roleArg = null;
        var argsMatch = Regex.Match(initScript[..pathMatch.Index], @"\[\s*this\s*(?:,\s*[""']([^""']+)[""'])+\s*\]", RegexOptions.IgnoreCase);
        if (argsMatch.Success)
        {
            // Берем последний строковый аргумент (обычно именно он отвечает за роль/тип в switch)
            var captures = argsMatch.Groups[1].Captures;
            if (captures.Count > 0)
                roleArg = captures[^1].Value;
        }

        return (scriptPath, roleArg);
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

    private static void ClassifyWeapon(SquadUnit unit, string w)
    {
        var lower = w.ToLowerInvariant();
        if (lower.Contains("binocular") || lower.Contains("vector") || lower.Contains("pdu4") || lower.Contains("lerca") || lower.Contains("tr8"))
        {
            if (!unit.Loadout.LinkedItems.Contains(w))
                unit.Loadout.LinkedItems.Add(w);
        }
        else if (lower.Contains("rpg") || lower.Contains("launch") || lower.Contains("at4") || lower.Contains("nlaw") || lower.Contains("m72") || lower.Contains("panzerfaust") || lower.Contains("igla") || lower.Contains("stinger") || lower.Contains("smaw") || lower.Contains("rshg"))
        {
            unit.SecondaryWeapon = w;
        }
        else if (lower.Contains("pistol") || lower.Contains("makarov") || lower.Contains("pya") || lower.Contains("m9") || lower.Contains("glock") || lower.Contains("tt33") || lower.Contains("aps") || lower.Contains("cz99") || lower.Contains("1911") || lower.Contains("rsp30") || lower.Contains("flare"))
        {
            unit.Handgun = w;
        }
        else
        {
            if (string.IsNullOrEmpty(unit.PrimaryWeapon))
                unit.PrimaryWeapon = w;
            else if (string.IsNullOrEmpty(unit.SecondaryWeapon))
                unit.SecondaryWeapon = w;
        }
    }

    private static string MatchLastSingleArg(string text, string pattern)
    {
        var matches = Regex.Matches(text, pattern, RegexOptions.IgnoreCase);
        return matches.Count > 0 ? matches[^1].Groups[1].Value : string.Empty;
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