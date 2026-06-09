import { CamelCaseString } from '@codama/nodes';

import { Fragment, getExportAllFragment, mergeFragments } from '../utils';

/**
 * A barrel export path segment: a camelCase node name or a dotted aggregate/framing
 * file name. Plain `string` is excluded so un-normalized names fail to compile.
 */
export type IndexPageItemName = CamelCaseString | `${string}.${string}`;

export function getIndexPageFragment(items: { name: IndexPageItemName }[]): Fragment | undefined {
    if (items.length === 0) return;

    const names = items
        .map(item => item.name)
        .sort((a, b) => a.localeCompare(b))
        .map(name => getExportAllFragment(`./${name}`));

    return mergeFragments(names, cs => cs.join('\n'));
}
