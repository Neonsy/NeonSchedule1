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

internal sealed class GameDataReport
{
    public string SchemaVersion { get; init; } = string.Empty;
    public string ExporterVersion { get; init; } = string.Empty;
    public DateTimeOffset ExportedAtUtc { get; init; }
    public string Runtime { get; init; } = string.Empty;
    public string GameVersion { get; init; } = string.Empty;
    public string MelonLoaderVersion { get; init; } = string.Empty;
    public string S1ApiVersion { get; init; } = string.Empty;
    public SaveStateSnapshot SaveState { get; init; } = new();
    public MixingSummary Mixing { get; init; } = new();
    public RecipeSourceSnapshot RecipeSources { get; init; } = new();
    public List<ItemSnapshot> Items { get; init; } = new();
    public List<ProductSnapshot> Products { get; init; } = new();
    public List<RecipeSnapshot> Recipes { get; init; } = new();
    public List<SeedSnapshot> Seeds { get; init; } = new();
    public List<ShroomSpawnSnapshot> ShroomSpawns { get; init; } = new();
    public List<PackagingSnapshot> Packaging { get; init; } = new();
    public List<AdditiveSnapshot> Additives { get; init; } = new();
    public List<SoilSnapshot> Soils { get; init; } = new();
    public OvenTransformSourceSnapshot OvenTransformSources { get; init; } = new();
    public List<OvenTransformSnapshot> OvenTransforms { get; init; } = new();
    public List<ProductionStationSnapshot> ProductionStations { get; init; } = new();
    public ProductionLogisticsSnapshot ProductionLogistics { get; init; } = new();
    public List<QualityValueSnapshot> QualityValues { get; init; } = new();
    public QualityMechanicsSnapshot QualityMechanics { get; init; } = new();
    public PeopleSourceSnapshot PeopleSources { get; init; } = new();
    public List<PersonSnapshot> People { get; init; } = new();
    public List<CustomerSnapshot> Customers { get; init; } = new();
    public List<RelationshipEdgeSnapshot> RelationshipEdges { get; init; } = new();
    public CustomerConstantsSnapshot CustomerConstants { get; init; } = new();
    public WorldSnapshot World { get; init; } = new();
    public List<ShopSnapshot> Shops { get; init; } = new();
    public DiscoverySnapshot Discovery { get; init; } = new();
}

internal sealed class RecipeCollection
{
    public RecipeSourceSnapshot Sources { get; init; } = new();
    public List<Il2CppScheduleOne.StationFramework.StationRecipe> Recipes { get; init; } = new();
}

internal sealed class RecipeSourceSnapshot
{
    public int ProductAttachedCount { get; set; }
    public int ChemistryInterfaceCount { get; set; }
    public int LoadedAssetCount { get; set; }
    public int ResourceAssetCount { get; set; }
    public int UniqueRecipeCount { get; set; }
}

internal sealed class SaveStateSnapshot
{
    public int DefaultKnownProductCount { get; init; }
    public int CreatedProductCount { get; init; }
    public int UnlockedRecipeCount { get; init; }
    public int DiscoveredRecipeCount { get; init; }
}

internal sealed class MixingSummary
{
    public int MaxProperties { get; init; }
    public float MaxDeltaDifference { get; init; }
    public int ValidIngredientCount { get; init; }
    public int EffectCount { get; init; }
    public Dictionary<string, int> MixerMapEffectCounts { get; init; } = new();
    public List<string> DefaultProductIds { get; init; } = new();
    public List<MixIngredientSnapshot> Ingredients { get; init; } = new();
    public List<MixEffectSnapshot> Effects { get; init; } = new();
    public List<MixMapSnapshot> MixerMaps { get; init; } = new();
    public List<MixOracleSnapshot> Oracles { get; init; } = new();
}

