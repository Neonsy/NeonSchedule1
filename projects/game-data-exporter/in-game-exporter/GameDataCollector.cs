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

namespace NeonSchedule1.GameDataExporter;

internal static partial class GameDataCollector
{
    private static readonly DrugType[] SupportedDrugTypes =
    {
        DrugType.Marijuana,
        DrugType.Methamphetamine,
        DrugType.Cocaine,
        DrugType.Shrooms,
    };

    internal static GameDataReport Collect(
        DateTimeOffset exportedAtUtc,
        string assetDirectory,
        string assetDirectoryName,
        Action<string>? progress)
    {
        var registry = Il2CppScheduleOne.Registry.Instance
            ?? throw new InvalidOperationException("Registry.Instance is unavailable after load.");
        var productManager = NativeProductManager.Instance
            ?? throw new InvalidOperationException("ProductManager.Instance is unavailable after load.");
        var propertyUtility = NativePropertyUtility.Instance
            ?? throw new InvalidOperationException("PropertyUtility.Instance is unavailable after load.");

        var nativeItems = CopyItems(registry.GetAllItems());
        var products = CollectStaticProducts(productManager);
        var recipeCollection = CollectRecipes(products);
        var ovenTransformCollection = CollectOvenTransforms(nativeItems);
        var qualityValues = CollectQualityValues(products);
        var peopleCollection = CollectPeople(products);
        var world = CollectWorld();
        progress?.Invoke("Collecting complete mixer solver data and oracle cases.");
        var mixing = CollectMixingSummary(productManager, propertyUtility, products);
        progress?.Invoke(
            $"Mixer solver data complete: {mixing.Ingredients.Count} ingredients, " +
            $"{mixing.Effects.Count} effects, {mixing.MixerMaps.Count} maps, " +
            $"{mixing.Oracles.Count} oracle cases.");
        var discovery = DiscoveryCollector.Collect(
            nativeItems,
            assetDirectory,
            assetDirectoryName,
            progress);

        return new GameDataReport
        {
            SchemaVersion = "neonschedule1-game-data-export-1",
            ExporterVersion = ExporterMod.ExporterVersion,
            ExportedAtUtc = exportedAtUtc,
            Runtime = "IL2CPP",
            GameVersion = Application.version,
            MelonLoaderVersion = AssemblyVersion(typeof(MelonMod).Assembly),
            S1ApiVersion = AssemblyVersion(typeof(S1API.Products.ProductManager).Assembly),
            SaveState = CollectSaveState(productManager, recipeCollection.Recipes),
            Mixing = mixing,
            Items = nativeItems.Select(ItemSnapshot.FromNative).ToList(),
            Products = products.Select(ProductSnapshot.FromNative).ToList(),
            RecipeSources = recipeCollection.Sources,
            Recipes = recipeCollection.Recipes.Select(RecipeSnapshot.FromNative).ToList(),
            Seeds = CollectSeeds(nativeItems),
            ShroomSpawns = CollectShroomSpawns(nativeItems),
            Packaging = CollectPackaging(nativeItems),
            Additives = CollectAdditives(nativeItems),
            Soils = CollectSoils(nativeItems),
            OvenTransformSources = ovenTransformCollection.Sources,
            OvenTransforms = ovenTransformCollection.Transforms,
            ProductionStations = CollectProductionStations(nativeItems),
            QualityValues = qualityValues,
            QualityMechanics = CollectQualityMechanics(qualityValues),
            PeopleSources = peopleCollection.Sources,
            People = peopleCollection.People,
            Customers = peopleCollection.Customers,
            RelationshipEdges = peopleCollection.RelationshipEdges,
            CustomerConstants = peopleCollection.CustomerConstants,
            World = world,
            Shops = CollectShops(),
            Discovery = discovery,
        };
    }

    private static string AssemblyVersion(Assembly assembly) =>
        assembly.GetName().Version?.ToString() ?? "unknown";

