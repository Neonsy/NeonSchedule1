using UnityEngine;
using UnityEngine.AI;

namespace NeonSchedule1.GameDataExporter;

internal static partial class DiscoveryCollector
{
    private static DiscoveryPlayerControllerRouteCompatibilitySnapshot
        ProbePlayerControllerCompatibility(
            IReadOnlyList<VectorSnapshot3> corners,
            DiscoveryPlayerNavigationSnapshot navigation,
            DiscoveryPlayerMovementSnapshot movement)
    {
        var controller = movement.LoadedController;
        var probe = new DiscoveryPlayerControllerRouteCompatibilitySnapshot
        {
            Method =
                "navmesh-boundary-margin-route-elevation-and-diagnostic-locations",
            Applicability =
                "candidate-static-controller-geometry-not-charactercontroller-move-proof",
            Limitation =
                "Does not simulate CharacterController.Move, dynamic obstacles, doors, " +
                "collision layers, scripts, or identify explicit link traversal.",
            SampleSpacing = navigation.ControllerClearanceSampleSpacing,
            ControllerRadius = controller?.Radius ?? 0f,
            AgentRadius = navigation.Agent.Radius,
            RequiredAdditionalRadius = controller is null
                ? 0f
                : MathF.Max(0f, controller.Radius - navigation.Agent.Radius),
            ControllerHeight = controller?.Height ?? 0f,
            AgentHeight = navigation.Agent.Height,
            ControllerSlopeLimit = controller?.SlopeLimit ?? 0f,
            AgentMaximumSlope = navigation.Agent.MaximumSlope,
            ControllerStepOffset = controller?.StepOffset ?? 0f,
            AgentStepHeight = navigation.Agent.StepHeight,
        };
        if (controller is null)
        {
            probe.Error = "No loaded player character controller was available.";
            return probe;
        }
        if (corners.Count == 0)
        {
            probe.Error = "The complete path exposed no corners.";
            return probe;
        }

        const float tolerance = 1e-4f;
        probe.HeightEnvelopeSatisfied =
            controller.Height <= navigation.Agent.Height + tolerance;
        try
        {
            var sampling = SamplePlayerRoute(
                corners,
                navigation.ControllerClearanceSampleSpacing,
                navigation.Agent.TypeId,
                navigation.Agent.StepHeight);
            probe.RouteSurfaceSampleFailureCount = sampling.FailureCount;
            probe.RouteSurfaceFailureSpans = sampling.FailureSpans;
            var minimumBoundaryDistance = float.PositiveInfinity;
            PlayerRouteSurfaceSample? minimumBoundarySample = null;
            PlayerRouteSurfaceSample? firstBoundaryMarginFailure = null;
            PlayerRouteSurfaceSample? lastBoundaryMarginFailure = null;
            var firstBoundaryMarginFailureDistance = 0f;
            var lastBoundaryMarginFailureDistance = 0f;
            for (var index = 0; index < sampling.Samples.Count; index++)
            {
                var sample = sampling.Samples[index];
                if (NavMesh.FindClosestEdgeFilter(
                        sample.Position,
                        out var hit,
                        navigation.Agent.TypeId,
                        NavMesh.AllAreas))
                {
                    probe.BoundarySampleCount++;
                    if (hit.distance < minimumBoundaryDistance)
                    {
                        minimumBoundaryDistance = hit.distance;
                        probe.MinimumBoundaryDistance = hit.distance;
                        minimumBoundarySample = sample;
                    }
                    if (hit.distance + tolerance < probe.RequiredAdditionalRadius)
                    {
                        probe.BoundaryMarginFailureSampleCount++;
                        if (firstBoundaryMarginFailure is null)
                        {
                            firstBoundaryMarginFailure = sample;
                            firstBoundaryMarginFailureDistance = hit.distance;
                        }
                        lastBoundaryMarginFailure = sample;
                        lastBoundaryMarginFailureDistance = hit.distance;
                    }
                }
                else
                {
                    probe.BoundaryQueryFailureCount++;
                }
            }
            if (minimumBoundarySample is not null)
            {
                probe.MinimumBoundarySample = BoundarySampleSnapshot(
                    minimumBoundarySample,
                    sampling.RouteLength,
                    minimumBoundaryDistance);
            }
            if (firstBoundaryMarginFailure is not null)
            {
                probe.FirstBoundaryMarginFailure = BoundarySampleSnapshot(
                    firstBoundaryMarginFailure,
                    sampling.RouteLength,
                    firstBoundaryMarginFailureDistance);
            }
            if (lastBoundaryMarginFailure is not null)
            {
                probe.LastBoundaryMarginFailure = BoundarySampleSnapshot(
                    lastBoundaryMarginFailure,
                    sampling.RouteLength,
                    lastBoundaryMarginFailureDistance);
            }

            var slopeRadians = controller.SlopeLimit * (MathF.PI / 180f);
            for (var index = 1; index < sampling.Samples.Count; index++)
            {
                var delta =
                    sampling.Samples[index].Position -
                    sampling.Samples[index - 1].Position;
                var horizontalDistance = MathF.Sqrt(
                    (delta.x * delta.x) + (delta.z * delta.z));
                var absoluteRise = MathF.Abs(delta.y);
                var allowedRise =
                    (horizontalDistance * MathF.Tan(slopeRadians)) +
                    controller.StepOffset;
                probe.MaximumObservedAbsoluteRise = MathF.Max(
                    probe.MaximumObservedAbsoluteRise,
                    absoluteRise);
                probe.MaximumObservedElevationExcess = MathF.Max(
                    probe.MaximumObservedElevationExcess,
                    absoluteRise - allowedRise);
            }

            probe.RadiusMarginSatisfied =
                probe.BoundaryQueryFailureCount == 0 &&
                probe.MinimumBoundaryDistance is not null &&
                probe.BoundaryMarginFailureSampleCount == 0;
            probe.RouteElevationSatisfied =
                probe.RouteSurfaceSampleFailureCount == 0 &&
                probe.MaximumObservedElevationExcess <= tolerance;
            probe.SupportedByProbe =
                probe.RadiusMarginSatisfied &&
                probe.HeightEnvelopeSatisfied &&
                probe.RouteElevationSatisfied;
        }
        catch (Exception exception)
        {
            probe.Error = $"{exception.GetType().Name}: {exception.Message}";
        }
        return probe;
    }