internal sealed class MixIngredientSnapshot
{
    public string Id { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public float BasePurchasePrice { get; init; }
    public float ResellMultiplier { get; init; }
    public List<string> EffectIds { get; init; } = new();

    internal static MixIngredientSnapshot FromNative(
        Il2CppScheduleOne.Product.PropertyItemDefinition ingredient) => new()
    {
        Id = ingredient.ID,
        Name = ingredient.Name,
        BasePurchasePrice = ingredient.BasePurchasePrice,
        ResellMultiplier = ingredient.ResellMultiplier,
        EffectIds = GameDataCollector.CopyMixEffectIds(ingredient.Properties),
    };
}

internal sealed class MixEffectSnapshot
{
    public string Id { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public int Tier { get; init; }
    public float Addictiveness { get; init; }
    public bool ImplementedPriorMixingRework { get; init; }
    public int ValueChange { get; init; }
    public float ValueMultiplier { get; init; }
    public float AddBaseValueMultiple { get; init; }
    public float MixDirectionX { get; init; }
    public float MixDirectionY { get; init; }
    public float MixMagnitude { get; init; }

    internal static MixEffectSnapshot FromNative(Effect effect) => new()
    {
        Id = effect.ID,
        Name = effect.Name,
        Tier = effect.Tier,
        Addictiveness = effect.Addictiveness,
        ImplementedPriorMixingRework = effect.ImplementedPriorMixingRework,
        ValueChange = effect.ValueChange,
        ValueMultiplier = effect.ValueMultiplier,
        AddBaseValueMultiple = effect.AddBaseValueMultiple,
        MixDirectionX = effect.MixDirection.x,
        MixDirectionY = effect.MixDirection.y,
        MixMagnitude = effect.MixMagnitude,
    };
}

internal sealed class MixMapSnapshot
{
    public string DrugType { get; init; } = string.Empty;
    public int DrugTypeValue { get; init; }
    public float MapRadius { get; init; }
    public List<MixMapEffectSnapshot> Effects { get; init; } = new();
}

internal sealed class MixMapEffectSnapshot
{
    public int Index { get; init; }
    public string EffectId { get; init; } = string.Empty;
    public float PositionX { get; init; }
    public float PositionY { get; init; }
    public float Radius { get; init; }
}

internal sealed class MixOracleSnapshot
{
    public string Kind { get; init; } = string.Empty;
    public string? ProductId { get; init; }
    public string DrugType { get; init; } = string.Empty;
    public int DrugTypeValue { get; init; }
    public float BaseValue { get; init; }
    public List<string> InputEffectIds { get; init; } = new();
    public List<string> IngredientIds { get; init; } = new();
    public List<string> ResultEffectIds { get; init; } = new();
    public float CalculatedValue { get; init; }