    private static List<Il2CppScheduleOne.ItemFramework.ItemDefinition> CopyItems(
        Il2CppSystem.Collections.Generic.List<Il2CppScheduleOne.ItemFramework.ItemDefinition>? source)
    {
        if (source is null)
        {
            throw new InvalidOperationException("Registry.GetAllItems returned null.");
        }

        var result = new List<Il2CppScheduleOne.ItemFramework.ItemDefinition>(source.Count);
        var ids = new HashSet<string>(StringComparer.Ordinal);

        for (var index = 0; index < source.Count; index++)
        {
            var item = source[index];
            if (item is null || string.IsNullOrWhiteSpace(item.ID))
            {
                continue;
            }

            if (!ids.Add(item.ID))
            {
                throw new InvalidOperationException($"Duplicate registry item ID '{item.ID}'.");
            }

            result.Add(item);
        }

        return result.OrderBy(item => item.ID, StringComparer.Ordinal).ToList();
    }

    private static List<Il2CppScheduleOne.Product.ProductDefinition> CollectStaticProducts(
        NativeProductManager manager)
    {
        var createdIds = new HashSet<string>(StringComparer.Ordinal);
        if (manager.createdProducts is not null)
        {
            for (var index = 0; index < manager.createdProducts.Count; index++)
            {
                var created = manager.createdProducts[index];
                if (created is not null && !string.IsNullOrWhiteSpace(created.ID))
                {
                    createdIds.Add(created.ID);
                }
            }
        }

        var source = manager.AllProducts
            ?? throw new InvalidOperationException("ProductManager.AllProducts is unavailable.");
        var result = new List<Il2CppScheduleOne.Product.ProductDefinition>();
        var ids = new HashSet<string>(StringComparer.Ordinal);

        for (var index = 0; index < source.Count; index++)
        {
            var product = source[index];
            if (product is null || string.IsNullOrWhiteSpace(product.ID) || createdIds.Contains(product.ID))
            {
                continue;
            }

            if (!ids.Add(product.ID))
            {
                throw new InvalidOperationException($"Duplicate static product ID '{product.ID}'.");
            }

            result.Add(product);
        }

        return result.OrderBy(product => product.ID, StringComparer.Ordinal).ToList();
    }

    private static RecipeCollection CollectRecipes(
        IReadOnlyList<Il2CppScheduleOne.Product.ProductDefinition> products)
    {
        var result = new List<Il2CppScheduleOne.StationFramework.StationRecipe>();
        var ids = new HashSet<string>(StringComparer.Ordinal);
        var sources = new RecipeSourceSnapshot();

        void AddRecipe(Il2CppScheduleOne.StationFramework.StationRecipe? recipe)
        {
            if (recipe is null || string.IsNullOrWhiteSpace(recipe.RecipeID))
            {
                return;
            }

            if (ids.Add(recipe.RecipeID))
            {
                result.Add(recipe);
            }
        }

        foreach (var product in products)
        {
            if (product.Recipes is null)
            {
                continue;
            }

            for (var index = 0; index < product.Recipes.Count; index++)
            {
                sources.ProductAttachedCount++;
                AddRecipe(product.Recipes[index]);
            }
        }

        var chemistryInterface =
            Il2CppScheduleOne.UI.Stations.ChemistryStationInterface.Instance;
        if (chemistryInterface?.Recipes is not null)
        {
            for (var index = 0; index < chemistryInterface.Recipes.Count; index++)
            {
                sources.ChemistryInterfaceCount++;
                AddRecipe(chemistryInterface.Recipes[index]);
            }
        }

        var loadedAssets = Resources.FindObjectsOfTypeAll<
            Il2CppScheduleOne.StationFramework.StationRecipe>();
        if (loadedAssets is not null)
        {
            sources.LoadedAssetCount = loadedAssets.Length;
            for (var index = 0; index < loadedAssets.Length; index++)
            {
                AddRecipe(loadedAssets[index]);
            }
        }

        var resourceAssets = Resources.LoadAll<
            Il2CppScheduleOne.StationFramework.StationRecipe>(string.Empty);
        if (resourceAssets is not null)
        {
            sources.ResourceAssetCount = resourceAssets.Length;
            for (var index = 0; index < resourceAssets.Length; index++)
            {
                AddRecipe(resourceAssets[index]);
            }
        }

        sources.UniqueRecipeCount = result.Count;
        return new RecipeCollection
        {
            Sources = sources,
            Recipes = result.OrderBy(recipe => recipe.RecipeID, StringComparer.Ordinal).ToList(),
        };
    }

