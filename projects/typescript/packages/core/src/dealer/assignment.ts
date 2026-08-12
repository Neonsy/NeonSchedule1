import {
    TradeCatalogSchema,
    type DealerProfile,
    type TradeCatalog,
} from '#core/data/trade';

export interface LogicalDealerProfile extends Omit<DealerProfile, 'instanceKey'> {
    readonly instanceKeys: readonly string[];
}

export interface DealerAssignmentDealerState {
    readonly personId: string;
    readonly signingFeePaid: boolean;
}

export interface DealerAssignmentCustomer {
    readonly customerId: string;
    readonly expectedRevenue: number;
    readonly expectedProfit: number;
    readonly eligibleDealerIds?: readonly string[];
}

export interface DealerAssignmentInput {
    readonly dealers: readonly DealerAssignmentDealerState[];
    readonly customers: readonly DealerAssignmentCustomer[];
    readonly maximumDealerSubsets: number;
}

export interface DealerCustomerAssignment {
    readonly customerId: string;
    readonly dealerId: string;
    readonly expectedRevenue: number;
    readonly expectedProfitBeforeDealerCut: number;
    readonly dealerCut: number;
    readonly expectedProfitAfterDealerCut: number;
}

export interface DealerAssignmentGroup {
    readonly dealerId: string;
    readonly instanceKeys: readonly string[];
    readonly salesCutPercentage: number;
    readonly signingFeeCharged: number;
    readonly assignments: readonly DealerCustomerAssignment[];
    readonly expectedRevenue: number;
    readonly expectedProfitBeforeDealerCut: number;
    readonly dealerCut: number;
    readonly expectedProfit: number;
}

export interface DealerAssignmentEvidence {
    readonly logicalDealerCount: number;
    readonly collapsedInstanceCount: number;
    readonly possibleDealerSubsets: number | null;
    readonly evaluatedDealerSubsets: number;
    readonly maximumDealerSubsets: number;
    readonly flowAugmentations: number;
}

export interface DealerAssignmentResult {
    readonly status: 'exact' | 'subset-limit';
    readonly groups: readonly DealerAssignmentGroup[];
    readonly unassignedCustomerIds: readonly string[];
    readonly expectedRevenue: number;
    readonly expectedProfitBeforeDealerCosts: number;
    readonly dealerCut: number;
    readonly signingFees: number;
    readonly expectedProfit: number;
    readonly evidence: DealerAssignmentEvidence;
}

interface AvailableDealer {
    readonly profile: LogicalDealerProfile;
    readonly signingFeePaid: boolean;
}

interface CandidateResult {
    readonly groups: readonly DealerAssignmentGroup[];
    readonly assignments: readonly DealerCustomerAssignment[];
    readonly expectedRevenue: number;
    readonly expectedProfitBeforeDealerCosts: number;
    readonly dealerCut: number;
    readonly signingFees: number;
    readonly expectedProfit: number;
}

interface FlowEdge {
    readonly to: number;
    readonly reverse: number;
    capacity: number;
    readonly cost: number;
}

interface AssignmentEdge {
    readonly edge: FlowEdge;
    readonly customer: DealerAssignmentCustomer;
    readonly dealer: AvailableDealer;
    readonly dealerCut: number;
    readonly expectedProfitAfterDealerCut: number;
}

export class DealerAssignmentOptimizer {
    readonly #logicalDealers: readonly LogicalDealerProfile[];
    readonly #maximumCustomers: number;
    readonly #collapsedInstanceCount: number;

