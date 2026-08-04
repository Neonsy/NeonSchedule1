using System.Reflection;
using System.Security.Cryptography;
using System.Globalization;
using System.Text;
using Il2CppInterop.Runtime;
using Unity.AI.Navigation;
using UnityEngine;
using UnityEngine.AI;
using UnityEngine.UI;

namespace NeonSchedule1.GameDataExporter;

internal static partial class DiscoveryCollector
{
    private static void CollectNavigation(
        DiscoverySnapshot result,
        Action<string>? progress)
    {
        result.Navigation.Method = "sampled-navmesh-grid";
        result.Navigation.SampleSpacing = 2f;
        result.Navigation.QueryHeight = 0f;
        result.Navigation.MaxSampleDistance = 12f;

        var surfaces = Resources.FindObjectsOfTypeAll<NavMeshSurface>();
        for (var index = 0; index < surfaces.Length; index++)
        {
            var surface = surfaces[index];
            if (surface is null || !DiscoveryReflection.IsSceneObject(surface.gameObject))
            {
                continue;
            }

            var snapshot = new DiscoveryNavMeshSurfaceSnapshot
            {
                ObjectPath = DiscoveryReflection.ObjectPath(surface.transform),
                SceneName = surface.gameObject.scene.name,
                Transform = TransformSnapshot.FromTransform(surface.transform),
                AgentTypeId = surface.agentTypeID,
                CollectObjects = surface.collectObjects.ToString(),
                LayerMask = surface.layerMask.value,
                UseGeometry = surface.useGeometry.ToString(),
                DefaultArea = surface.defaultArea,
                IgnoreNavMeshAgent = surface.ignoreNavMeshAgent,
                IgnoreNavMeshObstacle = surface.ignoreNavMeshObstacle,
                OverrideTileSize = surface.overrideTileSize,
                TileSize = surface.tileSize,
                OverrideVoxelSize = surface.overrideVoxelSize,
                VoxelSize = surface.voxelSize,
                MinimumRegionArea = surface.minRegionArea,
                BuildHeightMesh = surface.buildHeightMesh,
            };

            try
            {
                var data = surface.navMeshData;
                if (data is not null)
                {
                    snapshot.DataPosition = VectorSnapshot3.FromVector(data.position);
                    snapshot.SourceBoundsCenter = VectorSnapshot3.FromVector(data.sourceBounds.center);
                    snapshot.SourceBoundsSize = VectorSnapshot3.FromVector(data.sourceBounds.size);
                    snapshot.HasHeightMeshData = data.hasHeightMeshData;
                }
            }
            catch (Exception exception)
            {
                snapshot.Error = $"{exception.GetType().Name}: {exception.Message}";
            }

            result.Navigation.Surfaces.Add(snapshot);
        }

        var horizontalPoints = new List<Vector3>();
        for (var regionIndex = 0; regionIndex < result.Map.Regions.Count; regionIndex++)
        {
            var points = result.Map.Regions[regionIndex].PolygonPoints;
            for (var pointIndex = 0; pointIndex < points.Count; pointIndex++)
            {
                horizontalPoints.Add(new Vector3(points[pointIndex].X, 0f, points[pointIndex].Z));
            }
        }
        for (var locationIndex = 0; locationIndex < result.Locations.Count; locationIndex++)
        {
            var point = result.Locations[locationIndex].Position;
            if (point is not null)
            {
                horizontalPoints.Add(new Vector3(point.X, 0f, point.Z));
            }
        }

        if (horizontalPoints.Count == 0)
        {
            result.Navigation.Error = "No map bounds were available for navigation sampling.";
            return;
        }

        const float padding = 30f;
        var minX = MathF.Floor(horizontalPoints.Min(point => point.x) - padding);
        var maxX = MathF.Ceiling(horizontalPoints.Max(point => point.x) + padding);
        var minZ = MathF.Floor(horizontalPoints.Min(point => point.z) - padding);
        var maxZ = MathF.Ceiling(horizontalPoints.Max(point => point.z) + padding);
        var spacing = result.Navigation.SampleSpacing;
        var width = (int)MathF.Floor((maxX - minX) / spacing) + 1;
        var height = (int)MathF.Floor((maxZ - minZ) / spacing) + 1;
        result.Navigation.BoundsMinimum = new VectorSnapshot3 { X = minX, Y = 0f, Z = minZ };
        result.Navigation.BoundsMaximum = new VectorSnapshot3 { X = maxX, Y = 0f, Z = maxZ };
        result.Navigation.GridWidth = width;
        result.Navigation.GridHeight = height;

        var sampleIndices = new Dictionary<long, int>();
        try
        {
            for (var zIndex = 0; zIndex < height; zIndex++)
            {
                var z = minZ + (zIndex * spacing);
                for (var xIndex = 0; xIndex < width; xIndex++)
                {
                    var x = minX + (xIndex * spacing);
                    var query = new Vector3(x, result.Navigation.QueryHeight, z);
                    if (!NavMesh.SamplePosition(
                            query,
                            out var hit,
                            result.Navigation.MaxSampleDistance,
                            NavMesh.AllAreas) ||
                        MathF.Abs(hit.position.x - x) > spacing * 0.5f ||
                        MathF.Abs(hit.position.z - z) > spacing * 0.5f)
                    {
                        continue;
                    }

                    var sampleIndex = result.Navigation.Samples.Count;
                    result.Navigation.Samples.Add(new DiscoveryNavigationSampleSnapshot
                    {
                        GridX = xIndex,
                        GridZ = zIndex,
                        Position = VectorSnapshot3.FromVector(hit.position),
                        AreaMask = hit.mask,
                    });
                    sampleIndices[NavigationGridKey(xIndex, zIndex)] = sampleIndex;
                }

                if ((zIndex + 1) % 25 == 0 || zIndex + 1 == height)
                {
                    progress?.Invoke(
                        $"Discovery 4/9 progress: sampled {zIndex + 1}/{height} navigation rows.");
                }
            }
        }
        catch (Exception exception)
        {
            result.Navigation.Error = $"Sampling failed: {exception.GetType().Name}: {exception.Message}";
            return;
        }

        try
        {
            for (var index = 0; index < result.Navigation.Samples.Count; index++)
            {
                var sample = result.Navigation.Samples[index];
                AddNavigationEdge(result.Navigation, sampleIndices, index, sample.GridX + 1, sample.GridZ);
                AddNavigationEdge(result.Navigation, sampleIndices, index, sample.GridX, sample.GridZ + 1);
            }
        }
        catch (Exception exception)
        {
            result.Navigation.EdgeError =
                $"Edge validation failed: {exception.GetType().Name}: {exception.Message}";
        }
    }