    private static SaveStateSnapshot CollectSaveState(
        NativeProductManager manager,
        IReadOnlyList<Il2CppScheduleOne.StationFramework.StationRecipe> recipes)
    {
        var knownCount = manager.DefaultKnownProducts?.Count ?? 0;
        var createdCount = manager.createdProducts?.Count ?? 0;

        return new SaveStateSnapshot
        {
            DefaultKnownProductCount = knownCount,
            CreatedProductCount = createdCount,
            UnlockedRecipeCount = recipes.Count(recipe => recipe.Unlocked),
            DiscoveredRecipeCount = recipes.Count(recipe => recipe.IsDiscovered),
        };
    }

    private static MixingSummary CollectMixingSummary(
        NativeProductManager manager,
        NativePropertyUtility propertyUtility,
        IReadOnlyList<Il2CppScheduleOne.Product.ProductDefinition> products)
    {
        var effectsById = new Dictionary<string, Effect>(StringComparer.Ordinal);
        var nativeEffects = propertyUtility.AllProperties
            ?? throw new InvalidOperationException("PropertyUtility.AllProperties is unavailable.");
        for (var effectIndex = 0; effectIndex < nativeEffects.Count; effectIndex++)
        {
            var effect = nativeEffects[effectIndex];
            if (effect is null || string.IsNullOrWhiteSpace(effect.ID))
            {
                continue;
            }
            if (!effectsById.TryAdd(effect.ID, effect))
            {
                throw new InvalidOperationException($"Duplicate effect ID '{effect.ID}'.");
            }
        }

        var ingredients = new List<Il2CppScheduleOne.Product.PropertyItemDefinition>();
        var ingredientIds = new HashSet<string>(StringComparer.Ordinal);
        var nativeIngredients = manager.ValidMixIngredients
            ?? throw new InvalidOperationException("ProductManager.ValidMixIngredients is unavailable.");
        for (var ingredientIndex = 0;
             ingredientIndex < nativeIngredients.Count;
             ingredientIndex++)
        {
            var ingredient = nativeIngredients[ingredientIndex];
            if (ingredient is null || string.IsNullOrWhiteSpace(ingredient.ID))
            {
                continue;
            }
            if (ingredient.Properties is null || ingredient.Properties.Count == 0)
            {
                throw new InvalidOperationException(
                    $"Mix ingredient '{ingredient.ID}' has no effects.");
            }
            if (!ingredientIds.Add(ingredient.ID))
            {
                throw new InvalidOperationException(
                    $"Duplicate mix ingredient ID '{ingredient.ID}'.");
            }
            ingredients.Add(ingredient);
        }

        var mapEffectCounts = new Dictionary<string, int>(StringComparer.Ordinal);
        var mixerMaps = new List<MixMapSnapshot>(SupportedDrugTypes.Length);
        foreach (var drugType in SupportedDrugTypes)
        {
            var map = manager.GetMixerMap(drugType)
                ?? throw new InvalidOperationException($"Mixer map '{drugType}' is unavailable.");
            var entries = map.Effects
                ?? throw new InvalidOperationException($"Mixer map '{drugType}' has no effects.");
            mapEffectCounts[drugType.ToString()] = entries.Count;
            var mapSnapshot = new MixMapSnapshot
            {
                DrugType = drugType.ToString(),
                DrugTypeValue = (int)drugType,
                MapRadius = map.MapRadius,
            };
            for (var entryIndex = 0; entryIndex < entries.Count; entryIndex++)
            {
                var entry = entries[entryIndex];
                if (entry?.Property is null || string.IsNullOrWhiteSpace(entry.Property.ID))
                {
                    throw new InvalidOperationException(
                        $"Mixer map '{drugType}' contains an invalid entry at {entryIndex}.");
                }
                mapSnapshot.Effects.Add(new MixMapEffectSnapshot
                {
                    Index = entryIndex,
                    EffectId = entry.Property.ID,
                    PositionX = entry.Position.x,
                    PositionY = entry.Position.y,
                    Radius = entry.Radius,
                });
            }
            mixerMaps.Add(mapSnapshot);
        }

        var defaultProductIds = new HashSet<string>(StringComparer.Ordinal);
        AddMixProductId(defaultProductIds, manager.DefaultWeed);
        AddMixProductId(defaultProductIds, manager.DefaultMeth);
        AddMixProductId(defaultProductIds, manager.DefaultCocaine);
        AddMixProductId(defaultProductIds, manager.DefaultShroom);
        if (manager.DefaultKnownProducts is not null)
        {
            for (var productIndex = 0;
                 productIndex < manager.DefaultKnownProducts.Count;
                 productIndex++)
            {
                AddMixProductId(defaultProductIds, manager.DefaultKnownProducts[productIndex]);
            }
        }

        return new MixingSummary
        {
            MaxProperties = EffectMixCalculator.MAX_PROPERTIES,
            MaxDeltaDifference = EffectMixCalculator.MAX_DELTA_DIFFERENCE,
            ValidIngredientCount = ingredients.Count,
            EffectCount = effectsById.Count,
            MixerMapEffectCounts = mapEffectCounts,
            DefaultProductIds = defaultProductIds.OrderBy(id => id, StringComparer.Ordinal).ToList(),
            Ingredients = ingredients
                .OrderBy(ingredient => ingredient.ID, StringComparer.Ordinal)
                .Select(MixIngredientSnapshot.FromNative)
                .ToList(),
            Effects = effectsById.Values
                .OrderBy(effect => effect.ID, StringComparer.Ordinal)
                .Select(MixEffectSnapshot.FromNative)
                .ToList(),
            MixerMaps = mixerMaps,
            Oracles = CollectMixOracles(products, ingredients, effectsById),
        };
    }

