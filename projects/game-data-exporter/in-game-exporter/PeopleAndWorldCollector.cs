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
    private static PeopleCollection CollectPeople(
        IReadOnlyList<Il2CppScheduleOne.Product.ProductDefinition> products)
    {
        _ = Il2CppScheduleOne.NPCs.NPCManager.Instance
            ?? throw new InvalidOperationException("NPCManager.Instance is unavailable after load.");
        var registry = Il2CppScheduleOne.NPCs.NPCManager.NPCRegistry
            ?? throw new InvalidOperationException("NPCManager.NPCRegistry is unavailable after load.");

        var result = new PeopleCollection
        {
            CustomerConstants = CustomerConstantsSnapshot.FromGame(),
        };
        result.Sources.NpcRegistryCount = registry.Count;

        var customersByNpcId = new Dictionary<string, Il2CppScheduleOne.Economy.Customer>(
            StringComparer.Ordinal);

        void AddCustomers(
            Il2CppSystem.Collections.Generic.List<Il2CppScheduleOne.Economy.Customer>? customers,
            bool unlocked)
        {
            if (customers is null)
            {
                return;
            }

            if (unlocked)
            {
                result.Sources.UnlockedCustomerCount = customers.Count;
            }
            else
            {
                result.Sources.LockedCustomerCount = customers.Count;
            }

            for (var index = 0; index < customers.Count; index++)
            {
                var customer = customers[index];
                var npcId = customer?.NPC?.ID;
                if (customer is not null && !string.IsNullOrWhiteSpace(npcId))
                {
                    customersByNpcId[npcId] = customer;
                }
            }
        }

        AddCustomers(Il2CppScheduleOne.Economy.Customer.LockedCustomers, unlocked: false);
        AddCustomers(Il2CppScheduleOne.Economy.Customer.UnlockedCustomers, unlocked: true);

        var directedConnections = new HashSet<string>(StringComparer.Ordinal);
        for (var npcIndex = 0; npcIndex < registry.Count; npcIndex++)
        {
            var npc = registry[npcIndex];
            if (npc is null || string.IsNullOrWhiteSpace(npc.ID))
            {
                continue;
            }

            customersByNpcId.TryGetValue(npc.ID, out var customer);
            customer ??= npc.GetComponent<Il2CppScheduleOne.Economy.Customer>();
            if (customer is not null)
            {
                customersByNpcId[npc.ID] = customer;
            }

            var roles = new List<string>();
            if (customer is not null)
            {
                roles.Add("customer");
            }

            if (npc.GetComponent<Il2CppScheduleOne.Economy.Dealer>() is not null)
            {
                roles.Add("dealer");
            }

            if (npc.GetComponent<Il2CppScheduleOne.Economy.Supplier>() is not null)
            {
                roles.Add("supplier");
            }

            var relation = npc.RelationData;
            var definitionRelationship = npc.NPCData?.Relationship;
            result.People.Add(new PersonSnapshot
            {
                Id = npc.ID,
                FirstName = npc.FirstName ?? string.Empty,
                LastName = npc.LastName ?? string.Empty,
                FullName = npc.FullName ?? string.Empty,
                Region = npc.Region.ToString(),
                Roles = roles.OrderBy(role => role, StringComparer.Ordinal).ToList(),
                DefaultRelationship = definitionRelationship?.DefaultRelationshipValue,
                DisplayRelationship = definitionRelationship?.DisplayRelationshipValue,
                RelationshipInLoadedSave = relation?.RelationDelta,
                UnlockedInLoadedSave = relation?.Unlocked,
                UnlockTypeInLoadedSave = relation?.UnlockType.ToString(),
            });

            if (relation?.Connections is null)
            {
                continue;
            }

            for (var connectionIndex = 0;
                 connectionIndex < relation.Connections.Count;
                 connectionIndex++)
            {
                var connectedNpc = relation.Connections[connectionIndex];
                if (connectedNpc is null ||
                    string.IsNullOrWhiteSpace(connectedNpc.ID) ||
                    string.Equals(npc.ID, connectedNpc.ID, StringComparison.Ordinal))
                {
                    continue;
                }

                directedConnections.Add(npc.ID + "\u001f" + connectedNpc.ID);
            }
        }

        foreach (var pair in directedConnections)
        {
            var separatorIndex = pair.IndexOf('\u001f');
            var sourceId = pair[..separatorIndex];
            var targetId = pair[(separatorIndex + 1)..];
            if (string.CompareOrdinal(sourceId, targetId) > 0)
            {
                continue;
            }

            result.RelationshipEdges.Add(new RelationshipEdgeSnapshot
            {
                SourceId = sourceId,
                TargetId = targetId,
                Bidirectional = directedConnections.Contains(targetId + "\u001f" + sourceId),
            });
        }

        foreach (var entry in customersByNpcId.OrderBy(entry => entry.Key, StringComparer.Ordinal))
        {
            var customer = entry.Value;
            var data = customer.CustomerData;
            if (data is null)
            {
                continue;
            }

            var preferredEffectIds = new List<string>();
            if (data.PreferredProperties is not null)
            {
                for (var effectIndex = 0;
                     effectIndex < data.PreferredProperties.Count;
                     effectIndex++)
                {
                    var effect = data.PreferredProperties[effectIndex];
                    if (effect is not null && !string.IsNullOrWhiteSpace(effect.ID))
                    {
                        preferredEffectIds.Add(effect.ID);
                    }
                }
            }

            var affinities = new List<DrugAffinitySnapshot>();
            var productAffinities = data.DefaultAffinityData?.ProductAffinities;
            if (productAffinities is not null)
            {
                for (var affinityIndex = 0;
                     affinityIndex < productAffinities.Count;
                     affinityIndex++)
                {
                    var affinity = productAffinities[affinityIndex];
                    if (affinity is null)
                    {
                        continue;
                    }

                    affinities.Add(new DrugAffinitySnapshot
                    {
                        DrugType = affinity.DrugType.ToString(),
                        Affinity = affinity.Affinity,
                    });
                }
            }
            var currentAffinities = new List<DrugAffinitySnapshot>();
            var currentAffinityData = customer.currentAffinityData;
            var currentProductAffinities = currentAffinityData?.ProductAffinities;
            if (currentProductAffinities is not null)
            {
                for (var affinityIndex = 0;
                     affinityIndex < currentProductAffinities.Count;
                     affinityIndex++)
                {
                    var affinity = currentProductAffinities[affinityIndex];
                    if (affinity is null)
                    {
                        continue;
                    }

                    currentAffinities.Add(new DrugAffinitySnapshot
                    {
                        DrugType = affinity.DrugType.ToString(),
                        Affinity = affinity.Affinity,
                    });
                }
            }

            var customerSnapshot = new CustomerSnapshot
            {
                PersonId = entry.Key,
                Standards = data.Standards.ToString(),
                PreferredEffectIds = preferredEffectIds
                    .OrderBy(id => id, StringComparer.Ordinal)
                    .ToList(),
                DrugAffinities = affinities
                    .OrderBy(affinity => affinity.DrugType, StringComparer.Ordinal)
                    .ToList(),
                CurrentDrugAffinitiesInLoadedSave = currentAffinities
                    .OrderBy(affinity => affinity.DrugType, StringComparer.Ordinal)
                    .ToList(),
                BaseAddiction = data.BaseAddiction,
                CurrentAddictionInLoadedSave = customer.CurrentAddiction,
                DependenceMultiplier = data.DependenceMultiplier,
                CallPoliceChance = data.CallPoliceChance,
                CanBeDirectlyApproached = data.CanBeDirectlyApproached,
                GuaranteeFirstSampleSuccess = data.GuaranteeFirstSampleSuccess,
                MinimumWeeklySpend = data.MinWeeklySpend,
                MaximumWeeklySpend = data.MaxWeeklySpend,
                MinimumOrdersPerWeek = data.MinOrdersPerWeek,
                MaximumOrdersPerWeek = data.MaxOrdersPerWeek,
                PreferredOrderDay = data.PreferredOrderDay.ToString(),
                OrderTime = data.OrderTime,
                MinimumMutualRelationshipRequirement = data.MinMutualRelationRequirement,
                MaximumMutualRelationshipRequirement = data.MaxMutualRelationRequirement,
                SampleRequestSuccessChanceInLoadedSave = customer.GetSampleRequestSuccessChance(),
            };
            CollectCustomerProductEvaluations(customer, customerSnapshot, products);
            result.Customers.Add(customerSnapshot);
        }

        result.People = result.People
            .OrderBy(person => person.Id, StringComparer.Ordinal)
            .ToList();
        result.Customers = result.Customers
            .OrderBy(customer => customer.PersonId, StringComparer.Ordinal)
            .ToList();
        result.RelationshipEdges = result.RelationshipEdges
            .OrderBy(edge => edge.SourceId, StringComparer.Ordinal)
            .ThenBy(edge => edge.TargetId, StringComparer.Ordinal)
            .ToList();
        result.Sources.UniquePersonCount = result.People
            .Select(person => person.Id)
            .Distinct(StringComparer.Ordinal)
            .Count();
        result.Sources.UniqueCustomerCount = result.Customers.Count;
        result.Sources.DirectedConnectionCount = directedConnections.Count;
        result.Sources.UniqueRelationshipEdgeCount = result.RelationshipEdges.Count;
        return result;
    }

    private static WorldSnapshot CollectWorld()
    {
        var result = new WorldSnapshot
        {
            DealerMechanics = new DealerMechanicsSnapshot
            {
                MaximumCustomers = Il2CppScheduleOne.Economy.Dealer.MAX_CUSTOMERS,
                DealArrivalDelay = Il2CppScheduleOne.Economy.Dealer.DEAL_ARRIVAL_DELAY,
                MinimumTravelTime = Il2CppScheduleOne.Economy.Dealer.MIN_TRAVEL_TIME,
                MaximumTravelTime = Il2CppScheduleOne.Economy.Dealer.MAX_TRAVEL_TIME,
                OverflowSlotCount = Il2CppScheduleOne.Economy.Dealer.OVERFLOW_SLOT_COUNT,
                CashReminderThreshold =
                    Il2CppScheduleOne.Economy.Dealer.CASH_REMINDER_THRESHOLD,
                RelationshipChangePerDeal =
                    Il2CppScheduleOne.Economy.Dealer.RELATIONSHIP_CHANGE_PER_DEAL,
            },
        };

        var npcRegistry = Il2CppScheduleOne.NPCs.NPCManager.NPCRegistry;
        if (npcRegistry is not null)
        {
            for (var npcIndex = 0; npcIndex < npcRegistry.Count; npcIndex++)
            {
                var npc = npcRegistry[npcIndex];
                if (npc is null || string.IsNullOrWhiteSpace(npc.ID))
                {
                    continue;
                }

                var dealer = npc.GetComponent<Il2CppScheduleOne.Economy.Dealer>();
                if (dealer?.DealerData is not null)
                {
                    var movement = npc.Movement
                        ?? throw new InvalidOperationException(
                            $"Dealer {npc.ID} has no NPC movement component.");
                    result.Dealers.Add(new DealerSnapshot
                    {
                        PersonId = npc.ID,
                        InstanceKey = $"{npc.ID}:{DiscoveryReflection.ObjectPath(npc.transform)}",
                        RuntimeInstanceId = npc.GetInstanceID(),
                        ObjectPath = DiscoveryReflection.ObjectPath(npc.transform),
                        DealerType = dealer.DealerData.DealerType.ToString(),
                        HomeName = dealer.DealerData.HomeName ?? string.Empty,
                        SalesCutPercentage = dealer.DealerData.SalesCutPercentage,
                        SigningFee = dealer.DealerData.SigningFee,
                        WalkSpeed = movement.WalkSpeed,
                        NegativeQualityTolerance =
                            Il2CppScheduleOne.Economy.Dealer.NegativeQualityTolerance,
                        PositiveQualityTolerance =
                            Il2CppScheduleOne.Economy.Dealer.PositiveQualityTolerance,
                    });
                }

                var supplier = npc.GetComponent<Il2CppScheduleOne.Economy.Supplier>();
                if (supplier?.SupplierData is not null)
                {
                    var currentDeadDropItems = new List<SupplierItemSnapshot>();
                    if (supplier._deaddropItems is not null)
                    {
                        for (var itemIndex = 0;
                             itemIndex < supplier._deaddropItems.Length;
                             itemIndex++)
                        {
                            var pair = supplier._deaddropItems[itemIndex];
                            if (pair is not null && !string.IsNullOrWhiteSpace(pair.String))
                            {
                                currentDeadDropItems.Add(new SupplierItemSnapshot
                                {
                                    ItemId = pair.String,
                                    Quantity = pair.Int,
                                });
                            }
                        }
                    }

                    var deliveryListings = new List<SupplierDeliveryListingSnapshot>();
                    var nativeDeliveryListings = supplier.SupplierData.DeliveryShopListings;
                    if (nativeDeliveryListings is not null)
                    {
                        for (var listingIndex = 0;
                             listingIndex < nativeDeliveryListings.Count;
                             listingIndex++)
                        {
                            var listing = nativeDeliveryListings[listingIndex];
                            if (listing?.Item is null)
                            {
                                continue;
                            }

                            deliveryListings.Add(new SupplierDeliveryListingSnapshot
                            {
                                ItemId = listing.Item.ID,
                                Price = listing.Price,
                            });
                        }
                    }

                    result.Suppliers.Add(new SupplierSnapshot
                    {
                        PersonId = npc.ID,
                        MinimumDeadDropOrderLimit =
                            supplier.SupplierData.MinimumDeaddropOrderLimit,
                        MaximumDeadDropOrderLimit =
                            supplier.SupplierData.MaximumDeaddropOrderLimit,
                        DeliveryRelationshipRequirement =
                            Il2CppScheduleOne.Economy.Supplier.DeliveryRelationshipRequirement,
                        MeetupRelationshipRequirement =
                            Il2CppScheduleOne.Economy.Supplier.MeetupRelationshipRequirement,
                        DeadDropItemLimit =
                            Il2CppScheduleOne.Economy.Supplier.DeaddropItemLimit,
                        DeadDropWaitPerItem =
                            Il2CppScheduleOne.Economy.Supplier.DeaddropWaitPerItem,
                        DeadDropMaximumWait =
                            Il2CppScheduleOne.Economy.Supplier.DeaddropMaxWait,
                        MeetupDuration = Il2CppScheduleOne.Economy.Supplier.MeetupDuration,
                        MeetupCooldown = Il2CppScheduleOne.Economy.Supplier.MeetupCooldown,
                        MeetingEndDistance =
                            Il2CppScheduleOne.Economy.Supplier.MeetingEndDistance,
                        DeliveryListings = deliveryListings
                            .OrderBy(listing => listing.ItemId, StringComparer.Ordinal)
                            .ToList(),
                        CurrentDeadDropItemsInLoadedSave = currentDeadDropItems
                            .OrderBy(item => item.ItemId, StringComparer.Ordinal)
                            .ToList(),
                    });
                }
            }
        }

        var properties = Il2CppScheduleOne.Property.Property.Properties;
        if (properties is not null)
        {
            for (var index = 0; index < properties.Count; index++)
            {
                var property = properties[index];
                if (property is null || string.IsNullOrWhiteSpace(property.PropertyCode))
                {
                    continue;
                }

                result.Properties.Add(new PropertySnapshot
                {
                    Code = property.PropertyCode,
                    Name = property.PropertyName ?? string.Empty,
                    Price = property.Price,
                    EmployeeCapacity = property.EmployeeCapacity,
                    LoadingDockCount = property.LoadingDockCount,
                    GridCount = property.Grids?.Count ?? 0,
                    AmbientTemperature = property.AmbientTemperature,
                    OwnedByDefault = property.OwnedByDefault,
                    IsBusiness = property.TryCast<Il2CppScheduleOne.Property.Business>() is not null,
                    Position = VectorSnapshot.FromTransform(property.SpawnPoint),
                });
            }
        }

        var businesses = Il2CppScheduleOne.Property.Business.Businesses;
        var launderingInterfaces =
            Resources.FindObjectsOfTypeAll<Il2CppScheduleOne.UI.LaunderingInterface>();
        if (businesses is not null)
        {
            for (var index = 0; index < businesses.Count; index++)
            {
                var business = businesses[index];
                if (business is null || string.IsNullOrWhiteSpace(business.PropertyCode))
                {
                    continue;
                }

                var launderingInterface = launderingInterfaces.FirstOrDefault(candidate =>
                    candidate is not null &&
                    candidate.Business?.PropertyCode == business.PropertyCode);
                result.Businesses.Add(new BusinessSnapshot
                {
                    PropertyCode = business.PropertyCode,
                    LaunderCapacity = business.LaunderCapacity,
                    MinimumLaunderAmount = launderingInterface is null
                        ? null
                        : Il2CppScheduleOne.UI.LaunderingInterface.MinLaunderAmount,
                });
            }
        }

        var employeeManager = Il2CppScheduleOne.Employees.EmployeeManager.Instance;
        if (employeeManager is not null)
        {
            foreach (var employeeType in Enum.GetValues<Il2CppScheduleOne.Employees.EEmployeeType>())
            {
                var prefab = employeeManager.GetEmployeePrefab(employeeType);
                if (prefab is null)
                {
                    continue;
                }

                var mechanics = DiscoveryReflection.ReadMembers(
                    prefab,
                    "MaxAssignedPots",
                    "MAX_ASSIGNED_STATIONS",
                    "MAX_ASSIGNED_BINS",
                    "MaxAssignedStations",
                    "MaxAssignedBins",
                    "MaxAssignedRoutes",
                    "PackagingSpeedMultiplier");
                if (employeeType == Il2CppScheduleOne.Employees.EEmployeeType.Handler)
                {
                    var packager = employeeManager.PackagerPrefab;
                    if (packager is not null)
                    {
                        mechanics["MaxAssignedStations"] =
                            packager.MaxAssignedStations.ToString(CultureInfo.InvariantCulture);
                        mechanics["PackagingSpeedMultiplier"] =
                            packager.PackagingSpeedMultiplier.ToString(
                                "R",
                                CultureInfo.InvariantCulture);
                        mechanics["MaxAssignedRoutes"] = "5";
                    }
                }
                var botanist = prefab.TryCast<Il2CppScheduleOne.Employees.Botanist>();
                if (botanist is not null)
                {
                    mechanics["MaxAssignedPots"] = botanist.MaxAssignedPots.ToString(
                        CultureInfo.InvariantCulture);
                    mechanics["MoistureLevelRandomMax"] =
                        Il2CppScheduleOne.Employees.Botanist.MoistureLevelRandomMax.ToString(
                            "R",
                            CultureInfo.InvariantCulture);
                }
                if (prefab.TryCast<Il2CppScheduleOne.Employees.Chemist>() is not null)
                {
                    mechanics["MaximumAssignedStations"] =
                        Il2CppScheduleOne.Employees.Chemist.MAX_ASSIGNED_STATIONS.ToString(
                            CultureInfo.InvariantCulture);
                }
                if (prefab.TryCast<Il2CppScheduleOne.Employees.Cleaner>() is not null)
                {
                    mechanics["MaximumAssignedBins"] =
                        Il2CppScheduleOne.Employees.Cleaner.MAX_ASSIGNED_BINS.ToString(
                            CultureInfo.InvariantCulture);
                }
                // Registry prefabs have not applied NPCData yet. Read the serialized
                // source used by native initialization instead of the empty runtime field.
                var originalNpcData = prefab._npcData?.GetOriginalData();
                result.EmployeeTypes.Add(new EmployeeTypeSnapshot
                {
                    Type = employeeType.ToString(),
                    RuntimeType = DiscoveryReflection.RuntimeTypeName(prefab),
                    DailyWage = prefab.DailyWage,
                    BaseWorkSpeed = prefab.CurrentWorkSpeed,
                    WalkSpeed = originalNpcData?.Movement?.WalkSpeed ?? 0,
                    InventorySlotCount = originalNpcData?.Inventory?.InventorySlotCount ?? 0,
                    Mechanics = mechanics,
                });
            }
        }

        var vehicleManager = Il2CppScheduleOne.Vehicles.VehicleManager.Instance;
        var vehiclePrefabs = vehicleManager?.VehiclePrefabs;
        if (vehiclePrefabs is not null)
        {
            for (var index = 0; index < vehiclePrefabs.Count; index++)
            {
                var vehicle = vehiclePrefabs[index];
                if (vehicle is null || string.IsNullOrWhiteSpace(vehicle.VehicleCode))
                {
                    continue;
                }

                result.Vehicles.Add(new VehicleSnapshot
                {
                    Code = vehicle.VehicleCode,
                    Name = vehicle.VehicleName ?? string.Empty,
                    Price = vehicle.VehiclePrice,
                    TopSpeed = vehicle.TopSpeed,
                    StorageCapacity = vehicle.Capacity,
                });
            }
        }

        var levelManager = Il2CppScheduleOne.Levelling.LevelManager.Instance;
        if (levelManager is not null)
        {
            result.CurrentOrderLimitMultiplierInLoadedSave =
                Il2CppScheduleOne.Levelling.LevelManager.GetOrderLimitMultiplier(
                    levelManager.GetFullRank());
            foreach (var rank in Enum.GetValues<Il2CppScheduleOne.Levelling.ERank>())
            {
                for (var tier = 1;
                     tier <= Il2CppScheduleOne.Levelling.LevelManager.TIERS_PER_RANK;
                     tier++)
                {
                    var fullRank = new Il2CppScheduleOne.Levelling.FullRank(rank, tier);
                    result.Ranks.Add(new RankSnapshot
                    {
                        Rank = rank.ToString(),
                        Tier = tier,
                        TotalXpRequired = levelManager.GetTotalXPForRank(fullRank),
                        OrderLimitMultiplier =
                            Il2CppScheduleOne.Levelling.LevelManager
                                .GetOrderLimitMultiplier(fullRank),
                    });
                }
            }
        }

        result.Dealers = result.Dealers
            .OrderBy(x => x.PersonId, StringComparer.Ordinal)
            .ThenBy(x => x.InstanceKey, StringComparer.Ordinal)
            .ToList();
        result.Suppliers = result.Suppliers.OrderBy(x => x.PersonId, StringComparer.Ordinal).ToList();
        result.Properties = result.Properties.OrderBy(x => x.Code, StringComparer.Ordinal).ToList();
        result.Businesses = result.Businesses.OrderBy(x => x.PropertyCode, StringComparer.Ordinal).ToList();
        result.EmployeeTypes = result.EmployeeTypes.OrderBy(x => x.Type, StringComparer.Ordinal).ToList();
        result.Vehicles = result.Vehicles.OrderBy(x => x.Code, StringComparer.Ordinal).ToList();
        result.Ranks = result.Ranks
            .OrderBy(x => x.TotalXpRequired)
            .ThenBy(x => x.Rank, StringComparer.Ordinal)
            .ThenBy(x => x.Tier)
            .ToList();
        return result;
    }

    private static List<ShopSnapshot> CollectShops()
    {
        var result = new List<ShopSnapshot>();
        var shops = Il2CppScheduleOne.UI.Shop.ShopInterface.AllShops;
        if (shops is null)
        {
            return result;
        }

        for (var shopIndex = 0; shopIndex < shops.Count; shopIndex++)
        {
            var shop = shops[shopIndex];
            if (shop is null)
            {
                continue;
            }

            var snapshot = new ShopSnapshot
            {
                Index = shopIndex,
                Code = shop.ShopCode ?? string.Empty,
            };

            if (shop.Listings is not null)
            {
                for (var listingIndex = 0; listingIndex < shop.Listings.Count; listingIndex++)
                {
                    var listing = shop.Listings[listingIndex];
                    if (listing?.Item is null)
                    {
                        continue;
                    }

                    snapshot.Listings.Add(new ShopListingSnapshot
                    {
                        ItemId = listing.Item.ID,
                        ResolvedPrice = listing.Price,
                        OverridePrice = listing.OverridePrice,
                        OverriddenPrice = listing.OverriddenPrice,
                        LimitedStock = listing.LimitedStock,
                        DefaultStock = listing.DefaultStock,
                        CanBeDelivered = listing.CanBeDelivered,
                    });
                }
            }

            snapshot.Listings = snapshot.Listings
                .OrderBy(listing => listing.ItemId, StringComparer.Ordinal)
                .ToList();
            result.Add(snapshot);
        }

        return result.OrderBy(shop => shop.Code, StringComparer.Ordinal).ThenBy(shop => shop.Index).ToList();
    }
}
