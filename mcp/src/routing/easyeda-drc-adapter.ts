import type { RoutingRules, RoutingRuleValues } from 'eda-copilot-router';
import type {
    PcbDrcBundle,
    PcbDrcDifferentialPairRule,
    PcbDrcEqualLengthGroupRule,
    PcbDrcNetClassRule,
    PcbDrcNetRule,
    PcbDrcNetRuleEntry,
} from '@copilot/shared/types/pcb/drc';

type JsonRecord = Record<string, unknown>;
type RelationRule = PcbDrcNetClassRule | PcbDrcEqualLengthGroupRule;

function record(value: unknown): JsonRecord | undefined {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function clone<T>(value: T): T {
    return structuredClone(value);
}

function presetFamily(root: JsonRecord, category: string, family: string) {
    const categoryObject = record(root[category]);
    const familyObject = record(categoryObject?.[family]);
    if (!categoryObject || !familyObject) {
        throw new TypeError(`EasyEDA DRC preset family is unavailable: ${category}.${family}`);
    }
    return familyObject;
}

function createPreset(root: JsonRecord, category: string, family: string, name: string) {
    const presets = presetFamily(root, category, family);
    const source = Object.values(presets).map(record).find((item): item is JsonRecord => Boolean(item));
    if (!source) throw new TypeError(`EasyEDA DRC preset family is empty: ${category}.${family}`);
    const output = clone<JsonRecord>(source);
    output.editName = name;
    output.isSetDefault = false;
    presets[name] = output;
    return output;
}

function rewriteNumbers(value: unknown, replacement: number): unknown {
    if (typeof value === 'number') return replacement;
    if (Array.isArray(value)) return value.map(item => rewriteNumbers(item, replacement));
    const target = record(value);
    if (target) for (const [key, child] of Object.entries(target)) {
        target[key] = rewriteNumbers(child, replacement);
    }
    return value;
}

function replaceNamedValues(value: unknown, fields: Readonly<Record<string, number>>) {
    if (Array.isArray(value)) {
        for (const child of value) replaceNamedValues(child, fields);
        return;
    }
    const target = record(value);
    if (!target) return;
    for (const [key, child] of Object.entries(target)) {
        if (fields[key] !== undefined) target[key] = fields[key];
        else replaceNamedValues(child, fields);
    }
}

function replaceNamedTables(value: unknown, fields: Readonly<Record<string, number>>) {
    if (Array.isArray(value)) {
        for (const child of value) replaceNamedTables(child, fields);
        return;
    }
    const target = record(value);
    if (!target) return;
    for (const [key, child] of Object.entries(target)) {
        if (fields[key] !== undefined) target[key] = rewriteNumbers(child, fields[key]);
        else replaceNamedTables(child, fields);
    }
}

function netOccurrences(netRules: readonly PcbDrcNetRuleEntry[], name: string) {
    const result: PcbDrcNetRule[] = [];
    for (const rule of netRules) {
        if (rule.type === 'net' && rule.name === name) result.push(rule);
        if (rule.type === 'netClass' || rule.type === 'equalLengthGroup') {
            for (const child of rule.sub) if (child.name === name) result.push(child);
        }
    }
    return result;
}

function sourceNetRule(netRules: readonly PcbDrcNetRuleEntry[], name: string): PcbDrcNetRule {
    return clone(netOccurrences(netRules, name)[0] ?? { type: 'net', name });
}

function memberRules(
    netRules: readonly PcbDrcNetRuleEntry[],
    current: readonly PcbDrcNetRule[],
    names: readonly string[],
) {
    const existing = new Map(current.map(item => [item.name, item]));
    return names.map(name => clone(existing.get(name) ?? sourceNetRule(netRules, name)));
}

function ensureNetClass(
    netRules: PcbDrcNetRuleEntry[],
    name: string,
    nets: readonly string[],
) {
    let rule = netRules.find((item): item is PcbDrcNetClassRule => item.type === 'netClass' && item.name === name);
    if (!rule) {
        rule = { type: 'netClass', name, sub: [] };
        netRules.push(rule);
    }
    rule.sub = memberRules(netRules, rule.sub, nets);
    return rule;
}

function ensureEqualLengthGroup(
    netRules: PcbDrcNetRuleEntry[],
    name: string,
    nets: readonly string[],
) {
    let rule = netRules.find((item): item is PcbDrcEqualLengthGroupRule => (
        item.type === 'equalLengthGroup' && item.name === name
    ));
    if (!rule) {
        rule = { type: 'equalLengthGroup', name, sub: [] };
        netRules.push(rule);
    }
    rule.sub = memberRules(netRules, rule.sub, nets);
    return rule;
}

function ensureDifferentialPair(
    netRules: PcbDrcNetRuleEntry[],
    pair: { id: string; positive: string; negative: string },
) {
    let rule = netRules.find((item): item is PcbDrcDifferentialPairRule => (
        item.type === 'differentialPair' && item.name === pair.id
    ));
    if (!rule) {
        rule = {
            type: 'differentialPair',
            name: pair.id,
            positiveNet: pair.positive,
            negativeNet: pair.negative,
            sub: [],
        };
        netRules.push(rule);
    }
    rule.positiveNet = pair.positive;
    rule.negativeNet = pair.negative;
    rule.sub = memberRules(netRules, rule.sub, [pair.positive, pair.negative])
        .map(item => ({ type: 'net', name: item.name }));
    return rule;
}

const PHYSICAL_FIELDS = ['Track', 'Via Size', 'Safe Spacing'] as const;

function copyFields(source: PcbDrcNetRule | RelationRule, targets: readonly PcbDrcNetRule[], fields = PHYSICAL_FIELDS) {
    for (const target of targets) for (const field of fields) {
        if (source[field] === undefined) delete target[field];
        else target[field] = source[field];
    }
}

function assignPhysicalPresets(
    configuration: JsonRecord,
    rule: PcbDrcNetRule | RelationRule,
    values: RoutingRuleValues,
    prefix: string,
) {
    const trackName = `${prefix}_track`;
    const track = createPreset(configuration, 'Physics', 'Track', trackName);
    const formData = record(record(track.form)?.data);
    const widthEntry = formData && (record(formData['1']) ?? Object.values(formData).map(record).find(Boolean));
    if (!widthEntry) throw new TypeError('EasyEDA Track preset does not expose form.data width fields.');
    widthEntry.minValue = values.minTrackWidthMm;
    widthEntry.defaultValue = values.preferredTrackWidthMm;
    widthEntry.maxValue = Math.max(values.minTrackWidthMm, values.preferredTrackWidthMm);
    rule.Track = trackName;

    const viaName = `${prefix}_via`;
    const via = createPreset(configuration, 'Physics', 'Via Size', viaName);
    replaceNamedValues(via, {
        viaOuterdiameterMin: values.via.minDiameterMm,
        viaOuterdiameterDefault: values.via.preferredDiameterMm,
        viaOuterdiameterMax: Math.max(values.via.minDiameterMm, values.via.preferredDiameterMm),
        viaInnerdiameterMin: values.via.minDrillMm,
        viaInnerdiameterDefault: values.via.preferredDrillMm,
        viaInnerdiameterMax: Math.max(values.via.minDrillMm, values.via.preferredDrillMm),
    });
    rule['Via Size'] = viaName;

    const spacingName = `${prefix}_spacing`;
    const spacing = createPreset(configuration, 'Spacing', 'Safe Spacing', spacingName);
    const rewriteContent = (value: unknown) => {
        if (Array.isArray(value)) {
            for (const child of value) rewriteContent(child);
            return;
        }
        const item = record(value);
        if (!item) return;
        for (const [key, child] of Object.entries(item)) {
            if (key === 'content') item[key] = rewriteNumbers(child, values.clearanceMm);
            else rewriteContent(child);
        }
    };
    rewriteContent(spacing);
    rule['Safe Spacing'] = spacingName;
}

function assignDifferentialPreset(
    configuration: JsonRecord,
    netRules: PcbDrcNetRuleEntry[],
    pair: { id: string; positive: string; negative: string },
    values: RoutingRuleValues,
    index: number,
) {
    if (!values.differential) return;
    const name = `copilot_router_diff_${index}`;
    const preset = createPreset(configuration, 'Physics', 'Differential Pair', name);
    replaceNamedTables(preset, {
        strokeWidthTables: values.differential.trackWidthMm,
        diffPairSpacingTables: values.differential.gapMm,
    });
    if (values.differential.maxSkewMm !== undefined) replaceNamedValues(
        preset,
        { differentailPairLenTolerMax: values.differential.maxSkewMm },
    );
    for (const net of [pair.positive, pair.negative]) {
        for (const occurrence of netOccurrences(netRules, net)) occurrence['Differential Pair'] = name;
    }
}

function sameValues(left: RoutingRuleValues, right: RoutingRuleValues) {
    return JSON.stringify(left) === JSON.stringify(right);
}

function sameNames(left: readonly string[], right: readonly string[]) {
    const sortedLeft = [...left].sort();
    const sortedRight = [...right].sort();
    return sortedLeft.length === sortedRight.length
        && sortedLeft.every((item, index) => item === sortedRight[index]);
}

function changedKeys<T>(
    source: readonly T[] | undefined,
    target: readonly T[] | undefined,
    key: (item: T) => string,
    equal: (left: T, right: T) => boolean,
) {
    const before = new Map((source ?? []).map(item => [key(item), item]));
    const after = new Map((target ?? []).map(item => [key(item), item]));
    return new Set([...before.keys(), ...after.keys()].filter(name => {
        const left = before.get(name);
        const right = after.get(name);
        return !left || !right || !equal(left, right);
    }));
}

export type RoutingRulesDiff = Readonly<{
    defaultChanged: boolean;
    nets: ReadonlySet<string>;
    netClasses: ReadonlySet<string>;
    differentialPairs: ReadonlySet<string>;
    matchedGroups: ReadonlySet<string>;
    hasChanges: boolean;
}>;

export function diffRoutingRules(source: RoutingRules, target: RoutingRules): RoutingRulesDiff {
    const nets = changedKeys(source.nets, target.nets, item => item.net, (left, right) => sameValues(left.values, right.values));
    const netClasses = changedKeys(source.netClasses, target.netClasses, item => item.name, (left, right) => (
        sameNames(left.nets, right.nets) && sameValues(left.values, right.values)
    ));
    const differentialPairs = changedKeys(source.differentialPairs, target.differentialPairs, item => item.id, (left, right) => (
        left.positive === right.positive && left.negative === right.negative
    ));
    const matchedGroups = changedKeys(source.matchedGroups, target.matchedGroups, item => item.id, (left, right) => (
        sameNames(left.nets, right.nets) && left.toleranceMm === right.toleranceMm
    ));
    const defaultChanged = !sameValues(source.default, target.default);
    return {
        defaultChanged, nets, netClasses, differentialPairs, matchedGroups,
        hasChanges: defaultChanged || nets.size > 0 || netClasses.size > 0
            || differentialPairs.size > 0 || matchedGroups.size > 0,
    };
}

function preset(configuration: JsonRecord, category: string, family: string, name: unknown) {
    const presets = presetFamily(configuration, category, family);
    if (typeof name === 'string' && record(presets[name])) return record(presets[name]);
    return Object.values(presets).map(record).find(item => item?.isSetDefault === true)
        ?? Object.values(presets).map(record).find(Boolean);
}

function nestedNumber(value: unknown, key: string): number | undefined {
    if (Array.isArray(value)) for (const child of value) {
        const found = nestedNumber(child, key);
        if (found !== undefined) return found;
    }
    const item = record(value);
    if (!item) return undefined;
    const firstNumber = (candidate: unknown): number | undefined => {
        if (typeof candidate === 'number') return candidate;
        if (Array.isArray(candidate)) for (const child of candidate) {
            const found = firstNumber(child);
            if (found !== undefined) return found;
        }
        const nested = record(candidate);
        if (nested) for (const child of Object.values(nested)) {
            const found = firstNumber(child);
            if (found !== undefined) return found;
        }
        return undefined;
    };
    if (item[key] !== undefined) return firstNumber(item[key]);
    for (const child of Object.values(item)) {
        const found = nestedNumber(child, key);
        if (found !== undefined) return found;
    }
    return undefined;
}

function valuesFromNativeRule(
    configuration: JsonRecord,
    rule: PcbDrcNetRuleEntry,
    fallback: RoutingRuleValues,
): RoutingRuleValues {
    const track = preset(configuration, 'Physics', 'Track', rule.Track);
    const via = preset(configuration, 'Physics', 'Via Size', rule['Via Size']);
    const spacing = preset(configuration, 'Spacing', 'Safe Spacing', rule['Safe Spacing']);
    return {
        ...fallback,
        minTrackWidthMm: nestedNumber(track, 'minValue') ?? fallback.minTrackWidthMm,
        preferredTrackWidthMm: nestedNumber(track, 'defaultValue') ?? fallback.preferredTrackWidthMm,
        clearanceMm: nestedNumber(spacing, 'content') ?? fallback.clearanceMm,
        via: {
            minDiameterMm: nestedNumber(via, 'viaOuterdiameterMin') ?? fallback.via.minDiameterMm,
            preferredDiameterMm: nestedNumber(via, 'viaOuterdiameterDefault') ?? fallback.via.preferredDiameterMm,
            minDrillMm: nestedNumber(via, 'viaInnerdiameterMin') ?? fallback.via.minDrillMm,
            preferredDrillMm: nestedNumber(via, 'viaInnerdiameterDefault') ?? fallback.via.preferredDrillMm,
        },
    };
}

/** Add the native EasyEDA relation state that is absent from autoroute JSON. */
export function mergeEasyEdaDrcIntoRoutingRules(source: PcbDrcBundle, rules: RoutingRules): RoutingRules {
    const valuesByNet = new Map(rules.nets.map(item => [item.net, item.values]));
    const netClasses = source.netRules.filter((item): item is PcbDrcNetClassRule => item.type === 'netClass').map(item => ({
        name: item.name,
        nets: item.sub.map(net => net.name),
        values: valuesFromNativeRule(
            source.ruleConfiguration,
            item,
            valuesByNet.get(item.sub[0]?.name ?? '') ?? rules.default,
        ),
    }));
    const differentialPairs = source.netRules
        .filter((item): item is PcbDrcDifferentialPairRule => item.type === 'differentialPair')
        .map(item => ({ id: item.name, positive: item.positiveNet, negative: item.negativeNet }));
    const matchedGroups = source.netRules
        .filter((item): item is PcbDrcEqualLengthGroupRule => item.type === 'equalLengthGroup')
        .map(item => ({
            id: item.name,
            nets: item.sub.map(net => net.name),
            toleranceMm: nestedNumber(
                preset(source.ruleConfiguration, 'Physics', 'Net Length Tolerance', item['Net Length Tolerance']),
                'netLengthTolerance',
            ) ?? 25.4,
        }));
    const {
        netClasses: _autorouteNetClasses,
        differentialPairs: _autorouteDifferentialPairs,
        matchedGroups: _autorouteMatchedGroups,
        ...physicalRules
    } = rules;
    return {
        ...physicalRules,
        ...(netClasses.length ? { netClasses } : {}),
        ...(differentialPairs.length ? { differentialPairs } : {}),
        ...(matchedGroups.length ? { matchedGroups } : {}),
    };
}

function updateDefaultPhysicalPresets(configuration: JsonRecord, values: RoutingRuleValues) {
    const track = preset(configuration, 'Physics', 'Track', undefined);
    const formData = record(record(track?.form)?.data);
    const widthEntry = formData && (record(formData['1']) ?? Object.values(formData).map(record).find(Boolean));
    if (widthEntry) {
        widthEntry.minValue = values.minTrackWidthMm;
        widthEntry.defaultValue = values.preferredTrackWidthMm;
        widthEntry.maxValue = Math.max(values.minTrackWidthMm, values.preferredTrackWidthMm);
    }
    const via = preset(configuration, 'Physics', 'Via Size', undefined);
    if (via) replaceNamedValues(via, {
        viaOuterdiameterMin: values.via.minDiameterMm,
        viaOuterdiameterDefault: values.via.preferredDiameterMm,
        viaOuterdiameterMax: Math.max(values.via.minDiameterMm, values.via.preferredDiameterMm),
        viaInnerdiameterMin: values.via.minDrillMm,
        viaInnerdiameterDefault: values.via.preferredDrillMm,
        viaInnerdiameterMax: Math.max(values.via.minDrillMm, values.via.preferredDrillMm),
    });
    const spacing = preset(configuration, 'Spacing', 'Safe Spacing', undefined);
    const updateContent = (candidate: unknown) => {
        if (Array.isArray(candidate)) {
            for (const child of candidate) updateContent(child);
            return;
        }
        const item = record(candidate);
        if (!item) return;
        for (const [key, child] of Object.entries(item)) {
            if (key === 'content') item[key] = rewriteNumbers(child, values.clearanceMm);
            else updateContent(child);
        }
    };
    updateContent(spacing);
}

/** Translate fully materialized EDA-neutral rules to native EasyEDA DRC trees. */
export function routingRulesToEasyEdaDrcBundle(
    source: PcbDrcBundle,
    sourceRules: RoutingRules,
    rules: RoutingRules,
): PcbDrcBundle {
    const ruleConfiguration = clone(source.ruleConfiguration);
    let netRules = clone(source.netRules);
    const changes = diffRoutingRules(sourceRules, rules);
    if (!changes.hasChanges) return { ruleConfiguration, netRules };
    if (changes.defaultChanged) updateDefaultPhysicalPresets(ruleConfiguration, rules.default);
    const valuesByNet = new Map(rules.nets.map(item => [item.net, item.values]));
    const classForNet = new Map<string, NonNullable<RoutingRules['netClasses']>[number]>();
    const classRuleForNet = new Map<string, PcbDrcNetClassRule>();

    for (const [index, item] of (rules.netClasses ?? []).entries()) {
        const classRule = ensureNetClass(netRules, item.name, item.nets);
        if (changes.netClasses.has(item.name)) {
            assignPhysicalPresets(ruleConfiguration, classRule, item.values, `copilot_router_class_${index}`);
            copyFields(classRule, classRule.sub);
        }
        for (const net of item.nets) {
            classForNet.set(net, item);
            classRuleForNet.set(net, classRule);
        }
    }
    const targetClassNames = new Set((rules.netClasses ?? []).map(item => item.name));
    netRules = netRules.filter(rule => rule.type !== 'netClass' || targetClassNames.has(rule.name));

    for (const [index, assignment] of rules.nets.entries()) {
        if (!changes.nets.has(assignment.net)) continue;
        const inheritedClass = classForNet.get(assignment.net);
        if (inheritedClass && sameValues(inheritedClass.values, assignment.values)) {
            copyFields(classRuleForNet.get(assignment.net)!, netOccurrences(netRules, assignment.net));
            continue;
        }
        let occurrences = netOccurrences(netRules, assignment.net);
        if (!occurrences.length) {
            const rule: PcbDrcNetRule = { type: 'net', name: assignment.net };
            netRules.push(rule);
            occurrences = [rule];
        }
        const assignmentRule = clone(occurrences[0]);
        assignPhysicalPresets(ruleConfiguration, assignmentRule, assignment.values, `copilot_router_net_${index}`);
        copyFields(assignmentRule, occurrences);
    }

    for (const [index, group] of (rules.matchedGroups ?? []).entries()) {
        const groupRule = ensureEqualLengthGroup(netRules, group.id, group.nets);
        if (!changes.matchedGroups.has(group.id)) continue;
        const name = `copilot_router_match_${index}`;
        const tolerance = createPreset(ruleConfiguration, 'Physics', 'Net Length Tolerance', name);
        replaceNamedValues(tolerance, { netLengthTolerance: group.toleranceMm });
        groupRule['Net Length Tolerance'] = name;
        for (const member of groupRule.sub) member['Net Length Tolerance'] = name;
    }
    const targetGroupNames = new Set((rules.matchedGroups ?? []).map(item => item.id));
    netRules = netRules.filter(rule => rule.type !== 'equalLengthGroup' || targetGroupNames.has(rule.name));

    // Native EasyEDA stores class/group members below their relation nodes instead
    // of retaining an additional top-level net entry. Differential-pair nodes are
    // supplementary and therefore do not affect this primary placement.
    const groupedNets = new Set([
        ...(rules.netClasses ?? []).flatMap(item => item.nets),
        ...(rules.matchedGroups ?? []).flatMap(item => item.nets),
    ]);
    const primaryNames = new Set(netRules.filter(rule => rule.type === 'net').map(rule => rule.name));
    for (const assignment of rules.nets) if (!groupedNets.has(assignment.net) && !primaryNames.has(assignment.net)) {
        netRules.push(sourceNetRule(source.netRules, assignment.net));
    }
    const nativeNetRules = netRules.filter(rule => rule.type !== 'net' || !groupedNets.has(rule.name));

    // Differential-pair nodes are supplementary. Apply them only after the
    // primary net/class/length-group placement is final, so a restored
    // standalone net receives (or loses) the pair preset as well.
    const targetPairMembers = new Set((rules.differentialPairs ?? []).flatMap(pair => [pair.positive, pair.negative]));
    const affectedPairMembers = new Set([
        ...(sourceRules.differentialPairs ?? []),
        ...(rules.differentialPairs ?? []),
    ].filter(pair => changes.differentialPairs.has(pair.id)).flatMap(pair => [pair.positive, pair.negative]));
    for (const rule of nativeNetRules) if (rule.type !== 'differentialPair') for (const net of (
        rule.type === 'net' ? [rule] : rule.sub
    )) if (affectedPairMembers.has(net.name) && !targetPairMembers.has(net.name)) {
        delete net['Differential Pair'];
    }
    for (const [index, pair] of (rules.differentialPairs ?? []).entries()) {
        ensureDifferentialPair(nativeNetRules, pair);
        if (!changes.differentialPairs.has(pair.id)) continue;
        const values = valuesByNet.get(pair.positive) ?? valuesByNet.get(pair.negative);
        if (values) assignDifferentialPreset(ruleConfiguration, nativeNetRules, pair, values, index);
    }
    const targetPairNames = new Set((rules.differentialPairs ?? []).map(item => item.id));
    const finalNetRules = nativeNetRules.filter(
        rule => rule.type !== 'differentialPair' || targetPairNames.has(rule.name),
    );

    return { ruleConfiguration, netRules: finalNetRules };
}
