using System.Security.Cryptography;
using System.Globalization;
using System.Text;
using System.Text.Json;
using Il2CppScheduleOne.ItemFramework;
using UnityEngine;

namespace NeonSchedule1.GameDataExporter;

internal static partial class GameDataCollector
{
    internal const string PlannerObservationRequestFileName =
        "planner-observation-request.json";
    internal const string PlannerObservationResponseFileName =
        "planner-observation-response.json";

    private const string PlannerObservationRequestSchema =
        "neonschedule1-planner-observation-request-1";
    private const string PlannerObservationResponseSchema =
        "neonschedule1-planner-observation-response-1";
    private const int MaximumPlannerObservationRequestBytes = 16_384;

    internal static bool TryRunPlannerObservation(
        string outputDirectory,
        string exporterVersion,
        Action<string>? progress)
    {
        var requestPath = Path.Combine(outputDirectory, PlannerObservationRequestFileName);
        if (!File.Exists(requestPath))
        {
            return false;
        }

        var fileLength = new FileInfo(requestPath).Length;
        if (fileLength <= 0 || fileLength > MaximumPlannerObservationRequestBytes)
        {
            throw new InvalidOperationException(
                $"Planner observation request must contain 1 to " +
                $"{MaximumPlannerObservationRequestBytes} bytes.");
        }

        var requestBytes = File.ReadAllBytes(requestPath);
        ValidatePlannerObservationRequestJson(requestBytes);
        var request = JsonSerializer.Deserialize<PlannerObservationRequest>(
            requestBytes,
            ExportJson.Options)
            ?? throw new InvalidOperationException("Planner observation request is invalid.");
        ValidatePlannerObservationRequest(request);
        if (!string.Equals(request.ExpectedGameVersion, Application.version, StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                $"Planner observation request targets game {request.ExpectedGameVersion}, " +
                $"but the loaded game reports {Application.version}.");
        }

        var requestHash = Convert.ToHexString(SHA256.HashData(requestBytes)).ToLowerInvariant();
        progress?.Invoke("Planner observation request found. Reading allowlisted save state.");
        var inventories = new List<PlannerInventorySnapshot>();
        var inventoryScopes = new PlannerInventoryScopes();
        var state = CollectPlannerState();
        CollectPlannerInventories(inventories, inventoryScopes);
        inventories = inventories
            .OrderBy(inventory => inventory.Owner.Kind, StringComparer.Ordinal)
            .ThenBy(inventory => inventory.Owner.Id, StringComparer.Ordinal)
            .ToList();
        RequireUniqueInventoryOwners(inventories);

        var response = new PlannerObservationResponse
        {
            Schema = PlannerObservationResponseSchema,
            ExporterVersion = exporterVersion,
            ObservedAtUtc = DateTimeOffset.UtcNow.UtcDateTime.ToString(
                "yyyy-MM-dd'T'HH:mm:ss.fff'Z'",
                CultureInfo.InvariantCulture),
            GameVersion = Application.version,
            RequestId = request.RequestId,
            RequestSha256 = requestHash,
            State = state,
            InventoryScopes = inventoryScopes,
            Inventories = inventories,
        };
        var json = JsonSerializer.Serialize(response, ExportJson.Options);
        var responsePath = Path.Combine(outputDirectory, PlannerObservationResponseFileName);
        WriteAtomic(
            responsePath,
            json,
            new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
        var responseHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(json)))
            .ToLowerInvariant();
        WriteAtomic(
            responsePath + ".sha256",
            responseHash + Environment.NewLine,
            Encoding.ASCII);
        progress?.Invoke(
            $"Planner observation complete: {inventories.Count} inventory snapshots. " +
            $"Response {responsePath}. SHA-256 {responseHash}");
        return true;
    }

    private static PlannerStateSnapshot CollectPlannerState()
    {
        var levelManager = Il2CppScheduleOne.Levelling.LevelManager.Instance
            ?? throw new InvalidOperationException("LevelManager is unavailable after load.");
        var fullRank = levelManager.GetFullRank();
        var orderLimitMultiplier =
            Il2CppScheduleOne.Levelling.LevelManager.GetOrderLimitMultiplier(fullRank);
        var registry = Il2CppScheduleOne.NPCs.NPCManager.NPCRegistry
            ?? throw new InvalidOperationException("NPCManager.NPCRegistry is unavailable after load.");
        var npcGroups = GroupPlannerNpcs(registry, out var registryCoverageComplete);

        var unlockedPersonIds = new List<string>();
        var relationships = new List<PlannerRelationshipFact>();
        var recommendedDealerIds = new List<string>();
        var recruitedDealerIds = new List<string>();
        var customers = new List<PlannerCustomerState>();
        var dealers = new List<PlannerDealerState>();
        var peopleCoverageComplete = registryCoverageComplete;
        foreach (var group in npcGroups.OrderBy(pair => pair.Key, StringComparer.Ordinal))
        {
            var npc = SelectPlannerNpc(group.Value, out var selectionUnambiguous);
            peopleCoverageComplete &= selectionUnambiguous;

            var relation = npc.RelationData;
            if (relation is null)
            {
                peopleCoverageComplete = false;
            }
            else
            {
                relationships.Add(new PlannerRelationshipFact
                {
                    PersonId = group.Key,
                    Relationship = relation.RelationDelta,
                });
                if (relation.Unlocked)
                {
                    unlockedPersonIds.Add(group.Key);
                }
            }

            var customer = npc.GetComponent<Il2CppScheduleOne.Economy.Customer>();
            if (customer is not null)
            {
                var affinityValues = new List<PlannerCustomerDrugAffinity>();
                var affinityCoverageComplete = true;
                var currentAffinities = customer.currentAffinityData?.ProductAffinities;
                if (currentAffinities is not null)
                {
                    for (var affinityIndex = 0;
                         affinityIndex < currentAffinities.Count;
                         affinityIndex++)
                    {
                        var affinity = currentAffinities[affinityIndex];
                        if (affinity is null)
                        {
                            affinityCoverageComplete = false;
                            continue;
                        }
                        affinityValues.Add(new PlannerCustomerDrugAffinity
                        {
                            DrugType = affinity.DrugType.ToString(),
                            Affinity = affinity.Affinity,
                        });
                    }
                    affinityValues = affinityValues
                        .OrderBy(affinity => affinity.DrugType, StringComparer.Ordinal)
                        .ToList();
                }
                customers.Add(new PlannerCustomerState
                {
                    CustomerId = group.Key,
                    Addiction = Known(customer.CurrentAddiction),
                    OrderLimitMultiplier = Known(orderLimitMultiplier),
                    DrugAffinities = currentAffinities is null
                        ? Unknown()
                        : KnownCollection(affinityValues, affinityCoverageComplete),
                });
            }

            var dealer = npc.GetComponent<Il2CppScheduleOne.Economy.Dealer>();
            if (dealer is null)
            {
                continue;
            }
            if (relation?.Unlocked == true &&
                relation.UnlockType ==
                    Il2CppScheduleOne.NPCs.Relation.NPCRelationData.EUnlockType.Recommendation)
            {
                recommendedDealerIds.Add(group.Key);
            }
            if (dealer.IsRecruited)
            {
                recruitedDealerIds.Add(group.Key);
            }
            dealers.Add(new PlannerDealerState
            {
                PersonId = group.Key,
                SigningFeePaid = Known(dealer.IsRecruited),
            });
        }

        unlockedPersonIds.Sort(StringComparer.Ordinal);
        relationships = relationships.OrderBy(item => item.PersonId, StringComparer.Ordinal).ToList();
        recommendedDealerIds.Sort(StringComparer.Ordinal);
        recruitedDealerIds.Sort(StringComparer.Ordinal);
        customers = customers.OrderBy(item => item.CustomerId, StringComparer.Ordinal).ToList();
        dealers = dealers.OrderBy(item => item.PersonId, StringComparer.Ordinal).ToList();

        var timeManager = Il2CppScheduleOne.GameTime.TimeManager.Instance
            ?? throw new InvalidOperationException("TimeManager is unavailable after load.");
        var gameMinute = checked(
            timeManager.ElapsedDays * 1_440 +
            Il2CppScheduleOne.GameTime.TimeManager.GetMinSumFrom24HourTime(
                timeManager.CurrentTime));

        return new PlannerStateSnapshot
        {
            MixingRuleProfile = Known(ActiveRuleProfile()),
            CurrentRank = Known(new PlannerRank
            {
                Rank = fullRank.Rank.ToString(),
                Tier = fullRank.Tier,
            }),
            UnlockedPersonIds = KnownCollection(unlockedPersonIds, peopleCoverageComplete),
            Relationships = KnownCollection(relationships, peopleCoverageComplete),
            RecommendedDealerIds = KnownCollection(
                recommendedDealerIds,
                peopleCoverageComplete),
            RecruitedDealerIds = KnownCollection(recruitedDealerIds, peopleCoverageComplete),
            Customers = KnownCollection(customers, peopleCoverageComplete),
            Dealers = KnownCollection(dealers, peopleCoverageComplete),
            AvailableCash = Known(S1API.Money.Money.GetCashBalance()),
            GameMinute = Known(gameMinute),
            Properties = CollectPlannerPropertyStates(),
            Employees = CollectPlannerEmployeeStates(),
        };
    }

    private static object CollectPlannerPropertyStates()
    {
        var properties = Il2CppScheduleOne.Property.Property.Properties;
        if (properties is null)
        {
            return Unknown();
        }

        var result = new List<PlannerPropertyState>();
        var complete = true;
        for (var propertyIndex = 0; propertyIndex < properties.Count; propertyIndex++)
        {
            var property = properties[propertyIndex];
            if (property is null || string.IsNullOrWhiteSpace(property.PropertyCode))
            {
                complete = false;
                continue;
            }
            var placements = new List<PlannerPlacementRuntimeState>();
            var placementCoverageComplete = property.BuildableItems is not null;
            if (property.BuildableItems is not null)
            {
                for (var itemIndex = 0; itemIndex < property.BuildableItems.Count; itemIndex++)
                {
                    var item = property.BuildableItems[itemIndex];
                    if (item is null)
                    {
                        placementCoverageComplete = false;
                        continue;
                    }
                    var placementId = item.GUID.ToString();
                    if (string.IsNullOrWhiteSpace(placementId))
                    {
                        placementCoverageComplete = false;
                        continue;
                    }
                    var growContainer = item.TryCast<Il2CppScheduleOne.Growing.GrowContainer>();
                    var trashContainerItem =
                        item.TryCast<Il2CppScheduleOne.ObjectScripts.TrashContainerItem>();
                    placements.Add(new PlannerPlacementRuntimeState
                    {
                        PlacementId = placementId,
                        ItemId = string.IsNullOrWhiteSpace(item.ItemInstance?.Definition?.ID)
                            ? Unknown()
                            : Known(item.ItemInstance.Definition.ID),
                        Position = Known(VectorSnapshot3.FromVector(item.transform.position)),
                        Rotation = Known(VectorSnapshot3.FromVector(item.transform.eulerAngles)),
                        Moisture = growContainer is null
                            ? Unknown()
                            : Known(growContainer.NormalizedMoistureAmount),
                        TrashQuantity = trashContainerItem?.Container is null
                            ? Unknown()
                            : Known(trashContainerItem.Container.TrashLevel),
                        TaskReady = Unknown(),
                    });
                }
            }
            placements = placements
                .OrderBy(placement => placement.PlacementId, StringComparer.Ordinal)
                .ToList();
            result.Add(new PlannerPropertyState
            {
                PropertyCode = property.PropertyCode,
                Owned = Known(property.IsOwned),
                Placements = property.BuildableItems is null
                    ? Unknown()
                    : KnownCollection(placements, placementCoverageComplete),
            });
        }
        result = result.OrderBy(property => property.PropertyCode, StringComparer.Ordinal).ToList();
        return KnownCollection(result, complete);
    }

    private static object CollectPlannerEmployeeStates()
    {
        var employees = Il2CppScheduleOne.Employees.EmployeeManager.Instance?.AllEmployees;
        if (employees is null)
        {
            return Unknown();
        }

        var result = new List<PlannerEmployeeState>();
        var complete = true;
        for (var index = 0; index < employees.Count; index++)
        {
            var employee = employees[index];
            if (employee is null || string.IsNullOrWhiteSpace(employee.ID))
            {
                complete = false;
                continue;
            }
            result.Add(new PlannerEmployeeState
            {
                EmployeeId = employee.ID,
                Position = Known(VectorSnapshot3.FromVector(employee.transform.position)),
                CurrentWorkSpeed = Known(employee.CurrentWorkSpeed),
                TaskReady = Known(employee.CanWork()),
            });
        }
        result = result.OrderBy(employee => employee.EmployeeId, StringComparer.Ordinal).ToList();
        return KnownCollection(result, complete);
    }

    private static void CollectPlannerInventories(
        List<PlannerInventorySnapshot> result,
        PlannerInventoryScopes scopes)
    {
        CollectPlayerInventory(result, scopes);
        CollectNpcInventories(result, scopes);
        CollectPropertyAndPlacementInventories(result, scopes);
        CollectEmployeeInventories(result, scopes);
        CollectVehicleInventories(result, scopes);
    }

    private static void CollectPlayerInventory(
        List<PlannerInventorySnapshot> result,
        PlannerInventoryScopes scopes)
    {
        var slots = Il2CppScheduleOne.PlayerScripts.PlayerInventory.Instance?
            .GetAllInventorySlots();
        if (slots is null)
        {
            scopes.Player = "unknown";
            return;
        }
        result.Add(InventoryFromSlots("player", "local", slots, "complete"));
        scopes.Player = "complete";
    }

    private static void CollectNpcInventories(
        List<PlannerInventorySnapshot> result,
        PlannerInventoryScopes scopes)
    {
        var registry = Il2CppScheduleOne.NPCs.NPCManager.NPCRegistry;
        if (registry is null)
        {
            scopes.Dealers = "unknown";
            scopes.Suppliers = "unknown";
            return;
        }

        var npcGroups = GroupPlannerNpcs(registry, out var registryCoverageComplete);
        var dealersComplete = registryCoverageComplete;
        var suppliersComplete = registryCoverageComplete;
        foreach (var group in npcGroups.OrderBy(pair => pair.Key, StringComparer.Ordinal))
        {
            foreach (var dealerNpc in group.Value.OrderBy(
                         candidate => DiscoveryReflection.ObjectPath(candidate.transform),
                         StringComparer.Ordinal))
            {
                var dealer = dealerNpc.GetComponent<Il2CppScheduleOne.Economy.Dealer>();
                if (dealer is null)
                {
                    continue;
                }
                var ownerId =
                    $"{group.Key}:{DiscoveryReflection.ObjectPath(dealerNpc.transform)}";
                var slots = dealer.GetAllSlots();
                if (slots is null)
                {
                    dealersComplete = false;
                    result.Add(EmptyInventory("dealer", ownerId, "partial"));
                    continue;
                }
                result.Add(InventoryFromSlots("dealer", ownerId, slots, "complete"));
            }

            var npc = SelectPlannerNpc(group.Value, out var supplierSelectionUnambiguous);
            var supplier = npc.GetComponent<Il2CppScheduleOne.Economy.Supplier>();
            if (supplier is not null)
            {
                suppliersComplete &= supplierSelectionUnambiguous;
                var inventory = EmptyInventory("supplier", group.Key, "complete");
                var entries = new Dictionary<string, InventoryCounter>(StringComparer.Ordinal);
                if (supplier._deaddropItems is not null)
                {
                    for (var itemIndex = 0; itemIndex < supplier._deaddropItems.Length; itemIndex++)
                    {
                        var pair = supplier._deaddropItems[itemIndex];
                        if (pair is null || string.IsNullOrWhiteSpace(pair.String) || pair.Int < 0)
                        {
                            suppliersComplete = false;
                            inventory.Coverage = "partial";
                            continue;
                        }
                        if (pair.Int > 0)
                        {
                            AddInventoryCount(entries, pair.String, pair.Int, 0);
                        }
                    }
                }
                inventory.Entries = entries
                    .OrderBy(pair => pair.Key, StringComparer.Ordinal)
                    .Select(pair => new PlannerInventoryEntry
                    {
                        ItemId = pair.Key,
                        CurrentQuantity = Known(pair.Value.Quantity),
                        CurrentStackCount = Unknown(),
                    })
                    .ToList();
                result.Add(inventory);
            }
        }
        scopes.Dealers = dealersComplete ? "complete" : "partial";
        scopes.Suppliers = suppliersComplete ? "complete" : "partial";
    }

    private static Dictionary<string, List<Il2CppScheduleOne.NPCs.NPC>> GroupPlannerNpcs(
        Il2CppSystem.Collections.Generic.List<Il2CppScheduleOne.NPCs.NPC> registry,
        out bool complete)
    {
        var result = new Dictionary<string, List<Il2CppScheduleOne.NPCs.NPC>>(
            StringComparer.Ordinal);
        complete = true;
        for (var index = 0; index < registry.Count; index++)
        {
            var npc = registry[index];
            if (npc is null || string.IsNullOrWhiteSpace(npc.ID))
            {
                complete = false;
                continue;
            }
            if (!result.TryGetValue(npc.ID, out var group))
            {
                group = new List<Il2CppScheduleOne.NPCs.NPC>();
                result.Add(npc.ID, group);
            }
            group.Add(npc);
        }
        return result;
    }

    private static Il2CppScheduleOne.NPCs.NPC SelectPlannerNpc(
        IReadOnlyList<Il2CppScheduleOne.NPCs.NPC> candidates,
        out bool unambiguous)
    {
        var active = candidates.Where(candidate => candidate.gameObject.activeInHierarchy).ToList();
        var firstState = PlannerNpcStateKey(candidates[0]);
        unambiguous = candidates.Count == 1 || candidates
            .Skip(1)
            .All(candidate => string.Equals(
                PlannerNpcStateKey(candidate),
                firstState,
                StringComparison.Ordinal));
        return (active.Count > 0 ? active : candidates)
            .OrderBy(
                candidate => DiscoveryReflection.ObjectPath(candidate.transform),
                StringComparer.Ordinal)
            .First();
    }

    private static string PlannerNpcStateKey(Il2CppScheduleOne.NPCs.NPC npc)
    {
        var key = new StringBuilder();
        var relation = npc.RelationData;
        if (relation is null)
        {
            key.Append("relation:null|");
        }
        else
        {
            key.Append("relation:")
                .Append(relation.RelationDelta.ToString("R", CultureInfo.InvariantCulture))
                .Append(':')
                .Append(relation.Unlocked)
                .Append(':')
                .Append(relation.UnlockType)
                .Append('|');
        }

        var customer = npc.GetComponent<Il2CppScheduleOne.Economy.Customer>();
        if (customer is null)
        {
            key.Append("customer:null|");
        }
        else
        {
            key.Append("customer:")
                .Append(customer.CurrentAddiction.ToString("R", CultureInfo.InvariantCulture))
                .Append(':');
            var affinities = customer.currentAffinityData?.ProductAffinities;
            if (affinities is null)
            {
                key.Append("null");
            }
            else
            {
                var values = new List<string>();
                for (var index = 0; index < affinities.Count; index++)
                {
                    var affinity = affinities[index];
                    values.Add(affinity is null
                        ? "null"
                        : $"{affinity.DrugType}:" +
                            affinity.Affinity.ToString("R", CultureInfo.InvariantCulture));
                }
                values.Sort(StringComparer.Ordinal);
                key.AppendJoin(',', values);
            }
            key.Append('|');
        }

        var dealer = npc.GetComponent<Il2CppScheduleOne.Economy.Dealer>();
        key.Append("dealer:")
            .Append(dealer is null ? "null" : dealer.IsRecruited)
            .Append('|');
        return key.ToString();
    }

    private static void CollectPropertyAndPlacementInventories(
        List<PlannerInventorySnapshot> result,
        PlannerInventoryScopes scopes)
    {
        var properties = Il2CppScheduleOne.Property.Property.Properties;
        if (properties is null)
        {
            scopes.Properties = "unknown";
            scopes.Placements = "unknown";
            return;
        }

        var propertiesComplete = true;
        var placementsComplete = true;
        for (var propertyIndex = 0; propertyIndex < properties.Count; propertyIndex++)
        {
            var property = properties[propertyIndex];
            if (property is null || string.IsNullOrWhiteSpace(property.PropertyCode))
            {
                propertiesComplete = false;
                placementsComplete = false;
                continue;
            }

            var claimedPlacementSlots = new HashSet<IntPtr>();
            if (property.BuildableItems is null)
            {
                placementsComplete = false;
            }
            else
            {
                for (var itemIndex = 0; itemIndex < property.BuildableItems.Count; itemIndex++)
                {
                    var item = property.BuildableItems[itemIndex];
                    if (item is null)
                    {
                        placementsComplete = false;
                        continue;
                    }
                    var placementId = item.GUID.ToString();
                    if (string.IsNullOrWhiteSpace(placementId))
                    {
                        placementsComplete = false;
                        continue;
                    }
                    var slots = new List<ItemSlot>();
                    var localSeen = new HashSet<IntPtr>();
                    var isInventoryOwner = false;
                    var itemComplete = CollectPlacementSlots(
                        item,
                        slots,
                        localSeen,
                        ref isInventoryOwner);
                    foreach (var pointer in localSeen)
                    {
                        claimedPlacementSlots.Add(pointer);
                    }
                    if (!itemComplete)
                    {
                        placementsComplete = false;
                    }
                    if (isInventoryOwner)
                    {
                        result.Add(InventoryFromSlots(
                            "placement",
                            placementId,
                            slots,
                            itemComplete ? "complete" : "partial"));
                    }
                }
            }

            var propertySlots = new List<ItemSlot>();
            var propertySeen = new HashSet<IntPtr>();
            var propertyComplete = true;
            if (property.LoadingDocks is not null)
            {
                for (var dockIndex = 0; dockIndex < property.LoadingDocks.Length; dockIndex++)
                {
                    var dock = property.LoadingDocks[dockIndex];
                    if (dock is null)
                    {
                        propertyComplete = false;
                        continue;
                    }
                    if (!AddSlots(
                            dock.InputSlots,
                            propertySlots,
                            propertySeen,
                            claimedPlacementSlots) ||
                        !AddSlots(
                            dock.OutputSlots,
                            propertySlots,
                            propertySeen,
                            claimedPlacementSlots))
                    {
                        propertyComplete = false;
                    }
                }
            }
            var storages = property.GetComponentsInChildren<
                Il2CppScheduleOne.Storage.StorageEntity>(true);
            if (storages is not null)
            {
                for (var storageIndex = 0; storageIndex < storages.Length; storageIndex++)
                {
                    var storage = storages[storageIndex];
                    if (storage is null || !AddSlots(
                            storage.ItemSlots,
                            propertySlots,
                            propertySeen,
                            claimedPlacementSlots))
                    {
                        propertyComplete = false;
                    }
                }
            }
            result.Add(InventoryFromSlots(
                "property",
                property.PropertyCode,
                propertySlots,
                propertyComplete ? "complete" : "partial"));
            propertiesComplete &= propertyComplete;
        }
        scopes.Properties = propertiesComplete ? "complete" : "partial";
        scopes.Placements = placementsComplete ? "complete" : "partial";
    }

    private static bool CollectPlacementSlots(
        Il2CppScheduleOne.EntityFramework.BuildableItem item,
        List<ItemSlot> slots,
        HashSet<IntPtr> seen,
        ref bool isInventoryOwner)
    {
        var complete = true;
        var storages = item.GetComponentsInChildren<Il2CppScheduleOne.Storage.StorageEntity>(true);
        if (storages is not null && storages.Length > 0)
        {
            isInventoryOwner = true;
            for (var index = 0; index < storages.Length; index++)
            {
                complete &= storages[index] is not null &&
                    AddSlots(storages[index]!.ItemSlots, slots, seen);
            }
        }

        var packaging = item.TryCast<Il2CppScheduleOne.ObjectScripts.PackagingStation>();
        if (packaging is not null)
        {
            isInventoryOwner = true;
            complete &= AddSlots(packaging.ItemSlots, slots, seen);
        }
        var drying = item.TryCast<Il2CppScheduleOne.ObjectScripts.DryingRack>();
        if (drying is not null)
        {
            isInventoryOwner = true;
            complete &= AddSlots(drying.ItemSlots, slots, seen);
        }
        var press = item.TryCast<Il2CppScheduleOne.ObjectScripts.BrickPress>();
        if (press is not null)
        {
            isInventoryOwner = true;
            complete &= AddSlots(press.ItemSlots, slots, seen);
        }
        var mixing = item.TryCast<Il2CppScheduleOne.ObjectScripts.MixingStation>();
        if (mixing is not null)
        {
            isInventoryOwner = true;
            complete &= AddSlots(mixing.ItemSlots, slots, seen);
        }
        var oven = item.TryCast<Il2CppScheduleOne.ObjectScripts.LabOven>();
        if (oven is not null)
        {
            isInventoryOwner = true;
            complete &= AddSlots(oven.ItemSlots, slots, seen);
        }
        var cauldron = item.TryCast<Il2CppScheduleOne.ObjectScripts.Cauldron>();
        if (cauldron is not null)
        {
            isInventoryOwner = true;
            complete &= AddSlots(cauldron.ItemSlots, slots, seen);
        }
        var growContainer = item.TryCast<Il2CppScheduleOne.Growing.GrowContainer>();
        if (growContainer is not null)
        {
            isInventoryOwner = true;
            complete &= AddSlots(growContainer.InputSlots, slots, seen);
            complete &= AddSlots(growContainer.OutputSlots, slots, seen);
        }
        var spawnStation =
            item.TryCast<Il2CppScheduleOne.StationFramework.MushroomSpawnStation>();
        if (spawnStation is not null)
        {
            isInventoryOwner = true;
            complete &= AddSlots(spawnStation.ItemSlots, slots, seen);
        }
        return complete;
    }

    private static void CollectEmployeeInventories(
        List<PlannerInventorySnapshot> result,
        PlannerInventoryScopes scopes)
    {
        var employees = Il2CppScheduleOne.Employees.EmployeeManager.Instance?.AllEmployees;
        if (employees is null)
        {
            scopes.Employees = "unknown";
            return;
        }
        var complete = true;
        for (var index = 0; index < employees.Count; index++)
        {
            var employee = employees[index];
            if (employee is null || string.IsNullOrWhiteSpace(employee.ID))
            {
                complete = false;
                continue;
            }
            var slots = employee.Inventory?.ItemSlots;
            if (slots is null)
            {
                complete = false;
                result.Add(EmptyInventory("employee", employee.ID, "partial"));
            }
            else
            {
                result.Add(InventoryFromSlots("employee", employee.ID, slots, "complete"));
            }
        }
        scopes.Employees = complete ? "complete" : "partial";
    }

    private static void CollectVehicleInventories(
        List<PlannerInventorySnapshot> result,
        PlannerInventoryScopes scopes)
    {
        var vehicles = Il2CppScheduleOne.Vehicles.VehicleManager.Instance?.PlayerOwnedVehicles;
        if (vehicles is null)
        {
            scopes.Vehicles = "unknown";
            return;
        }
        var complete = true;
        for (var index = 0; index < vehicles.Count; index++)
        {
            var vehicle = vehicles[index];
            if (vehicle is null)
            {
                complete = false;
                continue;
            }
            var vehicleId = vehicle.GUID.ToString();
            if (string.IsNullOrWhiteSpace(vehicleId) || vehicle.Storage?.ItemSlots is null)
            {
                complete = false;
                continue;
            }
            result.Add(InventoryFromSlots(
                "vehicle",
                vehicleId,
                vehicle.Storage.ItemSlots,
                "complete"));
        }
        scopes.Vehicles = complete ? "complete" : "partial";
    }

    private static PlannerInventorySnapshot InventoryFromSlots(
        string ownerKind,
        string ownerId,
        Il2CppSystem.Collections.Generic.List<ItemSlot> slots,
        string coverage)
    {
        var collected = new List<ItemSlot>();
        var seen = new HashSet<IntPtr>();
        var complete = AddSlots(slots, collected, seen);
        return InventoryFromSlots(
            ownerKind,
            ownerId,
            collected,
            complete ? coverage : "partial");
    }

    private static PlannerInventorySnapshot InventoryFromSlots(
        string ownerKind,
        string ownerId,
        IReadOnlyList<ItemSlot> slots,
        string coverage)
    {
        var entries = new Dictionary<string, InventoryCounter>(StringComparer.Ordinal);
        var complete = string.Equals(coverage, "complete", StringComparison.Ordinal);
        foreach (var slot in slots)
        {
            var instance = slot?.ItemInstance;
            if (instance is null || slot!.Quantity == 0)
            {
                continue;
            }
            var itemId = instance.Definition?.ID;
            if (string.IsNullOrWhiteSpace(itemId) || slot.Quantity < 0)
            {
                complete = false;
                continue;
            }
            AddInventoryCount(entries, itemId, slot.Quantity, 1);
        }
        return new PlannerInventorySnapshot
        {
            Owner = new PlannerInventoryOwner { Kind = ownerKind, Id = ownerId },
            Coverage = complete ? "complete" : "partial",
            Entries = InventoryEntries(entries),
        };
    }

    private static PlannerInventorySnapshot EmptyInventory(
        string ownerKind,
        string ownerId,
        string coverage) => new()
    {
        Owner = new PlannerInventoryOwner { Kind = ownerKind, Id = ownerId },
        Coverage = coverage,
    };

    private static List<PlannerInventoryEntry> InventoryEntries(
        IReadOnlyDictionary<string, InventoryCounter> counts) => counts
        .OrderBy(pair => pair.Key, StringComparer.Ordinal)
        .Select(pair => new PlannerInventoryEntry
        {
            ItemId = pair.Key,
            CurrentQuantity = Known(pair.Value.Quantity),
            CurrentStackCount = Known(pair.Value.StackCount),
        })
        .ToList();

    private static void AddInventoryCount(
        IDictionary<string, InventoryCounter> entries,
        string itemId,
        int quantity,
        int stackCount)
    {
        if (!entries.TryGetValue(itemId, out var entry))
        {
            entry = new InventoryCounter();
            entries.Add(itemId, entry);
        }
        entry.Quantity = checked(entry.Quantity + quantity);
        entry.StackCount = checked(entry.StackCount + stackCount);
    }

    private static bool AddSlots(
        Il2CppSystem.Collections.Generic.List<ItemSlot>? source,
        ICollection<ItemSlot> destination,
        ISet<IntPtr> seen,
        ISet<IntPtr>? excluded = null)
    {
        if (source is null)
        {
            return false;
        }
        var complete = true;
        for (var index = 0; index < source.Count; index++)
        {
            var slot = source[index];
            if (slot is null)
            {
                complete = false;
                continue;
            }
            if (excluded?.Contains(slot.Pointer) == true || !seen.Add(slot.Pointer))
            {
                continue;
            }
            destination.Add(slot);
        }
        return complete;
    }

    private static void RequireUniqueInventoryOwners(
        IReadOnlyList<PlannerInventorySnapshot> inventories)
    {
        var owners = new HashSet<string>(StringComparer.Ordinal);
        foreach (var inventory in inventories)
        {
            if (!owners.Add($"{inventory.Owner.Kind}\0{inventory.Owner.Id}"))
            {
                throw new InvalidOperationException(
                    $"Planner observation contains duplicate inventory owner " +
                    $"{inventory.Owner.Kind}/{inventory.Owner.Id}.");
            }
        }
    }

    private static void ValidatePlannerObservationRequestJson(byte[] content)
    {
        using var document = JsonDocument.Parse(content);
        if (document.RootElement.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidOperationException("Planner observation request must be an object.");
        }
        var allowed = new HashSet<string>(StringComparer.Ordinal)
        {
            "schema",
            "requestId",
            "expectedGameVersion",
        };
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in document.RootElement.EnumerateObject())
        {
            if (!allowed.Contains(property.Name) || !seen.Add(property.Name))
            {
                throw new InvalidOperationException(
                    $"Planner observation request contains unsupported property " +
                    $"{property.Name}.");
            }
        }
        if (seen.Count != allowed.Count)
        {
            throw new InvalidOperationException(
                "Planner observation request is missing a required property.");
        }
    }

    private static void ValidatePlannerObservationRequest(PlannerObservationRequest request)
    {
        if (!string.Equals(
                request.Schema,
                PlannerObservationRequestSchema,
                StringComparison.Ordinal) ||
            string.IsNullOrWhiteSpace(request.RequestId) ||
            request.RequestId.Length > 128 ||
            request.RequestId.Contains('\0') ||
            string.IsNullOrWhiteSpace(request.ExpectedGameVersion) ||
            request.ExpectedGameVersion.Length > 64)
        {
            throw new InvalidOperationException("Planner observation request is invalid.");
        }
    }

    private static PlannerKnownValue<T> Known<T>(T value) => new() { Value = value };

    private static PlannerKnownCollection<T> KnownCollection<T>(
        List<T> values,
        bool complete) => new()
    {
        Coverage = complete ? "complete" : "partial",
        Values = values,
    };

    private static PlannerUnknownValue Unknown() => new();
}

