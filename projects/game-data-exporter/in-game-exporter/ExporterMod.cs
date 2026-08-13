using System.Reflection;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Il2CppInterop.Runtime;
using MelonLoader;
using S1API.Lifecycle;
using UnityEngine;
using Effect = Il2CppScheduleOne.Effects.Effect;
using EffectList = Il2CppSystem.Collections.Generic.List<Il2CppScheduleOne.Effects.Effect>;
using EffectMixCalculator = Il2CppScheduleOne.Effects.EffectMixCalculator;
using DrugType = Il2CppScheduleOne.Product.EDrugType;
using NativeProductManager = Il2CppScheduleOne.Product.ProductManager;
using NativePropertyUtility = Il2CppScheduleOne.Product.PropertyUtility;

[assembly: MelonInfo(
    typeof(NeonSchedule1.GameDataExporter.ExporterMod),
    "NeonSchedule1 Game Data Exporter",
    NeonSchedule1.GameDataExporter.ExporterMod.ExporterVersion,
    "NeonTechSpace")]

namespace NeonSchedule1.GameDataExporter;

public sealed class ExporterMod : MelonMod
{
    public const string ExporterVersion = "0.0.21";
    private const string OutputEnvironmentVariable = "NEONSCHEDULE1_EXPORT_OUTPUT";

    private static string OutputDirectory => ResolveOutputDirectory();

    private static string ResolveOutputDirectory()
    {
        var configured = Environment.GetEnvironmentVariable(OutputEnvironmentVariable);
        return string.IsNullOrWhiteSpace(configured)
            ? Path.GetFullPath(Path.Combine(
                Directory.GetCurrentDirectory(),
                "UserData",
                "NeonSchedule1",
                "exports"))
            : Path.GetFullPath(configured);
    }

    public override void OnInitializeMelon()
    {
        GameLifecycle.OnLoadComplete += RunAfterLoad;
        LoggerInstance.Msg($"Ready. Load a save to export game data to {OutputDirectory}");
    }

