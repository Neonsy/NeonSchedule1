using Il2Cpp;
using Il2CppInterop.Runtime;
using Il2CppPathfinding;
using Il2CppScheduleOne.Vehicles;
using Il2CppScheduleOne.Vehicles.AI;
using UnityEngine;

namespace NeonSchedule1.GameDataExporter;

internal static partial class DiscoveryCollector
{
    private static void CollectVehicleNavigation(DiscoverySnapshot result)
    {
        var navigation = result.VehicleNavigation;
        navigation.Method =
            "native-astar-point-graphs-prefab-agent-profiles-and-endpoint-node-proximity";
        navigation.Applicability =
            "static-vehicle-topology-configuration-and-guide-endpoint-evidence";
        navigation.Limitation =
            "Does not execute NavigationUtility.CalculatePath, VehicleAgent.Navigate, " +
            "collision avoidance, traffic, dynamic obstacles, teleport fallback, or live driving. " +
            "NavigationSettings are supplied per call and are not one static vehicle profile.";
        navigation.AgentProfileApplicability =
            "vehicle-manager-prefabs-without-initialize-vehicle-data-derived-fields-may-be-zero";
        navigation.EndpointMappingMethod =
            "nearest-walkable-point-graph-node-by-euclidean-distance";

        var errors = new List<string>();
        try
        {
            CollectVehicleNavigationConstants(navigation);
        }
        catch (Exception exception)
        {
            errors.Add(
                $"Vehicle constants failed: {exception.GetType().Name}: {exception.Message}");
        }

        var capturedGraphs = new List<CapturedVehicleGraph>();
        try
        {
            CollectVehicleGraphs(navigation, capturedGraphs, errors);
        }
        catch (Exception exception)
        {
            errors.Add(
                $"Vehicle graphs failed: {exception.GetType().Name}: {exception.Message}");
        }

        try
        {
            CollectVehicleNodeLinks(navigation);
        }
        catch (Exception exception)
        {
            errors.Add(
                $"Vehicle links failed: {exception.GetType().Name}: {exception.Message}");
        }

        try
        {
            CollectVehicleAgentProfiles(navigation);
        }
        catch (Exception exception)
        {
            errors.Add(
                $"Vehicle agent profiles failed: {exception.GetType().Name}: " +
                exception.Message);
        }

        try
        {
            CollectVehicleEndpointMappings(result, navigation);
        }
        catch (Exception exception)
        {
            errors.Add(
                $"Vehicle endpoint mapping failed: {exception.GetType().Name}: " +
                exception.Message);
        }

        navigation.Error = string.Join(" ", errors);
    }

    private static void CollectVehicleNavigationConstants(
        DiscoveryVehicleNavigationSnapshot navigation)
    {
        navigation.VehicleGraphName = VehicleAgent.VehicleGraphName ?? string.Empty;
        navigation.RoadGraphName = VehicleAgent.RoadGraphName ?? string.Empty;
        navigation.MainGraphSamplePoint =
            VectorSnapshot3.FromVector(VehicleAgent.MainGraphSamplePoint);
        navigation.RoadPathCostMultiplier = NavigationUtility.ROAD_MULTIPLIER;
        navigation.OffroadPathCostMultiplier = NavigationUtility.OFFROAD_MULTIPLIER;
        navigation.MaximumDistanceFromPath = VehicleAgent.MaxDistanceFromPath;
        navigation.MaximumDistanceFromPathWhenReversing =
            VehicleAgent.MaxDistanceFromPathWhenReversing;
        navigation.MinimumRenavigationRate = VehicleAgent.MinRenavigationRate;
        navigation.DestinationSlowDistance =
            VehicleAgent.DestinationDistanceSlowThreshold;
        navigation.DestinationArrivalDistance =
            VehicleAgent.DestinationArrivalThreshold;
        navigation.UnmarkedSpeed = VehicleAgent.UnmarkedSpeed;
        navigation.ReverseSpeed = VehicleAgent.ReverseSpeed;
        navigation.KinematicModeSpeedMultiplier =
            VehicleAgent.KinematicModeSpeedMultiplier;
        navigation.ObstacleMinimumRange = VehicleAgent.OBSTACLE_MIN_RANGE;
        navigation.ObstacleMaximumRange = VehicleAgent.OBSTACLE_MAX_RANGE;
    }

