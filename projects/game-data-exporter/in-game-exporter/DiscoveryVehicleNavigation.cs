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
            "native-astar-generic-graphs-mesh-geometry-prefab-agent-profiles-and-endpoint-projection";
        navigation.Applicability =
            "static-vehicle-topology-configuration-and-guide-endpoint-evidence";
        navigation.Limitation =
            "Does not execute NavigationUtility.CalculatePath, VehicleAgent.Navigate, " +
            "collision avoidance, traffic, dynamic obstacles, teleport fallback, or live driving. " +
            "NavigationSettings are supplied per call and are not one static vehicle profile. " +
            "Endpoint projection uses captured triangle surfaces when available and node " +
            "positions otherwise.";
        navigation.AgentProfileApplicability =
            "vehicle-manager-prefabs-without-initialize-vehicle-data-derived-fields-may-be-zero";
        navigation.EndpointMappingMethod =
            "nearest-walkable-captured-node-by-graph-geometry-distance";

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
            CollectVehicleEndpointMappings(result, navigation, capturedGraphs);
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

            var root = graph.TryCast<PointGraph>()?.root;
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

            var capturedNodes = new List<CapturedVehicleNode>();
            capturedGraphs.Add(new CapturedVehicleGraph(
                graphSnapshot,
                capturedNodes));
            try
            {
                graphSnapshot.DeclaredNodeCount = graph.CountNodes();
                var nextNodeIndex = 0;
                System.Action<GraphNode> captureNode = node =>
                {
                    var nodeIndex = nextNodeIndex++;
                    if (node is null)
                    {
                        graphSnapshot.Error = AppendVehicleError(
                            graphSnapshot.Error,
                            $"Node callback at index {nodeIndex} returned null.");
                        return;
                    }

                    var nodeSnapshot = SnapshotVehicleGraphNode(nodeIndex, node);
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
                };
                Il2CppSystem.Action<GraphNode> nativeCaptureNode = captureNode;
                graph.GetNodes(nativeCaptureNode);
                GC.KeepAlive(nativeCaptureNode);

                if (graphSnapshot.DeclaredNodeCount != graphSnapshot.Nodes.Count)
                {
                    graphSnapshot.Error = AppendVehicleError(
                        graphSnapshot.Error,
                        $"Declared {graphSnapshot.DeclaredNodeCount} nodes but captured " +
                        $"{graphSnapshot.Nodes.Count}.");
                }
                if (graphSnapshot.Nodes.Count == 0)
                {
                    graphSnapshot.Error = AppendVehicleError(
                        graphSnapshot.Error,
                        "Graph contains no captured nodes.");
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
        for (var graphIndex = 0; graphIndex < navigation.Graphs.Count; graphIndex++)
        {
            var graph = navigation.Graphs[graphIndex];
            if (graph.Error.Length > 0)
            {
                errors.Add($"{graph.Role} vehicle graph: {graph.Error}");
            }
        }
    }

    private static DiscoveryVehicleGraphNodeSnapshot SnapshotVehicleGraphNode(
        int nodeIndex,
        GraphNode node)
    {
        var pointNode = node.TryCast<PointNode>();
        var meshNode = node.TryCast<MeshNode>();
        var triangleNode = node.TryCast<TriangleMeshNode>();
        var snapshot = new DiscoveryVehicleGraphNodeSnapshot
        {
            Index = nodeIndex,
            RuntimeType = DiscoveryReflection.RuntimeTypeName(node),
            GeometryKind = triangleNode is not null
                ? "triangle-mesh"
                : meshNode is not null
                    ? "mesh"
                    : pointNode is not null
                        ? "point"
                        : "node-position",
            Position = VectorSnapshot3.FromVector((Vector3)node.position),
            Walkable = node.Walkable,
            Penalty = node.Penalty,
            Tag = node.Tag,
            RuntimeGraphIndex = node.GraphIndex,
        };
        if (meshNode is null)
        {
            return snapshot;
        }

        try
        {
            snapshot.DeclaredVertexCount = meshNode.GetVertexCount();
            for (var vertexIndex = 0;
                 vertexIndex < snapshot.DeclaredVertexCount;
                 vertexIndex++)
            {
                snapshot.Vertices.Add(
                    VectorSnapshot3.FromVector((Vector3)meshNode.GetVertex(vertexIndex)));
            }
        }
        catch (Exception exception)
        {
            snapshot.Error =
                $"Geometry collection failed: {exception.GetType().Name}: " +
                exception.Message;
        }
        return snapshot;
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
                var pointNode = node.Node.TryCast<PointNode>();
                var meshNode = node.Node.TryCast<MeshNode>();
                if (pointNode is not null)
                {
                    AddVehicleConnections(
                        graph.Snapshot,
                        node,
                        pointNode.connections,
                        loose: false,
                        nodeAddresses);
                    AddVehicleConnections(
                        graph.Snapshot,
                        node,
                        pointNode.looseConnections,
                        loose: true,
                        nodeAddresses);
                }
                else if (meshNode is not null)
                {
                    AddVehicleConnections(
                        graph.Snapshot,
                        node,
                        meshNode.connections,
                        loose: false,
                        nodeAddresses);
                }
                else
                {
                    node.Snapshot.Error = AppendVehicleError(
                        node.Snapshot.Error,
                        "Connection data are unavailable for this node type.");
                }
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
        var nodeErrorCount = graph.Nodes.Count(node => node.Snapshot.Error.Length > 0);
        if (nodeErrorCount > 0)
        {
            graph.Snapshot.Error = AppendVehicleError(
                graph.Snapshot.Error,
                $"{nodeErrorCount} nodes have collection errors.");
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
        DiscoveryVehicleNavigationSnapshot navigation,
        IReadOnlyList<CapturedVehicleGraph> capturedGraphs)
    {
        for (var graphIndex = 0; graphIndex < capturedGraphs.Count; graphIndex++)
        {
            var graph = capturedGraphs[graphIndex];
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
        CapturedVehicleGraph graph,
        string subjectKind,
        string subjectCode,
        string subjectInstanceKey,
        int endpointIndex,
        VectorSnapshot3 position)
    {
        var endpoint = ToVector(position);
        VehicleEndpointCandidate? nearest = null;
        for (var nodeIndex = 0; nodeIndex < graph.Nodes.Count; nodeIndex++)
        {
            var node = graph.Nodes[nodeIndex];
            if (!node.Snapshot.Walkable)
            {
                continue;
            }
            var graphPosition = ClosestVehicleGraphPoint(
                node.Snapshot,
                endpoint,
                out var projectionMethod);
            var graphDistance = Vector3.Distance(endpoint, graphPosition);
            if (nearest is not null &&
                (graphDistance > nearest.GraphDistance ||
                 (graphDistance == nearest.GraphDistance &&
                  node.Snapshot.Index >= nearest.Node.Snapshot.Index)))
            {
                continue;
            }
            nearest = new VehicleEndpointCandidate(
                node,
                graphPosition,
                projectionMethod,
                Vector3.Distance(endpoint, ToVector(node.Snapshot.Position)),
                graphDistance);
        }
        navigation.EndpointMappings.Add(
            new DiscoveryVehicleEndpointMappingSnapshot
            {
                SubjectKind = subjectKind,
                SubjectCode = subjectCode,
                SubjectInstanceKey = subjectInstanceKey,
                EndpointIndex = endpointIndex,
                Position = position,
                GraphRole = graph.Snapshot.Role,
                GraphName = graph.Snapshot.Name,
                GraphArrayIndex = graph.Snapshot.ArrayIndex,
                NearestNodeIndex = nearest?.Node.Snapshot.Index,
                NearestNodePosition = nearest?.Node.Snapshot.Position,
                NearestGraphPosition = nearest is null
                    ? null
                    : VectorSnapshot3.FromVector(nearest.GraphPosition),
                ProjectionMethod = nearest?.ProjectionMethod ?? string.Empty,
                NodeCenterDistance = nearest?.NodeCenterDistance,
                GraphDistance = nearest?.GraphDistance,
                Error = nearest is null ? "Graph has no walkable captured nodes." : string.Empty,
            });
    }

    private static Vector3 ClosestVehicleGraphPoint(
        DiscoveryVehicleGraphNodeSnapshot node,
        Vector3 point,
        out string method)
    {
        if (node.GeometryKind != "triangle-mesh" || node.Vertices.Count != 3)
        {
            method = "node-position";
            return ToVector(node.Position);
        }

        method = "triangle-surface";
        return ClosestPointOnTriangle(
            point,
            ToVector(node.Vertices[0]),
            ToVector(node.Vertices[1]),
            ToVector(node.Vertices[2]));
    }

    private static Vector3 ClosestPointOnTriangle(
        Vector3 point,
        Vector3 first,
        Vector3 second,
        Vector3 third)
    {
        var firstSecond = second - first;
        var firstThird = third - first;
        var firstPoint = point - first;
        var firstSecondProjection = Vector3.Dot(firstSecond, firstPoint);
        var firstThirdProjection = Vector3.Dot(firstThird, firstPoint);
        if (firstSecondProjection <= 0f && firstThirdProjection <= 0f)
        {
            return first;
        }

        var secondPoint = point - second;
        var secondFirstProjection = Vector3.Dot(firstSecond, secondPoint);
        var secondThirdProjection = Vector3.Dot(firstThird, secondPoint);
        if (secondFirstProjection >= 0f &&
            secondThirdProjection <= secondFirstProjection)
        {
            return second;
        }

        var firstSecondEdge =
            firstSecondProjection * secondThirdProjection -
            secondFirstProjection * firstThirdProjection;
        if (firstSecondEdge <= 0f &&
            firstSecondProjection >= 0f &&
            secondFirstProjection <= 0f)
        {
            var weight = firstSecondProjection /
                (firstSecondProjection - secondFirstProjection);
            return first + weight * firstSecond;
        }

        var thirdPoint = point - third;
        var thirdFirstProjection = Vector3.Dot(firstSecond, thirdPoint);
        var thirdSecondProjection = Vector3.Dot(firstThird, thirdPoint);
        if (thirdSecondProjection >= 0f &&
            thirdFirstProjection <= thirdSecondProjection)
        {
            return third;
        }

        var firstThirdEdge =
            thirdFirstProjection * firstThirdProjection -
            firstSecondProjection * thirdSecondProjection;
        if (firstThirdEdge <= 0f &&
            firstThirdProjection >= 0f &&
            thirdFirstProjection <= 0f)
        {
            var weight = firstThirdProjection /
                (firstThirdProjection - thirdFirstProjection);
            return first + weight * firstThird;
        }

        var secondThirdEdge =
            secondFirstProjection * thirdSecondProjection -
            thirdFirstProjection * secondThirdProjection;
        if (secondThirdEdge <= 0f &&
            secondThirdProjection - secondFirstProjection >= 0f &&
            thirdFirstProjection - thirdSecondProjection >= 0f)
        {
            var weight =
                (secondThirdProjection - secondFirstProjection) /
                ((secondThirdProjection - secondFirstProjection) +
                 (thirdFirstProjection - thirdSecondProjection));
            return second + weight * (third - second);
        }

        var denominatorSum =
            secondThirdEdge + firstThirdEdge + firstSecondEdge;
        if (Mathf.Abs(denominatorSum) <= 0.000001f)
        {
            var firstSecondPoint = ClosestPointOnSegment(point, first, second);
            var firstThirdPoint = ClosestPointOnSegment(point, first, third);
            var secondThirdPoint = ClosestPointOnSegment(point, second, third);
            var firstSecondDistance = (point - firstSecondPoint).sqrMagnitude;
            var firstThirdDistance = (point - firstThirdPoint).sqrMagnitude;
            var secondThirdDistance = (point - secondThirdPoint).sqrMagnitude;
            if (firstSecondDistance <= firstThirdDistance &&
                firstSecondDistance <= secondThirdDistance)
            {
                return firstSecondPoint;
            }
            return firstThirdDistance <= secondThirdDistance
                ? firstThirdPoint
                : secondThirdPoint;
        }

        var denominator = 1f / denominatorSum;
        var secondWeight = firstThirdEdge * denominator;
        var thirdWeight = firstSecondEdge * denominator;
        return first + firstSecond * secondWeight + firstThird * thirdWeight;
    }

    private static Vector3 ClosestPointOnSegment(
        Vector3 point,
        Vector3 start,
        Vector3 end)
    {
        var segment = end - start;
        var lengthSquared = segment.sqrMagnitude;
        if (lengthSquared <= 0.000001f)
        {
            return start;
        }
        var weight = Mathf.Clamp01(Vector3.Dot(point - start, segment) / lengthSquared);
        return start + weight * segment;
    }

    private static string AppendVehicleError(string current, string addition) =>
        current.Length == 0 ? addition : $"{current} {addition}";

    private sealed record CapturedVehicleGraph(
        DiscoveryVehicleGraphSnapshot Snapshot,
        List<CapturedVehicleNode> Nodes);

    private sealed record CapturedVehicleNode(
        GraphNode Node,
        DiscoveryVehicleGraphNodeSnapshot Snapshot);

    private sealed record VehicleEndpointCandidate(
        CapturedVehicleNode Node,
        Vector3 GraphPosition,
        string ProjectionMethod,
        float NodeCenterDistance,
        float GraphDistance);

    private sealed record VehicleNodeAddress(
        int GraphArrayIndex,
        int NodeIndex);
}
