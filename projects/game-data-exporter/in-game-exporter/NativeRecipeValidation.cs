using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using UnityEngine;
using EffectList = Il2CppSystem.Collections.Generic.List<Il2CppScheduleOne.Effects.Effect>;
using NativeGameManager = Il2CppScheduleOne.DevUtilities.GameManager;
using NativeProductManager = Il2CppScheduleOne.Product.ProductManager;

namespace NeonSchedule1.GameDataExporter;

internal static partial class GameDataCollector
{
    internal const string NativeValidationRequestFileName =
        "native-recipe-validation-request.json";
    internal const string NativeValidationResponseFileName =
        "native-recipe-validation-response.json";

    private const string NativeValidationRequestSchema =
        "neonschedule1-native-recipe-validation-request-2";
    private const string NativeValidationResponseSchema =
        "neonschedule1-native-recipe-validation-response-2";
    private const int MaximumRequestBytes = 1_048_576;
    private const int MaximumCases = 64;
    private const int MaximumIngredientsPerCase = 8;

    internal static bool TryRunNativeRecipeValidation(
        string outputDirectory,
        string exporterVersion,
        Action<string> progress)
    {
        var requestPath = Path.Combine(outputDirectory, NativeValidationRequestFileName);
        if (!File.Exists(requestPath))
        {
            return false;
        }

        var fileLength = new FileInfo(requestPath).Length;
        if (fileLength <= 0 || fileLength > MaximumRequestBytes)
        {
            throw new InvalidOperationException(
                $"Native validation request must contain 1 to {MaximumRequestBytes} bytes.");
        }

        progress($"Native recipe validation request found at {requestPath}");
        var requestBytes = File.ReadAllBytes(requestPath);
        var request = JsonSerializer.Deserialize<NativeRecipeValidationRequest>(
            requestBytes,
            ExportJson.Options)
            ?? throw new InvalidOperationException("Native validation request is empty.");
        ValidateRequest(request);

        if (!string.Equals(request.Dataset.GameVersion, Application.version, StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                $"Native validation request targets game {request.Dataset.GameVersion}, " +
                $"but the running game is {Application.version}.");
        }

        var activeRuleProfile = ActiveRuleProfile();
        ValidateRuleProfile(request.RuleProfile, activeRuleProfile);

        var manager = NativeProductManager.Instance
            ?? throw new InvalidOperationException("ProductManager.Instance is unavailable after load.");
        var products = CollectStaticProducts(manager).ToDictionary(
            product => product.ID,
            StringComparer.Ordinal);
        var ingredients = CollectValidationIngredients(manager);
        var results = request.Cases.Select(testCase =>
            EvaluateNativeRecipe(testCase, products, ingredients)).ToList();
        var requestHash = Convert.ToHexString(SHA256.HashData(requestBytes)).ToLowerInvariant();
        var response = new NativeRecipeValidationResponse
        {
            Schema = NativeValidationResponseSchema,
            ExporterVersion = exporterVersion,
            EvaluatedAtUtc = DateTimeOffset.UtcNow,
            GameVersion = Application.version,
            RequestSha256 = requestHash,
            RuleProfile = activeRuleProfile,
            Cases = results,
        };
        var json = JsonSerializer.Serialize(response, ExportJson.Options);
        var responsePath = Path.Combine(outputDirectory, NativeValidationResponseFileName);
        WriteAtomic(responsePath, json, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
        var responseHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(json)))
            .ToLowerInvariant();
        WriteAtomic(responsePath + ".sha256", responseHash + Environment.NewLine, Encoding.ASCII);
        progress(
            $"Native recipe validation complete: {results.Count} cases. " +
            $"Response {responsePath}. SHA-256 {responseHash}");
        return true;
    }

    private static Dictionary<string, Il2CppScheduleOne.Product.PropertyItemDefinition>
        CollectValidationIngredients(NativeProductManager manager)
    {
        var source = manager.ValidMixIngredients
            ?? throw new InvalidOperationException("ProductManager.ValidMixIngredients is unavailable.");
        var result = new Dictionary<string, Il2CppScheduleOne.Product.PropertyItemDefinition>(
            StringComparer.Ordinal);
        for (var index = 0; index < source.Count; index++)
        {
            var ingredient = source[index];
            if (ingredient is null || string.IsNullOrWhiteSpace(ingredient.ID))
            {
                continue;
            }
            if (!result.TryAdd(ingredient.ID, ingredient))
            {
                throw new InvalidOperationException(
                    $"Duplicate native mixing ingredient ID '{ingredient.ID}'.");
            }
        }
        return result;
    }

    private static NativeRecipeValidationResult EvaluateNativeRecipe(
        NativeRecipeValidationCase testCase,
        IReadOnlyDictionary<string, Il2CppScheduleOne.Product.ProductDefinition> products,
        IReadOnlyDictionary<string, Il2CppScheduleOne.Product.PropertyItemDefinition> ingredients)
    {
        if (!products.TryGetValue(testCase.ProductId, out var product))
        {
            throw new InvalidOperationException(
                $"Native validation case '{testCase.Id}' has unknown product '{testCase.ProductId}'.");
        }

        var effects = product.Properties;
        foreach (var ingredientId in testCase.IngredientIds)
        {
            if (!ingredients.TryGetValue(ingredientId, out var ingredient))
            {
                throw new InvalidOperationException(
                    $"Native validation case '{testCase.Id}' has unknown ingredient '{ingredientId}'.");
            }
            if (ingredient.Properties is null || ingredient.Properties.Count != 1 ||
                ingredient.Properties[0] is null)
            {
                throw new InvalidOperationException(
                    $"Native mixing ingredient '{ingredientId}' does not have exactly one effect.");
            }
            effects = MixEffects(effects, ingredient.Properties[0], product.DrugType);
        }

        return new NativeRecipeValidationResult
        {
            Id = testCase.Id,
            ProductId = testCase.ProductId,
            IngredientIds = new List<string>(testCase.IngredientIds),
            EffectIds = CopyMixEffectIds(effects),
            CalculatedValue = NativeProductManager.CalculateProductValue(product.BasePrice, effects),
        };
    }

    private static void ValidateRequest(NativeRecipeValidationRequest request)
    {
        if (!string.Equals(request.Schema, NativeValidationRequestSchema, StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                $"Unsupported native validation request schema '{request.Schema}'.");
        }
        if (request.Dataset is null || string.IsNullOrWhiteSpace(request.Dataset.GameVersion) ||
            string.IsNullOrWhiteSpace(request.Dataset.DatasetSha256) ||
            request.Dataset.DatasetSha256.Length != 64 ||
            request.Dataset.DatasetSha256.Any(character =>
                !Uri.IsHexDigit(character) || char.IsUpper(character)) ||
            string.IsNullOrWhiteSpace(request.Dataset.NormalizerVersion))
        {
            throw new InvalidOperationException("Native validation request dataset identity is invalid.");
        }
        if (request.Cases is null || request.Cases.Count == 0 || request.Cases.Count > MaximumCases)
        {
            throw new InvalidOperationException(
                $"Native validation request must contain 1 to {MaximumCases} cases.");
        }
        ValidateRuleProfileShape(request.RuleProfile);

        var caseIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (var testCase in request.Cases)
        {
            if (testCase is null || string.IsNullOrWhiteSpace(testCase.Id) ||
                !caseIds.Add(testCase.Id) ||
                string.IsNullOrWhiteSpace(testCase.ProductId) ||
                testCase.IngredientIds is null ||
                testCase.IngredientIds.Count > MaximumIngredientsPerCase ||
                testCase.IngredientIds.Any(string.IsNullOrWhiteSpace))
            {
                throw new InvalidOperationException("Native validation request contains an invalid case.");
            }
        }
    }

    private static NativeMixingRuleProfile ActiveRuleProfile()
    {
        var settings = NativeGameManager.Instance?.Settings
            ?? throw new InvalidOperationException("GameManager settings are unavailable after load.");
        if (!settings.UseRandomizedMixMaps)
        {
            return new NativeMixingRuleProfile { Kind = "standard" };
        }
        var remainder = NativeGameManager.Seed % 360;
        return new NativeMixingRuleProfile
        {
            Kind = "seeded-rotation",
            AngleDegrees = (remainder + 360) % 360,
        };
    }

    private static void ValidateRuleProfile(
        NativeMixingRuleProfile requested,
        NativeMixingRuleProfile active)
    {
        ValidateRuleProfileShape(requested);
        if (!string.Equals(requested.Kind, active.Kind, StringComparison.Ordinal) ||
            requested.AngleDegrees != active.AngleDegrees)
        {
            throw new InvalidOperationException(
                $"Native validation request uses mixing profile '{requested.Kind}' " +
                $"angle {requested.AngleDegrees?.ToString() ?? "none"}, but the loaded save uses " +
                $"'{active.Kind}' angle {active.AngleDegrees?.ToString() ?? "none"}.");
        }
    }

    private static void ValidateRuleProfileShape(NativeMixingRuleProfile profile)
    {
        if (profile is null ||
            (string.Equals(profile.Kind, "standard", StringComparison.Ordinal)
                ? profile.AngleDegrees is not null
                : !string.Equals(profile.Kind, "seeded-rotation", StringComparison.Ordinal) ||
                    profile.AngleDegrees is null or < 0 or >= 360))
        {
            throw new InvalidOperationException("Native validation mixing rule profile is invalid.");
        }
    }

    private static void WriteAtomic(string path, string content, Encoding encoding)
    {
        var temporaryPath = path + ".tmp";
        File.WriteAllText(temporaryPath, content, encoding);
        File.Move(temporaryPath, path, overwrite: true);
    }
}