    private static void CollectMapServices(DiscoverySnapshot result)
    {
        var keys = new HashSet<string>(StringComparer.Ordinal);
        var payPhones = Resources.FindObjectsOfTypeAll<Il2CppScheduleOne.Calling.PayPhone>();
        var sceneGameObjects = Resources.FindObjectsOfTypeAll<GameObject>();
        result.ServiceResourceCounts["pay-phone"] = payPhones.Length;
        foreach (var gameObject in sceneGameObjects)
        {
            if (gameObject is null || !DiscoveryReflection.IsSceneObject(gameObject))
            {
                continue;
            }

            var normalizedName = NormalizeName(gameObject.name ?? string.Empty);
            if (normalizedName.Contains("payphone", StringComparison.Ordinal) ||
                normalizedName.Contains("phonebooth", StringComparison.Ordinal))
            {
                result.NamedSceneServiceObjects.Add(new DiscoveryNamedSceneObjectSnapshot
                {
                    Kind = "phone-candidate",
                    Name = gameObject.name ?? string.Empty,
                    ObjectPath = DiscoveryReflection.ObjectPath(gameObject.transform),
                    SceneName = gameObject.scene.name,
                    Position = VectorSnapshot3.FromVector(gameObject.transform.position),
                });
            }
        }

        DiscoveryMapServiceSnapshot? Add(
            Component component,
            string kind,
            string id,
            string name,
            string description = "",
            string region = "",
            Transform? accessPoint = null,
            Transform? locationTransform = null,
            string locationSource = "component-transform",
            string linkedPersonId = "",
            Dictionary<string, string>? mechanics = null)
        {
            if (!DiscoveryReflection.IsSceneObject(component.gameObject))
            {
                return null;
            }

            var usesRequestedLocation = locationTransform is not null &&
                DiscoveryReflection.IsSceneObject(locationTransform.gameObject);
            var physicalTransform = usesRequestedLocation
                ? locationTransform!
                : component.transform;
            var objectPath = DiscoveryReflection.ObjectPath(physicalTransform);
            id = string.IsNullOrWhiteSpace(id) ? objectPath : id;
            var key = $"{kind}\u001f{id}\u001f{objectPath}";
            if (!keys.Add(key))
            {
                return null;
            }

            var snapshot = new DiscoveryMapServiceSnapshot
            {
                Kind = kind,
                Id = id,
                Name = name,
                Description = description,
                RuntimeType = DiscoveryReflection.RuntimeTypeName(component),
                ObjectPath = objectPath,
                InterfaceObjectPath = DiscoveryReflection.ObjectPath(component.transform),
                SceneName = physicalTransform.gameObject.scene.name,
                Region = region,
                Position = VectorSnapshot3.FromVector(physicalTransform.position),
                Rotation = VectorSnapshot3.FromVector(physicalTransform.eulerAngles),
                AccessPoint = TransformSnapshot.FromTransform(accessPoint),
                LocationSource = usesRequestedLocation ? locationSource : "component-transform",
                LinkedPersonId = linkedPersonId,
                Mechanics = mechanics ?? new Dictionary<string, string>(StringComparer.Ordinal),
            };
            result.MapServices.Add(snapshot);
            result.Locations.Add(new DiscoveryLocationSnapshot
            {
                Kind = $"map-service-{kind}",
                Id = id,
                Name = name,
                Description = description,
                RuntimeType = snapshot.RuntimeType,
                Position = snapshot.Position,
                Rotation = snapshot.Rotation,
                SceneName = snapshot.SceneName,
                PersonId = linkedPersonId,
            });
            return snapshot;
        }

        foreach (var atm in Resources.FindObjectsOfTypeAll<Il2CppScheduleOne.Money.ATM>())
        {
            if (atm is null)
            {
                continue;
            }

            Add(
                atm,
                "atm",
                atm.GUID.ToString(),
                atm.name ?? "ATM",
                accessPoint: atm.AccessPoint,
                mechanics: new Dictionary<string, string>(StringComparer.Ordinal)
                {
                    ["depositLimitEnabled"] = Il2CppScheduleOne.Money.ATM.DepositLimitEnabled.ToString(),
                    ["weeklyDepositLimit"] = Il2CppScheduleOne.Money.ATM.WeeklyDepositLimit.ToString("R", CultureInfo.InvariantCulture),
                    ["breakImpactThreshold"] = Il2CppScheduleOne.Money.ATM.BreakImpactThreshold.ToString("R", CultureInfo.InvariantCulture),
                    ["repairTimeDays"] = Il2CppScheduleOne.Money.ATM.RepairTimeDays.ToString(CultureInfo.InvariantCulture),
                    ["minimumCashDrop"] = Il2CppScheduleOne.Money.ATM.MinCashDrop.ToString(CultureInfo.InvariantCulture),
                    ["maximumCashDrop"] = Il2CppScheduleOne.Money.ATM.MaxCashDrop.ToString(CultureInfo.InvariantCulture),
                });
        }

        foreach (var machine in Resources.FindObjectsOfTypeAll<
                     Il2CppScheduleOne.ObjectScripts.VendingMachine>())
        {
            if (machine is null)
            {
                continue;
            }

            Add(
                machine,
                "vending-machine",
                machine.GUID.ToString(),
                machine.name ?? "Vending machine",
                accessPoint: machine.AccessPoint,
                mechanics: new Dictionary<string, string>(StringComparer.Ordinal)
                {
                    ["cost"] = Il2CppScheduleOne.ObjectScripts.VendingMachine.COST.ToString("R", CultureInfo.InvariantCulture),
                    ["repairTimeDays"] = Il2CppScheduleOne.ObjectScripts.VendingMachine.REPAIR_TIME_DAYS.ToString(CultureInfo.InvariantCulture),
                    ["freeItemImpactThreshold"] = Il2CppScheduleOne.ObjectScripts.VendingMachine.IMPACT_THRESHOLD_FREE_ITEM.ToString("R", CultureInfo.InvariantCulture),
                    ["freeItemChance"] = Il2CppScheduleOne.ObjectScripts.VendingMachine.IMPACT_THRESHOLD_FREE_ITEM_CHANCE.ToString("R", CultureInfo.InvariantCulture),
                    ["breakImpactThreshold"] = Il2CppScheduleOne.ObjectScripts.VendingMachine.IMPACT_THRESHOLD_BREAK.ToString("R", CultureInfo.InvariantCulture),
                    ["minimumCashDrop"] = Il2CppScheduleOne.ObjectScripts.VendingMachine.MIN_CASH_DROP.ToString(CultureInfo.InvariantCulture),
                    ["maximumCashDrop"] = Il2CppScheduleOne.ObjectScripts.VendingMachine.MAX_CASH_DROP.ToString(CultureInfo.InvariantCulture),
                    ["litStartTime"] = machine.LitStartTime.ToString(CultureInfo.InvariantCulture),
                    ["litEndTime"] = machine.LitOnEndTime.ToString(CultureInfo.InvariantCulture),
                });
        }

        foreach (var phone in payPhones)
        {
            if (phone is null)
            {
                continue;
            }

            Add(
                phone,
                "pay-phone",
                string.Empty,
                phone.name ?? "Pay phone",
                accessPoint: phone.CameraPosition,
                mechanics: new Dictionary<string, string>(StringComparer.Ordinal)
                {
                    ["ringInterval"] = Il2CppScheduleOne.Calling.PayPhone.RING_INTERVAL.ToString("R", CultureInfo.InvariantCulture),
                    ["ringRange"] = Il2CppScheduleOne.Calling.PayPhone.RING_RANGE.ToString("R", CultureInfo.InvariantCulture),
                });
        }

        var visualOnlyPayPhoneCount = 0;
        bool ContainsFunctionalPayPhone(Transform root)
        {
            foreach (var phone in payPhones)
            {
                if (phone is null || !DiscoveryReflection.IsSceneObject(phone.gameObject))
                {
                    continue;
                }

                var phoneTransform = phone.transform;
                if (phoneTransform == root ||
                    phoneTransform.IsChildOf(root) ||
                    root.IsChildOf(phoneTransform))
                {
                    return true;
                }
            }

            return false;
        }

        foreach (var gameObject in sceneGameObjects)
        {
            if (gameObject is null || !DiscoveryReflection.IsSceneObject(gameObject) ||
                NormalizeName(gameObject.name ?? string.Empty) != "payphone" ||
                NormalizeName(gameObject.transform.parent?.name ?? string.Empty) == "payphone" ||
                ContainsFunctionalPayPhone(gameObject.transform))
            {
                continue;
            }

            var renderer = gameObject.GetComponentInChildren<Renderer>(true);
            if (renderer is null)
            {
                continue;
            }
            var service = Add(
                renderer,
                "pay-phone-visual",
                DiscoveryReflection.ObjectPath(gameObject.transform),
                gameObject.name ?? "Pay phone",
                "Physical payphone model without a functional PayPhone component.",
                locationTransform: gameObject.transform,
                locationSource: "scene-visual-root",
                mechanics: new Dictionary<string, string>(StringComparer.Ordinal)
                {
                    ["functional"] = "false",
                });
            if (service is not null)
            {
                visualOnlyPayPhoneCount++;
            }
        }
        result.ServiceResourceCounts["pay-phone-visual-only"] = visualOnlyPayPhoneCount;

        foreach (var recycler in Resources.FindObjectsOfTypeAll<
                     Il2CppScheduleOne.ObjectScripts.Recycler>())
        {
            if (recycler is null)
            {
                continue;
            }

            Add(
                recycler,
                "cash-for-trash",
                string.Empty,
                recycler.name ?? "Cash for trash",
                mechanics: new Dictionary<string, string>(StringComparer.Ordinal)
                {
                    ["currentCashValueInLoadedSave"] = recycler.cashValue.ToString("R", CultureInfo.InvariantCulture),
                });
        }

        foreach (var deadDrop in Resources.FindObjectsOfTypeAll<
                     Il2CppScheduleOne.Economy.DeadDrop>())
        {
            if (deadDrop is null)
            {
                continue;
            }

            Add(
                deadDrop,
                "dead-drop",
                deadDrop.GUID.ToString(),
                deadDrop.DeadDropName ?? deadDrop.name ?? "Dead drop",
                deadDrop.DeadDropDescription ?? string.Empty,
                deadDrop.Region.ToString());
        }

        foreach (var stash in Resources.FindObjectsOfTypeAll<
                     Il2CppScheduleOne.Economy.SupplierStash>())
        {
            if (stash is null)
            {
                continue;
            }

            Add(
                stash,
                "supplier-stash",
                string.Empty,
                stash.name ?? "Supplier stash",
                stash.locationDescription ?? string.Empty,
                linkedPersonId: stash.Supplier?.ID ?? string.Empty,
                mechanics: new Dictionary<string, string>(StringComparer.Ordinal)
                {
                    ["cashAmountInLoadedSave"] = stash.CashAmount.ToString("R", CultureInfo.InvariantCulture),
                    ["storageSlotCount"] = (stash.Storage?.SlotCount ?? 0).ToString(CultureInfo.InvariantCulture),
                });
        }

        foreach (var location in Resources.FindObjectsOfTypeAll<
                     Il2CppScheduleOne.Economy.SupplierLocation>())
        {
            if (location is null)
            {
                continue;
            }

            var configuredSupplierIds = new List<string>();
            if (location.configs is not null)
            {
                for (var configIndex = 0;
                     configIndex < location.configs.Length;
                     configIndex++)
                {
                    var supplierId = location.configs[configIndex]?.SupplierID;
                    if (!string.IsNullOrWhiteSpace(supplierId))
                    {
                        configuredSupplierIds.Add(supplierId);
                    }
                }
            }
            Add(
                location,
                "supplier-meetup",
                string.Empty,
                location.LocationName ?? location.name ?? "Supplier meetup",
                location.LocationDescription ?? string.Empty,
                accessPoint: location.SupplierStandPoint,
                linkedPersonId: location.ActiveSupplier?.ID ?? string.Empty,
                mechanics: new Dictionary<string, string>(StringComparer.Ordinal)
                {
                    ["deliveryBayCount"] = (location.DeliveryBays?.Length ?? 0).ToString(CultureInfo.InvariantCulture),
                    ["configuredSupplierIds"] = string.Join(',', configuredSupplierIds
                        .Distinct(StringComparer.Ordinal)
                        .OrderBy(id => id, StringComparer.Ordinal)),
                });
        }

        foreach (var jeremy in Resources.FindObjectsOfTypeAll<
                     Il2CppScheduleOne.NPCs.CharacterClasses.Jeremy>())
        {
            if (jeremy?.Dealership is null)
            {
                continue;
            }

            var accessPoint = jeremy.Dealership.SpawnPoints is { Length: > 0 }
                ? jeremy.Dealership.SpawnPoints[0]
                : null;
            var service = Add(
                jeremy.Dealership,
                "vehicle-dealership",
                string.Empty,
                jeremy.Dealership.name ?? "Vehicle dealership",
                accessPoint: accessPoint,
                linkedPersonId: jeremy.ID);
            if (service is null || jeremy.Listings is null)
            {
                continue;
            }

            for (var listingIndex = 0;
                 listingIndex < jeremy.Listings.Count;
                 listingIndex++)
            {
                var listing = jeremy.Listings[listingIndex];
                if (listing is null)
                {
                    continue;
                }

                service.Listings.Add(new DiscoveryMapServiceListingSnapshot
                {
                    ItemId = listing.vehicleCode ?? string.Empty,
                    Name = listing.vehicleName ?? string.Empty,
                    Price = listing.price,
                });
            }
            service.Listings = service.Listings
                .OrderBy(listing => listing.ItemId, StringComparer.Ordinal)
                .ToList();
        }

        foreach (var game in Resources.FindObjectsOfTypeAll<
                     Il2CppScheduleOne.Casino.BlackjackGameController>())
        {
            if (game is null)
            {
                continue;
            }

            Add(
                game,
                "blackjack-table",
                string.Empty,
                game.name ?? "Blackjack table",
                mechanics: new Dictionary<string, string>(StringComparer.Ordinal)
                {
                    ["minimumBet"] = Il2CppScheduleOne.Casino.BlackjackGameController.MinimumBet.ToString(CultureInfo.InvariantCulture),
                    ["maximumBet"] = Il2CppScheduleOne.Casino.BlackjackGameController.MaximumBet.ToString(CultureInfo.InvariantCulture),
                    ["payoutRatio"] = Il2CppScheduleOne.Casino.BlackjackGameController.PayoutRatio.ToString("R", CultureInfo.InvariantCulture),
                    ["blackjackPayoutRatio"] = Il2CppScheduleOne.Casino.BlackjackGameController.BlackjackPayoutRatio.ToString("R", CultureInfo.InvariantCulture),
                });
        }

        foreach (var game in Resources.FindObjectsOfTypeAll<Il2CppScheduleOne.Casino.SlotMachine>())
        {
            if (game is null)
            {
                continue;
            }

            var bets = new List<string>();
            if (Il2CppScheduleOne.Casino.SlotMachine.BetAmounts is not null)
            {
                for (var index = 0;
                     index < Il2CppScheduleOne.Casino.SlotMachine.BetAmounts.Length;
                     index++)
                {
                    bets.Add(
                        Il2CppScheduleOne.Casino.SlotMachine.BetAmounts[index]
                            .ToString(CultureInfo.InvariantCulture));
                }
            }
            Add(
                game,
                "slot-machine",
                string.Empty,
                game.name ?? "Slot machine",
                mechanics: new Dictionary<string, string>(StringComparer.Ordinal)
                {
                    ["betAmounts"] = string.Join(',', bets),
                });
        }

        foreach (var lot in Resources.FindObjectsOfTypeAll<Il2CppScheduleOne.Map.ParkingLot>())
        {
            if (lot is null)
            {
                continue;
            }

            Add(
                lot,
                "parking-lot",
                lot.GUID.ToString(),
                lot.name ?? "Parking lot",
                accessPoint: lot.EntryPoint,
                mechanics: new Dictionary<string, string>(StringComparer.Ordinal)
                {
                    ["parkingSpotCount"] = (lot.ParkingSpots?.Count ?? 0).ToString(CultureInfo.InvariantCulture),
                    ["usesExitPoint"] = lot.UseExitPoint.ToString(),
                });
        }

        foreach (var pawnShop in Resources.FindObjectsOfTypeAll<
                     Il2CppScheduleOne.UI.PawnShopInterface>())
        {
            if (pawnShop is null)
            {
                continue;
            }

            Add(
                pawnShop,
                "pawn-shop",
                string.Empty,
                pawnShop.name ?? "Pawn shop",
                locationTransform: pawnShop.PawnShopNPC?.transform,
                locationSource: "linked-npc-loaded-position",
                linkedPersonId: pawnShop.PawnShopNPC?.ID ?? string.Empty,
                mechanics: new Dictionary<string, string>(StringComparer.Ordinal)
                {
                    ["minimumPayment"] = Il2CppScheduleOne.UI.PawnShopInterface.PAYMENT_MIN.ToString("R", CultureInfo.InvariantCulture),
                    ["maximumPayment"] = Il2CppScheduleOne.UI.PawnShopInterface.PAYMENT_MAX.ToString("R", CultureInfo.InvariantCulture),
                    ["maximumValueMultiplier"] = Il2CppScheduleOne.UI.PawnShopInterface.MAX_VALUE_MULTIPLIER.ToString("R", CultureInfo.InvariantCulture),
                    ["minimumValueMultiplier"] = Il2CppScheduleOne.UI.PawnShopInterface.MIN_VALUE_MULTIPLIER.ToString("R", CultureInfo.InvariantCulture),
                    ["pawnSlotCount"] = Il2CppScheduleOne.UI.PawnShopInterface.PAWN_SLOT_COUNT.ToString(CultureInfo.InvariantCulture),
                    ["thinkTime"] = Il2CppScheduleOne.UI.PawnShopInterface.THINK_TIME.ToString("R", CultureInfo.InvariantCulture),
                });
        }

        foreach (var seller in Resources.FindObjectsOfTypeAll<
                     Il2CppScheduleOne.Dialogue.DialogueController_SkateboardSeller>())
        {
            if (seller is null)
            {
                continue;
            }

            var service = Add(
                seller,
                "skateboard-seller",
                string.Empty,
                seller.name ?? "Skateboard seller");
            if (service is null || seller.Options is null)
            {
                continue;
            }
            for (var optionIndex = 0; optionIndex < seller.Options.Count; optionIndex++)
            {
                var option = seller.Options[optionIndex];
                if (option?.Item is null)
                {
                    continue;
                }
                service.Listings.Add(new DiscoveryMapServiceListingSnapshot
                {
                    ItemId = option.Item.ID,
                    Name = option.Item.Name ?? string.Empty,
                    Price = option.Price,
                });
            }
        }

        void AddCustomizationService(
            Il2CppScheduleOne.UI.CharacterCustomization.CharacterCustomizationUI ui,
            string kind,
            string name)
        {
            string FindCategoryName(
                Il2CppScheduleOne.UI.CharacterCustomization.CharacterCustomizationOption option)
            {
                var current = option.transform;
                while (current is not null)
                {
                    if (NormalizeName(current.parent?.name ?? string.Empty) == "container")
                    {
                        return current.name ?? string.Empty;
                    }

                    if (current == ui.transform)
                    {
                        break;
                    }
                    current = current.parent;
                }

                return string.Empty;
            }

            var shop = ui.CharacterCustomizationShop;
            var service = Add(
                ui,
                kind,
                string.Empty,
                name,
                accessPoint: shop?.CameraPosition,
                locationTransform: shop?.transform,
                locationSource: "character-customization-shop");
            if (service is null)
            {
                return;
            }
            var options = ui.GetComponentsInChildren<
                Il2CppScheduleOne.UI.CharacterCustomization.CharacterCustomizationOption>(true);
            for (var optionIndex = 0; optionIndex < options.Length; optionIndex++)
            {
                var option = options[optionIndex];
                if (option is null)
                {
                    continue;
                }
                service.Listings.Add(new DiscoveryMapServiceListingSnapshot
                {
                    ItemId = DiscoveryReflection.ObjectPath(option.transform),
                    Name = option.Label ?? option.Name ?? option.name ?? string.Empty,
                    Price = option.Price,
                    Category = FindCategoryName(option),
                    RequiresLevel = option.RequireLevel,
                    RequiredRank = option.RequireLevel
                        ? option.RequiredLevel.ToString()
                        : string.Empty,
                    Metadata = new Dictionary<string, string>(StringComparer.Ordinal)
                    {
                        ["assetName"] = option.Name ?? string.Empty,
                        ["label"] = option.Label ?? string.Empty,
                    },
                });
            }
        }

        foreach (var ui in Resources.FindObjectsOfTypeAll<
                     Il2CppScheduleOne.UI.CharacterCustomization.BarbershopUI>())
        {
            if (ui is not null)
            {
                AddCustomizationService(ui, "barbershop", ui.name ?? "Barbershop");
            }
        }
        foreach (var ui in Resources.FindObjectsOfTypeAll<
                     Il2CppScheduleOne.UI.CharacterCustomization.TattooShopUI>())
        {
            if (ui is not null)
            {
                AddCustomizationService(ui, "tattoo-shop", ui.name ?? "Tattoo shop");
            }
        }

        foreach (var menu in Resources.FindObjectsOfTypeAll<Il2CppScheduleOne.UI.VehicleModMenu>())
        {
            if (menu is null)
            {
                continue;
            }
            var service = Add(
                menu,
                "vehicle-repaint",
                string.Empty,
                menu.name ?? "Vehicle repaint",
                accessPoint: menu.VehiclePosition,
                locationTransform: menu.VehiclePosition,
                locationSource: "vehicle-position",
                mechanics: new Dictionary<string, string>(StringComparer.Ordinal)
                {
                    ["repaintCost"] = Il2CppScheduleOne.UI.VehicleModMenu.repaintCost.ToString("R", CultureInfo.InvariantCulture),
                    ["availableColorCount"] = (menu.colorToButton?.Count ?? 0).ToString(CultureInfo.InvariantCulture),
                });
            var colors = Il2CppScheduleOne.Vehicles.Modification.VehicleColors.Instance;
            if (service is null || colors?.colorLibrary is null)
            {
                continue;
            }
            for (var colorIndex = 0; colorIndex < colors.colorLibrary.Count; colorIndex++)
            {
                var color = colors.colorLibrary[colorIndex];
                if (color is null)
                {
                    continue;
                }
                service.Listings.Add(new DiscoveryMapServiceListingSnapshot
                {
                    ItemId = color.color.ToString(),
                    Name = color.colorName ?? color.color.ToString(),
                    Price = Il2CppScheduleOne.UI.VehicleModMenu.repaintCost,
                    DisplayColor = ColorSnapshot.FromColor(color.MaterialColor),
                    Metadata = new Dictionary<string, string>(StringComparer.Ordinal)
                    {
                        ["uiColor"] = ColorUtility.ToHtmlStringRGBA(color.UIColor),
                    },
                });
            }
        }
    }