    private static void CollectVehicleGraphs(
        DiscoveryVehicleNavigationSnapshot navigation,
        List<CapturedVehicleGraph> capturedGraphs,
        List<string> errors)
    {
        if (string.IsNullOrWhiteSpace(navigation.VehicleGraphName) ||
            string.IsNullOrWhiteSpace(navigation.RoadGraphName))
        {
            errors.Add("Native vehicle graph names are unavailable.");
            return;
        }

        var active = AstarPath.active;
        var graphs = active?.data?.graphs;
        if (active is null || graphs is null)
        {
            errors.Add("AstarPath.active data or graphs are unavailable.");
            return;
        }

        navigation.OwnerObjectPath = DiscoveryReflection.ObjectPath(active.transform);
        navigation.OwnerSceneName = active.gameObject.scene.name;

        try
        {
            var tagNames = active.GetTagNames();
            if (tagNames is not null)
            {
                for (var index = 0; index < tagNames.Length; index++)
                {
                    navigation.TagNames.Add(tagNames[index] ?? string.Empty);
                }
            }
        }
        catch (Exception exception)
        {
            errors.Add(
                $"A* tag names failed: {exception.GetType().Name}: {exception.Message}");
        }

        var nodeAddresses = new Dictionary<IntPtr, VehicleNodeAddress>();
        for (var graphArrayIndex = 0;
             graphArrayIndex < graphs.Length;
             graphArrayIndex++)
        {
            var graph = graphs[graphArrayIndex];
            if (graph is null)
            {
                continue;
            }

            var graphName = graph.name ?? string.Empty;
            var role = string.Equals(
                graphName,
                navigation.VehicleGraphName,
                StringComparison.Ordinal)
                ? "general"
                : string.Equals(
                    graphName,
                    navigation.RoadGraphName,
                    StringComparison.Ordinal)
                    ? "road"
                    : string.Empty;
            if (role.Length == 0)
            {
                continue;
            }

            var pointGraph = graph.TryCast<PointGraph>();
            var root = pointGraph?.root;
            var graphSnapshot = new DiscoveryVehicleGraphSnapshot
            {
                Role = role,
                ArrayIndex = graphArrayIndex,
                RuntimeGraphIndex = graph.graphIndex,
                Name = graphName,
                RuntimeType = DiscoveryReflection.RuntimeTypeName(graph),
                Guid = graph.guid.ToString(),
                InitialPenalty = graph.initialPenalty,
                RootObjectPath = root is null
                    ? string.Empty
                    : DiscoveryReflection.ObjectPath(root),
                SceneName = root is null ? string.Empty : root.gameObject.scene.name,
            };
            navigation.Graphs.Add(graphSnapshot);

            if (pointGraph is null)
            {
                graphSnapshot.Error =
                    $"Expected a PointGraph but found {graphSnapshot.RuntimeType}.";
                continue;
            }

            var capturedNodes = new List<CapturedVehicleNode>();
            capturedGraphs.Add(new CapturedVehicleGraph(
                graphSnapshot,
                pointGraph,
                capturedNodes));
            try
            {
                graphSnapshot.DeclaredNodeCount = pointGraph.nodeCount;
                var nodes = pointGraph.nodes;
                if (nodes is null)
                {
                    graphSnapshot.Error = "PointGraph nodes are unavailable.";
                    continue;
                }

                for (var nodeIndex = 0; nodeIndex < nodes.Length; nodeIndex++)
                {
                    var node = nodes[nodeIndex];
                    if (node is null)
                    {
                        continue;
                    }

                    var nodeSnapshot = new DiscoveryVehicleGraphNodeSnapshot
                    {
                        Index = nodeIndex,
                        Position = VectorSnapshot3.FromVector((Vector3)node.position),
                        Walkable = node.Walkable,
                        Penalty = node.Penalty,
                        Tag = node.Tag,
                        RuntimeGraphIndex = node.GraphIndex,
                    };
                    graphSnapshot.Nodes.Add(nodeSnapshot);
                    capturedNodes.Add(new CapturedVehicleNode(node, nodeSnapshot));
                    if (!nodeAddresses.TryAdd(
                            node.Pointer,
                            new VehicleNodeAddress(graphArrayIndex, nodeIndex)))
                    {
                        graphSnapshot.Error = AppendVehicleError(
                            graphSnapshot.Error,
                            $"Node pointer at index {nodeIndex} is duplicated.");
                    }
                }

                if (graphSnapshot.DeclaredNodeCount != graphSnapshot.Nodes.Count)
                {
                    graphSnapshot.Error = AppendVehicleError(
                        graphSnapshot.Error,
                        $"Declared {graphSnapshot.DeclaredNodeCount} nodes but captured " +
                        $"{graphSnapshot.Nodes.Count}.");
                }
            }
            catch (Exception exception)
            {
                graphSnapshot.Error = AppendVehicleError(
                    graphSnapshot.Error,
                    $"Node collection failed: {exception.GetType().Name}: " +
                    exception.Message);
            }
        }

        for (var graphIndex = 0; graphIndex < capturedGraphs.Count; graphIndex++)
        {
            CollectVehicleGraphConnections(
                capturedGraphs[graphIndex],
                nodeAddresses);
        }

        navigation.Graphs = navigation.Graphs
            .OrderBy(graph => graph.ArrayIndex)
            .ToList();
        var generalCount = navigation.Graphs.Count(graph => graph.Role == "general");
        var roadCount = navigation.Graphs.Count(graph => graph.Role == "road");
        if (generalCount != 1 || roadCount != 1)
        {
            errors.Add(
                $"Expected one general and one road vehicle graph but found " +
                $"{generalCount} general and {roadCount} road graphs.");
        }
    }