internal sealed class PlannerObservationRequest
{
    public string Schema { get; init; } = string.Empty;
    public string RequestId { get; init; } = string.Empty;
    public string ExpectedGameVersion { get; init; } = string.Empty;
}

internal sealed class PlannerObservationResponse
{
    public string Schema { get; init; } = string.Empty;
    public string ExporterVersion { get; init; } = string.Empty;
    public string ObservedAtUtc { get; init; } = string.Empty;
    public string GameVersion { get; init; } = string.Empty;
    public string RequestId { get; init; } = string.Empty;
    public string RequestSha256 { get; init; } = string.Empty;
    public PlannerObservationSource Source { get; init; } = new();
    public PlannerStateSnapshot State { get; init; } = new();
    public PlannerInventoryScopes InventoryScopes { get; init; } = new();
    public List<PlannerInventorySnapshot> Inventories { get; init; } = new();
}

internal sealed class PlannerObservationSource
{
    public string Kind { get; init; } = "mod";
    public string Access { get; init; } = "read-only";
    public string RawPayloadRetention { get; init; } = "none";
}

internal sealed class PlannerStateSnapshot
{
    public object MixingRuleProfile { get; init; } = new PlannerUnknownValue();
    public object CurrentRank { get; init; } = new PlannerUnknownValue();
    public object UnlockedPersonIds { get; init; } = new PlannerUnknownValue();
    public object Relationships { get; init; } = new PlannerUnknownValue();
    public object RecommendedDealerIds { get; init; } = new PlannerUnknownValue();
    public object RecruitedDealerIds { get; init; } = new PlannerUnknownValue();
    public object Customers { get; init; } = new PlannerUnknownValue();
    public object Dealers { get; init; } = new PlannerUnknownValue();
    public object AvailableCash { get; init; } = new PlannerUnknownValue();
    public object GameMinute { get; init; } = new PlannerUnknownValue();
    public object Properties { get; init; } = new PlannerUnknownValue();
    public object Employees { get; init; } = new PlannerUnknownValue();
}

