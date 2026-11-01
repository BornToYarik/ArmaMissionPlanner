using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using ArmaMissionPlanner.Core.Models;
using ArmaMissionPlanner.Core.Pbo;
using ArmaMissionPlanner.Core.Sqm;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
        policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod());
});

builder.Services.AddSingleton<MissionStateService>();
builder.Services.AddSingleton<ArmaAssetsCatalogService>();

var app = builder.Build();

app.UseCors();
app.UseDefaultFiles();
app.UseStaticFiles();

// Инициализируем каталог иконок при старте
var assetsCatalog = app.Services.GetRequiredService<ArmaAssetsCatalogService>();
assetsCatalog.Initialize(builder.Environment.ContentRootPath);

string? ResolveMapDirectory(string worldName)
{
    var safeWorld = Path.GetFileName(worldName.ToLowerInvariant());
    var candidates = new[]
    {
        Path.GetFullPath(Path.Combine(builder.Environment.ContentRootPath, "..", "maps", safeWorld)),
        Path.Combine(builder.Environment.ContentRootPath, "maps", safeWorld),
        Path.Combine(builder.Environment.ContentRootPath, "wwwroot", "maps", safeWorld),
        Path.Combine(AppContext.BaseDirectory, "maps", safeWorld)
    };

    return candidates.FirstOrDefault(Directory.Exists);
}

// 1. Загрузка и разбор PBO файла
app.MapPost("/api/mission/upload", async (IFormFile file, MissionStateService state) =>
{
    if (file == null || file.Length == 0)
        return Results.BadRequest("Файл пустой.");

    var ms = new MemoryStream();
    await file.CopyToAsync(ms);
    ms.Position = 0;

    var mission = state.LoadMission(ms, file.FileName);
    return Results.Ok(mission);
}).DisableAntiforgery();

// 2. Получение текущей загруженной миссии
app.MapGet("/api/mission/current", (MissionStateService state) =>
{
    return state.CurrentMission != null
        ? Results.Ok(state.CurrentMission)
        : Results.NotFound();
});

// 3. Отдача картинок из PBO
app.MapGet("/api/mission/image", (string path, MissionStateService state) =>
{
    var bytes = state.GetFileBytes(path);
    if (bytes == null) return Results.NotFound();

    var ext = Path.GetExtension(path).ToLowerInvariant();
    var contentType = ext switch
    {
        ".jpg" or ".jpeg" => "image/jpeg",
        ".png" => "image/png",
        _ => "application/octet-stream"
    };

    return Results.File(bytes, contentType);
});

// 4. Словарь русских названий и доступных иконок из arma_assets_dump_fixed.json
app.MapGet("/api/assets/catalog", (ArmaAssetsCatalogService catalog) =>
{
    return Results.Ok(catalog.DisplayNames);
});

// 5. Универсальная отдача PNG-иконки по классу оружия/снаряжения/техники/маркера!
app.MapGet("/api/assets/icon/{className}", (string className, ArmaAssetsCatalogService catalog) =>
{
    var filePath = catalog.ResolveIconFilePath(className);
    if (filePath != null && File.Exists(filePath))
    {
        return Results.File(filePath, "image/png");
    }
    return Results.NotFound();
});

// 6. Отдача конфигурации карты map.json
app.MapGet("/api/maps/{worldName}/map.json", (string worldName) =>
{
    var mapDir = ResolveMapDirectory(worldName);
    if (mapDir != null)
    {
        var jsonPath = Path.Combine(mapDir, "map.json");
        if (File.Exists(jsonPath))
            return Results.File(jsonPath, "application/json");
    }

    return Results.NotFound(new { error = $"map.json для '{worldName}' не найден." });
});

