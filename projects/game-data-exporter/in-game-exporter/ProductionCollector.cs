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
    private static List<SeedSnapshot> CollectSeeds(
        IEnumerable<Il2CppScheduleOne.ItemFramework.ItemDefinition> items)
    {
        var result = new List<SeedSnapshot>();

        foreach (var item in items)
        {
            var seed = item.TryCast<Il2CppScheduleOne.Growing.SeedDefinition>();
            if (seed is null)
            {
                continue;
            }

            var plant = seed.PlantPrefab;
            var harvestables = new List<HarvestSnapshot>();
            var harvestKeys = new HashSet<string>(StringComparer.Ordinal);
            void AddHarvest(Il2CppScheduleOne.Growing.PlantHarvestable? harvestable)
            {
                if (harvestable?.Product is null)
                {
                    return;
                }

                var key = $"{harvestable.Product.ID}\u001f{harvestable.ProductQuantity}";
                if (harvestKeys.Add(key))
                {
                    harvestables.Add(new HarvestSnapshot
                    {
                        ProductId = harvestable.Product.ID,
                        Quantity = harvestable.ProductQuantity,
                    });
                }
            }

            if (plant?._harvestables is not null)
            {
                for (var index = 0; index < plant._harvestables.Count; index++)
                {
                    AddHarvest(plant._harvestables[index]);
                }
            }

            AddHarvest(plant?.TryCast<Il2CppScheduleOne.Growing.CocaPlant>()?.Harvestable);
            AddHarvest(plant?.TryCast<Il2CppScheduleOne.Growing.WeedPlant>()?.BranchPrefab);

            result.Add(new SeedSnapshot
            {
                ItemId = seed.ID,
                PlantRuntimeType = plant?.GetType().FullName ?? string.Empty,
                GrowthTime = plant?.GrowthTime ?? 0,
                BaseYieldQuantity = plant?.BaseYieldQuantity ?? 0,
                HarvestTarget = plant?.HarvestTarget ?? string.Empty,
                Harvestables = harvestables
                    .OrderBy(harvest => harvest.ProductId, StringComparer.Ordinal)
                    .ThenBy(harvest => harvest.Quantity)
                    .ToList(),
            });
        }

        return result.OrderBy(seed => seed.ItemId, StringComparer.Ordinal).ToList();
    }

    private static List<ShroomSpawnSnapshot> CollectShroomSpawns(
        IEnumerable<Il2CppScheduleOne.ItemFramework.ItemDefinition> items)
    {
        var result = new List<ShroomSpawnSnapshot>();

        foreach (var item in items)
        {
            var spawn = item.TryCast<Il2CppScheduleOne.ItemFramework.ShroomSpawnDefinition>();
            if (spawn is null)
            {
                continue;
            }

            result.Add(new ShroomSpawnSnapshot
            {
                ItemId = spawn.ID,
                ProductId = spawn.Shroom?.ID ?? string.Empty,
                GrowTime = spawn.ColonyPrefab?._growTime ?? 0,
                BaseYieldQuantity = spawn.ColonyPrefab?.BaseShroomYield ?? 0,
                MaximumTemperatureForGrowth =
                    Il2CppScheduleOne.Growing.ShroomColony.MaxTemperatureForGrowth,
                MinimumSoilMoistureForGrowth =
                    Il2CppScheduleOne.Growing.ShroomColony.MinSoilMoistureForGrowth,
            });
        }

        return result.OrderBy(spawn => spawn.ItemId, StringComparer.Ordinal).ToList();
    }

    private static List<PackagingSnapshot> CollectPackaging(
        IEnumerable<Il2CppScheduleOne.ItemFramework.ItemDefinition> items)
    {
        var result = new List<PackagingSnapshot>();

        foreach (var item in items)
        {
            var packaging = item.TryCast<Il2CppScheduleOne.Product.Packaging.PackagingDefinition>();
            if (packaging is null)
            {
                continue;
            }

            result.Add(new PackagingSnapshot
            {
                ItemId = packaging.ID,
                Quantity = packaging.Quantity,
                BasePurchasePrice = packaging.BasePurchasePrice,
            });
        }

        return result.OrderBy(packaging => packaging.ItemId, StringComparer.Ordinal).ToList();
    }

    private static List<AdditiveSnapshot> CollectAdditives(
        IEnumerable<Il2CppScheduleOne.ItemFramework.ItemDefinition> items)
    {
        var result = new List<AdditiveSnapshot>();
        foreach (var item in items)
        {
            var additive = item.TryCast<Il2CppScheduleOne.ItemFramework.AdditiveDefinition>();
            if (additive is null)
            {
                continue;
            }

            result.Add(new AdditiveSnapshot
            {
                ItemId = additive.ID,
                QualityChange = additive.QualityChange,
                YieldMultiplier = additive.YieldMultiplier,
                InstantGrowth = additive.InstantGrowth,
            });
        }

        return result.OrderBy(additive => additive.ItemId, StringComparer.Ordinal).ToList();
    }

    private static List<SoilSnapshot> CollectSoils(
        IEnumerable<Il2CppScheduleOne.ItemFramework.ItemDefinition> items)
    {
        var result = new List<SoilSnapshot>();
        foreach (var item in items)
        {
            var soil = item.TryCast<Il2CppScheduleOne.ItemFramework.SoilDefinition>();
            if (soil is null)
            {
                continue;
            }

            result.Add(new SoilSnapshot
            {
                ItemId = soil.ID,
                Quality = soil.SoilQuality.ToString(),
                Uses = soil.Uses,
            });
        }

        return result.OrderBy(soil => soil.ItemId, StringComparer.Ordinal).ToList();
    }

    private static OvenTransformCollection CollectOvenTransforms(
        IEnumerable<Il2CppScheduleOne.ItemFramework.ItemDefinition> items)
    {
        var result = new List<OvenTransformSnapshot>();
        var keys = new HashSet<string>(StringComparer.Ordinal);
        var sources = new OvenTransformSourceSnapshot();

        foreach (var item in items)
        {
            var storable = item.TryCast<Il2CppScheduleOne.ItemFramework.StorableItemDefinition>();
            if (storable is null)
            {
                continue;
            }

            sources.StorableDefinitionCount++;
            var stationItem = storable.StationItem;
            if (stationItem is null)
            {
                continue;
            }

            sources.StationItemCount++;
            if (stationItem.Modules is null)
            {
                continue;
            }

            for (var moduleIndex = 0; moduleIndex < stationItem.Modules.Count; moduleIndex++)
            {
                var module = stationItem.Modules[moduleIndex];
                if (module is null)
                {
                    continue;
                }

                sources.ModuleCount++;
                var cookable = module.TryCast<
                    Il2CppScheduleOne.StationFramework.CookableModule>();
                if (cookable?.Product is null)
                {
                    continue;
                }

                sources.CookableModuleCount++;
                var key = string.Join(
                    "\u001f",
                    item.ID,
                    cookable.CookType.ToString(),
                    cookable.CookTime.ToString(CultureInfo.InvariantCulture),
                    cookable.Product.ID,
                    cookable.ProductQuantity.ToString(CultureInfo.InvariantCulture));
                if (!keys.Add(key))
                {
                    continue;
                }

                result.Add(new OvenTransformSnapshot
                {
                    InputItemId = item.ID,
                    CookType = cookable.CookType.ToString(),
                    CookTime = cookable.CookTime,
                    OutputItemId = cookable.Product.ID,
                    OutputQuantity = cookable.ProductQuantity,
                });
            }
        }

        sources.UniqueTransformCount = result.Count;
        return new OvenTransformCollection
        {
            Sources = sources,
            Transforms = result
                .OrderBy(transform => transform.InputItemId, StringComparer.Ordinal)
                .ThenBy(transform => transform.OutputItemId, StringComparer.Ordinal)
                .ToList(),
        };
    }

    // Native Awake and InitializeGridItem methods create the transit slots. The registry's
    // buildable prefabs have not initialized those lists, so this versioned topology is explicit.
    private static List<ProductionStationSnapshot> CollectProductionStations(
        IEnumerable<Il2CppScheduleOne.ItemFramework.ItemDefinition> items)
    {
        var result = new List<ProductionStationSnapshot>();
        foreach (var item in items)
        {
            var buildable = item.TryCast<Il2CppScheduleOne.ItemFramework.BuildableItemDefinition>();
            var built = buildable?.BuiltItem;
            if (built is null)
            {
                continue;
            }

            var station = new ProductionStationSnapshot { ItemId = item.ID };

            var packagingStation = built.GetComponent<
                Il2CppScheduleOne.ObjectScripts.PackagingStation>();
            if (packagingStation is not null)
            {
                station.Kind = packagingStation.TryCast<
                        Il2CppScheduleOne.Packaging.PackagingStationMk2>() is null
                    ? "packaging"
                    : "packaging-mk2";
                station.EmployeeSpeedMultiplier =
                    packagingStation.PackagerEmployeeSpeedMultiplier;
                SetTransitTopology(
                    station,
                    2,
                    1,
                    new[]
                    {
                        CategoryFilter(0, "Packaging"),
                        TypeFilter(1, "ItemFilter_UnpackagedProduct"),
                    },
                    new[] { TypeFilter(0, "ItemFilter_PackagedProduct") });
                result.Add(station);
                continue;
            }

            var dryingRack = built.GetComponent<Il2CppScheduleOne.ObjectScripts.DryingRack>();
            if (dryingRack is not null)
            {
                station.Kind = "drying-rack";
                station.Capacity = dryingRack.ItemCapacity;
                station.MaxProcessMultiplier =
                    Il2CppScheduleOne.ObjectScripts.DryingRack.MAX_DRY_MULTIPLIER;
                station.ProcessMinutesPerTier =
                    Il2CppScheduleOne.ObjectScripts.DryingRack.DRY_MINS_PER_TIER;
                station.MinimumTemperatureThreshold =
                    Il2CppScheduleOne.ObjectScripts.DryingRack.WARMTH_MIN_THRESHOLD;
                station.MaximumTemperatureThreshold =
                    Il2CppScheduleOne.ObjectScripts.DryingRack.WARMTH_MAX_THRESHOLD;
                SetTransitTopology(
                    station,
                    1,
                    1,
                    new[] { TypeFilter(0, "ItemFilter_Dryable") });
                result.Add(station);
                continue;
            }

            var brickPress = built.GetComponent<Il2CppScheduleOne.ObjectScripts.BrickPress>();
            if (brickPress is not null)
            {
                station.Kind = "brick-press";
                station.ProductSlotCount = 2;
                station.PackagingItemId = brickPress.BrickPackaging?.ID ?? string.Empty;
                station.PackagingQuantity = brickPress.BrickPackaging?.Quantity;
                SetTransitTopology(
                    station,
                    2,
                    1,
                    new[]
                    {
                        TypeFilter(0, "ItemFilter_UnpackagedProduct"),
                        TypeFilter(1, "ItemFilter_UnpackagedProduct"),
                    });
                result.Add(station);
                continue;
            }

            var mixingStation = built.GetComponent<
                Il2CppScheduleOne.ObjectScripts.MixingStation>();
            if (mixingStation is not null)
            {
                station.Kind = mixingStation.TryCast<
                        Il2CppScheduleOne.ObjectScripts.MixingStationMk2>() is null
                    ? "mixing"
                    : "mixing-mk2";
                station.Capacity = mixingStation.MaxMixQuantity;
                station.TimePerItem = mixingStation.MixTimePerItem;
                station.RequiresManualIngredientInsertion =
                    mixingStation.RequiresIngredientInsertion;
                SetTransitTopology(
                    station,
                    2,
                    1,
                    new[]
                    {
                        TypeFilter(0, "ItemFilter_UnpackagedProduct"),
                        TypeFilter(1, "ItemFilter_MixingIngredient"),
                    });
                result.Add(station);
                continue;
            }

            var labOven = built.GetComponent<Il2CppScheduleOne.ObjectScripts.LabOven>();
            if (labOven is not null)
            {
                station.Kind = "lab-oven";
                SetTransitTopology(station, 1, 1);
                result.Add(station);
                continue;
            }

            var sprinkler = built.GetComponent<Il2CppScheduleOne.ObjectScripts.Sprinkler>();
            if (sprinkler is not null)
            {
                station.Kind = "sprinkler";
                station.ApplyDelay = sprinkler.ApplyWaterDelay;
                station.Cooldown = sprinkler.Cooldown;
                station.MinimumTargetCount = sprinkler.MinTilesToWater;
                result.Add(station);
                continue;
            }

            var cauldron = built.TryCast<Il2CppScheduleOne.ObjectScripts.Cauldron>()
                ?? built.GetComponent<Il2CppScheduleOne.ObjectScripts.Cauldron>();
            if (cauldron is not null)
            {
                station.Kind = "cauldron";
                station.CookTime = cauldron.CookTime;
                station.RequiredPrimaryInputQuantity =
                    Il2CppScheduleOne.ObjectScripts.Cauldron.COCA_LEAF_REQUIRED;
                station.PrimaryInputPrefabName = cauldron.CocaLeafPrefab?.name ?? string.Empty;
                station.SecondaryInputPrefabName = cauldron.GasolinePrefab?.name ?? string.Empty;
                station.PrimaryInputItemId = ResolveStationItemId(
                    items,
                    cauldron.CocaLeafPrefab);
                station.SecondaryInputItemId = ResolveStationItemId(
                    items,
                    cauldron.GasolinePrefab);
                station.OutputItemId = cauldron.CocaineBaseDefinition?.ID ?? string.Empty;
                SetTransitTopology(
                    station,
                    5,
                    1,
                    new[]
                    {
                        IdFilter(0, station.PrimaryInputItemId),
                        IdFilter(1, station.PrimaryInputItemId),
                        IdFilter(2, station.PrimaryInputItemId),
                        IdFilter(3, station.PrimaryInputItemId),
                        IdFilter(4, station.SecondaryInputItemId),
                    });
                result.Add(station);
                continue;
            }

            var spawnStation = built.TryCast<
                    Il2CppScheduleOne.StationFramework.MushroomSpawnStation>()
                ?? built.GetComponent<
                    Il2CppScheduleOne.StationFramework.MushroomSpawnStation>();
            if (spawnStation is not null)
            {
                station.Kind = "mushroom-spawn";
                station.GrainBagItemId = spawnStation._grainBagDefinition?.ID ?? string.Empty;
                if (spawnStation._validSporeSyringeDefinitions is not null)
                {
                    for (var index = 0;
                         index < spawnStation._validSporeSyringeDefinitions.Length;
                         index++)
                    {
                        var syringe = spawnStation._validSporeSyringeDefinitions[index];
                        if (syringe is null)
                        {
                            continue;
                        }

                        station.SporeSyringes.Add(new SporeSyringeSnapshot
                        {
                            ItemId = syringe.ID,
                            OutputSpawnItemId = syringe.SpawnDefinition?.ID ?? string.Empty,
                        });
                    }
                }

                SetTransitTopology(
                    station,
                    2,
                    1,
                    new[]
                    {
                        IdFilter(0, station.GrainBagItemId),
                        IdFilter(1, station.SporeSyringes.Select(syringe => syringe.ItemId)),
                    });

                result.Add(station);
                continue;
            }

            var pot = built.TryCast<Il2CppScheduleOne.ObjectScripts.Pot>()
                ?? built.GetComponent<Il2CppScheduleOne.ObjectScripts.Pot>();
            if (pot is not null)
            {
                station.Kind = "grow-container";
                station.YieldMultiplier = pot.YieldMultiplier;
                station.GrowSpeedMultiplier = pot.GrowSpeedMultiplier;
                station.MaxTemperatureGrowthMultiplier =
                    Il2CppScheduleOne.ObjectScripts.Pot.MaxWarmthGrowthMultiplier;
                station.MinimumTemperatureThreshold =
                    Il2CppScheduleOne.ObjectScripts.Pot.WarmthMinThreshold;
                station.MaximumTemperatureThreshold =
                    Il2CppScheduleOne.ObjectScripts.Pot.WarmthMaxThreshold;
                station.AllowedSoilIds = CopyIds(pot.AllowedSoils);
                station.AllowedAdditiveIds = CopyIds(pot.AllowedAdditives);
                SetTransitTopology(station, 0, 1);
                result.Add(station);
                continue;
            }

            var growLight = built.TryCast<Il2CppScheduleOne.ObjectScripts.GrowLight>()
                ?? built.GetComponent<Il2CppScheduleOne.ObjectScripts.GrowLight>();
            if (growLight?.usableLightSource is not null)
            {
                station.Kind = "grow-light";
                station.GrowSpeedMultiplier = growLight.usableLightSource.GrowSpeedMultiplier;
                result.Add(station);
            }
        }

        return result.OrderBy(station => station.ItemId, StringComparer.Ordinal).ToList();
    }

    // These current-version values come from the native route and employee behavior methods.
    private static ProductionLogisticsSnapshot CollectProductionLogistics() => new()
    {
        HandlerRouteLimit = 5,
        RouteSelection = "stored-order-first-ready",
        RouteFilterModes = new List<string> { "whitelist", "blacklist" },
        MovedQuantityLimits = new List<string>
        {
            "source-quantity",
            "requested-maximum",
            "destination-input-capacity",
        },
        AccessPointSelection = "npc-reachable",
        HandlerTaskPriority = new List<string>
        {
            "packaging-station-work",
            "brick-press-work",
            "packaging-station-supply-move",
            "brick-press-supply-move",
            "configured-transit-route",
        },
        EmployeeScheduling = new EmployeeSchedulingSnapshot
        {
            DispatchAuthority = "server",
            DispatchPrerequisite = "can-work-and-no-active-behaviour",
            TaskSelection = "first-ready-in-native-priority-order",
            TaskReadiness = "native-mutable-runtime-state-not-recorded",
            WorkAvailability = new EmployeeWorkAvailabilitySnapshot
            {
                EmployeeHome = "required",
                DailyPayment = "paid-for-today-required-auto-from-employee-home-cash",
                ShiftSchedule = "no-fixed-shift",
                EndOfDayTime = 400,
                ConsumeProduct = "blocks-work",
            },
            Movement = new EmployeeMovementSnapshot
            {
                TaskOrigin = "current-npc-position",
                CompletionPosition = "task-endpoint-until-subsequent-behaviour",
                TaskChaining = "each-selected-task-starts-from-then-current-npc-position",
                GrowContainerItemSource = "employee-inventory-otherwise-assigned-supplies",
                GrowContainerTaskKinds = new List<string>
                {
                    "grow-container-watering-below-0.2",
                    "mushroom-bed-misting-below-0.2",
                    "grow-container-additive",
                    "grow-container-soil-pour",
                    "pot-sow-seed",
                    "mushroom-bed-apply-spawn",
                    "pot-harvest",
                    "mushroom-bed-harvest",
                    "grow-container-watering-below-0.3",
                    "mushroom-bed-misting-below-0.3",
                },
                GrowContainerTaskLegs = new List<string>
                {
                    "current-to-supplies-if-required-item-missing",
                    "supplies-to-grow-container-if-supplies-visited",
                    "current-to-grow-container-otherwise",
                },
                StationTaskKinds = new List<string>
                {
                    "drying-rack-stop",
                    "mushroom-spawn-station-work",
                    "lab-oven-finish",
                    "lab-oven-start",
                    "chemistry-station-start",
                    "cauldron-start",
                    "mixing-station-start",
                },
                StationTaskLegs = new List<string>
                {
                    "current-to-station-access-point",
                },
                MoveItemTaskKinds = new List<string>
                {
                    "drying-rack-output-move",
                    "mushroom-spawn-station-output-move",
                    "drying-rack-input-move",
                    "lab-oven-output-move",
                    "chemistry-station-output-move",
                    "cauldron-output-move",
                    "mixing-station-output-move",
                },
                MoveItemTaskLegs = new List<string>
                {
                    "current-to-source-access-point",
                    "source-to-destination-access-point",
                },
                LegFrequency = "once-per-selected-task-activation-if-not-already-at-endpoint",
            },
            BotanistTaskPriority = new List<string>
            {
                "grow-container-watering-below-0.2",
                "mushroom-bed-misting-below-0.2",
                "grow-container-additive",
                "grow-container-soil-pour",
                "pot-sow-seed",
                "mushroom-bed-apply-spawn",
                "pot-harvest",
                "mushroom-bed-harvest",
                "drying-rack-stop",
                "drying-rack-output-move",
                "mushroom-spawn-station-work",
                "mushroom-spawn-station-output-move",
                "grow-container-watering-below-0.3",
                "mushroom-bed-misting-below-0.3",
                "drying-rack-input-move",
            },
            ChemistTaskPriority = new List<string>
            {
                "lab-oven-finish",
                "lab-oven-start",
                "chemistry-station-start",
                "cauldron-start",
                "mixing-station-start",
                "lab-oven-output-move",
                "chemistry-station-output-move",
                "cauldron-output-move",
                "mixing-station-output-move",
            },
        },
        StationMovementEmployeeTypes = new List<string> { "Botanist", "Chemist" },
    };

    private static void SetTransitTopology(
        ProductionStationSnapshot station,
        int inputSlotCount,
        int outputSlotCount,
        IEnumerable<SlotFilterSnapshot>? inputFilters = null,
        IEnumerable<SlotFilterSnapshot>? outputFilters = null)
    {
        station.InputSlotCount = inputSlotCount;
        station.OutputSlotCount = outputSlotCount;
        station.InputFilters = inputFilters?.ToList() ?? new List<SlotFilterSnapshot>();
        station.OutputFilters = outputFilters?.ToList() ?? new List<SlotFilterSnapshot>();
    }

    private static SlotFilterSnapshot TypeFilter(int slotIndex, string filterType) => new()
    {
        SlotIndex = slotIndex,
        FilterType = $"ScheduleOne.ItemFramework.{filterType}",
    };

    private static SlotFilterSnapshot CategoryFilter(int slotIndex, string category) => new()
    {
        SlotIndex = slotIndex,
        FilterType = "ScheduleOne.ItemFramework.ItemFilter_Category",
        Categories = new List<string> { category },
    };

    private static SlotFilterSnapshot IdFilter(int slotIndex, string itemId) =>
        IdFilter(slotIndex, new[] { itemId });

    private static SlotFilterSnapshot IdFilter(
        int slotIndex,
        IEnumerable<string> itemIds) => new()
    {
        SlotIndex = slotIndex,
        FilterType = "ScheduleOne.ItemFramework.ItemFilter_ID",
        IsWhitelist = true,
        ItemIds = itemIds
            .Where(itemId => !string.IsNullOrWhiteSpace(itemId))
            .Distinct(StringComparer.Ordinal)
            .OrderBy(itemId => itemId, StringComparer.Ordinal)
            .ToList(),
    };

    private static string ResolveStationItemId(
        IEnumerable<Il2CppScheduleOne.ItemFramework.ItemDefinition> items,
        Il2CppScheduleOne.StationFramework.StationItem? stationItem)
    {
        if (stationItem is null)
        {
            return string.Empty;
        }

        foreach (var item in items)
        {
            var candidate = item.TryCast<
                Il2CppScheduleOne.ItemFramework.StorableItemDefinition>()?.StationItem;
            if (candidate is not null &&
                candidate.GetInstanceID() == stationItem.GetInstanceID())
            {
                return item.ID;
            }
        }

        static string Normalize(string value)
        {
            var normalized = string.Concat(value
                .Where(char.IsLetterOrDigit)
                .Select(char.ToLowerInvariant));
            foreach (var suffix in new[] { "stationitem", "prefab", "clone" })
            {
                if (normalized.EndsWith(suffix, StringComparison.Ordinal))
                {
                    normalized = normalized[..^suffix.Length];
                }
            }
            return normalized;
        }

        var stationName = Normalize(stationItem.name ?? string.Empty);
        if (stationName.Length > 0)
        {
            foreach (var item in items)
            {
                if (Normalize(item.ID) == stationName ||
                    Normalize(item.Name ?? string.Empty) == stationName)
                {
                    return item.ID;
                }
            }
        }

        return string.Empty;
    }

    private static List<string> CopyIds<T>(
        Il2CppInterop.Runtime.InteropTypes.Arrays.Il2CppReferenceArray<T>? source)
        where T : Il2CppScheduleOne.ItemFramework.ItemDefinition
    {
        var result = new List<string>();
        if (source is null)
        {
            return result;
        }

        for (var index = 0; index < source.Length; index++)
        {
            var item = source[index];
            if (item is not null && !string.IsNullOrWhiteSpace(item.ID))
            {
                result.Add(item.ID);
            }
        }

        return result.OrderBy(id => id, StringComparer.Ordinal).ToList();
    }

    private static List<QualityValueSnapshot> CollectQualityValues(
        IEnumerable<Il2CppScheduleOne.Product.ProductDefinition> products)
    {
        var result = new List<QualityValueSnapshot>();
        foreach (var product in products)
        {
            foreach (var quality in Enum.GetValues<Il2CppScheduleOne.ItemFramework.EQuality>())
            {
                var instance = product.GetDefaultInstance(1)
                    .TryCast<Il2CppScheduleOne.Product.ProductItemInstance>();
                if (instance is null)
                {
                    continue;
                }

                instance.SetQuality(quality);
                result.Add(new QualityValueSnapshot
                {
                    ProductId = product.ID,
                    Quality = quality.ToString(),
                    MonetaryValue = instance.GetMonetaryValue(),
                });
            }
        }

        return result;
    }

    private static QualityMechanicsSnapshot CollectQualityMechanics(
        IReadOnlyList<QualityValueSnapshot> monetaryValues)
    {
        var result = new QualityMechanicsSnapshot
        {
            CustomerQualityMaxEffect = Il2CppScheduleOne.Economy.Customer.QUALITY_MAX_EFFECT,
            CustomerPropertyMaxEffect = Il2CppScheduleOne.Economy.Customer.PROPERTY_MAX_EFFECT,
            MinimumOrderAppeal = Il2CppScheduleOne.Economy.Customer.MIN_ORDER_APPEAL,
            MonetaryValueVariesByQuality = monetaryValues
                .GroupBy(value => value.ProductId, StringComparer.Ordinal)
                .Any(group => group.Select(value => value.MonetaryValue).Distinct().Count() > 1),
        };

        foreach (var quality in Enum.GetValues<Il2CppScheduleOne.ItemFramework.EQuality>())
        {
            result.QualityScalars.Add(new QualityScalarSnapshot
            {
                Quality = quality.ToString(),
                Scalar = Il2CppScheduleOne.Economy.CustomerData.GetQualityScalar(quality),
            });
        }

        return result;
    }

}
