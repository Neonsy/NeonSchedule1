import type { Customer, CustomerCatalog } from '#core/data/customer';
import type { Person, RelationshipCatalog } from '#core/data/person';
import type { RankCatalog, RankReference } from '#core/data/progression';
import type { TradeCatalog } from '#core/data/trade';
import type { WorldMap, WorldRegion } from '#core/data/world';
import {
    logicalDealerProfiles,
    type DealerAssignmentDealerState,
    type LogicalDealerProfile,
} from '#core/dealer/assignment';
import { RelationshipGraph } from '#core/relationship/graph';

export interface PersonRelationshipFact {
    readonly personId: string;
    readonly relationship: number;
}

export interface PersonEligibilityFacts {
    readonly currentRank?: RankReference;
    readonly unlockedPersonIds?: readonly string[];
    readonly relationships?: readonly PersonRelationshipFact[];
    readonly recommendedDealerIds?: readonly string[];
    readonly recruitedDealerIds?: readonly string[];
}

export type PersonEligibilityStatus = 'eligible' | 'ineligible' | 'unknown';

export type PersonEligibilityReason =
    | { readonly code: 'missing-current-rank'; readonly regionId: string; readonly required: RankReference }
    | {
        readonly code: 'rank-below-region-requirement';
        readonly regionId: string;
        readonly current: RankReference;
        readonly required: RankReference;
    }
    | { readonly code: 'missing-person-unlock-fact' }
    | { readonly code: 'person-not-unlocked' }
    | { readonly code: 'missing-current-relationship' }
    | { readonly code: 'unsupported-dealer-type'; readonly dealerType: string }
    | { readonly code: 'missing-dealer-recruitment-fact' }
    | { readonly code: 'missing-dealer-recommendation-fact' }
    | { readonly code: 'dealer-not-recommended' }
    | { readonly code: 'dealer-not-mutually-known'; readonly connectionIds: readonly string[] };

export interface CustomerEligibilityDecision {
    readonly customerId: string;
    readonly status: PersonEligibilityStatus;
    readonly currentRelationship: number | null;
    readonly reasons: readonly PersonEligibilityReason[];
}

export interface DealerEligibilityDecision {
    readonly dealerId: string;
    readonly instanceKeys: readonly string[];
    readonly dealerType: string;
    readonly status: PersonEligibilityStatus;
    readonly signingFeePaid: boolean | null;
    readonly connectionIds: readonly string[];
    readonly reasons: readonly PersonEligibilityReason[];
}

export interface PersonEligibility {
    readonly customers: readonly CustomerEligibilityDecision[];
    readonly dealers: readonly DealerEligibilityDecision[];
    readonly eligibleCustomerIds: readonly string[];
    readonly dealerAssignmentStates: readonly DealerAssignmentDealerState[];
}

export interface PersonEligibilityData {
    readonly ranks: RankCatalog;
    readonly world: Pick<WorldMap, 'regions'>;
    readonly people: readonly Person[];
    readonly customers: readonly Customer[];
    readonly customerCatalog: Pick<CustomerCatalog, 'constants' | 'customerIds'>;
    readonly relationships: RelationshipCatalog;
    readonly trade: TradeCatalog;
}

interface IndexedData {
    readonly ranks: ReadonlyMap<string, number>;
    readonly people: ReadonlyMap<string, Person>;
    readonly regions: ReadonlyMap<string, WorldRegion>;
    readonly relationships: RelationshipGraph;
    readonly dealers: readonly LogicalDealerProfile[];
}

interface ResolvedFacts {
    readonly currentRank: RankReference | undefined;
    readonly unlockedPeople: ReadonlySet<string> | undefined;
    readonly relationships: ReadonlyMap<string, number> | undefined;
    readonly recommendedDealers: ReadonlySet<string> | undefined;
    readonly recruitedDealers: ReadonlySet<string> | undefined;
}

const unknownReasonCodes = new Set<PersonEligibilityReason['code']>([
    'missing-current-rank',
    'missing-person-unlock-fact',
    'missing-current-relationship',
    'missing-dealer-recruitment-fact',
    'missing-dealer-recommendation-fact',
]);

export class PersonEligibilityResolver {
    readonly #data: IndexedData;
    readonly #customers: readonly Customer[];
    readonly #minimumRelationship: number;
    readonly #maximumRelationship: number;

