using System;
using System.IO;
using System.Linq;
using ArmaMissionPlanner.Core.Pbo;
using ArmaMissionPlanner.Core.Sqm;
using NUnit.Framework;

namespace ArmaMissionPlanner.Core.Tests;

public class Tests
{
    [Test]
    public void Extract_RealMissionPbo_ParsesRandomizedUniformsAndNestedSquadDescriptions()
    {
        const string pboPath = @"F:\projects\wog_160_balkan_gambit_11.cup_chernarus_A3.pbo";
        if (!File.Exists(pboPath))
        {
            Assert.Ignore("Sample PBO not present on disk.");
            return;
        }

        using var archive = PboArchive.Open(pboPath);
        var sqmEntry = archive.Entries.First(e => e.FileName.Equals("mission.sqm", StringComparison.OrdinalIgnoreCase));
        var root = RapReader.ReadFromBytes(archive.GetFileData(sqmEntry));

        var mission = MissionExtractor.Extract(root, archive, pboPath);

        // 1. Проверяем, что у стороны East (SDKZ), где форма и шлемы выдаются через BIS_fnc_selectRandom,
        // парсер достал и основную форму, и все 9 вариантов из массива рандома:
        var eastUnitsWithRandomUniform = mission.Groups
            .Where(g => g.Side.Equals("East", StringComparison.OrdinalIgnoreCase))
            .SelectMany(g => g.Units)
            .Where(u => u.Loadout.UniformVariants.Count > 1)
            .ToList();

        Assert.That(eastUnitsWithRandomUniform.Count, Is.GreaterThan(0), "Должны быть найдены юниты с рандомизированной формой");
        var sampleEastUnit = eastUnitsWithRandomUniform[0];
        Assert.That(sampleEastUnit.Loadout.Uniform, Is.EqualTo("LOP_U_US_Fatigue_10"));
        Assert.That(sampleEastUnit.Loadout.UniformVariants.Count, Is.EqualTo(9));
        Assert.That(sampleEastUnit.Loadout.HeadgearVariants.Count, Is.GreaterThanOrEqualTo(1));

        // 2. Проверяем, что нет ложной ошибки П. 5.5 "кладутся вещи в форму, но форма не выдана"
        var falseNoUniformErrors = mission.ValidationReport
            .Where(v => v.RuleNumber == "П. 5.5" && v.Details.Contains("форма не выдана"))
            .ToList();
        Assert.That(falseNoUniformErrors, Is.Empty, "Не должно быть ложных ошибок о невыданной рандомной форме");

        // 3. Проверяем корректный разбор вложенных скобок в описании отделения: "Отделение поддержки, M1151A1, M1151A1(Mk19)"
        var supportGroup = mission.Groups.FirstOrDefault(g => g.SquadDescription.Contains("M1151A1(Mk19)"));
        Assert.That(supportGroup, Is.Not.Null, "Вложенные скобки M1151A1(Mk19) не должны обрезаться на первой закрывающей скобке");

        // 4. Проверяем, что сербский бинокль rhssaf_zrak_rd7j попал в LinkedItems, а не в SecondaryWeapon (Труба/ПТ)
        var safKo = mission.Groups
            .Where(g => g.Side.Equals("Independent", StringComparison.OrdinalIgnoreCase))
            .SelectMany(g => g.Units)
            .First(u => u.InitScript.Contains("ko.sqf", StringComparison.OrdinalIgnoreCase));
        Assert.That(safKo.SecondaryWeapon, Is.Empty, "Бинокль rhssaf_zrak_rd7j не должен попадать в слот ПТ-трубы");
        Assert.That(safKo.Loadout.LinkedItems, Contains.Item("rhssaf_zrak_rd7j"));

        // 5. Проверяем привязку вкладок брифинга к сторонам (case RESISTANCE / case EAST)
        Assert.That(mission.Briefing.Any(b => b.Side == "Independent"), Is.True);
        Assert.That(mission.Briefing.Any(b => b.Side == "East"), Is.True);
    }

