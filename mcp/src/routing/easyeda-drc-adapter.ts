import type { RoutingRules, RoutingRuleValues } from 'eda-copilot-router';
import type {
    PcbDrcBundle,
    PcbDrcDifferentialPairRule,
    PcbDrcRuleObject,
} from '@copilot/shared/types/pcb/drc';

type JsonRecord = Record<string, unknown>;

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
    presets[name] = output;
    return output;
}

function rewriteNumbers(value: unknown, replacement: number): unknown {
    if (typeof value === 'number') return replacement;
    if (Array.isArray(value)) return value.map(item => rewriteNumbers(item, replacement));
    const target = record(value);
    if (target) {
        for (const [key, child] of Object.entries(target)) target[key] = rewriteNumbers(child, replacement);
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

function collectNetRules(value: unknown, output = new Map<string, PcbDrcRuleObject>()) {
    if (Array.isArray(value)) {
        for (const child of value) collectNetRules(child, output);
        return output;
    }
    const item = record(value);
    if (!item) return output;
    if (item.type === 'net' && typeof item.name === 'string' && item.name) {
        output.set(item.name, clone(item));
    }
    if (Array.isArray(item.sub)) collectNetRules(item.sub, output);
    return output;
}

function assignRulePresets(
    configuration: JsonRecord,
    netRule: PcbDrcRuleObject,
    values: RoutingRuleValues,
    index: number,
) {
    const prefix = `copilot_router_${index}`;
    const trackName = `${prefix}_track`;
    const track = createPreset(configuration, 'Physics', 'Track', trackName);
    const formData = record(record(track.form)?.data);
    const widthEntry = formData && (record(formData['1']) ?? Object.values(formData).map(record).find(Boolean));
    if (!widthEntry) throw new TypeError('EasyEDA Track preset does not expose form.data width fields.');
    widthEntry.minValue = values.minTrackWidthMm;
    widthEntry.defaultValue = values.preferredTrackWidthMm;
    widthEntry.maxValue = Math.max(values.minTrackWidthMm, values.preferredTrackWidthMm);
    netRule.Track = trackName;

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
    netRule['Via Size'] = viaName;

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
    netRule['Safe Spacing'] = spacingName;

    if (values.differential) {
        const differentialName = `${prefix}_diff`;
        const differential = createPreset(configuration, 'Physics', 'Differential Pair', differentialName);
        replaceNamedTables(differential, {
            strokeWidthTables: values.differential.trackWidthMm,
            diffPairSpacingTables: values.differential.gapMm,
        });
        if (values.differential.maxSkewMm !== undefined) replaceNamedValues(
            differential,
            { differentailPairLenTolerMax: values.differential.maxSkewMm },
        );
        netRule['Differential Pair'] = differentialName;
    }
}

/** Translate fully materialized EDA-neutral rules to an EasyEDA DRC bundle. */
export function routingRulesToEasyEdaDrcBundle(
    source: PcbDrcBundle,
    rules: RoutingRules,
): PcbDrcBundle {
    const ruleConfiguration = clone(source.ruleConfiguration);
    const sourceNets = collectNetRules(source.netRules);
    const netRules = new Map<string, PcbDrcRuleObject>();
    for (const [index, assignment] of rules.nets.entries()) {
        const netRule = sourceNets.get(assignment.net) ?? { type: 'net', name: assignment.net };
        netRule.type = 'net';
        netRule.name = assignment.net;
        assignRulePresets(ruleConfiguration, netRule, assignment.values, index);
        netRules.set(assignment.net, netRule);
    }

    const pairMembers = new Set((rules.differentialPairs ?? []).flatMap(pair => [pair.positive, pair.negative]));
    const matchedMembers = new Set((rules.matchedGroups ?? []).flatMap(group => group.nets));
    const relationOverlap = [...pairMembers].filter(net => matchedMembers.has(net));
    if (relationOverlap.length) throw new TypeError(
        `EasyEDA cannot apply the same net as both a differential-pair and equal-length child: ${relationOverlap.join(', ')}`,
    );

    const output: Array<PcbDrcRuleObject | PcbDrcDifferentialPairRule> = [];
    for (const [net, rule] of netRules) if (!pairMembers.has(net) && !matchedMembers.has(net)) output.push(rule);
    for (const pair of rules.differentialPairs ?? []) {
        const positive = netRules.get(pair.positive);
        const negative = netRules.get(pair.negative);
        if (!positive || !negative) throw new TypeError(`Differential pair ${pair.id} references a missing net rule.`);
        const preset = positive['Differential Pair'] ?? negative['Differential Pair'];
        output.push({
            type: 'differentialPair', name: pair.id,
            positiveNet: pair.positive, negativeNet: pair.negative,
            ...(preset === undefined ? {} : { 'Differential Pair': preset }),
            sub: [positive as never, negative as never],
        });
    }
    for (const [groupIndex, group] of (rules.matchedGroups ?? []).entries()) {
        const toleranceName = `copilot_router_match_${groupIndex}`;
        const tolerance = createPreset(ruleConfiguration, 'Physics', 'Net Length Tolerance', toleranceName);
        replaceNamedValues(tolerance, { netLengthTolerance: group.toleranceMm });
        const sub = group.nets.map(net => {
            const rule = netRules.get(net);
            if (!rule) throw new TypeError(`Matched group ${group.id} references a missing net rule: ${net}`);
            rule['Net Length Tolerance'] = toleranceName;
            return rule;
        });
        output.push({ type: 'equalLengthGroup', name: group.id, 'Net Length Tolerance': toleranceName, sub });
    }
    return { ruleConfiguration, netRules: output };
}