    private static void CollectVehicleGraphConnections(
        CapturedVehicleGraph graph,
        IReadOnlyDictionary<IntPtr, VehicleNodeAddress> nodeAddresses)
    {
        for (var nodeIndex = 0; nodeIndex < graph.Nodes.Count; nodeIndex++)
        {
            var node = graph.Nodes[nodeIndex];
            try
            {
                AddVehicleConnections(
                    graph.Snapshot,
                    node,
                    node.Node.connections,
                    loose: false,
                    nodeAddresses);
                AddVehicleConnections(
                    graph.Snapshot,
                    node,
                    node.Node.looseConnections,
                    loose: true,
                    nodeAddresses);
                node.Snapshot.Connections = node.Snapshot.Connections
                    .OrderBy(connection => connection.TargetGraphArrayIndex ?? int.MaxValue)
                    .ThenBy(connection => connection.TargetNodeIndex ?? int.MaxValue)
                    .ThenBy(connection => connection.Loose)
                    .ThenBy(connection => connection.Cost)
                    .ToList();
            }
            catch (Exception exception)
            {
                graph.Snapshot.Error = AppendVehicleError(
                    graph.Snapshot.Error,
                    $"Connections for node {node.Snapshot.Index} failed: " +
                    $"{exception.GetType().Name}: {exception.Message}");
            }
        }
    }

