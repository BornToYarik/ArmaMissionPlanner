using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using ArmaMissionPlanner.Core.Models;
using ArmaMissionPlanner.Core.Pbo;

namespace ArmaMissionPlanner.Core.Sqm;

public static class MissionValidator
{
    // Автоматические системные файлы Армы, которые движок вызывает сам (не считаются "неиспользуемыми")
    private static readonly HashSet<string> EngineEntryFiles = new(StringComparer.OrdinalIgnoreCase)
    {
        "mission.sqm",
        "description.ext",
        "init.sqf",
        "initserver.sqf",
        "initplayerlocal.sqf",
        "initplayerserver.sqf",
        "onplayerkilled.sqf",
        "onplayerrespawn.sqf",
        "cba_settings.sqf",
        "stringtable.xml",
        "briefing.sqf"
    };

    // Запрещенное ванильное оружие/броня/фургоны из п. 5.6 и 5.8 правил WOG
    private static readonly string[] ForbiddenVanillaPrefixes =
    {
        "arifle_MX", "arifle_Katiba", "arifle_TRG2", "arifle_Mk20", "arifle_SDAR",
        "arifle_SPAR_", "arifle_CTAR_", "arifle_ARX_", "arifle_MSBS65_", "arifle_AK12_",
        "LMG_Mk200", "LMG_Zafir", "LMG_03_F", "MMG_01_", "MMG_02_",
        "srifle_EBR", "srifle_DMR_01", "srifle_DMR_02", "srifle_DMR_03", "srifle_DMR_04",
        "srifle_DMR_05", "srifle_DMR_06", "srifle_DMR_07", "srifle_GM6", "srifle_LRR",
        "launch_NLAW_F", "launch_RPG32_F", "launch_B_Titan", "launch_O_Titan", "launch_I_Titan",
        "U_B_CombatUniform", "U_O_CombatUniform", "U_I_CombatUniform",
        "V_PlateCarrier1_", "V_PlateCarrier2_", "V_PlateCarrierGL_", "V_PlateCarrierSpec_",
        "H_HelmetB", "H_HelmetO_", "H_HelmetIA",
        "C_Van_02_", "B_G_Van_02_", "O_G_Van_02_", "I_C_Van_02_", "I_E_Van_02_"
    };

    public static List<ValidationIssue> Validate(
        SqmClass root,
        MissionInfo mission,
        PboArchive? archive,
        string? pboFileName,
        bool isBinarized)
    {
        var issues = new List<ValidationIssue>();
        int totalPlayableSlots = mission.Groups.Sum(g => g.Units.Count);

        // =========================================================================
        // 1. НАЗВАНИЕ ФАЙЛА (Раздел 1 правил)
        // =========================================================================
        ValidateFileName(pboFileName, totalPlayableSlots, issues);

        // =========================================================================
        // 2. ОБЩИЕ НАСТРОЙКИ, БИНАРИЗАЦИЯ, ПОГОДА И ЛОББИ (Раздел 2 правил)
        // =========================================================================
        ValidateGeneralAndIntel(root, mission, archive, totalPlayableSlots, isBinarized, issues);

        // =========================================================================
        // 3. БРИФИНГ И КАРТИНКИ ФОРМ (Раздел 3 правил)
        // =========================================================================
        ValidateBriefing(mission, issues);

        // =========================================================================
        // 4. СЛОТЫ, ШТАБ, МЕДИКИ И ИНЖЕНЕРЫ (Раздел 4 правил)
        // =========================================================================
        ValidateSlotsAndRoles(mission, totalPlayableSlots, issues);

        // =========================================================================
        // 5. ТЕХНИКА, ОЧИСТКА ХРАНИЛИЩА, ВАНИЛА И РЕМКОМПЛЕКТЫ (Раздел 5 правил)
        // =========================================================================
        ValidateVehiclesAndEquipment(root, mission, archive, issues);

        // =========================================================================
        // 6. ФАЙЛЫ PBO, БИТЫЕ ССЫЛКИ, НЕИСПОЛЬЗУЕМЫЕ SQF И ТРИГГЕРЫ (Разделы 5 и 6)
        // =========================================================================
        if (archive != null)
        {
            ValidateFilesAndReferences(root, mission, archive, issues);
        }

        // =========================================================================
        // 7. МОДУЛИ WMT И EDIT TERRAIN OBJECT (Разделы 6 и 7 правил)
        // =========================================================================
        ValidateModulesAndTriggers(root, mission, issues);

        return issues;
    }

    // -------------------------------------------------------------------------
    // Раздел 1: Проверка названия .pbo файла
    // -------------------------------------------------------------------------
    private static void ValidateFileName(string? pboFileName, int totalSlots, List<ValidationIssue> issues)
    {
        const string cat = "1. Название файла и Настройки";
        if (string.IsNullOrWhiteSpace(pboFileName)) return;

        var fileName = Path.GetFileName(pboFileName);

        // Точек должно быть ровно две: <имя>.<остров>.pbo
        int dotCount = fileName.Count(c => c == '.');
        if (dotCount != 2)
        {
            issues.Add(new ValidationIssue
            {
                RuleNumber = "П. 1",
                Category = cat,
                Severity = "Error",
                Title = "Некорректное количество точек в имени файла PBO",
                Details = $"Файл '{fileName}' содержит {dotCount} точ(ек), а по правилам должно быть ровно две: wog_<слоты>_<название>_<версия>.<остров>.pbo (например, версии пишутся слитно без точки: 10 вместо 1.0)."
            });
        }

        var parts = fileName.Split('.');
        var missionPart = parts[0];

        if (missionPart != missionPart.ToLowerInvariant())
        {
            issues.Add(new ValidationIssue
            {
                RuleNumber = "П. 1",
                Category = cat,
                Severity = "Error",
                Title = "Заглавные буквы в названии файла",
                Details = $"Часть имени '{missionPart}' должна состоять строго из строчных букв."
            });
        }

        // Проверка шаблона wog_<слоты>_<название>_<версия>
        var regex = new Regex(@"^wog_(\d+)_([a-z0-9_]+)_(\d+)$");
        var match = regex.Match(missionPart);
        if (!match.Success)
        {
            bool hasVBeforeVersion = Regex.IsMatch(missionPart, @"_v\d+$", RegexOptions.IgnoreCase);
            issues.Add(new ValidationIssue
            {
                RuleNumber = "П. 1",
                Category = cat,
                Severity = "Error",
                Title = "Имя файла не соответствует шаблону WOG",
                Details = hasVBeforeVersion
                    ? $"В файле '{fileName}' использована буква 'v' перед версией, что запрещено правилами (нужно просто цифры, например _10)."
                    : $"Имя '{missionPart}' не подходит под шаблон wog_<кол-во слотов>_<название>_<версия>. Разрешены только строчные латинские буквы, цифры и '_'."
            });
        }
        else
        {
            int fileSlots = int.Parse(match.Groups[1].Value);
            if (fileSlots != totalSlots)
            {
                issues.Add(new ValidationIssue
                {
                    RuleNumber = "П. 1 / 2.1",
                    Category = cat,
                    Severity = "Error",
                    Title = "Количество слотов в имени файла не совпадает с реальным",
                    Details = $"В названии файла указано {fileSlots} слотов, но фактически в миссии {totalSlots} слотов."
                });
            }
            else
            {
                issues.Add(new ValidationIssue
                {
                    RuleNumber = "П. 1",
                    Category = cat,
                    Severity = "Ok",
                    Title = "Название файла PBO соответствует правилам",
                    Details = $"Файл '{fileName}' оформлен верно ({totalSlots} сл.)."
                });
            }
        }
    }

