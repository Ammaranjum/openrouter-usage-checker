using System.Globalization;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace OpenRouterUsage;

public sealed record UsageData(
    string? Label, decimal? Limit, decimal? LimitRemaining, string? LimitReset,
    decimal? Usage, decimal? UsageDaily, decimal? UsageWeekly, decimal? UsageMonthly);

public sealed record UsageResponse(UsageData Data);
public sealed record Observation(UsageData Data, DateTimeOffset ObservedAt);
public sealed record DailyUsage(decimal UsageUsd, decimal? TotalUsageUsd,
    string FirstObservedAt, string LastObservedAt);
public sealed class KeyHistory { public Dictionary<string, DailyUsage> Days { get; set; } = new(); }
public sealed class UsageHistory
{
    public int Version { get; set; } = 1;
    public string Timezone { get; set; } = "UTC";
    public Dictionary<string, KeyHistory> Keys { get; set; } = new();
}

public static class UsageFiles
{
    public static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower, WriteIndented = true
    };

    public static string KeyId(string key) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(key)));
    public static string Money(decimal? amount) => amount is decimal value
        ? "$" + value.ToString("0.00", CultureInfo.InvariantCulture) : "not reported";

    public static string UpdatedText(DateTimeOffset? updated, DateTimeOffset now)
    {
        if (updated is null) return "Not updated yet";
        double seconds = Math.Max(0, (now - updated.Value).TotalSeconds);
        if (seconds < 60) return "Updated just now";
        if (seconds < 3600) return $"Updated {(int)(seconds / 60)} min ago";
        if (seconds < 86400) return $"Updated {(int)(seconds / 3600)} hr ago";
        return "Updated " + updated.Value.ToLocalTime().ToString("g", CultureInfo.CurrentCulture);
    }

    public static void Write(string path, string content)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        string temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            File.WriteAllText(temporary, content, new UTF8Encoding(false));
            File.Move(temporary, path, true);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }

    public static UsageHistory ReadHistory(string path)
    {
        if (!File.Exists(path)) return new();
        string text = File.ReadAllText(path);
        using var document = JsonDocument.Parse(text);
        var root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object ||
            !root.TryGetProperty("version", out var version) || version.GetInt32() != 1 ||
            !root.TryGetProperty("timezone", out var timezone) || timezone.GetString() != "UTC" ||
            !root.TryGetProperty("keys", out var keys) || keys.ValueKind != JsonValueKind.Object)
            throw new InvalidDataException("Unrecognized usage history format; the existing file was preserved.");
        var history = JsonSerializer.Deserialize<UsageHistory>(text, Json)!;
        if (history.Keys.Values.Any(entry => entry?.Days is null))
            throw new InvalidDataException("Invalid key history; the existing file was preserved.");
        return history;
    }

    public static void Record(string path, string key, Observation observation)
    {
        var data = observation.Data;
        if (data.UsageDaily is not decimal daily || daily < 0) return;
        var history = ReadHistory(path);
        string id = KeyId(key);
        if (!history.Keys.TryGetValue(id, out var entry)) history.Keys[id] = entry = new();
        string date = observation.ObservedAt.UtcDateTime.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        string timestamp = observation.ObservedAt.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
        entry.Days.TryGetValue(date, out var previous);
        if (previous is not null && DateTimeOffset.Parse(previous.LastObservedAt, CultureInfo.InvariantCulture) > observation.ObservedAt)
            return;
        entry.Days[date] = new(daily, data.Usage, previous?.FirstObservedAt ?? timestamp, timestamp);
        Write(path, JsonSerializer.Serialize(history, Json));
    }

    public static string PanelText(UsageData data) => data.LimitRemaining.HasValue
        ? Money(data.LimitRemaining) + " left" : "Remaining unavailable";

    public static IEnumerable<KeyValuePair<string, DailyUsage>> RecentDays(UsageHistory history, string key) =>
        (history.Keys.GetValueOrDefault(KeyId(key))?.Days ?? new())
        .OrderByDescending(pair => pair.Key).Take(7);
}

public sealed class OpenRouterClient(HttpClient http)
{
    public async Task<Observation> FetchAsync(string key, CancellationToken cancellation)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "https://openrouter.ai/api/v1/key");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        using var response = await http.SendAsync(request, cancellation);
        if (!response.IsSuccessStatusCode)
            throw new HttpRequestException(response.StatusCode == System.Net.HttpStatusCode.Unauthorized
                ? "API key rejected (401). Check Settings."
                : $"OpenRouter request failed ({(int)response.StatusCode}).");
        var payload = JsonSerializer.Deserialize<UsageResponse>(await response.Content.ReadAsStringAsync(cancellation), UsageFiles.Json);
        if (payload?.Data is null) throw new InvalidDataException("OpenRouter returned no usage data.");
        if (payload.Data.UsageDaily is < 0) throw new InvalidDataException("OpenRouter returned invalid daily usage.");
        return new(payload.Data, response.Headers.Date ?? DateTimeOffset.UtcNow);
    }
}