    private static PlayerRouteSurfaceSamplingResult SamplePlayerRoute(
        IReadOnlyList<VectorSnapshot3> corners,
        float spacing,
        int agentTypeId,
        float agentStepHeight)
    {
        var rawSamples = new List<PlayerRouteRawSample>
        {
            new(0, 0, ToVector(corners[0]), 0f),
        };
        var routeLength = 0f;
        for (var index = 1; index < corners.Count; index++)
        {
            var start = ToVector(corners[index - 1]);
            var end = ToVector(corners[index]);
            var delta = end - start;
            var segmentLength = delta.magnitude;
            var horizontalDistance = MathF.Sqrt(
                (delta.x * delta.x) + (delta.z * delta.z));
            var steps = Math.Max(1, (int)MathF.Ceiling(horizontalDistance / spacing));
            for (var step = 1; step <= steps; step++)
            {
                var progress = step / (float)steps;
                rawSamples.Add(new PlayerRouteRawSample(
                    rawSamples.Count,
                    index - 1,
                    Vector3.Lerp(start, end, progress),
                    routeLength + (segmentLength * progress)));
            }
            routeLength += segmentLength;
        }

        var samples = new List<PlayerRouteSurfaceSample>(rawSamples.Count);
        var failureSpans =
            new List<DiscoveryPlayerRouteSurfaceFailureSpanSnapshot>();
        DiscoveryPlayerRouteSurfaceFailureSpanSnapshot? currentFailureSpan = null;
        var failureCount = 0;
        var maxSampleDistance = MathF.Max(spacing * 2f, agentStepHeight + 0.1f);
        for (var index = 0; index < rawSamples.Count; index++)
        {
            var raw = rawSamples[index];
            var succeeded = NavMesh.SamplePositionFilter(
                raw.Position,
                out var hit,
                maxSampleDistance,
                agentTypeId,
                NavMesh.AllAreas);
            samples.Add(new PlayerRouteSurfaceSample(
                raw.SampleIndex,
                raw.PathSegmentIndex,
                succeeded ? hit.position : raw.Position,
                raw.DistanceFromRouteStart,
                succeeded));
            if (succeeded)
            {
                if (currentFailureSpan is not null)
                {
                    failureSpans.Add(currentFailureSpan);
                    currentFailureSpan = null;
                }
                continue;
            }

            failureCount++;
            if (currentFailureSpan is null)
            {
                currentFailureSpan =
                    new DiscoveryPlayerRouteSurfaceFailureSpanSnapshot
                    {
                        StartSampleIndex = raw.SampleIndex,
                        EndSampleIndex = raw.SampleIndex,
                        StartPathSegmentIndex = raw.PathSegmentIndex,
                        EndPathSegmentIndex = raw.PathSegmentIndex,
                        SampleCount = 1,
                        StartPosition = VectorSnapshot3.FromVector(raw.Position),
                        EndPosition = VectorSnapshot3.FromVector(raw.Position),
                        StartDistanceFromRouteStart = raw.DistanceFromRouteStart,
                        EndDistanceFromRouteStart = raw.DistanceFromRouteStart,
                        StartDistanceFromRouteEnd =
                            MathF.Max(0f, routeLength - raw.DistanceFromRouteStart),
                        EndDistanceFromRouteEnd =
                            MathF.Max(0f, routeLength - raw.DistanceFromRouteStart),
                    };
                continue;
            }

            currentFailureSpan.EndSampleIndex = raw.SampleIndex;
            currentFailureSpan.EndPathSegmentIndex = raw.PathSegmentIndex;
            currentFailureSpan.SampleCount++;
            currentFailureSpan.EndPosition =
                VectorSnapshot3.FromVector(raw.Position);
            currentFailureSpan.EndDistanceFromRouteStart =
                raw.DistanceFromRouteStart;
            currentFailureSpan.EndDistanceFromRouteEnd =
                MathF.Max(0f, routeLength - raw.DistanceFromRouteStart);
        }
        if (currentFailureSpan is not null)
        {
            failureSpans.Add(currentFailureSpan);
        }
        return new PlayerRouteSurfaceSamplingResult(
            samples,
            failureSpans,
            failureCount,
            routeLength);
    }