// 7. Раздача тайлов топографической карты OCAP
app.MapGet("/api/maps/{worldName}/{z:int}/{x:int}/{y:int}.png", (string worldName, int z, int x, int y) =>
{
    if (x < 0 || y < 0 || z < 0) return Results.NotFound();

    var safeWorld = Path.GetFileName(worldName.ToLowerInvariant());
    var mapDir = ResolveMapDirectory(safeWorld)
                 ?? Path.Combine(builder.Environment.ContentRootPath, "maps", safeWorld);

    var localPathTopo = Path.Combine(mapDir, "topo", z.ToString(), x.ToString(), $"{y}.png");
    var localPathDirect = Path.Combine(mapDir, z.ToString(), x.ToString(), $"{y}.png");

    if (File.Exists(localPathTopo))
        return Results.File(localPathTopo, "image/png");
    if (File.Exists(localPathDirect))
        return Results.File(localPathDirect, "image/png");

    return Results.NotFound();
});

app.MapFallbackToFile("index.html");

app.Run("http://localhost:5123");

// Сервис каталога иконок и названий классов из arma_assets_dump_fixed.json
public class ArmaAssetsCatalogService
{
    private string? _iconsDir;
    // className -> pngFileName (например "rhs_weap_ak74m" -> "rhs_weap_ak74m_ca.png")
    private readonly Dictionary<string, string> _classToIconFile = new(StringComparer.OrdinalIgnoreCase);
    // className -> DisplayName (например "rhs_weap_ak74m" -> "АК-74М")
    public Dictionary<string, string> DisplayNames { get; } = new(StringComparer.OrdinalIgnoreCase);

    public void Initialize(string contentRoot)
    {
        // Ищем папку с PNG иконками
        var iconDirCandidates = new[]
        {
            Path.GetFullPath(Path.Combine(contentRoot, "..", "arma-icons")),
            Path.GetFullPath(Path.Combine(contentRoot, "..", "arma-planner-ui", "public", "arma-icons")),
            Path.Combine(contentRoot, "arma-icons"),
            Path.Combine(contentRoot, "wwwroot", "arma-icons")
        };
        _iconsDir = iconDirCandidates.FirstOrDefault(Directory.Exists);

        // Ищем arma_assets_dump_fixed.json
        var jsonCandidates = new[]
        {
            Path.GetFullPath(Path.Combine(contentRoot, "..", "arma_assets_dump_fixed.json")),
            Path.GetFullPath(Path.Combine(contentRoot, "..", "arma-icons", "arma_assets_dump_fixed.json")),
            Path.GetFullPath(Path.Combine(contentRoot, "..", "arma-planner-ui", "public", "arma_assets_dump_fixed.json")),
            Path.GetFullPath(Path.Combine(contentRoot, "..", "arma-planner-ui", "src", "arma_assets_dump_fixed.json")),
            Path.Combine(contentRoot, "arma_assets_dump_fixed.json")
        };

        var jsonPath = jsonCandidates.FirstOrDefault(File.Exists);
        if (jsonPath == null && _iconsDir != null)
        {
            var inIcons = Path.Combine(_iconsDir, "arma_assets_dump_fixed.json");
            if (File.Exists(inIcons)) jsonPath = inIcons;
        }

        if (jsonPath != null)
        {
            try
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(jsonPath));
                var root = doc.RootElement;
                if (root.ValueKind == JsonValueKind.Array)
                {
                    // [0] = Markers ([cls, name, iconPath, color])
                    if (root.GetArrayLength() > 0 && root[0].ValueKind == JsonValueKind.Array)
                    {
                        foreach (var el in root[0].EnumerateArray())
                        {
                            if (el.ValueKind == JsonValueKind.Array && el.GetArrayLength() >= 3)
                            {
                                var cls = el[0].GetString() ?? "";
                                var disp = el[1].GetString() ?? "";
                                var paaPath = el[2].GetString() ?? "";
                                RegisterAsset(cls, disp, paaPath);
                            }
                        }
                    }

                    // [2] = Weapons / Magazines / Vehicles ([cls, displayName, picturePath])
                    if (root.GetArrayLength() > 2 && root[2].ValueKind == JsonValueKind.Array)
                    {
                        foreach (var el in root[2].EnumerateArray())
                        {
                            if (el.ValueKind == JsonValueKind.Array && el.GetArrayLength() >= 3)
                            {
                                var cls = el[0].GetString() ?? "";
                                var disp = el[1].GetString() ?? "";
                                var paaPath = el[2].GetString() ?? "";
                                RegisterAsset(cls, disp, paaPath);
                            }
                        }
                    }
                }
                Console.WriteLine($"[ArmaAssets] Загружено классов: {_classToIconFile.Count}, папка иконок: {_iconsDir ?? "не найдена"}");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[ArmaAssets] Ошибка чтения JSON: {ex.Message}");
            }
        }
    }

    private void RegisterAsset(string className, string displayName, string paaPath)
    {
        if (string.IsNullOrWhiteSpace(className)) return;
        if (!string.IsNullOrWhiteSpace(displayName) && !DisplayNames.ContainsKey(className))
        {
            DisplayNames[className] = displayName;
        }

        if (string.IsNullOrWhiteSpace(paaPath) || paaPath.StartsWith("#(")) return;

        var normalized = paaPath.Replace('/', '\\');
        var fileNameNoExt = Path.GetFileNameWithoutExtension(normalized);
        if (string.IsNullOrWhiteSpace(fileNameNoExt) || fileNameNoExt.Equals("clear_empty", StringComparison.OrdinalIgnoreCase))
            return;

        _classToIconFile[className] = fileNameNoExt.ToLowerInvariant() + ".png";
    }

    public string? ResolveIconFilePath(string className)
    {
        if (_iconsDir == null || string.IsNullOrWhiteSpace(className)) return null;

        // 1. Точное совпадение по словарю из дампа
        if (_classToIconFile.TryGetValue(className, out var pngName))
        {
            var full = Path.Combine(_iconsDir, pngName);
            if (File.Exists(full)) return full;
        }

        // 2. Фоллбэк: пробуем имя самого класса (напр. b_inf.png или ak74m_ca.png)
        var direct = Path.Combine(_iconsDir, className.ToLowerInvariant() + ".png");
        if (File.Exists(direct)) return direct;

        var directCa = Path.Combine(_iconsDir, className.ToLowerInvariant() + "_ca.png");
        if (File.Exists(directCa)) return directCa;

        return null;
    }
}