    // -------------------------------------------------------------------------
    // Раздел 2: Настройки, Бинаризация, Погода, Лобби, Картинки <= 200 Кб
    // -------------------------------------------------------------------------
    private static void ValidateGeneralAndIntel(
        SqmClass root,
        MissionInfo mission,
        PboArchive? archive,
        int totalSlots,
        bool isBinarized,
        List<ValidationIssue> issues)
    {
        const string cat = "1. Название файла и Настройки";

        // П. 2.1: Название внутри миссии: WOG <слоты> <Название> <версия>
        if (string.IsNullOrWhiteSpace(mission.Name))
        {
            issues.Add(new ValidationIssue
            {
                RuleNumber = "П. 2.1",
                Category = cat,
                Severity = "Error",
                Title = "Не заполнено название миссии (Представление: Название)",
                Details = "Поле briefingName в настройках миссии пустое."
            });
        }
        else
        {
            if (mission.Name.Contains('_'))
            {
                issues.Add(new ValidationIssue
                {
                    RuleNumber = "П. 2.1",
                    Category = cat,
                    Severity = "Error",
                    Title = "Символ '_' в названии миссии",
                    Details = $"В названии '{mission.Name}' использовано нижнее подчеркивание. По правилам нужно использовать пробелы."
                });
            }

            var nameMatch = Regex.Match(mission.Name.Trim(), @"^WOG\s+(\d+)\s+(.+)\s+(\d+\.\d+)$");
            if (!nameMatch.Success)
            {
                issues.Add(new ValidationIssue
                {
                    RuleNumber = "П. 2.1",
                    Category = cat,
                    Severity = "Warning",
                    Title = "Название миссии отклоняется от шаблона 'WOG <слоты> <Название> <версия>'",
                    Details = $"Текущее название: '{mission.Name}'. Ожидается формат вида 'WOG {totalSlots} Восход 1.0'."
                });
            }
            else
            {
                int titleSlots = int.Parse(nameMatch.Groups[1].Value);
                if (titleSlots != totalSlots)
                {
                    issues.Add(new ValidationIssue
                    {
                        RuleNumber = "П. 2.1",
                        Category = cat,
                        Severity = "Error",
                        Title = "Число слотов в названии миссии не совпадает с реальным",
                        Details = $"В названии '{mission.Name}' указано {titleSlots} сл., а в миссии {totalSlots} сл."
                    });
                }
                else
                {
                    issues.Add(new ValidationIssue
                    {
                        RuleNumber = "П. 2.1",
                        Category = cat,
                        Severity = "Ok",
                        Title = "Название миссии оформлено по шаблону",
                        Details = $"'{mission.Name}'"
                    });
                }
            }
        }

        // П. 2.2: Автор
        if (string.IsNullOrWhiteSpace(mission.Author))
        {
            issues.Add(new ValidationIssue
            {
                RuleNumber = "П. 2.2",
                Category = cat,
                Severity = "Error",
                Title = "Не указан Автор миссии",
                Details = "Поле 'Представление: Автор' в атрибутах миссии не заполнено."
            });
        }

        // П. 2.2: Бинаризация mission.sqm
        if (!isBinarized)
        {
            issues.Add(new ValidationIssue
            {
                RuleNumber = "П. 2.2",
                Category = cat,
                Severity = "Error",
                Title = "Бинаризация файла mission.sqm отключена",
                Details = "По правилам проекта бинаризация файлов в настройках миссии обязательно должна быть включена."
            });
        }
        else
        {
            issues.Add(new ValidationIssue
            {
                RuleNumber = "П. 2.2",
                Category = cat,
                Severity = "Ok",
                Title = "Бинаризация mission.sqm включена",
                Details = "Файл mission.sqm сохранен в бинарном формате RAP."
            });
        }

        // П. 2.2: Размер одного изображения не более 200 Кб (± 10 Кб => 210 Кб)
        if (archive != null)
        {
            var imageEntries = archive.Entries.Where(e =>
            {
                var ext = Path.GetExtension(e.FileName).ToLowerInvariant();
                return ext is ".jpg" or ".jpeg" or ".paa" or ".png";
            }).ToList();

            foreach (var img in imageEntries)
            {
                double sizeKb = img.DataSize / 1024.0;
                if (sizeKb > 210.0)
                {
                    issues.Add(new ValidationIssue
                    {
                        RuleNumber = "П. 2.2",
                        Category = cat,
                        Severity = "Error",
                        Title = $"Превышен лимит веса изображения ({sizeKb:F1} КБ)",
                        Details = $"Файл '{img.FileName}' весит {sizeKb:F1} КБ при максимуме 200 КБ (±10 КБ)."
                    });
                }
            }
        }

        // П. 2.3: Окружение (Дождь и Ветер <= 40%, Туман на островах CUP)
        var intel = root.GetClass("Mission")?.GetClass("Intel");
        if (intel != null)
        {
            float startRain = ReadFloat(intel, "startRain");
            float forecastRain = ReadFloat(intel, "forecastRain");
            float maxRain = Math.Max(startRain, forecastRain);
            if (maxRain > 0.401f)
            {
                issues.Add(new ValidationIssue
                {
                    RuleNumber = "П. 2.3",
                    Category = cat,
                    Severity = "Error",
                    Title = $"Превышена интенсивность дождя ({maxRain * 100:F0}%)",
                    Details = $"Запрещено использовать дождь более 40% (старт: {startRain * 100:F0}%, прогноз: {forecastRain * 100:F0}%)."
                });
            }

            float startWind = ReadFloat(intel, "startWind");
            float forecastWind = ReadFloat(intel, "forecastWind");
            float maxWind = Math.Max(startWind, forecastWind);
            if (maxWind > 0.401f)
            {
                issues.Add(new ValidationIssue
                {
                    RuleNumber = "П. 2.3",
                    Category = cat,
                    Severity = "Error",
                    Title = $"Превышена интенсивность ветра ({maxWind * 100:F0}%)",
                    Details = $"Запрещено использовать ветер более 40% (старт: {startWind * 100:F0}%, прогноз: {forecastWind * 100:F0}%)."
                });
            }

            float startFog = ReadFloat(intel, "startFog");
            float forecastFog = ReadFloat(intel, "forecastFog");
            if ((startFog > 0.01f || forecastFog > 0.01f) && Math.Abs(startFog - forecastFog) > 0.01f)
            {
                issues.Add(new ValidationIssue
                {
                    RuleNumber = "П. 2.3",
                    Category = cat,
                    Severity = "Warning",
                    Title = "Различаются начальный туман и прогноз тумана",
                    Details = $"Старт тумана: {startFog * 100:F0}%, прогноз: {forecastFog * 100:F0}%. На картах с водоемами CUP туман разрешен только если старт и прогноз одинаковы."
                });
            }
        }

        // П. 2.4: Сводка в лобби (<фракция> (<цвет>, атака) vs <фракция> (<цвет>, оборона))
        if (string.IsNullOrWhiteSpace(mission.Overview))
        {
            issues.Add(new ValidationIssue
            {
                RuleNumber = "П. 2.4",
                Category = cat,
                Severity = "Error",
                Title = "Не заполнена сводка в лобби (OverviewText)",
                Details = "Ожидается шаблон: <фракция атаки> (<цвет>, атака) vs <фракция обороны> (<цвет>, оборона)."
            });
        }
        else if (!mission.Overview.Contains('(') || !mission.Overview.Contains(')'))
        {
            issues.Add(new ValidationIssue
            {
                RuleNumber = "П. 2.4",
                Category = cat,
                Severity = "Warning",
                Title = "Сводка в лобби может не соответствовать шаблону",
                Details = $"Текущая сводка: '{mission.Overview}'. Проверьте наличие (<цвет стороны>, атака/оборона)."
            });
        }
    }