internal sealed class PlannerUnknownValue
{
    public string Status { get; init; } = "unknown";
}

internal sealed class PlannerKnownValue<T>
{
    public string Status { get; init; } = "known";
    public T Value { get; init; } = default!;
}

internal sealed class PlannerKnownCollection<T>
{
    public string Status { get; init; } = "known";
    public string Coverage { get; init; } = "complete";
    public List<T> Values { get; init; } = new();
}

internal sealed class PlannerRank
{
    public string Rank { get; init; } = string.Empty;
    public int Tier { get; init; }
}

internal sealed class PlannerRelationshipFact
{
    public string PersonId { get; init; } = string.Empty;
    public float Relationship { get; init; }
}

internal sealed class PlannerCustomerState
{
    public string CustomerId { get; init; } = string.Empty;
    public object Addiction { get; init; } = new PlannerUnknownValue();
    public object OrderLimitMultiplier { get; init; } = new PlannerUnknownValue();
    public object DrugAffinities { get; init; } = new PlannerUnknownValue();
}

internal sealed class PlannerCustomerDrugAffinity
{
    public string DrugType { get; init; } = string.Empty;
    public float Affinity { get; init; }
}

internal sealed class PlannerDealerState
{
    public string PersonId { get; init; } = string.Empty;
    public object SigningFeePaid { get; init; } = new PlannerUnknownValue();
}