    constructor(catalogInput: TradeCatalog) {
        const catalog = TradeCatalogSchema.assert(catalogInput);
        this.#logicalDealers = logicalDealerProfiles(catalog);
        this.#maximumCustomers = catalog.dealerMechanics.maximumCustomers;
        if (!Number.isSafeInteger(this.#maximumCustomers) || this.#maximumCustomers < 1) {
            throw new Error('Dealer maximum customers must be a positive safe integer');
        }
        this.#collapsedInstanceCount = catalog.dealers.length - this.#logicalDealers.length;
    }

    assign(input: DealerAssignmentInput): DealerAssignmentResult {
        requirePositiveSafeInteger(input.maximumDealerSubsets, 'Maximum dealer subsets');
        const dealers = availableDealers(input.dealers, this.#logicalDealers);
        const customers = assignmentCustomers(input.customers, new Set(dealers.map(({ profile }) =>
            profile.personId
        )));
        const possibleSubsets = dealers.length < 53 ? 2 ** dealers.length : null;
        let evaluatedDealerSubsets = 0;
        let flowAugmentations = 0;
        let subsetLimitReached = false;
        let best = emptyCandidate();

        const evaluate = (active: readonly AvailableDealer[]): void => {
            if (evaluatedDealerSubsets >= input.maximumDealerSubsets) {
                subsetLimitReached = true;
                return;
            }
            evaluatedDealerSubsets++;
            const flow = solveAssignmentFlow(customers, active, this.#maximumCustomers);
            flowAugmentations += flow.augmentations;
            const usedDealerIds = new Set(flow.assignments.map(({ dealerId }) => dealerId));
            if (active.some(({ profile }) => !usedDealerIds.has(profile.personId))) return;
            const candidate = summarizeCandidate(flow.assignments, active);
            if (betterCandidate(candidate, best)) best = candidate;
        };

        const selected = Array<boolean>(dealers.length).fill(false);
        do {
            evaluate(dealers.filter((_, index) => selected[index]));
        } while (!subsetLimitReached && advanceSubset(selected));

        const assignedCustomerIds = new Set(best.assignments.map(({ customerId }) => customerId));
        return {
            status: subsetLimitReached ? 'subset-limit' : 'exact',
            groups: best.groups,
            unassignedCustomerIds: customers
                .map(({ customerId }) => customerId)
                .filter((customerId) => !assignedCustomerIds.has(customerId)),
            expectedRevenue: best.expectedRevenue,
            expectedProfitBeforeDealerCosts: best.expectedProfitBeforeDealerCosts,
            dealerCut: best.dealerCut,
            signingFees: best.signingFees,
            expectedProfit: best.expectedProfit,
            evidence: {
                logicalDealerCount: this.#logicalDealers.length,
                collapsedInstanceCount: this.#collapsedInstanceCount,
                possibleDealerSubsets: possibleSubsets,
                evaluatedDealerSubsets,
                maximumDealerSubsets: input.maximumDealerSubsets,
                flowAugmentations,
            },
        };
    }
}

export function logicalDealerProfiles(catalogInput: TradeCatalog): LogicalDealerProfile[] {
    const catalog = TradeCatalogSchema.assert(catalogInput);
    const grouped = new Map<string, DealerProfile[]>();
    const instanceKeys = new Set<string>();
    for (const dealer of catalog.dealers) {
        requireId(dealer.personId, 'Dealer person');
        requireId(dealer.instanceKey, 'Dealer instance');
        if (instanceKeys.has(dealer.instanceKey)) {
            throw new Error(`Duplicate dealer instance ${JSON.stringify(dealer.instanceKey)}`);
        }
        instanceKeys.add(dealer.instanceKey);
        const instances = grouped.get(dealer.personId);
        if (instances === undefined) grouped.set(dealer.personId, [dealer]);
        else instances.push(dealer);
    }
    return [...grouped]
        .map(([personId, instances]) => collapseDealer(personId, instances))
        .sort((left, right) => left.personId.localeCompare(right.personId));
}

function collapseDealer(personId: string, instances: readonly DealerProfile[]): LogicalDealerProfile {
    const first = instances[0]!;
    requireId(first.type, `Dealer ${JSON.stringify(personId)} type`);
    requireId(first.homeName, `Dealer ${JSON.stringify(personId)} home`);
    requirePositiveFinite(first.walkSpeed, `Dealer ${JSON.stringify(personId)} walk speed`);
    requirePercentage(first.salesCutPercentage, `Dealer ${JSON.stringify(personId)} sales cut`);
    requireNonNegativeFinite(first.signingFee, `Dealer ${JSON.stringify(personId)} signing fee`);
    if (!Number.isFinite(first.qualityTolerance.negative) ||
        !Number.isFinite(first.qualityTolerance.positive)) {
        throw new Error(`Dealer ${JSON.stringify(personId)} quality tolerance must be finite`);
    }
    for (const candidate of instances.slice(1)) {
        if (!sameCommercialProfile(first, candidate)) {
            throw new Error(
                `Dealer ${JSON.stringify(personId)} has inconsistent physical instance profiles`
            );
        }
    }
    return {
        personId,
        instanceKeys: instances.map(({ instanceKey }) => instanceKey).sort(),
        type: first.type,
        homeName: first.homeName,
        walkSpeed: first.walkSpeed,
        salesCutPercentage: first.salesCutPercentage,
        signingFee: first.signingFee,
        qualityTolerance: { ...first.qualityTolerance },
    };
}

function advanceSubset(selected: boolean[]): boolean {
    for (let index = selected.length - 1; index >= 0; index--) {
        if (!selected[index]) {
            selected[index] = true;
            return true;
        }
        selected[index] = false;
    }
    return false;
}

function sameCommercialProfile(left: DealerProfile, right: DealerProfile): boolean {
    return left.type === right.type &&
        left.homeName === right.homeName &&
        left.walkSpeed === right.walkSpeed &&
        left.salesCutPercentage === right.salesCutPercentage &&
        left.signingFee === right.signingFee &&
        left.qualityTolerance.negative === right.qualityTolerance.negative &&
        left.qualityTolerance.positive === right.qualityTolerance.positive;
}

function availableDealers(
    states: readonly DealerAssignmentDealerState[],
    profiles: readonly LogicalDealerProfile[]
): AvailableDealer[] {
    const profilesById = new Map(profiles.map((profile) => [profile.personId, profile]));
    const seen = new Set<string>();
    return states.map((state): AvailableDealer => {
        requireId(state.personId, 'Available dealer');
        if (seen.has(state.personId)) {
            throw new Error(`Duplicate available dealer ${JSON.stringify(state.personId)}`);
        }
        seen.add(state.personId);
        const profile = profilesById.get(state.personId);
        if (profile === undefined) {
            throw new Error(`Unknown available dealer ${JSON.stringify(state.personId)}`);
        }
        if (typeof state.signingFeePaid !== 'boolean') {
            throw new Error(`Dealer ${JSON.stringify(state.personId)} signing-fee state is invalid`);
        }
        return { profile, signingFeePaid: state.signingFeePaid };
    }).sort((left, right) => left.profile.personId.localeCompare(right.profile.personId));
}

function assignmentCustomers(
    input: readonly DealerAssignmentCustomer[],
    availableDealerIds: ReadonlySet<string>
): DealerAssignmentCustomer[] {
    const seen = new Set<string>();
    return input.map((customer): DealerAssignmentCustomer => {
        requireId(customer.customerId, 'Assignment customer');
        if (seen.has(customer.customerId)) {
            throw new Error(`Duplicate assignment customer ${JSON.stringify(customer.customerId)}`);
        }
        seen.add(customer.customerId);
        requireNonNegativeFinite(customer.expectedRevenue, 'Customer expected revenue');
        if (!Number.isFinite(customer.expectedProfit)) {
            throw new Error('Customer expected profit must be finite');
        }
        const eligibleDealerIds = customer.eligibleDealerIds === undefined
            ? undefined
            : uniqueIds(customer.eligibleDealerIds, 'eligible dealer');
        for (const dealerId of eligibleDealerIds ?? []) {
            if (!availableDealerIds.has(dealerId)) {
                throw new Error(`Unknown eligible dealer ${JSON.stringify(dealerId)}`);
            }
        }
        return { ...customer, ...(eligibleDealerIds === undefined ? {} : { eligibleDealerIds }) };
    }).sort((left, right) => left.customerId.localeCompare(right.customerId));
}

function solveAssignmentFlow(
    customers: readonly DealerAssignmentCustomer[],
    dealers: readonly AvailableDealer[],
    maximumCustomers: number
): { readonly assignments: readonly DealerCustomerAssignment[]; readonly augmentations: number } {
    if (customers.length === 0 || dealers.length === 0) return { assignments: [], augmentations: 0 };
    const source = 0;
    const firstCustomer = 1;
    const firstDealer = firstCustomer + customers.length;
    const sink = firstDealer + dealers.length;
    const graph = Array.from({ length: sink + 1 }, () => [] as FlowEdge[]);
    const assignmentEdges: AssignmentEdge[] = [];
    customers.forEach((customer, customerIndex) => {
        addEdge(graph, source, firstCustomer + customerIndex, 1, 0);
        const eligible = customer.eligibleDealerIds === undefined
            ? undefined
            : new Set(customer.eligibleDealerIds);
        dealers.forEach((dealer, dealerIndex) => {
            if (eligible !== undefined && !eligible.has(dealer.profile.personId)) return;
            const dealerCut = customer.expectedRevenue * dealer.profile.salesCutPercentage;
            const expectedProfitAfterDealerCut = customer.expectedProfit - dealerCut;
            if (expectedProfitAfterDealerCut <= 0) return;
            const edge = addEdge(
                graph,
                firstCustomer + customerIndex,
                firstDealer + dealerIndex,
                1,
                -expectedProfitAfterDealerCut
            );
            assignmentEdges.push({
                edge,
                customer,
                dealer,
                dealerCut,
                expectedProfitAfterDealerCut,
            });
        });
    });
    dealers.forEach((_, index) => addEdge(graph, firstDealer + index, sink, maximumCustomers, 0));

    let augmentations = 0;
    while (augmentNegativePath(graph, source, sink)) augmentations++;
    const assignments = assignmentEdges
        .filter(({ edge }) => edge.capacity === 0)
        .map(({ customer, dealer, dealerCut, expectedProfitAfterDealerCut }) => ({
            customerId: customer.customerId,
            dealerId: dealer.profile.personId,
            expectedRevenue: customer.expectedRevenue,
            expectedProfitBeforeDealerCut: customer.expectedProfit,
            dealerCut,
            expectedProfitAfterDealerCut,
        }))
        .sort((left, right) =>
            left.customerId.localeCompare(right.customerId) ||
            left.dealerId.localeCompare(right.dealerId)
        );
    return { assignments, augmentations };
}

function addEdge(
    graph: FlowEdge[][],
    from: number,
    to: number,
    capacity: number,
    cost: number
): FlowEdge {
    const forward = { to, reverse: graph[to]!.length, capacity, cost };
    const reverse = { to: from, reverse: graph[from]!.length, capacity: 0, cost: -cost };
    graph[from]!.push(forward);
    graph[to]!.push(reverse);
    return forward;
}

function augmentNegativePath(graph: FlowEdge[][], source: number, sink: number): boolean {
    const distances = Array<number>(graph.length).fill(Number.POSITIVE_INFINITY);
    const previousNode = Array<number>(graph.length).fill(-1);
    const previousEdge = Array<number>(graph.length).fill(-1);
    distances[source] = 0;
    for (let pass = 0; pass < graph.length - 1; pass++) {
        let changed = false;
        for (let node = 0; node < graph.length; node++) {
            if (!Number.isFinite(distances[node]!)) continue;
            graph[node]!.forEach((edge, edgeIndex) => {
                if (edge.capacity <= 0) return;
                const distance = distances[node]! + edge.cost;
                if (distance >= distances[edge.to]!) return;
                distances[edge.to] = distance;
                previousNode[edge.to] = node;
                previousEdge[edge.to] = edgeIndex;
                changed = true;
            });
        }
        if (!changed) break;
    }
    if (!Number.isFinite(distances[sink]!) || distances[sink]! >= 0) return false;
    for (let node = sink; node !== source; node = previousNode[node]!) {
        const from = previousNode[node]!;
        const edge = graph[from]![previousEdge[node]!]!;
        edge.capacity--;
        graph[node]![edge.reverse]!.capacity++;
    }
    return true;
}

function summarizeCandidate(
    assignments: readonly DealerCustomerAssignment[],
    active: readonly AvailableDealer[]
): CandidateResult {
    const groups = active.map(({ profile, signingFeePaid }): DealerAssignmentGroup => {
        const dealerAssignments = assignments.filter(({ dealerId }) => dealerId === profile.personId);
        const expectedRevenue = sum(dealerAssignments, ({ expectedRevenue: value }) => value);
        const expectedProfitBeforeDealerCut = sum(
            dealerAssignments,
            ({ expectedProfitBeforeDealerCut: value }) => value
        );
        const dealerCut = sum(dealerAssignments, ({ dealerCut: value }) => value);
        const signingFeeCharged = signingFeePaid ? 0 : profile.signingFee;
        return {
            dealerId: profile.personId,
            instanceKeys: profile.instanceKeys,
            salesCutPercentage: profile.salesCutPercentage,
            signingFeeCharged,
            assignments: dealerAssignments,
            expectedRevenue,
            expectedProfitBeforeDealerCut,
            dealerCut,
            expectedProfit: expectedProfitBeforeDealerCut - dealerCut - signingFeeCharged,
        };
    }).sort((left, right) => left.dealerId.localeCompare(right.dealerId));
    const expectedRevenue = sum(groups, ({ expectedRevenue: value }) => value);
    const expectedProfitBeforeDealerCosts = sum(
        groups,
        ({ expectedProfitBeforeDealerCut: value }) => value
    );
    const dealerCut = sum(groups, ({ dealerCut: value }) => value);
    const signingFees = sum(groups, ({ signingFeeCharged: value }) => value);
    return {
        groups,
        assignments: [...assignments],
        expectedRevenue,
        expectedProfitBeforeDealerCosts,
        dealerCut,
        signingFees,
        expectedProfit: expectedProfitBeforeDealerCosts - dealerCut - signingFees,
    };
}

function betterCandidate(left: CandidateResult, right: CandidateResult): boolean {
    if (left.expectedProfit !== right.expectedProfit) return left.expectedProfit > right.expectedProfit;
    if (left.dealerCut !== right.dealerCut) return left.dealerCut < right.dealerCut;
    if (left.signingFees !== right.signingFees) return left.signingFees < right.signingFees;
    if (left.groups.length !== right.groups.length) return left.groups.length < right.groups.length;
    return compareAssignments(left.assignments, right.assignments) < 0;
}

function compareAssignments(
    left: readonly DealerCustomerAssignment[],
    right: readonly DealerCustomerAssignment[]
): number {
    for (let index = 0; index < Math.min(left.length, right.length); index++) {
        const comparison = left[index]!.customerId.localeCompare(right[index]!.customerId) ||
            left[index]!.dealerId.localeCompare(right[index]!.dealerId);
        if (comparison !== 0) return comparison;
    }
    return left.length - right.length;
}

function emptyCandidate(): CandidateResult {
    return {
        groups: [],
        assignments: [],
        expectedRevenue: 0,
        expectedProfitBeforeDealerCosts: 0,
        dealerCut: 0,
        signingFees: 0,
        expectedProfit: 0,
    };
}

function sum<T>(values: readonly T[], select: (value: T) => number): number {
    return values.reduce((total, value) => total + select(value), 0);
}

function uniqueIds(ids: readonly string[], label: string): string[] {
    const unique = new Set<string>();
    for (const id of ids) {
        requireId(id, label);
        if (unique.has(id)) throw new Error(`Duplicate ${label} ${JSON.stringify(id)}`);
        unique.add(id);
    }
    return [...unique].sort();
}

function requireId(value: string, label: string): void {
    if (value.trim().length === 0) throw new Error(`${label} ID must not be blank`);
}

function requireNonNegativeFinite(value: number, label: string): void {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be non-negative`);
}

function requirePositiveFinite(value: number, label: string): void {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be positive`);
}

function requirePercentage(value: number, label: string): void {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error(`${label} must be between zero and one`);
    }
}

function requirePositiveSafeInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error(`${label} must be a positive safe integer`);
    }
}