    // -------------------------------------------------------------------------
    // Раздел 3: Брифинг, ссылки на маркеры и скриншоты форм сторон
    // -------------------------------------------------------------------------
    private static void ValidateBriefing(MissionInfo mission, List<ValidationIssue> issues)
    {
        const string cat = "3. Брифинг";

        if (mission.Briefing.Count == 0)
        {
            issues.Add(new ValidationIssue
            {
                RuleNumber = "П. 3",
                Category = cat,
                Severity = "Error",
                Title = "Отсутствует брифинг миссии",
                Details = "В PBO не найдены вкладки дневника (createDiaryRecord в briefing.sqf)."
            });
            return;
        }

        // Проверяем все ссылки <marker name='...'> внутри текста брифинга
        var existingMarkers = new HashSet<string>(mission.Markers.Select(m => m.Name), StringComparer.OrdinalIgnoreCase);
        var markerRefRegex = new Regex(@"<marker\s+name\s*=\s*['""]([^'""]+)['""]", RegexOptions.IgnoreCase);
        var missingMarkers = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var sec in mission.Briefing)
        {
            foreach (Match m in markerRefRegex.Matches(sec.HtmlText))
            {
                var markerName = m.Groups[1].Value.Trim();
                if (!string.IsNullOrEmpty(markerName) && !existingMarkers.Contains(markerName))
                {
                    missingMarkers.Add($"{markerName} (вкладка '{sec.Title}')");
                }
            }
        }

        if (missingMarkers.Count > 0)
        {
            issues.Add(new ValidationIssue
            {
                RuleNumber = "П. 3",
                Category = cat,
                Severity = "Error",
                Title = "В брифинге есть ссылки на несуществующие маркеры",
                Details = $"Маркеры отсутствуют в mission.sqm: {string.Join(", ", missingMarkers)}."
            });
        }
        else
        {
            issues.Add(new ValidationIssue
            {
                RuleNumber = "П. 3",
                Category = cat,
                Severity = "Ok",
                Title = "Все ссылки на маркеры в брифинге валидны",
                Details = $"Проверено вкладок брифинга: {mission.Briefing.Count}."
            });
        }

