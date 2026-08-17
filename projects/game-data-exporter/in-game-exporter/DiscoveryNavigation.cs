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
        ConfigureNavigationGraph(result.Navigation);
        ConfigureNavigationGraph(result.PlayerNavigation);
        ConfigurePlayerRouteProbe(result.PlayerNavigation);
        result.PlayerNavigation.Applicability =
            "candidate-humanoid-navmesh-not-native-player-path-contract";
        CollectPlayerMovement(result.PlayerMovement);

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
            result.PlayerNavigation.Error =
                "No map bounds were available for navigation sampling.";
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
        SetNavigationBounds(result.Navigation, minX, maxX, minZ, maxZ, width, height);
        SetNavigationBounds(result.PlayerNavigation, minX, maxX, minZ, maxZ, width, height);

        if (EmployeeNavigationAgentTypeId(result.Navigation) is int employeeAgentTypeId)
        {
            SampleNavigationGraph(
                result.Navigation,
                employeeAgentTypeId,
                "employee",
                progress);
        }
        var playerAgentTypeId = PlayerNavigationAgentTypeId(
            result.PlayerNavigation,
            result.Navigation.Surfaces);
        CollectPlayerNavigationLinks(result.PlayerNavigation, playerAgentTypeId);
        if (playerAgentTypeId is int candidatePlayerAgentTypeId)
        {
            SampleNavigationGraph(
                result.PlayerNavigation,
                candidatePlayerAgentTypeId,
                "candidate player",
                progress);
        }
    }

    private static void ConfigureNavigationGraph(DiscoveryNavigationGraphSnapshot navigation)
    {
        navigation.Method = "sampled-navmesh-grid";
        navigation.SampleSpacing = 2f;
        navigation.QueryHeight = 0f;
        navigation.MaxSampleDistance = 12f;
    }

    private static void SetNavigationBounds(
        DiscoveryNavigationGraphSnapshot navigation,
        float minX,
        float maxX,
        float minZ,
        float maxZ,
        int width,
        int height)
    {
        navigation.BoundsMinimum = new VectorSnapshot3 { X = minX, Y = 0f, Z = minZ };
        navigation.BoundsMaximum = new VectorSnapshot3 { X = maxX, Y = 0f, Z = maxZ };
        navigation.GridWidth = width;
        navigation.GridHeight = height;
    }

    private static void SampleNavigationGraph(
        DiscoveryNavigationGraphSnapshot navigation,
        int agentTypeId,
        string progressSubject,
        Action<string>? progress)
    {
        var spacing = navigation.SampleSpacing;
        var minX = navigation.BoundsMinimum!.X;
        var minZ = navigation.BoundsMinimum!.Z;
        var width = navigation.GridWidth;
        var height = navigation.GridHeight;

        var sampleIndices = new Dictionary<long, int>();
        try
        {
            for (var zIndex = 0; zIndex < height; zIndex++)
            {
                var z = minZ + (zIndex * spacing);
                for (var xIndex = 0; xIndex < width; xIndex++)
                {
                    var x = minX + (xIndex * spacing);
                    var query = new Vector3(x, navigation.QueryHeight, z);
                    if (!NavMesh.SamplePositionFilter(
                            query,
                            out var hit,
                            navigation.MaxSampleDistance,
                            agentTypeId,
                            NavMesh.AllAreas) ||
                        MathF.Abs(hit.position.x - x) > spacing * 0.5f ||
                        MathF.Abs(hit.position.z - z) > spacing * 0.5f)
                    {
                        continue;
                    }

                    var sampleIndex = navigation.Samples.Count;
                    navigation.Samples.Add(new DiscoveryNavigationSampleSnapshot
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
                        $"Discovery 4/9 progress: sampled {zIndex + 1}/{height} " +
                        $"{progressSubject} navigation rows.");
                }
            }
        }
        catch (Exception exception)
        {
            navigation.Error =
                $"Sampling failed: {exception.GetType().Name}: {exception.Message}";
            return;
        }

        try
        {
            for (var index = 0; index < navigation.Samples.Count; index++)
            {
                var sample = navigation.Samples[index];
                AddNavigationEdge(
                    navigation,
                    sampleIndices,
                    index,
                    sample.GridX + 1,
                    sample.GridZ,
                    navigation.Agent);
                AddNavigationEdge(
                    navigation,
                    sampleIndices,
                    index,
                    sample.GridX,
                    sample.GridZ + 1,
                    navigation.Agent);
            }
        }
        catch (Exception exception)
        {
            navigation.EdgeError =
                $"Edge validation failed: {exception.GetType().Name}: {exception.Message}";
        }
    }

    private static void CollectPlayerMovement(DiscoveryPlayerMovementSnapshot movement)
    {
        movement.Source =
            "ScheduleOne.PlayerScripts.PlayerMovement-and-PlayerInventory-native-constants";
        movement.SpeedApplicability = "base-speeds-runtime-multipliers-not-applied";
        movement.InventoryCapacityApplicability =
            "slot-count-only-current-contents-and-stack-allocation-not-applied";
        movement.InventorySlotCount =
            Il2CppScheduleOne.PlayerScripts.PlayerInventory.InventorySlotCount;
        movement.WalkSpeed = Il2CppScheduleOne.PlayerScripts.PlayerMovement.WalkSpeed;
        movement.SprintMultiplier =
            Il2CppScheduleOne.PlayerScripts.PlayerMovement.SprintMultiplier;
        movement.SprintSpeed = movement.WalkSpeed * movement.SprintMultiplier;
        movement.CrouchSpeedMultiplier =
            Il2CppScheduleOne.PlayerScripts.PlayerMovement.CrouchSpeedMultipler;
        movement.CrouchSpeed = movement.WalkSpeed * movement.CrouchSpeedMultiplier;
        movement.DefaultControllerRadius =
            Il2CppScheduleOne.PlayerScripts.PlayerMovement.ControllerRadius;
        movement.DefaultStandingControllerHeight =
            Il2CppScheduleOne.PlayerScripts.PlayerMovement.DefaultCharacterControllerHeight;

        try
        {
            var loaded = Il2CppScheduleOne.PlayerScripts.PlayerMovement.Instance;
            var controller = loaded?.Controller;
            if (loaded is null || controller is null)
            {
                movement.Error = "No loaded player character controller was available.";
                return;
            }
            movement.LoadedController = new DiscoveryPlayerControllerSnapshot
            {
                Enabled = controller.enabled,
                Radius = controller.radius,
                Height = controller.height,
                Center = VectorSnapshot3.FromVector(controller.center),
                SlopeLimit = controller.slopeLimit,
                StepOffset = controller.stepOffset,
                SkinWidth = controller.skinWidth,
                MinimumMoveDistance = controller.minMoveDistance,
            };
        }
        catch (Exception exception)
        {
            movement.Error =
                $"Player controller collection failed: {exception.GetType().Name}: " +
                exception.Message;
        }
    }

    private static int? EmployeeNavigationAgentTypeId(
        DiscoveryNavigationSnapshot navigation)
    {
        var manager = Il2CppScheduleOne.Employees.EmployeeManager.Instance;
        if (manager is null)
        {
            navigation.Error = "EmployeeManager.Instance is unavailable.";
            return null;
        }

        var employeeTypesByAgentType = new Dictionary<int, List<string>>();
        foreach (var employeeType in Enum.GetValues<Il2CppScheduleOne.Employees.EEmployeeType>())
        {
            var prefab = manager.GetEmployeePrefab(employeeType);
            if (prefab is null)
            {
                continue;
            }
            var agent = prefab.GetComponentInChildren<NavMeshAgent>(true);
            if (agent is null)
            {
                navigation.Error = $"Employee prefab {employeeType} has no NavMeshAgent.";
                return null;
            }

            if (!employeeTypesByAgentType.TryGetValue(agent.agentTypeID, out var employeeTypes))
            {
                employeeTypes = new List<string>();
                employeeTypesByAgentType.Add(agent.agentTypeID, employeeTypes);
            }
            employeeTypes.Add(employeeType.ToString());
        }

        if (employeeTypesByAgentType.Count != 1)
        {
            navigation.Error =
                $"Employee prefabs use {employeeTypesByAgentType.Count} navigation agent types.";
            return null;
        }

        var entry = employeeTypesByAgentType.Single();
        var agentTypeId = entry.Key;
        if (!navigation.Surfaces.Any(surface => surface.AgentTypeId == agentTypeId))
        {
            navigation.Error = $"No loaded NavMeshSurface uses employee agent type {agentTypeId}.";
            return null;
        }

        var settings = NavMesh.GetSettingsByID(agentTypeId);
        var name = NavMesh.GetSettingsNameFromID(agentTypeId);
        if (string.IsNullOrWhiteSpace(name))
        {
            navigation.Error = $"Employee navigation agent type {agentTypeId} has no settings name.";
            return null;
        }
        if (!float.IsFinite(settings.agentRadius) || settings.agentRadius <= 0f ||
            !float.IsFinite(settings.agentHeight) || settings.agentHeight <= 0f ||
            !float.IsFinite(settings.agentSlope) || settings.agentSlope < 0f || settings.agentSlope >= 90f ||
            !float.IsFinite(settings.agentClimb) || settings.agentClimb < 0f)
        {
            navigation.Error = $"Employee navigation agent type {agentTypeId} has invalid movement settings.";
            return null;
        }

        navigation.Agent = new DiscoveryNavigationAgentSnapshot
        {
            Subject = "employees",
            Source = "employee-prefabs",
            TypeId = agentTypeId,
            Name = name,
            Radius = settings.agentRadius,
            Height = settings.agentHeight,
            MaximumSlope = settings.agentSlope,
            StepHeight = settings.agentClimb,
            EmployeeTypes = entry.Value.OrderBy(value => value, StringComparer.Ordinal).ToList(),
        };
        return agentTypeId;
    }

    private static int? PlayerNavigationAgentTypeId(
        DiscoveryPlayerNavigationSnapshot navigation,
        IReadOnlyList<DiscoveryNavMeshSurfaceSnapshot> surfaces)
    {
        const string expectedName = "Humanoid";
        var candidateAgentTypeIds = new HashSet<int>();
        try
        {
            for (var index = 0; index < surfaces.Count; index++)
            {
                var surfaceAgentTypeId = surfaces[index].AgentTypeId;
                if (string.Equals(
                        NavMesh.GetSettingsNameFromID(surfaceAgentTypeId),
                        expectedName,
                        StringComparison.Ordinal))
                {
                    candidateAgentTypeIds.Add(surfaceAgentTypeId);
                }
            }
        }
        catch (Exception exception)
        {
            navigation.Error =
                $"Player navigation agent discovery failed: {exception.GetType().Name}: " +
                exception.Message;
            return null;
        }

        if (candidateAgentTypeIds.Count != 1)
        {
            navigation.Error =
                $"Loaded navigation surfaces expose {candidateAgentTypeIds.Count} distinct " +
                $"agent types named {expectedName}.";
            return null;
        }

        var agentTypeId = candidateAgentTypeIds.Single();
        var settings = NavMesh.GetSettingsByID(agentTypeId);
        var name = NavMesh.GetSettingsNameFromID(agentTypeId);
        if (!float.IsFinite(settings.agentRadius) || settings.agentRadius <= 0f ||
            !float.IsFinite(settings.agentHeight) || settings.agentHeight <= 0f ||
            !float.IsFinite(settings.agentSlope) || settings.agentSlope < 0f ||
            settings.agentSlope >= 90f ||
            !float.IsFinite(settings.agentClimb) || settings.agentClimb < 0f)
        {
            navigation.Error =
                $"Player navigation agent type {agentTypeId} has invalid movement settings.";
            return null;
        }

        navigation.Agent = new DiscoveryNavigationAgentSnapshot
        {
            Subject = "player",
            Source = "loaded-navmesh-surface-named-humanoid",
            TypeId = agentTypeId,
            Name = name,
            Radius = settings.agentRadius,
            Height = settings.agentHeight,
            MaximumSlope = settings.agentSlope,
            StepHeight = settings.agentClimb,
        };
        return agentTypeId;
    }

    private static long NavigationGridKey(int x, int z) => ((long)z << 32) | (uint)x;

    private static void AddNavigationEdge(
        DiscoveryNavigationGraphSnapshot navigation,
        IReadOnlyDictionary<long, int> sampleIndices,
        int fromIndex,
        int toX,
        int toZ,
        DiscoveryNavigationAgentSnapshot agent)
    {
        if (!sampleIndices.TryGetValue(NavigationGridKey(toX, toZ), out var toIndex))
        {
            return;
        }

        var fromSnapshot = navigation.Samples[fromIndex].Position;
        var toSnapshot = navigation.Samples[toIndex].Position;
        var deltaX = fromSnapshot.X - toSnapshot.X;
        var deltaZ = fromSnapshot.Z - toSnapshot.Z;
        var horizontalDistance = MathF.Sqrt(deltaX * deltaX + deltaZ * deltaZ);
        var maximumRise =
            horizontalDistance * MathF.Tan(agent.MaximumSlope * (MathF.PI / 180f)) +
            agent.StepHeight;
        var tolerance = 1e-5f * MathF.Max(1f, maximumRise);
        if (MathF.Abs(fromSnapshot.Y - toSnapshot.Y) > maximumRise + tolerance)
        {
            return;
        }
        var from = new Vector3(fromSnapshot.X, fromSnapshot.Y, fromSnapshot.Z);
        var to = new Vector3(toSnapshot.X, toSnapshot.Y, toSnapshot.Z);
        if (!NavMesh.RaycastFilter(from, to, out _, agent.TypeId, NavMesh.AllAreas))
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