    internal static MixOracleSnapshot FromProduct(
        Il2CppScheduleOne.Product.ProductDefinition product,
        IEnumerable<string> ingredientIds,
        EffectList result) => new()
    {
        Kind = "product-sequence",
        ProductId = product.ID,
        DrugType = product.DrugType.ToString(),
        DrugTypeValue = (int)product.DrugType,
        BaseValue = product.BasePrice,
        InputEffectIds = GameDataCollector.CopyMixEffectIds(product.Properties),
        IngredientIds = ingredientIds.ToList(),
        ResultEffectIds = GameDataCollector.CopyMixEffectIds(result),
        CalculatedValue = NativeProductManager.CalculateProductValue(
            product.BasePrice,
            result),
    };
}

internal sealed class ItemSnapshot
{
    public string Id { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public string RuntimeType { get; init; } = string.Empty;
    public string Category { get; init; } = string.Empty;
    public int StackLimit { get; init; }
    public bool IsStorable { get; init; }
    public float? BasePurchasePrice { get; init; }
    public float? ResellMultiplier { get; init; }
    public bool? RequiresLevelToPurchase { get; init; }
    public string? RequiredRank { get; init; }
    public int? RequiredRankTier { get; init; }
    public bool? IsUnlockedInLoadedSave { get; init; }

    internal static ItemSnapshot FromNative(Il2CppScheduleOne.ItemFramework.ItemDefinition item)
    {
        var storable = item.TryCast<Il2CppScheduleOne.ItemFramework.StorableItemDefinition>();
        return new ItemSnapshot
        {
            Id = item.ID,
            Name = item.Name,
            RuntimeType = item.GetType().FullName ?? string.Empty,
            Category = item.Category.ToString(),
            StackLimit = item.StackLimit,
            IsStorable = storable is not null,
            BasePurchasePrice = storable?.BasePurchasePrice,
            ResellMultiplier = storable?.ResellMultiplier,
            RequiresLevelToPurchase = storable?.RequiresLevelToPurchase,
            RequiredRank = storable?.RequiredRank.Rank.ToString(),
            RequiredRankTier = storable?.RequiredRank.Tier,
            IsUnlockedInLoadedSave = storable?.IsUnlocked,
        };
    }
}

internal sealed class ProductSnapshot
{
    public string Id { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public string DrugType { get; init; } = string.Empty;
    public int DrugTypeValue { get; init; }
    public float BasePrice { get; init; }
    public float MarketValue { get; init; }
    public float CurrentPrice { get; init; }
    public float BasePurchasePrice { get; init; }
    public float BaseAddictiveness { get; init; }
    public List<string> EffectIds { get; init; } = new();
    public List<string> RecipeIds { get; init; } = new();
    public List<string> ValidPackagingIds { get; init; } = new();

    internal static ProductSnapshot FromNative(Il2CppScheduleOne.Product.ProductDefinition product)
    {
        var effectIds = new List<string>();
        if (product.Properties is not null)
        {
            for (var index = 0; index < product.Properties.Count; index++)
            {
                var effect = product.Properties[index];
                if (effect is not null && !string.IsNullOrWhiteSpace(effect.ID))
                {
                    effectIds.Add(effect.ID);
                }
            }
        }

        var recipeIds = new List<string>();
        if (product.Recipes is not null)
        {
            for (var index = 0; index < product.Recipes.Count; index++)
            {
                var recipe = product.Recipes[index];
                if (recipe is not null && !string.IsNullOrWhiteSpace(recipe.RecipeID))
                {
                    recipeIds.Add(recipe.RecipeID);
                }
            }
        }

        var packagingIds = new List<string>();
        if (product.ValidPackaging is not null)
        {
            for (var index = 0; index < product.ValidPackaging.Length; index++)
            {
                var packaging = product.ValidPackaging[index];
                if (packaging is not null && !string.IsNullOrWhiteSpace(packaging.ID))
                {
                    packagingIds.Add(packaging.ID);
                }
            }
        }

        return new ProductSnapshot
        {
            Id = product.ID,
            Name = product.Name,
            DrugType = product.DrugType.ToString(),
            DrugTypeValue = (int)product.DrugType,
            BasePrice = product.BasePrice,
            MarketValue = product.MarketValue,
            CurrentPrice = product.Price,
            BasePurchasePrice = product.BasePurchasePrice,
            BaseAddictiveness = product.BaseAddictiveness,
            EffectIds = effectIds,
            RecipeIds = recipeIds.OrderBy(id => id, StringComparer.Ordinal).ToList(),
            ValidPackagingIds = packagingIds.OrderBy(id => id, StringComparer.Ordinal).ToList(),
        };
    }
}

internal sealed class RecipeSnapshot
{
    public string Id { get; init; } = string.Empty;
    public string Title { get; init; } = string.Empty;
    public bool UnlockedInLoadedSave { get; init; }
    public bool DiscoveredInLoadedSave { get; init; }
    public int CookTimeMinutes { get; init; }
    public float CookTemperature { get; init; }
    public float CookTemperatureTolerance { get; init; }
    public string QualityCalculationMethod { get; init; } = string.Empty;
    public List<RecipeIngredientSnapshot> Ingredients { get; init; } = new();
    public string OutputItemId { get; init; } = string.Empty;
    public int OutputQuantity { get; init; }