    private static void AddMixProductId(
        ISet<string> ids,
        Il2CppScheduleOne.Product.ProductDefinition? product)
    {
        if (product is not null && !string.IsNullOrWhiteSpace(product.ID))
        {
            ids.Add(product.ID);
        }
    }

    private static List<MixOracleSnapshot> CollectMixOracles(
        IReadOnlyList<Il2CppScheduleOne.Product.ProductDefinition> products,
        IReadOnlyList<Il2CppScheduleOne.Product.PropertyItemDefinition> ingredients,
        IReadOnlyDictionary<string, Effect> effectsById)
    {
        var result = new List<MixOracleSnapshot>();
        foreach (var product in products)
        {
            foreach (var firstIngredient in ingredients)
            {
                var first = MixEffects(
                    product.Properties,
                    firstIngredient.Properties[0],
                    product.DrugType);
                result.Add(MixOracleSnapshot.FromProduct(
                    product,
                    new[] { firstIngredient.ID },
                    first));

                foreach (var secondIngredient in ingredients)
                {
                    var second = MixEffects(
                        first,
                        secondIngredient.Properties[0],
                        product.DrugType);
                    result.Add(MixOracleSnapshot.FromProduct(
                        product,
                        new[] { firstIngredient.ID, secondIngredient.ID },
                        second));
                }
            }
        }

        foreach (var drugType in SupportedDrugTypes)
        {
            foreach (var effect in effectsById.Values.OrderBy(
                         effect => effect.ID,
                         StringComparer.Ordinal))
            {
                foreach (var ingredient in ingredients)
                {
                    var seed = new EffectList();
                    seed.Add(effect);
                    var mixed = MixEffects(seed, ingredient.Properties[0], drugType);
                    result.Add(new MixOracleSnapshot
                    {
                        Kind = "single-effect",
                        DrugType = drugType.ToString(),
                        DrugTypeValue = (int)drugType,
                        BaseValue = 100f,
                        InputEffectIds = new List<string> { effect.ID },
                        IngredientIds = new List<string> { ingredient.ID },
                        ResultEffectIds = CopyMixEffectIds(mixed),
                        CalculatedValue = NativeProductManager.CalculateProductValue(100f, mixed),
                    });
                }
            }
        }

        return result;
    }

    private static EffectList MixEffects(
        EffectList current,
        Effect newEffect,
        DrugType drugType)
    {
        var input = new EffectList();
        if (current is not null)
        {
            for (var index = 0; index < current.Count; index++)
            {
                if (current[index] is not null)
                {
                    input.Add(current[index]);
                }
            }
        }
        return EffectMixCalculator.MixProperties(input, newEffect, drugType)
            ?? throw new InvalidOperationException(
                $"MixProperties returned null for '{drugType}' and '{newEffect.ID}'.");
    }

    internal static List<string> CopyMixEffectIds(EffectList? effects)
    {
        var result = new List<string>();
        if (effects is null)
        {
            return result;
        }
        for (var index = 0; index < effects.Count; index++)
        {
            var effect = effects[index];
            if (effect is not null && !string.IsNullOrWhiteSpace(effect.ID))
            {
                result.Add(effect.ID);
            }
        }
        return result;
    }

}