    private static void AddVehicleConnections(
        DiscoveryVehicleGraphSnapshot graph,
        CapturedVehicleNode source,
        Il2CppInterop.Runtime.InteropTypes.Arrays.Il2CppReferenceArray<Connection>?
            connections,
        bool loose,
        IReadOnlyDictionary<IntPtr, VehicleNodeAddress> nodeAddresses)
    {
        if (connections is null)
        {
            return;
        }

        for (var index = 0; index < connections.Length; index++)
        {
            var connection = connections[index];
            if (connection is null)
            {
                graph.UnresolvedConnectionCount++;
                continue;
            }
            var target = connection.node;
            VehicleNodeAddress? address = null;
            if (target is not null &&
                nodeAddresses.TryGetValue(target.Pointer, out var foundAddress))
            {
                address = foundAddress;
            }
            if (address is null)
            {
                graph.UnresolvedConnectionCount++;
            }
            source.Snapshot.Connections.Add(
                new DiscoveryVehicleGraphConnectionSnapshot
                {
                    Loose = loose,
                    TargetGraphArrayIndex = address?.GraphArrayIndex,
                    TargetNodeIndex = address?.NodeIndex,
                    TargetRuntimeGraphIndex = target?.GraphIndex ?? 0,
                    Cost = connection.cost,
                    ShapeEdge = connection.shapeEdge,
                });
        }
    }

    private static void CollectVehicleNodeLinks(
        DiscoveryVehicleNavigationSnapshot navigation)
    {
        var links = Resources.FindObjectsOfTypeAll<NodeLink>();
        for (var index = 0; index < links.Length; index++)
        {
            var link = links[index];
            if (link is null || !DiscoveryReflection.IsSceneObject(link.gameObject))
            {
                continue;
            }

            try
            {
                navigation.Links.Add(new DiscoveryVehicleNodeLinkSnapshot
                {
                    ObjectPath = DiscoveryReflection.ObjectPath(link.transform),
                    SceneName = link.gameObject.scene.name,
                    Enabled = link.enabled,
                    ActiveInHierarchy = link.gameObject.activeInHierarchy,
                    StartPosition = link.Start is null
                        ? null
                        : VectorSnapshot3.FromVector(link.Start.position),
                    EndPosition = link.End is null
                        ? null
                        : VectorSnapshot3.FromVector(link.End.position),
                    CostFactor = link.costFactor,
                    OneWay = link.oneWay,
                    DeleteConnection = link.deleteConnection,
                });
            }
            catch (Exception exception)
            {
                navigation.Links.Add(new DiscoveryVehicleNodeLinkSnapshot
                {
                    ObjectPath = DiscoveryReflection.ObjectPath(link.transform),
                    SceneName = link.gameObject.scene.name,
                    Error = $"{exception.GetType().Name}: {exception.Message}",
                });
            }
        }

        navigation.Links = navigation.Links
            .OrderBy(link => link.ObjectPath, StringComparer.Ordinal)
            .ToList();
    }