    private void RunAfterLoad()
    {
        try
        {
            Directory.CreateDirectory(OutputDirectory);
            var recipeRequestPath = Path.Combine(
                OutputDirectory,
                GameDataCollector.NativeValidationRequestFileName);
            var convexRequestPath = Path.Combine(
                OutputDirectory,
                GameDataCollector.NativeConvexValidationRequestFileName);
            if (File.Exists(recipeRequestPath) && File.Exists(convexRequestPath))
            {
                throw new InvalidOperationException(
                    "Recipe and convex validation requests cannot run together.");
            }
            if (GameDataCollector.TryRunNativeConvexValidation(
                    OutputDirectory,
                    ExporterVersion,
                    message => LoggerInstance.Msg(message)) ||
                GameDataCollector.TryRunNativeRecipeValidation(
                    OutputDirectory,
                    ExporterVersion,
                    message => LoggerInstance.Msg(message)))
            {
                return;
            }

            GameDataCollector.RequireStandardMixingRuleProfile();
            LoggerInstance.Msg(
                "Reading item, map, layout, shop, people, production, and visual metadata.");
            var exportedAtUtc = DateTimeOffset.UtcNow;
            var runId = exportedAtUtc.UtcDateTime.ToString(
                "yyyyMMdd'T'HHmmssfff'Z'",
                CultureInfo.InvariantCulture);
            var assetDirectoryName = $"neonschedule1-assets-{runId}";
            var report = GameDataCollector.Collect(
                exportedAtUtc,
                Path.Combine(OutputDirectory, assetDirectoryName),
                assetDirectoryName,
                message => LoggerInstance.Msg(message));
            LoggerInstance.Msg("Discovery data collected. Serializing the JSON report.");
            var json = JsonSerializer.Serialize(report, ExportJson.Options);

            var outputPath = Path.Combine(
                OutputDirectory,
                $"neonschedule1-game-data-{runId}.json");
            var temporaryPath = outputPath + ".tmp";
            File.WriteAllText(
                temporaryPath,
                json,
                new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
            File.Move(temporaryPath, outputPath, overwrite: true);
            LoggerInstance.Msg("Report written. Computing its SHA-256 checksum.");

            var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(json)))
                .ToLowerInvariant();
            File.WriteAllText(outputPath + ".sha256", hash + Environment.NewLine, Encoding.ASCII);
            LoggerInstance.Msg($"Export report written to {outputPath}");

            LoggerInstance.Msg(
                $"Export complete: {report.Items.Count} items, {report.Products.Count} products, " +
                $"{report.Mixing.Ingredients.Count} mixing ingredients, " +
                $"{report.Mixing.Effects.Count} effects, {report.Mixing.MixerMaps.Count} mixer maps, " +
                $"{report.Mixing.Oracles.Count} mixer oracle cases, " +
                $"{report.Recipes.Count} recipes, {report.Seeds.Count} seeds, " +
                $"{report.ShroomSpawns.Count} shroom spawns, {report.Customers.Count} customers, " +
                $"{report.RelationshipEdges.Count} relationship edges, {report.Shops.Count} shops, " +
                $"{report.Shops.Sum(shop => shop.Listings.Count)} listings, " +
                $"{report.World.Suppliers.Sum(supplier => supplier.DeliveryListings.Count)} supplier listings, " +
                $"{report.World.Properties.Count} properties, {report.World.Businesses.Count} businesses. " +
                $"Discovery: {report.Discovery.Locations.Count} locations, " +
                $"{report.Discovery.MapServices.Count} typed map services, " +
                $"{report.Discovery.ShopDetails.Count(x => x.Position is not null)} physical shop locations, " +
                $"{report.Discovery.Buildables.Count} buildables, " +
                $"{report.Discovery.Buildables.Sum(x => x.InteractionPoints.Count)} buildable interaction points, " +
                $"{report.Discovery.Buildables.Sum(x => x.TransitAccessPoints.Count)} transit access points, " +
                $"{report.Discovery.Buildables.Sum(x => x.ProceduralTiles.Count)} buildable procedural tiles, " +
                $"{report.Discovery.PropertyLayouts.Count} property layouts, " +
                $"{report.Discovery.PropertyLayouts.Sum(x => x.Colliders.Count)} property colliders, " +
                $"{report.Discovery.PropertyLayouts.Sum(x => x.Surfaces.Count)} surfaces, " +
                $"{report.Discovery.PropertyLayouts.Sum(x => x.ProceduralTiles.Count)} property procedural tiles, " +
                $"{report.Discovery.PropertyLayouts.Sum(x => x.LoadingDocks.Count)} loading docks, " +
                $"{report.Discovery.NpcSchedules.Count} NPC schedules with " +
                $"{report.Discovery.ScheduleActionCount} actions, " +
                $"{report.Discovery.NpcSchedules.Sum(x => x.Actions.Count(a => a.Location is not null))} located actions, " +
                $"{report.Discovery.Navigation.Samples.Count} navigation samples with " +
                $"{report.Discovery.Navigation.Edges.Count / 2} verified edges, " +
                $"{report.Discovery.VisualAssets.Meshes.Count} mesh assets, " +
                $"{report.Discovery.VisualMeshFileCount} exported mesh files, " +
                $"{report.Discovery.VisualTextureFileCount} exported material textures, " +
                $"{report.Discovery.VisualAssets.Materials.Count} material assets, " +
                $"{report.Discovery.PresentationAssetCandidates.Count} presentation candidates, " +
                $"{report.Discovery.AssetCount} exported assets. " +
                $"SHA-256 {hash}");
        }
        catch (Exception exception)
        {
            LoggerInstance.Error(
                $"Game data export failed ({exception.GetType().Name}): {exception.Message}");
        }
    }
}