    internal static RecipeSnapshot FromNative(Il2CppScheduleOne.StationFramework.StationRecipe recipe)
    {
        var ingredients = new List<RecipeIngredientSnapshot>();
        if (recipe.Ingredients is not null)
        {
            for (var index = 0; index < recipe.Ingredients.Count; index++)
            {
                var ingredient = recipe.Ingredients[index];
                if (ingredient is null)
                {
                    continue;
                }

                var ids = new HashSet<string>(StringComparer.Ordinal);
                if (ingredient.Item is not null && !string.IsNullOrWhiteSpace(ingredient.Item.ID))
                {
                    ids.Add(ingredient.Item.ID);
                }

                if (ingredient.Items is not null)
                {
                    for (var variantIndex = 0; variantIndex < ingredient.Items.Count; variantIndex++)
                    {
                        var variant = ingredient.Items[variantIndex];
                        if (variant is not null && !string.IsNullOrWhiteSpace(variant.ID))
                        {
                            ids.Add(variant.ID);
                        }
                    }
                }

                ingredients.Add(new RecipeIngredientSnapshot
                {
                    Quantity = ingredient.Quantity,
                    AcceptedItemIds = ids.OrderBy(id => id, StringComparer.Ordinal).ToList(),
                });
            }
        }

        return new RecipeSnapshot
        {
            Id = recipe.RecipeID,
            Title = recipe.RecipeTitle,
            UnlockedInLoadedSave = recipe.Unlocked,
            DiscoveredInLoadedSave = recipe.IsDiscovered,
            CookTimeMinutes = recipe.CookTime_Mins,
            CookTemperature = recipe.CookTemperature,
            CookTemperatureTolerance = recipe.CookTemperatureTolerance,
            QualityCalculationMethod = recipe.QualityCalculationMethod.ToString(),
            Ingredients = ingredients,
            OutputItemId = recipe.Product?.Item?.ID ?? string.Empty,
            OutputQuantity = recipe.Product?.Quantity ?? 0,
        };
    }
}

internal sealed class RecipeIngredientSnapshot
{
    public int Quantity { get; init; }
    public List<string> AcceptedItemIds { get; init; } = new();
}

internal sealed class SeedSnapshot
{
    public string ItemId { get; init; } = string.Empty;
    public string PlantRuntimeType { get; init; } = string.Empty;
    public int GrowthTime { get; init; }
    public int BaseYieldQuantity { get; init; }
    public string HarvestTarget { get; init; } = string.Empty;
    public List<HarvestSnapshot> Harvestables { get; init; } = new();
}

internal sealed class HarvestSnapshot
{
    public string ProductId { get; init; } = string.Empty;
    public int Quantity { get; init; }
}

internal sealed class ShroomSpawnSnapshot
{
    public string ItemId { get; init; } = string.Empty;
    public string ProductId { get; init; } = string.Empty;
    public int GrowTime { get; init; }
    public int BaseYieldQuantity { get; init; }
    public float MaximumTemperatureForGrowth { get; init; }
    public float MinimumSoilMoistureForGrowth { get; init; }
}

internal sealed class PackagingSnapshot
{
    public string ItemId { get; init; } = string.Empty;
    public int Quantity { get; init; }
    public float BasePurchasePrice { get; init; }
}

internal sealed class AdditiveSnapshot
{
    public string ItemId { get; init; } = string.Empty;
    public float QualityChange { get; init; }
    public float YieldMultiplier { get; init; }
    public float InstantGrowth { get; init; }
}

internal sealed class SoilSnapshot
{
    public string ItemId { get; init; } = string.Empty;
    public string Quality { get; init; } = string.Empty;
    public int Uses { get; init; }
}

internal sealed class OvenTransformCollection
{
    public OvenTransformSourceSnapshot Sources { get; init; } = new();
    public List<OvenTransformSnapshot> Transforms { get; init; } = new();
}

internal sealed class OvenTransformSourceSnapshot
{
    public int StorableDefinitionCount { get; set; }
    public int StationItemCount { get; set; }
    public int ModuleCount { get; set; }
    public int CookableModuleCount { get; set; }
    public int UniqueTransformCount { get; set; }
}

internal sealed class OvenTransformSnapshot
{
    public string InputItemId { get; init; } = string.Empty;
    public string CookType { get; init; } = string.Empty;
    public int CookTime { get; init; }
    public string OutputItemId { get; init; } = string.Empty;
    public int OutputQuantity { get; init; }
}

internal sealed class ProductionStationSnapshot
{
    public string ItemId { get; init; } = string.Empty;
    public string Kind { get; set; } = string.Empty;
    public int? CookTime { get; set; }
    public int? RequiredPrimaryInputQuantity { get; set; }
    public string? OutputItemId { get; set; }
    public string? GrainBagItemId { get; set; }
    public float? YieldMultiplier { get; set; }
    public float? GrowSpeedMultiplier { get; set; }
    public float? MaxTemperatureGrowthMultiplier { get; set; }
    public int? Capacity { get; set; }
    public int? TimePerItem { get; set; }
    public float? EmployeeSpeedMultiplier { get; set; }
    public float? MaxProcessMultiplier { get; set; }
    public int? ProcessMinutesPerTier { get; set; }
    public float? MinimumTemperatureThreshold { get; set; }
    public float? MaximumTemperatureThreshold { get; set; }
    public bool? RequiresManualIngredientInsertion { get; set; }
    public int? InputSlotCount { get; set; }
    public int? OutputSlotCount { get; set; }
    public int? ProductSlotCount { get; set; }
    public string? PackagingItemId { get; set; }
    public int? PackagingQuantity { get; set; }
    public string? PrimaryInputPrefabName { get; set; }
    public string? SecondaryInputPrefabName { get; set; }
    public string? PrimaryInputItemId { get; set; }
    public string? SecondaryInputItemId { get; set; }
    public float? ApplyDelay { get; set; }
    public float? Cooldown { get; set; }
    public int? MinimumTargetCount { get; set; }
    public List<string> AllowedSoilIds { get; set; } = new();
    public List<string> AllowedAdditiveIds { get; set; } = new();
    public List<SlotFilterSnapshot> InputFilters { get; set; } = new();
    public List<SlotFilterSnapshot> OutputFilters { get; set; } = new();
    public List<SporeSyringeSnapshot> SporeSyringes { get; set; } = new();
}

internal sealed class SlotFilterSnapshot
{
    public int SlotIndex { get; init; }
    public string FilterType { get; init; } = string.Empty;
    public bool? IsWhitelist { get; set; }
    public List<string> ItemIds { get; set; } = new();
    public List<string> Categories { get; set; } = new();
}

internal sealed class ProductionLogisticsSnapshot
{
    public int HandlerRouteLimit { get; init; }
    public string RouteSelection { get; init; } = string.Empty;
    public List<string> RouteFilterModes { get; init; } = new();
    public List<string> MovedQuantityLimits { get; init; } = new();
    public string AccessPointSelection { get; init; } = string.Empty;
    public List<string> HandlerTaskPriority { get; init; } = new();
    public EmployeeSchedulingSnapshot EmployeeScheduling { get; init; } = new();
    public List<string> StationMovementEmployeeTypes { get; init; } = new();
}

internal sealed class EmployeeSchedulingSnapshot
{
    public string DispatchAuthority { get; init; } = string.Empty;
    public string DispatchPrerequisite { get; init; } = string.Empty;
    public string TaskSelection { get; init; } = string.Empty;
    public string TaskReadiness { get; init; } = string.Empty;
    public EmployeeWorkAvailabilitySnapshot WorkAvailability { get; init; } = new();
    public List<string> BotanistTaskPriority { get; init; } = new();
    public List<string> ChemistTaskPriority { get; init; } = new();
}

internal sealed class EmployeeWorkAvailabilitySnapshot
{
    public string EmployeeHome { get; init; } = string.Empty;
    public string DailyPayment { get; init; } = string.Empty;
    public string ShiftSchedule { get; init; } = string.Empty;
    public int EndOfDayTime { get; init; }
    public string ConsumeProduct { get; init; } = string.Empty;
}

internal sealed class SporeSyringeSnapshot
{
    public string ItemId { get; init; } = string.Empty;
    public string OutputSpawnItemId { get; init; } = string.Empty;
}

internal sealed class QualityValueSnapshot
{
    public string ProductId { get; init; } = string.Empty;
    public string Quality { get; init; } = string.Empty;
    public float MonetaryValue { get; init; }
}

internal sealed class QualityMechanicsSnapshot
{
    public float CustomerQualityMaxEffect { get; init; }
    public float CustomerPropertyMaxEffect { get; init; }
    public float MinimumOrderAppeal { get; init; }
    public bool MonetaryValueVariesByQuality { get; init; }
    public List<QualityScalarSnapshot> QualityScalars { get; init; } = new();
}

internal sealed class QualityScalarSnapshot
{
    public string Quality { get; init; } = string.Empty;
    public float Scalar { get; init; }
}

internal sealed class WorldSnapshot
{
    public float? CurrentOrderLimitMultiplierInLoadedSave { get; set; }
    public DealerMechanicsSnapshot DealerMechanics { get; init; } = new();
    public List<DealerSnapshot> Dealers { get; set; } = new();
    public List<SupplierSnapshot> Suppliers { get; set; } = new();
    public List<PropertySnapshot> Properties { get; set; } = new();
    public List<BusinessSnapshot> Businesses { get; set; } = new();
    public List<EmployeeTypeSnapshot> EmployeeTypes { get; set; } = new();
    public List<VehicleSnapshot> Vehicles { get; set; } = new();
    public List<RankSnapshot> Ranks { get; set; } = new();
}

internal sealed class DealerSnapshot
{
    public string PersonId { get; init; } = string.Empty;
    public string InstanceKey { get; init; } = string.Empty;
    public int RuntimeInstanceId { get; init; }
    public string ObjectPath { get; init; } = string.Empty;
    public string DealerType { get; init; } = string.Empty;
    public string HomeName { get; init; } = string.Empty;
    public float SalesCutPercentage { get; init; }
    public float SigningFee { get; init; }
    public float WalkSpeed { get; init; }
    public int NegativeQualityTolerance { get; init; }
    public int PositiveQualityTolerance { get; init; }
}

internal sealed class DealerMechanicsSnapshot
{
    public int MaximumCustomers { get; init; }
    public int DealArrivalDelay { get; init; }
    public int MinimumTravelTime { get; init; }
    public int MaximumTravelTime { get; init; }
    public int OverflowSlotCount { get; init; }
    public float CashReminderThreshold { get; init; }
    public float RelationshipChangePerDeal { get; init; }
}

internal sealed class SupplierSnapshot
{
    public string PersonId { get; init; } = string.Empty;
    public float MinimumDeadDropOrderLimit { get; init; }
    public float MaximumDeadDropOrderLimit { get; init; }
    public float DeliveryRelationshipRequirement { get; init; }
    public float MeetupRelationshipRequirement { get; init; }
    public int DeadDropItemLimit { get; init; }
    public int DeadDropWaitPerItem { get; init; }
    public int DeadDropMaximumWait { get; init; }
    public int MeetupDuration { get; init; }
    public int MeetupCooldown { get; init; }
    public float MeetingEndDistance { get; init; }
    public List<SupplierDeliveryListingSnapshot> DeliveryListings { get; init; } = new();
    public List<SupplierItemSnapshot> CurrentDeadDropItemsInLoadedSave { get; init; } = new();
}

internal sealed class SupplierDeliveryListingSnapshot
{
    public string ItemId { get; init; } = string.Empty;
    public float Price { get; init; }
}

internal sealed class SupplierItemSnapshot
{
    public string ItemId { get; init; } = string.Empty;
    public int Quantity { get; init; }
}

internal sealed class PropertySnapshot
{
    public string Code { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public float Price { get; init; }
    public int EmployeeCapacity { get; init; }
    public int LoadingDockCount { get; init; }
    public int GridCount { get; init; }
    public float AmbientTemperature { get; init; }
    public bool OwnedByDefault { get; init; }
    public bool IsBusiness { get; init; }
    public VectorSnapshot? Position { get; init; }
}

internal sealed class BusinessSnapshot
{
    public string PropertyCode { get; init; } = string.Empty;
    public float LaunderCapacity { get; init; }
    public int? MinimumLaunderAmount { get; init; }
}

internal sealed class EmployeeTypeSnapshot
{
    public string Type { get; init; } = string.Empty;
    public string RuntimeType { get; init; } = string.Empty;
    public float DailyWage { get; init; }
    public float BaseWorkSpeed { get; init; }
    public float WalkSpeed { get; init; }
    public int InventorySlotCount { get; init; }
    public Dictionary<string, string> Mechanics { get; init; } = new();
}

internal sealed class VehicleSnapshot
{
    public string Code { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public float Price { get; init; }
    public float TopSpeed { get; init; }
    public int StorageCapacity { get; init; }
}

internal sealed class RankSnapshot
{
    public string Rank { get; init; } = string.Empty;
    public int Tier { get; init; }
    public int TotalXpRequired { get; init; }
    public float OrderLimitMultiplier { get; init; }
}

internal sealed class VectorSnapshot
{
    public float X { get; init; }
    public float Y { get; init; }
    public float Z { get; init; }

    internal static VectorSnapshot? FromTransform(Transform? transform)
    {
        if (transform is null)
        {
            return null;
        }

        var position = transform.position;
        return new VectorSnapshot { X = position.x, Y = position.y, Z = position.z };
    }
}

internal sealed class ShopSnapshot
{
    public int Index { get; init; }
    public string Code { get; init; } = string.Empty;
    public List<ShopListingSnapshot> Listings { get; set; } = new();
}

internal sealed class ShopListingSnapshot
{
    public string ItemId { get; init; } = string.Empty;
    public float ResolvedPrice { get; init; }
    public bool OverridePrice { get; init; }
    public float OverriddenPrice { get; init; }
    public bool LimitedStock { get; init; }
    public int DefaultStock { get; init; }
    public bool CanBeDelivered { get; init; }

}