internal sealed class PlannerPropertyState
{
    public string PropertyCode { get; init; } = string.Empty;
    public object Owned { get; init; } = new PlannerUnknownValue();
    public object Placements { get; init; } = new PlannerUnknownValue();
}

internal sealed class PlannerPlacementRuntimeState
{
    public string PlacementId { get; init; } = string.Empty;
    public object ItemId { get; init; } = new PlannerUnknownValue();
    public object Position { get; init; } = new PlannerUnknownValue();
    public object Rotation { get; init; } = new PlannerUnknownValue();
    public object Moisture { get; init; } = new PlannerUnknownValue();
    public object TrashQuantity { get; init; } = new PlannerUnknownValue();
    public object TaskReady { get; init; } = new PlannerUnknownValue();
}

internal sealed class PlannerEmployeeState
{
    public string EmployeeId { get; init; } = string.Empty;
    public object Position { get; init; } = new PlannerUnknownValue();
    public object CurrentWorkSpeed { get; init; } = new PlannerUnknownValue();
    public object TaskReady { get; init; } = new PlannerUnknownValue();
}

internal sealed class PlannerInventoryScopes
{
    public string Player { get; set; } = "unknown";
    public string Dealers { get; set; } = "unknown";
    public string Suppliers { get; set; } = "unknown";
    public string Properties { get; set; } = "unknown";
    public string Placements { get; set; } = "unknown";
    public string Employees { get; set; } = "unknown";
    public string Vehicles { get; set; } = "unknown";
}

internal sealed class PlannerInventorySnapshot
{
    public PlannerInventoryOwner Owner { get; init; } = new();
    public string Coverage { get; set; } = "complete";
    public List<PlannerInventoryEntry> Entries { get; set; } = new();
}

internal sealed class PlannerInventoryOwner
{
    public string Kind { get; init; } = string.Empty;
    public string Id { get; init; } = string.Empty;
}

internal sealed class PlannerInventoryEntry
{
    public string ItemId { get; init; } = string.Empty;
    public object CurrentQuantity { get; init; } = new PlannerUnknownValue();
    public object CurrentStackCount { get; init; } = new PlannerUnknownValue();
}

internal sealed class InventoryCounter
{
    public int Quantity { get; set; }
    public int StackCount { get; set; }
}