internal sealed class NativeRecipeValidationRequest
{
    public string Schema { get; init; } = string.Empty;
    public NativeRecipeValidationDataset Dataset { get; init; } = new();
    public NativeMixingRuleProfile RuleProfile { get; init; } = new();
    public List<NativeRecipeValidationCase> Cases { get; init; } = new();
}

internal sealed class NativeRecipeValidationDataset
{
    public string GameVersion { get; init; } = string.Empty;
    public string DatasetSha256 { get; init; } = string.Empty;
    public string NormalizerVersion { get; init; } = string.Empty;
}

internal sealed class NativeRecipeValidationCase
{
    public string Id { get; init; } = string.Empty;
    public string ProductId { get; init; } = string.Empty;
    public List<string> IngredientIds { get; init; } = new();
}

internal sealed class NativeRecipeValidationResponse
{
    public string Schema { get; init; } = string.Empty;
    public string ExporterVersion { get; init; } = string.Empty;
    public DateTimeOffset EvaluatedAtUtc { get; init; }
    public string GameVersion { get; init; } = string.Empty;
    public string RequestSha256 { get; init; } = string.Empty;
    public NativeMixingRuleProfile RuleProfile { get; init; } = new();
    public List<NativeRecipeValidationResult> Cases { get; init; } = new();
}

internal sealed class NativeMixingRuleProfile
{
    public string Kind { get; init; } = string.Empty;
    public int? AngleDegrees { get; init; }
}

internal sealed class NativeRecipeValidationResult
{
    public string Id { get; init; } = string.Empty;
    public string ProductId { get; init; } = string.Empty;
    public List<string> IngredientIds { get; init; } = new();
    public List<string> EffectIds { get; init; } = new();
    public float CalculatedValue { get; init; }
}
