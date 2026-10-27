using System.Diagnostics;
using ArmaMissionPlanner.Core.Models;
using ArmaMissionPlanner.Core.Pbo;
using ArmaMissionPlanner.Core.Sqm;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
        policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod());
});

builder.Services.AddSingleton<MissionStateService>();

var app = builder.Build();

app.UseCors();
app.UseDefaultFiles();
app.UseStaticFiles();

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

// 2. Получение текущей загруженной миссии (если обновили страницу F5)
app.MapGet("/api/mission/current", (MissionStateService state) =>
{
    return state.CurrentMission != null
        ? Results.Ok(state.CurrentMission)
        : Results.NotFound();
});

// 3. Отдача картинок (форм сторон / превью) напрямую из открытого PBO
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
// 4. Раздача (и опциональная докачка) тайлов топографической карты OCAP
var httpClient = new HttpClient();
app.MapGet("/api/maps/{worldName}/{z:int}/{x:int}/{y:int}.png", async (string worldName, int z, int x, int y) =>
{
    var safeWorld = worldName.ToLowerInvariant();
    var mapsRoot = Path.Combine(AppContext.BaseDirectory, "maps", safeWorld);

    // Проверяем оба стандарта папок OCAP: maps/world/topo/z/x/y.png и maps/world/z/x/y.png
    var localPathTopo = Path.Combine(mapsRoot, "topo", z.ToString(), x.ToString(), $"{y}.png");
    var localPathDirect = Path.Combine(mapsRoot, z.ToString(), x.ToString(), $"{y}.png");

    if (File.Exists(localPathTopo))
        return Results.File(localPathTopo, "image/png");
    if (File.Exists(localPathDirect))
        return Results.File(localPathDirect, "image/png");

    // Опционально: если указать базовый URL зеркала карт OCAP, бэкенд сам скачает и закэширует тайл на диск
    const string? remoteOcapMirrorBaseUrl = null; // например: "https://example-ocap-server.com/images/maps"
    if (!string.IsNullOrEmpty(remoteOcapMirrorBaseUrl))
    {
        try
        {
            var url = $"{remoteOcapMirrorBaseUrl}/{safeWorld}/{z}/{x}/{y}.png";
            var bytes = await httpClient.GetByteArrayAsync(url);
            Directory.CreateDirectory(Path.GetDirectoryName(localPathDirect)!);
            await File.WriteAllBytesAsync(localPathDirect, bytes);
            return Results.File(bytes, "image/png");
        }
        catch
        {
            // Если тайла нет на сервере — отдаем 404, Leaflet оставит сетку
        }
    }

    return Results.NotFound();
});
app.MapFallbackToFile("index.html");

// Если запустили как готовый .exe — автоматически открываем браузер
if (!app.Environment.IsDevelopment())
{
    var url = "http://localhost:5123";
    app.Lifetime.ApplicationStarted.Register(() =>
    {
        Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
    });
    app.Run(url);
}
else
{
    app.Run("http://localhost:5123");
}

// Сервис для хранения текущего открытого PBO в памяти
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