    [Test]
    public void Extract_AtSignSquadSuffixInLeaderRole_SplitsRoleAndSquadDescription()
    {
        var root = new SqmClass { Name = "Root" };
        var missionNode = new SqmClass { Name = "Mission" };
        var entitiesNode = new SqmClass { Name = "Entities" };

        var groupNode = new SqmClass { Name = "Item0" };
        groupNode.Children.Add(new SqmProperty { Name = "dataType", Value = "Group" });
        groupNode.Children.Add(new SqmProperty { Name = "side", Value = "West" });
        groupNode.Children.Add(new SqmProperty { Name = "id", Value = 1 });

        var groupEntities = new SqmClass { Name = "Entities" };
        var leaderUnit = new SqmClass { Name = "Item0" };
        leaderUnit.Children.Add(new SqmProperty { Name = "dataType", Value = "Object" });
        leaderUnit.Children.Add(new SqmProperty { Name = "type", Value = "B_Soldier_SL_F" });
        leaderUnit.Children.Add(new SqmProperty { Name = "id", Value = 10 });

        var attrs = new SqmClass { Name = "Attributes" };
        attrs.Children.Add(new SqmProperty { Name = "isPlayable", Value = 1 });
        attrs.Children.Add(new SqmProperty { Name = "description", Value = "Командир отделения@Альфа 1-1 (Мотопехота, БМП-2)" });
        leaderUnit.Children.Add(attrs);

        groupEntities.Children.Add(leaderUnit);
        groupNode.Children.Add(groupEntities);
        entitiesNode.Children.Add(groupNode);
        missionNode.Children.Add(entitiesNode);
        root.Children.Add(missionNode);

        var extracted = MissionExtractor.Extract(root);
        Assert.That(extracted.Groups.Count, Is.EqualTo(1));
        var grp = extracted.Groups[0];
        Assert.That(grp.CallSign, Is.EqualTo("Альфа 1-1"));
        Assert.That(grp.SquadDescription, Is.EqualTo("Мотопехота, БМП-2"));
        Assert.That(grp.Units[0].RoleDescription, Is.EqualTo("Командир отделения"));
    }

    [Test]
    public void Extract_AllLocalWogPbos_NeverAssignsNvgOrGogglesOrMasksAsPrimaryWeapon()
    {
        var candidatePaths = new System.Collections.Generic.List<string>();
        if (Directory.Exists(@"C:\Users\advad\Downloads"))
            candidatePaths.AddRange(Directory.GetFiles(@"C:\Users\advad\Downloads", "wog_*.pbo"));
        if (File.Exists(@"F:\miski_arma3\miski_pbo\wog_184_night_shift_11.Altis.pbo"))
            candidatePaths.Add(@"F:\miski_arma3\miski_pbo\wog_184_night_shift_11.Altis.pbo");
        if (File.Exists(@"F:\projects\wog_160_balkan_gambit_11.cup_chernarus_A3.pbo"))
            candidatePaths.Add(@"F:\projects\wog_160_balkan_gambit_11.cup_chernarus_A3.pbo");

        if (candidatePaths.Count == 0)
        {
            Assert.Ignore("No local WOG PBOs found to scan.");
            return;
        }

        var distinctPrimaryWeapons = new System.Collections.Generic.HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var path in candidatePaths)
        {
            using var archive = PboArchive.Open(path);
            var sqmEntry = archive.Entries.FirstOrDefault(e => e.FileName.Equals("mission.sqm", StringComparison.OrdinalIgnoreCase));
            if (sqmEntry == null) continue;

            byte[] sqmBytes = archive.GetFileData(sqmEntry);
            SqmClass root;
            try
            {
                root = RapReader.ReadFromBytes(sqmBytes);
            }
            catch
            {
                continue;
            }

            var mission = MissionExtractor.Extract(root, archive, path);
            foreach (var u in mission.Groups.SelectMany(g => g.Units))
            {
                if (string.IsNullOrEmpty(u.PrimaryWeapon)) continue;
                distinctPrimaryWeapons.Add(u.PrimaryWeapon);

                var lower = u.PrimaryWeapon.ToLowerInvariant();
                Assert.That(
                    lower.Contains("nvg") || lower.EndsWith("_nv") || lower.Contains("1pn138") ||
                    lower.Contains("anpvs") || lower.Contains("balaclava") || lower.Contains("balaklava") ||
                    lower.Contains("goggles") || lower.Contains("shemag") || lower.Contains("scarf") ||
                    lower.Contains("kneepad") || lower.Contains("beard") || lower.Contains("6m2"),
                    Is.False,
                    $"Миссия {Path.GetFileName(path)}, юнит '{u.RoleDescription}': в PrimaryWeapon попал ПНВ/маска/аксессуар '{u.PrimaryWeapon}'");
            }
        }

        TestContext.Out.WriteLine($"Проверено PBO: {candidatePaths.Count}, уникальных классов основного оружия: {distinctPrimaryWeapons.Count}");
        foreach (var w in distinctPrimaryWeapons.OrderBy(x => x))
        {
            TestContext.Out.WriteLine($"  PrimaryWeapon: {w}");
        }
    }
}