    private static long NavigationGridKey(int x, int z) => ((long)z << 32) | (uint)x;

    private static void AddNavigationEdge(
        DiscoveryNavigationSnapshot navigation,
        IReadOnlyDictionary<long, int> sampleIndices,
        int fromIndex,
        int toX,
        int toZ)
    {
        if (!sampleIndices.TryGetValue(NavigationGridKey(toX, toZ), out var toIndex))
        {
            return;
        }

        var fromSnapshot = navigation.Samples[fromIndex].Position;
        var toSnapshot = navigation.Samples[toIndex].Position;
        var from = new Vector3(fromSnapshot.X, fromSnapshot.Y, fromSnapshot.Z);
        var to = new Vector3(toSnapshot.X, toSnapshot.Y, toSnapshot.Z);
        if (!NavMesh.Raycast(from, to, out _, NavMesh.AllAreas))
        {
            navigation.Edges.Add(fromIndex);
            navigation.Edges.Add(toIndex);
        }
    }

    private static void CollectTimedAccessZones(DiscoverySnapshot result)
    {
        var zones = Resources.FindObjectsOfTypeAll<Il2CppScheduleOne.Map.TimedAccessZone>();
        for (var index = 0; index < zones.Length; index++)
        {
            var zone = zones[index];
            if (zone is null || !DiscoveryReflection.IsSceneObject(zone.gameObject))
            {
                continue;
            }

            result.TimedAccessZones.Add(new DiscoveryTimedAccessZoneSnapshot
            {
                Id = DiscoveryReflection.ObjectPath(zone.transform),
                OpenTime = zone.OpenTime,
                CloseTime = zone.CloseTime,
                AllowExitWhenClosed = zone.AllowExitWhenClosed,
                AutoCloseDoor = zone.AutoCloseDoor,
                Position = VectorSnapshot3.FromVector(zone.transform.position),
                Rotation = VectorSnapshot3.FromVector(zone.transform.eulerAngles),
                SceneName = zone.gameObject.scene.name,
                DoorCount = zone.Doors?.Count ?? 0,
            });
        }

        result.TimedAccessZones = result.TimedAccessZones
            .OrderBy(x => x.Id, StringComparer.Ordinal)
            .ToList();
    }

}