    private static void CollectVehicleAgentProfiles(
        DiscoveryVehicleNavigationSnapshot navigation)
    {
        var manager = VehicleManager.Instance;
        var prefabs = manager?.VehiclePrefabs;
        if (prefabs is null)
        {
            navigation.AgentProfiles.Add(new DiscoveryVehicleAgentProfileSnapshot
            {
                Source = "VehicleManager.VehiclePrefabs",
                Error = "VehicleManager prefabs are unavailable.",
            });
            return;
        }

        for (var index = 0; index < prefabs.Count; index++)
        {
            var vehicle = prefabs[index];
            if (vehicle is null || string.IsNullOrWhiteSpace(vehicle.VehicleCode))
            {
                continue;
            }

            try
            {
                var agent = vehicle.Agent;
                if (agent is null)
                {
                    navigation.AgentProfiles.Add(
                        new DiscoveryVehicleAgentProfileSnapshot
                        {
                            VehicleCode = vehicle.VehicleCode,
                            VehicleName = vehicle.VehicleName ?? string.Empty,
                            Source = "VehicleManager.VehiclePrefabs",
                            TopSpeed = vehicle.TopSpeed,
                            Error = "Vehicle prefab has no VehicleAgent.",
                        });
                    continue;
                }

                var bounds = vehicle.BoundingBoxDimensions;
                navigation.AgentProfiles.Add(
                    new DiscoveryVehicleAgentProfileSnapshot
                    {
                        VehicleCode = vehicle.VehicleCode,
                        VehicleName = vehicle.VehicleName ?? string.Empty,
                        Source = "VehicleManager.VehiclePrefabs",
                        TopSpeed = vehicle.TopSpeed,
                        ReverseMultiplier = vehicle.reverseMultiplier,
                        BoundingBoxDimensions = VectorSnapshot3.FromVector(bounds),
                        ActualMaximumSteeringAngle = vehicle.ActualMaxSteeringAngle,
                        VehicleLength = agent.vehicleLength,
                        VehicleWidth = agent.vehicleWidth,
                        TurnRadius = agent.turnRadius,
                        MinimumSampleStepSize = agent.sampleStepSizeMin,
                        MaximumSampleStepSize = agent.sampleStepSizeMax,
                        MinimumTurningSpeed = agent.minTurningSpeed,
                        MinimumThrottle = agent.throttleMin,
                        MaximumThrottle = agent.throttleMax,
                        TurnSpeedReductionMinimumRange =
                            agent.turnSpeedReductionMinRange,
                        TurnSpeedReductionMaximumRange =
                            agent.turnSpeedReductionMaxRange,
                        TurnSpeedReductionDivisor = agent.turnSpeedReductionDivisor,
                        MinimumTurnSpeedReductionAngle =
                            agent.minTurnSpeedReductionAngleThreshold,
                        DriveFlags = SnapshotVehicleDriveFlags(agent.Flags),
                        GeneralSeeker = SnapshotVehicleSeeker(agent.generalSeeker),
                        RoadSeeker = SnapshotVehicleSeeker(agent.roadSeeker),
                    });
            }
            catch (Exception exception)
            {
                navigation.AgentProfiles.Add(
                    new DiscoveryVehicleAgentProfileSnapshot
                    {
                        VehicleCode = vehicle.VehicleCode,
                        VehicleName = vehicle.VehicleName ?? string.Empty,
                        Source = "VehicleManager.VehiclePrefabs",
                        Error = $"{exception.GetType().Name}: {exception.Message}",
                    });
            }
        }

        navigation.AgentProfiles = navigation.AgentProfiles
            .OrderBy(profile => profile.VehicleCode, StringComparer.Ordinal)
            .ToList();
    }

    private static DiscoveryVehicleDriveFlagsSnapshot? SnapshotVehicleDriveFlags(
        DriveFlags? flags)
    {
        if (flags is null)
        {
            return null;
        }
        return new DiscoveryVehicleDriveFlagsSnapshot
        {
            OverrideSpeed = flags.OverrideSpeed,
            OverriddenSpeed = flags.OverriddenSpeed,
            OverriddenReverseSpeed = flags.OverriddenReverseSpeed,
            SpeedLimitMultiplier = flags.SpeedLimitMultiplier,
            UseRoads = flags.UseRoads,
            ObstacleMode = flags.ObstacleMode.ToString(),
            AutoBrakeAtDestination = flags.AutoBrakeAtDestination,
            TurnBasedSpeedReduction = flags.TurnBasedSpeedReduction,
        };
    }

    private static DiscoveryVehicleSeekerSnapshot SnapshotVehicleSeeker(Seeker? seeker)
    {
        if (seeker is null)
        {
            return new DiscoveryVehicleSeekerSnapshot();
        }

        var penalties = new List<int>();
        if (seeker.tagPenalties is not null)
        {
            for (var index = 0; index < seeker.tagPenalties.Length; index++)
            {
                penalties.Add(seeker.tagPenalties[index]);
            }
        }
        return new DiscoveryVehicleSeekerSnapshot
        {
            Available = true,
            GraphMask = seeker.graphMask,
            TraversableTags = seeker.traversableTags,
            TagPenalties = penalties,
        };
    }