    private static DiscoveryPlayerRouteBoundarySampleSnapshot BoundarySampleSnapshot(
        PlayerRouteSurfaceSample sample,
        float routeLength,
        float boundaryDistance) =>
        new()
        {
            SampleIndex = sample.SampleIndex,
            PathSegmentIndex = sample.PathSegmentIndex,
            Position = VectorSnapshot3.FromVector(sample.Position),
            DistanceFromRouteStart = sample.DistanceFromRouteStart,
            DistanceFromRouteEnd =
                MathF.Max(0f, routeLength - sample.DistanceFromRouteStart),
            BoundaryDistance = boundaryDistance,
            RouteSurfaceSampleSucceeded = sample.SurfaceSampleSucceeded,
        };

    private sealed record PlayerRouteRawSample(
        int SampleIndex,
        int PathSegmentIndex,
        Vector3 Position,
        float DistanceFromRouteStart);

    private sealed record PlayerRouteSurfaceSample(
        int SampleIndex,
        int PathSegmentIndex,
        Vector3 Position,
        float DistanceFromRouteStart,
        bool SurfaceSampleSucceeded);

    private sealed record PlayerRouteSurfaceSamplingResult(
        List<PlayerRouteSurfaceSample> Samples,
        List<DiscoveryPlayerRouteSurfaceFailureSpanSnapshot> FailureSpans,
        int FailureCount,
        float RouteLength);
}