public class MissionStateService
{
    private readonly object _lock = new();
    private PboArchive? _currentArchive;
    private MemoryStream? _currentStream;

    public MissionInfo? CurrentMission { get; private set; }

    public MissionInfo LoadMission(MemoryStream pboStream, string fileName)
    {
        lock (_lock)
        {
            _currentArchive?.Dispose();
            _currentStream?.Dispose();

            _currentStream = pboStream;
            _currentArchive = PboArchive.Open(_currentStream, leaveOpen: true);

            var sqmEntry = _currentArchive.Entries.FirstOrDefault(e =>
                e.FileName.Equals("mission.sqm", StringComparison.OrdinalIgnoreCase))
                ?? throw new InvalidOperationException("В PBO нет файла mission.sqm");

            var root = RapReader.ReadFromBytes(_currentArchive.GetFileData(sqmEntry));
            CurrentMission = MissionExtractor.Extract(root, _currentArchive, fileName);
            return CurrentMission;
        }
    }

    public byte[]? GetFileBytes(string relativePath)
    {
        lock (_lock)
        {
            if (_currentArchive == null) return null;
            var normalized = relativePath.Replace("/", "\\").TrimStart('\\');
            var entry = _currentArchive.Entries.FirstOrDefault(e =>
                e.FileName.Equals(normalized, StringComparison.OrdinalIgnoreCase));

            return entry != null ? _currentArchive.GetFileData(entry) : null;
        }
    }
}