        if (mission.BriefingImages.Count == 0)
        {
            issues.Add(new ValidationIssue
            {
                RuleNumber = "П. 3",
                Category = cat,
                Severity = "Warning",
                Title = "В брифинге не найдены изображения форм сторон",
                Details = "Для больших игр обязательно добавлять скриншоты с изображением сторон конфликта."
            });
        }
    }

    // -------------------------------------------------------------------------
    // Раздел 4: Слоты (<= 220), Штабное 1-е отделение, >= 3 медиков, Инженеры
    // -------------------------------------------------------------------------
    private static void ValidateSlotsAndRoles(MissionInfo mission, int totalSlots, List<ValidationIssue> issues)
    {
        const string cat = "4. Слоты и Стороны";

        if (totalSlots > 220)
        {
            issues.Add(new ValidationIssue
            {
                RuleNumber = "П. 4.1",
                Category = cat,
                Severity = "Error",
                Title = $"Превышен лимит слотов на миссии ({totalSlots} > 220)",
                Details = "Количество слотов на миссиях WOG не должно превышать 220."
            });
        }
        else
        {
            issues.Add(new ValidationIssue
            {
                RuleNumber = "П. 4.1",
                Category = cat,
                Severity = "Ok",
                Title = $"Количество слотов в пределах нормы ({totalSlots} / 220)",
                Details = $"Сторон конфликта: {mission.Groups.Select(g => g.Side).Distinct().Count()}."
            });
        }

        foreach (var sideGroup in mission.Groups.GroupBy(g => g.Side))
        {
            var side = sideGroup.Key;
            var groups = sideGroup.ToList();
            if (groups.Count == 0) continue;

            // П. 4.3: Первое по списку отделение должно быть штабным
            var firstGroup = groups[0];
            var firstLeaderRole = firstGroup.Units.FirstOrDefault()?.RoleDescription ?? "";
            bool isFirstHq = IsHqText(firstGroup.CallSign) || IsHqText(firstGroup.SquadDescription) || IsHqText(firstLeaderRole);

            if (!isFirstHq)
            {
                issues.Add(new ValidationIssue
                {
                    RuleNumber = "П. 4.3",
                    Category = cat,
                    Severity = "Warning",
                    Title = $"[{side}] Первое отделение может не являться штабным",
                    Details = $"Первое отделение стороны {side}: '{firstGroup.CallSign}' ({firstLeaderRole}). Штабным может быть только 1-е по списку отделение."
                });
            }

            // Проверяем, нет ли штабного отделения ниже по списку
            for (int i = 1; i < groups.Count; i++)
            {
                var g = groups[i];
                var leaderRole = g.Units.FirstOrDefault()?.RoleDescription ?? "";
                if (IsHqText(g.SquadDescription) || leaderRole.Contains("Командир стороны", StringComparison.OrdinalIgnoreCase) || leaderRole.Contains("КС", StringComparison.Ordinal))
                {
                    issues.Add(new ValidationIssue
                    {
                        RuleNumber = "П. 4.3",
                        Category = cat,
                        Severity = "Error",
                        Title = $"[{side}] Штабное отделение стоит не первым по списку",
                        Details = $"Отделение '{g.CallSign}' ({leaderRole}) находится на позиции #{i + 1}, а должно быть 1-м."
                    });
                }
            }

            // П. 4.6: Не менее 3-х медиков на стороне (если на стороне больше 15 человек)
            int sideSlots = groups.Sum(g => g.Units.Count);
            int medicCount = groups.SelectMany(g => g.Units).Count(IsUnitMedic);
            if (sideSlots >= 15 && medicCount < 3)
            {
                issues.Add(new ValidationIssue
                {
                    RuleNumber = "П. 4.6",
                    Category = cat,
                    Severity = "Error",
                    Title = $"[{side}] Недостаточно медиков на стороне ({medicCount} из минимум 3)",
                    Details = $"На стороне {side} ({sideSlots} сл.) найдено всего {medicCount} медик(ов)."
                });
            }
            else
            {
                issues.Add(new ValidationIssue
                {
                    RuleNumber = "П. 4.6",
                    Category = cat,
                    Severity = "Ok",
                    Title = $"[{side}] Медиков на стороне: {medicCount} шт.",
                    Details = "Требование (не менее 3-х медиков на сторону) выполнено."
                });
            }
        }
    }

    // -------------------------------------------------------------------------
    // Раздел 5: Техника, очистка хранилища в атрибутах, ремкомплекты, ванила
    // -------------------------------------------------------------------------
    private static void ValidateVehiclesAndEquipment(
        SqmClass root,
        MissionInfo mission,
        PboArchive? archive,
        List<ValidationIssue> issues)
    {
        const string cat = "5. Техника и Снаряжение";

        // 1. Проверка неочищенного "Хранилища снаряжения" (ammoBox в mission.sqm) у техники и ящиков
        var entitiesRoot = root.GetClass("Mission")?.GetClass("Entities");
        var uncleanedVehicles = new List<string>();
        if (entitiesRoot != null)
        {
            CheckVehicleAmmoBoxRecursive(entitiesRoot, archive, uncleanedVehicles);
        }

        if (uncleanedVehicles.Count > 0)
        {
            issues.Add(new ValidationIssue
            {
                RuleNumber = "П. 5.2",
                Category = cat,
                Severity = "Error",
                Title = $"Не очищено 'Хранилище снаряжения' у техники/ящиков ({uncleanedVehicles.Count} шт.)",
                Details = $"В атрибутах редактора (или через clear*CargoGlobal в SQF) не очищен стандартный инвентарь у: {string.Join(", ", uncleanedVehicles.Take(10))}{(uncleanedVehicles.Count > 10 ? " и др." : "")}."
            });
        }
        else
        {
            issues.Add(new ValidationIssue
            {
                RuleNumber = "П. 5.2",
                Category = cat,
                Severity = "Ok",
                Title = "Хранилище снаряжения всей техники и ящиков очищено",
                Details = "Стандартный инвентарь Армы в атрибутах объектов пуст."
            });
        }

        // 2. Проверка локальности вызова скриптов снаряжения (if (local _unit) / isServer)
        var nonLocalInitEntities = new List<string>();
        foreach (var u in mission.Groups.SelectMany(g => g.Units))
        {
            if (!string.IsNullOrWhiteSpace(u.InitScript) && u.InitScript.Contains(".sqf", StringComparison.OrdinalIgnoreCase))
            {
                if (!IsLocalSafeCall(u.InitScript, archive))
                {
                    nonLocalInitEntities.Add($"Юнит '{u.RoleDescription}' ({u.InitScript.Trim()})");
                }
            }
        }
        foreach (var v in mission.Vehicles)
        {
            if (!string.IsNullOrWhiteSpace(v.InitScript) && v.InitScript.Contains(".sqf", StringComparison.OrdinalIgnoreCase))
            {
                if (!IsLocalSafeCall(v.InitScript, archive))
                {
                    nonLocalInitEntities.Add($"Техника '{v.VehicleClass}' ({v.InitScript.Trim()})");
                }
            }
        }

        if (nonLocalInitEntities.Count > 0)
        {
            issues.Add(new ValidationIssue
            {
                RuleNumber = "П. 5.1",
                Category = cat,
                Severity = "Warning",
                Title = $"Вызов SQF снаряжения без условия локальности ({nonLocalInitEntities.Count} шт.)",
                Details = $"Проверьте наличие условия 'if (local this)' или 'if (isServer)' внутри скрипта или в init: {string.Join("; ", nonLocalInitEntities.Take(5))}."
            });
        }

        // 3. Проверка гусеничной техники на наличие ремкомплекта (ToolKit) и рюкзака в кузове (П. 5.10)
        var trackedWithoutToolkit = new List<string>();
        foreach (var v in mission.Vehicles)
        {
            if (IsTrackedCombatVehicle(v.VehicleClass))
            {
                bool hasToolkit = v.Cargo.Items.Keys.Any(k => k.Equals("ToolKit", StringComparison.OrdinalIgnoreCase));
                bool hasBackpack = v.Cargo.Backpacks.Values.Sum() > 0;
                if (!hasToolkit || !hasBackpack)
                {
                    trackedWithoutToolkit.Add($"{v.VehicleClass} (ToolKit: {(hasToolkit ? "есть" : "НЕТ")}, Рюкзак: {(hasBackpack ? "есть" : "НЕТ")})");
                }
            }
        }

        if (trackedWithoutToolkit.Count > 0)
        {
            issues.Add(new ValidationIssue
            {
                RuleNumber = "П. 5.10 / 4.8",
                Category = cat,
                Severity = "Warning",
                Title = $"Гусеничная техника без ремкомплекта или рюкзака ({trackedWithoutToolkit.Count} шт.)",
                Details = $"По п. 5.10 в гусеничной технике обязательно наличие хотя бы одного ToolKit и рюкзака для него: {string.Join(", ", trackedWithoutToolkit.Take(8))}."
            });
        }

        // 4. Проверка на запрещенное ванильное вооружение, броню и фургон Van (П. 5.6, 5.8)
        var forbiddenFound = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var u in mission.Groups.SelectMany(g => g.Units))
        {
            CheckForbiddenClass(u.PrimaryWeapon, $"у юнита {u.RoleDescription}", forbiddenFound);
            CheckForbiddenClass(u.SecondaryWeapon, $"у юнита {u.RoleDescription}", forbiddenFound);
            CheckForbiddenClass(u.Loadout.Uniform, $"форма у {u.RoleDescription}", forbiddenFound);
            CheckForbiddenClass(u.Loadout.Vest, $"разгрузка у {u.RoleDescription}", forbiddenFound);
            CheckForbiddenClass(u.Loadout.Headgear, $"шлем у {u.RoleDescription}", forbiddenFound);
        }
        foreach (var v in mission.Vehicles)
        {
            CheckForbiddenClass(v.VehicleClass, "техника на карте", forbiddenFound);
            foreach (var w in v.Cargo.Weapons.Keys)
                CheckForbiddenClass(w, $"в кузове {v.VehicleClass}", forbiddenFound);
        }

        if (forbiddenFound.Count > 0)
        {
            issues.Add(new ValidationIssue
            {
                RuleNumber = "П. 5.6 / 5.8",
                Category = cat,
                Severity = "Error",
                Title = $"Обнаружено ванильное снаряжение или запрещенная техника ({forbiddenFound.Count} кл.)",
                Details = $"Запрещено правилами WOG: {string.Join(", ", forbiddenFound.Take(10))}."
            });
        }
    }

    // -------------------------------------------------------------------------
    // Разделы 5.4 и 6.5: Проверка путей файлов, битых ссылок и НЕИСПОЛЬЗУЕМЫХ файлов в PBO
    // -------------------------------------------------------------------------
    private static void ValidateFilesAndReferences(
        SqmClass root,
        MissionInfo mission,
        PboArchive archive,
        List<ValidationIssue> issues)
    {
        const string cat = "6. Файлы PBO и Скрипты";

        // 1. П. 5.4: Запрет пробелов и спецсимволов в названиях файлов (кроме '_', '.', '\', '/')
        var badFileNames = new List<string>();
        foreach (var entry in archive.Entries)
        {
            var norm = entry.FileName.Replace('/', '\\');
            if (!Regex.IsMatch(norm, @"^[a-zA-Z0-9_\\.\-]+$") || norm.Contains(' '))
            {
                badFileNames.Add(entry.FileName);
            }
        }

        if (badFileNames.Count > 0)
        {
            issues.Add(new ValidationIssue
            {
                RuleNumber = "П. 5.4",
                Category = cat,
                Severity = "Error",
                Title = $"Недопустимые символы или пробелы в именах файлов ({badFileNames.Count} шт.)",
                Details = $"Запрещены пробелы и спецсимволы (кроме '_'): {string.Join(", ", badFileNames)}."
            });
        }

        // 2. Построение графа всех используемых файлов и поиск битых ссылок (отсутствующих файлов)
        var allPboFiles = new HashSet<string>(
            archive.Entries.Select(e => NormalizePath(e.FileName)),
            StringComparer.OrdinalIgnoreCase);

        var referencedFiles = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var missingReferences = new List<string>();

        // Помечаем системные входные файлы Армы как используемые
        foreach (var entry in archive.Entries)
        {
            var norm = NormalizePath(entry.FileName);
            if (EngineEntryFiles.Contains(norm) || EngineEntryFiles.Contains(Path.GetFileName(norm)))
            {
                referencedFiles.Add(norm);
            }
        }

        // Собираем все строковые значения из mission.sqm (init, overviewPicture, loadScreen, атрибуты)
        var sqmStrings = new List<(string Context, string Text)>();
        CollectAllStringsFromSqm(root, "mission.sqm", sqmStrings);

        foreach (var (ctx, text) in sqmStrings)
        {
            ExtractFileReferencesFromText(text, ctx, "", allPboFiles, referencedFiles, missingReferences);
        }

        // Также проверяем все текстовые файлы внутри PBO (.sqf, .ext, .hpp, .sqfc) на ссылки друг на друга
        foreach (var entry in archive.Entries)
        {
            var ext = Path.GetExtension(entry.FileName).ToLowerInvariant();
            if (ext is ".sqf" or ".ext" or ".hpp" or ".h" or ".fsm")
            {
                try
                {
                    var content = archive.GetFileContentAsString(entry.FileName);
                    var cleanContent = StripSqfComments(content);
                    var currentDir = Path.GetDirectoryName(NormalizePath(entry.FileName)) ?? "";
                    ExtractFileReferencesFromText(cleanContent, entry.FileName, currentDir, allPboFiles, referencedFiles, missingReferences);
                }
                catch
                {
                    // Пропускаем ошибки чтения
                }
            }
        }

        // Добавляем картинки из брифинга
        foreach (var img in mission.BriefingImages)
        {
            var normImg = NormalizePath(img);
            referencedFiles.Add(normImg);
            if (!allPboFiles.Contains(normImg))
            {
                missingReferences.Add($"Картинка в брифинге '{img}' не найдена в PBO");
            }
        }

        // Отчет по битым ссылкам (когда ссылаются на SQF или картинку, которой НЕТ в PBO!)
        if (missingReferences.Count > 0)
        {
            issues.Add(new ValidationIssue
            {
                RuleNumber = "П. 5.1 / 6",
                Category = cat,
                Severity = "Error",
                Title = $"Найдены ссылки на отсутствующие в PBO файлы ({missingReferences.Count} шт.)",
                Details = string.Join("; ", missingReferences.Distinct().Take(10))
            });
        }
        else
        {
            issues.Add(new ValidationIssue
            {
                RuleNumber = "П. 5.1 / 6",
                Category = cat,
                Severity = "Ok",
                Title = "Все вызываемые скрипты (.sqf) и изображения присутствуют в PBO",
                Details = "Битых ссылок на отсутствующие файлы не обнаружено."
            });
        }

        // Отчет по НЕИСПОЛЬЗУЕМЫМ файлам в PBO (П. 6.5 правил)
        var unusedFiles = allPboFiles
            .Where(f => !referencedFiles.Contains(f))
            .ToList();

        if (unusedFiles.Count > 0)
        {
            issues.Add(new ValidationIssue
            {
                RuleNumber = "П. 6.5",
                Category = cat,
                Severity = "Error",
                Title = $"Обнаружены неиспользуемые файлы в PBO ({unusedFiles.Count} шт.)",
                Details = $"По п. 6.5 запрещено наличие неиспользуемых файлов в PBO: {string.Join(", ", unusedFiles)}."
            });
        }
        else
        {
            issues.Add(new ValidationIssue
            {
                RuleNumber = "П. 6.5",
                Category = cat,
                Severity = "Ok",
                Title = "Неиспользуемых файлов в PBO не обнаружено",
                Details = $"Все файлы архива ({allPboFiles.Count} шт.) задействованы в миссии."
            });
        }
    }

    // -------------------------------------------------------------------------
    // Разделы 6 и 7: Модули WMT_Main, WMT_Time, WMT_Point, Триггеры и EditTerrainObject
    // -------------------------------------------------------------------------
    private static void ValidateModulesAndTriggers(SqmClass root, MissionInfo mission, List<ValidationIssue> issues)
    {
        const string cat = "7. Модули WMT и Ограничения";
        var wmt = mission.WmtSettings;

        bool hasWmtMain = wmt.RawModuleAttributes.Keys.Any(k => k.StartsWith("WMT_Main.", StringComparison.OrdinalIgnoreCase));
        bool hasWmtTime = wmt.RawModuleAttributes.Keys.Any(k => k.StartsWith("WMT_Time.", StringComparison.OrdinalIgnoreCase));

        // П. 6.3: Обязательно наличие модулей WMT_Main и WMT_Time
        var entitiesRoot = root.GetClass("Mission")?.GetClass("Entities");
        var logicTypes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        int triggerCount = 0;
        var cupEditTerrainErrors = new List<string>();

        if (entitiesRoot != null)
        {
            InspectLogicAndTriggersRecursive(entitiesRoot, logicTypes, ref triggerCount, cupEditTerrainErrors);
        }

        if (!hasWmtMain && !logicTypes.Contains("WMT_Main"))
        {
            issues.Add(new ValidationIssue
            {
                RuleNumber = "П. 6.3",
                Category = cat,
                Severity = "Error",
                Title = "Отсутствует обязательный модуль WMT_Main",
                Details = "На миссии обязательно должен стоять модуль WMT_Main."
            });
        }

        if (!hasWmtTime && !logicTypes.Contains("WMT_Time"))
        {
            issues.Add(new ValidationIssue
            {
                RuleNumber = "П. 6.3",
                Category = cat,
                Severity = "Error",
                Title = "Отсутствует обязательный модуль WMT_Time",
                Details = "На миссии обязательно должен стоять модуль WMT_Time."
            });
        }

        // П. 7 (WMT_Main): Дальность видимости по картам
        int maxAllowedViewDist = GetMaxAllowedViewDistance(mission.WorldName);
        if (wmt.ViewDistance > maxAllowedViewDist)
        {
            issues.Add(new ValidationIssue
            {
                RuleNumber = "П. 7 (WMT_Main)",
                Category = cat,
                Severity = "Error",
                Title = $"Превышена максимальная дальность видимости для карты {mission.WorldName} ({wmt.ViewDistance} м > {maxAllowedViewDist} м)",
                Details = $"Для острова '{mission.WorldName}' максимальная разрешенная прорисовка составляет {maxAllowedViewDist} м."
            });
        }
        else
        {
            issues.Add(new ValidationIssue
            {
                RuleNumber = "П. 7 (WMT_Main)",
                Category = cat,
                Severity = "Ok",
                Title = $"Дальность видимости ({wmt.ViewDistance} м) соответствует лимиту карты ({maxAllowedViewDist} м)",
                Details = $"Прорисовка земли: {wmt.TerrainViewDistance} м."
            });
        }

        // П. 7 (WMT_Main): Если присутствует авиация -> прорисовка земли обязательно 10000 м
        bool hasAircraft = mission.Vehicles.Any(v => IsAircraftClass(v.VehicleClass));
        if (hasAircraft && wmt.TerrainViewDistance != 10000)
        {
            issues.Add(new ValidationIssue
            {
                RuleNumber = "П. 7 (WMT_Main)",
                Category = cat,
                Severity = "Error",
                Title = $"Неверная прорисовка земли при наличии авиации ({wmt.TerrainViewDistance} м вместо 10000 м)",
                Details = "Если на миссии присутствует авиация, дальность прорисовки земли обязательно должна быть 10000 м."
            });
        }

        // П. 7 (WMT_Time): Время на миссию <= 120 минут (до 150 по согласованию), фризтайм = 3 мин, зона 20..100 м
        if (wmt.MissionTimeMinutes > 150)
        {
            issues.Add(new ValidationIssue
            {
                RuleNumber = "П. 7 (WMT_Time)",
                Category = cat,
                Severity = "Error",
                Title = $"Превышено время на миссию ({wmt.MissionTimeMinutes} мин > 120 мин)",
                Details = "Максимальное время на миссию — 120 минут (до 150 мин только по спец. согласованию с администрацией)."
            });
        }
        else if (wmt.MissionTimeMinutes > 120)
        {
            issues.Add(new ValidationIssue
            {
                RuleNumber = "П. 7 (WMT_Time)",
                Category = cat,
                Severity = "Warning",
                Title = $"Время на миссию ({wmt.MissionTimeMinutes} мин) превышает стандартные 120 минут",
                Details = "Продолжительность от 121 до 150 минут допускается только по согласованию с администрацией."
            });
        }

        if (wmt.FreezeTimeMinutes != 3)
        {
            issues.Add(new ValidationIssue
            {
                RuleNumber = "П. 7 (WMT_Time)",
                Category = cat,
                Severity = "Error",
                Title = $"Неверное время на подготовку / фризтайм ({wmt.FreezeTimeMinutes} мин вместо 3 мин)",
                Details = "По правилам WMT_Time время на подготовку должно составлять строго 3 минуты."
            });
        }

        if (wmt.StartZoneSize < 20 || wmt.StartZoneSize > 100)
        {
            issues.Add(new ValidationIssue
            {
                RuleNumber = "П. 7 (WMT_Time)",
                Category = cat,
                Severity = "Error",
                Title = $"Размер стартовой зоны ({wmt.StartZoneSize} м) вне диапазона 20–100 м",
                Details = "По правилам размер стартовой зоны в WMT_Time должен быть от 20 до 100 метров."
            });
        }

        // П. 7 (WMT_Point): Таймер >= 300 сек -> должно быть включено оповещение
        foreach (var pt in wmt.CapturePoints)
        {
            if (pt.CaptureTimeSeconds >= 300)
            {
                issues.Add(new ValidationIssue
                {
                    RuleNumber = "П. 7 (WMT_Point)",
                    Category = cat,
                    Severity = "Warning",
                    Title = $"Зона '{pt.Name}' имеет таймер захвата {pt.CaptureTimeSeconds} сек (>= 5 мин)",
                    Details = "Убедитесь, что в настройках модуля зоны включено оповещение о начале захвата зоны."
                });
            }
        }

        // П. 6.4: Не рекомендуется использовать связки из 4 и более триггеров
        if (triggerCount >= 4)
        {
            issues.Add(new ValidationIssue
            {
                RuleNumber = "П. 6.4",
                Category = cat,
                Severity = "Warning",
                Title = $"На миссии используется {triggerCount} триггеров",
                Details = "П. 6.4: Не рекомендуется использовать связки из 4 и более триггеров."
            });
        }

        // П. 7 (Модуль Редактировать объект ландшафта)
        if (cupEditTerrainErrors.Count > 0)
        {
            issues.Add(new ValidationIssue
            {
                RuleNumber = "П. 7 (Ландшафт)",
                Category = cat,
                Severity = "Warning",
                Title = $"Обнаружен модуль 'Редактировать объект ландшафта' с отключением разрушаемости ({cupEditTerrainErrors.Count} шт.)",
                Details = "Запрещено редактировать разрушаемость объекта на CUP объектах (разрешено только на ванильных объектах)."
            });
        }
    }

    // =========================================================================
    // Вспомогательные методы анализа SqmClass и SQF
    // =========================================================================

    private static void CheckVehicleAmmoBoxRecursive(SqmClass container, PboArchive? archive, List<string> uncleanedList)
    {
        foreach (var item in container.Children.OfType<SqmClass>())
        {
            var dataType = item.GetProperty("dataType")?.AsString();
            if (dataType == "Layer")
            {
                var sub = item.GetClass("Entities");
                if (sub != null) CheckVehicleAmmoBoxRecursive(sub, archive, uncleanedList);
                continue;
            }

            if (dataType != "Object") continue;
            var typeName = item.GetProperty("type")?.AsString() ?? "";
            if (string.IsNullOrEmpty(typeName)) continue;

            // Пропускаем статические заборы, окопы, камни и знаки
            if (IsStaticScenery(typeName)) continue;

            var attributes = item.GetClass("Attributes");
            var initScript = ReadStringField(item, attributes, "init");

            // Проверяем, очищается ли инвентарь скриптом (clearWeaponCargoGlobal и т.д.)
            bool clearedByScript = HasScriptCargoClear(initScript, archive);
            if (clearedByScript) continue;

            // Проверяем свойство ammoBox в CustomAttributes (3DEN редактор)
            var ammoBoxVal = FindCustomAttr(item, "ammoBox") ?? FindCustomAttr(attributes, "ammoBox");
            if (ammoBoxVal != null)
            {
                // Пустое хранилище в 3DEN имеет вид: [[[[],[]],[[],[]],[[],[]],[[],[]]],false]
                var innerArrays = Regex.Replace(ammoBoxVal, @"\s+", "");
                if (!innerArrays.Contains("[[[[],[]],[[],[]],[[],[]],[[],[]]]"))
                {
                    uncleanedList.Add(typeName);
                }
            }
        }
    }

    private static bool HasScriptCargoClear(string initScript, PboArchive? archive)
    {
        if (string.IsNullOrWhiteSpace(initScript)) return false;
        if (initScript.Contains("clearWeaponCargo", StringComparison.OrdinalIgnoreCase) ||
            initScript.Contains("clearMagazineCargo", StringComparison.OrdinalIgnoreCase) ||
            initScript.Contains("clearItemCargo", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        if (archive == null) return false;
        var match = Regex.Match(initScript, @"[""']([^""']+\.sqf)[""']", RegexOptions.IgnoreCase);
        if (!match.Success) return false;

        var scriptPath = NormalizePath(match.Groups[1].Value);
        var entry = archive.Entries.FirstOrDefault(e => NormalizePath(e.FileName).Equals(scriptPath, StringComparison.OrdinalIgnoreCase));
        if (entry == null) return false;

        try
        {
            var content = archive.GetFileContentAsString(entry.FileName);
            return content.Contains("clearWeaponCargo", StringComparison.OrdinalIgnoreCase) ||
                   content.Contains("clearMagazineCargo", StringComparison.OrdinalIgnoreCase) ||
                   content.Contains("clearItemCargo", StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return false;
        }
    }

    private static bool IsLocalSafeCall(string initScript, PboArchive? archive)
    {
        if (initScript.Contains("local", StringComparison.OrdinalIgnoreCase) ||
            initScript.Contains("isServer", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        if (archive == null) return true;
        var match = Regex.Match(initScript, @"[""']([^""']+\.sqf)[""']", RegexOptions.IgnoreCase);
        if (!match.Success) return true;

        var scriptPath = NormalizePath(match.Groups[1].Value);
        var entry = archive.Entries.FirstOrDefault(e => NormalizePath(e.FileName).Equals(scriptPath, StringComparison.OrdinalIgnoreCase));
        if (entry == null) return true;

        try
        {
            var content = archive.GetFileContentAsString(entry.FileName);
            return content.Contains("local", StringComparison.OrdinalIgnoreCase) ||
                   content.Contains("isServer", StringComparison.OrdinalIgnoreCase) ||
                   content.Contains("isDedicated", StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return true;
        }
    }

    private static void CollectAllStringsFromSqm(SqmClass node, string path, List<(string Context, string Text)> list)
    {
        foreach (var prop in node.Children.OfType<SqmProperty>())
        {
            if (prop.Value is string s && !string.IsNullOrWhiteSpace(s))
            {
                list.Add(($"{path}.{prop.Name}", s));
            }
        }
        foreach (var sub in node.Children.OfType<SqmClass>())
        {
            CollectAllStringsFromSqm(sub, $"{path}.{sub.Name}", list);
        }
    }

    private static void ExtractFileReferencesFromText(
        string text,
        string sourceContext,
        string currentDir,
        HashSet<string> allPboFiles,
        HashSet<string> referencedFiles,
        List<string> missingReferences)
    {
        // Ищем любые строки в кавычках с расширением файла (.sqf, .ext, .hpp, .jpg, .png, .paa, .ogg, .fsm)
        var fileRegex = new Regex(@"[""']([^""'<>|*?\r\n]+\.(?:sqf|ext|hpp|h|jpg|jpeg|png|paa|ogg|wss|fsm))[""']", RegexOptions.IgnoreCase);
        foreach (Match m in fileRegex.Matches(text))
        {
            var rawRef = m.Groups[1].Value.Trim();
            // Игнорируем системные пути Arma 3 (начинающиеся с \A3, \ca, \rhs, \cup и т.д., если их нет в PBO)
            if (rawRef.StartsWith("\\a3\\", StringComparison.OrdinalIgnoreCase) ||
                rawRef.StartsWith("a3\\", StringComparison.OrdinalIgnoreCase) ||
                rawRef.StartsWith("\\ca\\", StringComparison.OrdinalIgnoreCase) ||
                rawRef.StartsWith("\\rhs", StringComparison.OrdinalIgnoreCase) ||
                rawRef.StartsWith("\\cup\\", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            var norm = NormalizePath(rawRef);
            if (allPboFiles.Contains(norm))
            {
                referencedFiles.Add(norm);
                continue;
            }

            // Пробуем относительно папки текущего скрипта (например #include "macros.hpp")
            if (!string.IsNullOrEmpty(currentDir))
            {
                var relNorm = NormalizePath(Path.Combine(currentDir, norm));
                if (allPboFiles.Contains(relNorm))
                {
                    referencedFiles.Add(relNorm);
                    continue;
                }
            }

            // Если это ссылка на .sqf или локальную картинку, которой нет в PBO — фиксируем ошибку!
            if (norm.EndsWith(".sqf", StringComparison.OrdinalIgnoreCase) ||
                norm.EndsWith(".jpg", StringComparison.OrdinalIgnoreCase) ||
                norm.EndsWith(".png", StringComparison.OrdinalIgnoreCase) ||
                norm.EndsWith(".hpp", StringComparison.OrdinalIgnoreCase))
            {
                missingReferences.Add($"В '{sourceContext}' указан отсутствующий файл '{rawRef}'");
            }
        }
    }

    private static void InspectLogicAndTriggersRecursive(
        SqmClass container,
        HashSet<string> logicTypes,
        ref int triggerCount,
        List<string> cupEditTerrainErrors)
    {
        foreach (var item in container.Children.OfType<SqmClass>())
        {
            var dataType = item.GetProperty("dataType")?.AsString();
            if (dataType == "Layer")
            {
                var sub = item.GetClass("Entities");
                if (sub != null) InspectLogicAndTriggersRecursive(sub, logicTypes, ref triggerCount, cupEditTerrainErrors);
            }
            else if (dataType == "Trigger")
            {
                triggerCount++;
            }
            else if (dataType == "Logic")
            {
                var type = item.GetProperty("type")?.AsString() ?? "";
                if (!string.IsNullOrEmpty(type)) logicTypes.Add(type);

                if (type.Equals("ModuleEditTerrainObject_F", StringComparison.OrdinalIgnoreCase))
                {
                    var allowDamage = FindCustomAttr(item, "allowDamage");
                    if (allowDamage != null && (allowDamage.Equals("false", StringComparison.OrdinalIgnoreCase) || allowDamage == "0"))
                    {
                        cupEditTerrainErrors.Add(type);
                    }
                }
            }
        }
    }

    private static int GetMaxAllowedViewDistance(string worldName)
    {
        var w = (worldName ?? "").ToLowerInvariant();
        if (w.Contains("zargabad") || w.Contains("reshmaan")) return 5000;
        if (w.Contains("lythium") || w.Contains("lithium")) return 4000;
        if (w.Contains("ruha") || w.Contains("hellanmaa") || w.Contains("fallujah") || w.Contains("tanoa")) return 2000;
        if (w.Contains("chernarus_2020") || w.Contains("cup_chernarus_a3") || w.Contains("vt7")) return 2500;
        return 3000;
    }

    private static bool IsHqText(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return false;
        return s.Contains("1-1") ||
               s.Contains("Штаб", StringComparison.OrdinalIgnoreCase) ||
               s.Contains("HQ", StringComparison.OrdinalIgnoreCase) ||
               s.Contains("Управление", StringComparison.OrdinalIgnoreCase) ||
               s.Contains("Командир стороны", StringComparison.OrdinalIgnoreCase) ||
               s.Contains("КВ", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsUnitMedic(SquadUnit u)
    {
        var role = u.RoleDescription ?? "";
        var cls = u.VehicleClass ?? "";
        if (role.Contains("Медик", StringComparison.OrdinalIgnoreCase) ||
            role.Contains("Санитар", StringComparison.OrdinalIgnoreCase) ||
            role.Contains("Врач", StringComparison.OrdinalIgnoreCase) ||
            role.Contains("Medic", StringComparison.OrdinalIgnoreCase) ||
            cls.Contains("medic", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        // Или если у бойца в инвентаре лежит хирургический набор / сшиватель / >= 10 морфинов ACE
        return u.Loadout.ItemsAndMagazines.Keys.Any(k =>
            k.Contains("surgicalKit", StringComparison.OrdinalIgnoreCase) ||
            k.Contains("personalAidKit", StringComparison.OrdinalIgnoreCase) ||
            k.Equals("Medikit", StringComparison.OrdinalIgnoreCase));
    }

    private static bool IsTrackedCombatVehicle(string cls)
    {
        var lower = cls.ToLowerInvariant();
        if (lower.Contains("static") || lower.Contains("box") || lower.Contains("crate") || lower.Contains("ace_"))
            return false;
        return lower.Contains("bmp") || lower.Contains("bmd") || lower.Contains("mtlb") ||
               lower.Contains("t72") || lower.Contains("t80") || lower.Contains("t90") ||
               lower.Contains("t55") || lower.Contains("t62") || lower.Contains("t34") ||
               lower.Contains("m1a1") || lower.Contains("m1a2") || lower.Contains("m2a") ||
               lower.Contains("m60") || lower.Contains("m113") || lower.Contains("aav") ||
               lower.Contains("leopard") || lower.Contains("marder") || lower.Contains("puma") ||
               lower.Contains("warrior") || lower.Contains("challenger") || lower.Contains("zsu") ||
               lower.Contains("2s") || lower.Contains("shilka") || lower.Contains("tunguska") ||
               lower.Contains("tracked");
    }

    private static bool IsAircraftClass(string cls)
    {
        var lower = cls.ToLowerInvariant();
        return lower.Contains("heli") || lower.Contains("mi8") || lower.Contains("mi24") ||
               lower.Contains("ka52") || lower.Contains("uh60") || lower.Contains("uh1") ||
               lower.Contains("ah64") || lower.Contains("ah1") || lower.Contains("ch47") ||
               lower.Contains("plane") || lower.Contains("su25") || lower.Contains("a10") ||
               lower.Contains("l39") || lower.Contains("c130");
    }

    private static bool IsStaticScenery(string typeName)
    {
        string[] prefixes =
        {
            "Land_", "Misc_", "Fort_", "Wall_", "Sign_", "Fence", "BagFence",
            "CamoNet", "RoadCone", "RoadBarrier", "Hedgehog", "Trench", "Crater",
            "Helper", "Clutter", "Lamp", "PowerLines", "Tree", "Bush", "Rock", "ACE_ConcertinaWire"
        };
        return prefixes.Any(p => typeName.StartsWith(p, StringComparison.OrdinalIgnoreCase));
    }

    private static void CheckForbiddenClass(string? cls, string context, HashSet<string> target)
    {
        if (string.IsNullOrWhiteSpace(cls)) return;
        if (ForbiddenVanillaPrefixes.Any(p => cls.StartsWith(p, StringComparison.OrdinalIgnoreCase)))
        {
            target.Add($"{cls} ({context})");
        }
    }

    private static string NormalizePath(string path)
    {
        return path.Replace('/', '\\').TrimStart('\\').Trim();
    }

    private static string StripSqfComments(string sqf)
    {
        var noBlock = Regex.Replace(sqf, @"/\*[\s\S]*?\*/", string.Empty);
        return Regex.Replace(noBlock, @"//.*$", string.Empty, RegexOptions.Multiline);
    }

    private static float ReadFloat(SqmClass cls, string propName)
    {
        var prop = cls.GetProperty(propName);
        if (prop?.Value == null) return 0f;
        try { return Convert.ToSingle(prop.Value, CultureInfo.InvariantCulture); }
        catch { return 0f; }
    }

    private static string ReadStringField(SqmClass entity, SqmClass? attributes, string fieldName)
    {
        return attributes?.GetProperty(fieldName)?.AsString()
               ?? entity.GetProperty(fieldName)?.AsString()
               ?? string.Empty;
    }

    private static string? FindCustomAttr(SqmClass? container, string propertyKeyword)
    {
        var customAttrs = container?.GetClass("CustomAttributes");
        if (customAttrs == null) return null;

        foreach (var attr in customAttrs.Children.OfType<SqmClass>())
        {
            var propName = attr.GetProperty("property")?.AsString() ?? "";
            if (propName.Contains(propertyKeyword, StringComparison.OrdinalIgnoreCase))
            {
                var valClass = attr.GetClass("Value")?.GetClass("data");
                return valClass?.GetProperty("value")?.AsString();
            }
        }
        return null;
    }
}