    constructor(data: PersonEligibilityData) {
        const ranks = rankIndex(data.ranks);
        const people = uniqueIndex(data.people, ({ id }) => id, 'person');
        const regions = uniqueIndex(data.world.regions, ({ id }) => id, 'region');
        const customers = [...data.customers].sort((left, right) => left.id.localeCompare(right.id));
        uniqueIndex(customers, ({ id }) => id, 'customer');
        const catalogCustomerIds = uniqueIds(data.customerCatalog.customerIds, 'catalog customer');
        if (!sameIds(customers.map(({ id }) => id), catalogCustomerIds)) {
            throw new Error('Customer definitions do not match the normalized customer catalog');
        }
        for (const customer of customers) {
            const person = requirePerson(people, customer.id, `Customer ${JSON.stringify(customer.id)}`);
            if (!person.roles.includes('customer')) {
                throw new Error(`Customer ${JSON.stringify(customer.id)} has no customer person role`);
            }
            if (!person.regions.includes(customer.region)) {
                throw new Error(`Customer ${JSON.stringify(customer.id)} region does not match its person`);
            }
        }
        for (const person of data.people) {
            for (const regionId of person.regions) {
                if (!regions.has(regionId)) {
                    throw new Error(`Person ${JSON.stringify(person.id)} has unknown region ${JSON.stringify(regionId)}`);
                }
            }
        }
        const graph = new RelationshipGraph(data.relationships);
        if (!sameIds(graph.personIds, [...people.keys()])) {
            throw new Error('Relationship catalog people do not match normalized people');
        }
        const dealers = logicalDealerProfiles(data.trade);
        for (const dealer of dealers) {
            const person = requirePerson(people, dealer.personId, `Dealer ${JSON.stringify(dealer.personId)}`);
            if (!person.roles.includes('dealer')) {
                throw new Error(`Dealer ${JSON.stringify(dealer.personId)} has no dealer person role`);
            }
            const instanceKeys = new Set(person.instances.map(({ key }) => key));
            for (const instanceKey of dealer.instanceKeys) {
                if (!instanceKeys.has(instanceKey)) {
                    throw new Error(
                        `Dealer ${JSON.stringify(dealer.personId)} has unknown instance ${JSON.stringify(instanceKey)}`
                    );
                }
            }
        }
        this.#minimumRelationship = data.customerCatalog.constants.minimumRelationship;
        this.#maximumRelationship = data.customerCatalog.constants.maximumRelationship;
        if (!Number.isFinite(this.#minimumRelationship) ||
            !Number.isFinite(this.#maximumRelationship) ||
            this.#minimumRelationship > this.#maximumRelationship) {
            throw new Error('Customer relationship range is invalid');
        }
        this.#data = { ranks, people, regions, relationships: graph, dealers };
        this.#customers = customers;
    }

    resolve(facts: PersonEligibilityFacts): PersonEligibility {
        const resolved = this.#resolveFacts(facts);
        const customers = this.#customers.map((customer) => this.#customerDecision(customer, resolved));
        const dealers = this.#data.dealers.map((dealer) => this.#dealerDecision(dealer, resolved));
        return {
            customers,
            dealers,
            eligibleCustomerIds: customers
                .filter(({ status }) => status === 'eligible')
                .map(({ customerId }) => customerId),
            dealerAssignmentStates: dealers
                .filter((decision): decision is DealerEligibilityDecision & { signingFeePaid: boolean } =>
                    decision.status === 'eligible' && decision.signingFeePaid !== null
                )
                .map(({ dealerId, signingFeePaid }) => ({ personId: dealerId, signingFeePaid })),
        };
    }

    #resolveFacts(facts: PersonEligibilityFacts): ResolvedFacts {
        if (facts.currentRank !== undefined) requireRank(this.#data.ranks, facts.currentRank, 'Current rank');
        const personIds = [...this.#data.people.keys()];
        const dealerIds = this.#data.dealers.map(({ personId }) => personId);
        const relationships = optionalRelationshipMap(
            facts.relationships,
            new Set(personIds),
            this.#minimumRelationship,
            this.#maximumRelationship
        );
        return {
            currentRank: facts.currentRank,
            unlockedPeople: optionalKnownSet(facts.unlockedPersonIds, personIds, 'unlocked person'),
            relationships,
            recommendedDealers: optionalKnownSet(
                facts.recommendedDealerIds,
                dealerIds,
                'recommended dealer'
            ),
            recruitedDealers: optionalKnownSet(
                facts.recruitedDealerIds,
                dealerIds,
                'recruited dealer'
            ),
        };
    }

    #customerDecision(customer: Customer, facts: ResolvedFacts): CustomerEligibilityDecision {
        const person = this.#data.people.get(customer.id)!;
        const reasons = [
            ...this.#regionReasons(person, facts.currentRank),
            ...unlockReasons(customer.id, facts.unlockedPeople),
        ];
        const currentRelationship = facts.relationships?.get(customer.id) ?? null;
        if (currentRelationship === null) reasons.push({ code: 'missing-current-relationship' });
        return {
            customerId: customer.id,
            status: statusFor(reasons),
            currentRelationship,
            reasons,
        };
    }

    #dealerDecision(dealer: LogicalDealerProfile, facts: ResolvedFacts): DealerEligibilityDecision {
        const person = this.#data.people.get(dealer.personId)!;
        const connectionIds = this.#data.relationships.neighbors(dealer.personId);
        const reasons: PersonEligibilityReason[] = [
            ...this.#regionReasons(person, facts.currentRank),
        ];
        let signingFeePaid: boolean | null = null;
        if (dealer.type !== 'PlayerDealer') {
            reasons.push({ code: 'unsupported-dealer-type', dealerType: dealer.type });
        } else if (facts.recruitedDealers === undefined) {
            reasons.push({ code: 'missing-dealer-recruitment-fact' });
        } else if (facts.recruitedDealers.has(dealer.personId)) {
            signingFeePaid = true;
        } else {
            signingFeePaid = false;
            if (facts.recommendedDealers === undefined) {
                reasons.push({ code: 'missing-dealer-recommendation-fact' });
            } else if (!facts.recommendedDealers.has(dealer.personId)) {
                reasons.push({ code: 'dealer-not-recommended' });
            }
            if (facts.unlockedPeople === undefined) {
                reasons.push({ code: 'missing-person-unlock-fact' });
            } else if (!connectionIds.some((personId) => facts.unlockedPeople!.has(personId))) {
                reasons.push({ code: 'dealer-not-mutually-known', connectionIds });
            }
        }
        return {
            dealerId: dealer.personId,
            instanceKeys: dealer.instanceKeys,
            dealerType: dealer.type,
            status: statusFor(reasons),
            signingFeePaid,
            connectionIds,
            reasons,
        };
    }

    #regionReasons(
        person: Person,
        currentRank: RankReference | undefined
    ): PersonEligibilityReason[] {
        const requirements = person.regions.map((regionId) => {
            const region = this.#data.regions.get(regionId)!;
            return { region, required: regionRankRequirement(region, this.#data.ranks) };
        });
        if (requirements.length === 0 || requirements.some(({ region, required }) =>
            region.unlockedByDefault || required === null ||
            (currentRank !== undefined && rankPosition(this.#data.ranks, currentRank) >=
                rankPosition(this.#data.ranks, required)))) {
            return [];
        }
        if (currentRank === undefined) {
            return requirements.map(({ region, required }) => ({
                code: 'missing-current-rank',
                regionId: region.id,
                required: required!,
            }));
        }
        return requirements.map(({ region, required }) => ({
            code: 'rank-below-region-requirement',
            regionId: region.id,
            current: currentRank,
            required: required!,
        }));
    }
}

function statusFor(reasons: readonly PersonEligibilityReason[]): PersonEligibilityStatus {
    if (reasons.some(({ code }) => !unknownReasonCodes.has(code))) return 'ineligible';
    return reasons.length === 0 ? 'eligible' : 'unknown';
}

function unlockReasons(
    personId: string,
    unlockedPeople: ReadonlySet<string> | undefined
): PersonEligibilityReason[] {
    if (unlockedPeople === undefined) return [{ code: 'missing-person-unlock-fact' }];
    return unlockedPeople.has(personId) ? [] : [{ code: 'person-not-unlocked' }];
}

function regionRankRequirement(
    region: WorldRegion,
    ranks: ReadonlyMap<string, number>
): RankReference | null {
    if (region.rankRequirement === null) return null;
    const matches = [...ranks.keys()]
        .map(rankFromKey)
        .filter((rank) => formatRegionRank(rank) === region.rankRequirement);
    if (matches.length !== 1) {
        throw new Error(
            `Region ${JSON.stringify(region.id)} rank requirement ` +
            `${JSON.stringify(region.rankRequirement)} does not identify one normalized rank`
        );
    }
    return matches[0]!;
}

function formatRegionRank(rank: RankReference): string {
    return `${rank.rank.replaceAll('_', ' ')} ${romanNumeral(rank.tier)}`;
}

function romanNumeral(value: number): string {
    const numerals = ['I', 'II', 'III', 'IV', 'V'];
    return numerals[value - 1] ?? String(value);
}

function rankIndex(catalog: RankCatalog): ReadonlyMap<string, number> {
    const result = new Map<string, number>();
    let previousXp = -1;
    for (const [position, rank] of catalog.levels.entries()) {
        const key = rankKey(rank);
        if (result.has(key)) throw new Error(`Duplicate normalized rank ${formatRank(rank)}`);
        if (!Number.isSafeInteger(rank.tier) || rank.tier < 1) {
            throw new Error(`Normalized rank ${formatRank(rank)} has an invalid tier`);
        }
        if (!Number.isSafeInteger(rank.totalXpRequired) || rank.totalXpRequired < 0 ||
            rank.totalXpRequired <= previousXp) {
            throw new Error('Normalized rank catalog must be strictly ordered by required XP');
        }
        previousXp = rank.totalXpRequired;
        result.set(key, position);
    }
    if (result.size === 0) throw new Error('Normalized rank catalog cannot be empty');
    return result;
}

function requireRank(
    ranks: ReadonlyMap<string, number>,
    rank: RankReference,
    label: string
): void {
    if (!ranks.has(rankKey(rank))) {
        throw new Error(`${label} is not in the normalized rank catalog: ${formatRank(rank)}`);
    }
}

function rankPosition(ranks: ReadonlyMap<string, number>, rank: RankReference): number {
    return ranks.get(rankKey(rank))!;
}

function rankKey(rank: RankReference): string {
    return `${rank.rank}\u0000${rank.tier}`;
}

function rankFromKey(key: string): RankReference {
    const separator = key.lastIndexOf('\u0000');
    return { rank: key.slice(0, separator), tier: Number(key.slice(separator + 1)) };
}

function formatRank(rank: RankReference): string {
    return `${JSON.stringify(rank.rank)} tier ${rank.tier}`;
}

function optionalKnownSet(
    values: readonly string[] | undefined,
    knownValues: readonly string[],
    label: string
): ReadonlySet<string> | undefined {
    if (values === undefined) return undefined;
    const known = new Set(knownValues);
    const result = new Set<string>();
    for (const value of values) {
        if (!known.has(value)) throw new Error(`Unknown ${label} ${JSON.stringify(value)}`);
        if (result.has(value)) throw new Error(`Duplicate ${label} ${JSON.stringify(value)}`);
        result.add(value);
    }
    return result;
}

function optionalRelationshipMap(
    values: readonly PersonRelationshipFact[] | undefined,
    knownPeople: ReadonlySet<string>,
    minimum: number,
    maximum: number
): ReadonlyMap<string, number> | undefined {
    if (values === undefined) return undefined;
    const result = new Map<string, number>();
    for (const fact of values) {
        if (!knownPeople.has(fact.personId)) {
            throw new Error(`Unknown relationship person ${JSON.stringify(fact.personId)}`);
        }
        if (result.has(fact.personId)) {
            throw new Error(`Duplicate relationship person ${JSON.stringify(fact.personId)}`);
        }
        if (!Number.isFinite(fact.relationship) || fact.relationship < minimum ||
            fact.relationship > maximum) {
            throw new Error(
                `Relationship for ${JSON.stringify(fact.personId)} must be between ${minimum} and ${maximum}`
            );
        }
        result.set(fact.personId, fact.relationship);
    }
    return result;
}

function uniqueIndex<T>(
    values: readonly T[],
    key: (value: T) => string,
    label: string
): ReadonlyMap<string, T> {
    const result = new Map<string, T>();
    for (const value of values) {
        const id = key(value);
        if (id.trim() === '') throw new Error(`${label} ID must not be blank`);
        if (result.has(id)) throw new Error(`Duplicate ${label} ${JSON.stringify(id)}`);
        result.set(id, value);
    }
    return result;
}

function uniqueIds(values: readonly string[], label: string): string[] {
    return [...uniqueIndex(values, (value) => value, label).keys()].sort();
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
    const sortedLeft = [...left].sort();
    const sortedRight = [...right].sort();
    return sortedLeft.length === sortedRight.length &&
        sortedLeft.every((value, index) => value === sortedRight[index]);
}

function requirePerson(
    people: ReadonlyMap<string, Person>,
    personId: string,
    label: string
): Person {
    const person = people.get(personId);
    if (person === undefined) throw new Error(`${label} has no normalized person`);
    return person;
}