    private static void CollectVehicleEndpointMappings(
        DiscoverySnapshot result,
        DiscoveryVehicleNavigationSnapshot navigation)
    {
        for (var graphIndex = 0; graphIndex < navigation.Graphs.Count; graphIndex++)
        {
            var graph = navigation.Graphs[graphIndex];
            for (var propertyIndex = 0;
                 propertyIndex < result.PropertyLayouts.Count;
                 propertyIndex++)
            {
                var property = result.PropertyLayouts[propertyIndex];
                if (property.SpawnPoint is null)
                {
                    continue;
                }
                AddVehicleEndpointMapping(
                    navigation,
                    graph,
                    "property-spawn",
                    property.PropertyCode,
                    string.Empty,
                    0,
                    property.SpawnPoint.Position);
            }

            for (var shopIndex = 0; shopIndex < result.ShopDetails.Count; shopIndex++)
            {
                var shop = result.ShopDetails[shopIndex];
                var endpoints = PlayerRouteEndpoints(shop);
                for (var endpointIndex = 0;
                     endpointIndex < endpoints.Count;
                     endpointIndex++)
                {
                    var endpoint = endpoints[endpointIndex];
                    AddVehicleEndpointMapping(
                        navigation,
                        graph,
                        endpoint.Kind,
                        shop.Code,
                        shop.HolderInstanceKey,
                        endpoint.Index,
                        VectorSnapshot3.FromVector(endpoint.Position));
                }
            }
        }

        navigation.EndpointMappings = navigation.EndpointMappings
            .OrderBy(mapping => mapping.SubjectKind, StringComparer.Ordinal)
            .ThenBy(mapping => mapping.SubjectCode, StringComparer.Ordinal)
            .ThenBy(mapping => mapping.SubjectInstanceKey, StringComparer.Ordinal)
            .ThenBy(mapping => mapping.EndpointIndex)
            .ThenBy(mapping => mapping.GraphArrayIndex)
            .ToList();
    }

    private static void AddVehicleEndpointMapping(
        DiscoveryVehicleNavigationSnapshot navigation,
        DiscoveryVehicleGraphSnapshot graph,
        string subjectKind,
        string subjectCode,
        string subjectInstanceKey,
        int endpointIndex,
        VectorSnapshot3 position)
    {
        var nearest = graph.Nodes
            .Where(node => node.Walkable)
            .Select(node => new
            {
                Node = node,
                Distance = Vector3.Distance(
                    ToVector(position),
                    ToVector(node.Position)),
            })
            .OrderBy(candidate => candidate.Distance)
            .ThenBy(candidate => candidate.Node.Index)
            .FirstOrDefault();
        navigation.EndpointMappings.Add(
            new DiscoveryVehicleEndpointMappingSnapshot
            {
                SubjectKind = subjectKind,
                SubjectCode = subjectCode,
                SubjectInstanceKey = subjectInstanceKey,
                EndpointIndex = endpointIndex,
                Position = position,
                GraphRole = graph.Role,
                GraphName = graph.Name,
                GraphArrayIndex = graph.ArrayIndex,
                NearestNodeIndex = nearest?.Node.Index,
                NearestNodePosition = nearest?.Node.Position,
                Distance = nearest?.Distance,
                Error = nearest is null ? "Graph has no walkable captured nodes." : string.Empty,
            });
    }

    private static string AppendVehicleError(string current, string addition) =>
        current.Length == 0 ? addition : $"{current} {addition}";

    private sealed record CapturedVehicleGraph(
        DiscoveryVehicleGraphSnapshot Snapshot,
        PointGraph Graph,
        List<CapturedVehicleNode> Nodes);

    private sealed record CapturedVehicleNode(
        PointNode Node,
        DiscoveryVehicleGraphNodeSnapshot Snapshot);

    private sealed record VehicleNodeAddress(
        int GraphArrayIndex,
        int NodeIndex);
}
